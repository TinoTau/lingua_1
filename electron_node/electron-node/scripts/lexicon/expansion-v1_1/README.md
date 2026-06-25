# Lexicon Expansion V1.1 (Addendum v1.2.1)

**Option B** · Patch First · JSONL dual-write

## Decisions frozen

| ID | Choice |
|----|--------|
| D-01 | Option B — `term add` + `aliases` + Patch |
| D-02 | 挂号处 → `domainTags: ['general']` (oral 统一) |

## Build

```bash
cd electron_node/electron-node
npm run lexicon:expansion-v1_1:build
```

Produces:

- `patches/exp-v1_1-p1-terms.patch.json` (14 ops)
- `patches/exp-v1_1-p1_5-alias.patch.json` (16 ops)
- Appends P1 rows to `domain_patch_multidomain_v1/entries.jsonl`

## Apply (sequential)

```bash
npm run lexicon:patch-build-gate -- scripts/lexicon/expansion-v1_1/patches/exp-v1_1-p1-terms.patch.json
npm run lexicon:patch:apply:electron -- scripts/lexicon/expansion-v1_1/patches/exp-v1_1-p1-terms.patch.json

npm run lexicon:patch-build-gate -- scripts/lexicon/expansion-v1_1/patches/exp-v1_1-p1_5-alias.patch.json
npm run lexicon:patch:apply:electron -- scripts/lexicon/expansion-v1_1/patches/exp-v1_1-p1_5-alias.patch.json

npm run lexicon:gate:v3-runtime
```

`patch-build-gate` = `scan-patch-granularity` + `scan-alias-legality`（[Alias Ownership Contract V1.0.0](../../../../docs/lexicon-v3/ALIAS_OWNERSHIP_CONTRACT_FROZEN_V1_0_0.md)）。

> **注意：** 历史 P1/P1.5 patch 若含非法 ASR alias，将在 alias gate FAIL；须按 [Alias Ownership Contract](../../../../docs/lexicon-v3/ALIAS_OWNERSHIP_CONTRACT_FROZEN_V1_0_0.md) 清理后再 apply。

After Patch A only, regenerate Patch B against current manifest:

```bash
node scripts/lexicon/expansion-v1_1/build-expansion-patches.mjs --patch-b-only
```

**P1.5 split:** words already in term SSOT (`EXISTING_TERM_ID_BY_WORD`) emit `term update` + alias merge; others emit `term add` (Option B).

## Patch C (acceptance)

见 Addendum v1.2.1 §11 — gate + E2E + Dialog200。
