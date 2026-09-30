# Lingua FW Repair V4 — Single-Char Collector Live Rejection Audit

**Date:** 2026-08-18  
**Stage:** `FW_REPAIR_V4_SINGLE_CHAR_COLLECTOR_OBSERVABILITY_AND_LIVE_REJECTION_AUDIT`  
**Type:** OBSERVATION ONLY / NO BUSINESS FIX  
**Artifacts:** `training/model2_v3/experiments/v3_stage_j_live_dialog200/single_char_collector_live_2026_08_18/`

本轮只回答：对每个 production 1-char window，collector 经历了什么，以及拒绝分布是什么。不放宽 uniqueness、tone gate、cap、fuzzy。

---

## 0. P0

上一轮 164 个 `HIT_REJECTED_BY_ROUTE` **不能**再当成「collector 从未 accept」。

本轮 live collector 在 4477 个 1-char window 上：

- **accept 2331（52.1%）**
- reject 2146
- 最大 collector reject = `MULTIPLE_TONE_EXACT_CANDIDATES`（1046，23.4%）

但是：

- **2331 次 accept 之后，`bindLexiconHitsToWindow` 全部因 `priorScore < minPrior(0.5)` 丢掉**
- 2510 单字 `priorScore` 实测 0.08–0.30，没有任何一行能过 0.5
- 因此 selected-path 1-char FineSpan 仍是 **0 lexical / 3966 fallback**

上一轮看到的「全是 fallback FineSpan」是 **collector accept + bind 全灭**，不是 collector 零产量。

目标 expected 表面：213 个 true-recall 单字单位里 collector 选出 expected 仅 **2**。那是冻结 unique/surface-exact（对照 ASR window，不是 expectedText）的产物。

---

## 1. Decision tree / accept 语义（以代码为准）

见同目录 `single_char_collector_decision_tree.md`。

Accept 只有两条：

1. `ACCEPT_UNIQUE_TONE_EXACT` — tone ready，eligible==1，未截断，score≥min（默认 0）。**不要求** surface==windowText。
2. `ACCEPT_SURFACE_EXACT` — uniqueness 失败后 `word === windowText`（页内或 identity SQL）。

无 Top1、无 expectedText、无 fuzzy、无 domain、cap=1。

未发现会改变 accept 的 collector 内 `UNJUSTIFIED_FILTER`。  
**Hidden filter 在 bind 层：`minPrior=0.5`。本轮不改。**

---

## 2. Trace / tests

- Taxonomy `SINGLE_CHAR_COLLECTOR_TRACE_V1`，终端互斥。
- TRACE 只在决策之后拍照；fixture TRACE_ON/OFF hits/order **一致**。
- SQLite 合同测试 13/13 PASS（含 unique / multiple / no pattern / not ready / SQL miss / 繁简 / score / LIMIT / fallback-after-reject）。
- Live TRACE_OFF 5 条：3 条 SAME_RAW 业务等价；2 条 ASR 非确定，不当作 TRACE 破坏。

---

## 3. Live run

| 项 | 值 |
|----|----|
| Runner | `run-dialog200-stagej-full-path-trace.mjs --arm stagej` |
| Profile | NO_PROFILE |
| Checkpoint | `d66847be…beda` MATCH |
| Lexicon | bundleVersion **13**，checksum MATCH，len1 **2510** |
| Model2 | INVOKED 199；pipeline 504 **d192** 1 条 |
| 1-char windows | **4477**（勿与旧 4157 对齐） |

---

## 4. Global funnel

| 步 | N |
|----|--:|
| 1-char windows | 4477 |
| blocked | 0 |
| query executed | 4027 |
| SQL hit≥1 | 3377 |
| tone ready / pattern present | 4027 / 4027 |
| pattern absent | 450 |
| tone exact≥1 | 3377 |
| unique tone exact | 984 |
| surface exact≥1 | 1799 |
| **accepted** | **2331** |
| collector reject | 2146 |
| accept then unbound (minPrior) | **2331 / 2331** |
| path0 lexical 1-char FineSpan | **0** |

Accept rate = 2331/4477 = **52.07%**.

Uniqueness counts（tone-ready 且 SQL hit）：0=n/a among hits; **1=984; 2=610; 3=440; 4+=1343**.

Score reject **0**。LIMIT truncation reject **0**。Normalization overlay **0**（本轮 ASR window 无 raw≠canonical）。

---

## 5. Target sites（MATERIALIZABLE_TARGET_V1 true-recall 单字）

| 项 | N |
|----|--:|
| true-recall length-1 | 213 |
| function-word 另计 | 31 |
| in_lexicon | 200 |
| valid 1-char selected-path FineSpan | 172（**全部 fallback**） |
| collector accepted **expected** surface | **2** |
| no valid 1-char path | 41 |

Target-site collector terminals：ACCEPT_SURFACE_EXACT 83，ACCEPT_UNIQUE 39，MULTIPLE 49，SQL_NO_HIT 20，NO_TONE_PATTERN 12，NO_VALID_FINESPAN 10。

83+39=122 个目标位 collector 接受的是 **ASR 窗表面**，不是 expected。Expected 命中仅 2。

No-valid 41 拆分：covered_by_2+ 26；window exists not selected 5；no 1-char window 10。**不修 FineSpan。**

---

## 6. 旧假说

| 假说 | 判决 |
|------|------|
| 1.1C fail-closed | **MINOR**（NO_TONE_PATTERN 450 / 10.1%） |
| uniqueness | **MINOR** 对全局 collector；对 expected 替换是主要冻结限制 |
| surface exact miss | **NOT_SUPPORTED**（0 `SURFACE_EXACT_MISS`；surface exact 是主 accept 路径） |
| score | **NOT_SUPPORTED**（0） |
| LIMIT=8 | **NOT_SUPPORTED**（0 `LIMIT_TRUNCATION_REJECT`） |
| normalization | **NOT_SUPPORTED**（0） |
| bind minPrior 0.5 | **SUPPORTED / PRIMARY** 解释「0 lexical 1-char FineSpan」 |

旧 164 不可 replay 出 SQL/tone 内部原因。Live 是 authoritative collector-reason source。不要固定 164。

---

## 7. Conformance / decision

Collector 冻结语义 **WORKING_AS_DESIGNED**。实现 bug（unique+ready+score 仍返回 null）**0**。

全局 lexical FineSpan=0 不是 uniqueness 主因，是 **bind minPrior 与 2510 单字 prior 不兼容**。本轮禁止修。

Collector yield 并不低，因此 **不**发 uniqueness contract change proposal。

下一轮：**BIND_MIN_PRIOR_LENGTH1_AUDIT**（只审计，或由用户决定是否提案改 minPrior / 单字 prior）。之后才是 FineSpan path audit。

---

Single-Char Collector Live Audit:
DESIGN_LIMITATION


================================================
RUNTIME
================================================

dialog_200:
199 INVOKED + 1 pipeline 504 (d192) / 200


1-char Windows:
4477


Lexicon Bundle:
13 / sha256:eb7f6e32955c559fc2ce9faf8b46be5071bbf226beb7cb8a0713434f7ac725b7


Single-char Rows:
2510


Trace Behavior Equivalent:
YES (fixture); live same-raw 3/3


================================================
GLOBAL COLLECTOR FUNNEL
================================================

Applicable Windows:
4477


Query Executed:
4027


SQL Hit:
3377


Tone Ready:
4027


Tone Pattern Present:
4027


Tone Exact >=1:
3377


Unique Tone Exact:
984


Surface Exact:
1799


Accepted:
2331


Fallback:
2146


Collector Accept Rate:
52.07%


================================================
TARGET SITES
================================================

True Recall Single-char Units:
213


Valid 1-char Path Site:
172 (all fallback)


Collector Accepted Expected Surface:
2


Rejected:
211 collector-not-expected + bind-drop of accepts


No Valid 1-char Path:
41


Target-Site Accept Rate:
0.94% (expected surface)


================================================
TERMINAL REASONS
================================================

SQL_NO_HIT:
650


TONE_READINESS_NOT_READY:
0


NO_TONE_PATTERN:
450


NO_TONE_EXACT_CANDIDATE:
0


MULTIPLE_TONE_EXACT_CANDIDATES:
1046


SURFACE_EXACT_MISS:
0


MIN_SCORE_REJECT:
0


LIMIT_TRUNCATION_REJECT:
0


NORMALIZATION_SURFACE_MISMATCH:
0


OTHER_REJECT:
0


ACCEPT_SURFACE_EXACT:
1347


ACCEPT_UNIQUE_TONE_EXACT:
984


================================================
ROOT CAUSE
================================================

Largest Reject Reason:
MULTIPLE_TONE_EXACT_CANDIDATES


Percentage:
23.4% of windows


1.1C Fail-Closed:
SECONDARY


Uniqueness:
SECONDARY (collector); PRIMARY only for expected-surface substitution


Surface Exact:
NOT_CAUSE (this is an accept path)


Score:
NOT_CAUSE


LIMIT:
NOT_CAUSE


Normalization:
NOT_CAUSE


Bind minPrior 0.5:
PRIMARY for 0 lexical 1-char FineSpan (2331/2331 accepts unbound)


================================================
CONFORMANCE
================================================

Base-only:
PASS


Exact-only:
PASS


No Fuzzy:
PASS


No Domain:
PASS


Cap=1:
PASS


Frozen Collector Semantics:
PASS


Hidden Filter:
YES (bind minPrior; not inside collector accept)


================================================
DECISION
================================================

Collector Working As Designed:
YES


Implementation Bug Found:
NO


Implementation Fix Required:
NO


Frozen Contract Is Primary Limitation:
NO (for global lexical FineSpan); YES (for expected-char substitution yield)


Contract Change Proposal Required:
NO


FineSpan Change Required:
NO


Lexicon Change Required:
NO


Model2 Change Required:
NO


Budget Change Required:
NO


Assembly Change Required:
NO


Training Required:
NO


Recommended Next Phase:
BIND_MIN_PRIOR_LENGTH1_AUDIT
