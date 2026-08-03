> **HISTORICAL / SUPERSEDED BY MULTI-PATH LEXICAL LATTICE / NOT RUNTIME AUTHORITY** (Step 6, 2026-07-30). SoftBoundary LTR Fine Span is deleted from runtime; see Runtime SSOT V1.2 + Lattice Architecture V1.0.0.
> **HISTORICAL / SUPERSEDED (Fine Span architecture)** — 2026-07-26  
> LTR-only / unique FormalFineSpan / cursor-commit / windows 2..5-as-SSOT claims in this document are **not** current Architecture SSOT.  
> Current authority: `FW_Repair_V4_Multi_Path_Lexical_Lattice_Architecture_V1.0.0_FROZEN.md`  
> Original text retained as historical evidence. Do not treat as active freeze.
# FW Repair V4
# FineSpan Soft Boundary + Session Domain Prior + LLM Correction
## Complete Development Plan

| Field | Value |
|---|---|
| Date | 2026-07-22 |
| Document Type | Development-ready architecture and implementation plan |
| Source Basis | Frozen architecture, historical audit conclusions, current repository state, pre-development proposal audit |
| Target Release | FW Repair V4 |
| Status | Ready for development after this document is frozen |
| Authority | Runtime SSOT / frozen FW Repair V4 architecture |
| Related Audit | `FW_Repair_V4_FineSpan_SoftBoundary_SessionDomainPrior_LLMCorrection_PreDevelopment_Audit_2026_07_22.md` |

---

# 1. Executive Decision

本轮开发采用以下**唯一方案**：

```text
FW coarse boundary remains
        ↓
coarse boundary becomes soft boundary
        ↓
utterance-global left-to-right FineSpan generation
        ↓
temporary overlapping options
        ↓
commit exactly one non-overlapping FineSpan per cursor position
        ↓
Recall candidates
        ↓
current-turn Domain Vote
        ↓
SameDomain buckets
        ↓
Sentence Assembly
        ↓
KenLM scoring
        ↓
JobResult.currentTurnDomains
        ↓
Web session state
        ↓
recent-turn aggregation + low-frequency LLM correction
        ↓
next request.domainPriors
        ↓
Scheduler validates and passes through
        ↓
Node consumes domainPriors as soft prior only
```

## 1.1 Final ownership decision

审计报告提出了 Node Session 与 Web Session 两种存储位置。本轮按照已确认的冻结设计，正式裁定：

> **Web 是 `sessionDomainPriors` 的唯一会话状态 Owner。**

理由：

1. 已冻结目标明确为 `JobResult → Web → next request → Scheduler → Node` 闭环。
2. Node 不应长期保存完整会话业务状态。
3. Scheduler 应保持无状态和零领域推理。
4. Web 已持有 `sessionId` 和当前会话生命周期。
5. 避免 Node `activeLexiconProfile` 与 Web prior 同时影响 Recall。
6. Job retry 时，prior 固化在请求 payload 中，行为可回放。
7. 多节点调度不依赖某一节点上的隐式 session state。

最终 ownership：

```text
Current-turn Domain Vote owner = Node
Session domain aggregation owner = Web
LLM semantic correction producer = existing LLM summary service
Domain prior merge final decision owner = Web
Transport validation owner = Scheduler
FineSpan prior consumption owner = Node
```

禁止同时保留 Node Session prior 和 Web prior 两套决策状态。

---

# 2. Design Constraints

## 2.1 Main-chain constraints

必须保持唯一主链：

```text
ASR / FW Raw
→ Coarse Span + Timestamp
→ FineSpan Generator
→ Pinyin / Tone / Lexicon Recall
→ Current-turn Domain Vote
→ SameDomain Buckets
→ Sentence Assembly
→ KenLM
→ JobResult
```

不得新增、恢复或保留运行中的：

- Detector 主链；
- 旧 span 主链；
- FineSpan Beam；
- 全句多路径分词；
- DP / 全局回溯；
- Shadow domain 链路；
- Node Session prior 与 Web prior 双链路；
- LLM 直接控制 FineSpan；
- Scheduler 领域推理；
- Context Prior 决策旁路；
- KenLM 领域加权旁路。

## 2.2 FineSpan constraints

1. FW coarse span 必须保留。
2. coarse boundary 作为 soft boundary，不是硬边界。
3. FineSpan 在全句连续字符/音节坐标上从左到右运行。
4. 临时 option 可以重叠。
5. 正式 FineSpan 不得重叠。
6. 每个 cursor 位置只提交一个正式 FineSpan。
7. cursor 只向前移动。
8. 跨越最多一个相邻 coarse boundary。
9. 跨越两个及以上 coarse boundary 必须拒绝。
10. 跨界 option 默认弱于等价的界内 option。
11. 跨界 option 只有形成有效完整词时才可胜出。
12. 长度本身不得成为优先理由。
13. 一个正式 FineSpan 可以保留多个 Recall candidate。
14. 第一版不实现 one-step lookahead。
15. 不把重叠消解推迟到 Assembly 或 KenLM。

## 2.3 Domain prior constraints

1. `currentTurnDomains` 表示当前句证据。
2. `sessionDomainPriors` 表示多轮会话先验。
3. 当前句 vote 不得直接覆盖会话方向。
4. prior 只能影响：
   - Recall 查询顺序；
   - domain candidate quota；
   - 同等级 FineSpan option 排序。
5. prior 不得作为允许域白名单。
6. base 候选必须始终保留。
7. 至少保留一个非 prior 领域探索配额。
8. 当前句证据必须能够推翻 prior。
9. prior 不得修改 KenLM 分数。
10. prior 不得直接建立 SameDomain bucket。
11. 不得通过 `enabledDomains` 或 `recallDomainScope` 将 prior 变成硬 gate。
12. domain 来源继续服从词库 SSOT：`domain` 与 `term_domain_tags`。
13. 同一词可有多个领域，不得读取 `domains[0]` 作为唯一领域。

## 2.4 LLM correction constraints

1. 原有 LLM 摘要功能保留。
2. LLM 保持异步、低频、非热路径。
3. LLM 只输出结构化领域校准信息。
4. LLM 不直接修改当前句 vote。
5. LLM 不直接写入 Node FineSpan。
6. LLM 不直接覆盖 `sessionDomainPriors`。
7. LLM 校准必须经 Web 端统一 merger。
8. 单次 LLM 结果不得独立触发会话领域翻转。
9. 明确话题切换至少需要当前句证据与 LLM 校准共同支持。
10. 长自然语言摘要可继续用于业务上下文，但不得作为 FineSpan 输入。

## 2.5 Protocol constraints

1. Scheduler 仍为无状态透传层。
2. Scheduler 只做 schema 校验、字段限制和透传。
3. 不在 Scheduler 聚合、衰减、投票或调用 LLM。
4. `domainPriors` 必须写入具体 job payload，保证 retry 一致。
5. 未知或非法 prior 必须降级为空数组，不得阻断任务。
6. 新增字段限制：Top 3 domains；domain 必须来自 registry；weight 在 `[0,1]`。
7. 不传完整 `fw_detector` 给 Web 作为会话状态协议。
8. 不把长摘要放入 FineSpan payload。

---

# 3. Architecture

## 3.1 End-to-end architecture

```text
┌─────────────────────────────────────────────────────────────┐
│ Web                                                         │
│ ConversationDomainState                                     │
│ ├─ recentTurnDomains[4]                                     │
│ ├─ latestLlmCalibration                                     │
│ └─ domainPriors[Top3]                                       │
│ next utterance request + domainPriors                       │
└──────────────────────────────┬──────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ Scheduler                                                   │
│ validate domainPriors                                       │
│ preserve in JobAssign / Utterance payload                   │
│ no domain inference                                         │
└──────────────────────────────┬──────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ Node                                                        │
│ ASR/FW Raw                                                  │
│ → coarse spans / boundary positions                         │
│ → LTR FineSpan Generator                                    │
│    ├─ local 2..5 temporary options                          │
│    ├─ boundaryCrossCount <= 1                               │
│    ├─ Recall + Tone + Lexicon                               │
│    ├─ domainPriors soft ranking/quota                       │
│    └─ commit one formal FineSpan                            │
│ → current-turn Domain Vote                                  │
│ → SameDomain buckets                                        │
│ → Sentence Assembly                                         │
│ → KenLM                                                     │
│ → JobResult.currentTurnDomains                              │
└──────────────────────────────┬──────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ Scheduler result mapping                                    │
│ preserve currentTurnDomains + llmCalibration                │
└──────────────────────────────┬──────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ Web merger                                                  │
│ recent vote aggregation + LLM correction                    │
│ → next sessionDomainPriors                                  │
└─────────────────────────────────────────────────────────────┘
```

## 3.2 Responsibility matrix

| Layer | Responsibility | Must not do |
|---|---|---|
| FW partition | Produce coarse spans and boundary metadata | Select final FineSpan |
| FineSpan Generator | Select non-overlapping formal FineSpan boundaries | Vote final sentence domain |
| Recall | Return lexical candidates and multi-domain tags | Decide conversation domain |
| Domain Vote | Decide current-turn domain evidence | Persist session state |
| Web Session State | Aggregate recent-turn domains | Re-run lexical recall |
| LLM Summary | Semantic correction and topic-shift detection | Control each span |
| Scheduler | Validate and pass fields | Merge or infer domains |
| Sentence Assembly | Assemble candidates from committed spans | Resolve generator overlap |
| KenLM | Score sentence candidates | Repair span boundaries |

---

# 4. Interface

## 4.1 Node request input

```ts
export interface DomainPrior {
  domain: string;
  weight: number;
}

export interface UtteranceDomainContext {
  domainPriors?: DomainPrior[];
}
```

Requirements:

- `domainPriors.length <= 3`；
- domain 必须存在于运行时 domain registry；
- 非法项丢弃；
- 缺失等同 `[]`；
- FineSpan 只读取此字段；
- 不读取 `activeLexiconProfile` 作为第二 prior。

## 4.2 Node JobResult output

```ts
export interface CurrentTurnDomain {
  domain: string;
  voteCount: number;
  normalizedScore?: number;
}

export interface LlmDomainCalibration {
  primaryDomain?: string;
  secondaryDomains?: string[];
  confidence: number;
  topicShift: boolean;
  summaryVersion: string;
  updatedAt: number;
}

export interface JobResultExtra {
  currentTurnDomains?: CurrentTurnDomain[];
  llmCalibration?: LlmDomainCalibration;
}
```

约束：

- `currentTurnDomains` 从当前 `retainedDomains` 和 `domainScores` 投影；
- Web 不解析完整 `fw_detector`；
- 不混入 session merge 结果；
- `llmCalibration` 来自既有异步摘要/intent 结果；
- 长摘要文本不进入 FineSpan 请求字段。

## 4.3 Web session state

```ts
export interface TurnDomainSnapshot {
  utteranceId: string;
  domains: CurrentTurnDomain[];
  createdAt: number;
}

export interface ConversationDomainState {
  sessionId: string;
  recentTurns: TurnDomainSnapshot[];
  llmCalibration?: LlmDomainCalibration;
  domainPriors: DomainPrior[];
}
```

硬限制：

```text
recentTurns <= 4
domainPriors <= 3
```

## 4.4 Scheduler protocol

需要同步扩展：

- Rust `ExtraResult`；
- Rust `JobAssign` / `UtteranceMessage`；
- Electron/shared TypeScript message definitions；
- Scheduler result serialization；
- Scheduler request validation。

Request wire example：

```json
{
  "utterance": {
    "domainPriors": [
      { "domain": "food_order", "weight": 0.55 },
      { "domain": "coffee", "weight": 0.30 },
      { "domain": "restaurant_service", "weight": 0.15 }
    ]
  }
}
```

Result example：

```json
{
  "extra": {
    "currentTurnDomains": [
      { "domain": "food_order", "voteCount": 3 },
      { "domain": "coffee", "voteCount": 2 }
    ],
    "llmCalibration": {
      "primaryDomain": "food_order",
      "secondaryDomains": ["coffee"],
      "confidence": 0.86,
      "topicShift": false,
      "summaryVersion": "intent-v1",
      "updatedAt": 1784721600000
    }
  }
}
```

---

# 5. Data Contract

## 5.1 `DomainPrior`

| Field | Type | Required | Constraint | Meaning |
|---|---|---:|---|---|
| `domain` | string | Yes | registry-valid | Fine domain identifier |
| `weight` | number | Yes | `0 < weight <= 1` | Relative soft prior |

Contract：

1. 最多 3 项。
2. 不允许重复 domain。
3. 重复时 Web 合并，Node 再防御性去重。
4. 权重可以不严格合计为 1，Node 归一化。
5. 无合法项时进入无 prior 基线。
6. 不允许携带 alias。
7. 不允许携带粗领域替代细领域；如 LLM 输出粗领域，必须通过既有 registry mapping 转换。

## 5.2 `CurrentTurnDomain`

| Field | Type | Required | Meaning |
|---|---|---:|---|
| `domain` | string | Yes | 当前句被保留领域 |
| `voteCount` | integer | Yes | Presence Vote count |
| `normalizedScore` | number | No | 仅诊断/排序，不替代 voteCount |

禁止：

- 将 base 写成领域票；
- 将 prior 权重混入 voteCount；
- 将 LLM confidence 写入 voteCount；
- 只返回一个 winner 丢弃并列领域。

## 5.3 `LlmDomainCalibration`

| Field | Constraint |
|---|---|
| `primaryDomain` | 可空；registry-valid |
| `secondaryDomains` | 最多 2 |
| `confidence` | `[0,1]` |
| `topicShift` | boolean |
| `summaryVersion` | 必须存在 |
| `updatedAt` | Unix milliseconds |

LLM calibration 不具备直接决策权。

## 5.4 Formal FineSpan

```ts
export interface FormalFineSpan {
  spanId: string;
  rawStart: number;
  rawEnd: number;
  syllableStart: number;
  syllableEnd: number;
  coarseSpanIds: string[];
  boundaryCrossCount: 0 | 1;
  windowSource: "in_span_window" | "boundary_window" | "fallback";
  candidates: RecallCandidate[];
  selectionReason: FineSpanSelectionReason;
}
```

Invariants：

```text
next.rawStart >= previous.rawEnd
boundaryCrossCount <= 1
rawEnd > rawStart
formal FineSpans cannot overlap
```

## 5.5 Temporary FineSpan option

Temporary option 复用现有 window descriptor，不新增复杂 path 类型：

```ts
type FineSpanOption = GlobalWindowDescriptor;
```

只补充或复用：

- `boundaryCrossCount`；
- `windowSource`；
- `rawStart/rawEnd`；
- `syllableStart/syllableEnd`；
- Recall result；
- option evaluation reason。

禁止新增：`spanPath`、`beamState`、`repairTarget`、`crossSpanCandidate`、`candidateGraph`。

---

# 6. Code Logic

## 6.1 Development Item A — LTR FineSpan Generator

### 目的

用 cursor 单向正式提交替换当前全句 2～5 音节全量重叠正式窗口，消除 Assembly 的重叠组合膨胀。

### Responsibility

唯一 Owner：FineSpan Generator。

### 输入

- raw utterance text / syllable sequence；
- coarse spans；
- coarse boundary positions；
- timestamp mapping；
- tone slices；
- `domainPriors`；
- lexicon recall interface；
- existing limits：min=2、max=5、cross<=1。

### 输出

```text
Ordered FormalFineSpan[]
```

### 最终决策位置

FineSpan Generator。Compatibility、Assembly、KenLM 不再决定正式边界。

### 与冻结架构对应关系

对应 utterance-global LTR、coarse boundary metadata、temporary overlap、formal non-overlap、no Beam。

### 逻辑

```text
cursor = utteranceStart

while cursor < utteranceEnd:
    generate local options length 2..5 from cursor
    reject options crossing >1 coarse boundary
    recall candidates for valid options
    evaluate lexical completeness
    apply boundary preference
    apply domain prior only as soft tie-break / quota input
    select exactly one option
    commit FormalFineSpan
    cursor = selected.end

    if no valid 2..5 option:
        commit deterministic fallback
        advance cursor
```

Option priority：

```text
valid complete lexicon term
>
valid recall candidate
>
fallback
```

然后比较：

```text
single complete lexical unit
>
multi-unit concatenation
>
partial fragment
```

边界优先：

```text
in-span complete term
>
boundary-cross complete term
>
in-span fallback
```

但允许：

```text
boundary-cross complete term > in-span single-character fallback
```

例：

```text
[酒] | [店前台]
酒 = fallback
酒店 = complete lexicon hit + cross 1
select 酒店
```

prior 只在前述证据相同或近似时作为 tie-break。长度只在全部前置条件等价时使用，禁止“最长窗口默认胜出”。

Fallback：允许既有被动单字 span 或最小推进单位；必须保证 cursor 前进。

Tone：正式 span 提交后，必须基于最终 range 重新确认 `WindowTimeRange → AcousticToneSlice`，不得复用被拒绝 option 的错位 tone 结果。

## 6.2 Development Item B — Formal FineSpan Candidate Pool

### 目的

把当前按 coarse span 聚合、名实不符的 pool 收敛为真正按正式 FineSpan 聚合。

### Responsibility

FineSpan candidate pool builder。

### 输入

`Ordered FormalFineSpan[]`。

### 输出

`FineSpanCandidatePool[]`，每个 pool 对应一个正式、不重叠 FineSpan。

### 最终决策位置

边界由 Formal FineSpan 决定；pool builder 不重新切边界。

### 与冻结架构对应关系

对应“一个正式 FineSpan 内允许多个 Recall candidate”。

### 逻辑

- 不再按 coarse span 作为主要 pool unit；
- coarse span ids 仅作 metadata；
- 保留候选多领域标签；
- base candidate 不产生 domain vote；
- 同一 FineSpan 多个有效 domain candidate 可参与 vote；
- 不因 prior 删除其他领域候选。

## 6.3 Development Item C — Current-turn Domain Projection

### 目的

将 Presence Vote 结果以稳定小结构返回 Web。

### Responsibility

Node JobResult assembly。

### 输入

`retainedDomains`、`domainScores`、utterance id。

### 输出

`JobResult.extra.currentTurnDomains`。

### 最终决策位置

`voteUtteranceDomainFromPool`。JobResult assembly 只投影。

### 与冻结架构对应关系

对应当前句 Domain Vote 为当前句唯一领域权威。

### 逻辑

- 保留并列最高领域；
- 保留达到冻结阈值的领域；
- 最多 Top 3；
- score 相同确定性排序；
- base 不输出；
- 多领域词按全部有效 tag 计票；
- prior 不混入 vote。

## 6.4 Development Item D — Web Session Domain State

### 目的

以最近多轮 vote 形成稳定、轻量、跨轮先验，避免单句误投票绑死会话。

### Responsibility

Web conversation session state。

### 输入

- previous state；
- latest `currentTurnDomains`；
- latest valid `llmCalibration`；
- sessionId。

### 输出

`sessionDomainPriors` / next request `domainPriors`。

### 最终决策位置

Web Domain Prior Merger，是 session prior 的唯一最终决策位置。

### 与冻结架构对应关系

对应 `JobResult → Web → next request → Scheduler → Node`。

### 状态窗口

第一版冻结：最近 4 轮、Top 3 domains，不新增可配置矩阵。

### 聚合规则

固定轮次权重：

```text
latest turn      = 4
previous turn    = 3
two turns ago    = 2
three turns ago  = 1
```

每轮贡献：

```text
domain contribution = turnWeight × normalizedCurrentTurnVote
normalizedCurrentTurnVote = voteCount / maxVoteCountOfTurn
```

单轮错误保护：新领域仅出现一轮时可以进入 Top 3 尾部，但不得直接升为第一；常规情况下需连续 2 轮支持。

话题切换条件：

```text
Condition A:
new domain leads in two consecutive currentTurnDomains
AND its recent-window aggregate exceeds old leader

Condition B:
new domain appears in current turn
AND LLM topicShift = true
AND LLM primaryDomain = new domain
AND LLM confidence >= 0.75
AND new domain appeared in at least one of previous two turns
```

LLM 不得单独切换。

State reset：新 sessionId、显式新会话、conversation reset、session expiry、切换账户时清空。不得跨 sessionId 复用。

## 6.5 Development Item E — Scheduler Protocol Pass-through

### 目的

打通 `currentTurnDomains` 返回和 `domainPriors` 回传，同时保持 Scheduler 零领域业务逻辑。

### Responsibility

Scheduler schema and serialization。

### 输入

Web request priors、Node currentTurnDomains、LLM calibration。

### 输出

Node job payload 与 Web result payload。

### 最终决策位置

无领域决策，只做 validation。

### 与冻结架构对应关系

对应 Scheduler 无状态透传原则。

### 逻辑

Request validation：Top 3、registry-valid、weight finite/positive；非法项丢弃；不记录对话全文。

Result mapping：显式加入 `currentTurnDomains`、`llmCalibration`，不透传完整 `fw_detector` 作为 session state 协议。

Retry：首次清洗后的 priors 固化到 job payload，所有 retry 使用同一 payload。

## 6.6 Development Item F — Node Prior Consumption

### 目的

让历史领域加速完整领域词识别，但不锁死新领域。

### Responsibility

FineSpan option evaluator + Recall candidate allocation。

### 输入

`domainPriors`、temporary options、Recall candidates with `domains[]`。

### 输出

prior-adjusted option ordering、prior-aware quota、diagnostics。

### 最终决策位置

FineSpan boundary 由 Generator 决定；current-turn domain 仍由 Domain Vote 决定。

### 与冻结架构对应关系

对应“上下文负责先去哪里找，Recall 负责找到了什么，FineSpan 负责在哪里切，Domain Vote 负责当前句属于哪里”。

### 逻辑

优先排序：prior-domain、base、other-domain，但禁止 option×domain 多次 SQL。优先一次 recall 返回 candidates+domains，再内存排序。

默认 quota：

```text
prior-domain candidates: up to 2
base candidates: at least 1
other-domain candidate: at least 1 when available
```

总量继续服从现有 per-span 与 sentence cap。prior 不改变 phonetic validity、tone contradiction、lexicon validity、voteCount、KenLM score。

## 6.7 Development Item G — LLM Correction Convergence

### 目的

保留 LLM 摘要能力，将其从独立 session profile 收敛为 Web prior merger 的低频纠偏输入。

### Responsibility

Existing LLM intent/summary pipeline + JobResult projection + Web merger。

### 输入

recent conversation context、available domain registry、current summary state。

### 输出

`LlmDomainCalibration`。

### 最终决策位置

LLM 只提供建议，是否应用由 Web merger 决定。

### 与冻结架构对应关系

对应 Domain Vote 高频证据 + LLM 低频纠偏。

### 修改要求

- 保留现有异步调度频率；
- 保留 bootstrap/interval/surge 触发，除非测试证明错误；
- 标准化 `topicShift`；
- 输出细领域或可确定映射的粗领域；
- 停止 `activeLexiconProfile` 对 FW Recall 的隐式直接影响；
- `lexiconSessionIntent` 可保留给 diagnostics/业务摘要；
- FineSpan 不直接读取 LLM profile；
- 不恢复 context-prior 决策链。

---

# 7. Diagnostics / Trace

## 7.1 FineSpan trace

每句记录：raw text hash、coarse spans、boundary positions、cursor、options、range、boundaryCrossCount、lexicon hit、candidate count、prior match、selected/rejected reason、formal overlap count。

示例：

```json
{
  "fineSpanTrace": {
    "rawTextHash": "...",
    "coarseSpans": [],
    "boundaryPositions": [],
    "steps": [
      {
        "cursor": 0,
        "options": [
          {
            "start": 0,
            "end": 2,
            "boundaryCrossCount": 0,
            "source": "in_span_window",
            "lexiconHit": true,
            "candidateCount": 3,
            "priorMatchedDomains": ["food_order"],
            "decision": "selected"
          }
        ],
        "selectedSpan": {
          "start": 0,
          "end": 2,
          "reason": "complete_term_prior_tiebreak"
        }
      }
    ]
  }
}
```

## 7.2 Domain prior trace

记录 input priors、normalized priors、quota、currentTurnDomains、prior 是否改变 option 顺序。不得把 prior 加入 voteCount。

## 7.3 Web merger trace

记录 sessionId hash、recent turns、LLM calibration、before/after priors、applied rule、rejected correction reason。

## 7.4 LLM trace

记录 trigger reason、summary version、domains、confidence、topicShift、registry validation、applied/rejected。常规日志不记录敏感长文本。

## 7.5 Architecture compliance trace

```text
generatorMode = ltr_soft_boundary
formalOverlapCount = 0
beamEnabled = false
globalWindowProductionPath = false
schedulerDomainInference = false
fineSpanPriorSource = domainPriors
contextPriorDecisionApplied = false
```

---

# 8. Regression

## 8.1 Baseline regression

无 prior 时必须保持 Domain Vote、SameDomain、cap16、KenLM 接口、无 LLM 降级、Scheduler 缺字段兼容。

## 8.2 FineSpan regression

1. coarse boundary 正确，不跨界。
2. coarse boundary 错误，跨一个边界。
3. 跨两个边界拒绝。
4. 临时 option 重叠。
5. 正式 span 无重叠。
6. cursor 单向推进。
7. fallback 不死循环。
8. tone range 正确。
9. 被动单字 span 保留。
10. `一杯/少冰/奶茶`。
11. `酒|店前台 → 酒店/前台`。
12. `退房|然后去机场` 不误合并。
13. 歧义句不建立 Beam。
14. 长窗口不因长度胜出。

## 8.3 Domain regression

1. base 不计票。
2. 同一 FineSpan 多 domain candidates 可投票。
3. 多领域词读取全部 `term_domain_tags`。
4. 唯一最高、并列最高、低差距规则保持。
5. prior 不改变 voteCount。
6. 当前句可推翻错误 prior。
7. other-domain exploration 保留。
8. currentTurnDomains 正确输出。

## 8.4 Session prior regression

1. 最近 4 轮聚合。
2. 单轮异常只进尾部。
3. 连续两轮新领域提升。
4. LLM 单独建议不切换。
5. LLM+当前证据可切换。
6. 新会话清空。
7. 重连/retry 一致。
8. 多 session 隔离。
9. invalid prior 清洗。
10. Top 3。
11. 权重归一化。
12. Web 不解析完整 FW diagnostics。

## 8.5 LLM regression

1. 摘要继续产生。
2. 不在 FineSpan 热路径调用。
3. 输出域 registry 校验。
4. topicShift false 不翻转。
5. topicShift true 但当前句不支持，不翻转。
6. 过期 calibration 忽略。
7. LLM 失败不阻断主链。
8. activeLexiconProfile 不再隐式影响 FW Recall。

## 8.6 Performance regression

- LTR 近似 `O(n×4)`；
- 不再建立全句正式重叠窗；
- Assembly overlap subset 显著下降；
- SQL 不因 Top3 prior 成倍增长；
- sentence candidates ≤16；
- KenLM 输入不增加；
- LLM 调用频率不增加；
- dialog_200 重放与 P50/P95 对比。

---

# 9. Acceptance Criteria

## 9.1 Functional acceptance

全部满足才通过：

1. `[酒]|[店前台]` 提交 `[酒店][前台]`。
2. 正常停顿不被无效长跨界词吞并。
3. `一杯少冰奶茶` 产生非重叠正式 FineSpan。
4. formal overlap count 恒为 0。
5. cursor 不回退、不分叉。
6. boundaryCrossCount 最大为 1。
7. 同一正式 FineSpan 可保留多个候选。
8. Domain Vote 仍基于当前句候选。
9. JobResult 到 Web 可见 currentTurnDomains。
10. Web 生成并回传 Top3 domainPriors。
11. Scheduler 完整透传且不推理。
12. Node prior 仅影响 soft ranking/quota。
13. base 与 other-domain exploration 保留。
14. 单轮错误 vote 不改写会话主方向。
15. 连续新领域证据 + LLM 可切换。
16. LLM 失败不阻断主链。
17. 无 prior 时稳定降级。
18. sentence candidate cap 仍为 16。
19. 多领域词不退化为一词一领域。
20. 旧全滑窗 production path 不再运行。

## 9.2 Data acceptance

- TS/Rust 类型一致；
- domain 经 registry 验证；
- Top3 限制；
- retry 使用相同 prior；
- current turn 与 session prior 语义不混淆；
- 不存在第二个 activeDomains 决策字段；
- trace 可回放 merge 与 span selection。

## 9.3 Performance acceptance

- 正式 FineSpan 数不高于实际 cursor 提交步数；
- Assembly overlap subset 不再是主路径；
- SQL 不超过现有硬上限；
- KenLM 候选不超过16；
- Node P95 不明显恶化；
- LLM 保持异步。

---

# 10. Architecture Compliance Criteria

## 10.1 Single-path compliance

PASS 条件：

```text
only one FineSpan production path
only one session prior source enters Node
only one current-turn Domain Vote
only one Web merger
```

失败条件：

- 新 LTR 与旧 global windows 同时运行；
- Web prior 与 Node active profile 同时调整 Recall；
- Context Prior 再参与决策；
- Scheduler 合并领域。

## 10.2 Responsibility compliance

| Decision | Required owner |
|---|---|
| Coarse boundary | FW partition |
| Formal FineSpan boundary | LTR FineSpan Generator |
| Lexical candidates | Recall |
| Current-turn domains | Domain Vote |
| Session prior | Web merger |
| LLM correction | LLM output + Web merger application |
| Request validation | Scheduler |
| Sentence ranking | KenLM |

任一层越权即失败。

## 10.3 SSOT compliance

- domain registry 来自词库/运行时 registry；
- term-domain 多对多来自 `term_domain_tags`；
- 不通过 config alias 重建领域 SSOT；
- 不假设一词一领域；
- LLM 不得自造未注册 domain。

## 10.4 Complexity compliance

- 无 Beam；
- 无 DP；
- 无全句多路径；
- 无正式重叠 span；
- 无 option×domain 成倍 SQL；
- 不把组合爆炸转移给 Assembly/KenLM。

## 10.5 Compatibility compliance

项目尚未上线：不保留旧错误 production 兼容链，不增加 shadow fallback。测试 fixture 可用于对比，但 production entry 必须只指向新链路。

---

# 11. KEEP / MODIFY / RESTORE / DELETE

## 11.1 KEEP

1. `partitionCoarseSpans`。
2. `boundaryCrossCount` / `windowSource`。
3. `maxBoundaryCrossCount=1`。
4. `recallTopKForWindows` / `recallSpanTopKV3`。
5. Tone timestamp 主链。
6. `voteUtteranceDomainFromPool`。
7. SameDomain bucket 规则。
8. Sentence cap 16。
9. KenLM scoring 职责。
10. 异步 LLM summary/intent 服务。
11. `context-prior.ts` diagnostics-only。
12. `term_domain_tags` 多领域 SSOT。
13. Job retry 机制。
14. Web `sessionId` 生命周期。

## 11.2 MODIFY

1. `generate-global-windows.ts` → LTR option generation + formal commit。
2. `buildFineSpanCandidatePool` → formal-FineSpan pool。
3. Compatibility relation usage → 不再承担 overlap 决策。
4. `buildSentenceCandidates` → 输入已不重叠 FineSpan，移除 overlap subset 主路径。
5. Node JobResult assembly → currentTurnDomains / llmCalibration。
6. Scheduler Rust `ExtraResult`。
7. Scheduler `JobAssign` / `UtteranceMessage`。
8. Shared TypeScript messages。
9. Web conversation state + merger。
10. Node Recall ordering/quota。
11. LLM intent output 标准化 topicShift。
12. `activeLexiconProfile` 停止影响 FW Recall。

## 11.3 RESTORE

不恢复旧链路。只恢复并明确以下设计语义：

1. LLM 摘要作为低频纠偏。
2. coarse boundary 的停顿参考价值。
3. base/domain 动态平衡。
4. 当前句证据优先于历史上下文。
5. `term_domain_tags` 多领域读取。

不得恢复 old detector、old Beam、old overlapping formal span、VoteMass、context prior gate、Node hidden session prior。

## 11.4 DELETE

1. `generateGlobalWindows` 全量重叠 production 调用。
2. 只服务全量正式重叠窗的 truncate/预算逻辑。
3. Assembly `allNonOverlapSubsets` 或等价 overlap 枚举主路径。
4. 旧滑窗与新 LTR 双运行开关。
5. Node `activeLexiconProfile → FW Recall` 隐式接线。
6. Web prior + Node prior 双重加权。
7. Scheduler 领域 merge 尝试。
8. Context Prior 决策旁路。
9. `domains[0]` 一词一领域读取。
10. 只服务旧 overlap path 的过时测试/配置。
11. `repair_target` / span path / beam state 兼容代码。
12. 不可达旧 Detector/Beam production import。

Archive 文件可保留，但不得被 production import。

---

# 12. Target List

## P0 — Protocol and ownership freeze

- [ ] 冻结 Web 为 session prior 唯一 owner。
- [ ] 冻结三个 contract。
- [ ] 扩展 Scheduler request/result schema。
- [ ] 建立 TS/Rust contract tests。
- [ ] 明确 activeLexiconProfile 不再影响 FW。

## P1 — Web prior closed loop

- [ ] Web 接收 currentTurnDomains。
- [ ] 最近4轮环形缓冲。
- [ ] deterministic merge。
- [ ] LLM correction 接入。
- [ ] Top3 domainPriors 回传。
- [ ] session reset/isolation。
- [ ] retry consistency。

## P2 — Node prior soft consumption

- [ ] request bind。
- [ ] registry validation。
- [ ] candidate ordering。
- [ ] base guaranteed quota。
- [ ] other-domain exploration。
- [ ] no vote contamination。
- [ ] trace。

## P3 — LTR FineSpan

- [ ] continuous utterance coordinate。
- [ ] local 2～5 options。
- [ ] soft boundary cross≤1。
- [ ] lexical completeness evaluation。
- [ ] one formal commit。
- [ ] fallback progression。
- [ ] tone range recomputation。
- [ ] formal overlap assertion。

## P4 — Pool / Assembly convergence

- [ ] pool 按 formal FineSpan。
- [ ] Domain Vote input 对齐。
- [ ] Assembly 不再消解 overlap。
- [ ] 删除 overlap subset 主路径。
- [ ] cap16 保持。
- [ ] KenLM 接口不变。

## P5 — LLM convergence

- [ ] calibration 标准化。
- [ ] topicShift。
- [ ] registry mapping。
- [ ] 移除 FW hidden profile influence。
- [ ] failure degradation。
- [ ] trace。

## P6 — Cleanup and freeze

- [ ] 删除旧 global window production path。
- [ ] 删除双 prior。
- [ ] 删除过时 tests/config。
- [ ] 更新 SSOT 文档。
- [ ] dialog_200。
- [ ] architecture compliance audit。

---

# 13. Check List

## Design

- [ ] 唯一 LTR FineSpan 主链。
- [ ] soft boundary。
- [ ] formal FineSpan 不重叠。
- [ ] 无 Beam/DP/path search。
- [ ] Web 唯一 session prior owner。
- [ ] Scheduler 零业务推理。
- [ ] LLM 只低频纠偏。

## Interface

- [ ] TS/Rust schema 一致。
- [ ] currentTurnDomains 到 Web。
- [ ] domainPriors 到 Node。
- [ ] Top3 校验。
- [ ] invalid prior 降级。
- [ ] retry payload 固化。

## Code logic

- [ ] cursor 单向推进。
- [ ] 每 cursor 只提交一个 span。
- [ ] cross≤1。
- [ ] 跨界仅完整词可胜出。
- [ ] 长度不默认优先。
- [ ] prior 只弱排序。
- [ ] base 保留。
- [ ] other-domain exploration 保留。
- [ ] current vote 不混入 prior。
- [ ] tone range 使用最终 span。

## Diagnostics

- [ ] option trace。
- [ ] selected/rejected reason。
- [ ] overlap count。
- [ ] input/output prior。
- [ ] Web merge rule。
- [ ] LLM correction applied/rejected。
- [ ] architecture flags。

## Cleanup

- [ ] 旧 global windows 不再 production 调用。
- [ ] Assembly overlap subset 删除。
- [ ] Node profile 不再隐式 prior。
- [ ] 无 dual path。
- [ ] 无 domains[0]。
- [ ] 无新增配置冗余。

---

# 14. Regression List

## FineSpan

- [ ] `[酒]|[店前台]`
- [ ] `[我要退房]|[然后去机场]`
- [ ] `一杯少冰奶茶`
- [ ] 多个界内完整词
- [ ] 跨两个边界
- [ ] 无词库命中 fallback
- [ ] 单字语气词
- [ ] timestamp/tone alignment
- [ ] max-length 5
- [ ] cursor end condition
- [ ] no overlap assertion

## Domain Vote

- [ ] base no vote
- [ ] multi-domain term
- [ ] tied top domains
- [ ] proportional retained buckets
- [ ] prior does not alter vote
- [ ] current evidence overrides bad prior

## Web prior

- [ ] one bad turn
- [ ] two-turn topic shift
- [ ] LLM agrees
- [ ] LLM conflicts
- [ ] topicShift without current evidence
- [ ] stale calibration
- [ ] new session reset
- [ ] concurrent session isolation
- [ ] malformed prior
- [ ] retry consistency

## Protocol

- [ ] ExtraResult serialization
- [ ] JobAssign serialization
- [ ] unknown field behavior
- [ ] backward missing-field behavior
- [ ] Top3 size
- [ ] registry validation
- [ ] TS/Rust golden fixtures

## Performance

- [ ] SQL count
- [ ] FineSpan count
- [ ] Assembly candidate count
- [ ] KenLM input ≤16
- [ ] Node P50/P95
- [ ] dialog_200
- [ ] no LLM hot-path call

---

# 15. Development Order

```text
Phase 1  Freeze interfaces and ownership
Phase 2  Open Scheduler/Web/Node prior protocol
Phase 3  Implement Web merger and request round-trip
Phase 4  Implement Node soft prior consumption
Phase 5  Replace global windows with LTR FineSpan
Phase 6  Converge pool and Assembly
Phase 7  Integrate LLM calibration and cut hidden profile influence
Phase 8  Delete old paths
Phase 9  Regression + dialog_200 + architecture audit
Phase 10 Freeze documents and contracts
```

不允许先保留旧 global windows 作为 fallback 再上线新 LTR。开发分支中可短暂存在未接线实现，但最终合并前只能有一个 production entry。

---

# 16. Development Completion Deliverables

开发完成必须输出：

1. Development Report；
2. Test Report；
3. Protocol Contract diff；
4. Runtime trace examples；
5. Deleted code inventory；
6. KEEP/MODIFY/RESTORE/DELETE completion table；
7. dialog_200 comparison；
8. performance comparison；
9. Architecture Compliance Audit；
10. updated Runtime SSOT / interface documentation。

---

# 17. Final Frozen Statement

```text
Utterance-global LTR FineSpan
+
FW coarse boundary as soft pause metadata
+
temporary overlapping options
+
one non-overlapping formal FineSpan per cursor
+
current-turn Domain Vote on Node
+
recent-turn Session Domain Prior on Web
+
Scheduler validation and pass-through only
+
LLM summary as low-frequency correction
+
single unified domainPriors input to Node
+
no Beam
+
no global multi-path search
+
no dual prior
+
no overlap resolution in Assembly
```

最终职责：

```text
Current sentence evidence: Node Domain Vote
Conversation memory: Web Session Domain State
Semantic correction: LLM Calibration
Transport: Scheduler
Span decision: LTR FineSpan Generator
Sentence scoring: KenLM
```

任何偏离上述 ownership 的实现均视为架构不合规，不得进入冻结版本。

