# Compatibility — 冻结合约（Coverage V1.2 + Authority V1.1）

**状态**：FROZEN（2026-06-16/17）  
**代码根**：`span-assembly-v4/classify-overlap-relation.ts` · `candidate-compatibility-graph.ts`

Compatibility = **Relation Layer**：分类 overlap → merge coverage → 产出 `activeCandidates` 供 Domain Assembly 消费。Graph/Beam 仅 Shadow，**禁止**进入 KenLM/Apply。

---

## 1. 权威分层

| 层 | 权威 | 禁止 |
|----|------|------|
| 分类 | `classifyOverlapRelation` | Emit/Assembly/Graph/Beam 自行 classify |
| 决策 | `resolveCompatibilityRelations` | Assembly 内 re-run conflict |
| Merge | Compatibility 层 coverage merge | Graph 内 re-implement merge |
| Assembly | 消费 `activeCandidates` | 用 beam/graph 替换 activeCandidates |
| Graph/Beam | Shadow diagnostics | 决策回流 Main Chain |

---

## 2. 唯一分类入口

```ts
classifyOverlapRelation(candidateA, candidateB)
```

### 分类顺序（严格）

| Step | 条件 | 结果 |
|------|------|------|
| 1 | 无 overlap 或 adjacent only | `COMPATIBLE` |
| 2 | overlap slice 完全一致 | `COMPATIBLE` |
| 3 | replacement **且** syllable containment | `COVERAGE` |
| 4 | 同 parentTerm + matched fragment 一致 | `COMPATIBLE` |
| 5 | 其余 overlap | `CONFLICT` |

Step-3 优先于 Step-4。

### Containment SSOT

- **Replacement**：连续子串（`蓝莓 ⊂ 蓝莓马芬` ✅）
- **Syllable**：`parent.syllableStart <= child.syllableStart && parent.syllableEnd >= child.syllableEnd`
- **禁止**：`windowPinyinKey` 字符串包含、raw range 作主判据

---

## 3. Coverage Merge

| 规则 | 约束 |
|------|------|
| 方向 | 短词被长词覆盖（COVERAGE relation） |
| activeCandidates | merge 后保留未被 narrow 的候选 |
| Hard drop | 零 hard drop 主路径；relation 标记 + merge 剪枝 |
| Graph | 消费 `coverageRelations` / `conflictRelations`，不 re-classify |

---

## 4. CompatibilityResult

```ts
interface CompatibilityResult {
  activeCandidates: WindowCandidate[];
  coverageRelations: CoverageRelation[];
  conflictRelations: ConflictRelation[];
  hardDropCandidates: WindowCandidate[];
  metrics: CompatibilityMetrics;
}
```

### ConflictRelation

```ts
interface ConflictRelation {
  candidateIdA: string;
  candidateIdB: string;
  relationType: "CONFLICT";
  source: "syllable_overlap" | "window_overlap";
  reason?: string;
}
```

- 唯一标识：**candidateId**
- 仅 syllableOverlap conflict，禁止扩大 `findConflictPairs()` 门控

### Metrics 迁移

| 废止 | 新增 |
|------|------|
| `conflictCount`（混合语义） | `conflictRelationCount` |
| — | `hardDropCount` |
| — | `coverageRelationCount` |

---

## 5. Orchestrator 接线

```text
recallTopKForWindows
  → resolveCompatibilityRelations   ← 权威决策点
  → activeCandidates
  → runDomainAwareAssembly(activeCandidates)
  → buildSentenceCandidates → KenLM → Apply
```

`emit-v4-evidence.ts`：只 emit 证据，**不** classify overlap。

### Graph 合约

- 允许：`buildCandidateGraph(candidates, conflictRelations)`
- 禁止：变更 `mergeOverlappingEdges` / greedy coverage / path selection

### Candidate Selector

- 输入：`activeCandidates`（post-merge）
- Conflict 决胜已在 Compatibility 层完成；Assembly 按 score + domain priority 排序

---

## 6. 典型 Case

| Case | 期望 |
|------|------|
| 蓝莓 vs 蓝莓马芬 | COVERAGE |
| 中杯 vs 悲烧（同 syllable overlap） | CONFLICT |
| 同位置同词 | COMPATIBLE |
| adjacent only | COMPATIBLE |

---

## 7. SSOT 文件

| 文件 | 职责 |
|------|------|
| `classify-overlap-relation.ts` | 唯一分类 |
| `candidate-compatibility-graph.ts` | resolve + metrics |
| `span-assembly-v4-orchestrator.ts` | activeCandidates 接线 |
| `emit-v4-evidence.ts` | 证据 emit |
| `classify-overlap-relation.test.ts` | 分类单测 |
| `candidate-compatibility-graph.test.ts` | resolve 单测 |

---

## 8. 禁止项（冻结内）

- 新增 Coverage 路径绕过 `classifyOverlapRelation`
- Recall/Tone 层做 compatibility 决策
- Graph/Beam 结果接入 KenLM / Apply
- 恢复 mixed `conflictCount` 语义
- 静默修改 merge / conflict 决策逻辑

---

## 9. 后续

Compatibility 层 **已闭合**。Apply 常为 0 的主因已定位至 KenLM pick 阈值，见 [kenlm/KENLM_RUNTIME.md](../kenlm/KENLM_RUNTIME.md)。
