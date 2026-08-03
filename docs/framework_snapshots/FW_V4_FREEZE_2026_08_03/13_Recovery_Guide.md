# 13 — Recovery Guide

| Field | Value |
|-------|-------|
| Snapshot | **FW_V4_FREEZE_2026_08_03** |
| Goal | Restore ASR post-processing Framework to this Recovery Baseline |
| Recall Subsystem | **FROZEN_AT_2026_08_03** |

---

## Inputs Required

| Input | Location |
|-------|----------|
| Git tag / commit | `FW_V4_FREEZE_2026_08_03` · see `snapshot.json` |
| Snapshot pack | `docs/framework_snapshots/FW_V4_FREEZE_2026_08_03/` |
| CURRENT SSOT | `docs/current/INDEX.md` · `docs/tone-v2/RUNTIME_DOMAIN_DOCUMENT_INDEX.md` · `docs/fw-detector/freeze/FROZEN.md` |
| Recall Supporting | `docs/supporting/Recall_Subsystem_Frozen_Contract_2026_08_03.md` |
| Formal Source | `electron_node/docs/lexicon-assets/full_rebuild_v1/` |
| Lexicon bundle | `node_runtime/lexicon/v3/` |

Do **not** rely on chat history or dirty uncommitted worktrees.

---

## Documentation Hierarchy（恢复后阅读顺序）

```text
1. Framework Snapshot（本包）
2. CURRENT SSOT — docs/current/INDEX.md
3. Supporting — docs/supporting/INDEX.md（含 Recall Subsystem Frozen Contract）
4. Acceptance — docs/acceptance/（Evidence only）
5. Archive — docs/archive/
```

---

## Steps

1. **Locate freeze point**
   ```text
   git fetch --tags
   git checkout FW_V4_FREEZE_2026_08_03
   ```
   Or: `git checkout <freeze-commit-sha>`  
   Note: documentation commits after the tag tip do **not** move the tag; for latest CURRENT docs, checkout the documentation commit after tag if needed.

2. **Install dependencies**
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

5. **Promote to v3**
   ```text
   node ../../docs/tone-v2/_audit_scratch/promote-rebuild-to-v3.mjs
   ```
   Or copy sqlite/manifest/checksum into `node_runtime/lexicon/v3/`.

6. **Verify Lexicon identity**
   - Read `node_runtime/lexicon/v3/manifest.json` + `checksum.txt`
   - Expect post-recovery formal identity **bundleVersion=13** · termCount=**9259** · checksum `sha256:b3cc9477227900d726b769a6135a81d09dfdd5a862b37c6e1e92c04e12a81d58` when Source includes 2026-08-03 Recall repairs
   - Git freeze tip historically recorded v12; rebuild from current formal Source is authoritative

7. **Atomicity**
   ```text
   npm run lexicon:test:atomicity
   ```
   Confirm REJECT_COMPOSITE=0 · UNRESOLVED=0 · mode=enforce.  
   Note: `npm run lexicon:gate:v3-runtime` may FAIL on stale row-count thresholds — identity authority is checksum + Atomicity enforce 0/0.

8. **Exact Recall matrix**（仓库真实探针）
   ```text
   set ELECTRON_RUN_AS_NODE=1
   .\node_modules\electron\dist\electron.exe ..\..\docs\tone-v2\_audit_scratch\post-atomicity-exact-recall-probe.mjs
   ```

9. **Window theoretical-count / blocked critical = 0**
   - Evidence pack: `docs/acceptance/Freeze/2026-08-03_Window_Boundary_Audit/`
   - Or re-run: `docs/tone-v2/_audit_scratch/window-boundary-audit.mjs` via Electron

10. **Tone readiness Fail Closed + Plain fallback calls = 0 + composite SQL**
    - Evidence: `docs/acceptance/Freeze/2026-08-03_Recall_Query_Builder_Audit/` / `recall_query_builder_audit_2026_08_03/`
    - Or re-run: `docs/tone-v2/_audit_scratch/recall-query-builder-audit.mjs`

11. **Enumerator trace — no hidden filter of in-SQL correct terms**
    - Evidence: `docs/acceptance/Freeze/2026-08-03_Recall_Candidate_Enumeration_Audit/`
    - Or re-run: `docs/tone-v2/_audit_scratch/recall-candidate-enumeration-audit.mjs`

12. **dialog_200**
    ```text
    set ELECTRON_RUN_AS_NODE=1
    .\node_modules\electron\dist\electron.exe ..\..\docs\tone-v2\_audit_scratch\post-atomicity-dialog200-probe.mjs
    ```

13. **Hard gates**
    ```text
    completedCases = 200
    failedCases = 0
    latticeUncovered = 0
    Atomicity REJECT_COMPOSITE = 0
    Atomicity UNRESOLVED = 0
    ```

---

## Success

Meeting the hard gates + unique production chain + Recall subsystem contracts above = restored to **FW_V4_FREEZE_2026_08_03** recovery baseline (with post-recovery lexicon identity when Source includes Recall repairs).
