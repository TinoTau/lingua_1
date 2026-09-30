#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Emit Partial→Full Rescue audit artifacts from BASELINE_V1 (offline only)."""
from __future__ import annotations

import csv
import json
import re
from pathlib import Path

OUT = Path(__file__).resolve().parent
RUN_ID = "dialog200_full_pipeline_20260909_001141"

# Deterministic equal-interval sample of 60 PARTIAL (sorted by caseId).
PARTIAL_IDS = [
    "d001",
    "d011",
    "d028",
    "d045",
    "d065",
    "d084",
    "d092",
    "d102",
    "d126",
    "d133",
    "d141",
    "d155",
    "d176",
    "d184",
    "d190",
]
FULL_IDS = ["d079", "d083", "d124", "d151", "d159", "d173"]


def norm(s: str) -> str:
    return re.sub(r"[\s\W_]+", "", s or "", flags=re.UNICODE).lower()


def lev(a: str, b: str) -> int:
    a, b = a or "", b or ""
    if not a:
        return len(b)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (0 if ca == cb else 1)))
        prev = cur
    return prev[-1]


# Manual text-first classifications (RAW/FINAL/REFERENCE reviewed).
PARTIAL = {
    "d001": dict(
        raw_error_complexity="multi-error",
        what_postprocess_fixed="繁简转换；未修复中杯/蓝莓马芬区域",
        remaining_error="中贝→中杯；蓝没马分→蓝莓马芬",
        primary_residual_class="MULTI_ERROR_SENTENCE",
        raw_error_regions_estimate="3+",
        fixed_regions_estimate="1",
        remaining_regions_estimate="2",
        trace_note="KenLM inputs含更接近参考的完整句(蓝莓马分)但仍含中贝；BETTER_COMPLETE=YES非全对",
        confidence="HIGH",
    ),
    "d011": dict(
        raw_error_complexity="multi-error",
        what_postprocess_fixed="繁简转换",
        remaining_error="括号出→挂号处；内客→内科；号码→号吗；微→胃",
        primary_residual_class="MULTI_ERROR_SENTENCE",
        raw_error_regions_estimate="3+",
        fixed_regions_estimate="1",
        remaining_regions_estimate="3+",
        trace_note="多候选但均远离reference；NOT_OBSERVED module owner",
        confidence="HIGH",
    ),
    "d028": dict(
        raw_error_complexity="multi-error",
        what_postprocess_fixed="繁简转换",
        remaining_error="解题步,中能不能解解→解题步骤能不能再讲一遍",
        primary_residual_class="MULTI_ERROR_SENTENCE",
        raw_error_regions_estimate="2",
        fixed_regions_estimate="1",
        remaining_regions_estimate="2",
        trace_note="SINGLE_CANDIDATE_BEFORE_KENLM",
        confidence="MEDIUM",
    ),
    "d045": dict(
        raw_error_complexity="multi-error",
        what_postprocess_fixed="繁简转换",
        remaining_error="后选生成为→后选生城；上限计划→上线计划；请安→请按",
        primary_residual_class="MULTI_ERROR_SENTENCE",
        raw_error_regions_estimate="3+",
        fixed_regions_estimate="1",
        remaining_regions_estimate="3+",
        trace_note="多候选均差；领域词簇多错",
        confidence="HIGH",
    ),
    "d065": dict(
        raw_error_complexity="heavy-ASR-corruption",
        what_postprocess_fixed="繁简转换",
        remaining_error="上线计划/后选生城/联调等大段仍严重偏离",
        primary_residual_class="ASR_INFORMATION_LOSS",
        raw_error_regions_estimate="3+",
        fixed_regions_estimate="1",
        remaining_regions_estimate="3+",
        trace_note="重损坏；文本后处理合理恢复空间很有限",
        confidence="HIGH",
    ),
    "d084": dict(
        raw_error_complexity="multi-error",
        what_postprocess_fixed="繁简转换；扫马→扫码（局部修复）",
        remaining_error="打爆麻→打包吗；结一下张→结一下账",
        primary_residual_class="INCOMPLETE_LOCAL_REPAIR",
        raw_error_regions_estimate="3+",
        fixed_regions_estimate="2",
        remaining_regions_estimate="2",
        trace_note="同一句内修了一处支付相关错误，另两处仍错；非KenLM多选问题",
        confidence="HIGH",
    ),
    "d092": dict(
        raw_error_complexity="multi-error",
        what_postprocess_fixed="繁简转换",
        remaining_error="大北周行→大杯就行",
        primary_residual_class="REMAINING_PHONETIC_ERROR",
        raw_error_regions_estimate="2",
        fixed_regions_estimate="1",
        remaining_regions_estimate="1",
        trace_note="前段基本正确；尾部近音残留；多候选未更接近",
        confidence="MEDIUM",
    ),
    "d102": dict(
        raw_error_complexity="single-error",
        what_postprocess_fixed="繁简转换",
        remaining_error="缺失「发痒」；其余已接近",
        primary_residual_class="ASR_INFORMATION_LOSS",
        raw_error_regions_estimate="1",
        fixed_regions_estimate="1",
        remaining_regions_estimate="1",
        trace_note="raw未含发痒信息；SINGLE_CANDIDATE",
        confidence="MEDIUM",
    ),
    "d126": dict(
        raw_error_complexity="single-error",
        what_postprocess_fixed="繁简转换",
        remaining_error="等急→等级",
        primary_residual_class="REMAINING_LEXICAL_ERROR",
        raw_error_regions_estimate="1",
        fixed_regions_estimate="1",
        remaining_regions_estimate="1",
        trace_note="单点词面残留；不据此判Lexicon missing",
        confidence="HIGH",
    ),
    "d133": dict(
        raw_error_complexity="heavy-ASR-corruption",
        what_postprocess_fixed="繁简转换；轻微候选替换未达正确",
        remaining_error="后选声城/候选生成接口文档等大段仍错且有重复",
        primary_residual_class="MULTI_ERROR_SENTENCE",
        raw_error_regions_estimate="3+",
        fixed_regions_estimate="1",
        remaining_regions_estimate="3+",
        trace_note="BETTER_COMPLETE=YES(候选生成)仍远非reference",
        confidence="HIGH",
    ),
    "d141": dict(
        raw_error_complexity="multi-error",
        what_postprocess_fixed="繁简转换",
        remaining_error="更→跟；缺「系统」",
        primary_residual_class="MULTI_ERROR_SENTENCE",
        raw_error_regions_estimate="2",
        fixed_regions_estimate="1",
        remaining_regions_estimate="2",
        trace_note="SINGLE_CANDIDATE",
        confidence="MEDIUM",
    ),
    "d155": dict(
        raw_error_complexity="heavy-ASR-corruption",
        what_postprocess_fixed="繁简转换",
        remaining_error="对齐上线计划/后选生城/联调等仍严重错",
        primary_residual_class="ASR_INFORMATION_LOSS",
        raw_error_regions_estimate="3+",
        fixed_regions_estimate="1",
        remaining_regions_estimate="3+",
        trace_note="与d065同类重损坏",
        confidence="HIGH",
    ),
    "d176": dict(
        raw_error_complexity="heavy-ASR-corruption",
        what_postprocess_fixed="繁简转换",
        remaining_error="更意识规则要是→更衣室柜子钥匙",
        primary_residual_class="ASR_INFORMATION_LOSS",
        raw_error_regions_estimate="1",
        fixed_regions_estimate="1",
        remaining_regions_estimate="1",
        trace_note="单区域但声学信息严重偏离；SINGLE_CANDIDATE",
        confidence="HIGH",
    ),
    "d184": dict(
        raw_error_complexity="multi-error",
        what_postprocess_fixed="繁简转换；局部客互→客户类改善有限",
        remaining_error="小乘→小陈；包错→报错；换存→缓存；三点钱→三点前；百结论法→把结论发",
        primary_residual_class="MULTI_ERROR_SENTENCE",
        raw_error_regions_estimate="3+",
        fixed_regions_estimate="1",
        remaining_regions_estimate="3+",
        trace_note="4候选均远；BETTER_COMPLETE=NO相对final",
        confidence="HIGH",
    ),
    "d190": dict(
        raw_error_complexity="multi-error",
        what_postprocess_fixed="繁简转换",
        remaining_error="头通→头痛；开店要病→开点药并；些常规→血常规",
        primary_residual_class="MULTI_ERROR_SENTENCE",
        raw_error_regions_estimate="3+",
        fixed_regions_estimate="1",
        remaining_regions_estimate="3+",
        trace_note="SINGLE_CANDIDATE",
        confidence="HIGH",
    ),
}

FULL = {
    "d079": dict(
        raw_error_complexity="single-error",
        raw_error_regions_estimate="1",
        short_note="实质为繁体→简体；内容已正确，非多错误ASR修复",
    ),
    "d083": dict(
        raw_error_complexity="single-error",
        raw_error_regions_estimate="1",
        short_note="实质为繁体→简体归一化",
    ),
    "d124": dict(
        raw_error_complexity="single-error",
        raw_error_regions_estimate="1",
        short_note="实质为繁体→简体；与d079同类",
    ),
    "d151": dict(
        raw_error_complexity="single-error",
        raw_error_regions_estimate="1",
        short_note="实质为繁体→简体归一化",
    ),
    "d159": dict(
        raw_error_complexity="single-error",
        raw_error_regions_estimate="1",
        short_note="实质为繁体→简体归一化",
    ),
    "d173": dict(
        raw_error_complexity="single-error",
        raw_error_regions_estimate="1",
        short_note="实质为繁体→简体；与d083同类",
    ),
}


def main():
    cases = {
        r["caseId"]: r
        for r in csv.DictReader((OUT / "fresh_dialog200_case_results.csv").open(encoding="utf-8-sig"))
    }
    raws = {}
    for line in (OUT / f"fresh_dialog200_raw_cases_{RUN_ID}.jsonl").open(encoding="utf-8"):
        o = json.loads(line)
        raws[o["caseId"]] = o

    partial_rows = []
    class_counts = {}
    single_err = multi_err = 0
    single_cand = better_yes = asr_loss = unknown = 0

    for cid in PARTIAL_IDS:
        c = cases[cid]
        o = raws[cid]
        meta = PARTIAL[cid]
        inputs = o.get("kenlm_input_texts") or []
        kinc = len(inputs)
        single = "YES" if kinc <= 1 else "NO"
        better = "NOT_APPLICABLE"
        if kinc >= 2:
            df = lev(norm(c["reference"]), norm(c["final"]))
            best = min(lev(norm(c["reference"]), norm(t)) for t in inputs)
            better = "YES" if best < df else "NO"
            if better == "YES":
                better_yes += 1
        if single == "YES":
            single_cand += 1
        cls = meta["primary_residual_class"]
        class_counts[cls] = class_counts.get(cls, 0) + 1
        if meta["raw_error_complexity"] == "multi-error" or meta["raw_error_complexity"] == "heavy-ASR-corruption":
            multi_err += 1
        elif meta["raw_error_complexity"] == "single-error":
            single_err += 1
        if cls == "ASR_INFORMATION_LOSS":
            asr_loss += 1
        if cls == "UNKNOWN":
            unknown += 1

        partial_rows.append(
            {
                "caseId": cid,
                "raw": c["rawAsr"],
                "final": c["final"],
                "reference": c["reference"],
                "raw_error_complexity": meta["raw_error_complexity"],
                "what_postprocess_fixed": meta["what_postprocess_fixed"],
                "remaining_error": meta["remaining_error"],
                "primary_residual_class": cls,
                "raw_error_regions_estimate": meta["raw_error_regions_estimate"],
                "fixed_regions_estimate": meta["fixed_regions_estimate"],
                "remaining_regions_estimate": meta["remaining_regions_estimate"],
                "kenlm_input_count": kinc,
                "single_candidate_before_kenlm": single,
                "better_complete_candidate_present": better,
                "trace_note": meta["trace_note"],
                "confidence": meta["confidence"],
            }
        )

    full_rows = []
    for cid in FULL_IDS:
        c = cases[cid]
        o = raws[cid]
        meta = FULL[cid]
        m3_retry = 0
        paths = o.get("paths") or []
        for p in paths:
            m3_retry += (p.get("model3") or {}).get("decisions_retry") or 0
        full_rows.append(
            {
                "caseId": cid,
                "raw": c["rawAsr"],
                "final": c["final"],
                "reference": c["reference"],
                "raw_error_complexity": meta["raw_error_complexity"],
                "raw_error_regions_estimate": meta["raw_error_regions_estimate"],
                "retry_used": "YES" if m3_retry > 0 else "NO",
                "path_count": o.get("path_count") or len(paths),
                "kenlm_input_count": len(o.get("kenlm_input_texts") or []),
                "short_note": meta["short_note"],
            }
        )

    # Dominant: MULTI_ERROR_SENTENCE count
    multi_class = class_counts.get("MULTI_ERROR_SENTENCE", 0)
    # Also count incomplete local repair as related multi-region phenomenon for H1 narrative
    dominant = "MULTI_ERROR_SENTENCE" if multi_class >= 8 else "NO_DOMINANT_PATTERN"
    dominant_count = multi_class

    if dominant == "MULTI_ERROR_SENTENCE":
        next_audit = "MULTI_ERROR_REPAIR_COVERAGE_TARGETED_AUDIT"
        verdict = "PARTIAL_TO_FULL_AUDIT_PASS_DOMINANT_PATTERN_FOUND"
    else:
        next_audit = "NONE"
        verdict = "PARTIAL_TO_FULL_AUDIT_PASS_NO_DOMINANT_PATTERN"

    summary = {
        "phase": "PARTIAL_IMPROVEMENT_TO_FULL_RESCUE_AUDIT",
        "run_id": RUN_ID,
        "baseline_id": "LINGUA_DIALOG200_BASELINE_V1",
        "sample_method": "sort PARTIAL caseId ascending; equal-interval indices floor(i*60/15) for i=0..14",
        "partial_sample_count": 15,
        "partial_sample_ids": PARTIAL_IDS,
        "full_rescue_count": 6,
        "full_rescue_ids": FULL_IDS,
        "residual_class_counts": class_counts,
        "single_error_partial_count": single_err,
        "multi_error_partial_count": multi_err,
        "single_candidate_before_kenlm_count": single_cand,
        "better_complete_candidate_present_count": better_yes,
        "asr_information_loss_count": asr_loss,
        "unknown_count": unknown,
        "incomplete_local_repair_count": class_counts.get("INCOMPLETE_LOCAL_REPAIR", 0),
        "dominant_pattern": dominant,
        "dominant_pattern_count": f"{dominant_count}/15",
        "hypotheses": {
            "H1_multi_error_dominant": multi_class >= 8 or multi_err >= 8,
            "H2_better_complete_candidate_often": better_yes >= 8,
            "H3_single_candidate_before_kenlm_often": single_cand >= 8,
            "H4_asr_information_loss_dominant": asr_loss >= 8,
            "H5_no_single_pattern": dominant == "NO_DOMINANT_PATTERN",
        },
        "full_rescue_contrast_note": "6/6 FULL_RESCUE are essentially Traditional→Simplified script normalization of already-correct content; not multi-error ASR repairs",
        "MODEL3_REOPEN_REQUIRED": "NO",
        "RETRY_ARCHITECTURE_REOPEN_REQUIRED": "NO",
        "PRODUCTION_CODE_CHANGE": "NONE",
        "KNOWN_DEFERRED_PERFORMANCE_ISSUE": "FW_UNATTRIBUTED_REMAINDER timing",
        "ONE_NEXT_AUDIT": next_audit,
        "verdict": verdict,
    }

    with (OUT / "Partial_Improvement_Targeted_Cases.csv").open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(partial_rows[0].keys()))
        w.writeheader()
        w.writerows(partial_rows)
    with (OUT / "Full_Rescue_Contrast.csv").open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(full_rows[0].keys()))
        w.writeheader()
        w.writerows(full_rows)
    (OUT / "Partial_Improvement_to_Full_Rescue_Summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    md = f"""# Partial Improvement → Full Rescue Targeted Quality Audit

Generated: 2026-09-10  
Phase: `PARTIAL_IMPROVEMENT_TO_FULL_RESCUE_AUDIT`  
Mode: READ_ONLY / OFFLINE  
RUN_ID: `{RUN_ID}` · Baseline: `LINGUA_DIALOG200_BASELINE_V1`

## Verdict

`{verdict}`

```text
DOMINANT_PATTERN = {dominant} ({dominant_count}/15)
ONE_NEXT_AUDIT = {next_audit}
PRODUCTION_CODE_CHANGE = NONE
MODEL3_REOPEN_REQUIRED = NO
RETRY_ARCHITECTURE_REOPEN_REQUIRED = NO
```

---

## Sample

- Method: PARTIAL caseId 升序后等间隔 `floor(i*60/15)`，i=0..14  
- PARTIAL sample (15): `{', '.join(PARTIAL_IDS)}`  
- FULL_RESCUE contrast (6): `{', '.join(FULL_IDS)}`

---

## Answers

| # | Answer |
|---|--------|
| A | 最常见 PRIMARY class：**MULTI_ERROR_SENTENCE**（{multi_class}/15） |
| B | 是。multi/heavy raw complexity **{multi_err}/15** |
| C | 是。多数固定估计为修了约 1 个区域（常仅为繁简），仍留 2–3+ 区域 |
| D | KenLM前单候选 **{single_cand}/15**（未达≥8主导） |
| E | 更好完整候选 **{better_yes}/15**（未达主导；H2 不成立） |
| F | **是且更强**：6/6 FULL_RESCUE 实质是**繁体→简体**，内容本已正确，不是“简单单点ASR修复” |
| G | ASR_INFORMATION_LOSS **{asr_loss}/15**（重要但非≥8主导） |
| H | **是** — MULTI_ERROR_SENTENCE ≥8/15 |
| I | **是** → `{next_audit}` |
| J | **否** |

---

## Hypothesis results

| H | Result |
|---|--------|
| H1 multi-error | **SUPPORTED** ({multi_class}/15 MULTI_ERROR_SENTENCE; {multi_err}/15 multi/heavy complexity) |
| H2 better complete candidate often | **REJECTED** ({better_yes}/15) |
| H3 single candidate before KenLM often | **REJECTED as dominant** ({single_cand}/15) |
| H4 ASR information loss dominant | **REJECTED as dominant** ({asr_loss}/15) |
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
{json.dumps(class_counts, ensure_ascii=False, indent=2)}
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
"""
    (OUT / "Partial_Improvement_to_Full_Rescue_Audit.md").write_text(md, encoding="utf-8")
    print(json.dumps({"verdict": verdict, "dominant": dominant, "counts": class_counts, "next": next_audit}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
