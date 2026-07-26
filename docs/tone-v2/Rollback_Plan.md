# Rollback Plan — Multi-Domain Runtime R2

```text
STATUS: EXECUTION RECORD

Historical rollback plan only. Cannot replace Runtime_SSOT_Contract_Freeze.md.
```

| 字段 | 值 |
|------|-----|
| Document Status | **EXECUTION RECORD** |
| 依据 | `Multi_Domain_Runtime_Deviation_Rollback_SSOT_Audit.md` |
| 方案 | **R2 Partial Rollback** |
| 基线 | `HEAD` (`262b3d3`) 单文件恢复；禁止全目录 restore |
| Lexicon Bundle v10 | **KEEP（不碰）** |
| 日期 | 2026-07-19 |

---

## 执行原则

1. 仅回滚 Multi-Domain 偏航改动。  
2. **不得** `git restore` / `checkout` 整个 `fw-detector` 或 `lexicon*` 目录。  
3. 混入 CFG-01 / 其它未提交改动的文件 → **PARTIAL** 或人工 hunk，禁止整文件覆盖。  
4. 不新增兼容层 / shadow / feature flag。

---

## 逐文件判定

| 文件 | 判定 | 方法 | 原因 |
|------|------|------|------|
| Lexicon Bundle / hierarchy / sqlite / manifest | **KEEP** | 不碰 | 审计强制保留 |
| `lexicon/hotword-types.ts` | **KEEP** | 保留去 `domain` | R2 保留 Lexicon 事实清洁 |
| `lexicon-v2/lexicon-runtime-v2.ts` | **KEEP** | 保留 union+sort | R2 保留 Recall merge |
| `lexicon/candidate-score.ts` | **KEEP** | 保留 | 配合 Hotword 无 `domain` |
| `lexicon/lexicon-runtime.ts` | **KEEP** | 保留 | 同上 |
| `lexicon/local-span-recall.ts` | **KEEP** | 保留 | 同上 |
| `lexicon-v2/recall-span-topk-v2.ts` | **KEEP** | 保留 | 去掉 kind 的 `domains[0]` 合理 |
| `lexicon-v2/recall-span-topkv3.ts` | **KEEP** | 保留 | 无 `domain` 镜像 |
| `lexicon-v2/tone-first-tier-collector.ts` | **KEEP** | 保留 | 同上 |
| `lexicon-patch-v3/patch-recall-smoke.ts` | **KEEP** | 保留 | smoke 输出 domains[] |
| `span-assembly-shared/utterance-domain-vote.ts` | **FULL ROLLBACK** | `git checkout HEAD -- <file>` | 删除均分算法 |
| `span-assembly-shared/candidate-domains.ts` | **FULL ROLLBACK** | **删除文件** | 仅服务偏航 API |
| `span-assembly-shared/types.ts` | **FULL ROLLBACK** | checkout HEAD | Graph/Parent `domains[]` → `domainId` |
| `span-assembly-shared/coarse-candidate-graph.ts` | **FULL ROLLBACK** | checkout HEAD | Shadow merge union |
| `span-assembly-shared/select-greedy-longest-parent-term.ts` | **FULL ROLLBACK** | checkout HEAD | Shadow includes |
| `span-assembly-shared/matched-domain.ts` | **FULL ROLLBACK** | checkout HEAD 恢复 | 误删首域工具；开发前存在 |
| `span-assembly-v4/v4-types.ts` | **FULL ROLLBACK** | checkout HEAD | 去掉 domains/selectedDomain |
| `span-assembly-v4/recall-topk-for-windows.ts` | **FULL ROLLBACK** | checkout HEAD | 恢复 `domainId` 压缩（已知债务回潮；R2 允许） |
| `span-assembly-v4/assemble-domain-aware-span-sets.ts` | **FULL ROLLBACK** | checkout HEAD | 回滚 includes/selectedDomain |
| `span-assembly-v4/window-candidate-to-pick.ts` | **FULL ROLLBACK** | checkout HEAD | 文本 pick 合同 |
| `span-assembly-v4/domain-assembly-types.ts` | **FULL ROLLBACK** | checkout HEAD | pick 去 domains |
| `span-assembly-v4/emit-v4-evidence.ts` | **FULL ROLLBACK** | checkout HEAD | Shadow domainId |
| `span-assembly-v4/assemble-parent-term-span-candidates-v4.ts` | **FULL ROLLBACK** | checkout HEAD | Shadow |
| `span-assembly-v4/build-fw-spans-from-coarse-assembly-v4.ts` | **FULL ROLLBACK** | checkout HEAD | 诊断扩散 |
| `build-sentence-candidates.ts` | **FULL ROLLBACK** | checkout HEAD | 去 pick domains/selectedDomain |
| `assemble-domain-aware-span-sets.test.ts` | **FULL ROLLBACK** | checkout HEAD | 迁就测试 |
| `multi-domain-candidate-contract.test.ts` | **FULL ROLLBACK** | **删除** | 迁就均分 |
| `multi-domain-live-bundle.test.ts` | **FULL ROLLBACK** | **删除** | ABI 假阳性 |
| `span-assembly-v4-orchestrator.ts` | **PARTIAL ROLLBACK** | **禁止整文件 checkout** | 含 CFG-01 `recallDomainScope`；仅改 `domains`→`domainId` 资格判断 |
| `fw-detector/types.ts` | **PARTIAL ROLLBACK** | 人工删多域诊断字段 | 保留 CFG-01/rerank 诊断扩展；去掉 selectedDomain 等 |
| `freeze-contract.test.ts` / `fw-detector-orchestrator.ts` / `v4-limits.ts` / 其它 * | **KEEP** | 不碰 | 非 Multi-Domain 核心 / 其它未提交工作 |

---

## 风险与回退

* Recall 保留 Hotword `domains[]` 无 `domain` 时，HEAD `recall-topk` 的 `domain ?? domains?.[0]` **仍可用**。  
* 若 typecheck 失败 → 对冲突点 **REBUILD** 到冻结 `domainId` 合同，不引入均分。  
* 不触碰 Lexicon Bundle。

---

## 下一步

按上表执行 → 生成 `Runtime_SSOT_Contract_Freeze.md` + `Runtime_SSOT_Recovery_Report.md` → **STOP**。
