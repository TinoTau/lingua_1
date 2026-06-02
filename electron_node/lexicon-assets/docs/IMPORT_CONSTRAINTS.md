# Lexicon V3 Asset Import Constraints

Frozen rules applied by `import-v3-canonical-asset.mjs` + `validate-seed --strict`.

> **Scope:** V1 `node_runtime/lexicon/current` — **not** FW v3 runtime Patch path.

## Seed → deploy sanitize

| Rule | Constraint |
|------|------------|
| Row type | `canonical_term` only; confusion rows rejected at validate |
| `word` (CJK) | ≤ 5 chars for recall (`RECALL_PREFERRED_MAX`) |
| `word` (latin) | compact length ≤ 5 after whitespace removal |
| Build max | ≤ 8 chars (`MAX_WORD_LEN`) |
| `priorScore` | (0, 1] |
| `domains` | Must exist in `data/lexicon/profile-registry.json` |
| Duplicate `word` | **Merged** — higher `priorScore` wins; other surface forms → `aliases` |
| Alias collision | Alias must not equal another canonical `word` |
| `reviewStatus` (deploy) | `approved` \| `pending` \| `rejected` only |

## Asset-package label mapping

| Package field | Deploy value (default import) |
|---------------|-------------------------------|
| `pending_review` | `approved` when `--review-status approved` |
| `draft_review_required` | `approved` when `--review-status approved` |

## Provenance (strict)

Required on every row after sanitize: `license`, `importBatch`, `normalizedBy`, `reviewStatus`.  
Schema detail: [SOURCE_PROVENANCE_SCHEMA.md](./SOURCE_PROVENANCE_SCHEMA.md).

## Post-import

1. `npm rebuild better-sqlite3` if build fails on MODULE_VERSION  
2. `npm run lexicon:rebuild-sqlite` before `npm start`  
3. Restart Electron node — load `node_runtime/lexicon/current`

## Commands

```powershell
cd electron_node/electron-node
npm run lexicon:import-v3-5k-assets
npm run lexicon:rebuild-sqlite
npm run lexicon:v3-gate
```
