# FW Repair V4 — Atomicity Closure and Source Cleanup
## Test Report · 2026-08-02

| Field | Value |
|-------|-------|
| Bundle under test | `node_runtime/lexicon/_rebuild_candidate` → promoted `v3` |
| checksum | `ab78bf3599911711fc18ce59c62ab93c8f50c5410a1a6254e01125a244ce1f76` |
| Hard gates | Exact Recall PASS · dialog_200 200/200 · Atomicity enforce 0/0 |

---

## 1. Atomicity Gate

| Metric | Result |
|--------|--------|
| mode | enforce |
| ACCEPT | 9248 |
| ACCEPT_EXCEPTION | 8 |
| REJECT_COMPOSITE | **0** |
| UNRESOLVED | **0** |
| term_pinyin_ngrams | absent |
| parent_fragment | absent |

Artifacts：`atomicity_enforce_report.csv` · rebuild `atomicity_report.json`。

---

## 2. Exact Recall Matrix

| Word | Expect formal | formalCount | Exact hit | Pass |
|------|---------------|-------------|-----------|------|
| 休息 | Y | 1 | Y | Y |
| 策略 | Y | 1 | Y | Y |
| 神经网络 | Y | 1 | Y | Y |
| 单元测试 | Y | 1 | Y | Y |
| 迷你吧 | Y | 1 | Y | Y |
| 训练 | Y | 1 | Y | Y |
| 会议 | Y | 1 | Y | Y |
| 上线 | Y | 1 | Y | Y |
| 计划 | Y | 1 | Y | Y |
| 接口 | Y | 1 | Y | Y |
| 文档 | Y | 1 | Y | Y |
| 上线计划 | N | 0 | — | Y |
| 接口文档 | N | 0 | — | Y |
| 专家系统 | N | 0 | — | Y |
| 邀请函 | N | 0 | — | Y |

Probe：`docs/tone-v2/_audit_scratch/post-atomicity-exact-recall-probe.mjs`。

---

## 3. dialog_200

| Metric | Before (Step7 freeze) | After Atomicity |
|--------|----------------------|-----------------|
| completedCases | 200 | **200** |
| failedCases | 0 | **0** |
| latticeUncovered | 0 | **0** |
| kenlmInputCount | 200 | 200 |
| Pre-KenLM p50 | 66 | 41 |
| Pre-KenLM p95 | 109 | 70 |
| Pre-KenLM max | 152 | 111 |

Export：`dialog200_post_atomicity_candidate_export.csv`。

---

## 4. Six-Term Closure

`forced_activation_six_closure.csv`：6/6 最终 KEEP_DOMAIN_ATOMIC；无 REVIEW_PENDING。

---

## 5. Overfit Static Audit

| Pattern | Finding |
|---------|---------|
| dialog200 special case | 无新增 |
| testMode branch | 无 |
| surface blacklist（是否/邀请函） | 无；Validator 为通用长度规则 |
| expected sentence / gold lookup | 无 |
| caseId condition（生产路径） | 仅既有 diagnostics config |
| manual candidate patch | 无 |

---

## 6. Target / Check List

```text
[x] 未重新设计主链
[x] 未修改 Domain Vote
[x] 未恢复 parent fragment / LTR
[x] 已修复原子词数据与短词误判
[x] 已完成 6 词 Forced Activation → KEEP/DELETE
[x] 已修改正式 Source（未直接改 SQLite）
[x] 已写入 domain_atomic 元数据
[x] 未机械复制 Domain Tags
[x] 已切换 enforce + clean rebuild + Gate
[x] 已记录新 checksum / Node 加载
[x] Exact Recall + dialog_200
[x] 已导出 Candidate CSV
[x] 过拟合静态审计 + CURRENT SSOT
[x] 未优化 KenLM；已完成 Readiness Audit
[x] 已生成全部报告和 CSV
```

---

## 7. Final Verdict

**ATOMICITY_CLOSED_KENLM_READY**
