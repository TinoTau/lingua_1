# Lexicon Patch Importer V4 — 合约与 Runbook

**版本：** V1.2 · 2026-06-25  
**代码：** `scripts/lexicon/lexicon-patch-import-v4*.mjs` · `main/src/lexicon-patch-v3/`

---

## 1. 标准导入

```powershell
cd electron_node\electron-node
npm run build:main
npm run lexicon:patch:import:electron -- path\to\patch.json --source-jsonl path\to\entries.jsonl
```

成功条件：**Pre Gate + Apply + Runtime Gate + Source Sync（若提供 JSONL）** 全部 PASS。

### 仅校验

```powershell
npm run lexicon:patch:import -- patch.json --dry-run
```

### Patch Hash

```powershell
npm run lexicon:compute-patch-hash:v4 -- patch.json
```

### E2E

```powershell
npm run test:lexicon-patch-v4-e2e
```

---

## 2. Pre Gate（G-01）

Apply 前必须 PASS：

```text
scan-patch-granularity → scan-alias-legality → validate append semantics
```

| 命令 | 说明 |
|------|------|
| `npm run lexicon:patch-build-gate -- <patch.json>` | 粒度 + alias 联合 |
| `npm run lexicon:scan-alias-legality -- <patch.json>` | Alias Ownership |

Alias 规则见 [ALIAS_OWNERSHIP_CONTRACT_FROZEN_V1_0_0.md](./ALIAS_OWNERSHIP_CONTRACT_FROZEN_V1_0_0.md)。

---

## 3. 碰撞键（C-01–C-03）

碰撞定义为 **`termId`** 或 **`(word, pinyin_key)`** — **禁止**仅按 `word` 判碰。

| 规则 | 结果 |
|------|------|
| termId 已存在 | FAIL `term_already_exists` |
| (word, pinyin_key) 已存在 | FAIL `term_already_exists` |
| 同 word 不同 pinyin_key | 允许共存（如 长乐 chang2/le4 vs zhang3/le4） |

---

## 4. Term 解析（R-01–R-03）

| 方式 | 规则 |
|------|------|
| `term_id` | **优先** |
| `word` | 须唯一；0 行 → `term_not_found`；多行 → `ambiguous_term_word` |

---

## 5. Weight Merge（冻结 SQL）

```sql
INSERT INTO term_domain_tags (...)
ON CONFLICT(term_id, domain_id)
DO UPDATE SET weight = MAX(weight, excluded.weight);
```

**禁止** `INSERT OR IGNORE` 作为 appendDomainTags 最终实现。

---

## 6. Runtime Gate 原子性（G-02–G-03）

Importer 成功 = Pre Gate **AND** Apply **AND** Runtime Gate 全 PASS。

Runtime Gate FAIL → Importer 返回 FAIL 并写 `reports/lexicon-import/<patchId>_*.json`。

### 恢复步骤（G-03）

1. 读 report 中 `checksum_after` 与失败步骤。
2. 若有 `node_runtime/lexicon/v3` 备份 → **整目录还原**。
3. 否则：反向 patch 或 `lexicon:build:v2-shadow` 全量重建。
4. `npm run lexicon:gate:v3-runtime` 直至 PASS。
5. 重启节点 reload。

**禁止：** gate FAIL 状态下叠加下一 patch。

---

## 7. Source Sync（SS-01–SS-04）

- Importer 支持 `--source-jsonl`（**P0**）
- JSONL 为 SSOT；patch apply 后须 dual-write 回 JSONL
- Tech_AI / Medical 大批量（`operations.length > 100`）须设 `tableThresholds` + Threshold Review

---

## 8. 与 V3 Patch Service 关系

```text
LexiconPatchV3 JSON → patch-service（事务）→ rematerialize → manifest → forceReloadLexiconRuntimeV3()
```

Importer V4 为 **Electron 节点侧**一键入口；调度器下发见 [ARCHITECTURE.md](./ARCHITECTURE.md) §下一阶段。

---

## 9. 禁止项

- 无 `alias_type` 的裸 `aliases[]`
- 绕过 Pre Gate 直接 apply
- 修改 Schema DDL 作为 importer 修复手段

---

*Patch Importer V4 · Lexicon V3 模块 SSOT*
