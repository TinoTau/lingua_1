<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: docs/current/INDEX.md
Archive Path: docs/archive/HISTORICAL/Lexicon_Maintenance_Checklist_V1.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: docs/current/INDEX.md

# Lexicon Maintenance Checklist V1

**Status:** Frozen companion · **V1** · **2026-07-18**  
**Authority：** [Lexicon_Domain_Contract_Freeze_V1.md](./Lexicon_Domain_Contract_Freeze_V1.md) · [Lexicon_Operation_Guide_V1.md](./Lexicon_Operation_Guide_V1.md)  
**用途：** 每次改 `term_domain_tags` / Patch / Cleanup 前后勾选  
**本轮：** 文档 only · 不改代码

---

## A. 变更前（Pre-flight）

- [ ] 已阅读 Domain Contract Freeze V1 与 Operation Guide V1  
- [ ] 本次变更 **只计划修改** `term_domain_tags`（及必要的物化 + checksum）  
- [ ] **未**计划新增列：`is_base` / `all_domain` / `domain_role` / `general_tag` / `weak_domain`  
- [ ] **未**计划自动挖词批量打标  
- [ ] **未**计划「按 tag 数量阈值自动删标」脚本  
- [ ] 每个待改词已用判据回答：有无 **领域区分能力**（不是「是否术语」）  
- [ ] 弱锚点词（机场/预订/会议/开发/测试/上线/路线/签到/包车/入住/退房等）已标为 **人审**，非盲删  
- [ ] 已排除「全领域」写法；跨行业通用词目标为 **空 tags**

---

## B. 单词语检查（每个变更词）

### B1 判定为 Base

- [ ] 确认为无区分力或合同「必须 Base」类  
- [ ] 执行后：该 `term_id` 的 `term_domain_tags` **行数 = 0**  
- [ ] 未改用 `general` 域「占位」

### B2 判定为 Domain

- [ ] 确认为有区分力  
- [ ] tags ⊆ 真实相关 fine domains（无 meeting/tech 乱贴）  
- [ ] active tag 数 **≤ 5**（能少则少）  
- [ ] 无 capacity/测试污染域  
- [ ] 错域已纠正（例：医生→medical，非 meeting）

### B3 物化

- [ ] 已 rematerialize（或等价同步），`domain_lexicon` 与 tags **一致**  
- [ ] **未**单独手改 `domain_lexicon.domain_id` 作为「真相」

---

## C. 批量变更额外检查

- [ ] 变更词列表已存档（词 · before tags · after tags · 原因）  
- [ ] 批量规模受控；禁止「分类器全量 A 桶」不经抽检直接落库  
- [ ] Meeting / Tech_AI 若大幅删标：已抽检是否误伤弱锚点（会议/机场/上线等）  
- [ ] `manifest.json` checksum / `term_domain_tags` 计数 / `domainAvailability` 已更新  
- [ ] Lexicon Runtime 可成功 load（checksum 通过）

---

## D. 变更后验收（Post）

### D1 数据合同

- [ ] 抽查 ≥10 个 Base 词：`COUNT(tags)=0`  
- [ ] 抽查 ≥10 个 Domain 词：tags 正确且 ≤5  
- [ ] `general` 域 tag 行目标为 **0**（除非书面解冻）  
- [ ] 无 `all_domain` 式「一词挂满可用域」

### D2 禁止项回归

- [ ] 未新增 Base/All-Domain 字段  
- [ ] 未引入自动打标任务进生产流水线  
- [ ] 未部署「按数量自动删 tag」作业

### D3 运行观测（若跑 dialog_200 / Offline Vote）

- [ ] 记录 Meeting / Tech_AI Winner 数量（对比变更前）  
- [ ] 记录 Domain Recall / Base 候选量级（无意外塌陷）  
- [ ] 已知禁止/人审词未被误伤  
- [ ] **未**声称可进 Assembly Diversity（除非 Vote 合同另验通过）

---

## E. 红线（任一触发即 FAIL · 回滚或停更）

| ID | 红线 |
|----|------|
| R-01 | 自动生成 Domain Tag 写入生产库 |
| R-02 | 新增 Base / All Domain 等第二套状态 |
| R-03 | 按 tag 数量自动删标 |
| R-04 | 只改 `domain_lexicon`、不改 `term_domain_tags` |
| R-05 | 用 `general` tag 表达 Base |
| R-06 | 无区分力词保留多域 tags「刷召回」 |

---

## F. 签字

| 角色 | 姓名 | 日期 | 结果 |
|------|------|------|------|
| 变更执行 | | | PASS / FAIL |
| 复核 | | | PASS / FAIL |

**变更单号 / Patch ID：** ________________  

**关联词表附件：** ________________  

---

## G. 速查

```text
空 tags = Base
有区分力 → 最少正确 tags
tags = 唯一 Domain SSOT
禁止自动打标 · 禁止 Base 字段 · 禁止 All Domain · 禁止按数量自动删标
```
