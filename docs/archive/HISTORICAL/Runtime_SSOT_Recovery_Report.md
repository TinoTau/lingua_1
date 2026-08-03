<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: docs/current/INDEX.md
Archive Path: docs/archive/HISTORICAL/Runtime_SSOT_Recovery_Report.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: docs/current/INDEX.md

# Runtime SSOT Recovery Report

```text
STATUS: EXECUTION RECORD

Execution claim for R2 Partial Rollback only.
Cannot replace the current FROZEN contract (Runtime_SSOT_Contract_Freeze.md).
Architecture truth requires code + Frozen Authority + Accepted Baseline Audit.
```

| 字段 | 值 |
|------|-----|
| Document Status | **EXECUTION RECORD** |
| 任务 | Multi-Domain Runtime Rollback Execution（R2） |
| 计划 | `Rollback_Plan.md` |
| 审计 | `Multi_Domain_Runtime_Deviation_Rollback_SSOT_Audit.md` |
| 日期 | 2026-07-19 |
| Lexicon Bundle | **KEEP** · sha256 `62e04b3a43dfc1927713df0d4e2b9b735d30a6f682e916c42dab47ceef57b4ef`（未改） |
| 类型检查 | `tsc -p tsconfig.main.json --noEmit` → **PASS** |
| 回归 | `assemble-domain-aware-span-sets.test.ts` → **PASS** |

---

## 1. 执行摘要

已完成 **R2 Partial Rollback**：

* 删除 Vote 均分、`candidate-domains`、Assembly/Shadow `domains[]` 扩散、迁就测试与 ABI 假阳性测试  
* **保留** Hotword `domains[]` union + 稳定排序（无 `domain` 镜像）  
* **保留** CFG-01 `recallDomainScope` 等非 Multi-Domain 未提交工作（orchestrator 未整文件覆盖）  
* 恢复主链 `domainId` Vote / sameDomain（已知 `domains[0]` 债务回潮，符合 R2）  

未执行 `git reset --hard` / 全目录 restore。

---

## 2. 逐文件最终状态

| 文件 | 最终状态 | 说明 |
|------|----------|------|
| Lexicon Bundle / hierarchy / sqlite | **KEEP** | 未触碰 |
| `lexicon/hotword-types.ts` | **KEEP** | 无 `domain` 字段 |
| `lexicon-v2/lexicon-runtime-v2.ts` | **KEEP** | union + localeCompare sort |
| `lexicon/candidate-score.ts` 等 Hotword 配套 | **KEEP** | 配合无 `domain` |
| `utterance-domain-vote.ts` | **REBUILD** | 去掉均分；保留 `domainId` + winner 诊断字段（避免误伤 CFG-01 metrics） |
| `candidate-domains.ts` | **ROLLBACK** | **已删除** |
| `multi-domain-*.test.ts` | **ROLLBACK** | **已删除** |
| `span-assembly-shared/types.ts` | **ROLLBACK** | `domainId` |
| `coarse-candidate-graph.ts` | **ROLLBACK** | HEAD |
| `select-greedy-…` | **ROLLBACK** | HEAD |
| `matched-domain.ts` | **ROLLBACK** | 已恢复 |
| `v4-types.ts` WindowCandidate | **ROLLBACK** | `domainId`；metrics 字段 **REBUILD** 对齐 orchestrator（非均分） |
| `recall-topk-for-windows.ts` | **ROLLBACK+REBUILD** | `domainId=domains?.[0]`；去掉无效 tone 字段写 |
| `assemble-domain-aware-span-sets.ts` | **ROLLBACK** | `domainId===winner` |
| `window-candidate-to-pick.ts` | **ROLLBACK** | 无 selectedDomain |
| `domain-assembly-types.ts` | **ROLLBACK** | HEAD |
| `emit-v4-evidence.ts` | **ROLLBACK** | Shadow `domainId` |
| `assemble-parent-…` | **ROLLBACK** | HEAD |
| `build-fw-spans-…` | **ROLLBACK** | HEAD |
| `build-sentence-candidates.ts` | **ROLLBACK** | 无 domains/selectedDomain |
| `assemble-domain-aware-span-sets.test.ts` | **ROLLBACK** | HEAD；PASS |
| `span-assembly-v4-orchestrator.ts` | **PARTIAL** | 仅恢复 `domainId` 资格判断；保留 recallDomainScope |
| `fw-detector/types.ts` | **PARTIAL** | 去掉 selectedDomain 等；保留其它诊断扩展 |

---

## 3. 已消除的偏航

| 项 | 状态 |
|----|------|
| Vote `/ domains.length` | **已移除** |
| `filterEligibleDomainsByCoarse` | **已删除** |
| Assembly pick `domains` / `selectedDomain` | **已移除** |
| GraphEdge / Parent* `domains[]` | **已恢复 domainId** |
| Shadow domains 迁移 | **已回滚** |
| ABI skip → PASS 测试 | **已删除** |
| Decision 多副本 `selectedDomain` | **已清除** |

---

## 4. 恢复后 Runtime 架构图

```text
term + term_domain_tags          ← Lexicon Fact SSOT（KEEP v10）
        ↓
Hotword.domains[] (union+sort)   ← KEEP 只读投影
        ↓
WindowCandidate.domainId = domains?.[0]   ← 债务回潮（R2 允许）
        ↓
UtteranceDomainVoteResult        ← 唯一句级 Decision SSOT
        ↓
sameDomain (domainId === winner) + base
        ↓
SpanReplacementPick (text)       ← 无 Lexicon/Vote 污染
        ↓
KenLM (text)
```

Shadow：诊断链，未继续投资新合同。

---

## 5. 证明项

| 证明 | 结果 |
|------|------|
| 无 Decision SSOT 重复（selectedDomain 多写） | **是** |
| 无 DTO 扩散至 Assembly/Graph domains[] | **是** |
| 无 Shadow 新 domains 合同 | **是** |
| 无 Assembly 职责污染 | **是** |
| Lexicon Bundle 未改 | **是** |
| 无均分 Vote | **是** |

---

## 6. 遗留（下一轮，禁止本轮继续开发）

1. `domains[0]` Candidate 压缩债务  
2. DOMAIN_RECALL `DomainWeight` 未落地  
3. parent_fragment 重复计分  
4. Shadow Beam 退役另开 Phase  

合同见：`Runtime_SSOT_Contract_Freeze.md`

---

## 7. 最终状态码

```text
PARTIAL ROLLBACK COMPLETE
```

```text
ROLLBACK EXECUTION COMPLETE — STOP
```

等待人工确认 SSOT Freeze；不得继续 Multi-Domain 开发或优化。
