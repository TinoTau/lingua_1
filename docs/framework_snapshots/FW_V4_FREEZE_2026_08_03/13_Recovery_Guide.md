# 13 — Recovery Guide

| Field | Value |
|-------|-------|
| Snapshot | **FW_V4_FREEZE_2026_08_03** |
| Goal | Restore ASR post-processing Framework to this Recovery Baseline |

---

## Inputs Required

| Input | Location |
|-------|----------|
| Git tag / commit | `FW_V4_FREEZE_2026_08_03` · see `snapshot.json` |
| Snapshot pack | `docs/framework_snapshots/FW_V4_FREEZE_2026_08_03/` |
| CURRENT SSOT | `docs/tone-v2/RUNTIME_DOMAIN_DOCUMENT_INDEX.md` · `docs/fw-detector/freeze/FROZEN.md` |
| Formal Source | `electron_node/docs/lexicon-assets/full_rebuild_v1/` |
| Lexicon bundle | `node_runtime/lexicon/v3/` |

Do **not** rely on chat history or dirty uncommitted worktrees.

---

## Steps

1. **Locate freeze point**
   ```text
   git fetch --tags
   git checkout FW_V4_FREEZE_2026_08_03
   ```
   Or: `git checkout <freeze-commit-sha>`

2. **Install dependencies** (repo root / electron-node as usual)
   ```text
   cd electron_node/electron-node
   npm ci
   ```

3. **Build**
   ```text
   npm run build:main
   ```

4. **Full Rebuild from formal Source**
   ```text
   npm run lexicon:full-rebuild -- --force
   ```
   Default out: `node_runtime/lexicon/_rebuild_candidate`

5. **Promote to v3** (copy sqlite/manifest/checksum/stats/atomicity reports)
   ```text
   node ../../docs/tone-v2/_audit_scratch/promote-rebuild-to-v3.mjs
   ```
   Or equivalent copy into `node_runtime/lexicon/v3/`.

6. **Verify Lexicon identity**
   - bundleVersion = 12  
   - checksum = `ab78bf3599911711fc18ce59c62ab93c8f50c5410a1a6254e01125a244ce1f76`  
     (or rebuild-equivalent with enforce Gate 0/0 if Source unchanged)

7. **Lexicon / Atomicity gate**
   ```text
   npm run lexicon:gate:v3-runtime
   npm run lexicon:test:atomicity
   ```
   Confirm Atomicity report: REJECT_COMPOSITE=0 · UNRESOLVED=0 · mode=enforce.

8. **Start / load Node**
   - Confirm `LexiconRuntimeV2.loadFromBundleDir(node_runtime/lexicon/v3)` status=ok  
   - Confirm loaded checksum

9. **Exact Recall regression**
   ```text
   ELECTRON_RUN_AS_NODE=1
   ./node_modules/electron/dist/electron.exe ../../docs/tone-v2/_audit_scratch/post-atomicity-exact-recall-probe.mjs
   ```

10. **dialog_200**
    ```text
    ELECTRON_RUN_AS_NODE=1
    ./node_modules/electron/dist/electron.exe ../../docs/tone-v2/_audit_scratch/post-atomicity-dialog200-probe.mjs
    ```

11. **Hard gates**
    ```text
    completedCases = 200
    failedCases = 0
    latticeUncovered = 0
    Atomicity REJECT_COMPOSITE = 0
    Atomicity UNRESOLVED = 0
    ```

---

## Success

Meeting the hard gates + unique production chain + no production LTR/parent_fragment/ngrams = restored to **FW_V4_FREEZE_2026_08_03**.
