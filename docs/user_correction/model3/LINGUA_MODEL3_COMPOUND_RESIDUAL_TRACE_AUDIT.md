# Lingua1 — Model3 Compound Residual Full-Chain Trace Audit

## PHASE: `LINGUA_MODEL3_COMPOUND_RESIDUAL_TRACE_AUDIT`

- **性质**：READ-ONLY · TRACE-FIRST · FIRST-FAILURE-OWNER LOCALIZATION ONLY
- **约束**：NO PRODUCT CHANGE · NO MODEL TRAINING · NO ARCHITECTURE CHANGE · NO RETRY POLICY CHANGE
- **分母**：上一轮 B1（`B1_TARGET_ALIGNED_COMPOUND_ASR_ERROR`）= **14**
- **基线身份**：`OBSERVED_CASES = 14`（与 EXPECTED 一致，无 `BASELINE_IDENTITY_MISMATCH`）
- **已关闭议题**：Model2 Window/Action Binding = PASS / CLOSED（本轮禁止重开）

---

## 0. 冻结责任回顾

| 组件 | 冻结职责 |
|:---|:---|
| **Model2** | UserProfile pronunciation relation → candidate expansion。不负责修复全部 ASR 错误，不负责最终语义判断。 |
| **Model3** | Anchor-conditioned Acoustic-Linguistic Repair Trigger。仅对 non-anchor residual 可行动：输出 KEEP / RETRY。禁止改写 Anchor / 重跑 Model2 / 建第二主链。 |

`COMPOUND_NON_PROFILE_ASR_ERROR ≠ Model2 bug`。本轮只追：Model2 部分解释之后，residual 在 Anchor → Model3 → Retry → Stage-2 → Downstream 的**第一次真实失败点**。

---

## 1. 关键代码审计：PARTIAL Model2 Evidence → Whole-Span Anchor

### 代码位置

- 文件：`electron_node/electron-node/main/src/model3-runtime/model3-anchor-adapter.ts`
- 函数：`hasModel2Evidence` · `materializeModel3Anchors`

### 实际逻辑

```text
hasModel2Evidence(candidates, span):
  for each candidate bound to span:
    if retrievalProvenance ∈ {PROFILE_RETRIEVAL, PROFILE_PRONUNCIATION, PROFILE_DOMAIN}:
      return true   # ANY hit

materializeModel3Anchors(...):
  if domainOk OR model2Ok:
    mark WHOLE PathFineSpan as Anchor
```

### 不变式检验

冻结原则：

> Anchor 必须表示「该 span 已被上游 evidence **足够解释**」，  
> 而不是「该 span 曾经收到过任意 Model2 candidate」。

实测：

| 检验项 | 结果 |
|:---|:---|
| `MODEL2_EVIDENCE_PRESENT ⇒ WHOLE_SPAN_ANCHOR = true` | **YES** |
| `PARTIAL_MODEL2_EVIDENCE_CAUSES_FALSE_ANCHOR` | **YES** |
| 是否检查「Model2 变换后仍有未解释发音 residual」 | **NO** |
| `MODEL2_ON_MODEL3_RETRY` | **NO**（全部 retry region `model3Reinvoked=false`；未发现 retry 重调 Model2） |

因此：`liu|ruo|chuan --n_l→ niu|ruo|chuan` 这类 **PARTIAL EXPLANATION** 会通过「任意 PROFILE provenance candidate」把相关 PathFineSpan（甚至只是部分被解释的 mono/bi span）标成 Anchor，使真正未解释音节无法进入 Model3 actionable 集合。

---

## 2. 全链路追踪方法

对每个 B1 case（CORRECT_PROFILE）：

1. 冻结 tone evidence replay：`POST /session-bootstrap` + `POST /run-lexicon-mock`
2. 从 `extra.dialog200_path_trace.paths[].model3` 提取：
   - `anchors` / `decisions` / `retry_regions` / `retry_attempts` / `retry_recall_invocations`
3. 用上一轮 B1 的 `targetExpectedRegionStart/End` 对齐 path FineSpans（字段 `start/end`）
4. 按 M3-A…M3-L 裁定 **exactly one** firstFailureOwner（M3-E 仅作中间态，不得作为最终 owner）

「应该 RETRY」判断只基于运行时可得证据（cand=0/1、non-anchor、结构可疑），**不**用 pilot target 作 oracle。

---

## 3. 14-case 逐条摘要

| caseId | target | ASR region | Model2 xf | residual | Anchor 行为 | Model3 | Retry/Stage-2 | firstFailureOwner |
|:---|:---|:---|:---|:---|:---|:---|:---|:---|
| p2_u001_020 | 礼宾员 | 理事员 | ni\|shi\|yuan | shi≠bin | 「理事」「员的」DOMAIN_AND_MODEL2 | NONE | — | **M3-B** |
| p2_u001_039 | 牛肉串 | 刘若川 | niu\|ruo\|chuan | ruo≠rou | 「刘」MODEL2（对该字全解释）；「若」non-anchor | RETRY「若」 | reseg+Stage-2=1，无 useful | **M3-I** |
| p2_u002_012 | 出租车 | 出注册 | chu\|zu\|ce | ce≠che | 「注册」DOMAIN_AND_MODEL2 **锁住册** | RETRY「出」 | Stage-2 未覆盖真实 residual | **M3-B** |
| p2_u003_016 | 换乘 | 翻成 | han\|cheng | han≠huan | 「翻」non-anchor cand=1 | **KEEP** | — | **M3-D** |
| p2_u003_017 | 护士长 | 副市场 | hu\|shi\|chang | chang≠zhang | 「市场」DOMAIN_AND_MODEL2 | NONE | — | **M3-B** |
| p2_u003_022 | 集合区 | 集佛趣 | ji\|ho\|qu | ho≠he | 集/佛/趣 全 non-anchor cand=1 | **KEEP×3** | — | **M3-D** |
| p2_u003_023 | 河谷区 | 佛国… | ho\|guo | 复合 | 佛/国 non-anchor cand=1 | **KEEP** | — | **M3-D** |
| p2_u003_024 | 候机厅 | 方击听 | hang\|ji\|ting | hang≠hou | 「对方」「击听」DOMAIN_AND_MODEL2 | NONE | — | **M3-B** |
| p2_u003_034 | 千层酥 | 签陈素 | qian\|cheng\|su | cheng≠ceng | 签/陈 non-anchor cand=1 | **KEEP** | — | **M3-D** |
| p2_u004_005 | 检查法 | 剪裁器 | jian\|chai\|qi | 复合 | 「把剪」「裁器」DOMAIN_AND_MODEL2 | NONE | — | **M3-B** |
| p2_u004_009 | 床头灯 | 藏头灯 | chang\|tou\|deng | chang≠chuang | 「藏」MODEL2 **PARTIAL→FALSE_ANCHOR** | RETRY「头」 | 未覆盖真实 residual | **M3-B** |
| p2_u004_019 | 地暖 | 德鸾 | de\|nuan | de≠di | 「德鸾」DOMAIN_AND_MODEL2（n_l 仅解释鸾） | NONE | — | **M3-B** |
| p2_u005_019 | 贵宾室 | 归病似 | gui\|bing\|shi | bing≠bin | 「归病」DOMAIN_AND_MODEL2 **锁住病** | RETRY「似」 | 未覆盖真实 residual | **M3-B** |
| p2_u005_034 | 薯条 | 锁条 | shuo\|tiao | shuo≠shu | 「解锁」DOMAIN_AND_MODEL2 | NONE | — | **M3-B** |

### 代表案例对比（完整 contrast）

#### 牛肉串（p2_u001_039）

```text
WindowEvidence (Model2): wid covering 刘若川 → n_l → niu|ruo|chuan
Path FineSpans: 刘[A/MODEL2] | 若[R/RETRY] | 川[R/KEEP]
Expected: unexplained residual 「若」进入 Model3 → RETRY → Stage-2
Actual: 「若」确实 RETRY + resegOk + recallCandidatesReturned=1
first failure: Stage-2 无法从单字「若」产生 recoverable multi-char evidence
OWNER: M3-I (EXPECTED_CAPABILITY_LIMIT)
```

#### 换乘（p2_u003_016）

```text
Model2: 翻成 → h_f → han|cheng
Path: 翻[R/KEEP cand=1] | 成大[A/DOMAIN_AND_MODEL2]
Runtime suspicion: mono residual cand=1，结构可疑
Actual: Model3 KEEP（未触发 RETRY）
OWNER: M3-D (IMPLEMENTATION_BUG / decision)
```

#### 出租车（p2_u002_012）

```text
Model2: 出注册 → z_zh → chu|zu|ce
Path: 出[R/RETRY] | 注册[A/DOMAIN_AND_MODEL2]  ← 「册」被锁在 Anchor
Expected residual for Model3: 「册」(ce≠che)
Actual: Model3 只 RETRY「出」；真实 residual 不可行动
OWNER: M3-B (ANCHOR_OWNER)
```

#### 贵宾室（p2_u005_019）

```text
Model2: 归病似 → sh_s → gui|bing|shi
Path: 归病[A/DOMAIN_AND_MODEL2] | 似[R/RETRY]
真实 residual 「病」(bing≠bin) 锁在 Anchor 内
OWNER: M3-B (ANCHOR_OWNER)
```

#### 地暖 / 床头灯（PARTIAL Model2 → FALSE_ANCHOR 铁证）

```text
德鸾: n_l 解释 luan→nuan，但 de≠di 仍未解释 → 整 span DOMAIN_AND_MODEL2 Anchor
藏:   ch_c 解释 cang→chang，但仍缺介音 u (≠chuang) → MODEL2 Anchor 锁死
first code point: model3-anchor-adapter.ts::hasModel2Evidence → materializeModel3Anchors
```

---

## 4. Required Counts

```text
TOTAL_CASES = 14

RESIDUAL_PRESERVED (runtime non-anchor in target) = 8
FALSE_ANCHOR (first owner M3-B)                   = 9
MODEL3_TARGET_SPAN_PRESENT                        = 14
MODEL3_KEEP                                       = 4
MODEL3_RETRY                                      = 4
RETRY_REGION_CORRECT                              = 2
RETRY_EXECUTED                                    = 4
STAGE2_RECALL_EXECUTED                            = 4
STAGE2_USEFUL_EVIDENCE                            = 0
DOWNSTREAM_RECOVERY                               = 0
FINAL_CORRECT                                     = 0
```

---

## 5. First-owner Counts

```text
M3-A = 0
M3-B = 9
M3-C = 0
M3-D = 4
M3-F = 0
M3-G = 0
M3-H = 0
M3-I = 1
M3-J = 0
M3-K = 0
M3-L = 0

SUM = 14
```

（M3-E 不计入最终 firstFailureOwner。）

| Owner | Bug vs Capability |
|:---|:---|
| M3-B ×9 | IMPLEMENTATION_BUG（Anchor 粒度 / PARTIAL Model2→whole-span） |
| M3-D ×4 | IMPLEMENTATION_BUG（Model3 对 thin residual 错误 KEEP） |
| M3-I ×1 | EXPECTED_CAPABILITY_LIMIT（RETRY 正确但 Stage-2 无 useful evidence） |

```text
implementationBugCount = 13
capabilityLimitCount = 1
architectureDecisionRequiredCount = 0
```

---

## 6. Architecture Invariants（本轮仅验证）

| Invariant | 结果 |
|:---|:---|
| MODEL2_PRE_EDGE_INSERTION | PASS（未重开） |
| WINDOW_LOCAL_ACTION_OWNERSHIP | PASS（上一轮已关闭） |
| MODEL2_ON_MODEL3_RETRY | **NO / PASS** |
| PARTIAL_MODEL2_EVIDENCE_CAUSES_FALSE_ANCHOR | **YES / FAIL invariant intent** |
| JOBRESULT_BOUNDARY | PASS（诊断在 dialog200_path_trace） |

---

## 7. Owner Adjudication

- **Dominant firstFailureOwner** = `M3-B`（9/14 = 64.3%）
- **ONE_NEXT_OWNER** = `ANCHOR_OWNER`
- **Outcome** = `FALSE_ANCHOR_PRIMARY_BLOCKER`

次要失败面：`MODEL3_DECISION_OWNER`（4 例 thin residual KEEP）。在 Anchor 问题未解除前，不建议把 Model3 决策训练当作主修复线——大量真实 residual 根本进不了 Model3 actionable 输入。

唯一能力边界例：`p2_u001_039`（牛肉串）证明：当 residual 真正暴露且 Model3 RETRY 正确时，Stage-2 仍可能无法恢复 → `STAGE2_RECALL_CAPABILITY_OWNER` / EXPECTED_CAPABILITY_LIMIT。

---

## 8. Deferred（本轮不分析）

- `B4_TARGET_REGION_NOT_REPRESENTABLE = 3` → `DEFERRED_FINESPAN_BOUNDARY_SSOT_CHECK`
- `PILOT_WINDOW_DIAGNOSTIC_SELECTOR_BUG` → `CONFIRMED / DEFERRED HARNESS FIX`

---

## 9. 回答本轮唯一问题

> Compound ASR residual 从 Model2 之后，到 Model3、Retry、Stage-2、Downstream 的第一次真实失败发生在哪里？

**大多数（9/14）第一次失败在 Anchor 物化：`materializeModel3Anchors` 把 PARTIAL Model2 / Domain evidence 等价成 whole-span Anchor，使未解释 residual 在进入 Model3 前就被锁死（M3-B / ANCHOR_OWNER）。**

次要：4/14 在 Model3 决策（错误 KEEP）；1/14 在 Stage-2 能力边界。

---

## 10. Artifacts

1. `docs/user_correction/model3/LINGUA_MODEL3_COMPOUND_RESIDUAL_TRACE_AUDIT.md`
2. `docs/user_correction/model3/LINGUA_MODEL3_COMPOUND_RESIDUAL_TRACE_SUMMARY.json`
3. `docs/user_correction/model3/LINGUA_MODEL3_COMPOUND_RESIDUAL_TRACE_MATRIX.json`

## 11. STOP

本轮只审计，不修 Anchor / Model3 / Retry / Stage-2 / Lexicon / Model2。
