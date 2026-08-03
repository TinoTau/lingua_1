<!-- Documentation Hierarchy Metadata
Status: **SUPERSEDED**
Superseded By: CURRENT Sole Authorities + FW_V4_FREEZE_2026_08_03
Archive Path: docs/archive/SUPERSEDED/FW_Repair_V4_Lexical_Connectivity_Repair_V1_Batch1_1C_Mandatory_Tone_Recall_PreDevelopment_Audit_And_Repair_Design_2026_07_28.md
-->

> **SUPERSEDED** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: CURRENT Sole Authorities + FW_V4_FREEZE_2026_08_03

# FW Repair V4 — Lexical Connectivity Repair V1 · Batch 1.1C Mandatory Tone Recall Pre-Development Audit And Repair Design

| Field | Value |
|-------|-------|
| Date | 2026-07-28 |
| Stage | Pre-Development Audit + Repair Design — **IMPLEMENTED (CR 1.0.8)** |
| Implementation | [`FW_Repair_V4_Lexical_Connectivity_Repair_V1_Batch1_1C_Mandatory_Tone_Recall_Development_Report_2026_07_28.md`](./FW_Repair_V4_Lexical_Connectivity_Repair_V1_Batch1_1C_Mandatory_Tone_Recall_Development_Report_2026_07_28.md) |
| Code / test / Contract / SQLite changes | See Development Report (this file remains the **behavioral SSOT**) |
| Dependency | Batch 1.1A CLOSED · Batch 1.1B CLOSED |
| Architecture decision | **Fail Closed on Tone** — No Tone → No Candidate |

---

## 1. Executive Summary

当前 Lattice Tone Recall 在 `toneActive === false` 时会 **静默改走 Plain**（length1 + length2–5），并在 length2–5 另有 **Tone underfill → Plain 补齐**。两者都会引入 **无 Tone 约束的同音候选**，污染 Edge / Path。

冻结决策：**Tone 是进入本链路的必要条件**。本轮设计删除所有 Tone→Plain 兼容路径（含 underfill 补数），不保留 fallback / shadow / 开关兜底。

证据均来自当前生产代码（未改代码）。

---

## 2. Final Verdict

```text
BATCH 1.1C MANDATORY TONE RECALL

CURRENT IMPLEMENTATION:
FAIL

PLAIN FALLBACK ENTRY POINTS:
CONFIRMED

FAIL-CLOSED DESIGN:
READY

SCOPE:
CONTAINED

READY FOR DEVELOPMENT:
YES
```

说明：

- **CURRENT IMPLEMENTATION: FAIL** — 相对本轮冻结架构（禁止 Plain），非相对 1.1A/1.1B。  
- **SCOPE: CONTAINED** — 修改面集中在 Recall（`collectBaseOnlySingleCharCandidate` + `collectTierCandidatesToneFirst`）及诊断/测试；不改 Edge/Path/Vote/Assembly/KenLM/SQLite/LIMIT 数值/1.1A/1.1B 语义（LIMIT 仅用于 Tone 查询）。  
- **READY FOR DEVELOPMENT: YES** — 调用点、删除清单、状态设计、测试矩阵已闭合。

---

## 3. Frozen Architecture Decision

```text
该 Recall 链路必须使用有效 Acoustic Tone。

Tone 不可用 / 未启用 / Runtime 不支持 /
Pattern 缺失或非法：

→ 不得自动 Plain Recall
→ 本窗口不生成 Tone Recall Candidate
→ Fail Closed
```

原因：Plain 仅拼音约束 → 同音集扩大 → 污染 LexicalEdge / SegmentationPath / 组句。

不保留：兼容 fallback、安全 fallback、legacy、shadow、双链路、配置兜底。

---

## 4. Current Tone Data Flow

Tone **不是**从 ASR 文本推断声调；pattern 来自 **声学时间片 × 词时间对齐**。

```text
ASR segments.words[].start/end  (+ batch time offsets)
  → buildWordTimeSpans(rawText, asrSegments, …)     [tone-time-align.ts]
       WordTimeSpan { rawStart/rawEnd, start/end sec }

FW / pipeline AcousticToneSlice[]
  (start/end sec + tonePosterior)                   [task-router types → fw-detector]

span-assembly-v4-orchestrator
  → buildWordTimeSpans(...)
  → recallTopKForWindows({ acousticSlices, wordTimeSpans, toneTimestampOnlyEnabled })

resolveTimestampToneState(slices, toneTimestampOnlyEnabled)  [tone-recall.ts]
  toneTimestampOnlyEnabled=false → toneEnabled=false (caller_disabled)
  no slices → toneEnabled=false
  else → toneEnabled=true

per window (if toneEnabled && slices && wordTimeSpans):
  extractAcousticTonePatternForRecall
    = extractAcousticTonePatternByTime
         charRangeToWindowTime(rawStart, rawEnd, …) → WindowTimeRange | null
         selectSlicesByTimeOverlap(slices, range)
         IF overlapSlices.length !== syllableCount(=rawEnd-rawStart):
           pattern = null   // 部分覆盖 / 长度不一致 → 无完整 pattern
         ELSE:
           pattern = argmaxToneFromPosterior(each slice)

acousticTonePattern?: number[]
  → recallSpanTopKV2/V3
       buildTonePinyinKeyFromSyllablesAndPattern(syllables, pattern)
         null if: no pattern, length mismatch, tone∉[1..5]
       toneActive = tonePinyinKey!=null && supportsToneFirstRecall()
```

| Step | File | Function | Fail → |
|------|------|----------|--------|
| Word time | `tone-time-align.ts` | `buildWordTimeSpans` | 缺 word 时间 / 文本对齐失败 → 无 span |
| Caller gate | `tone-recall.ts` | `resolveTimestampToneState` | disabled / no slices |
| Window extract | `tone-time-align.ts` | `extractAcousticTonePatternByTime` | 无 time range；slice 数 ≠ 字符跨度 |
| Key build | `tone-pinyin.ts` | `buildTonePinyinKeyFromSyllablesAndPattern` | null |
| Runtime support | `lexicon-runtime-v2.ts` | `supportsToneFirstRecall` | false（无 tone stmt） |

### 覆盖机制要点（真实代码）

- **完整覆盖：** overlap slice 数 == `rawEnd - rawStart`（按 **字符跨度**，非 `syllableEnd-syllableStart`）。  
- **部分覆盖 / 数量不一致：** `pattern=null`，但可能仍有 `windowTimeRange`（diagnostics 记 miss）。  
- **无覆盖：** 无 wordTime 交集 → `windowTimeRange=null`，`pattern=null`。  
- **非法 Tone 值：** key builder 要求整数 1–5；argmax 结果若异常会令 key null。  
- **length1–5：** 同一提取函数；length1 时 `syllableCount` 通常为 1。  
- **跨粗边界 / fallback 窗：** 只要有 `rawStart/rawEnd` + spans/slices，同样走提取；失败则无 pattern。  
- **风险备注（开发时勿“用 Plain 修”）：** `syllableCount = rawEnd - rawStart` 假设字符≈音节；多音字/非 1:1 时可能系统性 `pattern=null` → Fail Closed 后 Candidate 减少，应修对齐/覆盖，不恢复 Plain。

---

## 5. Current Recall Call Graph

```text
orchestrator.recallForWindows
  → recallTopKForWindows
       → (optional) extract pattern
       → recallSpanTopKV3 → recallSpanTopKV2

length===1:
  collectBaseOnlySingleCharCandidate
    toneActive?
      Y: tone ambiguity LIMIT=8 → resolve(+1.1A) → tone exact LIMIT=2 (1.1B)
      N: plain ambiguity LIMIT=8 → resolve → plain exact LIMIT=2   ← DELETE

length∈[2,5]:
  collectTierCandidatesToneFirst
    !toneActive → lookupPlainTiers → plain_only_no_pattern   ← DELETE
    toneActive → lookupToneTiers
      if underfill → lookupPlainTiers + dedupe plain_fallback   ← DELETE
      else tone_exact only
```

---

## 6. Tone Coverage Audit

| 场景 | 当前能否得到 pattern | Fail Closed 后 |
|------|----------------------|----------------|
| length1 完整 1 slice | 可以 | Tone Recall |
| length2–5 完整 N slices | 可以 | Tone Recall |
| timestamp 缺失 | pattern null | Empty |
| 部分覆盖（slice 数 ≠ 字符跨度） | pattern null | Empty |
| `toneTimestampOnlyEnabled=false` | 不提取 | Empty（caller_disabled） |
| Runtime 无 tone stmt | toneActive false（即使有 pattern） | Empty（今日会 Plain → **违规**） |
| 跨边界窗 / fallback 单字窗 | 同提取逻辑 | 有完整 Tone 才 Recall |

**结论：** 不是每个窗口都能取得 Tone；失败路径今日多数落入 Plain。目标：失败 → **Empty**。

---

## 7. Length1 Current Behavior

文件：`recall-span-topk-v2.ts` · `collectBaseOnlySingleCharCandidate`

| 条件 | 当前 | 目标 |
|------|------|------|
| toneActive | tone amb8 + tone exact2；stage `tone_exact` | **KEEP**（1.1A/1.1B 语义保留在 Tone 域） |
| !toneActive | plain amb8 + plain exact2；stage `plain_only_no_pattern` | **Empty + 诊断**；**禁止** plain API |
| Tone SQL empty | empty（可 tone exact） | **KEEP**（不改走 Plain） |
| Tone underfill | **不存在** length1 underfill plain | n/a |

目标分支：

```text
ready → tone ambiguity → resolve(+truncation) → tone exact if needed
!ready → hits=[]；不调用 lookupBaseByPinyinKey / lookupBaseByExactSurfaceAndPinyin
```

---

## 8. Length2–5 Current Behavior

文件：`tone-first-tier-collector.ts` · `collectTierCandidatesToneFirst`

| 分支 | 当前 | 目标 |
|------|------|------|
| A `!toneActive` → `lookupPlainTiers` | Plain Candidate | **DELETE** → Empty |
| B `needPlainFallback` → plain fill + `dedupeByIdPreferToneExact` | `plain_fallback` 无独立 Tone 兼容校验 | **DELETE** → 仅返回已有 Tone Candidate |
| Tone SQL 满额 | `tone_exact` | **KEEP** |
| Tone SQL 空 | 今日仍可能 plain fill（若 underfill） | **Empty**（无 Plain） |

**B 审计结论：** Plain 补齐候选 **没有** 二次 Tone SQL / Tone 兼容门；仅 stage 标签。按冻结矩阵 **必须删除**。

---

## 9. All Plain Fallback Entry Points

| 文件 | 函数/位置 | 条件 | 长度 | 生成 Candidate? | 本轮删除范围 |
|------|-----------|------|------|-----------------|--------------|
| `recall-span-topk-v2.ts` | `collectBaseOnly…` else 支 | `!toneActive` | 1 | 是（plain amb） | **YES DELETE 调用** |
| `recall-span-topk-v2.ts` | `tryExactSurface…` with `toneActive:false` | 承接上支 | 1 | 可能 | **YES（该路径）** |
| `tone-first-tier-collector.ts` | `lookupPlainTiers` via `!toneActive` | `!toneActive` | 2–5 | 是 | **YES DELETE 调用** |
| `tone-first-tier-collector.ts` | `needPlainFallback` + `lookupPlainTiers` | underfill | 2–5 | 是 | **YES DELETE** |
| `tone-first-tier-collector.ts` | `dedupeByIdPreferToneExact` plain 臂 | 服务 B | 2–5 | 是 | **YES 随 B 删/简化** |
| stages `plain_only_no_pattern` / `plain_fallback` | 产出标签 | 上述路径 | * | 元数据 | **停用/替换诊断**（见 §15） |

**非本轮删除（保留 Runtime 能力 / 其他用途）：**

| API | 生产 Tone Recall 外用途 | 分类 |
|-----|-------------------------|------|
| `LexiconRuntimeV2.lookupBaseByPinyinKey` | 测试、patch smoke、Runtime 合同；**亦可被其他非 Tone-Recall 工具调用** | **KEEP API** · **RESTRICT** 禁止自 Tone Recall `!ready`/`underfill` 调用 |
| `lookupBaseByExactSurfaceAndPinyin` | 1.1B 机械 API；测试 | **KEEP API** · Tone Recall 仅允许在 **非本链路** 或未来明确非 Tone 产品中使用；**本链路 !ready 禁止**；ready 时用 **Tone exact** |
| `lookupPlainTiers` | **仅** `tone-first-tier-collector` 内部 | Fail Closed 后若无引用 → **DELETE 函数** |
| `lookupDomainsByPinyinKeyMulti` / idiom plain | 仅 `lookupPlainTiers` | 随 Plain tiers 删除调用；Tone 侧继续用 `*AndToneKey*` |

---

## 10. Runtime Ownership

```text
KEEP:
  supportsToneFirstRecall() → boolean
  lookupBaseByPinyinAndToneKey / ExactSurfacePinyinAndTone → rows | []
  lookupBaseByPinyinKey / ExactSurfaceAndPinyin → 保留机械能力（RESTRICT 调用方）

禁止下沉到 Runtime:
  Fail Closed 政策
  Candidate / eligibility
  自动 Plain fallback
```

---

## 11. Recall Ownership

**唯一策略 Owner：Recall。**

建议引入内部 readiness（不新增 Candidate Kind）：

```ts
type ToneRecallReadiness =
  | { state: 'ready'; tonePinyinKey: string }
  | { state: 'no_pattern' }
  | { state: 'invalid_pattern' }
  | { state: 'caller_disabled' }
  | { state: 'runtime_unsupported' };
```

解析顺序（设计）：

1. Caller 未启用 / 未传入有效 tone 通道 → `caller_disabled`（若可从 input 区分；否则与 no_pattern 合并需在开发时二选一并写进 CR）  
2. `!supportsToneFirstRecall()` → `runtime_unsupported`  
3. pattern 缺失 → `no_pattern`  
4. key build 失败（长度/非法值）→ `invalid_pattern`  
5. 否则 → `ready`

**仅 `ready` 执行 Tone SQL（amb + exact）。**

诊断：写入 Recall diagnostics / Trace（`tone_recall_readiness` / skip reason）；**不**改变业务逻辑。

---

## 12. Target Behavior Matrix

| 状态 | 目标行为 |
|------|----------|
| Tone Pattern 完整合法 + Runtime 支持 | Tone Recall（LIMIT=8 amb + LIMIT=2 exact 仅 Tone） |
| Pattern 缺失 | Empty + `tone_no_pattern` |
| Pattern 长度不匹配 | Empty + `tone_invalid_pattern` |
| Tone 值非法 | Empty + `tone_invalid_pattern` |
| Caller 关闭 Tone | Empty + `tone_caller_disabled` |
| Runtime 不支持 | Empty + `tone_runtime_unsupported`（Fail Closed，禁 Plain） |
| Tone SQL 空 | Empty + `tone_lookup_empty`（禁 Plain） |
| Tone SQL 候选不足 | **仅返回已有 Tone Candidate**（禁 Plain 补齐） |
| Tone exact 未命中 | Empty（禁 Plain exact） |

```text
Fail Closed on Tone.
No Tone → No Candidate.
```

---

## 13. Proposed Code Changes（设计，未实施）

### 13.1 `collectBaseOnlySingleCharCandidate`

- 计算 `ToneRecallReadiness`。  
- `ready`：保持现有 tone amb + 1.1A resolve + 1.1B tone exact。  
- 非 `ready`：`hit=null`；**零** plain SQL；记录 readiness。

### 13.2 `collectTierCandidatesToneFirst`

- 删除 `if (!toneActive) { lookupPlainTiers… }`。  
- 删除 `needPlainFallback` 整段 plain fill。  
- `ready`：仅 `lookupToneTiers` + merge；返回已有行（可少于 limit）。  
- 非 `ready`：空 entries + readiness。  
- `lookupPlainTiers` / `dedupeByIdPreferToneExact`：无引用则删除。

### 13.3 不改

- 1.1A truncation 公式、1.1B exact 身份规则（在 **Tone** 路径内）。  
- LIMIT 常量数值 8 / 2。  
- Edge / Path / Vote / Assembly / KenLM / schema / indexes / Candidate Kind。

### 13.4 Orchestrator

- **默认不改** `toneTimestampOnlyEnabled` 机制；关闭时 → readiness `caller_disabled` → Empty。  
- 不新增 shadow Plain 链。

---

## 14. Proposed Interface Changes

| 项 | 建议 |
|----|------|
| `ToneLookupStage` | 停用业务路径上的 `plain_fallback` / `plain_only_no_pattern`；保留 `tone_exact`；或仅 diagnostics 枚举 readiness |
| Candidate Kind | **不新增** |
| Runtime 新 API | **不需要** |
| Trace | 增加 readiness / skip reason（可选字段） |
| `build-lexical-edges` `hasToneRelaxed` | Plain 消失后该证据位将不再由 Recall 置位（**不改 Edge 合同结构**；仅输入变少） |

---

## 15. Proposed Diagnostic Changes

建议原因码（观测 only）：

```text
tone_ready
tone_no_pattern
tone_invalid_pattern
tone_caller_disabled
tone_runtime_unsupported
tone_lookup_empty
tone_lookup_underfill   // 有 Tone 行但 < limit；非错误，勿 Plain
```

停用描述已删除行为的标签作为 **成功路径语义**：

```text
plain_only_no_pattern
plain_fallback
```

（测试/排序表 `tone-recall-sort.ts` 中的旧 stage 权重：开发阶段改为仅 `tone_exact` 或删除 plain 档。）

---

## 16. Plain API Retention Analysis

| API | KEEP / DELETE / RESTRICT |
|-----|--------------------------|
| `lookupBaseByPinyinKey` | **KEEP** Runtime；**RESTRICT** 禁止 Tone Recall fail/underfill 调用 |
| `lookupBaseByExactSurfaceAndPinyin` | **KEEP** Runtime；本链路仅 Tone exact |
| `lookupPlainTiers` | Tone Recall 去引用后 **DELETE**（若无其他调用方） |
| `needPlainFallback` | **DELETE** |
| `dedupeByIdPreferToneExact` | **DELETE** 或缩为 no-op identity（无 plain 输入） |
| patch-recall-smoke / 合同测试直接调 plain | **KEEP**（非 Tone Recall 链路） |

---

## 17. Lattice Impact

Fail Closed 后预期：

| 指标 | 方向 | 判定 |
|------|------|------|
| WindowCandidate | ↓ | **预期**（去掉非法 Plain） |
| LexicalEdge | ↓ | **预期** |
| 完整 Path | 可能 ↓ | **预期**；不断用 Plain 强行连通 |
| fallback Edge / gap | 可能 ↑ | 由 fallback Edge 政策 / Tone 覆盖 / 词库 tone 数据解决 |

```text
连通性不能以引入无 Tone 约束候选为代价。
```

跨 Batch：若 timestamp 对齐系统性失败导致大面积 Empty，属 **覆盖修复**（数据/对齐），**不是**恢复 Plain Recall。

---

## 18. Regression Risk

| 风险 | 缓解 |
|------|------|
| 大量现有测试依赖无 pattern → plain 命中 | 按 §19 改写期望为 Empty；补充 tone-ready 夹具 |
| length2–5 TopK/limit 行为变化（不再补满） | 断言“仅 Tone 行”；禁止假设填满 |
| dialog_200 Candidate/Path 下降 | 基线对比；分析 Tone 覆盖率，不回滚 Plain |
| `hasToneRelaxed` 证据减少 | 文档化 |
| 1.1A/1.1B 回归 | Tone 路径内全绿；Plain 路径用例改为 readiness Empty |

---

## 19. Test Plan

### 19.1 Length1

| Case | Expect |
|------|--------|
| 合法 Tone + Runtime 支持 | Tone Candidate |
| 无 Pattern | Empty；plain SQL = 0 |
| 非法 Pattern | Empty；plain SQL = 0 |
| Runtime unsupported | Empty；plain SQL = 0 |
| Tone SQL empty | Empty；plain SQL = 0 |
| amb 未命中 + tone exact 命中 | Tone Candidate |
| amb+exact 皆未命中 | Empty |
| Caller disabled | Empty |

### 19.2 Length2–5

| Case | Expect |
|------|--------|
| 有 Tone Candidate | 仅 Tone |
| Tone underfill | 不 Plain 补齐；返回已有 Tone 行 |
| Tone empty / unsupported / no pattern | Empty；plain SQL = 0 |

### 19.3 Regression

```text
1.1A truncation · 1.1B surface exact（Tone 路径）
Length1/2–5 · LexicalEdge · Path · HB · Vote · TopKV3 · Freeze
dialog_200（覆盖率 + Candidate 质量，非强制 Plain 召回率）
```

断言手段：spy `lookupBaseByPinyinKey` / `lookupBaseByExactSurfaceAndPinyin` / `lookupPlainTiers` 在 fail-closed 路径 **调用次数 = 0**。

---

## 20–22. KEEP / MODIFY / DELETE

### KEEP

- 1.1A truncation-aware uniqueness（Tone fetch 上）  
- 1.1B exact surface identity（**Tone exact API**）  
- LIMIT=8 / LIMIT=2 **数值**（仅 Tone 查询）  
- Runtime rows-only；Recall Candidate owner  
- Candidate Kind；schema；indexes  
- Edge / Path / Vote / Assembly / KenLM **实现**  
- Runtime plain lookup **机械 API 存在性**

### MODIFY（开发阶段）

- `collectBaseOnlySingleCharCandidate`  
- `collectTierCandidatesToneFirst`  
- Diagnostics / Trace readiness  
- 依赖 Plain 行为的测试与旧 stage 排序  

### DELETE（开发阶段，附引用）

| 项 | 真实引用 |
|----|----------|
| `!toneActive → lookupBaseByPinyinKey`（length1） | `recall-span-topk-v2.ts` ~462 |
| `!toneActive → plain exact` | `tryExactSurface… toneActive:false` ~471–476 |
| `!toneActive → lookupPlainTiers` | `tone-first-tier-collector.ts` ~204–225 |
| `needPlainFallback` + plain fill | ~239–305 |
| `dedupeByIdPreferToneExact` plain 臂 | ~154–169, ~273 |
| 业务路径 `plain_fallback` / `plain_only_no_pattern` 作为成功语义 | stage 赋值处；`build-lexical-edges` 仅消费 |

---

## 23. Target List

```text
[x] 确认 Tone 完整数据流
[x] 确认每个窗口的 Tone 覆盖机制
[x] 找出所有 !toneActive → Plain 分支
[x] 找出所有 Tone underfill → Plain 分支
[x] 审计 Length1
[x] 审计 Length2–5
[x] 审计 Plain exact fallback
[x] 审计 Plain API 其他合法调用方
[x] 设计 Fail Closed 状态
[x] 设计最小代码修改
[x] 设计删除列表
[x] 设计测试
[x] 分析 Lattice 连通性影响
[x] 输出完整报告
```

---

## 24. Check List

```text
[x] 本轮未修改代码
[x] 本轮未修改测试
[x] 本轮未修改 Contract
[x] 不保留 Tone → Plain 兼容路径（设计层）
[x] 不新增 Shadow Path
[x] 不扩大 LIMIT
[x] 不修改 SQLite
[x] 不修改 Candidate Kind
[x] 不修改 Edge / Path / Vote / Assembly / KenLM
[x] 所有结论来自真实代码
[x] 所有删除项附真实调用引用
[x] 明确下一步可进入开发：YES
```

---

## 25. Development Readiness

```text
READY FOR DEVELOPMENT: YES

建议开发顺序：
1) 引入 ToneRecallReadiness（Recall 内部）
2) Length1 Fail Closed + 测试（plain SQL=0）
3) Length2–5 删除 A/B Plain + 测试
4) 诊断标签迁移
5) 1.1A/1.1B/Edge/Path/dialog_200 回归
6) 再写 CR（开发冻结时，非本轮）
```

**不在本轮：** 修改生产代码、测试、Contract、SQLite；进入 Batch 1.1D / Batch 2。
