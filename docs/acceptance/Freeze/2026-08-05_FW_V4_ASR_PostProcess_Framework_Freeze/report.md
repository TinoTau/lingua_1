# FW Repair V4 — Current ASR Post-Processing Framework Freeze

| Field | Value |
|-------|-------|
| Date | 2026-08-05 |
| Freeze ID | **FW_V4_ASR_POSTPROCESS_FREEZE_2026_08_05** |
| Previous | `FW_V4_FREEZE_2026_08_03` |
| Verdict | **FRAMEWORK_FREEZE_COMPLETE** |

---

## Q1 — Commit SHA and Tag

| Field | Value |
|-------|-------|
| Tag | `FW_V4_ASR_POSTPROCESS_FREEZE_2026_08_05` |
| baseline_identity.gitCommit | `RESOLVE_FROM_TAG` |
| Authoritative peel | `git rev-list -n 1 FW_V4_ASR_POSTPROCESS_FREEZE_2026_08_05` |

Annotated Tag peel 必须等于冻结 tip Commit。验证：`verify_freeze.ps1` → `VERIFY_FREEZE_PASS`。

---

## Q2 — Working Tree clean?

Freeze Commit 完成后：纳入范围内 tracked files clean。  
显式排除未审计 WIP（未提交）：`docs/tone-v2/_audit_scratch/**`、`kenLM/corpus/**`、`kenLM/model/corpus_v1/**`、实验脚本；Lexicon rebuild WIP 已 **restore 到 HEAD**（不纳入本冻结）。

---

## Q3 — Freeze scope modules

```text
Tone · Exact Recall · Lexicon contracts · Domain Vote · SameDomain Bucket
Sentence Assembly Enumeration · Formula A Metadata · CrossPath · KenLM
CURRENT SSOT · Snapshot · Recovery materials
```

---

## Q4 — Tone / Exact Recall in CURRENT SSOT?

**是。** Snapshot `02_Runtime.md` + CURRENT Index + Supporting Recall Contract（`FROZEN_AT_2026_08_03` 仍有效）。Mandatory Tone · Mode C · 禁止 Plain fallback。

---

## Q5 — repairSelectionCompleteness archived?

**是。** `INTERFACE_FREEZE.md` · Assembly Contract · Diagnostics · Implementation code + Formula A tests · Development Acceptance Pack。

---

## Q6 — Assembly Enumeration matches code?

**是。** Interval Non-Overlap Repair-Subset DFS + Gap Fill + Score Sort + Exact Dedup + Cap；limits 1024/16/16/8·6·4。与 `build-sentence-candidates.ts` 一致。

---

## Q7 — Is Top16 a capacity bottleneck?

**否。** dialog_200 mean pool ≈1.685；competition ≈2.827；max=8；full-16=0；mean unused ≈14.315。

---

## Q8 — Why pause Candidate Diversity?

无 Sole Owner；池未饱和；近重复是质量议题而非 cap 压力。登记 D1 `DEFERRED_NO_OWNER`。

---

## Q9 — allocateDomainBucketSentenceBudget?

`KNOWN_NON_BLOCKING_INCONSISTENCY`（D2）：调用作 guard，返回值未接入生成。本轮不改。

---

## Q10 — CrossPath / KenLM duties unchanged?

**是。** CrossPath = merge + exact-text first-wins + ≤16。KenLM = score/rank/pick only；不读 Formula A。

---

## Q11 — Wikipedia KenLM non-production?

**是。** `PRODUCTION_REJECTED`；生产 trie SHA256 `532A335A…A62A4C` 保留。

---

## Q12 — Interactive Repair only deferred?

**是。** D3 `DEFERRED_FUTURE_MODULE` — 无接口/占位代码/JobResult 改动。

---

## Q13 — Tests run this freeze (CURRENT_RUN)

| Command | Result |
|---------|--------|
| Formula A + Assembly + CrossPath + rerank + freeze-contract Jest | **PASS** (122 tests) |
| `npm run docs:check` | **PASS** |
| `npm run accept:domain-multibucket-kenlm` | **ACCEPTANCE_PASS** |

---

## Q14 — Inherited baseline only

| Item | Status |
|------|--------|
| dialog_200 200/200 | **INHERITED_BASELINE** — not rerun this freeze |
| KENLM_BENCHMARK_V1 human labels | **INHERITED** evidence pack |
| Recall subsystem freeze 2026-08-03 | **INHERITED** |

---

## Q15 — Runtime behaviour unchanged?

**是。** 见 `runtime_behavior_seal.json` — 全部 `false`。本轮仅文档/元数据归档 + 已实现 metadata 代码纳入基线（metadata-only，无 admission）。

---

## Q16 — CURRENT SSOT unique authority updated?

**是。** `docs/INDEX.md` · `docs/current/INDEX.md` · fw-detector contracts · Snapshot entry。无 FINAL/LATEST/V2 平行权威。旧 Snapshot 未改写。

---

## Q17 — Recovery verified?

`RECOVERY.md` + `verify_freeze.ps1`（只读）。Tag 创建后执行验证脚本。

---

## Q18 — Can this be next-stage baseline?

**是 → FRAMEWORK_FREEZE_COMPLETE**

```text
FRAMEWORK_FREEZE_COMPLETE

当前 ASR 后处理代码、接口、Owner、能力边界、
Assembly Enumeration、Repair Selection Metadata、
CrossPath 与 KenLM Runtime Boundary
已建立新的日期节点冻结基线。

CURRENT SSOT 已同步；
恢复身份、文件 Manifest、验证脚本和 Git Tag 已建立；
Runtime 行为未发生变化。

该冻结版本可作为 Interactive Recognition Repair
及后续独立模块开发的恢复基线。
```
