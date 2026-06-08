# Local Raw-IME Diff 后真实识别质量审计（只读）

**日期：** 2026-06-07  
**类型：** 只读审计（无代码变更、无补丁、无开发）  
**数据源：** `tests/lexicon-tone-dialog200-local-raw-ime-batch-result.json`（200/200 契约 PASS）  
**参考文本：** `test wav/dialog_200/cases.manifest.json`  
**分析脚本：** `tests/experiments/_fw-quality-post-local-raw-ime-diff-audit.mjs`（只读）  
**原始统计：** `tests/experiments/_fw-quality-post-local-raw-ime-diff-audit-data.json`

**关联：** [Local Raw-IME Diff 开发报告](./Pinyin_IME_v2_Local_RawImeDiff_Development_Report_2026_06_07.md) · [批测报告](./Pinyin_IME_v2_Local_RawImeDiff_Dialog200_Test_Report_2026_06_07.md) · [apply=0 根因审计](./Lexicon_Tone_Apply0_Root_Cause_Audit_2026_06_07.md)

---

## 执行摘要

Local Raw-IME Diff 已将 **FW 触发率从 106 提升到 158**，但 **final CER 仍为 0.250、apply=0**，说明增益停在 **Proposal 触达层**，未进入 **Recall → KenLM → Apply** 的有效修复闭环。

| 问题 | 结论 |
|------|------|
| 158 个 FW 里有多少「有价值 span」？ | **111/158 案例（70%）** 至少 1 个可对齐替换 span；span 级 **174/316（55%）** 同长对齐可修复，**142/316（45%）** 边界明显错误 |
| Recall 命中正确词？ | 仅 **35/174 可修复 span（20%）**；**34/158 案例（22%）** 任一 span 命中 |
| Tone 是否有效？ | 在已 Recall 命中的 35 span 中，**33/35 已在 Top1**（batch 排序后）；**Tone 不是主瓶颈** |
| KenLM 阻断？ | **52 案** 进入句级 KenLM；**16 案** Recall 命中且 KenLM 查询，**16/16 pickedIsRaw=true**；**maxDelta 全部 < minDeltaToReplace=0.03** |
| apply=0 最大原因？ | **Recall miss / 无候选（77 案，49%）** + **span 边界不可修复（47 案，30%）**；到达 KenLM 的 **32 案（20%）** 全部被 minDelta 门控 |

**ROI 排序：** **B PrimaryDomain + span 边界** > **A Recall** > **D KenLM** > **C Tone**  
**Proposal 冻结建议：** Local Raw-IME Diff **可冻结**；下一阶段应转 **profile 注入 + span 边界/normalizer + Recall domain 路由**，而非继续堆 Proposal fallback。

---

## 一、158 个 FW 案例：真实质量总览

### 1.1 审计口径

| 术语 | 定义 |
|------|------|
| **可修复 span** | raw/reference 对齐后，span 与 reference 替换词 **同长** 且 **文字不同** |
| **边界错误 span** | 有 ASR 错区，但 span 切分与 reference 替换词 **不同长** 或切在错误边界（如 `钟贝少` 对 `中杯`） |
| **Recall 命中** | span 的 batch `candidates[]` TopK 中含 reference 对齐的正确替换词 |
| **Tone 命中** | batch 候选已按 `finalScore`（含 tone 排序）排列；正确词 rank≤1/3/5 |

### 1.2 总体数量

| 指标 | 数量 | 占 158 FW | 占 316 span |
|------|------|-----------|-------------|
| FW 触发案例 | 158 | 100% | — |
| 至少 1 个可修复 span 的案例 | **111** | **70.3%** | — |
| 可修复 span（同长对齐） | **174** | — | **55.1%** |
| 边界错误 span | **142** | — | **44.9%** |
| Recall Top1 命中 span | **33** | — | 10.4% |
| Recall Top5 命中 span | **35** | — | 11.1% |
| Recall 完全空（0 候选）的可修复 span | **94** | — | 29.7% |
| 任一 span Recall 命中的案例 | **34** | **21.5%** | — |
| 进入 KenLM 句级 rerank | **52** | **32.9%** | — |
| apply > 0 | **0** | **0%** | — |

### 1.3 链路漏斗（158 FW）

```
158 FW triggered
  ├─ 47 案 (30%)  无可修复 span（P0 边界/对齐失败）
  ├─ 111 案 (70%) 有可修复 span
  │     ├─ 77 案 (49%)  Recall miss / 无句级候选（P1）
  │     ├─  2 案 (1%)   Recall hit 但 Tone rank 未进 Top1（P2）
  │     └─ 32 案 (20%)  Recall+Tone OK 但 KenLM 拒绝（P3）
  └─  0 案         Apply guard 拒绝（P4）
```

---

## 二、抽样真实质量（30 条）

**抽样条件：** `fw_triggered=true` 且 `selectedSpanCount>0`；种子 `20260607`，共 30 条。

### 2.1 抽样 ID 列表

| # | ID | 场景 | 分类 |
|---|-----|------|------|
| 1 | d058 | shopping | A4 |
| 2 | d038 | restaurant | A4 |
| 3 | d067 | customer_service | A2 |
| 4 | d013 | shopping | A2 |
| 5 | d026 | interview | A3 |
| 6 | d065 | tech_deploy | A3 |
| 7 | d009 | taxi | A2 |
| 8 | d021 | tech_deploy | A2 |
| 9 | d012 | hospital | A2 |
| 10 | d034 | bank | A2 |
| 11 | d016 | friend | A2 |
| 12 | d010 | hospital | A2 |
| 13 | d071 | interview | A3 |
| 14 | d072 | interview | A3 |
| 15 | d074 | friend | A3 |
| 16 | d089 | meeting | A3 |
| 17 | d116 | interview | A3 |
| 18 | d119 | friend | A3 |
| 19 | d143 | taxi | A3 |
| 20 | d155 | tech_deploy | A3 |
| 21 | d161 | interview | A3 |
| 22 | d188 | taxi | A3 |
| 23 | d189 | taxi | A3 |
| 24 | d017 | friend | A2 |
| 24–30 | （其余见 `_fw-quality-post-local-raw-ime-diff-audit-data.json` §sample30） | — | A2/A3/A4 |

### 2.2 分类定义与占比

| 分类 | 含义 | 30 条抽样占比 |
|------|------|---------------|
| **A1** | 正确 span + 正确 recall + 未被 KenLM 阻断 | **0%**（apply=0，无端到端成功案例） |
| **A2** | 正确 span + recall 未命中 | **47%**（14/30） |
| **A3** | 正确 span + recall 命中 + KenLM 拒绝 | **27%**（8/30） |
| **A4** | 错误 span / 边界不可修复 | **27%**（8/30） |

### 2.3 典型抽样（节选 6 条）

#### A3 · d026（interview）— Recall 命中，KenLM 拒绝

| 字段 | 内容 |
|------|------|
| raw | 你如何看待**夸团队写作**,遇到需求**边更**一般怎么处理? |
| reference | 你如何看待**跨团队协作**,遇到需求**变更**… |
| span | `边更` → 期望 `变更` |
| recallTopK | `变更`（Top1） |
| KenLM | pickedIsRaw=true；maxDelta=**0.00176** < 0.03 |

#### A2 · d009（taxi）— span 可修复，recall 偏误

| 字段 | 内容 |
|------|------|
| raw | 去望金斯赫…那边现在**赌不赌**? |
| reference | 去望京SOHO…那边现在**堵不堵**? |
| span | `赌不` |
| recallTopK | `独步`（未含 `堵不`/`赌不` 正确替换） |
| KenLM | 有 1 个组合句；maxDelta≈0 |

#### A4 · d058（shopping）— 边界错误

| 字段 | 内容 |
|------|------|
| span | `穿中`（期望应对齐 `中码` 区域，实际对齐到 `这件`） |
| recallTopK | `传中` |
| 结论 | span 切分偏离 ASR 错词，Recall 无法救 |

#### A2 · d001 餐饮（不在 30 抽样内，专项见第七节）

| 字段 | 内容 |
|------|------|
| span | `钟贝少` / `深便` / `有蓝美马分` |
| recall | `深便`→[`身边`,`申辩`]；其余 **recallEmpty** |
| 根因 | 边界含多余字 + **domain_hits=0**（general profile） |

---

## 三、Recall 命中率审计

**统计总体：** 可修复 span **174** 个（来自 158 FW）

| 指标 | 数量 | 占可修复 span |
|------|------|---------------|
| recallHitTop1 | **33** | **19.0%** |
| recallHitTop3 | **35** | **20.1%** |
| recallHitTop5 | **35** | **20.1%** |
| recallMiss（有候选但未命中） | **45** | **25.9%** |
| recallEmpty（0 候选） | **94** | **54.0%** |

### 3.1 四类场景 Recall（可修复 span 子集）

| 场景 | 可修复 span | Top1 命中 | Top3 命中 | Top5 命中 | recallMiss | recallEmpty |
|------|-------------|-----------|-----------|-----------|------------|-------------|
| **餐饮 cafe** | 24 | **0** | **0** | **0** | 9 | **15** |
| **医院 hospital** | 22 | 6 | 7 | 7 | 6 | 9 |
| **银行 bank** | 8 | 1 | 2 | 2 | 0 | 6 |
| **技术 tech** | 33 | 6 | 6 | 6 | 15 | 12 |

**餐饮结论：** 158 FW 中 cafe 虽有触发，但 **Recall 对 reference 正确词命中率为 0**；与 `primaryDomain=general`、`domain_hits=0` 一致。

---

## 四、ToneModule 质量

**统计范围：** Recall 已命中正确词的 **35** 个 span（batch 候选顺序 = tone 排序后 finalScore）

| 指标 | 数量 | 占 Recall 命中 span |
|------|------|---------------------|
| toneCorrectTop1 | **33** | **94.3%** |
| toneCorrectTop3 | **35** | **100%** |
| toneCorrectTop5 | **35** | **100%** |

**全批 Tone 旁证：**

| 指标 | 值 |
|------|-----|
| 有 `recallToneCompatibleCount>0` 的案例 | **12/200** |
| d001–d003 `recallToneCompatibleCount` | **均为 0** |
| FW 内 Tone 推理 avg | **7.1 ms** |

**判断：** Tone **已在发挥作用**（命中 span 内几乎总把正确词排到 Top1），但 **仅 35 个 span 走进 Recall 命中**，Tone 无法弥补上游 Recall/span 失败。**Tone 不是 apply=0 主因。**

---

## 五、KenLM 阻断分析

### 5.1 总体

| 指标 | 数量 |
|------|------|
| 进入 KenLM 查询的 FW 案例 | **52** |
| Recall 命中且 KenLM 查询 | **16** |
| pickedIsRaw=true | **52/52**（100%） |
| pickedCandidate（非 raw） | **0** |
| kenlmApprovedCount | **0** |

### 5.2 pickedIsRaw=true 原因

**统一原因：** 所有修复句的 **KenLM delta < minDeltaToReplace=0.03**（配置快照全批一致）。

| maxDelta 分布（52 案 KenLM 查询） | 数量 |
|-----------------------------------|------|
| **负值**（修复句比 raw 更差） | **32** |
| **0 ~ 0.01** | **20** |
| 0.01 ~ 0.03 | **0** |
| ≥ 0.03（可通过门控） | **0** |

### 5.3 KenLM 样本（Recall 命中路径）

| ID | 原句（节选） | 候选句（节选） | maxDelta | 阈值 |
|----|-------------|---------------|----------|------|
| d026 | …需求**边更**… | …需求**变更**… | **0.00176** | 0.03 |
| d065 | …**后选生**… | …**候选生**… | **0.00003** | 0.03 |
| d074 | …**叫吗**… | …**角马**… | **0.00141** | 0.03 |
| d116 | …**边更**… | …**变更**… | **0.00201** | 0.03 |
| d189 | …**赌不赌**… | …**独步赌**… | **0.00041** | 0.03 |

**结论：** KenLM **偏保守**；但当前更大问题是 **仅 16 案** 同时 Recall 命中并到达 KenLM——放宽阈值 alone 最多影响这 16 案，**无法解释 158 FW 中 106 案未到达 KenLM**。

---

## 六、Apply=0 根因（158 FW）

| 原因 | 数量 | 占比 | 说明 |
|------|------|------|------|
| **P1 · Recall miss** | **77** | **48.7%** | 有可修复 span 但 recallEmpty / 未命中 / `no_candidates` |
| **P0 · 无可修复 span** | **47** | **29.7%** | 边界错误，Recall 无从着手（Proposal 触达但 span 质量不足） |
| **P3 · Recall hit + Tone hit + KenLM reject** | **32** | **20.3%** | 有句级候选；maxDelta < 0.03 |
| **P2 · Recall hit + Tone miss** | **2** | **1.3%** | 正确词在 TopK 但非 Top1 |
| **P4 · Apply guard reject** | **0** | **0%** | 无 approved replacement |

> 注：P0 为 span 质量问题，与 P1 合计 **124/158（78%）** 在 KenLM 之前已失败。

---

## 七、餐饮专项（d001 / d002 / d003 + cafe）

### 7.1 三案批测 trace

#### d001

| 字段 | 内容 |
|------|------|
| raw | …热拿铁**钟贝少**糖 **深便**温 以下今天有**蓝美马分**吗? |
| reference | …热拿铁，**中杯**，少糖。顺便问一下今天有**蓝莓马芬**吗？ |
| selected spans | `钟贝少` / `深便` / `有蓝美马分` |
| batch recallTopK | `深便`→[`身边`,`申辩`]；其余 **[]** |
| toneTopK | recallToneFallback=2；无 tone-compatible |
| KenLM | combinationCount=**0**；未查询 |
| active_domain | **base_only**；domain_hits=**0** |

#### d002

| 字段 | 内容 |
|------|------|
| raw | …**美食**…**大悲**… |
| reference | …**美式**…**大杯**… |
| selected spans | `做一杯美食` / `悲就行谢谢`（边界偏移） |
| batch recallTopK | **[]**（两 span 均无候选） |
| KenLM | combinationCount=**0** |

#### d003

| 字段 | 内容 |
|------|------|
| raw | …**少病**…**小背** |
| reference | …**少冰**…**小杯** |
| selected spans | `燕麦`(误) / `少病` / `赶时间小背` |
| batch recallTopK | `少病`→[`烧饼`,`哨兵`]；`燕麦`→[`掩埋`] |
| KenLM | combinationCount=**0** |

### 7.2 启用 restaurant profile 的理论命中（SQLite 桶模拟，只读）

对 **标准 span 文本**（非 batch 实际切分）查询 `lexicon.sqlite`：

| span | 目标词 | general Top8 排名 | restaurant Top8 排名 | domain_lexicon |
|------|--------|-------------------|----------------------|----------------|
| 钟贝 | 中杯 | **#1** | **#1** | ✅ |
| 蓝美马分 | 蓝莓马芬 | **#1** | **#1** | ✅ |
| 美食 | 美式 | #3 | **#1** | ✅ |
| 大悲 | 大杯 | #2 | **#1** | ✅ |
| 小背 | 小杯 | #2 | **#1** | ✅ |
| 少病 | 少冰 | **未入桶** | **未入桶** | ❌（词库无 `少冰`） |

**回答：如果启用 restaurant profile，这些案例理论上能否命中？**

| 案例 | 结论 |
|------|------|
| d001 | **不能端到端命中**。span 边界错误（`钟贝少`/`有蓝美马分`）；即使 profile=restaurant，batch 路径 `domain_hits=0`、recallEmpty |
| d002 | **不能**。span 切在 `做一杯美食`/`悲就行谢谢`，Recall 未执行；profile  alone 无法修复边界 |
| d003 | **部分可能**。`小背→小杯` 在 restaurant 桶 **#1**；但 batch span 为 `赶时间小背`（5 字）且 recallEmpty；`少病→少冰` **词库缺失** |

**关键：** restaurant 词 **已在 SQLite**，瓶颈是 **(1) span 边界 (2) primaryDomain=general 未路由 domain_lexicon (3) 少冰未入库**。

---

## 八、PrimaryDomain 影响评估

### 8.1 当前批测

| 项 | 值 |
|----|-----|
| primaryDomain | **general（200/200）** |
| recallV2 `active_domain` | **base_only（158 FW 全部）** |
| `domain_hits` | **0**（餐饮/技术域词未参与 merge） |
| `industry_routing_used` | **false** |

### 8.2 模拟 restaurant profile 后 Recall TopK 变化

| 目标词 | general 排名 | restaurant 排名 | 变化 |
|--------|-------------|-----------------|------|
| 中杯 | #1 | #1 | 无（已在 domain 桶首位，但 batch 未查 domain） |
| 蓝莓马芬 | #1 | #1 | 无 |
| 美式 | **#3** | **#1** | ⬆ 2 |
| 大杯 | **#2** | **#1** | ⬆ 1 |
| 小杯 | **#2** | **#1** | ⬆ 1 |
| 少冰 | 未命中 | 未命中 | 无（词库缺） |

**中杯 / 大杯 / 蓝莓马芬是否会进入 TopK？**

- **离线桶查询：** 会（已在 domain_lexicon Top1–2）
- **当前 batch 实际路径：** **不会** — batch Recall 诊断 `domain_hits=0`，且餐饮 span 多 recallEmpty 或边界错误

**PrimaryDomain 是否已成为最大瓶颈？**  
**是（与 span 边界并列第一）。** general profile 下 domain_lexicon **完全未参与**；餐饮 24 个可修复 span **Recall Top1 命中 0**。

---

## 九、性能真实性审计

| 阶段 | avg (ms) | p95 (ms) | 说明 |
|------|----------|----------|------|
| **Proposal（IME decode）** | **6.6** | **13** | `pinyinImeV2.decodeMs`；Local Raw-IME Diff 增量可忽略 |
| **Recall v2** | **1.4** | **4** | 各 span `v2_recall_ms` 之和 |
| **Tone 推理** | **7.1** | **11** | ASR 内 `tone_inference_ms` |
| **KenLM batch** | **2842** | **10766** | 仅 **52 案** 有查询；其余为 0 |
| **FW detector 总步** | **761** | **4161** | 含 Proposal+Recall+组合+KenLM |
| Pipeline 总（批测） | 3254 | 6586 | 含 ASR |

**结论：** 全批 avg 被 **52 案 KenLM 长尾** 拉高；**106 案未进 KenLM** 的 FW 步进通常 **<100 ms**。**Proposal/Recall/Tone 均不是性能瓶颈**；KenLM 仅在有句级候选时显著。

---

## 十、最终结论

### 10.1 核心问答

| 问题 | 答案 |
|------|------|
| 158 FW 中真正有价值 span 比例？ | **案例级 70%（111/158）**；**span 级 55%（174/316）** 同长可修复；含餐饮边界问题时实际更低 |
| Recall 命中率？ | **20%（35/174 可修复 span）**；**案例级 22%（34/158）** |
| Tone 是否有效？ | **在已命中 span 内有效（Top1 94%）**；全批影响面太窄 |
| apply=0 最大原因？ | **Recall miss + span 边界（78%）**；其次 **KenLM minDelta（20%）** |
| PrimaryDomain 是否最大瓶颈？ | **是** — domain_lexicon 未路由；餐饮 Recall 命中 **0** |
| KenLM 是否过于保守？ | **是** — 52 案查询全部 pickedIsRaw；但仅 16 案 Recall 命中 |
| 启用 restaurant profile 预计 CER 改善？ | **短期几乎为 0**（需同时修 span 边界 + profile 注入）；**中期** 若 profile+边界修复，餐饮 6 目标词中 **5 词** 可进 Top1，**粗估 cafe 子集 CER 可降 0.03–0.08**（非全批） |
| 下一步 ROI 最高模块？ | **B PrimaryDomain + span 边界/normalizer** |
| 是否冻结 Proposal？ | **建议冻结 Local Raw-IME Diff**；转入 profile + Recall 路由 + span 质量 |

### 10.2 模块 ROI 排序

| 排序 | 模块 | 理由 |
|------|------|------|
| **1** | **B · PrimaryDomain** | domain_hits=0；餐饮词已在库但未参与 merge |
| **2** | **Proposal/Normalizer 边界** | 45% span 边界错误；d001 `钟贝少` 等 |
| **3** | **A · Recall** | 54% 可修复 span recallEmpty；餐饮 0 命中 |
| **4** | **D · KenLM** | 32 案可达但未过 0.03；需更好句级候选后再调阈值 |
| **5** | **C · Tone** | 已命中 span 内 Top1 率 94%；边际收益最小 |

### 10.3 建议下一阶段（审计建议，非开发任务）

1. **批测注入 `primaryDomain=restaurant`**（cafe 场景）并复跑 dialog_200 餐饮子集  
2. **Normalizer span 长度/边界** — 避免 `钟贝少`、`有蓝美马分` 类切分  
3. **词库补 `少冰`** 或明确走 base 同音路径  
4. **KenLM 阈值** — 在 Recall+profile 打通后，对 `maxDelta∈[0,0.03)` 的 20 案做 A/B（只读实验）

---

## 附录：数据文件

| 文件 | 说明 |
|------|------|
| `tests/lexicon-tone-dialog200-local-raw-ime-batch-result.json` | 本轮批测原始 JSON |
| `tests/experiments/_fw-quality-post-local-raw-ime-diff-audit-data.json` | 本审计统计 JSON |
| `tests/experiments/_cafe_sqlite_probe.json` | 餐饮 SQLite 桶只读探针 |
| `tests/experiments/_fw-quality-post-local-raw-ime-diff-audit.mjs` | 只读分析脚本 |

---

**审计约束确认：** 本报告为只读分析，未修改产品代码、未提交补丁、未进行开发。
