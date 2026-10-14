'use strict';

/**
 * server.js — 麦门券官 HTTP 服务
 *
 * 能力：
 * - 托管前端仪表盘（public/）
 * - GET  /api/dashboard：我的优惠券 + 我的积分 + 今日活动（聚合看板）
 * - POST /api/claim：一键领取全部可领优惠券（available-coupons → auto-bind-coupons → query-my-coupons）
 * - GET  /api/health：健康检查（含当前模式 REAL / MOCK）
 *
 * 运行：
 *   export MCD_MCP_TOKEN=你的Token   # 真实模式
 *   node server.js
 * 未配置 Token 时自动进入 MOCK（演示）模式。
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const { McpClient } = require('./src/mcp-client');
const {
  parseAvailableCoupons,
  parseClaimResult,
  parseMyCoupons,
  parseCampaignCalendar,
  buildDashboard,
  estimateSavings,
  buildPortfolio,
  extractCouponValue,
} = require('./src/coupon-engine');
const {
  parseMeals,
  buildAdvisor,
  parsePriceResult,
} = require('./src/advisor-engine');

const PORT = Number(process.env.PORT || 3001);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');

const COUPON_TTL_MS = 60 * 1000; // 我的券缓存 1 分钟
const ACCOUNT_TTL_MS = 60 * 1000; // 积分缓存 1 分钟
const CAMPAIGN_TTL_MS = 30 * 60 * 1000; // 活动缓存 30 分钟
const MENU_TTL_MS = 30 * 60 * 1000; // 菜单缓存 30 分钟（菜单变化慢）

const DEFAULT_STORE = '1950801'; // 用券决策默认门店：麦当劳北京学院国际大厦餐厅（演示/真实均可查询）

const MOCK_DATA = loadJson(path.join(ROOT, 'examples', 'mock-data.json'));
const client = new McpClient({ mockData: MOCK_DATA });

// Mock 模式下注入函数型计价：按 items × mock 菜单价格表动态计算（单位：分）
client.mockData['calculate-price'] = function mockCalculatePrice(args) {
  const items = Array.isArray(args && args.items) ? args.items : [];
  const rawMenu = typeof this.mockData['query-meals'] === 'string'
    ? this.mockData['query-meals']
    : JSON.stringify(this.mockData['query-meals']);
  const menuRes = parseMeals(rawMenu);
  const priceMap = {};
  for (const m of menuRes) priceMap[m.code] = Math.round(m.currentPrice * 100);
  let total = 0;
  const list = [];
  for (const it of items) {
    const code = it && (it.productCode || it.code);
    const qty = Number(it && it.quantity) || 1;
    const unit = priceMap[String(code)] || 0;
    const sub = unit * qty;
    total += sub;
    list.push({ productCode: String(code), price: unit, quantity: qty, name: String(code) });
  }
  return {
    success: true, code: 200, message: '请求成功', datetime: new Date().toISOString(),
    data: {
      productOriginalPrice: total, productPrice: total,
      deliveryOriginalPrice: 0, deliveryPrice: 0,
      packingOriginalPrice: 0, packingPrice: 0, tablewarePrice: 0,
      originalPrice: total, discount: 0, price: total, productList: list,
    },
  };
};

const cache = {
  coupons: { data: null, at: 0 },
  account: { data: null, at: 0 },
  campaign: { data: null, at: 0 },
  menu: { data: null, at: 0 },
};

function loadJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    console.error(`[mcd-auto-coupon] 读取 ${file} 失败: ${err.message}`);
    return {};
  }
}

async function cached(key, ttl, fetcher) {
  const now = Date.now();
  if (cache[key].data && now - cache[key].at < ttl) return cache[key].data;
  const data = await fetcher();
  cache[key].data = data;
  cache[key].at = now;
  return data;
}

async function getMyCoupons() {
  return cached('coupons', COUPON_TTL_MS, async () => {
    const res = await client.callTool('query-my-coupons');
    return parseMyCoupons(res.data);
  });
}

async function getAccount() {
  return cached('account', ACCOUNT_TTL_MS, async () => {
    const res = await client.callTool('query-my-account');
    return res.ok && res.data && typeof res.data === 'object' ? res.data : null;
  });
}

async function getActivities() {
  return cached('campaign', CAMPAIGN_TTL_MS, async () => {
    const res = await client.callTool('campaign-calendar');
    return parseCampaignCalendar(res.data);
  });
}

/** 拉取默认门店菜单（到店自取），30 分钟缓存 */
async function getMenu() {
  return cached('menu', MENU_TTL_MS, async () => {
    const res = await client.callTool('query-meals', {
      storeCode: DEFAULT_STORE,
      orderType: 1,
      beType: 1,
    });
    return parseMeals(res.data);
  });
}

/** 对候选餐品逐项官方真实计价，返回 [{code, name, price(元), verified:boolean}] */
async function verifyPrices(candidates) {
  const items = candidates.map((c) => ({ productCode: c.code, quantity: 1 }));
  if (items.length === 0) return [];
  const res = await client.callTool('calculate-price', {
    storeCode: DEFAULT_STORE,
    orderType: 1,
    beType: 1,
    items,
  });
  const parsed = parsePriceResult(res.data);
  if (!parsed) {
    // 计价解析失败：退回候选的菜单价（标 verified:false）
    return candidates.map((c) => ({ code: c.code, name: c.name, price: c.price, verified: false }));
  }
  return candidates.map((c) => ({
    code: c.code,
    name: c.name,
    price: Math.round(c.price * 100) / 100,
    verified: true,
  }));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 64 * 1024) {
        reject(new Error('请求体过大'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('请求体不是合法 JSON'));
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Forbidden');
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 Not Found');
    }
    const ext = path.extname(file).toLowerCase();
    const types = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.ico': 'image/x-icon',
    };
    res.writeHead(200, {
      'Content-Type': types[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
}

function sendJson(res, status, obj) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(obj));
}

async function handleDashboard(req, res) {
  try {
    const [myCoupons, account, activities] = await Promise.all([
      getMyCoupons().catch(() => ({ count: 0, coupons: [] })),
      getAccount().catch(() => null),
      getActivities().catch(() => []),
    ]);
    const dashboard = buildDashboard(myCoupons, account, activities);
    sendJson(res, 200, { ok: true, mock: client.isMock, ...dashboard });
  } catch (err) {
    console.error('[mcd-auto-coupon] /api/dashboard 失败:', err.message);
    sendJson(res, 502, { ok: false, error: err.message });
  }
}

/** GET /api/portfolio — 券资产金额化驾驶舱 */
async function handlePortfolio(req, res) {
  try {
    const [myCoupons, account] = await Promise.all([
      getMyCoupons().catch(() => ({ count: 0, coupons: [] })),
      getAccount().catch(() => null),
    ]);
    const portfolio = buildPortfolio(myCoupons, account);
    sendJson(res, 200, { ok: true, mock: client.isMock, ...portfolio });
  } catch (err) {
    console.error('[mcd-auto-coupon] /api/portfolio 失败:', err.message);
    sendJson(res, 502, { ok: false, error: err.message });
  }
}

/** POST /api/advisor — 智能用券决策（券→餐反向匹配，TOP N 真实计价） */
async function handleAdvisor(req, res) {
  try {
    const body = await readJsonBody(req);
    const couponIndex = Number(body.couponIndex);
    if (!Number.isInteger(couponIndex) || couponIndex < 0) {
      return sendJson(res, 400, { ok: false, error: '参数 couponIndex 必须是 >=0 的整数' });
    }
    const myCoupons = await getMyCoupons().catch(() => ({ count: 0, coupons: [] }));
    const coupon = (myCoupons.coupons || [])[couponIndex];
    if (!coupon) {
      return sendJson(res, 404, { ok: false, error: '找不到这张优惠券' });
    }
    const value = extractCouponValue(coupon);
    const meals = await getMenu().catch(() => []);
    const advisor = buildAdvisor(value, meals);
    // 对 TOP N 候选官方真实计价
    let candidates = advisor.candidates;
    if (advisor.usable && candidates.length > 0) {
      candidates = await verifyPrices(candidates).catch(() => candidates.map((c) => ({
        code: c.code, name: c.name, price: c.price, verified: false,
      })));
      // 把计价结果合并回候选
      const priceMap = {};
      for (const p of candidates) priceMap[p.code] = { price: p.price, verified: p.verified };
      candidates = advisor.candidates.map((c) => ({
        ...c,
        verifiedPrice: priceMap[c.code] ? priceMap[c.code].price : null,
        verified: priceMap[c.code] ? priceMap[c.code].verified : false,
      }));
    }
    const expiry = myCoupons.coupons && coupon.validDate ? coupon.validDate : '';
    sendJson(res, 200, {
      ok: true,
      mock: client.isMock,
      coupon: { title: coupon.title, benefit: coupon.benefit || '', validDate: expiry },
      value,
      usable: advisor.usable,
      reason: advisor.reason || '',
      storeCode: DEFAULT_STORE,
      candidates,
    });
  } catch (err) {
    console.error('[mcd-auto-coupon] /api/advisor 失败:', err.message);
    sendJson(res, 502, { ok: false, error: err.message });
  }
}

async function handleClaim(req, res) {
  try {
    // 1. 领券前记录当前券数（作为净增基准）
    const before = await getMyCoupons().catch(() => ({ count: 0, coupons: [] }));

    // 2. 查询可领券列表
    const availRes = await client.callTool('available-coupons');
    const available = parseAvailableCoupons(availRes.data);

    // 3. 一键领取
    const claimRes = await client.callTool('auto-bind-coupons');
    const claim = parseClaimResult(claimRes.data);

    // 4. 领完后重新拉取"我的优惠券"（跳过缓存），以实际入账为准
    cache.coupons = { data: null, at: 0 };
    const myCoupons = await getMyCoupons();
    const netNew = Math.max(0, (myCoupons.count || 0) - (before.count || 0));

    const savings = estimateSavings(myCoupons.coupons);

    sendJson(res, 200, {
      ok: true,
      mock: client.isMock,
      claim: {
        total: claim.total,
        success: claim.success,
        failed: claim.failed,
        error: claim.error || '',
        coupons: claim.coupons,
      },
      newClaimed: netNew,
      available: available,
      coupons: { count: myCoupons.count, list: myCoupons.coupons },
      savings: savings ? { label: `已领券预计可省约 ¥${savings.total}`, count: savings.count, total: savings.total } : null,
    });
  } catch (err) {
    console.error('[mcd-auto-coupon] /api/claim 失败:', err.message);
    sendJson(res, 502, {
      ok: false,
      error: err.message,
      hint: client.isMock
        ? 'Mock 模式执行失败（检查 examples/mock-data.json）'
        : '真实模式调用失败，请检查 MCD_MCP_TOKEN 与网络',
    });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);
  try {
    if (req.method === 'GET' && pathname === '/api/health') {
      return sendJson(res, 200, {
        ok: true,
        app: 'mcd-auto-coupon',
        version: '2.0.0',
        mock: client.isMock,
        tools: ['available-coupons', 'auto-bind-coupons', 'query-my-coupons', 'query-my-account', 'campaign-calendar', 'query-meals', 'calculate-price'],
      });
    }
    if (req.method === 'GET' && pathname === '/api/dashboard') {
      return await handleDashboard(req, res);
    }
    if (req.method === 'GET' && pathname === '/api/portfolio') {
      return await handlePortfolio(req, res);
    }
    if (req.method === 'POST' && pathname === '/api/advisor') {
      return await handleAdvisor(req, res);
    }
    if (req.method === 'POST' && pathname === '/api/claim') {
      return await handleClaim(req, res);
    }
    if (pathname.startsWith('/api/')) {
      return sendJson(res, 404, { ok: false, error: '接口不存在' });
    }
    return serveStatic(req, res, pathname);
  } catch (err) {
    console.error('[mcd-auto-coupon] 请求处理异常:', err.message);
    return sendJson(res, 500, { ok: false, error: err.message });
  }
});

server.listen(PORT, () => {
  const mode = client.isMock ? 'MOCK（模拟数据，未配置 Token）' : 'REAL（真实麦当劳 MCP）';
  console.log('========================================');
  console.log('  麦门券官 mcd-auto-coupon v2.0.0');
  console.log(`  运行模式: ${mode}`);
  console.log(`  打开浏览器: http://localhost:${PORT}`);
  console.log('  配置真实 Token: export MCD_MCP_TOKEN=<你的Token>');
  console.log('  V2.0 新增: 券资产驾驶舱 / 智能用券决策 / 省钱战报');
  console.log('========================================');

  // 启动后台预热：先拉一次菜单与券数据进缓存，用户首次点击"怎么用最值"即可秒出建议
  // （query-meals 全量菜单官方响应可达 20~40 秒，预热避免首个用户等太久）
  if (!client.isMock) {
    getMenu().then((meals) => {
      console.log(`[mcd-auto-coupon] 菜单预热完成: ${meals.length} 个餐品`);
    }).catch((err) => {
      console.warn('[mcd-auto-coupon] 菜单预热失败（稍后点击时会自动重试）:', err.message);
    });
    getMyCoupons().then((coupons) => {
      console.log(`[mcd-auto-coupon] 券数据预热完成: ${coupons.count} 张券`);
    }).catch((err) => {
      console.warn('[mcd-auto-coupon] 券数据预热失败（稍后访问时会自动重试）:', err.message);
    });
  }
});
