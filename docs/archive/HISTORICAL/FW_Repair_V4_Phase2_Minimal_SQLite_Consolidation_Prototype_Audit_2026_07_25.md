<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: CURRENT SSOT + Acceptance Records
Archive Path: docs/archive/HISTORICAL/FW_Repair_V4_Phase2_Minimal_SQLite_Consolidation_Prototype_Audit_2026_07_25.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: CURRENT SSOT + Acceptance Records

# FW Repair V4 — Phase 2 Minimal SQLite Consolidation Prototype Audit

| Field | Value |
|-------|-------|
| Date | 2026-07-25 |
| Type | Read-only audit + scratch prototype（非生产接入） |
| Upstream | Phase 0 PASS · Phase 1 PASS WITH LOW CACHE HIT RATE |
| Probe | `docs/tone-v2/phase2_minimal_sqlite_consolidation_probe.json` |
| Harness | `docs/tone-v2/_audit_scratch/phase2-minimal-sqlite-consolidation-probe.mjs` |

---

## 1. Executive Summary

| Question | Answer |
|----------|--------|
| Phase 1 `physicalSqlStatementCount=11034` 是否准确？ | **否**（低估）；本轮已修 metrics，未改业务语义 |
| 是否存在可合并的重复 SQLite statement？ | **是** — 主要在 parent 路径的 `term_domain_tags` 逐 term 动态 prepare/execute |
| 是否需要通用 Batch 架构？ | **否** |
| 最终裁决 | **PROCEED ONE MINIMAL RUNTIME CONSOLIDATION** |

唯一推荐改动点：

```text
LexiconRuntimeV2 内私有 multi-term_id term_domain_tags lookup
← 替代 parent fragment 路径上 N 次单 term 动态 prepare
```

不新增 Recall 链 / 导出 DTO / 配置 / Batch 层。

| Candidate | Verdict |
|-----------|---------|
| A — term_domain_tags 合并 | **PROCEED MINIMAL CONSOLIDATION** |
| B — domain ID 复用 | **KEEP CURRENT**（已由 RuntimeDomainRegistry 完成） |
| C — exact lookup 小批合并 | **REJECT — COMPLEXITY INCREASE** |

---

## 2. Existing Production SSOT

唯一生产链（保持不变）：

```text
LTR temporary window
→ recallTopKForWindows
→ recallSpanTopKV3
→ recallSpanTopKV2
→ LexiconRuntimeV2
→ SQLite
→ score / bind
→ Formal FineSpan
```

| SSOT | Owner |
|------|-------|
| Lexicon 数据 | SQLite（唯一） |
| Recall 业务语义 | V2/V3（tone-first / merge / score / parent / TopK） |
| Domain 可用性 / 层级 | `RuntimeDomainRegistry`（load 时自 SQLite 构建一次） |
| 句内去重 key | Canonical RecallQueryKey（Utterance Cache；本轮不改） |
| FineSpan 坐标 | Phase 0 `buildUtteranceSyllableCoordinate` |

---

## 3. Real SQLite Execution Inventory

| 文件 | 函数 | Statement | 查询类型 | 生产可达 | Phase1 是否计数 |
|------|------|-----------|----------|----------|-----------------|
| `lexicon-runtime-v2.ts` | `lookupTier` → `stmtBase.all` | prepared | base plain | YES（FW） | YES（+1） |
| `lexicon-runtime-v2.ts` | `lookupBaseByPinyinAndToneKey` | prepared | base tone | YES（有 tone） | YES（+1） |
| `lexicon-runtime-v2.ts` | `lookupTier` → `stmtIdiom.all` | prepared | idiom | 默认 off（`maxIdiomCandidates=0`） | YES if used |
| `lexicon-runtime-v2.ts` | `lookupIdiomByPinyinAndToneKey` | prepared | idiom tone | 默认 off | YES if used |
| `lexicon-runtime-v2.ts` | `queryDomainMultiRowsAtomic` idSql | **dynamic prepare** | domain plain/tone ids | YES | **曾只 +1，实为 1–2** |
| `lexicon-runtime-v2.ts` | `queryDomainMultiRowsAtomic` rowSql | **dynamic prepare** | domain rows+tags join | YES（有 hit） | **曾漏计** |
| `lexicon-runtime-v2.ts` | `stmtDomain` / `stmtDomainToneComposite` | prepared at load | domain single | **未走 multi 主路径** | N/A |
| `lexicon-runtime-v2.ts` | `lookupParentFragmentsByNgramKey` | prepared `stmtNgram.all` | parent ngram | YES | **曾未计入 physical（在 ngram 计数器）** |
| `lexicon-runtime-v2.ts` | `lookupTermDomainTagsInScope` | **dynamic prepare** | term_domain_tags | YES（parent） | **曾完全未计** |
| `lexicon-runtime-v2.ts` | `lookupIndustryRoutes` | prepared | industry routing | 非 LTR Recall | 否 |
| `runtime-domain-registry.ts` | `buildRuntimeDomainRegistry` | DISTINCT domain_id + hierarchy | domain id inventory | load-time only | 否（启动） |
| `lexicon-runtime-v2.ts` | load COUNT(*) | dynamic | manifest/version counts | load-time only | 否（启动） |

`prepare` 与 `execute`：**分开**。prepared path = load 时 prepare 一次 + 运行时 `.all`；domain atomic / tags = **每次** `db.prepare(...).all(...)`。

Global LRU hit：`tierSqlQueries` / `ngramSqlQueries` **不增加** → physical **0**（正确意图）。  
但 **tags 不进 Global LRU**，故 warm 同 key 仍会反复打 tags SQL。

---

## 4. Physical SQL Metric Accuracy

### 问题回答

1. **11034 是否准确实测？** → **不准确（低估）**。只看 `tierSqlQueries` delta，且 domain atomic 把 2 条算成 1，tags/ngram 漏计。
2. **helper +1 但内部多条？** → **是**：`lookupDomainsByPinyinKeyMulti` / tone multi → `queryDomainMultiRowsAtomic` 执行 1（无 hit）或 2（有 hit）条。
3. **Global LRU hit = 0 physical？** → tier/ngram **是**；tags **否**（从未缓存）。
4. **动态 `db.prepare()` 是否统计？** → Phase1 **未单独计 prepare**；execute 对 tags 曾完全漏计。
5. **prepare vs execute？** → 未分开；本轮仍以 **execute（.all/.get）** 为 physical statement。
6. **一次 domain atomic？** → **1 或 2** 条 statement。
7. **一次 parent fragment lookup？** → **1** 条 ngram + **0..K** 条 tags（K≤`parentFragmentTopK`，且受 per-parent / filter 影响）。
8. **典型 V3（offline 无 tone）分布（修计数后实测）？**

| Sample | Cold physical | Warm physical | 说明 |
|--------|---------------|---------------|------|
| `ji\|chang` | **7** | **3** | warm 的 3 全来自 tags（base/domain/ngram LRU hit） |
| `zhong\|bei` | **5** | **1** | tags 仍打 |
| `wang\|jing` | **3** | **0** | 无 parent hit → 无 tags |

### 本轮 metrics-only 修复（允许）

- `queryDomainMultiRowsAtomic` 返回 `statementCount` ∈ {0,1,2}
- `lookupTermDomainTagsInScope`：`tierSqlQueries += 1`
- `getPhysicalStatementStats()` = tier + ngram；`recallTopKForWindows` 改用该合计

**未改**候选语义 / 排序 / Parent P1。

---

## 5. Per-Request Statement Breakdown

Offline GT（无 acoustic tone）→ `plain_only_no_pattern`：

```text
cold miss 典型:
  base plain          1
  domain atomic       1–2   (dynamic SQL)
  parent ngram        1
  term_domain_tags    0–3+  (dynamic SQL, 每接受的 parent)
```

`countToneSqlQueries` 中的 “domain +1” 是 **helper 计数语义**，不是真实 statement 数。

同 LTR cursor：局部 2..5 window → 多个 **不同** pinyin key（上界扫描 mean≈3.55 options/cursor）。Utterance Cache 命中率仅 0.4%，说明同句 Canonical 重复极少；exact 合并跨 key 的机会主要在「同一步多 window 同时 miss」，但实现成本高（见 Candidate C）。

---

## 6. Existing Global LRU / Domain Registry Reuse

| 机制 | 作用 | 本轮结论 |
|------|------|----------|
| Global LRU 512 | base/domain/idiom/ngram 结果 | KEEP；tags **未覆盖** |
| RuntimeDomainRegistry | load 时 DISTINCT fine domains + hierarchy | **已消除** per-request domain-id SQL |
| resolveRecallScope | 把 config domains 投影到 registry | 传入 V3 的 `domainIds` |

Candidate B **无需再开发**。

---

## 7. Candidate A — term_domain_tags

**现象**：`lookupParentFragments` 对每个接受的 parent 调用 `lookupTermDomainTagsInScope` → 每次动态 prepare + 1 execute；**且不走 LRU**。

**原型**（仅 `_audit_scratch`）：

```sql
SELECT term_id, domain_id
FROM term_domain_tags
WHERE term_id IN (...) AND domain_id IN (...)
ORDER BY term_id, domain_id
```

→ Node 按 `term_id` 分组（保留一词多领域多行）。

### 实测

| Metric | One-by-one | Multi IN |
|--------|------------|----------|
| statement 合计（探针用例） | **51** | **12** |
| 降幅 | — | **≈76.5%** |
| rowEquivalent | — | **true** |
| orderEquivalent（按 domain_id sort） | — | **true** |
| warm P95 ms（6 terms） | 0.59 | **0.25** |

EXPLAIN：single / multi 均走 covering PK index `sqlite_autoindex_term_domain_tags_1`。

**Verdict: PROCEED MINIMAL CONSOLIDATION**

---

## 8. Candidate B — domain ID reuse

- Registry：`availableFineDomains` 来自 `SELECT DISTINCT domain_id FROM term_domain_tags`（load 一次）
- Recall：`domainIds` 来自 `resolveRecallScope`，**无** per-request domain-id SQL

**Verdict: KEEP CURRENT**（`ssotSafe=true`，statementBefore=After=0）

---

## 9. Candidate C — exact lookup consolidation

原型：多 key `IN` 拉行 → 按 key 分组 → 每组 `slice(limit)`（**禁止**共享 `LIMIT N`）。

| 结果 | 值 |
|------|-----|
| row/order equivalent（per-key TopK） | true |
| statement 4→1（微基准） | 有降幅 |
| warm P95 | 0.72 → 0.53 ms（微） |
| 生产复杂度 | +分支（tone/plain、domain atomic 双语句、per-key TopK）≈120LOC |

同 cursor 多 key 是常态，但：

- 已有 Global LRU
- domain 路径本就 2-statement dynamic SQL，合并更难
- 易滑向「第二条 batch API」

**Verdict: REJECT — COMPLEXITY INCREASE**

---

## 10. Prototype SQL

见 harness；**未**进入生产调用链。

Candidate A 唯一建议落点：

```text
LexiconRuntimeV2.lookupTermDomainTagsInScopeMulti(termIds, domainIds) // private
recall-span-topkv3 lookupParentFragments: 先收集 candidate parentTermIds → 一次 multi → map 取值
```

可删除/收敛：循环内 N 次 `lookupTermDomainTagsInScope` 动态 prepare（保留单 id API 作薄封装亦可）。

---

## 11. EXPLAIN QUERY PLAN

| Query | Plan（摘要） |
|-------|----------------|
| tags single | COVERING INDEX PK `(term_id=? AND domain_id=?)` |
| tags multi | 同上 |
| domain atomic id | `idx_domain_pinyin` / tone + join tags + TEMP B-TREE GROUP/ORDER |
| parent ngram | `idx_term_ngram_key (ngram_pinyin_key, enabled)` + TEMP ORDER |

---

## 12. Row Equivalence Results

| Candidate | 100% row eq |
|-----------|-------------|
| A tags | **YES**（空/单/多/重复 term_id/多 domain scope） |
| B | N/A（无 SQL 变更） |
| C exact per-key | **YES** |

---

## 13. Ordering Equivalence Results

| Candidate | order eq |
|-----------|----------|
| A（`ORDER BY term_id, domain_id` + 组内 sort） | **YES** |
| C（组内 `prior_score DESC` + limit） | **YES** |

---

## 14. Performance Results

计时边界：原型 A/B 两侧相同；冷首条单独记录，稳态用 warm n≥29。

| 场景 | Before | After |
|------|--------|-------|
| tags warm P50 | 0.38 ms | **0.13 ms** |
| tags warm P95 | 0.59 ms | **0.25 ms** |
| tags statements（用例包） | 51 | **12** |
| exact micro P95 | 0.72 ms | 0.53 ms（但 REJECT） |

生产全量 dialog_200 P95 **未**在本轮重跑（本轮禁止接 LTR）；正式开发时应 Cold/Warm LRU 分列重测。

---

## 15. Complexity Delta

| 项目 | 当前 | 推荐原型 A |
|------|------|------------|
| 生产函数数量 | 1（`lookupTermDomainTagsInScope`） | +1 private multi（或内聚） |
| 导出类型数量 | 0 | **0** |
| 配置项数量 | 0 | **0** |
| Runtime 分支数量 | 低 | +1（空 ids 短路） |
| SQL statement 数 / parent 请求 | 1 ngram + N tags | 1 ngram + **1** tags |
| 代码行变化 | — | ≈40 |
| 语义风险 | — | 低（分组保留多领域行） |

满足：**删除的 statement 调用 > 新增抽象**。

Candidate C 不满足复杂度负增长。

---

## 16. SSOT Compliance

| 约束 | 状态 |
|------|------|
| 无第二条 Batch 层 / Queue / Feature | ✅ |
| 无新导出 DTO / 正式 SqlFactQueryKey | ✅ |
| 无新配置 / feature flag | ✅ |
| 无第二 Recall 链 | ✅ |
| 评分/TopK/Parent P1 不改 | ✅ |
| SQLite 仍为唯一词库 SSOT | ✅ |

---

## 17. KEEP / MODIFY / REJECT

| 项 | 决定 |
|----|------|
| LTR / Coordinate / Vote / Sentence / KenLM | KEEP |
| Utterance Cache（Phase 1） | KEEP（本轮不删） |
| Domain Registry | KEEP |
| Global LRU | KEEP |
| Exact cross-key batch | REJECT |
| Domain-id per-request SQL | 不存在 → KEEP |
| term_domain_tags 单 term 循环 | **MODIFY（唯一推荐）** |
| physical SQL metrics | **MODIFY（本轮已修）** |

---

## 18. Phase 1 Cache Assessment

| 问题 | 结论 |
|------|------|
| 是否 Phase 2 必需基础？ | **否** — 合并在 Runtime 内部即可 |
| 是否删除？ | 本轮 **KEEP**；命中率低但语义中性、可观测；**REMOVE LATER** 仅当证明纯负担 |

不得为抬高 Phase 1 价值而造 Batch 层。

---

## 19. Risks

1. Parent 路径若改为「先滤 row 再 multi tags」，必须保持与现序相同的接受集合（perParent / domain filter / TopK）。
2. 动态 SQL 占位符长度随 term 数变化 — parent TopK 很小（≤3–12），可接受；勿做成无限 IN。
3. Domain atomic 仍每次 dynamic prepare — 本轮**不**建议动（复杂度高，且已有 LRU）。
4. 修计数后 dialog_200 `physicalSql` 绝对值会上升（更真），不可与旧 11034 横比。

---

## 20. Final Recommendation

# **PROCEED ONE MINIMAL RUNTIME CONSOLIDATION**

| 维度 | 说明 |
|------|------|
| 唯一 SSOT | SQLite + 现有 V2/V3；改动仅 `LexiconRuntimeV2`（+ parent 调用点） |
| 删除的重复执行 | 同一 V3 request 内 N 次 `term_domain_tags` 动态 prepare/execute |
| 新增长期结构 | **1 个私有 multi-id helper**；0 导出类型；0 配置；0 新 Recall API |
| 为何复杂度不增加 | 用一次索引查询替换循环；无 Batch 框架；无双实现长期并存 |

**禁止**：`PROCEED FULL BATCH ARCHITECTURE`。

正式开发范围应 **仅 Candidate A**；不得打包 B/C。

---

*Metrics 修复已落在 `lexicon-runtime-v2.ts` / `recall-topk-for-windows.ts`（计数 only）。原型 SQL 仅在 `_audit_scratch`，未接生产 LTR。*
