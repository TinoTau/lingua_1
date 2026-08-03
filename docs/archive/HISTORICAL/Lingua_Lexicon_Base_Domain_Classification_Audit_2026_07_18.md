<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: CURRENT SSOT + Acceptance Records
Archive Path: docs/archive/HISTORICAL/Lingua_Lexicon_Base_Domain_Classification_Audit_2026_07_18.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: CURRENT SSOT + Acceptance Records

# Lingua Lexicon Base / Domain Classification Audit

**Date:** 2026-07-18  
**Audit Type:** Read-only Lexicon Classification Audit  
**禁止：** 改代码 / 改库 / 改 `term_domain_tags` / Runtime·Vote·Assembly·配置 / 自动修复 / 自动生成标签  

**合同依据（冻结）：**

1. 所有 term 默认属于 Base。  
2. 仅具有明显领域区分能力的词才允许拥有 `term_domain_tags`。  
3. 无区分力的词（即使跨行业常见）→ `term_domain_tags = 空`（Base Only）。  
4. 真正有区分力的词（拿铁、房卡、挂号、登机牌、珍珠奶茶、接口、部署、MRI…）→ 允许 tags。

**上游：** [Lexicon Domain Contract Readonly Audit](./Lingua_Lexicon_Domain_Contract_Readonly_Audit_2026_07_18.md)  
**DB：** `node_runtime/lexicon/v3/lexicon.sqlite`（`term` = 10000，全部当前有 tag）  
**离线分类器（只读）：** `tests/experiments/analyze-lexicon-base-domain-classification.py`  
**完整词表 JSON：** `tmp/budget_expansion_20260715/lexicon_base_domain_classification_audit.json`

---

## Executive Verdict

| 桶 | Count | Rate | 含义 |
|----|------:|-----:|------|
| **A 建议迁回 Base** | **7216** | 72.2% | 应清空 `term_domain_tags` |
| **B 建议保留 Domain** | **557** | 5.6% | 高置信：有强领域标记且标签对齐 |
| **C 明显错误领域** | **69** | 0.7% | 标签错 / 污染 / 串域（可与 A/B/D 重叠标注） |
| **D 需运营人工确认** | **2166** | 21.7% | 有 tag 但无强标记，或弱会议/科技形态 |

**核心结论：**

- 当前库对「是否应拥有 tags」严重过标：约 **3/4** 建议直接回 Base。  
- Meeting / Tech_AI 膨胀是主因：meeting 标签词中 **98.7%** 建议回 Base；tech_ai **94.3%**。  
- 「保留 Domain」高置信仅 **557**；另有 **2166** 边界词需人审（其中大量可能仍是合法 Domain，只是本轮标记表未覆盖）。  
- **未修改任何数据。**

---

## 方法说明（只读启发式）

分类器 `heuristic_contract_classifier_v1`：

| 规则 | 动作 |
|------|------|
| 合同显式 Base Only 表 + 无标记通用词 | → **A** |
| 强领域标记（咖啡/医疗/酒店/接机/科技术语等）且 tag 对齐 | → **B** |
| 强标记但 tag 错误 / capacity 污染 / `general` 伪域 | → **C**（并给出建议保留域） |
| 无强标记的 meeting/tech 二字词与 pack 导入 | → **A**（Inflation） |
| 弱「会务/科技」形态或细域有 tag 无强标记 | → **D** |

**局限（必须阅读）：**

- **非人工金标**；B 为高置信下限，可能漏掉合法 Domain（落入 D）。  
- 部分会务核心词（如「会议」）因落入通用弱词表被划入 **A**——运营可上调为 B/D。  
- 「机场」「预订」因无强标记 + 污染 → **A**（Base Only 符合合同「跨场景通用」；若业务要坚持交通/酒店域，属 **D 人审**）。  
- MRI 等词 **不在 `term` 表** → 不参与本轮分类。

完整 `words[]` 见 JSON（A/B/D 全量词表；C 全量明细）。

---

## A — 建议迁回 Base 的词

| 指标 | 值 |
|------|---:|
| Count | **7216** |
| 主来源 | industry_pack_v2: 6751 · v1: 459 · expansion: 4 · seed: 2 |

**按 reason：**

| reason | Count |
|--------|------:|
| short_unmarked_in_meeting_or_tech | 6336 |
| pack_imported_no_discriminative_marker | 714 |
| no_domain_discriminative_power | 166 |

**合同示例覆盖（在 `term` 内者）：**

| Term | 本轮桶 | 说明 |
|------|--------|------|
| 经理 / 客户 / 安排 / 问题 / 系统 / 今天 / 大家 / 进行 / 开始 / 你好 | **A** | 符合 Base Only |
| 订单 / 确认 / 谢谢 / 可以 | 不在 `term` | 物理上未打 domain tag；保持空 tags 即可 |

**代表性样本（完整 7216 词见 JSON `A_to_base.words`）：**

| Term | Current Tags | reason |
|------|--------------|--------|
| 经理 | tech_ai | no_domain_discriminative_power |
| 客户 | tech_ai | 同上 |
| 问题 | meeting | 同上 |
| 安排 | meeting | 同上 |
| 今天 | meeting | 同上 |
| 大家 | meeting | 同上 |
| 你好 | tourism_hotel | 同上 |
| 上帝 / 上午 / 一定 / 云台 | meeting | short_unmarked… |
| 一口同声 / 万用手册 / 个人资料 | meeting | pack_imported… |
| 交换机 | meeting | pack_imported… |
| 预订 | 六域（含 medical/meeting） | Base Only + 污染 |
| 机场 | meeting+tech_ai+交通 | 污染；合同偏 Base / 人审交通 |

**建议：** 清空上述词的全部 `term_domain_tags`（本轮不执行）。

---

## B — 建议保留 Domain 的词

| 指标 | 值 |
|------|---:|
| Count | **557** |
| 主来源 | industry_pack_v1: 493 · domain_seed: 49 · v2: 11 · expansion: 4 |

**合同正向样例：**

| Term | Current Tags | 判定 |
|------|--------------|------|
| 拿铁 | coffee, food_order | **B 保留** |
| 房卡 | tourism_hotel | **B 保留** |
| 登机牌 | tourism_pickup | **B 保留** |
| 珍珠奶茶 | milk_tea | **B 保留** |
| 接口 | tech_ai | **B 保留** |
| 部署 | tech_ai | **B 保留** |
| 热拿铁 / 美式 | coffee… | **B 保留** |
| 挂号 | medical, meeting | **C**（保留 medical，去掉 meeting） |
| MRI | — | **缺词条**（非分类问题） |

**代表性保留样本：**

| Term | Tags | 强域 |
|------|------|------|
| 上线 / 候选 / 接口 / 联调 / 令牌 / 优化器 / 二级缓存 | tech_ai | tech_ai |
| 三段萃取 / 二段萃取 | coffee | coffee |
| 专家门诊 / 专科门诊 / 中国护士 | medical | medical |
| 专车 | tourism_transport | tourism_transport |
| 中国大酒店 / 中央酒店 / 产权酒店 | tourism_hotel | tourism_hotel |
| 举牌 / 举牌区 | tourism_pickup | tourism_pickup |
| 乌龙茶 | milk_tea | milk_tea |
| 乡村面包 | bakery | bakery |
| 会务 / 议程 / 纪要 / 路演 / 签到 / 话筒 / 董事会 | meeting | meeting |

完整词表：JSON `B_keep_domain.words`（557）。

---

## C — 明显错误领域

| 指标 | 值 |
|------|---:|
| Count（含 also_wrong） | **69** |
| 主类型 | 医疗→meeting；capacity 污染；细域互串；`general` 伪域 |

### 高优先级错误（摘录）

| Term | Current Tags | 建议保留 Tags | 错误类型 |
|------|--------------|---------------|----------|
| 医生 | meeting | **medical** | Wrong Domain Assignment |
| 头痛 | meeting | **medical** | 同上 |
| 嗓子 | meeting | **medical** | 同上 |
| 感冒 | meeting | **medical** | 同上 |
| 医院 / 主题医院 | meeting | **medical** | 同上 |
| 咳嗽 | tech_ai | **medical** | 同上 |
| 挂号 | medical, meeting | **medical** | 多余 meeting |
| 挂号处 | general | **medical** | general 伪域 |
| 服务器 | tourism_transport | **tech_ai**（人审） | 串域；落 D/C 交界 |
| 大模型 | meeting, tech_ai | **tech_ai** | 多余 meeting |
| 客房 | meeting, tourism_hotel | **tourism_hotel** | 多余 meeting |
| 中杯 | 6 域含 medical/meeting | **coffee**（+餐饮族人审） | capacity 污染 |
| 少冰 / 大杯 / 小杯 | 含 medical/tech/transport | **coffee** / 饮品族 | capacity 污染 |
| 蓝莓马芬 | bakery, food_order, meeting | **bakery** | 多余 meeting |
| 咖啡包 | tourism_hotel | **coffee** | 串域 |
| 套餐 | tourism_hotel | **food_order** | 串域 |
| 可以吗 / 四十码 | general | **空（Base）** | 禁止 general_tag |

全量 69 条明细：JSON `C_wrong_domain.items`。

---

## D — 需要运营人工确认的边界词

| 指标 | 值 |
|------|---:|
| Count | **2166** |

**按 reason：**

| reason | Count | 人审提示 |
|--------|------:|----------|
| domain_tagged_without_strong_marker | 2135 | 细域有 tag、本轮无强标记 → 可能仍是合法 Domain |
| meetingish_without_strong_lexicon_marker | 13 | 弱会务形态 |
| techish_without_strong_lexicon_marker | 14 | 弱科技形态 |
| unclassified_needs_human | 4 | 其它 |

**人审原则（合同）：**

- 问：去掉该词后，能否仍可靠区分「这句话属于哪一细域」？  
- 能 → 保留最少必要 tags（≤5）。  
- 不能 → 迁回 Base（空 tags）。  
- 禁止用「多行业都会说」作为打标理由。

完整词表：JSON `D_boundary.words`（2166）。

---

## E — Meeting Inflation

| 指标 | Count | Rate |
|------|------:|-----:|
| 当前带 meeting tag 的 term | 4828 | 100% |
| 建议迁回 Base（A） | **4764** | **98.7%** |
| 建议保留 Domain（B） | 33 | 0.7% |
| 边界（D） | 13 | 0.3% |
| 错误域相关（C） | 20 | 0.4% |

**判定：存在严重 Meeting Inflation。**

- 主体来自 industry_pack_v2 字袋挖词 + 单域强制打标。  
- 二字无标记词大量灌入 meeting（与 Contract Readonly Audit 一致）。  
- 真正高置信保留的会务区分词仅约 **33**（议程/纪要/会务/路演/签到/同传相关标记等）。

---

## F — Tech_AI Inflation

| 指标 | Count | Rate |
|------|------:|-----:|
| 当前带 tech_ai tag 的 term | 2543 | 100% |
| 建议迁回 Base（A） | **2399** | **94.3%** |
| 建议保留 Domain（B） | 122 | 4.8% |
| 边界（D） | 14 | 0.6% |
| 错误域相关（C） | 9 | 0.4% |

**判定：存在严重 Tech_AI Inflation。**

- 高置信保留约 **122**（接口/部署/缓存/令牌/优化器/联调/上线/评测标记等）。  
- `经理/客户/系统/公司/因为/已经…` 等均在 A，符合 Base Only。

---

## G — 预计迁回 Base 后各 Domain Tag 数量变化

**投影假设（只读推演，未写库）：**

1. **A** → 删除该词全部 tags。  
2. **B** → 保留 `keep_tags_if_any`（对齐强域）。  
3. **C** → 仅保留建议域（纠正串域/污染）。  
4. **D** → **暂不改**（人审前上界偏保守）。  
5. `general` → 投影中清除。

| Domain | Current Tag Rows | After A→Base（D 不变） | Δ |
|--------|-----------------:|----------------------:|--:|
| meeting | 4828 | **46** | **-4782** |
| tech_ai | 2543 | **140** | **-2403** |
| medical | 438 | 435 | -3 |
| coffee | 406 | 377 | -29 |
| tourism_hotel | 310 | 301 | -9 |
| tourism_route | 283 | 283 | 0 |
| food_order | 263 | 248 | -15 |
| tourism_pickup | 258 | 248 | -10 |
| tourism_transport | 249 | 247 | -2 |
| bakery | 227 | 221 | -6 |
| milk_tea | 194 | 176 | -18 |
| transport | 115 | 113 | -2 |
| general | 7 | **0** | **-7** |
| **合计（约）** | **10121** | **~2635** | **~-7486** |

**解读：**

- Inflation 域（meeting / tech_ai）在「只迁 A、冻结 D」后即塌缩一个数量级以上。  
- 餐饮/旅游/医疗行数变化较小：因其词更多落在 **D（人审）** 或 **B**，而非 A。  
- 若运营将 D 中无区分力者继续迁 Base，meeting/tech_ai 以外细域仍会再降；**最终 B+审过的 D 才是合同合规 Domain 集**。

更激进投影（额外压缩无标记 D）见 JSON `projected_aggressive_demote_unmarked_D`（本报告主表采用保守「D 不变」）。

---

## 汇总：A–G 对照

| 桶 | Count | 一句话 |
|----|------:|--------|
| A 迁回 Base | 7216 | 不应拥有 tags |
| B 保留 Domain | 557 | 高置信应有 tags |
| C 错误领域 | 69 | 标签错，需改域或回 Base |
| D 人审边界 | 2166 | 是否保留 tags 待定 |
| E Meeting Inflation | 4764/4828 →Base | 确认 |
| F Tech_AI Inflation | 2399/2543 →Base | 确认 |
| G 投影 | meeting 4828→46 等 | 见上表 |

---

## 证据文件

| 文件 | 内容 |
|------|------|
| `tmp/budget_expansion_20260715/lexicon_base_domain_classification_audit.json` | 全量 words、C 明细、投影、样本 |
| `tests/experiments/analyze-lexicon-base-domain-classification.py` | 可复现只读分类器 |

---

## 本轮边界

```text
未修改代码 / 数据库 / term_domain_tags / Runtime / Vote / Assembly / 配置
未自动修复
未自动生成标签
```

**收口一句话：** 按冻结合同，当前词库约 **72%** 的已打标 term 建议迁回 Base；Meeting/Tech_AI 膨胀主导；仅约 **5.6%** 高置信保留 Domain，**21.7%** 交运营人审。
