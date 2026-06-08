# FW Detector / Lexicon Recall — Tone Constraint Audit

**日期**：2026-06-03  
**性质**：只读审计（禁止开发 / 调参 / 改词库 / 改 IME / 改 Recall 行为）  
**前置**：[Recall Candidate Dump Audit](./Recall_Candidate_Dump_Audit_2026_06_03.md)  
**探针脚本**：`electron_node/electron-node/tests/experiments/tone-constraint-audit-probe.mjs`  
**探针数据**：`tests/experiments/tone-constraint-audit-probe.json`

---

## 0. Executive Summary

| 结论 | 判定 |
|------|------|
| **当前 span recall 是否真正使用音调约束？** | **否（对 base 主路径实质未生效）** |
| **少病 → 烧饼/哨兵 根因** | **A 词库无少冰** + **B SQL 仅 plain pinyin** + **C toneDistance 仅软排序且 base 词条无声调数字** |
| **tone 是否影响 priorScore / candidateScore？** | **否** — 仅 `fw-sentence-rerank-pipeline.ts` 召回后排序 |
| **FW ASR 是否提供 tone？** | **否** — 仅从 ASR 错字反查 `pinyin-pro` |
| **是否允许 Tone Constraint P2 Development？** | **是（观测结论：当前约束名存实亡，需 P2 设计与词库补齐）** |

**少病案例一句话**：`shao|bing` 桶内仅有 **烧饼、哨兵**；**少冰 不在 v3 SQLite**；即便存在，base 层 `tone_pinyin_key` **100% 为无声调副本**，`toneDistance` 无法区分近音词。

---

## 1. 第一部分 — 数据库音调字段审计

**SQLite**：`node_runtime/lexicon/v3/lexicon.sqlite`  
**manifest**：`schemaVersion = lexicon-v3-four-table-v1`

### 1.1 表与字段

| 表 | 与 recall 相关字段 | 说明 |
|----|-------------------|------|
| **base_lexicon** | `pinyin_key` (PK)、`tone_pinyin_key`、`word` (PK)、`prior_score`、`repair_target` | runtime 主召回源 |
| **domain_lexicon** | `domain_id` (PK)、`pinyin_key`、`tone_pinyin_key`、`word` (PK)、… | 按 enabled domain 查询 |
| **idiom_lexicon** | 同 base 结构 | 4 字成语，本案例未命中 |
| **industry_routing_lexicon** | `pinyin_key`、`keyword`、`domain_id` | 路由，非词条召回 |

**不存在**独立 alias 表；alias 存在各表 `aliases` / `is_alias` 字段。

### 1.2 音调 / 无声调字段

| 字段名 | 存在 | 实际内容 |
|--------|------|----------|
| `pinyin_key` | ✅ | **无声调**，如 `shao\|bing` |
| `tone_pinyin_key` | ✅ | 列存在，但 **base/idiom 层无数字声调** |
| `tone_pinyin` / `pinyin_tone` / `syllables_with_tone` | ❌ | 无此命名 |

### 1.3 索引（PRAGMA index_list）

| 表 | 索引 | 列 |
|----|------|-----|
| base_lexicon | `sqlite_autoindex_base_lexicon_1` (UNIQUE) | `pinyin_key`, `word` |
| domain_lexicon | `sqlite_autoindex_domain_lexicon_1` (UNIQUE) | `domain_id`, `pinyin_key`, `word` |
| idiom_lexicon | `sqlite_autoindex_idiom_lexicon_1` (UNIQUE) | `pinyin_key`, `word` |

**索引不含 `tone_pinyin_key`** — recall 无法按声调索引查找。

### 1.4 tone_pinyin_key 有效覆盖率（实测）

| 表 | 总行数 | 列非空 | **含数字声调 `[0-9]`** |
|----|--------|--------|------------------------|
| base_lexicon | 50,000 | 50,000 (100%) | **0 (0%)** |
| domain_lexicon | 25 | 25 (100%) | **16 (64%)** |
| idiom_lexicon | 22,192 | 22,192 (100%) | **0 (0%)** |

> `tone_pinyin_key` 在 base 层实质等于 `pinyin_key` 的复制（如 `shao|bing`），**不是** `shao3|bing1` 格式。

### 1.5 Recall 查询实际使用字段

`lexicon-runtime-v2.ts` 预编译 SQL：

```sql
-- base
SELECT id, pinyin_key, tone_pinyin_key, word, ...
FROM base_lexicon
WHERE pinyin_key = ? AND enabled = 1 AND length(word) = ?
ORDER BY prior_score DESC
LIMIT ?

-- domain
SELECT id, domain_id, pinyin_key, tone_pinyin_key, word, ...
FROM domain_lexicon
WHERE domain_id = ? AND pinyin_key = ? AND enabled = 1 AND length(word) = ?
ORDER BY prior_score DESC
LIMIT ?
```

| 问题 | 答案 |
|------|------|
| 按 plain pinyin 查？ | **是** — `WHERE pinyin_key = ?` |
| 按 tone pinyin 查？ | **否** |
| 仅用 first syllable？ | **否** — 完整 `syllablesKey`（如 `shao\|bing`） |
| 后处理 toneDistance？ | **是** — 仅在 `fw-sentence-rerank-pipeline.ts`，**不在** `recall-span-topk-v2.ts` |
| tone hard filter？ | **否** |
| tone soft score？ | **是** — pipeline 内排序键 #1，但 base 词条 tone key 无效时退化为 priorScore |

---

## 2. 第二部分 — 词条音调数据抽查

| word | table | domain | pinyin_plain | pinyin_tone (DB) | priorScore | repairTarget | source |
|------|-------|--------|--------------|------------------|------------|--------------|--------|
| **少病** | — | — | — | — | — | — | **不在库** |
| **少冰** | — | — | — | — | — | — | **不在 v3 SQLite**（seed jsonl 有，runtime 无） |
| 烧饼 | base_lexicon | — | `shao\|bing` | `shao\|bing` | 0.7024 | true | jieba_dict_mit_highfreq_fw_domain_compat |
| 哨兵 | base_lexicon | — | `shao\|bing` | `shao\|bing` | 0.6617 | true | jieba_dict_mit_highfreq_fw_domain_compat |
| 评审 | base_lexicon | — | `ping\|shen` | `ping\|shen` | 0.7033 | true | jieba_dict_mit_highfreq_fw_domain_compat |
| 平身 | base_lexicon | — | `ping\|shen` | `ping\|shen` | 0.5605 | true | jieba_dict_mit_highfreq_fw_domain_compat |
| 进度 | base_lexicon | — | `jin\|du` | `jin\|du` | 0.6797 | true | jieba_dict_mit_highfreq_fw_domain_compat |
| 筋斗 | base_lexicon | — | `jin\|dou` | `jin\|dou` | 0.6870 | true | jieba_dict_mit_highfreq_fw_domain_compat |
| 文档 | base_lexicon | — | `wen\|dang` | `wen\|dang` | 0.6365 | true | jieba_dict_mit_highfreq_fw_domain_compat |
| 稳当 | base_lexicon | — | `wen\|dang` | `wen\|dang` | 0.5703 | true | jieba_dict_mit_highfreq_fw_domain_compat |
| 上线 | base_lexicon | — | `shang\|xian` | `shang\|xian` | 0.7087 | true | jieba_dict_mit_highfreq_fw_domain_compat |
| 上限 | base_lexicon | — | `shang\|xian` | `shang\|xian` | 0.6494 | true | jieba_dict_mit_highfreq_fw_domain_compat |

### 少冰 专项

| 来源 | 是否存在 |
|------|----------|
| `electron_node/electron-node/data/lexicon/hotwords.jsonl` | ✅ `restaurant-0126`，`pinyin:"shao bing"`，`domains:["restaurant"]` |
| `node_runtime/lexicon/v3/lexicon.sqlite` base | ❌ |
| `node_runtime/lexicon/v3/lexicon.sqlite` domain (restaurant) | ❌ |
| `node_runtime/pinyin-ime-v2/dict/*.txt` | ❌ |

**`pinyin_key=shao|bing` 桶内仅 2 条**：烧饼、哨兵（`hasShaobing: false`）。

---

## 3. 第三部分 — span 拼音生成审计

来源：`textToSyllables` / `textToToneSyllables`（`pinyin-pro`，`toneType: none/num`）

| span | plain | tone | plainKey | toneKey |
|------|-------|------|----------|---------|
| **少病** | shao bing | **shao3 bing4** | `shao\|bing` | `shao3\|bing4` |
| 赶时 | gan shi | gan3 shi2 | `gan\|shi` | `gan3\|shi2` |
| 进都 | jin dou | jin4 dou1 | `jin\|dou` | `jin4\|dou1` |
| 评审 | ping shen | ping2 shen3 | `ping\|shen` | `ping2\|shen3` |
| 检查 | jian cha | jian3 cha2 | `jian\|cha` | `jian3\|cha2` |
| 叫吗 | jiao ma | jiao4 ma5 | `jiao\|ma` | `jiao4\|ma5` |
| 解一 | jie yi | jie3 yi1 | `jie\|yi` | `jie3\|yi1` |

**多音字**：由 `pinyin-pro` 按**当前错字**消歧（非 ASR 音频 tone）。  
例：「少**病**」→ `bing4`；若正确字为「冰」应为 `bing1` — **错字导致 tone 跟着错**。

---

## 4. 第四部分 — Recall SQL 与排序路径

```text
span.text
  → textToSyllables()          # plain, toneType:none
  → syllablesKey()             # e.g. shao|bing
  → lookupBase/DomainByPinyinKey(pinyin_key)   # SQL, 无声调
  → scoreHotword()             # candidateScore, 无 tone 项
  → sort by candidateScore DESC
  → slice(perSpanLimit)
  → local-span-recall: filter priorScore >= minPrior

# 仅 pipeline 层（fw-sentence-rerank-pipeline.ts）：
  → textToToneSyllables(span.text)  # shao3|bing4
  → toneDistance(asrToneKey, hit.tonePinyinKey)
  → sort: toneDistance → priorScore → candidateScore
```

| 阶段 | 使用 tone？ |
|------|------------|
| `recall-span-topk-v2.ts` SQL | **否** |
| `recall-span-topk-v2.ts` 排序 | **否**（`candidateScore`） |
| `local-span-recall.ts` | **否** |
| `fw-sentence-rerank-pipeline.ts` | **是（软排序）** |

---

## 5. 第五部分 — toneDistance 计算

**公式**（`tone-pinyin.ts`）：逐音节字符串相等计数，不等则 `distance += 1`；key 格式 `syllable1|syllable2|...`；长度不等返回 `MAX_SAFE_INTEGER`。

### 5.1 少病案例 pair

| pair | plain match | span tone | cand tone (DB) | toneDistance | priorScore | candidateScore | minPrior |
|------|-------------|-----------|----------------|--------------|------------|----------------|----------|
| 少病 → **少冰** | ✅ | shao3\|bing4 | shao3\|bing1（理论） | **1** | — | — | **词不在库** |
| 少病 → 烧饼 | ✅ | shao3\|bing4 | shao\|bing | **2** | 0.7024 | 1.2024 | ✅ |
| 少病 → 哨兵 | ✅ | shao3\|bing4 | shao\|bing | **2** | 0.6617 | 1.1617 | ✅ |

> DB 中 `tone_pinyin_key=shao|bing`（无数字），与 `shao3|bing4` 比较时两音节均不等 → distance=2。  
> **所有 base 同桶候选 toneDistance 相同**，排序退回 **priorScore** → 烧饼 #1。

### 5.2 其它 pair

| pair | plain match | toneDistance | 备注 |
|------|-------------|--------------|------|
| 进都 → 进度 | ❌ (`jin\|dou` vs `jin\|du`) | 2 | 不同 plain 桶，靠 phoneticScore 0.5 仍可入池 |
| 进都 → 筋斗 | ✅ | 2 | 同桶，筋斗 prior 更高 → 先召回 |
| 评审 → 平身 | ✅ | 2 | 同 ping\|shen 桶，评审 prior 更高 |
| 文档 → 稳当 | ✅ | 2 | 同 wen\|dang 桶 |
| 上线 → 上限 | ✅ | 2 | 同 shang\|xian 桶 |

---

## 6. 第六部分 — minPrior / candidateScore

**candidateScore** = `priorScore + phoneticSimilarity + exactLengthBonus + domainBoost - editDistancePenalty`

| 项 | 是否含 tone |
|----|------------|
| priorScore | **否** |
| phoneticSimilarity | **否**（plain syllable Levenshtein） |
| editDistancePenalty | **否**（汉字编辑距离） |
| toneDistance | **仅 pipeline 排序，不进 score** |

**为何 tone mismatch 仍过 minPrior=0.5？**  
`minPrior` 只看词库 `prior_score`，与 tone 无关。烧饼/哨兵 prior 0.70/0.66 均通过。

**结论**：**声调不匹配仍可进入候选池**；当前无 hard filter；软排序对 base 层**无效**（tone key 无数字 → 全部 distance=2）。

---

## 7. 第七部分 — FW ASR 音调信息

| 问题 | 答案 |
|------|------|
| FW 输出是否含拼音？ | **否** — `UtteranceResponse.text` 仅汉字 |
| FW 输出是否含音调？ | **否** |
| faster-whisper 原生是否输出 tone？ | **否** — 字符级转写 |
| 当前 tone 来源？ | `textToToneSyllables(span.text)` → **pinyin-pro 从错字反查** |
| 多音字？ | pinyin-pro 默认消歧，**无 ASR 音频 disambiguation** |
| 错字→错 tone 链？ | **是** — 「少病」固定 bing4；正确「少冰」应为 bing1，但 span 已是错字 |

---

## 8. 第八部分 — 关键问题回答

### Q1 — 数据库是否包含音调信息？

**列存在，数据分层不一致**：`tone_pinyin_key` 100% 非空，但 **base/idiom 0% 含数字声调**；domain 25 条中 16 条含数字。

### Q2 — Recall 查询是否使用音调字段？

**否。** 查询条件仅 `pinyin_key`（无声调）。`tone_pinyin_key` 仅 SELECT 带出，供 pipeline 软排序。

### Q3 — 少病 → 烧饼/哨兵 根因？

| 代号 | 占比（主→次） | 说明 |
|------|--------------|------|
| **A** | **~60%** | **少冰 不在 v3 SQLite** |
| **B** | **~25%** | SQL 按 plain `shao\|bing` 桶，.homophone 共池 |
| **C** | **~10%** | toneDistance 仅 pipeline 软排序，且 recall 层已排序完 |
| **D** | **~5%** | base `tone_pinyin_key` 无声调数字 → 软排序失效 |
| E | — | 多音字/反查：次要（少冰缺失时无影响） |

**综合：A + B + C/D 组合。**

### Q4 — 若少冰在库，为何没召回？

**当前事实：不在库，故不可能召回。**  
**反事实**：若写入 `domain_lexicon`/`base` 且 `pinyin_key=shao|bing`，仍会与烧饼/哨兵同桶；除非 (1) `tone_pinyin_key` 为 `shao3|bing1` 且 pipeline tone 排序生效，或 (2) prior 更高且在 perSpanLimit 内。

### Q5 — 少冰不在库是否词库覆盖不足？

**是。** seed（`hotwords.jsonl`）有条目，**v3 bundle build 未纳入 runtime SQLite**；restaurant domain 表仅 25 行且无少冰。

### Q6 — tone mismatch 应改硬过滤？

**观测**：当前软约束对 base **未生效**；硬过滤需先修复 `tone_pinyin_key` 数据与查询路径。**允许作为 P2 议题讨论，本轮不实施。**

### Q7 — 是否应允许 plain 同、tone distance ≤ X？

**观测**：设计与代码意图为此（pipeline `toneDistance` 排序），但 **数据层未提供可比较的 tone key**，导致意图未落地。**P2 可先修数据再谈阈值 X。**

### Q8 — FW 能否直接提供 tone？

**当前不能。** faster-whisper 仅文本；需独立 G2P/声学模型方可。

### Q9 — 当前 tone 信息是否可信？

**低可信。** 源自 ASR 错字 + pinyin-pro 消歧；存在「错字→错 tone→错误 homophone 强化」风险。

---

## 9. 少病案例完整因果链

```text
ASR: 「少病」 (错字)
  ↓
textToSyllables → shao|bing
textToToneSyllables → shao3|bing4  (病=bing4，非冰=bing1)
  ↓
SQL: pinyin_key='shao|bing' AND length(word)=2
  ↓
桶内仅: 烧饼(0.7024), 哨兵(0.6617)   ← 少冰 不存在
  ↓
recall-span-topk-v2: sort by candidateScore → 烧饼, 哨兵
  ↓
pipeline toneDistance(shao3|bing4, shao|bing) = 2  (两者相同)
  ↓
排序退回 priorScore → 仍 烧饼, 哨兵
  ↓
correctCandidate 少冰 = NOT_FOUND
```

---

## 10. 是否允许 Tone Constraint P2 Development

| 维度 | 判定 |
|------|------|
| 当前约束是否真实生效？ | **否** |
| 是否需 P2？ | **是** — 至少含：词库补齐（少冰等）、`tone_pinyin_key` 数字声调、recall 层是否引入 tone 过滤/加权 |
| 本轮是否实施？ | **否**（只读审计边界） |

**P2 前置依赖（建议顺序，非本轮开发）**：

1. 词库：seed → v3 SQLite 一致性（少冰等 domain 词入库）  
2. 数据：`base_lexicon.tone_pinyin_key` 写入 `shao3|bing1` 格式  
3. 查询：评估 SQL `pinyin_key` vs `tone_pinyin_key` 分层或后滤  
4. ASR：评估是否引入独立于错字的 tone/G2P 源  

---

## 11. 附录 — 少病 Recall 实测输出

```
span: 少病
perSpanLimit: 4 (case 内 2 span)
Rank1: 烧饼  source=lexicon_pinyin_topk  candidateScore=1.2024  priorScore=0.7024  tonePinyinKey=shao|bing
Rank2: 哨兵  source=lexicon_pinyin_topk  candidateScore=1.1617  priorScore=0.6617  tonePinyinKey=shao|bing
sqlBucketCount: 2
```

---

*READONLY AUDIT — 未修改生产代码 / 词库 / IME / SQLite / 默认参数*
