# FW Repair V4 — KenLM Capability Baseline Audit

| Field | Value |
|-------|-------|
| Date | 2026-08-03 |
| Nature | **READ ONLY** · Capability Baseline · Real Runtime Reranking |
| Freeze Baseline | **FW_V4_FREEZE_2026_08_03** |
| Code / Model / Threshold / Lexicon | **UNCHANGED** |
| Artifacts | [`kenlm_capability_baseline_2026_08_03/`](./kenlm_capability_baseline_2026_08_03/) |
| Probe | `docs/tone-v2/_audit_scratch/kenlm-capability-baseline-probe.mjs` |
| Verdict | **KENLM_BASELINE_COMPLETE_UPSTREAM_BLOCKED** |

---

## 1. Executive Conclusion

真实 KenLM subprocess 已证明可调用，候选级导出与 Raw 身份校验已完成。

但在 **FW_V4_FREEZE_2026_08_03** 当前主链上：

```text
KenLM 输入池几乎没有“与 Raw 不同的竞争句”
→ 无法评价 KenLM 排序能力（B）
→ 无法评价 Decision Gate（C）
→ 真实噪声 Case 全部为 A：正确句未进入 KenLM 输入
```

| Suite | A | B | C | PASS | 含义 |
|-------|--:|--:|--:|-----:|------|
| dialog_200 | 0 | 0 | 0 | 200 | Raw≡Expected；池内无异文竞争（空通过） |
| noise_inventory | 7 | 0 | 0 | 0 | 正确候选全部缺失 |

**下一阶段唯一优先级：上游 Candidate Coverage（Recall / Lattice / Assembly / CrossPath），不是 KenLM 模型优化。**

---

## 2. Freeze Baseline

```text
ASR Raw → FineSpan/Lattice → Exact Recall → Domain Vote
→ SameDomain Bucket → Assembly → CrossPath → KenLM(Score/Rank/Pick)
```

KenLM 职责冻结：Score / Rank / Pick。  
禁止项本轮均未实施：模型、语料、n-gram、raw_log_delta、minDeltaToReplace、TopK、cap、主链、词库。

---

## 3. Real KenLM Invocation Proof

| Item | Value |
|------|-------|
| Proven | **YES** |
| Sample tokenized | `你 好 世 界` |
| Sample Total score | **-13.089462** |
| Sample OOV | **0** |
| Warmup wallMs | **700**（WSL 预热后） |
| Binding | `runKenlmQueryBatch` → `wsl.exe -- <query> <model>`（Windows 无 `query.exe` 时） |
| Process reuse | **无常驻进程**；`subprocessLock` 串行 mutex；每 batch 新 spawn |
| Production timeout | `kenlmSubprocessTimeoutMs = 5000` |
| Fail-open | subprocess 失败 → score 全 0，不阻断 pipeline |
| Mock / fake rank | **未使用** |

与手工 WSL smoke 一致：`Total: -13.089462 OOV: 0`。

若无法证明真实模型：本报告不会给出 COMPLETE；当前已证明。

---

## 4. KenLM Model Identity

| Field | Value |
|-------|-------|
| Path | `kenLM/model/zh_char_3gram.trie.bin`（`CHAR_LM_PATH`） |
| SHA256 | `532a335a09a006d1ba674f808814ee1d40c5b1d8f3527ca980e96723e7a62a4c` |
| Size | 34,995,949 bytes (~33.4 MB) |
| n-gram order | **3**（`lmplz -o 3`） |
| Level | **character-level**（`tokenizeForLm`） |
| Binary entry | `kenLM/kenlm/build/bin/query`（Linux ELF；经 WSL） |
| scoreMode | `raw_log_delta` |
| minDeltaToReplace | **3.0** |
| maxSentenceCandidates | **16** |

同 checksum 副本：`electron_node/services/asr_sherpa_lm/models/kenLM/zh_char_3gram.trie.bin`。

---

## 5. Input Candidate Contract

生产路径：

```text
runSpanAssemblyV4Orchestrator
→ kenlmSentenceCandidates.combinations (<=16)
→ runFwSentenceRerankFromPrefilled
→ rerankFwSentences(rawText, combinations, scorer, minDeltaToReplace)
→ scoreBatch([raw, ...candidateTexts])
```

观测（本基线）：

| 观测 | dialog_200 | noise |
|------|------------|-------|
| 平均 candidateCount（含 synthetic raw） | 2 | 2 |
| 每 Case 异文 distinct text | **1**（仅 Raw） | **1** |
| maxDelta ≠ 0 | **0 / 200** | **0 / 7** |

**KenLM 被调用 ≠ KenLM 有可排序竞争。** 当前几乎全部为 Raw 自复制槽位。

---

## 6. Candidate-Level Export

| File | Rows |
|------|------|
| `kenlm_capability_baseline_candidates.csv` | Case × Candidate |
| `kenlm_capability_case_summary.csv` | Case |
| `kenlm_abc_classification.csv` | A/B/C |
| `kenlm_score_distribution.csv` | score/delta/rank |
| `kenlm_performance_baseline.csv` | latency |

字段缺口（写 `UNAVAILABLE`，未伪造）：

| Field | Owner |
|-------|-------|
| `sourcePath` / `bucketDomain` 常缺 | CrossPath `SentenceCombination` DTO 未稳定携带 |
| `isCanonical` | Assembly marker 未普遍标注 |
| vocab size / prune params | 训练日志缺失 → MODEL_PROVENANCE_INCOMPLETE |

---

## 7. Raw Identity Validation

| Check | Result |
|-------|--------|
| Synthetic `isRaw` row per case | **1** |
| `deltaVsRaw` on raw row | **严格 0** |
| `baselineRawScore = raw kenlmScore` | **PASS** |
| Raw identity blockers | **0** |
| Combo text == raw（额外槽） | 普遍存在（池退化表现，非 Raw 缺失） |

Raw 未缺失、未覆盖 baseline；问题是 **异文候选缺失**，不是 Raw 合同破坏。

---

## 8. Correct Candidate Evaluation Boundary

```text
expectedText / ground truth
仅存在于评估脚本与本报告
不进入 Recall、Assembly、KenLM pick、Runtime API
```

静态证明：探针 `runCase` 仅将 `rawText` 传入 orchestrator / rerank；`expectedText` 只用于离线 `classifyAbc`。

dialog_200：`text === expectedText`（restored TTS 干净文本）→ 评估偏向 Raw Preservation，而非纠错能力。

---

## 9. dialog_200 Candidate Competition Coverage

| Metric | Value |
|--------|------:|
| totalCases | 200 |
| completedCases | 200 |
| failedCases | 0 |
| casesWith1Candidate（含 raw 槽后） | 0 |
| casesWith2PlusCandidates | 200 |
| averageCandidateCount | 2.0 |
| maxCandidateCount | 2 |
| rawOnlyCases（comboCount=0） | 0 |
| **distinct alt text > Raw** | **0 / 200** |
| expectedCandidateAvailable | 200（因 Raw≡Expected） |

结论：dialog_200 **不能**作为 KenLM 排序能力基准；只能证明链路调用与 Raw 保全。

---

## 10. A/B/C Classification

### Definitions

| Class | Rule |
|-------|------|
| A | 正确文本不在 KenLM 输入 |
| B | 正确候选存在且 rank ≠ 1 |
| C | 正确候选 rank = 1 但 selected ≠ 正确 |
| PASS | 存在 ∧ rank=1 ∧ selected=正确 |

### dialog_200

| A | B | C | PASS |
|--:|--:|--:|-----:|
| 0 | 0 | 0 | 200 |

空通过：Expected=Raw 且 Top1=Raw。

### noise_inventory（真实噪声）

| A | B | C | PASS |
|--:|--:|--:|-----:|
| **7** | 0 | 0 | 0 |

**A 为主 → NOT A KENLM PROBLEM。**

---

## 11. Real Noise Case Results

来源：`kenlm_validation_case_inventory.csv` → 本轮 `kenlm_validation_case_inventory_resolved.csv`（**未覆盖**原文件）。

| caseId | noise → correct | expected in pool | class | selected |
|--------|-----------------|------------------|-------|----------|
| nn-train-01 | 我闷蒸在 → 我们正在 | **false** | **A** | 保留噪声 Raw |
| nn-train-01b | 闷蒸 → 正在 | **false** | **A** | 保留噪声 Raw |
| center-01 | 忠心 → 中心 | **false** | **A** | 保留噪声 Raw |
| snack-01 | 消失 → 小食 | **false** | **A** | 保留噪声 Raw |
| sync-01 | 已精通步 → 已经同步 | **false** | **A** | 保留噪声 Raw |
| trigger-01 | 出发 → 触发 | **false** | **A** | 保留噪声 Raw |
| threshold-01 | 阈之一 → 阈值 | **false** | **A** | 保留噪声 Raw |

无 `unknown` / `reserved` / `pending` 残留。  
历史 readiness 中“Top3 含正确句”**在本 Freeze 运行时未复现** → 归因为上游池，而非本轮 KenLM 未调用。

---

## 12. Score Implementation

代码：`kenlm-scorer.ts` · `rerank-fw-sentences.ts` · `lm-scorer.ts` · `char-tokenize.ts`

| Topic | Current truth |
|-------|----------------|
| Primary score | KenLM **Total log score**（越大越好，通常为负） |
| Pick 用分 | **raw log score**，非 normalized |
| Normalization | `normalizedScore = 1/(1+exp(-score/10))` **仅诊断** |
| 长度归一 | **无** per-token / per-char 归一化参与 pick |
| 预处理 | Raw/Candidate **同一** `tokenizeForLm`：NFKC、CJK 逐字、拉丁/数字连续、保留标点、丢弃其余 |
| 重复分词 | 无二次分词；每句一次 tokenize |
| OOV | query 输出 OOV count；**无显式 OOV penalty 进入 pick** |
| 长度偏置 | 未补偿；更长句 logTotal 通常更低（更负）——**OPTIMIZATION_CANDIDATE** |
| Tie-break | `sort: b.score - a.score \|\| b.deltaVsRaw - a.deltaVsRaw`；本探针全量 rank 用 `origIndex` 稳定次序 |
| Score 方向 | **越大越好** |

---

## 13. raw_log_delta Verification

冻结公式：

```text
deltaVsRaw = candidateKenlmScore - rawKenlmScore
```

与 `rerank-fw-sentences.ts` 一致。  
Gate：`bestRawDelta >= minDeltaToReplace (3.0)` 才替换；否则 `pickedIsRaw=true`。

本轮：

| Check | Result |
|-------|--------|
| Raw delta == 0 | **PASS**（全量） |
| Top1 vs selected 可能不同 | **是**（Gate 可挡 Top1） |
| C 类 Case | **0**（无正确候选进池，无法形成 C） |

---

## 14. Top1 vs Pick Analysis

dialog_200 / noise：池内无异文 → Top1 恒为 Raw（或与 Raw 同分的复制槽）→ Pick 保持 Raw。  
**未出现** “Top1=正确但 Gate 拒绝”的 C 类样本。

---

## 15. Model Provenance

| Field | Value |
|-------|-------|
| Training script | `kenLM/scripts/setup_and_train.sh` |
| Build | `lmplz -o 3 -S 50%` → `build_binary trie` |
| Corpus raw | `kenLM/corpus/zh_sentences.raw.txt` · **439,490** sentences |
| Char corpus | `kenLM/corpus/corpus.char.txt` (~76 MB) |
| Manifested vocab size | **UNAVAILABLE** |
| Pruning | **未在脚本显式 prune**（默认 lmplz） |
| Status | **MODEL_PROVENANCE_INCOMPLETE**（缺 checksums.txt / vocab 清单） |

不阻止能力基线；阻止“直接重训而不先补 provenance”。

---

## 16. Quality Metrics

| Metric | Definition | dialog_200 |
|--------|------------|------------:|
| Expected Candidate Availability Rate | expected ∈ pool / completed | **1.00**（Raw≡Expected） |
| Correct Top1 Rate among available | expectedRank=1 / available | **1.00** |
| Correct Top3 Rate among available | expectedRank≤3 / available | **1.00** |
| Final Selection Accuracy among available | selected=expected / available | **1.00** |
| Raw Preservation Accuracy | selected=raw \| raw≡expected | **1.00** |
| Wrong Replacement Rate | selected∉{raw,expected} / completed | **0.00** |
| Missed Correction Rate | raw≠expected ∧ selected≠expected / completed | **0.00**（dialog 无 raw≠expected） |
| Score Tie Rate | 同分候选 Case 比 | **1.00**（Raw 与复制槽） |
| Avg Top1 Margin | top1−top2 | **0** |
| Avg Correct-vs-Raw Delta | expectedScore−rawScore | **0** |

噪声套件：Availability **0/7** → Missed Correction **7/7**（上游）。

---

## 17. Performance Metrics

| Metric | p50 | p95 | max |
|--------|----:|----:|----:|
| Pre-KenLM (orch) ms | 55 | 96 | 120 |
| **KenLM-only** ms | **654** | **691** | **704** |
| Total post (pre+kenlm) ms | 707 | 764 | 797 |

| Note | |
|------|--|
| Subprocess startup | WSL + 模型装载；预热后单句 ~0.5–0.7s |
| Per-candidate | 与 batch 同行；本轮每 Case 实际 2 行 stdin |
| Process reuse | 无；每 batch 新进程 |
| Model RSS（smoke） | RSSMax ~38 MB |
| Double scoreBatch | 探针为导出+生产 pick 各一次；生产路径通常一次 |

---

## 18. Failure Pattern Clusters

1. **POOL_COLLAPSE_TO_RAW** — CrossPath 输出仅 Raw 同文（dialog+noise）  
2. **A_NOISE_ALL** — 真实噪声正确句 0 进入 KenLM  
3. **DIALOG200_NOT_DISCRIMINATIVE** — Raw≡Expected，不能测纠错  
4. **VACUOUS_PASS** — dialog PASS 不代表 KenLM 排序强  

---

## 19. Optimization Candidates（记录 only · 未实施）

| ID | Candidate | Class |
|----|-----------|-------|
| OC1 | 上游异文句进入 KenLM 池（Coverage） | **必做优先** |
| OC2 | 构建 raw≠expected 的噪声评测集 | 评测 |
| OC3 | Windows native `query.exe` / 常驻 scorer | 性能 |
| OC4 | 长度归一 / OOV 显式项 | 模型侧（B 就绪后） |
| OC5 | Gate 3.0 是否过严 | 仅当出现 C 类后 |

---

## 20. Recommended Next Phase

```text
KENLM_BASELINE_COMPLETE_UPSTREAM_BLOCKED
→ Candidate Coverage Audit（Recall / Lattice / Assembly / CrossPath）
→ 禁止此时优化 KenLM 模型 / 语料 / Gate
```

仅当异文正确候选稳定进入 KenLM 输入后，才允许进入 Model Optimization 或 Gate Audit。

---

## 21. Target List

| ID | Status |
|----|--------|
| T1 Real scorer | **DONE** |
| T2 Model path/checksum/order | **DONE** |
| T3 Case×Candidate export | **DONE** |
| T4 Raw unique | **DONE** |
| T5 Raw delta=0 | **DONE** |
| T6 score/delta/rank | **DONE** |
| T7 Top1/Top3/Pick | **DONE** |
| T8 minDeltaToReplace | **DONE** (=3.0) |
| T9 dialog_200 + real KenLM | **DONE** |
| T10 Candidate counts | **DONE** |
| T11 Raw-only distinction | **DONE**（实质无异文） |
| T12 Availability | **DONE** |
| T13 A/B/C | **DONE** |
| T14 Noise resolve | **DONE** |
| T15 no unknown inventory | **DONE** |
| T16–T18 score/OOV/tie | **DONE** |
| T19 KenLM-only latency | **DONE** |
| T20–T23 quality rates | **DONE** |
| T24 no model/threshold change | **DONE** |
| T25 next priority unique | **DONE** = Upstream |
| T26 relative to freeze | **DONE** |

---

## 22. Check List

```text
[x] Baseline = FW_V4_FREEZE_2026_08_03
[x] 未修改 Framework / Lexicon / 模型 / 阈值 / TopK
[x] 已证明真实 KenLM 调用
[x] 已生成候选级导出
[x] 已验证 Raw 身份
[x] 已运行 dialog_200 全量真实 KenLM
[x] 已统计候选竞争覆盖（结论：无异文竞争）
[x] 已完成 A/B/C
[x] 已解析真实噪声对
[x] 已记录 Score 公式与 raw_log_delta
[x] 已记录模型身份与 provenance 缺口
[x] 已计算质量与性能指标
[x] 已生成报告与 CSV
```

---

## 23. Final Verdict

```text
KENLM_BASELINE_COMPLETE_UPSTREAM_BLOCKED

主要问题属于 A 类：
正确候选未进入 KenLM 输入。

当前不应优化 KenLM，
必须先定位 Recall / Assembly / CrossPath Candidate Coverage。
```
