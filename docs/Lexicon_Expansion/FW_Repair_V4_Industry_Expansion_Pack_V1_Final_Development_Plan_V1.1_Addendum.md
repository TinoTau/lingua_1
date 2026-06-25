# FW_Repair_V4_Industry_Expansion_Pack_V1_Final_Development_Plan_V1.1_Addendum

## Document Status

* Type: Final Development Plan Addendum
* Status: Mandatory Supplement
* Priority: V1.1 Addendum > Final Development Plan
* Date: 2026-06-25
* Scope: Industry Expansion Pack V1
* Framework Change: Forbidden
* Runtime Change: Forbidden
* Schema Change: Forbidden

---

# 1. Purpose

本补充文档用于闭合 Industry Expansion Pack V1 Final Development Plan 中仍未明确的 P0/P1 实现约束。

本轮目标仍然是：

```text
JSONL Source
+
Patch V4
+
Domain Tag
+
Import Validation
+
Runtime Validation
```

不是 Framework 开发。

---

# 2. P0 Blocking Items

开发前必须闭合以下 P0：

## P0-01 DENY LIST SSOT 对齐

Final Plan 中禁止词必须与代码中的 `EXPANSION_DENY_LIST` 一致。

禁止在计划中写入代码不会拦截的伪 DENY 词。

当前必须完整引用代码 SSOT：

```text
EXPANSION_DENY_LIST
```

如果需要新增 DENY 词，必须单独提出 validator 变更，不得在本轮数据包中隐式扩展。

---

## P0-02 V4 Builder 必须交付

必须新增 Industry Pack V1 专用 Patch V4 构建脚本。

建议路径：

```text
scripts/lexicon/industry_pack_v1/build-patch-v4.mjs
```

该脚本必须输出：

```text
LexiconPatchV4
```

禁止复用旧：

```text
build-expansion-patches.mjs
```

作为 Industry Pack 主生成器，因为其输出仍属于 V3 形态。

---

## P0-03 正式导入必须使用 Electron Importer

正式导入命令必须使用：

```text
npm run lexicon:patch:import:electron -- <patch.json> --source-jsonl <entries.jsonl>
```

禁止使用：

```text
lexicon:patch:apply
apply-lexicon-patch-v3
import-v3-canonical-asset
```

作为 Industry Expansion Pack 主路径。

---

## P0-04 Runtime Gate FAIL 后禁止继续叠 Patch

如果任一 Wave 导入后：

```text
Runtime Gate FAIL
```

必须停止后续 patch。

禁止继续导入下一批。

必须先：

```text
定位失败
修复 patch
重新验证
或回滚
```

---

## P0-05 同音变体不得走 Alias

ASR 同音、近音、错听表面不得作为 alias。

例如：

```text
后选
生城
计化
借口
```

不得进入 alias。

如确实需要支持，只能作为：

```text
独立 JSONL word 行
```

并且必须满足：

```text
真实词
合法拼音
合法声调
合法 domain_tags
repair_target=true
```

禁止：

```text
ASR_HOMOPHONE alias
NEAR_PHONE alias
拼音混淆 alias
```

---

# 3. Domain Rules Revision

## 3.1 仅允许已注册 Domain

所有 `domain_tags` 必须存在于：

```text
profile-registry.json
```

否则 Patch Validator 必须失败。

---

## 3.2 禁止使用未注册 Domain

当前禁止直接使用：

```text
retail
logistics
```

除非先完成 Domain Registry 注册与冻结。

---

## 3.3 禁止粗域作为标签

禁止：

```text
tourism
restaurant
general
```

作为 Industry Pack 主标签。

必须使用细域：

```text
tourism_pickup
tourism_hotel
tourism_route
tourism_transport
coffee
milk_tea
food_order
bakery
tech_ai
medical
transport
meeting
```

---

## 3.4 Wave 修正

### Wave 1

```text
tech_ai
tourism_pickup
tourism_hotel
tourism_route
tourism_transport
```

### Wave 2

```text
medical
transport
meeting
```

### Wave 3

```text
coffee
milk_tea
food_order
bakery
```

### Wave 4

```text
跨域 append
长尾补充
retail/logistics 注册后再进入
```

---

# 4. JSONL Source Package Contract

必须新建：

```text
industry_pack_v1/
```

建议结构：

```text
industry_pack_v1/
  entries.jsonl
  package.manifest.json
  README.md
```

---

## 4.1 JSONL Entry Required Fields

```json
{
  "word": "智能体",
  "pinyin": "zhi neng ti",
  "tone_pinyin": "zhi4 neng2 ti3",
  "domain_tags": ["tech_ai"],
  "domain_weights": {
    "tech_ai": 1.0
  },
  "repair_target": true,
  "enabled": true,
  "prior_score": 0.85,
  "lexiconLayer": "domain_patch",
  "source": "industry_pack_v1"
}
```

---

## 4.2 Pinyin Format

JSONL：

```text
pinyin = 空格分隔
```

例如：

```text
zhi neng ti
```

SQLite / Patch 内部：

```text
pinyin_key = | 分隔
```

例如：

```text
zhi|neng|ti
```

构建脚本负责转换。

---

## 4.3 Domain Weights Rule

如果存在：

```text
domain_weights
```

则其 key 必须是：

```text
domain_tags
```

的子集。

禁止：

```json
{
  "domain_tags": ["tech_ai"],
  "domain_weights": {
    "medical": 1.0
  }
}
```

---

# 5. Patch V4 Contract

## 5.1 Patch Metadata

每个 patch 必须包含：

```json
{
  "patchId": "industry-pack-v1-wave1",
  "patchSchemaVersion": "lexicon-patch-v4",
  "baseVersion": 4,
  "nextVersion": 5,
  "hash": "sha256:...",
  "tableThresholds": {},
  "operations": []
}
```

---

## 5.2 Version Rule

```text
baseVersion = 当前 manifest.bundleVersion
nextVersion = baseVersion + 1
```

多 Wave 必须串行递增。

禁止并行生成多个相同 baseVersion 的 Patch。

---

## 5.3 Hash Rule

必须通过：

```text
npm run lexicon:compute-patch-hash:v4
```

生成 hash。

执行前必须先：

```text
npm run build:main
```

---

## 5.4 Threshold Rule

当：

```text
operations.length > 100
```

必须提供：

```text
tableThresholds
```

阈值必须基于当前 bundle table count + 本 patch 预计增量计算。

---

# 6. Operation Contract

## 6.1 addTerm

用于新增 `(word,pinyin_key)` 不存在的 canonical term。

必须显式写：

```json
{
  "op": "addTerm",
  "word": "智能体",
  "pinyin": "zhi neng ti",
  "tone_pinyin": "zhi4 neng2 ti3",
  "domain_tags": ["tech_ai"],
  "repair_target": true
}
```

如果 term 已存在：

```text
必须失败
```

不得自动 append。

---

## 6.2 appendDomainTags

用于已有词追加新领域。

```json
{
  "op": "appendDomainTags",
  "word": "模型",
  "domain_tags": ["tech_ai"]
}
```

如果存在多音或多 term：

```text
必须使用 term_id
```

---

## 6.3 addLegalAlias

只能用于合法 alias。

必须包含：

```text
alias
alias_type
```

合法 alias_type 仅允许：

```text
TRAD_SIMPLIFIED
EN_ZH_MAPPING
BRAND_PRODUCT
ENTITY_WRITING
STANDARD_ABBREV
```

---

## 6.4 禁止操作

默认禁止：

```text
replaceDomainTagsDangerous
```

禁止作为普通扩词工具使用。

---

# 7. Builder Responsibility

V4 Builder 必须负责：

1. 读取 `industry_pack_v1/entries.jsonl`
2. 校验字段完整性
3. 解析 pinyin / tone_pinyin
4. 判断 addTerm vs appendDomainTags
5. 生成 Patch V4
6. 写入 tableThresholds
7. 生成 patch hash
8. 输出 build report

---

# 8. Decision Path Constraints

新增词条必须能够进入以下链路：

```text
JSONL
↓
Patch V4
↓
SQLite term / term_domain_tags
↓
rematerialize
↓
domain_lexicon / term_pinyin_ngrams
↓
Runtime Reload
↓
Recall
↓
Domain Vote
↓
Domain Filter
↓
Assembly
↓
KenLM
↓
Apply Gate
↓
Writeback
```

必须明确：

```text
入库 ≠ 可召回
可召回 ≠ 被批准
被批准 ≠ 一定写回
```

---

# 9. Semantic Acceptance Levels

## Level 1 — Recall Hit

词条可以被 Recall 命中。

---

## Level 2 — Assembly Selected

候选进入 Assembly 并被选中。

---

## Level 3 — KenLM Approved

候选句通过 KenLM Δ Gate。

诊断字段必须使用：

```text
pickedIsRaw
maxDelta
minDeltaToReplace
```

---

## Level 4 — Writeback Applied

最终写回文本。

诊断字段必须区分：

```text
selected
approved
applied
```

禁止混用。

---

# 10. Counterfactual Verification

必须增加反事实验证。

至少包含：

## CF-01 repair_target=false

同一词条如果 `repair_target=false`，应能 Recall，但不得 Apply。

---

## CF-02 no runtime reload

Patch 写入但不 reload 时，运行时不得看到新词。

---

## CF-03 invalid domain

未注册 domain 应被 validator 拒绝。

---

## CF-04 append domain

已有词 append 新 domain 后，旧 domain 不得消失。

---

# 11. Regression Gate

必须执行：

## Build

```text
npm run build:main
```

---

## Patch Dry Run

```text
npm run lexicon:patch:import:electron -- <patch.json> --source-jsonl <entries.jsonl> --dry-run
```

---

## Formal Import

```text
npm run lexicon:patch:import:electron -- <patch.json> --source-jsonl <entries.jsonl>
```

---

## Patch V4 E2E

```text
npm run test:lexicon-patch-v4-e2e
```

---

## Runtime Gate

```text
npm run lexicon:gate:v3-runtime
```

---

## FW Detector Freeze

```text
npm run test:fw-detector
```

---

## Ranking Semantic

```text
node tests/run-fw-ranking-semantics-test.mjs
```

---

## Dialog200 Spot

必须执行扩词前后对比。

---

## Industry Case Manifest

必须新增：

```text
tests/industry-pack-v1-cases.manifest.json
```

用于行业词专项验收。

---

# 12. Industry Case Manifest Contract

每个 case 必须包含：

```json
{
  "id": "industry_v1_001",
  "domainScope": ["tech_ai"],
  "raw": "",
  "expectedRecallTerms": [],
  "expectedDomain": "tech_ai",
  "expectedBehavior": "recall_hit"
}
```

---

必须支持：

```text
recall_hit
assembly_selected
apply_expected
apply_not_required
```

---

# 13. Diagnostics Contract

## Import Report

必须包含：

```text
pre_gate_results
runtime_gate_results
source_sync
source_sync_diff
checksum_before
checksum_after
new_terms
appended_domains
collision_terms
table_counts_delta
```

---

## Runtime Diagnostics

必须包含：

```text
domainAvailability
bundleVersion
lastPatchId
checksum
```

---

## FW Diagnostics

必须区分：

```text
assemblySelected
kenlmApproved
writebackApplied
```

---

# 14. Architecture Compliance Criteria

必须验证：

* Framework 未修改
* Runtime 实现未修改
* Patch V4 Contract 未修改
* Schema 未修改
* Ranking 未修改
* KenLM 未修改
* Apply Gate 未修改

---

必须验证：

新增词条进入真实主链。

禁止：

```text
词条存在但 Runtime 不可见
Runtime 可见但 Recall 不命中
Recall 命中但 repair_target 丢失
Assembly 选中但诊断误读
```

---

# 15. KEEP / MODIFY / RESTORE / DELETE

## KEEP

* Framework Freeze
* Patch V4
* Runtime Reload
* Multi Domain Append
* Alias Ownership
* domainBoost = 0
* KenLM Gate
* Fine Domain Rule

---

## MODIFY

* Final Development Plan
* DENY LIST Documentation
* Wave Domain List
* V4 Builder
* industry_pack_v1 Asset Layout
* Industry Case Manifest
* Diagnostics Examples
* Acceptance Criteria

---

## RESTORE

无。

---

## DELETE

* V3 Patch Apply 主路径
* Legacy Import 主路径
* build-expansion-patches.mjs 作为 Industry Pack 模板
* 单独依赖 patch-build-gate 作为 V4 全量门禁
* 未注册 domain 引用
* 同音混淆 alias 方案

---

# 16. Updated Target List

## P0

* 对齐 DENY LIST SSOT
* 新增 Industry V4 Builder
* 明确 Formal Import 命令
* 增加 Runtime Gate FAIL Stop Rule
* 明确 Homophone Independent Word Rule

---

## P1

* 创建 `industry_pack_v1/`
* 新增 Industry Case Manifest
* 完整 Patch V4 Metadata 示例
* `tableThresholds` 计算说明
* `build:main` 前置
* Source Sync 单向规则
* Fine Domain Tag 规则

---

## P2

* Context Prior 边界说明
* capFineDomains(12) 说明
* Dialog200 Spot 范围
* PatchId 运维说明

---

# 17. Updated Check List

开发前：

* [ ] DENY LIST 与代码一致
* [ ] domain_id 全部已注册
* [ ] 无 coarse domain tag
* [ ] 无非法 alias
* [ ] 无业务短语
* [ ] 无 ASR 错误词
* [ ] JSONL 路径已确定
* [ ] V4 Builder 已完成
* [ ] Industry Case Manifest 已定义

---

导入前：

* [ ] build:main PASS
* [ ] Patch V4 hash 已生成
* [ ] tableThresholds 已设置
* [ ] dry-run PASS
* [ ] source-jsonl 已传入
* [ ] append semantics PASS
* [ ] alias legality PASS
* [ ] granularity PASS

---

导入后：

* [ ] Runtime Gate PASS
* [ ] Source Sync PASS
* [ ] Manifest bundleVersion +1
* [ ] domainAvailability 更新
* [ ] Dialog200 无回归
* [ ] Industry Case PASS
* [ ] Frozen Architecture Verification PASS

---

# Final Recommendation

Final Development Plan 维持：

```text
CONDITIONAL READY
```

允许并行启动：

```text
JSONL 草稿生成
```

但在以下事项闭合前禁止正式导入：

1. DENY LIST SSOT 对齐
2. Industry V4 Builder 完成
3. `industry_pack_v1/` 目录完成
4. Industry Case Manifest 完成
5. Formal Import / Runtime Gate / Source Sync 验收链闭合

---

# Final Verdict

Industry Expansion Pack V1:

```text
CONDITIONAL READY
```

Framework Change Required:

```text
NO
```

Schema Change Required:

```text
NO
```

Runtime Implementation Change Required:

```text
NO
```

Patch V4 Contract Change Required:

```text
NO
```

Required Before Deployment:

```text
V4 Builder
DENY SSOT
Industry Case Manifest
Formal Import Gate
```
