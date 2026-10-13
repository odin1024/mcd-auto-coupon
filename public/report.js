'use strict';

/**
 * report.js — 麦门券官 V2.0「省钱战报」分享长图生成（纯 Canvas 2D，零依赖）
 *
 * 生成一张可截图/下载分享的竖版战报卡：
 *  品牌区 → 资产大数字 → 沉默成本提醒 → 我的券包 → 积分 → 活动 → 引导区
 * 所有数值口径与后端 buildPortfolio 一致（诚实口径，不虚报）。
 */

(function (global) {
  const W = 750; // 画布宽
  const PAD = 44; // 边距

  const COLORS = {
    bg: '#12151C',
    panel: '#1B2029',
    panel2: '#232936',
    gold: '#FFC72C',
    goldDark: '#e6a800',
    red: '#DA291C',
    redDark: '#B01A10',
    text: '#F2F4F7',
    muted: '#8E96A3',
    ok: '#7FE0A3',
    warn: '#FF9D5C',
    danger: '#FF6B5E',
    line: 'rgba(255,255,255,.1)',
  };

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function fmt(n) {
    if (n == null || n === '') return '--';
    const v = Number(n);
    if (!Number.isFinite(v)) return String(n);
    return v.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
  }

  function escapeCv(s) {
    return String(s == null ? '' : s);
  }

  /**
   * 绘制省钱战报
   * @param {HTMLCanvasElement} canvas
   * @param {Object} data {
   *   faceTotal, valuedCount, saveTotal, saveCount, pointAvailable, pointExpire,
   *   expiringLoss, expiringCount, coupons: [{title, benefit, validDate, value}],
   *   activities: [{dateLabel, title}], mock, dateLabel
   * }
   */
  function drawReport(canvas, data) {
    const ctx = canvas.getContext('2d');
    const DPR = Math.min(3, global.devicePixelRatio || 2);
    const h = computeHeight(data);
    canvas.width = W * DPR;
    canvas.height = h * DPR;
    ctx.scale(DPR, DPR);
    ctx.clearRect(0, 0, W, h);

    // 背景
    const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
    bgGrad.addColorStop(0, '#1a1410');
    bgGrad.addColorStop(0.5, COLORS.bg);
    bgGrad.addColorStop(1, '#101318');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, h);
    // 顶部金色光晕
    const glow = ctx.createRadialGradient(W / 2, -80, 20, W / 2, -80, 420);
    glow.addColorStop(0, 'rgba(255,199,44,.22)');
    glow.addColorStop(1, 'rgba(255,199,44,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, 400);

    let y = 0;

    /* ---------- 品牌区 ---------- */
    y += 40;
    // 徽标
    ctx.save();
    const badgeX = PAD, badgeSize = 56;
    const bGrad = ctx.createLinearGradient(badgeX, y, badgeX + badgeSize, y + badgeSize);
    bGrad.addColorStop(0, COLORS.gold);
    bGrad.addColorStop(1, COLORS.goldDark);
    ctx.fillStyle = bGrad;
    ctx.beginPath();
    ctx.arc(badgeX + badgeSize / 2, y + badgeSize / 2, badgeSize / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = COLORS.redDark;
    ctx.font = '900 30px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('M', badgeX + badgeSize / 2, y + badgeSize / 2 + 2);
    ctx.restore();

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = COLORS.text;
    ctx.font = '800 30px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText('麦门省钱战报', badgeX + badgeSize + 18, y + 24);
    ctx.fillStyle = COLORS.muted;
    ctx.font = '400 15px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText('MCD AUTO-COUPON · 券资产智能管家', badgeX + badgeSize + 18, y + 48);

    ctx.textAlign = 'right';
    ctx.fillStyle = COLORS.gold;
    ctx.font = '600 15px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText(data.dateLabel || '', W - PAD, y + 22);
    ctx.fillStyle = COLORS.muted;
    ctx.font = '400 13px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText(data.mock ? '演示数据 · 非官方实时' : '麦当劳 MCP 真实数据', W - PAD, y + 46);
    y += 72;

    /* ---------- 资产大数字 ---------- */
    const cardY = y;
    const cardW = (W - PAD * 2 - 20) / 3;
    const cardH = 138;
    const labels = [
      { key: '券面值合计', value: `¥${fmt(data.faceTotal)}`, note: `可量化券 ${data.valuedCount} 张`, color: COLORS.gold },
      { key: '预计可省', value: `¥${fmt(data.saveTotal)}`, note: `立减券 ${data.saveCount} 张`, color: COLORS.ok },
      { key: '可用积分', value: fmt(data.pointAvailable), note: data.pointExpire > 0 ? `本月到期 ${fmt(data.pointExpire)}` : '暂无到期', color: COLORS.text },
    ];
    labels.forEach((it, i) => {
      const x = PAD + i * (cardW + 10);
      ctx.save();
      const cg = ctx.createLinearGradient(x, cardY, x, cardY + cardH);
      cg.addColorStop(0, COLORS.panel);
      cg.addColorStop(1, '#181d25');
      ctx.fillStyle = cg;
      roundRect(ctx, x, cardY, cardW, cardH, 18);
      ctx.fill();
      ctx.strokeStyle = COLORS.line;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();

      ctx.fillStyle = COLORS.muted;
      ctx.font = '400 13px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(it.key, x + cardW / 2, cardY + 30);
      ctx.fillStyle = it.color;
      ctx.font = '800 30px "PingFang SC","Microsoft YaHei",sans-serif';
      const v = it.value.length > 7 ? it.value.slice(0, 7) + '…' : it.value;
      ctx.fillText(v, x + cardW / 2, cardY + 72);
      ctx.fillStyle = COLORS.muted;
      ctx.font = '400 12px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.fillText(it.note, x + cardW / 2, cardY + 106);
      ctx.textAlign = 'left';
    });
    y += cardH + 22;

    /* ---------- 沉默成本提醒 ---------- */
    if (data.expiringCount > 0 && data.expiringLoss > 0) {
      const sy = y;
      ctx.save();
      const wg = ctx.createLinearGradient(PAD, sy, W - PAD, sy + 76);
      wg.addColorStop(0, 'rgba(255,107,94,.16)');
      wg.addColorStop(1, 'rgba(255,107,94,.05)');
      ctx.fillStyle = wg;
      roundRect(ctx, PAD, sy, W - PAD * 2, 76, 16);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,107,94,.45)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();

      ctx.fillStyle = COLORS.danger;
      ctx.font = '800 15px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`⚠ ${data.expiringCount} 张券 ${data.expiringCount <= 3 ? '即将到期' : '临近到期'} · 再不用就白扔 ¥${fmt(data.expiringLoss)}`, PAD + 18, sy + 30);
      ctx.fillStyle = COLORS.muted;
      ctx.font = '400 13px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.fillText('沉默成本提醒：快用券，别让到手的优惠悄悄溜走', PAD + 18, sy + 54);
      y += 76 + 22;
    }

    /* ---------- 我的券包 ---------- */
    y += 4;
    ctx.fillStyle = COLORS.text;
    ctx.font = '700 20px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('我的券包', PAD, y);
    ctx.fillStyle = COLORS.muted;
    ctx.font = '400 13px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`共 ${data.coupons.length} 张`, W - PAD, y);
    ctx.textAlign = 'left';
    y += 26;

    const cList = data.coupons.slice(0, 6);
    if (cList.length === 0) {
      ctx.fillStyle = COLORS.muted;
      ctx.font = '400 14px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.fillText('暂无可用优惠券（演示数据）', PAD, y + 30);
      y += 56;
    } else {
      for (const c of cList) {
        const iy = y;
        ctx.save();
        ctx.fillStyle = COLORS.panel;
        roundRect(ctx, PAD, iy, W - PAD * 2, 66, 14);
        ctx.fill();
        ctx.strokeStyle = COLORS.line;
        ctx.stroke();
        ctx.restore();

        // 金额
        ctx.fillStyle = COLORS.gold;
        ctx.font = '800 22px "PingFang SC","Microsoft YaHei",sans-serif';
        ctx.textAlign = 'left';
        const val = c.value != null ? `¥${fmt(c.value)}` : '券';
        ctx.fillText(val, PAD + 20, iy + 30);
        ctx.fillStyle = COLORS.muted;
        ctx.font = '400 11px "PingFang SC","Microsoft YaHei",sans-serif';
        ctx.fillText('价值', PAD + 20, iy + 52);

        // 券名
        ctx.fillStyle = COLORS.text;
        ctx.font = '600 16px "PingFang SC","Microsoft YaHei",sans-serif';
        const title = escapeCv(c.title).length > 18 ? escapeCv(c.title).slice(0, 18) + '…' : escapeCv(c.title);
        ctx.fillText(title, PAD + 96, iy + 28);
        ctx.fillStyle = COLORS.muted;
        ctx.font = '400 12px "PingFang SC","Microsoft YaHei",sans-serif';
        ctx.fillText(c.validDate ? `有效期 ${escapeCv(c.validDate)}` : '', PAD + 96, iy + 52);
        y += 76;
      }
    }

    /* ---------- 活动速览 ---------- */
    if (data.activities && data.activities.length > 0) {
      y += 4;
      ctx.fillStyle = COLORS.text;
      ctx.font = '700 20px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.fillText('麦门今日活动', PAD, y);
      y += 28;
      const acts = data.activities.slice(0, 3);
      for (const a of acts) {
        const iy = y;
        ctx.save();
        ctx.fillStyle = 'rgba(255,255,255,.04)';
        roundRect(ctx, PAD, iy, W - PAD * 2, 52, 12);
        ctx.fill();
        ctx.strokeStyle = COLORS.line;
        ctx.stroke();
        ctx.restore();
        ctx.fillStyle = COLORS.gold;
        ctx.font = '600 13px "PingFang SC","Microsoft YaHei",sans-serif';
        ctx.fillText(a.dateLabel || '', PAD + 16, iy + 32);
        ctx.fillStyle = COLORS.text;
        ctx.font = '500 14px "PingFang SC","Microsoft YaHei",sans-serif';
        const t = escapeCv(a.title).length > 24 ? escapeCv(a.title).slice(0, 24) + '…' : escapeCv(a.title);
        ctx.fillText(t, PAD + 120, iy + 32);
        y += 62;
      }
    }

    /* ---------- 底部引导 ---------- */
    y += 16;
    const fy = y;
    ctx.save();
    const fg = ctx.createLinearGradient(PAD, fy, W - PAD, fy + 110);
    fg.addColorStop(0, 'rgba(255,199,44,.14)');
    fg.addColorStop(1, 'rgba(255,199,44,.03)');
    ctx.fillStyle = fg;
    roundRect(ctx, PAD, fy, W - PAD * 2, 110, 18);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,199,44,.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = COLORS.gold;
    ctx.font = '800 18px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('麦门信徒 · 省钱有理 🍟', W / 2, fy + 34);
    ctx.fillStyle = COLORS.text;
    ctx.font = '500 14px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText('开源项目 · 欢迎 Star ⭐', W / 2, fy + 64);
    ctx.fillStyle = COLORS.muted;
    ctx.font = '400 12px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText('github.com/odin1024/mcd-auto-coupon', W / 2, fy + 90);

    y = fy + 110 + 36;

    return { width: W, height: y };
  }

  /** 根据内容估算画布高度（避免二次绘制闪烁） */
  function computeHeight(data) {
    let h = 40 + 72 + 138 + 22 + 30; // 品牌+资产卡
    if (data.expiringCount > 0 && data.expiringLoss > 0) h += 76 + 22;
    h += 30;
    const n = Math.min(data.coupons.length, 6);
    h += n * 76 + (n === 0 ? 56 : 0);
    if (data.activities && data.activities.length > 0) h += 30 + Math.min(data.activities.length, 3) * 62;
    h += 16 + 110 + 36;
    return h;
  }

  global.McdReport = { drawReport, W };
})(typeof window !== 'undefined' ? window : globalThis);
