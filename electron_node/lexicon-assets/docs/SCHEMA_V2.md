# Lexicon Schema V2（five-table-v2）

**状态：** FINAL FROZEN（2026-06-21）  
**schemaVersion：** `lexicon-v3-five-table-v2`  
**代码根：** `electron_node/electron-node/main/src/lexicon-v2/` · `scripts/lexicon/`

---

## 1. 架构概览

采用 **Term-Centric** 方案，Runtime V2 直查 `term` + `term_domain_tags`。

| 层 | 说明 |
|----|------|
| SSOT | `term` / `term_domain_tags` |
| 物化层 | `domain_lexicon`（Build 产物，非 Runtime SSOT） |
| Manifest | `schemaVersion` gate，fail-fast |

同步常量位置（禁止单点修改）：

- `lexicon-types-v2.ts`  
- `lexicon-v3-runtime.mjs`  
- `run-gate-v3-runtime.mjs`

---

## 2. 核心表结构

### term

| 列 | 说明 |
|----|------|
| `id` | PK（DDL 列名；逻辑 term_id） |
| `word` | 词面 |
| `pinyin_key` | 无声调拼音键 |
| `tone_pinyin_key` | 带声调拼音键 |
| `prior_score` | homophone prior |
| `repair_target` | 0/1 |
| `enabled` | 0/1 |
| `tier` | 如 `domain` / `base` |

### term_domain_tags

| 列 | 说明 |
|----|------|
| `term_id` | FK → term |
| `domain_id` | 细域 ID |
| `domain_weight` | 域权重（Vote / routing 来源，**非** prior_score） |

索引：`(domain_id, pinyin_key)`、`(term_id)`、`(word, pinyin_key)`

### domain_hierarchy（DSU · build 物化 · runtime 只读）

| 列 | 说明 |
|----|------|
| `parent_domain_id` | 粗域 ID |
| `child_domain_id` | 细域 ID |

```sql
CREATE TABLE domain_hierarchy (
    parent_domain_id TEXT NOT NULL,
    child_domain_id  TEXT NOT NULL,
    PRIMARY KEY (parent_domain_id, child_domain_id)
);
CREATE INDEX idx_domain_hierarchy_child ON domain_hierarchy(child_domain_id);
```

- **编辑面：** `profile-registry.json` parent 字段 → **仅 build** 写入 sqlite
- **Runtime：** 只读；缺失或空 → fail-fast（REG-05 配套）
- **Patch：** **不修改** 本表（BG-06）
- **Gate：** `manifest.tables.domain_hierarchy >= 8`（BG-01，边数 = 当前 registry parent-child 数）

---

## 3. Build 输入（方案 A）

整包输入 `p1_3_lexicon_zh_v2`，包含：

- base（gate 要求 `>= 47500`）  
- idiom（gate 要求 `>= 21000`）  
- common5  
- multidomain seed（107 条）

**不得**单独 build multidomain patch。`manifest.seedInputs` 须记录全部输入包。

生产 seed 路径：

```text
electron_node/docs/lexicon-assets/p1_3_generic_zh_lexicon_v2_fw_domains/
  p1_3_lexicon_zh_v2/domain_patch_multidomain_v1/entries.jsonl
```

---

## 4. Multidomain Seed 格式

```json
{
  "word": "中杯",
  "pinyin": "zhong bei",
  "tone_pinyin": "zhong1 bei1",
  "domain_tags": ["coffee", "milk_tea", "food_order"],
  "domain_weights": {
    "coffee": 1.0,
    "milk_tea": 1.0,
    "food_order": 0.8
  },
  "source": "domain_seed_v1",
  "repair_target": true
}
```

| 字段 | 说明 |
|------|------|
| `word` | 主词面 |
| `pinyin` / `tone_pinyin` | 拼音键 |
| `domain_tags` | 细域列表 |
| `domain_weights` | 每域权重（须与 Vote routing weight 一致） |
| `repair_target` | 是否可作为 FW 替换目标 |

覆盖细域：`coffee`, `milk_tea`, `bakery`, `food_order`, `tourism_pickup`, `tourism_hotel`, `tourism_route`, `tourism_transport`

---

## 5. 导入 Phase（禁止跳阶段）

```text
Phase 1 — DDL / Manifest / Threshold
  ↓
Phase 2 — Importer
  ↓
Phase 3 — Patch（可与 Phase 2 并行）
  ↓
Phase 4 — Runtime
  ↓
Phase 5 — Diagnostics
  ↓
Phase 6 — 专项 12 句验收
  ↓
Phase 7 — Dialog200
```

Phase 1 前须 snapshot `node_runtime/lexicon/v3/`。

---

## 6. 关键合约

### routing weight

来源：`term_domain_tags.domain_weight`（`mergeDomainTierRowsV2` 禁止用 `prior_score` 覆盖）

### homophone prior

`source` 含 `homophone_variant` → `prior=0.35`；否则 `prior=0.85`

### parent ngram 多 tag

采用 **NGram Fan-Out**：每个 tag 生成独立 ngram 行

### Patch

- Add：`domain_tags[]`  
- Delete：按 `term_id`  
- Alias：继承全部 tags

### Manifest Gate

须同时支持 v1 / v2 bundle 部署顺序（v1 → v2 不中断）

### Manifest 域字段（DSU · Frozen 2026-06-23）

| 字段 | 说明 |
|------|------|
| `tables.domain_hierarchy` | hierarchy 行数；gate threshold **8**（BG-01） |
| `domainAvailability` | `{ [domain_id]: tag_count }` · 与 sqlite `term_domain_tags` GROUP BY 一致（BG-02/03） |
| `domainHierarchyVersion` | hierarchy 版本指纹；优先 manifest；供 REG-04 / diagnostics |

`stats.json` 须镜像 `domainAvailability`（gate BG-02）。域运行时合约见 [docs/fw-detector/DOMAIN_SOURCE_UNIFICATION.md](../../../docs/fw-detector/DOMAIN_SOURCE_UNIFICATION.md)。

---

## 7. 常用命令

```powershell
cd electron_node\electron-node

# V2 shadow build（FW 默认 recall）
npm run lexicon:build:v2-shadow

# Gate 校验
npm run lexicon:v3-gate

# Rebuild SQLite（npm start 前）
npm run lexicon:rebuild-sqlite

# 冻结合约
npx jest --testPathPattern="ddl-schema-v2|bundle-schema-v2|freeze-contract"
```

---

## 8. 验收基线

- Seed 107 条导入成功  
- `term >= 107`，`term_domain_tags >= 200`  
- manifest `schemaVersion = lexicon-v3-five-table-v2`  
- gate pass · orchestrator 加载 v2 成功  
- DSU Runtime Diagnostics 七字段齐全（见 [`docs/fw-detector/diagnostics/FROZEN.md`](../../../../docs/fw-detector/diagnostics/FROZEN.md)）  
- `domain_hierarchy` gate ≥ 8 · `domainAvailability` 对齐 sqlite  
- `hardDropCount = 0` · freeze-contract pass

---

## 9. 回滚

恢复 Phase 1 前 snapshot → 恢复 v1 manifest → 恢复 v1 sqlite

---

## 关联

| 文档 | 路径 |
|------|------|
| Domain Recall 合约 | `docs/fw-detector/recall/DOMAIN_RECALL.md` |
| Lexicon 资产 README | [`README.md`](./README.md) |
| FW Lexicon 运维 | `docs/lexicon-v3/LEXICON_OPERATIONS.md` |
