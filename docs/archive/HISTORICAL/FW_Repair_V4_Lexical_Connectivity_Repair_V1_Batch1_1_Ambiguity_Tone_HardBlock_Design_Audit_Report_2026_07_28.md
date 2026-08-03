<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: CURRENT SSOT + Acceptance Records
Archive Path: docs/archive/HISTORICAL/FW_Repair_V4_Lexical_Connectivity_Repair_V1_Batch1_1_Ambiguity_Tone_HardBlock_Design_Audit_Report_2026_07_28.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: CURRENT SSOT + Acceptance Records

# FW Repair V4 — Lexical Connectivity Repair V1 · Batch 1.1 Ambiguity / Tone / Hard-block Design Audit

| Field | Value |
|-------|-------|
| Date | 2026-07-28 |
| Stage | **Stage 1 — Design Audit only** |
| Code changes | **None** |
| Patches | **None** |
| Batch 2 | **Forbidden** |
| Prerequisite | Batch 1.0C Base Length-1 Runtime Gate = **PASS** |

---

## 1. Executive Summary

在真实 Runtime 已打通的前提下，本轮只读审计确认三个缺陷均有**唯一 Root Cause**、**唯一 Owner**、且可拆成互不跨层的 Repair：

| ID | Defect | Root Cause (one-line) | Sole Owner | Priority |
|----|--------|----------------------|------------|----------|
| **A1** | LIMIT=8 → false unique | 截断后的 residual singleton 被当成「语义唯一」 | **Recall**（length=1 歧义决议） | P0 |
| **A2** | surface rank9 unreachable | Surface exact 仅在 post-LIMIT 集合内搜索，无独立 surface 查询 | **Recall**（surface exact） | P0 |
| **B** | tone unsupported → plain fallback | length=1 把「capability 关闭」与「无 tone pattern」并入同一 plain 分支，且 stage 标成 `plain_only_no_pattern` | **Recall**（tone gate） | P1 |
| **C** | `…` / `……` 未 hard-block | Lattice HB 正则未收录省略号；ASCII `...` 因含 `.` 反而会 block | **Lattice Hard-block** | P1 |

**Stage 1 Verdict:**

```text
BATCH 1.1 DESIGN AUDIT:
PASS

THREE DEFECTS — ROOT CAUSE / OWNERSHIP / REPAIR SPLIT CLEAR
NO CODE CHANGED
READY FOR STAGE 2 ONLY AFTER EXPLICIT DEVELOPMENT PROMPT
```

---

## 2. Current Status

### 2.1 Confirmed by Batch 1.0C (real Runtime)

```text
Temp SQLite → LexiconRuntimeV2 → recallSpanTopKV2 → Candidate → Edge → Path
```

| Observation artifact | Key fact |
|----------------------|----------|
| `lattice_v1_batch1_0c/length1_limit8_real_sqlite_baseline.json` | DB=9 → Runtime=8 → eligible=1 → Candidate=1（**捌**）；`observedFalseUnique=true`；rank9 **玖** unreachable |
| `lattice_v1_batch1_0c/length1_tone_unsupported_baseline.json` | `supportsToneFirstRecall=false` + pattern 存在 → **plain fallback** → `我`；stage=`plain_only_no_pattern` |

### 2.2 Why these designs existed (before judging “bug”)

| Area | Why it was written this way |
|------|------------------------------|
| LIMIT=8 | CR 1.0.2 / Batch 1 意图：为歧义检测取「一小窗」候选，再 cap=1；注释写明 *SQL fetch window for ambiguity detection*。设计目标是**保守歧义**，不是 Top1-by-prior。 |
| Unique after filter | 「仅 1 个 eligible → 唯一」在**全量可见**时合理；实现未区分「真唯一」与「截断后看起来唯一」。 |
| Surface exact | 允许在同音多候选时用 `windowText` 消歧（Batch 1 规格）；但消歧范围被错误地绑在同一 SQL LIMIT 窗口上。 |
| Tone unsupported → plain | length=1 复用了 2–5 collector 的 `toneActive = key && supportsToneFirstRecall()` 布尔门；`!toneActive` 一律走 plain，把「无 pattern」与「有 pattern 但 Runtime 无 tone 列」混成一类。 |
| Hard-block 省略号缺失 | CR 1.0.2 只改「邻接句界允许 / 窗内句界仍 block」；标点集合沿用既有 `PUNCTUATION_RE` / `SENTENCE_BOUNDARY_RE`，未与 IME 边界正则（含 `…`）对齐。 |

---

## 3. Root Cause Analysis

### 3.1 P0 — Ambiguity Contract（LIMIT / false unique / surface / rank9）

#### A1 — False unique

```text
Root Cause
  LENGTH1_AMBIGUITY_SQL_LIMIT=8 在 Eligibility 之前截断；
  resolveLength1BaseCandidate 对 eligible.length===1 直接 accept，
  不感知「SQL 是否打满 LIMIT / 库内是否仍有更多同键行」。

Current Owner
  Recall — collectBaseOnlySingleCharCandidate /
           filterEligibleBaseSingleChar /
           resolveLength1BaseCandidate
  （Runtime 只执行 ORDER BY prior DESC LIMIT ?，无歧义语义）

Current Contract (de facto)
  LIMIT → Filter → if |eligible|==1 then UNIQUE else SurfaceExact(|eligible|)

Who should own it?
  Recall（歧义决议是 Lattice length=1 Recall 政策，不是 SQLite/Runtime 政策）

Should move?
  No — 保持 Recall ownership；不得下沉到 Runtime「猜唯一」

Can isolate?
  Yes — 仅改 length=1 歧义决议；不碰 domain/fuzzy/2–5 merge

Minimal change?
  Truncation-aware uniqueness（满 LIMIT 或存在性探测失败 → 不得判 unique）
  不改 Edge/Path/Vote/HB
```

**1.0C 实证链：** 9 行同键（前 7 alias）→ Runtime top8 → filter 后仅「捌」→ 被当成唯一 → Candidate=1。

#### A2 — Surface rank9 unreachable

```text
Root Cause
  pickUniqueSurfaceExact 仅扫描 post-LIMIT eligible 集合；
  无独立 (pinyin_key[, tone], word=surface) 查询。
  prior 排名第 9 的 surface 永远不可见。

Current Owner
  Recall — pickUniqueSurfaceExact / resolveLength1BaseCandidate

Current Contract (de facto)
  SurfaceExact ⊆ LimitedFetchSet

Who should own it?
  Recall（surface 消歧属于歧义决议；Runtime 可提供 lookup 原语但不做决议）

Should move?
  No — 决议留在 Recall；若需 SQL，由 Recall 发起「surface probe」调用 Runtime

Can isolate?
  Yes — 与 A1 同文件同 Owner，但机制不同（独立 probe vs truncation flag）

Minimal change?
  独立 surface-exact lookup（或等价安全全量上限内精确命中），
  再套既有「唯一 surface → accept」规则
```

**关系说明：** A1/A2 同属 Ambiguity Contract，但是**两个机械 Root Cause**，应拆成两个 Repair，避免一次 PR 混改两种语义。

---

### 3.2 P1 — Tone Unsupported

```text
Root Cause
  toneActive = (tonePinyinKey != null) && supportsToneFirstRecall()
  当 pattern 可建 key 但 supportsToneFirstRecall()==false 时 toneActive=false，
  落入与「无 pattern」相同的 plain lookup，并标记 toneLookupStage='plain_only_no_pattern'
  （标签与事实不符：pattern 实际存在）。

Current Owner
  Recall — collectBaseOnlySingleCharCandidate
  Runtime 仅报告 supportsToneFirstRecall()（能力位）
  Call-site 仅传入 acousticTonePattern（证据）

Current Contract (de facto)
  !toneActive → plain lookup + stage plain_only_no_pattern
  （含：无 pattern；或 tone 列不可用）

Who should own it?
  Recall 决策 fallback 政策；Runtime 不擅自 fallback；Call-site 不绕过

Should move?
  No

Can isolate?
  Yes — 仅 length=1 tone gate 分支；可对齐但不强制改 2–5 collector 同构行为（2–5 同样 !toneActive→plain，但用多候选 merge，风险画像不同）

Minimal change?
  拆分三态：
    (1) no pattern → plain_only_no_pattern（保持）
    (2) pattern + supported → tone_exact（保持）
    (3) pattern + unsupported → 显式政策：empty 或 labeled plain_fallback
  本审计不选定 (3) 的产品答案，只冻结「必须显式、不得伪装成 no_pattern」
```

**为什么现在会 plain fallback？**  
因为 length=1 把 `supportsToneFirstRecall()==false` 编码进 `!toneActive`，与「没有声学 tone」共用 else 分支。

**谁决定 fallback？**  
**Recall** 决定。Runtime 不决定。Call-site 不决定。

**Contract 是否允许？**  
CR 1.0.2 / 1.0.3 **未冻结** tone-unsupported 政策；当前行为是**未文档化的 de facto**，且 stage 标签误导。属 **Contract Gap**，不是已批准的「允许 silent plain」。

---

### 3.3 P1 — Hard-block ellipsis

```text
Root Cause
  lattice-hard-block-filter.ts:
    PUNCTUATION_RE = /[，。！？、；：,.!?;:]/
    SENTENCE_BOUNDARY_RE = /[。！？.!?]/
  均不含 Unicode … (U+2026) / 中文省略号 ……。
  对比：IME extract-raw-coarse-boundaries / normalize-for-ime 的标点集包含 …。

Current Owner
  Lattice Hard-block filter（Phase1 harness / Lattice 窗过滤）
  非 Recall；非 Runtime；production LTR 仍用 blockedFilter（需影响分析）

Current Contract (CR 1.0.2)
  邻接句界允许；窗内含句界 / 标点仍 block。
  「标点」字符表未显式列出省略号。

Who should own it?
  Hard-block filter（窗 slice 字符政策）

Should move?
  No

Can isolate?
  Yes — 只扩正则 / 字符表 + 矩阵测试；不改邻接允许语义

Minimal change?
  将 … / …… 纳入 punctuation_in_window（和/或 sentence_boundary，需产品二选一）
  ASCII "..."：当前因含 '.' 已被 SENTENCE_BOUNDARY_RE 命中 → 已 block（行为不对称）
```

**进入哪一步：** Window slice → `hasPunctuationInWindow` / `hasSentenceBoundary` → markBlocked。省略号若要生效，必须在这两步的字符集中出现。

---

## 4. Call Graph

### 4.1 LIMIT / Ambiguity

```text
SQLite base_lexicon
  (rows ordered by prior_score DESC)
        │
        ▼
LexiconRuntimeV2.lookupBase*(key[, tone], termLength=1, sqlLimit=8)
  ★ LIMIT 执行层（机械；无歧义语义）
        │
        ▼
Recall.collectBaseOnlySingleCharCandidate
        │
        ├─ filterEligibleBaseSingleChar     ★ Filter（enabled / len=1 / !alias / prior>0）
        │
        ├─ resolveLength1BaseCandidate
        │     ├─ eligible.length===1 → accept   ★ Unique（当前无 truncation 感知）
        │     └─ else pickUniqueSurfaceExact    ★ Exact（仅限 fetched set）
        │
        ├─ scoreLength1BaseHit → Hit/Candidate  ★ Cap=1 在决议之后
        │
        ▼
Edge Builder / Path（消费结果；不参与歧义）
```

| Mechanism | Layer |
|-----------|-------|
| LIMIT | Runtime 执行；**数值与语义 Owner = Recall**（传入 `LENGTH1_AMBIGUITY_SQL_LIMIT`） |
| Filter | Recall |
| Unique | Recall |
| Surface Exact | Recall |
| Candidate Cap | Recall（决议后 ≤1） |
| Edge | 下游消费者 |

### 4.2 Tone

```text
Call-site (recallTopKForWindows)
  传入 acousticTonePattern；length=1 强制 fuzzy=false / domainIds=[]
        │
        ▼
Recall.collectBaseOnlySingleCharCandidate
  buildTonePinyinKeyFromSyllablesAndPattern
  toneActive = key!=null && runtime.supportsToneFirstRecall()
        │
        ├─ toneActive=true  → lookupBaseByPinyinAndToneKey → … → tone_exact
        │
        └─ toneActive=false → lookupBaseByPinyinKey → … → plain_only_no_pattern
              ▲
              └── ★ Fallback 决策点 = Recall（此处）
                    Runtime 只提供 supportsToneFirstRecall()
```

### 4.3 Hard-block

```text
LexicalWindowQuery / GlobalWindowDescriptor
        │
        ▼
latticeHardBlockFilter
  softClearBoundaryCrossHardBlock
        │
        ├─ raw gap / whitespace
        ├─ hasPunctuationInWindow(slice)     ← … 当前不命中
        ├─ hasSentenceBoundary(slice)        ← … 当前不命中；'.' 会命中 → "..." block
        ├─ non-CJK / ASR gap
        │
        ▼
blocked=true → 不进 Recall
```

---

## 5. Ownership Matrix

| Concern | SQLite | Runtime | Recall | Eligibility | Edge/Path | HB |
|---------|:------:|:-------:|:------:|:-----------:|:---------:|:--:|
| LIMIT **value & ambiguity meaning** | — | execute only | **OWNER** | — | — | — |
| Eligibility filter | — | — | **OWNER** | (=Recall fn) | — | — |
| Unique / false-unique policy | — | — | **OWNER** | input only | — | — |
| Surface Exact policy | — | optional probe API | **OWNER** | — | — | — |
| Tone unsupported fallback | — | capability bit | **OWNER** | — | — | — |
| Ellipsis hard-block | — | — | — | — | — | **OWNER** |

**规则：每个 concern 一个 Owner。** 禁止 Runtime「顺带」做唯一性猜测；禁止 Edge 回补歧义。

---

## 6. Current Contract

| Topic | Current (code / de facto) |
|-------|---------------------------|
| Ambiguity | LIMIT(8) → Filter → Unique(|E|==1) ∨ SurfaceExact(E) → Cap 1 |
| Truncation | **忽略**（满 8 不当作「可能还有更多」） |
| Surface scope | **仅** LimitedFetchSet |
| Tone unsupported + pattern | Silent plain；stage=`plain_only_no_pattern` |
| No pattern | Plain；stage=`plain_only_no_pattern`（合理） |
| HB ellipsis `…`/`……` | **不 block** |
| HB ASCII `...` | **block**（via `.`） |
| CR 1.0.2 written | 保守歧义 + surface 可消歧；**未写** LIMIT 截断语义 / tone-unsupported / 省略号表 |

---

## 7. Expected Contract（审计目标态，非实现补丁）

| Topic | Expected |
|-------|----------|
| Ambiguity uniqueness | Probe / fetch 必须使「唯一」意味着**语义唯一**，而非「截断后剩余 1」 |
| Ordering | **Filter 与 truncation 感知先于 Unique**；SurfaceExact 不得依赖「碰巧落在 top-LIMIT」 |
| Surface | Surface exact 在消歧场景必须**可达**（独立 probe 或等价安全机制） |
| Tone unsupported | 三态显式；不得把 (pattern ∧ !supported) 标成 `plain_only_no_pattern`；政策在 empty vs labeled plain_fallback 中**二选一写入 Contract** 后再实现 |
| HB ellipsis | 与「窗内标点 block」一致；`…`/`……` 行为与 ASCII `...` **对称且可测** |

示例（Ambiguity — 表达意图，非指定算法）：

```text
Current:   LIMIT → Filter → Unique
Expected:  Probe/Fetch → Filter → TruncationSignal → Unique?
           + SurfaceExact(independent) when needed
```

---

## 8. Regression Impact

| Defect | Who uses it | Regression | Risk | Batch affected | Production affected | Tests affected |
|--------|-------------|------------|------|----------------|---------------------|----------------|
| A1/A2 | length=1 Lattice Recall only | length=2–5 TopK merge；domain；fuzzy | 过严 → 更多空 Candidate；过松 → 假命中 | Batch 1.1；阻塞 Batch 2 Gate | 当前 Production LTR 窗 min=2，**直接线上 length=1 路径有限**；Lattice harness/未来 cutover 高影响 | 1.0C LIMIT baseline；新增 9-homophone / rank9 / truncation 测 |
| B | length=1 tone gate | 2–5 tone-first collector 同构门（可选对齐） | 改 empty 会掉现有 plain 命中；改 labeled fallback 需诊断语义 | Batch 1.1 | Tone 列缺失/旧 bundle 场景 | tone unsupported baseline；stage 断言 |
| C | `latticeHardBlockFilter` | production `blockedFilter` 若未同步 → Lattice/LTR 不对称 | 漏放行跨省略号窗；或过度 block | Batch 1.1 | Lattice Phase1；若同步 LTR 则 production 窗过滤 | HB 矩阵；需新增 ellipsis 用例 |

---

## 9. Baseline Reuse

| Baseline | Action |
|----------|--------|
| `lattice_v1_batch1_0c/length1_limit8_real_sqlite_baseline.json` | **继续使用**为 Repair A 前对照；Repair 后**更新**同结构字段 |
| `lattice_v1_batch1_0c/length1_tone_unsupported_baseline.json` | **继续使用**；Repair B 后更新 `observedBehavior` / stage |
| `lattice_v1_batch1_generalization/length1_ambiguity_limit_risk.json` | 审计参考 KEEP |
| `lattice_v1_batch1_generalization/hard_block_generalization_matrix.json` | 审计参考 KEEP |
| **NEW** `lattice_v1_batch1_1/hard_block_ellipsis_baseline.json` | Stage 2/3 前先测真实行为（`…` / `……` / `...`）写入 |
| **NEW** truncation / rank9 专用结果 JSON | Repair A 验收证据 |

Helper：**继续复用** `length1-real-sqlite.test.helpers.ts` + Electron ABI。

---

## 10. Repair Plan（拆分建议 — 不开发）

### Repair A — Ambiguity Truncation / False Unique

| Field | Value |
|-------|-------|
| Scope | length=1 uniqueness 不得在「可能截断」时 accept residual singleton |
| Owner | Recall |
| Root Cause | A1 only |
| Likely files | `recall-span-topk-v2.ts`（`LENGTH1_AMBIGUITY_SQL_LIMIT` / `resolveLength1BaseCandidate` 周边）；Contract CR |
| Tests | 9 同音 alias 假唯一回归为 **empty**（或非 unique）；既有真唯一单字仍命中 |
| Regression | length=2–5；cap 顺序；alias/disabled |

### Repair B — Surface Exact Reachability（rank9）

| Field | Value |
|-------|-------|
| Scope | Surface exact 消歧不依赖 prior top-LIMIT 窗口 |
| Owner | Recall（可调用 Runtime lookup；决议仍在 Recall） |
| Root Cause | A2 only |
| Likely files | `recall-span-topk-v2.ts`；必要时 Runtime **只加**精确 surface 查询原语（若现有 SQL 不够）；Contract CR |
| Tests | surface 排第 9 → 可消歧；无 surface 且截断 → 仍空 |
| Regression | 不得把 surface 变成「优先 Top1」绕过歧义 |

**顺序：** A → B（B 依赖「非截断假唯一」语义清晰），或同 Stage 串行两个 PR，**禁止**单 PR 混改。

### Repair C — Tone Unsupported Explicit Policy

| Field | Value |
|-------|-------|
| Scope | 拆分 tone gate 三态；选定 empty **或** labeled `plain_fallback`；修正 stage |
| Owner | Recall |
| Root Cause | B only |
| Likely files | `recall-span-topk-v2.ts`；Implementation Contract；可选诊断字段 |
| Tests | pattern∧!supported 的契约测；无 pattern 行为不变 |
| Regression | 1.0C plain 无 pattern 用例；2–5 默认不改除非显式对齐 |

### Repair D — Hard-block Ellipsis Symmetry

| Field | Value |
|-------|-------|
| Scope | `…` / `……` 纳入窗内标点/句界政策；与 `...` 对称 |
| Owner | `lattice-hard-block-filter`（评估是否同步 `blocked-window-filter`） |
| Root Cause | C only |
| Likely files | `lattice-hard-block-filter.ts`（+ 可选 LTR twin）；HB tests |
| Tests | 省略号矩阵；邻接允许回归不破坏 |
| Regression | CR 1.0.2 邻接句界用例 |

> 提示词要求 Repair A/B/C：上表 A/B/C 对应 Ambiguity-truncation / Surface / Tone；Hard-block 为 **Repair D**（同 Batch 1.1，独立 Root Cause）。

---

## 11. Risks

1. **过严歧义** → 连通性 length=1 命中率下降（应用 Fallback edge 填洞，属预期权衡）。  
2. **Surface probe 写错 Owner** → 若放进 Runtime「自动唯一」会破坏 SSOT。  
3. **Tone 改 empty** 与 1.0C 观测到的 plain 命中冲突 → 必须先写 Contract 再改测。  
4. **HB 只改 Lattice 不改 LTR** → 双过滤器行为分裂。  
5. **跨层大改**（一次改 LIMIT+tone+HB）→ 违反「一 Repair 一 Root Cause」→ Stage 4 必 CONDITIONAL。

---

## 12. KEEP

- Batch 1.0C Runtime `minTermLength` 契约（base 1–5；其他 tier ≥2）
- length=1 base-only；cap=1；`domains=[]`；`repairTarget=false`；不 vote
- 邻接句界允许（CR 1.0.2）
- 真实 SQLite helper / Electron ABI
- 2–5 tone-first / fuzzy / domain 主路径（本批不顺手改）
- LIMIT **常量名**可留；**语义**必须改（A）— 常量值是否仍为 8 由 Repair A 设计决定，Stage 1 不定

---

## 13. MODIFY（仅 Stage 2+ 候选）

- `resolveLength1BaseCandidate` / fetch 策略（A）
- Surface exact 可达性（B）
- length=1 tone gate 与 `toneLookupStage`（C）
- HB 标点正则（D）
- Implementation Contract Change Record（每项 Repair 后）

---

## 14. DELETE

- de facto「满 LIMIT 后 singleton = unique」
- de facto「tone unsupported 伪装 plain_only_no_pattern」
- （文档）任何暗示 LIMIT=8 已「安全完成歧义检测」的表述

---

## 15. NEW

- Truncation / existence probe 语义（Contract）
- Tone-unsupported 显式政策（Contract）
- Ellipsis HB baseline + 矩阵测试
- Batch 1.1 Stage 2/3/4/5 报告链

---

## 16. Target List

```text
[x] 审计 LIMIT 调用链并标注 LIMIT/Filter/Unique/Exact 层
[x] 审计 Tone fallback 决策点（Recall）
[x] 审计 Hard-block 省略号字符集缺口
[x] Ownership 唯一化矩阵
[x] Current vs Expected Contract
[x] 影响 / 回归 / Production 边界
[x] Baseline 复用与新增清单
[x] Repair A/B/C/(D) 拆分（一因一修）
[x] 文档同步建议
[ ] Stage 2 Development — 未开始（本轮禁止）
```

---

## 17. Check List

```text
[x] 未修改任何代码
[x] 未生成开发补丁
[x] 未准备 Batch 2
[x] 三个问题 Root Cause 明确
[x] Ownership 无双 Owner
[x] Repair 可拆分且不强制跨层
[x] 基于 1.0C 真实基线而非 Mock
[x] 说明「为什么现在这样设计」后再谈 Expected
```

---

## 18. Recommendation

```text
BATCH 1.1 DESIGN AUDIT: PASS

Next (only when an explicit Stage 2 prompt is issued):
  1) Repair A — truncation-aware uniqueness
  2) Repair B — independent surface exact
  3) Repair C — tone-unsupported explicit policy (Contract first)
  4) Repair D — ellipsis hard-block symmetry

Do NOT enter Batch 2.
Do NOT start coding in this Stage 1 turn.
After Stage 2–3 of each Repair, Batch 1 still needs Stage 4 Generalization + Stage 5 Gate
before any Batch 2 lexicon write work.
```

### 文档同步（Stage 1 结论）

| Document | Update now? | Later |
|----------|-------------|-------|
| **Implementation Contract** | Stage 1 **不改代码契约正文**（可在 Stage 2 随 Repair 追加 CR） | 每项 Repair 必须 CR |
| **Architecture FROZEN** | **不更新**（歧义/tone/HB 字符表属实现契约层） | 仅当窗长/所有权架构变化 |
| **Development Plan** | 可选：标注 Batch 1.1 四 Repair 顺序 | Stage 2 前更新任务条 |
| **Interface / Data Contract** | Stage 1 不改 | 若新增 tone stage 枚举语义或 HB reason，再改 |
| **本审计报告** | **NEW（本文件）** | KEEP 为 Stage 2 输入 SSOT |

---

## Appendix — Code anchors (read-only)

| Symbol | File |
|--------|------|
| `LENGTH1_AMBIGUITY_SQL_LIMIT` | `lexicon-v2/recall-span-topk-v2.ts` |
| `filterEligibleBaseSingleChar` | same |
| `resolveLength1BaseCandidate` / `pickUniqueSurfaceExact` | same |
| `collectBaseOnlySingleCharCandidate` tone gate | same |
| `supportsToneFirstRecall` | `lexicon-v2/lexicon-runtime-v2.ts` |
| `PUNCTUATION_RE` / `SENTENCE_BOUNDARY_RE` | `span-assembly-v4/lattice-hard-block-filter.ts` |
| 2–5 parallel `!toneActive → plain` | `lexicon-v2/tone-first-tier-collector.ts` |
