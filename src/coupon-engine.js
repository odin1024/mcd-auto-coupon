'use strict';

/**
 * coupon-engine.js — 麦门券官的解析与业务引擎
 *
 * 解析麦当劳 MCP 返回的三种文本形态：
 *  - available-coupons（麦麦省券列表）：Markdown 文本
 *  - auto-bind-coupons（一键领券结果）：Markdown 文本
 *  - query-my-coupons（我的优惠券）：Markdown 文本
 *  - query-my-account（我的积分）：JSON（由 mcp-client 直接解包）
 *  - campaign-calendar（活动日历）：Markdown 文本
 *
 * 所有解析器均面向官方文档的真实返回结构编写，并对异常输入做安全降级。
 */

/** 解析麦麦省券列表文本 → [{ title, status, image }] */
function parseAvailableCoupons(text) {
  if (typeof text !== 'string') return [];
  const sections = text.split(/(?=[-*>\s]*优惠券标题\s*[:：])/).filter((s) => s.trim());
  const coupons = [];
  for (const sec of sections) {
    const lines = sec.split(/\r?\n/).map((l) => l.trim());
    const titleLine = lines.find((l) => /优惠券标题\s*[:：]/.test(l));
    if (!titleLine) continue;
    const title = titleLine.replace(/^[-*>\s]*优惠券标题\s*[:：]\s*/, '').trim();
    const statusLine = lines.find((l) => /^状态\s*[:：]/.test(l));
    const status = statusLine ? statusLine.replace(/^状态\s*[:：]\s*/, '').trim() : '';
    const imgLine = lines.find((l) => /<img[^>]*src="([^"]+)"/i.test(l));
    const image = imgLine ? (imgLine.match(/<img[^>]*src="([^"]+)"/i) || [])[1] || '' : '';
    coupons.push({ title, status, image });
  }
  return coupons;
}

/** 解析一键领券结果文本 → { total, success, failed, error, coupons: [{title, couponId, couponCode}] } */
function parseClaimResult(text) {
  if (typeof text !== 'string') {
    return { total: 0, success: 0, failed: 0, error: '', coupons: [] };
  }
  // 官方失败形态："### 领券失败\n\n错误信息：暂无可领取的优惠券"
  if (/###\s*领券失败/.test(text)) {
    const errMatch = text.match(/错误信息\s*[:：]?\s*(.+)/);
    return {
      total: 0,
      success: 0,
      failed: 0,
      error: errMatch ? errMatch[1].trim() : '领券失败',
      coupons: [],
    };
  }
  const num = (pattern) => {
    const m = text.match(pattern);
    return m ? parseInt(m[1], 10) || 0 : 0;
  };
  const total = num(/\*\*总计\*\*\s*[:：]?\s*(\d+)/);
  const success = num(/\*\*成功\*\*\s*[:：]?\s*(\d+)/);
  const failed = num(/\*\*失败\*\*\s*[:：]?\s*(\d+)/);

  const coupons = [];
  let current = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    // 成功券标题行：官方格式为 "- **9.9元薯你最甜**"
    const titleM = line.match(/^-\s*\*\*([^*]+)\*\*/);
    if (titleM) {
      current = { title: titleM[1].trim(), couponId: '', couponCode: '' };
      coupons.push(current);
      continue;
    }
    if (!current) continue;
    const idM = line.match(/^[-*>\s]*couponId\s*[:：]\s*(\S+)/);
    if (idM) { current.couponId = idM[1]; continue; }
    const cdM = line.match(/^[-*>\s]*couponCode\s*[:：]\s*(\S+)/);
    if (cdM) { current.couponCode = cdM[1]; }
  }
  return { total, success, failed, error: '', coupons };
}

/** 解析我的优惠券文本 → { count, coupons: [{title, benefit, validDate, receivedTime, tags}] } */
function parseMyCoupons(text) {
  if (typeof text !== 'string') return { count: 0, coupons: [] };
  const countMatch = text.match(/共\s*(\d+)\s*张/);
  const count = countMatch ? parseInt(countMatch[1], 10) || 0 : 0;

  const coupons = [];
  const lines = text.split(/\r?\n/);
  let current = null;
  const push = () => {
    if (current && current.title) coupons.push(current);
    current = null;
  };
  for (const rawLine of lines) {
    const line = rawLine.trim();
    const head = line.match(/^##\s+(.+)$/);
    if (head) {
      push();
      const rest = head[1];
      const benefitMatch = rest.match(/^(.*?)\s*-\s*\*\*优惠\*\*/);
      current = {
        title: (benefitMatch ? benefitMatch[1] : rest).trim(),
        benefit: '',
        validDate: '',
        receivedTime: '',
        tags: '',
      };
      const inlineBenefit = rest.match(/\*\*优惠\*\*\s*[:：]?\s*(.+)$/);
      if (inlineBenefit) current.benefit = inlineBenefit[1].trim();
      continue;
    }
    if (!current) continue;
    const field = (key, target) => {
      const m = line.match(new RegExp(`\\*\\*${key}\\*\\*\\s*[:：]?\\s*(.+)$`));
      if (m) current[target] = m[1].trim();
    };
    field('优惠', 'benefit');
    field('有效期', 'validDate');
    field('领取时间', 'receivedTime');
    field('标签', 'tags');
  }
  push();
  return { count, coupons };
}

/**
 * 从券文本中保守估算可量化金额（元）。
 * 只有出现明确的"立减/省/优惠 X 元"语义才计入；"¥X（用券价格）"这类不视为省钱金额。
 * @returns {{count:number,total:number}|null}
 */
function estimateSavings(coupons) {
  if (!Array.isArray(coupons) || coupons.length === 0) return null;
  let total = 0;
  let count = 0;
  for (const c of coupons) {
    const text = `${c.title || ''} ${c.benefit || ''}`;
    const m = text.match(/(?:立减|省|优惠)\s*(\d+(?:\.\d+)?)\s*元/);
    if (m) {
      total += parseFloat(m[1]);
      count += 1;
    }
  }
  return count > 0 ? { count, total: Math.round(total * 100) / 100 } : null;
}

/** 解析活动日历 Markdown 文本 → [{ dateLabel, status, title, content, image }] */
function parseCampaignCalendar(text) {
  if (typeof text !== 'string') return [];
  const marker = text.indexOf('### 活动列表');
  const body = marker >= 0 ? text.slice(marker) : text;
  const sections = body.split(/####\s+/).filter((s) => s.trim());
  const activities = [];
  for (const sec of sections) {
    const lines = sec.split(/\r?\n/).map((l) => l.trim());
    const head = lines[0] || '';
    const dateMatch = head.match(/(\d{1,2}月\d{1,2}日)/);
    const statusMatch = head.match(/(今日|明天|昨日|昨天|今天|进行中|即将开始|即将到来|往期回顾|即将持续|未来)/);
    const dateLabel = dateMatch ? dateMatch[1] : head.split(/[\s\-—|:：]+/)[0].trim();
    const status = statusMatch ? statusMatch[1] : '';
    let title = '';
    let content = '';
    for (const line of lines) {
      const t = line.match(/^.*?\*\*活动标题\*\*\s*[:：]\s*(.*)$/);
      if (t) { title = clean(t[1]); continue; }
      const c = line.match(/^.*?\*\*活动内容介绍\*\*\s*[:：]\s*(.*)$/);
      if (c) { content = clean(c[1]); }
    }
    if (title || content) activities.push({ dateLabel, status, title, content });
  }
  return activities;
}

function clean(s) {
  return s
    .replace(/<img[^>]*>/gi, '')
    .replace(/\\/g, '')
    .replace(/[ \t]+$/g, '')
    .trim();
}

/**
 * 聚合看板数据。
 * @param {Object} myCoupons   parseMyCoupons 结果
 * @param {Object} account     query-my-account 的 data（JSON）
 * @param {Array}  activities  活动列表
 */
function buildDashboard(myCoupons, account, activities) {
  const savings = estimateSavings(myCoupons.coupons);
  return {
    coupons: {
      count: myCoupons.count,
      list: myCoupons.coupons,
    },
    savings: savings ? { label: `已领券预计可省约 ¥${savings.total}`, count: savings.count, total: savings.total } : null,
    account: account
      ? {
          availablePoint: account.availablePoint,
          accumulativePoint: account.accumulativePoint,
          frozenPoint: account.frozenPoint,
          currentMouthExpirePoint: account.currentMouthExpirePoint,
          expiredPoint: account.expiredPoint,
          currency: account.currency || '麦当劳积分',
        }
      : null,
    activities: activities,
  };
}

module.exports = {
  parseAvailableCoupons,
  parseClaimResult,
  parseMyCoupons,
  parseCampaignCalendar,
  estimateSavings,
  buildDashboard,
  clean,
};
