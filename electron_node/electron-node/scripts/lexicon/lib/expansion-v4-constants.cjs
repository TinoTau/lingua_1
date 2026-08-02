/** V4 expansion denylist — mirrors main/src/lexicon-patch-v4/patch-types-v4.ts */
const EXPANSION_DENY_LIST = [
  '候选生成',
  '上线计划',
  '接口文档',
  '机场高速',
  '热巧克力',
  '酒店订单',
  '燕麦拿铁',
  '杭州西溪',
];

const MAX_EXPANSION_CJK_LEN = 5;

module.exports = { EXPANSION_DENY_LIST, MAX_EXPANSION_CJK_LEN };
