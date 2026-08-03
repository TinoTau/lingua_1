<!-- Documentation Hierarchy Metadata
Status: **SUPERSEDED**
Superseded By: CURRENT Sole Authorities + FW_V4_FREEZE_2026_08_03
Archive Path: docs/archive/SUPERSEDED/FW_Repair_V4_Lexical_Connectivity_Repair_V1_Batch1_1C_Tone_Unsupported_Fallback_PreDevelopment_Audit_Report_2026_07_28.md
-->

> **SUPERSEDED** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: CURRENT Sole Authorities + FW_V4_FREEZE_2026_08_03

# FW Repair V4 — Lexical Connectivity Repair V1 · Batch 1.1C Tone Unsupported Fallback Pre-Development Audit

| Field | Value |
|-------|-------|
| Date | 2026-07-28 |
| Stage | **SUPERSEDED by Mandatory Tone Recall Development (CR 1.0.8)** |
| Status | **HISTORICAL AUDIT ONLY** — production Tone→Plain paths **deleted** in Batch 1.1C |
| Replacement SSOT | [`FW_Repair_V4_Lexical_Connectivity_Repair_V1_Batch1_1C_Mandatory_Tone_Recall_PreDevelopment_Audit_And_Repair_Design_2026_07_28.md`](./FW_Repair_V4_Lexical_Connectivity_Repair_V1_Batch1_1C_Mandatory_Tone_Recall_PreDevelopment_Audit_And_Repair_Design_2026_07_28.md) + Implementation Contract **CR 1.0.8** |
| Code / test / Contract changes | **None in this audit file** (implementation landed in Development Report 2026-07-28) |

---

## 1. Executive Summary

真实代码里，“Tone → Plain”不是单一机制，而是 **两类不同行为** 被文档笼统称为 fallback：

| 类型 | 代码位置 | Stage 标签 | 含义 |
|------|----------|------------|------|
| **A. Tone path inactive → Plain-only** | `collectBaseOnlySingleCharCandidate` / `collectTierCandidatesToneFirst` 入口 `if (!toneActive)` | 一律标 `plain_only_no_pattern` | 从未执行 tone SQL；直接 plain lookup |
| **B. Tone path active → Plain fill** | 仅 `collectTierCandidatesToneFirst`（length **2–5**） | `plain_fallback` | 先 tone SQL；候选不足时 **再** 调 plain 补齐 |

**Batch 1.1C 真正要对齐的“Tone Unsupported → Plain”问题**，落在类型 **A**：当调用方已有 acoustic tone pattern，但 `supportsToneFirstRecall()===false`（或等价地 `toneActive===false`）时，仍走 plain，且 stage **无法区分**「无 pattern」与「Runtime 不支持 tone」。

Length=1 **没有**类型 B（tone 空结果后补 plain）。Tone SQL 空/拒绝后保持 empty，再走 1.1B exact（仍在 tone 或 plain 各自路径内）。

**唯一 Decision Owner（是否进入 tone path）：Recall 层**（`toneActive = tonePinyinKey != null && runtime.supportsToneFirstRecall()`）。Runtime **不**自动 fallback；Orchestrator 只决定是否提供 pattern。

---

## 2. Final Verdict

```text
BATCH 1.1C PRE-DEVELOPMENT AUDIT:
PASS

TONE UNSUPPORTED FALLBACK
ROOT CAUSE AND OWNERSHIP CONFIRMED

LENGTH1: SILENT PLAIN-ONLY (MISLABELED plain_only_no_pattern)
LENGTH2-5: SEPARATE UNDERFILL plain_fallback (NOT THE SAME BUG)

READY FOR BATCH 1.1C DEVELOPMENT DESIGN
```

（本轮未开发；未改代码/测试/Contract。）

---

## 3. Audit Scope

| In | Out |
|----|-----|
| Tone unsupported / plain path 真实调用链 | 修改 LIMIT / Candidate / 1.1A / 1.1B |
| Runtime vs Recall ownership | Batch 1.1D HB / Batch 2 / Cutover |
| Length1 + Length2–5 差异 | 实现新政策 |

---

## 4. Frozen Contracts（本轮不得重开）

1.1A truncation · 1.1B exact surface · LIMIT=8/2 · Runtime rows-only · Recall Candidate owner · Edge/Path/Vote/Assembly/KenLM 未审计为修改对象。

CR **1.0.7** 明确：tone-unsupported fallback → **Batch 1.1C**（deferred）。

---

## 5. Current Call Graph

### 5.1 Lattice window → Recall（生产）

```text
span-assembly-v4-orchestrator
  → recallTopKForWindows
       resolveTimestampToneState(toneTimestampOnlyEnabled)
       if toneEnabled && slices && wordTimeSpans:
         extractAcousticTonePatternForRecall → acousticTonePattern?
       else:
         acousticTonePattern = undefined
       → recallSpanTopKV3 / recallSpanTopKV2
```

### 5.2 Length = 1（Connectivity 冻结路径）

```text
recallSpanTopKV2
  → collectBaseOnlySingleCharCandidate
       tonePinyinKey = buildTonePinyinKeyFromSyllablesAndPattern(syllables, patternSlice)
       toneActive = (tonePinyinKey != null) && runtime.supportsToneFirstRecall()

       if toneActive:
         lookupBaseByPinyinAndToneKey(..., LIMIT=8)
         resolveLength1BaseCandidate(+truncation)
         if !chosen: tryExactSurfaceBaseIdentity(toneActive=true)  // exact tone LIMIT=2
         scoreLength1BaseHit(..., stage='tone_exact')
         // NO plain underfill fallback

       else:   // ← Tone Unsupported OR no/malformed pattern 共用此分支
         lookupBaseByPinyinKey(..., LIMIT=8)
         resolveLength1BaseCandidate(+truncation)
         if !chosen: tryExactSurfaceBaseIdentity(toneActive=false)  // exact plain LIMIT=2
         scoreLength1BaseHit(..., stage='plain_only_no_pattern')  // ← 标签不区分原因
```

### 5.3 Length = 2–5（既有 Tone-first collector）

```text
recallSpanTopKV2 (non-length1)
  → collectTierCandidates
       → collectTierCandidatesToneFirst
            toneActive = same formula

            if !toneActive:
              lookupPlainTiers → stage plain_only_no_pattern
              return  // no tone SQL

            lookupToneTiers
            if toneMerged.length >= effectiveLimit:
              stage tone_exact; return

            // Type B — underfill plain fill（与 Unsupported 不同）
            lookupPlainTiers
            dedupeByIdPreferToneExact → tone_exact | plain_fallback
```

---

## 6. Tone Unsupported Definition

### 6.1 代码中真实存在的状态（不得混为一谈）

| 状态 | 判定依据（真实代码） | 是否同一种？ |
|------|----------------------|--------------|
| **Runtime tone unsupported** | `supportsToneFirstRecall() === false` ≡ `!(hasToneColumn && stmtBaseToneComposite)` | **本 Batch 核心对象** |
| **No / malformed tone key** | `buildTonePinyinKey…` 返回 `null`（无 pattern、长度不齐、tone∉[1,5]） | **不同原因**，但与 unsupported **共用** `!toneActive` 分支 |
| **Caller tone disabled** | `toneTimestampOnlyEnabled===false` → 不提取 pattern → key null | **Orchestrator 门控**，非 Runtime unsupported |
| **Tone SQL empty / mismatch** | tone path 已激活，查询返回 0 行 | **不是** unsupported；length1 **不**因此转 plain |
| **Tone underfill** | length2–5 tone 行数 &lt; limit | 触发 **plain_fallback**（类型 B） |

**结论：** 文档里的 toneKey 缺失 / unsupported / disabled / unavailable / mismatch **不是同一种状态**。当前代码用单一布尔 `toneActive` 折叠了前三类（凡致 `toneActive===false` 都标 `plain_only_no_pattern`），**无法在 Candidate 上区分**。

### 6.2 `supportsToneFirstRecall` 实现

```455:457:electron_node/electron-node/main/src/lexicon-v2/lexicon-runtime-v2.ts
  supportsToneFirstRecall(): boolean {
    return this.hasToneColumn && this.stmtBaseToneComposite != null;
  }
```

- `hasToneColumn`：成功 `loadFromBundleDir` 时硬编码 `true`。
- `stmtBaseToneComposite`：仅在 V3 five-table manifest 时 prepare；否则为 `null` → unsupported。
- Runtime tone API 在 stmt 缺失时 **返回 `[]`**，**不**内部改调 plain。

---

## 7. Fallback Owner

| 问题 | 答案 |
|------|------|
| 谁决定走 tone 还是 plain？ | **Recall**（`collectBaseOnly…` / `collectTierCandidatesToneFirst`） |
| Runtime 是否自动 fallback？ | **否** — 只返回 rows / `[]` |
| Orchestrator 角色？ | 决定是否提供 `acousticTonePattern`（`toneTimestampOnlyEnabled`） |
| Caller 是否“再调一次 plain”？ | **否** — Recall **内部**在 `!toneActive` 时直接调 plain API（静默，无第二轮对外协议） |

**唯一 Owner（path 选择）：Recall。**

存在 **两处** 相同公式（非两次串联 fallback）：

1. `recall-span-topk-v2.ts` · `collectBaseOnlySingleCharCandidate`（length1）  
2. `tone-first-tier-collector.ts` · `collectTierCandidatesToneFirst`（length2–5）

另有 **第三处语义不同** 的 plain fill：length2–5 `needPlainFallback`（类型 B）。

---

## 8. Runtime Behavior

| API | Tone unsupported / no stmt | Tone active |
|-----|----------------------------|-------------|
| `lookupBaseByPinyinAndToneKey` | `[]`（stmt 空或 toneKey 空） | tone SQL rows |
| `lookupBaseByPinyinKey` | plain SQL | plain SQL |
| `lookupBaseByExactSurfacePinyinAndTone` | `[]` | exact tone rows |
| `lookupBaseByExactSurfaceAndPinyin` | exact plain rows | exact plain rows |
| `supportsToneFirstRecall` | `false` | `true`（V3） |

**Runtime Contract：** 机械 lookup；**无** resolve / fallback / Candidate 决策。

---

## 9. Recall Behavior

### Length=1（1.1A/1.1B 路径）

- `toneActive`：仅 tone ambiguity + tone exact；**绝不** tone→plain 二次查找。  
- `!toneActive`：仅 plain ambiguity + plain exact；stage 固定 `plain_only_no_pattern`。  
- 若有 pattern 但 unsupported：仍 plain，调用者只见 `plain_only_no_pattern`，**静默**（无显式 `tone_unsupported` 标记）。

### Length=2–5

- `!toneActive`：同 length1，plain-only + `plain_only_no_pattern`。  
- `toneActive` + underfill：tone 后再 plain → `plain_fallback`（**显式** stage，但是 **underfill** 政策，不是 unsupported）。

---

## 10. Decision Matrix

| 条件 | Length1 行为 | Stage | Exact API |
|------|--------------|-------|-----------|
| 无 pattern | plain LIMIT=8 | `plain_only_no_pattern` | plain exact |
| pattern malformed → key null | plain | `plain_only_no_pattern` | plain exact |
| `supportsToneFirstRecall=false` + 有 pattern | plain（**静默**） | `plain_only_no_pattern`（**误标**） | plain exact |
| tone supported + key ok | tone LIMIT=8 | `tone_exact` | tone exact |
| tone SQL empty | empty（可 exact miss） | — | tone exact only |
| tone truncated residual 无 identity | empty（1.1A） | — | 可 identity accept（1.1B tone） |

| 条件 | Length2–5 额外 |
|------|----------------|
| tone underfill | + plain fill → `plain_fallback` |

---

## 11. Candidate Impact

| 维度 | Unsupported → plain（length1）影响？ |
|------|--------------------------------------|
| ambiguity LIMIT=8 | **仍用 8**，但 SQL 谓词变为 plain（更宽同音集） |
| exact LIMIT=2 | **仍用 2**，但走 plain exact |
| Candidate priority / 1.1B override 规则 | **不变** |
| Eligibility / kind=`exact_base` | **不变** |
| Score 公式 | **不变**；输入候选池可能因 plain 更宽而变 |
| `toneLookupStage` | 标成 `plain_only_no_pattern`，**掩盖** unsupported |
| `toneCompatible` / tonePenalty | 仅 `tone_exact` 时设置；plain 路径无 tone match 元数据 |

---

## 12. Downstream Impact

| 模块 | 影响 |
|------|------|
| LexicalEdge / Path / Vote / Assembly / KenLM | **算法未改**；仅可能收到不同 WindowCandidate（更宽 plain 命中） |
| Hard-block | **无关**（1.1D） |
| 跨 Batch？ | Candidate 内容变化可间接影响 Edge/Path 计数；**政策修复仍属 1.1C Recall**，不要求改 Edge 实现 |

---

## 13. Contract Consistency

| 文档 | 与代码 |
|------|--------|
| CR 1.0.7「tone-unsupported → 1.1C」 | **一致** — 问题仍在；未授权本轮修复 |
| CR 1.0.6「不改 tone-unsupported」 | **一致** — 1.1B 未改该分支 |
| Architecture / 旧 Tone V2 文档中的 plain fallback | **部分冲突命名**：常把类型 A 与类型 B 混称 “plain fallback”；代码里 `plain_fallback` **仅**类型 B |
| Development Plan（若写 “tone empty → auto plain” 于 length1） | **缺失/错误** — length1 **无** tone-empty→plain |

---

## 14. Duplicate Logic

| Item | Verdict |
|------|---------|
| `toneActive` 公式复制于 length1 + collector | **KEEP**（两入口）；1.1C 可考虑共享 helper，但属可选 |
| length2–5 `needPlainFallback` underfill | **KEEP** — 与 Unsupported **不同政策**；禁止在 1.1C 误删 |
| Runtime 内部 fallback | **不存在** |
| MERGE | 仅当 1.1C 设计明确要求统一 stage 标签时再议 |

---

## 15. Shadow Chain

| 模式 | 是否存在 |
|------|----------|
| tone → plain → tone → plain 循环 | **否** |
| length1：tone SQL 后再 plain | **否** |
| length2–5：tone 一次 + plain 至多一次 | **是**（underfill，有界） |
| Unsupported：跳过 tone，直接 plain | **是**（单次，非 shadow 双链） |

无第二条 Recall 产品链；无 tone/plain 交替重入。

---

## 16. Related Code Index

| 文件 | 符号 | 作用 |
|------|------|------|
| `lexicon-runtime-v2.ts` | `supportsToneFirstRecall`, tone/plain/exact lookups | Runtime 能力与 rows |
| `tone-pinyin.ts` | `buildTonePinyinKeyFromSyllablesAndPattern` | key 或 null |
| `recall-span-topk-v2.ts` | `collectBaseOnlySingleCharCandidate`, `tryExactSurfaceBaseIdentity` | length1 path |
| `tone-first-tier-collector.ts` | `collectTierCandidatesToneFirst`, `ToneLookupStage` | length2–5 + stage 枚举 |
| `tone-recall.ts` | `resolveTimestampToneState` | Orchestrator 是否提取 pattern |
| `recall-topk-for-windows.ts` | pattern 提取后传入 Recall | Caller 侧 tone 门控 |

---

## 17. KEEP / MODIFY / DELETE

| | |
|--|--|
| **KEEP** | 1.1A/1.1B；Runtime 不 fallback；length2–5 underfill `plain_fallback`（除非 1.1C 明确扩 scope）；Edge/Path/Vote |
| **MODIFY** | **仅 1.1C 开发阶段**：Recall 对 unsupported 的政策与 **stage 语义**（本轮不改） |
| **DELETE** | 无（本轮无代码变更） |

---

## 18. Target List

```text
[x] 审计 Tone Unsupported 定义
[x] 找到真实 fallback 调用链
[x] 找到唯一 Owner（Recall path 选择）
[x] 审计 Runtime 行为
[x] 审计 Recall 行为
[x] 审计 Candidate 影响
[x] 审计 Edge / Path / Vote 影响
[x] 审计重复逻辑
[x] 审计 Shadow Chain
[x] 核对 Contract
[x] 输出完整审计报告
```

---

## 19. Check List

```text
[x] 未修改代码
[x] 未修改测试
[x] 未修改 Contract
[x] 未进入 Batch1.1D
[x] 未进入 Batch2
[x] 所有结论均来自真实代码
[x] 输出完整调用链
[x] 标明唯一 Decision Owner
```

---

## 20. Development Risk（供 1.1C 设计，非本轮实施）

1. **标签污染：** unsupported 与 “无 pattern” 共用 `plain_only_no_pattern` → 观测/验收易误判。  
2. **政策分叉：** length1 无 underfill plain；length2–5 有 — 1.1C 必须写清 scope（仅 length1 Connectivity？或全局？）。  
3. **误伤 underfill：** 禁止把 `plain_fallback`（类型 B）当成 Unsupported bug 删掉。  
4. **静默加宽候选：** unsupported 时 plain LIMIT=8 同音集更宽，可能改变 uniqueness/exact 结果。  
5. **Orchestrator 门控：** `toneTimestampOnlyEnabled=false` 也会 `!toneActive`；勿全部算作 Runtime unsupported。  
6. **当前生产 V3：** `supportsToneFirstRecall` 通常为 true；缺陷主要在 **能力关闭/非 V3/测试注入** 与 **观测语义**，仍须政策冻结。

---

## 21. Recommended 1.1C Focus（设计提示，非开发）

```text
明确区分：
  (1) no_pattern
  (2) runtime_tone_unsupported
  (3) caller_tone_disabled
  (4) tone_sql_empty / mismatch
  (5) length2-5 underfill plain_fallback

冻结：
  Unsupported 时 Candidate 政策（empty vs explicit plain vs labeled plain）
  Stage / diagnostics 是否可区分
  是否触碰 length2-5 underfill（建议默认不动）
```

---

## 22. Batch Boundary

| | |
|--|--|
| 未进入 1.1D / Batch 2 / Cutover | Confirmed（只读） |
| HB / Vote / Path / KenLM 实现 | 未因本审计修改；间接 Candidate 影响记入风险 |

---

## 23. Excluded Scope

未实现政策；未改 CR；未改测试；未扩 LIMIT；未改 1.1A/1.1B；未改 Edge/Path/Vote/Assembly/KenLM。
