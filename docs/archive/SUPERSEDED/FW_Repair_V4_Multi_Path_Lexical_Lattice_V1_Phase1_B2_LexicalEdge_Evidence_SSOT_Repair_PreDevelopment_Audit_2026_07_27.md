<!-- Documentation Hierarchy Metadata
Status: **SUPERSEDED**
Superseded By: CURRENT Sole Authorities + FW_V4_FREEZE_2026_08_03
Archive Path: docs/archive/SUPERSEDED/FW_Repair_V4_Multi_Path_Lexical_Lattice_V1_Phase1_B2_LexicalEdge_Evidence_SSOT_Repair_PreDevelopment_Audit_2026_07_27.md
-->

> **SUPERSEDED** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: CURRENT Sole Authorities + FW_V4_FREEZE_2026_08_03

# FW Repair V4 — Multi-Path Lexical Lattice V1 · Phase 1 B2 LexicalEdge Evidence SSOT Repair Pre-Development Audit

| Field | Value |
|-------|-------|
| Date | 2026-07-27 |
| Audit type | **Read-only · Pre-Development** |
| Scope | **B2 only** — LexicalEdge `recallEvidence` vs identity first-wins |
| Out of scope | B1 Budget · Path · Vote · Assembly · KenLM · Production Cutover |
| Code / config / SQLite / lexicon changes | **NONE** |

---

## 1. Executive Summary

B2 根因（代码事实，非仅 Acceptance 引用）：

```text
buildLexicalEdges:
  1) dedupePreserveOrder(candidates)   // termId else candidateId, first-wins
  2) buildRecallEvidence(keptOnly)     // OR over 保留集
→ 同 identity 后出现的 hitKind / toneLookupStage 被丢弃后，
  Edge.recallEvidence 无法反映这些来源
```

Architecture / Contract 要求 Path `structuralEvidence`（`exactEdgeCount` / `toneRelaxedEdgeCount` / `fuzzyEdgeCount` / `parentEdgeCount`）**消费 Edge 级证据**。去重后算 evidence 会系统性低估结构证据 → **正确性缺陷**。

**唯一推荐修复：**

```text
Edge-Level Union（方案 A）
在 buildLexicalEdges 内：
  先对「该边界全部输入 WindowCandidate」做 evidence OR
  再 identity first-wins 保留主 Candidate
不改 identity、不改顺序、不改 Ranking/SQL、不新增 DTO
```

| 问题 | 答案 |
|------|------|
| Evidence 聚合步骤 | **仅** `buildLexicalEdges` |
| 按 Edge 还是 Identity？ | **Edge-Level**（对全部输入 Candidate OR；与 Identity-Group OR 对布尔标志数学等价，实现选更简的 A） |
| first-wins？ | **保留**（Candidate 主体） |
| `recallEvidence` 覆盖范围 | 该 Edge 对应 Window 的**全部输入** Candidate |
| `hasFuzzy` | Fuzzy Recall **存在**于 V2/V3 Hit（`recallCandidateKind`），但 **未透传**到 `WindowCandidate` → **FIX 映射**（薄透传），不是 DELETE，也不是新开 fuzzy 召回 |

---

## 2. Frozen Constraints

| ID | 约束 |
|----|------|
| I1 | Identity = `termId` else `candidateId`；禁止 replacement / surface / domain / hitKind 作合并键 |
| O1 | Candidate 顺序 = Recall 首次出现顺序；后续同 identity 不得改变主 Candidate 位次 |
| E1 | 一 `(start,end)` → 一 LexicalEdge |
| N1 | 禁止 EvidenceCandidate / Registry / Policy 等新中间态（除非证明现结构不够 — 本轮**不够的证据不足**） |
| S1 | 不改 Recall ranking / SQL / TopK；不处理 B1 |

---

## 3. Current Evidence Call Graph

```text
LexiconRuntime / recallSpanTopKV2
  → RecallSpanTopKV2Hit
       hitKind(via V3 map), toneLookupStage, recallCandidateKind, source, hotword.id
  → recallSpanTopKV3 (mapV2Hit / parent_fragment)
       RecallSpanTopKV3Hit { hitKind, toneLookupStage, recallCandidateKind, hotword.id, … }
  → bindLexiconHitsToWindow
       WindowCandidate {
         termId ← hotword.id,
         hitKind ← exact_term | parent_fragment,
         toneLookupStage ← exact 路径的 stage（parent 不写 stage）,
         recallSource ← hit.source (V3 WindowCandidateSource),
         source ← GraphEdgeSource,
         domains[], score, …
         // 丢失: recallCandidateKind（含 fuzzy_*）
       }
  → Window candidates[]（Recall 顺序）
  → buildLexicalEdges
       dedupePreserveOrder  → 同 identity continue/drop     ← Evidence 可能在此丢失来源行
       buildRecallEvidence(kept) → LexicalEdge.recallEvidence
  → LexicalEdge { candidates, recallEvidence }
  → (未来) Path.structuralEvidence 计数 Edge flags
```

| 字段 | 产生步 | 可能丢失步 |
|------|--------|------------|
| `hitKind` | bind | 同 identity 非 first 行在 dedupe |
| `toneLookupStage` | bind（exact） | 同上；parent 行本就不带 |
| `recallCandidateKind` / fuzzy | V2/V3 Hit | **bind 未写入 WindowCandidate** |
| `termId` | bind | 不去失（identity 键） |
| `domains[]` | bind | first-wins 保留主行；不因 evidence 修复改变 |
| `recallEvidence.*` | Edge builder | **当前在 dedupe 后计算 → B2** |

---

## 4. Evidence Source Matrix

| Edge Evidence | WindowCandidate / Hit 来源 | 产生函数 | 当前映射 |
|---------------|---------------------------|----------|----------|
| `hasExact` | `hitKind === 'exact_term'` | `buildRecallEvidence` | `candidates.some(...)` |
| `hasToneExact` | `toneLookupStage === 'tone_exact'` | 同上 | 同上 |
| `hasToneRelaxed` | `toneLookupStage === 'plain_fallback'` | 同上 | **仅** `plain_fallback`；**不含** `plain_only_no_pattern`（与 tone 诊断注释一致） |
| `hasParent` | `hitKind === 'parent_fragment'` | 同上 | 同上 |
| `hasFuzzy` | 应为 V2/V3 `recallCandidateKind ∈ {fuzzy_plain, fuzzy_plain_domain}` | **无** | **硬编码 `false`**（`build-lexical-edges.ts` L60–L61） |

### 相关字段角色

| 字段 | 正式业务证据？ | 说明 |
|------|:-------------:|------|
| `hitKind` | **是** | exact vs parent — Edge evidence / 未来 Path 计数 |
| `toneLookupStage` | **是** | tone_exact / plain_fallback — Edge tone flags |
| `recallCandidateKind` | **是（Hit 层）** | 含 fuzzy_*；**未进** WindowCandidate |
| `recallSource` (`WindowCandidateSource`) | 诊断 / 溯源 | 无 fuzzy token；非 Edge boolean 源 |
| `source` (`GraphEdgeSource`) | Assembly/Vote 域类 | base_term / domain_term… **不是** Recall 路径证据 |
| `parentTermId` | Parent 元数据 | 标识父词；`hasParent` 以 `hitKind` 为准 |
| `lookupStage` | **不存在**于 WindowCandidate | 勿猜测 |

---

## 5. Evidence Ownership

| 对象 | 原始 Evidence | 聚合 Evidence |
|------|:-------------:|:-------------:|
| Lexicon Fact / V3 Hit | **是** | 否 |
| WindowCandidate | **是**（绑定后载体） | 否 |
| Candidate Identity Group | 否（实现细节） | 可选中间态 — **不需要单独 Owner** |
| **LexicalEdge** | 否 | **是（唯一聚合 SSOT）** |
| SegmentationPath | 否 | **否** — 只消费 Edge flags 计数 |
| Diagnostics | 副本 | 不得另推业务 evidence |

目标结构（本审计确认成立）：

```text
Raw Recall Evidence SSOT  → WindowCandidate / Recall Hit 字段
Edge Evidence SSOT        → buildLexicalEdges → LexicalEdge.recallEvidence
Path Structural Evidence  → 只读 Edge.recallEvidence 计数（Phase 2；本轮不实现）
```

---

## 6. Current Dedupe Semantics

锚点：`build-lexical-edges.ts`

```text
function candidateMergeKey(c):
  if c.termId non-empty: return "term:" + termId
  else return "cand:" + candidateId

function dedupePreserveOrder(candidates):
  seen = {}
  out = []
  for c in candidates:                 # Recall 顺序
    key = candidateMergeKey(c)
    if key in seen: continue           # first-wins drop
    seen.add(key)
    out.push(c)
  return out

function buildLexicalEdges(recalledWindows):
  for bundle in recalledWindows:       # Window 顺序
    kept = dedupePreserveOrder(bundle.candidates)
    if kept empty: continue
    edge.candidates = kept
    edge.recallEvidence = buildRecallEvidence(kept)   # ← 去重后
```

**Evidence 在去重之后计算** — 这就是 B2。

---

## 7. Architecture Contract Interpretation

### Architecture V1.0.0 §14.2 LexicalEdge

| | 原文要点 |
|--|----------|
| Input | **Windows + Recall hits** |
| Output | edgeKind, **candidates[]**, **evidence** |
| Responsibility | Unique boundary + **merged** Candidates |
| Invariants | One edge per (start,end) |

→ Evidence 与 merged candidates 同为 Edge **输出**；Input 明确包含 **Recall hits（全量输入）**，并非“仅合并后主体”。

### Implementation Contract §4.2 / §4.3 / §8.3

```text
LexicalEdge.recallEvidence { hasExact, hasToneExact, hasToneRelaxed, hasFuzzy, hasParent }

Path.structuralEvidence {
  exactEdgeCount, toneRelaxedEdgeCount, fuzzyEdgeCount, parentEdgeCount
}

Prune（cap 触发时）按 structuralEvidence 排序（含 fuzzyEdgeCount ASC 等）
```

→ Path **不重新扫描** WindowCandidate；只消费 Edge 聚合事实。若 Edge evidence 因 first-wins 丢来源，Path 结构评分失真（Acceptance B2）。

**最小正确语义（满足冻结架构）：**

```text
Candidate 主体：同 identity first-wins
Candidate 顺序：首次出现不变
Edge Evidence：对该边界全部输入 Candidate 做布尔 OR union
```

---

## 8. Edge-Level vs Identity-Level Union Decision

| 方案 | 定义 | 布尔 OR 结果 |
|------|------|--------------|
| **A Edge-Level** | 先对全部输入算 evidence，再 dedupe candidates | 覆盖所有输入来源 |
| **B Identity-Group** | 组内 union → 再 OR 各组 | 对布尔 flags **与 A 等价** |

**正式选择：方案 A**

| 依据 | 说明 |
|------|------|
| Architecture Input | Windows + Recall hits → evidence 属边界全量输入 |
| 实现复杂度 | A 更少代码，无分组结构 |
| 非“更完整冲动” | 与 B 布尔语义相同；选 A 因 SSOT 简洁 |
| 非选 B 的理由 | B 不增加正确性，只增加中间态 |

**不选**“只对最终保留 identity 的**单行** evidence”（即现状）— 那是 B2 缺陷。

---

## 9. hasFuzzy Audit

### 9.1 Fuzzy 是否真实存在？

| 证据 | 结论 |
|------|------|
| `recall-span-topk-v2.ts` `classifyRecallCandidateKind` | `variant.isFuzzy` → `fuzzy_plain` / `fuzzy_plain_domain` |
| `isFuzzyPinyinRecallEnabled()` / `fuzzyRecallEnabled` | 配置可打开；orchestrator / harness 可传入 |
| V3 `mapV2Hit` | **保留** `recallCandidateKind`；`hitKind` 仍为 `exact_term` |
| `WindowCandidateSource` | **无** fuzzy 枚举 |
| `bindLexiconHitsToWindow` | **不复制** `recallCandidateKind` |

**判定：B** — 系统存在 fuzzy Recall，但 Edge/`WindowCandidate` **未映射** → 应 **FIX 映射**，不得为凑 `true` 新开召回，也不得因恒 false 假装“无 fuzzy”而 DELETE 合同字段（Contract + Path `fuzzyEdgeCount` 需要该位）。

### 9.2 与其它字段关系

| 易混淆 | 结论 |
|--------|------|
| `plain_fallback` | Tone 放宽，映射 `hasToneRelaxed`；**不是** fuzzy |
| `parent_fragment` | `hasParent`；**不是** fuzzy |
| `lexicon_pinyin_topk` | 拼音路径 source；模糊与否看 `recallCandidateKind` |

---

## 10. Field Simplification

| 字段 | KEEP / FIX / DELETE | 原因 |
|------|---------------------|------|
| `hasExact` | **KEEP** | `hitKind` 有真实来源 |
| `hasToneExact` | **KEEP** | `tone_exact` 有真实来源 |
| `hasToneRelaxed` | **KEEP** | 映射 `plain_fallback`；与诊断一致 |
| `hasParent` | **KEEP** | `parent_fragment` |
| `hasFuzzy` | **FIX** | 合同保留；映射 `recallCandidateKind` 前缀 `fuzzy_` |
| 硬编码 `hasFuzzy: false` | **DELETE** | 谎言常量 |
| 新增 evidence 数组 | **禁止** | Architecture 只要布尔块 |

---

## 11. Recommended Minimal Repair

### 唯一方案：Edge-Level Evidence Union + Fuzzy 薄透传

```text
initialize edgeEvidence = all false
initialize seenIdentity
initialize keptCandidates = []

for candidate in original order:          # Recall 顺序
    OR-merge candidate into edgeEvidence  # 含 hasFuzzy（透传后）

    identity = termId ?? candidateId
    if identity already seen:
        continue
    mark identity
    keep candidate                        # first-wins 主体

if keptCandidates empty:
    no edge
else:
    emit one LexicalEdge:
      candidates = keptCandidates
      recallEvidence = edgeEvidence
```

| 项 | 规则 |
|----|------|
| 扫描顺序 | 输入 Candidate 原序 |
| Identity key | `termId` else `candidateId` |
| 主 Candidate | first-wins |
| Evidence 时机 | **dedupe 前 / 与扫描同一遍 OR** |
| Evidence 范围 | 该边界**全部输入** Candidate |
| 输出顺序 | kept 的首次出现序 |
| hasFuzzy | `recallCandidateKind` ∈ fuzzy_* → true |

**是否只改 `buildLexicalEdges`？**

| 目标 | 需要改动 |
|------|----------|
| 关闭 B2（tone/parent 同 identity 丢失） | **仅** `buildLexicalEdges` + tests |
| `hasFuzzy` 合同位可真 | **额外最小映射**：`WindowCandidate` 增加可选 `recallCandidateKind?`（或 `isFuzzyRecall?`）+ `bindLexiconHitsToWindow` 从 `hit.recallCandidateKind` 透传 — **不改** ranking/SQL |

优先级符合审计：先 Edge builder；字段缺失再薄映射。

---

## 12. Files and Symbols

| 文件 | 符号 | 动作 |
|------|------|------|
| `build-lexical-edges.ts` | `buildLexicalEdges`, `buildRecallEvidence`, `dedupePreserveOrder` | **MODIFY** — union 时机；fuzzy 读透传字段 |
| `v4-types.ts` | `WindowCandidate` | **MAY** — 可选 `recallCandidateKind?` |
| `recall-topk-for-windows.ts` | `bindLexiconHitsToWindow` | **MAY** — 一行透传（同类 termId） |
| `phase1-window-edge-harness.test.ts` 等 | 多来源 evidence 用例 | **MODIFY / ADD** |
| Orchestrator / LTR / Vote / SQL | — | **不改** |

禁止改：`recallSpanTopKV3` 排序、TopK、score、termId 生成规则。

---

## 13. KEEP / MODIFY / DELETE

### KEEP

```text
termId first-wins / candidateId fallback
Recall 首次顺序
一边界一 Edge
无 Candidate 不建 Edge / 无 fallback Edge
Candidate score / domains[] / ranking / SQL
```

### MODIFY

```text
build-lexical-edges.ts
  - buildLexicalEdges 局部循环：先 OR evidence，再 dedupe keep
  - buildRecallEvidence：输入改为「全量 candidates」或内联 OR；hasFuzzy 读透传字段

bindLexiconHitsToWindow（若做 hasFuzzy）
  - recallCandidateKind?: hit.recallCandidateKind

tests
  - 同 identity 多来源；不同 identity；candidateId fallback；
    同 replacement 不同 termId；domains[]；hasFuzzy 映射
```

### DELETE

```text
hasFuzzy: false 硬编码
（无）真实 hitKind/tone 映射
```

---

## 14. Target List

```text
[ ] buildLexicalEdges：Edge-Level evidence OR → 再 first-wins
[ ] 单测：同 termId exact+tone_exact 与 parent+plain_fallback → 主体保留 A，evidence 全 true 位
[ ] 单测：不同 termId 均保留
[ ] 单测：无 termId 用 candidateId
[ ] 单测：同 replacement 不同 termId → 两 Candidate
[ ] domains[] 不变回归
[ ] hasFuzzy：透传 + 映射（或分步：先 union，再透传 PR）
[ ] 不改 B1 / Path / Production 接线
```

---

## 15. Check List

```text
[ ] Identity / 顺序 / 单 Edge 不变
[ ] Evidence 不因 dedupe 丢失
[ ] 无新 DTO / Registry
[ ] 无 Recall SQL/rank 变更
[ ] Production 未接 Lattice
[ ] 未进入 B1 开发或 Phase 2
```

---

## 16. Regression Plan

| 套件 | 要求 |
|------|------|
| `build-lexical-edges` / Phase1 harness unit | §17 用例 |
| live SQLite / multi-domain / termId / order | 既有 Phase1 live + 合同测试仍 PASS |
| freeze-contract / production isolation | 不变 |
| **不要求** Path / Vote / Assembly / KenLM | 本轮禁止 |

---

## 17. Acceptance Criteria（B2 开发完成后）

```text
Candidate identity 不变
Candidate first-wins 不变
Candidate 顺序不变
一个边界一个 Edge
Evidence 不因 identity 去重丢失
domains[] 不变
Recall ranking / SQL 不变
Production 未接入 Lattice
无新 DTO / 无新业务分支开关
同 identity 多来源构造用例：evidence 含全部正式来源位
hasFuzzy：不再硬编码 false；fuzzy hit 可反映 true（透传后）
```

---

## 18. Risks

| 风险 | 等级 | 说明 |
|------|------|------|
| 生产同 identity 多 stage 少见 | OBSERVE | V2 `bestById` 常合并；缺陷仍在 builder 语义，测试必须构造 |
| hasFuzzy 透传范围蔓延 | MINOR | 限制为可选字段 + bind 一行 |
| 与 B1 同 PR 纠缠 | BLOCKER 若发生 | 本审计禁止 |

---

## 19. Final Decision

```text
READY FOR B2 EVIDENCE SSOT REPAIR DEVELOPMENT
```

### 冻结本审计的唯一答案

| 项 | 结论 |
|----|------|
| 唯一 Evidence 聚合 Owner | **`buildLexicalEdges` → `LexicalEdge.recallEvidence`** |
| 唯一 union 时机 | 对该边界 Candidate 扫描时、**first-wins 保留之前（或同一遍先 OR 再决定 keep）** |
| 唯一 union 范围 | 该边界 **全部输入** WindowCandidate（方案 A） |
| 精确修改文件 | **MUST** `build-lexical-edges.ts` + tests；**MAY** `v4-types.ts` + `bindLexiconHitsToWindow`（hasFuzzy） |
| hasFuzzy | **FIX 映射**（V3 `recallCandidateKind` 薄透传）；非 DELETE；非新建 fuzzy 召回 |
| 为何不需架构重构 | Identity/顺序/单 Edge 合同不变；只纠正 evidence 相对 Input=Recall hits 的聚合时机；无新 DTO |

**禁止进入 B1 开发或 Phase 2。**（B1 / B2 可并行审计，但本轮交付仅 B2 开发就绪结论。）
