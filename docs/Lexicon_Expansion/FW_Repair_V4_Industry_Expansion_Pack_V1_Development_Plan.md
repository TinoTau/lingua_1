# FW_Repair_V4_Industry_Expansion_Pack_V1_Development_Plan

## Document Status

* Type: Development Plan
* Phase: Lexicon Expansion
* Framework Status: Frozen
* Contract Status: Frozen
* Architecture Compliance Baseline: PASS
* Source Audit: FW_Repair_V4_Industry_Expansion_Pack_V1_PreDev_Audit_2026_06_25

---

# 1. Objective

构建 Industry Expansion Pack V1。

目标：

* 扩充约 2000 个合法行业词条
* 提升多行业真实对话场景下的 Recall 覆盖率
* 不修改 FW Repair V4 架构
* 不修改 SQLite Schema
* 不修改 Runtime
* 不修改 Ranking
* 不修改 Domain Vote
* 不修改 KenLM
* 不修改 Apply Gate

本轮仅允许：

* JSONL 数据建设
* Patch V4 构建
* Domain Tag 扩充

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
* Patch V4 Contract
* Runtime Loader
* Alias Ownership Contract

---

## 2.3 Domain Contract

Domain Tag 仅用于：

* Domain Vote
* Domain Filter
* Statistics
* Operations

禁止：

* Domain Recall Boost

当前冻结：

domainBoost = 0

---

## 2.4 Alias Contract

禁止：

* 同音字混淆集
* ASR错误词表
* 拼音替换表

允许：

* 品牌别名
* 英文缩写
* 官方简称

必须符合 Alias Ownership Contract。

---

# 3. Development Scope

## In Scope

### 新增行业词条

目标：

1800~3000 个词条

建议首批：

2000 ± 20%

---

### 新增 Domain Tags

允许：

appendDomainTags

禁止：

replaceDomainTags

---

### JSONL 更新

允许：

entries.jsonl

新增或维护。

---

### Patch V4

允许：

* addTerm
* appendDomainTags
* addLegalAlias

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

每个词条必须满足：

## 必填字段

```json
{
  "word": "",
  "pinyin": "",
  "tone_pinyin": "",
  "domain_tags": [],
  "repair_target": true
}
```

---

## 词条要求

必须：

* 真实中文词
* 合法拼音
* 合法声调
* 合法 Domain
* 非 Alias
* 非 ASR 错误词

---

禁止：

* 业务短语
* 营销文案
* 句子片段
* Prompt 模板

---

# 5. Industry Expansion Strategy

## Wave 1

500词

重点：

* tech_ai
* tourism

---

## Wave 2

500词

重点：

* medical
* transport
* meeting

---

## Wave 3

500词

重点：

* restaurant
* bakery
* coffee

---

## Wave 4

500词

重点：

* retail
* logistics
* mixed domains

---

# 6. Data Structure Example

```json
{
  "word": "智能体",
  "pinyin": "zhi neng ti",
  "tone_pinyin": "zhi4 neng2 ti3",
  "domain_tags": [
    "tech_ai"
  ],
  "repair_target": true,
  "prior_score": 0.9,
  "source": "industry_pack_v1"
}
```

---

# 7. Diagnostics Example

## Import Diagnostics

```json
{
  "patchId": "industry-pack-v1-wave1",
  "operation": "addTerm",
  "word": "智能体",
  "result": "success"
}
```

---

## Recall Diagnostics

```json
{
  "word": "智能体",
  "recallHit": true,
  "domain": "tech_ai"
}
```

---

## Apply Diagnostics

```json
{
  "candidate": "智能体",
  "repairTarget": true,
  "approved": true
}
```

---

# 8. Target List

## P0

生成：

Industry Expansion Pack V1

约 2000 词。

---

## P1

生成：

JSONL Source Package

---

## P2

生成：

Patch V4 Package

---

## P3

完成：

Domain Tag Mapping

---

# 9. Check List

开发完成后确认：

* JSONL 格式正确
* Patch V4 校验通过
* Domain Tag 合法
* repair_target=true
* 无非法 Alias
* 无业务短语
* 无 ASR 错误词

---

# 10. Regression List

必须执行：

* freeze-contract.test.ts
* Dialog200 Spot Test
* Patch Build Gate
* Runtime Gate

---

# 11. Acceptance Criteria

必须满足：

* Patch Validator PASS
* Runtime Gate PASS
* Source Sync PASS
* Dialog200 无回归
* Freeze Contract PASS

---

# 12. Architecture Compliance Criteria

验证：

Framework Frozen

Contract Frozen

Runtime Frozen

Patch Frozen

Domain Contract Frozen

Alias Contract Frozen

---

要求：

新增词条必须真实参与：

Recall
→ Domain Vote
→ Ranking
→ Assembly
→ Apply

链路。

禁止出现：

功能存在但不生效。

---

# 13. KEEP / MODIFY / RESTORE / DELETE

## KEEP

* Patch V4
* Multi Domain Tag
* Alias Ownership
* Runtime Reload
* Framework Freeze

---

## MODIFY

* Expansion Documentation
* Industry Source Package

---

## RESTORE

无

---

## DELETE

* Full Build 作为扩词主路径
* Legacy Import 流程
* 同音字混淆集建设方案

---

# Final Verdict

Industry Expansion Pack V1

READY FOR DEVELOPMENT

Framework Change Required: NO

Schema Change Required: NO

Runtime Change Required: NO

Patch Change Required: NO

Next Phase:

Industry Expansion Pack V1 Data Generation
