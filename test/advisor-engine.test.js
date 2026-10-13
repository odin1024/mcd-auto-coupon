'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseMeals,
  extractJson,
  parsePrice,
  buildAdvisor,
  parsePriceResult,
} = require('../src/advisor-engine');

/* ---------------- 菜单解析 ---------------- */

const REAL_MEALS_TEXT =
  '# API Response Information\n\n' +
  '## Response Structure\n\n' +
  '- **data.categories**: 菜单分类列表\n' +
  '- **data.meals.mapKey.name**: 餐品名称\n\n' +
  '## Original Response\n\n' +
  '{"success":true,"code":200,"message":"ok","datetime":"2026-10-13 10:00:00","data":' +
  '{"categories":[{"name":"汉堡","meals":[{"code":"1100","tags":[]}]},{"name":"小食","meals":[{"code":"1500","tags":[]}]}],' +
  '"meals":{"1100":{"name":"巨无霸","image":"https://img.mcd.cn/1100.png","currentPrice":"26.5","originalPrice":"26.5"},' +
  '"1500":{"name":"中薯条","image":"","currentPrice":"12.5","originalPrice":"12.5"}}}}';

test('parseMeals：官方"说明+Original Response"格式解析', () => {
  const meals = parseMeals(REAL_MEALS_TEXT);
  assert.equal(meals.length, 2);
  assert.equal(meals[0].code, '1100');
  assert.equal(meals[0].name, '巨无霸');
  assert.equal(meals[0].currentPrice, 26.5);
  assert.equal(meals[0].category, '汉堡');
  assert.equal(meals[1].category, '小食');
});

test('parseMeals：兼容已解包对象（Mock 模式）', () => {
  const obj = {
    success: true,
    data: {
      categories: [{ name: '汉堡', meals: [{ code: '1100' }] }],
      meals: { 1100: { name: '巨无霸', currentPrice: '26.5' } },
    },
  };
  const meals = parseMeals(obj);
  assert.equal(meals.length, 1);
  assert.equal(meals[0].name, '巨无霸');
});

test('parseMeals：无价格餐品剔除 / 空输入降级', () => {
  const obj = {
    data: {
      categories: [{ name: 'x', meals: [{ code: '1' }, { code: '2' }] }],
      meals: { 1: { name: '有价', currentPrice: '10' }, 2: { name: '无价', currentPrice: null } },
    },
  };
  const meals = parseMeals(obj);
  assert.equal(meals.length, 1);
  assert.equal(meals[0].name, '有价');
  assert.deepEqual(parseMeals(''), []);
  assert.deepEqual(parseMeals(null), []);
});

/* ---------------- 用券决策 ---------------- */

test('buildAdvisor：立减券 → 券后价排序，最划算置顶', () => {
  const meals = [
    { code: 'a', name: '巨无霸', category: '汉堡', currentPrice: 26.5 },
    { code: 'b', name: '中薯条', category: '小食', currentPrice: 12.5 },
    { code: 'c', name: '可乐', category: '饮料', currentPrice: 11.5 },
  ];
  const r = buildAdvisor(3, meals);
  assert.equal(r.usable, true);
  assert.equal(r.candidates.length, 3);
  // 立减3元：可乐券后 8.5 最划算 → 置顶
  assert.equal(r.candidates[0].code, 'c');
  assert.equal(r.candidates[0].payAfterCoupon, 8.5);
  assert.equal(r.candidates[0].saved, 3);
});

test('buildAdvisor：用券价券 → 折扣率最高者（接近白拿）置顶', () => {
  const meals = [
    { code: 'a', name: '巨无霸', category: '汉堡', currentPrice: 26.5 },
    { code: 'b', name: '中薯条', category: '小食', currentPrice: 12.5 },
    { code: 'c', name: '可乐', category: '饮料', currentPrice: 11.5 },
  ];
  const r = buildAdvisor(9.9, meals);
  assert.equal(r.candidates[0].code, 'c'); // 券后 1.6，省 9.9
  assert.equal(r.candidates[0].payAfterCoupon, 1.6);
  assert.equal(r.candidates[2].code, 'a'); // 券后 16.6
});

test('buildAdvisor：无法量化券 / 空菜单 → usable=false', () => {
  const meals = [{ code: 'a', name: 'x', category: 'y', currentPrice: 10 }];
  assert.equal(buildAdvisor(null, meals).usable, false);
  assert.equal(buildAdvisor(3, []).usable, false);
  assert.equal(buildAdvisor(0, meals).usable, false);
});

test('buildAdvisor：券价值超过餐品价 → 券后 0（白拿）', () => {
  const meals = [{ code: 'a', name: '小食', category: '小食', currentPrice: 5 }];
  const r = buildAdvisor(6, meals);
  assert.equal(r.candidates[0].payAfterCoupon, 0);
  assert.equal(r.candidates[0].saved, 5);
});

/* ---------------- 计价结果解析 ---------------- */

test('parsePriceResult：官方计价"分"转元', () => {
  const text =
    '## Original Response\n\n' +
    '{"success":true,"data":{"originalPrice":2650,"discount":0,"price":2650,"productPrice":2650}}';
  const r = parsePriceResult(text);
  assert.equal(r.price, 26.5);
  assert.equal(r.originalPrice, 26.5);
  assert.equal(r.discount, 0);
});

test('parsePriceResult：缺 price → null', () => {
  assert.equal(parsePriceResult('## Original Response\n\n{"data":{}}'), null);
  assert.equal(parsePriceResult(''), null);
});

/* ---------------- 工具函数 ---------------- */

test('extractJson：兼容对象 / 文本 / 空', () => {
  assert.deepEqual(extractJson({ a: 1 }), { a: 1 });
  assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
  assert.equal(extractJson(''), null);
  assert.equal(extractJson(null), null);
});

test('parsePrice：字符串/数字/非法', () => {
  assert.equal(parsePrice('26.5'), 26.5);
  assert.equal(parsePrice('¥13'), 13);
  assert.equal(parsePrice(9.9), 9.9);
  assert.equal(parsePrice('abc'), null);
  assert.equal(parsePrice(null), null);
});
