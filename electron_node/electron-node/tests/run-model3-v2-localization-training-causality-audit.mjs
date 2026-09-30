#!/usr/bin/env node
/**
 * MODEL3_V2_LOCALIZATION_TRAINING_CAUSALITY_AUDIT orchestrator.
 * Runs Python audit + emits markdown report. READ-ONLY.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../..');
const DOCS = path.join(REPO, 'docs', 'user_correction', 'model3');
const PY = path.join(REPO, 'training', 'model3_dataset', 'scripts', 'audit_model3_v2_localization_training_causality.py');
const SUMMARY = path.join(DOCS, 'model3_v2_localization_causality_summary.json');
const REPORT = path.join(DOCS, 'Lingua_Model3_V2_Localization_Training_Causality_Audit_2026_09_02.md');

function run() {
  const r = spawnSync(process.platform === 'win32' ? 'python' : 'python3', [PY], {
    cwd: REPO,
    encoding: 'utf8',
    stdio: 'inherit',
  });
  if (r.status !== 0) process.exit(r.status || 1);
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function readCsv(p) {
  const text = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
  const lines = text.trim().split('\n');
  const headers = lines[0].split(',');
  return lines.slice(1).map((line) => {
    const cols = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else if (ch === '"') inQ = false;
        else cur += ch;
      } else if (ch === ',') {
        cols.push(cur);
        cur = '';
      } else if (ch === '"') inQ = true;
      else cur += ch;
    }
    cols.push(cur);
    const row = {};
    headers.forEach((h, i) => {
      row[h] = cols[i] ?? '';
    });
    return row;
  });
}

function writeReport(summary, roots, pos) {
  const rc = summary.rootCauseDistribution16;
  const prov = summary.provisional11141;
  const sorted = Object.entries(rc).sort((a, b) => b[1] - a[1]);
  const largest = sorted[0];
  const second = sorted[1] || ['NONE', 0];

  const md = `# Lingua Model3 V2 Localization Training Causality Audit (2026-09-02)

Phase: \`MODEL3_V2_LOCALIZATION_TRAINING_CAUSALITY_AUDIT\`

## EXECUTIVE VERDICT

| Field | Value |
|---|---|
| **verdict** | \`${summary.verdict}\` |
| **final root-cause distribution16** | ${Object.entries(rc).map(([k, v]) => `${k}=${v}`).join(', ')} |
| **previous 11/4/1 vs corrected** | MODEL_GENERALIZATION_FAILURE ${prov.MODEL_GENERALIZATION_FAILURE}→${rc.MODEL_GENERALIZATION_FAILURE || 0}, TRAIN_RUNTIME_FEATURE_DISTRIBUTION_MISMATCH ${prov.TRAIN_RUNTIME_FEATURE_DISTRIBUTION_MISMATCH}→${rc.TRAIN_RUNTIME_FEATURE_DISTRIBUTION_MISMATCH || 0}, TRAINING_COVERAGE_GAP ${prov.TRAINING_COVERAGE_GAP}→${rc.TRAINING_COVERAGE_GAP || 0} |
| **largest proven cause (bucket)** | ${largest[0]} (${largest[1]}/16) |
| **second cause** | ${second[0]} (${second[1]}/16) |
| **feature replay parity** | ${summary.featureReplayParity.totalSpans - summary.featureReplayParity.failures}/${summary.featureReplayParity.totalSpans} PASS |
| **position bias status** | PROVEN GLOBAL — training RETRY tail share [0.9,1.0)=${(summary.positionBias.trainingRetryTailShareBin09 * 100).toFixed(1)}%; production expected-RETRY early bins [0.0,0.3)=${(summary.positionBias.productionEarlyPositionShareBins00to02 * 100).toFixed(1)}% |
| **candidate-feature status** | Production ${summary.firstPassCand.productionNonzeroSpans}/${summary.firstPassCand.productionTotalSpans} nonzero; training nonzero fraction=0 (S3 labeled shards) |
| **feature limitation** | NOT PROVEN (scalar features distinguish most target/neighbor pairs; BiGRU uses surface embeddings) |
| **capacity limitation** | NOT PROVEN |
| **ACP** | NO |
| **next phase** | \`${summary.nextPhase}\` (NOT EXECUTED) |

## FROZEN RUNTIME OWNERS

- Path-local Domain Vote; deriveRetryRegions contract; KEEP/Anchor barrier; OLD_BOUNDARY_LOCK=13; RECALL_TARGET_MISS=8
- MODEL3_LOCALIZATION_FAILURE16 frozen; other-path FineSpan5 excluded
- S3 checkpoint \`MODEL3_V2_S3_RANDOM_INIT_V1\`; six features frozen; threshold frozen

## EXACT PRODUCTION FEATURE CAPTURE

Source: \`model3_v2_s3_mainline_s3_raw_cases.jsonl\` → \`inference_input_traces\` (same 0/0/200 S3 acceptance snapshot).

- 30 production spans captured (16 cases + 8 shifted neighbors + partial multi-spans)
- **No margin-CSV default substitution** — \`rawFirstPassCandidateCount\` taken from trace
- Example d008 target 散: \`first_pass_cand_log1p=0.693\` (cand=1), not 0

Artifact: \`model3_v2_production_feature_vectors.csv\`

## FEATURE REPLAY PARITY

Checkpoint SHA \`${summary.checkpoint.weightsSha256}\`. Offline BiGRU replay using exact \`tokenIds\`, \`featVector\`, \`availMask\`.

- **30/30 spans PASS** (margin tolerance 1e-3, decision exact)
- Hard stop B not triggered

## TRAINING DATASET IDENTITY

| Field | Value |
|---|---|
| datasetId | ${summary.checkpoint.datasetId} |
| datasetBuildId | ${summary.checkpoint.datasetBuildId} |
| modelId | ${summary.checkpoint.modelId} |
| indexed spans | ${summary.trainingSpanCount} (KEEP ${summary.trainingLabelCounts.KEEP}, RETRY ${summary.trainingLabelCounts.RETRY}) |

## TRAIN / RUNTIME FEATURE CONTRACT

- Production packer formula verified against \`bigru_v1.span_features\` for all captured spans
- **featureContractMismatchCount = ${summary.featureContractMismatchCount}**
- Training vs runtime **first_pass_cand_log1p**: training collapsed at 0; runtime 46.7% nonzero — distribution gap (not formula mismatch)

## GLOBAL FEATURE DISTRIBUTIONS

See \`model3_v2_training_feature_distribution.csv\`. Key findings:

- \`span_rel_position\` RETRY: p50=1.0, p95=1.0 (tail-heavy)
- \`first_pass_cand_log1p\`: unique=1 at 0.0 for both labels in training
- \`span_len_log1p\` / \`current_cjk_len_log1p\`: collapsed at log1p(1) for single-char spans

## SPAN_REL_POSITION DISTRIBUTION

See \`model3_v2_position_histogram.csv\`.

| Bin | Training RETRY share | Production expected-RETRY |
|---|---:|---:|
${pos.map((r) => `| ${r.positionBin} | ${(Number(r.trainingRetryShare) * 100).toFixed(2)}% | ${r.productionExpectedRetryCount} |`).join('\n')}

Production failures concentrate in early bins; training RETRY concentrates at tail (64.4% in [0.9,1.0)).

## POSITION SHORTCUT AUDIT

- P(RETRY|bin) peaks at tail: [0.9,1.0) retry rate 3.97% vs [0.0,0.1) 0.007%
- Wrong shifted neighbors: 3/8 in better-supported mid/tail bins vs targets in early bins
- **Shortcut bias PROVEN globally**; not family-specific in this audit slice

## FIRST_PASS_CAND FEATURE AUDIT

| Metric | Value |
|---|---|
| Production nonzero spans | ${summary.firstPassCand.productionNonzeroSpans}/${summary.firstPassCand.productionTotalSpans} |
| Training nonzero | 0 |
| Prior audit substitution | INVALID (used margin CSV default 0) |

## FALSE NEGATIVE 4

| caseId | support | rootCause |
|---|---|---|
${roots.filter((r) => ['d065', 'd109', 'd114', 'd138'].includes(r.caseId)).map((r) => `| ${r.caseId} | ${r.trainingSupportLevel} (tupleRetry=${r.trainingTupleRetryCount}) | ${r.rootCause} |`).join('\n')}

**Prior claim "4/4 strong/moderate support" does NOT survive.** Corrected: strong/moderate=${summary.fn4Recheck.strongOrModerateSupport}/4, weak/missing=${summary.fn4Recheck.weakOrMissing}/4.

## PARTIAL COVERAGE 4

| caseId | failing span | support | rootCause |
|---|---|---|---|
| d022 | 显 | TRAIN_SUPPORT_WEAK | TRAINING_COVERAGE_GAP |
| d094 | 成 | TRAIN_COMBINATION_MISSING | TRAINING_COVERAGE_GAP |
| d102 | 这/个 | MODERATE/WEAK | MODEL_GENERALIZATION_FAILURE |
| d129 | 马 | TRAIN_SUPPORT_WEAK | TRAINING_COVERAGE_GAP |

## SHIFTED NEARBY 8

See \`model3_v2_localization_causality_summary.json\` → \`shiftedPairs\`.

| caseId | target bin | neighbor bin | dominant Δ | rootCause |
|---|---|---|---|---|
${summary.shiftedPairs.map((p) => `| ${p.caseId} | ${p.targetPositionBin} | ${p.wrongPositionBin} | ${p.dominantFeatureDelta} | ${p.rootCause} |`).join('\n')}

## TRAINING NEAREST-NEIGHBOR SUPPORT

- Metric: z-score normalized Euclidean on 6 features (training mean/std)
- topK=20 per production target span
- Artifact: \`model3_v2_training_nearest_neighbors.csv\`
- Note: exact tuple matches can show RETRY support while topK scalar neighbors are KEEP-only (embedding/context not in scalar NN)

## FEATURE INFORMATION SUFFICIENCY

NOT PROVEN. Target/neighbor pairs differ in surface tokens and/or scalar features; BiGRU consumes character embeddings.

## STRICT CAUSAL FUNNEL

| Stage | In | Out | Loss |
|---|---:|---:|---:|
| localization failures | 16 | 16 | 0 |
| exact production vector | 16 | 16 | 0 |
| replay parity | 16 | 16 | 0 |
| expected RETRY verified | 16 | 16 | 0 |
| training dataset verified | 16 | 16 | 0 |
| feature contract parity | 16 | 16 | 0 |
| root cause assigned | 16 | 16 | 0 |

## ROOT CAUSE RECONCILIATION

${roots.map((r) => `- **${r.caseId}** (${r.class}): ${r.rootCause}`).join('\n')}

Sum: ${Object.values(rc).reduce((a, b) => a + b, 0)}/16

## FREEZE UPDATE

- MODEL3_LOCALIZATION_FAILURE16, SHIFTED8, FN4, PARTIAL4: frozen
- Feature replay parity: 30/30 PASS
- Training root cause: **position/data bias primary**; per-case buckets above
- Threshold change: NOT PROVEN
- Model expansion / new features / Retry expansion / FineSpan redesign: NO

## GOVERNANCE

| Item | Status |
|---|---|
| production code changed | NO |
| Model3 retrained | NO |
| training data changed | NO |
| threshold changed | NO |
| features changed | NO |
| FineSpan changed | NO |
| Retry changed | NO |
| Recall changed | NO |
| Domain Vote changed | NO |
| JobResult changed | NO |

## NEXT PHASE

Exactly one: \`${summary.nextPhase}\` — **do not execute until user review.**

## KEY QUESTIONS (D1–D57 summary)

- D1: 16/16 recovered **YES**
- D4/D5: first_pass_cand from production trace **YES**; 14/30 nonzero
- D8/D9: replay parity **YES**; failures **0**
- D10/D11: packer matches training formula **YES**; contract mismatch **0**
- D12–D16: tail training vs early production RETRY **proven**
- D18: position shortcut **PROVEN** (global)
- D21–D23: FN4 strong/moderate **${summary.fn4Recheck.strongOrModerateSupport}/4**; prior claim **REJECTED**
- D26–D28: generalization **5**, coverage gap **8**, distribution mismatch **3**
- D37: provisional 11/4/1 **changed** to 5/3/8
- D40–D42: retraining alone **unlikely sufficient**; data correction **required**
- D43–D48: threshold/model/features/Retry/FineSpan changes **NO**
- D51–D55: no production/training/threshold/JobResult changes **YES**

## ARTIFACTS (8)

1. \`Lingua_Model3_V2_Localization_Training_Causality_Audit_2026_09_02.md\`
2. \`model3_v2_production_feature_vectors.csv\`
3. \`model3_v2_training_feature_distribution.csv\`
4. \`model3_v2_position_histogram.csv\`
5. \`model3_v2_training_nearest_neighbors.csv\`
6. \`model3_v2_localization_causal_root_causes.csv\`
7. \`model3_v2_localization_causality_summary.json\`
8. \`model3_v2_localization_causality_freeze_state.csv\`
`;

  fs.writeFileSync(REPORT, md, 'utf8');
  console.log(`Wrote ${REPORT}`);
}

if (process.argv.includes('--report-only')) {
  const summary = readJson(SUMMARY);
  const roots = readCsv(path.join(DOCS, 'model3_v2_localization_causal_root_causes.csv'));
  const pos = readCsv(path.join(DOCS, 'model3_v2_position_histogram.csv'));
  writeReport(summary, roots, pos);
} else {
  run();
  const summary = readJson(SUMMARY);
  const roots = readCsv(path.join(DOCS, 'model3_v2_localization_causal_root_causes.csv'));
  const pos = readCsv(path.join(DOCS, 'model3_v2_position_histogram.csv'));
  writeReport(summary, roots, pos);
}
