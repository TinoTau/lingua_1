# Lingua Model2 — Runtime Integration MVP Final Closure Development Report

**Date:** 2026-08-17  
**Label:** `RUNTIME_INTEGRATION_SKELETON_CLOSED`  
**Artifacts:** `training/model2_v3/experiments/v3_runtime_integration_mvp_final_closure/`

---

## Goal

关闭上一轮唯一未闭合业务缺口：

`Target Absent → Introduced = PARTIAL` → **PASS**

---

## What was delivered

### 1. TEST_FIXTURE_ONLY LexiconRuntimeV2 SQLite

- 复制 operational v3 schema bundle（不改生产词库）
- 写入 ≥22 条 PROFILE_TARGET_ABSENT cases（覆盖 ACTIVE_SET_V1：n_l / sh_s / h_f / z_zh / ch_c / eng_en / in_ing）
- 含 multi-tag `term_domain_tags`（coffee + milk_tea）
- 标记：`TEST_FIXTURE_ONLY_MODEL2_RUNTIME_E2E`

### 2. Real path proof (no mocks)

```
base recall (observed) → target ABSENT
Session UserProfile (phonetic)
FineSpan syllables
Stage P Trainable Model2 (sidecar)
selected action
relation adapter + acousticTonePattern
LexiconRuntimeV2 SQLite
WindowCandidate(PROFILE_RETRIEVAL)
termId merge
→ target PRESENT
```

### 3. Tone wiring fix (required for Batch 1.1C)

Mandatory tone recall Fail-Closed 导致无 `acousticTonePattern` 时 profile query 永远空。

最小修复：

- `relation-lexicon-adapter` / `expand-active-candidates` 转发 FineSpan tone pattern
- orchestrator 从 `toneRebindTrace.acousticTonePattern` 传入

未改 Assembly / KenLM / FineSpan generator。

### 4. Metrics (measured)

| Metric | Value |
|--------|-------|
| Eligible cases | 22 |
| Introduced | 22 |
| Introduction rate | **1.0** |
| P50 | ~3 ms |
| P95 | ~4 ms |
| Sidecar 100 infers | singleton PASS |

---

## Explicit non-claims

- Stage D / Stage J / Full Model2 Complete：**未做**
- Stage P 仍用 sidecar legacy training hash
- `MODEL2_FEATURE_HASH_V1` 仅 ready for Stage J
- Wrong/Swapped budget selectivity：**DEFERRED**

---

## Next phase

1. Stage D real lexical/domain UserProfile writeback  
2. Stage J unified training **with MODEL2_FEATURE_HASH_V1**  
3. 替换 Stage P-only checkpoint — **不重写 runtime architecture**
