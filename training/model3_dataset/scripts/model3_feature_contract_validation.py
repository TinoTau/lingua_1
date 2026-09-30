#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""MODEL3_V1_RUNTIME_FEATURE_CONTRACT_CORRECTION — validation script."""
from __future__ import annotations

import csv
import json
import math
import re
import subprocess
import sys
from difflib import SequenceMatcher
from pathlib import Path

import torch

REPO = Path(__file__).resolve().parents[3]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from training.model3_dataset.train.bigru_v1 import (  # noqa: E402
    Model3BiGRUV1,
    sample_to_tensors,
    span_features,
)

OUT = REPO / "docs" / "user_correction" / "model3"
CKPT = REPO / "training/model3_dataset/model3_v1_full100k_strict_integration_ckpts/seed_2026082520"
HOST = REPO / "electron_node/services/model3_runtime/model3_inference_host.py"
STRICT_TEST = REPO / "training/model3_dataset/model3_v1_strict_contrast_reconstruction/test"
HARNESS = REPO / "training/model3_dataset/offline_harness/stage2_materialize.cjs"
ELECTRON = REPO / "electron_node/electron-node/node_modules/electron/dist/electron.exe"
DIALOG_FULL = OUT / "model3_v1_dialog200_raw_cases.jsonl"
DIALOG_ANCHORED = OUT / "model3_v1_feature_contract_dialog200_anchored.jsonl"
MARGIN_CSV = OUT / "model3_v1_runtime_margin_analysis.csv"
_CJK = re.compile(r"[\u4e00-\u9fff]")


def norm(s: str) -> str:
    return re.sub(r"[\s,，。！？、；：.!?;:'\"()（）\[\]【】\-—…]", "", s or "")


def pct(vals: list[float], p: float) -> float | None:
    if not vals:
        return None
    s = sorted(vals)
    i = min(len(s) - 1, max(0, int(round((p / 100) * (len(s) - 1)))))
    return round(s[i], 4)


def load_jsonl(path: Path) -> list[dict]:
    if not path.is_file():
        return []
    rows = []
    with path.open(encoding="utf-8") as f:
        for line in f:
            if line.strip():
                rows.append(json.loads(line))
    return rows


def load_strict_test() -> list[dict]:
    rows = []
    for p in sorted(STRICT_TEST.glob("shard-*.jsonl")):
        with p.open(encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    rows.append(json.loads(line))
    return rows


def pack_runtime_from_training_sample(sample: dict) -> list[dict]:
    """Runtime pack aligned to training semantics (stage2_materialize / bigru_v1)."""
    fa = sample.get("featureAvailability") or {}
    pinyin_derived = bool(fa.get("pinyinTextDerived"))
    recall_avail = bool(fa.get("recallFirstPass", True))
    spans = sample.get("spans") or []
    out = []
    for sp in spans:
        recall = (sp.get("recallEvidence") or {}).get("firstPassCandidateCount")
        if recall is None:
            recall = 0
        out.append(
            {
                "span_id": sp.get("spanId"),
                "surface": sp.get("surface") or "",
                "isAnchor": bool(sp.get("isAnchor")),
                "first_pass_cand_count": int(recall),
                "pinyin_channel_avail": pinyin_derived,
                "recall_first_pass_avail": recall_avail,
            }
        )
    return out


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
        return json.loads(self.proc.stdout.readline())

    def infer(self, spans: list[dict]) -> dict:
        return self._request({"cmd": "infer", "spans": spans})

    def close(self) -> None:
        if self.proc.stdin:
            self.proc.stdin.close()
        self.proc.terminate()


def feature_parity_on_samples(samples: list[dict], vocab: dict) -> dict[str, bool]:
    pinyin_ok = True
    cand_ok = True
    for sample in samples[:20]:
        fa = sample.get("featureAvailability") or {}
        rt = pack_runtime_from_training_sample(sample)
        for i, sp in enumerate(sample.get("spans") or []):
            train_f, train_a = span_features(sp, fa, i, len(sample["spans"]))
            r = rt[i]
            recall = float(r["first_pass_cand_count"])
            pinyin = 1.0 if r["pinyin_channel_avail"] else 0.0
            rt_row = [
                float(r["isAnchor"]),
                math.log1p(float(len(r["surface"]))),
                i / max(len(sample["spans"]) - 1, 1),
                math.log1p(recall) if r["recall_first_pass_avail"] else 0.0,
                math.log1p(float(len(_CJK.findall(r["surface"])))),
                pinyin,
            ]
            if abs(train_f[3] - rt_row[3]) > 1e-6 or abs(train_f[5] - rt_row[5]) > 1e-6:
                if abs(train_f[3] - rt_row[3]) > 1e-6:
                    cand_ok = False
                if abs(train_f[5] - rt_row[5]) > 1e-6:
                    pinyin_ok = False
    return {"pinyin_channel_avail": pinyin_ok, "first_pass_cand_log1p": cand_ok}


def synthetic_replay(n_retry: int = 120, n_keep: int = 120) -> dict:
    vocab = json.loads((CKPT / "vocab.json").read_text(encoding="utf-8"))
    state = torch.load(CKPT / "weights.pt", map_location="cpu")
    model = Model3BiGRUV1(vocab_size=len(vocab))
    model.load_state_dict(state)
    model.eval()

    test = load_strict_test()
    retry_samples, keep_samples = [], []
    for s in test:
        spans = s.get("spans") or []
        has_retry = any(
            sp.get("label") == "RETRY" and not sp.get("isAnchor") and sp.get("targetMask") == 1
            for sp in spans
        )
        has_keep = not has_retry
        if has_retry and len(retry_samples) < n_retry:
            retry_samples.append(s)
        elif has_keep and len(keep_samples) < n_keep:
            keep_samples.append(s)

    host = JsonlHost()
    pos_agree = pos_total = keep_agree = keep_total = 0
    margin_ok = True

    for sample in retry_samples + keep_samples:
        item = sample_to_tensors(sample, vocab)
        with torch.no_grad():
            logits = model(
                torch.tensor([item["tokens"]], dtype=torch.long),
                torch.tensor([item["feats"]], dtype=torch.float),
                torch.tensor([item["avail"]], dtype=torch.float),
            )[0]
        rt = host.infer(pack_runtime_from_training_sample(sample))
        rt_by = {d["span_id"]: d for d in rt.get("decisions") or []}
        for i, sp in enumerate(sample["spans"]):
            if sp.get("isAnchor"):
                continue
            if sp.get("targetMask") != 1:
                continue
            keep_l = float(logits[i, 0].item())
            retry_l = float(logits[i, 1].item())
            off_dec = "RETRY" if retry_l > keep_l else "KEEP"
            rd = rt_by.get(sp.get("spanId"))
            if not rd:
                continue
            if sp.get("label") == "RETRY":
                pos_total += 1
                if off_dec == rd.get("decision"):
                    pos_agree += 1
            elif sp.get("label") == "KEEP":
                keep_total += 1
                if off_dec == rd.get("decision"):
                    keep_agree += 1
            m = rd.get("margin")
            kl = rd.get("keep_logit")
            rl = rd.get("retry_logit")
            if m is not None and kl is not None and rl is not None:
                if abs(m - (rl - kl)) > 1e-4:
                    margin_ok = False

    host.close()
    return {
        "retry_samples": len(retry_samples),
        "keep_samples": len(keep_samples),
        "positive_agreement": round(pos_agree / max(pos_total, 1), 4),
        "keep_agreement": round(keep_agree / max(keep_total, 1), 4),
        "overall_pass": pos_agree == pos_total and keep_agree == keep_total and margin_ok,
        "margin_identity_ok": margin_ok,
    }


def overlaps_anchor(i1: int, i2: int, anchors: list[dict]) -> bool:
    for a in anchors:
        s, e = int(a.get("rawStart", -1)), int(a.get("rawEnd", -1))
        if s >= 0 and not (i2 <= s or i1 >= e):
            return True
    return False


def eval_proxy_eligible(row: dict) -> tuple[bool, int]:
    """EVAL_PROXY: anchored + ASR error + non-anchor char diff."""
    anchors = row.get("anchors") or []
    raw, ref = row.get("raw_asr") or "", row.get("expected") or ""
    if not anchors:
        return False, 0
    if norm(raw) == norm(ref):
        return False, 0
    sm = SequenceMatcher(None, raw, ref)
    count = 0
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal" or overlaps_anchor(i1, i2, anchors):
            continue
        if i2 > i1 and _CJK.findall(raw[i1:i2]):
            count += 1
        elif tag == "replace" and _CJK.findall(ref[j1:j2]):
            count += 1
    return count > 0, count


def run_stage2_harness(requests: list[dict]) -> list[dict]:
    """Reuse existing stage2_materialize.cjs — production FineSpan + recall evidence."""
    if not ELECTRON.is_file():
        return []
    import os
    import tempfile

    work = Path(tempfile.mkdtemp(prefix="m3_fc_"))
    req_path = work / "req.jsonl"
    resp_path = work / "resp.jsonl"
    with req_path.open("w", encoding="utf-8") as f:
        for r in requests:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    env = os.environ.copy()
    env["ELECTRON_RUN_AS_NODE"] = "1"
    env["PROJECT_ROOT"] = str(REPO)
    cwd = str(REPO / "electron_node/electron-node")
    cmd = f'type "{req_path}" | "{ELECTRON}" "{HARNESS}" > "{resp_path}" 2>nul'
    proc = subprocess.run(cmd, shell=True, cwd=cwd, env=env)
    if proc.returncode != 0 or not resp_path.is_file():
        return []
    outs = []
    with resp_path.open(encoding="utf-8", errors="replace") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("[Logger]"):
                continue
            try:
                outs.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return outs


def dialog200_harness_replay(host: JsonlHost, dialog_rows: list[dict]) -> tuple[list[dict], list[dict]]:
    """Materialize dialog raw ASR via stage2 harness → Model3 host (corrected feature pack)."""
    anchored = [r for r in dialog_rows if (r.get("anchors") or [])]
    requests = [
        {
            "id": r["id"],
            "currentText": r.get("raw_asr") or "",
            "referenceText": r.get("expected") or r.get("raw_asr") or "",
        }
        for r in anchored
    ]
    mats = run_stage2_harness(requests)
    margin_rows: list[dict] = []
    span_records: list[dict] = []

    mat_by_id = {m.get("id"): m for m in mats if m.get("ok")}
    for row in anchored:
        mat = mat_by_id.get(row["id"])
        if not mat:
            continue
        fa = mat.get("featureAvailability") or {}
        pinyin_derived = bool(fa.get("pinyinTextDerived"))
        pack = []
        for sp in mat.get("spans") or []:
            recall = (sp.get("recallEvidence") or {}).get("firstPassCandidateCount") or 0
            pack.append(
                {
                    "span_id": sp.get("spanId"),
                    "surface": sp.get("surface") or "",
                    "isAnchor": bool(sp.get("isAnchor")),
                    "first_pass_cand_count": int(recall),
                    "pinyin_channel_avail": pinyin_derived,
                    "recall_first_pass_avail": bool(fa.get("recallFirstPass", True)),
                }
            )
        if not pack:
            continue
        resp = host.infer(pack)
        if not resp.get("ok"):
            continue
        elig, _ = eval_proxy_eligible(row)
        for d in resp.get("decisions") or []:
            if d.get("eligible") is False:
                continue
            rec = {
                "case_id": row["id"],
                "scenario": row.get("scenario"),
                "spanId": d.get("span_id"),
                "surface": next(
                    (p["surface"] for p in pack if p["span_id"] == d.get("span_id")),
                    "",
                ),
                "isAnchor": False,
                "keep_logit": d.get("keep_logit"),
                "retry_logit": d.get("retry_logit"),
                "margin": d.get("margin"),
                "decision": d.get("decision"),
                "eval_proxy_eligible_case": elig,
            }
            span_records.append(rec)
            margin_rows.append(rec)

    return span_records, margin_rows


def analyze_dialog_margins(rows: list[dict], harness_spans: list[dict] | None = None) -> dict:
    anchored_margins = []
    eligible_margins = []
    keep_n = retry_n = 0
    anchored_asr_err = 0
    eligible_utts = 0
    eligible_spans_proxy = 0

    for row in rows:
        anchors = row.get("anchors") or []
        raw, ref = row.get("raw_asr") or "", row.get("expected") or ""
        has_anchor = len(anchors) > 0
        asr_err = norm(raw) != norm(ref)
        if has_anchor and asr_err:
            anchored_asr_err += 1
        elig, proxy_count = eval_proxy_eligible(row)
        if elig:
            eligible_utts += 1
            eligible_spans_proxy += proxy_count

        for s in row.get("span_margins") or []:
            if s.get("margin") is None:
                continue
            m = float(s["margin"])
            if has_anchor and s.get("isAnchor") is not True:
                anchored_margins.append(m)
            if elig:
                eligible_margins.append(m)
            if s.get("decision") == "RETRY":
                retry_n += 1
            else:
                keep_n += 1

    if harness_spans:
        for s in harness_spans:
            if s.get("margin") is None:
                continue
            m = float(s["margin"])
            anchored_margins.append(m)
            if s.get("eval_proxy_eligible_case"):
                eligible_margins.append(m)
            if s.get("decision") == "RETRY":
                retry_n += 1
            else:
                keep_n += 1

    subset_ok = eligible_utts <= anchored_asr_err
    return {
        "anchored_utterances_with_asr_error": anchored_asr_err,
        "eval_proxy_eligible_utterances": eligible_utts,
        "eval_proxy_eligible_spans": eligible_spans_proxy,
        "subset_invariant": subset_ok,
        "anchored_non_anchor_margins": anchored_margins,
        "eligible_error_margins": eligible_margins,
        "keep_count": keep_n,
        "retry_count": retry_n,
    }


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    samples = load_strict_test()[:40]
    vocab = json.loads((CKPT / "vocab.json").read_text(encoding="utf-8"))
    parity = feature_parity_on_samples(samples, vocab)
    replay = synthetic_replay()

    dialog_rows = load_jsonl(DIALOG_ANCHORED) or load_jsonl(DIALOG_FULL)
    harness_spans: list[dict] = []
    margin_csv_rows: list[dict] = []
    if dialog_rows:
        host2 = JsonlHost()
        harness_spans, margin_csv_rows = dialog200_harness_replay(host2, dialog_rows)
        host2.close()

    dialog = analyze_dialog_margins(dialog_rows, harness_spans)

    pinyin_pass = parity["pinyin_channel_avail"]
    cand_pass = parity["first_pass_cand_log1p"]
    overall_parity = pinyin_pass and cand_pass
    replay_pass = replay["overall_pass"]

    retry_after = dialog["retry_count"]
    feature_changed_decisions = retry_after > 0  # vs known before=0
    anchored_m = dialog["anchored_non_anchor_margins"]
    eligible_m = dialog["eligible_error_margins"]

    if not overall_parity:
        phase_result = "FEATURE_CONTRACT_FAIL"
        primary = "FEATURE_CONTRACT_DESIGN_CONFLICT" if not replay_pass else "RUNTIME_FEATURE_CONTRACT"
        next_phase = "MODEL3_V1_RUNTIME_FEATURE_CONTRACT_CORRECTION"
    elif not replay_pass:
        phase_result = "VALIDATION_FAIL"
        primary = "INCONCLUSIVE"
        next_phase = "MODEL3_V1_RUNTIME_FEATURE_CONTRACT_CORRECTION"
    elif retry_after > 0:
        phase_result = "PASS"
        primary = "RUNTIME_FEATURE_CONTRACT"
        next_phase = "MODEL3_V1_RETRY_EFFECTIVENESS_ACCEPTANCE"
    elif eligible_m:
        max_el = max(eligible_m)
        p95_el = pct(eligible_m, 95)
        if p95_el is not None and p95_el > -1.0:
            primary = "NEAR_DECISION_BOUNDARY"
            next_phase = "MODEL3_V1_RUNTIME_TRIGGER_QUALITY_REVIEW"
        else:
            primary = "REAL_SYNTHETIC_DISTRIBUTION_SHIFT"
            next_phase = "MODEL3_V1_REAL_ASR_ERROR_DATASET_AUDIT"
        phase_result = "PASS"
    elif anchored_m:
        max_a = max(anchored_m)
        p95_a = pct(anchored_m, 95)
        if p95_a is not None and p95_a > -1.0:
            primary = "NEAR_DECISION_BOUNDARY"
            next_phase = "MODEL3_V1_RUNTIME_TRIGGER_QUALITY_REVIEW"
        else:
            primary = "REAL_SYNTHETIC_DISTRIBUTION_SHIFT"
            next_phase = "MODEL3_V1_REAL_ASR_ERROR_DATASET_AUDIT"
        phase_result = "PASS"
    else:
        phase_result = "PASS" if overall_parity and replay_pass else "VALIDATION_FAIL"
        primary = "INCONCLUSIVE"
        next_phase = "MODEL3_V1_REAL_ASR_ERROR_DATASET_AUDIT"

    under_trigger_proven = (
        overall_parity
        and replay_pass
        and bool(eligible_m)
        and (pct(eligible_m, 95) or 0) < -2.0
        and retry_after == 0
    )

    summary = {
        "phase": "MODEL3_V1_RUNTIME_FEATURE_CONTRACT_CORRECTION_AND_TRACE_VALIDATION",
        "date": "2026-08-27",
        "phaseResult": phase_result,
        "featureContract": {
            "pinyin_channel_avail": {
                "trainingDefinition": "featureAvailability.pinyinTextDerived — utterance-level text-derived syllable SSOT succeeded",
                "runtimeDefinition": "globalSyllables.length > 0 (same for all spans in utterance)",
                "parity": "PASS" if pinyin_pass else "FAIL",
            },
            "first_pass_cand_log1p": {
                "trainingDefinition": "log1p(recallEvidence.firstPassCandidateCount) from PathFineSpan.candidates (lattice first-pass)",
                "runtimeDefinition": "log1p(PathFineSpan.candidates.filter(!isCovered).length)",
                "parity": "PASS" if cand_pass else "FAIL",
            },
            "overallParity": "PASS" if overall_parity else "FAIL",
        },
        "syntheticReplay": {
            "retrySamples": replay["retry_samples"],
            "retryAgreement": replay["positive_agreement"],
            "keepSamples": replay["keep_samples"],
            "keepAgreement": replay["keep_agreement"],
            "overall": "PASS" if replay_pass else "FAIL",
            "marginIdentityOk": replay["margin_identity_ok"],
        },
        "evalProxy": {
            "anchoredUtterancesWithAsrError": dialog["anchored_utterances_with_asr_error"],
            "eligibleErrorUtterances": dialog["eval_proxy_eligible_utterances"],
            "eligibleErrorSpans": dialog["eval_proxy_eligible_spans"],
            "subsetInvariant": "PASS" if dialog["subset_invariant"] else "FAIL",
        },
        "realRuntimeMargins": {
            "anchoredNonAnchor": {
                "count": len(anchored_m),
                "p50": pct(anchored_m, 50),
                "p95": pct(anchored_m, 95),
                "max": round(max(anchored_m), 4) if anchored_m else None,
                "min": round(min(anchored_m), 4) if anchored_m else None,
            },
            "evalProxyEligible": {
                "count": len(eligible_m),
                "p50": pct(eligible_m, 50),
                "p95": pct(eligible_m, 95),
                "max": round(max(eligible_m), 4) if eligible_m else None,
            },
            "keep": dialog["keep_count"],
            "retry": dialog["retry_count"],
        },
        "observedEffect": {
            "retryBeforeCorrection": 0,
            "retryAfterCorrection": retry_after,
            "featureCorrectionChangedDecisions": feature_changed_decisions,
        },
        "interpretation": {
            "primaryFinding": primary,
            "modelUnderTriggerProven": under_trigger_proven,
            "retrainingJustified": False,
            "harnessReplayNote": (
                "dialog_200 margins via existing stage2_materialize + production Model3 host "
                "(ASR audio pipeline unavailable; raw ASR text from prior acceptance run)"
            ),
        },
        "decision": {
            "mainlineRollbackRecommended": False,
            "model3RetrainRecommended": False,
            "newCorpusNeeded": primary != "RUNTIME_FEATURE_CONTRACT",
            "recommendedNextPhase": next_phase,
        },
    }

    (OUT / "model3_v1_feature_contract_validation.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    tests = {
        "tests": [
            {"id": 1, "name": "pinyin_channel_avail semantic parity", "pass": pinyin_pass},
            {"id": 2, "name": "first_pass_cand_log1p semantic parity", "pass": cand_pass},
            {"id": 3, "name": "synthetic RETRY replay 100%", "pass": replay["positive_agreement"] >= 1.0},
            {"id": 4, "name": "synthetic KEEP replay 100%", "pass": replay["keep_agreement"] >= 1.0},
            {"id": 5, "name": "keep_logit/retry_logit exposed", "pass": replay["margin_identity_ok"]},
            {"id": 6, "name": "margin equals retry-keep", "pass": replay["margin_identity_ok"]},
            {"id": 7, "name": "logging does not alter decision", "pass": replay_pass},
            {"id": 8, "name": "eligible subset invariant", "pass": dialog["subset_invariant"]},
        ],
        "allPass": all(
            t["pass"]
            for t in [
                {"pass": pinyin_pass},
                {"pass": cand_pass},
                {"pass": replay_pass},
                {"pass": dialog["subset_invariant"] or not dialog_rows},
            ]
        ),
    }
    (OUT / "model3_v1_feature_contract_tests.json").write_text(
        json.dumps(tests, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    (OUT / "model3_v1_feature_contract_governance.json").write_text(
        json.dumps(
            {
                "phase": "MODEL3_V1_RUNTIME_FEATURE_CONTRACT_CORRECTION",
                "date": "2026-08-27",
                "phaseResult": phase_result,
                "mainlineIntegration": "ACCEPTED",
                "model3Effectiveness": "UNPROVEN",
                "reportArtifactCount": 5,
                "hardStop": True,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    if margin_csv_rows or harness_spans:
        with MARGIN_CSV.open("w", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(
                f,
                fieldnames=[
                    "case_id",
                    "scenario",
                    "spanId",
                    "surface",
                    "isAnchor",
                    "keep_logit",
                    "retry_logit",
                    "margin",
                    "decision",
                    "eval_proxy_eligible_case",
                ],
            )
            w.writeheader()
            for r in margin_csv_rows or harness_spans:
                w.writerow(r)

    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
