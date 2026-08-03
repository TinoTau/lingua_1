<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: CURRENT SSOT + Acceptance Records
Archive Path: docs/archive/HISTORICAL/FW_Repair_V4_Lexical_Connectivity_Repair_V1_Batch1_1A_Truncation_Aware_Uniqueness_Generalization_Audit_Report_2026_07_28.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: CURRENT SSOT + Acceptance Records

# FW Repair V4 — Lexical Connectivity Repair V1 · Batch 1.1A Truncation-aware Uniqueness Generalization Audit

| Field | Value |
|-------|-------|
| Date | 2026-07-28 |
| Stage | **4 — Generalization Audit** |
| Production code changes | **None** |
| Next if PASS | Stage 5 Cleanup & Gate |
| Forbidden | Batch 1.1B · Batch 2 · claiming Batch 1.1A final PASS |

---

## 1. Executive Summary

Stage 3 修复（`returnedCount >= requestedLimit → fetchMayBeTruncated → residual singleton 拒收`）在真实 SQLite / Electron / 正式 Recall 入口上对 **plain+tone、7/8/9 边界、eligibility/cache/下游** 做了泛化核对。

核心产品判断：

```text
exact-limit reject:
ACCEPTED CONTRACT
```

即：数据库恰好 `total == LIMIT` 且过滤后唯一时，当前也会拒绝。这是在「无法区分真截断 vs 恰好满页」时，按 **宁可漏修、不可误修** 接受的有意保守策略，**不是**阻塞性假阴性缺陷。

---

## 2. Final Verdict

```text
BATCH 1.1A STAGE 4 GENERALIZATION:
PASS

TRUNCATION-AWARE UNIQUENESS GENERALIZES
EXACT-LIMIT REJECTION ACCEPTED AS CONSERVATIVE CONTRACT
READY FOR STAGE 5 CLEANUP & GATE
```

---

## 3. Scope and Non-goals

| In scope | Out of scope (recorded only) |
|----------|------------------------------|
| Truncation-aware uniqueness generalization | Surface rank9 / independent probe (1.1B) |
| Exact-limit product decision | Tone unsupported policy (1.1C) |
| Cache / completeness / plain·tone parity | Hard-block ellipsis (1.1D) |
| Downstream Edge/Path/Vote under reject | Production cutover · Batch 2 |

本轮未修改 Recall / Runtime / SQL。

---

## 4. Current Contract (CR 1.0.4)

与实现对齐（以代码为准，报告一致）：

1. Runtime `LIMIT` = 有界 fetch  
2. `returnedCount == requestedLimit` ⇒ **可能**截断  
3. 截断风险下 residual singleton ≠ 语义唯一  
4. 真唯一仅在未满页可见集合成立  
5. 不授权 surface probe / tone unsupported / HB ellipsis  

---

## 5. Code Re-verification

| Symbol | Current behavior |
|--------|------------------|
| `LENGTH1_AMBIGUITY_SQL_LIMIT` | 常量 `8`（唯一硬编码绑定） |
| `length1FetchMayBeTruncated` | `returnedCount >= requestedLimit`（算法无 `==8` 特判） |
| `resolveLength1BaseCandidate` | singleton + truncated → `null`；else surface-in-set |
| `collectBaseOnlySingleCharCandidate` | plain / tone 均传 truncation fact |
| 生产过拟合 | **无**固定汉字/拼音/`rowCount=9`/`aliasCount=7` |

报告与代码：**一致**。

---

## 6. 7/8/9 Boundary Matrix

证据：`docs/tone-v2/_audit_scratch/lattice_v1_batch1_1a/stage4_boundary_matrix.json`  
探针：`batch1-1a-stage4-generalization.audit.test.ts`（16 PASS，Electron）。

| DB total | returned | eligible=1 | Expected / Observed |
|---------:|---------:|-----------:|---------------------|
| 7 | 7 | 1 | **accept** / accept |
| 8 | 8 | 1 | **conservative reject** / reject |
| 9 | 8 | 1 | **reject** / reject |

---

## 7. Plain Results

| ID | Scenario | final |
|----|----------|------:|
| P1 | total=7 eligible=1 | 1（庚） |
| P2 | total=8 eligible=1 | **0**（exact-limit） |
| P3 | total=9 eligible=1 | 0 |
| P4 | total=8 eligible=0 | 0 |
| P5 | total=8 eligible≥2 | 0（非 Top1） |
| P6 | total=7 eligible≥2 + surface | 1（懂） |

---

## 8. Tone Results

| ID | Scenario | final |
|----|----------|------:|
| T1 | total=7 eligible=1 | 1 |
| T2 | total=8 eligible=1 | **0**（exact-limit） |
| T3 | total=9 eligible=1 | 0 |
| T4 | total=8 eligible=0 | 0 |
| T5 | total=8 eligible≥2 | 0 |
| T6 | total=7 + surface | 1（下） |

plain / tone **行为同构**。

---

## 9. Exact-limit Analysis

**事实（P2/T2）：**

```text
DB total = 8（不存在第 9 行）
Runtime returned = 8
eligible = 1
Recall Candidate = 0
```

**机制：** truncation fact 只看满页，不区分「恰好 8」与「>8 被截断」。

**为何现在这样设计：** Stage 1/2 选择零额外 SQL（无 count/existence probe），用机械满页信号避免假唯一；代价是 exact-limit 假阴性。

---

## 10. Product-level Decision

```text
exact-limit reject:
ACCEPTED CONTRACT
```

选择 **Option A**，依据：

1. 项目明确优先 **避免误修**（假唯一会生成错误 lexical Candidate/Edge）。  
2. exact-limit ∩ residual-singleton 是窄角落（同键 enabled 行恰好 = LIMIT 且过滤后剩 1）。  
3. 拒绝后由既有 **fallback edge** 补连通性空洞，Recall 不回灌 Top1。  
4. CR 1.0.4 字面已写 `returnedCount == requestedLimit` ⇒ may be truncated；与实现一致。  
5. 若未来召回损失不可接受，应开独立 **Batch 1.1A-2**（count/LIMIT+1 probe）——**本轮不实现、不定方案**。

**不是** BLOCKING GENERALIZATION DEFECT。

---

## 11. LIMIT Metamorphic Tests

| Check | Result |
|-------|--------|
| 算法依赖固定 8？ | **否** — 谓词仅为 `returnedCount >= requestedLimit` |
| 生产 `== 8` / 固定汉字？ | **否** |
| Cache LIMIT=1↔8 | 行数互不污染（见 CACHE case） |
| 生产常量可注入？ | 否；未改生产代码；用 LIMIT=1/8 Runtime 调用验证算法泛化 |

---

## 12. Eligibility Metamorphic Tests

| Mix | Result |
|-----|--------|
| alias + disabled + prior≤0，total&lt;LIMIT，eligible=1 | **accept**（伪） |
| 全 alias / 多 eligible | empty / 非 Top1（P4/P5/T4/T5） |

结论：规则不绑定「7 alias + 1 legal」固定模式。

---

## 13. Ordering Metamorphic Tests

合法候选在 top-LIMIT 末位（Stage 3 已测）与矩阵多种 prior 排序下，截断拒绝 / 非截断接受仍成立。  
`LIMIT+1` surface：**仍不可达**（RANK9）— Known Defect → 1.1B，**非本轮回归**。

---

## 14. returnedCount&lt;limit Completeness Audit

| Layer | Finding |
|-------|---------|
| SQL | 单一 `LIMIT ?`；`enabled=1 AND length(word)=?` |
| Runtime base lookup | 无二次 slice；cache 原样返回 |
| length=1 Recall | 无 tier collector 预截断 |
| disabled | **在 SQL 内过滤**，不占 LIMIT 槽 |
| alias | **在 SQL 外过滤**，占 LIMIT 槽（设计已知） |

**问题：是否存在 `returnedCount < limit` 但仍有更多同键 enabled 行不可见？**

```text
No — for the SQL predicate (pinyin[/tone], enabled=1, length=word).
```

因此 `returnedCount < limit ⇒ 该谓词下可见集合完整` 成立；当前 uniqueness Contract **可靠**。

（若未来把 alias 也下推到 SQL 排除，LIMIT 语义会变化——属另案，非现状。）

---

## 15. Runtime Cache Audit

| Lookup | Cache key includes |
|--------|-------------------|
| plain base | `base:plain:{key}:{termLength}:{limit}` |
| tone base | tier 串含 `tone` + pinyin + toneKey + termLength + limit；lookupTier 再拼 limit |

验证：

```text
LIMIT=1 → 8 与 8 → 1：行数正确
plain / tone namespace 分离
```

```text
Cache behavior: SAFE
```

---

## 16. Plain/Tone Consistency

| Aspect | Plain | Tone |
|--------|-------|------|
| requested limit | 8 | 8 |
| truncation fact | 同 | 同 |
| eligibility | 同 | 同 |
| surface-in-set | 同 | 同 |
| cap | 1 | 1 |
| stage label | plain_only_no_pattern / tone_exact | （tone unsupported 政策未改） |

无隐藏歧义影响 Generalization。

---

## 17. Surface Behavior

| Case | Status |
|------|--------|
| Surface in fetched set（P6/T6） | **未破坏** |
| Surface at LIMIT+1（RANK9） | 仍不可达；Known Defect 1.1B |

---

## 18–19. Candidate→Edge→Path / Fallback

| Case | Result |
|------|--------|
| 真唯一「点」 | Candidate → lexical Edge → retained Path |
| exact-limit reject | No Candidate → No lexical Edge；无 hidden Top1 |
| Fallback | 既有机制负责补洞；Recall 不回补错误候选 |

---

## 20. Vote Isolation

exact-limit / false-unique 拒绝窗口：`domainScores={}`；base length=1 仍 `domains=[]`。

---

## 21. Diagnostics / Trace

| Observation | Judgment |
|-------------|----------|
| truncation reject 与 no-eligible 在 hit 计数上均表现为「无 Candidate」 | 可排查性 **PARTIAL** |
| `singleCharHitCount` 不把拒绝记为命中 | **OK** |
| 无专用 `rejectedDueToTruncation` 字段 | Stage 5 **可选** cleanup / 独立 diagnostics 项；**非 Stage 4 blocker** |

---

## 22. SQL / Performance Impact

| Metric | Evidence |
|--------|----------|
| Extra SQL probe | **无** |
| Pagination / full fetch | **无** |
| physicalSqlAfterTrueUniqueRecall | **1**（单次 base lookup） |

结构上相对 Stage 2 前：**无额外 DB round trip**。

---

## 23. Production Build Isolation

- `npm run build:main` SUCCESS  
- audit test / matrix JSON / helper **不进 dist**  
- inventory：`batch1_1a_stage4_dist_test_resource_inventory.json` → **CLEAN**

---

## 24. Regression Results

Stage 4 矩阵 **16 PASS**。未改生产逻辑，Stage 3 回归集仍适用（100 PASS 此前已记录）。本轮未重跑全量 2–5（无代码 diff）；若 Stage 5 要求可再跑一次作为门禁附件。

---

## 25. Known Defects

1. **Surface rank9 unreachable** — Batch 1.1B  
2. **Tone unsupported → plain** — Batch 1.1C  
3. **HB ellipsis `…`** — Batch 1.1D  
4. Diagnostics 难区分 truncation vs empty — Stage 5 optional  

---

## 26. Risks

| Risk | Mitigation / status |
|------|---------------------|
| exact-limit 漏召回 | **Accepted**；可后续 1.1A-2 |
| alias 占 LIMIT 槽加剧满页 | 已知；保守策略覆盖 |
| 误把 rank9 当回归 | 已标注 Known Defect |

---

## 27–30. KEEP / MODIFY / DELETE / NEW

| Class | Items |
|-------|-------|
| KEEP | CR 1.0.4；truncation fact；LIMIT=8 常量；无 probe 设计 |
| MODIFY | （生产）无；可选 Stage 5 文档/诊断澄清 |
| DELETE | 无 |
| NEW | Stage 4 矩阵 JSON；本审计报告；audit 探针测试文件 |

---

## 31. Target List

```text
[x] 代码与 CR 1.0.4 核对
[x] plain/tone 7/8/9
[x] exact-limit / zero / multi eligible
[x] LIMIT 过拟合审计
[x] returnedCount<limit 完整性
[x] cache 顺序变形
[x] eligibility / ordering
[x] surface + rank9 Known Defect
[x] Edge/Path/Vote
[x] SQL 次数
[x] dist inventory
[x] exact-limit 产品结论 = ACCEPTED CONTRACT
[x] 输出本报告
```

---

## 32. Check List

```text
[x] 未修改生产代码
[x] 未新增 SQL probe / Runtime uniqueness API
[x] 未修 rank9 / tone unsupported / HB
[x] 未进 1.1B / Batch 2
[x] 未 Fake Runtime
[x] 未模糊 exact-limit 结论
[x] 未忽略 cache / tone
```

---

## 33. Stage 5 Recommendation

```text
READY FOR STAGE 5 CLEANUP & GATE

建议 Stage 5：
- 归档 before/after + stage4 matrix
- 确认 audit 探针是否保留在仓库（测试资源，已排除 dist）
- 可选：文档注明 exact-limit = 有意保守
- 可选：diagnostics 拒绝原因（独立小项，非必须）
- 门禁通过后才允许开始 Batch 1.1B Design/Dev
```

**不得**在 Stage 5 完成前输出 READY FOR BATCH 1.1B / BATCH 2 / BATCH 1 PASS。
