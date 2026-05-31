# Lexicon Runtime V2 实施方案（补充约束整合版）

版本：V1.1
日期：2026-05-30

本文件是在《Lexicon Runtime V2 实施方案》基础上，结合开发前代码审计与补充约束清单形成的实施版文档。

## 核心结论

允许立即启动：
- Phase 0 Shadow Build

禁止立即启动：
- Phase 3 Recall 切换
- Phase 4 Industry Routing

原因：
- 当前仍有 alias、idiom、latin、domain routing、feature flag 等决策未闭合。
- FW 主链已冻结，Phase 3 开始涉及行为变化，必须走 freeze 例外流程。

---

# 一、最终架构

ASR
→ FW_SPAN_DETECTOR
→ AGGREGATION
→ DEDUP
→ TRANSLATION

保持不变。

业务文本 SSOT：

ctx.segmentForJobResult

保持不变。

KenLM：

weak_veto

保持不变。

---

# 二、V2 数据层

## base_lexicon

仅允许：

- 2字词
- 3字词

禁止：

- 1字词
- 普通4字词
- 5字以上短语
- 专业词

新增字段：

- id
- normalized

索引：

- pinyin_key

---

## idiom_lexicon

仅允许：

- 4字成语
- 固定熟语

必须包含：

- repair_target

否则无法通过 FW pick 门控。

---

## domain_lexicon

仅允许：

- 行业词
- 专业词
- 品牌
- 产品
- 地名

强制约束：

domain_id 不能为 general。

索引：

(domain_id, pinyin_key)

---

## industry_routing_lexicon

用途：

topicKeywords
→ domain

新增约束：

PRIMARY KEY
(pinyin_key, keyword, domain_id)

避免重复路由。

---

# 三、Pinyin Key 统一规范

唯一 SSOT：

main/src/lexicon/pinyin-index.ts

规则：

syllables
→ normalize
→ join("|")

示例：

zhong|bei

禁止：

- LLM 输出 pinyin
- 多套 pinyin_key 规则

---

# 四、Alias 策略

审计结论：

推荐 Build 阶段物化。

原因：

- Runtime 查询最快
- 行为稳定
- 避免二次展开

最终方案：

alias
→ build
→ alias row

而不是 runtime 动态展开。

---

# 五、Latin Token 策略

Phase 3 前：

继续走 V1 exactIndex。

不进入 V2。

后续单独立项。

---

# 六、Recall 路由表

2~3字：

base_lexicon

4字成语：

idiom_lexicon

2~5字专业词：

domain_lexicon

最终：

base
+ idiom
+ domain

merge

dedupe

KenLM

pick

---

# 七、Domain 策略

V1 问题：

general
→ hard reject

导致 P1.3 包无法使用。

V2 规则：

base 不带 domain

idiom 不带 domain

domain_lexicon 必须带 domain_id

Session Intent：

负责路由。

enabledDomains：

负责安全裁剪。

---

# 八、Feature Flags

Phase 1

features.lexiconRuntimeV2.enabled

features.lexiconRuntimeV2.bundlePath

features.lexiconRuntimeV2.lruBucketCacheSize

Phase 2

features.lexiconV2.enabled

features.lexiconV2.sessionIntentWriteEnabled

Phase 3

features.fwDetector.useLexiconRuntimeV2Recall

Phase 4

features.fwDetector.useIndustryRouting

默认全部 false。

---

# 九、Session Intent SSOT

新增：

LexiconSessionIntent

字段：

- summary
- topicKeywords
- topicKeywordPinyinKeys
- primaryDomain
- secondaryDomains
- confidence

新增约束：

topicKeywordPinyinKeys
必须由 Node 计算。

禁止 LLM 输出。

Profile 切换门限：

confidence >= 0.75

与现有 activeLexiconProfile 保持一致。

Phase 2 期间：

lexiconIntentSummary
与
lexiconSessionIntent

双写。

---

# 十、Phase 0 实施内容

新增：

build-lexicon-v2-shadow.mjs

build-v2-shadow-bundle.mjs

v2-classify-row.mjs

v2-shadow-stats.mjs

输出：

manifest_v2.json

lexicon_v2.sqlite

checksum.txt

stats_v2.json

rejected_v2.jsonl

目录：

node_runtime/lexicon/v2_shadow

禁止覆盖：

node_runtime/lexicon/current

---

# 十一、Phase 1 实施内容

新增：

LexiconRuntimeV2

LexiconRuntimeV2Holder

支持：

- SQL Query
- Prepared Statement
- LRU Cache

仍不接入 FW。

---

# 十二、Phase 2 实施内容

新增：

LexiconSessionIntent

扩展：

prompt_templates.py

lexicon-profile-decision-parser.ts

session-finalize.ts

turn-profile-binding.ts

目标：

仅写 Session。

不参与 Recall。

---

# 十三、Phase 3 实施内容

唯一允许改造点：

local-span-recall.ts

禁止修改：

fw-topk-decision-pipeline.ts

KenLM 调用顺序

Pick 逻辑

Greedy 逻辑

新增：

LocalSpanRecallHit V2 映射层

要求：

输出契约与 V1 完全一致。

验收：

dialog_200

200/200 PASS

---

# 十四、Phase 4 实施内容

启用：

industry_routing_lexicon

路径：

topicKeywords
→ pinyin_key
→ routing
→ domain

Fallback：

LLM
→ routing
→ domain_anchor
→ enabledDomains

---

# 十五、Target List

P0

- Shadow Build
- 四表 Schema
- stats_v2
- rejected_v2

P1

- RuntimeV2
- SQL
- LRU

P2

- SessionIntent
- topicKeywords

P3

- RecallV2
- Merge
- Dialog200

P4

- Industry Routing
- Domain Routing

---

# 十六、Check List

架构

[ ] 主链不变
[ ] segmentForJobResult 不变
[ ] KenLM 不变
[ ] Recover 不回流

数据

[ ] base 仅 2/3 字
[ ] idiom 独立
[ ] domain 独立
[ ] 无 general 专业词

Runtime

[ ] V1 默认
[ ] V2 Flag
[ ] SQL 可回滚

Session

[ ] topicKeywords
[ ] pinyinKeys
[ ] primaryDomain

Recall

[ ] LocalSpanRecallHit 不变
[ ] dialog_200 PASS
[ ] 无劣化

Build

[ ] manifest_v2
[ ] checksum
[ ] stats_v2
[ ] rejected_v2

---

# 十七、最终决策

当前最安全路线：

Phase 0
→ Phase 1
→ Phase 2

暂停。

待：

- alias 策略确认
- idiom 策略确认
- common5 策略确认
- routing 策略确认

之后再进入：

Phase 3 Recall 切换。
