#!/usr/bin/env node
/**
 * Semantic chain spot: Recall → Domain scope → FW V4 orchestrator candidates.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const dist = path.join(root, 'dist/main/electron-node/main/src');

const CASES = [
  { id: 'sc_tech', raw: '我们部署大模型推理服务', domain: 'tech_ai', terms: ['大模型', '推理'] },
  { id: 'sc_milk', raw: '一杯阿萨姆红茶少冰', domain: 'milk_tea', terms: ['阿萨姆红茶'] },
  { id: 'sc_food', raw: '来一份凉拌黄瓜', domain: 'food_order', terms: ['凉拌黄瓜'] },
  { id: 'sc_medical', raw: '请问导诊台在哪', domain: 'medical', terms: ['导诊台'] },
  { id: 'sc_meeting', raw: '下午平行投影会议', domain: 'meeting', terms: ['平行投影'] },
];

async function main() {
  const { pinyin } = require('pinyin-pro');
  const { ensureLexiconRuntimeV2Loaded, getLexiconRuntimeV2 } = require(path.join(
    dist,
    'lexicon-v2/lexicon-runtime-v2-holder.js'
  ));
  const { recallSpanTopKV3 } = require(path.join(dist, 'lexicon-v2/recall-span-topkv3.js'));
  const { runFwDetectorOrchestrator } = require(path.join(
    dist,
    'fw-detector/fw-detector-orchestrator.js'
  ));

  const state = ensureLexiconRuntimeV2Loaded();
  if (state.status !== 'ok') {
    console.error(JSON.stringify({ status: 'fail', error: state.errorMessage }));
    process.exit(1);
  }

  const runtimeV2 = getLexiconRuntimeV2();
  const results = [];

  for (const c of CASES) {
    const recallHits = [];
    for (const term of c.terms) {
      const syllables = pinyin(term, { toneType: 'none', type: 'array' }).map((s) => String(s).toLowerCase());
      const recall = recallSpanTopKV3(runtimeV2, {
        syllables,
        windowText: term,
        termLength: [...term].length,
        topK: 8,
        domainIds: [c.domain],
        perSpanLimit: 8,
      });
      const words = (recall.hits ?? []).map((h) => h.hotword?.word).filter(Boolean);
      recallHits.push({ term, hit: words.includes(term), words: words.slice(0, 4) });
    }

    const ctx = {
      rawAsrText: c.raw,
      fwDetectorEnabledDomainsOverride: [c.domain],
      fwDetectorEnableKenLMGateOverride: true,
      segmentForJobResult: c.raw,
    };
    const fw = await runFwDetectorOrchestrator(ctx);
    const candidateWords = new Set();
    for (const span of fw.spans ?? []) {
      for (const cand of span.candidates ?? []) {
        if (cand.word) candidateWords.add(cand.word);
        if (cand.hotword?.word) candidateWords.add(cand.hotword.word);
      }
    }
    const chainHit = c.terms.some((t) => candidateWords.has(t));

    results.push({
      id: c.id,
      domain: c.domain,
      recallHits,
      recallOk: recallHits.every((h) => h.hit),
      fwTriggered: fw.triggered,
      spanCount: fw.spans?.length ?? 0,
      candidateWords: [...candidateWords].slice(0, 12),
      assemblyChainHit: chainHit,
    });
  }

  console.log(JSON.stringify({ status: 'ok', results }, null, 2));
  const ok = results.every((r) => r.recallOk && r.spanCount > 0);
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
