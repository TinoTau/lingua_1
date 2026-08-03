<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: docs/current/INDEX.md
Archive Path: docs/archive/HISTORICAL/Fine_Span_Domain_Presence_Vote_and_Multi_Bucket_Assembly_Development_Report.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: docs/current/INDEX.md

# Fine_Span_Domain_Presence_Vote_and_Multi_Bucket_Assembly_Development_Report

| 字段 | 值 |
|------|-----|
| Status | **COMPLETE** |
| Date | 2026-07-19 |
| Task | Fine-Span Domain Presence Vote and Multi-Bucket Assembly Repair |
| HEAD (start) | `262b3d32717db97807fa48103aa44f1ea518361a` |
| Lexicon | v10 · `sha256:62e04b3a43dfc1927713df0d4e2b9b735d30a6f682e916c42dab47ceef57b4ef` |

---

## 1. Executive Verdict

**PASS.** 主链已切换为「细 span 领域存在票」+「多领域桶 Assembly」+「KenLM 跨桶统一评分」。`WindowCandidate.domainId` / `domains[0]` 投影已删除；`DOMAIN_BUCKET_RETENTION_RATIO = 0.75` 为唯一保留比例 SSOT。fresh-dist Electron 验收 `ACCEPTANCE_PASS`。

---

## 2. Git 状态

- 分支：`main`（相对 `origin/main` 大量未提交工作树；本轮修改叠加于既有 SSOT/Lexicon 变更之上）
- 本轮核心代码路径：`utterance-domain-vote.ts`、`recall-topk-for-windows.ts`、`assemble-domain-aware-span-sets.ts`、`span-assembly-v4-orchestrator.ts`、相关 types/emit/parent/graph
- 本轮测试：`fine-span-domain-presence-vote.test.ts` 等
- 本轮文档：`Runtime_SSOT_Contract_Freeze.md` V1.1、`DOMAIN_RECALL.md` §4、`FROZEN_V1_2.md` 主链图、`RUNTIME_DOMAIN_DOCUMENT_INDEX.md`

---

## 3. 修改前真实链路

```text
Hotword.domains[]
  → recall-topk: domainId = domains[0]
  → WindowCandidate.domainId
  → voteUtteranceDomainFromPool:
       VoteMass = score × SOURCE_WEIGHT × coverageWeight 累加到 domainId
  → finalize: localeCompare tie-break → 单一 utteranceDomain
  → filterDomainCandidatesPerSpan: domainId === winningDomain + base
  → 单一 spanSets → buildSentenceCandidates(≤16) → KenLM
```

Shadow：`GraphEdge.domainId` / `applyDomainVoteToEdges` 按单一 winner 软降权。

---

## 4. 修改后正式链路

```text
term_domain_tags → Hotword.domains[]
  → WindowCandidate.domains[]（完整复制，一 hit 一 Candidate）
  → FineSpanDomainSet = Union(合法候选.domains)
  → domainScores[domain] = distinct fine-span count
  → retainedDomains（并列最高 / 0.75 比例 / base-only）
  → 每 retainedDomain：sameDomain(includes) + Base → spanSets
  → 每桶 buildSentenceCandidates(perBucketCap) → merge 去重 → ≤16
  → KenLM（纯文本，跨桶）
```

---

## 5. 旧 Vote 公式与删除原因

| 旧机制 | 删除原因 |
|--------|----------|
| `CandidateScore × SourceWeight × CoverageWeight` 累加 | 把召回分数误当领域存在证据；多领域词会放大/扭曲 |
| `domains.length` 均分 | 已冻结禁止；无合同依据 |
| `domainId = domains[0]` | 丢失 membership；sameDomain 假排除 |
| 单一 `utteranceDomain` 强制 winner | 证据不足或并列时错误压缩候选 |

分数仍可用于 Candidate 排序/截断，**不再**决定领域票数。

---

## 6. FineSpanDomainSet 实现

`buildFineSpanDomainSet`（`utterance-domain-vote.ts`）：

- 输入：一细 span 内候选
- 排除：`isCovered`、非 `domain_term`/`passive_domain_weak`、`general`/`base_term`/空 label
- 输出：`Set<string>` = 合法 `domains[]` 并集

---

## 7. 每 span 每 domain 去重实现

并集天然保证：**同一 span 对同一 domain 只贡献 1 票**。  
结构性重复（同 `candidateId` / 同 `parentTermId`）用 `seenKeys` 跳过；**不同自然语言候选全部保留并参与并集**。

---

## 8. domainCounts

复用字段名 `domainScores`，冻结新语义：

```text
domainScores[domain] = distinct fine-span count（整数）
```

诊断别名：`maxCount` / `runnerUpCount` / `winnerScore` / `runnerUpScore` / `voteMargin`。

---

## 9. retention ratio 选择依据

- 仓库内 **无** 既有 `retentionRatio` / margin / ambiguity 配置可复用（审计结果）
- 场景比较：`0.5` 过松（4vs2 会双桶）；`0.8` 过紧（4vs3 会丢次高）；`0.67`/`0.75` 均满足 4vs2 单桶、4vs3 双桶
- **选定最小稳定建议值 `0.75`** → `DOMAIN_BUCKET_RETENTION_RATIO`（唯一定义于 `utterance-domain-vote.ts`，`v4-limits` 再导出）

---

## 10. 唯一领先行为

`max` 唯一且次高 `< max×0.75` → `retainedDomains = [winner]`。单元测试 17.1 / 17.4 PASS。

---

## 11. 并列最高行为

`count === maxCount` 的全部领域保留；`localeCompare` 仅稳定排序，不删桶。测试 17.2 / 17.5 PASS。

---

## 12. 差距不足行为

例：4 vs 3 vs 1，ratio=0.75 → 保留 4 与 3，丢弃 1。测试 17.3 PASS。

---

## 13. Base 桶行为

- Base 不进 Vote（`source === base_term` 跳过）
- `maxCount=0` → `insufficientEvidence`，单 base/fallback 桶
- 有 retained 时 Base 进入每一领域桶

---

## 14. 多领域桶 Assembly

`runDomainAwareAssembly` 产出 `bucketSpanSets[]`；`sameDomain` = `domains.includes(bucketDomain)`。多领域 Candidate **不复制**，按 membership 自然出现在多个桶。

---

## 15. KenLM 跨桶评分

Orchestrator：各桶独立 `buildSentenceCandidates` → 按文本 merge → **一次**池子交给后续 KenLM（≤16）。不在桶内先选领域 winner。

---

## 16. Candidate 预算

`allocateDomainBucketSentenceBudget(n, 16) = floor(16/n)`；若 `<1` **抛错 BLOCKED**（禁止静默丢并列桶）。测试覆盖 n=17 抛错。

---

## 17. domainId 清理

| 位置 | 状态 |
|------|------|
| `WindowCandidate` | `domains?` only |
| Recall | 复制 `hotword.domains` |
| DomainAware pick | 临时 `domains`；Pick 转换剥离 |
| GraphEdge / ParentEvidence / ParentSpanCandidate | `domains?` |
| `sameDomain` / greedy parent | `includes` |
| `domains[0]` | **ABSENT** |

---

## 18. Shadow 清理

Shadow 仍诊断隔离；`voteUtteranceDomain` / `applyDomainVoteToEdges` 改为 presence + `retainedDomains` membership，**无**第二套浮点 VoteMass。未恢复 `domainId`。

---

## 19. 测试结果

| Suite | Result |
|-------|--------|
| `fine-span-domain-presence-vote.test.ts` | PASS |
| `assemble-domain-aware-span-sets.test.ts` | PASS |
| `domain-rerank.test.ts` | PASS |
| `freeze-contract.test.ts`（GATE-INT-2 已更新） | PASS |
| `recall-scope-wiring.test.ts` | PASS |

---

## 20. Electron fresh-dist 验收

```text
npm run accept:runtime-ssot → ACCEPTANCE_PASS
```

Lexicon v10 smoke 观测（少糖+中杯）：`domainScores` 整数 span count；`retainedDomains` 并列三桶；Pick 无 domain 字段；无证据 → base-only。

---

## 21. 文档修订

| 文档 | 动作 |
|------|------|
| `Runtime_SSOT_Contract_Freeze.md` | V1.1 Presence Vote 权威改写 |
| `DOMAIN_RECALL.md` §4 | 废弃 VoteMass；指向 Presence |
| `FROZEN_V1_2.md` | 主链图多桶 |
| `RUNTIME_DOMAIN_DOCUMENT_INDEX.md` | 索引更新 |

---

## 22. 风险

- 多领域词（如「中杯」三标签）在短句上易并列多桶 → 依赖 KenLM 与预算均分；属设计预期
- Shadow Beam 仍存在（诊断 only）；未做完整 Shadow 删除
- 工作树含大量无关未提交文件；本轮未做 git commit

---

## 23. Target List

- [x] 删除 Candidate `domainId` / `domains[0]`
- [x] FineSpan presence Vote
- [x] retained multi-bucket Assembly
- [x] KenLM 跨桶 ≤16
- [x] 单 SSOT `DOMAIN_BUCKET_RETENTION_RATIO=0.75`
- [x] 单元测试 17.x 场景
- [x] fresh-dist Electron
- [x] 权威文档冻结更新

---

## 24. Check List

- [x] 无并行 VoteMass 路径
- [x] 无 Recall fan-out
- [x] Pick / KenLM 无 domains
- [x] 并列最高不因 localeCompare 丢桶
- [x] 预算冲突显式 BLOCKED

---

## 强制验收输出

```text
DOMAIN VOTE UNIT:
DISTINCT FINE SPAN DOMAIN PRESENCE
```

```text
MULTIPLE CANDIDATES PER FINE SPAN:
PRESERVED
```

```text
ONE SPAN ONE VOTE PER DOMAIN:
PASS
```

```text
MULTIPLE SPANS SAME DOMAIN:
ACCUMULATED
```

```text
BASE PARTICIPATES IN DOMAIN VOTE:
NO
```

```text
DOMAINID REMOVED:
YES
```

```text
DOMAINS[0] PROJECTION:
ABSENT
```

```text
UNIQUE CLEAR WINNER:
SINGLE BUCKET
```

```text
TIED MAXIMUM:
ALL MAX BUCKETS RETAINED
```

```text
INSUFFICIENT MARGIN:
RATIO-QUALIFIED BUCKETS RETAINED
```

```text
NO DOMAIN EVIDENCE:
BASE-ONLY BUCKET
```

```text
RECALL CANDIDATE FAN-OUT:
ABSENT
```

```text
DOMAINS IN SPANREPLACEMENTPICK:
ABSENT
```

```text
DOMAINS IN KENLM:
ABSENT
```

```text
TOTAL SENTENCE CANDIDATES <= 16:
PASS
```

```text
KENLM CROSS-BUCKET RANKING:
PASS
```

```text
FRESH DIST ELECTRON ACCEPTANCE:
PASS
```

```text
FREEZE DOCUMENTS UPDATED:
YES
```

```text
FINAL VERDICT:
PASS
```

---

```text
FINE-SPAN DOMAIN PRESENCE VOTE AND MULTI-BUCKET ASSEMBLY REPAIR COMPLETE — STOP
```
