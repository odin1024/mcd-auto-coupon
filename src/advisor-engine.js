'use strict';

/**
 * advisor-engine.js — 麦门券官 V2.0「智能用券决策」引擎
 *
 * 差异化定位：市面上都是"想吃 X → 找券"（餐→券正向）；券官做的是
 * "你手里的券 → 怎么用最值"（券→餐反向）：
 *   1. 解析 query-meals 菜单（官方真实价格）
 *   2. 对一张券，枚举菜单餐品的"券后实付"（立减券：现价-立减；用券价券：直接用面值）
 *   3. 排序找出"最划算 TOP N"，并对 TOP N 调 calculate-price 官方真实计价验证
 *   4. 给出结论：用这张券最值的方式 / 是否值得凑单
 *
 * 所有金额口径诚实：无法量化的券（无面值/无立减语义）不参与决策。
 */

/** 解析 query-meals 返回 → [{ code, name, category, currentPrice, originalPrice, image }]
 * 兼容两种入参：官方返回的"说明+JSON"文本（真实模式），或已解包的对象（Mock 模式）。
 */
function parseMeals(text) {
  const data = extractJson(text);
  if (!data || typeof data !== 'object') return [];
  const payload = data.data && typeof data.data === 'object' ? data.data : data;
  const mealsMap = (payload.meals && typeof payload.meals === 'object') ? payload.meals : {};
  const categories = Array.isArray(payload.categories) ? payload.categories : [];

  // code -> 分类名（第一个出现的分类为准）
  const codeCategory = {};
  for (const cat of categories) {
    const catName = cat && cat.name ? String(cat.name) : '';
    const list = Array.isArray(cat.meals) ? cat.meals : [];
    for (const m of list) {
      const code = m && m.code != null ? String(m.code) : '';
      if (code && !(code in codeCategory)) codeCategory[code] = catName;
    }
  }

  const meals = [];
  for (const code of Object.keys(mealsMap)) {
    const m = mealsMap[code] || {};
    if (!m || typeof m !== 'object') continue;
    const price = parsePrice(m.currentPrice);
    if (price == null) continue; // 无价格的餐品不参与决策
    meals.push({
      code: String(code),
      name: m.name ? String(m.name) : String(code),
      category: codeCategory[code] || '',
      currentPrice: price,
      originalPrice: parsePrice(m.originalPrice) != null ? parsePrice(m.originalPrice) : price,
      image: m.image ? String(m.image) : '',
    });
  }
  return meals;
}

/** 提取官方"## Original Response"标记后的 JSON；兼容对象入参；失败返回 null */
function extractJson(text) {
  if (text && typeof text === 'object') return text;
  if (typeof text !== 'string' || !text.trim()) return null;
  let candidate = text;
  const marker = candidate.indexOf('## Original Response');
  if (marker >= 0) {
    candidate = candidate.slice(marker + '## Original Response'.length).trim();
    candidate = candidate.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  }
  try {
    const parsed = JSON.parse(candidate);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/** 解析价格字符串（"26.5"/"¥26.5"）→ 数字；失败 null */
function parsePrice(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
  const cleaned = String(v).replace(/[^0-9.]/g, '');
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/**
 * 对一张券构建用券决策候选（券→餐反向匹配）。
 * @param {number|null} couponValue  券价值（元）；null 表示无法量化
 * @param {Array} meals  parseMeals 结果
 * @param {Object} opts  {topN=3, excludeCategories=[]}
 * @returns {{usable:boolean, reason:string, candidates:Array}}
 */
function buildAdvisor(couponValue, meals, opts = {}) {
  const topN = opts.topN || 3;
  const exclude = opts.excludeCategories || [];
  if (couponValue == null || couponValue <= 0) {
    return {
      usable: false,
      reason: '这张券无法量化面值（非立减/无明确用券价），暂不参与决策',
      candidates: [],
    };
  }
  if (!Array.isArray(meals) || meals.length === 0) {
    return { usable: false, reason: '暂无可用菜单数据，无法给出用券建议', candidates: [] };
  }

  const scored = [];
  for (const meal of meals) {
    if (exclude.includes(meal.category)) continue;
    const pay = Math.max(0, meal.currentPrice - couponValue); // 券后实付
    const saved = Math.min(meal.currentPrice, couponValue);   // 这张券帮你省的
    const ratio = meal.currentPrice > 0 ? saved / meal.currentPrice : 0; // 折扣率
    scored.push({ meal, pay, saved, ratio });
  }

  scored.sort((a, b) => {
    // 越接近"券价值刚好够用"越值：pay 越小越值，pay 相同则省得多者优先，再按原价低
    if (a.pay !== b.pay) return a.pay - b.pay;
    if (b.saved !== a.saved) return b.saved - a.saved;
    return a.meal.currentPrice - b.meal.currentPrice;
  });

  const candidates = scored.slice(0, topN).map((s) => ({
    code: s.meal.code,
    name: s.meal.name,
    category: s.meal.category,
    price: s.meal.currentPrice,
    payAfterCoupon: Math.round(s.pay * 100) / 100,
    saved: Math.round(s.saved * 100) / 100,
    ratio: Math.round(s.ratio * 100),
    image: s.meal.image,
  }));

  return { usable: true, reason: '', candidates };
}

/**
 * 把官方 calculate-price 返回文本解析为 {price(元), originalPrice(元), discount(元)}
 * 金额单位为分，统一转元。
 */
function parsePriceResult(text) {
  const data = extractJson(text);
  if (!data) return null;
  const d = data.data && typeof data.data === 'object' ? data.data : data;
  if (d.price == null) return null;
  return {
    price: Math.round(Number(d.price) / 100 * 100) / 100,
    originalPrice: d.originalPrice != null ? Math.round(Number(d.originalPrice) / 100 * 100) / 100 : null,
    discount: d.discount != null ? Math.round(Number(d.discount) / 100 * 100) / 100 : null,
  };
}

module.exports = {
  parseMeals,
  extractJson,
  parsePrice,
  buildAdvisor,
  parsePriceResult,
};
