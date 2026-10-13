'use strict';

/**
 * app.js — 麦门券官 V2.0 前端逻辑
 * 券资产驾驶舱 / 券面化卡片与到期警示 / 智能用券决策弹层 / 省钱战报长图
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

/* ---------- 驾驶舱 ---------- */
async function loadPortfolio() {
  try {
    const res = await fetch('/api/portfolio', { cache: 'no-store' });
    const d = await res.json();
    if (!d.ok) throw new Error(d.error || '服务异常');
    renderPortfolio(d);
  } catch (err) {
    $('#dash-face-value').textContent = '--';
    $('#dash-point-value').textContent = '--';
  }
}

function renderPortfolio(d) {
  const fmt = formatNumber;
  $('#dash-face-value').textContent = `¥${fmt(d.coupons ? d.coupons.faceTotal : 0)}`;
  $('#dash-face-note').textContent = `可量化券 ${d.coupons ? d.coupons.valuedCount : 0} 张 · 共 ${d.coupons ? d.coupons.count : 0} 张`;

  const pt = d.point || {};
  $('#dash-point-value').textContent = fmt(pt.available);
  $('#dash-point-note').innerHTML = pt.expireThisMonth > 0
    ? `本月到期 <span class="dash-danger">${fmt(pt.expireThisMonth)}</span>`
    : '本月无到期积分';

  const ex = d.expiring || {};
  if (ex.count > 0 && ex.loss > 0) {
    $('#dash-loss-value').textContent = `¥${fmt(ex.loss)}`;
    $('#dash-loss-note').textContent = `${ex.count} 张券 ≤3 天到期，再不用就白扔`;
  } else {
    $('#dash-loss-value').textContent = '¥0';
    $('#dash-loss-note').textContent = '暂无临近到期，安心';
    $('#dash-loss').classList.add('dash-ok');
  }

  const sd = d.savings;
  $('#dash-save-value').textContent = sd && sd.total > 0 ? `¥${fmt(sd.total)}` : '¥0';
}

/* ---------- 看板 ---------- */
async function loadDashboard(showLoading = false) {
  try {
    const res = await fetch('/api/dashboard', { cache: 'no-store' });
    const d = await res.json();
    if (!d.ok) throw new Error(d.error || '服务异常');
    renderDashboard(d);
    return d;
  } catch (err) {
    $('#coupon-summary').textContent = '加载失败';
    $('#coupon-savings').textContent = err.message;
    return null;
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
      .map((c, idx) => ({ c, idx, expiry: parseExpiry(c.validDate), left: daysLeft(parseExpiry(c.validDate)) }))
      .sort((a, b) => {
        const ra = a.left == null ? 99 : a.left < 0 ? 98 : a.left;
        const rb = b.left == null ? 99 : b.left < 0 ? 98 : b.left;
        return ra - rb;
      });
    sorted.forEach(({ c, idx, left }) => {
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
          <div class="c-adv"><button class="adv-btn" data-idx="${idx}">✨ 怎么用最值</button></div>
        </div>`;
      listEl.appendChild(item);
    });
    // 事件委托：用券决策
    listEl.querySelectorAll('.adv-btn').forEach((btn) => {
      btn.addEventListener('click', () => openAdvisor(Number(btn.dataset.idx)));
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
        let rank = 0;
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

/* ---------- 智能用券决策 ---------- */
const advisorModal = $('#advisor-modal');
const advisorBody = $('#advisor-body');

async function openAdvisor(couponIndex) {
  advisorBody.innerHTML = '<div class="empty-tip">正在查询菜单与官方计价…</div>';
  advisorModal.hidden = false;
  document.body.classList.add('modal-open');
  try {
    const res = await fetch('/api/advisor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ couponIndex }),
    });
    const d = await res.json();
    if (!d.ok) throw new Error(d.error || '查询失败');
    renderAdvisor(d);
  } catch (err) {
    advisorBody.innerHTML = `<div class="empty-tip">查询失败：${escapeHtml(err.message)}</div>`;
  }
}

function renderAdvisor(d) {
  if (!d.usable) {
    advisorBody.innerHTML = `
      <div class="adv-coupon">
        <div class="adv-c-title">${escapeHtml(d.coupon.title)}</div>
        ${d.coupon.benefit ? `<div class="c-meta">${escapeHtml(d.coupon.benefit)}</div>` : ''}
      </div>
      <div class="empty-tip">${escapeHtml(d.reason)}</div>`;
    return;
  }
  const val = d.value != null ? `¥${formatNumber(d.value)}` : '--';
  let html = `
    <div class="adv-coupon">
      <div class="adv-c-head">
        <div class="adv-c-title">${escapeHtml(d.coupon.title)}</div>
        <div class="adv-c-value">这张券价值 <b class="gold-text">${val}</b> · 怎么用最值？</div>
      </div>
      ${d.coupon.validDate ? `<div class="adv-c-date">📅 ${escapeHtml(d.coupon.validDate)}</div>` : ''}
    </div>
    <div class="adv-list">`;
  (d.candidates || []).forEach((c, i) => {
    const isTop = i === 0;
    const payCls = c.payAfterCoupon <= 0 ? 'free' : '';
    const payText = c.payAfterCoupon <= 0 ? '白拿' : `¥${formatNumber(c.payAfterCoupon)}`;
    html += `
      <div class="adv-item">
        <div class="adv-rank ${isTop ? 'rank-top' : ''}">${i + 1}</div>
        <div class="adv-main">
          <div class="adv-name-row">
            <span class="adv-name">${escapeHtml(c.name)}</span>
            ${c.category ? `<span class="adv-cat">${escapeHtml(c.category)}</span>` : ''}
            ${isTop ? '<span class="rank-best">最划算</span>' : ''}
          </div>
          <div class="adv-price-row">
            <span class="adv-old">¥${formatNumber(c.price)}</span>
            <span class="adv-arrow">→</span>
            <span class="adv-pay ${payCls}">${payText}</span>
            <span class="adv-saved">省 ¥${formatNumber(c.saved)} · ${c.ratio}%</span>
          </div>
          <div class="adv-verified">官方 MCP 真实计价</div>
        </div>
      </div>`;
  });
  html += `</div>
    <div class="adv-foot">
      <b>怎么算的：</b>你手里的券 → 匹配门店菜单 → 官方 calculate-price 真实计价，自动排出 TOP 3 最划算方案（示例门店 ${escapeHtml(d.storeCode || '')}）。
    </div>`;
  advisorBody.innerHTML = html;
}

/* ---------- 省钱战报 ---------- */
const reportModal = $('#report-modal');
const reportCanvas = $('#report-canvas');

async function openReport() {
  reportModal.hidden = false;
  document.body.classList.add('modal-open');
  const wrap = document.getElementById('report-canvas-wrap');
  if (wrap) wrap.innerHTML = '<div class="empty-tip">正在生成战报…</div>';
  try {
    const [dashboard, portfolio] = await Promise.all([
      fetch('/api/dashboard', { cache: 'no-store' }).then((r) => r.json()),
      fetch('/api/portfolio', { cache: 'no-store' }).then((r) => r.json()),
    ]);
    const data = buildReportData(dashboard, portfolio);
    renderReport(data);
  } catch (err) {
    if (wrap) wrap.innerHTML = `<div class="empty-tip">生成失败：${escapeHtml(err.message)}</div>`;
  }
}

function buildReportData(dashboard, portfolio) {
  const coupons = (dashboard.coupons && dashboard.coupons.list) || [];
  const pt = portfolio.point || {};
  const now = new Date();
  const dateLabel = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`;
  return {
    faceTotal: portfolio.coupons ? portfolio.coupons.faceTotal : 0,
    valuedCount: portfolio.coupons ? portfolio.coupons.valuedCount : 0,
    saveTotal: dashboard.savings ? dashboard.savings.total : 0,
    saveCount: dashboard.savings ? dashboard.savings.count : 0,
    pointAvailable: pt.available,
    pointExpire: pt.expireThisMonth || 0,
    expiringLoss: portfolio.expiring ? portfolio.expiring.loss : 0,
    expiringCount: portfolio.expiring ? portfolio.expiring.count : 0,
    coupons: coupons.map((c) => {
      const val = extractPrice(c.title, c.benefit);
      return {
        title: c.title || '',
        benefit: c.benefit || '',
        validDate: c.validDate || '',
        value: val,
      };
    }),
    activities: (dashboard.activities || []).slice(0, 3).map((a) => ({ dateLabel: a.dateLabel, title: a.title })),
    mock: !!dashboard.mock,
    dateLabel,
  };
}

function renderReport(data) {
  const wrap = document.getElementById('report-canvas-wrap');
  if (wrap) wrap.innerHTML = '';
  reportCanvas.hidden = false;
  const { height } = McdReport.drawReport(reportCanvas, data);
  reportCanvas.style.aspectRatio = `${McdReport.W} / ${height}`;
}

$('#btn-report').addEventListener('click', openReport);

$('#report-download').addEventListener('click', () => {
  try {
    const url = reportCanvas.toDataURL('image/png');
    const a = document.createElement('a');
    const d = new Date();
    a.download = `麦门省钱战报-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.png`;
    a.href = url;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } catch (err) {
    alert('保存失败，请长按图片保存');
  }
});

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
    await loadPortfolio();
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

/* ---------- 弹层关闭 ---------- */
function closeModal(modal) {
  modal.hidden = true;
  document.body.classList.remove('modal-open');
}
$('#advisor-close').addEventListener('click', () => closeModal(advisorModal));
$('#report-close').addEventListener('click', () => closeModal(reportModal));
document.querySelectorAll('.modal-mask').forEach((mask) => {
  mask.addEventListener('click', () => {
    closeModal(advisorModal);
    closeModal(reportModal);
  });
});

/* ---------- 刷新 ---------- */
$('#btn-refresh').addEventListener('click', () => {
  loadDashboard(true);
  loadPortfolio();
});

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
  if (!Number.isFinite(n)) return String(n);
  return n.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
}

/* ---------- 启动 ---------- */
loadDashboard();
loadPortfolio();
