'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseAvailableCoupons,
  parseClaimResult,
  parseMyCoupons,
  parseCampaignCalendar,
  estimateSavings,
  extractCouponValue,
  couponExpiry,
  buildPortfolio,
  buildDashboard,
} = require('../src/coupon-engine');

const { McpClient } = require('../src/mcp-client');

/* ---------------- 麦麦省券列表 ---------------- */

test('available-coupons：官方示例格式解析', () => {
  const text =
    '### 麦麦省优惠券列表： \n' +
    '- 优惠券标题：11.9元麦乐鸡\n 状态：已领取\n 优惠券图片：\n <img src="https://img.mcd.cn/a.png" height="auto" width="300">\n' +
    '- 优惠券标题：9.9元薯你最甜\n 状态：未领取\n 优惠券图片：\n <img src="https://img.mcd.cn/b.png" height="auto" width="300">\n' +
    '- 优惠券标题：北非蛋风味麦满分\n 状态：不可领取\n 优惠券图片：\n <img src="https://img.mcd.cn/c.png" height="auto" width="300">';
  const list = parseAvailableCoupons(text);
  assert.equal(list.length, 3);
  assert.equal(list[0].title, '11.9元麦乐鸡');
  assert.equal(list[0].status, '已领取');
  assert.equal(list[1].title, '9.9元薯你最甜');
  assert.equal(list[1].status, '未领取');
  assert.equal(list[1].image, 'https://img.mcd.cn/b.png');
  assert.equal(list[2].status, '不可领取');
});

test('available-coupons：空输入安全降级', () => {
  assert.deepEqual(parseAvailableCoupons(''), []);
  assert.deepEqual(parseAvailableCoupons(null), []);
});

/* ---------------- 一键领券结果 ---------------- */

test('auto-bind-coupons：官方示例格式解析', () => {
  const text =
    '### 🎉 领券结果 **总计**: 2 张优惠券\n' +
    '**成功**: 2 张\n' +
    '**失败**: 0 张\n\n' +
    '---\n\n' +
    '#### ✅ 成功领取的优惠券： \n' +
    '- **9.9元薯你最甜**  \n' +
    '- couponId：8ED8D8BEBEBDEF26B615682E92EFAC86\n' +
    ' - couponCode：MCDD60T892ST5EV00N1090\n' +
    ' - 图片：<img src="https://img.mcd.cn/b.png" alt="9.9元薯你最甜" height="200" width="auto"> \n' +
    '- **任意消费立减3元**  \n' +
    '- couponId：5F1C2A3B4C5D6E7F8A9B0C1D2E3F4A5B6\n' +
    ' - couponCode：MCDD31T111ST5EV00N2222';
  const r = parseClaimResult(text);
  assert.equal(r.total, 2);
  assert.equal(r.success, 2);
  assert.equal(r.failed, 0);
  assert.equal(r.coupons.length, 2);
  assert.equal(r.coupons[0].title, '9.9元薯你最甜');
  assert.equal(r.coupons[0].couponId, '8ED8D8BEBEBDEF26B615682E92EFAC86');
  assert.equal(r.coupons[1].title, '任意消费立减3元');
});

test('auto-bind-coupons：官方失败格式解析（暂无可领取）', () => {
  const r = parseClaimResult('### 领券失败\n\n错误信息：暂无可领取的优惠券');
  assert.equal(r.total, 0);
  assert.equal(r.success, 0);
  assert.equal(r.failed, 0);
  assert.equal(r.error, '暂无可领取的优惠券');
  assert.deepEqual(r.coupons, []);
});

test('auto-bind-coupons：空输入安全降级', () => {
  assert.deepEqual(parseClaimResult(''), { total: 0, success: 0, failed: 0, error: '', coupons: [] });
  assert.deepEqual(parseClaimResult(null), { total: 0, success: 0, failed: 0, error: '', coupons: [] });
});

/* ---------------- 我的优惠券 ---------------- */

test('query-my-coupons：官方示例格式解析', () => {
  const text =
    '# 您的优惠券列表\n\n' +
    '共 1 张可用优惠券\n\n' +
    '## 9.9元薯你最甜 - **优惠**: ¥9.9 (用券价格)\n' +
    '- **有效期**: 2025-12-09 00:00-2026-02-12 23:59\n' +
    '- **领取时间**: 今日收到\n' +
    '- **标签**: 到店专用、外送专用\n\n' +
    '<img src="https://img.mcd.cn/b.png" alt="9.9元薯你最甜" height="300" width="auto">';
  const r = parseMyCoupons(text);
  assert.equal(r.count, 1);
  assert.equal(r.coupons.length, 1);
  assert.equal(r.coupons[0].title, '9.9元薯你最甜');
  assert.equal(r.coupons[0].benefit, '¥9.9 (用券价格)');
  assert.ok(r.coupons[0].validDate.includes('2025-12-09'));
  assert.equal(r.coupons[0].tags, '到店专用、外送专用');
});

test('query-my-coupons：多张券 + 无优惠字段', () => {
  const text =
    '# 您的优惠券列表\n\n共 2 张可用优惠券\n\n' +
    '## 巨无霸半价券 - **优惠**: 半价\n- **有效期**: 2026-10-01 00:00-2026-10-31 23:59\n- **标签**: 到店专用\n\n' +
    '## 免费薯条券\n- **有效期**: 2026-10-01 00:00-2026-10-15 23:59';
  const r = parseMyCoupons(text);
  assert.equal(r.count, 2);
  assert.equal(r.coupons.length, 2);
  assert.equal(r.coupons[0].title, '巨无霸半价券');
  assert.equal(r.coupons[0].benefit, '半价');
  assert.equal(r.coupons[1].title, '免费薯条券');
  assert.equal(r.coupons[1].benefit, '');
});

test('query-my-coupons：空输入安全降级', () => {
  assert.deepEqual(parseMyCoupons(''), { count: 0, coupons: [] });
});

/* ---------------- 省钱估算 ---------------- */

test('estimateSavings：只统计明确的"立减/省/优惠 X 元"', () => {
  const coupons = [
    { title: '任意消费立减3元', benefit: '立减3元' },
    { title: '9.9元薯你最甜', benefit: '¥9.9 (用券价格)' }, // 用券价不计入
    { title: '巨无霸省5元券', benefit: '省5元' },
  ];
  const s = estimateSavings(coupons);
  assert.equal(s.count, 2);
  assert.equal(s.total, 8);
});

test('estimateSavings：无可量化金额时返回 null', () => {
  assert.equal(estimateSavings([]), null);
  assert.equal(estimateSavings([{ title: '9.9元薯你最甜', benefit: '¥9.9 (用券价格)' }]), null);
  assert.equal(estimateSavings(null), null);
});

/* ---------------- 活动日历 ---------------- */

test('campaign-calendar：官方格式解析', () => {
  const text =
    '### 当前时间：2026-10-10 09:30:00 ### 活动列表： #### 10月10日 今日\n' +
    '- **活动标题**：麦麦会员日：今日积分双倍到账\n' +
    ' **活动内容介绍**：🎉 每月 10 日会员日，今日下单积分双倍累计，记得先领券再下单！ #### 10月11日 即将开始\n' +
    '- **活动标题**：秋季限定上新\n **活动内容介绍**：深秋限定热饮上新';
  const acts = parseCampaignCalendar(text);
  assert.equal(acts.length, 2);
  assert.equal(acts[0].dateLabel, '10月10日');
  assert.equal(acts[0].status, '今日');
  assert.ok(acts[0].title.includes('会员日'));
  assert.equal(acts[1].status, '即将开始');
});

/* ---------------- 券价值提取（V2.0） ---------------- */

test('extractCouponValue：立减券 → 价值=立减金额', () => {
  assert.equal(extractCouponValue({ title: '任意消费立减3元', benefit: '立减3元' }), 3);
  assert.equal(extractCouponValue({ title: '大堡口福省5元', benefit: '省5元' }), 5);
  assert.equal(extractCouponValue({ title: '优惠10元券', benefit: '优惠10元' }), 10);
});

test('extractCouponValue：用券价券 → 价值=面值', () => {
  assert.equal(extractCouponValue({ title: '9.9元薯你最甜', benefit: '¥9.9 (用券价格)' }), 9.9);
  assert.equal(extractCouponValue({ title: '11.9元麦乐鸡', benefit: '¥11.9 (用券价格)' }), 11.9);
});

test('extractCouponValue：无法量化 → null（不虚报）', () => {
  assert.equal(extractCouponValue({ title: '巨无霸半价券', benefit: '半价' }), null);
  assert.equal(extractCouponValue({ title: '免费薯条券', benefit: '' }), null);
  assert.equal(extractCouponValue(null), null);
});

/* ---------------- 到期与沉默成本（V2.0） ---------------- */

test('couponExpiry：从有效期区间取最后到期日并算剩余天数', () => {
  const { expiry, leftDays } = couponExpiry(
    { validDate: '2026-10-10 00:00-2026-10-15 23:59' },
    new Date(2026, 9, 13)
  );
  assert.equal(expiry.getFullYear(), 2026);
  assert.equal(expiry.getMonth(), 9);
  assert.equal(expiry.getDate(), 15);
  assert.equal(leftDays, 2);
});

test('couponExpiry：无有效期 → null', () => {
  assert.deepEqual(couponExpiry({ title: 'x' }), { expiry: null, leftDays: null });
  assert.deepEqual(couponExpiry(null), { expiry: null, leftDays: null });
});

test('buildPortfolio：券面值合计 / 即将过期沉默成本 / 已过期损失', () => {
  const myCoupons = {
    count: 3,
    coupons: [
      { title: '9.9元薯你最甜', benefit: '¥9.9 (用券价格)', validDate: '2026-10-10 00:00-2026-10-15 23:59' }, // 2天后到期 → 沉默成本
      { title: '任意消费立减3元', benefit: '立减3元', validDate: '2026-10-01 00:00-2026-10-31 23:59' },       // 未临期
      { title: '巨无霸半价券', benefit: '半价', validDate: '2026-09-01 00:00-2026-09-30 23:59' },            // 已过期但不可量化
    ],
  };
  const now = new Date(2026, 9, 13);
  const p = buildPortfolio(myCoupons, null, now);
  assert.equal(p.coupons.count, 3);
  assert.equal(p.coupons.valuedCount, 2);
  assert.equal(p.coupons.faceTotal, 12.9);
  assert.equal(p.expiring.count, 1);
  assert.equal(p.expiring.loss, 9.9);
  assert.equal(p.expired.count, 0); // 半价券不可量化 → 不计损失
});

test('buildPortfolio：积分与到期积分提取', () => {
  const account = {
    availablePoint: '7592', accumulativePoint: '141760.94',
    frozenPoint: '30', currentMouthExpirePoint: '1200', currency: '麦当劳积分',
  };
  const p = buildPortfolio({ count: 0, coupons: [] }, account);
  assert.equal(p.point.available, 7592);
  assert.equal(p.point.expireThisMonth, 1200);
  assert.equal(p.coupons.faceTotal, 0);
});

/* ---------------- 看板聚合 ---------------- */

test('buildDashboard：聚合券、积分、活动与省钱估算', () => {
  const myCoupons = {
    count: 2,
    coupons: [
      { title: '任意消费立减3元', benefit: '立减3元' },
      { title: '9.9元薯你最甜', benefit: '¥9.9 (用券价格)' },
    ],
  };
  const account = { availablePoint: '7592', accumulativePoint: '141760.94', frozenPoint: '30', currentMouthExpirePoint: '0' };
  const activities = [{ dateLabel: '10月10日', status: '今日', title: '会员日', content: '积分双倍' }];
  const d = buildDashboard(myCoupons, account, activities);
  assert.equal(d.coupons.count, 2);
  assert.equal(d.savings.total, 3);
  assert.equal(d.account.availablePoint, '7592');
  assert.equal(d.activities.length, 1);
});

/* ---------------- MCP 客户端（Mock 模式联通） ---------------- */

test('McpClient Mock：券工具文本与 JSON 均正确解包', async () => {
  const mockData = {
    'available-coupons': '### 麦麦省优惠券列表： - 优惠券标题：9.9元薯你最甜\n 状态：未领取',
    'query-my-account': { success: true, code: 200, message: 'ok', data: { availablePoint: '100' } },
  };
  const client = new McpClient({ token: '', mockData });
  assert.equal(client.isMock, true);

  const avail = await client.callTool('available-coupons');
  assert.equal(typeof avail.data, 'string');

  const acc = await client.callTool('query-my-account');
  assert.equal(acc.data.availablePoint, '100');
});

test('McpClient：官方"字段说明包装"格式正确解包', async () => {
  const client = new McpClient({
    token: '',
    mockData: {
      'query-my-account':
        '# API Response Information\n\nSome field docs...\n\n## Original Response\n\n{"success":true,"code":200,"message":"ok","data":{"availablePoint":"100"}}',
    },
  });
  const res = await client.callTool('query-my-account');
  assert.equal(res.ok, true);
  assert.equal(res.data.availablePoint, '100');
});
