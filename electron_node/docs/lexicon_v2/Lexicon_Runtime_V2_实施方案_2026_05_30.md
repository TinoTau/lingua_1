# Lexicon Runtime V2 技术实施方案（冻结主链版）

版本：V1.0
日期：2026-05-30

**补充文档（实施前必读）：** [Lexicon_Runtime_V2_实施方案_补充约束清单_2026_05_30.md](./Lexicon_Runtime_V2_实施方案_补充约束清单_2026_05_30.md)

## 一、项目目标

在不改变已经冻结的主链：

ASR
→ FW_SPAN_DETECTOR
→ AGGREGATION
→ DEDUP
→ TRANSLATION

的前提下，完成 Lexicon Runtime V2 升级。

核心目标：

1. 解决 V1 全量内存加载问题
2. 解决 general domain 死锁问题
3. 建立基础词库 / 成语库 / 专业词库分层体系
4. 建立 Session Intent SSOT
5. 建立行业路由能力
6. 保持 KenLM weak_veto 不变
7. 保持 FW 决策链不变

---

# 二、架构设计

## V1

canonical_term JSONL
→ build
→ lexicon_terms
→ 全量加载
→ pinyinIndex
→ recall

问题：

- 单表
- 无 pinyin_key
- 无行业隔离
- 无 Session Intent
- 内存无上限

---

## V2

base_lexicon
idiom_lexicon
domain_lexicon
industry_routing_lexicon

SessionIntent
↓
industry routing
↓
base recall
+
domain recall
↓
merge
↓
KenLM weak_veto
↓
pick

---

# 三、数据库结构

## base_lexicon

用途：

- 2字词
- 3字词

禁止：

- 1字词
- 普通4字词
- 5字以上短语
- 专业词

```sql
CREATE TABLE base_lexicon (
  pinyin_key TEXT NOT NULL,
  word TEXT NOT NULL,
  prior_score REAL NOT NULL,
  repair_target INTEGER NOT NULL,
  enabled INTEGER NOT NULL,
  aliases TEXT,
  source TEXT,
  PRIMARY KEY (pinyin_key, word)
);
```

索引：

```sql
CREATE INDEX idx_base_pinyin
ON base_lexicon(pinyin_key);
```

---

## idiom_lexicon

用途：

- 成语
- 固定熟语

```sql
CREATE TABLE idiom_lexicon (
  pinyin_key TEXT NOT NULL,
  word TEXT NOT NULL,
  prior_score REAL NOT NULL,
  enabled INTEGER NOT NULL,
  PRIMARY KEY (pinyin_key, word)
);
```

---

## domain_lexicon

用途：

- 行业词
- 专业词
- 品牌
- 产品
- 地名

```sql
CREATE TABLE domain_lexicon (
  domain_id TEXT NOT NULL,
  pinyin_key TEXT NOT NULL,
  word TEXT NOT NULL,
  prior_score REAL NOT NULL,
  repair_target INTEGER NOT NULL,
  aliases TEXT,
  enabled INTEGER NOT NULL,
  PRIMARY KEY(domain_id, word)
);
```

索引：

```sql
CREATE INDEX idx_domain_pinyin
ON domain_lexicon(domain_id, pinyin_key);
```

---

## industry_routing_lexicon

```sql
CREATE TABLE industry_routing_lexicon (
  pinyin_key TEXT NOT NULL,
  keyword TEXT NOT NULL,
  domain_id TEXT NOT NULL,
  weight REAL NOT NULL
);
```

---

# 四、Session Intent SSOT

新增：

```ts
export type LexiconSessionIntent = {
  summary: string;

  topicKeywords: string[];

  topicKeywordPinyinKeys: string[];

  primaryDomain: string;

  secondaryDomains: string[];

  confidence: number;

  updatedAt: number;

  effectiveFromTurn: number;

  source:
    | "cpu_llm"
    | "manual"
    | "fallback_anchor";

  reason: string[];
};
```

写入位置：

```ts
SessionObject.lexiconSessionIntent
```

读取位置：

```ts
JobContext.lexiconSessionIntent
```

注意：

CPU LLM 只负责：

- summary
- topicKeywords
- primaryDomain

绝不参与词条选择。

---

# 五、Runtime V2 接口

```ts
interface LexiconRuntimeV2 {

  lookupBaseByPinyinKey(
    key: string,
    termLength: number,
    topK: number
  ): HotwordEntry[];

  lookupDomainByPinyinKey(
    domainId: string,
    key: string,
    termLength: number,
    topK: number
  ): HotwordEntry[];

  lookupIdiomByPinyinKey(
    key: string,
    termLength: number,
    topK: number
  ): HotwordEntry[];

  lookupIndustryRoutes(
    pinyinKeys: string[]
  ): IndustryRouteHit[];
}
```

---

# 六、Recall 逻辑

## V1

```text
span
→ pinyin bucket
→ score
→ KenLM
→ pick
```

---

## V2

```text
span
→ pinyin_key

→ base lookup

→ domain lookup

→ idiom lookup

→ merge

→ dedupe

→ score

→ KenLM weak_veto

→ pick
```

KenLM 不改。

---

# 七、Build Pipeline

## 输入

```text
base_zh_v1/
idiom_zh_v1/
domain_zh_v1/
industry_routing_v1/
```

---

## 输出

```text
manifest_v2.json

lexicon_v2.sqlite

checksum.txt

stats_v2.json
```

---

# 八、代码逻辑

## Phase 0

新增：

```text
build-v2-shadow-bundle.mjs

v2-classify-row.mjs

v2-shadow-stats.mjs
```

目标：

只生成 V2 Bundle。

不替换 Runtime。

---

## Phase 1

新增：

```text
lexicon-runtime-v2.ts

lexicon-runtime-v2-holder.ts
```

支持：

SQL 查询

LRU Cache

Feature Flag

---

## Phase 2

新增：

```text
LexiconSessionIntent
```

扩展：

```json
{
  "topicKeywords": [
    "咖啡",
    "中杯",
    "拿铁"
  ]
}
```

---

## Phase 3

改造：

```text
local-span-recall.ts
```

替换：

```text
lookupTopKByPinyin
```

为：

```text
lookupBase
+
lookupDomain
```

FW 主链顺序保持不变。

---

## Phase 4

启用：

```text
industry_routing_lexicon
```

实现：

topicKeywords
→ domain

---

# 九、Target List

## P0

- V2 Shadow Build
- V2 Validate
- V2 Stats
- 四表 Schema
- 不替换 Runtime

## P1

- LexiconRuntimeV2
- SQL 查询
- LRU Cache
- Memory Benchmark

## P2

- LexiconSessionIntent
- topicKeywords
- diagnostics

## P3

- base recall
- domain recall
- merge
- dialog_200 回归

## P4

- industry routing
- domain routing
- fallback 策略

---

# 十、Check List

## 架构

- [ ] 不修改 ASR→FW→AGG→DEDUP→TRANSLATION
- [ ] 不修改 segmentForJobResult
- [ ] 不修改 KenLM weak_veto
- [ ] 不恢复 Recover

## 数据

- [ ] base 只允许 2/3 字
- [ ] idiom 独立
- [ ] domain 独立
- [ ] industry routing 独立
- [ ] pinyin_key 使用统一规则

## Runtime

- [ ] V1 默认保持
- [ ] V2 Feature Flag
- [ ] SQL 查询通过
- [ ] LRU 生效

## Session

- [ ] topicKeywords 写入
- [ ] topicKeywordPinyinKeys 生成
- [ ] primaryDomain 生效

## 测试

- [ ] Build Test
- [ ] Runtime Test
- [ ] Session Test
- [ ] dialog_200
- [ ] Memory Benchmark
- [ ] Recall P95 Benchmark
- [ ] No Degradation

---

# 十一、冻结边界

禁止修改：

- suspicious-span-detector-v1.ts
- applyFwSpanReplacements
- segmentForJobResult
- kenlm-span-gate.ts
- legacy/recover/*
- FW 主链步骤顺序

允许修改：

- Runtime V2
- Shadow Build
- Session Intent
- local-span-recall（Phase 3）
- Industry Routing

---

# 十二、最终结论

建议立即启动：

Phase 0

原因：

- 不影响主链
- 不替换 Runtime
- 风险最低
- 可验证四表架构

待 Shadow Build 稳定后进入：

Phase 1 → Phase 2 → Phase 3 → Phase 4
