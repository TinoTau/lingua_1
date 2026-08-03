<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: CURRENT SSOT + Acceptance Records
Archive Path: docs/archive/HISTORICAL/FW_Repair_V4_Lexical_Connectivity_Repair_V1_Batch1_Generalization_And_Batch2_Readiness_Audit_2026_07_28.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: CURRENT SSOT + Acceptance Records

# FW Repair V4 — Lexical Connectivity Repair V1  
## Batch 1 Generalization / Test-Overfitting Audit  
## + Batch 2 Lexicon Write Capability Readiness Audit

| Field | Value |
|-------|-------|
| Date | 2026-07-28 |
| Nature | **只读** · 反测试迎合 · 生产泛化 · Batch 2 准备门禁 |
| Code/Test/Fixture/SQLite/Contract 修改 | **无** |
| Evidence | [`_audit_scratch/lattice_v1_batch1_generalization/`](./_audit_scratch/lattice_v1_batch1_generalization/) |

---

## 1. Executive Summary

Batch 1 的 **生产规则本体大体是通用的**（无 fixture 汉字硬编码；length=1 分支不依赖 `NODE_ENV`/`JEST`；domain lookup 在 length=1 路径上代码不可达；cap 位于歧义判定之后；Hard-block 邻接删除为正则级规则）。

但按本轮门禁，**不能**判定为「已证明生产泛化完成」，因为存在三类硬缺口：

| # | 类别 | 问题 | 等级 |
|---|------|------|------|
| 1 | B/生产污染 | `connectivity-batch1-fixture.ts` 位于 `main/src`，**未被** `tsconfig.main` exclude，且 `electron-builder` 打包 `dist/main/**/*` | **P0** |
| 2 | D/证明不足 | Batch 1 **零**真实临时 SQLite + `LexiconRuntimeV2` 集成证据；全部依赖 in-memory fake | **P0**（规格强制 CONDITIONAL） |
| 3 | D/语义 | `LENGTH1_AMBIGUITY_SQL_LIMIT=8` 可在截断后 **假唯一**；surface exact 落在第 9 名则不可达 | **P0** |

另有 P1：语气 unsupported 时回落到 plain；Hard-block 未覆盖省略号 `…`；部分测试 SELF-FULFILLING；2–5 仅 suite 绿无内容级 golden。

---

## 2. Final Verdict

```text
BATCH 1 GENERALIZATION AUDIT:
CONDITIONAL

GENERALIZATION / TEST ISOLATION GAPS MUST BE FIXED
BEFORE BATCH 2
```

```text
BATCH 2 STATUS:
BLOCKED
```

阻塞原因：§21 P0 未清；本轮不得设计正式 Batch 2 开发范围。

---

## 3. Audit Scope

只读审计：`recall-span-topk-v2.ts`、`recall-topk-for-windows.ts`、`lattice-hard-block-filter.ts`、Phase1/2 harness、Batch1 tests/fixture、tsconfig / electron-builder、既有 2–5 测试与报告表述。  
未改代码/测试/词库/Contract。

---

## 4. Fixture Literal Inventory

详见 [`fixture_literal_inventory.json`](./_audit_scratch/lattice_v1_batch1_generalization/fixture_literal_inventory.json)。

| 结论 | 证据 |
|------|------|
| 生产 Recall/HB/call-site/harness **无**「我/吗/点/是/市/我想/拿铁」分支 | rg 无匹配 |
| Fixture 词条仅出现于 fixture / `*.test.ts` / docs | 允许 |
| `createBatch1FixtureRuntime` 定义在非测试 `.ts` | **不允许（污染风险）** |

**A. 数据硬编码：** 生产路径 **未发现**。风险在 fixture **文件落点**，非字面量进算法。

---

## 5. Fixture Isolation

| 检查项 | 结果 |
|--------|------|
| 被 production import？ | **否**（仅 `*.test.ts`） |
| `tsconfig.main` exclude？ | **否** — 仅排除 `**/*.test.ts` |
| `include` | `main/src/**/*` → fixture **会被 tsc 编译进 dist** |
| electron-builder `files` | `dist/main/**/*` → **会进入安装包文件树** |
| barrel / index export？ | **未发现** |
| 绕过真实 Runtime？ | **是** — 完整 fake |

**判定：B（必须迁移）**

```text
fixture 位于生产源码并可能被打包或误调用
→ 必须在 Batch 1 修复中迁出 main/src（或加入 exclude 且从 dist 剔除）
→ 阻塞 Batch 2
```

建议目标路径：`main/src/**/__tests__/` 或 `tests/fixtures/`（并确保不进 `tsconfig.main`）。

---

## 6. Fixture vs Runtime

详见 [`fixture_vs_runtime_contract_matrix.json`](./_audit_scratch/lattice_v1_batch1_generalization/fixture_vs_runtime_contract_matrix.json)。

关键项：`overall contract` = **CONFLICT**（绕过 checksum/SQLite/`ORDER BY prior`/LIMIT 交互）。  
多项 `NOT REPRESENTED`：>8 同音、`supportsToneFirstRecall=false`、malformed tone。

---

## 7. Length-1 Branch Generality

伪代码（与实现一致，对任意单字成立）：

```text
if length∉[1,5] or topK<=0 → empty
if length==1:
  effectiveTopK = min(topK,1)
  if toneKey && supportsToneFirstRecall:
    raw = lookupBaseByTone(..., LIMIT 8)
  else:
    raw = lookupBasePlain(..., LIMIT 8)
  eligible = filter(enabled, word.len==1, !isAlias, prior>0)
  chosen = unique(eligible) OR uniqueSurfaceExact(eligible, windowText) OR null
  force domains=[]; repairTarget=false
  return 0|1 hit
else:
  existing 2–5 flow
```

无 `if test` / fixture / `JEST_WORKER_ID` / 具体汉字。  
**A/B：通过（规则通用）。**

---

## 8. Ambiguity / SQL Limit

详见 [`length1_ambiguity_limit_risk.json`](./_audit_scratch/lattice_v1_batch1_generalization/length1_ambiguity_limit_risk.json)。

| 问题 | 答案 |
|------|------|
| >8 同音？ | 只见 top-8 by prior；可能假唯一 |
| 满 LIMIT 是否视为“可能还有更多”？ | **否** — 当前不探测 |
| surface 在第 9？ | **永远无法消歧** |
| SQLite 排序？ | `ORDER BY prior_score DESC`；prior 并列不稳定 |

推荐（仅审计）：`LIMIT 2` 非唯一探测 + **独立 surface exact 查询**，或安全全量上限。

**阻塞 Batch 2：是（P0）。**

---

## 9. Candidate Cap Ordering

代码顺序证据：`collectBaseOnlySingleCharCandidate` 先 lookup(8) → filter → `resolveLength1BaseCandidate` → 再返回 ≤1；`effectiveTopK=min(topK,1)` 不用于截断 SQL。

**不是**「TopK=1 → 宣称唯一」。  
**Cap 顺序：PASS。**

---

## 10. Tone Generalization

| 场景 | 行为 | 判定 |
|------|------|------|
| tone pattern + supportsTone | tone 路径；无 plain fallback | OK |
| 无 pattern | plain_only | OK |
| `supportsToneFirstRecall()==false` 但有 pattern | **回落 plain** | **P1 偏差** — 可能把带调输入当 plain 唯一 |
| 轻声 tone=5 | `buildTonePinyinKey` 允许 1–5 | 代码支持；fixture 仅 ma5，未系统测 |
| 同音同调多字 | 需 surface；否则空 | 规则 OK；LIMIT 风险叠加 |

测试过度依赖 `wo3`/`shi4`。

---

## 11. Base / Domain Isolation

| 层 | 证据 |
|----|------|
| V2 length=1 | **不调用** `lookupDomain*` / idiom / fuzzy builder |
| Call-site | `domainIds=[]`（防 cache 串味）；非唯一保证 |
| 空数组语义 | length=1 **根本不进** domain API → 空数组「全域」风险不适用 |
| mapping | `scoreLength1BaseHit` **强制** `domains=[]`、`repairTarget=false` |

**Base-only：代码不可达保证 — PASS。**

---

## 12. Alias / Variant Isolation

| 项 | 证据 |
|----|------|
| `is_alias` 真实列 | `lexicon-runtime-v2.ts` SELECT + `isAlias: row.is_alias === 1` |
| `isAlias === true` 过滤 | `undefined` 当作非 alias — 与真实 mapping 一致 |
| alias **展开** | length=1 不走 alias expansion — OK |
| homophone_variant | 无专用展开；未在真实 row 上验证 variant source 字段 |

**对真实 is_alias 列：PASS；variant 覆盖：PARTIAL（P2）。**

---

## 13. Hard-block Generalization

详见 [`hard_block_generalization_matrix.json`](./_audit_scratch/lattice_v1_batch1_generalization/hard_block_generalization_matrix.json)。

- 邻接删除：**通用**（非「吗」特判）。
- 窗内 `，。！？；：、` 与 ASCII `.!?;:`：**代码覆盖**。
- **`…` / `……`：不在正则 — 可能放行（P1）。**
- 测试矩阵偏薄（多数字符未测）。

---

## 14. Diagnostics Integrity

Phase1 从 `windows` / `recallableWindows` / `byWindow` / `edges` 计数；Phase2 从 `lexicalEdges` / retained `paths.edgeRefs` / fallback edges 计数。  
**非**测试手工累加。

| 字段 | 定义要点 |
|------|----------|
| WindowCount | 含 blocked |
| RecallCount | 仅 recallable（未 block） |
| CapHitCount | len=1 且最终 candidates===1（成功 cap 命中，非「曾截断 >1」） |
| UsedCount | retained path 上 span=1 lexical 去重 |

Fixture Path 测试对 UsedCount 的 `≥1` 来自 **手工 edges**，不能证明 harness diagnostics 在真实 recall 链上的 >0。

---

## 15. Test Assertion Quality

详见 [`batch1_test_assertion_quality_inventory.json`](./_audit_scratch/lattice_v1_batch1_generalization/batch1_test_assertion_quality_inventory.json)。

- STRONG：多数 Recall/HB/call-site/edge  
- SELF-FULFILLING：**Path**、**Vote**（手工候选/边）  
- 无 `.only` / `.skip`

SELF-FULFILLING **单独**不阻塞，但与「无真实 SQLite」叠加 → CONDITIONAL。

---

## 16. Mock / Spy Audit

| 类型 | 现状 |
|------|------|
| Unit mapping（fixture runtime） | 主路径 |
| Spy `recallSpanTopKV3` | call-site 参数 — 有效 |
| Runtime contract / 临时 SQLite | **缺失** |

规格：完全只有 in-memory fake → **必须 CONDITIONAL**，补真实临时 SQLite 集成后方可 Batch 2。

---

## 17. 2–5 Behavioral Regression

详见 [`before_after_length2_5_behavior_matrix.json`](./_audit_scratch/lattice_v1_batch1_generalization/before_after_length2_5_behavior_matrix.json)。

- 结构上 length=1 early-return **隔离** 2–5 流程  
- 343 suite PASS = **未坏测试**  
- **无** before/after 内容字节 golden → PARTIAL

---

## 18. Production Reachability

| 层 | 状态 |
|----|------|
| Recall API length=1 | **已具备能力** |
| Production LTR Window | `windowMinSyllables: 2` — **不会生成 length=1** |
| Lattice Production cutover | **未做** |

Batch 1 ≠「生产已改善单字连通」。开发报告若暗示生产效果，属表述过冲；能力建设表述可保留。

---

## 19. Production Bundle Pollution

```text
tsconfig.main include main/src/**/*
  + exclude only *.test.ts
  + electron-builder files: dist/main/**/*
  = connectivity-batch1-fixture.js 将进入产物
```

**P0 阻塞。**

---

## 20. Hidden Failure Audit

| 项 | 结论 |
|----|------|
| skip/only/todo（新测） | 无 |
| 吞 SQL 当空候选 | length=1 无 catch-swallow |
| intent smoke FAIL | `ECONNREFUSED :5018` — 外部 LLM；非 Recall 参数路径 |
| 删旧测 / 放宽断言 | 无证据 |

---

## 21. Required Batch 1 Fixes（本轮不开发）

### P0 — 阻塞 Batch 2

1. **迁出 fixture**  
   - 文件：`connectivity-batch1-fixture.ts`  
   - 问题：main/src + 打包  
   - 最小改：移至 test/fixtures 或 exclude + 禁止进 dist；更新测试 import  
   - Contract：否  

2. **真实临时 SQLite + LexiconRuntimeV2 集成测**  
   - 至少 1 条：写最小 `base_lexicon` bundle → load → length=1 Recall → Candidate  
   - 覆盖 is_alias / tone composite / LIMIT 边界之一  

3. **歧义 LIMIT 假唯一**  
   - 文件：`recall-span-topk-v2.ts` `collectBaseOnlySingleCharCandidate`  
   - 问题：LIMIT=8 后 `length===1` 当唯一  
   - 最小改：截断感知（满 LIMIT → 非唯一除非 surface exact **独立查询**命中）或 LIMIT 2 探测 + surface SQL  
   - 新增测：9 同音 / surface 第 9 / 满 LIMIT  
   - Contract：建议 CR 补一句「歧义判定不得依赖截断后的假唯一」（可选 1.0.3）

### P1 — Batch 2 前建议

4. `supportsToneFirstRecall===false` 时：有 tone pattern 应 **空或显式 plain_only 策略**，禁止静默当 tone-exact。  
5. Hard-block：评估 `…`；补标点矩阵测试。  
6. Path/Vote：改为从 Recall 产物驱动，或标注为 enumerator-only。  
7. 变形测：见 [`batch1_deformation_test_design.json`](./_audit_scratch/lattice_v1_batch1_generalization/batch1_deformation_test_design.json)（他/她/它、拿/哪/那…）。

### P2 — 可后补

8. CapHit 语义文档化（成功 cap vs 曾截断）。  
9. 2–5 内容 golden 快照。  
10. variant source 字段专项。

---

## 22. Batch 1 Final Gate

```text
CONDITIONAL — 不满足 PASS 的 5/6/11 等条：
  ❌ fixture 可能进 production bundle
  ❌ 无真实 SQLite / LexiconRuntimeV2 集成证据
  ❌ 歧义判定受 SQL LIMIT 错误影响风险
  ✅ 生产无 fixture 字面量硬编码
  ✅ length=1 不依赖测试环境
  ✅ cap 在歧义后
  ✅ domain lookup 代码不可达
  ✅ diagnostics 来自真实 harness 事件
  ⚠️ Hard-block / 断言 / 2–5 内容锁 部分达标
```

---

## 23. Batch 2 Status

```text
BLOCKED

原因：
1. Fixture 生产包污染未修复
2. 缺少真实 LexiconRuntimeV2+SQLite 证明
3. LENGTH=8 假唯一语义缺陷未修复
```

以下 §24–§29 **不展开正式开发设计**（门禁要求）。仅保留占位与证据文件中的 `BLOCKED` 清单，供修复后复用。

---

## 24–29. Batch 2（Blocked Placeholders）

- Patch / Full Build / Governance / Tests / Order：见  
  `batch2_*_inventory.json` / `batch2_test_plan.json` — **status: BLOCKED**  
- 原则提醒（非授权开发）：`addBaseTerm` 应为 **base_lexicon 操作**（不限单字）；禁 `domain_tags`；与 Full Build `singleCharApproved` 统一准入；Batch 2 验收前仍禁正式词表导入。

---

## 30. Excluded Modules

本轮未改；Batch 2 仍不得改 Recall/HB/Edge/Path/Vote/KenLM/LTR/cutover（除非先单独修 Batch1 P0）。

---

## 31. Risks

| 风险 | 等级 |
|------|------|
| 假唯一错误连通字 | P0 |
| fixture 进安装包 / 误调用 | P0 |
| 报告被读成「生产已单字连通」 | P1 |
| 省略号窗放行 | P1 |

---

## 32. KEEP

通用 length=1 分支结构 · base-only 不可达 · cap 顺序 · 邻接 HB 删除思路 · singleChar diagnostics 事件源 · 2–5 隔离 early-return

---

## 33. MODIFY（仅建议，下轮开发）

LIMIT 歧义安全 · tone unsupported 策略 · HB 省略号（若产品需要）

---

## 34. DELETE / 迁出

`main/src/.../connectivity-batch1-fixture.ts` 从生产编译集迁出

---

## 35. NEW（下轮）

临时 SQLite 集成测 · LIMIT/变形测 ·（通过后再）Batch 2 ops

---

## 36. Target List

```text
[x] fixture 字面量搜索 — 生产无硬编码
[x] fixture 打包风险 — 确认会进 dist/main
[x] fixture vs runtime — CONFLICT
[x] 真实 SQLite 证据 — 缺失
[x] length=1 无测试环境依赖
[x] SQL LIMIT=8 风险 — 确认
[x] cap 在歧义后 — 确认
[x] domain 不可达 — 确认
[x] alias 真实 is_alias — 确认
[x] HB 矩阵 — PARTIAL + 省略号 gap
[x] diagnostics 事件源 — 确认
[x] 26 测断言 — 含 2 SELF-FULFILLING
[x] mock vs runtime — 仅 fake
[x] 2–5 — suite PASS only
[x] 无 skip 隐藏
[x] Batch1 Verdict = CONDITIONAL
[x] Batch2 = BLOCKED（不继续正式设计）
```

---

## 37. Check List

```text
[x] 本轮未改代码/测试/fixture/词库/SQLite/Contract
[x] 未因 26 PASS 假设生产正确
[x] 未忽略 main/src fixture
[x] 未把 mock 当 SQLite 证明
[x] 未忽略 LIMIT=8
[x] 未用 PASS 掩盖 Production 无 length=1 Window
[x] Batch1 未通过时未授权 Batch2 开发
[x] 未建议正式词表导入 / cutover
```

---

## 38. Final Recommendation

1. **先开「Batch 1 补测 / 去污染 / LIMIT 安全」小修复轮**（仅 P0，禁止混入 Patch V4）。  
2. 复跑本审计；仅当 **Generalization = PASS** 再启动 Batch 2。  
3. Batch 2 验收前：**仍禁止**正式 50–100 单字导入 operational SQLite。

---

## 四十问简答

1. 生产硬编码？**否**（fixture 文件落点有问题）  
2. fixture 进 bundle？**会（若 build）**  
3. 与真实 runtime 关键等价？**否（CONFLICT）**  
4. 真实 SQLite 集成？**无**  
5. LIMIT=8 假唯一？**可能**  
6. cap 在歧义后？**是**  
7. domain 不可达？**是**  
8. alias 对真实 row？**是（is_alias）**  
9. HB 完整矩阵？**部分；省略号缺口**  
10. diagnostics 真实事件？**是（harness）**  
11. self-fulfilling？**有 2 个**  
12. 2–5 内容级？**仅 suite**  
13. Verdict？**CONDITIONAL**  
14. 阻塞 Batch 2？**是**  
15–19. Batch 2 文件/拆分？**BLOCKED — 不设计**  
20. Batch 2 后仍禁导入直至验收？**是；且当前 Batch 2 未开始**
