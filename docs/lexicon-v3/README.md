# Lexicon V3 Documentation Index

**Status**: Active — Canonical Language World Runtime (frozen)  
**Supersedes**: Lexicon V2 confusion/error-world paths

## Primary documents

| Document | Purpose |
|----------|---------|
| [LEXICON_V3_FINAL_ARCHITECTURE.md](./LEXICON_V3_FINAL_ARCHITECTURE.md) | V3 runtime architecture freeze |
| [LEGACY_FREEZE.md](./LEGACY_FREEZE.md) | V2 / confusion legacy policy |
| [SEMANTIC_BOUNDARY.md](./SEMANTIC_BOUNDARY.md) | LLM vs Recover boundary |
| [SOURCE_PROVENANCE_SCHEMA.md](./SOURCE_PROVENANCE_SCHEMA.md) | Canonical seed provenance fields |
| [IMPORT_CONSTRAINTS.md](./IMPORT_CONSTRAINTS.md) | Asset import sanitize / dedupe / approved rules |
| [V3_ACCEPTANCE_GATE.md](./V3_ACCEPTANCE_GATE.md) | Runtime / build / benchmark gates |

## Wrap-up report (2026-05-27)

| Document | Purpose |
|----------|---------|
| [Lexicon V3 Runtime Wrapup](../../docs/lexicon-v3/LEXICON_V3_FINAL_ARCHITECTURE.md) | 架构冻结（仓库级） |

## Implementation location

- Runtime: `electron_node/electron-node/main/src/lexicon/`
- Build: `electron_node/electron-node/scripts/lexicon/`
- Evaluation assets: `electron_node/docs/lexicon-assets/Lexicon_Phase5_Evaluation_Package/`

## Commands

```powershell
cd electron_node/electron-node
npm run test:lexicon
npm run lexicon:build
npm run lexicon:phase5-benchmark
npm run lexicon:source-manager -- --input data/lexicon/10k/lexicon_10k_canonical_merged.jsonl
```
