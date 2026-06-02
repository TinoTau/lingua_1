# Lexicon V3.1 — Final SSOT

> **Status:** FROZEN (implementation complete for node-side Patch Service)  
> **Date:** 2026-06-01  
> **Authority:** This is the **only** document to use for Lexicon V3.1 architecture and implementation decisions.  
> **Scope:** Node runtime bundle, Patch Service, test/CLI entry, integration boundaries. V1 asset import — see [electron_node/lexicon-assets/docs/IMPORT_CONSTRAINTS.md](../../electron_node/lexicon-assets/docs/IMPORT_CONSTRAINTS.md).

---

## 1. One-line architecture

```text
Single Runtime (node_runtime/lexicon/v3)
  → Single SQLite (lexicon.sqlite)
  → Single Manifest (manifest.json + stats.json + checksum.txt)
  → Patch Service (lexicon-patch-v3, transaction + reload)
  → FW / ASR (frozen; reads runtime only)
```

**Next phase (not in this freeze):** Node Agent production entry → Scheduler patch distribution → version tracking → production rollout.

---

## 2. Single Runtime

| Item | Value |
|------|--------|
| Path | `{PROJECT_ROOT}/node_runtime/lexicon/v3` |
| Default config | `bundlePath` → `node_runtime/lexicon/v3` (`node-config-defaults`, freeze SSOT) |
| Loader class | `LexiconRuntimeV2` (class name unchanged in V3.1 freeze; loads v3 bundle) |
| Bootstrap only | `npm run lexicon:prepare:v3-runtime` (copy from offline `v2_shadow` build output) |
| Gate | `npm run lexicon:gate:v3-runtime` |

**Forbidden at runtime:**

- `lexicon_dynamic`, `active_bundle.json`, env bundle override (`LEXICON_*_BUNDLE_PATH`)
- Second runtime directory, staging swap, node-side JSONL Source tree / Build V3 / overlay

---

## 3. Single SQLite

```text
node_runtime/lexicon/v3/
  lexicon.sqlite
```

**Tables (unchanged, four-table model):**

- `base_lexicon`
- `idiom_lexicon`
- `domain_lexicon`
- `industry_routing_lexicon`

**Audit table (created on first patch apply):**

- `lexicon_patch_history`

Patch apply uses **SQLite transaction**; gate thresholds inside txn; manifest/stats/checksum written **after** COMMIT.

---

## 4. Single Manifest

```text
node_runtime/lexicon/v3/
  manifest.json      # schemaVersion: lexicon-v3-four-table-v1
  stats.json
  checksum.txt       # sha256(lexicon.sqlite)
```

**After successful patch:** `manifest.json` includes `lastPatchId`, `lastAppliedAt`, `bundleVersion`, `tables`, `checksum`.

**Migration:** `npm run lexicon:migrate:v3-runtime` — one-time from dual-manifest layout. Backup under `_backup_manifest_migration/`.

**Deprecated filenames (do not use on v3 runtime):** `manifest_v2.json`, `manifest_v3.json`, `stats_v2.json`, `stats_v3.json`, `lexicon_v2.sqlite`.

---

## 5. Patch Service

**Module:** `electron_node/electron-node/main/src/lexicon-patch-v3/`

**Protocol:**

```ts
interface LexiconPatchV3 {
  patchId: string;
  baseVersion: number;
  nextVersion: number;
  hash: string;
  signature?: string;   // reserved; verification not enforced in V3.1 freeze
  operations: PatchOperation[];
}
// PatchOperation: add | update | enable | disable | delete
```

**Apply flow:**

```text
validate (version, hash, domain keys, priorScore)
  → close runtime + patch lock
  → BEGIN TRANSACTION
  → apply operations (alias materialize, routing cascade)
  → gate thresholds (V3_TABLE_THRESHOLDS)
  → INSERT lexicon_patch_history
  → COMMIT
  → write manifest.json, stats.json, checksum.txt
  → forceReloadLexiconRuntimeV3()
```

**Routing disable:** `industry_routing_lexicon` has no `enabled` column → **DELETE** routing rows on domain disable/delete.

**Entries (dev/test only today):**

| Entry | Path / command |
|-------|----------------|
| HTTP (test server) | `POST http://127.0.0.1:5020/lexicon/apply-patch` |
| CLI | `npm run lexicon:patch:apply -- --bundle-dir <dir> patch.json` |
| Service | `applyLexiconPatchV3()` in `patch-service.ts` |

E2E uses temp bundle copies (`--bundle-dir`); production apply without override targets default v3 path.

---

## 6. Node Agent (next phase — P1)

**V3.1 freeze:** Patch Service is implemented; **production entry is not**.

| Today | Target |
|-------|--------|
| `test-server.ts` only | Node Agent IPC/HTTP calling **same** `applyLexiconPatchV3()` |
| No scheduler traffic | Scheduler → node → PatchService |

**Constraint (Rev.1):** One implementation — no duplicate apply logic in Agent vs test-server.

---

## 7. Scheduler integration (next phase — P2)

**Not implemented.** Scheduler must:

1. Generate `LexiconPatchV3` (stable hash, monotonic `nextVersion`)
2. Optional signing (`signature` field)
3. Deliver to node Agent endpoint
4. Track ack / failure / rollback policy

**Blocker cleared for integration:** `lexicon-update/` removed; node-side Patch path tested (E2E 12/12, dialog_200 200/200).

---

## 8. Responsibilities

| Side | Owns |
|------|------|
| **Ops / Scheduler** | Assets, review, patch generation, signing, rollout policy |
| **Node** | Validate patch → SQLite txn → metadata → reload → FW reads |

**Offline tools (not Patch path):**

- `lexicon:build:v2-shadow` → builds **offline** seed bundle under `v2_shadow` (bootstrap input)
- `lexicon:import-v3-*` → V1 `current` only
- `lexicon:v3-gate` → V1 `current` only
- `lexicon:patch-merge` → offline seed merge

---

## 9. Frozen boundaries (do not change without freeze review)

- `main/src/fw-detector/`
- `main/src/asr-repair/` (legacy path)
- `main/src/pipeline/` enhancement steps
- `recall-span-topk-v2.ts`, KenLM gate semantics
- Four-table schema and Recall read path

---

## 10. V3.1 implementation status (frozen)

| Capability | Status |
|------------|--------|
| v3 runtime + single manifest | ✅ |
| `lexicon-patch-v3` + validator + applier | ✅ |
| patch_history + manifest/stats/checksum writer | ✅ |
| reload + test-server HTTP + CLI | ✅ |
| Patch E2E + recall smoke + freeze regression | ✅ |
| dialog_200 contract batch | ✅ |
| Node Agent production entry | ⏳ P1 |
| Scheduler distribution | ⏳ P2 |
| Signature verification | ⏳ P3 |
| Production rollout playbook | ⏳ P4 |

---

## 11. Verification commands

```bash
cd electron_node/electron-node
npm run build:main
npm run test:fw-detector
npm run test:lexicon
npm run test:lexicon-patch-e2e
npm run lexicon:gate:v3-runtime
```

---

## 12. Next-phase roadmap

| Phase | Name | Scope |
|-------|------|--------|
| **V3.1** | **Frozen** | Node Patch Service + single runtime (this document) |
| **P1** | Node Agent integration | Agent endpoint → `applyLexiconPatchV3` |
| **P2** | Scheduler patch distribution | Generate, sign, deliver patches |
| **P3** | Version tracking | Cross-node version SSOT, idempotency ops |
| **P4** | Production rollout | Staging apply on real v3, backup, dialog regression |

---

## 13. Document index

| Document | Role |
|----------|------|
| **This file** | Architecture SSOT |
| [README.md](./README.md) | Entry index |
| [electron_node/.../lexicon-v2/README.md](../../electron_node/electron-node/main/src/lexicon-v2/README.md) | Runtime loader module |
| [electron_node/.../lexicon-patch-v3/README.md](../../electron_node/electron-node/main/src/lexicon-patch-v3/README.md) | Patch module |
| [electron_node/.../scripts/lexicon/README.md](../../electron_node/electron-node/scripts/lexicon/README.md) | npm scripts |
| [electron_node/lexicon-assets/docs/](../../electron_node/lexicon-assets/docs/README.md) | V1 asset import |
| [electron_node/docs/lexicon_v2/LEXICON_RUNTIME_V2.md](../../electron_node/docs/lexicon_v2/LEXICON_RUNTIME_V2.md) | FW recall 详述 |

---

## 14. Revision log

| Date | Change |
|------|--------|
| 2026-06-01 | Initial SSOT |
| 2026-06-02 | Docs consolidated; module READMEs; test reports removed |
