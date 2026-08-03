> **HISTORICAL / SUPERSEDED (Fine Span architecture)** — 2026-07-26  
> LTR-only / unique FormalFineSpan / cursor-commit / windows 2..5-as-SSOT claims in this document are **not** current Architecture SSOT.  
> Current authority: `FW_Repair_V4_Multi_Path_Lexical_Lattice_Architecture_V1.0.0_FROZEN.md`  
> Original text retained as historical evidence. Do not treat as active freeze.
# FW Repair V4 — Multi-Path Lexical Lattice Pre-Development Audit

| Field | Value |
|-------|-------|
| Date | 2026-07-26 |
| Type | **开发前只读审计**（禁止改代码 / Schema / 配置） |
| Scope | Fine Span → Recall → Vote → Assembly → KenLM |
| Electron SQLite | better-sqlite3 · **SQLite 3.49.2**（实测支持 `WITH … VALUES` / `ROW_NUMBER() OVER`） |

---

## 1. Executive Summary

| 问题 | 基于代码的结论 |
|------|----------------|
| 当前与目标架构差距 | **巨大**：生产是 **单条 LTR 贪心 FormalFineSpan 序列**；目标是 **多 SegmentationPath 词图** |
| 能否在现有主链上直接改造 | **可在同一 orchestrator 入口替换 FineSpan 段**；Vote/Assembly/KenLM **内核可复用**，但调用粒度与 DTO 必须改 |
| 是否存在需先清理的旧链 | **是**：LTR 唯一 commit、全句统一 Vote、跨路径混合组句假设、死代码 `generateGlobalWindows` / `truncateWindows`、parent `lookupTermDomainTagsInScope` N+1 |
| SQLite 批量是否适合 | **技术可行**（3.49.2 支持窗口函数）；**收益未证明一定大于复杂度** |
| 不新增索引、不用临时表 | **可行**：`WITH input(…) AS (VALUES …)` + join 现有 `idx_*_pinyin*` / PK tags |
| 最大技术风险 | **(1)** 与冻结「LTR 唯一 FineSpan 主链 / 无 Beam」文档正面冲突；**(2)** 路径枚举爆炸若不按位置限宽；**(3)** 目标「1～5 全窗」与现码「正式窗 2～5、1 仅 fallback」合同冲突 |

### 最终结论

```text
READY WITH BLOCKERS
```

**不可在未解除文档冻结、未删除 LTR 唯一决策的前提下“直接开发”多路径词图。**  
第一阶段必须先完成：冻结文档修订范围确认 + 删除/替换 LTR commit 所有权 + 引入 Edge/Path 结构（复用现有 Candidate/Window 类型），再谈批量 SQL。

---

## 2. Current Runtime Call Chain

真实生产链（附关键位置）：

```text
fw-detector-orchestrator.ts :: runFwDetectorOrchestrator
  → fw-detector-v4-path.ts :: runFwDetectorV4Path
    → span-assembly-v4-orchestrator.ts :: runSpanAssemblyV4Orchestrator
         → pinyin-ime-v2-pinyin-stream.ts :: buildUtteranceSyllableCoordinate
         → coarse-span-partition.ts :: partitionCoarseSpans
         → ltr-fine-span-generator.ts :: runLtrFineSpanGeneration
              → generateLocalOptionsAtCursor          // 临时窗 2..5
              → (orch) blockedFilter + recallTopKForWindows
              → commitBestFormalFineSpan              // 每 cursor 恰好 1 个 Formal
              → cursor = formalSpan.syllableEnd
         → tone-commit-rebind.ts :: rebindToneAfterFormalCommit
         → candidate-compatibility-graph.ts :: resolveCompatibilityRelations
         → assemble-domain-aware-span-sets.ts :: runDomainAwareAssembly
              → utterance-domain-vote.ts :: voteUtteranceDomainFromPool   // 整句一次
              → filterDomainCandidatesPerSpan / assembleDomainAwareSpanSets
         → build-sentence-candidates.ts :: buildSentenceCandidates
              + mergeCrossBucketSentenceCandidates     // 全局 ≤16
         → build-fw-spans-from-coarse-assembly-v4.ts :: buildFwSpansFromFormalFineSpans
    → kenlm/run-fw-sentence-rerank-from-prefilled.ts :: runFwSentenceRerankFromPrefilled
         → KenLMScorer.scoreBatch(string[])
```

**输入条件（已满足目标 §2.1）：** Fine Span 阶段开始时已有整句 `rawText`、音节流、可选 `acousticSlices` / `wordTimeSpans`；**不是**网络逐字流。所谓 LTR「流式」= 句内从左向右扫描。

---

## 3. Current Data Flow

| 阶段 | 主要 DTO | 所有权 |
|------|----------|--------|
| 坐标 | `UtteranceSyllableCoordinate`（syllables + ranges） | Phase 0 SSOT |
| 粗边界 | `CoarseSpan[]` | soft boundary（跨 ≤1） |
| 临时窗 | `GlobalWindowDescriptor` | LTR option / Recall 输入 |
| 召回 | `WindowCandidate`（含 `domains[]`） | Recall → Formal 池 |
| 正式切分 | `FormalFineSpan[]`（**唯一序列**） | LTR commit |
| Vote | `FineSpanPoolForVote` / `PoolVoteCandidate` | 全 Formal 池一次 |
| 组句 | `SpanReplacementPick[][]` / `SentenceCombination` | 按 retainedDomain 桶 |
| KenLM | `prefilledCombinations: SentenceCombination[]` → `string[]` | 无 path 元数据 |

**不存在：** `SegmentationPath` · `boundaryKey` · `pathId` · `LexicalEdge`（作为路径构件）。

`CompatibilityGraphEdge` 是 Formal **之后**候选覆盖/冲突关系，**不是**分界路径图。

---

## 4. Current Fine Span Decision Logic

### 分类（目标 §4.3）

```text
A. 单一贪心路径  ← 当前生产归属
```

不是 B 纯最长匹配（有 K1/K2/K3 比较）；不是 D Beam；不是 E「多 Span 并列无路径」（Formal 是有序互斥序列）。

### Cursor

| 项 | 代码事实 |
|----|----------|
| 创建 | `cursor = 0`（`runLtrFineSpanGeneration`） |
| 每步 | 生成锚定 cursor 的 2..5 窗 → Recall → `commitBestFormalFineSpan` **恰好 1 个** |
| 前移 | `cursor = formalSpan.syllableEnd`（**找到并 commit 即锁死该段边界**） |
| 结束 | `cursor >= syllableCount` |
| 回溯 | **无** |
| 1 音节 | 仅 fallback，保证能前进 |

### 窗口长度（与目标冲突）

| 项 | 当前冻结 `V4_LIMITS` | 目标设计 |
|----|----------------------|----------|
| 正式滑窗 | **2..5** | **1..5 全部连续窗** |
| 1 音节 | fallback only | 正式词库 Edge（若库中有） |
| 跨 coarse | soft，跨 ≤1 | 目标词图以音节连续为准；coarse 需降级/删除硬耦合 |

### 「找到一个词即锁死边界」

**是。** `commitBestFormalFineSpan` 选定胜者后 cursor 跳到其 `syllableEnd`，同起点更长/更短竞争窗全部丢弃，**不会**保留第二条 `boundaryKey`。

---

## 5. Recall and SQLite Audit

### 执行模型

```text
逐窗：for window in windows → recallSpanTopKV3 → V2 tiers + parent
```

| 类型 | 入口 | SQL | TopK 所有权 | domains[] | 逐窗？ | N+1 |
|------|------|-----|-------------|-----------|--------|-----|
| Exact plain/tone | `collectTierCandidatesToneFirst` | prepared base + **dynamic** domain atomic | Runtime cfg / `exactTopK=2` | atomic JOIN+merge | 是 | domain=1–2 stmt/窗 |
| Fuzzy | V2 variants | 同上 × variants | `perVariantLimit` | 同 exact | 是 | 放大 |
| Parent ngram | `lookupParentFragmentsByNgramKey` | prepared ngram | `parentFragmentTopK=3` | 事后 `lookupTermDomainTagsInScope` | 是 | **每 parent 1 tags** |
| Base | base lookup | prepared | maxBase | `[]` | 是 | — |
| Idiom | 默认 `maxIdiomCandidates=0` | — | — | — | — | — |

### 关键确认

1. Exact：**已在 Recall 内**装配完整 in-scope `domains[]`（`queryDomainMultiRowsAtomic`）。
2. Parent：**仍单独补查** `term_domain_tags`（历史补丁；见 2026-07-26 Residue Audit 裁决 B）。
3. **无**逐 Candidate 在 Vote/Assembly 查 tags。
4. 一窗多次 SQLite：plain≈ base+domain(+ngram+tags×K)；tone 不足再翻倍 plain。
5. 同 `pinyinKey`：句内 Utterance Cache 命中率极低（≈0.4%）；跨句靠 Global LRU。
6. `lookupTermDomainTagsInScope` 唯一调用者 = `recall-span-topkv3` → **可内聚删除**（并入 parent 事实装配后）。

### 预算

`maxSqlPerUtterance = 150`（逻辑窗尝试次数 gate，非真实 statement）。

---

## 6. Target Architecture Mapping

| 目标模块 | 现有映射 | 动作 |
|----------|----------|------|
| WindowQuery 1..5 | `GlobalWindowDescriptor` + LTR options | **MODIFY**：生成全句所有 [i,i+L)、L∈1..5；弱化/去掉「仅 cursor 锚定」 |
| LexicalEdge | 无；近邻 = 同 `(start,end)` 的 `WindowCandidate[]` | **MODIFY/新增最小类型**（或复用 descriptor+candidates 映射） |
| SegmentationPath | **无**； FormalFineSpan[] 是单路径 | **新增路径结构**（禁止平行完整 DTO 体系膨胀） |
| Path Domain Vote | `voteUtteranceDomainFromPool` | **MODIFY 调用者**：按 path 切池多次调用；**不改计票** |
| Path Assembly | `runDomainAwareAssembly` + `buildSentenceCandidates` | **MODIFY**：每 path 独立跑；禁止跨 path 拼句 |
| 全局 ≤16 | `mergeCrossBucketSentenceCandidates` | **KEEP 上限**；改为跨 path 配额后再裁 |
| KenLM | `scoreBatch(string[])` | **KEEP**；metadata 在调用前后用 Map 关联 |

---

## 7. Proposed Lexical Lattice Design

### 推荐数据关系（对齐目标 §2.5 / §3）

```text
WindowQuery (去重后批量 Recall)
  → LexicalEdge[start,end) { candidates[] }   // 同边界合并，不按候选展开路径
  → SegmentationPath { boundaryKey, edgeRefs[] }
       → 每 edge 挂共享 Candidate 引用（禁止深拷贝数组）
```

### 复用

| KEEP | 说明 |
|------|------|
| `WindowCandidate` / `HotwordEntry.domains[]` | 候选与领域 SSOT 投影 |
| `syllablesKey` / Phase 0 音节坐标 | 统一 `[start,end)` 音节索引 |
| `blockedFilter` 子集 | Latin/标点 gap 仍应用；**跨 coarse 规则需重评** |
| Global LRU | 跨句 DB 缓存 |

### 同边界多候选

现码 LTR 在 commit 时已把多候选挂在 **一个** FormalFineSpan 上（选边界后保留池内多候选）——**同边界不展开多路径** 这一点与目标一致。  
失败点在于：**不同长度/落点的边界不会同时保留**。

---

## 8. Multi-Path Enumeration Design

### 合法路径约束（目标）

`0` 连续覆盖到 `N`；无重叠空洞；边长 ≤5；仅词库命中边。

### 限宽（建议待测，非新配置强制）

| 参数 | 建议初值 | 依据 |
|------|----------|------|
| `maxSegmentationPaths` | **4** | 现无等价配置；`CoarseAssemblyLimits.maxCoarsePaths` 为死代码不可复用 |
| 每结束位置 path 限宽 | **必须** | 仅句尾限宽会中爆炸 |
| `boundaryKey` 去重 | 必须 | `"0-2\|2-4\|4-6"` |

结构评分允许：覆盖完整、exact/tone/fuzzy 证据、单字降级数、parent 使用数。  
**禁止** KenLM/LLM/最终领域决定边界（现 LTR 也未用 KenLM 定界——KEEP 该原则）。

### 复杂度控制

同边界 Candidate 合并 + TopK + path 限宽 + 全局句候选 16。

---

## 9. Path-Isolated Domain Vote

| 项 | 现状 | 最小改动 |
|----|------|----------|
| 输入 | `FineSpanPoolForVote[]`（每 Formal 一池） | 按 path 的 span 序列重组池 |
| 是否知边界 | 知 fine syllable 范围 | 加 `pathId` 仅诊断可选 |
| 跨 coarse 聚合 | Vote 按 Formal 池累加整句 | 改为 **每 path 一次** `voteUtteranceDomainFromPool` |
| 计票规则 | presence · 0.75 · base 不计 | **KEEP 不动** |
| DB | 不查 | KEEP |

原则满足：**只改调用粒度与输入组织。**

---

## 10. Path-Isolated Sentence Assembly

| 项 | 现状 |
|----|------|
| 输入 | 单一 Formal 序列 + 全句 `retainedDomains` |
| 顺序 | 按 Formal 槽位；interval 枚举非重叠 picks |
| SameDomain | `domains.includes(bucket)` |
| 16 | 每桶内部 cap + **全局** merge cap=16 |
| pathId | 无 |

### 目标隔离

每 `SegmentationPath` 独立 Vote → SameDomain → Assembly；**禁止** PathA 前半 + PathB 后半。

### 全局 16 配额（评估）

| 方案 | 评价 |
|------|------|
| **A：每有效路径先 1，剩余按结构质量分** | **推荐**：避免低结构分路径在 KenLM 前被清零 |
| B：固定比例 | 路径数变化时僵硬 |
| C：局部 TopK 再全局裁 | 实现简单，但易灭掉「唯一怪异但正确」路径 |

禁止候选句全排列（现 `enumerateIntervalPaths` 已有节点上限 1024——KEEP 思想）。

---

## 11. KenLM Integration

| 问题 | 答案 |
|------|------|
| 输入 | 实质 `string[]`（`scoreBatch`） |
| metadata | **不支持**；须在外层 `text → {pathId,boundaryKey,spanRefs}` Map |
| 去重 | Assembly/merge 按 text；同文多路径会并一条——**Trace 会丢多来源**，需改 merge 策略（保留多来源或 path 后缀诊断） |
| 角色 | 评分 + `minDeltaToReplace`；诊断 top3 |
| 是否定界 | **否**（符合目标） |

---

## 12. SQLite Batch Query Feasibility

### 冻结限制遵守

**不建议、不依赖：** 新索引、临时表、持久中间表、改 Schema。

### 实测能力（Electron ABI）

- SQLite **3.49.2**
- `WITH t(x) AS (VALUES …)`：**可用**
- `ROW_NUMBER() OVER (PARTITION BY window_id …)`：**可用**
- better-sqlite3：**同步**主线程；statement 可复用（load 时 prepare）
- 动态 `IN` / `VALUES`：受参数数量与 SQL 长度限制；N≈30 → 窗≈ 5×30−10 ≈ **140** 量级可接受，但需分片

### 方案对比

| 方案 | 内容 | 改动 | CPU | 内存 | 等价性 | 建议 |
|------|------|------|-----|------|--------|------|
| **A 现状** | 窗×分支×tags N+1 | 0 | 高 SQL 次数 | 低 | 基线 | 过渡期 |
| **B 按类型 Batch SQL** | Exact/Tone/Parent/Tags 各一批 + 每窗独立 TopK（窗口函数） | 高 | 可能降往返，但排序/绑定成本上升 | 中 | 需严格等价测试 | **第二阶段** |
| **C 去重 + prepared 复用** | 全句窗去重；冷 LRU；tags multi-id 一次 | **最低** | 降重复与 N+1 | 低 | 易 | **第一阶段 SQL** |

**不得**使用 `WHERE pinyin_key IN (…) LIMIT K` 跨窗共享 LIMIT。

### domains 两阶段（目标强制）

```text
阶段1：每窗 Term TopK（无 tags JOIN + 行级 LIMIT）
阶段2：汇总 term_id → 一次加载完整 term_domain_tags
→ Candidate.domains[] 在进入 Lattice 前完成
→ Vote/Assembly/KenLM 零 SQL
```

与现 exact atomic 精神一致；parent 应并入此模型（删除独立 `lookupTermDomainTagsInScope` 循环）。

### 批量是否一定更快？

**否。** Phase 1 句内 cache 命中≈0.4%；瓶瓶颈在 **每窗多次 statement + parent tags**。  
在禁止新索引/临时表下：

- **预计收益：** 降 parent N+1 + 降重复 pinyin 查询（全句去重后）；全量 Batch SQL 收益需实测。
- **风险：** 动态 SQL 构造、窗口函数排序、大 VALUES 绑定、结果分组错误导致 TopK/多域截断。

**推荐顺序：** 先 **C（去重 + tags 批量装配）** → 等价通过后再评估 **B（Exact Batch）**。

---

## 13. Performance and Memory Assessment

### 13.1 窗口数（目标 1..5；O(5N)）

| N（音节） | 约窗数 Σ_{L=1..5} (N−L+1)+ |
|-----------|------------------------------|
| 6 | 20 |
| 12 | 50 |
| 20 | 90 |
| 30 | 140 |

现码仅 cursor 处 2..5（每步≤4）+ fallback，**远少**于全句 1..5。

### 13.2 SQL 量级（粗估，现码）

```text
现：每 Recall 尝试 ≈ (1~2 tier) + (0~1 ngram) + (0~3 tags)  （冷）
× LTR 步数（≈ Formal 数，dialog 均值 ~12）× 每步 options(~3)
优化后目标：去重窗一次 Exact/Parent + 一次 tags multi
```

精确前后对比必须重跑 instrumented probe（本轮不改代码、不给假数）。

### 13.3 内存

路径应 **引用 Edge**，不复制 `candidates[]`。  
4 paths × ~10 edges × 共享候选：远小于复制。

### 13.4 CPU 风险热点

路径扩展、多次 Vote/Assembly、Batch 窗口函数、DTO 复制。KenLM 仍 ≤16 → **相对可控**。

---

## 14. KEEP / MODIFY / RESTORE / DELETE Matrix

| 项 | 标记 | 说明 |
|----|------|------|
| Phase 0 音节坐标 SSOT | KEEP | |
| SQLite 词库 SSOT | KEEP | |
| `Hotword.domains[]` / Vote 不计 base | KEEP | |
| Domain Vote 计票公式 / 0.75 | KEEP | 只改调用粒度 |
| `maxSentenceCandidates=16` 全局 | KEEP | |
| KenLM 只评分 | KEEP | |
| Global LRU | KEEP | |
| Coarse soft boundary 作为生成硬过滤 | MODIFY→弱化/删除 | 词图以音节连续+blocked gap 为准 |
| LTR `commitBestFormalFineSpan` 唯一路径 | **DELETE**（替换） | 多路径枚举取代 |
| Cursor 贪心推进所有权 | **DELETE**（替换） | |
| 整句一次 `voteUtteranceDomainFromPool` | MODIFY | 改为 per-path |
| 跨桶 merge 假设单 Formal 序列 | MODIFY | 跨 path 配额 |
| `generateGlobalWindows` | DELETE | 死代码 |
| `truncateWindows` 生产路径 | DELETE | |
| `lookupTermDomainTagsInScope` 循环 API | DELETE（并入 Recall 装配后） | |
| Shadow beam / 双链路 | NOT FOUND 生产；KEEP 禁止 | freeze 已禁 |
| `CompatibilityGraph` | KEEP 或后置 | 非分界图；可后评估 |
| Parent P1 始终 | KEEP 语义 | 装配方式 MODIFY |
| 1 音节仅 fallback | MODIFY | 目标要正式 1..5 词库边 |

---

## 15. Target List

```text
[ ] 定位当前 Fine Span 唯一决策点 → commitBestFormalFineSpan
[ ] 定位 Cursor 推进所有权 → runLtrFineSpanGeneration
[ ] 确认统一音节索引 → Phase 0 SSOT
[ ] 实现 1～5 音节 WindowQuery（全句连续）设计
[ ] 复用现有 Recall 生成 LexicalEdge（同边界合并 Candidate）
[ ] Candidate 在 Recall 内完成 domains[]（含 parent）
[ ] 清理 Parent Fragment N+1 标签查询
[ ] 实现完整覆盖 SegmentationPath 枚举
[ ] boundaryKey 去重
[ ] 每个位置路径限宽
[ ] 每条路径独立 Domain Vote
[ ] 每条路径独立 SameDomain
[ ] 每条路径独立 Sentence Assembly
[ ] 全局候选上限保持 16（方案 A 配额）
[ ] KenLM 跨路径统一评分 + 外置 Trace Map
[ ] 保留 pathId / boundaryKey Trace
[ ] 删除旧唯一分界决策（LTR commit）
[ ] 删除旧跨路径统一投票
[ ] 删除旧混合组句假设
[ ] 删除死代码 / 禁止 shadow
[ ] 验证批量/去重查询与逐窗等价
[ ] 修订冻结文档（LTR-only / 无 Beam）后再合入
```

---

## 16. Check List

```text
[ ] 最大窗口严格为 5
[ ] 所有窗口使用音节 [start,end)
[ ] 不混用字符偏移与音节偏移（raw 仅对齐/Trace）
[ ] 不新增 SQLite 索引
[ ] 不创建 SQLite 临时表 / 持久中间表
[ ] 不修改词库 SSOT
[ ] 不新增第二套领域来源
[ ] Domain Vote 不查询数据库
[ ] 下游不补查 term_domain_tags
[ ] 多领域 Candidate.domains[] 完整
[ ] 每窗口独立 TopK（禁止跨窗全局 LIMIT）
[ ] 同边界多候选不展开成多条 SegmentationPath
[ ] 不进行候选句全排列
[ ] 不以 KenLM/LLM 提前决定边界
[ ] 不同路径不共享票池、不混合组句
[ ] 所有路径候选总数 ≤16
[ ] KenLM 仍只负责最终评分
[ ] 无旧新双链路 / 无兼容 fallback 长期残留
```

---

## 17. Regression List（不得破坏）

- Phase 0 Latin/CJK 坐标与 gap block  
- Presence Vote：base 不计票；多域完整；0.75 保留比  
- Parent 结构键不双计  
- 全局句候选 ≤16；KenLM fail-open raw  
- repairTarget / Apply 窄出合同  
- dialog_200 offline 成功语义（改造后需重定义「路径保留」金样例）  
- 冻结测试：无 shadow beam；无 coarse 静默 fallback  

---

## 18. Acceptance Criteria

1. 长 N 输入仅生成连续 1～5 音节窗；  
2. 每合法窗至多一个边界 Edge；Edge 可挂多 Candidate；  
3. 至少两条不同 `boundaryKey` 完整路径可同时保留（词库支持时）；  
4. 每路径 0..N 连续覆盖；  
5. 路径独立 Vote / SameDomain / Assembly；  
6. 合并后句候选 ≤16；  
7. KenLM 跨路径统一排序；  
8. Lattice 前 `domains[]` 完整；Vote/Assembly/KenLM 零 SQL；  
9. SQLite 优化无新索引、无临时表；  
10. 批量/去重结果与逐窗基线字段级等价；  
11. 无双链路、无兼容 fallback；  
12. 相关测试更新并通过；冻结文档已同步。

---

## 19. Risks and Blockers

| ID | Blocker / Risk | 严重度 |
|----|----------------|--------|
| B1 | 冻结文档写明 **LTR 唯一 FineSpan / 无 Beam**；多路径词图需正式修订权限 | **BLOCKER** |
| B2 | 窗合同 2..5+fallback vs 目标 1..5 全生成 | **BLOCKER**（产品确认） |
| B3 | 路径枚举若只句尾限宽 → 组合爆炸 | HIGH |
| B4 | 同文多路径被 text dedup 合并 → Trace 丢来源 | MEDIUM |
| B5 | Batch SQL 复杂度 vs 收益不确定 | MEDIUM |
| B6 | Coarse soft 规则与全句滑窗冲突需显式决策 | MEDIUM |
| B7 | `windowCandidateToDomainAwarePick` 仅 `exact_term`（parent 投票不进组句）— 词图后是否保持 | 需确认 |

---

## 20. Recommended Development Sequence

**本轮不开发。** 建议顺序：

### Phase 0 — 解冻与合同（文档/评审，无代码）

确认：允许多 SegmentationPath；窗 1..5；coarse 角色；`maxSegmentationPaths` 初值。

### Phase 1 — Lattice 骨架（替换 LTR commit）

- 全句 WindowQuery 1..5  
- Recall（可先仍逐窗）→ LexicalEdge  
- Path 枚举 + boundaryKey 去重 + 位置限宽  
- **删除**唯一 Formal 贪心推进  
- 单测：`yi bei na tie shao bing` 双 boundaryKey  

### Phase 2 — Path 隔离 Vote / Assembly / 16 配额

- 多次调用现有 Vote  
- 每 path Assembly  
- 方案 A 全局 16  
- KenLM 外置 Trace Map  

### Phase 3 — SQLite（禁索引/临时表）

1. Parent tags 并入 Recall 装配（删 N+1 API）  
2. 窗去重 + prepared 复用  
3. （可选）Exact `WITH VALUES` + `ROW_NUMBER` 每窗 TopK + tags 二阶段  

### Phase 4 — 清理与回归

删死代码；更新 freeze-contract；dialog_200 / 路径金样例。

---

## 文档一致性（只列，不改）

| 文档 | 冲突 | 建议方向 |
|------|------|----------|
| `docs/fw-detector/ARCHITECTURE.md` / FineSpan LTR 冻结 | 唯一 LTR 主链 | 改为 Lattice + 多 Path |
| `INTERFACE_FREEZE.md` | FormalFineSpan 序列合同 | 增 SegmentationPath |
| `Lingua_Runtime_Evolution_Rule.md` | 字段演进管线 | pathId/boundaryKey 走 Freeze→Catalog |
| Domain Vote / Presence 冻结文 | 「全 Formal 池一次 Vote」 | 改为 per-path 调用边界 |
| Sentence Assembly / ≤16 文 | 单序列假设 | 跨 path 配额 |
| Phase 0/1/2 SQL 审计 | 逐窗+tags N+1 | 与 Lattice 批量对齐 |
| `freeze-contract.test.ts` | 钉死 LTR / 无 beam 符号 | 随实现重写门禁 |

---

## Final Answers（强制明确）

1. **能否直接进入开发？** → **否**（`READY WITH BLOCKERS`）；先解冻合同再写代码。  
2. **开发前必须先清理什么？** → LTR 唯一 commit 作为 FineSpan SSOT 的地位；明确 1..5 窗合同；parent tags 二次查询归入 Recall 装配计划。  
3. **只需改调用方式的模块？** → Domain Vote 计票、KenLM scorer、全局 16 merge 思想、Global LRU。  
4. **需要重构的模块？** → FineSpan 生成（LTR→Lattice）、Orchestrator 主链、Assembly 输入组织、Trace/DTO。  
5. **应直接删除的旧逻辑？** → 贪心 Formal 唯一路径；生产不可达 `generateGlobalWindows`/`truncateWindows`；并入装配后的 `lookupTermDomainTagsInScope` 循环；禁止复活 shadow beam。  
6. **SQLite 批量采用？** → **先 C（去重 + prepared + tags 一次加载）**；再评估 B（`WITH VALUES` + 每窗 `ROW_NUMBER` TopK）。  
7. **禁索引/临时表下的收益与风险？** → 收益：降 N+1 与重复 key；风险：动态 SQL/分组错误/未必降 P95。  
8. **第一开发阶段范围？** → **Phase 1 Lattice 骨架**（全句 1..5 窗 → Edge → 有限完整 Path → 单测双边界），Vote/Assembly 可暂仍跑「每 path 调用现有函数」的最小接线；**不做** Batch Framework。

---

*证据来源：`ltr-fine-span-generator.ts` · `span-assembly-v4-orchestrator.ts` · `recall-topk-for-windows.ts` · `recall-span-topkv3.ts` · `lexicon-runtime-v2.ts` · `utterance-domain-vote.ts` · `assemble-domain-aware-span-sets.ts` · `build-sentence-candidates.ts` · `run-fw-sentence-rerank-from-prefilled.ts` · `v4-limits.ts` · Electron SQLite 3.49.2 探测 · 既有 Phase0/1/2 与 Domain Tag Residue 审计。*
