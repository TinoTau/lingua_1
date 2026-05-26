#!/usr/bin/env node
/**
 * Generate Phase 5 evaluation package benchmark JSONL assets from pilot lexicon + dialog manifest.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { phase5PackageDir, phase5BenchmarkDir, dialog200ManifestPath } from './lib/phase5-paths.mjs';
import { electronNodeRoot, repoRoot } from './lib/paths.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pilotPath = path.join(electronNodeRoot(), 'data/lexicon/pilot/lexicon_1k_pilot_v1.jsonl');
const outBenchmark = phase5BenchmarkDir();
const outPkg = phase5PackageDir();

function loadPilot() {
  const lines = fs.readFileSync(pilotPath, 'utf-8').split(/\r?\n/).filter(Boolean);
  return lines.map((l) => JSON.parse(l));
}

function writeJsonl(filePath, rows) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf-8');
}

const pilot = loadPilot();
const byDomain = { travel: [], transport: [], restaurant: [], tech_ai: [] };
for (const row of pilot) {
  const d = row.domains?.[0] ?? 'general';
  if (byDomain[d]) byDomain[d].push(row);
}

const mixedWords = [
  'GPU',
  'CUDA',
  'KenLM',
  'Whisper',
  'Qwen',
  'Uber',
  'WiFi',
  'Bluetooth',
  'HDMI',
  'Type-C',
  'check in',
  'boarding gate',
  'AirDrop',
];

const aliasCases = [];
let alIdx = 1;
for (const row of pilot) {
  const word = row.word?.trim();
  if (!word) continue;
  for (const alias of row.aliases || []) {
    const a = alias?.trim();
    if (!a || a === word) continue;
    aliasCases.push({
      caseId: `al-${String(alIdx++).padStart(3, '0')}`,
      alias: a,
      expectedCanonical: word,
      matchType: /[\u4e00-\u9fff]/.test(a) ? 'alias_pinyin' : 'alias_exact',
      domain: row.domains?.[0] ?? 'general',
      mustHit: true,
    });
    if (aliasCases.length >= 48) break;
  }
  if (aliasCases.length >= 48) break;
}
for (const w of mixedWords) {
  const row = pilot.find((r) => r.word === w);
  if (!row) continue;
  for (const alias of row.aliases || []) {
    const a = alias?.trim();
    if (!a) continue;
    aliasCases.push({
      caseId: `al-${String(alIdx++).padStart(3, '0')}`,
      alias: a,
      expectedCanonical: w,
      matchType: 'alias_exact',
      domain: 'tech_ai',
      mustHit: true,
    });
  }
}
aliasCases.push({
  caseId: `al-${String(alIdx++).padStart(3, '0')}`,
  alias: 'takeaway',
  expectedCanonical: '外卖',
  matchType: 'alias_exact',
  domain: 'restaurant',
  mustHit: true,
});
aliasCases.push({
  caseId: `al-${String(alIdx++).padStart(3, '0')}`,
  alias: 'takeaway',
  expectedCanonical: '打包',
  matchType: 'alias_collision_probe',
  domain: 'restaurant',
  mustHit: false,
  note: 'collision probe — validate should reject in seed',
});

const mixedCases = [];
let mlIdx = 1;
for (const w of mixedWords) {
  const row = pilot.find((r) => r.word === w);
  mixedCases.push({
    caseId: `ml-${String(mlIdx++).padStart(3, '0')}`,
    word: w,
    domain: row?.domains?.[0] ?? 'tech_ai',
    expectExactHit: true,
    sampleSegment: `测试 ${w} 运行正常`,
  });
}
while (mixedCases.length < 30) {
  const row = pilot.filter((r) => (r.domains?.[0] ?? '') === 'tech_ai')[mixedCases.length % 100];
  if (!row) break;
  mixedCases.push({
    caseId: `ml-${String(mlIdx++).padStart(3, '0')}`,
    word: row.word,
    domain: 'tech_ai',
    expectExactHit: false,
    sampleSegment: `关于${row.word}的讨论`,
  });
}

const recallCases = [];
let crIdx = 1;
const recallSeeds = [
  { text: '我们要去机场接送', word: '机场接送', domain: 'travel' },
  { text: '订一张高铁票', word: '高铁票', domain: 'transport' },
  { text: '这个 GPU 占用很高', word: 'GPU', domain: 'tech_ai' },
  { text: '蓝牙连接失败', word: '蓝牙', domain: 'tech_ai' },
];
for (const s of recallSeeds) {
  recallCases.push({
    caseId: `cr-${String(crIdx++).padStart(3, '0')}`,
    segmentText: s.text,
    expectedCanonical: s.word,
    matchType: 'topk_or_pinyin',
    domain: s.domain,
  });
}
for (const domain of Object.keys(byDomain)) {
  for (const row of byDomain[domain].slice(0, 8)) {
    if (recallCases.length >= 32) break;
    recallCases.push({
      caseId: `cr-${String(crIdx++).padStart(3, '0')}`,
      segmentText: `请帮我处理${row.word}相关事宜`,
      expectedCanonical: row.word,
      matchType: 'topk',
      domain,
    });
  }
}

const manifest = JSON.parse(fs.readFileSync(dialog200ManifestPath(), 'utf-8'));
const goldenLabels = [];
const typoMap = [
  ['机场接送', '机场借送'],
  ['高铁', '高铁'],
  ['GPU', 'GPU'],
];
let gIdx = 0;
for (const c of manifest.slice(0, 35)) {
  const utterance = c.utterance || '';
  let expected = utterance;
  let raw = utterance;
  if (gIdx < typoMap.length) {
    const [correct, wrong] = typoMap[gIdx];
    if (utterance.includes(correct)) {
      raw = utterance.replace(correct, wrong);
      expected = utterance;
    }
  }
  goldenLabels.push({
    id: c.id,
    raw,
    expected,
    domain: c.scenario,
    mustNotReplace: [],
  });
  gIdx += 1;
}

const falseRepair = [
  {
    caseId: 'fr-001',
    rawAsr: '我今天不需要机场接送',
    expectedFinal: '我今天不需要机场接送',
    shouldRepair: false,
    domain: 'travel',
    mustNotReplace: ['机场接送'],
  },
  {
    caseId: 'fr-002',
    rawAsr: '这个 GPU 占用正常',
    expectedFinal: '这个 GPU 占用正常',
    shouldRepair: false,
    domain: 'tech_ai',
    mustNotReplace: ['GPU'],
  },
  {
    caseId: 'fr-003',
    rawAsr: '我已经预定了酒店',
    expectedFinal: '我已经预定了酒店',
    shouldRepair: false,
    domain: 'travel',
    mustNotReplace: ['预定'],
  },
  {
    caseId: 'fr-004',
    rawAsr: '我想叫出租车去机场',
    expectedFinal: '我想叫出租车去机场',
    shouldRepair: false,
    domain: 'transport',
    mustNotReplace: ['出租车'],
  },
  {
    caseId: 'fr-005',
    rawAsr: '蓝莓马芬已经卖完了',
    expectedFinal: '蓝莓马芬已经卖完了',
    shouldRepair: false,
    domain: 'restaurant',
    mustNotReplace: ['蓝莓马芬'],
  },
];
for (const c of manifest.slice(0, 20)) {
  if (falseRepair.length >= 22) break;
  falseRepair.push({
    caseId: `fr-${String(falseRepair.length + 1).padStart(3, '0')}`,
    rawAsr: c.utterance,
    expectedFinal: c.utterance,
    shouldRepair: false,
    domain: c.scenario,
    mustNotReplace: [],
  });
}

writeJsonl(path.join(outBenchmark, 'alias_calibration_cases.jsonl'), aliasCases);
writeJsonl(path.join(outBenchmark, 'mixed_language_canonical_cases.jsonl'), mixedCases);
writeJsonl(path.join(outBenchmark, 'canonical_recall_benchmark_cases.jsonl'), recallCases);
writeJsonl(path.join(outBenchmark, 'dialog_200_golden_labels.jsonl'), goldenLabels);
writeJsonl(path.join(outBenchmark, 'false_repair_golden.jsonl'), falseRepair);

const baseline = {
  schemaVersion: 'phase5-benchmark-baseline-v1',
  frozenAt: new Date().toISOString(),
  ladder: '2k',
  metrics: {
    topk_hit_rate: 0,
    top1_hit_rate: 0,
    alias_hit_rate: 0,
    false_repair_rate: 0,
    no_op_repair_rate: 0,
    runtime_latency_ms: 0,
  },
  dialog200Baseline: {
    source: 'phase4b_canonical_expansion_manifest_gate.json',
    pass: 200,
    total: 200,
    lexicon_runtime_ok_count: 200,
    replacements_applied_count: 47,
    lexicon_pinyin_topk_candidate_total: 75,
    confusion_evidence_total: 0,
  },
  notes: 'Update metrics after dialog_200 batch on canonical-only bundle.',
};

fs.mkdirSync(outPkg, { recursive: true });
fs.writeFileSync(path.join(outPkg, 'phase5_benchmark_baseline.json'), JSON.stringify(baseline, null, 2), 'utf-8');

console.log(
  JSON.stringify(
    {
      alias_cases: aliasCases.length,
      mixed_cases: mixedCases.length,
      recall_cases: recallCases.length,
      golden_labels: goldenLabels.length,
      false_repair: falseRepair.length,
      out: outPkg,
    },
    null,
    2
  )
);
