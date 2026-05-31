# P4 domain_patch Build 链路只读审计报告

版本：V1.0  
日期：2026-05-31  
**范围：** 为何 `domain_patch_zh_v2` 未进入 `lexicon_v2.sqlite`，导致 `domain_lexicon = 0`  
**约束：** 只读；不涉及 Recall / Sentence Rerank / KenLM / Runtime 加载

---

## 1. 执行摘要

| 项 | 结论 |
|----|------|
| **最终定位** | **B — domain patch 文件存在，但 v2 shadow build 未将其纳入输入** |
| domain patch 是否存在 | **是** — `domain_patch_zh_v2/entries.jsonl` **9 行** |
| build 实际读取 | **`combined_entries.jsonl` 单文件**（73,089 行，**0 行** `domain_patch`） |
| combined 是否含 patch | **否** — 资产生成阶段即排除（`includedInGenericCombined: false`） |
| Parse 是否过滤 domain 行 | **本次 build 无 domain_patch 行输入**，不存在 parse 层丢弃 |
| SQLite 是否写入失败 | **否** — `insertDomain` 路径正常，但 `domainRows.length = 0` |
| 当前 `domain_lexicon` | **0 行** |

**一句话：** 行业词在 **Build 输入边界** 丢失 — shadow build 使用的 seed **从未包含** `domain_patch_zh_v2`；build 脚本 **不会** 自动合并 patch 目录，也 **未** 使用已存在的 `combined_with_domain_patch_entries.jsonl`。

**选项对照：**

| 选项 | 判定 |
|------|------|
| A. patch 文件不存在 | ❌ |
| **B. 存在但 build 没读取** | **✅ 主因** |
| C. build 读取 combined 丢失 | ⚠️ 机制细节：丢失发生在 **combined 资产生成**，非 build 运行时 merge；与 B 为同一因果链 |
| D. combined 存在 SQLite 写入失败 | ❌ |
| E. SQLite 成功 runtime 加载失败 | ❌（超出本次 Build 链路范围） |
| F. 多问题共同导致 | ❌ 单一根因：输入 seed 未含 patch |

---

## 2. Domain Patch Source

### 2.1 仓库内 domain patch seed 清单

| 路径 | 文件 | 行数 | 说明 |
|------|------|------|------|
| `electron_node/docs/lexicon-assets/p1_3_generic_zh_lexicon_v2_fw_domains/p1_3_lexicon_zh_v2/domain_patch_zh_v2/` | `entries.jsonl` | **9** | 主 patch seed |
| 同上 | `rejected.jsonl` | **0** | 空 |
| 同上 | `manifest.json` | — | `includedInGenericCombined: false` |
| 同上 | `stats.json` | — | 9 词条列表 |

**未发现** 其他 `domain_patch*` 目录或第二份 patch seed（全仓 glob 仅上述 1 套）。

### 2.2 Patch manifest 声明

```json
{
  "version": "domain_patch_zh_v2",
  "layer": "domain_patch",
  "entryCount": 9,
  "includedInGenericCombined": false,
  "domains": ["restaurant"]
}
```

路径：`domain_patch_zh_v2/manifest.json`

### 2.3 示例词条（9 条 canonical，均为 `domains: ["restaurant"]`）

| word | lexiconLayer | domains | repairTarget | aliases（节选） |
|------|--------------|---------|--------------|-----------------|
| 中杯 | domain_patch | restaurant | true | 钟贝、忠贝、终杯 |
| 大杯 | domain_patch | restaurant | true | 大悲、达杯 |
| 小杯 | domain_patch | restaurant | true | 小碑、小悲 |
| 美式 | domain_patch | restaurant | true | 美是、没事 |
| 拿铁 | domain_patch | restaurant | true | 拿帖、那铁 |
| 摩卡 | domain_patch | restaurant | true | 磨卡 |
| 马芬 | domain_patch | restaurant | true | 麻烦 |
| 蓝莓 | domain_patch | restaurant | true | 兰梅 |
| 蓝莓马芬 | domain_patch | restaurant | true | 蓝莓麻烦、兰梅马芬 |

**说明：** 全部为 **restaurant** 域咖啡/餐饮同音 patch；**无** travel / it / medical 独立 patch 文件（generic combined 上的 `domains[]` 仅为 FW 兼容标签，见 §4）。

---

## 3. Build 输入

### 3.1 入口 CLI

| 项 | 值 |
|----|-----|
| 命令 | `npm run lexicon:build:v2-shadow` |
| 入口 | `electron_node/electron-node/scripts/lexicon/build-lexicon-v2-shadow.mjs` |
| 核心 | `lib/build-v2-shadow-bundle.mjs` → `classifySeedRowsToV2Tables()` → `writeSqliteBundle()` |

### 3.2 实际读取逻辑

```27:48:electron_node/electron-node/scripts/lexicon/build-lexicon-v2-shadow.mjs
const input = args.input ?? defaultSeedPath();
...
inputFiles = resolveInputFiles(input);
...
const { rows } = loadJsonlInputs(inputFiles);
```

```35:52:electron_node/electron-node/scripts/lexicon/lib/paths.mjs
export function resolveInputFiles(inputArg) {
  ...
  if (stat.isFile()) {
    return [resolved];          // 单文件 → 只读该文件
  }
  const files = fs
    .readdirSync(resolved)
    .filter((name) => name.endsWith('.jsonl'))   // 目录 → 仅 *.jsonl
    ...
}
```

| 机制 | 行为 |
|------|------|
| **默认 input** | `defaultSeedPath()` → `data/lexicon/10k/...`（与 P1.3 无关） |
| **P1.3 实际 build** | 显式 `--input combined_entries.jsonl`（见 manifest `seed_path`） |
| **glob / 白名单** | **无** domain_patch 自动发现；**无** multi-path merge |
| **目录模式** | 若传目录，仅合并该目录下 `.jsonl`；**不会** 跨目录拉取 `domain_patch_zh_v2/` |

### 3.3 本次磁盘 bundle 的 build 输入（manifest 证据）

| 字段 | 值 |
|------|-----|
| `seed_path` | `electron_node\docs\lexicon-assets\...\p1_3_lexicon_zh_v2\combined_entries.jsonl` |
| **是否含 domain_patch_zh_v2** | **否** |

### 3.4 文档与 README 明示

`p1_3_lexicon_zh_v2/README.md`：

> `domain_patch_zh_v2/entries.jsonl` is separate and is **not** included in `combined_entries.jsonl`.  
> Use `combined_with_domain_patch_entries.jsonl` only when you want to include the optional cafe/restaurant homophone patch.

`Lexicon_Runtime_V2_Phase0_开发说明_2026_05_30.md` §5：

> 说明：`combined_entries` 不含 `domain_patch`；domain/routing 需单独 merge patch 后再 build。

**结论：** build **只读了 generic combined**；**未读** `domain_patch_zh_v2/entries.jsonl`，也 **未读** `combined_with_domain_patch_entries.jsonl`。

---

## 4. Combined Entries

### 4.1 `combined_entries.jsonl`（build 实际输入）

| 指标 | 值 |
|------|-----|
| 路径 | `.../p1_3_lexicon_zh_v2/combined_entries.jsonl` |
| **总行数** | **73,089** |
| `type=canonical_term` | **73,089** |
| `type=alias` / 非 canonical | **0** |
| `lexiconLayer=domain_patch` | **0** |
| `lexiconLayer=domain` | **0** |
| `domains != general` | **73,089**（均为 `["travel","transport","restaurant","tech_ai"]` 兼容标签） |

**lexiconLayer 分布：**

| layer | count |
|-------|-------|
| base | 50,000 |
| idiom | 22,192 |
| common5 | 897 |

### 4.2 前 5 条样例（combined_entries）

| word | lexiconLayer | domains | repairTarget |
|------|--------------|---------|--------------|
| 的 | base | travel, transport, restaurant, tech_ai | true |
| 了 | base | travel, transport, restaurant, tech_ai | true |
| 自己 | base | travel, transport, restaurant, tech_ai | true |
| 没有 | base | travel, transport, restaurant, tech_ai | true |
| 什么 | base | travel, transport, restaurant, tech_ai | true |

### 4.3 patch 是否在 combined 中

| 检查项 | 结果 |
|--------|------|
| 9 条 patch canonical 以 `lexiconLayer=domain_patch` 出现在 combined | **0 / 9** |
| patch 词以 **任意 layer** 出现在 combined | **2 / 9**（「美式」「小杯」以 **base** 层存在于 generic base，与 patch 无关） |
| 「拿铁」「中杯」「钟贝」等 patch 专词在 combined | **不存在** |

### 4.4 对照：`combined_with_domain_patch_entries.jsonl`（未用于本次 build）

| 指标 | 值 |
|------|-----|
| 总行数 | **73,098**（= 73,089 + **9** patch） |
| `domain_patch` 行 | **9** |
| 是否 manifest seed_path | **否** |

`combined_with_domain_patch_stats.json`：`layerDistribution.domain_patch = 9`

**结论：** domain patch **不在** build 所用的 combined 中；仓库内虽有 **含 patch 的 alternate combined**，但 **未被 v2 shadow build 选用**。

---

## 5. Parse 流程

### 5.1 `parse-rows.mjs` — 字段保留

```18:40:electron_node/electron-node/scripts/lexicon/lib/parse-rows.mjs
export function parseCanonicalRow(row) {
  ...
  domains: row.domains,
  domain: row.domain,
  ...
  repairTarget: row.repairTarget ?? row.repair_target,
  enabled: coerceEnabled(row.enabled),
  ...
  aliases: Array.isArray(row.aliases) ? row.aliases : [],
```

| 字段 | 是否保留 |
|------|----------|
| `domains` | ✅ |
| `repairTarget` | ✅ |
| `enabled` | ✅ |
| `lexiconLayer` | ✅（保留在 `entry.row`，供 classify 使用） |

**无** parse 阶段按 domain 丢弃行的逻辑。

### 5.2 分类器 — 决定 tier（非 parse 过滤）

```79:84:electron_node/electron-node/scripts/lexicon/lib/v2-classify-row.mjs
  if (layer === 'base') {
    ...
    return accept('base', { pinyinKey, domainIds: [] });  // 强制 base 表，忽略 domains 元数据
  }
```

```93:101:electron_node/electron-node/scripts/lexicon/lib/v2-classify-row.mjs
  if (layer === 'domain_patch' || layer === 'domain') {
    const domainIds = domainResult.domains.filter((d) => d !== 'general');
    ...
    return accept('domain', { pinyinKey, domainIds });    // → domain_lexicon
  }
```

**本次 build 事实：**

- 输入 73,089 行中 **0 行** `lexiconLayer=domain_patch` → classify **从未产出** `tier=domain`
- 50,000 行 base 虽带 `domains[]`，因 `layer=base` → **全部** 进 `base_lexicon`，**不会** 进 `domain_lexicon`
- `rejectStats` 中 `domain_missing_id=0`、`domain_len_invalid=0` → **无** domain 行被拒

### 5.3 `materializeAliasRows`（v2-materialize-aliases.mjs）

- 仅当 canonical 已进入某 tier 后，才物化 alias 行（`is_alias=1`）
- 本次 `domainRows` 为空 → **无** domain alias 物化
- 与 patch 未入库 **无因果关系**（根因在输入无 patch 行）

**结论：** Parse / classify **未** 过滤掉 domain patch；**patch 行从未进入 parse 管道**。

---

## 6. SQLite Materialize

### 6.1 表创建（SCHEMA_SQL）

路径：`build-v2-shadow-bundle.mjs` L63–78

```sql
CREATE TABLE domain_lexicon (
  id TEXT NOT NULL,
  domain_id TEXT NOT NULL,
  pinyin_key TEXT NOT NULL,
  ...
  PRIMARY KEY (domain_id, word)
);
```

### 6.2 INSERT 路径

```218:237:electron_node/electron-node/scripts/lexicon/lib/build-v2-shadow-bundle.mjs
  const insertDomain = db.prepare(`
    INSERT INTO domain_lexicon
      (id, domain_id, pinyin_key, tone_pinyin_key, word, ...)
    VALUES (@id, @domain_id, @pinyin_key, ...)
  `);
  ...
    for (const row of domainRows) {
      insertDomain.run(row);
    }
```

| 阶段 | 数据来源 |
|------|----------|
| SELECT（分类） | `classifySeedRowsToV2Tables()` → `classification.tier === 'domain'` |
| INSERT | `domainRows` 数组逐行写入 |
| industry_routing | 由 domain canonical 自动生成（本次 routing **0** 行，因 domain **0** 行） |

**结论：** Materialize 代码路径 **完整**；`domainRows.length === 0` → 循环 **0 次**，非 INSERT 失败。

---

## 7. SQLite 实际统计

**路径：** `D:\Programs\github\lingua_1\node_runtime\lexicon\v2_shadow\lexicon_v2.sqlite`

| 表 | count | is_alias=1 |
|----|-------|------------|
| **base_lexicon** | **50,000** | 0 |
| **domain_lexicon** | **0** | 0 |
| idiom_lexicon | 22,192 | 0 |
| industry_routing_lexicon | 0 | — |

**domain_lexicon 前 20 行抽样：** **[]（空）**

与 manifest / stats 一致：

- `manifest_v2.json` → `domain_lexicon.rowCount: 0`
- `stats_v2.json` → `domain_lexicon.canonicalCount: 0`, `byDomain: {}`

---

## 8. Build 日志

### 8.1 脚本标准输出格式

```67:69:electron_node/electron-node/scripts/lexicon/build-lexicon-v2-shadow.mjs
console.log(
  `[lexicon:build:v2-shadow] base=... idiom=... domain=${result.domainRows.length} routing=... rejected=...`
);
```

### 8.2 本次 build 记录（Phase0 开发说明 + stats 时间戳）

| 日志 / 产物 | 值 |
|-------------|-----|
| build 时间 | `2026-05-30T11:32:47`（stats_v2 / manifest） |
| 预期 console | **`domain=0`** |
| rejected | **897**（全部为 `common5_deferred`） |
| `domain_missing_id` | 0 |
| `domain_len_invalid` | 0 |

### 8.3 未出现的日志字符串

在 `scripts/lexicon/` 内 **无** 以下字面量或分支：

- `domain patch ignored`
- `unsupported layer`
- `unknown type`
- `domain rows = 0`（仅通过 `domain=${result.domainRows.length}` 数值体现）

**结论：** build **正常完成**；domain=0 是 **输入分类结果**，非 error 路径。

---

## 9. Schema 审计

### 9.1 `manifest_v2.json`

| 字段 | 值 |
|------|-----|
| schemaVersion | `lexicon-v2-shadow-v1`（磁盘 bundle；源码常量为 v2） |
| seed_path | `combined_entries.jsonl` |
| tables.domain_lexicon.rowCount | **0** |
| tables.domain_lexicon.byDomain | **{}** |
| rejectStats | 含 `domain_missing_id`、`domain_len_invalid`（均为 0） |

### 9.2 `stats_v2.json`

| 字段 | 值 |
|------|-----|
| tables.domain_lexicon.rowCount | **0** |
| tables.domain_lexicon.canonicalCount | **0** |
| tables.domain_lexicon.aliasCount | **0** |
| tables.domain_lexicon.byDomain | **{}** |
| domain coverage 专用字段 | **无**（以 `byDomain` + `rowCount` 表达） |

**结论：** manifest/stats **准确反映** domain 空表；无隐藏 domain 行。

---

## 10. 最终定位

### 10.1 因果链（仅 Build）

```
domain_patch_zh_v2/entries.jsonl (9 rows, 存在)
        │
        │  includedInGenericCombined: false
        │  README / validation_summary 明示分离
        ▼
combined_entries.jsonl (73089 rows, 0× domain_patch)  ◄── build --input 指向此文件
        │
        │  resolveInputFiles: 单文件，无 patch 目录
        │  loadJsonlInputs → 73089 rows
        ▼
v2-classify-row: 0 rows tier=domain
        │
        ▼
domainRows = []  →  insertDomain ×0
        │
        ▼
domain_lexicon = 0
```

### 10.2 选项 **B** 的代码与数据证据

| 证据类型 | 内容 |
|----------|------|
| **文件存在** | `domain_patch_zh_v2/entries.jsonl` 9 行；`rejected.jsonl` 0 行 |
| **build 输入** | manifest `seed_path` = `combined_entries.jsonl` only |
| **输入统计** | combined 中 `domain_patch` = **0** |
| **未使用 alternate** | `combined_with_domain_patch_entries.jsonl` 含 9 patch，**不在** seed_path |
| **build 脚本** | 无 patch merge；`resolveInputFiles` 不跨目录 |
| **SQLite** | INSERT 逻辑存在，执行 0 次 |
| **rejectStats** | 无 domain 相关拒绝 |

### 10.3 若 patch 进入 build 会怎样（反事实，仅证代码路径）

`lexiconLayer=domain_patch` → `classifyLexiconV2Row` → `tier=domain` → `pushTierRows(domainRows, ...)` → `insertDomain.run(row)`。

**本次未发生**，因 **输入未含 patch**，非 classify/SQLite 缺陷。

---

## 11. Target List

| # | Target | 路径 | 审计结果 |
|---|--------|------|----------|
| T1 | Patch seed | `domain_patch_zh_v2/entries.jsonl` | **9 行，存在** |
| T2 | Patch manifest | `domain_patch_zh_v2/manifest.json` | `includedInGenericCombined: false` |
| T3 | Generic combined | `combined_entries.jsonl` | **0** domain_patch |
| T4 | Combined+patch | `combined_with_domain_patch_entries.jsonl` | **9** domain_patch，**未作 build 输入** |
| T5 | Build CLI | `build-lexicon-v2-shadow.mjs` | 单 `--input`，无 patch 自动合并 |
| T6 | Input resolver | `paths.mjs` `resolveInputFiles` | 单文件 / 单目录 jsonl |
| T7 | Parse | `parse-rows.mjs` | 字段保留，无 domain 过滤 |
| T8 | Classify | `v2-classify-row.mjs` | domain_patch→domain tier（未触发） |
| T9 | Materialize | `build-v2-shadow-bundle.mjs` | INSERT domain 路径存在，0 行执行 |
| T10 | Alias 物化 | `v2-materialize-aliases.mjs` | domain alias 依赖 domainRows（空） |
| T11 | Stats | `v2-shadow-stats.mjs` | domain rowCount=0 统计正确 |
| T12 | 磁盘 SQLite | `node_runtime/lexicon/v2_shadow/lexicon_v2.sqlite` | domain_lexicon **0** |
| T13 | Build 产物 | `manifest_v2.json` / `stats_v2.json` | seed=combined；domain=0 |

---

## 12. Check List

| # | 检查项 | 方法 | 结果 |
|---|--------|------|------|
| C1 | 仓库内 patch seed 数量 | glob `domain_patch*` | ✅ 1 套，9 行 |
| C2 | patch 是否声明 excluded from combined | 读 manifest + README | ✅ `includedInGenericCombined: false` |
| C3 | build 实际 seed_path | 读 manifest_v2.json | ✅ `combined_entries.jsonl` |
| C4 | combined 中 domain_patch 行数 | 扫 jsonl | ✅ **0** |
| C5 | combined_with_patch 行数 | 扫 jsonl + stats | ✅ **9** patch，未用于 build |
| C6 | build 是否读 patch 目录 | 读 paths + build entry | ✅ **否** |
| C7 | parse 是否丢弃 domain 字段 | 读 parse-rows.mjs | ✅ 保留 |
| C8 | classify 是否拒 domain_patch | rejectStats | ✅ 无 domain 拒绝 |
| C9 | SQLite domain INSERT 是否执行 | domainRows=0 + stats | ✅ 0 次 |
| C10 | domain_lexicon 行数 | 只读 SQL | ✅ **0** |
| C11 | build 日志 domain 计数 | Phase0 说明 + console 格式 | ✅ **domain=0** |
| C12 | stats/manifest domain 字段 | 读 JSON | ✅ rowCount=0, byDomain={} |

---

**审计日期：** 2026-05-31  
**辅助脚本（只读）：** `electron_node/electron-node/tests/readonly-audit-domain-patch-build.py`  
**声明：** 本报告仅回答「为什么 domain_patch 没有进入 domain_lexicon」；不含代码修改与未来方案。
