# Lingua FW Repair V4 — Single-Char Repair Lexicon Grouping / Counterfactual Audit

**Date:** 2026-08-19  
**Stage:** `FW_REPAIR_V4_SINGLE_CHAR_REPAIR_LEXICON_GROUPING_AND_COUNTERFACTUAL_AUDIT`  
**Type:** AUDIT ONLY / READ ONLY  
**Artifacts:** `training/model2_v3/experiments/v3_stage_j_live_dialog200/single_char_repair_lexicon_grouping_audit_2026_08_19/`

未导入 SQLite，未改 2510 IME 表、minPrior、collector、FineSpan、Model2；未用 dialog_200 筛选词表成员。

CLD 三套表来自 `docs/user_correction/single_char/`。分组键：规范化 `pinyin` + tone（缺调号的旧 TSV 音节对齐为 tone=5，仅用于跨表比较）。

---

## Answers

**A.** STRICT unique groups = **515**（字数 515，unique word rate 0.4578）。

**B.** STRICT 歧义：size2=145 size3=66 size4=14 size5+=12 groups；ambiguous words 610。

**C.** 512 旧 substitution replay：OLD non-expected 510 → STRICT 272（约 −47%）。但在 213 个 true-recall 目标的 **acoustic unique-tone** 上，STRICT 的 non-expected unique **升高**（23→43）：缩小词表会把原先歧义组变成错误的唯一候选（例：`du4` 只剩「度」）。BALANCED live non-expected=26，仍高于 OLD 的 23。毫/涡：毫不在 STRICT（hao2 → NO_CANDIDATE）；涡不在 STRICT，`wo1` 为 喔/窝 歧义 fallback。BALANCED 的 hao2 会 unique 成「豪」（仍是误修）。

**D.** 213 个 true-recall 单字目标的**词表成员覆盖**：OLD2510 200，STRICT 183（86%），BALANCED 197，FULL 213。覆盖 ≠ unique-tone 可修。

**E.** unique-only 理论（acoustic query）：见 UNIQUE-TONE COUNTERFACTUAL。STRICT expected unique=2，non-expected unique=43，precision proxy=0.044。

**F.** **不适合**作为第一版 production candidate universe（HOLD）。词表成词方向正确，但 unique-only 合同下 residual 误修仍高，且会因“歧义坍缩”制造新误修。

Overlap STRICT ∩ OLD2510 = 927；STRICT only 198；OLD only 1583。不是 2510 的纯子集。

---

Single-Char Repair Lexicon Grouping Audit:
HOLD


================================================
INPUT
================================================

OLD2510:
2510


STRICT:
1125


BALANCED:
1420


FULL_CLD:
3913


Invalid Rows:
0


Duplicates:
0 exact (word,group_key); heteronyms counted separately


================================================
PINYIN + TONE GROUPS
================================================

                  OLD2510   STRICT   BALANCED   FULL

Groups:
982   752   849   1156

Unique Groups:
418   515   523   360

Words In Unique Groups:
418   515   523   360

Words In Ambiguous Groups:
2092   610   897   3553

Unique Word Rate:
0.1665   0.4578   0.3683   0.092

Mean Group Size:
2.556   1.496   1.6726   3.3849

P95 Group Size:
6.0   3.0   4.0   9.0

Max Group Size:
20   7   10   26


================================================
STRICT FREQUENCY
================================================

SUBTLEX P50:
57.194


Weibo P50:
64.9408


Combined P50:
66.7976


Unique Group Frequency P50:
69.7331


Ambiguous Group Frequency P50:
64.0401


================================================
DIALOG_200 TARGET COVERAGE
================================================

True Recall Single-char Targets:
213


OLD2510 Coverage:
200 (0.939)


STRICT Coverage:
183 (0.8592)


BALANCED Coverage:
197 (0.9249)


FULL Coverage:
213 (1.0)


================================================
UNIQUE-TONE COUNTERFACTUAL
================================================

                  OLD2510   STRICT   BALANCED   FULL

Expected Unique:
0   2   1   0

Non-Expected Unique:
23   43   26   21

Ambiguous:
133   92   114   144

No Candidate:
44   64   59   39

Identity:
13   12   13   9

Precision Proxy:
0.0   0.0444   0.037   0.0

Recall Proxy:
0.0   0.0094   0.0047   0.0


================================================
OLD 512 SUBSTITUTIONS
================================================

OLD Non-Expected:
510


STRICT Non-Expected:
272


BALANCED Non-Expected:
273


STRICT Reduction:
0.4667


BALANCED Reduction:
0.4647


================================================
BAD EXAMPLES
================================================

好→毫:

OLD:
present=True query=UNIQUE unique=毫 size=1

STRICT:
present=False query=NO_CANDIDATE unique=None size=0

BALANCED:
present=False query=UNIQUE unique=豪 size=1

FULL:
present=True query=AMBIGUOUS unique=None size=5


我→涡:

OLD:
present=True query=UNIQUE unique=涡 size=1

STRICT:
present=False query=AMBIGUOUS unique=None size=2

BALANCED:
present=False query=AMBIGUOUS unique=None size=2

FULL:
present=True query=AMBIGUOUS unique=None size=6


================================================
DECISION MATRIX
================================================

STRICT:

Coverage:
183 / 213

Precision Proxy:
0.0444

Non-Expected Risk:
43 live unique-tone; 272 of 512 replay

Ambiguity:
word rate 0.5422


BALANCED:

Coverage:
197 / 213

Precision Proxy:
0.037

Non-Expected Risk:
26 live unique-tone; 273 of 512 replay

Ambiguity:
word rate 0.6317


================================================
RECOMMENDATION
================================================

Recommended Candidate Universe:
NONE


Reason:
Non-expected unique substitutions remain high on both STRICT and BALANCED.


Production Import Ready:
NO


License Review Required:
YES


Change Existing 2510 IME Inventory:
NO


Create Separate Repair Lexicon:
YES


Change minPrior Now:
NO


Change Collector:
NO


Change FineSpan:
NO


Change Model2:
NO


Training:
NO


Recommended Next Phase:
HOLD_NO_IMPORT — unique-only + CLD STRICT/BALANCED still fails precision. Next: further single-char repair contract redesign (not sqlite import). Keep IME 2510. LICENSE_REVIEW_REQUIRED if a CLD-derived table is ever proposed.
