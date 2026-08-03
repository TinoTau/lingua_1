<!-- Documentation Hierarchy Metadata
Status: **ACCEPTANCE_RECORD**
Superseded By: Evidence only — not CURRENT
Archive Path: docs/acceptance/Freeze/FW_V4_FREEZE_2026_08_03_Code_and_Documentation_Freeze_Report.md
-->

> **ACCEPTANCE_RECORD** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: Evidence only — not CURRENT

# FW_V4_FREEZE_2026_08_03 — Code and Documentation Freeze Report

| Field | Value |
|-------|-------|
| Date | 2026-08-03 |
| Verdict | **FRAMEWORK_FREEZE_COMMITTED** |
| Nature | IMPLEMENTATION · Snapshot registration · NO business logic change |

---

## 1. Executive Summary

正式建立 **FW_V4_FREEZE_2026_08_03** 为 CURRENT RECOVERY BASELINE。Snapshot 权威目录：`docs/framework_snapshots/FW_V4_FREEZE_2026_08_03/`。绑定已验收 Lattice 主链代码、Atomicity Closure Source、CURRENT SSOT 索引与回归硬门。KenLM 仅 Runtime Boundary READY；质量未宣称 PASS。

---

## 2. Freeze Scope

ASR Raw → FineSpan/Lattice → Exact Recall → Domain Vote → Bucket → Assembly → CrossPath → KenLM Runtime Boundary  
+ Tone Evidence · Lexicon Full Rebuild · Unified Atomicity · term_domain_tags · Diagnostics · JobResult boundary.

---

## 3. Baseline Identity

| Item | Value |
|------|-------|
| Lexicon checksum | `ab78bf3599911711fc18ce59c62ab93c8f50c5410a1a6254e01125a244ce1f76` |
| bundleVersion | 12 |
| terms / domain tags | 9256 / 655 |
| Atomicity | enforce · 9248/8/0/0 |
| dialog_200 | 200/200 · uncovered=0 |
| Pre-KenLM (re-verify) | p50=56 · p95=100 · max=165 ms |

---

## 4. Files Included (INCLUDE_IN_FREEZE)

- Production code under `electron_node/electron-node/main/src/**`（Lattice cutover / LTR retirement / Atomicity bridges）  
- Lexicon scripts `scripts/lexicon/**`（已版本化 lib）  
- Formal Source `electron_node/docs/lexicon-assets/full_rebuild_v1/`（prior commit + 本基线）  
- `docs/framework_snapshots/**`  
- CURRENT indexes：`RUNTIME_DOMAIN_DOCUMENT_INDEX.md` · `docs/fw-detector/freeze/FROZEN.md` · tone-v2 FRAMEWORK_FREEZE_SUMMARY pointer  
- 本冻结报告  

## 5. Files Excluded

| Class | Examples |
|-------|----------|
| EXCLUDE_GENERATED | `node_runtime/lexicon/**/*.sqlite` · dist · logs |
| EXCLUDE_TEMP | `_audit_scratch/**` bulk JSON/out dumps（保留关键探针脚本若已跟踪） |
| REQUIRES_REVIEW | 大量未跟踪历史 audit MD（不阻断 Snapshot；可后续入库为 ACCEPTANCE RECORD） |

---

## 6–15. Snapshot Contents

见 pack `01`–`13` + SUMMARY。要点：

- Architecture：唯一主链；legacy PRODUCTION_ACTIVE=0  
- Ownership：无重叠  
- Atomicity：enforce · Source cleanup done · Runtime filter forbidden  
- Domain：`term_domain_tags` SSOT · Presence Vote  
- Diagnostics：read-only；caseId diagnostics-only  
- KenLM：READY ≠ quality PASS  
- Known Limitations：含 stale `lexicon:gate:v3-runtime` 阈值  

---

## 16. Acceptance Commands and Results

| Command | exitCode | Result |
|---------|----------|--------|
| `npm run build:main` | 0 | PASS |
| `npx jest --testPathPattern=freeze-contract` | 0 | 89/89 PASS |
| `npm run lexicon:test:atomicity` | 0 | PASS |
| dialog_200 post-atomicity probe | 0 | 200/200 · uncovered=0 · hardGatePass |
| Exact Recall（prior closure） | 0 | allPass（checksum 未变） |
| `npm run lexicon:gate:v3-runtime` | 1 | FAIL stale minima（KNOWN LIMITATION #10） |
| Lexicon checksum file | — | matches ab78bf… |
| Legacy residual in main/src | — | TEST_ONLY only（freeze-contract assertions） |
| Overfit search | — | no production gold/expectedSentence |

---

## 17. Residual Search

| Pattern | Classification |
|---------|----------------|
| parent_fragment / term_pinyin_ngrams / recallSpanTopKV3 / ltrRuntimeEnabled / phraseCandidates / phoneticGroups in production ts | **PRODUCTION_ACTIVE = 0** |
| Same strings in freeze-contract.test.ts | TEST_ONLY / DOCUMENTATION gate |

---

## 18. Overfit Search

无新增 `expectedSentence` / `goldAnswer` / `manualCandidate` / surface whitelist 生产决策。  
`caseId` diagnostics allowlist = diagnostics-only。

---

## 19. Git Commit

| Field | Value |
|-------|-------|
| Freeze Commit | `8603408097d0e4ce03651ec8d2d24afb44d70389` |
| Subject | freeze: establish FW_V4_FREEZE_2026_08_03 recovery baseline |
| Metadata Finalization | subsequent commit filling `snapshot.json` git.commit |

## 20. Git Tag

Annotated tag `FW_V4_FREEZE_2026_08_03` on metadata-finalized tip.

---

## 21. Recovery Instructions

`docs/framework_snapshots/FW_V4_FREEZE_2026_08_03/13_Recovery_Guide.md`

---

## 22. Target List

T1–T30：本轮完成（T22 中 `lexicon:gate:v3-runtime` 记为已知阈值债，不以旧阈值为硬门）。

---

## 23. Check List

```text
[x] 未修改业务算法/Vote/KenLM/词库内容（本轮仅文档+登记+提交已验收代码）
[x] 已检查工作区并排除临时产物
[x] Snapshot 目录 docs/framework_snapshots/FW_V4_FREEZE_2026_08_03
[x] CURRENT 索引更新
[x] build + freeze-contract + atomicity + dialog_200
[x] checksum 记录
[x] legacy PRODUCTION_ACTIVE=0
[x] 无长期冻结分支
[x] Git commit/tag
```

---

## 24. Final Verdict

```text
FRAMEWORK_FREEZE_COMMITTED

FW_V4_FREEZE_2026_08_03 已正式建立。

当前已验收代码、正式 Source、配置、CURRENT SSOT、
Framework Snapshot 和回归基线已绑定至 Git commit
8603408097d0e4ce03651ec8d2d24afb44d70389
（+ metadata finalization）。

未创建长期冻结分支。

Snapshot Tag：FW_V4_FREEZE_2026_08_03

该节点可作为 KenLM 能力验证前的恢复基线。
```
