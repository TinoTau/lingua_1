# Compatibility Authority Reduction — 冻结合约 V1.1

**状态**：FROZEN（2026-06-16）  
**依据**：Coverage Merge V1.2 · Development Specification V1.0  
**目的**：消除 Spec V1.0 阻塞级缺口，**不**新增架构、**不**改变 Compatibility = Relation Layer 结论

---

## 1. 范围

### 允许修改

```text
candidate-compatibility-graph.ts
span-assembly-v4-orchestrator.ts
emit-v4-evidence.ts
v4-types.ts
diagnostics
```

### 禁止修改

```text
Recall · Tone · DomainVote · Beam Logic · KenLM Logic · Apply · SQL
```

---

## 2. 权威下沉原则

| 层 | 权威 |
|----|------|
| Relation | `classifyOverlapRelation` + `resolveCompatibilityRelations` |
| Merge | Coverage merge 在 Compatibility 层完成 |
| Assembly | 只消费 `activeCandidates`，**不** re-decide conflict/coverage |
| Graph/Beam | Shadow only，消费 relations，不改决策 |

---

## 3. Graph 合约

- 允许：`buildCandidateGraph(candidates, conflictRelations)`
- 禁止：变更 mergeOverlappingEdges / greedy coverage / path selection
- Graph = conflictRelations 消费者，非本轮优化目标

---

## 4. ConflictRelation（与 V1.2 一致）

```ts
interface ConflictRelation {
  candidateIdA: string;
  candidateIdB: string;
  relationType: "CONFLICT";
  source: "syllable_overlap" | "window_overlap";
  reason?: string;
}
```

- candidateId 为唯一标识
- 仅 syllableOverlap conflict，禁止扩大 `findConflictPairs()` 门控

---

## 5. CompatibilityResult 统一返回

```ts
interface CompatibilityResult {
  activeCandidates: WindowCandidate[];
  coverageRelations: CoverageRelation[];
  conflictRelations: ConflictRelation[];
  hardDropCandidates: WindowCandidate[];
  metrics: CompatibilityMetrics;
}
```

Orchestrator **必须**从 Compatibility 层取 `activeCandidates` 传入 Domain Assembly，禁止在 Assembly 前二次 filter conflict。

---

## 6. 指标迁移

| 字段 | 状态 |
|------|------|
| `conflictCount` | **废止**（原 Conflict+Drop 混合） |
| `conflictRelationCount` | 新增：Conflict Relation 数量 |
| `hardDropCount` | 新增：窄口径 Hard Drop |
| `coverageRelationCount` | 新增：Coverage Relation 数量 |

Diagnostics 须同步新 metrics 名称，禁止继续写入废止字段。

---

## 7. Emit 层约束

`emit-v4-evidence.ts`：

- 只 emit 候选证据，**不** classify overlap
- 不持有 coverage/conflict 决策权
- relations 由 Compatibility 层产出后传入 Graph（Shadow）

---

## 8. Orchestrator 接线

```text
recallTopKForWindows
  → resolveCompatibilityRelations  ← 权威决策点
  → activeCandidates
  → runDomainAwareAssembly(activeCandidates)
```

禁止：

- Assembly 内 re-run conflict detection
- 用 beam/graph 结果替换 activeCandidates
- Emit 路径影响 Main Chain 候选集

---

## 9. Candidate Selector 设计约束

（源自 Design Drift Audit 收口）

| 规则 | 约束 |
|------|------|
| Selector 输入 | `activeCandidates`（post-merge） |
| 排序依据 | score + domain priority（Assembly 层） |
| Conflict 决胜 | 已在 Compatibility 层完成，Assembly 不再 pairwise conflict |
| Visibility | trace 可观测 candidate 进出 Compatibility，非决策层 |

---

## 10. SSOT 文件

| 文件 | 职责 |
|------|------|
| `candidate-compatibility-graph.ts` | resolveCompatibilityRelations · metrics |
| `classify-overlap-relation.ts` | 分类（V1.2） |
| `span-assembly-v4-orchestrator.ts` | activeCandidates 接线 |
| `emit-v4-evidence.ts` | 证据 emit |
| `candidate-compatibility-graph.test.ts` | 单测 |

---

## 11. 禁止项（冻结内）

- 在 Recall/Tone 层做 compatibility 决策
- 恢复 hard drop 作为主路径
- Graph/Beam 决策回流 Main Chain
- 新增 conflict 判定绕过 `classifyOverlapRelation`

---

## 12. 与 Coverage V1.2 关系

Authority Reduction **依赖** Coverage V1.2 分类顺序与 containment SSOT，不得与之冲突。  
详见 [COVERAGE_MERGE_FROZEN_V1_2.md](./COVERAGE_MERGE_FROZEN_V1_2.md)。

---

## 13. 后续

Compatibility 层 **已闭合**；候选存活链主因已定位至 KenLM 层（Apply 常为 0），下一阶段 KenLM 审计。
