# Lingua FW Repair V4 — Bind minPrior Length-1 Audit

**Date:** 2026-08-19  
**Stage:** `FW_REPAIR_V4_BIND_MIN_PRIOR_LENGTH1_AUDIT`  
**Type:** AUDIT ONLY / READ ONLY  
**Artifacts:** `training/model2_v3/experiments/v3_stage_j_live_dialog200/bind_minprior_length1_audit_2026_08_19/`

本轮不改 minPrior、priorScore、collector、FineSpan、库存、Model2、Assembly、Budget、KenLM，也不训练。

权威 live 仍是 2026-08-18 collector 审计：1-char windows **4477**，collector accept **2331**，accept 后 bind **2331/2331** 因 `priorScore < 0.5` 丢弃。dialog_200：**199 INVOKED + d192 pipeline 504**（基础设施，不改业务）。

---

## 0. 五个问题的答案

### A. minPrior=0.5 的设计 owner

**Candidate Binder / Recall pre-filter**，函数 `bindLexiconHitsToWindow`。  
默认来自 `fw-config.ts`：`cfg.minPrior ?? 0.5`。  
CONFIG.md 把它标成词库**运营**键；Recall 冻结合同又规定改 minPrior 必须走 Framework Impact Audit。FineSpan / Vote / Assembly / KenLM **不拥有**该阈值。

### B. 原始针对什么

历史记录（2026-07-27 LexicalEdge / Import / Length-1-5 审计）表明：防止 **低 operational prior 的词库噪声**（例如 `麻烦` prior=0.35、`homophone_variant`），以及默认 Patch/CSV prior **0.85–0.9** 下“只有显式低 prior 才被滤”。

不是：单字歧义闸（那是 uniqueness / tone / cap=1）；不是 fuzzy 爆炸闸（fuzzy min=2）；不是 FineSpan 边质量公式。

### C. 冻结单字设计是否要求同一 minPrior=0.5

代码：**是**，bind **无** length 分支。  
Lattice CR 1.0.2：**未写** bypass，也**未写** length-1 必须用 0.5。  
历史连通性审计：**禁止降 minPrior**，要求受控单字 prior 0.85–0.95。  

冻结 length-specific prior policy：**CONTRACT_GAP**（文档未定义 length=1 与 2+ 是否应不同阈值）。  
因此 “Applies To Length-1 By Frozen Design” = 对 **统一 bind 闸** 为 YES；对 **专门 length-1 政策** 为 UNDEFINED。本报告主字段取统一闸：**YES**（无 bypass 证据）。

### D. 为什么 2510 行全是 0.08–0.30

IME TSV `weight` 被 Full Rebuild **原样写入** `prior_score`（缺省 0.12）。TSV **没有** `prior` 列。  
这符合 Aug-18 导入**实现**，不符合 July-27 运营 prior 0.85 标尺。不是 sqlite 运行时 clamp。

### E. 若只让 2331 个已 accept 的单字进入 bind（不改 prior）

离线 CF1（非提案）：最多 **2331** 条 lexical 1-char 边（每窗 cap=1）。  
每句 mean / P95 / max 见下文。**不是** fuzzy 候选爆炸。  
其中大量是 **identity**（ASR 字→同字）；unique-tone 替换里多数 **不是** expected 修复。  
true-recall 目标位 expected 表面仍约 **2/213**。恢复 materialization ≠ 大规模纠错。

---

## 1. Primary verdict

**FROZEN_CONTRACT_INCOMPATIBILITY**

- minPrior=0.5 用于全部 bind hits：符合 Recall 冻结流水线，且历史明确禁止为了单字连通性去降阈值。  
- 2510 prior=IME `weight`（0.08–0.30）：符合 Aug-18 库存导入算法，并随 bundle 13 冻结。  
- 二者组合：**0** 个单字能过 0.5 → lexical 1-char FineSpan=0。

不是 IMPLEMENTATION_DRIFT（没有“length-1 应绕过 minPrior”的冻结条文）。  
不是 PRIOR_DATA_BUG（2510 生成算法就是 weight 直通，不是相对该算法的 build 错误）。  
不是 WORKING_AS_DESIGNED 去解释“产品故意要 0 条 lexical 单字边”（Lattice 1.0.2 要求正式 length-1 边来自带 termId 的 operational recall；导入 2510 的目的是让这条路径存在）。

次要发现：OWNERSHIP_DRIFT_POSSIBLE；IME weight 与 operational prior **语义混用**。

---

## 2. 产品护栏

Collector 在 213 个 true-recall 单字目标上选出 **expected 表面仅 2**。  
即使未来允许 2331 条边 bind，也只是 **恢复 lexical 1-char edge materialization**。  
不得表述为“修 minPrior 后单字 recall/纠错就解决了”。

---

Bind MinPrior Length-1 Audit:
CONTRACT_INCOMPATIBILITY


================================================
MINPRIOR
================================================

Current minPrior:
0.5


Owner:
Candidate Binder (bindLexiconHitsToWindow) / Recall pre-filter; config default fw-config.ts; CONFIG.md 运营键; Recall freeze 2026-08-03 变更需 snapshot


Original Purpose:
Filter low operational-prior lexical noise (e.g. homophone_variant / 麻烦 0.35) after enumerator, before WindowCandidate. Not a single-char ambiguity gate.


Applies To Length-1 By Frozen Design:
YES


Applies To Length-2+:
YES


Length-Specific Contract:
NO


================================================
PRIOR SCORE
================================================

Single-char N:
2510


Single-char Prior Min:
0.08


P50:
0.08


P95:
0.24


Max:
0.3


>=0.5:
0 / 2510 (0.0)


Prior Source:
IME TSV column `weight` copied to sqlite `prior_score` by loadSingleCharRows (default 0.12). Not frequency-normalized operational confidence. Multi-char CSV default remains 0.9.


Prior Generation Matches Frozen Contract:
UNCLEAR


================================================
MULTI-CHAR COMPARISON
================================================

2-char Prior P50:
0.85


3-char Prior P50:
0.86


Bound Multi-char Prior Range:
0.84–0.92 (n=232; >=0.5: 232)


minPrior Appropriate For Multi-char:
YES


================================================
2331 ACCEPTED
================================================

Collector Accepted:
2331


Would Pass minPrior=0.5:
0


Surface-Exact:
1347


Unique-Tone:
984


Identity Candidate:
1819


Substitution Candidate:
512


Expected Target Candidate:
2


================================================
COUNTERFACTUAL
================================================

Current Lexical 1-char Edges:
0


If Accepted Length-1 Could Bind:
2331


Edge Count Mean:
11.713568


Edge Count P95:
19.0


Edge Count Max:
24


Identity Edges:
1819


Substitution Edges:
512


Expected Correction Edges:
2


Potential Wrong Substitution Opportunities:
510


Candidate Explosion:
NO


================================================
ROOT CAUSE
================================================

Primary Verdict:

FROZEN_CONTRACT_INCOMPATIBILITY


Evidence:
Uniform bind minPrior=0.5 with no length bypass (Recall freeze). 2510 priors are IME TSV weights 0.08–0.30 by Aug-18 rebuild. 0/2510 and 0/2331 pass 0.5. Multi-char operational priors sit at ~0.9 and do pass. Lattice CR never waived minPrior and never redefined IME weight as operational prior.


================================================
DECISION
================================================

Change minPrior:
NO / PROPOSAL_REQUIRED


Change Single-char Prior:
NO / PROPOSAL_REQUIRED


Restore Frozen Implementation:
NO


Architecture / Contract Change Proposal:
YES


Single-char Collector Change:
NO


FineSpan Change:
NO


Lexicon Inventory Change:
NO


Model2 Change:
NO


Assembly Change:
NO


Budget Change:
NO


Training:
NO


Recommended Next Phase:
ARCHITECTURE_CONTRACT_CHANGE_PROPOSAL_BIND_MINPRIOR_LENGTH1 (user confirmation required; do not ship length==1 bypass or global prior lift)

---

## Appendix notes

- Surface-exact accept prior P50: 0.12; unique-tone P50: 0.12. Both bands remain <0.5; neither accept path is uniquely “too low”.
- Identity edges would add lexical copies of the ASR character; they do not by themselves repair true-recall substitutions.
- Unique-tone substitutions include live examples such as 好→毫 / 我→涡: if bound, they are wrong-substitution opportunities, not expected repairs.
- Downstream Assembly/KenLM CF: **NOT_RUN** (would require lattice mutation or production replay).
- d192: infrastructure-only; this audit reused 4477 windows and did not retry ASR.
