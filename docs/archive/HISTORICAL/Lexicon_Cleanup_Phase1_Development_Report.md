<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: docs/current/INDEX.md
Archive Path: docs/archive/HISTORICAL/Lexicon_Cleanup_Phase1_Development_Report.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: docs/current/INDEX.md

# Lexicon Cleanup Phase1 — Development Report

**Date:** 2026-07-18  
**Type:** 小范围数据治理（仅 `term_domain_tags`）  
**Status:** 已完成 · **等待验收** · **禁止继续开发**

**允许：** 修改 `term_domain_tags`（及 bundle 完整性：`manifest.json` / `checksum.txt`）  
**禁止（本轮未改）：** Runtime · Vote · Assembly · DTO · Candidate · 表结构 · 新字段 · 新配置 · 自动生成逻辑

**脚本：** `electron_node/electron-node/scripts/lexicon/run-lexicon-cleanup-phase1.cjs`  
**结果 JSON：** `tmp/budget_expansion_20260715/lexicon_cleanup_phase1_result.json`  
**DB：** `node_runtime/lexicon/v3/lexicon.sqlite`（bundleVersion **7 → 8**）

---

## Summary

| 指标 | Before | After | Δ |
|------|-------:|------:|--:|
| `term_domain_tags` 行数 | 10121 | **10092** | **-29** |
| 有 tag 的 term（Domain） | 10000 | **9984** | **-16** |
| 无 tag 的 term（合同 Base） | 0 | **16** | **+16** |
| `term` 总数 | 10000 | 10000 | 0 |
| **实际修改词数** | — | **39** | — |
| 计划跳过（不在 term） | — | 3（谢谢/确认/可以） | — |

**Meeting tag 行：** 4828 → **4809**（**-19**）  
**Tech_AI tag 行：** 2543 → **2537**（**-6**）  
**Medical tag 行：** 438 → **444**（**+6**）  
**general tag 行：** 7 → **0**（伪域清除）

禁止清单词（机场/预订/入住/退房/路线/签到/会议/开发/测试/上线/包车）**全部未改**。

---

## 修改范围三类

### 第一类 — Wrong Domain Assignment（17 词）

| Term | Before | After | 原因 |
|------|--------|-------|------|
| 医生 | meeting | medical | 错域 |
| 医院 | meeting | medical | 错域 |
| 主题医院 | meeting | medical | 错域 |
| 头痛 | meeting | medical | 错域 |
| 嗓子 | meeting | medical | 错域 |
| 感冒 | meeting | medical | 错域 |
| 咳嗽 | tech_ai | medical | 错域 |
| 病人 | meeting | medical | 错域 |
| 症状 | tech_ai | medical | 错域 |
| 挂号 | medical, meeting | medical | 去掉多余 meeting |
| 挂号处 | general | medical | general 伪域 → medical |
| 服务器 | tourism_transport | tech_ai | 错域 |
| 套餐 | tourism_hotel | food_order | 错域 |
| 咖啡包 | tourism_hotel | coffee | 错域 |
| 客房 | meeting, tourism_hotel | tourism_hotel | 去掉多余 meeting |
| 大模型 | meeting, tech_ai | tech_ai | 去掉多余 meeting |
| 智能体 | meeting, tech_ai | tech_ai | 去掉多余 meeting |
| 香菜 | general | food_order | general 伪域 → food_order |

### 第二类 — Capacity Validation 污染恢复（5 词）

| Term | Before | After | 原因 |
|------|--------|-------|------|
| 中杯 | bakery, coffee, food_order, **medical**, **meeting**, milk_tea | bakery, coffee, food_order, milk_tea | 去掉 capacity 污染域 |
| 少冰 | bakery, coffee, food_order, **medical**, milk_tea, **tourism_transport** | bakery, coffee, food_order, milk_tea | 同上 |
| 大杯 | coffee, food_order, **medical**, milk_tea, **tech_ai** | coffee, food_order, milk_tea | 同上 |
| 小杯 | coffee, food_order, **medical**, milk_tea, **tourism_route** | coffee, food_order, milk_tea | 同上 |
| 蓝莓马芬 | bakery, food_order, **meeting** | bakery, food_order | 去掉 meeting 污染 |

（**机场 / 预订** 同属 capacity 污染源，但在禁止清单内 → **未处理**。）

### 第三类 — Base Only 清 tags（16 词生效）

| Term | Before | After |
|------|--------|-------|
| 经理 | tech_ai | **[]** |
| 客户 | tech_ai | **[]** |
| 问题 | meeting | **[]** |
| 安排 | meeting | **[]** |
| 今天 | meeting | **[]** |
| 大家 | meeting | **[]** |
| 系统 | tech_ai | **[]** |
| 开始 | tech_ai | **[]** |
| 进行 | meeting | **[]** |
| 你好 | tourism_hotel | **[]** |
| 结束 | meeting | **[]** |
| 可以吗 | general | **[]** |
| 四十码 | general | **[]** |
| 赶时间 | general | **[]** |
| 问一下 | general | **[]** |
| 顺便 | general | **[]** |

**跳过（term 中不存在）：** 谢谢 · 确认 · 可以

---

## 所有修改词列表（39）

```text
医生, 医院, 主题医院, 头痛, 嗓子, 感冒, 咳嗽, 病人, 症状,
挂号, 挂号处, 服务器, 套餐, 咖啡包, 客房, 大模型, 智能体, 香菜,
中杯, 少冰, 大杯, 小杯, 蓝莓马芬,
经理, 客户, 问题, 安排, 今天, 大家, 系统, 开始, 进行, 你好, 结束,
可以吗, 四十码, 赶时间, 问一下, 顺便
```

---

## Domain / Base 统计（合同定义）

| 统计 | Before | After |
|------|-------:|------:|
| Domain Term（`term` 上 ≥1 tag） | 10000 | **9984** |
| Base Term（`term` 上 0 tag） | 0 | **16** |
| tag 行合计 | 10121 | **10092** |

### 各域 tag 行数

| Domain | Before | After | Δ |
|--------|-------:|------:|--:|
| meeting | 4828 | 4809 | **-19** |
| tech_ai | 2543 | 2537 | **-6** |
| medical | 438 | 444 | **+6** |
| coffee | 406 | 407 | +1 |
| food_order | 263 | 265 | +2 |
| tourism_hotel | 310 | 307 | -3 |
| tourism_transport | 249 | 247 | -2 |
| tourism_route | 283 | 282 | -1 |
| bakery | 227 | 227 | 0 |
| milk_tea | 194 | 194 | 0 |
| tourism_pickup | 258 | 258 | 0 |
| transport | 115 | 115 | 0 |
| general | 7 | **0** | **-7** |

---

## 禁止清单验收（保持原样）

| Term | Tags（未变） |
|------|----------------|
| 机场 | meeting, tech_ai, tourism_transport, transport |
| 预订 | food_order, medical, meeting, tourism_hotel, tourism_route, transport |
| 入住 | tourism_hotel |
| 退房 | tourism_hotel |
| 路线 | tourism_route, tourism_transport |
| 签到 | meeting |
| 会议 | meeting |
| 开发 | tech_ai |
| 测试 | tech_ai |
| 上线 | tech_ai |
| 包车 | tourism_route |

---

## 附带完整性更新（非业务逻辑）

| 文件 | 变更 |
|------|------|
| `manifest.json` | checksum 重算；`term_domain_tags` 计数；`domainAvailability`；`lastPatchId=lexicon-cleanup-phase1`；`bundleVersion=8` |
| `checksum.txt` | 与 sqlite sha256 对齐 |

**未修改：** Runtime / Vote / Assembly / DTO / Candidate / 表结构 / 新字段 / fw-config。

---

## Residual（验收须知）

1. **未 rematerialize `domain_lexicon`：** 本轮严格只改 `term_domain_tags`。Domain Recall SQL 为 `domain_lexicon ⋈ term_domain_tags`；个别纠错词（如医生→medical）在 `domain_lexicon` 仍可能只有旧 `domain_id` 行，导致 **标签 SSOT 已对、Domain SQL 暂未对齐**。若验收要求召回一致，需另开「物化同步」小步（本轮禁止继续开发）。  
2. Meeting / Tech_AI Inflation **主体仍在**（4809 / 2537）；Phase1 仅为高置信点修，非全量回 Base。  
3. 弱锚点词（机场/预订/会议…）按令 **原样保留**，待下一阶段。

---

## 验收清单

- [ ] 抽查：医生=`medical`；中杯无 meeting/medical；经理/今天 **无 tags**  
- [ ] 抽查：机场/预订/会议/上线/签到 **未变**  
- [ ] Lexicon load：checksum 通过（manifest v8）  
- [ ] 确认未改 Runtime/Vote/Assembly 代码  

---

## 本轮边界

```text
禁止继续开发
等待验收
```
