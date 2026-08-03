> **HISTORICAL / SUPERSEDED BY MULTI-PATH LEXICAL LATTICE / NOT RUNTIME AUTHORITY** (Step 6, 2026-07-30). SoftBoundary LTR Fine Span is deleted from runtime; see Runtime SSOT V1.2 + Lattice Architecture V1.0.0.
> **HISTORICAL / SUPERSEDED (Fine Span architecture)** — 2026-07-26  
> LTR-only / unique FormalFineSpan / cursor-commit / windows 2..5-as-SSOT claims in this document are **not** current Architecture SSOT.  
> Current authority: `FW_Repair_V4_Multi_Path_Lexical_Lattice_Architecture_V1.0.0_FROZEN.md`  
> Original text retained as historical evidence. Do not treat as active freeze.
# FW Repair V4
# FineSpan Soft Boundary + Session Domain Prior + LLM Correction
## Supplement Review（缺口与契约补充）

| Field | Value |
|---|---|
| Date | 2026-07-22 |
| Document Type | Supplement（Design / Interface / Data / Decision / Regression / Acceptance） |
| Status | Binding for development after freeze with Development Plan |
| Companion Plan | `FW_Repair_V4_FineSpan_SoftBoundary_SessionDomainPrior_LLMCorrection_Development_Plan_2026_07_22.md` |
| Related Audit | `FW_Repair_V4_FineSpan_SoftBoundary_SessionDomainPrior_LLMCorrection_PreDevelopment_Audit_2026_07_22.md` |
| Authority | Runtime SSOT / frozen FW Repair V4 architecture |
| Scope Rule | **禁止改变冻结设计**；仅补充约束、契约、回归与验收 |

---

# 0. Executive Verdict

对照 Development Plan、PreDevelopment Audit 与当前代码后：

```text
冻结主链 / Web session prior Owner / Scheduler 零推理 / LLM 低频纠偏
—— 保持不变（KEEP）

仍存在实现歧义与契约缺口，必须在本 Supplement 钉死后方可开发
—— 不引入新功能，不重开 Node Session prior 所有权
```

**最大未钉死风险（开发前必须按本文执行）：**

1. FineSpan option 多套偏序缺少**单一全序**；
2. `currentTurnDomains` 的 Top3 / 阈值 / 并列三者冲突；
3. Scheduler `ExtraResult` 封闭结构会剥掉协议字段；
4. Node `activeLexiconProfile` / `lexiconSessionIntent` / weak-domain 双路径残余；
5. Tone commit 后重算、LTR fallback、`windowSource` 与现码名实不符；
6. Web merge Condition A/B 边角（并列、空轮、异步 LLM）。

---

# 1. KEEP / MODIFY / RESTORE / DELETE

> 本节为 Supplement 裁决总表。与 Plan §11 一致处标注「Plan」；本文件新增钉死项标注「Supplement」。

## 1.1 KEEP

| Item | Source |
|---|---|
| 唯一主链：Coarse → FineSpan → Recall → Vote → Bucket → Assembly → KenLM | Plan |
| Web 为 `sessionDomainPriors` 唯一会话 Owner | Plan（不重开） |
| Scheduler 无状态；只校验 + 透传 | Plan |
| LLM 异步低频；不直接写 FineSpan / 不直接覆盖 prior | Plan |
| Context Prior diagnostics-only（`applied:false`） | Plan + Code |
| Presence Vote：`DOMAIN_BUCKET_RETENTION_RATIO = 0.75`；并列最高走 tie 分支、非并列走阈值 | Code Implementation |
| `term_domain_tags` 多领域；禁止 `domains[0]` 一词一域 | Plan + Frozen |
| Sentence candidate cap **16**；KenLM 职责不变 | Plan |
| `boundaryCrossCount <= 1`；`maxBoundaryCrossCount=1` | Plan + Code |
| `weakDomainRecallEnabled` 默认 **false** | Code |
| Web 会话键继续用 `sessionId`（**不引入** `conversationId`） | Code Implementation |
| Node 内部 `retainedDomains` / `domainScores` 仍为当前句 Vote SSOT | Plan |
| `context-prior.ts` 文件可保留为诊断 helper | Plan |

## 1.2 MODIFY（契约钉死 / 接线收敛，不改架构）

| Item | Supplement 钉死 |
|---|---|
| `generateGlobalWindows` production 调用 | 改为 LTR option+commit；旧全量滑窗调用删除（见 DELETE） |
| `buildFineSpanCandidatePool` | 主键改为 Formal FineSpan；coarse 仅 metadata |
| `ExtraResult` / `JobAssign` / `Utterance` | 显式增加 `currentTurnDomains` / `llmCalibration` / `domainPriors` |
| `currentTurnDomains` 投影 | 见 §4.2 固定算法 |
| Option 选择 | 见 §5.1 单一全序 |
| LTR fallback | 见 §5.2 |
| `windowSource` | 见 §4.4（对齐 `fallback` / 保留 `blocked` 仅诊断） |
| LLM `shouldSwitch` → `topicShift` | 见 §4.3（投影，不静默冒充） |
| 粗域 LLM → 细域 prior | 见 §4.3（Web merger 展开，FineSpan 只收 fine） |
| `activeLexiconProfile` | 可保留会话/摘要；**停止**作为 FineSpan / Recall soft prior |
| Assembly `allNonOverlapSubsets` | LTR 后不再作正式边界消解主路径 |
| Plan 示例 JSON 嵌套 `utterance.domainPriors` | 改为 **顶层** `Utterance` / `JobAssign.domainPriors`（与现扁平消息一致） |

## 1.3 RESTORE（仅语义，不恢复旧代码路径）

| Item | Note |
|---|---|
| Coarse boundary 作为停顿 soft metadata | Plan RESTORE |
| base / other-domain 探索配额 | Plan RESTORE |
| 当前句证据优先于历史 prior | Plan RESTORE |
| LLM 摘要低频纠偏语义 | Plan RESTORE |

**禁止恢复：** Detector 主链、Beam、正式重叠滑窗、VoteMass、Context Prior gate、Node hidden session prior 决策态。

## 1.4 DELETE

| Item | Source |
|---|---|
| Production 全量重叠 `generateGlobalWindows` 调用 | Plan |
| 仅服务全量正式重叠窗的 truncate 预算主路径（120/40） | Supplement（LTR 后不再作为正式窗预算） |
| Assembly 以 overlap 枚举消解正式边界的主路径 | Plan |
| LTR + 旧滑窗双运行开关 | Plan |
| `domainPriors` 写入 `enabledDomains` / `recallDomainScope` / `jobOverride` | Supplement |
| Web prior + Node profile 双重 soft prior | Plan |
| 把完整 `fw_detector` 当作 Web session 协议 | Plan |
| `domains[0]` 唯一域读取 | Plan |
| Node Session 内另存 `sessionDomainPriors` 决策态 | Plan（允许诊断镜像，禁止决策） |
| 不可达 Detector/Beam/repair_target 兼容链 | Plan |

---

# 2. Design Constraint

## DC-1 Soft prior 唯一入口

```text
Node FineSpan / Recall soft prior 唯一输入 = request.domainPriors
```

禁止以下任一路径充当 prior 或硬 gate：

- `features.fwDetector.enabledDomains` / `recallDomainScope`（由 prior 写入）；
- `ctx.fwDetectorEnabledDomainsOverride` ← prior；
- `activeLexiconProfile.primaryDomain`；
- `lexiconSessionIntent` / ALS `runWithLexiconRecallContext`；
- `contextPrior*` 决策字段；
- `weakDomainRecallPlan` 与 `domainPriors` 叠加加权。

**来源：** Design Gap + Architecture Drift（Plan §2.3 / §4.1 vs `weak-domain` / sessionIntent 残留）  
**必要性：** 防止双 prior 与 prior-as-gate。  
**影响：** Node bind、Recall quota、option 排序。  
**未来风险：** 否则 Web 闭环与 Node 隐式 prior 再次分叉。

## DC-2 Node profile / intent 存活边界

允许：

- Session 生命周期继续持有 `activeLexiconProfile` / `lexiconSessionIntent`；
- JobResult 诊断 / 业务摘要字段继续投影；
- Intent LLM 继续异步调度。

禁止：

- 改变 FineSpan option 序、candidate quota、Vote、Assembly membership、KenLM score；
- 与 `domainPriors` 同时作为 soft ranking 输入。

本轮默认：`weakDomainRecallEnabled` 保持 **false**；若测试需开启，不得与 `domainPriors` 并存为决策输入（二选一，禁止叠加）。

**来源：** Code Implementation + Previous Audit  
**影响：** orchestrator / weak-domain / session-result-extra。

## DC-3 Context Prior 决策旁路保持关闭

```text
contextPriorApplied === false  （强制）
```

禁止将 `domainPriors` 写入 `contextPriorDomain*` 决策链。诊断字段可 KEEP。

**来源：** Frozen Principle + Current Code（`mergeContextPriorIntoRuntimeDiag(..., { applied:false })`）

## DC-4 Vote 池单位 = Formal FineSpan

Presence Vote「一 Span 一票」的 Span 单位必须是 **已提交 Formal FineSpan**，不得继续以 coarse span 作为 pool 主键。

`coarseSpanIds` 仅 metadata；跨界 Formal FineSpan（`boundaryCrossCount=1`）计为一票单位。

**来源：** Architecture Drift（`buildFineSpanCandidatePool` 现按 coarse 聚合）  
**影响：** Item B + Vote 输入对齐。

## DC-5 LTR 正式边界唯一决策点

正式 FineSpan 边界只在 LTR Generator commit；Compatibility / Assembly / KenLM 不得回退改边界。

正式集合不变量：

```text
formalOverlapCount === 0
cursor 只前进
每 cursor 恰好 commit 1 个 FormalFineSpan（含 fallback）
```

**来源：** Plan + Design Gap（现码重叠消解在 Assembly）

## DC-6 Scheduler 无词库推理

Scheduler **不得**加载词库、不得调用 LLM、不得合并 recent turns。

registry-valid 策略见 IC-2（静态 allowlist 或 Web 预校验 + schema 防御）。

**来源：** Design Gap（Scheduler 无 RuntimeDomainRegistry）

## DC-7 开发分支短暂双实现、合并前单入口

允许开发分支短暂存在未接线的 LTR 实现文件；**合并 / 上线前** production entry 只能指向 LTR。禁止长期 dual-path flag。

**来源：** Plan §15 + Architecture Compliance

---

# 3. Interface Contract

## IC-1 Request：`domainPriors` 挂载点

与现有扁平消息对齐（**修正** Plan §4.4 嵌套示例歧义）：

```text
Web → Scheduler:  Utterance.domainPriors?: DomainPrior[]
Scheduler → Node: JobAssign.domainPriors?: DomainPrior[]   （同名复制）
```

约束：

- 缺失 / `null` / 非法清洗后为空数组 ≡ 无 prior 基线；
- 长度 ≤ 3；去重（后写丢弃或 Web 已合并；Node 再防御）；
- retry 使用首次清洗后固化进 job payload 的同一数组；
- FineSpan **只**读 `JobAssign.domainPriors`，不读 SessionObject prior 决策态。

**来源：** Design Gap + Code Implementation（`UtteranceMessage` / Rust `Utterance` / `JobAssign` 均为扁平字段）

## IC-2 Scheduler registry 校验策略（冻结二选一中的 A）

**冻结选择 A（本轮）：**

```text
1) Web merger 输出前：用与 Node 同源的 fine-domain allowlist 预校验并丢弃非法项；
2) Scheduler：仅校验 schema（数组、字段类型、length≤3、weight 有限且 0<w≤1、domain 非空字符串、无重复）；
3) Node：再次用 RuntimeDomainRegistry 防御性丢弃未知 domain。
```

Scheduler **不**持有完整词库；**不**做粗细映射。

若未来需要 Scheduler 静态快照，必须另开冻结变更；本轮禁止。

**来源：** Design Gap  
**影响：** Scheduler validation 实现范围。

## IC-3 Result：`ExtraResult` 显式字段

Rust / TS `ExtraResult` **必须显式**增加：

```ts
currentTurnDomains?: CurrentTurnDomain[];
llmCalibration?: LlmDomainCalibration;
```

禁止依赖 `serde` 未知字段穿透或 TS 索引签名“碰巧透传”。

约束：

- **不**把完整 `fw_detector` 加入 ExtraResult 作为 session 协议；
- Node 内部诊断可继续写 `JobResult.extra.fw_detector`，但 Scheduler→Web 会话闭环只认上述两字段；
- Web 忽略未知诊断大包。

**来源：** Architecture Drift（`common.rs` ExtraResult 封闭白名单）

## IC-4 `llmCalibration` 到达时序

Intent / summary 为异步：

```text
同轮 JobResult.extra.llmCalibration 允许缺省
Web 在后续可得的结果或独立更新中合并 llmCalibration
merge 以 updatedAt + summaryVersion 对齐，禁止假设与 currentTurnDomains 同包到达
```

禁止：因同轮缺 `llmCalibration` 阻断主链或丢弃 `currentTurnDomains`。

**来源：** Design Gap + Architecture Drift（`finalizeSessionTurn` → 异步 intent）

## IC-5 Web 消费面

```text
TranslationResult.extra.currentTurnDomains
TranslationResult.extra.llmCalibration
→ ConversationDomainState
→ next Utterance.domainPriors
```

Web **不得**解析 `fw_detector.spanAssemblyV4` 作为 prior 输入。

**来源：** Plan §2.5 / §4.2

## IC-6 TS / Rust golden contract

必须提供跨语言 golden fixture：

- `domainPriors` request round-trip；
- `currentTurnDomains` + `llmCalibration` result round-trip；
- 缺字段兼容；
- Top3 / 非法 weight / 重复 domain 清洗行为一致。

**来源：** Plan Target List P0 + Test Finding

---

# 4. Data Contract

## 4.1 `DomainPrior`（钉死 weight）

| Field | Constraint |
|---|---|
| `domain` | fine domain；registry-valid；禁止 alias；禁止粗域进入 Node payload |
| `weight` | **`0 < weight ≤ 1`**（禁止 0；禁止 NaN/Inf） |
| 数组 | ≤ 3；domain 唯一 |
| 求和 | **不要求** Σ=1；Node 消费前按 Σ 归一化；Σ=0 不可能（因禁止 0） |

Plan §2.5 与 §5.1 对 weight 下界表述不一致处，**以本条为准**。

**来源：** Design Gap

## 4.2 `currentTurnDomains` 投影算法（钉死）

输入：`retainedDomains` + `domainScores`（Presence Vote SSOT，算法 KEEP 现码）。

```text
Step 1  retained = selectRetainedDomains(domainScores)
        // KEEP: tie → 全部并列最高；非 tie → count >= maxCount * 0.75
Step 2  过滤 base / general / base_term（不得输出）
Step 3  排序: voteCount desc, domain asc（localeCompare）
Step 4  截断 Top 3
Step 5  投影:
        { domain, voteCount: domainScores[domain], normalizedScore?: voteCount/maxCount }
```

并列处理补充：

- Vote 层：并列最高 **全部**进入 `retainedDomains`（可 >3）—— KEEP 现码，供 Assembly bucket；
- JobResult 投影层：仅 Top3 —— 供 Web prior；
- **禁止**为满足 Top3 而把并列最高压成单一 winner；
- 若并列最高域数 >3：投影按 `domain asc` 稳定截断至 3，并在 diagnostics 标记 `currentTurnDomainsTruncated=true`（不改变 Node 内部 retained）。

空票轮：

```text
insufficientEvidence 或 retainedDomains=[]
→ currentTurnDomains = []
→ Web: 该轮不写入 recentTurns 贡献（或贡献全 0）
→ 不得清空已有 sessionDomainPriors
```

**来源：** Design Gap + Code Implementation（`utterance-domain-vote.ts`）

## 4.3 `LlmDomainCalibration` 与粗细映射

### 4.3.1 `topicShift` 投影

现码仅有 `shouldSwitch`，无 `topicShift`。

```text
llmCalibration.topicShift =
  结构化字段 topicShift（若 LLM JSON 已提供）
  否则不得用 shouldSwitch 静默冒充
```

本轮要求：

1. Intent JSON **新增**可选 `topicShift: boolean`；
2. 解析器优先读 `topicShift`；
3. 若缺失：`topicShift = false`（保守），**不要**自动 `= shouldSwitch`；
4. `shouldSwitch` 可保留给 Node profile 会话逻辑，但 **Web Condition B 只读 `topicShift`**。

**来源：** Design Gap + Code Implementation（`LexiconProfileDecision`）

### 4.3.2 粗 → 细

```text
LLM primaryDomain / secondaryDomains 允许 coarse（现状）
Web merger 在写入 domainPriors 前：
  - 若已是 fine 且 registry-valid → 直接用
  - 若是 coarse → 经 coarseToFineMap 展开为候选细域，再按校准权重分配到 Top3 规则内
  - 无法映射 → 丢弃该项
Node FineSpan payload 中的 domainPriors.domain 必须已是 fine
```

禁止把 coarse 原样塞进 `domainPriors`。

**来源：** Design Gap（LLM coarse vs Vote fine）

### 4.3.3 过期校准

```text
若 llmCalibration.updatedAt 早于 recentTurns[0].createdAt 超过固定阈值
或 summaryVersion 不匹配当前 intent schema
→ Web merge 忽略该校准（不翻转）
```

第一版过期阈值冻结为：**超过最近 4 轮窗口墙钟时间之外**即视为 stale（实现可用 `recentTurns` 最旧 `createdAt` 比较）。禁止新增可配置矩阵。

**来源：** Plan regression + Design Gap

## 4.4 FormalFineSpan / windowSource

```ts
windowSource: "in_span_window" | "boundary_window" | "fallback"
```

与现码对齐：

| 现码 | 本轮 |
|---|---|
| `in_span_window` | KEEP |
| `boundary_window` | KEEP |
| `blocked` | **仅**临时 option 拒绝态 / 诊断；**不得**进入 FormalFineSpan |
| 计划 `fallback` | FormalFineSpan 在无 2..5 合法 option 时使用 |

`passive_domain_weak` 仍是 **candidate source**，不是 `windowSource`。禁止混名。

**来源：** Design Gap + Architecture Drift

## 4.5 base 识别

```text
base 候选 = graphSource / source ∈ { base_term } 或等价「无 fine vote label」
不是 domain === "base" 字符串字段
Vote 继续排除 general / base_term 标签
```

**来源：** Code Implementation

---

# 5. Decision Constraint

## 5.1 FineSpan option 全序（单一字典序）

将 Plan §6.1 三套偏序合并为**唯一比较键**（从高到低）：

```text
K1 lexicalCompleteness
   complete_single_term > multi_unit_concat > partial_fragment > none

K2 boundaryClass
   in_span_complete > boundary_cross_complete > in_span_fallback
   例外（硬编码）:
     boundary_cross_complete > in_span_single_char_fallback

K3 priorSoftMatch
   仅当 K1、K2 全等时：
   matchedPriorWeightSum desc（option 候选 domains ∩ domainPriors 的归一化权重和）
   无 prior 或均未命中 → 0

K4 length
   仅当 K1..K3 全等：更短优先（禁止最长默认胜出）

K5 stableTie
   rawEnd asc, then rawStart asc, then spanId asc
```

谓词钉死：

- `complete_single_term`：存在 exact lexicon term 覆盖整个 option 音节区间；
- `multi_unit_concat`：多个 exact 子段拼接覆盖，但非单一 term；
- `partial_fragment`：仅 parent_fragment / 非完整覆盖；
- `none`：无有效 recall；
- `in_span_single_char_fallback`：option 为 fallback 单步推进单位。

「证据相同或近似」**删除模糊阈值**；本轮只允许 K1..K2 全等后才进入 prior。

**来源：** Design Gap（Plan 多偏序无全序）  
**未来风险：** 不钉死则跨界/长度/prior 互相覆盖，回归不可判定。

## 5.2 LTR Fallback

```text
若 cursor 处不存在合法 length∈[2,5] 且 boundaryCrossCount≤1 的 option：
  commit FormalFineSpan:
    推进单位 = 1 个 syllable（若无音节坐标则 1 个 raw char）
    windowSource = "fallback"
    candidates 可空
  cursor += 推进单位
  必须保证 cursor 严格增大（禁止死循环）
```

禁止：

- 用「整段 coarse 原文 canonical」冒充 FineSpan fallback（那是 Assembly 空槽行为，KEEP 在 Assembly，不挪到 Generator）；
- fallback 跨 coarse boundary（`boundaryCrossCount` 对单步推进为 0，除非单音节本身跨界——第一版单步不跨界）。

**来源：** Design Gap（Plan fallback vs `domainAwarePickFromCanonical`）

## 5.3 Tone 重算

```text
Recall / Tone 可对 temporary options 计算；
正式 commit 后必须用最终 FormalFineSpan.rawStart/rawEnd
重新提取 AcousticToneSlice / Tone pattern；
禁止复用被拒绝 option 的 tone 结果作为正式 span 附着。
```

**来源：** Design Gap（现码仅在 `recallTopKForWindows` 按临时窗提取）

## 5.4 Prior quota（钉死与现限交互）

在 **一次** recall 返回的 candidates 上内存分配（禁止 option×domain 多次 SQL）：

```text
prior-domain: up to 2
base: at least 1 if available
other-domain: at least 1 if available
总量 ≤ 现有 per-span assembly 上限（spanCount 映射 8/6/4）与 exactTopK/parentFragmentTopK
```

若预算冲突：

```text
base 保证 > other-domain 保证 > prior 填满 > 其余按原排序截断
```

prior **不得**改变 phonetic / tone contradiction / lexicon validity。

**来源：** Design Gap（Plan quota vs `per-span-candidate-limit.ts`）

## 5.5 Web merger Condition A/B 边角

### Leader 定义

```text
turnLeader = 该轮 currentTurnDomains 排序第一
并列 voteCount 的多个第一 → 该轮「无唯一 leader」（isTurnLeadTie=true）
Condition A「new domain leads」要求：唯一 leader 且 domain === newDomain
并列 leader 不算 leads
```

### Aggregate

```text
aggregate(domain) = Σ turnWeight_i × normalizedVote_i(domain)
翻转要求严格 > 旧 leader aggregate；== 不翻转
```

### 空轮

```text
currentTurnDomains=[] → 不推进 topic-shift Condition A；
不清除 sessionDomainPriors；
不占用「连续两轮」计数的成功支持（该轮视为无证据）
```

### Condition B「appeared in previous two turns」

```text
domain 在该轮 currentTurnDomains 中且 voteCount > 0 即「出现」
空轮不计入出现
```

### 单轮新域尾部保护

```text
仅 1 轮出现的新域：可进入 Top3 尾部（rank≥2），不得成为 domainPriors[0]
除非满足 Condition A 或 Condition B
```

### LLM 单独建议

```text
仅 llmCalibration 支持、当前句不支持 → 不翻转（Plan KEEP）
```

**来源：** Design Gap + Test Finding

## 5.6 `enabledDomains` / `resolveRecallScope` 与 prior 隔离

```text
resolveRecallScope 继续: jobOverride → config.enabledDomains → availableFineDomains
domainPriors 不得写入上述任一输入
无 prior 时行为与今日基线一致
```

**来源：** Plan §2.3.11 + Test Finding

---

# 6. Regression Requirement

以下为 Plan §8 之外必须补测的盲区：

| ID | Case | Expect |
|---|---|---|
| R-SUP-01 | prior 注入后检查 `resolveRecallScope` 输出 | 与无 prior 相同（除非另有合法 jobOverride） |
| R-SUP-02 | `ExtraResult` round-trip | `currentTurnDomains` / `llmCalibration` 不丢失 |
| R-SUP-03 | 非法 weight=0 / 重复 domain / 未知 domain | 清洗后不阻断；可能降为 `[]` |
| R-SUP-04 | formal FineSpan 两两区间 | `overlap count == 0` |
| R-SUP-05 | LTR + 旧 `generateGlobalWindows` production import | 不存在双入口 |
| R-SUP-06 | `contextPriorApplied` | 恒 `false` |
| R-SUP-07 | `weakDomainRecallEnabled=false` + 有 profile + 有 domainPriors | option 序只反映 domainPriors，不反映 profile |
| R-SUP-08 | 同轮无 llmCalibration、次轮到达 | merge 不误翻；主链不阻断 |
| R-SUP-09 | Vote 并列 4 域 | Node retained 可 >3；`currentTurnDomains` ≤3 且稳定序 |
| R-SUP-10 | 空票轮 | prior 不清空 |
| R-SUP-11 | Tone：选中跨界完整词 | 正式 span tone range = commit range |
| R-SUP-12 | K4 长度 | 两完整界内词同 prior 命中时，更短胜出 |
| R-SUP-13 | `domains[]` 多标签 | 不计 `domains[0]` |
| R-SUP-14 | retry 同 job payload | domainPriors 字节级一致 |
| R-SUP-15 | TS/Rust golden | 字段名/类型一致 |

**来源：** Test Finding + Architecture Drift

---

# 7. Acceptance Requirement

在 Plan §9 全部满足之外，补充：

| ID | Criterion |
|---|---|
| A-SUP-01 | Production FineSpan entry = LTR only；`globalWindowProductionPath=false` |
| A-SUP-02 | `formalOverlapCount===0` 写入 architecture compliance trace |
| A-SUP-03 | Web→Scheduler→Node→Scheduler→Web 闭环可观测 `domainPriors` / `currentTurnDomains` |
| A-SUP-04 | Option 全序用例：`[酒]|[店前台]` → commit `酒店`（cross-complete > in-span fallback） |
| A-SUP-05 | Option 全序用例：长度不胜出（两 complete 同级时更短优先） |
| A-SUP-06 | topicShift 四象限：`(topicShift, currentEvidence)` 仅 (true, true) 可走 Condition B |
| A-SUP-07 | `shouldSwitch=true` 但缺 `topicShift` → 不触发 Condition B |
| A-SUP-08 | coarse LLM primary 经 map 后 FineSpan 只见 fine priors |
| A-SUP-09 | base quota 与 other-domain exploration 在有 prior 时仍满足 §5.4 |
| A-SUP-10 | Assembly 不再依赖 overlap subset 作为正式边界消解；cap≤16 |
| A-SUP-11 | 删除清单（§1.4）在 production import graph 上不可达 |

---

# 8. Diagnostics / Trace Contract（补充钉死）

Plan §7 保留。补充强制字段：

```text
architectureCompliance:
  generatorMode = "ltr_soft_boundary"
  formalOverlapCount = 0
  beamEnabled = false
  globalWindowProductionPath = false
  schedulerDomainInference = false
  fineSpanPriorSource = "domainPriors" | "none"
  contextPriorDecisionApplied = false
  currentTurnDomainsTruncated?: boolean
  llmCalibrationPresentOnResult: boolean
```

Web merger trace 必须能区分：

```text
appliedRule ∈ {
  aggregate_only,
  condition_a_two_turn_lead,
  condition_b_llm_supported,
  rejected_llm_only,
  rejected_single_turn_new_leader,
  rejected_stale_calibration,
  no_op_empty_turn
}
```

**来源：** Plan + Design Gap（验收可回放）

---

# 9. Hidden Premises Made Explicit

以下为 Plan 隐含、现码易偏的前提，现升格为约束：

1. **「不传完整 fw_detector」≠「Node 禁止写 fw_detector」** — Node 可写诊断；协议闭环另字段。  
2. **「Scheduler registry-valid」≠「Scheduler 加载词库」** — 见 IC-2。  
3. **「LLM 标准化 topicShift」≠「删除 shouldSwitch」** — 双字段并存，职责分离。  
4. **「fallback」≠「Assembly canonical 填空」** — Generator fallback 是 cursor 推进；Assembly 空槽逻辑独立。  
5. **「Top3 currentTurnDomains」≠「Vote retainedDomains Top3」** — Vote/Assembly 可保留更多 bucket；投影层截断。  
6. **「Web Owner」≠「Node 不得有 SessionObject」** — Node Session 可存 profile/摘要；不得存 prior 决策态。  
7. **临时 option 可重叠；正式不可重叠** — Compatibility 图可辅助诊断，不得成为第二边界决策。  
8. **LTR 删除全滑窗后，120/40 truncate 预算失去对象** — 不得为保留预算而复活全滑窗。

**来源：** Hidden Premise / Architecture Drift

---

# 10. Test Blind Spots → Required Cases

| Blind spot | Required case |
|---|---|
| Plan 有 Condition A/B，缺并列 leader | `isTurnLeadTie` 不翻转 |
| Plan 有 prior soft，缺「近似」定义 | 仅全等后 prior；见 R-SUP-12 |
| Plan 写 Tone 重算，无 hook | A-SUP tone range 断言 |
| Plan 写 ExtraResult 扩展，未写封闭结构风险 | R-SUP-02 |
| Plan 写 registry-valid，Scheduler 无 registry | IC-2 + 非法 domain 清洗 |
| Plan 同包 llmCalibration 示例 | R-SUP-08 异步 |
| `shouldSwitch` vs `topicShift` | A-SUP-07 |
| retained >3 vs 投影 Top3 | R-SUP-09 |
| prior → enabledDomains 误接 | R-SUP-01 |

---

# 11. Acceptance Gap Closure Checklist

开发完成时，除 Plan §9 / §10 外必须全部勾选：

- [ ] DC-1..DC-7 无违反证据  
- [ ] IC-1..IC-6 契约测试通过  
- [ ] §4 数据投影用例通过  
- [ ] §5 全序 / fallback / tone / quota / merge 边角通过  
- [ ] R-SUP-01..15 通过  
- [ ] A-SUP-01..11 通过  
- [ ] KEEP/MODIFY/RESTORE/DELETE 完成表写入 Development Report  
- [ ] architecture compliance trace 字段齐全  

---

# 12. Final Binding Statement

```text
本 Supplement 与 Development Plan 共同构成本轮唯一开发依据。
冲突时：
  - 冻结架构 / Ownership（Web session prior）以 Plan 为准；
  - 实现歧义 / 投影算法 / 全序 / 协议挂载 / 异步语义以本 Supplement 为准；
  - 不得用本文件引入 Node Session prior 决策态或 Dual Path。
```

任何实现若重新引入：

```text
全量正式重叠滑窗
Beam / DP
Assembly 正式边界消解
prior-as-gate
profile 第二 prior
Context Prior 决策
Scheduler 领域推理
```

均视为 **架构不合规**，不得进入冻结版本。

