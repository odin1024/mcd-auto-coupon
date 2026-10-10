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
} = require('./src/coupon-engine');

const PORT = Number(process.env.PORT || 3001);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');

const COUPON_TTL_MS = 60 * 1000; // 我的券缓存 1 分钟
const ACCOUNT_TTL_MS = 60 * 1000; // 积分缓存 1 分钟
const CAMPAIGN_TTL_MS = 30 * 60 * 1000; // 活动缓存 30 分钟

const MOCK_DATA = loadJson(path.join(ROOT, 'examples', 'mock-data.json'));
const client = new McpClient({ mockData: MOCK_DATA });

const cache = {
  coupons: { data: null, at: 0 },
  account: { data: null, at: 0 },
  campaign: { data: null, at: 0 },
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
        version: '1.0.0',
        mock: client.isMock,
        tools: ['available-coupons', 'auto-bind-coupons', 'query-my-coupons', 'query-my-account', 'campaign-calendar'],
      });
    }
    if (req.method === 'GET' && pathname === '/api/dashboard') {
      return await handleDashboard(req, res);
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
  console.log('  麦门券官 mcd-auto-coupon v1.0.0');
  console.log(`  运行模式: ${mode}`);
  console.log(`  打开浏览器: http://localhost:${PORT}`);
  console.log('  配置真实 Token: export MCD_MCP_TOKEN=<你的Token>');
  console.log('========================================');
});
