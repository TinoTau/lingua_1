# FW_Repair_V4_Industry_Expansion_Pack_V1_Final_Development_Plan

## Document Status

* Type: Final Development Plan
* Status: CONDITIONAL READY
* Framework Status: Frozen
* Contract Status: Frozen
* Architecture Compliance: PASS
* Source Audit: PASS
* Supplement Audit: Applied

---

# 1. Objective

构建 Industry Expansion Pack V1。

目标：

* 扩充约 2000 个合法行业词条
* 提升跨行业真实对话场景 Recall 覆盖率
* 不修改 Framework
* 不修改 Runtime 实现
* 不修改 SQLite Schema
* 不修改 Ranking
* 不修改 Domain Vote
* 不修改 KenLM
* 不修改 Apply Gate

本轮仅允许：

* JSONL 数据建设
* Patch V4 构建
* Domain Tag 扩充
* V4 导入与验收

---

# 2. Frozen Design Constraints

## 2.1 Framework Freeze

禁止修改：

* Recall Pipeline
* Domain Vote
* Domain Filter
* Ranking
* Tone Guard
* Assembly
* KenLM
* Apply Gate
* Writeback

---

## 2.2 Lexicon Freeze

禁止修改：

* SQLite Schema
* Runtime Loader
* Patch Import Contract
* Alias Ownership Contract

必须使用：

* Lexicon Patch Importer V4

禁止：

* apply-lexicon-patch-v3
* import-v3-canonical-asset
* Legacy Import Path

---

## 2.3 Domain Contract

冻结：

```text
domainBoost = 0
```

Domain Tag 仅用于：

* Domain Vote
* Domain Filter
* Domain Statistics
* Operations

不得作为 Recall 主排序依据。

---

## 2.4 Alias Contract

禁止：

* 同音混淆集
* ASR错误词表
* Near Phone Alias
* 拼音替换表

允许：

* 官方简称
* 品牌简称
* 英文缩写

必须符合 Alias Ownership Contract。

---

# 3. Development Scope

## In Scope

### Industry Expansion Pack V1

目标：

1800~3000 词。

推荐：

2000±20%

---

### JSONL Source Package

新增：

industry_pack_v1/

资产目录。

---

### Patch V4 Package

允许：

* addTerm
* appendDomainTags
* updateDomainWeights
* deleteTerm
* addLegalAlias

---

### Multi Domain Append

必须：

appendDomainTags

禁止：

replaceDomainTagsDangerous

---

## Out Of Scope

禁止：

* Framework 开发
* Runtime 开发
* Importer 开发
* Schema 调整
* Ranking 调整
* KenLM 调整

---

# 4. Data Contract

## 必填字段

```json
{
  "word": "",
  "pinyin": "",
  "tone_pinyin": "",
  "domain_tags": [],
  "repair_target": true,
  "lexiconLayer": "domain_patch"
}
```

---

## 默认值

```text
repair_target=true

prior_score=0.85

enabled=1
```

---

## Domain Rules

必须：

* 使用已注册 domain_id
* 使用 Fine Domain

禁止：

* general
* 未注册 domain
* coarse domain winner

示例：

允许：

tourism_pickup
tourism_hotel
tourism_route
tourism_transport

禁止：

tourism
retail
logistics
（未注册前）

````

---

## Granularity Contract

允许：

- 2字
- 3字
- 4字

5字：

- 专有术语
- 行业术语

---

禁止：

- 业务短语
- 固定搭配
- Prompt模板
- 营销文案
- ASR错误词

---

## DENY LIST

禁止：

- 候选生成
- 上线计划
- 接口文档
- 数据管道
- 向量数据库

以及系统 Validator 定义的全部禁止项。

---

# 5. Industry Expansion Strategy

## Wave 1

重点：

- tech_ai
- tourism_pickup
- tourism_hotel
- tourism_route
- tourism_transport

---

## Wave 2

重点：

- medical
- transport
- meeting

---

## Wave 3

重点：

- restaurant
- bakery
- coffee

---

## Wave 4

重点：

- food_order
- retail（注册后）
- logistics（注册后）

---

# 6. JSONL Contract

## JSONL

```json
{
  "word": "智能体",
  "pinyin": "zhi neng ti",
  "tone_pinyin": "zhi4 neng2 ti3",
  "domain_tags": [
    "tech_ai"
  ],
  "repair_target": true,
  "lexiconLayer": "domain_patch"
}
````

---

## Collision Rule

唯一键：

```text
(word,pinyin_key)
```

---

已存在词：

必须：

```text
appendDomainTags
```

禁止：

```text
addTerm
```

---

多音字：

必须：

```text
term_id
```

禁止：

仅使用 word 定位。

---

# 7. Patch Contract

## Metadata

必须：

```json
{
  "patchSchemaVersion":"lexicon-patch-v4",
  "baseVersion":4
}
```

---

## Version Chain

要求：

```text
nextVersion
=
baseVersion + 1
```

串行递增。

---

## Hash

必须：

```text
npm run lexicon:compute-patch-hash:v4
```

生成。

---

## Threshold

当：

```text
operations > 100
```

必须：

```text
tableThresholds
```

同步调整。

---

# 8. Diagnostics Contract

## Import Diagnostics

必须检查：

* pre_gate_results
* runtime_gate_results
* source_sync
* checksum_before
* checksum_after
* new_terms
* appended_domains
* collision_terms

---

## Recall Diagnostics

必须检查：

* RecallSpanTopKV3Hit
* domainScores
* utteranceDomain

---

## Apply Diagnostics

必须检查：

* selected
* approved
* applied

三级状态。

禁止混用。

---

# 9. Regression List

必须执行：

## Import Validation

```text
lexicon:patch:import --dry-run
```

---

## Patch E2E

```text
test:lexicon-patch-v4-e2e
```

---

## Freeze Contract

```text
freeze-contract.test.ts
```

---

## Ranking Semantic

```text
run-fw-ranking-semantics-test.mjs
```

---

## Runtime Gate

```text
lexicon:gate:v3-runtime
```

---

## Dialog200 Spot Test

抽样验证。

---

## Industry Domain Test

新增：

行业专项 Case 集。

---

# 10. Acceptance Criteria

必须满足：

## Import

PASS

---

## Source Sync

PASS

必须：

```text
--source-jsonl
```

---

## Runtime Gate

PASS

---

## Freeze Contract

PASS

---

## Dialog200

无回归。

---

## Industry Cases

通过。

---

# 11. Semantic Acceptance

必须区分：

## Level 1

可召回

Recall Hit

---

## Level 2

可批准

Assembly Selected

KenLM Approved

---

## Level 3

可写回

Apply Success

---

禁止：

将：

```text
已入库
=
已写回
```

视为通过。

---

# 12. Architecture Compliance Criteria

验证：

* Framework Frozen
* Contract Frozen
* Runtime Frozen
* Patch Frozen
* Domain Contract Frozen
* Alias Contract Frozen

---

验证：

新增词条真实参与：

Recall
→ Domain Vote
→ Ranking
→ Assembly
→ Apply

链路。

---

必须进行：

Counterfactual Verification

证明：

功能生效

而非仅存在。

---

# 13. KEEP / MODIFY / RESTORE / DELETE

## KEEP

* Patch V4
* Multi Domain Append
* Alias Ownership
* Runtime Reload
* Framework Freeze
* Domain Boost = 0
* KenLM Gate
* Fine Domain Winner Rule

---

## MODIFY

* Industry Expansion Documentation
* V4 Builder
* Diagnostics
* Regression Set
* Industry Case Set

---

## RESTORE

无

---

## DELETE

* V3 Patch Apply
* Legacy Import
* 同音混淆集方案
* 非注册 Domain 引用

---

# Final Verdict

Industry Expansion Pack V1

CONDITIONAL READY

Framework Change Required: NO

Schema Change Required: NO

Runtime Change Required: NO

Patch Change Required: NO

Blockers:

* Domain Registry Alignment
* V4 Builder Alignment
* Industry Case Set Definition

Next Phase:

Industry Expansion Source Package Generation
→ Patch V4 Build
→ Import Validation
→ Runtime Validation
→ Industry Expansion Deployment
