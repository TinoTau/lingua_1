# FW Repair V4 — Atomicity Closure and Source Cleanup
## Development Report · 2026-08-02

| Field | Value |
|-------|-------|
| Nature | MIXED · FREEZE / ADJUST / AUDIT / IMPLEMENT / VERIFY |
| Verdict | **ATOMICITY_CLOSED_KENLM_READY** |
| Bundle | `node_runtime/lexicon/v3` · bundleVersion **12** · checksum `ab78bf3599911711fc18ce59c62ab93c8f50c5410a1a6254e01125a244ce1f76` |

---

## 1. Executive Summary

Atomicity 阶段已关闭：主链/Vote/双 Atomicity/Validator Owner/`term_domain_tags` SSOT 正式冻结；休息·策略数据与短词 Validator 已修；6 个 REVIEW 词 Forced Activation 闭环；Source Cleanup + `domain_atomic` 例外落地；Full Rebuild `enforce` 通过（REJECT_COMPOSITE=0 / UNRESOLVED=0）；Exact Recall 与 dialog_200（200/200 · uncovered=0）回归通过；KenLM 能力验证输入/评分/排序可追踪。未优化 KenLM。

---

## 2. Frozen Architecture

生产唯一主链：

```text
ASR Raw → FineSpan/Lattice → Formal Exact Recall → Domain Vote
→ SameDomain Bucket → Sentence Assembly → CrossPath → KenLM
```

RETIRED：LTR · parent_fragment · term_pinyin_ngrams · phrase/substring/shadow recall。

---

## 3. Frozen Atomicity Contract

Surface Atomicity + Domain-semantic Atomicity（A 或 B）。  
例外：`term_type=domain_atomic`（不扩展 Runtime Schema）。

---

## 4. Frozen Domain Vote Contract

Presence Vote 不变：仅 `domain_term` / `passive_domain_weak`；base 不投票；每 FineSpan 每域最多 +1。  
领域票下降根因是 compound-only fine tag，不是 Vote Bug。

---

## 5. Data Defect Fixes

| Surface | Root cause | Fix Owner |
|---------|------------|-----------|
| 休息 | `tone_pinyin_key` `xi0` | Source → `xiu1\|xi1` |
| 策略 | Source 曾写 `lüe`，Runtime `normalizeSyllable` 剥非 ASCII → query `ce4\|le4` | Source 对齐 `ce\|le` / `ce4\|le4`；Full Rebuild 写入前统一 `normalizePinyinKeyForRuntime` |
| 迷你吧 | `ba0` 阻断 Exact | Source → `mi2\|ni3\|ba1` |

---

## 6. Short-Term Validator Fix

`matchTemplateOrFragment`：长度感知；≤3 字规范词（是否/邀请函/迷你吧类）不再被短语模板误杀。禁止 surface 白名单特判。

---

## 7. Six-Term Forced Activation Results

| Surface | Final |
|---------|-------|
| 回归测试 | KEEP_DOMAIN_ATOMIC |
| 测试数据 | KEEP_DOMAIN_ATOMIC |
| 特征工程 | KEEP_DOMAIN_ATOMIC |
| 配置文件 | KEEP_DOMAIN_ATOMIC |
| 集成测试 | KEEP_DOMAIN_ATOMIC |
| 迷你吧 | KEEP_DOMAIN_ATOMIC（tone 修复后） |

无 REVIEW_PENDING。

---

## 8. Final Source Action Matrix

产出：`docs/tone-v2/atomicity_final_source_actions.csv`（813 行动作行；8 KEEP；805 DELETE）。

另：`atomicity_enforce_report.csv`（740 UNRESOLVED → DELETE_SURFACE_ATOMIC_UNRESOLVED）。

---

## 9. Domain Atomic Exceptions

8 词写入 `term_type=domain_atomic` + 统一 `exception_reason`。  
未机械复制 神经/网络/单元/测试 → tech_ai。

---

## 10. Source Cleanup

正式 CSV：`lexicon_full_corrected_review.csv` · `supplemental_terms.csv` · `term_domain_tags_corrected.csv`。  
未直接改生产 SQLite。`sources.manifest.json` contentBundleVersion=12 + 新 hashes。

---

## 11. Atomicity Enforce

`run-lexicon-full-rebuild.mjs` / `full-rebuild-from-csv.mjs` 默认 **enforce**（`--atomicity-mode=audit` opt-out）。

---

## 12. Full Rebuild

```text
npm run lexicon:full-rebuild -- --force
```

空目录构建；不读旧 SQLite/tmp；Gate PASS。

---

## 13. New Bundle Identity

| Field | Value |
|-------|-------|
| bundleVersion | 12 |
| checksum | `ab78bf3599911711fc18ce59c62ab93c8f50c5410a1a6254e01125a244ce1f76` |
| terms | 9256 |
| domain tags | 655 |
| ACCEPT_EXCEPTION | 8 |
| atomicity.mode | enforce |

---

## 14. Exact Recall Regression

休息 / 策略 / 神经网络 / 单元测试 / 迷你吧 / 训练 / 会议 / 上线 / 计划 / 接口 / 文档 = PASS；上线计划 / 接口文档 / 专家系统 / 邀请函 formal=0。

---

## 15. dialog_200 Regression

| Metric | After |
|--------|-------|
| completedCases | 200 |
| failedCases | 0 |
| latticeUncovered | 0 |
| kenlmInputCount | 200 |
| Pre-KenLM p50/p95/max | 41 / 70 / 111 ms |

导出：`dialog200_post_atomicity_candidate_export.csv`。  
Candidate 数允许相对 Before 下降（组合词删除预期）。

---

## 16. Overfit Static Audit

未新增 dialog200 / gold / expectedSentence / surface 黑名单特判。  
`v4-diagnostics-config` 的 caseId 匹配仅为 diagnostics 白名单（既有）。Atomicity 仅由 Source metadata + Unified Validator 驱动。

---

## 17. SSOT Freeze Updates

- [`FW_Repair_V4_Atomicity_Closure_SSOT_Freeze_2026_08_02.md`](./FW_Repair_V4_Atomicity_Closure_SSOT_Freeze_2026_08_02.md)
- Index：`RUNTIME_DOMAIN_DOCUMENT_INDEX.md`（本轮追加入口）

---

## 18. Remaining Lexicon Expansion Work

- 未来 Expansion Package 仍须过 Unified Validator  
- 可选：IME `lve` ↔ Runtime `le` 进一步统一（本轮不改 Runtime normalize 语义）  
- KenLM 能力验证与优化（下一阶段）

---

## 19. Target List

T1–T32：见同日 Test Report Check List；本轮全部勾选完成（KenLM 为 Readiness，非优化）。

---

## 20. Check List

见 Test Report。

---

## 21. Final Verdict

```text
ATOMICITY_CLOSED_KENLM_READY

主链、Domain Vote、Atomicity 和词库构建合同均已冻结。
已确认的数据错误已修复；组合词已完成最终 Source Action；
Atomicity Enforce 已启用；新词库 clean rebuild；
dialog_200 回归通过；未发现测试集特判。
KenLM 输入、评分、排序、delta 与 Raw 身份具备验证条件。
可以进入 KenLM 能力验证与优化。
```
