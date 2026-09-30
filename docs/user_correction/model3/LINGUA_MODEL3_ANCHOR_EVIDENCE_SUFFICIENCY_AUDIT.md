# Lingua1 — Anchor Evidence Sufficiency 专项审计

## PHASE: `LINGUA_MODEL3_ANCHOR_EVIDENCE_SUFFICIENCY_AUDIT`

- **性质**：READ-ONLY · TRACE-FIRST · FIRST-FAILURE-MECHANISM AUDIT ONLY
- **禁止**：任何生产代码 / 配置 / 模型 / Anchor 规则 / Domain Vote / Retry / Stage-2 / FineSpan / Pilot 修改
- **唯一问题**：9 个 `M3-B / FALSE_ANCHOR` case 上，生产代码依据什么证据把 PathFineSpan 标为 Anchor？该证据能否证明 whole span 已被「充分解释」？

---

## 0. Baseline Identity

上一轮权威：`LINGUA_MODEL3_COMPOUND_RESIDUAL_TRACE_AUDIT`

```text
TOTAL_B1_CASES = 14
M3-B = 9
M3-D = 4
M3-I = 1

EXPECTED_CASES = 9
OBSERVED_CASES = 9
BASELINE_IDENTITY = PASS
```

分母 caseId（严格匹配）：

```text
p2_u001_020  p2_u002_012  p2_u003_017  p2_u003_024
p2_u004_005  p2_u004_009  p2_u004_019  p2_u005_019  p2_u005_034
```

已冻结且本轮未重开：Model2 pre-edge SSOT、Window Binding、`MODEL2_ON_MODEL3_RETRY=NO`、Model2 relation 局部变换合法、compound residual 属 Model3 责任。

---

## 1. Anchor 生产调用链（唯一入口）

| 项 | 值 |
|:---|:---|
| **唯一 materialization 入口** | `model3-anchor-adapter.ts` → `materializeModel3Anchors` |
| **调用方** | `run-model3-path-step.ts` → `prepareModel3PathUpstream` / `prepareModel3PathUpstreamWithoutInfer` |
| **实际 predicate** | `if (domainOk \|\| model2Ok) → push whole-span Anchor` |
| **隐藏 Anchor 来源** | **无**（仅 DOMAIN / MODEL2 / DOMAIN_AND_MODEL2） |

### 1.1 `domainOk` = `hasRetainedDomainEvidence`

| 字段 | 含义 |
|:---|:---|
| **读取** | `candidate.source ∈ {domain_term, passive_domain_weak}`；`candidate.domains ∩ vote.retainedDomains`；`candidateBoundToSpan` |
| **上游** | 基座 lexicon domain recall **和/或** Model2 `materializeDomainHits` |
| **真实语义** | 「该 PathFineSpan 几何上绑定了**任意** retained-domain 的 domain candidate」 |
| **不是** | 「span surface 已被 lexical/domain evidence **完整解释**」 |
| **phonetic coverage 检查** | **无** |
| **sufficiency 检查** | **无** |

### 1.2 `model2Ok` = `hasModel2Evidence`

| 字段 | 含义 |
|:---|:---|
| **读取** | `retrievalProvenance ∈ {PROFILE_RETRIEVAL, PROFILE_PRONUNCIATION, PROFILE_DOMAIN}` |
| **上游** | `expand-windows-with-model2` → `candidate-materialize`（P 发音 hits + D soft hits） |
| **真实语义** | 「该 span 绑定了**任意** Model2 provenance candidate」 |
| **不是** | 「Model2 relation 变换已充分解释整个 span 发音」 |
| **coverage 检查** | **无** |

### 1.3 关键耦合：`PROFILE_DOMAIN` 双触发

文件：`candidate-materialize.ts` → `materializeDomainHits`

```text
source = domain_term          → 满足 domainOk
retrievalProvenance = PROFILE_DOMAIN  → 满足 model2Ok
```

因此 Model2 **domain soft** 注入的同一批候选，经常同时点亮 `domainOk` 与 `model2Ok`，产出大量 `DOMAIN_AND_MODEL2`——**并不**代表「Domain 解释了 surface + Model2 解释了发音」。

实测：多数 false-anchor span 上的「Domain cands」与「Model2 cands」是同一批 soft-list 表面（如 `预订/入园/接客…`），`windowPinyinKey` 是 ASR span 拼音，**候选 surface ≠ span surface**。

### 1.4 当前实际 contract（非文档愿望）

```text
ANY_DOMAIN_EVIDENCE OR ANY_MODEL2_EVIDENCE
→ WHOLE_PATHFINESPAN_ANCHOR

DOES_CURRENT_RUNTIME_HAVE_EXPLICIT_EVIDENCE_SUFFICIENCY_CONTRACT? = NO
ANCHOR_EVIDENCE_SUFFICIENCY_CONTRACT = ABSENT
ANCHOR_COVERAGE_GRANULARITY = LOST
```

概念链在生产中被压成：

```text
candidate exists → evidence exists → Anchor
```

中间的 `PARTIAL_EXPLANATION` / `FULL_SPAN_SUFFICIENTLY_EXPLAINED` **不存在于代码**。

---

## 2. 代表案例复核

### Case A — 地暖（`p2_u004_019`）

```text
ASR span: 德鸾 (de|luan)
Model2 n_l 可解释: luan→nuan
AUDIT_GT residual: de≠di
anchorSource: DOMAIN_AND_MODEL2
```

| 问题 | 答案 |
|:---|:---|
| Model2 是否只解释 luan→nuan？ | **是**（partial）；adapter **不检查** |
| Domain evidence 是什么？ | retained `tourism_route` 的 soft hits（预订/入园…）几何绑定到 `de\|luan` 窗口 |
| Domain 是否解释 `de`？ | **否**（甚至不证明 surface=德鸾 是域词） |
| 最终触发条件 | `domainOk \|\| model2Ok`（两者皆 true） |
| 移除 Model2 后 Domain alone？ | **仍 Anchor**（cf DomOnly=YES） |
| 移除 Domain 后 Model2 alone？ | **仍 Anchor**（cf M2Only=YES） |

**FIRST CAUSE: A3**（兼 A4 granularity loss + A5 domain 语义误用）

### Case B — 床头灯（`p2_u004_009`）— 最干净纯 Model2

```text
span: 藏 (cang)
Model2: single:ch_c → PROFILE_PRONUNCIATION → surface「常」
domainOk: False
AUDIT_GT: chang≠chuang（缺介音 u）
```

| 问题 | 答案 |
|:---|:---|
| `ANY PROFILE provenance → whole span Anchor`？ | **YES（生产真实机制）** |
| Domain 是否必要？ | **否** |

**FIRST CAUSE: A1_MODEL2_ANY_EVIDENCE_WHOLE_SPAN_ANCHOR**

### Case C — 出租车（`p2_u002_012`）

```text
出 = non-anchor / RETRY
注册 = DOMAIN_AND_MODEL2 Anchor  ← 「册」residual 锁死
```

| 侧 | Coverage |
|:---|:---|
| Model2 | soft/`PROFILE_DOMAIN` 或发音路径存在；**不**证明 ce 已解释 |
| Domain | pickup soft hits 几何绑定；**不**证明「注册」surface 充分解释 |

「册」失去 Model3 actionable 权限的原因：whole-span Anchor → `eligible=false` → 强制 KEEP。

**FIRST CAUSE: A3**

### Case D — 检查法（`p2_u004_005`）

权威 `decisions/anchors`：`把剪`、`裁器` = `DOMAIN_AND_MODEL2`。

本轮 capped `after_model2_candidates`（cap=24）未导出绑定到这两 span 的 cand（`bound=0`）→ **候选明细 TRACE 部分不足**；但 `anchorSource` 标签足以证明 materialization 时 `domainOk∧model2Ok`。

上一轮探针 `model2ProvCandCount=0` 是**绑定/导出缺陷**，不能解读为「Domain-only 独立造假」的唯一证据；代码上 Domain-only **可以**独立造 Anchor（见 §3 counterfactual）。

**FIRST CAUSE: A3**（兼 A5；候选列表 A6 细节）

---

## 3. Counterfactual Trigger（只读谓词推演）

对每个 primary false-anchor span，按当前代码：

```text
Model2=false, Domain=current → Anchor = domainOk
Model2=current, Domain=false → Anchor = model2Ok
Model2=false, Domain=false → Anchor = false
```

| Case | DomOnly | M2Only | Neither |
|:---|:---:|:---:|:---:|
| 礼宾员/理事 | YES | YES | NO |
| 出租车/注册 | YES | YES | NO |
| 护士长/市场 | YES | YES | NO |
| 候机厅/对方 | YES | YES | NO |
| 检查法/把剪 | YES* | YES* | NO |
| **床头灯/藏** | **NO** | **YES** | NO |
| 地暖/德鸾 | YES | YES | NO |
| 贵宾室/归病 | YES | YES | NO |
| 薯条/解锁 | YES | YES | NO |

\*检查法由权威 `DOMAIN_AND_MODEL2` 推断。

```text
MODEL2_ONLY_CAN_FALSE_ANCHOR = YES   (代码 + 藏 实证)
DOMAIN_ONLY_CAN_FALSE_ANCHOR = YES   (代码 + 8/9 DomOnly 反事实)
```

分母内**观测到的**纯 Domain-only 实例 = 0（因 `PROFILE_DOMAIN` 双触发常同时点亮两侧）→ `DOMAIN_ONLY_FALSE_ANCHOR = PARTIAL`。

---

## 4. 9-case Evidence Coverage 与 Taxonomy

| caseId | primary span | Model2 | Domain | source | wholeSpanSufficientlyExplained | FIRST CAUSE |
|:---|:---|:---:|:---:|:---|:---:|:---|
| p2_u001_020 | 理事 | Y/PARTIAL | Y/NON_SUF | DOMAIN_AND_MODEL2 | **NO** | **A3** |
| p2_u002_012 | 注册 | Y/PARTIAL | Y/NON_SUF | DOMAIN_AND_MODEL2 | **NO** | **A3** |
| p2_u003_017 | 市场 | Y/PARTIAL | Y/NON_SUF | DOMAIN_AND_MODEL2 | **NO** | **A3** |
| p2_u003_024 | 对方 | Y/PARTIAL | Y/NON_SUF | DOMAIN_AND_MODEL2 | **NO** | **A3** |
| p2_u004_005 | 把剪 | Y* | Y* | DOMAIN_AND_MODEL2 | **NO** | **A3** |
| p2_u004_009 | 藏 | Y/PARTIAL | N | **MODEL2** | **NO** | **A1** |
| p2_u004_019 | 德鸾 | Y/PARTIAL | Y/NON_SUF | DOMAIN_AND_MODEL2 | **NO** | **A3** |
| p2_u005_019 | 归病 | Y/PARTIAL | Y/NON_SUF | DOMAIN_AND_MODEL2 | **NO** | **A3** |
| p2_u005_034 | 解锁 | Y/PARTIAL | Y/NON_SUF | DOMAIN_AND_MODEL2 | **NO** | **A3** |

（A4 granularity loss、A5 domain 语义误用在 8/9 A3 案上为**伴生机制**，不另计 exactly-one primary。）

### Required Counts

```text
TOTAL_CASES = 9

MODEL2_EVIDENCE_PRESENT = 9
DOMAIN_EVIDENCE_PRESENT = 8
BOTH_EVIDENCE_PRESENT = 8

MODEL2_PARTIAL_EXPLANATION = 9
DOMAIN_PARTIAL_OR_NON_SUFFICIENT = 8

A1_MODEL2_ANY_EVIDENCE_WHOLE_SPAN_ANCHOR = 1
A2_DOMAIN_ANY_EVIDENCE_WHOLE_SPAN_ANCHOR = 0
A3_BOTH_INSUFFICIENT_OR_RULE = 8
A4_ANCHOR_GRANULARITY_LOSS = 0   (primary; 伴生见上)
A5_DOMAIN_EVIDENCE_SEMANTIC_MISUSE = 0  (primary; 伴生见上)
A6_TRACE_INSUFFICIENT = 0
A7_OTHER_VERIFIED = 0

SUM = 9
```

---

## 5. Owner Adjudication

共同根因：

```text
不同 evidence source（PROFILE_PRONUNCIATION / PROFILE_DOMAIN / domain_term）
全部被压缩为 boolean evidence-exists
→ whole PathFineSpan Anchor
且无 Evidence Sufficiency contract
```

因此：

```text
ONE_NEXT_OWNER = ANCHOR_EVIDENCE_SUFFICIENCY_OWNER
```

不要分别去「修 Model2」或「修 Domain Vote」——Model2 relation 变换本身合法；Domain Vote retainedDomains 语义本身也可保留。失败在 **Anchor adapter 把 existence 当成 sufficiency**。

### 与冻结架构一致性

```text
PATCH_FREE_LOCAL_REFACTOR_FEASIBLE = YES
ARCHITECTURE_CHANGE_PROPOSAL_REQUIRED = NO
```

只改：

```text
Anchor materialization / evidence sufficiency
（model3-anchor-adapter.ts 及必要的 sufficiency 判定输入字段）
```

可不改：Model2、Domain Vote、FineSpan、Segmentation、Model3 权重、Retry、Stage-2、Assembly、KenLM、JobResult。

### ONE_NEXT_DELTA（只描述，不实施）

> 在 Anchor materialization 层引入显式 **Evidence Sufficiency** contract：仅当上游证据在 span 粒度上证明「充分解释」时才标 Anchor；禁止 `domainOk OR model2Ok` 的 boolean ANY-evidence 直接 whole-span Anchor。覆盖度信息若在 Window→Candidate→PathFineSpan 传递中丢失，应在 adapter 边界恢复或拒绝升格为 Anchor。

---

## 6. Final Verdict

```text
BASELINE_IDENTITY = PASS

FALSE_ANCHOR_REPRODUCED = YES

MODEL2_ONLY_FALSE_ANCHOR = YES
DOMAIN_ONLY_FALSE_ANCHOR = PARTIAL

ANCHOR_EVIDENCE_SUFFICIENCY_CONTRACT = ABSENT

ANCHOR_COVERAGE_GRANULARITY = LOST

PRIMARY_FIRST_FAILURE_MECHANISM =
ANY_DOMAIN_EVIDENCE OR ANY_MODEL2_EVIDENCE
(including PROFILE_DOMAIN soft hits)
→ WHOLE_PATHFINESPAN_ANCHOR
without sufficiency / phonetic-coverage check

ONE_NEXT_OWNER = ANCHOR_EVIDENCE_SUFFICIENCY_OWNER

PATCH_FREE_LOCAL_REFACTOR_FEASIBLE = YES

ARCHITECTURE_CHANGE_PROPOSAL_REQUIRED = NO

PRODUCT_CODE_CHANGE_THIS_ROUND = NO
```

---

## 7. Deferred（本轮不处理）

- M3-D = 4（MODEL3_FALSE_KEEP）
- M3-I = 1（Stage-2 capability）
- Tone first owner / B4 / Pilot harness selector bug
- 不重跑 Full Pilot200

## 8. Artifacts

1. `docs/user_correction/model3/LINGUA_MODEL3_ANCHOR_EVIDENCE_SUFFICIENCY_AUDIT.md`
2. `docs/user_correction/model3/LINGUA_MODEL3_ANCHOR_EVIDENCE_SUFFICIENCY_SUMMARY.json`
3. `docs/user_correction/model3/LINGUA_MODEL3_ANCHOR_EVIDENCE_SUFFICIENCY_MATRIX.json`

## 9. STOP

本轮只审计，不修 Anchor。
