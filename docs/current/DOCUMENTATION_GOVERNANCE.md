---
title: Repository Documentation Governance
status: CURRENT_SSOT
authority: DOCUMENTATION_GOVERNANCE
baseline: FW_V4_FREEZE_2026_08_03
owner: docs
supersedes:
reviewed_at: 2026-08-04
---

# Documentation Governance — Sole Authority

本文件是仓库 **Documentation Governance** 的唯一 CURRENT Sole Authority。  
所有开发、审计、测试、冻结与文档整理任务必须遵守本规则。

权威入口索引：[`INDEX.md`](./INDEX.md) · 统一入口：[`../INDEX.md`](../INDEX.md)

---

## 1. Documentation Hierarchy

```text
CURRENT SSOT
  → Supporting Contracts
  → Framework Snapshots
  → Acceptance Records
  → Architecture Decisions (ADR)
  → Historical Archive
  → Experimental / Scratch
```

阅读顺序（强制）：

```text
1. Documentation Governance（本文件）
2. Framework Snapshot（当前恢复基线）
3. docs/current/INDEX.md → 对应 Sole Authority
4. Supporting Contract（必要时）
5. Acceptance Records（证据 only）
6. 禁止从 Historical 报告重新推导当前架构
```

---

## 2. Classification Definitions

每份文档必须且只能有一个 Primary Classification：

| Class | Meaning |
|-------|---------|
| `CURRENT_SSOT` | 当前生产架构 / 接口 / 数据合同唯一权威 |
| `SUPPORTING_CONTRACT` | 解释 CURRENT；不得重定义 |
| `FRAMEWORK_SNAPSHOT` | 日期节点恢复基线绑定 |
| `ARCHITECTURE_DECISION` | ADR：为何采用某决策 |
| `ACCEPTANCE_RECORD` | 开发 / 审计 / 测试 / 回归 / 冻结证据 |
| `OPERATING_GUIDE` | 构建 / 运行 / 恢复 / 部署 / 排障 |
| `REFERENCE_DATA` | 参考、示例、非权威规格 |
| `HISTORICAL` / `SUPERSEDED` / `RETIRED` | 追溯；不得作 CURRENT |
| `EXPERIMENTAL` / `SCRATCH` | 实验 / 临时探针产物 |
| `DUPLICATE` | 已识别重复；待清理或已清理 |
| `UNCLASSIFIED` | 禁止长期存在于生产相关路径 |

---

## 3. Sole Authority Rule

```text
每个 Concern 只能存在一个 CURRENT Sole Authority。
```

禁止：

```text
多个 CURRENT / FINAL / LATEST
Acceptance 报告冒充 CURRENT
Supporting 隐式成为第二套架构
从 Historical 覆盖 CURRENT
```

冲突处理：确定权威 → 降级其它文档 → 更新索引 → 记录 migration；**不得直接删除唯一证据**。

Concern 登记以 [`INDEX.md`](./INDEX.md) 与本轮 Acceptance 的 `ssot_conflict_matrix.csv` 为准。

---

## 4. Directory Structure（逻辑目标）

优先复用现有模块路径；**职责清晰优于物理目录完全统一**。

```text
docs/
  INDEX.md                 — 统一入口
  current/                 — CURRENT 入口 + Governance
  supporting/              — Supporting Contracts
  architecture/adr/        — ADR
  framework_snapshots/     — Snapshots
  acceptance/
    Development|Audit|Test|Regression|Freeze|Documentation/
  operating/               — 操作指南入口（可引用 setup/troubleshooting/snapshot Recovery）
  reference/               — 参考资料
  archive/                 — SUPERSEDED / RETIRED / HISTORICAL / EXPERIMENT
  _scratch/                — 临时（非权威）
```

`docs/tone-v2/`、`docs/fw-detector/` 等可继续承载 Sole Authority **正文**；必须由 `docs/current/INDEX.md` 引用，不得平行再造 CURRENT。

---

## 5. Naming Rules

| Kind | Rule |
|------|------|
| CURRENT | 稳定语义名；禁止 `FINAL` / `LATEST` / `NEW` / `V2_COPY` / 日期后缀作为权威身份 |
| Acceptance pack | `docs/acceptance/<Type>/YYYY-MM-DD_<TaskName>/` |
| ADR | `ADR-NNNN-Short-Decision-Name.md` |
| Snapshot | `FW_V4_FREEZE_YYYY_MM_DD`（或项目既有 Snapshot 合同） |
| Historical | 保留原名；移动到 archive 时不改写正文结论 |

禁止文件名：`(1)` `(2)` `copy` `final2`。

---

## 6. Metadata Rules

CURRENT / Supporting / ADR / Snapshot / Acceptance 顶部应有 Metadata（YAML front-matter 或等价表格）。最低字段：

- CURRENT: `status`, `authority`, `baseline`, `reviewed_at`
- Supporting: `status`, `supports`, `baseline`
- Acceptance: `status`, `record_type`, `date`, `baseline`, `proves`
- Historical: `status`, `superseded_by`, `historical_baseline`, `reason`

若文件已有表格 Metadata，沿用现有格式，不强制双格式。

---

## 7. Acceptance Pack Contract

每轮任务只生成 **一个** 正式产物目录：

```text
docs/acceptance/<Type>/YYYY-MM-DD_<TaskName>/
  README.md
  report.md
  summary.json
  *.csv / *.json / callgraph.md / contract.md（按需）
```

`<Type>` ∈ `Development` | `Audit` | `Test` | `Regression` | `Freeze` | `Documentation`

禁止：

```text
同时复制到 tone-v2 / fw-detector / 根目录 / 多个 acceptance
把 Acceptance 当作 CURRENT
修改旧 Snapshot 业务结论
覆盖历史 Acceptance 正文
```

scratch 仅临时脚本与中间产物；正式证据必须进入 Acceptance Pack。

---

## 8. Snapshot Documentation Rule

- Snapshot 绑定当时代码 / 文档 / 数据 / 验收。
- **不取代**模块 Sole Authority。
- 不得改写旧 Snapshot 架构结论。
- 允许更新：导航链接、Governance 引用、阅读顺序、migration map。
- 新阶段冻结 → **新建** Snapshot；不修改旧 Snapshot 身份。

---

## 9. ADR Rule

- 路径：`docs/architecture/adr/`
- 旧 ADR 不修改 Decision 结论；后续决策新增 ADR 并声明 `supersedes`。
- 最低结构：Status · Context · Decision · Consequences · Alternatives · Related SSOT · Related Acceptance

---

## 10. Historical Document Rule

- 保留追溯；禁止删除唯一证据。
- 文首应标明 Status / Superseded By / Last Valid Baseline。
- Historical 内失效链接可保留，但建议声明：

```text
Historical document; paths may refer to repository state at that date.
```

---

## 11. Duplicate Handling

| Action | When |
|--------|------|
| `KEEP_CANONICAL` | Acceptance / CURRENT / Snapshot 正式路径 |
| `DELETE_EXACT_DUPLICATE` | 内容哈希完全相同且无独立证据价值 |
| `REPLACE_WITH_POINTER` | 旧路径仍被外链引用 |
| `MOVE_ARCHIVE` | 有历史价值但非权威 |
| `KEEP_UNIQUE_EVIDENCE` | 探针脚本等唯一可复现证据 |
| `REQUIRES_REVIEW` | 无法自动判断 |

---

## 12. Link Maintenance

- CURRENT / Supporting / Snapshot / Operating / Governance / 统一 INDEX 中的失效链接必须修复。
- Historical 旧链不计入硬门，但需记录。
- 路径迁移必须更新索引与 Snapshot 导航，并写入 migration 记录。

---

## 13. Required Update Sequence

```text
1. 读 Governance + Snapshot + CURRENT SSOT
2. 执行开发 / 审计 / 测试
3. 生成单一 Acceptance Pack
4. 判断是否影响 CURRENT → 更新原 Sole Authority（禁止平行 FINAL）
5. 架构决策 → 新增 ADR
6. 阶段完成 → 新 Snapshot
7. 更新 Index
8. 运行 docs:check
9. 提交代码与文档
```

---

## 14. Documentation Review Gate

执行：

```text
npm run docs:check
```

（实现：`scripts/docs/check-documentation-governance.mjs`，经 `electron_node/electron-node` package script 暴露。）

Gate 至少检查：

- CURRENT Sole Authority 冲突登记
- Acceptance 目录命名
- 缺 README / report / summary
- 禁止后缀 `(1)/(2)/copy/final2`
- CRITICAL 范围失效链接
- Acceptance 误标 CURRENT
- 根目录散落 Acceptance 报告
- 未登记的 Documentation Governance

---

## 15. Git Commit Rule

- 文档治理与业务逻辑分 commit（若同 PR）。
- 不得重写 git history、移动旧 Freeze Tag、改写历史 Acceptance 结论。
- 建议：Governance → Consolidation → Acceptance Record 分提交。

---

## 16. Future Task Output Contract

每次任务开始先确定：

```text
taskId · date · baseline · module · taskType
```

然后只写入对应 Acceptance Type 目录。开发人员与 Cursor **不得**在模块目录另存“最终设计报告”并与 CURRENT 并存。

---

## 17. Orphan Pack Member Rule

Acceptance Pack 内的 CSV / JSON / callgraph / contract / trace 等附件：

```text
只要同目录 README/report/summary 已被 Acceptance Type 合同覆盖，
即视为 PACK_MEMBER，不要求单文件写入 Index。
```

禁止为了把 orphan 指标降到 0 而把数千个附件逐文件加入 Index。

`UNINDEXED_CURRENT` 与未关闭的 `POSSIBLE_CURRENT_OR_SUPPORTING` 仍为硬门。

---

## 18. Historical Link Rule

Historical / Superseded / Retired / 过期 troubleshooting 事故报告中的失效路径：

```text
允许保留原正文；
应声明：Historical document; paths may refer to repository state at that date.
```

此类链接计入 `HISTORICAL_STATE_LINK` 信息债，**不**计入 CRITICAL 硬门。

Living Operating Guides（`docs/operating/INDEX.md`、Recovery Guide、setup 入口）的失效链接必须修复为 0。

---

## 19. Duplicate Evidence Role Rule

内容哈希相同不等于可删：

| Role | Policy |
|------|--------|
| Acceptance formal report | Canonical keep |
| Snapshot sealed copy | Keep — 不得仅因相同删除 |
| Independent acceptance evidence at different dates | Keep both |
| Scratch / generated mirror | Delete or keep noise policy |
| Legacy path still referenced | Pointer preferred over delete |

不得把 `REQUIRES_REVIEW` 长期留在正式治理结果中；必须给出 KEEP / DELETE / POINTER 决策。

---

## 20. Authority Registry Count Rule

两种计数不得混用：

```text
CURRENT_SSOT classification count
  = 被 Primary Classification 标为 CURRENT_SSOT 的文件数

currentAuthorities / Sole Authority registry
  = docs/current/INDEX.md（及 Gate 清单）登记的 Concern→正文 条目数
```

Index 自身、Snapshot Entry、Documentation Governance 可能同时出现在 registry 中；  
**计数差不自动等于 Sole Authority 冲突**。冲突判定以同一 Concern 的实质竞争正文为准。

---

## Related

| Kind | Path |
|------|------|
| ADR | [`../architecture/adr/ADR-0001-Adopt-Repository-Documentation-Governance.md`](../architecture/adr/ADR-0001-Adopt-Repository-Documentation-Governance.md) |
| Acceptance (governance establish) | [`../acceptance/Documentation/2026-08-03_Docs_Repository_Governance_and_Consolidation/`](../acceptance/Documentation/2026-08-03_Docs_Repository_Governance_and_Consolidation/) |
| Acceptance (residual backlog closure) | [`../acceptance/Documentation/2026-08-04_Documentation_Governance_Residual_Backlog_Closure/`](../acceptance/Documentation/2026-08-04_Documentation_Governance_Residual_Backlog_Closure/) |
| Snapshot | [`../framework_snapshots/FW_V4_FREEZE_2026_08_03/`](../framework_snapshots/FW_V4_FREEZE_2026_08_03/) |
