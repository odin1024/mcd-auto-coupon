'use strict';

/**
 * app.js — 麦门券官前端逻辑（升级版）
 * 券面化渲染 / 到期排序与警示 / 积分高亮 / 活动分组 / 省钱横幅
 */

const $ = (sel) => document.querySelector(sel);
const btnClaim = $('#btn-claim');
const claimResult = $('#claim-result');
const claimResultTitle = $('#claim-result-title');
const claimResultList = $('#claim-result-list');

/* ---------- 模式徽标 ---------- */
fetch('/api/health')
  .then((r) => r.json())
  .then((d) => {
    if (d && d.mock) {
      const badge = $('#mode-badge');
      badge.textContent = '演示模式（模拟数据）';
      badge.hidden = false;
    }
  })
  .catch(() => {});

/* ---------- 日期工具 ---------- */
function today() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** 从"2026-10-10 00:00-2026-10-16 23:59"提取最后到期日（Date） */
function parseExpiry(validDate) {
  if (!validDate) return null;
  const m = validDate.match(/(\d{4})-(\d{1,2})-(\d{1,2})/g);
  if (!m) return null;
  const last = m[m.length - 1].match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  const d = new Date(Number(last[1]), Number(last[2]) - 1, Number(last[3]));
  return isNaN(d.getTime()) ? null : d;
}

function daysLeft(expiry) {
  if (!expiry) return null;
  return Math.round((expiry - today()) / 86400000);
}

/** 从 title/benefit 提取券面金额 */
function extractPrice(title, benefit) {
  const text = `${benefit || ''} ${title || ''}`;
  const m = text.match(/¥\s*([\d.]+)/);
  if (m) return Number(m[1]);
  const n = text.match(/(\d+(?:\.\d+)?)\s*元/);
  if (n) return Number(n[1]);
  return null;
}

/** 解析"10月7日" → {month, day} */
function parseMonthDay(label) {
  const m = (label || '').match(/(\d{1,2})月(\d{1,2})日/);
  if (!m) return null;
  return { month: Number(m[1]), day: Number(m[2]) };
}

/* ---------- 看板 ---------- */
async function loadDashboard(showLoading = false) {
  try {
    const res = await fetch('/api/dashboard', { cache: 'no-store' });
    const d = await res.json();
    if (!d.ok) throw new Error(d.error || '服务异常');
    renderDashboard(d);
  } catch (err) {
    $('#coupon-summary').textContent = '加载失败';
    $('#coupon-savings').textContent = err.message;
  }
}

function renderDashboard(d) {
  const coupons = d.coupons || { count: 0, list: [] };
  const account = d.account || null;
  const activities = d.activities || [];

  // 省钱横幅
  const banner = $('#savings-banner');
  if (d.savings && d.savings.count > 0) {
    banner.hidden = false;
    banner.textContent = `券包已就绪：${d.savings.count} 张券预计可省约 ¥${formatNumber(d.savings.total)}`;
  } else {
    banner.hidden = true;
  }

  // 我的优惠券
  $('#coupon-summary').textContent = coupons.count + ' 张';
  const savingsEl = $('#coupon-savings');
  savingsEl.textContent = d.savings ? d.savings.label : '';
  const listEl = $('#coupon-list');
  listEl.innerHTML = '';
  if (coupons.list.length === 0) {
    listEl.innerHTML = '<div class="empty-tip">还没有可用优惠券，点上方按钮一键领取</div>';
  } else {
    const sorted = coupons.list
      .map((c) => ({ c, expiry: parseExpiry(c.validDate), left: daysLeft(parseExpiry(c.validDate)) }))
      .sort((a, b) => {
        // 过期置底，临近到期置顶，其余按到期日升序
        const ra = a.left == null ? 99 : a.left < 0 ? 98 : a.left;
        const rb = b.left == null ? 99 : b.left < 0 ? 98 : b.left;
        return ra - rb;
      });
    sorted.forEach(({ c, left }) => {
      const stateCls = left == null ? '' : left < 0 ? 'state-expired' : left <= 3 ? 'state-expiring' : '';
      const flag = left == null ? '' : left < 0 ? '已过期' : left === 0 ? '今天到期' : left <= 3 ? `${left} 天后到期` : '';
      const price = extractPrice(c.title, c.benefit);
      const item = document.createElement('div');
      item.className = 'coupon-item ' + stateCls;
      item.innerHTML = `
        <div class="c-amount">
          <div class="c-price">${price != null ? `<small>¥</small>${price}` : '券'}</div>
          <div class="c-unit">${price != null ? '用券价' : '优惠券'}</div>
        </div>
        <div class="c-main">
          <div class="c-title">${escapeHtml(c.title)}</div>
          ${c.benefit ? `<div class="c-meta">${escapeHtml(c.benefit)}</div>` : ''}
          ${flag ? `<div class="expire-flag">${flag}</div>` : ''}
          ${c.validDate ? `<div class="c-meta">有效期：${escapeHtml(c.validDate)}</div>` : ''}
          ${c.tags ? `<div class="c-tags">${c.tags.split(/[、,，]/).filter(Boolean).slice(0, 3).map((t) => `<span class="c-tag">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
        </div>`;
      listEl.appendChild(item);
    });
  }

  // 我的积分
  if (account) {
    $('#point-available').textContent = formatNumber(account.availablePoint);
    const expire = Number(account.currentMouthExpirePoint) || 0;
    const expireHtml = expire > 0
      ? `<span class="danger-text">${formatNumber(expire)}</span>`
      : `<b>${formatNumber(expire)}</b>`;
    $('#point-detail').innerHTML = `
      累计积分：<b>${formatNumber(account.accumulativePoint)}</b><br />
      冻结积分：<b>${formatNumber(account.frozenPoint)}</b><br />
      本月到期：${expireHtml}${expire > 0 ? ' <span class="warn-text">即将清零</span>' : ''}${account.currency ? ` · ${escapeHtml(account.currency)}` : ''}`;
  } else {
    $('#point-available').textContent = '--';
    $('#point-detail').textContent = '积分信息暂不可用';
  }

  // 今日活动（今日 → 未来 → 往期）
  const actEl = $('#activity-list');
  actEl.innerHTML = '';
  if (activities.length === 0) {
    actEl.innerHTML = '<div class="empty-tip">暂无活动信息</div>';
  } else {
    const now = today();
    const ranked = activities
      .map((a) => {
        let rank = 0; // 0=今日 1=未来 2=往期
        const st = a.status || '';
        if (st.includes('今日') || st.includes('今天')) rank = 0;
        else {
          const md = parseMonthDay(a.dateLabel);
          if (md) {
            const cur = new Date(now.getFullYear(), md.month - 1, md.day);
            if (cur.getTime() === now.getTime()) rank = 0;
            else if (cur.getTime() > now.getTime()) rank = 1;
            else rank = 2;
          } else if (st.includes('往期') || st.includes('昨日')) {
            rank = 2;
          } else if (st.includes('明天')) {
            rank = 1;
          }
        }
        return { a, rank };
      })
      .sort((x, y) => x.rank - y.rank);

    ranked.forEach(({ a, rank }) => {
      const cls = rank === 0 ? 'today' : rank === 2 ? 'past' : '';
      const statusText = a.status || (rank === 0 ? '今日' : rank === 1 ? '即将' : '往期');
      const item = document.createElement('div');
      item.className = `activity-item ${cls}`;
      item.innerHTML = `
        <div class="a-date">${escapeHtml(a.dateLabel || '')}</div>
        <div class="a-body">
          <div class="a-title">${escapeHtml(a.title || '')}</div>
          ${a.content ? `<div class="a-content">${escapeHtml(a.content)}</div>` : ''}
          <span class="a-status">${escapeHtml(statusText)}</span>
        </div>`;
      actEl.appendChild(item);
    });
  }
}

/* ---------- 一键领券 ---------- */
btnClaim.addEventListener('click', async () => {
  btnClaim.disabled = true;
  btnClaim.querySelector('.claim-text').textContent = '正在领券中…';
  try {
    const res = await fetch('/api/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    const d = await res.json();
    if (!d.ok) throw new Error(d.error || '领券失败');
    renderClaim(d);
    await loadDashboard();
  } catch (err) {
    claimResult.hidden = false;
    claimResultTitle.textContent = '领券失败';
    claimResultList.innerHTML = `<div class="empty-tip">${escapeHtml(err.message)}</div>`;
  } finally {
    btnClaim.disabled = false;
    btnClaim.querySelector('.claim-text').textContent = '一键领取全部优惠券';
  }
});

function renderClaim(d) {
  claimResult.hidden = false;
  const c = d.claim || { total: 0, success: 0, failed: 0, error: '', coupons: [] };
  if (c.error && d.newClaimed === 0) {
    claimResultTitle.textContent = '本次没有新券可领';
    claimResultList.innerHTML = `<div class="empty-tip">${escapeHtml(c.error)}（当前已有 ${d.coupons ? d.coupons.count : 0} 张可用券）</div>`;
    return;
  }
  if (d.newClaimed > 0) {
    claimResultTitle.textContent = `领券成功：本次新增 ${d.newClaimed} 张优惠券`;
  } else if (c.success > 0) {
    claimResultTitle.textContent = `领券结果：成功 ${c.success} 张`;
  } else {
    claimResultTitle.textContent = '已是最新状态，没有可领取的新券';
  }
  claimResultList.innerHTML = '';
  const items = c.coupons.length > 0 ? c.coupons : (d.coupons && d.coupons.list ? d.coupons.list.slice(-d.newClaimed) : []);
  if (items.length === 0) {
    claimResultList.innerHTML = '<div class="empty-tip">券包已是最新（无新增）</div>';
  } else {
    items.forEach((cp) => {
      const item = document.createElement('div');
      item.className = 'claim-item';
      item.innerHTML = `
        <span class="ok">✓</span>${escapeHtml(cp.title)}
        ${cp.couponCode ? `<div class="code">couponCode: ${escapeHtml(cp.couponCode)}</div>` : ''}`;
      claimResultList.appendChild(item);
    });
  }
  claimResult.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* ---------- 刷新 ---------- */
$('#btn-refresh').addEventListener('click', () => loadDashboard(true));

/* ---------- 工具 ---------- */
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatNumber(v) {
  if (v == null || v === '') return '--';
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return n.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
}

/* ---------- 启动 ---------- */
loadDashboard();
