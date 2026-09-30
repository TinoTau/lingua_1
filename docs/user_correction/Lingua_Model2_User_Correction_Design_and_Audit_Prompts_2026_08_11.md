# Lingua 用户手动纠错 + Model2 完整方案与开发前审计提示词

日期：2026-08-11

## 1. 冻结目标

在不改变已经冻结的节点端 ASR 后处理主链的前提下，新增两项能力：

1. 用户手动纠错数据闭环；
2. Model2：独立于 Lexicon Exact Recall 的 User-Conditioned Fuzzy Recall。

Model2 只负责在 Fine Span Sliding Window 阶段扩大候选召回，不负责最终纠错决策。

节点端唯一主链继续保持：

```text
ASR
→ Tone / Timestamp
→ Fine Span Sliding Window
→ Candidate Recall
→ Domain Vote
→ SameDomain Bucket
→ Sentence Assembly
→ KenLM
→ downstream
```

Candidate Recall 扩展为：

```text
Fine Span Batch
├─ Lexicon Exact Recall
└─ Model2 User-Conditioned Fuzzy Recall
      ↓
Candidate Merge
      ↓
继续唯一现有主链
```

禁止引入第二条完整后处理链、Shadow pipeline、新 Detector、新 Beam、Model2 最终决策、Model2 独立 Domain Vote / Sentence Assembly / KenLM。

---

## 2. 数据 Ownership

### Web Server

Runtime UserProfile SSOT。

- 长期保存当前用户的 bounded UserProfile；
- 不保存完整 CorrectionHistory；
- session start 时把 UserProfile 一次性发送给 Scheduler；
- 接收 Scheduler 返回的 ProfileDelta 并更新 UserProfile。

### Scheduler / Operator Server

CorrectionHistory / Training Source Data SSOT。

- 接收用户纠错；
- 保存 CorrectionEvent；
- 做必要 span alignment / normalization；
- 生成 ProfileDelta；
- 构建 Model2 训练集；
- 负责 Global Model2 的训练、评估和发布。

### Node

只做 session-level 临时消费。

- session start 接收 bounded UserProfile；
- 放入 session memory；
- Model2 推理时读取；
- session end 删除；
- 不长期保存用户画像或纠错历史。

---

## 3. UserProfile 原则

CorrectionHistory 可以持续增长，但 Runtime UserProfile 必须严格 bounded，不得随历史记录线性增长。

建议 V1 上限：32 KB。

UserProfile 只保存与 fuzzy recall 有直接关系的运行时条件：

```text
phonetic_bias
  n/l
  z/zh
  c/ch
  s/sh
  an/ang
  en/eng
  in/ing
  ...

tone_bias
  tone confusion weights

personal_terms
  bounded Top-K

confusion_bias
  bounded Top-K

domain_bias
  bounded Top-K

schema_version
profile_version
```

低频、长期未使用项目通过 decay / merge / Top-K 淘汰。

---

## 4. Model2 定义

**Model2 = User-Conditioned Fuzzy Recall Model**。

它不是用户专属模型，不是 Seq2Seq 整句纠错器，也不是第二个 ASR。

统一维护一个 Global Model2：

```text
Global Model2
+
Runtime UserProfile
```

同一个模型权重面对不同 UserProfile，产生不同候选排序。

### 输入

```text
Span Batch
Local Context
Pinyin / Phonetic Features
Tone Features
UserProfile
可选 Domain Context
```

### 输出

```text
per-span Top-K candidate spans
candidate score
source=model2
```

建议每 span Top-K <= 3。

### 原理

```text
Span / Context Encoder
          +
Phonetic / Tone Features
          +
UserProfile Encoder
          ↓
Conditioned Query Representation
          ↓
Candidate Retrieval / Ranking
          ↓
Top-K fuzzy candidates
```

UserProfile 是 condition / bias，而不是答案。

模型学习：

```text
不同用户参数
→ 如何改变 phonetic / context evidence 的权重
→ 如何改变 candidate ranking
```

而不是：

```text
user_id → specific answer
```

---

## 5. 性能架构

禁止 per-span sequential inference。

正确方式：

```text
Utterance
→ Fine Span Batch
   ├─ Lexicon batch recall
   └─ Model2 one batch inference
→ Candidate Merge
```

Model2 与 Lexicon Recall 在逻辑上独立，运行上尽量并行。

建议 V1 性能预算：

```text
1 Model2 batch inference / utterance
bounded spans / utterance
Top-K <= 3 / span
UserProfile <= 32 KB
UserProfile transfer = once / session
Node persistence = 0
model target size: preferably <100 MB
latency target: tens of milliseconds; final Gate by real-node benchmark
```

Model2 失败时，只把该 candidate source 视为空，Existing Exact Recall 继续运行；不得建立 fallback 主链。

---

## 6. 手动纠错数据链

```text
Web Manual Correction UI
        ↓
Correction API
        ↓
Scheduler CorrectionEvent Store
        ↓
Span Alignment / Normalization
        ├─→ ProfileDelta → Web Server UserProfile
        └─→ TrainingSample Builder
                     ↓
                 Model2 Dataset
```

### CorrectionEvent V1

至少包含：

```text
event_id
user_id
session_id
utterance_id
asr_text
system_text
corrected_text
correction spans
必要 pinyin/tone/span context
domain context
pipeline/model version
created_at
```

不得为了“以后可能用”保存整个 JobResult 副本。

---

## 7. TrainingSample V1

Model2 不训练：

```text
错误整句 → 正确整句
```

而训练：

```text
Input:
  ASR span
  local context
  pinyin/tone

Condition:
  UserProfile
  optional domain context

Target:
  correct candidate / NO_MATCH

Metadata:
  user/speaker group
  term
  domain
  real/synthetic
  generator/data version
```

训练集必须有：

- Positive；
- Negative / NO_CHANGE；
- Hard Negative。

---

## 8. 数据来源

### Synthetic 冷启动

```text
Corpus
→ TTS / pronunciation perturbation
→ Existing ASR
→ real ASR error distribution
→ TrainingSample
```

可注入口音和发音扰动：

```text
n/l
z/zh
c/ch
s/sh
an/ang
en/eng
in/ing
d/t
b/p
g/k
tone confusion
弱读
吞音
连读
语速变化
```

优先让扰动音频真正跑过当前 ASR，而不是仅人工制造错误文字。

### Real Data

真实用户 CorrectionEvent 持续进入 Scheduler，逐步成为真实 distribution anchor。

Synthetic 与 Real 必须分开标记和分开评估。

---

## 9. Model2 Anti-Demo 训练与验证原则

### 必须 group-disjoint

至少：

```text
Train Users != Validation Users != Test Users
```

并建立：

```text
unseen user
unseen term
unseen user + unseen term
unseen domain
```

测试。

不得把 user_id 直接作为可记忆 embedding 条件。

### Ablation / Parameter Sensitivity

正式测试：

```text
Full Profile
Empty Profile
Wrong Profile
Randomized Profile
without Tone
without Context
without Phonetic
```

若 Profile 有无结果几乎相同，说明模型没使用个性化条件。

若小幅改变 Profile 导致输出完全翻转，说明 UserProfile 权重过大。

### 核心指标

```text
Candidate Recall@1
Candidate Recall@3
Candidate Recall@5
No-Match False Positive Rate
Wrong Candidate Injection Rate
Unseen-User Recall@K
Unseen-User + Unseen-Term Recall@K
P50/P95 latency
RSS / model size
```

Model2 的主要目标是 Recall，不要求自身直接产生最终正确句。

---

## 10. 推荐开发阶段

### Phase 0 — Scheduler + Web Pre-development Audit

确认身份、session、utterance、API、持久化、session bootstrap、Node assignment、domain prior transport、模型发布机制。

### Phase 1 — Freeze Data Contracts

冻结：

```text
CorrectionEvent V1
UserProfile V1
ProfileDelta V1
Model2RecallRequest V1
Model2RecallResult V1
```

### Phase 2 — Web Manual Correction

实现 UI、提交、幂等、失败处理。

### Phase 3 — Correction Persistence + ProfileDelta

Scheduler 保存纠错事实并产生 bounded ProfileDelta；Web Server 更新 UserProfile。

### Phase 4 — Dataset Builder

CorrectionEvent → span alignment → TrainingSample；并建立 synthetic pipeline。

### Phase 5 — Generic Model2 Baseline

先证明没有 UserProfile 时 Generic Fuzzy Recall 能工作。

### Phase 6 — User-Conditioned Model2

再加入 UserProfile conditioning。

### Phase 7 — Generalization Acceptance

完成 user-disjoint / term-disjoint / domain-disjoint / hard-negative / ablation / runtime benchmark。

### Phase 8 — Node Integration

只接入 Fine Span Batch 并行 candidate source；其余冻结节点主链不动。

### Phase 9 — End-to-End Regression / Freeze

运行已有 dialog regression + Model2 专用测试集，确认最终质量、误修率和性能净收益。

---

# Scheduler 开发前代码审计提示词

```text
# Lingua User Manual Correction + Model2 — Scheduler 开发前代码审计

请对当前 Lingua 调度服务器代码进行一次只读开发前架构审计。
不要修改任何代码、配置、数据库或文档。

本轮目标不是重新设计 ASR 后处理，而是确认 Scheduler 是否能够支持：

1. 用户手动纠错数据集中保存；
2. CorrectionEvent 标准化与训练数据沉淀；
3. 根据 CorrectionEvent 计算 ProfileDelta 并返回 Web Server；
4. session start 时把 Web Server 提供的 bounded UserProfile 转发给 assigned Node；
5. Scheduler 不作为 Runtime UserProfile SSOT；
6. 后续运营方统一训练、发布 Global Model2。

## A. 冻结节点端约束

当前唯一主链保持：

ASR
→ Tone / Timestamp
→ Fine Span Sliding Window
→ Candidate Recall
→ Domain Vote
→ SameDomain Bucket
→ Sentence Assembly
→ KenLM
→ downstream

新 Model2 只允许作为 Fine Span Sliding Window 的并行 candidate source：

Fine Span Batch
├─ Lexicon Exact Recall
└─ Model2 User-Conditioned Fuzzy Recall
   ↓
Candidate Merge
   ↓
继续现有唯一主链

禁止：
- 第二条完整 ASR 后处理链；
- Shadow / Compatibility pipeline；
- 新 Detector；
- 新 Beam；
- Model2 最终纠错；
- Model2 独立 Domain Vote / Sentence Assembly / KenLM。

## B. Scheduler 目标 ownership

Scheduler：
- CorrectionHistory / Training Source Data SSOT；
- CorrectionEvent persistence；
- 必要 span alignment / normalization；
- ProfileDelta calculation；
- Model2 training/export/version distribution 的运营侧边界。

Web Server：
- Runtime UserProfile SSOT。

Node：
- session-only UserProfile cache；
- 不长期持久化用户画像。

## C. Web → Scheduler 审计

完整追踪：
- 当前 Web 调 Scheduler 的入口；
- authentication / user identity；
- user_id / session_id / utterance_id 的生成与 ownership；
- 当前 feedback / correction / transcript update 接口；
- controller/service/repository 边界；
- schema validation；
- retry / idempotency；
- error handling。

判断新增 submitCorrection / CorrectionEvent API 最自然的位置。

## D. Scheduler Persistence 审计

确认：
- 数据库类型；
- repository/data-access 架构；
- conversation/session/utterance 数据结构；
- logging/trace/feedback/training 类存储；
- CorrectionEvent 新增 ownership；
- 与 runtime log / JobResult 是否产生重复存储。

不得建议保存整个 JobResult 作为 correction history。

## E. Scheduler → Node Session Transport

完整追踪：
- Node selection；
- session affinity；
- session bootstrap；
- Scheduler → Node 调用协议；
- session metadata；
- 当前 domain prior/topN 的传递路径；
- Node 如何感知 session start/end；
- 是否已有 session-context contract 可承载 UserProfile；
- 当前是否每 utterance 重复发送 session metadata。

目标：

Web Server
→ session start
→ Scheduler
→ assigned Node
→ Node session memory

UserProfile 一次/session，而不是每 utterance 重复发送。

## F. JobResult Consumer Audit

JobResult 已冻结为跨服务传输封装，不作为单服务内部数据对象。

如果必须修改 JobResult 才能传 UserProfile，必须先列出：
- all producers；
- all consumers；
- serialization/deserialization；
- Web/Scheduler/Node/NMT/TTS 等依赖；
- tests；
- compatibility risk。

优先寻找现有 session metadata/context contract，不得直接修改 JobResult。

## G. User Data SSOT Conflict Audit

检查是否已经存在：
- Scheduler 长期 UserProfile；
- Node 用户 profile persistence；
- Web 无用户持久化能力；
- 同一用户画像多个 SSOT；
- correction history 多份持久化。

目标 SSOT：
Scheduler = CorrectionHistory / Training Source
Web Server = Runtime UserProfile
Node = Session-only cache

## H. Model Distribution Reuse Audit

只审计已有基础设施，不开发模型。

确认：
- Scheduler 当前模型版本管理；
- Node 当前模型下载/更新；
- manifest/hash/version；
- 是否可以复用现有模型分发机制；
- 是否需要独立 Model2 metadata contract；
- 是否存在不必要的 per-user model infrastructure。

禁止设计每用户独立模型。

## I. 目标 Contract

评估以下最小 contract 在现有代码中的合理位置：

CorrectionEvent
UserProfile
ProfileDelta
Model2VersionMetadata

Runtime UserProfile 必须 bounded，按 32 KB V1 目标评估。

CorrectionHistory 可增长，但 Runtime UserProfile 不得线性增长。

## J. 风险/冗余搜索

主动搜索：
Shadow
Compatibility
Legacy
Deprecated
Fallback
Bypass
Hidden Gate
Dead Feature
Duplicate ownership
Duplicate persistence
Cross-service contract leakage

所有发现分类：
KEEP
MODIFY
ADD
DELETE
CONFLICT
DEFER

## K. 输出报告

生成：
Lingua_User_Correction_Model2_Scheduler_PreDevelopment_Audit_2026_08_11.md

报告必须包括：
1. Executive Summary
2. Current Scheduler Architecture
3. Web → Scheduler Call Chain
4. Scheduler Persistence Architecture
5. Scheduler → Node Session Call Chain
6. User / Session / Utterance Identity Ownership
7. Current Context / Domain Prior Transport
8. JobResult Consumer Audit
9. Proposed CorrectionEvent Ownership
10. Proposed UserProfile Transport Path
11. Model Distribution Reuse Analysis
12. Data SSOT Analysis
13. Conflict / Redundancy / Legacy Findings
14. KEEP / MODIFY / ADD / DELETE / DEFER Matrix
15. Target File List
16. Target Interface List
17. Target Data Structure List
18. Risks
19. Development Preconditions
20. Recommended Development Sequence
21. Acceptance Checklist

不要修改代码。
不要生成兼容双链路。
不要偏离冻结节点端架构。
```

---

# Web / Web Server 开发前代码审计提示词

```text
# Lingua User Manual Correction + UserProfile — Web 开发前代码审计

请对当前 Lingua Web 前端及 Web Server 进行一次只读开发前代码审计。
不要修改代码、配置、数据库或文档。

目标是确认现有 Web 架构如何支持：
- 用户手动纠错 UI；
- CorrectionEvent 提交；
- Runtime UserProfile 长期保存；
- ProfileDelta 合并；
- session start 时把 UserProfile 一次性发送给 Scheduler；
- Browser 不作为 UserProfile 权威持久化层；
- Web Server 不保存完整 CorrectionHistory。

## A. 冻结 ownership

Web Server：
Runtime UserProfile SSOT。

Scheduler：
CorrectionHistory / Training Source Data SSOT。

Node：
session-only UserProfile temporary cache。

Browser：
UI state only。

Global Model2：
运营方统一维护，不存在 per-user model。

## B. Current Result Rendering Flow

完整追踪：

audio input
→ request
→ Scheduler
→ Node
→ result
→ Web display

确认：
- ASR / final recognized text 在哪个组件展示；
- utterance_id 是否能追踪至 UI；
- 是否已有 transcript edit / retry / feedback；
- 当前 message state/store；
- 如何在不破坏现有对话流程的情况下进入 correction mode；
- 如何同时保留 system_text 和 corrected_text；
- 是否存在修改文本覆盖原始系统事实的风险。

目标：
用户可以对一次 utterance 的最终识别文本编辑并显式确认。

不要设计自动纠错 UI。

## C. User Persistence Audit

确认：
- 用户账户体系；
- user_id；
- auth/session；
- Web Server 数据库；
- user preference/profile/settings 表；
- repository/service；
- UserProfile 独立字段/表的合理位置；
- profile_version；
- 多设备读取一致性。

UserProfile 必须 bounded，V1 按 32 KB 上限评估。

禁止：
- Cookie 作为 UserProfile SSOT；
- localStorage / IndexedDB 作为权威长期存储；
- Web 保存完整 CorrectionHistory；
- UserProfile 随 correction history 无限增长。

## D. Correction Submission

审计 Web Server → Scheduler API client。

目标新增/复用：
submitCorrection()

请求必须能关联：
user_id
session_id
utterance_id
asr/system text
corrected text
必要 context/version

Scheduler 返回：
ProfileDelta

Web Server：
validate version
→ merge ProfileDelta
→ persist UserProfile

重点检查：
- retry；
- idempotency；
- concurrent corrections；
- multiple tabs；
- multiple devices；
- version conflict；
- duplicate delta application。

优先复用现有简单事务/version 机制，不要新建复杂事件系统。

## E. Session Bootstrap

审计：
Browser
→ Web Server
→ Scheduler
→ Node

确认：
- session start 真实入口；
- domain prior/topN 当前在哪里生成；
- UserProfile 最自然附加位置；
- 是否可以只在 session start 发送一次；
- 当前是否每 utterance 重复发送 context；
- 是否存在 Web Server 绕过 Scheduler 直接调用 Node。

目标：
Runtime UserProfile 在 session start 一次进入 runtime session。

## F. UserProfile V1

基于现有代码评估最小结构：

schema_version
profile_version
phonetic_bias
tone_bias
personal_terms
confusion_bias
domain_bias

不要加入：
年龄
性别
职业
地理信息
完整 correction list
与 fuzzy recall 无直接关系的用户画像。

## G. ProfileDelta Update Flow

评估：

current UserProfile
+
Scheduler ProfileDelta
→ new UserProfile

重点确认：
- optimistic version check；
- repeated request；
- stale delta；
- conflict handling。

不要把 parameter extraction 复杂规则放到 Browser 前端。

## H. Node Boundary

本轮不修改 Node。

Web 只负责向 Scheduler 提供 session UserProfile。

禁止：
- Web 直接调用 Model2；
- Web 自己做 candidate recall；
- Web 保存 Node-specific runtime state；
- Web 参与 Domain Vote / Candidate Merge；
- Web 复制节点端 ASR 后处理。

## I. Legacy / Conflict Audit

搜索：
Legacy
Deprecated
Compatibility
Fallback
Shadow
Bypass
old feedback
old correction
user preference
profile
personalization
transcript edit
retry/rewrite

识别任何与新 ownership 冲突的历史实现。

所有发现分类：
KEEP
MODIFY
ADD
DELETE
CONFLICT
DEFER

## J. 输出报告

生成：
Lingua_User_Correction_UserProfile_Web_PreDevelopment_Audit_2026_08_11.md

报告必须包括：
1. Executive Summary
2. Current Browser/Web Architecture
3. Current Result Rendering Flow
4. Current Session Lifecycle
5. Current User Persistence
6. Existing Feedback/Correction Features
7. Proposed Manual Correction UI Location
8. Correction API Integration Point
9. UserProfile Storage Location
10. ProfileDelta Update Flow
11. Session Bootstrap Integration
12. Multi-device / Version Handling
13. Data Ownership / SSOT Check
14. Conflict / Redundancy / Legacy Findings
15. KEEP / MODIFY / ADD / DELETE / DEFER Matrix
16. Target File List
17. Target Component List
18. Target API List
19. Target Data Structures
20. Risks
21. Development Preconditions
22. Recommended Development Sequence
23. Acceptance Checklist

不要修改代码。
不要生成新主链。
不要把 UserProfile 放进 Browser Cookie。
不要在 Web 保存完整 correction training set。
不要设计 per-user model。
```
