# 词库 Runtime V2 + Session Intent SSOT 技术方案

版本：V1.0  
日期：2026-05-30  
适用项目：Lingua_1 / electron-node / FW Detector 主链  
状态：技术方案草案  
依据文档：  
- `词库分表拼音主键架构_现状与目标_决策报告_2026_05_30.md`
- `词库架构_Session意图与行业词库_只读审计报告_2026_05_30.md`
- `P1_3_Base_Lexicon_只读审计报告_2026_05_30.md`
- `Lexicon_Runtime_V2_开发前只读代码审计报告_2026_05_30.md`（**开发前代码边界审计 SSOT**）

---

# 1. 执行摘要

当前词库 Runtime 的核心问题不是 FW 主链，而是词库 Runtime 的数据组织方式已经不适合继续扩展：

```text
当前：
canonical_term JSONL
→ lexicon:build
→ 单一 lexicon.sqlite
→ 启动时全表读入内存
→ 内存 Map<pinyinKey, entries[]>
→ FW recall
```

该结构在 7 万级词库下还能运行，但随着基础词库、成语库、行业词库、专业词库持续扩张，存在明显问题：

1. 启动全量加载，内存随词条线性增长；
2. `domains` 只是标签，不是分库键；
3. SQLite 只作为 bundle 容器，没有发挥拼音主键索引能力；
4. Session 意图与行业词库尚未接通；
5. CPU LLM Intent 只输出 summary / domain profile，不输出结构化 topicKeywords；
6. FW recall 仍然从统一 bucket 过滤，而不是基础词表 + 专业词表双路查询。

目标架构：

```text
Session Intent SSOT
→ 行业/专业域判定
→ base_lexicon 按 pinyin_key 查
→ domain_lexicon 按 domain_id + pinyin_key 查
→ 合并候选
→ KenLM weak_veto
→ apply
```

核心原则：

```text
不改 ASR→FW→Aggregation→Dedup→Translation 主链顺序
只改词库 Runtime / Recall 内核 / Session 意图字段
```

---

# 2. 现状架构

## 2.1 当前 build 链路

```text
canonical_term JSONL
  → npm run lexicon:validate
  → npm run lexicon:build
  → node_runtime/lexicon/current/
       manifest.json
       lexicon.sqlite
       checksum.txt
```

当前 seed 可在构建阶段分层：

```text
base
idiom
domain_patch
```

但 merge 后全部进入同一张表：

```sql
lexicon_terms
```

---

## 2.2 当前 SQLite 表

```sql
CREATE TABLE lexicon_terms (
  id TEXT PRIMARY KEY,
  word TEXT NOT NULL,
  pinyin TEXT NOT NULL,
  domains TEXT,
  prior_score REAL,
  repair_target INTEGER,
  enabled INTEGER
);
```

问题：

```text
无 pinyin_key 主键
无 base/domain 分表
无 (domain_id, pinyin_key) 索引
无 industry routing 表
```

---

## 2.3 当前 Runtime

```text
LexiconRuntime.load()
  → SELECT * FROM lexicon_terms
  → buildHotwordPinyinIndex()
  → buildExactWordIndex()
  → buildAliasIndexes()
  → recall 时只查内存 Map
```

优点：

```text
热路径快
span recall 不扫全库
```

缺点：

```text
启动全量加载
百万级词库无内存上界
专业词库越多，bucket 越污染
```

---

## 2.4 当前 FW Recall

```text
span text
  → pinyin_key
  → getPinyinBucket(pinyin_key)
  → minPrior filter
  → domain filter
  → domainBoost
  → KenLM weak_veto
  → pick
```

当前 domain 机制：

```text
domains 字段 = 标签
enabledDomains = 硬白名单
ActiveLexiconProfile = 加分
```

它不是：

```text
Session 意图
→ 行业表
→ 专业词库
```

---

# 3. 改造目标

## 3.1 数据结构目标

### base_lexicon

基础词表。

```sql
CREATE TABLE base_lexicon (
  pinyin_key TEXT NOT NULL,
  word TEXT NOT NULL,
  prior_score REAL NOT NULL,
  repair_target INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  source TEXT,
  tags TEXT,
  PRIMARY KEY (pinyin_key, word)
);

CREATE INDEX idx_base_lexicon_pinyin
ON base_lexicon(pinyin_key);
```

用途：

```text
2/3 字基础现代汉语词
高频通用词
泛用 ASR 同音候选
```

禁止：

```text
1 字词
普通 4 字组合词
5 字以上普通短语
专业词
自由组合短语
```

---

### idiom_lexicon

成语 / 固定熟语表。

```sql
CREATE TABLE idiom_lexicon (
  pinyin_key TEXT NOT NULL,
  word TEXT NOT NULL,
  prior_score REAL NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  source TEXT,
  PRIMARY KEY (pinyin_key, word)
);
```

用途：

```text
4 字成语
固定熟语
```

不混入 base。

---

### domain_lexicon

专业词表。

建议优先采用单表 + domain_id 复合索引，而不是动态建大量表。

```sql
CREATE TABLE domain_lexicon (
  domain_id TEXT NOT NULL,
  pinyin_key TEXT NOT NULL,
  word TEXT NOT NULL,
  prior_score REAL NOT NULL,
  repair_target INTEGER NOT NULL DEFAULT 1,
  aliases TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  source TEXT,
  tags TEXT,
  PRIMARY KEY (domain_id, pinyin_key, word)
);

CREATE INDEX idx_domain_lexicon_domain_pinyin
ON domain_lexicon(domain_id, pinyin_key);
```

用途：

```text
行业词
专业词
品牌
地名
产品名
项目专有词
```

---

### industry_routing_lexicon

行业判定表。

```sql
CREATE TABLE industry_routing_lexicon (
  keyword TEXT NOT NULL,
  pinyin_key TEXT NOT NULL,
  domain_id TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1.0,
  source TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (domain_id, pinyin_key, keyword)
);

CREATE INDEX idx_industry_routing_pinyin
ON industry_routing_lexicon(pinyin_key);

CREATE INDEX idx_industry_routing_domain
ON industry_routing_lexicon(domain_id);
```

用途：

```text
Session topicKeywords
→ pinyin_key
→ domain_id
```

---

# 4. Session Intent SSOT

## 4.1 新增 Session 级字段

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

  source: 'cpu_llm' | 'manual' | 'fallback_anchor';

  reason: string[];
};
```

Session：

```ts
export type SessionObject = {
  lexiconSessionIntent?: LexiconSessionIntent;

  activeLexiconProfile: ActiveLexiconProfileSnapshot;

  pendingProfile?: ActiveLexiconProfileSnapshot;

  profileHistory: ProfileSwitchEvent[];
};
```

---

## 4.2 字段职责

| 字段 | 职责 |
|------|------|
| `lexiconSessionIntent` | Session 级用户意图 SSOT |
| `topicKeywords` | 行业表/专业词表判定输入 |
| `topicKeywordPinyinKeys` | 与 FW pinyin_key 规则一致 |
| `primaryDomain` | 专业词表主路由 |
| `secondaryDomains` | 多域 fallback / union |
| `activeLexiconProfile` | 仍用于 domainBoost |
| `turnProfileSnapshot` | JobContext 固定快照 |

---

## 4.3 CPU LLM Intent 输出扩展

当前输出：

```json
{
  "summary": "...",
  "primaryDomain": "restaurant",
  "secondaryDomains": [],
  "confidence": 0.85,
  "shouldSwitch": true,
  "reason": []
}
```

目标输出：

```json
{
  "summary": "用户在点咖啡，关注杯型、温度和糖度",
  "topicKeywords": ["咖啡", "中杯", "拿铁", "少糖"],
  "primaryDomain": "restaurant",
  "secondaryDomains": [],
  "confidence": 0.88,
  "shouldSwitch": true,
  "reason": ["出现咖啡点单相关词"]
}
```

注意：

```text
topicKeywordPinyinKeys 由 Node 统一计算
不要依赖 LLM 生成拼音
```

---

## 4.4 写入链

```text
session finalize
  → shouldScheduleIntentJob
  → enqueueIntentJob
  → POST /intent
  → parseLexiconProfileDecision
  → Node 计算 topicKeywordPinyinKeys
  → session.lexiconSessionIntent = {...}
  → sync activeLexiconProfile / pendingProfile
```

下一 turn：

```text
beginTurnForJob
  → bind lexiconSessionIntent to JobContext
  → FW recall reads ctx.lexiconSessionIntent
```

---

# 5. Recall Runtime V2

## 5.1 目标流程

```text
span
  → pinyin_key
  → lookupBase(pinyin_key)
  → lookupDomain(primaryDomain, pinyin_key)
  → optional lookupDomain(secondaryDomains, pinyin_key)
  → merge candidates
  → dedupe
  → score
  → KenLM weak_veto
  → pick
```

---

## 5.2 Query API

```ts
type LexiconCandidate = {
  word: string;
  pinyinKey: string;
  priorScore: number;
  source: 'base' | 'idiom' | 'domain';
  domainId?: string;
  repairTarget: boolean;
  aliases?: string[];
};

type RecallLookupRequest = {
  pinyinKey: string;
  termLength: number;
  activeDomain?: string;
  secondaryDomains?: string[];
  includeBase: boolean;
  includeIdiom: boolean;
  maxBaseCandidates: number;
  maxDomainCandidates: number;
};

type RecallLookupResult = {
  candidates: LexiconCandidate[];
  diagnostics: {
    baseHitCount: number;
    domainHitCount: number;
    idiomHitCount: number;
    activeDomain?: string;
    fallbackUsed: boolean;
  };
};
```

---

## 5.3 Merge 规则

候选来源：

```text
base
domain(primary)
domain(secondary)
idiom
```

推荐排序权重：

```text
domain(primary) boost > domain(secondary) boost > base > idiom
```

但必须限制：

```text
domain 不得完全覆盖 base
```

建议：

```ts
const score =
  priorScore
  + sourceBoost
  + domainBoost
  + phoneticScore
  - editPenalty;
```

---

## 5.4 fallback 策略

| 条件 | 行为 |
|------|------|
| 无 Session intent | base-only recall |
| intent confidence 低 | base + enabledDomains default |
| domain lookup 空 | base fallback |
| domain routing 冲突 | primary + secondary union |
| SQL 查询失败 | no candidate，FW 不 apply |

---

# 6. Build Pipeline V2

## 6.1 输入结构

```text
data/lexicon/zh/
  base_zh_v1/entries.jsonl
  idiom_zh_v1/entries.jsonl
  domain_zh_v1/entries.jsonl
  industry_routing_v1/entries.jsonl
```

---

## 6.2 输出结构

```text
node_runtime/lexicon/current/
  manifest.json
  lexicon.sqlite
  checksum.txt
```

SQLite 内：

```text
base_lexicon
idiom_lexicon
domain_lexicon
industry_routing_lexicon
```

---

## 6.3 Builder 职责

新增或扩展：

```text
scripts/lexicon/build-lexicon-runtime-v2.mjs
scripts/lexicon/validate-lexicon-runtime-v2.mjs
scripts/lexicon/check-pinyin-buckets-v2.mjs
scripts/lexicon/migrate-v1-to-v2.mjs
```

---

## 6.4 Builder 校验规则

### base

```text
只允许 2/3 字
禁止 1 字
禁止普通 4 字
禁止 5 字以上
禁止自由组合短语
低频过滤
bucket max 20
```

### idiom

```text
只允许 4 字
必须标记 idiom/fixed_expression
```

### domain

```text
允许 2 字以上
必须有 domain_id
允许 aliases
repairTarget 默认 true
```

### industry routing

```text
keyword 必须 2 字以上
必须有 domain_id
必须有 weight
```

---

# 7. 迁移方案

## Phase 0：V2 Schema Shadow Build

不改 Runtime。

目标：

```text
先能构建 V2 SQLite
但 Runtime 仍使用 V1
```

产出：

```text
lexicon_v2.sqlite
manifest_v2.json
schema stats
```

验收：

```text
build PASS
validate PASS
stats 合理
```

---

## Phase 1：Runtime 双实现

新增：

```ts
LexiconRuntimeV2
```

但不替换 V1。

支持：

```text
SQL by pinyin_key
LRU bucket cache
base/domain lookup
```

验收：

```text
unit tests PASS
同一个 pinyin_key 查询结果与 V1 shadow 对齐
内存占用下降
```

---

## Phase 2：Session Intent SSOT

新增：

```text
LexiconSessionIntent
topicKeywords
topicKeywordPinyinKeys
```

不改 recall。

先做观测：

```text
Session 是否能稳定产出 domain + keywords
```

验收：

```text
intent job PASS
session field 落地
diagnostics 可见
```

---

## Phase 3：FW Recall 双路查询

将：

```text
lookupTopKByPinyin
```

替换为：

```text
lookupBaseAndDomainByPinyin
```

保持 FW 主链步骤不变。

验收：

```text
dialog_200 PASS
quality 不劣化
recall latency p95 可控
memory 降低
```

---

## Phase 4：Industry Routing

启用：

```text
topicKeywordPinyinKeys
→ industry_routing_lexicon
→ activeDomain correction
```

验收：

```text
domain routing accuracy
专业词 recall 命中率
误触发率
```

---

# 8. Target List

## P0：方案落地前置

| ID | Target |
|---|---|
| P0-1 | 冻结 V2 schema |
| P0-2 | 新增 base/domain/idiom/industry routing seed 规范 |
| P0-3 | 新增 V2 validate |
| P0-4 | 新增 V2 build shadow 输出 |
| P0-5 | 不改现有 FW Runtime |
| P0-6 | 输出 stats / rejected / bucket 报告 |

---

## P1：Runtime V2

| ID | Target |
|---|---|
| P1-1 | 新增 LexiconRuntimeV2 |
| P1-2 | SQL 按 pinyin_key 查询 |
| P1-3 | LRU bucket cache |
| P1-4 | base/domain/idiom lookup API |
| P1-5 | memory benchmark |
| P1-6 | recall latency benchmark |

---

## P2：Session Intent SSOT

| ID | Target |
|---|---|
| P2-1 | 新增 LexiconSessionIntent 类型 |
| P2-2 | 扩展 CPU LLM schema topicKeywords |
| P2-3 | Node 计算 topicKeywordPinyinKeys |
| P2-4 | Session 写入 lexiconSessionIntent |
| P2-5 | JobContext 绑定只读副本 |
| P2-6 | diagnostics 输出 |

---

## P3：双路 Recall

| ID | Target |
|---|---|
| P3-1 | lookup base + domain |
| P3-2 | candidate merge + dedupe |
| P3-3 | sourceBoost / domainBoost |
| P3-4 | KenLM weak_veto 保持不变 |
| P3-5 | dialog_200 全量回归 |
| P3-6 | quality/perf 报告 |

---

## P4：Industry Routing

| ID | Target |
|---|---|
| P4-1 | industry_routing_lexicon 表 |
| P4-2 | topic keyword → domain lookup |
| P4-3 | LLM domain vs routing domain shadow compare |
| P4-4 | fallback 策略 |
| P4-5 | domain accuracy benchmark |

---

# 9. Check List

## 架构

- [ ] FW 主链步骤顺序不变
- [ ] `segmentForJobResult` SSOT 不变
- [ ] KenLM weak_veto 不变
- [ ] Recover 不恢复
- [ ] V2 只改变词库 Runtime / Recall 内核

## 数据

- [ ] base_lexicon 只含基础词
- [ ] idiom_lexicon 独立
- [ ] domain_lexicon 独立
- [ ] industry_routing_lexicon 独立
- [ ] pinyin_key 统一使用 `|` 分隔
- [ ] 每表有索引
- [ ] manifest 记录 schemaVersion

## Runtime

- [ ] 不全量加载 domain 词库
- [ ] SQL pinyin_key 查询可用
- [ ] LRU cache 可配置
- [ ] 查询失败不影响主链
- [ ] diagnostics 可见

## Session

- [ ] LLM 输出 topicKeywords
- [ ] Node 生成 topicKeywordPinyinKeys
- [ ] Session 写 lexiconSessionIntent
- [ ] JobContext 只读绑定
- [ ] 低置信度 fallback

## 测试

- [ ] V2 build tests PASS
- [ ] V2 runtime unit tests PASS
- [ ] Session intent tests PASS
- [ ] dialog_200 PASS
- [ ] memory benchmark PASS
- [ ] recall latency p95 可控
- [ ] quality 不劣化

---

# 10. 风险与缓解

| 风险 | 说明 | 缓解 |
|---|---|---|
| SQL 查询变慢 | V1 是内存 Map | LRU cache + p95 benchmark |
| 定域错误 | LLM / routing 可能误判 | base fallback + 多域 union |
| domain 词污染 | 专业词过多 | domain 按需查，不进 base |
| 改造触碰冻结 | recall 内核行为变化 | 走例外变更单 |
| topicKeywords 质量差 | LLM 输出不稳定 | Node 校验 + fallback_anchor |
| 多表 build 复杂 | 构建链变长 | Phase 0 shadow build |
| 与现有 bundle 不兼容 | V1/V2 共存 | versioned manifest |

---

# 11. Cursor 开发提示词

```text
请基于当前仓库做词库 Runtime V2 Phase 0 技术实现方案，不要直接替换现有 Runtime。

目标：
在不修改 ASR→FW→Aggregation→Dedup→Translation 主链的前提下，为下一代词库 Runtime 建立分表拼音主键 schema 和 shadow build 能力。

背景：
当前 Runtime 是单表 lexicon.sqlite + 全表读入内存 + Map<pinyinKey, entries[]>。
目标是：
base_lexicon
idiom_lexicon
domain_lexicon
industry_routing_lexicon
四类表分离，以 pinyin_key 或 (domain_id, pinyin_key) 为索引键。

约束：
1. 不改 FW 主链步骤顺序。
2. 不改 segmentForJobResult SSOT。
3. 不改 KenLM weak_veto。
4. 不恢复 Recover。
5. 不替换现有 LexiconRuntime。
6. Phase 0 只做 shadow build + validate + stats。
7. 不让 general domain 再进入 FW recall 硬过滤问题。
8. 不导入 1 字 base 词。
9. base 只允许 2/3 字。
10. 普通 4 字不进 base。
11. domain 词独立入 domain_lexicon。

请输出：
1. V2 SQLite schema
2. seed 输入格式
3. build 脚本设计
4. validate 脚本设计
5. stats/rejected 输出
6. 与现有 lexicon:build 的并行关系
7. 需要修改/新增的文件
8. 测试清单
9. 风险
10. checklist
```

---

# 12. 最终结论

这不是简单的词库导入格式修改，而是下一代词库 Runtime 架构变更。

应单独立项为：

```text
Lexicon Runtime V2
```

并与 FW 主链冻结解耦。

推荐路线：

```text
Phase 0：V2 schema + shadow build
Phase 1：Runtime V2 SQL lookup + LRU cache
Phase 2：Session Intent SSOT
Phase 3：base/domain 双路 recall
Phase 4：industry routing
```

其中最关键的架构结论是：

```text
CPU LLM 不负责选择具体修复词；
CPU LLM 只负责 Session 意图与行业域；
具体候选仍由 pinyin_key + base/domain lexicon + KenLM 决定。
```
