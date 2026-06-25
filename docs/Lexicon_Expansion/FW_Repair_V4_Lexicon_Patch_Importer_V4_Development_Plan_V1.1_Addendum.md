# FW_Repair_V4_Lexicon_Patch_Importer_V4_Development_Plan_V1.1_Addendum

Version: V1.1

Status: Development Ready

Type: Contract Addendum / Implementation Supplement

Date: 2026-06-24

Related Documents:

* FW_Repair_V4_Lexicon_Patch_Importer_V4_Development_Plan_V1.0
* FW_Repair_V4_Multi_Domain_Tag_Append_Audit
* FW_Repair_V4_Lexicon_Source_Format_And_Patch_Importer_V4_Audit

---

# 1. Purpose

本补充文档用于修正和冻结主开发计划中尚未明确的行为。

重点补充：

* Patch Envelope Contract
* AddTerm Collision Contract
* Multi-Domain Weight Merge Contract
* Term Identity Contract
* Runtime Gate Integration Contract
* Source Sync Contract
* V3 → V4 Migration Contract
* Import Report Contract

本文档与主开发计划同时生效。

如发生冲突：

```text
本补充文档优先。
```

---

# 2. Patch Envelope Contract

所有 V4 Patch 必须包含：

```json
{
  "patchId":"exp-v1_2-tech_ai-core",
  "patchSchemaVersion":"lexicon-patch-v4",
  "baseVersion":4,
  "nextVersion":5,
  "hash":"sha256:xxxx",
  "operations":[]
}
```

---

## Required Fields

| Field              | Required |
| ------------------ | -------- |
| patchId            | Yes      |
| patchSchemaVersion | Yes      |
| baseVersion        | Yes      |
| nextVersion        | Yes      |
| hash               | Yes      |
| operations         | Yes      |

---

## Version Rule

必须满足：

```text
baseVersion
=
manifest.bundleVersion
```

且：

```text
nextVersion
=
baseVersion + 1
```

否则：

```text
Patch Validation FAIL
```

---

## Hash Rule

Hash 必须基于：

```text
Canonical JSON
+
Operation Sort Key
```

生成。

禁止：

```text
人工修改 hash
```

---

# 3. AddTerm Collision Contract

新增：

```text
AddTerm Collision Policy
```

---

## Rule

当：

```text
addTerm
```

执行时。

如果：

```text
word 已存在
```

则：

```text
FAIL
```

---

禁止：

```text
自动转 appendDomainTags
```

禁止：

```text
静默覆盖
```

禁止：

```text
自动 merge
```

---

## Example

当前：

```text
预约
```

已存在。

执行：

```json
{
  "op":"addTerm",
  "word":"预约"
}
```

结果：

```text
FAIL

term_already_exists
```

开发者必须显式改为：

```json
{
  "op":"appendDomainTags",
  "word":"预约",
  "domain_tags":["tech_ai"]
}
```

---

# 4. Term Identity Contract

Patch 定位 Term 时。

允许：

```text
word
```

或：

```text
termId
```

---

## Priority

规则：

```text
termId
优先

word
次之
```

---

## Purpose

避免：

```text
同字不同词

同字不同拼音

同字不同来源
```

产生歧义。

---

## Example

```json
{
  "op":"appendDomainTags",
  "termId":"term-e4b8ade69daf7c7a",
  "domain_tags":["tech_ai"]
}
```

优先使用：

```text
termId
```

查找。

---

# 5. Multi Domain Weight Merge Contract

Append Domain 时。

禁止：

```text
覆盖已有权重
```

禁止：

```text
平均权重
```

禁止：

```text
累加权重
```

---

## Rule

采用：

```text
max(existing,incoming)
```

规则。

---

## Example

当前：

```text
预约

hotel=1.0
route=0.9
```

新增：

```text
tech_ai=0.6
```

结果：

```text
hotel=1.0
route=0.9
tech_ai=0.6
```

---

如果：

```text
tech_ai 已存在
```

且：

```text
existing=0.8

incoming=0.6
```

结果：

```text
0.8
```

---

# 6. Runtime Gate Integration Contract

Importer 不得只执行：

```text
Patch Apply
```

---

必须执行：

```text
Patch Apply
+
Runtime Gate
```

---

## Success Definition

仅当：

```text
Apply PASS

AND

Runtime Gate PASS
```

时。

Importer 返回：

```text
SUCCESS
```

---

否则：

```text
FAIL
```

---

## Mandatory Step

Importer 固定执行：

```text
lexicon:gate:v3-runtime
```

不得依赖人工执行。

---

# 7. Source Sync Contract

新增：

```text
JSONL ↔ SQLite
```

一致性验证。

---

## Requirement

Patch Apply 成功后。

必须确认：

```text
Source

Patch

SQLite
```

保持一致。

---

## Full Rebuild Rule

执行：

```text
JSONL
↓
Build
↓
SQLite
```

后。

不得出现：

```text
Domain Missing

Alias Missing

Term Missing
```

---

否则：

```text
FAIL
```

---

# 8. Import Report Contract

Importer 必须生成 Report。

---

## Required Fields

```json
{
  "patch_id":"",
  "patch_schema_version":"",

  "base_version":0,
  "next_version":0,

  "new_terms":0,
  "appended_domains":0,

  "new_aliases":0,
  "removed_aliases":0,

  "collisions":0,

  "dangerous_ops":0,

  "checksum_before":"",
  "checksum_after":"",

  "runtime_reload":"",

  "duration_ms":0
}
```

---

## Additional Fields

```json
{
  "gate_results":[],
  "rematerialized_term_ids":[],
  "append_domain_tags":[],
  "table_counts_delta":{}
}
```

---

# 9. V3 → V4 Migration Contract

V3 Patch：

```text
继续支持
但不再新增
```

---

V4 Patch：

```text
唯一开发标准
```

---

## Forbidden

禁止继续生成：

```text
update + domainTags
```

语义。

---

必须改为：

```text
appendDomainTags
```

或：

```text
replaceDomainTagsDangerous
```

---

# 10. E2E Acceptance Contract

新增：

```text
Patch N
```

作为 Append Domain E2E。

---

## Scenario

当前：

```text
预约

tourism_hotel
tourism_route
```

---

Patch：

```text
appendDomainTags

tech_ai
```

---

验证：

```text
tourism_hotel

tourism_route

tech_ai
```

同时存在。

---

## Failure Condition

出现：

```text
仅剩 tech_ai
```

则：

```text
FAIL
```

---

# 11. Updated P0 Scope

在主开发计划基础上。

新增：

```text
Patch Envelope

AddTerm Collision Policy

Term Identity Contract

Weight Merge Contract

Runtime Gate Integration

Source Sync Check

Append E2E
```

全部进入：

```text
P0
```

---

# 12. Updated Acceptance Criteria

开发完成后。

必须满足：

```text
新增领域不覆盖旧领域

Patch Apply 自动执行 Runtime Gate

Import Report 自动生成

Full Rebuild 无 Domain Drift

Append E2E PASS

Multi Domain Contract PASS

Alias Ownership Contract PASS

Tech_AI 500 可安全导入

Medical 500 可安全导入
```

---

# Final Recommendation

完成本补充文档定义的全部 P0 内容后：

冻结：

```text
Lexicon_Source_Format_Contract_V1_0

Patch_V4_Operation_Contract_V1_0

Multi_Domain_Tag_Append_Contract_V1_0

Lexicon_Patch_Importer_V4_Runbook
```

然后再进入：

```text
Tech_AI 500+

Medical 500+

Travel 1000+

Restaurant 1000+
```

真实世界领域词库建设阶段。
