<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: CURRENT SSOT + Acceptance Records
Archive Path: docs/archive/HISTORICAL/FW_Repair_V4_Production_Anti_Overfitting_Audit_2026_08_01.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: CURRENT SSOT + Acceptance Records

# FW Repair V4 — Production Code Anti-Overfitting and Test-Accommodation Audit

**Date:** 2026-08-01  
**Nature:** READ ONLY · ANTI-OVERFITTING · PRODUCTION CODE · TEST-ACCOMMODATION  
**禁止已遵守:** 未改代码 / 测试 / dialog_200 / 词库 / 配置；未新增测试集；未讨论扩大测试集；未用通过率替代代码证据。

---

## 1. Executive Conclusion

**Verdict: PASS**

```text
PASS

生产 ASR 后处理代码与 dialog_200、
targeted cases、Case ID、expected result 完全解耦。

未发现固定文本修复、测试候选注入、
测试专用阈值、Probe 污染或其他迎合测试的生产逻辑。
```

补充（不影响 PASS）：

| 项 | 说明 | 风险 |
|----|------|------|
| `resolveFwDetectorTraceCaseId` | 从 `session_id` 解析 `d###` **仅**控制诊断 trace 开关 | **P2** |
| `domain_anchor.json` | 含中文锚点词；默认 `useIndustryRouting=false`，V4 主链不走 | **DEAD / 非 V4 主链** |
| `index.ts` → `startTestServer` | 生产进程可起测试 HTTP 服务；**不**参与 FW 决策 | 非本审计 FAIL 条件 |
| Git 近期 lattice 修复 | 大量未提交/提交信息粗粒度 | **GIT_HISTORY_INCOMPLETE**；以当前源码为准 |

---

## 2. Audit Scope

| 覆盖 | 路径 |
|------|------|
| 生产 | `main/src/fw-detector`, `pipeline`, `lexicon`, `lexicon-v2`；相关 `node-config*` |
| 对照 | `docs/tone-v2/_audit_scratch`, `*.test.ts`, `tests/`, `scripts` |
| 链 | ASR Raw → Tone → Window → Recall → Edge → Path → FineSpan → Vote → Bucket → Budget → Assembly → CrossPath → KenLM → raw_log_delta → Result |

未改任何文件。反事实仅只读调用 `runSpanAssemblyV4Orchestrator`。

---

## 3. Definition of Test Accommodation

本审计将下列行为视为迎合测试（FAIL）：

```text
读取 dialog_200 / targeted / expected
识别 caseId 并改变 Recall/Vote/Budget/Assembly/KenLM/选择
硬编码测试词/句修复表
注入或删除预期 Candidate
测试专用业务阈值 / 算法分支
Probe/fixture 被生产 import
```

不视为迎合：

```text
单测 / Probe 使用 d001 文本
诊断字段记录 caseId
词库数据含真实词（拿铁/订单等）
配置默认值恰好被 dialog_200 使用（通用合同）
```

---

## 4. Production Call Chain（决策输入）

```text
rawText + lexicon domains[] + tone evidence + configs
→ resolveRecallScope(enabledDomains)     // 非 caseId
→ recallSpanTopKV3(domainIds, pinyin)    // 非 expectedText
→ Vote(domains[] presence)               // 非词表白名单
→ Budget(score, caps) / Assembly(range, overlap, cap)
→ CrossPath(exact text dedupe)
→ KenLM scoreBatch(texts) + minDeltaToReplace
→ apply approved spans
```

决策不依赖：`dialog_200` 文件、`expectedText`、`caseId`、人工判断函数。

---

## 5. Test File Reference Search

### 5.1 搜索范围与命中量（概要）

| 模式 | `main/src` 生产 `.ts`（排除 `*.test.ts`） | 测试 / Probe / 文档 |
|------|------------------------------------------|-------------------|
| `dialog_200` / `dialog200` | **0** 生产业务文件 | 多处 TEST/PROBE/DOC |
| `targeted_cases` / `targeted_prescan` | **0** | Probe/脚本 |
| `cases.manifest.json` | **0** | Probe |
| `_audit_scratch` | **0** 生产 import | 仅 `*.test.ts` / freeze 检查 |
| `expectedText` / `goldText` / `groundTruth` | **0** | TEST/PROBE |
| `humanJudgment` / `looksOdd` | **0** | 历史 Probe 叙述 / 无生产符号 |

### 5.2 代表性命中分类表

| symbol / string | file | context | classification | production reachable | decision impact | risk |
|---------------|------|---------|----------------|---------------------|-----------------|------|
| `dialog_200` | `lexicon-v2/batch1-1b-stage4-*.audit.test.ts` | 注释/审计说明 | TEST_ONLY | NO | none | P2 |
| `_audit_scratch` | `span-assembly-v4/residual-cleanup.test.ts` | 扫描 probe 残留字段 | TEST_ONLY | NO | none | P2 |
| `dialog200` summary | `aggregator/dedup.sanitize.test.ts` | fixture 路径 | TEST_ONLY | NO | none | P2 |
| `d001` 文本 | 多个 `*.test.ts` | 样例 raw | TEST_ONLY | NO | none | P3 |
| `dialog_200` | `docs/tone-v2/_audit_scratch/*.mjs` | 批探针 | PROBE_ONLY | NO（不被生产 import） | none | P2 |
| `v31-d200-(d\d+)` | `pipeline/steps/fw-detector-step.ts` | 解析 session → traceCaseId | PRODUCTION_ACTIVE | YES | **仅诊断** | **P2** |
| `traceCaseId` / `d001` 注释 | `span-assembly-v4-orchestrator.ts` | 可选诊断入参 | PRODUCTION_ACTIVE | YES | **仅诊断** | **P2** |
| `spanAssemblyV4DiagnosticsTargetIds` | `v4-diagnostics-config.ts` | caseId 匹配打开 trace | PRODUCTION_ACTIVE | YES | **仅诊断** | **P2** |
| `拿铁`/`马芬` 等 | `data/lexicon/domain_anchor.json` | industry routing 锚点 | DEAD on V4 default | 仅当 `useIndustryRouting=true` | 非 V4 默认主链 | P2 residual |
| `startTestServer` | `main/src/index.ts` | 启动测试 HTTP | PRODUCTION_ACTIVE（旁路服务） | YES | **不进 FW 决策** | out-of-scope P2 |

**无 `PRODUCTION_ACTIVE` 命中改变 Vote/Assembly/KenLM/Final selection。**

---

## 6. Case ID Special-Branch Search

| 符号 | 生产行为 |
|------|----------|
| `resolveFwDetectorTraceCaseId` | 正则取 `d###` → `ctx.fwDetectorTraceCaseId` |
| `resolveV4DiagnosticsConfig` | `traceActive = enabled && level==='trace' && matchesTargetId` |
| 默认配置 | `spanAssemblyV4DiagnosticsEnabled: false`，`targetIds: []` |

`matchesTargetId`：`targetIds` 空时对 **enabled+trace** 场景返回 true（全量 trace），**不是** `if (caseId==='d001')` 业务分支。

```text
未发现: if (caseId === "d001") / if (index < 200) / if (scenario === "coffee")
进入 Recall / Vote / Budget / Assembly / KenLM / Final selection
```

---

## 7. Hard-Coded Chinese Text Search

审计词（地址/低脂/地质/医院/议员/医师/议室/拿铁/大杯/小杯/订单/预订/前台/接口文档/上线计划/联调/蓝莓/马芬）在 **`fw-detector` 非测试 `.ts` 中：0 业务硬编码命中**。

全部命中位于 `*.test.ts`（fixture / expect），分类为 **合法测试 fixture**。

生产侧相关中文仅见：

| 位置 | 分类 |
|------|------|
| `domain_anchor.json` restaurant/travel 等锚点 | 配置数据；**默认未接入 V4 主链** |
| 词库 SQLite / IME 字典 | **合法词库数据** |

未发现：

```ts
if (text.includes("地址"))
if (rawText === "…")
specialCases["低脂"]
expectedCorrections
```

---

## 8. Candidate Injection Search

| 来源 | 机制 | 是否测试迎合 |
|------|------|--------------|
| Lexicon Recall | `recallSpanTopKV3` | 否 |
| Canonical | `domainAwareCanonicalFromPathFineSpan` | 否（通用 raw 保留） |
| Gap | `makeGapCanonicalPick` | 否 |
| Fallback edges | `injectFallbackEdges` | **音节连通性** 通用注入，非答案词 |
| Base / sameDomain | filter + budget | 否 |

未发现：`manualCandidate` / `forcedCandidate` / `safeCandidate` / 按测试词 push 正确答案 / 为凑 16 条变造句。

`maxSentenceCandidates=16` 为 **cap**，不是伪造候选。

---

## 9. Candidate Suppression Search

```text
humanJudgment / looksOdd / looksGood / knownBad / blockedWords /
oddSentences / badCandidate / noiseWords
```

在生产 `fw-detector`：**0 命中**。

删除仅来自：eligibility、domain bucket 过滤、budget、overlap、text dedupe、KenLM threshold — 全部通用规则。

---

## 10. Assembly Special-Case Search

`buildSentenceCandidates` / `assembleDomainAwareSpanSets` / mapper / `mergeCrossPathSentenceCandidates`：

- 依赖：range、score、overlap、budget、configured cap、exact text dedupe  
- **不**依赖：固定句子、固定 domain 名硬编码优先、caseId、dialog 句长特判  

`uniqueByText` 是通用去重，非测试名单。

---

## 11. Domain Vote Special-Case Search

Vote 使用候选 `domains[]`（词库 `term_domain_tags`  enrichment）+ presence 公式。

生产 Vote 源码 **无** `"拿铁"→coffee` / `"医生"→medical` 硬编码。

可选路径 `domain_anchor.json` 含 `"拿铁"→restaurant` 类锚点，但：

```text
useIndustryRouting 默认 false
V4 orchestrator 使用 resolveRecallScope，不调用 resolveRecallDomains
```

故对 **当前 V4 生产主链** 为 **不可达**。

---

## 12. Tone Special-Case Search

`tone-time-align.ts` 等：无 `mei2/mei3`、无固定汉字、无 wav 文件名、无 caseId、无 expected text。

Tone 依赖声学 slice / timestamp 合同（`toneTimestampOnlyEnabled` 默认 true）。

---

## 13. KenLM Score Override Search

`rerank-fw-sentences.ts`：

```text
scoreBatch([rawText, ...candidates.map(c => c.text)])
bestIndex by raw_log_delta
gate: bestRawDelta < minDeltaToReplace → keep raw
```

未发现：`scoreOverride` / `forceTop1` / `preferredSentence` / `goldSentence` / `boostPhrase` / `penaltyPhrase`。

`topCandidates.candidateId = candidate:${i}` 为诊断合成 ID，非分数覆盖。

---

## 14. raw_log_delta Special-Case Search

阈值：`minDeltaToReplace` 默认 **3.0**（`node-config-defaults` / `fw-config`）。

无 dialog_200 专用阈值、无句子 bypass、无按词强制 replace/keep。

Job override 可改 KenLM gate（`fw_detector` payload），属通用 IPC，非测试文件驱动。

---

## 15. Test Configuration Override Search

| 配置 | 默认生产值 | 测试专用业务算法？ |
|------|------------|-------------------|
| maxSentenceCandidates | 16 | 否 |
| minDeltaToReplace | 3.0 | 否 |
| per-span budget | 8/6/4 by span count | 否 |
| spanAssemblyV4DiagnosticsEnabled | false | 仅诊断 |
| useIndustryRouting | false | 否 |
| LEXICON_RECALL_V2_DIAGNOSTICS | env 控诊断收集 | **不改变 recall 结果** |
| NODE_ENV==='test' 业务分支 | **未发现**于 fw-detector 决策路径 | — |

`PROJECT_ROOT` 仅解析资源路径，不切换算法。

---

## 16. Probe / Test Import Contamination

反向依赖：

```text
Production Module
← 不 import docs/tone-v2/_audit_scratch
← 不 import dialog_200
← 不 import targeted_cases
← *.test.ts 仅被测试运行器加载
```

`P0 TEST_CODE_LEAK`：**未发现**。

`test-tone-fixtures` / `length1-real-sqlite.test.helpers` 仅被测试 import。

`index.ts` → `test-server`：旁路 HTTP，**非** FW 决策污染。

---

## 17. Git History Findings

```text
GIT_HISTORY_INCOMPLETE
```

对关键文件的 `git log` 仅见粗粒度 seal/freeze 提交；近期 SameDomain multi-candidate / eligibility 等大量改动可能仍在工作区未按测试样例特判提交。

`git log --grep=A01|dialog_200|whitelist|hardcode`：无「为 A01 特判」类提交信息。

**以当前源码静态审计为准：** 未见 case/文本特判残留；freeze 测试明确禁止 `temporaryPreStep4Collection` 等临时收集路径。

---

## 18. Data Pollution Findings

- Probe 对 lexicon：只读 `SELECT` / `Database(..., {readonly:true})` 模式为主  
- 生产主链不在 job 中 `INSERT` term_domain_tags  
- 本轮审计未修改词库；未发现测试运行把 dialog_200 答案写回词库的生产代码路径  

```text
dialog_200 / targeted probe 设计为只读消费；写回词库 = 未在生产源码中发现
```

---

## 19. Counterfactual Branch Check

只读调用生产 orchestrator（无 caseId）：

| tag | 变更 | pathN | retainedDomains | 说明 |
|-----|------|------:|-----------------|------|
| base | 原句（含蓝莓马芬） | 2 | food_order, coffee | — |
| base_repeat | 同 base | 2 | 同 | 确定性 |
| cf_name | 「我想」→「小李想」 | 2 | 同结构 domains | **无 shortcut** |
| cf_pastry | 蓝莓马芬→草莓蛋糕 | 1 | coffee | 词库命中差 → Path/Vote 可变；**非 case 分支** |

结论：无完整文本绑定；差异来自通用 recall/vote，符合「不同词库命中可不同 Candidate」。

---

## 20. Risk Inventory

| ID | 分类 | 说明 |
|----|------|------|
| R1 | P2 MISLEADING_DIAGNOSTIC | session 解析 `d###` / diagnostics targetIds |
| R2 | P2 residual / DEAD on V4 | `domain_anchor.json` 中文锚点（industry routing 关） |
| R3 | P2 | 生产可启 `test-server`（非 FW 迎合） |
| R4 | GIT_HISTORY_INCOMPLETE | 近期提交粒度不足 |

**无 P0 / P1 test-accommodation。**

---

## 21. Production Reachability Matrix

| 机制 | 可达生产决策？ |
|------|----------------|
| dialog_200 文件读入 | NO |
| targeted cases | NO |
| caseId → Vote/Assembly/KenLM | NO |
| caseId → diagnostics | YES（默认关） |
| 中文硬编码修复表 | NO |
| Probe import | NO |
| domain_anchor 关键词 | NO（默认） |
| injectFallbackEdges | YES（通用连通性） |
| KenLM score override | NO |

---

## 22. KEEP / DELETE / INVESTIGATE

### KEEP

```text
通用 Recall / Vote / Budget / Assembly / CrossPath / KenLM 合同
诊断默认关闭
useIndustryRouting=false
```

### DELETE（非本轮；可选清理）

```text
无必须删除的生产迎合逻辑
```

### INVESTIGATE（低优先级）

```text
是否文档化：traceCaseId 绝不影响决策
industry routing / domain_anchor 与 V4 主链隔离验收（已默认关闭）
```

---

## 23. Target List

| ID | 答案 |
|----|------|
| T1 | **否** |
| T2 | **否** |
| T3 | 可解析 `d###` **仅诊断**；不识别 A01/B01/C01 业务分支 |
| T4 | **否** |
| T5 | **否** |
| T6 | **否**（仅合法 canonical/gap/fallback） |
| T7 | **否** |
| T8 | **否** |
| T9 | **否** |
| T10 | **否** |
| T11 | **是** |
| T12 | **是** |
| T13 | **是** |
| T14 | **否** |
| T15 | **否** |
| T16 | 生产路径未见写回；Probe 只读 |
| T17 | Git 不完整；当前源码无 A01 特判 |
| T18 | **否**（主链）；anchor JSON 非 V4 默认 |
| T19 | **否** |
| T20 | **否** |
| T21 | 决策层 **完全不知道**；诊断层可解析 session |
| T22 | **是**（同结构通用分支；词库差导致结果差属预期） |
| T23 | 决策相关命中均为 TEST/PROBE/DOC/DEAD；诊断为 P2 |
| T24 | **否**（无 P0/P1） |
| T25 | **是** — test-agnostic production logic |

---

## 24. Check List

```text
[x] 未修改代码
[x] 未修改测试
[x] 未修改词库
[x] 未新增测试集
[x] 全仓搜索 dialog_200
[x] 全仓搜索 targeted cases
[x] 全仓搜索 Case ID
[x] 全仓搜索 expected/gold/reference
[x] 全仓搜索中文硬编码
[x] 检查 Candidate 注入
[x] 检查 Candidate 删除
[x] 检查 Assembly 特判
[x] 检查 Vote 特判
[x] 检查 Tone 特判
[x] 检查 KenLM score override
[x] 检查 raw_log_delta 特判
[x] 检查环境变量测试分支
[x] 检查 Probe/Test import 污染
[x] 检查 Git 最近修改
[x] 检查测试数据写回
[x] 执行小规模只读反事实分支检查
[x] 区分生产 / 测试 / Probe / 文档
[x] 所有发现均标记生产可达性
[x] 未讨论扩大测试集
[x] 未用测试通过率替代代码证据
```

---

## 25. Final Verdict

```text
PASS

生产 ASR 后处理代码与 dialog_200、
targeted cases、Case ID、expected result 完全解耦。

未发现固定文本修复、测试候选注入、
测试专用阈值、Probe 污染或其他迎合测试的生产逻辑。
```

对十五个核心问题的压缩回答：

1–2 否 · 3–7 否（业务层）· 8 否 · 9–10 否 · 11 否 · 12 否 · 13–15 否（合法 generic 除外）。
