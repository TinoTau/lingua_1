# Coverage Classification & Coverage Merge — 冻结合约 V1.2

**状态**：FROZEN（2026-06-16 实现闭合）  
**优先级**：V4 Frozen Architecture > Contract V1.2 > Supplement V1.1 > Spec V1.0  
**代码根**：`span-assembly-v4/classify-overlap-relation.ts` · `candidate-compatibility-graph.ts`

---

## 1. 目的

冻结 **Coverage Classification** 与 **Coverage Merge** 的最终行为。Compatibility = Relation Layer，产出 `activeCandidates` 供 Domain Assembly 消费。

---

## 2. 唯一分类入口

```ts
classifyOverlapRelation(candidateA, candidateB)
```

**禁止** Emit / Assembly / Graph / Beam 自行判断 Coverage。

所有 Coverage / Conflict **只能**来自 `classifyOverlapRelation()`。

---

## 3. 分类顺序（严格）

| Step | 条件 | 结果 |
|------|------|------|
| 1 | 无 overlap 或 adjacent only | `COMPATIBLE` |
| 2 | overlap slice 完全一致（同位置同词） | `COMPATIBLE` |
| 3 | replacement containment **且** syllable containment | `COVERAGE` |
| 4 | 同 parentTerm 且 matched fragment 一致 | `COMPATIBLE` |
| 5 | 其余 overlap | `CONFLICT` |

**Coverage 优先于 sameParent compatible**：若 Step-3 满足，直接 `COVERAGE`，不再走 Step-4。

---

## 4. Containment SSOT

### Replacement Containment

- 必须 **连续子串**：`蓝莓 ⊂ 蓝莓马芬` ✅；`蓝莓 ⊂ 草莓` ❌
- `杯 ⊂ 中杯` 仅 replacement 不足，须同时满足 syllable containment

### Syllable Containment

唯一判断：

```ts
parent.syllableStart <= child.syllableStart
&& parent.syllableEnd >= child.syllableEnd
```

**禁止**用 `windowPinyinKey` 字符串包含作为主判断。

### Raw Range

不参与 Coverage 判定（d001 已证 raw overlap ≠ syllable containment）。

---

## 5. Coverage Merge 行为

| 规则 | 约束 |
|------|------|
| Merge 方向 | 短词被长词 **覆盖**（COVERAGE relation） |
| activeCandidates | merge 后保留 **未被 narrow 掉** 的候选 |
| Hard drop | 零 hard drop 原则；仅 relation 标记 + merge 剪枝 |
| Graph | 消费 `coverageRelations` / `conflictRelations`，**不**自行 re-classify |

---

## 6. CompatibilityResult 结构

```ts
interface CompatibilityResult {
  activeCandidates: WindowCandidate[];
  coverageRelations: CoverageRelation[];
  conflictRelations: ConflictRelation[];
  hardDropCandidates: WindowCandidate[];
  metrics: CompatibilityMetrics;
}
```

### Metrics 迁移

| 旧字段 | 状态 |
|--------|------|
| `conflictCount`（Conflict+Drop 混合语义） | **废止** |

| 新字段 | 定义 |
|--------|------|
| `conflictRelationCount` | Conflict Relation 数量 |
| `hardDropCount` | 窄口径 Hard Drop |
| `coverageRelationCount` | Coverage Relation 数量 |

---

## 7. ConflictRelation SSOT

```ts
interface ConflictRelation {
  candidateIdA: string;
  candidateIdB: string;
  relationType: "CONFLICT";
  source: "syllable_overlap" | "window_overlap";
  reason?: string;
}
```

- 唯一标识：**candidateId**（禁止 replacement/word/surfaceText 作主键）
- 仅记录 syllableOverlap Conflict，与 `findConflictPairs()` 门控一致，禁止扩大

---

## 8. Graph 范围

本轮 Graph **允许**修改接口（如 `buildCandidateGraph(candidates, conflictRelations)`），**禁止**修改决策逻辑：

- 禁止变更 `mergeOverlappingEdges` / greedy coverage / path selection
- Graph 仅作为 conflictRelations 消费者，不是优化目标

---

## 9. SSOT 文件

| 文件 | 职责 |
|------|------|
| `classify-overlap-relation.ts` | 唯一分类入口 |
| `candidate-compatibility-graph.ts` | resolveCompatibilityRelations |
| `emit-v4-evidence.ts` | 证据 emit（不自行 classify） |
| `classify-overlap-relation.test.ts` | 分类单测 |

---

## 10. 禁止项（冻结内）

- 新增 Coverage 判定路径绕过 `classifyOverlapRelation`
- 用 raw range / pinyin 字符串替代 syllable containment
- 恢复 mixed `conflictCount` 语义
- Graph 内 re-implement coverage merge 决策

---

## 11. 典型 Case

| Case | 期望 |
|------|------|
| 蓝莓 vs 蓝莓马芬 | COVERAGE（syllable + replacement） |
| 中杯 vs 悲烧 | CONFLICT（同 syllable overlap，无 containment） |
| 同位置同词 | COMPATIBLE（Step-2） |
| adjacent only | COMPATIBLE（Step-1） |

---

## 12. 后续

Coverage / Merge **已闭合**；Compatibility Authority Reduction V1.1 在其上完成权威下沉，见 [AUTHORITY_REDUCTION_FROZEN_V1_1.md](./AUTHORITY_REDUCTION_FROZEN_V1_1.md)。
