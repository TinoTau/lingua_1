# FW_Repair_V4_Lexicon_Patch_Importer_V4_Development_Plan_V1.2_Addendum

Version: V1.2

Status: Mandatory Supplement

Date: 2026-06-24

Purpose:

解决 V1.1 Addendum 与实际代码实现之间剩余的契约缺口。

本文件优先级：

V1.2 Addendum

>

V1.1 Addendum

>

V1.0 Development Plan

---

# 1. Collision Identity Contract Revision

修订：

V1.1 中：

```text
word 已存在 → FAIL
```

定义不够精确。

---

## Frozen Rule

碰撞键定义为：

```text
(termId)

OR

(word,pinyin_key)
```

---

## C-01

如果：

```text
termId 已存在
```

结果：

```text
FAIL

term_already_exists
```

---

## C-02

如果：

```text
(word,pinyin_key)
```

已存在。

结果：

```text
FAIL

term_already_exists
```

---

## C-03

禁止：

仅依据：

```text
word
```

判定碰撞。

---

## Example

允许：

```text
长乐 chang2 le4

长乐 zhang3 le4
```

理论共存。

---

# 2. Term Resolution Contract Revision

Patch 引用 term 时：

推荐：

```text
term_id
```

---

允许：

```text
word
```

但：

必须满足：

```text
查询结果唯一
```

---

## R-01

word

0 行

结果：

```text
FAIL

term_not_found
```

---

## R-02

word

多行

结果：

```text
FAIL

ambiguous_term_word
```

---

## R-03

term_id

永远优先。

---

# 3. Weight Merge Contract Revision

V1.1:

```text
max(existing,incoming)
```

冻结。

---

V1.0:

```text
INSERT OR IGNORE
```

废弃。

---

## Frozen SQL

推荐：

```sql
INSERT INTO term_domain_tags (...)

ON CONFLICT(term_id,domain_id)

DO UPDATE

SET weight =
MAX(weight, excluded.weight);
```

---

禁止：

```text
INSERT OR IGNORE
```

作为 appendDomainTags 的最终实现。

---

# 4. Runtime Gate Atomicity Contract

Importer Success：

必须满足：

```text
Pre Gate PASS

AND

Apply PASS

AND

Runtime Gate PASS
```

---

## G-01

新增：

Pre Gate

必须包含：

```text
scan-patch-granularity

scan-alias-legality

validate append semantics
```

---

## G-02

Runtime Gate FAIL

Importer 返回：

```text
FAIL
```

并生成 Report。

---

## G-03

必须提供：

Recovery Runbook

定义：

```text
如何恢复上一 Bundle
```

---

# 5. Source Sync Contract Revision

Source Sync

升级为：

P0。

---

## SS-01

Importer 支持：

```text
--source-jsonl
```

参数。

---

## SS-02

Patch Apply 后。

验证：

```text
JSONL.domain_tags

⊆

SQLite.term_domain_tags
```

---

## SS-03

输出：

```text
source_sync

source_sync_diff
```

---

## SS-04

禁止：

```text
Patch Only

不更新 JSONL
```

---

Builder 必须：

```text
dual write
```

---

# 6. Import Report Revision

新增字段：

```json
{
  "status":"success",
  "error_code":"",
  "patch_path":"",
  "bundle_dir":"",
  "source_sync":"pass",
  "source_sync_diff":[],
  "pre_gate_results":[],
  "runtime_gate_results":[],
  "collision_terms":[]
}
```

---

失败场景：

仍必须输出 Report。

---

# 7. Patch V4 Hash Contract

新增：

```text
operationSortKeyV4
```

---

排序键：

```text
op

word

term_id

pinyin_key

domain_id

alias
```

---

Hash：

必须：

顺序无关。

---

# 8. Additional V4 Operations

新增：

```text
removeDomainTag

enableTerm

updateDomainWeights

updateTermFields

deleteTerm
```

---

约束：

```text
updateTermFields

不得修改：

domain_tags
```

---

# 9. Importer CLI Contract Revision

完整执行顺序：

```text
1 build

2 verify hash

3 validate schema

4 pre gate

5 validate append

6 apply patch

7 runtime gate

8 source sync

9 write report
```

---

Importer 成功定义：

```text
全部 PASS
```

---

# 10. E2E Contract Expansion

除：

Patch N

外。

新增：

```text
Patch N+1

Patch N+2

Patch N+3

Patch N+4
```

验证：

* append
* collision
* weight merge
* legacy compatibility

---

# 11. Threshold Contract

新增：

```text
Threshold Review
```

作为：

Tech_AI 500

Medical 500

前置条件。

---

禁止：

使用旧：

```text
V3_TABLE_THRESHOLDS_V2
```

直接导入 500+ 词。

---

# 12. Updated P0 Scope

新增进入 P0：

```text
Collision Key Contract

Term Resolution Contract

Weight Merge SQL

Runtime Gate Atomicity

Source Sync Algorithm

Hash Sort Key

Importer Report Schema

Threshold Review
```

---

# Final Recommendation

完成 V1.2 Addendum 后：

冻结：

Patch_V4_Operation_Contract_V1_0

Lexicon_Patch_Importer_V4_Runbook

然后启动：

Tech_AI 500

Medical 500

领域词库建设。
