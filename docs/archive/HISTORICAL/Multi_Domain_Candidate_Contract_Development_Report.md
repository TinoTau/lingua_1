<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: docs/current/INDEX.md
Archive Path: docs/archive/HISTORICAL/Multi_Domain_Candidate_Contract_Development_Report.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: docs/current/INDEX.md

# Multi-Domain Candidate Contract Development Report

```text
STATUS: REJECTED / SUPERSEDED

This report does not describe the current runtime architecture.
Its PASS verdict was invalidated by:
Multi_Domain_Runtime_Deviation_Rollback_SSOT_Audit.md

Do not use this document as a development or acceptance baseline.
Current authority: Runtime_SSOT_Contract_Freeze.md (Runtime SSOT Contract V1)
```

| 字段 | 值 |
|------|-----|
| Document Status | **REJECTED / SUPERSEDED** |
| 任务 | Multi-Domain Candidate Contract Repair |
| 审计基线 | `docs/tone-v2/Multi_Domain_Candidate_Contract_Audit.md` |
| Bundle | `node_runtime/lexicon/v3` · bundleVersion **10** · PatchId `lexicon-domain-hierarchy-completion-v1` |
| 性质 | Runtime 代码合同修复（**未改 Lexicon 数据**） |
| 日期 | 2026-07-19 |
| Verdict | **PASS（已作废）** |

---

## 1. 审计基线

审计结论：`B` + `C` + `D`。主压缩点：

```text
recall-topk-for-windows.ts
domainId = hotword.domain ?? hotword.domains?.[0]
```

目标合同：

```ts
domains: string[]      // 词库事实
selectedDomain?: string // Vote 后决策
```

Vote 前禁止 `domains[0]` / 单值压缩；禁止按 domain 复制 Candidate。

---

## 2. 修改文件

| 文件 | 变更 |
|------|------|
| `lexicon/hotword-types.ts` | 删除 `domain?` |
| `lexicon/candidate-score.ts` | `hotwordDomains` 仅读 `domains[]`，Base→`[]` |
| `lexicon/lexicon-runtime.ts` | 不再写 `domain: domains[0]` |
| `lexicon/local-span-recall.ts` | 去掉 `hotword.domain` fallback |
| `lexicon-v2/lexicon-runtime-v2.ts` | merge union + 字典序排序；删除 `domain` 双写 |
| `lexicon-v2/recall-span-topk-v2.ts` | 分类不再用 `domains[0]` |
| `lexicon-v2/recall-span-topkv3.ts` | ngram Hotword 仅 `domains[]` |
| `lexicon-v2/tone-first-tier-collector.ts` | tier 推断仅看 `domains.length` |
| `fw-detector/span-assembly-shared/candidate-domains.ts` | **新增** union/sort/eligible |
| `fw-detector/span-assembly-shared/utterance-domain-vote.ts` | 读 `domains[]`；权重 `/ length` |
| `fw-detector/span-assembly-shared/types.ts` | GraphEdge/Evidence → `domains[]` |
| `fw-detector/span-assembly-shared/coarse-candidate-graph.ts` | merge **union** domains |
| `fw-detector/span-assembly-shared/select-greedy-longest-parent-term.ts` | `includes` |
| `fw-detector/span-assembly-v4/v4-types.ts` | `domains` + `selectedDomain` + `termId` |
| `fw-detector/span-assembly-v4/recall-topk-for-windows.ts` | **移除压缩**；保留完整 `domains[]` |
| `fw-detector/span-assembly-v4/assemble-domain-aware-span-sets.ts` | `includes(selectedDomain)` |
| `fw-detector/span-assembly-v4/window-candidate-to-pick.ts` | 传 `domains`/`selectedDomain` |
| `fw-detector/span-assembly-v4/domain-assembly-types.ts` | pick 合同更新 |
| `fw-detector/span-assembly-v4/emit-v4-evidence.ts` | edges/evidence 用 `domains[]` |
| `fw-detector/span-assembly-v4/assemble-parent-term-span-candidates-v4.ts` | union domains |
| `fw-detector/span-assembly-v4/build-fw-spans-from-coarse-assembly-v4.ts` | 诊断字段拆分 |
| `fw-detector/span-assembly-v4/span-assembly-v4-orchestrator.ts` | voteEligible 改读 `domains` |
| `fw-detector/build-sentence-candidates.ts` | pick metadata |
| `fw-detector/types.ts` | candidateDomains / selectedDomain / votedFineDomain |
| `lexicon-patch-v3/patch-recall-smoke.ts` | 输出 `domains[]` |
| 测试 | `multi-domain-candidate-contract.test.ts`、`multi-domain-live-bundle.test.ts`、既有测试迁移 |

---

## 3. 删除文件或字段

| 项 | 说明 |
|----|------|
| `HotwordEntry.domain` | 删除 |
| `WindowCandidate.domainId` | 删除，改 `domains[]` |
| `GraphEdge.domainId` / `ParentTermEvidence.domainId` / `ParentSpanCandidate.domainId` | 删除 |
| `SpanReplacementPick.domainId` | 删除 |
| `matched-domain.ts` | 删除（首域挑选器，无调用方） |
| `domains[0]` 压缩路径 | 删除 |

**保留（非 Candidate 合同）：** session `primaryDomain`、recall scope `domainIds`、ngram 表列 `domain_id`、industry route `domainId`。

---

## 4. DTO before/after

**Before**

```ts
HotwordEntry { domain?: string; domains?: string[] }
WindowCandidate { domainId?: string }
```

**After**

```ts
HotwordEntry { domains?: string[] }           // Base = [] / undefined
WindowCandidate {
  termId?: string;
  domains: string[];
  selectedDomain?: string; // Vote 后才写
}
```

---

## 5. SQL before/after

SQL 查询本身不变（仍多行 JOIN）。  
`mergeDomainTierRows` **after**：

* union `domains`
* **稳定字典序排序**
* **不再**写 `domain = 首行`

---

## 6. merge before/after

| 位置 | Before | After |
|------|--------|-------|
| `mergeDomainTierRows` | first wins `domain` | union + sort |
| `mergeTwoEdges` | 高分边的单 `domainId` | `unionDomains` |
| parent span | 单 `domainId` | group reduce union |

Candidate 数量不因 domain 数增加（仍 1 Hotword / 1 WindowCandidate）。

---

## 7. Vote before/after

**Before：** `addDomainScore(candidate.domainId)` → 仅首项全权重。  

**After：**

```text
total = score × sourceWeight × coverageWeight
perDomain = total / domains.length
```

单域与双域 **总 evidence 守恒**。

---

## 8. Coarse validation

新增 `filterEligibleDomainsByCoarse(domains, coarse)`：

* 使用 `getParentDomainId` / hierarchy
* **不修改** `candidate.domains`
* **未**新增 hard filter（沿用审计：粗域仍先裁剪 recall scope；Vote 读完整 domains）

---

## 9. sameDomain

```ts
candidate.domains.includes(winningDomain)
```

写入 `selectedDomain = winningDomain`；原始 `domains[]` 保留。  
多域 Candidate **不复制**进多个最终 bucket。

---

## 10. Assembly

输入仍为：selected-domain + base（+ general fallback）。  
不按 domain 展开句子；`maxSentenceCandidates=16`、per-span 8/6/4、KenLM 纯文本接口未改。

---

## 11. 日志字段

| 新/明确字段 | 含义 |
|-------------|------|
| `candidateDomains` / `domains` | 词库事实 |
| `selectedDomain` | Vote 后入桶域 |
| `votedFineDomain` / `selectedSentenceDomain` | 句级决策 |
| `validatedCoarseDomain` | 可选会话粗域（类型预留） |

模糊单值 `domain` 在 span 诊断中标记 deprecated，暂保留兼容读侧。

---

## 12. 10 个真实 multi-domain trace

正式 Bundle（python 只读验证 `DB tags == domain_lexicon∩tags`）：

| word | n | domains（字典序） | Candidate 膨胀 |
|------|---|-------------------|----------------|
| 预订 | 4 | food_order, tourism_hotel, tourism_route, transport | 1× |
| 接送 | 2 | tourism_pickup, tourism_transport | 1× |
| 路线 | 2 | tourism_route, tourism_transport | 1× |
| 少糖 | 3 | coffee, food_order, milk_tea | 1× |
| 中杯 | 3 | coffee, food_order, milk_tea | 1× |
| 机场 | 2 | tourism_transport, transport | 1× |
| 预定 | 3 | food_order, tourism_hotel, tourism_route | 1× |
| 菜单 | 4 | bakery, coffee, food_order, milk_tea | 1× |
| 打包 | 4 | bakery, coffee, food_order, milk_tea | 1× |
| 堂食 | 4 | bakery, coffee, food_order, milk_tea | 1× |

全部 `match=true`。Runtime Hotword 路径在本机 Node ABI 与 better-sqlite3 不匹配时跳过原生加载（与既有 wiring 测试相同）；合同单测 + SQL 层证据覆盖。

---

## 13. Candidate 数量对比

```text
N domains → 仍 1 Candidate（未展开）
before 压缩丢失域；after 保留全集
```

---

## 14. Vote 总权重验证

单测 T3：

```text
domains=[coffee]           total ≈ 0.5
domains=[coffee,food_order] coffee≈0.25 + food_order≈0.25
totals equal
```

---

## 15. sentence duplicate 验证

T6：`unique(texts) === texts.length`；组合数 ≤16。

---

## 16. 候选预算验证

T9：`getPerSpanCandidateLimit` → 8 / 6 / 4 不变。

---

## 17. Lexicon Bundle hash 不变证明

| 字段 | 值 |
|------|-----|
| bundleVersion | 10 |
| lastPatchId | lexicon-domain-hierarchy-completion-v1 |
| checksum | `sha256:62e04b3a43dfc1927713df0d4e2b9b735d30a6f682e916c42dab47ceef57b4ef` |
| lexicon.sqlite SHA256 | 同上（未改写） |

本轮无 Lexicon patch / 无表内容变更。

---

## 18. 测试结果

| Suite | 结果 |
|-------|------|
| `multi-domain-candidate-contract.test.ts` | PASS（T1–T7,T9） |
| `multi-domain-live-bundle.test.ts` | PASS（T8；原生 runtime 遇 ABI 时降级 SQL 证据） |
| `assemble-domain-aware-span-sets.test.ts` | PASS |
| `recall-scope-wiring.test.ts` | PASS |
| `recall-span-topk-v2/v3`、`candidate-score`、`domain-filter`、`build-sentence-candidates` | PASS |
| `tsc -p tsconfig.main.json --noEmit` | PASS |

---

## 19. 遗留问题

1. **Shadow Beam** 仍并行存在（审计 D）；已改为 `domains[]`，但未删除 Shadow。  
2. **span.domain** 诊断字段仍保留（deprecated），完整日志清洗可后续。  
3. **parent ngram** 表仍单 `domain_id`（词库 schema）；映射为 `domains: [domainId]`。  
4. 本机 Jest Node ABI ≠ Electron better-sqlite3；T8 在 ABI 不匹配时跳过 Runtime Hotword 直读（SQL 证据仍过）。  
5. Vote 对 parent_fragment 仍可能多次加分（计数去重、分数累加）——非本轮 multi-domain 展开问题。

---

## 20. Development Verdict

```text
PASS
```

满足：

* Vote 前保留完整 `domains[]`
* 删除未经决策的 `domains[0]` 压缩
* Vote 权重归一化
* sameDomain 使用 `includes`
* 不复制 multi-domain Candidate
* Lexicon Bundle 未变
* 单测 + 类型检查通过

```text
DEVELOPMENT COMPLETE — STOP
```
