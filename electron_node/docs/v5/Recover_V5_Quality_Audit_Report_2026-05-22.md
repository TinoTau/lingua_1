# Recover V5 识别质量只读审计报告

| 项 | 值 |
|----|-----|
| 版本 | Quality Audit（Post-Alignment Batch） |
| 日期 | 2026-05-22 |
| 状态 | 只读审计（未改代码） |
| 批测数据 | `electron-node/tests/dialog-200-batch-result.json`（对齐后，2026-05-22T13:00） |
| 金标 | `test wav/dialog_200/cases.manifest.json` |
| 前置报告 | [Recover_V5_Test_Report_2026-05-22.md](./Recover_V5_Test_Report_2026-05-22.md)（对齐前批测，指标不同） |
| 代码审计 | [Recover_V5_PostImplementation_Readonly_Audit_2026-05-22.md](./Recover_V5_PostImplementation_Readonly_Audit_2026-05-22.md) |

---

## 审计范围与方法论

**目标**：不是检查「功能是否跑通」，而是分析：

- 当前真实识别质量如何
- Recover V5 实际修复能力到什么阶段
- 真正质量瓶颈在哪里

**方法**：

- 解析 `dialog-200-batch-result.json` 全量 200 case + `summary`
- 对照 `cases.manifest.json` 金标 utterance
- 分析 `window_recall_diagnostics`、`recall_coverage_diagnostics`、`v5_metrics`、`lexicon_recall_trace`、`sentence_repair` 等字段
- **不**做架构重设计、**不**改代码

**重要说明（对齐前 vs 对齐后）**：

| 指标 | 对齐前（旧测试报告） | 对齐后（本报告数据源） |
|------|----------------------|------------------------|
| `sentence_repair_modified` | 53 | **22** |
| 主 skip 标签 | `no_topk_candidate` (147) | **`no_window_expansion_candidate` (178)** |
| `lexicon_pinyin_topk_candidate_total` | 252 | **33** |

机制相同：无 `WindowCandidate` → 句级无法展开；标签在 lexicon 步 vs expansion 步不同。

---

## 1. 总体质量结论

### 1.1 契约 vs 质量（两层结论）

| 维度 | 结论 |
|------|------|
| **契约 / 引擎** | **200/200 PASS**；V5 主链行为符合冻结（diff 窗、TopK-only、sliding=0、out_of_bundle=0、raw pick=0） |
| **识别 / 产品** | dialog_200 上 **Recover 几乎未改善真实听写**；句级正确率 ≈ **0%** |

### 1.2 核心数字

| 指标 | 值 |
|------|-----|
| 写回（modified） | **22 / 200（11%）** |
| Skip | **178 / 200（89%）** |
| TopK 窗级命中率 | **33 / 6313（0.52%）** |
| 词库规模 | **67 条**（`manifest.lexiconCount`） |
| `near_pinyin_attempt_count` | **0** |
| `modified_without_replacement` | **0** |

### 1.3 场景分布（写回仅出现在种子场景）

| 场景 | 总数 | 写回 | 有 WindowCandidate |
|------|------|------|-------------------|
| `lexicon_homophone` | 12 | **12** | **12** |
| `tech_deploy` | 14 | **10** | **10** |
| cafe / meeting / taxi / hospital / … | 188 | **0** | **0** |

**一句话**：V5 **引擎**已达工程验证完成；**Lexicon World 内容**仍是种子/demo，**尚未**进入可运营词库世界。

---

## 2. 当前真实修复率

### 2.1 五类分类（相对 manifest 金标）

| 类别 | 含义 | 数量 | 占比 |
|------|------|------|------|
| **A** | ASR 错 → Recover 局部修对（替换目标词 ∈ 金标） | **~16** | **~8%** |
| **B** | ASR 对 → Recover 不改 | **~0** | **0%** |
| **C** | ASR 错 → Recover skip | **178** | **89%** |
| **D** | ASR 错 → Recover 写回但句级仍远离金标 | **~6** | **~3%** |
| **E** | ASR 对 → Recover 改坏 | **0** | **0%** |

> 合成 dialog_200 的 ASR 几乎全句错误，故 B 类极少。

### 2.2 两层修复率

| 层级 | 修复率 | 说明 |
|------|--------|------|
| **句级**（整句 = 金标） | **≈ 0%** | 22 条写回后仍大量错字 |
| **词级**（种子词命中） | homophone **100%**；tech_deploy **71%**；其他 **0%** |

### 2.3 典型 case

**A 类 — d043（lexicon_homophone）**

| 字段 | 内容 |
|------|------|
| 金标 | 我们下午讨论后选声城方案，先把**候选生成**的接口文档补齐。 |
| ASR | 我们下午讨论后 选生成放安线罢候选生成的结口文当补齐 |
| 写回 | `后选生成` → `候选生成`（1 处） |
| 残留错误 | 「放安线罢」「结口文当」未修 |

**C 类 — d001（cafe）**

| 字段 | 内容 |
|------|------|
| 金标 | 你好，我想点一杯**热拿铁**，中杯，少糖。…**蓝莓马芬**吗？ |
| ASR | 你以好我想点一被热拿铁中被少堂身便温 一下今天油来美马烦吗 |
| diff 窗 | 36（`diffSpanCount=39`） |
| TopK | `pinyinAttemptCount=36`，**`pinyinHitCount=0`** |
| skip | `no_window_expansion_candidate` |

---

## 3. 误修分析

| 类型 | 数量 | 证据 |
|------|------|------|
| 灾难性误修（E） | **0** | `modified_without_replacement=0` |
| 写回但句级仍错（D + 部分 A） | **~22** | 仅 1–2 span 替换，句级仍乱 |
| 替换目标与金标不符 | **~6** | 金标「后选生城」 vs 词库统一修「候选生成」 |

### 3.1 写回模式集中

| 模式 | 次数 |
|------|------|
| `后选生成` → `候选生成` | 13 |
| `*机画/计化/计话/…` → `上线计划` | ~20（多种 ASR 变体） |

### 3.2 误召特征

- 命中条目 **`phoneticScore = 1.0`**（exact 拼音桶），**非** near 误召
- `out_of_bundle_total = 0`
- 未见「把正确句改坏」的 E 类

---

## 4. `no_topk_candidate` / `no_window_expansion_candidate` 根因

### 4.1 当前批测标签

| skip 标签 | 数量 |
|-----------|------|
| `no_window_expansion_candidate` | **178** |
| `no_topk_candidate`（v5_metrics） | **0** |
| `none`（成功写回） | **22** |

**机制**：178 条均为 `window_candidate_count = 0` → 句修复阶段无法展开。

### 4.2 178 条分类（`recall_coverage_diagnostics.whyRejected`）

| 类型 | 含义 | 数量 | 占比 |
|------|------|------|------|
| **A** | Lexicon World **缺词** | **~125** | **~70%** |
| **对齐风险** | segment 与 rank0 不一致 | **~53** | **~30%** |
| **C** | 有候选但被 prior 淘汰 | **0** | — |
| **D** | candidateScore 过低 | **0** | `topkDroppedBelowMinScore=0` |
| **E** | KenLM 过滤（此阶段无候选） | **0** | — |

**最大来源**：**A 类 — Lexicon coverage 不足**（`pinyin_mismatch`），不是 TopK 排序、不是 KenLM、不是 same pinyin 不够近。

### 4.3 与「no_topk_candidate」的关系

对齐前批测 147 条 `no_topk_candidate` 与对齐后 178 条 `no_window_expansion_candidate` 为**同一漏斗**：

```text
diff 窗枚举 → TopK lookup → 0 WindowCandidate → skip
```

差异仅在 skip 打点位置（lexicon 步 vs expansion 步）。

---

## 5. TopK recall 质量分析

| 指标 | 值 |
|------|-----|
| 窗级 lookup 次数 | **6313** |
| TopK 命中 | **33** |
| 命中率 | **0.52%** |
| 有命中的 job | **22 / 200** |
| `topk_hit_jobs_by_term_length` | **仅 4 字窗（22 job）** |

### 5.1 Top1 / Top3 / Top5

- 33 个 `WindowCandidate` 分布在 22 个 job，多数 job 仅 **1–2** 候选
- `rankInTopK` 多为 **1**
- **无法**在 200 条规模统计「金标词是否进 Top3/Top5」——**金标词大多不在词库**

### 5.2 priorScore / phonetic 作用

| 特征 | 观察 |
|------|------|
| `priorScore` | 命中时 **≈ 3.93**（`log1p(frequency)` 迁移，**区分度窄**） |
| `phoneticScore` | 命中时 **= 1.0**（exact），**无排序区分度** |
| 高 prior 垄断 | **未见**（每窗 0–1 hit） |
| 随机合法词 | **否**（`out_of_bundle=0`） |

### 5.3 TopK 是否改善识别质量？

**仅在词库已收录的同音混淆对上有效**（homophone / tech_deploy）；对 general dialog **无效**。

---

## 6. candidateScore 分析

### 6.1 公式（对齐后实现）

```text
candidateScore =
  priorScore
  + phoneticSimilarity
  + exactLengthBonus
  + domainBoost
  - editDistancePenalty
```

### 6.2 实测 breakdown（d019 示例）

```json
{
  "priorScore": 3.93,
  "phoneticSimilarity": 1.0,
  "exactLengthBonus": 0.5,
  "domainBoost": 0,
  "editDistancePenalty": 0.25
}
```

→ `candidateScore ≈ 5.18`

### 6.3 特征贡献排序（有命中样本 n=33）

| 排序 | 特征 | 评价 |
|------|------|------|
| 1 | priorScore (~3.9) | 有贡献，动态范围窄 |
| 2 | phoneticSimilarity (+1.0) | 命中时封顶 |
| 3 | exactLengthBonus (+0.5) | 合理 |
| 4 | editDistancePenalty (−0.25) | 已生效，均值 ≈0.45，无 >1 |
| 5 | domainBoost | 本批 **0** |

批测：`edit_distance_penalty_sum=14.75`，`edit_distance_penalty_samples=33`。

因每窗通常 0–1 命中，**TopK 排序压力极小**。

---

## 7. KenLM 实际贡献分析

| 维度 | 值 / 结论 |
|------|-----------|
| 跑 KenLM 的 job | **22** |
| 句候选池 | 合计 **33**（多数 job 仅 **2** 候选） |
| `picked_from_raw_ctc_nbest` | **0** |
| `kenlm_worse_than_baseline` skip | 本批未见大量触发 |

### 7.1 四类判断

| 问题 | 结论 |
|------|------|
| A. 无 KenLM 时正确率 | 候选高度同质，**去掉 KenLM 多半仍选同类句**（需 A/B 验证） |
| B. 从多合法句中选对 | **极少数**；1–2 候选时 KenLM **几乎无选择空间** |
| C. 错 veto 对句 | **未见批量证据** |
| D. KenLM 真正作用 | **tie-break + 通顺度微调**，**非** dialog_200 质量主因 |

| 统计项 | 数量 |
|--------|------|
| KenLM 有贡献（打分）的 case | **~22** |
| KenLM 错误 veto | **~0** |
| KenLM 无影响（未进句级） | **178** |

---

## 8. same pinyin 是否足够

| 问题 | 基于 batch 的回答 |
|------|------------------|
| 成功修复是否靠 same pinyin？ | **是**（`near_pinyin_attempt_count=0`，`phoneticScore=1`） |
| 失败是否需要 near pinyin？ | **否占主导**（失败主因 **缺词**） |
| 开启 near 能否救 cafe？ | **不能**（「热拿铁」「你好」不在词库） |
| 候选爆炸风险 | 67 词索引风险有限；大词库未验证 |

### 8.1 失败原因比例（本批）

| 原因 | 占比 |
|------|------|
| **没词**（Lexicon World 缺） | **~70%+** |
| **对齐风险** | **~30%** |
| **拼音不够近** | **≈ 0%** |

**结论**：same pinyin **对已收录种子词足够**；对 dialog_200 **远远不够**。

---

## 9. Lexicon World Coverage 分析

| 类别 | 覆盖 / 写回 |
|------|-------------|
| 通用中文口语（咖啡、医院、打车…） | **≈ 0%** 写回 |
| AI / 技术词（候选生成、上线计划） | **高**（种子场景） |
| 中英混合 | **未验证**（`mixed_token_count=0`） |
| 地名 / 人名 / 旅游 / 餐饮 | **≈ 0%** |
| confusion 表（194 行） | 元数据存在，**不走 observed 主路径** |

**最缺**：场景实体词 + 高频口语词 + 与 ASR 错误音节对齐的合法词条。

**当前状态**：**框架是 Lexicon World Model**；**内容不是**（67 词 ≠ 世界模型）。

---

## 10. 当前真正瓶颈（优先级排序）

| 优先级 | 瓶颈 | 批测证据 |
|--------|------|----------|
| **P0-1** | **Lexicon coverage 极小** | 6313 lookup → 33 hit；178 skip；非 seed 场景 0 写回 |
| **P0-2** | **CTC / 合成 ASR 质量差** | 金标与 ASR 编辑距离极大 |
| **P0-3** | **segment ↔ rank0 对齐** | 73/200 `segment_synthetic`；53 `segment_alignment_risk` |
| **P1** | **priorScore 区分度低** | 命中 prior ≈ 3.93 扎堆 |
| **P1** | **词级修复 ≠ 句级正确** | 22 写回仅 1–2 词 |
| **P2** | KenLM 选择空间不足 | 每 job ~2 候选 |
| **P2** | same pinyin vs near | **非本批主矛盾** |
| **P2** | diff / 窗长 | 链路正常（ratio=1，sliding=0） |

---

## 11. Recover V5 成熟度评估

| 等级 | 判定 |
|------|------|
| A 实验性 | |
| **B 工程验证完成** | **✓ 当前** |
| C 可长期维护框架 | 接近（配置/trace 已对齐，词库未跟上） |
| D 生产可运营 | 未达到 |

**原因**：契约全绿 + homophone 12/12 证明引擎可信；dialog_200 句级修复率 ~0% 证明内容/覆盖未就绪。

---

## 12. 下一阶段真正应该做什么

> **前提**：Recover V5 **引擎已冻结**，不恢复 V4、不开 near、不动主链架构。

### P0（决定真实识别上限）

1. **扩充 Lexicon World（运营/数据）**  
   - 从 dialog_200 金标 + 场景词频导出词条清单（餐饮、出行、医疗、会议…）  
   - 目标：降低 `pinyin_mismatch`（当前 ~125），而非改 TopK 公式  

2. **建立句级评测基线**  
   - 指标：CER/WER vs 金标、词级命中、句级可用率  
   - **不要只用契约 PASS 衡量质量**  

3. **segment 与 CTC rank0 对齐**  
   - 73 条 mismatch 缩小可用 diff 窗；属聚合/产品策略  

### P1（重要但非瓶颈）

4. **priorScore 运营分化**（避免 3.93 扎堆）  
5. **区分词级成功 vs 句级成功**（报表拆分）  
6. **关 KenLM 的 A/B**（验证净收益）  

### P2（后置）

7. near pinyin 仅对 in-bundle 近音做小流量试验  
8. diff span 合并、trace 展示  
9. KenLM 性能调优  

---

## 13. 十个核心问题 — 速查表

| # | 问题 | 结论 |
|---|------|------|
| 1 | 实际修复能力？ | 种子同音 **强**；真实对话 **极弱** |
| 2 | 修复率是否有效？ | **词级种子有效**；**句级无效** |
| 3 | 是否存在误修？ | **无 E**；**大量 D（句仍错）** |
| 4 | no_topk 含义？ | 当前为 **no_window_expansion**；本质 **TopK 无命中** |
| 5 | 瓶颈？ | **词库 coverage ≫ ASR ≫ 对齐 ≫ prior ≫ KenLM** |
| 6 | same pinyin 够吗？ | **对已收录词够**；**对 dialog_200 不够** |
| 7 | priorScore 有效吗？ | **形式上有效**；**区分度不足** |
| 8 | TopK 改善质量吗？ | **仅 in-bundle 混淆** |
| 9 | 「能修但词库没有」？ | **~70%+** skip 属此类 |
| 10 | Lexicon World Model 阶段？ | **框架是；内容不是** |

---

## 14. 批测关键字段索引（便于复现）

| 字段路径 | 用途 |
|----------|------|
| `summary.v5_summary` | V5 聚合指标 |
| `summary.qualityConfig` | runtime snapshot |
| `summary.recall_why_rejected_distribution` | skip 根因 |
| `cases[].extra.window_recall_diagnostics` | diff 窗 / TopK 尝试 |
| `cases[].extra.recall_coverage_diagnostics` | 无候选原因 |
| `cases[].extra.window_candidates` | WindowCandidate + breakdown |
| `cases[].extra.sentence_candidate_trace` | KenLM 句级 trace |
| `cases[].extra.lexicon_manifest_ready` | manifest 就绪信息 |

---

## 15. 相关文档

| 文档 | 说明 |
|------|------|
| [Recover V5 冻结方案](./Recover%20V5%20冻结方案.md) | 架构基准 |
| [Recover_V5_PostImplementation_Alignment_Report_2026-05-22.md](./Recover_V5_PostImplementation_Alignment_Report_2026-05-22.md) | 对齐修正开发报告 |
| [Recover_V5_Test_Report_2026-05-22.md](./Recover_V5_Test_Report_2026-05-22.md) | 契约测试报告（对齐前批测） |

---

*本报告由只读质量审计生成，未修改仓库代码。*
