# Lexicon V3.1 — 架构 SSOT

**状态**：FROZEN（节点 Patch Service + 单 Runtime）  
**日期**：2026-06-01（架构）· 文档整理 2026-06-03  
**范围**：`node_runtime/lexicon/v3`、Patch、Runtime 加载、与 FW Recall 边界。  
**V1 资产 import**：[electron_node/lexicon-assets/docs/](../../electron_node/lexicon-assets/docs/README.md)

---

## 1. 架构总览

```text
Single Runtime (node_runtime/lexicon/v3)
  → Single SQLite (lexicon.sqlite)
  → Single Manifest (manifest.json + stats.json + checksum.txt)
  → Patch Service (lexicon-patch-v3, transaction + reload)
  → FW Recall / KenLM（只读 runtime；Span 由 Pinyin-IME-V2 供给）
```

---

## 2. Single Runtime

| 项 | 值 |
|----|-----|
| 路径 | `{PROJECT_ROOT}/node_runtime/lexicon/v3` |
| 默认配置 | `bundlePath` → 上述路径（`node-config-defaults`） |
| 加载器 | `LexiconRuntimeV2`（类名历史保留；读 v3 bundle） |
| Bootstrap | `npm run lexicon:prepare:v3-runtime` |
| 门禁 | `npm run lexicon:gate:v3-runtime` |

**禁止（运行时）**：

- `lexicon_dynamic`、`active_bundle.json`、`LEXICON_*_BUNDLE_PATH` 覆盖
- 第二套 runtime、staging swap、节点侧 JSONL Source / overlay 热更新

---

## 3. SQLite 四表模型

路径：`node_runtime/lexicon/v3/lexicon.sqlite`

| 表 | 用途 |
|----|------|
| `base_lexicon` | 基础词条 |
| `idiom_lexicon` | 成语/习语 |
| `domain_lexicon` | 领域词 |
| `industry_routing_lexicon` | 行业路由 |

**审计表**（首次 Patch 后创建）：`lexicon_patch_history`

Patch 在 **事务内** 改表；`manifest.json` / `stats.json` / `checksum.txt` 在 **COMMIT 后** 写入。

---

## 4. Manifest

```text
manifest.json   # schemaVersion: lexicon-v3-four-table-v1
stats.json
checksum.txt    # sha256(lexicon.sqlite)
```

成功 Patch 后 `manifest.json` 含 `lastPatchId`、`lastAppliedAt`、`bundleVersion`、`tables`、`checksum`。

**迁移**：`npm run lexicon:migrate:v3-runtime`（一次性；备份 `_backup_manifest_migration/`）

**废弃文件名**：`manifest_v2.json`、`manifest_v3.json`、`stats_v2.json`、`lexicon_v2.sqlite` 等。

---

## 5. Patch Service

**模块**：`main/src/lexicon-patch-v3/`

```typescript
interface LexiconPatchV3 {
  patchId: string;
  baseVersion: number;
  nextVersion: number;
  hash: string;
  signature?: string;  // 保留字段；V3.1 未强制验签
  operations: PatchOperation[];  // add | update | enable | disable | delete
}
```

**Apply 流程**：

```text
validate (version, hash, domain keys, priorScore)
  → close runtime + patch lock
  → BEGIN TRANSACTION
  → apply operations（alias materialize, routing cascade）
  → gate thresholds (V3_TABLE_THRESHOLDS)
  → INSERT lexicon_patch_history
  → COMMIT
  → write manifest.json, stats.json, checksum.txt
  → forceReloadLexiconRuntimeV3()
```

**路由表**：`industry_routing_lexicon` 无 `enabled` 列 → domain disable/delete 时 **DELETE** 路由行。

**入口**：

| 入口 | 说明 |
|------|------|
| `applyLexiconPatchV3()` | `patch-service.ts` |
| HTTP（测试服） | `POST /lexicon/apply-patch` |
| CLI | `npm run lexicon:patch:apply -- --bundle-dir <dir> patch.json` |

E2E 使用 `--bundle-dir` 临时目录；生产默认写 v3 路径。

---

## 6. Recall 与 FW 边界

| 组件 | 职责 | 代码 |
|------|------|------|
| **Lexicon Recall** | span → 词库 TopK 候选 | `lexicon/local-span-recall.ts` → V2 runtime |
| **Pinyin-IME-V2** | Span Discovery（**非**本仓库目录） | `fw-detector/pinyin-ime-v2/` |
| **FW Orchestrator** | IME → HintGate → Recall → KenLM → Apply | `fw-detector-orchestrator.ts` |

**冻结边界（勿在无评审时修改）**：

- `recall-span-topk-v2.ts`、四表 schema、KenLM gate 语义
- `fw-detector/` 主链拓扑（IME 见 [pinyin-v2/ARCHITECTURE.md](../pinyin-v2/ARCHITECTURE.md)）

### 6.1 Alias Ownership Contract V1.0.0（2026-06-24 冻结）

**SSOT：** [ALIAS_OWNERSHIP_CONTRACT_FROZEN_V1_0_0.md](./ALIAS_OWNERSHIP_CONTRACT_FROZEN_V1_0_0.md)

| 层 | 职责 |
|----|------|
| **Alias** (`is_alias=1`) | 实体规范化：简繁 · 中英 · 品牌 · 实体写法 · 缩写 |
| **Pinyin Recall** | 同音字恢复（后选→候选、像蔡→香菜、告诉→高速） |
| **Tone Recall** | 声调恢复（少病→少冰、大悲→大杯） |
| **KenLM** | 句级选择 |

**禁止：** ASR 同音/近音混淆、tone 错字、无 `alias_type` 的裸 `aliases[]`。

**Patch Build Gate：**

```text
scan-patch-granularity → scan-alias-legality → apply → lexicon:gate:v3-runtime
```

```powershell
npm run lexicon:patch-build-gate -- scripts/lexicon/expansion-v1_1/patches/<patch>.json
npm run lexicon:scan-alias-legality:test
```

---

## 7. 职责划分

| 方 | 负责 |
|----|------|
| Ops / Scheduler | 资产、Patch 生成、签名、下发策略（P2+） |
| Node | 校验 Patch → SQLite txn → metadata → reload |
| FW | 只读 runtime；通过 Recall 查词 |

**离线工具（非 Patch 热路径）**：

- `lexicon:build:v2-shadow` → 离线 seed → `v2_shadow`
- `lexicon:import-v3-*`、`lexicon:v3-gate` → V1 `current` 资产
- `lexicon:patch-merge` → 离线 seed 合并

---

## 8. 实现状态（V3.1 冻结）

| 能力 | 状态 |
|------|------|
| v3 runtime + 单 manifest | ✅ |
| lexicon-patch-v3 + validator + applier | ✅ |
| patch_history + manifest 写入 | ✅ |
| reload + test-server HTTP + CLI | ✅ |
| Patch E2E + freeze regression | ✅ |
| Node Agent 生产入口 | ⏳ P1 |
| Scheduler 下发 | ⏳ P2 |
| 签名验签 | ⏳ P3 |

---

## 9. 验证命令

```powershell
cd electron_node\electron-node
npm run build:main
npm run test:lexicon
npm run test:lexicon-patch-e2e
npm run lexicon:gate:v3-runtime
npm run test:fw-detector
```

---

## 10. 下一阶段

| Phase | 内容 |
|-------|------|
| **V3.1** | **Frozen** — 本文 |
| **P1** | Node Agent → `applyLexiconPatchV3` |
| **P2** | Scheduler patch distribution |
| **P3** | 版本追踪 / 验签 |
| **P4** | 生产 rollout |

---

## 11. 模块内文档索引

| 文档 | 位置 |
|------|------|
| 本文件 | `docs/lexicon-v3/ARCHITECTURE.md` |
| 入口 | `docs/lexicon-v3/README.md` |
| Patch 实现 | `main/src/lexicon-patch-v3/README.md` |
| Runtime | `main/src/lexicon-v2/README.md` |
| 脚本 | `scripts/lexicon/README.md` |
| Pinyin IME（Span） | `docs/pinyin-v2/ARCHITECTURE.md` |

---

## 12. 修订记录

| 日期 | 说明 |
|------|------|
| 2026-06-01 | V3.1 SSOT 初版 |
| 2026-06-03 | 合并审计/测试报告入 ARCHITECTURE；删除过期 FW 专项审计文档 |
| 2026-06-24 | Alias Ownership Contract V1.0.0 冻结；`scan-alias-legality` Patch Build Gate |
