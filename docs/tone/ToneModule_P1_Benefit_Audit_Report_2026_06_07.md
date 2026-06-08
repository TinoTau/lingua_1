# ToneModule P1 收益审计报告

**日期**: 2026-06-07  
**性质**: 只读收益分析（P0.5 已冻结，无代码/架构变更）  
**数据源**: `node_runtime/lexicon/v3/lexicon.sqlite`、Dialog200、P0.5 Runtime Validation、离线探针

---

## 执行摘要

| 维度 | 结论 |
|------|------|
| Dialog200 真实「调号完全匹配」命中 | **0** |
| Dialog200 Recall 排序变更（Tone ON vs OFF） | Top1 **9** / Top3 **15** |
| 词库可声调区分 bucket | **9** / 7831 同音 bucket（**0.11%**） |
| 词库 `tone_pinyin_key` 含调号条目 | 绝大多数为 plain `mei\|shi`，**无法触发 compatible** |
| 理论收益上限 | **极低～中低**（受词库 + CNN 双重约束） |
| 是否建议进入 P1.1 | **不建议**；优先 **P1.0 词库调号 SSOT 补齐** |

**核心结论**: ToneModule 链路在 P0.5 已接通，但 **真实数据中几乎无「acousticTonePattern ↔ candidateTonePattern 完全匹配」收益**，瓶颈在 **词库 `tone_pinyin_key` 未填调号**（仅 9 个 bucket 可区分），其次为 **CNN 调号误差** 与 **目标候选未入库**（如「少冰」）。

---

## 一、Tone 真正命中案例（pattern 完全匹配 + 排序）

### 1.1 Dialog200 E2E（真实链路）

P0.5 Runtime Validation（200 条全量）:

| 指标 | 值 |
|------|-----|
| `recallToneCompatibleCount`（聚合） | **0** |
| `recallToneFallbackCount` | 263 |
| Recall Top1 Change（ON vs OFF） | **9** |
| Recall Top3 Change | **15** |
| KenLM / Apply 变更 | **0** |

**解读**: Pattern 已进入 Recall 排序（fallback=263），但召回候选中 **无一** 同时满足 `tonePinyinKey` 调号与 `acousticTonePattern` 全匹配。排序变更来自 **全 incompatible 时的 priorScore 重排**，非「调号命中提权」。

### 1.2 离线探针（真实词库 + 合成声学 pattern）

探针脚本: `tone-module-p1-probe-offline.mjs`

| ASR词 | 声学 pattern | Recall Top5（OFF） | Recall Top5（ON） | compatible 命中 | 排序变化 |
|-------|-------------|-------------------|------------------|--------------|---------|
| 少病 | [3,1] | 烧饼, 哨兵 | 烧饼, 哨兵 | **0**（少冰未入库） | 无 |
| 钟贝 | [1,4] | — | — | 0 | 无 |
| 大悲 | [4,1] | 大悲 | 大悲 | 0 | 无 |
| 美食 | [3,3] | 美食,美式,美事,没事 | 美食,**没事**,美式,美事 | 0 | **有**（美式 2→3） |
| 评审 | [2,3] | 评审, 平身 | 评审, 平身 | 0 | 无 |
| 平身 | [2,1] | 平身, 评审 | **评审**, 平身 | 0 | **有**（Top1 互换） |
| 上线/上限 | [4,4] | 见探针 JSON | 见探针 JSON | 0 | 上限 case Top1 互换 |
| 检查/检察 | [3,3] | 检查, 检察, 监察 | **检察** 升至首位（检察 span） | 0 | 有 |

### 1.3 合成受控样例（P0.5 Final Acceptance，非真实词库）

仅当手动注入 `tonePinyinKey: shao3|bing1` 时：

| 原词 | ASR词 | Recall候选 | Tone Pattern | 排序变化 |
|------|-------|-----------|-------------|---------|
| 少冰 | 少病 | 少冰 | acoustic [3,1] ↔ shao3\|bing1 | **1←3 → Top1** |

此条 **不可代表生产词库**，因 DB 中无「少冰」且现有条目 key 为 `shao|bing`（无调号）。

### 1.4 Top20 样例表（按「排序影响」与「匹配度」综合）

| # | 原词 | ASR词 | Recall候选 | acousticTonePattern | candidateTonePattern | 完全匹配 | 排序变化 | 来源 |
|---|------|-------|-------------|--------------------|--------------------|---------|---------|------|
| 1 | 少冰 | 少病 | 少冰 | [3,1] | shao3\|bing1 | ✅ | 3→1 | 合成探针 |
| 2 | — | 平身 | 评审 | [2,1] | ping\|shen* | ❌ | 2→1 | 离线探针 |
| 3 | — | 上限 | 上线 | [4,4] | shang\|xian* | ❌ | 1→2 | 离线探针 |
| 4 | — | 检察 | 检查 | [3,3] | jian\|cha* | ❌ | 1→2 | 离线探针 |
| 5 | — | 美食 | 没事 | [3,3] | mei\|shi* | ❌ | 4→2 | 离线探针 |
| 6–20 | — | Dialog200 其余 | — | — | — | ❌ | 见 P0.5 E2E | 9 处 Top1 变更均无 compatible |

\* DB 存 plain key，无调号数字；`isCandidateToneCompatible` 返回 false。

---

## 二、最常见「同拼音不同调」词对（词库扫描）

**方法**: 扫描 `base_lexicon` + `domain_lexicon`，按 `pinyin_key` + 词长分组，筛选 **≥2 个不同 `tone_pinyin_key`** 的 bucket，按 `prior_score` 之和排序。

**统计**:

| 指标 | 值 |
|------|-----|
| 词库总词条（含 tone 字段） | 50,025 |
| 同音多词 bucket | **7,831** |
| **可调号区分** bucket（tone key 实质不同） | **9** |
| 可调号区分词对 | **17** |

### Top 17 可调号区分词对（即 Top100 全集）

| pinyin | wordA | toneA | wordB | toneB | 场景 |
|--------|-------|-------|-------|-------|------|
| mei\|shi | 美食 | mei\|shi | 美是 | mei3\|shi4 | 咖啡 |
| mei\|shi | 美食 | mei\|shi | 没事 | mei2\|shi4 | 咖啡 |
| mei\|shi | 美是 | mei3\|shi4 | 没事 | mei2\|shi4 | 咖啡 |
| xiao\|bei | 小辈 | xiao\|bei | 小碑 | xiao3\|bei1 | 通用 |
| zhong\|bei | 中杯 | zhong\|bei | 钟贝 | zhong1\|bei4 | **Dialog d001** |
| zhong\|bei | 中杯 | zhong\|bei | 终杯 | zhong1\|bei1 | 咖啡 |
| zhong\|bei | 钟贝 | zhong1\|bei4 | 终杯 | zhong1\|bei1 | 咖啡 |
| da\|bei | 大悲 | da\|bei | 大悲 | da4\|bei1 | **Dialog d002** |
| da\|bei | 大悲 | da\|bei | 达杯 | da2\|bei1 | 咖啡 |
| da\|bei | 大悲 | da4\|bei1 | 达杯 | da2\|bei1 | 咖啡 |
| na\|tie | 拿铁 | na\|tie | 拿帖 | na2\|tie1 | 咖啡 |
| na\|tie | 拿铁 | na\|tie | 那铁 | na4\|tie3 | 咖啡 |
| na\|tie | 拿帖 | na2\|tie1 | 那铁 | na4\|tie3 | 咖啡 |
| mo\|ka | 摩卡 | mo\|ka | 磨卡 | mo2\|ka3 | 咖啡 |
| lan\|mei | 蓝莓 | lan\|mei | 兰梅 | lan2\|mei2 | **Dialog d001** |
| lan\|mei\|ma\|fen | 蓝莓马芬 | lan\|mei\|ma\|fen | 兰梅马芬 | lan2\|mei2\|ma3\|fen1 | 咖啡 |
| ma\|fan | 麻烦 | ma\|fan | 麻烦 | ma2\|fan2 | 重复词条 |

**发现**: Dialog200 高频 ASR 错误（钟贝、大悲、美食、蓝莓）落在可调号区分集合内，但多数条目 **并存 plain + toned 两套 key**，Recall 实际读到的是 **无调号 key**。

---

## 三、Tone 无法区分的词

### 3.1 同 `tone_pinyin_key` 多词（调号相同）

| 指标 | 值 |
|------|-----|
| 不可区分词对数量 | **24,001** |
| 典型 bucket | `shi\|shi`（世事/事实/实施/…） |

**示例**:

| wordA | wordB | pinyin | tone |
|-------|-------|--------|------|
| 上线 | 上限 | shang\|xian | shang\|xian（plain，等价 shang4\|xian4） |
| 检查 | 检察 | jian\|cha | jian\|cha |
| 世事 | 事实 | shi\|shi | shi\|shi |

### 3.2 理论覆盖上限

| 层级 | 数量 | 说明 |
|------|------|------|
| 同音 bucket 总数 | 7,831 | plain pinyin 可召回多个候选 |
| Tone **可区分** bucket | **9** | 仅当 `tone_pinyin_key` 含不同调号 |
| Tone **不可区分** 词对 | 24,001+ | 同 key 或 plain key |
| **理论最大调号收益面** | **≈ 9 bucket × Dialog 命中率** | 远小于 7,831 bucket 的同音竞争面 |

即使 CNN 完美，Tone 对 **99.9% 同音竞争** 无区分能力（词库未标注调号）。

---

## 四、Dialog200 — Tone ON vs OFF 差异

**来源**: P0.5 `tone-module-p05-runtime-validation.json`（200 条 E2E）

| 指标 | 值 |
|------|-----|
| 有 span 的 case | 65 |
| Recall Top1 Change | **9** |
| Recall Top3 Change | **15** |
| KenLM Selected Change | 0 |
| Apply Count Change | **0** |

### 4.1 收益 vs 风险判断

| 类型 | 数量 | 说明 |
|------|------|------|
| **正确收益**（推断） | **0** 可确认 | 无 Apply 变更；无 golden→修复 的端到端确认 |
| **排序扰动** | 9（Top1） | Pattern 触发重排，但 compatible=0，可能为 prior .tie-break |
| **误修风险** | **低～中** | 排序变但 KenLM/Apply 未跟进；若未来补齐词库调号，扰动可能转化为误修 |
| **零影响** | 135+ case | FW 未触发 / tone 未启用 |

**典型样本（P0.5）**:

| id | rawAsr 片段 | toneEnabled | acousticPattern | 说明 |
|----|------------|-------------|-----------------|------|
| d001 | …钟贝… | — | — | 中杯/钟贝 bucket 存在，未产生 compatible |
| d003 | …少病… | ✅ | [3,3] | CNN 第二字调号与「少冰」不匹配 |
| d005 | … | ✅ | [4,2] | Pattern 有，recall compat=0 |

---

## 五、CNN 调号质量

### 5.1 抽样说明

- Dialog200 FW 全量扫盘因耗时未完成落盘；结合 P0.5 与离线探针。
- **Tone Enabled Case**: 47/200（P0.5 E2E）

### 5.2 典型案例：d003「少病」

| 字 | 期望（少冰语境） | CNN acoustic | 候选 少冰 key |
|----|----------------|-------------|--------------|
| 少 | 3 | 3 | shao3 |
| 病/冰 | 1 | **3** | bing1 |

第二音节调号错误 → **compatible 失败**，与 E2E `recallToneCompatibleCount=0` 一致。

### 5.3 调号准确率（推断级）

| 声调 | 推断准确率 | 依据 |
|------|-----------|------|
| 一声 | 中 | 咖啡域名词多一声起笔 |
| 二声 | 中～低 | 2↔3 混淆常见 |
| 三声 | 中 | d003 病→3 误判 |
| 四声 | 中 | 末音节四声较多 |
| 轻声 | 未充分采样 | — |

### 5.4 最易混淆组合（推断 + 业务观察）

| 混淆 | 场景 |
|------|------|
| **3↔4** | 上声 / 去声在短音节 |
| **2↔3** | 阳平 / 上声连读 |
| **调号对但词不在库** | 少病→少冰（少冰缺失） |

---

## 六、最终结论

### 6.1 Tone 真正产生收益的词类

| 词类 | 收益 | 条件 |
|------|------|------|
| 咖啡域 ASR 谐音 | **潜在** | 钟贝→中杯、大悲→大杯、美食→美式；需 **tone key 补齐 + CNN 准确** |
| 少病→少冰类 | **理论高、实际 0** | 少冰 **未入库** |
| 评审/平身、检查/检察 | **极低** | 调号 key 为 plain 或同 key |

### 6.2 Tone 完全无收益的词类

- **24,001+** 同 `tone_pinyin_key` 词对（占同音竞争绝大多数）
- `shi|shi`、`shang|xian` 等 plain-key 大 bucket
- FW 未触发 span（135/200）
- 单候选 span（无竞争）

### 6.3 最值得扩充的词典类型

1. **P0**: 为 7,831 同音 bucket 补齐 **带调号 `tone_pinyin_key`**（当前仅 9 bucket 合格）
2. **P1**: 入库高频修复目标：**少冰、中杯、大杯、美式** 等 Dialog200 黄金标签词
3. **P2**: 咖啡/餐厅 `domain_lexicon` 优先（钟贝/大悲/美食/蓝莓马芬 已部分覆盖）

### 6.4 最值得优化的 CNN 调号类别

1. **三声 / 去声边界**（3↔4）— 少病类
2. **二字词第二音节** — d003 第二字
3. **上声连读变调** — 不在当前兼容逻辑内，收益有限

### 6.5 理论收益上限评估

```
可区分 bucket (9) × Tone 启用率 (23.5%) × Span 命中率 (~32%) × CNN 准确率 (~?) × Recall 含目标词 (?)
≈ 个位数级 / 200 句 Dialog
```

当前实测：**compatible 命中 0**，Apply 收益 **0**。理论上限 **远低于** 同音 plain-Recall 修复上限。

### 6.6 是否值得进入 P1.1

| 选项 | 建议 |
|------|------|
| **P1.1（继续堆 CNN / 架构）** | **不建议** — 收益被词库阻断 |
| **P1.0（词库 tone_pinyin_key SSOT）** | **强烈建议** — 9/7831 bucket 是硬瓶颈 |
| **P1.0-b（入库缺失修复目标）** | **建议** — 少冰等 |

**结论**: 在 **不修改架构、不加打分** 前提下，P1 阶段应做 **词库数据收益**，而非 P1.1 模型迭代。待 `tone_pinyin_key` 覆盖率 >50% 同音 bucket 后再评估 CNN P1.1。

---

## 附录：审计产物

| 文件 | 说明 |
|------|------|
| `tests/experiments/tone-module-p1-lexicon-scan.json` | 词库同音/调号扫描 |
| `tests/experiments/tone-module-p1-probe-offline.json` | 离线 Recall 探针 |
| `tests/experiments/tone-module-p05-runtime-validation.json` | Dialog200 E2E |
| `tests/experiments/tone-module-p0-final-acceptance.json` | 合成少冰 Top1 |
| `tests/experiments/tone-constraint-audit-probe.json` | 词库/Recall 约束审计 |
