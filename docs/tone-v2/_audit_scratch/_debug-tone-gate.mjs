import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(__dirname, '../../..');
const electronRoot = path.join(repo, 'electron_node/electron-node');
const dist = path.join(electronRoot, 'dist/main/electron-node/main/src');
process.chdir(electronRoot);
process.env.PROJECT_ROOT = repo;
const require = createRequire(path.join(electronRoot, 'package.json'));
const Database = require('better-sqlite3');

const { LexiconRuntimeV2 } = require(path.join(dist, 'lexicon-v2/lexicon-runtime-v2.js'));
const { recallSpanTopKV2 } = require(path.join(dist, 'lexicon-v2/recall-span-topk-v2.js'));
const { resolveRecallScope } = require(
  path.join(dist, 'lexicon-v2/resolve-recall-enabled-fine-domains.js')
);
const { loadFwDetectorRuntimeConfig } = require(path.join(dist, 'fw-detector/fw-config.js'));
const { resolveToneRecallReadiness } = require(
  path.join(dist, 'lexicon-v2/tone-recall-readiness.js')
);
const { runPhase1WindowEdgeHarness } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/phase1-window-edge-harness.js')
);
const { defaultGeneralProfile } = require(path.join(dist, 'lexicon-v2/profile-registry.js'));
const { loadPinyinImeV2RuntimeConfig } = require(
  path.join(dist, 'fw-detector/pinyin-ime-v2/pinyin-ime-v2-config.js')
);
const { loadPinyinImeV2Dictionaries, resolvePinyinImeV2DictDir } = require(
  path.join(dist, 'fw-detector/pinyin-ime-v2/pinyin-ime-v2-dict-load.js')
);

const db = new Database(path.join(repo, 'node_runtime/lexicon/v3/lexicon.sqlite'), {
  readonly: true,
});
const rt = new LexiconRuntimeV2();
rt.loadFromBundleDir(path.join(repo, 'node_runtime/lexicon/v3'));
const fw = loadFwDetectorRuntimeConfig();
const domainIds = resolveRecallScope({ configEnabledDomains: fw.enabledDomains }).domainIds;

function tonesFromKey(tpk) {
  return String(tpk)
    .split('|')
    .map((s) => {
      const m = s.match(/(\d)/);
      return m ? Number(m[1]) : 0;
    });
}

const readinessNo = resolveToneRecallReadiness({
  syllables: ['zhong', 'xin'],
  runtimeSupportsTone: rt.supportsToneFirstRecall(),
  acousticTonePattern: undefined,
  toneCallerEnabled: false,
});
const readinessYes = resolveToneRecallReadiness({
  syllables: ['zhong', 'xin'],
  runtimeSupportsTone: rt.supportsToneFirstRecall(),
  acousticTonePattern: [1, 1],
  toneCallerEnabled: true,
});
console.log('readinessNo', readinessNo);
console.log('readinessYes', readinessYes);

const rNo = recallSpanTopKV2(rt, {
  syllables: ['zhong', 'xin'],
  windowText: '忠心',
  topK: 8,
  domainIds,
  toneCallerEnabled: false,
});
const rYes = recallSpanTopKV2(rt, {
  syllables: ['zhong', 'xin'],
  windowText: '忠心',
  topK: 8,
  domainIds,
  acousticTonePattern: [1, 1],
  toneCallerEnabled: true,
});
console.log(
  'noTone',
  rNo.hits.map((h) => h.hotword.word),
  rNo.toneRecallReadiness
);
console.log(
  'withTone',
  rYes.hits.map((h) => `${h.hotword.word}:${h.candidateScore}`),
  rYes.toneRecallReadiness
);

// Counterfactual: with tone fixtures, do expected atoms appear for all 7 cases?
const cases = [
  {
    id: 'nn-train-01',
    raw: '我闷蒸在升级公司内部的专家系统平台。',
    atoms: ['我们', '正在'],
  },
  { id: 'nn-train-01b', raw: '我闷蒸在训练神经网络模型。', atoms: ['正在'] },
  { id: 'center-01', raw: '微服务会定时向注册忠心上报健康状态。', atoms: ['中心'] },
  { id: 'snack-01', raw: '客房里的迷你吧提供饮料和消失。', atoms: ['小食'] },
  { id: 'sync-01', raw: '回归测试报告已精通步给质量保障团队。', atoms: ['已经', '同步'] },
  { id: 'trigger-01', raw: '调用下游超时后会出发熔断策略保护。', atoms: ['触发'] },
  { id: 'threshold-01', raw: '熔断策略阈之一按错误率重新校准。', atoms: ['阈值'] },
];

const ime = loadPinyinImeV2RuntimeConfig();
const dict = loadPinyinImeV2Dictionaries(resolvePinyinImeV2DictDir(ime.dictDir), {
  enabledDomains: ime.enabledDomains,
});
const profile = defaultGeneralProfile();

function makeCharToneFixtures(rawText) {
  const chars = [...rawText].filter((ch) => /[\u4e00-\u9fff]/.test(ch));
  const slices = [];
  let t = 0;
  for (const ch of chars) {
    const row =
      db.prepare(`SELECT tone_pinyin_key FROM term WHERE word=? AND enabled=1`).get(ch) ||
      db.prepare(`SELECT tone_pinyin_key FROM base_lexicon WHERE word=? AND enabled=1`).get(ch);
    let tone = 1;
    if (row?.tone_pinyin_key) {
      const m = String(row.tone_pinyin_key).match(/(\d)/);
      if (m) tone = Number(m[1]);
    }
    // Prefer compound tone from covering terms when available — use char default
    slices.push({
      startSec: t,
      endSec: t + 0.2,
      tone,
      char: ch,
    });
    t += 0.2;
  }
  // Also build wordTimeSpans per char
  const wordTimeSpans = chars.map((ch, i) => ({
    word: ch,
    startMs: i * 200,
    endMs: i * 200 + 200,
    startSec: i * 0.2,
    endSec: i * 0.2 + 0.2,
    rawStart: rawText.indexOf(ch), // fragile for repeats
    rawEnd: rawText.indexOf(ch) + ch.length,
  }));
  return { acousticSlices: slices, wordTimeSpans };
}

for (const c of cases) {
  // Offline: for each atom, if exists, recall with its own tone key
  for (const atom of c.atoms) {
    const row = db
      .prepare(
        `SELECT pinyin_key, tone_pinyin_key FROM term WHERE word=? AND enabled=1 LIMIT 1`
      )
      .get(atom);
    if (!row) {
      console.log(c.id, atom, 'TERM_MISSING');
      continue;
    }
    const syl = String(row.pinyin_key).split('|').filter(Boolean);
    const tones = tonesFromKey(row.tone_pinyin_key);
    const hit = recallSpanTopKV2(rt, {
      syllables: syl,
      windowText: atom,
      topK: 8,
      domainIds,
      acousticTonePattern: tones,
      toneCallerEnabled: true,
    });
    console.log(
      c.id,
      atom,
      'pk',
      row.pinyin_key,
      'tpk',
      row.tone_pinyin_key,
      'hits',
      hit.hits.map((h) => h.hotword.word),
      'rank',
      hit.hits.findIndex((h) => h.hotword.word === atom) + 1 || 'MISS'
    );
  }
}

// Production-like phase1 WITHOUT tone (matches KenLM baseline probe)
for (const c of cases.slice(0, 3)) {
  const p1 = runPhase1WindowEdgeHarness({
    rawText: c.raw,
    runtime: rt,
    profile,
    domainIds,
    minPrior: fw.minPrior,
    imeConfig: ime,
    dict,
  });
  const reps = new Set(
    p1.recalledWindows.flatMap((w) => w.candidates.map((x) => x.replacement))
  );
  console.log(
    'phase1_no_tone',
    c.id,
    'candWindows',
    p1.recalledWindows.filter((w) => w.candidates.length).length,
    'uniqueReps',
    [...reps].slice(0, 20),
    'edgeCount',
    p1.edges.length
  );
}
