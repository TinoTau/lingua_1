# Lingua FW Repair V4 — Single-Char Repair Lexicon Lexical Validity Audit

**Date:** 2026-08-19  
**Stage:** `FW_REPAIR_V4_SINGLE_CHAR_REPAIR_LEXICON_LEXICAL_VALIDITY_AUDIT`  
**Type:** AUDIT ONLY / READ ONLY  
**Artifacts:** `training/model2_v3/experiments/v3_stage_j_live_dialog200/single_char_repair_lexicon_lexical_validity_audit_2026_08_19/`

未改 SQLite、TSV、minPrior、prior、collector、FineSpan、Model2；未训练；未用 dialog_200 expectedText 选字；未用 LLM 逐字判决 2510。

---

## 0. 假设是否成立

**成立方向：**「常用汉字」≠「可独立用于单字纠错的词」。

当前 2510 的原始用途是 **Pinyin-IME 解码断路单字表**（通用规范汉字一级 + pinyin-data），权重是 **IME 角色政策**（fallback=0.08 … 功能词=0.30），不是成词证据。

2026-08-18 把它导入 `base_lexicon` 只满足了 Lattice「约 2000–3000 单字库存存在」，**没有**满足「独立 lexical repair item」。

**不能在本轮重建：** 仓库没有已授权的单字成词 / 独立 token 频率源。jieba 1 字曾被 `banSingleChar` / `reject one_char` 明确拒绝进生产词库。KenLM 语料是**按字切开的**，不是分词语料。

---

## 1. 当前源语义

见 `single_char_dictionary_provenance.md`。

**CURRENT_INVENTORY_HAS_NO_WORDHOOD_EVIDENCE.**

`frequency_rank` = 一级字表序号。`weight` = IME role 常量表，不是字频。

## 2. 权威源

| 能力 | 状态 |
|------|------|
| 汉语**词**典（单字词条） | 无 |
| 生产授权 POS | 无（仅有 jieba **拒绝快照** POS，DERIVED） |
| 独立 token 证据 | 无 |
| 独立词频 | 无 |
| 分词后语料 | TOKENIZED_CORPUS_REQUIRED |
| 足以 rebuild | **否** |

jieba overlap with 2510: **2509** / 2510 出现在 `rejected.jsonl` `reject_single_char`。这只证明 jieba 种子里有这些一字条目且被 Lingua **拒绝导入**，不能当作本轮 SUPPORTED。

## 3. 2510 资格

机械规则：没有生产授权成词证据 → 全部 **UNCERTAIN**。  
禁止把「看起来不像词」标成 NOT_SUPPORTED。  
禁止把 IME fallback 角色标成 NOT_SUPPORTED。

IME 角色仅用于 **provisional_class** 的极小子集：function→FUNCTION_WORD（79），measure→NUMERAL_OR_MEASURE（32）。其余 UNCERTAIN。

## 4. 好→毫 / 我→涡

不得假设应删除。

| 字 | IME role | weight | eligibility |
|----|----------|--------|-------------|
| 好 | content_single_char | 0.12 | UNCERTAIN |
| 毫 | content_single_char_fallback | 0.08 | UNCERTAIN |
| 我 | function_single_char | 0.30 | UNCERTAIN |
| 涡 | content_single_char_fallback | 0.08 | UNCERTAIN |

Live unique-tone 走的是**声学调**，不是汉字词典调：窗「好」在 tone2 上唯一命中「毫」。这是 collector 冻结语义 + 过大 character universe 的组合，不是本轮可修的实现 bug。

## 5. Consumers

IME V2 **正在**读这份 TSV 做 `byFirstFallback`。因此 **不能**为了 FW Repair 直接把 2510 删成几百个。优先 **数据职责分离**（Option C）。

## 6. minPrior

本轮不解决 0.08–0.30 vs 0.5。未来若存在小型 repair lexicon，operational prior 是否仍需要：**UNDEFINED**（禁止统一 prior=0.9，禁止扫阈值）。

---

Single-Char Repair Lexicon Audit:
INSUFFICIENT_SOURCE


================================================
CURRENT INVENTORY
================================================

Current Characters:
2510


Original Purpose:
Pinyin-IME decoder path-breakage single-character inventory (通用规范汉字一级 + mozillazg pinyin-data), later reused as FW Repair length-1 base_lexicon fill


Wordhood Evidence In Current Source:
NO


Current Inventory Suitable As Repair Lexicon:
NO


================================================
AUTHORITATIVE SOURCES
================================================

Lexical Dictionary Available:
NO


POS Evidence Available:
NO


Standalone Token Evidence Available:
NO


Standalone Frequency Available:
NO


Sources Sufficient For Rebuild:
NO


================================================
2510 EVIDENCE
================================================

SUPPORTED:
0


NOT_SUPPORTED:
0


UNCERTAIN:
2510


Independent Content Words:
0


Function Words:
79 (IME role provisional only; eligibility UNCERTAIN)


Numeral / Measure:
32 (IME role provisional only; eligibility UNCERTAIN)


Interjection / Discourse:
0


Bound / Formation Components:
0


Proper-Name Components:
0


Rare Standalone:
0


================================================
CANDIDATE UNIVERSE
================================================

Current Universe:
2510


Evidence-Supported Repair Universe:
0


Current Unique Pinyin+Tone Groups:
418


Supported Unique Pinyin+Tone Groups:
0


Current Ambiguous Groups:
564


Supported Ambiguous Groups:
0


================================================
COUNTERFACTUAL
================================================

Previous Substitution Opportunities:
512


Remain Under Supported Universe:
0


Removed:
512


Expected Corrections:
0


Non-Expected Substitution Opportunities:
0


Identity Candidates:
0


Ambiguous Fallback:
0


No Candidate:
2331


================================================
DIALOG_200 EVALUATION
================================================

True-Recall Single-Char Targets:
213


Current 2510 Coverage:
200


Supported-Universe Coverage:
0


Expected Unique-Tone Candidate:
0


Non-Expected Unique-Tone Candidate:
0


================================================
CONSUMERS
================================================

2510 Inventory Other Consumers:
Pinyin-IME-V2 (TSV → byFirstFallback); full-rebuild import; IME export path over sqlite base_lexicon; tests; Model2 feature if edges bind


Can Existing Inventory Be Replaced Directly:
NO


Separate Repair Lexicon Recommended:
YES


================================================
CONTRACT
================================================

Old Contract:
COMMON_CHARACTER_INVENTORY


Proposed Contract:
INDEPENDENT_SINGLE_CHAR_LEXICAL_REPAIR_INVENTORY


Contract Change Supported By Evidence:
YES


Architecture Change Proposal Required:
YES


================================================
DECISION
================================================

Rebuild Single-Char Repair Lexicon:
HOLD


Modify Existing 2510 Source:
NO


Create Separate Repair Inventory:
YES


Change minPrior Now:
NO


Change priorScore Now:
NO


Change Collector:
NO


Change FineSpan:
NO


Change Model2:
NO


Change Assembly:
NO


Training:
NO


Recommended Target Size:
UNKNOWN


Recommended Next Phase:
FIND_AUTHORITATIVE_SINGLE_CHAR_WORDHOOD_SOURCE (tokenized corpus or licensed word list; jieba 1-char would need explicit re-authorization). Then SEPARATE IME inventory vs repair inventory. Do not rebuild from 2510 roles or dialog_200.
