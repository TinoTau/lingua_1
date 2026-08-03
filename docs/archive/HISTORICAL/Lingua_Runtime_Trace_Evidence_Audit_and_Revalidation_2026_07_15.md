<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: CURRENT SSOT + Acceptance Records
Archive Path: docs/archive/HISTORICAL/Lingua_Runtime_Trace_Evidence_Audit_and_Revalidation_2026_07_15.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: CURRENT SSOT + Acceptance Records

# Lingua Runtime Trace Evidence Audit & Conditional Re-validation

**Date:** 2026-07-15  
**Type:** Read-only Audit · Consumer Trace Evidence · Conditional Re-export  
**Status:** Complete  
**Verdict:** **B — Existing Trace Partially Sufficient**

**Evidence JSON:** `tmp/asr_e2e_quality_validation/asr_e2e_freeze_trace_full_20260715/runtime_trace_evidence_audit.json`  
**Supplemental Export:** `tmp/runtime_trace_evidence_export_20260715/`（d001 · d048）  
**Analyzers:**  
- `electron_node/electron-node/tests/experiments/analyze-runtime-trace-evidence-audit.py`  
- `electron_node/electron-node/tests/experiments/export-runtime-trace-evidence-offline.mjs`（Consumer 离线导出，非 Runtime 变更）

**Binding:** [Lingua_Runtime_Evolution_Rule.md](./Lingua_Runtime_Evolution_Rule.md) · [ARCHITECTURE.md](../fw-detector/ARCHITECTURE.md) · [diagnostics/FROZEN.md](../fw-detector/diagnostics/FROZEN.md)

---

## Final Verdict

# **B — Existing Trace Partially Sufficient**

```text
补导出 Trace（Consumer 离线）→ 完成重新分析
未重跑 dialog_200 全量（200/200 E2E 已具备 Stage 5–6；缺口在 Consumer 未持久化数组）
```

| 项 | 结论 |
|----|------|
| 是否重新导出 Trace | **是** — 补导出 **2 case**（d001 · d048）至 `tmp/`（离线，非永久 Contract） |
| 是否重跑 dialog_200 全量 | **否** — 条件不满足「Runtime 未生成」；全量 E2E 已存在 |
| Runtime 是否生成完整 Trace | **是** — 源码 + 补导出实证 |
| 语料级 Stages 1–4 数组 | **Consumer_未提取**（E2E extract 丢弃） |
| Primary Bottleneck | **Sentence Generation Failure**（语料级）+ 单 case 深链显示 **Recall/Pool 未含目标词** |
| KenLM Corpus Audit | **不得进入** |

---

## 一、执行原则合规

| 禁止项 | 本轮 |
|--------|:----:|
| 修改 FW / Tone / Recall / Assembly / KenLM | ✅ 未改 |
| 修改 Runtime / Diagnostics | ✅ 未改 |
| 新增 Metrics / Mapping 语义 | ✅ 未改 |
| 新增永久持久化 / Runtime Contract | ✅ 仅 `tmp/` 离线导出 |
| 修改冻结 E2E extractor | ✅ 未改（另建离线导出脚本） |

---

## 二、第一阶段：已有 Trace 资产盘点

| 资产 | 路径 | Cases | 可用于分析？ |
|------|------|------:|:------------:|
| Full trace E2E | `tmp/.../asr_e2e_freeze_trace_full_20260715/` | **200/200** | Stage 5–6 ✅ · Stage 1–4 数组 ❌ |
| Fine-domain Acceptance | `.../fine_domain_recall_assembly_acceptance.json` | 84 targets | Overlay 漏斗（Stage 5–9） |
| Local partial trace | `tests/trace-d001.json` · `trace-d048.json` | 2 | Stage 2 部分 ✅ · pool/coarse ❌ |
| Batch v4 | `tests/span-assembly-v4-dialog200-batch-result.json` | 116 | summary + `utteranceDomain` only |
| Batch diag v102 | `tests/diagnostics-trace-v102-dialog200-batch-result.json` | 81 | summary + `utteranceDomain` only |
| **Supplemental export（本轮）** | `tmp/runtime_trace_evidence_export_20260715/` | **2** | **全链 Stage 1–6 数组 ✅** |

**检索关键词命中：**

| 关键词 | 已有？ | 位置 |
|--------|:------:|------|
| `trace-*.json` | ✅ | `tests/trace-d001.json` · `trace-d048.json` · `tmp/.../trace-d001.json` |
| `diagnosticsLevel=trace` | ✅ | E2E frozen config + export config |
| `allCombinations` | ✅ | E2E 200/200 |
| `recallHits[]` | ⚠️ | Runtime 生成；E2E **无**；local trace **有**；补导出 **有** |
| `poolBeforeDrop/AfterDrop` | ⚠️ | 仅补导出 **有** |
| `utteranceDomain` | ⚠️ | 旧 batch **有**；E2E **误映射为 null**；补导出 **有** |

---

## 三、Trace 覆盖范围（按 Stage）

### Stage 1 — Span

| 字段 | Runtime 生成？ | 语料 E2E | 补导出 d001 |
|------|:-------------:|:--------:|:-----------:|
| `coarseSpans[]` | ✅ | ❌ Consumer | ✅ 5 spans |
| `boundaryWindows[]` | ✅ | ❌ | ✅ |
| span boundary / text | ✅ | 仅 `spanCount` | ✅ `rawStart/rawEnd/text` |

### Stage 2 — Recall

| 字段 | Runtime 生成？ | 语料 E2E | 补导出 d001 |
|------|:-------------:|:--------:|:-----------:|
| `recallHits[]` | ✅ | ❌ 仅 `recallHitsCount` | ✅ 23 hits |
| `hitKind` · `toneLookupStage` · `repairTarget` | ✅ | ❌ | ✅ |
| `recallHitsPreFilter[]` | ✅ | ❌ | ✅ |

### Stage 3 — Domain Vote

| 字段 | Runtime 生成？ | 语料 E2E | 补导出 d001 |
|------|:-------------:|:--------:|:-----------:|
| `utteranceDomain` | ✅ | ❌ 误读 `coarseDomain` | ✅ `general` |
| `domainScores` · `winningFineDomain` | ✅ | ❌ | ✅ 可扩展 |
| per-candidate `retained/removed` | ❌ **未设计** | ❌ | ❌ |

### Stage 4 — Per-span Selection

| 字段 | Runtime 生成？ | 语料 E2E | 补导出 d001 |
|------|:-------------:|:--------:|:-----------:|
| `poolBeforeDrop[]` | ✅ | ❌ | ✅ |
| `poolAfterDrop[]` | ✅ | ❌ | ✅ 23 candidates |
| `dropReason` · `selection_bucket` | ✅（pool trace） | ❌ | ✅ `droppedReason` |
| `candidateLifecycle[]` | ✅ | ❌ | ✅ |

### Stage 5 — Sentence Generation

| 字段 | Runtime 生成？ | 语料 E2E | 补导出 d001 |
|------|:-------------:|:--------:|:-----------:|
| `allCombinations` | ✅ | ✅ **200/200** | ✅ 12 |
| `sentenceCandidates[]` | ✅ | ❌ | ✅ |
| `combinationScore` / `delta` | ✅ | ✅ deltas | ✅ |

### Stage 6 — KenLM

| 字段 | Runtime 生成？ | 语料 E2E | 补导出 d001 |
|------|:-------------:|:--------:|:-----------:|
| `pickedIsRaw` · `maxDelta` · `minDeltaToReplace` | ✅ | ✅ | ✅ |
| `picked` · `apply` (`appliedCount`) | ✅ | ✅ | ✅ |

---

## 四、Unavailable 根因（逐项，禁止笼统 Unavailable）

| 字段 / 症状 | 根因分类 | 证据 |
|-------------|----------|------|
| E2E `recallHits[]` 缺失 | **Consumer_未提取** | `extractMetrics` 计算数组后只写 `recallHitsCount` |
| E2E `poolBeforeDrop/AfterDrop` 缺失 | **Consumer_未提取** | 同上；未拷贝 `assembly.trace` 字段 |
| E2E `coarseSpans[]` 缺失 | **Consumer_未提取** | `fw-detector-v4-path.ts` spread `...(assembly.trace)` 但 E2E 未持久化 |
| E2E `utteranceDomain` 显示 null | **Consumer_未提取** | 误映射 `sa.domainVote?.coarseDomain`；Runtime 字段为 `sa.utteranceDomain` |
| `trace-d001/d048` 无 pool/coarse | **Consumer_未提取** | 历史局部导出脚本未拷贝全量 trace 块 |
| per-candidate Domain `retained/removed` | **Runtime_未生成** | `SpanAssemblyV4TraceDiagnostics` 无该字段；仅有 `utteranceDomain` + pool |
| Acceptance Stage 1–4 Unavailable | **Analyzer_未使用** + **Consumer_未提取** | 分析器读 E2E 摘要；非 Runtime 失败 |
| `allCombinations` 可用 | — | 无缺口 |

**结论：不存在「Runtime 未生成关键数组」的语料级问题；缺口几乎全部为 Consumer 未提取 / 历史导出不完整。**

---

## 五、已有 Trace 是否足够回答关键问题

| 问题 | 语料 200（仅 E2E） | 补导出后（d001/d048） |
|------|:------------------:|:---------------------:|
| 目标词是否进入 `recallHits` | ❌ | ✅ 可逐词查（但 d001 本次 run 目标词未命中） |
| 是否进入 Winner Domain | ❌ | ✅ `utteranceDomain` |
| 是否进入 Selected pool | ❌ | ✅ `poolAfterDrop` |
| 是否进入 `allCombinations` | ✅ | ✅ |
| 为何未进 Generated | 部分 | ✅ 可链式：pool 无目标词 → Generated 无目标词 |

→ **语料级不足 → 触发 Conditional 补导出（Verdict B）**  
→ **无需全量 200 重跑**（Runtime 已证生成；E2E 已有 Generation/KenLM）

---

## 六、Conditional Re-validation 执行记录

### 6.1 触发条件对照

| 条件 | 是否满足 |
|------|:--------:|
| Runtime 未生成关键字段 | **否** |
| 历史 Trace 关键数组缺失 | **是**（E2E consumer） |
| 已有 Trace 无法回答 §五 | **是**（语料级） |

### 6.2 执行内容

```text
配置（冻结）：
  spanAssemblyV4DiagnosticsEnabled = true
  spanAssemblyV4DiagnosticsLevel = trace
  spanAssemblyV4DiagnosticsTargetIds = []

动作：
  export-runtime-trace-evidence-offline.mjs --ids d001,d048
  → tmp/runtime_trace_evidence_export_20260715/trace-d001.json
  → tmp/runtime_trace_evidence_export_20260715/trace-d048.json

未执行：
  dialog_200 全量重跑（不必要）
```

### 6.3 补导出实证（d001）

| 指标 | 值 |
|------|---|
| `coarseSpans` | 5 |
| `recallHits` | 23 |
| `poolAfterDrop` | 23 |
| `allCombinations` | 12 |
| `utteranceDomain` | `general` |
| pool 样例 | `以北` · `焙烧` · `游览`…（**非** `中杯`/`拿铁`） |
| Generated 样例 | `…中焙烧糖 今天游览没马分吗?` |

**链式归因（d001 · 全字段可见）：**

```text
Span OK（coarseSpans 存在）
  → Recall Hit 存在，但目标 domain 词（拿铁/中杯/蓝莓马芬）未进入 recallHits/pool
  → poolAfterDrop 仅含同音误候选（以北/焙烧）
  → allCombinations 由错误 pool 组装
  → pickedIsRaw=true → KenLM 未替换
```

→ 该 case 可见 Primary Owner：**Recall Failure**（目标词级）+ **Sentence Generation Failure**（错误 pool 进句）

（注：历史 `trace-d001.json` 另一次 run 曾出现 `拿铁`/`蓝莓马芬` recallHit — 证明 Recall **能力**存在，但非每次 ASR 窗口都能命中目标词。）

---

## 七、重新分析：30 Case 随机样本（E2E 可见阶段）

从 dialog_200 **按 scenario 分层随机** 抽 30 case（非 84 目标 case 定向）。

**可见阶段 Owner 分布（仅 combinationCount / pickedIsRaw / applied）：**

| Primary Owner（可见） | Count |
|-----------------------|------:|
| KenLM Selection Failure | 主导（`pickedIsRaw=true` 且已有 Generated） |
| Sentence Generation Failure | 少量（`combinationCount=0`） |
| Unavailable（Stages 1–4） | 多数 case 无法判定 Recall/Select |

**结论：** 在 **不补全数组导出** 的情况下，语料级只能可靠定位 **Generation / KenLM**；补导出后可闭合全链。

---

## 八、Representative Cases（深链 + 随机）

### 8.1 全链可闭合 — d001（补导出）

| 字段 | 值 |
|------|----|
| FW Raw | 你好,我想點一杯熱拿鐵中貝少糖 今天有蓝没马分吗? |
| coarseSpans | 5（含 `你好,我想點一杯熱拿鐵` · `貝少糖 今天` 等） |
| poolAfterDrop | 23 — **无** `中杯`/`拿铁` |
| allCombinations | 12 — 含 `焙烧` 误组装 |
| utteranceDomain | `general` |
| pickedIsRaw | true |
| **Primary Owner** | **Recall Failure**（目标词）→ **Sentence Generation Failure** |

### 8.2 全链可闭合 — d048（补导出）

| 字段 | 值 |
|------|----|
| recallHits | 34 |
| poolAfterDrop | 34 |
| coarseSpans | 5 |
| allCombinations | 16 |
| utteranceDomain | `general` |

### 8.3 历史局部 trace — d001（tests/trace-d001.json）

| 对比项 | 历史局部 | 本轮补导出 |
|--------|----------|------------|
| recallHits | 49（含 `拿铁` · `蓝莓马芬`） | 23（不含目标词） |
| pool/coarse | ❌ | ✅ |
| allCombinations | ❌ | ✅ |

→ 同一 case ID **不同 run** 可表现不同 Recall 命中；Trace 证据足以区分，非分析器缺陷。

### 8.4 随机 30 case 摘要

见 `runtime_trace_evidence_audit.json` → `random_sample_30[]`

---

## 九、必须回答的 6 问

| # | 问题 | 答案 |
|---|------|------|
| 1 | 已有 Trace 是否足够？ | **部分足够** — E2E 覆盖 Generation/KenLM；Stages 1–4 数组不足 |
| 2 | 是否重新导出？ | **是** — 补导出 d001/d048（非全量 200） |
| 3 | 真正缺失哪一层？ | **Consumer 未提取**（非 Runtime 未生成） |
| 4 | 能否准确定位 Primary Owner？ | **补导出后：是**；语料 E2E-only：**仅 Generation/KenLM** |
| 5 | Assembly / Selection / Recall 谁是瓶颈？ | **语料级：Sentence Generation**；d001 深链：**Recall（目标词）+ Generation**；Selection **无法语料级定论**（pool 未导出） |
| 6 | KenLM Corpus Audit？ | **否** — usable Generated 不足（见 Fine-domain Acceptance Verdict C） |

---

## 十、Runtime 源码证明（Trace 已生成）

```text
fw-detector-v4-path.ts
  spanAssemblyV4: {
    ...assembly.metrics,          // utteranceDomain, domainCandidateCount, ...
  ...(assembly.trace ?? {}),    // recallHits, pool*, coarseSpans, ...
  }
  sentenceRerank.allCombinations  // when diagnosticsConfig.traceActive

v4-diagnostics-config.ts
  traceActive = enabled && level==='trace' && targetIds=[] → ALL cases

v4-diagnostics-trace.ts
  V4TraceCollector → pushRecallHit / pushPoolBeforeDrop / pushCoarseSpan / ...
```

---

## 十一、Primary Bottleneck & KenLM Gate

### Repair Pipeline 当前真正 Primary Bottleneck

```text
语料级（200/200 E2E + Fine-domain Acceptance）：
  Primary = Sentence Generation Failure
  （usable Generated 11.1%；multi-term joint 14.3%）

深链级（补导出 d001）：
  Primary = Recall Failure（目标细分词未入 pool）
           → Sentence Generation Failure（错误候选进句）

KenLM：
  次要 — 大量 pickedIsRaw；但 usable 机会池过薄，不得升格为主瓶颈
```

### KenLM Corpus Audit

```text
不得进入
理由：Trace 证明 Generation 质量 / Recall→Pool 链路问题先于 KenLM；
      Acceptance Verdict C 仍有效
```

---

## 十二、KEEP / MODIFY / RESTORE / DELETE

| 对象 | 裁决 |
|------|:----:|
| Runtime / Diagnostics 生成逻辑 | **KEEP** |
| E2E full trace 跑批（200/200 · allCombinations） | **KEEP** |
| 冻结 Repair 业务逻辑 | **KEEP** |
| E2E `extractMetrics` 数组丢弃行为 | **KEEP**（本轮不改；记录为 Consumer gap） |
| 离线补导出脚本（tmp only） | **MODIFY**（本轮新增 Consumer 工具） |
| 断言「Runtime 未生成 recallHits」 | **DELETE**（证伪） |
| 全量 dialog_200 重跑 | **DELETE**（本轮不需要） |
| Metrics Mapping 语义 | **KEEP** |
| 进入 KenLM Corpus Audit | **DELETE**（禁止） |

---

## 十三、后续（文档建议 · 非授权开发）

若需 **语料级** 闭合 Stages 1–4，按 Runtime Evolution Rule：

1. **Consumer 离线导出** 全量 200（或扩展现有 E2E extract **仅多写 tmp trace 文件**，不进 Contract）  
2. **Mapping Catalog 登记** 后再由 Metrics 消费（不得自动扫描）  
3. **不得** 为此修改 Runtime / Repair 主链  

---

*Lingua Runtime Trace Evidence Audit · Verdict B · Runtime Business Logic Diff = 0 · 2026-07-15*
