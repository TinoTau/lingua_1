#!/usr/bin/env node
/**
 * Generate entries.capacity-validation.jsonl (~240 addTerm + append rows).
 * Industry Expansion Pack V1 — Builder Capacity Validation batch.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pinyin } from 'pinyin-pro';
import { createRequire } from 'module';
import { repoRoot } from '../lib/paths.mjs';
import { loadTermIndex } from './lib/term-index.mjs';
import { EXPANSION_DENY_LIST } from './lib/constants.mjs';

const require = createRequire(import.meta.url);
const { EXISTING_TERM_ID_BY_WORD } = require('../expansion-v1_1/terms-manifest.cjs');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(
  repoRoot(),
  'electron_node',
  'docs',
  'lexicon-assets',
  'industry_pack_v1',
  'entries.capacity-validation.jsonl'
);

/** Curated real industry terms — fine domain only (V1.1 Addendum). */
const WORD_BANK = {
  tech_ai: [
    '智能体', '大模型', '微调', '推理', '算力', '向量', '嵌入', '编码', '解码', '标注',
    '语料', '蒸馏', '量化', '剪枝', '对齐', '提示', '上下文', '令牌', '分词', '词表',
    '召回', '重排', '评测', '基准', '消融', '过拟合', '欠拟合', '正则', '梯度', '优化器',
    '学习率', '批次', '轮次', '检查点', '权重', '偏置', '激活', '损失', '准确率', '召回率',
  ],
  tourism_transport: [
    '网约车', '顺风车', '出租车', '专车', '快车', '拼车', '里程', '路费', '高速', '匝道',
    '限行', '拥堵', '绕行', '导航', '定位', '轨迹', '站点', '枢纽', '换乘', '候车',
    '站台', '班次', '发车', '到站', '离站', '检票', '出站', '进站', '候车厅', '售票',
  ],
  tourism_pickup: [
    '接机', '送机', '接站', '送站', '举牌', '等候', '行李', '转盘', '航站楼', '到达口',
    '出发层', '停车楼', '落客区', '网约车', '专车', '拼车', '预约', '改签', '延误', '备降',
    '摆渡车', '贵宾厅', '休息室', '登机口', '安检口', '值机台',
  ],
  tourism_hotel: [
    '客房', '前台', '入住', '退房', '续住', '押金', '房卡', '早餐', '加床', '无烟',
    '海景', '城景', '套房', '标间', '大床', '双床', '钟点房', '行李', '寄存', '叫醒',
    '打扫', '备品', '拖鞋', '浴巾', '枕头', '空调', '暖气', '迷你吧', '客房服', '礼宾',
  ],
  tourism_route: [
    '行程', '景点', '门票', '导览', '讲解', '集合', '散团', '包车', '徒步', '索道',
    '缆车', '栈道', '观景台', '纪念馆', '博物馆', '古镇', '街区', '步行街', '夜市', '特产',
    '纪念品', '拍照', '打卡', '路线', '攻略', '预约', '限流', '闭园', '开放', '旺季',
  ],
  medical: [
    '挂号', '诊室', '门诊', '住院', '出院', '病历', '处方', '药房', '取药', '输液',
    '注射', '化验', '影像', '超声', '心电图', '麻醉', '手术', '复查', '复诊', '转诊',
    '医保', '自费', '陪护', '病床', '护士', '主任', '专家', '急诊', '发热', '核酸',
    '抗原', '疫苗', '康复', '理疗', '针灸', '拔罐',
  ],
  meeting: [
    '会议', '议程', '纪要', '主持', '发言', '讨论', '表决', '决议', '旁听', '签到',
    '投影', '话筒', '同声', '传译', '展位', '展台', '主题', '分会场', '主会场', '开幕式',
    '闭幕式', '晚宴', '招待', '接待', '证件', '胸牌', '资料', '手册', '展区', '路演',
  ],
  coffee: [
    '浓缩', '拿铁', '美式', '卡布', '摩卡', '澳白', '冷萃', '手冲', '意式', '单品',
    '拼配', '研磨', '萃取', '奶泡', '拉花', '焦糖', '香草', '榛果', '燕麦奶', '豆奶',
    '外带', '堂食', '杯型', '热饮', '冰饮', '去冰', '少冰', '多糖', '少糖', '无糖',
  ],
};

/** Extra industry terms when primary bank collides with runtime SSOT. */
const SUPPLEMENT_WORD_BANK = {
  tech_ai: [
    '参数', '部署', '版本', '缓存', '并发', '分布式', '副本', '故障', '容错', '灰度',
    '回滚', '集群', '节点', '容器', '镜像', '日志', '监控', '告警', '链路', '延迟',
    '吞吐', '配额', '限流', '熔断', '降级', '沙箱', '特征', '样本', '标注员', '质检',
  ],
  tourism_transport: [
    '辅路', '主路', '环岛', '掉头', '左转', '右转', '直行', '掉头口', '收费站', '服务区',
    '加油站', '充电桩', '停车场', '停车位', '违章', '罚单', '驾照', '行驶证', '年检', '保险',
  ],
  tourism_pickup: [
    '接机员', '送机员', '接站员', '送站员', '航班号', '车次', '站台号', '候车区', '贵宾通道', '快速通道',
    '行李车', '行李额', '超重费', '延误险', '改签费', '退票费', '登机牌', '安检员', '值机员', '候机楼',
  ],
  tourism_hotel: [
    '客房部', '礼宾部', '房态', '满房', '空房', '续住费', '加床费', '押金单', '发票', '水单',
    '入住单', '退房单', '房号', '楼层', '电梯', '走廊', '阳台', '窗户', '窗帘', '床垫',
  ],
  tourism_route: [
    '导览图', '游览车', '观光车', '讲解器', '耳机', '排队', '入园', '出园', '闭馆', '开馆',
    '淡旺季', '旺季票', '淡季票', '团体票', '学生票', '老人票', '儿童票', '免票', '半价', '预约票',
  ],
  medical: [
    '挂号费', '诊疗费', '床位费', '护理费', '手术费', '麻醉费', '化验单', '检查单', '影像科', '放射科',
    '内科', '外科', '儿科', '妇科', '骨科', '眼科', '耳鼻喉', '皮肤科', '口腔科', '急诊科',
  ],
  meeting: [
    '会务组', '主办方', '承办方', '赞助商', '参展商', '观众证', '工作证', '媒体证', '贵宾证', '邀请函',
    '日程表', '议题', '圆桌', '论坛', '峰会', '发布会', '签约仪式', '剪彩', '合影', '茶歇',
  ],
  coffee: [
    '咖啡豆', '咖啡粉', '咖啡机', '磨豆机', '压粉器', '蒸汽棒', '滤纸', '滤杯', '手冲壶', '温度计',
    '风味轮', '酸度', '苦度', '醇厚度', '余韵', '产区', '海拔', '日晒', '水洗', '蜜处理',
  ],
};

const APPEND_OPS = [
  { word: '机场', term_id: EXISTING_TERM_ID_BY_WORD['机场'], domain_tags: ['tech_ai'], weight: 0.75 },
  { word: '预订', term_id: EXISTING_TERM_ID_BY_WORD['预订'], domain_tags: ['tourism_hotel'], weight: 0.8 },
  { word: '预订', term_id: EXISTING_TERM_ID_BY_WORD['预订'], domain_tags: ['meeting'], weight: 0.7 },
  { word: '中杯', term_id: EXISTING_TERM_ID_BY_WORD['中杯'], domain_tags: ['meeting'], weight: 0.6 },
  { word: '大杯', term_id: EXISTING_TERM_ID_BY_WORD['大杯'], domain_tags: ['tech_ai'], weight: 0.55 },
  { word: '小杯', term_id: EXISTING_TERM_ID_BY_WORD['小杯'], domain_tags: ['medical'], weight: 0.5 },
  { word: '少冰', term_id: EXISTING_TERM_ID_BY_WORD['少冰'], domain_tags: ['tourism_transport'], weight: 0.65 },
  { word: '蓝莓马芬', term_id: EXISTING_TERM_ID_BY_WORD['蓝莓马芬'], domain_tags: ['meeting'], weight: 0.7 },
];

const SKIP_WORDS = new Set([
  ...EXPANSION_DENY_LIST,
  ...Object.keys(EXISTING_TERM_ID_BY_WORD),
]);

function pinyinSpaced(word) {
  return pinyin(word, { toneType: 'none', type: 'string' }).replace(/\s+/g, ' ').trim();
}

function tonePinyinSpaced(word) {
  return pinyin(word, { toneType: 'num', type: 'string' }).replace(/\s+/g, ' ').trim();
}

function makeAddRow(word, domain) {
  const weights = { [domain]: 1.0 };
  return {
    word,
    pinyin: pinyinSpaced(word),
    tone_pinyin: tonePinyinSpaced(word),
    domain_tags: [domain],
    domain_weights: weights,
    repair_target: true,
    enabled: true,
    prior_score: 0.86,
    lexiconLayer: 'domain_patch',
    source: 'industry_pack_v1',
    wave: 'capacity_validation',
    mutation: 'add',
  };
}

function makeAppendRow(spec) {
  const word = spec.word;
  const weights = Object.fromEntries(spec.domain_tags.map((t) => [t, spec.weight ?? 1.0]));
  return {
    word,
    pinyin: pinyinSpaced(word),
    tone_pinyin: tonePinyinSpaced(word),
    mutation: 'append',
    term_id: spec.term_id,
    domain_tags: spec.domain_tags,
    domain_weights: weights,
    repair_target: true,
    enabled: true,
    prior_score: 0.85,
    lexiconLayer: 'domain_patch',
    source: 'industry_pack_v1',
    wave: 'capacity_validation',
  };
}

function loadExistingWords() {
  const sqlite = path.join(repoRoot(), 'node_runtime', 'lexicon', 'v3', 'lexicon.sqlite');
  const idx = loadTermIndex(sqlite);
  const existing = new Set(SKIP_WORDS);
  if (idx) {
    for (const word of idx.byWord.keys()) {
      existing.add(word);
    }
  }
  return existing;
}

function collectAddRows(existingWords, seen) {
  const rows = [];
  const banks = [WORD_BANK, SUPPLEMENT_WORD_BANK];
  for (const bank of banks) {
    for (const [domain, words] of Object.entries(bank)) {
      for (const word of words) {
        if (seen.has(word) || existingWords.has(word)) {
          continue;
        }
        if (EXPANSION_DENY_LIST.includes(word)) {
          continue;
        }
        const cjk = [...word].filter((c) => /[\u4e00-\u9fff]/.test(c)).length;
        if (cjk < 2 || cjk > 5) {
          continue;
        }
        seen.add(word);
        rows.push(makeAddRow(word, domain));
      }
    }
  }
  return rows;
}

function main() {
  const existingWords = loadExistingWords();
  const seen = new Set();
  const rows = collectAddRows(existingWords, seen);

  for (const spec of APPEND_OPS) {
    rows.push(makeAppendRow(spec));
  }

  const addCount = rows.filter((r) => r.mutation === 'add').length;
  const appendCount = rows.filter((r) => r.mutation === 'append').length;

  if (addCount < 200) {
    throw new Error(
      `[generate-capacity-validation] need >=200 addTerm rows, got ${addCount} (existingWords=${existingWords.size})`
    );
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`, 'utf8');

  console.log('[generate-capacity-validation] wrote', OUT);
  console.log(
    `  addTerm rows: ${addCount}, appendDomainTags rows: ${appendCount}, total: ${rows.length}, skippedExisting: ${existingWords.size}`
  );
}

main();
