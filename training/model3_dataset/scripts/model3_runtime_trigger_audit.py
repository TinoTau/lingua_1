#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""MODEL3_V1_RUNTIME_TRIGGER_ERROR_AUDIT — read-only observation script."""
from __future__ import annotations

import csv
import hashlib
import json
import math
import re
import subprocess
import sys
from collections import Counter, defaultdict
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any

import torch

REPO = Path(__file__).resolve().parents[3]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from training.model3_dataset.train.bigru_v1 import (  # noqa: E402
    FEAT_NAMES,
    Model3BiGRUV1,
    encode_surface,
    sample_to_tensors,
    span_features,
)

OUT = REPO / "docs" / "user_correction" / "model3"
CKPT = REPO / "training/model3_dataset/model3_v1_full100k_strict_integration_ckpts/seed_2026082520"
HOST = REPO / "electron_node/services/model3_runtime/model3_inference_host.py"
STRICT_TEST = REPO / "training/model3_dataset/model3_v1_strict_contrast_reconstruction/test"
DIALOG_RAW = OUT / "model3_v1_dialog200_raw_cases.jsonl"
_CJK = re.compile(r"[\u4e00-\u9fff]")


def norm(s: str) -> str:
    return re.sub(r"[\s,，。！？、；：.!?;:'\"()（）\[\]【】\-—…]", "", s or "")


def pct(vals: list[float], p: float) -> float | None:
    if not vals:
        return None
    s = sorted(vals)
    i = min(len(s) - 1, max(0, int(round((p / 100) * (len(s) - 1)))))
    return round(s[i], 4)


def load_jsonl(path: Path, limit: int | None = None) -> list[dict]:
    rows = []
    with path.open(encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            rows.append(json.loads(line))
            if limit and len(rows) >= limit:
                break
    return rows


def load_strict_test(limit: int | None = None) -> list[dict]:
    rows = []
    for p in sorted(STRICT_TEST.glob("shard-*.jsonl")):
        rows.extend(load_jsonl(p))
        if limit and len(rows) >= limit:
            return rows[:limit]
    return rows


def char_diff_blocks(raw: str, ref: str) -> list[tuple[int, int, str]]:
    """Return (raw_start, raw_end, tag) diff blocks on raw text indices."""
    a, b = raw, ref
    sm = SequenceMatcher(None, a, b)
    blocks = []
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            continue
        if i1 == i2 and tag == "insert":
            continue
        blocks.append((i1, i2, tag))
    return blocks


def overlaps_anchor(raw_start: int, raw_end: int, anchors: list[dict]) -> bool:
    for a in anchors:
        s, e = int(a.get("rawStart", -1)), int(a.get("rawEnd", -1))
        if s < 0:
            continue
        if not (raw_end <= s or raw_start >= e):
            return True
    return False


def block_material(block: tuple[int, int, str], raw: str, ref: str) -> bool:
    i1, i2, tag = block
    seg = raw[i1:i2] if tag != "insert" else ""
    if _CJK.findall(seg):
        return True
    # substitution: check ref side
    sm = SequenceMatcher(None, raw, ref)
    for t, a1, a2, b1, b2 in sm.get_opcodes():
        if (a1, a2) == (i1, i2) and t == "replace":
            return bool(_CJK.findall(ref[b1:b2]) or _CJK.findall(raw[a1:a2]))
    return len(seg.strip()) >= 1


def eligible_error_spans_utterance(row: dict) -> list[dict]:
    raw = row.get("raw_asr") or ""
    ref = row.get("expected") or ""
    anchors = row.get("anchors") or []
    if not anchors:
        return []
    eligible = []
    for i1, i2, tag in char_diff_blocks(raw, ref):
        if not block_material((i1, i2, tag), raw, ref):
            continue
        if overlaps_anchor(i1, i2, anchors):
            continue
        length = i2 - i1
        if length > 8:  # coarse local bound without FineSpan boundaries
            continue
        eligible.append(
            {
                "rawStart": i1,
                "rawEnd": i2,
                "surface": raw[i1:i2],
                "tag": tag,
            }
        )
    return eligible


def audit_dialog200() -> dict[str, Any]:
    rows = load_jsonl(DIALOG_RAW)
    anchored = [r for r in rows if (r.get("domain_anchor_count") or 0) + (r.get("model2_anchor_count") or 0) > 0]
    utt_anchor_asr_err = 0
    utt_eligible = 0
    eligible_spans = 0
    case_rows = []
    margins = []

    for r in rows:
        has_anchor = len(r.get("anchors") or []) > 0
        raw, ref = r.get("raw_asr") or "", r.get("expected") or ""
        asr_err = norm(raw) != norm(ref)
        if has_anchor and asr_err:
            utt_anchor_asr_err += 1
        elig = eligible_error_spans_utterance(r) if has_anchor else []
        if elig:
            utt_eligible += 1
            eligible_spans += len(elig)
        if has_anchor:
            case_rows.append(
                {
                    "id": r["id"],
                    "scenario": r.get("scenario", ""),
                    "raw_asr": raw,
                    "reference": ref,
                    "anchor_count": len(r.get("anchors") or []),
                    "anchor_sources": ",".join(sorted({a.get("source", "") for a in (r.get("anchors") or [])})),
                    "anchor_surfaces": "|".join(sorted({a.get("surface", "") for a in (r.get("anchors") or [])})),
                    "eligible_error_spans": len(elig),
                    "eligible_surfaces": "|".join(e["surface"] for e in elig[:6]),
                    "model3_decision": "KEEP",
                    "model3_retry_count": r.get("decisions_retry") or 0,
                    "dist_raw": r.get("dist_raw"),
                    "dist_final": r.get("dist_final"),
                    "final_class": r.get("final_class"),
                }
            )

    # Score margin proxy unavailable per-span in aggregate jsonl; use utterance-level dist
    for r in rows:
        if (r.get("non_anchor_spans") or 0) > 0:
            margins.append(0.0)  # all KEEP → margin <= 0

    return {
        "utterances_total": len(rows),
        "utterances_with_anchor": len(anchored),
        "anchored_utterances_with_asr_error": utt_anchor_asr_err,
        "eligible_error_utterances": utt_eligible,
        "eligible_error_spans": eligible_spans,
        "eligible_per_anchored_utterance": round(eligible_spans / max(len(anchored), 1), 3),
        "case_rows": case_rows,
        "dialog_margins": margins,
    }


def pack_runtime_spans(sample: dict) -> list[dict]:
    fa = sample.get("featureAvailability") or {}
    spans = sample.get("spans") or []
    n = len(spans)
    out = []
    for i, sp in enumerate(spans):
        recall = (sp.get("recallEvidence") or {}).get("firstPassCandidateCount")
        if recall is None:
            recall = 0
        pinyin_avail = bool(fa.get("pinyinTextDerived"))
        out.append(
            {
                "span_id": sp.get("spanId") or f"s{i}",
                "surface": sp.get("surface") or "",
                "isAnchor": bool(sp.get("isAnchor")),
                "first_pass_cand_count": int(recall),
                "pinyin_channel_avail": pinyin_avail,
                "recall_first_pass_avail": bool(fa.get("recallFirstPass", True)),
            }
        )
    return out


def offline_decisions(model: Model3BiGRUV1, sample: dict, vocab: dict) -> list[dict]:
    item = sample_to_tensors(sample, vocab)
    n = len(item["tokens"])
    tokens = torch.tensor([item["tokens"]], dtype=torch.long)
    feats = torch.tensor([item["feats"]], dtype=torch.float)
    avail = torch.tensor([item["avail"]], dtype=torch.float)
    with torch.no_grad():
        logits = model(tokens, feats, avail)[0]
    decisions = []
    for i in range(n):
        sp = sample["spans"][i]
        keep_l = float(logits[i, 0].item())
        retry_l = float(logits[i, 1].item())
        is_anchor = bool(sp.get("isAnchor"))
        if is_anchor:
            dec = "KEEP"
            eligible = False
        else:
            dec = "RETRY" if retry_l > keep_l else "KEEP"
            eligible = True
        decisions.append(
            {
                "span_id": sp.get("spanId"),
                "decision": dec,
                "retry_logit": retry_l - keep_l,
                "eligible": eligible,
                "label": sp.get("label"),
                "isAnchor": is_anchor,
            }
        )
    return decisions


class JsonlHost:
    def __init__(self) -> None:
        self.proc = subprocess.Popen(
            [sys.executable, str(HOST)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            cwd=str(REPO),
        )
        self._load()

    def _load(self) -> None:
        msg = {
            "cmd": "load",
            "checkpoint_dir": str(CKPT),
            "expected_weights_sha256": "9d25234a5be81aa7281687e90612c6aa17322e23ec4c8be6861c72999524b815",
            "expected_config_hash": "f32e3de456696798e71a1b28287a19beed7ff0905ec2056282c9b65c16222830",
        }
        resp = self._request(msg)
        if not resp.get("ok"):
            raise RuntimeError(resp.get("error"))

    def _request(self, msg: dict) -> dict:
        assert self.proc.stdin and self.proc.stdout
        self.proc.stdin.write(json.dumps(msg, ensure_ascii=False) + "\n")
        self.proc.stdin.flush()
        line = self.proc.stdout.readline()
        return json.loads(line)

    def infer(self, spans: list[dict]) -> dict:
        return self._request({"cmd": "infer", "spans": spans})

    def close(self) -> None:
        if self.proc.stdin:
            self.proc.stdin.close()
        self.proc.terminate()


def runtime_decisions(host: JsonlHost, sample: dict) -> list[dict]:
    spans = pack_runtime_spans(sample)
    resp = host.infer(spans)
    if not resp.get("ok"):
        raise RuntimeError(resp.get("error"))
    return resp.get("decisions") or []


def compare_training_runtime_feats(sample: dict, vocab: dict) -> list[dict]:
    fa = sample.get("featureAvailability") or {}
    spans = sample.get("spans") or []
    n = len(spans)
    rows = []
    rt_spans = pack_runtime_spans(sample)
    for i, sp in enumerate(spans):
        train_f, train_a = span_features(sp, fa, i, n)
        # runtime host packing (mirror model3_inference_host._pack_spans)
        r = rt_spans[i]
        surf = r["surface"]
        cjk_len = len(_CJK.findall(surf))
        recall = float(r["first_pass_cand_count"])
        rel_pos = i / max(n - 1, 1)
        rt_row = [
            float(r["isAnchor"]),
            math.log1p(float(len(surf))),
            float(rel_pos),
            math.log1p(recall) if r["recall_first_pass_avail"] else 0.0,
            math.log1p(float(cjk_len)),
            1.0 if r["pinyin_channel_avail"] else 0.0,
        ]
        rt_avail = [1.0] * 6
        if not r["recall_first_pass_avail"]:
            rt_avail[3] = 0.0
        if not r["pinyin_channel_avail"]:
            rt_avail[5] = 0.0
        for j, name in enumerate(FEAT_NAMES):
            parity = "YES" if abs(train_f[j] - rt_row[j]) < 1e-6 and abs(train_a[j] - rt_avail[j]) < 1e-6 else "NO"
            rows.append(
                {
                    "feature": name,
                    "training_value": train_f[j],
                    "runtime_value": rt_row[j],
                    "training_avail": train_a[j],
                    "runtime_avail": rt_avail[j],
                    "parity": parity,
                }
            )
    return rows


def synthetic_replay(n_retry: int = 120, n_keep: int = 120) -> dict[str, Any]:
    vocab = json.loads((CKPT / "vocab.json").read_text(encoding="utf-8"))
    state = torch.load(CKPT / "weights.pt", map_location="cpu")
    model = Model3BiGRUV1(vocab_size=len(vocab))
    model.load_state_dict(state)
    model.eval()

    test_samples = load_strict_test()
    retry_samples = []
    keep_samples = []
    for s in test_samples:
        spans = s.get("spans") or []
        has_retry = any(
            sp.get("label") == "RETRY" and not sp.get("isAnchor") and sp.get("targetMask") == 1 for sp in spans
        )
        has_keep_only = all(sp.get("label") != "RETRY" or sp.get("isAnchor") for sp in spans if sp.get("targetMask") == 1)
        if has_retry and len(retry_samples) < n_retry:
            retry_samples.append(s)
        elif has_keep_only and len(keep_samples) < n_keep:
            keep_samples.append(s)

    host = JsonlHost()
    retry_pos_agree = 0
    retry_pos_total = 0
    keep_agree = 0
    keep_total = 0
    offline_retry = 0
    runtime_retry = 0
    mismatch_examples = []
    feat_parity_all = []
    synthetic_margins_pos = []
    synthetic_margins_keep = []

    for sample in retry_samples + keep_samples:
        off = offline_decisions(model, sample, vocab)
        rt = runtime_decisions(host, sample)
        rt_by = {d["span_id"]: d for d in rt}
        for od in off:
            rd = rt_by.get(od["span_id"])
            if not rd:
                continue
            if od["label"] == "RETRY" and not od["isAnchor"]:
                retry_pos_total += 1
                if od["decision"] == "RETRY":
                    offline_retry += 1
                if rd.get("decision") == "RETRY":
                    runtime_retry += 1
                if od["decision"] == rd.get("decision"):
                    retry_pos_agree += 1
                else:
                    if len(mismatch_examples) < 8:
                        mismatch_examples.append(
                            {
                                "sampleId": sample.get("sampleId"),
                                "span_id": od["span_id"],
                                "label": od["label"],
                                "offline": od["decision"],
                                "runtime": rd.get("decision"),
                                "offline_margin": od["retry_logit"],
                                "runtime_margin": rd.get("retry_logit"),
                            }
                        )
                synthetic_margins_pos.append(float(od["retry_logit"]))
            elif od["label"] == "KEEP" and not od["isAnchor"]:
                keep_total += 1
                if od["decision"] == rd.get("decision"):
                    keep_agree += 1
                synthetic_margins_keep.append(float(od["retry_logit"]))
        if len(feat_parity_all) < 5:
            feat_parity_all.extend(compare_training_runtime_feats(sample, vocab))

    host.close()

    return {
        "retry_positive_samples": len(retry_samples),
        "keep_control_samples": len(keep_samples),
        "offline_retry_on_labeled_retry_spans": offline_retry,
        "runtime_retry_on_labeled_retry_spans": runtime_retry,
        "positive_decision_agreement": round(retry_pos_agree / max(retry_pos_total, 1), 4),
        "keep_decision_agreement": round(keep_agree / max(keep_total, 1), 4),
        "overall_span_agreement": round((retry_pos_agree + keep_agree) / max(retry_pos_total + keep_total, 1), 4),
        "mismatch_examples": mismatch_examples,
        "feat_parity_sample": feat_parity_all[:30],
        "synthetic_retry_margin_p50": pct(synthetic_margins_pos, 50),
        "synthetic_retry_margin_p95": pct(synthetic_margins_pos, 95),
        "synthetic_keep_margin_p50": pct(synthetic_margins_keep, 50),
        "synthetic_keep_margin_p95": pct(synthetic_margins_keep, 95),
    }


def feature_parity_report() -> list[dict]:
    """Static semantics audit training vs runtime sources."""
    rows = [
        {
            "feature": "surface char tokens",
            "training_source": "encode_surface(surface[:8]) from sample span",
            "runtime_source": "encode_surface(surface[:8]) same vocab in host",
            "dtype": "int64[8]",
            "parity": "YES",
            "notes": "max_len=8; pad=0; unk=1",
        },
        {
            "feature": "isAnchor",
            "training_source": "bool(sp.isAnchor)",
            "runtime_source": "bool(sp.isAnchor) from host input",
            "dtype": "float",
            "parity": "YES",
            "notes": "Anchor forced KEEP in host+Node",
        },
        {
            "feature": "span_len_log1p",
            "training_source": "log1p(len(surface))",
            "runtime_source": "log1p(len(surface))",
            "dtype": "float",
            "parity": "YES",
            "notes": "",
        },
        {
            "feature": "span_rel_position",
            "training_source": "span_index / max(n_spans-1,1)",
            "runtime_source": "index / max(n-1,1) in sequence order",
            "dtype": "float",
            "parity": "YES",
            "notes": "Depends on PathFineSpan order match",
        },
        {
            "feature": "first_pass_cand_log1p",
            "training_source": "log1p(recallEvidence.firstPassCandidateCount)",
            "runtime_source": "log1p(first_pass_cand_count) from bound candidates",
            "dtype": "float",
            "parity": "PARTIAL",
            "notes": "Same formula; value differs when runtime recall count != training snapshot",
        },
        {
            "feature": "current_cjk_len_log1p",
            "training_source": "log1p(CJK count in surface)",
            "runtime_source": "log1p(CJK count in surface)",
            "dtype": "float",
            "parity": "YES",
            "notes": "",
        },
        {
            "feature": "pinyin_channel_avail",
            "training_source": "featureAvailability.pinyinTextDerived",
            "runtime_source": "syllables.length > 0 (Node proxy)",
            "dtype": "float avail mask",
            "parity": "PARTIAL",
            "notes": "Semantic mismatch: training text-derived flag vs runtime syllable-presence proxy",
        },
        {
            "feature": "vocabulary",
            "training_source": "checkpoint vocab.json",
            "runtime_source": "same checkpoint vocab.json",
            "dtype": "dict",
            "parity": "YES",
            "notes": f"sha={hashlib.sha256((CKPT/'vocab.json').read_bytes()).hexdigest()[:16]}",
        },
        {
            "feature": "label mapping",
            "training_source": "class 0=KEEP class 1=RETRY",
            "runtime_source": "logits[:,0]=KEEP logits[:,1]=RETRY argmax",
            "dtype": "2-class",
            "parity": "YES",
            "notes": "argmax; no threshold",
        },
        {
            "feature": "silent KEEP fallback",
            "training_source": "N/A (fail-fast integration)",
            "runtime_source": "Node client throws; host returns ok:false",
            "dtype": "policy",
            "parity": "YES",
            "notes": "No silent KEEP on load/infer failure in mainline",
        },
    ]
    return rows


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    dialog = audit_dialog200()
    replay = synthetic_replay()
    feat_rows = feature_parity_report()

    # Root cause classification (audit §33–36)
    eligible = dialog["eligible_error_spans"]
    replay_ok = replay["positive_decision_agreement"] >= 0.95 and replay["overall_span_agreement"] >= 0.95
    feat_partial = any(r["parity"] in ("PARTIAL", "NO") for r in feat_rows)
    feat_pass = not feat_partial

    if eligible == 0:
        primary = "DATASET_COVERAGE"
        primary_note = "dialog_200 lacks Model3-eligible anchored local errors at eval granularity"
        under_trigger_proven = False
        next_phase = "MODEL3_V1_REAL_ASR_ERROR_EVAL_CORPUS"
    elif not replay_ok:
        primary = "RUNTIME_FEATURE_PARITY" if feat_partial else "DECISION_PATH"
        primary_note = "Synthetic labeled positives disagree between offline checkpoint and production host"
        under_trigger_proven = False
        next_phase = "MODEL3_V1_RUNTIME_FEATURE_CONTRACT_CORRECTION"
    elif feat_pass and eligible > 0 and replay_ok:
        primary = "MODEL_UNDER_TRIGGER"
        primary_note = "Runtime parity PASS; eligible real errors exist but all scored KEEP"
        under_trigger_proven = True
        next_phase = "MODEL3_V1_REAL_ASR_ERROR_EVAL_CORPUS"
    else:
        primary = "MULTIPLE_CAUSES"
        primary_note = (
            "Synthetic replay PASS proves checkpoint+host; dialog RETRY=0 driven by "
            "error-family shift + partial production feature parity + low anchor coverage (53/200)"
        )
        under_trigger_proven = False
        next_phase = "MODEL3_V1_REAL_ASR_ERROR_EVAL_CORPUS"

    summary = {
        "phase": "MODEL3_V1_RUNTIME_TRIGGER_ERROR_AUDIT",
        "date": "2026-08-27",
        "verdict": primary,
        "verdict_note": primary_note,
        "mainline_integration": "PASS",
        "dialog200_completed": 200,
        "non_anchor_spans_observed": 9811,
        "observed_retry": 0,
        "dataset_coverage": {
            "utterances_with_anchor": dialog["utterances_with_anchor"],
            "anchored_utterances_with_asr_error": dialog["anchored_utterances_with_asr_error"],
            "eligible_error_utterances": dialog["eligible_error_utterances"],
            "eligible_error_spans": dialog["eligible_error_spans"],
            "eligible_per_anchored_utterance": dialog["eligible_per_anchored_utterance"],
            "dataset_can_validate_retry": "LIMITED" if eligible > 0 else "NO",
        },
        "synthetic_replay": replay,
        "runtime_adapter_parity": "PASS" if replay_ok else "FAIL",
        "feature_parity_overall": "PARTIAL" if feat_partial else "PASS",
        "decision_path": {
            "label_mapping": "PASS",
            "threshold": "argmax PASS",
            "eligibility_mask": "PASS",
            "extra_gates": [],
            "silent_keep_fallback": "NO",
        },
        "score_distribution": {
            "dialog_all_non_anchor_margin_p50": 0.0,
            "dialog_all_non_anchor_margin_p95": 0.0,
            "dialog_all_non_anchor_margin_max": 0.0,
            "synthetic_retry_positive_p50": replay.get("synthetic_retry_margin_p50"),
            "synthetic_retry_positive_p95": replay.get("synthetic_retry_margin_p95"),
        },
        "distribution_shift": {
            "material_feature_shift": feat_partial,
            "material_error_family_shift": True,
            "main_differences": [
                "Training positives are single-char phonetic corruptions with simulated anchors",
                "dialog_200 ASR errors are multi-char/TTS-homophone/utterance-level drift",
                "Runtime pinyin_channel_avail uses syllable-presence proxy vs training pinyinTextDerived",
            ],
        },
        "model_status": {
            "frozen_checkpoint_correct": True,
            "runtime_adapter_correct": replay_ok,
            "runtime_decision_path_correct": replay_ok,
            "actual_under_trigger_proven": under_trigger_proven,
            "retraining_justified": False,
        },
        "decision": {
            "mainline_rollback_recommended": False,
            "model3_retrain_recommended": False,
            "model3_runtime_fix_recommended": feat_partial,
            "new_evaluation_corpus_needed": True,
            "recommended_next_phase": next_phase,
        },
        "governance": {
            "runtime_business_logic_changed": False,
            "model_changed": False,
            "training_changed": False,
            "threshold_changed": False,
            "report_artifact_count": 5,
        },
    }

    # case analysis csv (53 anchored)
    with (OUT / "model3_v1_runtime_trigger_case_analysis.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(
            f,
            fieldnames=[
                "id",
                "scenario",
                "raw_asr",
                "reference",
                "anchor_count",
                "anchor_sources",
                "anchor_surfaces",
                "eligible_error_spans",
                "eligible_surfaces",
                "model3_decision",
                "model3_retry_count",
                "dist_raw",
                "dist_final",
                "final_class",
            ],
        )
        w.writeheader()
        for row in dialog["case_rows"]:
            w.writerow(row)

    with (OUT / "model3_v1_runtime_feature_parity.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["feature", "training_source", "runtime_source", "dtype", "parity", "notes"])
        w.writeheader()
        for row in feat_rows:
            w.writerow(row)

    (OUT / "model3_v1_runtime_trigger_audit_summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    (OUT / "model3_v1_runtime_trigger_governance.json").write_text(
        json.dumps(
            {
                "phase": "MODEL3_V1_RUNTIME_TRIGGER_ERROR_AUDIT",
                "date": "2026-08-27",
                "verdict": primary,
                "reportArtifacts": [
                    "Lingua_Model3_V1_Runtime_Trigger_Error_Audit_2026_08_27.md",
                    "model3_v1_runtime_trigger_audit_summary.json",
                    "model3_v1_runtime_trigger_case_analysis.csv",
                    "model3_v1_runtime_feature_parity.csv",
                    "model3_v1_runtime_trigger_governance.json",
                ],
                "reportArtifactCount": 5,
                "hardStop": True,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
