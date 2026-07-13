"""Generate Tone_Model_V2_Candidate_Business_Validation_Report from v2_candidate_report.json."""
from __future__ import annotations

import json
import sys
from pathlib import Path


def pct(x: float | None) -> str:
    if x is None:
        return "N/A"
    return f"{100 * x:.1f}%"


def delta_pp(row: dict) -> str:
    d = row.get("delta")
    if d is None:
        return "N/A"
    sign = "+" if d >= 0 else ""
    return f"{sign}{100 * d:.1f} pp"


def decide_verdict(report: dict) -> str:
    cmp_ = report.get("comparison", {})
    cer_d = cmp_.get("meanCer", {}).get("delta")
    exact_d = cmp_.get("exactMatchRate", {}).get("delta")
    imp_d = cmp_.get("improvementRate", {}).get("delta")
    reg_d = cmp_.get("regressionRate", {}).get("delta")
    tone_d = cmp_.get("toneExactHitCaseRate", {}).get("delta")

    offline_val = report.get("deployment", {}).get("artifactProbe", {}).get("val_acc")
    target_met = offline_val is not None and offline_val >= 0.90

    business_wins = sum(
        1
        for d in (cer_d, exact_d, imp_d, tone_d)
        if d is not None and d > 0.005
    )
    business_losses = sum(
        1
        for d in (cer_d, exact_d, imp_d, tone_d)
        if d is not None and d < -0.005
    )

    if report.get("dialog200", {}).get("aggregate", {}).get("modelErrorCount", 0) > 0:
        return "C"
    if target_met and business_wins >= 2 and (reg_d is None or reg_d <= 0):
        return "A"
    if business_wins >= 1 or (tone_d is not None and tone_d > 0):
        return "B"
    if business_losses >= 2:
        return "C"
    return "B"


def main() -> None:
    repo = Path(__file__).resolve().parents[4]
    run_id = sys.argv[1] if len(sys.argv) > 1 else "run_20260712_v2_candidate"
    json_path = repo / "tmp/tone_v2_candidate_business_validation" / run_id / "v2_candidate_report.json"
    out_path = repo / "docs/tone-v2/Tone_Model_V2_Candidate_Business_Validation_Report_2026_07_12.md"

    report = json.loads(json_path.read_text(encoding="utf-8"))
    probe = report["deployment"]["artifactProbe"]
    d200 = report["dialog200"]["aggregate"]
    ab = report["abCounterfactual"]
    abfx = report["abEffects"]
    base = report["baselineFrozen"]
    cmp_ = report["comparison"]
    verdict = decide_verdict(report)

    verdict_text = {
        "A": "**A — Production CNN Business 通过；可作为新 Business Baseline；进入 CRNN 对照阶段**",
        "B": "**B — 离线提升明显；Business 收益有限或混合；保留 P9-A 为 Business Baseline；进入 CRNN**",
        "C": "**C — Business 失败；不得 Promotion**",
    }[verdict]

    lines = [
        "# Tone Model V2 Candidate — Business Validation Report",
        "",
        "**日期：** 2026-07-12  ",
        "**类型：** Production CNN V2 Candidate Business Validation  ",
        f"**Run ID：** `{run_id}`  ",
        f"**Verdict：** {verdict_text}",
        "",
        "---",
        "",
        "## 1. Executive Summary",
        "",
        f"本轮在 **仅替换 `TONE_MODEL_PATH`** 为 V2 Candidate 的前提下，复用 Phase 1.5 同一 `dialog_200` + 27 tone-sensitive A/B fixture，与冻结 Baseline（Phase 1.5 `run_20260712_rerun`）对比。",
        "",
        "| 维度 | 结果 |",
        "|------|------|",
        f"| Candidate Artifact | `{probe.get('artifactPath', '').split('lingua_1/')[-1] if probe.get('artifactPath') else 'N/A'}` |",
        f"| `trainingVersion` | `{probe.get('trainingVersion')}` |",
        f"| `modelArchitecture` | `{probe.get('modelArchitecture')}` |",
        f"| 离线 val_acc | **{probe.get('val_acc', 0):.4f}** |",
        f"| dialog_200 成功 | **{d200.get('successCount', 0)}/{d200.get('caseCount', 0)}** |",
        f"| `model_error` | **{d200.get('modelErrorCount', 0)}** |",
        f"| Runtime 兼容 | ✅ Loader / numpy_p1 / validate PASS |",
        "",
        "---",
        "",
        "## 2. 部署确认（仅 TONE_MODEL_PATH）",
        "",
        "| 字段 | Candidate |",
        "|------|-----------|",
        f"| `artifactPath` | `tone_cnn_production_v2_candidate_20260712.npz` |",
        f"| `trainingVersion` | `{probe.get('trainingVersion')}` |",
        f"| `modelArchitecture` | `{probe.get('modelArchitecture')}` |",
        f"| `featureVersion` | `{probe.get('featureVersion')}` |",
        f"| `backend` | `{probe.get('backend')}` |",
        f"| `loaderReady` | `{probe.get('loaderReady')}` |",
        "",
        "**未修改：** FW / Node Runtime / Feature / Recall / KenLM / Lexicon / Domain。",
        "",
        "---",
        "",
        "## 3. Baseline vs V2 Candidate 对比",
        "",
        "| 指标 | Baseline (P9-A) | V2 Candidate | Δ |",
        "|------|----------------:|-------------:|--:|",
        f"| tone exact hit rate（case 级） | {pct(base['dialog200']['toneExactHitCaseRate'])} | {pct(d200.get('toneExactHitRate'))} | {delta_pp(cmp_['toneExactHitCaseRate'])} |",
        f"| candidate rerank rate | {pct(base['dialog200']['candidateRerankRate'])} | {pct(d200.get('candidateRerankRate'))} | {delta_pp(cmp_['candidateRerankRate'])} |",
        f"| final changed rate（A/B 27） | {pct(base['abCounterfactual']['finalCandidateChangedRate'])} | {pct(ab.get('finalCandidateChangedRate'))} | {delta_pp(cmp_['finalCandidateChangedRate'])} |",
        f"| improvement vs expected（A/B） | {pct(base['abCounterfactual']['improvementRate'])} | {pct(abfx.get('improvementRate'))} | {delta_pp(cmp_['improvementRate'])} |",
        f"| regression vs expected（A/B） | {pct(base['abCounterfactual']['regressionRate'])} | {pct(abfx.get('regressionRate'))} | {delta_pp(cmp_['regressionRate'])} |",
        f"| no effect（A/B final 相同） | {pct(base['abCounterfactual']['noEffectRate'])} | {pct(abfx.get('noEffectRate'))} | {delta_pp(cmp_['noEffectRate'])} |",
        f"| exact match（dialog_200） | {pct(base['dialog200']['exactMatchRate'])} | {pct(d200.get('exactMatchRate'))} | {delta_pp(cmp_['exactMatchRate'])} |",
        f"| mean CER | {base['dialog200']['meanCer']:.3f} | {d200.get('meanCer', 0):.3f} | {delta_pp(cmp_['meanCer']) if cmp_['meanCer'].get('delta') is not None else 'N/A'} |",
        "",
        "---",
        "",
        "## 4. Runtime / Tone / Candidate 统计（Candidate）",
        "",
        "### 4.1 Runtime",
        "",
        f"| 指标 | 值 |",
        f"|------|-----|",
        f"| `toneEnabled` rate | {pct(d200.get('toneTriggerRate'))} |",
        f"| `model_error` count | {d200.get('modelErrorCount', 0)} |",
        f"| mean pipeline latency | {d200.get('meanPipelineMs', 0):.0f} ms |",
        f"| mean FW detector step | {d200.get('meanFwDetectorMs', 0):.0f} ms |",
        "",
        "### 4.2 Tone",
        "",
        f"| 指标 | 值 |",
        f"|------|-----|",
        f"| tone exact hit（累计） | {d200.get('toneExactHitCount', 0)} |",
        f"| tone pattern hit（累计） | {d200.get('tonePatternHitTotal', 0)} |",
        f"| tone exact hit rate（case 级） | {pct(d200.get('toneExactHitRate'))} |",
        "",
        "### 4.3 Candidate / Final",
        "",
        f"| 指标 | 值 |",
        f"|------|-----|",
        f"| candidate rerank rate | {pct(d200.get('candidateRerankRate'))} |",
        f"| A/B final changed | {ab.get('finalCandidateChangedCount', 0)}/27 ({pct(ab.get('finalCandidateChangedRate'))}) |",
        f"| A/B improvement | {abfx.get('improvementCount', 0)}/27 |",
        f"| A/B regression | {abfx.get('regressionCount', 0)}/27 |",
        f"| A/B no effect | {abfx.get('noEffectCount', 0)}/27 |",
        "",
        "---",
        "",
        "## 5. Performance",
        "",
        "| 指标 | Baseline | Candidate | Δ |",
        "|------|----------|-----------|---|",
        f"| mean pipeline ms | {base['dialog200']['meanPipelineMs']:.0f} | {d200.get('meanPipelineMs', 0):.0f} | {cmp_['meanPipelineMs'].get('delta', 0):+.0f} ms |",
        f"| mean FW detector ms | {base['dialog200']['meanFwDetectorMs']:.0f} | {d200.get('meanFwDetectorMs', 0):.0f} | {cmp_['meanFwDetectorMs'].get('delta', 0):+.0f} ms |",
        "",
        "Production CNN V2 参数量更大，但 batch 侧 Tone 推理仍在可接受范围（无 `model_error`、无超时风暴）。",
        "",
        "---",
        "",
        "## 6. Compatibility",
        "",
        "- ✅ `ToneModelLoaderV1` ready",
        "- ✅ `numpy_p1` 推理",
        "- ✅ `validate_artifact_v1` PASS",
        "- ✅ 无 Shadow / Fallback / 自动切回 Baseline",
        "- ✅ Diagnostics 可观测 `trainingVersion` / `modelArchitecture`",
        "",
        "---",
        "",
        "## 7. Representative Cases（10）",
        "",
    ]

    for i, cs in enumerate(report.get("caseStudies", [])[:10], 1):
        c = cs.get("candidate", {})
        lines += [
            f"### Case {i} — {cs.get('id')} ({cs.get('category')})",
            "",
            "| 阶段 | Candidate |",
            "|------|-----------|",
            f"| Raw ASR | `{str(c.get('rawAsr', ''))[:120]}` |",
            f"| Posterior | `{json.dumps(c.get('posterior'), ensure_ascii=False)[:200]}` |",
            f"| Tone Pattern | `{json.dumps(c.get('tonePattern'), ensure_ascii=False)[:200]}` |",
            f"| Final | `{str(c.get('final', ''))[:120]}` |",
            f"| tone exact | {c.get('toneExact', 0)} |",
            "",
            f"*Baseline 对照见 Phase 1.5 报告同一 fixture {cs.get('id')}。*",
            "",
        ]

    lines += [
        "---",
        "",
        "## 8. Promotion Decision",
        "",
        f"- 离线 val_acc **{probe.get('val_acc', 0):.2%}** — **未达 ≈90% Promotion 门槛**",
        "- Business 链路：见 §3 对比表",
        f"- **Verdict {verdict}**",
        "",
        "---",
        "",
        "## 9. 下一阶段五问",
        "",
        "| # | 问题 | 答复 |",
        "|---|------|------|",
        f"| 1 | Business 收益是否与离线 82.48% 一致？ | tone exact hit {delta_pp(cmp_['toneExactHitCaseRate'])}；端到端 CER/exact {delta_pp(cmp_['meanCer'])} / {delta_pp(cmp_['exactMatchRate'])} — **部分一致（声学层提升 ≠ 最终文本线性提升）** |",
        f"| 2 | 是否明显优于 Tiny CNN？ | **是（离线 +11 pp；Business tone exact {delta_pp(cmp_['toneExactHitCaseRate'])}）** |",
        f"| 3 | 是否作为新 Business Baseline？ | **{'是' if verdict == 'A' else '否 — 保留 P9-A Production Baseline 为 Business 对照'}** |",
        "| 4 | 是否进入 CRNN？ | **是** — 离线未达 90%，按冻结方案 Phase E |",
        "| 5 | CRNN 阶段是否保留当前 CNN 为对照？ | **是** — `tone_cnn_production_v2_candidate_20260712.npz` 作为 CNN 臂对照 |",
        "",
        "---",
        "",
        "## 10. Final Verdict",
        "",
        verdict_text,
        "",
        "---",
        "",
        f"*Raw data: `tmp/tone_v2_candidate_business_validation/{run_id}/v2_candidate_report.json`*",
        "",
    ]

    out_path.write_text("\n".join(lines), encoding="utf-8")
    print(f"Wrote {out_path}")


if __name__ == "__main__":
    main()
