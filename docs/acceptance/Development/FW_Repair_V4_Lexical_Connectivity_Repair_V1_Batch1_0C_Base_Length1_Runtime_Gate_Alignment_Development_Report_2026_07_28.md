<!-- Documentation Hierarchy Metadata
Status: **ACCEPTANCE_RECORD**
Superseded By: Evidence only — not CURRENT
Archive Path: docs/acceptance/Development/FW_Repair_V4_Lexical_Connectivity_Repair_V1_Batch1_0C_Base_Length1_Runtime_Gate_Alignment_Development_Report_2026_07_28.md
-->

> **ACCEPTANCE_RECORD** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: Evidence only — not CURRENT

# FW Repair V4 — Lexical Connectivity Repair V1 · Batch 1.0C Base Length-1 Runtime Gate Alignment Development Report

| Field | Value |
|-------|-------|
| Date | 2026-07-28 |
| Batch | 1.0C |
| Scope | Stage 1–3 only (Design Audit → Development → Functional Test) |
| Next | Batch 1.1 Ambiguity / Tone / Hard-block Repair (only after this Functional PASS) |
| Not | Batch 2 · Batch 1 Stage 4/5 Generalization Gate |

---

## 1. Executive Summary

Batch 1.0B 证明真实 `LexiconRuntimeV2.lookupTier` 对 `termLength < 2` 一律返回 `[]`，导致 SQLite 已有单字 base 行也无法进入 Recall。本轮采用 **方案 A：显式 `minTermLength`**，仅对 base exact / base tone 开放 `termLength=1`；idiom 与 domain 保持 `>=2`。真实链路已打通：

```text
Temp SQLite → LexiconRuntimeV2 → recallSpanTopKV2 → Candidate → Edge → Path
```

---

## 2. Final Verdict

```text
BATCH 1.0C BASE LENGTH-1 RUNTIME GATE ALIGNMENT:
PASS

BASE EXACT/TONE LENGTH-1 CONTRACT ALIGNED
OTHER TIERS REMAIN FROZEN
READY FOR BATCH 1.1 REPAIR
```

---

## 3. Five-Stage Status

| Stage | Status |
|-------|--------|
| Stage 1 — Design Audit | **PASS** |
| Stage 2 — Development | **PASS** |
| Stage 3 — Functional Test | **PASS** |
| Stage 4 — Generalization Audit | PENDING（Batch 1 整体） |
| Stage 5 — Cleanup & Gate | PENDING（Batch 1 整体） |

---

## 4. Pre-Development Call Graph Audit

### 4.1 `lookupTier` callers（审计时）

| Caller | Table/Tier | Via lookupTier? | Current min | Required min | Action |
|--------|------------|-----------------|------------:|-------------:|--------|
| `lookupBaseByPinyinKey` | base plain | Yes | 2 | 1 | **MODIFY** |
| `lookupBaseByPinyinAndToneKey` | base tone | Yes | 2 | 1 | **MODIFY** |
| `lookupIdiomByPinyinKey` | idiom plain | Yes | 2 | 2 | KEEP |
| `lookupIdiomByPinyinAndToneKey` | idiom tone | Yes | 2 | 2 | KEEP |
| `lookupDomainsByPinyinKeyMulti` | domain | **No**（独立路径） | 无显式 Runtime gate | 2 | **KEEP + 显式 gate** |
| `lookupDomainsByPinyinAndToneKeyMulti` | domain tone | **No** | 无显式 Runtime gate | 2 | **KEEP + 显式 gate** |
| `lookupParentFragmentsByNgramKey` | ngram | No | n/a（无 termLength） | 2（call-site） | KEEP |
| Fuzzy builder | variants | No | MIN_SYLLABLES=2 | 2 | KEEP |

边界结论：`lookupTier` **并非**仅供 base 使用（idiom 共用），故禁止粗暴改为 `termLength < 1`。职责隔离可行 → 开发继续。

---

## 5. Runtime Contract Before

```text
lookupTier: termLength < 2 → []
→ base / idiom 全部 length=1 不可达
domain multi: 无显式 min gate（依赖 SQL length(word)=?）
```

---

## 6. Runtime Contract After

```text
Base exact:        termLength 1–5
Base tone exact:   termLength 1–5
Domain exact:      termLength 2–5（Runtime early return）
Domain tone exact: termLength 2–5
Idiom:             termLength ≥2（lookupTier minTermLength=2）
Fuzzy:             ≥2（builder）
Parent fragment:   call-site length=1 → parentFragmentTopK=0
Alias expansion:   length=1 Recall 不扩展；is_alias 过滤
```

Contract Change Record：**1.0.3**（Implementation Contract）。

---

## 7. Chosen Implementation

方案 A：

```ts
private lookupTier(..., minTermLength: number)
lookupBase*     → minTermLength = 1
lookupIdiom*    → minTermLength = 2
domain multi*   → if (termLength < 2) return []
```

禁止：调用方名称特判、table 字符串特判、NODE_ENV、feature flag、fake Runtime。

---

## 8. Why Other Tiers Remain Closed

1. Idiom 显式 `minTermLength=2`
2. Domain multi 显式 `termLength < 2 → []`
3. Length=1 Recall 独立 base-only 分支；不调用 domain / fuzzy / parent
4. Call-site：`exactTopK=1`、`domainIds=[]`、`fuzzy=false`、`parentFragmentTopK=0`
5. Fuzzy builder `MIN_SYLLABLES=2`

---

## 9. Files Changed

| File | Change |
|------|--------|
| `lexicon-runtime-v2.ts` | `minTermLength` + domain gate |
| `lexicon-runtime-v2-length1-base.contract.test.ts` | **NEW** Runtime Contract |
| `recall-span-topk-v2-length1.sqlite.integration.test.ts` | 更新为 1.0C 期望 + baselines |
| `length1-recall-edge-path.sqlite.integration.test.ts` | Candidate→Edge→Path / Vote / diagnostics |
| Implementation Contract | CR **1.0.3** |
| `_audit_scratch/lattice_v1_batch1_0c/*` | baselines + dist inventory |

复用（未新建第二套 helper）：`length1-real-sqlite.test.helpers.ts`

---

## 10. Tests Added / Updated

| Class | Suite |
|-------|-------|
| Runtime Contract Test | `lexicon-runtime-v2-length1-base.contract.test.ts` |
| SQLite / Recall Integration | `recall-span-topk-v2-length1.sqlite.integration.test.ts` |
| Edge/Path / Vote / Call-site | `length1-recall-edge-path.sqlite.integration.test.ts` |
| Unit（既有） | `connectivity-path-vote-bind.unit.test.ts` |

---

## 11–15. Evidence Summary

| Layer | Result |
|-------|--------|
| Real SQLite | seed 行可读；checksum 重签 |
| Real Runtime | plain/tone length=1 返回真实 row |
| Recall Candidate | `source=base_term`、`domains=[]`、`repairTarget=false`、cap=1 |
| Edge→Path | 「点」单字 retained；「甲乙丙丁戊」中「丙」lexical 使用 |
| Vote | base 单字 `domainScores={}`；domain「高速」votes |

---

## 16. LIMIT=8 Updated Baseline

见 `docs/tone-v2/_audit_scratch/lattice_v1_batch1_0c/length1_limit8_real_sqlite_baseline.json`：

| Field | Observed |
|-------|----------|
| databaseCandidateCount | 9 |
| runtimeReturnedCount | 8 |
| visibleEligibleCount | 1 |
| finalCandidateCount | 1 |
| surfaceExactAtPosition9Reachable | **false** |
| observedFalseUnique | **true**（捌） |

**本轮只记录，不修复。** Batch 1.1 应处理 LIMIT/surface 策略。

---

## 17. Tone Unsupported Updated Baseline

见 `length1_tone_unsupported_baseline.json`：

| Field | Observed |
|-------|----------|
| override supportsToneFirstRecall | false |
| observedBehavior | **plain_fallback_when_tone_unsupported** |
| finalWord | 我 |
| toneLookupStage | plain_only_no_pattern |

**本轮只记录，不修复。**

---

## 18. Diagnostics

Phase1 harness 在真实 length=1 window（`buildLexicalWindowQueries` min=1）下：

- `singleCharWindowCount / RecallCount / HitCount / CandidateCount / LexicalEdgeCount` → 非零
- 语义：窗口数 / 进入 Recall / 命中 / 候选合计 / cap=1 命中窗 / 单音节 lexical edge
- LTR `V4_LIMITS.windowMinSyllables=2` 仍不变；production LTR 不因此自动发 length=1 窗

---

## 19. 2–5 Regression

Electron：`recall-span-topk-v2` / `topkv3` / `lexicon-runtime-v2` / HB / freeze → **100 PASS**。内容 golden：`甲乙` / `exact_base`。

---

## 20. Production Build Isolation

- `npm run build:main` 成功
- helper / integration / contract tests **不进 dist**
- inventory：`batch1_0c_dist_test_resource_inventory.json` → **CLEAN**

---

## 21. Known Defects（记录，本轮不修）

1. **LIMIT=8 + alias 过滤 → 假唯一**（捌）
2. **surface 第 9（玖）不可达**
3. Tone unsupported → 当前为 plain fallback（策略待 1.1）
4. 同音多合法字无 surface exact → Recall 空（既有保守歧义策略）

---

## 22. Excluded Modules

未改：LIMIT 常量、`resolveLength1BaseCandidate`、HB、Vote/Edge/Path 算法、Patch V4、Full Build、operational SQLite、正式单字导入、Production cutover。

---

## 23–26. KEEP / MODIFY / DELETE / NEW

| Class | Items |
|-------|-------|
| KEEP | idiom min=2；fuzzy min=2；parent min=2；LENGTH1_AMBIGUITY_SQL_LIMIT=8；1.0B helper |
| MODIFY | `lookupTier` + base callers；domain multi gate；length1 integration expectations |
| DELETE | （无）1.0B「KNOWN DEFECT gate empty」断言 |
| NEW | Runtime length1 contract test；`lattice_v1_batch1_0c` baselines；CR 1.0.3 |

---

## 27. Target List

全部完成（见提示词 §29）：审计矩阵、契约冻结、真实 Runtime/Recall/Edge/Path/Vote、LIMIT/tone 基线更新、回归、dist CLEAN、双报告。

---

## 28. Check List

全部满足（见提示词 §30）：未粗暴开放全 tier；未改禁止范围；无 fake Runtime；无 feature flag；未准备 Batch 2。

---

## 29. Next Stage Recommendation

```text
→ Batch 1.1 — Ambiguity / Tone / Hard-block Repair
  依据本轮真实基线：
  - LIMIT=8 false-unique + rank9 unreachable
  - tone unsupported = plain fallback（是否保留由 1.1 决策）
禁止进入 Batch 2，直至 Batch 1 Stage 4/5 Gate = PASS。
```
