# P4 domain_lexicon 全链路只读审计报告

版本：V1.0  
日期：2026-05-31  
**范围：** P4 dialog_200 批测中 `domain_lexicon = 0` 的根因定位（只读，不改代码）  
**批测数据：** `electron_node/electron-node/tests/lexicon-v2-p4-batch-result.json`  
**Bundle 路径：** `D:\Programs\github\lingua_1\node_runtime\lexicon\v2_shadow\lexicon_v2.sqlite`

---

## 1. 执行摘要

| 项 | 结论 |
|----|------|
| **最终定位** | **A — `domain_lexicon` 在 SQLite / Build 层即为空** |
| 是否 B（有数据但 Recall 失败） | **否** — 表无行，不存在「Recall 查不到已有行业词」 |
| 是否 C（Recall 成功但 Merge 丢弃） | **否** — 全批测 `domain_hits` 合计 **0** |
| 是否 D（Merge 成功但 Sentence Builder 丢弃） | **否** — 无 domain 候选可进入组合 |
| 是否 E（Sentence Builder 成功但 KenLM 未选中 domain 句） | **否** — 无 domain 句进入 KenLM |
| P4 唯一 apply（d043） | 来自 **base_lexicon** 候选 + KenLM，与 `domain_lexicon` 无关 |
| Sentence Rerank | **工作正常**（39 job 进入 rerank；38 raw / 1 candidate） |

**一句话：** 行业词在 **Build 灌库之前即未进入 `domain_lexicon`**；Runtime、Recall、Merge、Sentence Builder、KenLM 各层均未「丢弃」行业词，因为 **SQLite 中根本没有行业词行**。

**附加事实（不改变主结论 A）：** P4 批测 profile 为 `primaryDomain=general`，Recall 侧 `domainIds=[]`、`active_domain=base_only`，即使 `domain_lexicon` 有数据，当前配置也不会发起 domain SQL（Industry Routing 关）。但本次 `domain_hits=0` 的直接原因是 **表为空**，而非 profile  alone。

---

## 2. SQLite 实际统计

**批测实际加载路径：**

```
D:\Programs\github\lingua_1\node_runtime\lexicon\v2_shadow\lexicon_v2.sqlite
```

**执行方式：** 只读 Python 脚本直连 SQLite（`tests/readonly-audit-domain-sqlite.py`，2026-05-31 复跑）。

| 表 | 总行数 | is_alias=1 | repair_target=1 | repair_target=0 |
|----|--------|------------|-----------------|-----------------|
| **base_lexicon** | **50,000** | 0 | 50,000 | 0 |
| **domain_lexicon** | **0** | 0 | 0 | 0 |
| idiom_lexicon | 22,192 | 0 | 22,192 | 0 |
| industry_routing_lexicon | 0 | — | — | — |

**alias 行数（全库 `is_alias=1`）：** **0**（canonical 的 `aliases` 字段未 materialize 为独立 alias 行；与 domain 为空无关，属 build 输入/策略事实）。

**证据文件：**

- `node_runtime/lexicon/v2_shadow/lexicon_v2.sqlite`
- `node_runtime/lexicon/v2_shadow/manifest_v2.json` → `"domain_lexicon": { "rowCount": 0 }`

---

## 3. Domain 分布统计

对 `domain_lexicon` 执行 `GROUP BY domain_id`：

| domain_id | count |
|-----------|-------|
| *(无行)* | — |

**结论：** SQLite 中 **不存在** restaurant / travel / it / medical 等任何 `domain_id` 行业词行。

---

## 4. Bundle 来源

### 4.1 Manifest（批测实际 bundle）

| 字段 | 值 |
|------|-----|
| **路径** | `node_runtime/lexicon/v2_shadow/` |
| **schemaVersion** | **`lexicon-v2-shadow-v1`** |
| **createdAt** | `2026-05-30T11:32:47.150Z` |
| **buildTime** | `1780140767150` |
| **backend** | `sqlite` |
| **seed_path** | `electron_node\docs\lexicon-assets\p1_3_generic_zh_lexicon_v2_fw_domains\p1_3_lexicon_zh_v2\combined_entries.jsonl` |
| **domain_lexicon.rowCount** | **0** |
| **rejectStats.common5_deferred** | 897 |

### 4.2 Build 脚本版本（源码，未反映到当前磁盘 bundle）

| 项 | 值 |
|----|-----|
| 脚本 | `electron_node/electron-node/scripts/lexicon/lib/build-v2-shadow-bundle.mjs` |
| 源码常量 | `LEXICON_V2_SHADOW_SCHEMA_VERSION = 'lexicon-v2-shadow-v2'` |
| 磁盘 manifest | **`lexicon-v2-shadow-v1`** |

**结论：** 批测加载的是 **2026-05-30 已构建的 v1 schema shadow bundle**（v2 shadow build 流程产物），**不是**源码中尚未重建的 v2 schema bundle。无论 v1/v2 schema，**当前磁盘 bundle 的 `domain_lexicon` 均为 0 行**。

### 4.3 Seed 层统计（build 输入）

对 `combined_entries.jsonl`（73,089 行）统计：

| lexiconLayer | 行数 |
|--------------|------|
| base | 50,000 |
| idiom | 22,192 |
| common5 | 897（build 拒绝：`common5_deferred`） |
| **domain / domain_patch** | **0** |

| 元数据 | 行数 |
|--------|------|
| `lexiconLayer=base` 且带 `domains[]` | 50,000 |
| `lexiconLayer=domain*` 且带 `domains[]` | **0** |

### 4.4 行业词样例文件未纳入 build 输入

独立 patch 文件（**未**出现在 `combined_entries.jsonl` / manifest seed_path）：

```
electron_node/docs/lexicon-assets/.../domain_patch_zh_v2/entries.jsonl
```

该文件含 9 条 `lexiconLayer=domain_patch`  canonical（中杯、大杯、美式、拿铁等），**build 未消费**。

**分类逻辑（build 时决定 tier）：**

```79:84:electron_node/electron-node/scripts/lexicon/lib/v2-classify-row.mjs
  if (layer === 'base') {
    if (charLen < 2 || charLen > 3) {
      return reject('base_len_invalid', `base layer requires 2-3 chars, got ${charLen}`);
    }
    return accept('base', { pinyinKey, domainIds: [] });
  }
```

```93:101:electron_node/electron-node/scripts/lexicon/lib/v2-classify-row.mjs
  if (layer === 'domain_patch' || layer === 'domain') {
    const domainIds = domainResult.domains.filter((d) => d !== 'general');
    ...
    return accept('domain', { pinyinKey, domainIds });
  }
```

**事实：** seed 中 50,000 行 base 虽带 `domains[]` 元数据，但 **`lexiconLayer=base` 强制进 `base_lexicon`，不会进 `domain_lexicon`**。patch 文件中「美式」「拿铁」「中杯」等 **0 行** 进入 combined seed（仅「美式」「小杯」以 **base** 层重复出现在 combined 中）。

---

## 5. Runtime 加载状态

### 5.1 批测配置

`tests/patch-p4-config.mjs`：

- `bundlePath: 'node_runtime/lexicon/v2_shadow'`
- `useLexiconRuntimeV2Recall: true`

### 5.2 启动行为（代码 + 历史批测一致）

`LexiconRuntimeV2.load()` 打开 SQLite，统计四表行数并打日志：

```195:219:electron_node/electron-node/main/src/lexicon-v2/lexicon-runtime-v2.ts
      const countDomain =
        (this.db.prepare('SELECT COUNT(*) AS c FROM domain_lexicon').get() as { c: number }).c ?? 0;
      ...
      logger.info(
        {
          bundleDir,
          schemaVersion: manifest.schemaVersion,
          tableCounts: this.state.tableCounts,
        },
        '[LEXICON_RUNTIME_V2] loaded'
      );
```

`stmtDomain` **已成功 prepare**（表结构存在，仅无数据）：

```179:184:electron_node/electron-node/main/src/lexicon-v2/lexicon-runtime-v2.ts
      this.stmtDomain = this.db.prepare(
        `SELECT ... FROM domain_lexicon
         WHERE domain_id = ? AND pinyin_key = ? AND enabled = 1 AND length(word) = ?
         ...
```

| 项 | 状态 |
|----|------|
| Runtime status | **ok**（P4 测试报告 / Phase1-2 批测：`base=50000, idiom=22192, domain=0, routing=0`） |
| domain 表打开 | **是** |
| domain 表有数据 | **否（0 行）** |

**结论：** 非 Runtime 加载失败；**domain 表为空是数据/build 问题**。

---

## 6. Recall 追踪

### 6.1 Domain ID 解析（P4 批测）

```16:27:electron_node/electron-node/main/src/lexicon-v2/domain-recall-merge.ts
export function resolveDomainIdsForRecall(profile: ActiveLexiconProfileSnapshot): string[] {
  const primary = profile.primaryDomain?.trim();
  if (!primary || primary === 'general' || !isValidLLMDomain(primary)) {
    return [];
  }
  ...
}
```

```78:86:electron_node/electron-node/main/src/lexicon-v2/profile-registry.ts
export function defaultGeneralProfile(): ActiveLexiconProfileSnapshot {
  return {
    primaryDomain: 'general',
    ...
  };
}
```

P4 批测：`lexicon_v2_intent_enabled=false` → profile 为 general → **`domainIds=[]`** → diagnostics 记 **`active_domain: base_only`**。

### 6.2 Recall SQL 路径

```158:164:electron_node/electron-node/main/src/lexicon-v2/recall-span-topk-v2.ts
  const domainHits: HotwordEntry[] = [];
  ...
  for (const domainId of domainIds) {
    domainHits.push(...runtimeV2.lookupDomainByPinyinKey(domainId, key, termLength, sqlLimit));
  }
```

当 `domainIds=[]` 时，**domain 查询循环 0 次**；即使传入 `restaurant`，空表仍返回 0 行。

### 6.3 样本词 SQL 模拟（同一 SQLite，只读）

| 词 | pinyin_key | base SQL 命中 | domain SQL 命中 |
|----|------------|---------------|-----------------|
| 美食 / 美式 | `mei\|shi` | **4**（美食、没事、美式等） | **0** |
| 拿铁 | `na\|tie` | **0** | **0** |
| 大杯 | `da\|bei` | **1**（大杯） | **0** |
| 钟贝 | `zhong\|bei` | **0** | **0** |
| 讨论 | `tao\|lun` | **1** | **0** |

**说明：**

- 「美式」等同音词在 **base 桶** 存在，**不是** `domain_lexicon` 命中。
- 「拿铁」「钟贝」在 combined seed 中 **无 canonical**；patch 未入库。
- domain SQL **对所有样本均为 0** — 与 **表空** 一致。

### 6.4 P4 批测全量 Recall diagnostics

来源：`lexicon-v2-p4-batch-result.json`（聚合脚本 `tests/readonly-audit-p4-batch-diag.py`）

| 指标 | 值 |
|------|-----|
| span recall 调用次数 | **42** |
| `domain_hits` 最大值 | **0** |
| `domain_hits` 合计 | **0** |
| `domain_hits > 0` 的 span 数 | **0** |
| `active_domain` 分布 | **`base_only`: 42** |
| `candidate_count_before_merge` 均值 | **1.48** |

**结论：** 不存在「SQL 有 domain 行但 Recall 查不到」的情况 — **表本身无行**；批测 additionally 未激活 domain 查询 target。

---

## 7. Merge 追踪

P4 使用 `perSpanLimit`，走 `mergeSpanCandidatesCombined`：

```107:122:electron_node/electron-node/main/src/lexicon-v2/recall-span-topk-v2.ts
  if (perSpanLimit != null && perSpanLimit > 0) {
    const rows: TierHotwordRow[] = [
      ...domainHits.map((h) => hotwordToTierRow(h, 'domain')),
      ...baseHits.map((h) => hotwordToTierRow(h, 'base')),
      ...
    ];
    const hasActiveDomain = (domainIds?.length ?? 0) > 0;
    return mergeSpanCandidatesCombined(rows, perSpanLimit, hasActiveDomain);
  }
```

```24:37:electron_node/electron-node/main/src/lexicon-v2/merge-span-candidates.ts
export function mergeSpanCandidatesCombined(
  rows: TierHotwordRow[],
  limit: number,
  hasActiveDomain: boolean
): TierHotwordRow[] {
  const domainCanonical = rows.filter((r) => r.tier === 'domain' && !r.isAlias);
  ...
  return ordered.slice(0, Math.max(0, limit));
}
```

**批测观测（全量 42 span）：**

| 阶段 | domain | base | merged |
|------|--------|------|--------|
| 输入 tier | **0** | ≥1（有 recall 的 span） | — |
| merge 后 | **0** | 保留 | `candidate_count_before_merge` = `candidate_count_after_merge` |

**d043 样本：**

| 字段 | 值 |
|------|-----|
| base_hits | 1 |
| domain_hits | **0** |
| candidate_count_before_merge | 1 |
| candidate_count_after_merge | 1 |
| active_domain | base_only |

**结论：** **不存在** domain 候选在 Merge 阶段被丢弃 — **Merge 从未收到 domain 行**。

---

## 8. Sentence Builder 追踪

`buildSentenceCandidates()` 对 per-span 候选做笛卡尔积（`fw-sentence-rerank-pipeline.ts` → `build-sentence-candidates.ts`）。

**d043（唯一 FW apply）：**

| 项 | 值 |
|----|-----|
| spanCount | 1 |
| perSpanLimit | 8 |
| combinationCount | **1** |
| recall domain_hits | **0** |
| recall base_hits | **1** |
| pickedIsRaw | **false** |
| maxDelta | **0.0307**（阈值 0.03） |

**来源分布：** 进入组合的 1 条 span 候选来自 **base recall**，**无 domain 来源**。

**全批测：** 无任何 case 的 `domain_hits > 0`，Sentence Builder **不可能**组合出 domain-tier 句。

**结论：** **不是** Sentence Builder 丢弃 domain — **上游无 domain 候选**。

---

## 9. KenLM 追踪

`rerankFwSentences()` 对 `[rawText, ...candidates]` 批打分，选 max delta ≥ `minDeltaToReplace` 的候选句。

**P4 批测 aggregate：**

| 指标 | 值 |
|------|-----|
| sentence_rerank jobs | 39 |
| picked raw | 38 |
| picked candidate | **1**（d043） |
| kenlmQueryCount（d043） | 2（raw + 1 候选） |

**d043 KenLM 行为：**

- 进入 KenLM 的候选句：**1 条**（由 **base** span 候选替换生成）
- **无** domain 来源的 sentence candidate 进入 batch
- winner：**candidate**（非 raw），`maxDelta=0.0307`

**结论：** KenLM **正常工作**；未选中 domain 句是因为 **从未构造 domain 句**，不是 KenLM 偏好问题。

---

## 10. 最终定位

### 10.1 选项对照

| 选项 | 含义 | 判定 | 依据 |
|------|------|------|------|
| **A** | `domain_lexicon` 为空 | **✅ 成立（主因）** | SQLite 0 行；manifest 0 行；seed 无 domain 层；patch 未纳入 build |
| B | 有数据但 Recall 失败 | ❌ | 表空，无「失败」可谈 |
| C | Recall 成功，Merge 丢弃 | ❌ | 全批测 domain_hits=0 |
| D | Merge 成功，Sentence Builder 丢弃 | ❌ | 无 domain 输入 |
| E | Builder 成功，KenLM 未选 domain | ❌ | 无 domain 句进 KenLM |
| F | 多因素共同造成 | ⚠️ 次要叠加 | **表空（A）** + 批测 `base_only` 不查 domain SQL；**不改变根因层级** |

### 10.2 证据链（自顶向下）

```
combined_entries.jsonl
  └─ lexiconLayer=domain* : 0 行
  └─ domain_patch_zh_v2/entries.jsonl : 未纳入 seed
       ↓ build-v2-shadow-bundle + v2-classify-row (base → base_lexicon)
domain_lexicon SQLite : 0 行
       ↓ lexicon-runtime-v2 load (domain table OK, count=0)
recallSpanTopKV2
  └─ domainIds=[] (general profile) OR 即使非空 → lookupDomain → 0 行
       ↓ domain_hits=0 (42/42 spans)
mergeSpanCandidatesCombined : 无 domain 行
       ↓
buildSentenceCandidates : 仅 base/idiom 候选
       ↓
rerankFwSentences : 38 raw + 1 base candidate (d043)
```

### 10.3 与用户选项 A/B/C/D 的映射

用户原始四选一：

| 用户选项 | 本报告判定 |
|----------|------------|
| A. SQLite 根本没有行业词 | **✅ 正确** |
| B. SQLite 有行业词但 Recall 没查到 | ❌ |
| C. Recall 查到但 Candidate Merge 丢弃 | ❌ |
| D. Recall 查到但 Sentence Rerank 没选中 | ❌（且无 domain 进入 rerank） |

---

## 11. Target List

以下为审计中 **已核对的对象**（非开发任务）：

| # | Target | 路径 / 对象 | 审计结果 |
|---|--------|-------------|----------|
| T1 | 批测 SQLite | `node_runtime/lexicon/v2_shadow/lexicon_v2.sqlite` | domain **0 行** |
| T2 | Manifest | `node_runtime/lexicon/v2_shadow/manifest_v2.json` | domain rowCount **0** |
| T3 | Build seed | `combined_entries.jsonl` | 无 domain/domain_patch 层 |
| T4 | Domain patch（未入库） | `domain_patch_zh_v2/entries.jsonl` | 9 行，未进 seed |
| T5 | 分类器 | `v2-classify-row.mjs` | base 层不进 domain 表 |
| T6 | Runtime | `lexicon-runtime-v2.ts` | 加载 ok，domain count=0 |
| T7 | Recall | `recall-span-topk-v2.ts` | domain_hits 全 0 |
| T8 | Merge | `merge-span-candidates.ts` | 无 domain 输入 |
| T9 | Sentence Builder | `build-sentence-candidates.ts` | 无 domain 组合 |
| T10 | KenLM | `rerank-fw-sentences.ts` | 正常；d043 为 base 候选 |
| T11 | P4 批测结果 | `lexicon-v2-p4-batch-result.json` | 200 case；domain_hits 恒 0 |

---

## 12. Check List

| # | 检查项 | 方法 | 结果 |
|---|--------|------|------|
| C1 | 确认批测 lexicon_v2.sqlite 路径 | 读 `patch-p4-config.mjs` + 磁盘存在性 | ✅ `node_runtime/lexicon/v2_shadow` |
| C2 | SQLite 四表行数 + repair_target | 只读 SQL | ✅ domain=0；base=50000 |
| C3 | domain_id 分布 | `GROUP BY domain_id` | ✅ 空 |
| C4 | manifest schema / seed | 读 `manifest_v2.json` | ✅ v1 schema；seed=combined；domain=0 |
| C5 | seed 层 lexiconLayer 统计 | 扫 jsonl | ✅ 无 domain 层 |
| C6 | patch 是否进 combined | 交叉比对 9 patch canonical | ✅ 未纳入（仅 2 词以 base 重复存在） |
| C7 | Runtime domain 表打开 | 读 `lexicon-runtime-v2.ts` + 历史 startup 日志 | ✅ prepare 成功；count=0 |
| C8 | 样本词 base/domain SQL | 只读模拟 | ✅ domain 全 0 |
| C9 | 批测 recall diagnostics 聚合 | 解析 batch JSON | ✅ 42 span；domain_hits=0 |
| C10 | Merge before/after | batch JSON per-span | ✅ 相等；无 domain |
| C11 | d043 sentence rerank | batch JSON case id=d043 | ✅ base 候选 apply |
| C12 | 全批测 domain_hits>0 | 扫 200 cases | ✅ **0 条** |

---

**审计人：** 只读自动化脚本 + 源码/static 交叉验证  
**审计日期：** 2026-05-31  
**声明：** 本报告仅回答「行业词丢在哪一层」；不含代码修改与未来方案。
