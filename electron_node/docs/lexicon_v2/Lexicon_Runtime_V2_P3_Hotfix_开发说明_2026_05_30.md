# Lexicon Runtime V2 — P3 Hotfix 开发说明

版本：V1.0  
日期：2026-05-30

## 目标

在 **不修改 FW 主链 / KenLM / Detector / Pick** 的前提下，于 **SQL 层** 限制 V2 Recall 候选规模，验证 Recall Explosion 是否由候选失控引起。

## 修改文件列表

| 文件 | 变更 |
|------|------|
| `lexicon-v2/lexicon-runtime-v2.ts` | SQL `ORDER BY prior_score DESC LIMIT ?` + `length(word)=?` |
| `lexicon-v2/lexicon-runtime-v2-config.ts` | `maxBaseCandidates` / `maxDomainCandidates` / `maxIdiomCandidates` |
| `lexicon-v2/recall-span-topk-v2.ts` | 使用配置限额；merge cap = 2+3+0 |
| `lexicon-v2/recall-v2-diagnostics.ts` | Hotfix 诊断字段 + job 级 collector |
| `node-config-types.ts` / `node-config-defaults.ts` | 新 flag 默认值 2/3/0 |
| `lexicon-v2/recall-hotfix.test.ts` | merge cap 单测 |
| `lexicon-v2/lexicon-runtime-v2.test.ts` | API 签名更新 |
| `tests/run-lexicon-v2-phase3-only-audit-batch.js` | Hotfix 批测输出路径 |
| `tests/analyze-phase3-only-audit.mjs` | 分层候选 / KenLM 统计 |

**未修改：** `fw-topk-decision-pipeline.ts`、`kenlm-span-gate.ts`、`suspicious-span-detector-v1.ts`、`apply-span-replacements.ts`

## Feature Flags

```json
"lexiconRuntimeV2": {
  "maxBaseCandidates": 2,
  "maxDomainCandidates": 3,
  "maxIdiomCandidates": 0,
  "recallDiagnosticsEnabled": true
}
```

## Recall 查询链（Hotfix 后）

```text
base_lexicon     SQL LIMIT 2  (pinyin_key + length(word))
domain_lexicon   SQL LIMIT 3  (per domain_id)
idiom_lexicon    默认跳过 (maxIdiomCandidates=0)
  → mergeTierCandidates (max 5)
  → score + topK (FW config topK=3)
  → KenLM weak_veto
  → pick
```

## 诊断字段（`fw_detector.recallV2Diagnostics`）

每 span：`base_hits`, `domain_hits`, `idiom_hits`, `*_after_limit`, `candidate_count_*`, `sent_to_kenlm`, `v2_recall_ms` 等。

## 批测

```bash
node tests/run-lexicon-v2-phase3-only-audit-batch.js
node tests/analyze-phase3-only-audit.mjs
```

输出：

- `tests/lexicon-v2-phase3-hotfix-audit-batch-result.json`
- `tests/lexicon-v2-phase3-hotfix-audit-quality-perf.json`

验收报告见：`Lexicon_Runtime_V2_P3_Hotfix_验证报告_2026_05_30.md`（批测完成后填写）
