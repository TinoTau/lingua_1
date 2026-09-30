# Partial Improvement → Full Rescue Targeted Quality Audit

Generated: 2026-09-10  
Phase: `PARTIAL_IMPROVEMENT_TO_FULL_RESCUE_AUDIT`  
Mode: READ_ONLY / OFFLINE  
RUN_ID: `dialog200_full_pipeline_20260909_001141` · Baseline: `LINGUA_DIALOG200_BASELINE_V1`

## Verdict

`PARTIAL_TO_FULL_AUDIT_PASS_DOMINANT_PATTERN_FOUND`

```text
DOMINANT_PATTERN = MULTI_ERROR_SENTENCE (8/15)
ONE_NEXT_AUDIT = MULTI_ERROR_REPAIR_COVERAGE_TARGETED_AUDIT
PRODUCTION_CODE_CHANGE = NONE
MODEL3_REOPEN_REQUIRED = NO
RETRY_ARCHITECTURE_REOPEN_REQUIRED = NO
```

---

## Sample

- Method: PARTIAL caseId 升序后等间隔 `floor(i*60/15)`，i=0..14  
- PARTIAL sample (15): `d001, d011, d028, d045, d065, d084, d092, d102, d126, d133, d141, d155, d176, d184, d190`  
- FULL_RESCUE contrast (6): `d079, d083, d124, d151, d159, d173`

---

## Answers

| # | Answer |
|---|--------|
| A | 最常见 PRIMARY class：**MULTI_ERROR_SENTENCE**（8/15） |
| B | 是。multi/heavy raw complexity **13/15** |
| C | 是。多数固定估计为修了约 1 个区域（常仅为繁简），仍留 2–3+ 区域 |
| D | KenLM前单候选 **5/15**（未达≥8主导） |
| E | 更好完整候选 **2/15**（未达主导；H2 不成立） |
| F | **是且更强**：6/6 FULL_RESCUE 实质是**繁体→简体**，内容本已正确，不是“简单单点ASR修复” |
| G | ASR_INFORMATION_LOSS **4/15**（重要但非≥8主导） |
| H | **是** — MULTI_ERROR_SENTENCE ≥8/15 |
| I | **是** → `MULTI_ERROR_REPAIR_COVERAGE_TARGETED_AUDIT` |
| J | **否** |

---

## Hypothesis results

| H | Result |
|---|--------|
| H1 multi-error | **SUPPORTED** (8/15 MULTI_ERROR_SENTENCE; 13/15 multi/heavy complexity) |
| H2 better complete candidate often | **REJECTED** (2/15) |
| H3 single candidate before KenLM often | **REJECTED as dominant** (5/15) |
| H4 ASR information loss dominant | **REJECTED as dominant** (4/15) |
| H5 no single pattern | **REJECTED** |

---

## Critical contrast

FULL_RESCUE 并不证明“后处理擅长修好 single-error ASR”。  
对照 6 例显示：raw 已基本正确（繁体），final 主要做脚本归一化后与简体 reference exact match。

PARTIAL 样本则多为：**脚本归一化 + 至多局部一词修复后，仍剩多个独立错误区域**。

因此“为什么没变成 FULL_RESCUE”的主现象是：

```text
QUALITY_PHENOMENON =
multi-error sentences partially cleaned (often script-only)
while other error regions remain
```

不是已证明的 KenLM 选错主导，也不是 Model3/Retry 架构问题。

---

## Residual class counts

```json
{
  "MULTI_ERROR_SENTENCE": 8,
  "ASR_INFORMATION_LOSS": 4,
  "INCOMPLETE_LOCAL_REPAIR": 1,
  "REMAINING_PHONETIC_ERROR": 1,
  "REMAINING_LEXICAL_ERROR": 1
}
```

---

## Next step (audit only)

```text
MULTI_ERROR_REPAIR_COVERAGE_TARGETED_AUDIT
```

问：现有主链在**多错误句**上是否系统性地只覆盖部分区域？是否存在可在**不改冻结架构**下用 ONE Delta 提高第二/第三错误区域覆盖的机会？

仍禁止：新 detector / 新主链 / reopen Model3·Retry architecture。

---

## Deferred

`KNOWN_DEFERRED_PERFORMANCE_ISSUE` = FW_UNATTRIBUTED_REMAINDER timing（本轮不处理）
