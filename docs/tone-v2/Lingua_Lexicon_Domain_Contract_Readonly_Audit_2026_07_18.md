# Lingua Lexicon Domain Contract — Read-only Audit

**Date:** 2026-07-18  
**Audit Type:** Read-only Code & Lexicon Audit  
**禁止：** 改代码 / 改库 / 改 `term_domain_tags` / 改 Runtime·Vote·Assembly·配置 / 自动修复 / 自动生成标签  
**审计依据（本轮用户冻结 Rule 1–5）：** Base 默认 · `term_domain_tags` 唯一领域 SSOT · 无全领域词 · ≤5 tags · 无区分力禁止打标  
**对照 SSOT：** [`DOMAIN_SOURCE_UNIFICATION.md`](../fw-detector/DOMAIN_SOURCE_UNIFICATION.md)（`term_domain_tags` = 可用域 / 标签源）  
**DB：** `node_runtime/lexicon/v3/lexicon.sqlite`  
**代码：** `electron_node/electron-node/main/src/lexicon-v2/` · `fw-detector/span-assembly-v4/` · `scripts/lexicon/industry_pack_v{1,2}/`

---

## Executive Verdict

# **当前词库不符合冻结后的 Lexicon Domain Contract**

| 合同条款 | 合规？ | 一句话 |
|----------|:------:|--------|
| Rule 1 — 默认 Base；无 tag = Base Only | **否** | `term` 表 **10000/10000** 均有 ≥1 个 `term_domain_tags`；合同意义下 Base Term = **0** |
| Rule 2 — `term_domain_tags` 唯一领域 SSOT；禁第二套角色字段 | **机制 PASS / 数据 FAIL** | Schema 无 `domain_role`/`is_base`/`is_all_domain`；但存在并行 `domain_lexicon.domain_id` 与 capacity 污染标签 |
| Rule 3 — 无全领域词；跨行业通用词应空 tag | **否** | `经理/客户/问题/安排/系统/今天/大家…` 均带单域 tag；另有 `general` 伪域 7 条 |
| Rule 4 — 单词 ≤5 active fine tags | **否** | **3** 词 >5 tags（`中杯`/`少冰`/`预订`） |
| Rule 5 — 无区分力禁止打标 | **否** | meeting **4828**、tech_ai **2543**；大量弱词/串域词 |

**本轮不提出开发方案。** 仅列违规、原因、影响与建议优先级。

---

## 库存快照（事实）

| 对象 | Count |
|------|------:|
| `term` | 10000（全部 `enabled=1`，全部 `tier=domain`） |
| `term_domain_tags` 行 | 10121 |
| 有 tag 的 term（Domain Term） | **10000** |
| 无 tag 的 term（合同 Base Term） | **0** |
| `base_lexicon`（Runtime Base Recall 表） | 50000 |
| `domain_lexicon` | 10100 |
| `idiom_lexicon` | 22192 |
| multi-tag terms（≥2） | 72 |
| `general` 域 tag 行 | 7 |

**`term.source` 分布：**

| source | terms |
|--------|------:|
| industry_pack_v2 | 7483 |
| industry_pack_v1 | 2387 |
| domain_seed_v1 (+homophone) | 107 |
| expansion_v1_1 | 23 |

---

## 第一部分 — Base Term（`term_domain_tags = 0`）

### 统计

| 定义 | Count |
|------|------:|
| Base Term（合同：`term` 上 tag 数 = 0） | **0** |
| Domain Term（tag 数 ≥ 1） | **10000** |

### Runtime：无 tag == Base？

| 路径 | 行为 | 与合同关系 |
|------|------|------------|
| **Base Recall** | `lookupBaseByPinyinKey` → **`base_lexicon`**，不读 `term_domain_tags` | 物理上“无 tag 表行”的通用词在 **另一张表**；**不是**合同定义的 `term`+空 tags |
| **Domain Recall** | `domain_lexicon` **INNER JOIN** `term_domain_tags` | 无 tag → **不会**进 Domain SQL |
| **Vote / sameDomain** | 依赖候选 `domainId`；无 `domainId`/`general` 不累加 | 与“Base 不参与 Vote”方向一致 |
| **无 tag == 无效词？** | **否**（对 `base_lexicon`）；对 `term` 表则当前 **不存在** 无 tag 行 | 未发现“无 tag 即丢弃整词”的硬逻辑 |

### 结论（Part 1）

- 合同要求的 **Base Only（空 tags）在 `term` 层尚未落地**。  
- Runtime **天然支持** Base 召回，但是通过 **双表模型**（`base_lexicon` vs `domain_lexicon`+tags），与冻结合同“同一 `term`、空 tags=Base”**语义不一致**（见 Part 10-G）。  
- **8079** 个 `term.word` 同时出现在 `base_lexicon`：同一词面既可 Base 召回，又可因 tags 走 Domain/Vote。

---

## 第二部分 — Domain Term 与 tag 数量分布

| Tag Count / term | Terms | Rate |
|-----------------:|------:|-----:|
| 1 | 9928 | 99.28% |
| 2 | 42 | 0.42% |
| 3 | 19 | 0.19% |
| 4 | 6 | 0.06% |
| 5 | 2 | 0.02% |
| **>5** | **3** | **0.03%** |

**按领域 tag 行数（Meeting / Tech_AI Inflation 信号）：**

| domain_id | Tag rows |
|-----------|--------:|
| meeting | **4828** |
| tech_ai | **2543** |
| medical | 438 |
| coffee | 406 |
| tourism_hotel | 310 |
| tourism_route | 283 |
| food_order | 263 |
| tourism_pickup | 258 |
| tourism_transport | 249 |
| bakery | 227 |
| milk_tea | 194 |
| transport | 115 |
| general | 7 |

meeting + tech_ai = **7371 / 10121 ≈ 72.8%** 全部领域标签行。

---

## 第三部分 — >5 tags（违反 Rule 4）

| Term | Tag Count | 所有 tag | 是否需要这么多领域？ |
|------|----------:|----------|----------------------|
| 中杯 | 6 | bakery, coffee, food_order, **medical**, **meeting**, milk_tea | **否** — 饮品规格词；medical/meeting 为 capacity 污染 |
| 少冰 | 6 | bakery, coffee, food_order, **medical**, milk_tea, **tourism_transport** | **否** |
| 预订 | 6 | food_order, **medical**, **meeting**, tourism_hotel, tourism_route, transport | **否** — 跨场景通用动作，合同上更接近 Base Only 或极少数旅游/餐饮 |

另：恰 =5（踩线，需运营审视）：

| Term | Tags |
|------|------|
| 大杯 | coffee, food_order, **medical**, milk_tea, **tech_ai** |
| 小杯 | coffee, food_order, **medical**, milk_tea, **tourism_route** |

=4 含合理餐饮族与污染：

| Term | Tags |
|------|------|
| 堂食/带走/打包/结账/菜单 | bakery, coffee, food_order, milk_tea（餐饮族，可争） |
| 机场 | meeting, tech_ai, tourism_transport, transport（**串域**） |

---

## 第四部分 — 明显错误领域抽样

| Term | Current Tags | 判定 | Wrong Domain Assignment？ | Runtime 问题？ |
|------|--------------|------|:-------------------------:|:--------------:|
| 医生 | meeting | 应为 medical 或 Base+medical | **是（数据）** | 否 — Runtime 忠实读 tag |
| 头痛 | meeting | medical | **是** | 否 |
| 嗓子 | meeting | medical | **是** | 否 |
| 服务器 | tourism_transport | tech_ai / Base | **是** | 否 |
| 你好 | tourism_hotel | **Base Only** | **是（Rule 3/5）** | 否 |
| 常规 | tech_ai | 弱通用 → Base Only | **是（Rule 5）** | 否 |
| 挂号 | medical, **meeting** | medical only | **部分（多标 meeting）** | 否 |
| 机场 | meeting, tech_ai, tourism_transport, transport | 交通为主 | **是（超标+串域）** | 否 |

**结论：** 上表均为 **Wrong Domain Assignment（数据）**，不是 Runtime 把正确标签算错。  
旁证：Vote 审计中 `医生` exact→meeting、parent medical 对抗，根因即本表标签。

---

## 第五部分 — 本应 Base Only 却带 tags

合同示例与扩展抽样（**建议：Base Only = 空 tags**）：

| Term | Current Tags | 建议 |
|------|--------------|------|
| 经理 | tech_ai | **Base Only** |
| 客户 | tech_ai | **Base Only** |
| 问题 | meeting | **Base Only** |
| 安排 | meeting | **Base Only** |
| 系统 | tech_ai | **Base Only** |
| 今天 | meeting | **Base Only** |
| 大家 | meeting | **Base Only** |
| 他们 / 这个 / 那个 / 然后 / 所以 / 还是 / 进行 / 结束 / 时间 / 电话 | meeting | **Base Only** |
| 我们 / 已经 / 因为 / 但是 / 开始 / 公司 | tech_ai | **Base Only** |
| 你们 / 你好 | tourism_hotel | **Base Only** |
| 订单 / 确认 / 谢谢 / 可以 / 一个 | （不在 `term`） | 若仅在 `base_lexicon` → 符合 Base 物理召回；**勿**再写入 tags |

`general` 域 7 词（`顺便/香菜/赶时间/挂号处/可以吗/四十码/问一下`）——合同无“全领域/general_tag”角色；Vote 又跳过 `general` 累加 → **标签语义空洞**，属 Rule 2/3 精神违规。

---

## 第六部分 — 有区分力却缺 tags？

| Term | 状态 | Missing Domain Tags？ |
|------|------|:---------------------:|
| 拿铁 | coffee, food_order | 否 |
| 房卡 | tourism_hotel | 否 |
| 挂号 | medical, meeting | 否（有 medical；多 meeting） |
| 登机牌 | tourism_pickup | 否 |
| 珍珠奶茶 | milk_tea | 否 |
| 热拿铁 / 美式 / 少糖 | 有 coffee 等 | 否 |
| 接口 | tech_ai | 否 |
| 部署 / 会议 | tech_ai / meeting | 否 |
| **接口文档** | **term / base 均不存在** | **不是缺 tag，是缺词条** |

**本轮抽样：未发现“强领域词在 `term` 中存在但 tags 为空”。**  
因 **全体 term 已打标**，Missing Domain Tags（D）在 `term` 层几乎被“过度打标”掩盖；真正缺口更可能在 **未入库的多音节领域短语**（如接口文档），属词条覆盖问题，非空 tags 问题。

---

## 第七部分 — Meeting / Tech_AI Inflation

### 规模

| Domain | Tags | 占全库 tag 行 | 主来源 |
|--------|-----:|-------------:|--------|
| meeting | 4828 | 47.7% | industry_pack_v2 **4532** |
| tech_ai | 2543 | 25.1% | industry_pack_v2 **2231** |

### Top100（meeting，按 prior_score）

前部即含污染与弱相关：`中杯`、`机场`、`蓝莓马芬`、`预订`，其后大量会务词混杂 `主题医院`、`交换机`、`云台`、`上帝` 类二字泛词（meeting 二字词 **4273/4828**）。

### 弱领域 / 串域证据

| 信号 | 证据 |
|------|------|
| 医疗词进 meeting | 医生、头痛、嗓子、感冒、挂号、医院、病人… |
| 饮品词进 meeting | 中杯、蓝莓马芬 |
| 功能词进 meeting/tech_ai | 今天/大家/问题/安排/经理/客户/系统… |
| tech_ai 二字词 | 2223（大量泛化） |
| 生成器侧 | `industry_pack_v2` 的 `DOMAIN_HINTS.meeting` 为超长金融/政务/人力字袋，用于从 base 挖词并 **单域打标** |

**判定：存在 Meeting Inflation 与 Tech_AI Inflation（分类 E），且与历史导入（F）直接相连。**

---

## 第八部分 — Domain Tag 来源

### 写入链路（只读还原）

```text
JSONL domain_tags
  → Lexicon Patch / Industry Pack apply
  → SQLite term + domain_lexicon + term_domain_tags
  → RuntimeDomainRegistry / Domain Recall JOIN
```

| 来源 | 证据 | 问题类型 |
|------|------|----------|
| **industry_pack_v2** | 7483 terms；`generate-industry-pack-v2-entries.mjs` 按 domain quota + char hints 挖词 | **自动批量生成 + 单域默认** |
| **industry_pack_v1** | 2387 terms；会务/科技主题包 | 批量导入；含合理领域词与噪声 |
| **domain_seed_v1** | 种子餐饮/旅游等 | 相对干净，但被后续 patch **追加错误域** |
| **capacity-validation** | `generate-capacity-validation-entries.mjs` 故意给 `中杯→meeting`、`大杯→tech_ai`、`少冰→tourism_transport` 等 | **测试污染未回滚**（仍在库） |
| **expansion_v1_1** | 少量 alias/术语 | 局部 |
| **lexicon_patch_history** | industry-pack-v2-full → v7；v1-full；capacity-validation；exp-v1_1… | 可追溯；**无“清空错误 tag”记录** |

### 确认项

| 问题 | 结论 |
|------|------|
| 自动生成？ | **是**（V2 generator） |
| 历史样本/导入脚本？ | **是** |
| 重复导入 / 追加 tag？ | **是**（种子词上叠加 capacity / pack 多域） |
| 默认 domain？ | V2 挖词时 **每词绑定单一目标域**（非“全领域”，但是 **弱亲和仍强制单域**） |
| 覆盖旧 tag？ | Patch 追加多域 → 出现 >5 与串域；非完整覆盖清洗 |

**无** Schema 级 `domain_role` / `is_base` / `is_all_domain` 第二套字段（Rule 2 机制面 PASS）。

---

## 第九部分 — 对未来 Top3 Domain Vote 的适合性

| 需求 | 现状 | 结论 |
|------|------|------|
| 多域证据应可同时参与 Vote | DB 可存多行 tags；`mergeDomainTierRows` 可填 `domains[]` | 存储层部分支持 |
| Runtime 候选 | `WindowCandidate.domainId = domains[0]`（`recall-topk-for-windows.ts` / `recall-span-topk-v2.ts`） | **单 domain 压缩 — 历史遗留** |
| Vote 公式 | 只用单 `domainId` × SOURCE_WEIGHT；**未用** `domainWeights`/`全 tags` | 与 DSU 文档“domainTags/domainWeights”表述 **DRIFT** |
| Top3 | 无 Top3 聚合；winner = argmax 单域分数 | **未就绪** |
| 标签质量 | 72.8% meeting/tech_ai | 即使实现 Top3，噪声仍会霸榜 |

**结论：** `term_domain_tags` **尚未**满足“可安全支撑 Top3 Domain Vote”的数据前提；且 Runtime 仍假设 **`domains[0]`**。

---

## 第十部分 — 违规分类汇总

### A — Wrong Domain Assignment

| 范围 | 说明 |
|------|------|
| 明确样例 | 医生/头痛/嗓子→meeting；服务器→tourism_transport；你好→tourism_hotel；常规→tech_ai |
| 规模估计 | meeting 中医疗串域至少数十；二字泛词数千级需人工/规则清洗 |
| 原因 | Industry Pack 字袋亲和 + capacity 污染 |
| 影响 | Domain Vote 系统性偏置（见 2026-07-17 Re-validation：meeting+tech_ai=89% winner） |

### B — Base Term Tagged

| 范围 | 说明 |
|------|------|
| 合同 Base Term 数 | **0**（应远大于 0） |
| 样例 | 经理/客户/问题/安排/系统/今天/大家/… |
| 原因 | 全体 `term` 以 domain tier 入库并强制打标 |
| 影响 | 通用词进入 Domain Recall 与 Vote，破坏 Rule 1/3 |

### C — Too Many Domain Tags

| 范围 | 说明 |
|------|------|
| >5 | **3**（中杯/少冰/预订） |
| =5 踩线污染 | 大杯/小杯 |
| 原因 | capacity-validation + 多 pack 追加 |
| 影响 | Rule 4 硬违规；多域噪声放大 Vote |

### D — Missing Domain Tags

| 范围 | 说明 |
|------|------|
| 抽样强领域词 | **未发现**“在 term 中却无 tag” |
| 相关缺口 | 如「接口文档」**整词缺失**（非空 tags） |
| 影响 | 相对 A/B/E 为次要；被过度打标掩盖 |

### E — Meeting / Tech_AI Inflation

| 范围 | 说明 |
|------|------|
| meeting 47.7% / tech_ai 25.1% tag 行 | **确认 Inflation** |
| 原因 | V2 配额与字袋挖词；meeting 字袋过宽 |
| 影响 | 与 A/B 叠加，驱动过度投域 |

### F — Historical Import Problem

| 范围 | 说明 |
|------|------|
| capacity-validation 故意错标 | **仍在生产库** |
| V1/V2 full patch 叠加 | 无回滚清洗 |
| 影响 | 直接造成 C 与部分 A |

### G — Runtime Contract Conflict

| 范围 | 说明 |
|------|------|
| 双表 Base vs 合同“空 tags=Base” | **语义冲突** |
| `domains[0]` 单域 DTO | 阻碍多域/Top3 |
| Vote 忽略 `domainWeights` / 全 tags | 与 DSU 文字 DRIFT |
| 无 tag ≠ 无效（base 表） | 机制可用，但合同未在 `term` 层落地 |
| 影响 | 即使清洗 tags，合同与 Runtime 模型仍需对齐（本轮不断言怎么改） |

---

## 建议优先级（仅排序，非开发方案）

| 优先级 | 类别 | 理由 |
|:------:|------|------|
| **P0** | **A + B + E** | 直接决定 Vote 对错与过度投域；体量最大 |
| **P1** | **F** | capacity/历史污染可定位、可解释，阻塞 Rule 4 |
| **P2** | **C** | 仅 3 词 >5，但属硬违规 |
| **P3** | **G** | Runtime/`domains[0]`/双表与合同对齐（先认清，再动代码） |
| **P4** | **D** | 本轮非主矛盾；缺词条另册 |

---

## 必须回答（收口）

1. **当前词库是否符合冻结 Lexicon Domain Contract？** → **否。**  
2. **哪些地方违反？** → Rule 1/3/4/5 全面违反；Rule 2 Schema 无第二套字段但数据与并行表语义混乱；Runtime 单 `domainId` 与合同多域/Top3 不齐。  
3. **违反原因？** → Industry Pack 自动挖词单域打标 + meeting/tech 配额膨胀 + capacity-validation 污染残留 + `term` 全员 domain tier。  
4. **影响范围？** → 全部 Domain Vote / sameDomain；dialog_200 已观测 meeting/tech_ai 霸榜与错误 winner。  
5. **建议优先级？** → **P0：错误域赋值 + Base 被打标 + Meeting/Tech_AI Inflation**；其次历史污染与 >5 tags；再 Runtime 合同冲突；Missing tags 末位。

---

## 本轮边界

```text
未修改任何代码 / 数据库 / 标签 / 配置
未自动修复
未自动生成标签
未提出开发方案或 RFC
```

**下一步（由用户决定，不在本报告展开）：** 仅在明确授权后，才可进入标签质量修复或 Runtime 合同对齐工作。
