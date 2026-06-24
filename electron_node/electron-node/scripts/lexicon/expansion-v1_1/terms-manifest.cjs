/**
 * Expansion V1.1 SSOT — Addendum v1.2.1 (Option B, D-02=general for oral).
 * Patch First + JSONL dual-write; Alias Ownership Contract V1.0.0.
 */

/** @type {readonly string[]} */
const DENY_LIST = Object.freeze([
  '候选生成',
  '上线计划',
  '接口文档',
  '机场高速',
  '热巧克力',
  '酒店订单',
  '燕麦拿铁',
  '杭州西溪',
]);

/** P1 — new canonical (JSONL + Patch A term add) */
const P1_TERMS = [
  { termId: 'exp-v1_1-zhongguancun', word: '中关村', domainTags: ['tourism_transport'], priorScore: 0.88 },
  { termId: 'exp-v1_1-wangjing', word: '望京', domainTags: ['tourism_transport'], priorScore: 0.88 },
  { termId: 'exp-v1_1-pudong', word: '浦东', domainTags: ['tourism_transport'], priorScore: 0.86 },
  { termId: 'exp-v1_1-zhangjiang', word: '张江', domainTags: ['tourism_transport'], priorScore: 0.86 },
  { termId: 'exp-v1_1-xixi', word: '西溪', domainTags: ['tourism_transport'], priorScore: 0.85 },
  { termId: 'exp-v1_1-sihuan', word: '四环', domainTags: ['tourism_transport'], priorScore: 0.84 },
  { termId: 'exp-v1_1-sanhuan', word: '三环', domainTags: ['tourism_transport'], priorScore: 0.84 },
  {
    termId: 'exp-v1_1-liantiao',
    word: '联调',
    domainTags: ['tech_ai'],
    priorScore: 0.9,
    aliasEntries: [{ alias: '連調', alias_type: 'TRAD_SIMPLIFIED' }],
  },
  {
    termId: 'exp-v1_1-qiaokeli',
    word: '巧克力',
    domainTags: ['coffee'],
    priorScore: 0.88,
  },
  { termId: 'exp-v1_1-wenyixia', word: '问一下', domainTags: ['general'], priorScore: 0.82 },
  { termId: 'exp-v1_1-keyima', word: '可以吗', domainTags: ['general'], priorScore: 0.82 },
  { termId: 'exp-v1_1-ganshijian', word: '赶时间', domainTags: ['general'], priorScore: 0.82 },
  { termId: 'exp-v1_1-guahaochu', word: '挂号处', domainTags: ['general'], priorScore: 0.85 },
  { termId: 'exp-v1_1-sishima', word: '四十码', domainTags: ['general'], priorScore: 0.8 },
];

/** Words already in term SSOT — Patch B uses update+alias merge, not term add (Option B). */
const EXISTING_TERM_ID_BY_WORD = {
  机场: 'term-e69cbae59cba7c6a',
  中杯: 'term-e4b8ade69daf7c7a',
  少冰: 'term-e5b091e586b07c73',
  大杯: 'term-e5a4a7e69daf7c64',
  小杯: 'term-e5b08fe69daf7c78',
  蓝莓马芬: 'term-e8939de88e93e9a9',
  预订: 'term-e9a284e8aea27c79',
};

/** P1.5 — legal alias only (Alias Ownership Contract V1.0.0) */
const P1_5_ALIAS_TERMS = [
  {
    termId: 'exp-v1_1-alias-houxuan',
    word: '候选',
    domainTags: ['tech_ai'],
    priorScore: 0.92,
    aliasEntries: [{ alias: '候選', alias_type: 'TRAD_SIMPLIFIED' }],
  },
  {
    termId: 'exp-v1_1-alias-shengcheng',
    word: '生成',
    domainTags: ['tech_ai'],
    priorScore: 0.92,
  },
  {
    termId: 'exp-v1_1-alias-shangxian',
    word: '上线',
    domainTags: ['tech_ai'],
    priorScore: 0.92,
    aliasEntries: [{ alias: '上線', alias_type: 'TRAD_SIMPLIFIED' }],
  },
  {
    termId: 'exp-v1_1-alias-jihua',
    word: '计划',
    domainTags: ['tech_ai'],
    priorScore: 0.92,
    aliasEntries: [
      { alias: '計畫', alias_type: 'TRAD_SIMPLIFIED' },
      { alias: '計劃', alias_type: 'TRAD_SIMPLIFIED' },
    ],
  },
  {
    termId: 'exp-v1_1-alias-jiekou',
    word: '接口',
    domainTags: ['tech_ai'],
    priorScore: 0.92,
  },
  {
    termId: 'exp-v1_1-alias-wendang',
    word: '文档',
    domainTags: ['tech_ai'],
    priorScore: 0.92,
  },
  {
    termId: 'exp-v1_1-alias-jichang',
    word: '机场',
    domainTags: ['tourism_transport'],
    priorScore: 0.9,
    aliasEntries: [{ alias: '機場', alias_type: 'TRAD_SIMPLIFIED' }],
  },
  {
    termId: 'exp-v1_1-alias-gaosu',
    word: '高速',
    domainTags: ['tourism_transport'],
    priorScore: 0.9,
  },
  {
    termId: 'exp-v1_1-alias-shunbian',
    word: '顺便',
    domainTags: ['general'],
    priorScore: 0.85,
  },
  {
    termId: 'exp-v1_1-alias-zhongbei',
    word: '中杯',
    domainTags: ['coffee', 'milk_tea', 'food_order'],
    priorScore: 0.9,
  },
  {
    termId: 'exp-v1_1-alias-shaobing',
    word: '少冰',
    domainTags: ['coffee', 'milk_tea', 'food_order'],
    priorScore: 0.88,
  },
  {
    termId: 'exp-v1_1-alias-dabei',
    word: '大杯',
    domainTags: ['coffee', 'milk_tea', 'food_order'],
    priorScore: 0.88,
  },
  {
    termId: 'exp-v1_1-alias-xiaobei',
    word: '小杯',
    domainTags: ['coffee', 'milk_tea', 'food_order'],
    priorScore: 0.88,
  },
  {
    termId: 'exp-v1_1-alias-lanmeimafen',
    word: '蓝莓马芬',
    domainTags: ['bakery'],
    priorScore: 0.9,
  },
  {
    termId: 'exp-v1_1-alias-xiangcai',
    word: '香菜',
    domainTags: ['general'],
    priorScore: 0.85,
  },
  {
    termId: 'exp-v1_1-alias-yuding',
    word: '预订',
    domainTags: ['tourism_hotel', 'tourism_route', 'food_order'],
    priorScore: 0.88,
    aliasEntries: [{ alias: '预定', alias_type: 'ENTITY_WRITING' }],
  },
];

/** Homophone variant standalone words removed from JSONL — cleanup runtime via apply script */
const HOMOPHONE_VARIANT_WORDS = Object.freeze([
  '钟贝',
  '忠贝',
  '终杯',
  '达杯',
  '大悲',
  '小悲',
  '小碑',
  '那铁',
  '拿帖',
  '磨卡',
  '美是',
  '没事',
  '兰梅',
  '兰梅马芬',
  '蓝莓麻烦',
  '麻烦',
]);

module.exports = {
  DENY_LIST,
  P1_TERMS,
  P1_5_ALIAS_TERMS,
  EXISTING_TERM_ID_BY_WORD,
  HOMOPHONE_VARIANT_WORDS,
};
