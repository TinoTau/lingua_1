# Lexicon V3 Final Architecture

**Status**: Frozen — Canonical Language World Runtime  
**Date**: 2026-05-27

## Production allows

- canonical terms (`lexicon_terms`)
- `domains[]`, `priorScore` (0–1), `aliases`
- exact / pinyin / alias indexes
- manifest gate + validation CLI
- benchmark / evaluation (offline)

## Production forbids

- confusion rows / `confusion_evidence` / observed recall
- runtime lexicon mutation / priorScore mutation
- replay auto-merge into production bundle
- operator-maintained error database
- LLM-generated WindowCandidate

## WindowCandidate.source (frozen)

| Source | Meaning |
|--------|---------|
| `lexicon_pinyin_topk` | Pinyin bucket TopK on canonical term |
| `canonical_exact` | Exact match on canonical word (latin / exact index) |
| `alias_exact` | Exact match via alias |
| `alias_pinyin` | Pinyin bucket match via alias |

Implementation: `electron-node/main/src/lexicon/window-candidate-source.ts`

## Build pipeline

`validate-seed` → `migrate-seed` → `build-bundle` → `manifest.json` + `checksum.txt`

- Confusion rows: **hard reject** (`confusion_row_rejected`)
- V3 `build-bundle` **不再创建** `lexicon_confusions` 表
- Unknown domain: **fail**
- Alias collision: **fail**
- `priorScore`: **0–1**, required > 0

### SQLite 与 bundle（勿与 ABI rebuild 混淆）

- **ABI**：`lexicon:build` / `lexicon:rebuild-sqlite` 管的是 `better-sqlite3` 与 Electron/系统 Node 的模块版本（早已冻结，见 `docs/CODING/常用命令`）。
- **Bundle 内容**：只有 seed 或 schema 变更时才需重跑 `lexicon:build` 生成新 `lexicon.sqlite`。
- 旧 bundle 若仍含 `lexicon_confusions` 表：**runtime 不读**，行为已是 canonical-only；重 build 仅为工件与 manifest 对齐。

## Remaining work (not runtime)

- 5k / 10k canonical asset production
- mixed-language canonical at scale
- alias asset expansion
- priorScore calibration on real corpora
