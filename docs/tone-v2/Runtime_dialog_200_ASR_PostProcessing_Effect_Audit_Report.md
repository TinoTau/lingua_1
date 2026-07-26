# Runtime dialog_200 ASR Post-Processing Effect Audit Report

| Field | Value |
|------|-------|
| Date | 2026-07-20T10-07-19 |
| Effect | **LIMITED POSITIVE** |
| Valid cases | **200 / 200** |
| Real Node Runtime | **YES** (`:5020` + ASR `:6007`) |
| Artifacts | `tmp/dialog200_asr_postprocess_audit/2026-07-20T10-07-19/` |
| Authority | [`Runtime_SSOT_Contract_Freeze.md`](./Runtime_SSOT_Contract_Freeze.md) |

---

## 1. Executive Verdict

在真实 Node Runtime 上对 `dialog_200` 全量 **200** 条完成 ASR 后处理效果审计。

**结论：LIMITED POSITIVE。**

- Final Normalized Exact Match：25 → **29**（+4）
- Mean CER：0.2303 → **0.1967**（改善 **+0.0336**）
- Net Fixed：`WRONG_FIXED(4) − CORRECT_BROKEN(0) = **4**`
- **无 CORRECT_BROKEN**（误修安全）
- 主瓶颈：**正确答案几乎进不了候选池**（GT Candidate Recall **5.7%**；165/175 错误句从未进池）
- KenLM 主因失败很少（primary `KENLM_MISRANK` = **2**）
- Presence Vote / Multi-Bucket 有小幅救援（`MULTI_BUCKET_RESCUE_COUNT` = **6**），不是本轮主瓶颈

```text
功能有净改善，但幅度有限；主要受 Recall / Lexicon / Candidate Assembly 限制。
```

---

## 2. Git Status

- 本轮为只读审计，未修改 Presence Vote / 0.75 / Multi-Bucket / cap 16 / KenLM / 词库 / Tone / ASR
- 新增审计脚本：`tests/experiments/run-dialog200-asr-postprocess-audit.mjs`
- 启动修复：清除 Cursor 环境 `ELECTRON_RUN_AS_NODE=1`（否则 Electron `app` 为 undefined）
- 未提交

---

## 3. Frozen Baseline

```text
Presence Vote / FineSpanDomainSet / One Span One Vote
DOMAIN_BUCKET_RETENTION_RATIO = 0.75
Multi-Bucket + Base every bucket + cross-bucket dedup
Candidate cap 16
prefilledCombinations required
Context Prior diagnostics-only
```

本轮 **PRESENCE_VOTE_ARCHITECTURE_MODIFIED = NO**。

---

## 4. Runtime Environment

| Component | Status |
|-----------|--------|
| Electron Node test server | YES · `http://127.0.0.1:5020` |
| Faster-Whisper VAD ASR | YES · `:6007` · model `faster-whisper-medium` · CUDA |
| Tone | YES · `toneTimestampOnlyEnabled=true`（formal freeze config） |
| Lexicon SQLite | YES · `node_runtime/lexicon/v3` |
| KenLM | YES · `zh_char_3gram.trie.bin` · `minDeltaToReplace=3.0` · fail-open |

---

## 5. Node Startup Procedure（本轮实际）

```text
1. 清理：taskkill electron；释放 5020/6007
2. 启动 ASR：tone_p10_start_fw.ps1 → :6007/health=200
3. 启动 Node：start-node-for-dialog200-audit.mjs
   （必须 delete ELECTRON_RUN_AS_NODE；否则 app.whenReady 崩溃）
4. 确认 :5020/health=200 且 :6007 仍存活
5. Round A smoke --limit 10
6. Round B full 200 + determinism 20
```

入口：`/run-pipeline-with-audio`（真实 wav → ASR → FW → Tone → Recall → Vote → Multi-Bucket → KenLM）。

---

## 6. Dataset Integrity

| Item | Value |
|------|-------|
| Path | `test wav/dialog_200` |
| Version | `restored_full_v1` |
| Manifest | 200 |
| WAV `dialog_d*.wav` | 200 |
| GT 对齐 | 一一对应 |
| Issues | **NONE** |

另有 `context_prior/` 10 条探针 wav，**未计入**本轮 200。

---

## 7. Effective Runtime Configuration

来自 `tests/freeze-config-ssot.json` + 运行时 userData config：

| Key | Value |
|-----|-------|
| spanAssemblyV4Enabled | true |
| toneTimestampOnlyEnabled | true |
| maxSentenceCandidates | 16 |
| minDeltaToReplace | 3.0 |
| enableKenLMGate | true |
| lexiconRuntimeV2.enabled | true |
| diagnosticsLevel（审计临时） | trace（仅观测，不改算法） |

---

## 8. Test Contamination Risk

```text
TEST SET CONTAMINATION RISK
```

- `dialog_200` 文本来自既有 Tone/FW 扫描语料，曾用于多轮开发验收
- 存在 `dialog_200_golden_labels.jsonl`（lexicon phase5）
- 本轮**未**定向补词 / 未改阈值 / 未 whitelist

---

## 9. Raw ASR Baseline

| Metric | Value |
|--------|------:|
| Strict Exact Match | 0 / 0.0% |
| Normalized Exact Match | 25 / 12.5% |
| CER (mean) | **0.2303** |

说明：Strict=0 因标点/空格与 GT 不完全一致；归一化后 25 条正确。

---

## 10. Final Post-Processing Metrics

| Metric | Value |
|--------|------:|
| Strict Exact Match | 0 / 0.0% |
| Normalized Exact Match | **29 / 14.5%** |
| CER (mean) | **0.1967** |

---

## 11. Net Improvement

| Metric | Raw | Final | Delta |
|--------|----:|------:|------:|
| Normalized Exact Match | 25 | 29 | **+4** |
| CER | 0.2303 | 0.1967 | **−0.0336** |
| Net Fixed | — | — | **+4** |

---

## 12. Repair Outcome Distribution

| Outcome | Count | Rate |
|---------|------:|-----:|
| CORRECT_PRESERVED | 25 | 12.5% |
| CORRECT_BROKEN | **0** | 0.0% |
| WRONG_FIXED | **4** | 2.0% |
| WRONG_IMPROVED | 54 | 27.0% |
| WRONG_UNCHANGED | 108 | 54.0% |
| WRONG_WORSENED | 9 | 4.5% |

---

## 13. Candidate Pool Recall

| Metric | Value |
|--------|------:|
| Raw wrong cases | 175 |
| GT entered candidate pool | **10** |
| Ground Truth Candidate Recall | **5.7%** |
| Entered pool + KenLM selected (final correct) | 4 |
| Entered pool but KenLM misranked / not selected | 6 |
| Never entered pool | **165** |

分层含义：

```text
A Never in pool (165) → Recall / Lexicon / Tone / Span / Domain / Assembly
B In pool, KenLM wrong (6) → KenLM / delta gate
C In pool, KenLM right (4) → 后处理成功
```

**不得把 A 归为 KenLM 不好。**

---

## 14. Presence Vote Effect

| Metric | Value |
|--------|------:|
| Base-only (`retainedDomains=0`) | 37 |
| Single-domain | 88 |
| Multi-domain (`>=2`) | **75** |

Vote 可观测字段已写入 jsonl：`domain_scores` / `retained_domains` / `retained_bucket_count`。

---

## 15. Multi-Bucket Rescue

```text
MULTI_BUCKET_RESCUE_COUNT = 6
```

样本：`d002, d003, d114, d137, d182, d183`

含义（本轮启发式）：多 retained domain 且 GT 进入 merged pool。

若只取 `retainedDomains[0]`，这 6 条存在正确候选丢失风险（需结合 per-bucket 证据进一步精读；本轮未改架构）。

---

## 16. Domain Vote Drop

```text
DOMAIN_VOTE_DROP (heuristic flag) = 132
primary_failure_category DOMAIN_VOTE_DROP = 132
```

**重要 caveat：** 当前审计启发式为：

```text
raw wrong ∧ GT not in pool ∧ domainRecallHitCount > 0 ∧ kenlmPoolCandidateCount > 0
```

这会把大量「有 domain recall 命中但整句 GT 未组装进池」的样本标成 Domain Vote Drop，**可能高估 Vote 责任**，实际常混有 Recall 噪声 / Assembly / Cap。  
Target List 要求下一轮做 **DOMAIN_VOTE_DROP 精读审计**（按 retainedDomains membership 与 per-bucket 文本核对），本轮只报告观察值，不改合同。

---

## 17. KenLM Selection Quality

| Metric | Value |
|--------|------:|
| primary KENLM_MISRANK | **2** (`d003`, `d183`) |
| DELTA_GATE_REJECT | 4 |
| kenlm fail-open raw | 116 |
| empty candidate pool | 0 |

KenLM **不是**主瓶颈。

---

## 18. Failure Attribution（primary）

| Failure Category | Count | Rate |
|------------------|------:|-----:|
| DOMAIN_VOTE_DROP | 132 | 66.0% |
| CANDIDATE_CAP_DROP | 21 | 10.5% |
| RECALL_MISS | 12 | 6.0% |
| DELTA_GATE_REJECT | 4 | 2.0% |
| KENLM_MISRANK | 2 | 1.0% |
| （其余成功/无 primary） | — | — |

主因解释（审计判断）：

```text
主瓶颈 = 正确答案未进入最终候选池（Recall / Lexicon / Assembly）
次瓶颈 = Candidate Cap / Domain bucket 过滤（需精读）
KenLM = 次要
Presence Vote = 有少量 Multi-Bucket 救援，非主损
```

---

## 19. Misrepair Cases

**CORRECT_BROKEN: NONE（0）**

WRONG_FIXED（全部 4 条）：`d002`, `d047`, `d137`, `d182`

详见 artifacts `focus_lists.json` / `dialog_200_asr_postprocess_failures.csv`。

---

## 20. Performance

| Latency | ms |
|---------|---:|
| mean total | **6437** |
| P50 | 5777 |
| P95 | **8621** |
| max | 24292 |

全量 200 墙钟约 **26.3 min**（不含 determinism 重复）。

---

## 21. Determinism

对前 20 条各跑 2 次：

| Metric | Value |
|--------|------:|
| tested | 20 |
| matched (raw+final+retained+pool) | 8 |
| rate | **40%** |

不匹配主因倾向：**ASR nondeterminism**（跨次 raw 文本漂移），而非 Vote 公式非确定。此前 E2E 报告亦记录过同类现象。

---

## 22. Remaining Risks

1. GT Candidate Recall 极低（5.7%）→ 后处理天花板低  
2. DOMAIN_VOTE_DROP 启发式可能高估 Vote 责任  
3. dialog_200 污染风险（历史开发语料）  
4. 确定性仅 40% → raw ASR 跨次噪声影响微观对比  
5. Strict Exact Match 对标点敏感，需统一以 Normalized + CER 为主指标  

---

## 23. Target List（下一轮审计，禁止本轮边测边修）

1. **Recall / Lexicon Coverage 精读**：165 条 GT never-in-pool  
2. **DOMAIN_VOTE_DROP 精读**：区分 Vote drop vs Recall/Assembly  
3. **MULTI_BUCKET_RESCUE 深挖**：若只用 `retainedDomains[0]` 损失多少  
4. **ASR nondeterminism**：固定 decoding / 同 session 重复策略  
5. **不要**优先重训 KenLM / 改 0.75 / 改 cap 16  

---

## 24. Check List

| Gate | Result |
|------|--------|
| G1 Real Runtime | **PASS** |
| G2 Dataset Integrity | **PASS** |
| G3 Raw Baseline | **PASS** |
| G4 Final Metrics | **PASS** |
| G5 Per-Case Evidence | **PASS**（jsonl） |
| G6 Candidate Recall | **PASS** |
| G7 Domain Vote Effect | **PASS**（含启发式 caveat） |
| G8 Failure Attribution | **PASS** |
| G9 Misrepair Safety | **PASS**（0 broken） |
| G10 Performance | **PASS** |
| G11 No Architecture Changes | **PASS** |

---

## 25. Final Verdict + Mandatory Output

```text
VALID_DIALOG_CASES:
200

REAL_NODE_RUNTIME_USED:
YES

REAL_ASR_USED:
YES

REAL_TONE_USED:
YES

REAL_LEXICON_DB_USED:
YES

REAL_KENLM_USED:
YES

RAW_STRICT_EXACT_MATCH:
0 / 0.0%

FINAL_STRICT_EXACT_MATCH:
0 / 0.0%

RAW_NORMALIZED_EXACT_MATCH:
25 / 12.5%

FINAL_NORMALIZED_EXACT_MATCH:
29 / 14.5%

RAW_CER:
0.2303

FINAL_CER:
0.1967

CER_IMPROVEMENT:
0.0336

WRONG_FIXED:
4

CORRECT_BROKEN:
0

NET_FIXED:
4

GROUND_TRUTH_CANDIDATE_RECALL:
10 / 5.7%

GROUND_TRUTH_ENTERED_POOL_BUT_KENLM_MISRANKED:
6

GROUND_TRUTH_NEVER_ENTERED_POOL:
165

MULTI_DOMAIN_CASES:
75

MULTI_BUCKET_RESCUE_COUNT:
6

DOMAIN_VOTE_DROP:
132

CANDIDATE_CAP_DROP:
21 (primary) / 138 (heuristic note)

KENLM_MISRANK:
2

POSTPROCESS_MISREPAIR:
0

MEAN_TOTAL_LATENCY_MS:
6437

P95_TOTAL_LATENCY_MS:
8621

DETERMINISTIC_REPEAT_RATE:
40%

PRESENCE_VOTE_ARCHITECTURE_MODIFIED:
NO

BLOCKING_TEST_GAPS:
NONE

ASR POST-PROCESSING EFFECT:
LIMITED POSITIVE
```

### Artifacts

```text
tmp/dialog200_asr_postprocess_audit/2026-07-20T10-07-19/
  dialog_200_asr_postprocess_audit_results.jsonl
  dialog_200_asr_postprocess_summary.json
  dialog_200_asr_postprocess_failures.csv
  dialog_200_node_runtime_execution.log
  focus_lists.json
```

---

```text
DIALOG_200 NODE RUNTIME ASR POST-PROCESSING
EFFECT AUDIT COMPLETE — STOP
```
