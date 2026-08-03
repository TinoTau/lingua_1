<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: docs/current/INDEX.md
Archive Path: docs/archive/HISTORICAL/FW_Repair_V4_Atomicity_REJECT_Composite_Batch1_Review_2026_08_02.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: docs/current/INDEX.md

# FW Repair V4 — Atomicity REJECT_COMPOSITE Batch-1 Review

**Date:** 2026-08-02  
**Nature:** READ ONLY · SOURCE-LEVEL REVIEW · 74 TERMS ONLY  
**Verdict:** `BATCH1_REVIEW_READY`

---

## 1. Executive Conclusion

已对 Candidate Bundle `atomicity_report` 中全部 **74** 条 `REJECT_COMPOSITE` 完成 Source 追溯、原子拆分、语义分类、Domain 影响与只读 Lattice/Exact 证据审计。

| Recommendation | Count |
|----------------|------:|
| DELETE_CONFIRMED | 71 |
| KEEP_AS_EXCEPTION | 3 |
| VALIDATOR_FALSE_POSITIVE | 0 |
| INSUFFICIENT_EVIDENCE | 0 |
| REVIEW_DOMAIN_TAGS (follow-up, may overlap DELETE) | 12 |

重点：
- **上线计划 / 接口文档** → `DELETE_CONFIRMED`（本轮不删除）
- **内科医生 / 国家博物馆 / 焦糖玛奇朵 / 蓝莓马芬** → `NOT_IN_REJECT_BATCH`（均为 UNRESOLVED，不入本批删除清单）
- Bundle 未变：term=10061，contentHash=`2c0088e3983826aa83018f38f2f8ec56cd0ec5bb31a4e824e6a1d2c44a6dca3f`

CSV: [reject_composite_batch1_review.csv](./reject_composite_batch1_review.csv)

---

## 2. Audit Scope

只读审计 `REJECT_COMPOSITE=74`。不修改 Source / Validator / SQLite / Domain Tags；不 rebuild；不切 enforce；不混入 740 个 UNRESOLVED。

---

## 3. Input Baseline

| Field | Value |
|-------|-------|
| Report | `node_runtime/lexicon/_rebuild_candidate/atomicity_report.json` |
| REJECT_COMPOSITE count | **74** |
| Report summary | ACCEPT 9247 / REJECT 74 / UNRESOLVED 740 |
| Baseline | **MATCH** |

---

## 4. Review Contract

DELETE_CONFIRMED 须同时满足 D-01…D-07。否则 KEEP / FP / INSUFFICIENT。本轮**不执行**任何删除。

---

## 5. Source Inventory

- `lexicon_full_corrected_review.csv`
- `supplemental_terms.csv`

每条 REJECT 已 trace 到 sourceFile + sourceRow（见 §11）。

---

## 6–10. Methods

- **Segments:** 拼接覆盖 + term 表存在性 + Exact Recall + domains  
- **Semantics:** 业务类别独立判定，不单复述 reasonCode  
- **Exception:** KEEP 必须建议 termType + exceptionReason  
- **Domain:** compound vs segment 并集；禁止机械复制标签  
- **Lattice CF:** 只读 Exact Recall；全 segment Exact → SEGMENTS_CAN_COVER  

---

## 11. Review Item 1–74

## 1. 可以吗

Source: lexicon_full_corrected_review.csv row 13 (expansion_v1_1)
Term ID: exp-v1_1-keyima
Domains: []
Validator Decision: REJECT_COMPOSITE
Reason: SENTENCE_FRAGMENT
Segments: (none)

Atomic Segment Check:
  - (no segments)

Exact Recall:
  - compound: false
  - n/a

Semantic Classification: OTHER
Exception Evidence: none (ordinary composite / fragment)
Domain Impact: DOMAIN_EVIDENCE_PRESERVED
Lattice Counterfactual: without-compound coverage=NO_SEGMENTS_FRAGMENT_OK; duplicatePath=NO_RUNTIME_DUPLICATION
Runtime Duplication: NO_RUNTIME_DUPLICATION

Recommendation: DELETE_CONFIRMED
Recommended Source Action: DELETE_SOURCE_ROW
Recommended termType: (n/a)
Recommended exceptionReason: (n/a)
Follow-up: none
Notes: 句段/口语碎片，非独立正式原子词；删除不依赖 parent fragment

## 2. 上线计划

Source: supplemental_terms.csv row 41 (supplemental)
Term ID: term-e4b88ae7babfe8ae
Domains: [tech_ai]
Validator Decision: REJECT_COMPOSITE
Reason: ACTION_OBJECT_PHRASE
Segments: 上线 + 计划

Atomic Segment Check:
  - 上线: formal=true id=exp-v1_1-alias-shangxian domains=[tech_ai] pinyin=shang|xian
  - 计划: formal=true id=exp-v1_1-alias-jihua domains=[] pinyin=ji|hua

Exact Recall:
  - compound: true
  - 上线: ExactRecall=true
  - 计划: ExactRecall=true

Semantic Classification: ACTION_OBJECT_PHRASE
Exception Evidence: none (ordinary composite / fragment)
Domain Impact: DOMAIN_EVIDENCE_PRESERVED
Lattice Counterfactual: without-compound coverage=SEGMENTS_CAN_COVER; duplicatePath=REDUNDANT_FULL_TERM_PATH
Runtime Duplication: REDUNDANT_FULL_TERM_PATH

Recommendation: DELETE_CONFIRMED
Recommended Source Action: DELETE_SOURCE_ROW
Recommended termType: (n/a)
Recommended exceptionReason: (n/a)
Follow-up: none
Notes: 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖

## 3. 专家系统

Source: lexicon_full_corrected_review.csv row 272 (industry_pack_v1)
Term ID: term-e4b893e5aeb6e7b3
Domains: []
Validator Decision: REJECT_COMPOSITE
Reason: NOUN_NOUN_BUSINESS_PHRASE
Segments: 专家 + 系统

Atomic Segment Check:
  - 专家: formal=true id=term-e4b893e5aeb67c7a domains=[] pinyin=zhuan|jia
  - 系统: formal=true id=term-e7b3bbe7bb9f7c78 domains=[] pinyin=xi|tong

Exact Recall:
  - compound: true
  - 专家: ExactRecall=true
  - 系统: ExactRecall=true

Semantic Classification: FIXED_TECHNICAL_TERM
Exception Evidence: recommended fixed_technical_term
Domain Impact: DOMAIN_EVIDENCE_PRESERVED
Lattice Counterfactual: without-compound coverage=SEGMENTS_CAN_COVER; duplicatePath=REDUNDANT_FULL_TERM_PATH
Runtime Duplication: REDUNDANT_FULL_TERM_PATH

Recommendation: KEEP_AS_EXCEPTION
Recommended Source Action: ADD_EXCEPTION_METADATA
Recommended termType: fixed_technical_term
Recommended exceptionReason: 「专家系统」是经典 AI 固定技术术语，指一类完整系统形态，拆成「专家+系统」不能等价替代其学科/产品指称。
Follow-up: none
Notes: 经典技术术语例外

## 4. 专题会议

Source: lexicon_full_corrected_review.csv row 286 (industry_pack_v1)
Term ID: term-e4b893e9a298e4bc
Domains: [meeting]
Validator Decision: REJECT_COMPOSITE
Reason: NOUN_NOUN_BUSINESS_PHRASE
Segments: 专题 + 会议

Atomic Segment Check:
  - 专题: formal=true id=term-e4b893e9a2987c7a domains=[] pinyin=zhuan|ti
  - 会议: formal=true id=term-e4bc9ae8aeae7c68 domains=[meeting] pinyin=hui|yi

Exact Recall:
  - compound: true
  - 专题: ExactRecall=true
  - 会议: ExactRecall=true

Semantic Classification: NOUN_NOUN_BUSINESS_PHRASE
Exception Evidence: none (ordinary composite / fragment)
Domain Impact: DOMAIN_EVIDENCE_PRESERVED
Lattice Counterfactual: without-compound coverage=SEGMENTS_CAN_COVER; duplicatePath=REDUNDANT_FULL_TERM_PATH
Runtime Duplication: REDUNDANT_FULL_TERM_PATH

Recommendation: DELETE_CONFIRMED
Recommended Source Action: DELETE_SOURCE_ROW
Recommended termType: (n/a)
Recommended exceptionReason: (n/a)
Follow-up: none
Notes: 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖

## 5. 主持会议

Source: lexicon_full_corrected_review.csv row 437 (industry_pack_v1)
Term ID: term-e4b8bbe68c81e4bc
Domains: [meeting]
Validator Decision: REJECT_COMPOSITE
Reason: NOUN_NOUN_BUSINESS_PHRASE
Segments: 主持 + 会议

Atomic Segment Check:
  - 主持: formal=true id=term-e4b8bbe68c817c7a domains=[] pinyin=zhu|chi
  - 会议: formal=true id=term-e4bc9ae8aeae7c68 domains=[meeting] pinyin=hui|yi

Exact Recall:
  - compound: true
  - 主持: ExactRecall=true
  - 会议: ExactRecall=true

Semantic Classification: NOUN_NOUN_BUSINESS_PHRASE
Exception Evidence: none (ordinary composite / fragment)
Domain Impact: DOMAIN_EVIDENCE_PRESERVED
Lattice Counterfactual: without-compound coverage=SEGMENTS_CAN_COVER; duplicatePath=REDUNDANT_FULL_TERM_PATH
Runtime Duplication: REDUNDANT_FULL_TERM_PATH

Recommendation: DELETE_CONFIRMED
Recommended Source Action: DELETE_SOURCE_ROW
Recommended termType: (n/a)
Recommended exceptionReason: (n/a)
Follow-up: none
Notes: 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖

## 6. 休息时间

Source: lexicon_full_corrected_review.csv row 787 (industry_pack_v1)
Term ID: term-e4bc91e681afe697
Domains: []
Validator Decision: REJECT_COMPOSITE
Reason: NOUN_NOUN_BUSINESS_PHRASE
Segments: 休息 + 时间

Atomic Segment Check:
  - 休息: formal=true id=term-e4bc91e681af7c78 domains=[] pinyin=xiu|xi
  - 时间: formal=true id=term-e697b6e997b47c73 domains=[] pinyin=shi|jian

Exact Recall:
  - compound: false
  - 休息: ExactRecall=false
  - 时间: ExactRecall=true

Semantic Classification: NOUN_NOUN_BUSINESS_PHRASE
Exception Evidence: none (ordinary composite / fragment)
Domain Impact: DOMAIN_EVIDENCE_PRESERVED
Lattice Counterfactual: without-compound coverage=SEGMENTS_INCOMPLETE; duplicatePath=SEMANTICALLY_DISTINCT_FULL_TERM_PATH
Runtime Duplication: SEMANTICALLY_DISTINCT_FULL_TERM_PATH

Recommendation: DELETE_CONFIRMED
Recommended Source Action: DELETE_SOURCE_ROW
Recommended termType: (n/a)
Recommended exceptionReason: (n/a)
Follow-up: none
Notes: 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖

## 7. 会议通知

Source: supplemental_terms.csv row 32 (supplemental)
Term ID: term-e4bc9ae8aeaee980
Domains: [meeting]
Validator Decision: REJECT_COMPOSITE
Reason: NOUN_NOUN_BUSINESS_PHRASE
Segments: 会议 + 通知

Atomic Segment Check:
  - 会议: formal=true id=term-e4bc9ae8aeae7c68 domains=[meeting] pinyin=hui|yi
  - 通知: formal=true id=term-e9809ae79fa57c74 domains=[] pinyin=tong|zhi

Exact Recall:
  - compound: true
  - 会议: ExactRecall=true
  - 通知: ExactRecall=true

Semantic Classification: NOUN_NOUN_BUSINESS_PHRASE
Exception Evidence: none (ordinary composite / fragment)
Domain Impact: DOMAIN_EVIDENCE_PRESERVED
Lattice Counterfactual: without-compound coverage=SEGMENTS_CAN_COVER; duplicatePath=REDUNDANT_FULL_TERM_PATH
Runtime Duplication: REDUNDANT_FULL_TERM_PATH

Recommendation: DELETE_CONFIRMED
Recommended Source Action: DELETE_SOURCE_ROW
Recommended termType: (n/a)
Recommended exceptionReason: (n/a)
Follow-up: none
Notes: 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖

## 8. 入住时间

Source: supplemental_terms.csv row 61 (supplemental)
Term ID: term-e585a5e4bd8fe697
Domains: [tourism_hotel]
Validator Decision: REJECT_COMPOSITE
Reason: ACTION_OBJECT_PHRASE
Segments: 入住 + 时间

Atomic Segment Check:
  - 入住: formal=true id=term-e585a5e4bd8f7c72 domains=[tourism_hotel] pinyin=ru|zhu
  - 时间: formal=true id=term-e697b6e997b47c73 domains=[] pinyin=shi|jian

Exact Recall:
  - compound: true
  - 入住: ExactRecall=true
  - 时间: ExactRecall=true

Semantic Classification: ACTION_OBJECT_PHRASE
Exception Evidence: none (ordinary composite / fragment)
Domain Impact: DOMAIN_EVIDENCE_PRESERVED
Lattice Counterfactual: without-compound coverage=SEGMENTS_CAN_COVER; duplicatePath=REDUNDANT_FULL_TERM_PATH
Runtime Duplication: REDUNDANT_FULL_TERM_PATH

Recommendation: DELETE_CONFIRMED
Recommended Source Action: DELETE_SOURCE_ROW
Recommended termType: (n/a)
Recommended exceptionReason: (n/a)
Follow-up: none
Notes: 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖

## 9. 前台信息

Source: lexicon_full_corrected_review.csv row 1694 (industry_pack_v1)
Term ID: term-e5898de58fb0e4bf
Domains: [tourism_hotel]
Validator Decision: REJECT_COMPOSITE
Reason: NOUN_NOUN_BUSINESS_PHRASE
Segments: 前台 + 信息

Atomic Segment Check:
  - 前台: formal=true id=term-e5898de58fb07c71 domains=[tourism_hotel] pinyin=qian|tai
  - 信息: formal=true id=term-e4bfa1e681af7c78 domains=[] pinyin=xin|xi

Exact Recall:
  - compound: true
  - 前台: ExactRecall=true
  - 信息: ExactRecall=true

Semantic Classification: NOUN_NOUN_BUSINESS_PHRASE
Exception Evidence: none (ordinary composite / fragment)
Domain Impact: DOMAIN_EVIDENCE_PRESERVED
Lattice Counterfactual: without-compound coverage=SEGMENTS_CAN_COVER; duplicatePath=REDUNDANT_FULL_TERM_PATH
Runtime Duplication: REDUNDANT_FULL_TERM_PATH

Recommendation: DELETE_CONFIRMED
Recommended Source Action: DELETE_SOURCE_ROW
Recommended termType: (n/a)
Recommended exceptionReason: (n/a)
Follow-up: none
Notes: 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖

## 10. 单元测试

Source: supplemental_terms.csv row 43 (supplemental)
Term ID: term-e58d95e58583e6b5
Domains: [tech_ai]
Validator Decision: REJECT_COMPOSITE
Reason: NOUN_NOUN_BUSINESS_PHRASE
Segments: 单元 + 测试

Atomic Segment Check:
  - 单元: formal=true id=term-e58d95e585837c64 domains=[] pinyin=dan|yuan
  - 测试: formal=true id=term-e6b58be8af957c63 domains=[] pinyin=ce|shi

Exact Recall:
  - compound: true
  - 单元: ExactRecall=true
  - 测试: ExactRecall=true

Semantic Classification: NOUN_NOUN_BUSINESS_PHRASE
Exception Evidence: none (ordinary composite / fragment)
Domain Impact: DOMAIN_EVIDENCE_LOST + REVIEW_DOMAIN_TAGS
Lattice Counterfactual: without-compound coverage=SEGMENTS_CAN_COVER; duplicatePath=REDUNDANT_FULL_TERM_PATH
Runtime Duplication: REDUNDANT_FULL_TERM_PATH

Recommendation: DELETE_CONFIRMED
Recommended Source Action: DELETE_SOURCE_ROW
Recommended termType: (n/a)
Recommended exceptionReason: (n/a)
Follow-up: REVIEW_DOMAIN_TAGS
Notes: 普通业务组合可删；Domain 证据弱化/丢失，后续独立复核原子词标签（禁止机械复制组合域）

## 11. 向量状态

Source: lexicon_full_corrected_review.csv row 2441 (industry_pack_v1)
Term ID: term-e59091e9878fe78a
Domains: [tech_ai]
Validator Decision: REJECT_COMPOSITE
Reason: NOUN_NOUN_BUSINESS_PHRASE
Segments: 向量 + 状态

Atomic Segment Check:
  - 向量: formal=true id=term-e59091e9878f7c78 domains=[tech_ai] pinyin=xiang|liang
  - 状态: formal=true id=term-e78ab6e680817c7a domains=[] pinyin=zhuang|tai

Exact Recall:
  - compound: true
  - 向量: ExactRecall=true
  - 状态: ExactRecall=true

Semantic Classification: NOUN_NOUN_BUSINESS_PHRASE
Exception Evidence: none (ordinary composite / fragment)
Domain Impact: DOMAIN_EVIDENCE_PRESERVED
Lattice Counterfactual: without-compound coverage=SEGMENTS_CAN_COVER; duplicatePath=REDUNDANT_FULL_TERM_PATH
Runtime Duplication: REDUNDANT_FULL_TERM_PATH

Recommendation: DELETE_CONFIRMED
Recommended Source Action: DELETE_SOURCE_ROW
Recommended termType: (n/a)
Recommended exceptionReason: (n/a)
Follow-up: none
Notes: 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖

## 12. 咖啡时间

Source: lexicon_full_corrected_review.csv row 2518 (industry_pack_v1)
Term ID: term-e59296e595a1e697
Domains: [coffee]
Validator Decision: REJECT_COMPOSITE
Reason: NOUN_NOUN_BUSINESS_PHRASE
Segments: 咖啡 + 时间

Atomic Segment Check:
  - 咖啡: formal=true id=term-e59296e595a17c6b domains=[coffee] pinyin=ka|fei
  - 时间: formal=true id=term-e697b6e997b47c73 domains=[] pinyin=shi|jian

Exact Recall:
  - compound: true
  - 咖啡: ExactRecall=true
  - 时间: ExactRecall=true

Semantic Classification: NOUN_NOUN_BUSINESS_PHRASE
Exception Evidence: none (ordinary composite / fragment)
Domain Impact: DOMAIN_EVIDENCE_PRESERVED
Lattice Counterfactual: without-compound coverage=SEGMENTS_CAN_COVER; duplicatePath=REDUNDANT_FULL_TERM_PATH
Runtime Duplication: REDUNDANT_FULL_TERM_PATH

Recommendation: DELETE_CONFIRMED
Recommended Source Action: DELETE_SOURCE_ROW
Recommended termType: (n/a)
Recommended exceptionReason: (n/a)
Follow-up: none
Notes: 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖

## 13. 回归测试

Source: supplemental_terms.csv row 45 (supplemental)
Term ID: term-e59b9ee5bd92e6b5
Domains: [tech_ai]
Validator Decision: REJECT_COMPOSITE
Reason: NOUN_NOUN_BUSINESS_PHRASE
Segments: 回归 + 测试

Atomic Segment Check:
  - 回归: formal=true id=term-e59b9ee5bd927c68 domains=[] pinyin=hui|gui
  - 测试: formal=true id=term-e6b58be8af957c63 domains=[] pinyin=ce|shi

Exact Recall:
  - compound: true
  - 回归: ExactRecall=true
  - 测试: ExactRecall=true

Semantic Classification: NOUN_NOUN_BUSINESS_PHRASE
Exception Evidence: none (ordinary composite / fragment)
Domain Impact: DOMAIN_EVIDENCE_LOST + REVIEW_DOMAIN_TAGS
Lattice Counterfactual: without-compound coverage=SEGMENTS_CAN_COVER; duplicatePath=REDUNDANT_FULL_TERM_PATH
Runtime Duplication: REDUNDANT_FULL_TERM_PATH

Recommendation: DELETE_CONFIRMED
Recommended Source Action: DELETE_SOURCE_ROW
Recommended termType: (n/a)
Recommended exceptionReason: (n/a)
Follow-up: REVIEW_DOMAIN_TAGS
Notes: 普通业务组合可删；Domain 证据弱化/丢失，后续独立复核原子词标签（禁止机械复制组合域）

## 14. 安检通道

Source: lexicon_full_corrected_review.csv row 3336 (industry_pack_v1)
Term ID: term-e5ae89e6a380e980
Domains: []
Validator Decision: REJECT_COMPOSITE
Reason: NOUN_NOUN_BUSINESS_PHRASE
Segments: 安检 + 通道

Atomic Segment Check:
  - 安检: formal=true id=term-e5ae89e6a3807c61 domains=[] pinyin=an|jian
  - 通道: formal=true id=term-e9809ae981937c74 domains=[] pinyin=tong|dao

Exact Recall:
  - compound: true
  - 安检: ExactRecall=true
  - 通道: ExactRecall=true

Semantic Classification: NOUN_NOUN_BUSINESS_PHRASE
Exception Evidence: none (ordinary composite / fragment)
Domain Impact: DOMAIN_EVIDENCE_PRESERVED
Lattice Counterfactual: without-compound coverage=SEGMENTS_CAN_COVER; duplicatePath=REDUNDANT_FULL_TERM_PATH
Runtime Duplication: REDUNDANT_FULL_TERM_PATH

Recommendation: DELETE_CONFIRMED
Recommended Source Action: DELETE_SOURCE_ROW
Recommended termType: (n/a)
Recommended exceptionReason: (n/a)
Follow-up: none
Notes: 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖

## 15. 审计日志

Source: lexicon_full_corrected_review.csv row 3416 (industry_pack_v1)
Term ID: term-e5aea1e8aea1e697
Domains: [tech_ai]
Validator Decision: REJECT_COMPOSITE
Reason: NOUN_NOUN_BUSINESS_PHRASE
Segments: 审计 + 日志

Atomic Segment Check:
  - 审计: formal=true id=term-e5aea1e8aea17c73 domains=[] pinyin=shen|ji
  - 日志: formal=true id=term-e697a5e5bf977c72 domains=[tech_ai] pinyin=ri|zhi

Exact Recall:
  - compound: true
  - 审计: ExactRecall=true
  - 日志: ExactRecall=true

Semantic Classification: NOUN_NOUN_BUSINESS_PHRASE
Exception Evidence: none (ordinary composite / fragment)
Domain Impact: DOMAIN_EVIDENCE_PRESERVED
Lattice Counterfactual: without-compound coverage=SEGMENTS_CAN_COVER; duplicatePath=REDUNDANT_FULL_TERM_PATH
Runtime Duplication: REDUNDANT_FULL_TERM_PATH

Recommendation: DELETE_CONFIRMED
Recommended Source Action: DELETE_SOURCE_ROW
Recommended termType: (n/a)
Recommended exceptionReason: (n/a)
Follow-up: none
Notes: 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖

## 16. 延误订单

Source: lexicon_full_corrected_review.csv row 3969 (industry_pack_v1)
Term ID: term-e5bbb6e8afafe8ae
Domains: [food_order]
Validator Decision: REJECT_COMPOSITE
Reason: NOUN_NOUN_BUSINESS_PHRASE
Segments: 延误 + 订单

Atomic Segment Check:
  - 延误: formal=true id=term-e5bbb6e8afaf7c79 domains=[] pinyin=yan|wu
  - 订单: formal=true id=term-e8aea2e58d957c64 domains=[food_order] pinyin=ding|dan

Exact Recall:
  - compound: true
  - 延误: ExactRecall=true
  - 订单: ExactRecall=true

Semantic Classification: NOUN_NOUN_BUSINESS_PHRASE
Exception Evidence: none (ordinary composite / fragment)
Domain Impact: DOMAIN_EVIDENCE_PRESERVED + REVIEW_DOMAIN_TAGS
Lattice Counterfactual: without-compound coverage=SEGMENTS_CAN_COVER; duplicatePath=REDUNDANT_FULL_TERM_PATH
Runtime Duplication: REDUNDANT_FULL_TERM_PATH

Recommendation: DELETE_CONFIRMED
Recommended Source Action: DELETE_SOURCE_ROW
Recommended termType: (n/a)
Recommended exceptionReason: (n/a)
Follow-up: REVIEW_DOMAIN_TAGS
Notes: 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖; 组合词/订单带 food_order，需复核原子词「订单」域标签是否误标（禁止机械复制）

## 17. 当前版本

Source: lexicon_full_corrected_review.csv row 4082 (industry_pack_v1)
Term ID: term-e5bd93e5898de789
Domains: [tech_ai]
Validator Decision: REJECT_COMPOSITE
Reason: NOUN_NOUN_BUSINESS_PHRASE
Segments: 当前 + 版本

Atomic Segment Check:
  - 当前: formal=true id=term-e5bd93e5898d7c64 domains=[] pinyin=dang|qian
  - 版本: formal=true id=term-e78988e69cac7c62 domains=[tech_ai] pinyin=ban|ben

Exact Recall:
  - compound: true
  - 当前: ExactRecall=true
  - 版本: ExactRecall=true

Semantic Classification: NOUN_NOUN_BUSINESS_PHRASE
Exception Evidence: none (ordinary composite / fragment)
Domain Impact: DOMAIN_EVIDENCE_PRESERVED
Lattice Counterfactual: without-compound coverage=SEGMENTS_CAN_COVER; duplicatePath=REDUNDANT_FULL_TERM_PATH
Runtime Duplication: REDUNDANT_FULL_TERM_PATH

Recommendation: DELETE_CONFIRMED
Recommended Source Action: DELETE_SOURCE_ROW
Recommended termType: (n/a)
Recommended exceptionReason: (n/a)
Follow-up: none
Notes: 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖

## 18. 循环网络

Source: lexicon_full_corrected_review.csv row 4161 (industry_pack_v1)
Term ID: term-e5beaae78eafe7bd
Domains: []
Validator Decision: REJECT_COMPOSITE
Reason: NOUN_NOUN_BUSINESS_PHRASE
Segments: 循环 + 网络

Atomic Segment Check:
  - 循环: formal=true id=term-e5beaae78eaf7c78 domains=[] pinyin=xun|huan
  - 网络: formal=true id=term-e7bd91e7bb9c7c77 domains=[] pinyin=wang|luo

Exact Recall:
  - compound: true
  - 循环: ExactRecall=true
  - 网络: ExactRecall=true

Semantic Classification: NOUN_NOUN_BUSINESS_PHRASE
Exception Evidence: none (ordinary composite / fragment)
Domain Impact: DOMAIN_EVIDENCE_PRESERVED
Lattice Counterfactual: without-compound coverage=SEGMENTS_CAN_COVER; duplicatePath=REDUNDANT_FULL_TERM_PATH
Runtime Duplication: REDUNDANT_FULL_TERM_PATH

Recommendation: DELETE_CONFIRMED
Recommended Source Action: DELETE_SOURCE_ROW
Recommended termType: (n/a)
Recommended exceptionReason: (n/a)
Follow-up: none
Notes: 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖

## 19. 快速测试

Source: lexicon_full_corrected_review.csv row 4237 (industry_pack_v1)
Term ID: term-e5bfabe9809fe6b5
Domains: []
Validator Decision: REJECT_COMPOSITE
Reason: NOUN_NOUN_BUSINESS_PHRASE
Segments: 快速 + 测试

Atomic Segment Check:
  - 快速: formal=true id=term-e5bfabe9809f7c6b domains=[] pinyin=kuai|su
  - 测试: formal=true id=term-e6b58be8af957c63 domains=[] pinyin=ce|shi

Exact Recall:
  - compound: true
  - 快速: ExactRecall=true
  - 测试: ExactRecall=true

Semantic Classification: NOUN_NOUN_BUSINESS_PHRASE
Exception Evidence: none (ordinary composite / fragment)
Domain Impact: DOMAIN_EVIDENCE_PRESERVED
Lattice Counterfactual: without-compound coverage=SEGMENTS_CAN_COVER; duplicatePath=REDUNDANT_FULL_TERM_PATH
Runtime Duplication: REDUNDANT_FULL_TERM_PATH

Recommendation: DELETE_CONFIRMED
Recommended Source Action: DELETE_SOURCE_ROW
Recommended termType: (n/a)
Recommended exceptionReason: (n/a)
Follow-up: none
Notes: 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖

## 20. 快速通道

Source: lexicon_full_corrected_review.csv row 4239 (industry_pack_v1)
Term ID: term-e5bfabe9809fe980
Domains: []
Validator Decision: REJECT_COMPOSITE
Reason: NOUN_NOUN_BUSINESS_PHRASE
Segments: 快速 + 通道

Atomic Segment Check:
  - 快速: formal=true id=term-e5bfabe9809f7c6b domains=[] pinyin=kuai|su
  - 通道: formal=true id=term-e9809ae981937c74 domains=[] pinyin=tong|dao

Exact Recall:
  - compound: true
  - 快速: ExactRecall=true
  - 通道: ExactRecall=true

Semantic Classification: NOUN_NOUN_BUSINESS_PHRASE
Exception Evidence: none (ordinary composite / fragment)
Domain Impact: DOMAIN_EVIDENCE_PRESERVED
Lattice Counterfactual: without-compound coverage=SEGMENTS_CAN_COVER; duplicatePath=REDUNDANT_FULL_TERM_PATH
Runtime Duplication: REDUNDANT_FULL_TERM_PATH

Recommendation: DELETE_CONFIRMED
Recommended Source Action: DELETE_SOURCE_ROW
Recommended termType: (n/a)
Recommended exceptionReason: (n/a)
Follow-up: none
Notes: 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖

## 21. 接口文档

Source: supplemental_terms.csv row 40 (supplemental)
Term ID: term-e68ea5e58fa3e696
Domains: [tech_ai]
Validator Decision: REJECT_COMPOSITE
Reason: NOUN_NOUN_BUSINESS_PHRASE
Segments: 接口 + 文档

Atomic Segment Check:
  - 接口: formal=true id=exp-v1_1-alias-jiekou domains=[tech_ai] pinyin=jie|kou
  - 文档: formal=true id=exp-v1_1-alias-wendang domains=[] pinyin=wen|dang

Exact Recall:
  - compound: true
  - 接口: ExactRecall=true
  - 文档: ExactRecall=true

Semantic Classification: NOUN_NOUN_BUSINESS_PHRASE
Exception Evidence: none (ordinary composite / fragment)
Domain Impact: DOMAIN_EVIDENCE_PRESERVED
Lattice Counterfactual: without-compound coverage=SEGMENTS_CAN_COVER; duplicatePath=REDUNDANT_FULL_TERM_PATH
Runtime Duplication: REDUNDANT_FULL_TERM_PATH

Recommendation: DELETE_CONFIRMED
Recommended Source Action: DELETE_SOURCE_ROW
Recommended termType: (n/a)
Recommended exceptionReason: (n/a)
Follow-up: none
Notes: 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖

## 22. 接送时间

Source: lexicon_full_corrected_review.csv row 4904 (industry_pack_v1)
Term ID: term-e68ea5e98081e697
Domains: [tourism_pickup]
Validator Decision: REJECT_COMPOSITE
Reason: NOUN_NOUN_BUSINESS_PHRASE
Segments: 接送 + 时间

Atomic Segment Check:
  - 接送: formal=true id=term-e68ea5e980817c6a domains=[tourism_pickup,tourism_transport] pinyin=jie|song
  - 时间: formal=true id=term-e697b6e997b47c73 domains=[] pinyin=shi|jian

Exact Recall:
  - compound: true
  - 接送: ExactRecall=true
  - 时间: ExactRecall=true

Semantic Classification: NOUN_NOUN_BUSINESS_PHRASE
Exception Evidence: none (ordinary composite / fragment)
Domain Impact: DOMAIN_EVIDENCE_PRESERVED
Lattice Counterfactual: without-compound coverage=SEGMENTS_CAN_COVER; duplicatePath=REDUNDANT_FULL_TERM_PATH
Runtime Duplication: REDUNDANT_FULL_TERM_PATH

Recommendation: DELETE_CONFIRMED
Recommended Source Action: DELETE_SOURCE_ROW
Recommended termType: (n/a)
Recommended exceptionReason: (n/a)
Follow-up: none
Notes: 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖

## 23. 提示工程

Source: lexicon_full_corrected_review.csv row 4956 (industry_pack_v1)
Term ID: term-e68f90e7a4bae5b7
Domains: []
Validator Decision: REJECT_COMPOSITE
Reason: NOUN_NOUN_BUSINESS_PHRASE
Segments: 提示 + 工程

Atomic Segment Check:
  - 提示: formal=true id=term-e68f90e7a4ba7c74 domains=[] pinyin=ti|shi
  - 工程: formal=true id=term-e5b7a5e7a88b7c67 domains=[] pinyin=gong|cheng

Exact Recall:
  - compound: true
  - 提示: ExactRecall=true
  - 工程: ExactRecall=true

Semantic Classification: NOUN_NOUN_BUSINESS_PHRASE
Exception Evidence: none (ordinary composite / fragment)
Domain Impact: DOMAIN_EVIDENCE_PRESERVED
Lattice Counterfactual: without-compound coverage=SEGMENTS_CAN_COVER; duplicatePath=REDUNDANT_FULL_TERM_PATH
Runtime Duplication: REDUNDANT_FULL_TERM_PATH

Recommendation: DELETE_CONFIRMED
Recommended Source Action: DELETE_SOURCE_ROW
Recommended termType: (n/a)
Recommended exceptionReason: (n/a)
Follow-up: none
Notes: 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖

## 24. 文档版本

Source: lexicon_full_corrected_review.csv row 5193 (industry_pack_v1)
Term ID: term-e69687e6a1a3e789
Domains: [tech_ai]
Validator Decision: REJECT_COMPOSITE
Reason: NOUN_NOUN_BUSINESS_PHRASE
Segments: 文档 + 版本

Atomic Segment Check:
  - 文档: formal=true id=exp-v1_1-alias-wendang domains=[] pinyin=wen|dang
  - 版本: formal=true id=term-e78988e69cac7c62 domains=[tech_ai] pinyin=ban|ben

Exact Recall:
  - compound: true
  - 文档: ExactRecall=true
  - 版本: ExactRecall=true

Semantic Classification: NOUN_NOUN_BUSINESS_PHRASE
Exception Evidence: none (ordinary composite / fragment)
Domain Impact: DOMAIN_EVIDENCE_PRESERVED
Lattice Counterfactual: without-compound coverage=SEGMENTS_CAN_COVER; duplicatePath=REDUNDANT_FULL_TERM_PATH
Runtime Duplication: REDUNDANT_FULL_TERM_PATH

Recommendation: DELETE_CONFIRMED
Recommended Source Action: DELETE_SOURCE_ROW
Recommended termType: (n/a)
Recommended exceptionReason: (n/a)
Follow-up: none
Notes: 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖

## 25. 日志恢复

Source: lexicon_full_corrected_review.csv row 5304 (industry_pack_v1)
Term ID: term-e697a5e5bf97e681
Domains: [tech_ai]
Validator Decision: REJECT_COMPOSITE
Reason: NOUN_NOUN_BUSINESS_PHRASE
Segments: 日志 + 恢复

Atomic Segment Check:
  - 日志: formal=true id=term-e697a5e5bf977c72 domains=[tech_ai] pinyin=ri|zhi
  - 恢复: formal=true id=term-e681a2e5a48d7c68 domains=[] pinyin=hui|fu

Exact Recall:
  - compound: true
  - 日志: ExactRecall=true
  - 恢复: ExactRecall=true

Semantic Classification: NOUN_NOUN_BUSINESS_PHRASE
Exception Evidence: none (ordinary composite / fragment)
Domain Impact: DOMAIN_EVIDENCE_PRESERVED
Lattice Counterfactual: without-compound coverage=SEGMENTS_CAN_COVER; duplicatePath=REDUNDANT_FULL_TERM_PATH
Runtime Duplication: REDUNDANT_FULL_TERM_PATH

Recommendation: DELETE_CONFIRMED
Recommended Source Action: DELETE_SOURCE_ROW
Recommended termType: (n/a)
Recommended exceptionReason: (n/a)
Follow-up: none
Notes: 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖

## 26. 日志系统

Source: lexicon_full_corrected_review.csv row 5307 (industry_pack_v1)
Term ID: term-e697a5e5bf97e7b3
Domains: [tech_ai]
Validator Decision: REJECT_COMPOSITE
Reason: NOUN_NOUN_BUSINESS_PHRASE
Segments: 日志 + 系统

Atomic Segment Check:
  - 日志: formal=true id=term-e697a5e5bf977c72 domains=[tech_ai] pinyin=ri|zhi
  - 系统: formal=true id=term-e7b3bbe7bb9f7c78 domains=[] pinyin=xi|tong

Exact Recall:
  - compound: true
  - 日志: ExactRecall=true
  - 系统: ExactRecall=true

Semantic Classification: NOUN_NOUN_BUSINESS_PHRASE
Exception Evidence: none (ordinary composite / fragment)
Domain Impact: DOMAIN_EVIDENCE_PRESERVED
Lattice Counterfactual: without-compound coverage=SEGMENTS_CAN_COVER; duplicatePath=REDUNDANT_FULL_TERM_PATH
Runtime Duplication: REDUNDANT_FULL_TERM_PATH

Recommendation: DELETE_CONFIRMED
Recommended Source Action: DELETE_SOURCE_ROW
Recommended termType: (n/a)
Recommended exceptionReason: (n/a)
Follow-up: none
Notes: 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖

## 27. 日志记录

Source: lexicon_full_corrected_review.csv row 5309 (industry_pack_v1)
Term ID: term-e697a5e5bf97e8ae
Domains: [tech_ai]
Validator Decision: REJECT_COMPOSITE
Reason: NOUN_NOUN_BUSINESS_PHRASE
Segments: 日志 + 记录

Atomic Segment Check:
  - 日志: formal=true id=term-e697a5e5bf977c72 domains=[tech_ai] pinyin=ri|zhi
  - 记录: formal=true id=term-e8aeb0e5bd957c6a domains=[] pinyin=ji|lu

Exact Recall:
  - compound: true
  - 日志: ExactRecall=true
  - 记录: ExactRecall=true

Semantic Classification: NOUN_NOUN_BUSINESS_PHRASE
Exception Evidence: none (ordinary composite / fragment)
Domain Impact: DOMAIN_EVIDENCE_PRESERVED
Lattice Counterfactual: without-compound coverage=SEGMENTS_CAN_COVER; duplicatePath=REDUNDANT_FULL_TERM_PATH
Runtime Duplication: REDUNDANT_FULL_TERM_PATH

Recommendation: DELETE_CONFIRMED
Recommended Source Action: DELETE_SOURCE_ROW
Recommended termType: (n/a)
Recommended exceptionReason: (n/a)
Follow-up: none
Notes: 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖

## 28. 早餐时间

Source: lexicon_full_corrected_review.csv row 5344 (industry_pack_v1)
Term ID: term-e697a9e9a490e697
Domains: [food_order]
Validator Decision: REJECT_COMPOSITE
Reason: NOUN_NOUN_BUSINESS_PHRASE
Segments: 早餐 + 时间

Atomic Segment Check:
  - 早餐: formal=true id=term-e697a9e9a4907c7a domains=[food_order,tourism_hotel] pinyin=zao|can
  - 时间: formal=true id=term-e697b6e997b47c73 domains=[] pinyin=shi|jian

Exact Recall:
  - compound: true
  - 早餐: ExactRecall=true
  - 时间: ExactRecall=true

Semantic Classification: NOUN_NOUN_BUSINESS_PHRASE
Exception Evidence: none (ordinary composite / fragment)
Domain Impact: DOMAIN_EVIDENCE_PRESERVED
Lattice Counterfactual: without-compound coverage=SEGMENTS_CAN_COVER; duplicatePath=REDUNDANT_FULL_TERM_PATH
Runtime Duplication: REDUNDANT_FULL_TERM_PATH

Recommendation: DELETE_CONFIRMED
Recommended Source Action: DELETE_SOURCE_ROW
Recommended termType: (n/a)
Recommended exceptionReason: (n/a)
Follow-up: none
Notes: 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖

## 29. 是否

Source: lexicon_full_corrected_review.csv row 5397 (industry_pack_v2)
Term ID: term-e698afe590a67c73
Domains: []
Validator Decision: REJECT_COMPOSITE
Reason: SENTENCE_FRAGMENT
Segments: (none)

Atomic Segment Check:
  - (no segments)

Exact Recall:
  - compound: true
  - n/a

Semantic Classification: OTHER
Exception Evidence: none (ordinary composite / fragment)
Domain Impact: DOMAIN_EVIDENCE_PRESERVED
Lattice Counterfactual: without-compound coverage=NO_SEGMENTS_FRAGMENT_OK; duplicatePath=NO_RUNTIME_DUPLICATION
Runtime Duplication: NO_RUNTIME_DUPLICATION

Recommendation: DELETE_CONFIRMED
Recommended Source Action: DELETE_SOURCE_ROW
Recommended termType: (n/a)
Recommended exceptionReason: (n/a)
Follow-up: none
Notes: 句段/口语碎片，非独立正式原子词；删除不依赖 parent fragment

## 30. 景区出口

Source: supplemental_terms.csv row 72 (supplemental)
Term ID: term-e699afe58cbae587
Domains: [tourism_route]
Validator Decision: REJECT_COMPOSITE
Reason: NOUN_NOUN_BUSINESS_PHRASE
Segments: 景区 + 出口

Atomic Segment Check:
  - 景区: formal=true id=term-e699afe58cba7c6a domains=[tourism_route] pinyin=jing|qu
  - 出口: formal=true id=term-e587bae58fa37c63 domains=[] pinyin=chu|kou

Exact Recall:
  - compound: true
  - 景区: ExactRecall=true
  - 出口: ExactRecall=true

Semantic Classification: NOUN_NOUN_BUSINESS_PHRASE
Exception Evidence: none (ordinary composite / fragment)
Domain Impact: DOMAIN_EVIDENCE_PRESERVED
Lattice Counterfactual: without-compound coverage=SEGMENTS_CAN_COVER; duplicatePath=REDUNDANT_FULL_TERM_PATH
Runtime Duplication: REDUNDANT_FULL_TERM_PATH

Recommendation: DELETE_CONFIRMED
Recommended Source Action: DELETE_SOURCE_ROW
Recommended termType: (n/a)
Recommended exceptionReason: (n/a)
Follow-up: none
Notes: 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖

## 31. 机场信息

Source: lexicon_full_corrected_review.csv row 5627 (industry_pack_v1)
Term ID: term-e69cbae59cbae4bf
Domains: [tourism_transport]
Validator Decision: REJECT_COMPOSITE
Reason: NOUN_NOUN_BUSINESS_PHRASE
Segments: 机场 + 信息

Atomic Segment Check:
  - 机场: formal=true id=term-e69cbae59cba7c6a domains=[tourism_transport,transport] pinyin=ji|chang
  - 信息: formal=true id=term-e4bfa1e681af7c78 domains=[] pinyin=xin|xi

Exact Recall:
  - compound: true
  - 机场: ExactRecall=true
  - 信息: ExactRecall=true

Semantic Classification: NOUN_NOUN_BUSINESS_PHRASE
Exception Evidence: none (ordinary composite / fragment)
Domain Impact: DOMAIN_EVIDENCE_PRESERVED
Lattice Counterfactual: without-compound coverage=SEGMENTS_CAN_COVER; duplicatePath=REDUNDANT_FULL_TERM_PATH
Runtime Duplication: REDUNDANT_FULL_TERM_PATH

Recommendation: DELETE_CONFIRMED
Recommended Source Action: DELETE_SOURCE_ROW
Recommended termType: (n/a)
Recommended exceptionReason: (n/a)
Follow-up: none
Notes: 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖

## 32. 机场时间

Source: lexicon_full_corrected_review.csv row 5632 (industry_pack_v1)
Term ID: term-e69cbae59cbae697
Domains: [tourism_transport]
Validator Decision: REJECT_COMPOSITE
Reason: NOUN_NOUN_BUSINESS_PHRASE
Segments: 机场 + 时间

Atomic Segment Check:
  - 机场: formal=true id=term-e69cbae59cba7c6a domains=[tourism_transport,transport] pinyin=ji|chang
  - 时间: formal=true id=term-e697b6e997b47c73 domains=[] pinyin=shi|jian

Exact Recall:
  - compound: true
  - 机场: ExactRecall=true
  - 时间: ExactRecall=true

Semantic Classification: NOUN_NOUN_BUSINESS_PHRASE
Exception Evidence: none (ordinary composite / fragment)
Domain Impact: DOMAIN_EVIDENCE_PRESERVED
Lattice Counterfactual: without-compound coverage=SEGMENTS_CAN_COVER; duplicatePath=REDUNDANT_FULL_TERM_PATH
Runtime Duplication: REDUNDANT_FULL_TERM_PATH

Recommendation: DELETE_CONFIRMED
Recommended Source Action: DELETE_SOURCE_ROW
Recommended termType: (n/a)
Recommended exceptionReason: (n/a)
Follow-up: none
Notes: 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖

## 33. 查看日志

Source: lexicon_full_corrected_review.csv row 5742 (industry_pack_v1)
Term ID: term-e69fa5e79c8be697
Domains: [tech_ai]
Validator Decision: REJECT_COMPOSITE
Reason: NOUN_NOUN_BUSINESS_PHRASE
Segments: 查看 + 日志

Atomic Segment Check:
  - 查看: formal=true id=term-e69fa5e79c8b7c63 domains=[] pinyin=cha|kan
  - 日志: formal=true id=term-e697a5e5bf977c72 domains=[tech_ai] pinyin=ri|zhi

Exact Recall:
  - compound: true
  - 查看: ExactRecall=true
  - 日志: ExactRecall=true

Semantic Classification: NOUN_NOUN_BUSINESS_PHRASE
Exception Evidence: none (ordinary composite / fragment)
Domain Impact: DOMAIN_EVIDENCE_PRESERVED
Lattice Counterfactual: without-compound coverage=SEGMENTS_CAN_COVER; duplicatePath=REDUNDANT_FULL_TERM_PATH
Runtime Duplication: REDUNDANT_FULL_TERM_PATH

Recommendation: DELETE_CONFIRMED
Recommended Source Action: DELETE_SOURCE_ROW
Recommended termType: (n/a)
Recommended exceptionReason: (n/a)
Follow-up: none
Notes: 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖

## 34. 检查内容

Source: lexicon_full_corrected_review.csv row 5813 (industry_pack_v1)
Term ID: term-e6a380e69fa5e586
Domains: []
Validator Decision: REJECT_COMPOSITE
Reason: NOUN_NOUN_BUSINESS_PHRASE
Segments: 检查 + 内容

Atomic Segment Check:
  - 检查: formal=true id=term-e6a380e69fa57c6a domains=[] pinyin=jian|cha
  - 内容: formal=true id=term-e58685e5aeb97c6e domains=[] pinyin=nei|rong

Exact Recall:
  - compound: true
  - 检查: ExactRecall=true
  - 内容: ExactRecall=true

Semantic Classification: NOUN_NOUN_BUSINESS_PHRASE
Exception Evidence: none (ordinary composite / fragment)
Domain Impact: DOMAIN_EVIDENCE_PRESERVED
Lattice Counterfactual: without-compound coverage=SEGMENTS_CAN_COVER; duplicatePath=REDUNDANT_FULL_TERM_PATH
Runtime Duplication: REDUNDANT_FULL_TERM_PATH

Recommendation: DELETE_CONFIRMED
Recommended Source Action: DELETE_SOURCE_ROW
Recommended termType: (n/a)
Recommended exceptionReason: (n/a)
Follow-up: none
Notes: 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖

## 35. 检查日志

Source: lexicon_full_corrected_review.csv row 5821 (industry_pack_v1)
Term ID: term-e6a380e69fa5e697
Domains: [tech_ai]
Validator Decision: REJECT_COMPOSITE
Reason: NOUN_NOUN_BUSINESS_PHRASE
Segments: 检查 + 日志

Atomic Segment Check:
  - 检查: formal=true id=term-e6a380e69fa57c6a domains=[] pinyin=jian|cha
  - 日志: formal=true id=term-e697a5e5bf977c72 domains=[tech_ai] pinyin=ri|zhi

Exact Recall:
  - compound: true
  - 检查: ExactRecall=true
  - 日志: ExactRecall=true

Semantic Classification: NOUN_NOUN_BUSINESS_PHRASE
Exception Evidence: none (ordinary composite / fragment)
Domain Impact: DOMAIN_EVIDENCE_PRESERVED
Lattice Counterfactual: without-compound coverage=SEGMENTS_CAN_COVER; duplicatePath=REDUNDANT_FULL_TERM_PATH
Runtime Duplication: REDUNDANT_FULL_TERM_PATH

Recommendation: DELETE_CONFIRMED
Recommended Source Action: DELETE_SOURCE_ROW
Recommended termType: (n/a)
Recommended exceptionReason: (n/a)
Follow-up: none
Notes: 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖

## 36. 检查是否有

Source: lexicon_full_corrected_review.csv row 5822 (industry_pack_v1)
Term ID: term-e6a380e69fa5e698
Domains: []
Validator Decision: REJECT_COMPOSITE
Reason: SENTENCE_FRAGMENT
Segments: (none)

Atomic Segment Check:
  - (no segments)

Exact Recall:
  - compound: true
  - n/a

Semantic Classification: OTHER
Exception Evidence: none (ordinary composite / fragment)
Domain Impact: DOMAIN_EVIDENCE_PRESERVED
Lattice Counterfactual: without-compound coverage=NO_SEGMENTS_FRAGMENT_OK; duplicatePath=NO_RUNTIME_DUPLICATION
Runtime Duplication: NO_RUNTIME_DUPLICATION

Recommendation: DELETE_CONFIRMED
Recommended Source Action: DELETE_SOURCE_ROW
Recommended termType: (n/a)
Recommended exceptionReason: (n/a)
Follow-up: none
Notes: 句段/口语碎片，非独立正式原子词；删除不依赖 parent fragment

## 37. 正则策略

Source: lexicon_full_corrected_review.csv row 5928 (industry_pack_v1)
Term ID: term-e6ada3e58899e7ad
Domains: []
Validator Decision: REJECT_COMPOSITE
Reason: NOUN_NOUN_BUSINESS_PHRASE
Segments: 正则 + 策略

Atomic Segment Check:
  - 正则: formal=true id=term-e6ada3e588997c7a domains=[] pinyin=zheng|ze
  - 策略: formal=true id=term-e7ad96e795a57c63 domains=[] pinyin=ce|le

Exact Recall:
  - compound: false
  - 正则: ExactRecall=true
  - 策略: ExactRecall=false

Semantic Classification: NOUN_NOUN_BUSINESS_PHRASE
Exception Evidence: none (ordinary composite / fragment)
Domain Impact: DOMAIN_EVIDENCE_PRESERVED
Lattice Counterfactual: without-compound coverage=SEGMENTS_INCOMPLETE; duplicatePath=SEMANTICALLY_DISTINCT_FULL_TERM_PATH
Runtime Duplication: SEMANTICALLY_DISTINCT_FULL_TERM_PATH

Recommendation: DELETE_CONFIRMED
Recommended Source Action: DELETE_SOURCE_ROW
Recommended termType: (n/a)
Recommended exceptionReason: (n/a)
Follow-up: none
Notes: 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖

## 38. 正常状态

Source: lexicon_full_corrected_review.csv row 5944 (industry_pack_v1)
Term ID: term-e6ada3e5b8b8e78a
Domains: []
Validator Decision: REJECT_COMPOSITE
Reason: NOUN_NOUN_BUSINESS_PHRASE
Segments: 正常 + 状态

Atomic Segment Check:
  - 正常: formal=true id=term-e6ada3e5b8b87c7a domains=[] pinyin=zheng|chang
  - 状态: formal=true id=term-e78ab6e680817c7a domains=[] pinyin=zhuang|tai

Exact Recall:
  - compound: true
  - 正常: ExactRecall=true
  - 状态: ExactRecall=true

Semantic Classification: NOUN_NOUN_BUSINESS_PHRASE
Exception Evidence: none (ordinary composite / fragment)
Domain Impact: DOMAIN_EVIDENCE_PRESERVED
Lattice Counterfactual: without-compound coverage=SEGMENTS_CAN_COVER; duplicatePath=REDUNDANT_FULL_TERM_PATH
Runtime Duplication: REDUNDANT_FULL_TERM_PATH

Recommendation: DELETE_CONFIRMED
Recommended Source Action: DELETE_SOURCE_ROW
Recommended termType: (n/a)
Recommended exceptionReason: (n/a)
Follow-up: none
Notes: 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖

## 39. 注册中心

Source: lexicon_full_corrected_review.csv row 6226 (industry_pack_v1)
Term ID: term-e6b3a8e5868ce4b8
Domains: []
Validator Decision: REJECT_COMPOSITE
Reason: ACTION_OBJECT_PHRASE
Segments: 注册 + 中心

Atomic Segment Check:
  - 注册: formal=true id=term-e6b3a8e5868c7c7a domains=[] pinyin=zhu|ce
  - 中心: formal=true id=term-e4b8ade5bf837c7a domains=[] pinyin=zhong|xin

Exact Recall:
  - compound: true
  - 注册: ExactRecall=true
  - 中心: ExactRecall=true

Semantic Classification: FIXED_TECHNICAL_TERM
Exception Evidence: recommended fixed_technical_term
Domain Impact: DOMAIN_EVIDENCE_PRESERVED
Lattice Counterfactual: without-compound coverage=SEGMENTS_CAN_COVER; duplicatePath=REDUNDANT_FULL_TERM_PATH
Runtime Duplication: REDUNDANT_FULL_TERM_PATH

Recommendation: KEEP_AS_EXCEPTION
Recommended Source Action: ADD_EXCEPTION_METADATA
Recommended termType: fixed_technical_term
Recommended exceptionReason: 「注册中心」在微服务架构中是固定组件名（Service Registry），完整形式具有独立技术实体身份，拆成「注册+中心」不能等价替代。
Follow-up: none
Notes: 微服务固定组件名

## 40. 流量镜像

Source: lexicon_full_corrected_review.csv row 6292 (industry_pack_v1)
Term ID: term-e6b581e9878fe995
Domains: []
Validator Decision: REJECT_COMPOSITE
Reason: NOUN_NOUN_BUSINESS_PHRASE
Segments: 流量 + 镜像

Atomic Segment Check:
  - 流量: formal=true id=term-e6b581e9878f7c6c domains=[] pinyin=liu|liang
  - 镜像: formal=true id=term-e9959ce5838f7c6a domains=[] pinyin=jing|xiang

Exact Recall:
  - compound: true
  - 流量: ExactRecall=true
  - 镜像: ExactRecall=true

Semantic Classification: NOUN_NOUN_BUSINESS_PHRASE
Exception Evidence: none (ordinary composite / fragment)
Domain Impact: DOMAIN_EVIDENCE_PRESERVED
Lattice Counterfactual: without-compound coverage=SEGMENTS_CAN_COVER; duplicatePath=REDUNDANT_FULL_TERM_PATH
Runtime Duplication: REDUNDANT_FULL_TERM_PATH

Recommendation: DELETE_CONFIRMED
Recommended Source Action: DELETE_SOURCE_ROW
Recommended termType: (n/a)
Recommended exceptionReason: (n/a)
Follow-up: none
Notes: 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖

## 41. 测试数据

Source: supplemental_terms.csv row 49 (supplemental)
Term ID: term-e6b58be8af95e695
Domains: [tech_ai]
Validator Decision: REJECT_COMPOSITE
Reason: ACTION_OBJECT_PHRASE
Segments: 测试 + 数据

Atomic Segment Check:
  - 测试: formal=true id=term-e6b58be8af957c63 domains=[] pinyin=ce|shi
  - 数据: formal=true id=term-e695b0e68dae7c73 domains=[] pinyin=shu|ju

Exact Recall:
  - compound: true
  - 测试: ExactRecall=true
  - 数据: ExactRecall=true

Semantic Classification: ACTION_OBJECT_PHRASE
Exception Evidence: none (ordinary composite / fragment)
Domain Impact: DOMAIN_EVIDENCE_LOST + REVIEW_DOMAIN_TAGS
Lattice Counterfactual: without-compound coverage=SEGMENTS_CAN_COVER; duplicatePath=REDUNDANT_FULL_TERM_PATH
Runtime Duplication: REDUNDANT_FULL_TERM_PATH

Recommendation: DELETE_CONFIRMED
Recommended Source Action: DELETE_SOURCE_ROW
Recommended termType: (n/a)
Recommended exceptionReason: (n/a)
Follow-up: REVIEW_DOMAIN_TAGS
Notes: 普通业务组合可删；Domain 证据弱化/丢失，后续独立复核原子词标签（禁止机械复制组合域）

## 42. 熔断策略

Source: lexicon_full_corrected_review.csv row 6637 (industry_pack_v1)
Term ID: term-e78694e696ade7ad
Domains: []
Validator Decision: REJECT_COMPOSITE
Reason: NOUN_NOUN_BUSINESS_PHRASE
Segments: 熔断 + 策略

Atomic Segment Check:
  - 熔断: formal=true id=term-e78694e696ad7c72 domains=[] pinyin=rong|duan
  - 策略: formal=true id=term-e7ad96e795a57c63 domains=[] pinyin=ce|le

Exact Recall:
  - compound: false
  - 熔断: ExactRecall=true
  - 策略: ExactRecall=false

Semantic Classification: NOUN_NOUN_BUSINESS_PHRASE
Exception Evidence: none (ordinary composite / fragment)
Domain Impact: DOMAIN_EVIDENCE_PRESERVED
Lattice Counterfactual: without-compound coverage=SEGMENTS_INCOMPLETE; duplicatePath=SEMANTICALLY_DISTINCT_FULL_TERM_PATH
Runtime Duplication: SEMANTICALLY_DISTINCT_FULL_TERM_PATH

Recommendation: DELETE_CONFIRMED
Recommended Source Action: DELETE_SOURCE_ROW
Recommended termType: (n/a)
Recommended exceptionReason: (n/a)
Follow-up: none
Notes: 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖

## 43. 特征工程

Source: lexicon_full_corrected_review.csv row 6713 (industry_pack_v1)
Term ID: term-e789b9e5be81e5b7
Domains: [tech_ai]
Validator Decision: REJECT_COMPOSITE
Reason: NOUN_NOUN_BUSINESS_PHRASE
Segments: 特征 + 工程

Atomic Segment Check:
  - 特征: formal=true id=term-e789b9e5be817c74 domains=[] pinyin=te|zheng
  - 工程: formal=true id=term-e5b7a5e7a88b7c67 domains=[] pinyin=gong|cheng

Exact Recall:
  - compound: true
  - 特征: ExactRecall=true
  - 工程: ExactRecall=true

Semantic Classification: NOUN_NOUN_BUSINESS_PHRASE
Exception Evidence: none (ordinary composite / fragment)
Domain Impact: DOMAIN_EVIDENCE_LOST + REVIEW_DOMAIN_TAGS
Lattice Counterfactual: without-compound coverage=SEGMENTS_CAN_COVER; duplicatePath=REDUNDANT_FULL_TERM_PATH
Runtime Duplication: REDUNDANT_FULL_TERM_PATH

Recommendation: DELETE_CONFIRMED
Recommended Source Action: DELETE_SOURCE_ROW
Recommended termType: (n/a)
Recommended exceptionReason: (n/a)
Follow-up: REVIEW_DOMAIN_TAGS
Notes: 普通业务组合可删；Domain 证据弱化/丢失，后续独立复核原子词标签（禁止机械复制组合域）

## 44. 环岛时间

Source: lexicon_full_corrected_review.csv row 6772 (industry_pack_v2)
Term ID: term-e78eafe5b29be697
Domains: []
Validator Decision: REJECT_COMPOSITE
Reason: NOUN_NOUN_BUSINESS_PHRASE
Segments: 环岛 + 时间

Atomic Segment Check:
  - 环岛: formal=true id=term-e78eafe5b29b7c68 domains=[] pinyin=huan|dao
  - 时间: formal=true id=term-e697b6e997b47c73 domains=[] pinyin=shi|jian

Exact Recall:
  - compound: true
  - 环岛: ExactRecall=true
  - 时间: ExactRecall=true

Semantic Classification: NOUN_NOUN_BUSINESS_PHRASE
Exception Evidence: none (ordinary composite / fragment)
Domain Impact: DOMAIN_EVIDENCE_PRESERVED
Lattice Counterfactual: without-compound coverage=SEGMENTS_CAN_COVER; duplicatePath=REDUNDANT_FULL_TERM_PATH
Runtime Duplication: REDUNDANT_FULL_TERM_PATH

Recommendation: DELETE_CONFIRMED
Recommended Source Action: DELETE_SOURCE_ROW
Recommended termType: (n/a)
Recommended exceptionReason: (n/a)
Follow-up: none
Notes: 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖

## 45. 登机时间

Source: lexicon_full_corrected_review.csv row 6997 (industry_pack_v1)
Term ID: term-e799bbe69cbae697
Domains: []
Validator Decision: REJECT_COMPOSITE
Reason: ACTION_OBJECT_PHRASE
Segments: 登机 + 时间

Atomic Segment Check:
  - 登机: formal=true id=term-e799bbe69cba7c64 domains=[] pinyin=deng|ji
  - 时间: formal=true id=term-e697b6e997b47c73 domains=[] pinyin=shi|jian

Exact Recall:
  - compound: true
  - 登机: ExactRecall=true
  - 时间: ExactRecall=true

Semantic Classification: ACTION_OBJECT_PHRASE
Exception Evidence: none (ordinary composite / fragment)
Domain Impact: DOMAIN_EVIDENCE_PRESERVED
Lattice Counterfactual: without-compound coverage=SEGMENTS_CAN_COVER; duplicatePath=REDUNDANT_FULL_TERM_PATH
Runtime Duplication: REDUNDANT_FULL_TERM_PATH

Recommendation: DELETE_CONFIRMED
Recommended Source Action: DELETE_SOURCE_ROW
Recommended termType: (n/a)
Recommended exceptionReason: (n/a)
Follow-up: none
Notes: 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖

## 46. 神经网络

Source: lexicon_full_corrected_review.csv row 7300 (industry_pack_v1)
Term ID: term-e7a59ee7bb8fe7bd
Domains: [tech_ai]
Validator Decision: REJECT_COMPOSITE
Reason: NOUN_NOUN_BUSINESS_PHRASE
Segments: 神经 + 网络

Atomic Segment Check:
  - 神经: formal=true id=term-e7a59ee7bb8f7c73 domains=[] pinyin=shen|jing
  - 网络: formal=true id=term-e7bd91e7bb9c7c77 domains=[] pinyin=wang|luo

Exact Recall:
  - compound: true
  - 神经: ExactRecall=true
  - 网络: ExactRecall=true

Semantic Classification: NOUN_NOUN_BUSINESS_PHRASE
Exception Evidence: none (ordinary composite / fragment)
Domain Impact: DOMAIN_EVIDENCE_LOST + REVIEW_DOMAIN_TAGS
Lattice Counterfactual: without-compound coverage=SEGMENTS_CAN_COVER; duplicatePath=REDUNDANT_FULL_TERM_PATH
Runtime Duplication: REDUNDANT_FULL_TERM_PATH

Recommendation: DELETE_CONFIRMED
Recommended Source Action: DELETE_SOURCE_ROW
Recommended termType: (n/a)
Recommended exceptionReason: (n/a)
Follow-up: REVIEW_DOMAIN_TAGS
Notes: 普通业务组合可删；Domain 证据弱化/丢失，后续独立复核原子词标签（禁止机械复制组合域）

## 47. 租车提醒

Source: lexicon_full_corrected_review.csv row 7353 (industry_pack_v2)
Term ID: term-e7a79fe8bda6e68f
Domains: [tourism_route]
Validator Decision: REJECT_COMPOSITE
Reason: NOUN_NOUN_BUSINESS_PHRASE
Segments: 租车 + 提醒

Atomic Segment Check:
  - 租车: formal=true id=term-e7a79fe8bda67c7a domains=[tourism_route] pinyin=zu|che
  - 提醒: formal=true id=term-e68f90e986927c74 domains=[] pinyin=ti|xing

Exact Recall:
  - compound: true
  - 租车: ExactRecall=true
  - 提醒: ExactRecall=true

Semantic Classification: NOUN_NOUN_BUSINESS_PHRASE
Exception Evidence: none (ordinary composite / fragment)
Domain Impact: DOMAIN_EVIDENCE_PRESERVED
Lattice Counterfactual: without-compound coverage=SEGMENTS_CAN_COVER; duplicatePath=REDUNDANT_FULL_TERM_PATH
Runtime Duplication: REDUNDANT_FULL_TERM_PATH

Recommendation: DELETE_CONFIRMED
Recommended Source Action: DELETE_SOURCE_ROW
Recommended termType: (n/a)
Recommended exceptionReason: (n/a)
Follow-up: none
Notes: 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖

## 48. 缆车提醒

Source: lexicon_full_corrected_review.csv row 7743 (industry_pack_v1)
Term ID: term-e7bc86e8bda6e68f
Domains: [tourism_route]
Validator Decision: REJECT_COMPOSITE
Reason: NOUN_NOUN_BUSINESS_PHRASE
Segments: 缆车 + 提醒

Atomic Segment Check:
  - 缆车: formal=true id=term-e7bc86e8bda67c6c domains=[tourism_route] pinyin=lan|che
  - 提醒: formal=true id=term-e68f90e986927c74 domains=[] pinyin=ti|xing

Exact Recall:
  - compound: true
  - 缆车: ExactRecall=true
  - 提醒: ExactRecall=true

Semantic Classification: NOUN_NOUN_BUSINESS_PHRASE
Exception Evidence: none (ordinary composite / fragment)
Domain Impact: DOMAIN_EVIDENCE_PRESERVED
Lattice Counterfactual: without-compound coverage=SEGMENTS_CAN_COVER; duplicatePath=REDUNDANT_FULL_TERM_PATH
Runtime Duplication: REDUNDANT_FULL_TERM_PATH

Recommendation: DELETE_CONFIRMED
Recommended Source Action: DELETE_SOURCE_ROW
Recommended termType: (n/a)
Recommended exceptionReason: (n/a)
Follow-up: none
Notes: 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖

## 49. 翻译日志

Source: lexicon_full_corrected_review.csv row 7819 (industry_pack_v1)
Term ID: term-e7bfbbe8af91e697
Domains: [tech_ai]
Validator Decision: REJECT_COMPOSITE
Reason: NOUN_NOUN_BUSINESS_PHRASE
Segments: 翻译 + 日志

Atomic Segment Check:
  - 翻译: formal=true id=term-e7bfbbe8af917c66 domains=[] pinyin=fan|yi
  - 日志: formal=true id=term-e697a5e5bf977c72 domains=[tech_ai] pinyin=ri|zhi

Exact Recall:
  - compound: true
  - 翻译: ExactRecall=true
  - 日志: ExactRecall=true

Semantic Classification: NOUN_NOUN_BUSINESS_PHRASE
Exception Evidence: none (ordinary composite / fragment)
Domain Impact: DOMAIN_EVIDENCE_PRESERVED
Lattice Counterfactual: without-compound coverage=SEGMENTS_CAN_COVER; duplicatePath=REDUNDANT_FULL_TERM_PATH
Runtime Duplication: REDUNDANT_FULL_TERM_PATH

Recommendation: DELETE_CONFIRMED
Recommended Source Action: DELETE_SOURCE_ROW
Recommended termType: (n/a)
Recommended exceptionReason: (n/a)
Follow-up: none
Notes: 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖

## 50. 联系电话

Source: lexicon_full_corrected_review.csv row 7887 (industry_pack_v1)
Term ID: term-e88194e7b3bbe794
Domains: []
Validator Decision: REJECT_COMPOSITE
Reason: NOUN_NOUN_BUSINESS_PHRASE
Segments: 联系 + 电话

Atomic Segment Check:
  - 联系: formal=true id=term-e88194e7b3bb7c6c domains=[] pinyin=lian|xi
  - 电话: formal=true id=term-e794b5e8af9d7c64 domains=[] pinyin=dian|hua

Exact Recall:
  - compound: true
  - 联系: ExactRecall=true
  - 电话: ExactRecall=true

Semantic Classification: NOUN_NOUN_BUSINESS_PHRASE
Exception Evidence: none (ordinary composite / fragment)
Domain Impact: DOMAIN_EVIDENCE_PRESERVED
Lattice Counterfactual: without-compound coverage=SEGMENTS_CAN_COVER; duplicatePath=REDUNDANT_FULL_TERM_PATH
Runtime Duplication: REDUNDANT_FULL_TERM_PATH

Recommendation: DELETE_CONFIRMED
Recommended Source Action: DELETE_SOURCE_ROW
Recommended termType: (n/a)
Recommended exceptionReason: (n/a)
Follow-up: none
Notes: 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖

## 51. 航班提醒

Source: lexicon_full_corrected_review.csv row 8070 (industry_pack_v1)
Term ID: term-e888aae78fade68f
Domains: []
Validator Decision: REJECT_COMPOSITE
Reason: NOUN_NOUN_BUSINESS_PHRASE
Segments: 航班 + 提醒

Atomic Segment Check:
  - 航班: formal=true id=term-e888aae78fad7c68 domains=[] pinyin=hang|ban
  - 提醒: formal=true id=term-e68f90e986927c74 domains=[] pinyin=ti|xing

Exact Recall:
  - compound: true
  - 航班: ExactRecall=true
  - 提醒: ExactRecall=true

Semantic Classification: NOUN_NOUN_BUSINESS_PHRASE
Exception Evidence: none (ordinary composite / fragment)
Domain Impact: DOMAIN_EVIDENCE_PRESERVED
Lattice Counterfactual: without-compound coverage=SEGMENTS_CAN_COVER; duplicatePath=REDUNDANT_FULL_TERM_PATH
Runtime Duplication: REDUNDANT_FULL_TERM_PATH

Recommendation: DELETE_CONFIRMED
Recommended Source Action: DELETE_SOURCE_ROW
Recommended termType: (n/a)
Recommended exceptionReason: (n/a)
Follow-up: none
Notes: 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖

## 52. 航班时间

Source: lexicon_full_corrected_review.csv row 8071 (industry_pack_v1)
Term ID: term-e888aae78fade697
Domains: []
Validator Decision: REJECT_COMPOSITE
Reason: NOUN_NOUN_BUSINESS_PHRASE
Segments: 航班 + 时间

Atomic Segment Check:
  - 航班: formal=true id=term-e888aae78fad7c68 domains=[] pinyin=hang|ban
  - 时间: formal=true id=term-e697b6e997b47c73 domains=[] pinyin=shi|jian

Exact Recall:
  - compound: true
  - 航班: ExactRecall=true
  - 时间: ExactRecall=true

Semantic Classification: NOUN_NOUN_BUSINESS_PHRASE
Exception Evidence: none (ordinary composite / fragment)
Domain Impact: DOMAIN_EVIDENCE_PRESERVED
Lattice Counterfactual: without-compound coverage=SEGMENTS_CAN_COVER; duplicatePath=REDUNDANT_FULL_TERM_PATH
Runtime Duplication: REDUNDANT_FULL_TERM_PATH

Recommendation: DELETE_CONFIRMED
Recommended Source Action: DELETE_SOURCE_ROW
Recommended termType: (n/a)
Recommended exceptionReason: (n/a)
Follow-up: none
Notes: 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖

## 53. 航班订单

Source: lexicon_full_corrected_review.csv row 8072 (industry_pack_v1)
Term ID: term-e888aae78fade8ae
Domains: [food_order]
Validator Decision: REJECT_COMPOSITE
Reason: NOUN_NOUN_BUSINESS_PHRASE
Segments: 航班 + 订单

Atomic Segment Check:
  - 航班: formal=true id=term-e888aae78fad7c68 domains=[] pinyin=hang|ban
  - 订单: formal=true id=term-e8aea2e58d957c64 domains=[food_order] pinyin=ding|dan

Exact Recall:
  - compound: true
  - 航班: ExactRecall=true
  - 订单: ExactRecall=true

Semantic Classification: NOUN_NOUN_BUSINESS_PHRASE
Exception Evidence: none (ordinary composite / fragment)
Domain Impact: DOMAIN_EVIDENCE_PRESERVED + REVIEW_DOMAIN_TAGS
Lattice Counterfactual: without-compound coverage=SEGMENTS_CAN_COVER; duplicatePath=REDUNDANT_FULL_TERM_PATH
Runtime Duplication: REDUNDANT_FULL_TERM_PATH

Recommendation: DELETE_CONFIRMED
Recommended Source Action: DELETE_SOURCE_ROW
Recommended termType: (n/a)
Recommended exceptionReason: (n/a)
Follow-up: REVIEW_DOMAIN_TAGS
Notes: 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖; 组合词/订单带 food_order，需复核原子词「订单」域标签是否误标（禁止机械复制）

## 54. 节点指标

Source: lexicon_full_corrected_review.csv row 8112 (industry_pack_v1)
Term ID: term-e88a82e782b9e68c
Domains: []
Validator Decision: REJECT_COMPOSITE
Reason: NOUN_NOUN_BUSINESS_PHRASE
Segments: 节点 + 指标

Atomic Segment Check:
  - 节点: formal=true id=term-e88a82e782b97c6a domains=[] pinyin=jie|dian
  - 指标: formal=true id=term-e68c87e6a0877c7a domains=[] pinyin=zhi|biao

Exact Recall:
  - compound: true
  - 节点: ExactRecall=true
  - 指标: ExactRecall=true

Semantic Classification: NOUN_NOUN_BUSINESS_PHRASE
Exception Evidence: none (ordinary composite / fragment)
Domain Impact: DOMAIN_EVIDENCE_PRESERVED
Lattice Counterfactual: without-compound coverage=SEGMENTS_CAN_COVER; duplicatePath=REDUNDANT_FULL_TERM_PATH
Runtime Duplication: REDUNDANT_FULL_TERM_PATH

Recommendation: DELETE_CONFIRMED
Recommended Source Action: DELETE_SOURCE_ROW
Recommended termType: (n/a)
Recommended exceptionReason: (n/a)
Follow-up: none
Notes: 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖

## 55. 节点注册

Source: lexicon_full_corrected_review.csv row 8115 (industry_pack_v1)
Term ID: term-e88a82e782b9e6b3
Domains: []
Validator Decision: REJECT_COMPOSITE
Reason: NOUN_NOUN_BUSINESS_PHRASE
Segments: 节点 + 注册

Atomic Segment Check:
  - 节点: formal=true id=term-e88a82e782b97c6a domains=[] pinyin=jie|dian
  - 注册: formal=true id=term-e6b3a8e5868c7c7a domains=[] pinyin=zhu|ce

Exact Recall:
  - compound: true
  - 节点: ExactRecall=true
  - 注册: ExactRecall=true

Semantic Classification: NOUN_NOUN_BUSINESS_PHRASE
Exception Evidence: none (ordinary composite / fragment)
Domain Impact: DOMAIN_EVIDENCE_PRESERVED
Lattice Counterfactual: without-compound coverage=SEGMENTS_CAN_COVER; duplicatePath=REDUNDANT_FULL_TERM_PATH
Runtime Duplication: REDUNDANT_FULL_TERM_PATH

Recommendation: DELETE_CONFIRMED
Recommended Source Action: DELETE_SOURCE_ROW
Recommended termType: (n/a)
Recommended exceptionReason: (n/a)
Follow-up: none
Notes: 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖

## 56. 节点配置

Source: lexicon_full_corrected_review.csv row 8119 (industry_pack_v1)
Term ID: term-e88a82e782b9e985
Domains: []
Validator Decision: REJECT_COMPOSITE
Reason: NOUN_NOUN_BUSINESS_PHRASE
Segments: 节点 + 配置

Atomic Segment Check:
  - 节点: formal=true id=term-e88a82e782b97c6a domains=[] pinyin=jie|dian
  - 配置: formal=true id=term-e9858de7bdae7c70 domains=[] pinyin=pei|zhi

Exact Recall:
  - compound: true
  - 节点: ExactRecall=true
  - 配置: ExactRecall=true

Semantic Classification: NOUN_NOUN_BUSINESS_PHRASE
Exception Evidence: none (ordinary composite / fragment)
Domain Impact: DOMAIN_EVIDENCE_PRESERVED
Lattice Counterfactual: without-compound coverage=SEGMENTS_CAN_COVER; duplicatePath=REDUNDANT_FULL_TERM_PATH
Runtime Duplication: REDUNDANT_FULL_TERM_PATH

Recommendation: DELETE_CONFIRMED
Recommended Source Action: DELETE_SOURCE_ROW
Recommended termType: (n/a)
Recommended exceptionReason: (n/a)
Follow-up: none
Notes: 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖

## 57. 行李订单

Source: lexicon_full_corrected_review.csv row 8348 (industry_pack_v1)
Term ID: term-e8a18ce69d8ee8ae
Domains: [food_order]
Validator Decision: REJECT_COMPOSITE
Reason: NOUN_NOUN_BUSINESS_PHRASE
Segments: 行李 + 订单

Atomic Segment Check:
  - 行李: formal=true id=term-e8a18ce69d8e7c78 domains=[] pinyin=xing|li
  - 订单: formal=true id=term-e8aea2e58d957c64 domains=[food_order] pinyin=ding|dan

Exact Recall:
  - compound: false
  - 行李: ExactRecall=true
  - 订单: ExactRecall=true

Semantic Classification: NOUN_NOUN_BUSINESS_PHRASE
Exception Evidence: none (ordinary composite / fragment)
Domain Impact: DOMAIN_EVIDENCE_PRESERVED + REVIEW_DOMAIN_TAGS
Lattice Counterfactual: without-compound coverage=SEGMENTS_CAN_COVER; duplicatePath=REDUNDANT_FULL_TERM_PATH
Runtime Duplication: REDUNDANT_FULL_TERM_PATH

Recommendation: DELETE_CONFIRMED
Recommended Source Action: DELETE_SOURCE_ROW
Recommended termType: (n/a)
Recommended exceptionReason: (n/a)
Follow-up: REVIEW_DOMAIN_TAGS
Notes: 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖; 组合词/订单带 food_order，需复核原子词「订单」域标签是否误标（禁止机械复制）

## 58. 行程订单

Source: lexicon_full_corrected_review.csv row 8359 (industry_pack_v1)
Term ID: term-e8a18ce7a88be8ae
Domains: [food_order, tourism_route]
Validator Decision: REJECT_COMPOSITE
Reason: NOUN_NOUN_BUSINESS_PHRASE
Segments: 行程 + 订单

Atomic Segment Check:
  - 行程: formal=true id=term-e8a18ce7a88b7c78 domains=[tourism_route] pinyin=xing|cheng
  - 订单: formal=true id=term-e8aea2e58d957c64 domains=[food_order] pinyin=ding|dan

Exact Recall:
  - compound: true
  - 行程: ExactRecall=true
  - 订单: ExactRecall=true

Semantic Classification: NOUN_NOUN_BUSINESS_PHRASE
Exception Evidence: none (ordinary composite / fragment)
Domain Impact: DOMAIN_EVIDENCE_PRESERVED + REVIEW_DOMAIN_TAGS
Lattice Counterfactual: without-compound coverage=SEGMENTS_CAN_COVER; duplicatePath=REDUNDANT_FULL_TERM_PATH
Runtime Duplication: REDUNDANT_FULL_TERM_PATH

Recommendation: DELETE_CONFIRMED
Recommended Source Action: DELETE_SOURCE_ROW
Recommended termType: (n/a)
Recommended exceptionReason: (n/a)
Follow-up: REVIEW_DOMAIN_TAGS
Notes: 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖; 组合词/订单带 food_order，需复核原子词「订单」域标签是否误标（禁止机械复制）

## 59. 视频会议

Source: lexicon_full_corrected_review.csv row 8488 (industry_pack_v1)
Term ID: term-e8a786e9a291e4bc
Domains: [meeting]
Validator Decision: REJECT_COMPOSITE
Reason: NOUN_NOUN_BUSINESS_PHRASE
Segments: 视频 + 会议

Atomic Segment Check:
  - 视频: formal=true id=term-e8a786e9a2917c73 domains=[] pinyin=shi|pin
  - 会议: formal=true id=term-e4bc9ae8aeae7c68 domains=[meeting] pinyin=hui|yi

Exact Recall:
  - compound: true
  - 视频: ExactRecall=true
  - 会议: ExactRecall=true

Semantic Classification: NOUN_NOUN_BUSINESS_PHRASE
Exception Evidence: none (ordinary composite / fragment)
Domain Impact: DOMAIN_EVIDENCE_PRESERVED
Lattice Counterfactual: without-compound coverage=SEGMENTS_CAN_COVER; duplicatePath=REDUNDANT_FULL_TERM_PATH
Runtime Duplication: REDUNDANT_FULL_TERM_PATH

Recommendation: DELETE_CONFIRMED
Recommended Source Action: DELETE_SOURCE_ROW
Recommended termType: (n/a)
Recommended exceptionReason: (n/a)
Follow-up: none
Notes: 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖

## 60. 训练数据

Source: supplemental_terms.csv row 48 (supplemental)
Term ID: term-e8aeade7bb83e695
Domains: [tech_ai]
Validator Decision: REJECT_COMPOSITE
Reason: NOUN_NOUN_BUSINESS_PHRASE
Segments: 训练 + 数据

Atomic Segment Check:
  - 训练: formal=true id=term-e8aeade7bb837c78 domains=[tech_ai] pinyin=xun|lian
  - 数据: formal=true id=term-e695b0e68dae7c73 domains=[] pinyin=shu|ju

Exact Recall:
  - compound: true
  - 训练: ExactRecall=true
  - 数据: ExactRecall=true

Semantic Classification: NOUN_NOUN_BUSINESS_PHRASE
Exception Evidence: none (ordinary composite / fragment)
Domain Impact: DOMAIN_EVIDENCE_PRESERVED
Lattice Counterfactual: without-compound coverage=SEGMENTS_CAN_COVER; duplicatePath=REDUNDANT_FULL_TERM_PATH
Runtime Duplication: REDUNDANT_FULL_TERM_PATH

Recommendation: DELETE_CONFIRMED
Recommended Source Action: DELETE_SOURCE_ROW
Recommended termType: (n/a)
Recommended exceptionReason: (n/a)
Follow-up: none
Notes: 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖

## 61. 训练监控

Source: lexicon_full_corrected_review.csv row 8540 (industry_pack_v1)
Term ID: term-e8aeade7bb83e79b
Domains: [tech_ai]
Validator Decision: REJECT_COMPOSITE
Reason: NOUN_NOUN_BUSINESS_PHRASE
Segments: 训练 + 监控

Atomic Segment Check:
  - 训练: formal=true id=term-e8aeade7bb837c78 domains=[tech_ai] pinyin=xun|lian
  - 监控: formal=true id=term-e79b91e68ea77c6a domains=[] pinyin=jian|kong

Exact Recall:
  - compound: true
  - 训练: ExactRecall=true
  - 监控: ExactRecall=true

Semantic Classification: NOUN_NOUN_BUSINESS_PHRASE
Exception Evidence: none (ordinary composite / fragment)
Domain Impact: DOMAIN_EVIDENCE_PRESERVED
Lattice Counterfactual: without-compound coverage=SEGMENTS_CAN_COVER; duplicatePath=REDUNDANT_FULL_TERM_PATH
Runtime Duplication: REDUNDANT_FULL_TERM_PATH

Recommendation: DELETE_CONFIRMED
Recommended Source Action: DELETE_SOURCE_ROW
Recommended termType: (n/a)
Recommended exceptionReason: (n/a)
Follow-up: none
Notes: 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖

## 62. 转盘出口

Source: lexicon_full_corrected_review.csv row 8930 (industry_pack_v1)
Term ID: term-e8bdace79b98e587
Domains: []
Validator Decision: REJECT_COMPOSITE
Reason: NOUN_NOUN_BUSINESS_PHRASE
Segments: 转盘 + 出口

Atomic Segment Check:
  - 转盘: formal=true id=term-e8bdace79b987c7a domains=[] pinyin=zhuan|pan
  - 出口: formal=true id=term-e587bae58fa37c63 domains=[] pinyin=chu|kou

Exact Recall:
  - compound: true
  - 转盘: ExactRecall=true
  - 出口: ExactRecall=true

Semantic Classification: NOUN_NOUN_BUSINESS_PHRASE
Exception Evidence: none (ordinary composite / fragment)
Domain Impact: DOMAIN_EVIDENCE_PRESERVED
Lattice Counterfactual: without-compound coverage=SEGMENTS_CAN_COVER; duplicatePath=REDUNDANT_FULL_TERM_PATH
Runtime Duplication: REDUNDANT_FULL_TERM_PATH

Recommendation: DELETE_CONFIRMED
Recommended Source Action: DELETE_SOURCE_ROW
Recommended termType: (n/a)
Recommended exceptionReason: (n/a)
Follow-up: none
Notes: 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖

## 63. 迁移学习

Source: lexicon_full_corrected_review.csv row 8998 (industry_pack_v1)
Term ID: term-e8bf81e7a7bbe5ad
Domains: []
Validator Decision: REJECT_COMPOSITE
Reason: ACTION_OBJECT_PHRASE
Segments: 迁移 + 学习

Atomic Segment Check:
  - 迁移: formal=true id=term-e8bf81e7a7bb7c71 domains=[] pinyin=qian|yi
  - 学习: formal=true id=term-e5ada6e4b9a07c78 domains=[] pinyin=xue|xi

Exact Recall:
  - compound: true
  - 迁移: ExactRecall=true
  - 学习: ExactRecall=true

Semantic Classification: ACTION_OBJECT_PHRASE
Exception Evidence: none (ordinary composite / fragment)
Domain Impact: DOMAIN_EVIDENCE_PRESERVED
Lattice Counterfactual: without-compound coverage=SEGMENTS_CAN_COVER; duplicatePath=REDUNDANT_FULL_TERM_PATH
Runtime Duplication: REDUNDANT_FULL_TERM_PATH

Recommendation: DELETE_CONFIRMED
Recommended Source Action: DELETE_SOURCE_ROW
Recommended termType: (n/a)
Recommended exceptionReason: (n/a)
Follow-up: none
Notes: 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖

## 64. 迷你吧

Source: lexicon_full_corrected_review.csv row 9129 (industry_pack_v1)
Term ID: term-e8bfb7e4bda0e590
Domains: [tourism_hotel]
Validator Decision: REJECT_COMPOSITE
Reason: SENTENCE_FRAGMENT
Segments: (none)

Atomic Segment Check:
  - (no segments)

Exact Recall:
  - compound: false
  - n/a

Semantic Classification: OTHER
Exception Evidence: none (ordinary composite / fragment)
Domain Impact: DOMAIN_EVIDENCE_LOST + REVIEW_DOMAIN_TAGS
Lattice Counterfactual: without-compound coverage=NO_SEGMENTS_FRAGMENT_OK; duplicatePath=NO_RUNTIME_DUPLICATION
Runtime Duplication: NO_RUNTIME_DUPLICATION

Recommendation: DELETE_CONFIRMED
Recommended Source Action: DELETE_SOURCE_ROW
Recommended termType: (n/a)
Recommended exceptionReason: (n/a)
Follow-up: REVIEW_DOMAIN_TAGS
Notes: 句段/口语碎片，非独立正式原子词；删除不依赖 parent fragment

## 65. 退房时间

Source: supplemental_terms.csv row 62 (supplemental)
Term ID: term-e98080e688bfe697
Domains: [tourism_hotel]
Validator Decision: REJECT_COMPOSITE
Reason: NOUN_NOUN_BUSINESS_PHRASE
Segments: 退房 + 时间

Atomic Segment Check:
  - 退房: formal=true id=term-e98080e688bf7c74 domains=[tourism_hotel] pinyin=tui|fang
  - 时间: formal=true id=term-e697b6e997b47c73 domains=[] pinyin=shi|jian

Exact Recall:
  - compound: true
  - 退房: ExactRecall=true
  - 时间: ExactRecall=true

Semantic Classification: NOUN_NOUN_BUSINESS_PHRASE
Exception Evidence: none (ordinary composite / fragment)
Domain Impact: DOMAIN_EVIDENCE_PRESERVED
Lattice Counterfactual: without-compound coverage=SEGMENTS_CAN_COVER; duplicatePath=REDUNDANT_FULL_TERM_PATH
Runtime Duplication: REDUNDANT_FULL_TERM_PATH

Recommendation: DELETE_CONFIRMED
Recommended Source Action: DELETE_SOURCE_ROW
Recommended termType: (n/a)
Recommended exceptionReason: (n/a)
Follow-up: none
Notes: 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖

## 66. 邀请函

Source: lexicon_full_corrected_review.csv row 9265 (industry_pack_v1)
Term ID: term-e98280e8afb7e587
Domains: []
Validator Decision: REJECT_COMPOSITE
Reason: SENTENCE_FRAGMENT
Segments: (none)

Atomic Segment Check:
  - (no segments)

Exact Recall:
  - compound: true
  - n/a

Semantic Classification: OTHER
Exception Evidence: none (ordinary composite / fragment)
Domain Impact: DOMAIN_EVIDENCE_PRESERVED
Lattice Counterfactual: without-compound coverage=NO_SEGMENTS_FRAGMENT_OK; duplicatePath=NO_RUNTIME_DUPLICATION
Runtime Duplication: NO_RUNTIME_DUPLICATION

Recommendation: DELETE_CONFIRMED
Recommended Source Action: DELETE_SOURCE_ROW
Recommended termType: (n/a)
Recommended exceptionReason: (n/a)
Follow-up: none
Notes: 句段/口语碎片，非独立正式原子词；删除不依赖 parent fragment

## 67. 部署脚本

Source: supplemental_terms.csv row 50 (supplemental)
Term ID: term-e983a8e7bdb2e884
Domains: [tech_ai]
Validator Decision: REJECT_COMPOSITE
Reason: ACTION_OBJECT_PHRASE
Segments: 部署 + 脚本

Atomic Segment Check:
  - 部署: formal=true id=term-e983a8e7bdb27c62 domains=[tech_ai] pinyin=bu|shu
  - 脚本: formal=true id=term-e8849ae69cac7c6a domains=[] pinyin=jiao|ben

Exact Recall:
  - compound: true
  - 部署: ExactRecall=true
  - 脚本: ExactRecall=true

Semantic Classification: ACTION_OBJECT_PHRASE
Exception Evidence: none (ordinary composite / fragment)
Domain Impact: DOMAIN_EVIDENCE_PRESERVED
Lattice Counterfactual: without-compound coverage=SEGMENTS_CAN_COVER; duplicatePath=REDUNDANT_FULL_TERM_PATH
Runtime Duplication: REDUNDANT_FULL_TERM_PATH

Recommendation: DELETE_CONFIRMED
Recommended Source Action: DELETE_SOURCE_ROW
Recommended termType: (n/a)
Recommended exceptionReason: (n/a)
Follow-up: none
Notes: 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖

## 68. 配置中心

Source: lexicon_full_corrected_review.csv row 9312 (industry_pack_v1)
Term ID: term-e9858de7bdaee4b8
Domains: []
Validator Decision: REJECT_COMPOSITE
Reason: ACTION_OBJECT_PHRASE
Segments: 配置 + 中心

Atomic Segment Check:
  - 配置: formal=true id=term-e9858de7bdae7c70 domains=[] pinyin=pei|zhi
  - 中心: formal=true id=term-e4b8ade5bf837c7a domains=[] pinyin=zhong|xin

Exact Recall:
  - compound: true
  - 配置: ExactRecall=true
  - 中心: ExactRecall=true

Semantic Classification: FIXED_TECHNICAL_TERM
Exception Evidence: recommended fixed_technical_term
Domain Impact: DOMAIN_EVIDENCE_PRESERVED
Lattice Counterfactual: without-compound coverage=SEGMENTS_CAN_COVER; duplicatePath=REDUNDANT_FULL_TERM_PATH
Runtime Duplication: REDUNDANT_FULL_TERM_PATH

Recommendation: KEEP_AS_EXCEPTION
Recommended Source Action: ADD_EXCEPTION_METADATA
Recommended termType: fixed_technical_term
Recommended exceptionReason: 「配置中心」在微服务/运维语境中是固定组件名（Config Center），完整形式具有独立技术实体身份。
Follow-up: none
Notes: 微服务固定组件名

## 69. 配置推理

Source: lexicon_full_corrected_review.csv row 9313 (industry_pack_v1)
Term ID: term-e9858de7bdaee68e
Domains: [tech_ai]
Validator Decision: REJECT_COMPOSITE
Reason: ACTION_OBJECT_PHRASE
Segments: 配置 + 推理

Atomic Segment Check:
  - 配置: formal=true id=term-e9858de7bdae7c70 domains=[] pinyin=pei|zhi
  - 推理: formal=true id=term-e68ea8e790867c74 domains=[tech_ai] pinyin=tui|li

Exact Recall:
  - compound: true
  - 配置: ExactRecall=true
  - 推理: ExactRecall=true

Semantic Classification: ACTION_OBJECT_PHRASE
Exception Evidence: none (ordinary composite / fragment)
Domain Impact: DOMAIN_EVIDENCE_PRESERVED
Lattice Counterfactual: without-compound coverage=SEGMENTS_CAN_COVER; duplicatePath=REDUNDANT_FULL_TERM_PATH
Runtime Duplication: REDUNDANT_FULL_TERM_PATH

Recommendation: DELETE_CONFIRMED
Recommended Source Action: DELETE_SOURCE_ROW
Recommended termType: (n/a)
Recommended exceptionReason: (n/a)
Follow-up: none
Notes: 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖

## 70. 配置文件

Source: supplemental_terms.csv row 51 (supplemental)
Term ID: term-e9858de7bdaee696
Domains: [tech_ai]
Validator Decision: REJECT_COMPOSITE
Reason: ACTION_OBJECT_PHRASE
Segments: 配置 + 文件

Atomic Segment Check:
  - 配置: formal=true id=term-e9858de7bdae7c70 domains=[] pinyin=pei|zhi
  - 文件: formal=true id=term-e69687e4bbb67c77 domains=[] pinyin=wen|jian

Exact Recall:
  - compound: true
  - 配置: ExactRecall=true
  - 文件: ExactRecall=true

Semantic Classification: ACTION_OBJECT_PHRASE
Exception Evidence: none (ordinary composite / fragment)
Domain Impact: DOMAIN_EVIDENCE_LOST + REVIEW_DOMAIN_TAGS
Lattice Counterfactual: without-compound coverage=SEGMENTS_CAN_COVER; duplicatePath=REDUNDANT_FULL_TERM_PATH
Runtime Duplication: REDUNDANT_FULL_TERM_PATH

Recommendation: DELETE_CONFIRMED
Recommended Source Action: DELETE_SOURCE_ROW
Recommended termType: (n/a)
Recommended exceptionReason: (n/a)
Follow-up: REVIEW_DOMAIN_TAGS
Notes: 普通业务组合可删；Domain 证据弱化/丢失，后续独立复核原子词标签（禁止机械复制组合域）

## 71. 降级策略

Source: lexicon_full_corrected_review.csv row 9567 (industry_pack_v1)
Term ID: term-e9998de7baa7e7ad
Domains: []
Validator Decision: REJECT_COMPOSITE
Reason: NOUN_NOUN_BUSINESS_PHRASE
Segments: 降级 + 策略

Atomic Segment Check:
  - 降级: formal=true id=term-e9998de7baa77c6a domains=[] pinyin=jiang|ji
  - 策略: formal=true id=term-e7ad96e795a57c63 domains=[] pinyin=ce|le

Exact Recall:
  - compound: false
  - 降级: ExactRecall=true
  - 策略: ExactRecall=false

Semantic Classification: NOUN_NOUN_BUSINESS_PHRASE
Exception Evidence: none (ordinary composite / fragment)
Domain Impact: DOMAIN_EVIDENCE_PRESERVED
Lattice Counterfactual: without-compound coverage=SEGMENTS_INCOMPLETE; duplicatePath=SEMANTICALLY_DISTINCT_FULL_TERM_PATH
Runtime Duplication: SEMANTICALLY_DISTINCT_FULL_TERM_PATH

Recommendation: DELETE_CONFIRMED
Recommended Source Action: DELETE_SOURCE_ROW
Recommended termType: (n/a)
Recommended exceptionReason: (n/a)
Follow-up: none
Notes: 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖

## 72. 集合时间

Source: lexicon_full_corrected_review.csv row 9649 (industry_pack_v1)
Term ID: term-e99b86e59088e697
Domains: []
Validator Decision: REJECT_COMPOSITE
Reason: NOUN_NOUN_BUSINESS_PHRASE
Segments: 集合 + 时间

Atomic Segment Check:
  - 集合: formal=true id=term-e99b86e590887c6a domains=[] pinyin=ji|he
  - 时间: formal=true id=term-e697b6e997b47c73 domains=[] pinyin=shi|jian

Exact Recall:
  - compound: true
  - 集合: ExactRecall=true
  - 时间: ExactRecall=true

Semantic Classification: NOUN_NOUN_BUSINESS_PHRASE
Exception Evidence: none (ordinary composite / fragment)
Domain Impact: DOMAIN_EVIDENCE_PRESERVED
Lattice Counterfactual: without-compound coverage=SEGMENTS_CAN_COVER; duplicatePath=REDUNDANT_FULL_TERM_PATH
Runtime Duplication: REDUNDANT_FULL_TERM_PATH

Recommendation: DELETE_CONFIRMED
Recommended Source Action: DELETE_SOURCE_ROW
Recommended termType: (n/a)
Recommended exceptionReason: (n/a)
Follow-up: none
Notes: 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖

## 73. 集成测试

Source: supplemental_terms.csv row 44 (supplemental)
Term ID: term-e99b86e68890e6b5
Domains: [tech_ai]
Validator Decision: REJECT_COMPOSITE
Reason: NOUN_NOUN_BUSINESS_PHRASE
Segments: 集成 + 测试

Atomic Segment Check:
  - 集成: formal=true id=term-e99b86e688907c6a domains=[] pinyin=ji|cheng
  - 测试: formal=true id=term-e6b58be8af957c63 domains=[] pinyin=ce|shi

Exact Recall:
  - compound: true
  - 集成: ExactRecall=true
  - 测试: ExactRecall=true

Semantic Classification: NOUN_NOUN_BUSINESS_PHRASE
Exception Evidence: none (ordinary composite / fragment)
Domain Impact: DOMAIN_EVIDENCE_LOST + REVIEW_DOMAIN_TAGS
Lattice Counterfactual: without-compound coverage=SEGMENTS_CAN_COVER; duplicatePath=REDUNDANT_FULL_TERM_PATH
Runtime Duplication: REDUNDANT_FULL_TERM_PATH

Recommendation: DELETE_CONFIRMED
Recommended Source Action: DELETE_SOURCE_ROW
Recommended termType: (n/a)
Recommended exceptionReason: (n/a)
Follow-up: REVIEW_DOMAIN_TAGS
Notes: 普通业务组合可删；Domain 证据弱化/丢失，后续独立复核原子词标签（禁止机械复制组合域）

## 74. 领域日志

Source: lexicon_full_corrected_review.csv row 9766 (industry_pack_v1)
Term ID: term-e9a286e59f9fe697
Domains: [tech_ai]
Validator Decision: REJECT_COMPOSITE
Reason: NOUN_NOUN_BUSINESS_PHRASE
Segments: 领域 + 日志

Atomic Segment Check:
  - 领域: formal=true id=term-e9a286e59f9f7c6c domains=[] pinyin=ling|yu
  - 日志: formal=true id=term-e697a5e5bf977c72 domains=[tech_ai] pinyin=ri|zhi

Exact Recall:
  - compound: true
  - 领域: ExactRecall=true
  - 日志: ExactRecall=true

Semantic Classification: NOUN_NOUN_BUSINESS_PHRASE
Exception Evidence: none (ordinary composite / fragment)
Domain Impact: DOMAIN_EVIDENCE_PRESERVED
Lattice Counterfactual: without-compound coverage=SEGMENTS_CAN_COVER; duplicatePath=REDUNDANT_FULL_TERM_PATH
Runtime Duplication: REDUNDANT_FULL_TERM_PATH

Recommendation: DELETE_CONFIRMED
Recommended Source Action: DELETE_SOURCE_ROW
Recommended termType: (n/a)
Recommended exceptionReason: (n/a)
Follow-up: none
Notes: 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖


---

## 12. DELETE_CONFIRMED Summary

Count: **71**

| surface | source | reason | segments | domainFollowUp |
|---------|--------|--------|----------|----------------|
| 可以吗 | lexicon_full_corrected_review.csv:13 | SENTENCE_FRAGMENT | - |  |
| 上线计划 | supplemental_terms.csv:41 | ACTION_OBJECT_PHRASE | 上线+计划 |  |
| 专题会议 | lexicon_full_corrected_review.csv:286 | NOUN_NOUN_BUSINESS_PHRASE | 专题+会议 |  |
| 主持会议 | lexicon_full_corrected_review.csv:437 | NOUN_NOUN_BUSINESS_PHRASE | 主持+会议 |  |
| 休息时间 | lexicon_full_corrected_review.csv:787 | NOUN_NOUN_BUSINESS_PHRASE | 休息+时间 |  |
| 会议通知 | supplemental_terms.csv:32 | NOUN_NOUN_BUSINESS_PHRASE | 会议+通知 |  |
| 入住时间 | supplemental_terms.csv:61 | ACTION_OBJECT_PHRASE | 入住+时间 |  |
| 前台信息 | lexicon_full_corrected_review.csv:1694 | NOUN_NOUN_BUSINESS_PHRASE | 前台+信息 |  |
| 单元测试 | supplemental_terms.csv:43 | NOUN_NOUN_BUSINESS_PHRASE | 单元+测试 | REVIEW_DOMAIN_TAGS |
| 向量状态 | lexicon_full_corrected_review.csv:2441 | NOUN_NOUN_BUSINESS_PHRASE | 向量+状态 |  |
| 咖啡时间 | lexicon_full_corrected_review.csv:2518 | NOUN_NOUN_BUSINESS_PHRASE | 咖啡+时间 |  |
| 回归测试 | supplemental_terms.csv:45 | NOUN_NOUN_BUSINESS_PHRASE | 回归+测试 | REVIEW_DOMAIN_TAGS |
| 安检通道 | lexicon_full_corrected_review.csv:3336 | NOUN_NOUN_BUSINESS_PHRASE | 安检+通道 |  |
| 审计日志 | lexicon_full_corrected_review.csv:3416 | NOUN_NOUN_BUSINESS_PHRASE | 审计+日志 |  |
| 延误订单 | lexicon_full_corrected_review.csv:3969 | NOUN_NOUN_BUSINESS_PHRASE | 延误+订单 | REVIEW_DOMAIN_TAGS |
| 当前版本 | lexicon_full_corrected_review.csv:4082 | NOUN_NOUN_BUSINESS_PHRASE | 当前+版本 |  |
| 循环网络 | lexicon_full_corrected_review.csv:4161 | NOUN_NOUN_BUSINESS_PHRASE | 循环+网络 |  |
| 快速测试 | lexicon_full_corrected_review.csv:4237 | NOUN_NOUN_BUSINESS_PHRASE | 快速+测试 |  |
| 快速通道 | lexicon_full_corrected_review.csv:4239 | NOUN_NOUN_BUSINESS_PHRASE | 快速+通道 |  |
| 接口文档 | supplemental_terms.csv:40 | NOUN_NOUN_BUSINESS_PHRASE | 接口+文档 |  |
| 接送时间 | lexicon_full_corrected_review.csv:4904 | NOUN_NOUN_BUSINESS_PHRASE | 接送+时间 |  |
| 提示工程 | lexicon_full_corrected_review.csv:4956 | NOUN_NOUN_BUSINESS_PHRASE | 提示+工程 |  |
| 文档版本 | lexicon_full_corrected_review.csv:5193 | NOUN_NOUN_BUSINESS_PHRASE | 文档+版本 |  |
| 日志恢复 | lexicon_full_corrected_review.csv:5304 | NOUN_NOUN_BUSINESS_PHRASE | 日志+恢复 |  |
| 日志系统 | lexicon_full_corrected_review.csv:5307 | NOUN_NOUN_BUSINESS_PHRASE | 日志+系统 |  |
| 日志记录 | lexicon_full_corrected_review.csv:5309 | NOUN_NOUN_BUSINESS_PHRASE | 日志+记录 |  |
| 早餐时间 | lexicon_full_corrected_review.csv:5344 | NOUN_NOUN_BUSINESS_PHRASE | 早餐+时间 |  |
| 是否 | lexicon_full_corrected_review.csv:5397 | SENTENCE_FRAGMENT | - |  |
| 景区出口 | supplemental_terms.csv:72 | NOUN_NOUN_BUSINESS_PHRASE | 景区+出口 |  |
| 机场信息 | lexicon_full_corrected_review.csv:5627 | NOUN_NOUN_BUSINESS_PHRASE | 机场+信息 |  |
| 机场时间 | lexicon_full_corrected_review.csv:5632 | NOUN_NOUN_BUSINESS_PHRASE | 机场+时间 |  |
| 查看日志 | lexicon_full_corrected_review.csv:5742 | NOUN_NOUN_BUSINESS_PHRASE | 查看+日志 |  |
| 检查内容 | lexicon_full_corrected_review.csv:5813 | NOUN_NOUN_BUSINESS_PHRASE | 检查+内容 |  |
| 检查日志 | lexicon_full_corrected_review.csv:5821 | NOUN_NOUN_BUSINESS_PHRASE | 检查+日志 |  |
| 检查是否有 | lexicon_full_corrected_review.csv:5822 | SENTENCE_FRAGMENT | - |  |
| 正则策略 | lexicon_full_corrected_review.csv:5928 | NOUN_NOUN_BUSINESS_PHRASE | 正则+策略 |  |
| 正常状态 | lexicon_full_corrected_review.csv:5944 | NOUN_NOUN_BUSINESS_PHRASE | 正常+状态 |  |
| 流量镜像 | lexicon_full_corrected_review.csv:6292 | NOUN_NOUN_BUSINESS_PHRASE | 流量+镜像 |  |
| 测试数据 | supplemental_terms.csv:49 | ACTION_OBJECT_PHRASE | 测试+数据 | REVIEW_DOMAIN_TAGS |
| 熔断策略 | lexicon_full_corrected_review.csv:6637 | NOUN_NOUN_BUSINESS_PHRASE | 熔断+策略 |  |
| 特征工程 | lexicon_full_corrected_review.csv:6713 | NOUN_NOUN_BUSINESS_PHRASE | 特征+工程 | REVIEW_DOMAIN_TAGS |
| 环岛时间 | lexicon_full_corrected_review.csv:6772 | NOUN_NOUN_BUSINESS_PHRASE | 环岛+时间 |  |
| 登机时间 | lexicon_full_corrected_review.csv:6997 | ACTION_OBJECT_PHRASE | 登机+时间 |  |
| 神经网络 | lexicon_full_corrected_review.csv:7300 | NOUN_NOUN_BUSINESS_PHRASE | 神经+网络 | REVIEW_DOMAIN_TAGS |
| 租车提醒 | lexicon_full_corrected_review.csv:7353 | NOUN_NOUN_BUSINESS_PHRASE | 租车+提醒 |  |
| 缆车提醒 | lexicon_full_corrected_review.csv:7743 | NOUN_NOUN_BUSINESS_PHRASE | 缆车+提醒 |  |
| 翻译日志 | lexicon_full_corrected_review.csv:7819 | NOUN_NOUN_BUSINESS_PHRASE | 翻译+日志 |  |
| 联系电话 | lexicon_full_corrected_review.csv:7887 | NOUN_NOUN_BUSINESS_PHRASE | 联系+电话 |  |
| 航班提醒 | lexicon_full_corrected_review.csv:8070 | NOUN_NOUN_BUSINESS_PHRASE | 航班+提醒 |  |
| 航班时间 | lexicon_full_corrected_review.csv:8071 | NOUN_NOUN_BUSINESS_PHRASE | 航班+时间 |  |
| 航班订单 | lexicon_full_corrected_review.csv:8072 | NOUN_NOUN_BUSINESS_PHRASE | 航班+订单 | REVIEW_DOMAIN_TAGS |
| 节点指标 | lexicon_full_corrected_review.csv:8112 | NOUN_NOUN_BUSINESS_PHRASE | 节点+指标 |  |
| 节点注册 | lexicon_full_corrected_review.csv:8115 | NOUN_NOUN_BUSINESS_PHRASE | 节点+注册 |  |
| 节点配置 | lexicon_full_corrected_review.csv:8119 | NOUN_NOUN_BUSINESS_PHRASE | 节点+配置 |  |
| 行李订单 | lexicon_full_corrected_review.csv:8348 | NOUN_NOUN_BUSINESS_PHRASE | 行李+订单 | REVIEW_DOMAIN_TAGS |
| 行程订单 | lexicon_full_corrected_review.csv:8359 | NOUN_NOUN_BUSINESS_PHRASE | 行程+订单 | REVIEW_DOMAIN_TAGS |
| 视频会议 | lexicon_full_corrected_review.csv:8488 | NOUN_NOUN_BUSINESS_PHRASE | 视频+会议 |  |
| 训练数据 | supplemental_terms.csv:48 | NOUN_NOUN_BUSINESS_PHRASE | 训练+数据 |  |
| 训练监控 | lexicon_full_corrected_review.csv:8540 | NOUN_NOUN_BUSINESS_PHRASE | 训练+监控 |  |
| 转盘出口 | lexicon_full_corrected_review.csv:8930 | NOUN_NOUN_BUSINESS_PHRASE | 转盘+出口 |  |
| 迁移学习 | lexicon_full_corrected_review.csv:8998 | ACTION_OBJECT_PHRASE | 迁移+学习 |  |
| 迷你吧 | lexicon_full_corrected_review.csv:9129 | SENTENCE_FRAGMENT | - | REVIEW_DOMAIN_TAGS |
| 退房时间 | supplemental_terms.csv:62 | NOUN_NOUN_BUSINESS_PHRASE | 退房+时间 |  |
| 邀请函 | lexicon_full_corrected_review.csv:9265 | SENTENCE_FRAGMENT | - |  |
| 部署脚本 | supplemental_terms.csv:50 | ACTION_OBJECT_PHRASE | 部署+脚本 |  |
| 配置推理 | lexicon_full_corrected_review.csv:9313 | ACTION_OBJECT_PHRASE | 配置+推理 |  |
| 配置文件 | supplemental_terms.csv:51 | ACTION_OBJECT_PHRASE | 配置+文件 | REVIEW_DOMAIN_TAGS |
| 降级策略 | lexicon_full_corrected_review.csv:9567 | NOUN_NOUN_BUSINESS_PHRASE | 降级+策略 |  |
| 集合时间 | lexicon_full_corrected_review.csv:9649 | NOUN_NOUN_BUSINESS_PHRASE | 集合+时间 |  |
| 集成测试 | supplemental_terms.csv:44 | NOUN_NOUN_BUSINESS_PHRASE | 集成+测试 | REVIEW_DOMAIN_TAGS |
| 领域日志 | lexicon_full_corrected_review.csv:9766 | NOUN_NOUN_BUSINESS_PHRASE | 领域+日志 |  |

---

## 13. KEEP_AS_EXCEPTION Summary

Count: **3**

| surface | termType | exceptionReason |
|---------|----------|-----------------|
| 专家系统 | fixed_technical_term | 「专家系统」是经典 AI 固定技术术语，指一类完整系统形态，拆成「专家+系统」不能等价替代其学科/产品指称。 |
| 注册中心 | fixed_technical_term | 「注册中心」在微服务架构中是固定组件名（Service Registry），完整形式具有独立技术实体身份，拆成「注册+中心」不能等价替代。 |
| 配置中心 | fixed_technical_term | 「配置中心」在微服务/运维语境中是固定组件名（Config Center），完整形式具有独立技术实体身份。 |

---

## 14. VALIDATOR_FALSE_POSITIVE Summary

Count: **0**

_None in this batch. No VALIDATOR_RULE_REVIEW_REQUIRED._

---

## 15. REVIEW_DOMAIN_TAGS Summary

Count: **12** (follow-up; typically paired with DELETE_CONFIRMED)

| surface | compoundDomains | segmentDomains | impact |
|---------|-----------------|----------------|--------|
| 单元测试 | tech_ai | 单元:; 测试: | DOMAIN_EVIDENCE_LOST |
| 回归测试 | tech_ai | 回归:; 测试: | DOMAIN_EVIDENCE_LOST |
| 延误订单 | food_order | 延误:; 订单:food_order | DOMAIN_EVIDENCE_PRESERVED |
| 测试数据 | tech_ai | 测试:; 数据: | DOMAIN_EVIDENCE_LOST |
| 特征工程 | tech_ai | 特征:; 工程: | DOMAIN_EVIDENCE_LOST |
| 神经网络 | tech_ai | 神经:; 网络: | DOMAIN_EVIDENCE_LOST |
| 航班订单 | food_order | 航班:; 订单:food_order | DOMAIN_EVIDENCE_PRESERVED |
| 行李订单 | food_order | 行李:; 订单:food_order | DOMAIN_EVIDENCE_PRESERVED |
| 行程订单 | food_order,tourism_route | 行程:tourism_route; 订单:food_order | DOMAIN_EVIDENCE_PRESERVED |
| 迷你吧 | tourism_hotel |  | DOMAIN_EVIDENCE_LOST |
| 配置文件 | tech_ai | 配置:; 文件: | DOMAIN_EVIDENCE_LOST |
| 集成测试 | tech_ai | 集成:; 测试: | DOMAIN_EVIDENCE_LOST |

---

## 16. INSUFFICIENT_EVIDENCE Summary

Count: **0**

_None._

---

## 17. Source Action Matrix

| Action | Count |
|--------|------:|
| DELETE_SOURCE_ROW | 71 |
| ADD_EXCEPTION_METADATA | 3 |
| REQUIRES_VALIDATOR_REVIEW | 0 |
| KEEP_UNCHANGED | 0 |

---

## 18. Next Development Scope

### Source Delete Batch
仅 `DELETE_CONFIRMED`（71）→ 从 review/supplemental 删除 Source 行。含 **上线计划、接口文档**。

### Exception Metadata Batch
仅 KEEP：专家系统、注册中心、配置中心 → 写入 `term_type` + `exception_reason`。

### Domain Review Batch
仅 REVIEW_DOMAIN_TAGS follow-up（12）→ 独立复核原子词标签；**禁止**组合域全量复制。

### Validator Review
本批无系统性误判；**不改 Validator**。UNRESOLVED 740 另开批次。

四类不得混在一次提交。

---

## 19. Target List Result

T1–T30: **PASS**

---

## 20. Check List Result

```text
[x] 未修改正式代码 / Source / SQLite / Domain Tags / Validator
[x] 未执行 rebuild / 未切换 enforce
[x] 已读取全部 74 条并完成 Source/拆分/Exact/语义/Domain/Lattice
[x] 已完成上线计划 / 接口文档专项
[x] 未混入 740 个 UNRESOLVED
[x] 已生成 Markdown + CSV + 五类汇总
[x] term count=10061 / content hash 未变
```

---

## 21. Final Recommendation

```text
BATCH1_REVIEW_READY

74 个 REJECT_COMPOSITE 已全部完成 Source、
语义、原子拆分、Domain 与 Lattice 证据审计。

DELETE、合法例外、Validator 误判和 Domain Follow-up
已经分离，可以进入 Source-level Cleanup 开发。
```

---

## Appendix A. DELETE_CONFIRMED

- **可以吗** (lexicon_full_corrected_review.csv:13) — 句段/口语碎片，非独立正式原子词；删除不依赖 parent fragment
- **上线计划** (supplemental_terms.csv:41) — 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖
- **专题会议** (lexicon_full_corrected_review.csv:286) — 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖
- **主持会议** (lexicon_full_corrected_review.csv:437) — 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖
- **休息时间** (lexicon_full_corrected_review.csv:787) — 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖
- **会议通知** (supplemental_terms.csv:32) — 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖
- **入住时间** (supplemental_terms.csv:61) — 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖
- **前台信息** (lexicon_full_corrected_review.csv:1694) — 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖
- **单元测试** (supplemental_terms.csv:43) — 普通业务组合可删；Domain 证据弱化/丢失，后续独立复核原子词标签（禁止机械复制组合域）
- **向量状态** (lexicon_full_corrected_review.csv:2441) — 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖
- **咖啡时间** (lexicon_full_corrected_review.csv:2518) — 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖
- **回归测试** (supplemental_terms.csv:45) — 普通业务组合可删；Domain 证据弱化/丢失，后续独立复核原子词标签（禁止机械复制组合域）
- **安检通道** (lexicon_full_corrected_review.csv:3336) — 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖
- **审计日志** (lexicon_full_corrected_review.csv:3416) — 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖
- **延误订单** (lexicon_full_corrected_review.csv:3969) — 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖; 组合词/订单带 food_order，需复核原子词「订单」域标签是否误标（禁止机械复制）
- **当前版本** (lexicon_full_corrected_review.csv:4082) — 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖
- **循环网络** (lexicon_full_corrected_review.csv:4161) — 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖
- **快速测试** (lexicon_full_corrected_review.csv:4237) — 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖
- **快速通道** (lexicon_full_corrected_review.csv:4239) — 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖
- **接口文档** (supplemental_terms.csv:40) — 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖
- **接送时间** (lexicon_full_corrected_review.csv:4904) — 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖
- **提示工程** (lexicon_full_corrected_review.csv:4956) — 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖
- **文档版本** (lexicon_full_corrected_review.csv:5193) — 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖
- **日志恢复** (lexicon_full_corrected_review.csv:5304) — 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖
- **日志系统** (lexicon_full_corrected_review.csv:5307) — 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖
- **日志记录** (lexicon_full_corrected_review.csv:5309) — 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖
- **早餐时间** (lexicon_full_corrected_review.csv:5344) — 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖
- **是否** (lexicon_full_corrected_review.csv:5397) — 句段/口语碎片，非独立正式原子词；删除不依赖 parent fragment
- **景区出口** (supplemental_terms.csv:72) — 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖
- **机场信息** (lexicon_full_corrected_review.csv:5627) — 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖
- **机场时间** (lexicon_full_corrected_review.csv:5632) — 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖
- **查看日志** (lexicon_full_corrected_review.csv:5742) — 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖
- **检查内容** (lexicon_full_corrected_review.csv:5813) — 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖
- **检查日志** (lexicon_full_corrected_review.csv:5821) — 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖
- **检查是否有** (lexicon_full_corrected_review.csv:5822) — 句段/口语碎片，非独立正式原子词；删除不依赖 parent fragment
- **正则策略** (lexicon_full_corrected_review.csv:5928) — 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖
- **正常状态** (lexicon_full_corrected_review.csv:5944) — 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖
- **流量镜像** (lexicon_full_corrected_review.csv:6292) — 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖
- **测试数据** (supplemental_terms.csv:49) — 普通业务组合可删；Domain 证据弱化/丢失，后续独立复核原子词标签（禁止机械复制组合域）
- **熔断策略** (lexicon_full_corrected_review.csv:6637) — 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖
- **特征工程** (lexicon_full_corrected_review.csv:6713) — 普通业务组合可删；Domain 证据弱化/丢失，后续独立复核原子词标签（禁止机械复制组合域）
- **环岛时间** (lexicon_full_corrected_review.csv:6772) — 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖
- **登机时间** (lexicon_full_corrected_review.csv:6997) — 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖
- **神经网络** (lexicon_full_corrected_review.csv:7300) — 普通业务组合可删；Domain 证据弱化/丢失，后续独立复核原子词标签（禁止机械复制组合域）
- **租车提醒** (lexicon_full_corrected_review.csv:7353) — 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖
- **缆车提醒** (lexicon_full_corrected_review.csv:7743) — 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖
- **翻译日志** (lexicon_full_corrected_review.csv:7819) — 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖
- **联系电话** (lexicon_full_corrected_review.csv:7887) — 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖
- **航班提醒** (lexicon_full_corrected_review.csv:8070) — 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖
- **航班时间** (lexicon_full_corrected_review.csv:8071) — 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖
- **航班订单** (lexicon_full_corrected_review.csv:8072) — 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖; 组合词/订单带 food_order，需复核原子词「订单」域标签是否误标（禁止机械复制）
- **节点指标** (lexicon_full_corrected_review.csv:8112) — 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖
- **节点注册** (lexicon_full_corrected_review.csv:8115) — 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖
- **节点配置** (lexicon_full_corrected_review.csv:8119) — 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖
- **行李订单** (lexicon_full_corrected_review.csv:8348) — 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖; 组合词/订单带 food_order，需复核原子词「订单」域标签是否误标（禁止机械复制）
- **行程订单** (lexicon_full_corrected_review.csv:8359) — 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖; 组合词/订单带 food_order，需复核原子词「订单」域标签是否误标（禁止机械复制）
- **视频会议** (lexicon_full_corrected_review.csv:8488) — 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖
- **训练数据** (supplemental_terms.csv:48) — 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖
- **训练监控** (lexicon_full_corrected_review.csv:8540) — 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖
- **转盘出口** (lexicon_full_corrected_review.csv:8930) — 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖
- **迁移学习** (lexicon_full_corrected_review.csv:8998) — 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖
- **迷你吧** (lexicon_full_corrected_review.csv:9129) — 句段/口语碎片，非独立正式原子词；删除不依赖 parent fragment
- **退房时间** (supplemental_terms.csv:62) — 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖
- **邀请函** (lexicon_full_corrected_review.csv:9265) — 句段/口语碎片，非独立正式原子词；删除不依赖 parent fragment
- **部署脚本** (supplemental_terms.csv:50) — 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖
- **配置推理** (lexicon_full_corrected_review.csv:9313) — 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖
- **配置文件** (supplemental_terms.csv:51) — 普通业务组合可删；Domain 证据弱化/丢失，后续独立复核原子词标签（禁止机械复制组合域）
- **降级策略** (lexicon_full_corrected_review.csv:9567) — 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖
- **集合时间** (lexicon_full_corrected_review.csv:9649) — 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖
- **集成测试** (supplemental_terms.csv:44) — 普通业务组合可删；Domain 证据弱化/丢失，后续独立复核原子词标签（禁止机械复制组合域）
- **领域日志** (lexicon_full_corrected_review.csv:9766) — 普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖

## Appendix B. KEEP_AS_EXCEPTION

- **专家系统** (lexicon_full_corrected_review.csv:272) — fixed_technical_term: 「专家系统」是经典 AI 固定技术术语，指一类完整系统形态，拆成「专家+系统」不能等价替代其学科/产品指称。
- **注册中心** (lexicon_full_corrected_review.csv:6226) — fixed_technical_term: 「注册中心」在微服务架构中是固定组件名（Service Registry），完整形式具有独立技术实体身份，拆成「注册+中心」不能等价替代。
- **配置中心** (lexicon_full_corrected_review.csv:9312) — fixed_technical_term: 「配置中心」在微服务/运维语境中是固定组件名（Config Center），完整形式具有独立技术实体身份。

## Appendix C. VALIDATOR_FALSE_POSITIVE

_None._

## Appendix D. REVIEW_DOMAIN_TAGS

- **单元测试** — DOMAIN_EVIDENCE_LOST; domains=[tech_ai]
- **回归测试** — DOMAIN_EVIDENCE_LOST; domains=[tech_ai]
- **延误订单** — DOMAIN_EVIDENCE_PRESERVED; domains=[food_order]
- **测试数据** — DOMAIN_EVIDENCE_LOST; domains=[tech_ai]
- **特征工程** — DOMAIN_EVIDENCE_LOST; domains=[tech_ai]
- **神经网络** — DOMAIN_EVIDENCE_LOST; domains=[tech_ai]
- **航班订单** — DOMAIN_EVIDENCE_PRESERVED; domains=[food_order]
- **行李订单** — DOMAIN_EVIDENCE_PRESERVED; domains=[food_order]
- **行程订单** — DOMAIN_EVIDENCE_PRESERVED; domains=[food_order,tourism_route]
- **迷你吧** — DOMAIN_EVIDENCE_LOST; domains=[tourism_hotel]
- **配置文件** — DOMAIN_EVIDENCE_LOST; domains=[tech_ai]
- **集成测试** — DOMAIN_EVIDENCE_LOST; domains=[tech_ai]

## Appendix E. INSUFFICIENT_EVIDENCE

_None._

## Special focus

### 上线计划
- Source: supplemental_terms.csv row 41
- Segments: 上线 + 计划；二者正式 term 且 Exact Recall=true
- 上线 domains=[tech_ai]；计划 Base
- Domain: PRESERVED；Lattice: SEGMENTS_CAN_COVER；REDUNDANT_FULL_TERM_PATH
- **DELETE_CONFIRMED**（本轮不删除）

### 接口文档
- Source: supplemental_terms.csv row 40
- Segments: 接口 + 文档；二者正式且 Exact Recall=true
- 接口 domains=[tech_ai]；文档 Base
- **DELETE_CONFIRMED**（本轮不删除）

### NOT_IN_REJECT_BATCH
| surface | decision |
|---------|----------|
| 内科医生 | UNRESOLVED |
| 国家博物馆 | UNRESOLVED |
| 焦糖玛奇朵 | UNRESOLVED |
| 蓝莓马芬 | UNRESOLVED |
