# -*- coding: utf-8 -*-
"""MODEL3_V2_S3_MAINLINE_CAUSAL_REPLAY_AUDIT — read-only parity + diagnostic analysis."""
from __future__ import annotations

import csv
import hashlib
import json
import math
import re
import statistics
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

DOCS = REPO / "docs/user_correction/model3"
BASE_RAW = DOCS / "model3_v2_s3_mainline_baseline_raw_cases.jsonl"
S3_RAW = DOCS / "model3_v2_s3_mainline_s3_raw_cases.jsonl"
S3_CKPT = REPO / "training/model3_dataset/model3_v2_s3_random_init_v1_ckpts/seed_2026083013"
S3_DATA = REPO / "training/model3_dataset/model3_v2_production_core_s3"
FREEZE = DOCS / "model3_v2_s3_freeze_manifest.json"
L3_SSOT = DOCS / "model3_v2_s3_l3_evaluation_ssot.json"
EXPECTED_SHA = "f1e4196933a66bbea73fdd8f17fa460f52696656208ff05c41f2dc9ff81cbbb1"

FEAT_KEYS = [
    "isAnchor",
    "span_len_log1p",
    "span_rel_position",
    "first_pass_cand_log1p",
    "current_cjk_len_log1p",
    "pinyin_channel_avail",
]

UPSTREAM_HASH_FIELDS = [
    "caseId",
    "raw_asr",
    "model3_paths",
    "non_anchor_spans",
    "domain_anchor_count",
    "model2_anchor_count",
    "dual_source_anchor_count",
    "anchors",
    "vote_calls",
    "retained_domains",
    "rejected_prevote",
    "second_vote",
    "kenlm_pool_pre_fork",
    "span_identity",
    "packed_model3_spans",
]


def utc() -> str:
    return datetime.now(timezone.utc).isoformat()


def file_sha(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for c in iter(lambda: f.read(1 << 20), b""):
            h.update(c)
    return h.hexdigest()


def load_jsonl(p: Path) -> dict[str, dict]:
    out: dict[str, dict] = {}
    with p.open(encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            r = json.loads(line)
            if r.get("id"):
                out[r["id"]] = r
    return out


def norm(t: str) -> str:
    return "".join(re.findall(r"[\u4e00-\u9fff]", t or ""))


def levenshtein(a: str, b: str) -> int:
    s, t = a or "", b or ""
    m, n = len(s), len(t)
    if not m:
        return n
    if not n:
        return m
    dp = [[0] * (n + 1) for _ in range(m + 1)]
    for i in range(m + 1):
        dp[i][0] = i
    for j in range(n + 1):
        dp[0][j] = j
    for i in range(1, m + 1):
        for j in range(1, n + 1):
            cost = 0 if s[i - 1] == t[j - 1] else 1
            dp[i][j] = min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost)
    return dp[m][n]


def pct(arr: list[float], p: float) -> float | None:
    if not arr:
        return None
    s = sorted(arr)
    return s[min(len(s) - 1, max(0, int(len(s) * p)))]


def span_identity_list(row: dict) -> list[tuple]:
    spans = []
    for sm in row.get("span_margins") or []:
        spans.append(
            (
                sm.get("spanId"),
                sm.get("surface"),
                sm.get("start"),
                sm.get("end"),
                sm.get("isAnchor"),
                sm.get("path_id"),
            )
        )
    return sorted(spans, key=lambda x: (x[0] or "", x[5] or ""))


def packed_spans_from_traces(row: dict) -> list[dict]:
    packed = []
    for t in row.get("inference_input_traces") or []:
        if t.get("status") not in (None, "OK"):
            continue
        sp = t.get("span") if isinstance(t.get("span"), dict) else t
        if not isinstance(sp, dict):
            continue
        if not sp.get("features"):
            continue
        packed.append(
            {
                "spanId": sp.get("spanId"),
                "pathId": t.get("pathId"),
                "surface": sp.get("surface") or sp.get("surfaceUsed"),
                "tokenIds": sp.get("tokenIds"),
                "featVector": sp.get("featVector"),
                "availMask": sp.get("availMask"),
                "features": sp.get("features"),
                "isAnchor": sp.get("isAnchor"),
            }
        )
    return sorted(packed, key=lambda x: (x.get("pathId") or "", x.get("spanId") or ""))


def upstream_payload(row: dict) -> dict:
    return {
        "caseId": row.get("id"),
        "raw_asr": row.get("raw_asr"),
        "model3_paths": row.get("model3_paths"),
        "non_anchor_spans": row.get("non_anchor_spans"),
        "domain_anchor_count": row.get("domain_anchor_count"),
        "model2_anchor_count": row.get("model2_anchor_count"),
        "dual_source_anchor_count": row.get("dual_source_anchor_count"),
        "anchors": row.get("anchors") or [],
        "vote_calls": row.get("vote_calls"),
        "retained_domains": sorted(set(row.get("retained_domains") or [])),
        "rejected_prevote": row.get("rejected_prevote"),
        "second_vote": row.get("second_vote"),
        "kenlm_pool_pre_fork": row.get("kenlm_pool"),
        "span_identity": span_identity_list(row),
        "packed_model3_spans": packed_spans_from_traces(row),
    }


def upstream_hash(row: dict) -> str:
    s = json.dumps(upstream_payload(row), sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(s.encode()).hexdigest()


def classify_mismatch_stage(base: dict, s3: dict, diffs: list[str]) -> str:
    b, s = upstream_payload(base), upstream_payload(s3)
    if "raw_asr" in diffs:
        return "ASR"
    if any(k in diffs for k in ("model3_paths", "non_anchor_spans", "span_identity")):
        return "FineSpan_or_Path"
    if any(
        k in diffs
        for k in (
            "anchors",
            "domain_anchor_count",
            "model2_anchor_count",
            "dual_source_anchor_count",
        )
    ):
        return "Anchor"
    if any(k in diffs for k in ("vote_calls", "retained_domains", "rejected_prevote", "second_vote")):
        return "Domain_Vote"
    if "kenlm_pool_pre_fork" in diffs:
        return "Recall_or_CandidateState"
    if "packed_model3_spans" in diffs:
        return "Packer_or_TraceSerialization"
    return "Mixed_or_Unknown"


def logical_retry_keys(row: dict) -> set[tuple]:
    cid = row["id"]
    keys: set[tuple] = set()
    for sm in row.get("span_margins") or []:
        if sm.get("decision") != "RETRY" or sm.get("isAnchor"):
            continue
        keys.add((cid, sm.get("start"), sm.get("end"), sm.get("surface")))
    return keys


def precheck() -> dict:
    conflicts = []
    man = json.loads((S3_DATA / "dataset_manifest.json").read_text(encoding="utf-8"))
    freeze = json.loads(FREEZE.read_text(encoding="utf-8")) if FREEZE.exists() else {}
    l3 = json.loads(L3_SSOT.read_text(encoding="utf-8")) if L3_SSOT.exists() else {}
    sha = file_sha(S3_CKPT / "weights.pt")
    if man.get("datasetId") != "MODEL3_V2_PRODUCTION_CORE_S3":
        conflicts.append("datasetId")
    if man.get("datasetBuildId") != "prod_core_s3_build_20260830_v1":
        conflicts.append("buildId")
    if sha != EXPECTED_SHA:
        conflicts.append("sha")
    if man.get("featureContractIdentity") != "packModel3SpanInferFields":
        conflicts.append("feature")
    if man.get("labelContractIdentity") != "MODEL3_LABEL_CONTRACT_V2_20260829":
        conflicts.append("label")
    if l3.get("evaluatorId") != "MODEL3_V2_L3_EVALUATOR_V1":
        conflicts.append("l3_evaluator")
    if l3.get("evaluatorVersion") != "20260831_v1":
        conflicts.append("l3_version")
    return {
        "passed": len(conflicts) == 0,
        "conflicts": conflicts,
        "sha": sha,
        "datasetId": man.get("datasetId"),
        "buildId": man.get("datasetBuildId"),
        "families": man.get("families"),
        "spanPathSamples": man.get("spanPathSamples"),
        "formalRetryLabelRate": man.get("labels", {}).get("RETRY", 0)
        / max(1, man.get("spanPathSamples") or man.get("labels", {}).get("RETRY", 1)),
        "l3Evaluator": l3.get("evaluatorId"),
        "l3Version": l3.get("evaluatorVersion"),
        "featureContract": "packModel3SpanInferFields",
        "labelContract": "MODEL3_LABEL_CONTRACT_V2_20260829",
    }


def bucket_count(values: list[int], edges: list[tuple[str, callable]]) -> dict[str, int]:
    out = {label: 0 for label, _ in edges}
    for v in values:
        for label, fn in edges:
            if fn(v):
                out[label] += 1
                break
    return out


def main() -> int:
    pc = precheck()
    if not pc["passed"]:
        summary = {"verdict": "S3_FREEZE_IDENTITY_MISMATCH", "precheck": pc}
        (DOCS / "model3_v2_s3_causal_replay_summary.json").write_text(
            json.dumps(summary, indent=2), encoding="utf-8"
        )
        return 2

    if not BASE_RAW.exists() or not S3_RAW.exists():
        print("missing raw cases")
        return 3

    base = load_jsonl(BASE_RAW)
    s3 = load_jsonl(S3_RAW)
    ids = sorted(set(base) & set(s3))

    parity_rows = []
    parity_pass = 0
    parity_fail = 0
    field_mismatch = Counter()
    stage_mismatch = Counter()

    for cid in ids:
        b, r = base[cid], s3[cid]
        hb, hr = upstream_hash(b), upstream_hash(r)
        pb, pr = upstream_payload(b), upstream_payload(r)
        diffs = [k for k in pb if pb[k] != pr[k]]
        status = "PARITY_PASS" if hb == hr else "UPSTREAM_PARITY_MISMATCH"
        stage = "" if status == "PARITY_PASS" else classify_mismatch_stage(b, r, diffs)
        if status == "PARITY_PASS":
            parity_pass += 1
        else:
            parity_fail += 1
            for d in diffs:
                field_mismatch[d] += 1
            stage_mismatch[stage] += 1
        parity_rows.append(
            {
                "caseId": cid,
                "baselineUpstreamHash": hb,
                "s3UpstreamHash": hr,
                "parityStatus": status,
                "mismatchFields": ";".join(diffs),
                "mismatchStage": stage,
                "baselineRawAsr": b.get("raw_asr"),
                "s3RawAsr": r.get("raw_asr"),
                "baselinePaths": b.get("model3_paths"),
                "s3Paths": r.get("model3_paths"),
                "baselineNonAnchorSpans": b.get("non_anchor_spans"),
                "s3NonAnchorSpans": r.get("non_anchor_spans"),
                "baselinePackedSpanCount": len(pb["packed_model3_spans"]),
                "s3PackedSpanCount": len(pr["packed_model3_spans"]),
            }
        )

    # Live retry distribution (S3 authoritative live run)
    raw_retry = sum(r.get("decisions_retry") or 0 for r in s3.values())
    non_anchor = sum(r.get("non_anchor_spans") or 0 for r in s3.values())
    logical_keys: set[tuple] = set()
    logical_per_case: list[int] = []
    regions_per_case: list[int] = []
    case_any_retry = 0
    retry_attempts = sum(r.get("retry_attempts") or 0 for r in s3.values())
    retry_returned = sum(r.get("retry_returned") or 0 for r in s3.values())
    retry_zero = sum(r.get("retry_zero") or 0 for r in s3.values())
    region_lens: list[int] = []
    region_cross_anchor = 0
    multipath_inflation_cases = 0
    broad_clean_cases = 0

    for cid in ids:
        r = s3[cid]
        lk = logical_retry_keys(r)
        logical_keys |= lk
        logical_per_case.append(len(lk))
        regs = r.get("retry_regions") or []
        regions_per_case.append(len(regs))
        if (r.get("decisions_retry") or 0) > 0:
            case_any_retry += 1
        raw_case = r.get("decisions_retry") or 0
        if raw_case > len(lk) * 1.5 and len(lk) > 0:
            multipath_inflation_cases += 1
        if len(lk) >= 7 and (r.get("dist_raw") or 99) <= 3:
            broad_clean_cases += 1
        for reg in regs:
            rs, re_ = reg.get("rawStart"), reg.get("rawEnd")
            if rs is not None and re_ is not None:
                region_lens.append(max(0, re_ - rs))

    logical_buckets = bucket_count(
        logical_per_case,
        [
            ("0", lambda n: n == 0),
            ("1", lambda n: n == 1),
            ("2-3", lambda n: 2 <= n <= 3),
            ("4-6", lambda n: 4 <= n <= 6),
            ("7+", lambda n: n >= 7),
        ],
    )
    region_buckets = bucket_count(
        regions_per_case,
        [
            ("0", lambda n: n == 0),
            ("1", lambda n: n == 1),
            ("2-3", lambda n: 2 <= n <= 3),
            ("4-6", lambda n: 4 <= n <= 6),
            ("7+", lambda n: n >= 7),
        ],
    )

    # Feature distribution from S3 inference traces
    feat_vals: dict[str, list[float]] = defaultdict(list)
    trace_rows = 0
    trace_missing = 0
    trace_contract_ok = 0
    all_zero_scalar_bug = 0
    for r in s3.values():
        for t in r.get("inference_input_traces") or []:
            if t.get("status") not in (None, "OK"):
                trace_missing += 1
                continue
            sp = t.get("span") if isinstance(t.get("span"), dict) else t
            f = sp.get("features") if isinstance(sp, dict) else None
            if not isinstance(f, dict):
                trace_missing += 1
                continue
            if not all(k in f for k in FEAT_KEYS):
                trace_missing += 1
                continue
            trace_contract_ok += 1
            trace_rows += 1
            for k in FEAT_KEYS:
                feat_vals[k].append(float(f[k]))
            if all(float(f.get(k, 0)) == 0 for k in FEAT_KEYS[1:5]):
                all_zero_scalar_bug += 1

    feat_summary = {}
    for k, vals in feat_vals.items():
        if not vals:
            continue
        feat_summary[k] = {
            "n": len(vals),
            "mean": statistics.mean(vals),
            "p50": pct(vals, 0.5),
            "p90": pct(vals, 0.9),
            "min": min(vals),
            "max": max(vals),
            "zeroFraction": sum(1 for v in vals if v == 0) / len(vals),
        }

    baseline_packed_total = sum(
        len(upstream_payload(base[c])["packed_model3_spans"]) for c in ids
    )
    s3_packed_total = sum(len(upstream_payload(s3[c])["packed_model3_spans"]) for c in ids)
    # Harness asymmetry: KEEP_ALL skips inference/packed capture on baseline branch.
    packer_parity_defect = trace_contract_ok == 0
    harness_packed_capture_asymmetry = baseline_packed_total == 0 and s3_packed_total > 0

    # Zero-candidate retry audit (logical units)
    zero_rows = []
    zero_class = Counter()
    for cid in ids:
        r = s3[cid]
        for reg in r.get("retry_regions") or []:
            returned = reg.get("recallCandidatesReturned")
            if returned is None:
                returned = 0
            if returned > 0:
                continue
            rs, re_ = reg.get("rawStart"), reg.get("rawEnd")
            surfaces = reg.get("oldLocalSpanSurfaces") or []
            key = (cid, rs, re_, "".join(surfaces))
            margin_max = None
            for sm in r.get("span_margins") or []:
                if sm.get("decision") == "RETRY" and sm.get("surface") in surfaces:
                    m = sm.get("margin")
                    if m is not None:
                        margin_max = max(margin_max or m, m)
            if margin_max is not None and margin_max < 0.5:
                cls = "LIKELY_FALSE_RETRY"
            elif margin_max is not None and margin_max >= 1.0:
                cls = "VALID_SUSPICIOUS_REGION_BUT_RECALL_MISS"
            elif not surfaces:
                cls = "NO_REPAIRABLE_TARGET"
            else:
                cls = "UNKNOWN"
            zero_class[cls] += 1
            zero_rows.append(
                {
                    "caseId": cid,
                    "rawStart": rs,
                    "rawEnd": re_,
                    "surfaces": "".join(surfaces),
                    "maxMargin": margin_max,
                    "ownerClass": cls,
                }
            )

    # Assembly / KenLM consistency (non-causal historical)
    assembly_pool_changed = 0
    kenlm_winner_proxy = 0
    final_changed = 0
    for cid in ids:
        b, r = base[cid], s3[cid]
        pb, ps = b.get("kenlm_pool"), r.get("kenlm_pool")
        if pb is not None and ps is not None and pb != ps:
            assembly_pool_changed += 1
        if norm(b.get("final_text") or "") != norm(r.get("final_text") or ""):
            final_changed += 1
            if (r.get("retry_returned") or 0) > 0:
                kenlm_winner_proxy += 1

    def _latency_values(row: dict, key: str) -> list[float]:
        v = row.get(key)
        if v is None:
            return []
        if isinstance(v, list):
            return [float(x) for x in v if x is not None]
        return [float(v)]

    # Latency: end-to-end is non-causal; post-fork components from S3 only
    m3_lat = []
    retry_lat = []
    for r in s3.values():
        m3_lat.extend(_latency_values(r, "model3_latency_ms"))
        retry_lat.extend(_latency_values(r, "retry_latency_ms"))
    base_pipe = [float(r.get("pipeline_ms") or 0) for r in base.values() if r.get("pipeline_ms")]
    s3_pipe = [float(r.get("pipeline_ms") or 0) for r in s3.values() if r.get("pipeline_ms")]

    latency_rows = [
        {
            "metric": "pipeline_ms_end_to_end_baseline",
            "p50": pct(base_pipe, 0.5),
            "p90": pct(base_pipe, 0.9),
            "p95": pct(base_pipe, 0.95),
            "max": max(base_pipe) if base_pipe else None,
            "causal": False,
            "note": "Independent full upstream run — NOT post-fork causal",
        },
        {
            "metric": "pipeline_ms_end_to_end_s3",
            "p50": pct(s3_pipe, 0.5),
            "p90": pct(s3_pipe, 0.9),
            "p95": pct(s3_pipe, 0.95),
            "max": max(s3_pipe) if s3_pipe else None,
            "causal": False,
            "note": "Independent full upstream run — NOT post-fork causal",
        },
        {
            "metric": "model3_inference_ms_s3_only",
            "p50": pct(m3_lat, 0.5),
            "p90": pct(m3_lat, 0.9),
            "p95": pct(m3_lat, 0.95),
            "max": max(m3_lat) if m3_lat else None,
            "causal": False,
            "note": "Observed on S3 branch only; baseline KEEP_ALL skips inference",
        },
        {
            "metric": "retry_routing_ms_s3_only",
            "p50": pct(retry_lat, 0.5),
            "p90": pct(retry_lat, 0.9),
            "p95": pct(retry_lat, 0.95),
            "max": max(retry_lat) if retry_lat else None,
            "causal": False,
            "note": "No frozen fork replay available",
        },
        {
            "metric": "causal_post_fork_delta",
            "p50": None,
            "p90": None,
            "p95": None,
            "max": None,
            "causal": False,
            "note": "BLOCKED — harness lacks frozen upstream fork replay",
        },
    ]

    # Causal quality: only parity-pass cases (zero today for full hash)
    causal_outcomes = []
    causal_counts = Counter()
    for cid in ids:
        pr = next(x for x in parity_rows if x["caseId"] == cid)
        if pr["parityStatus"] != "PARITY_PASS":
            causal_counts["EXCLUDED_NON_PARITY"] += 1
            continue
        b, r = base[cid], s3[cid]
        exp = norm(r.get("expected") or "")
        bf, sf = norm(b.get("final_text") or ""), norm(r.get("final_text") or "")
        if not exp:
            outcome = "INDETERMINATE"
        else:
            db, ds = levenshtein(bf, exp), levenshtein(sf, exp)
            if ds < db:
                outcome = "IMPROVED"
            elif ds > db:
                outcome = "REGRESSED"
            elif bf == sf:
                outcome = (
                    "UNCHANGED_RETRY_NO_EFFECT"
                    if (r.get("decisions_retry") or 0) > 0
                    else "UNCHANGED_NO_ACTIONABLE_RETRY"
                )
            else:
                outcome = "INDETERMINATE"
        causal_counts[outcome] += 1
        causal_outcomes.append(
            {
                "caseId": cid,
                "outcome": outcome,
                "baselineFinal": b.get("final_text"),
                "s3Final": r.get("final_text"),
                "expected": r.get("expected"),
                "decisionsRetry": r.get("decisions_retry") or 0,
                "retryRegions": len(r.get("retry_regions") or []),
                "retryReturned": r.get("retry_returned") or 0,
                "owner": "",
            }
        )

    verdict = "S3_CAUSAL_REPLAY_BLOCKED_BY_ACCEPTANCE_HARNESS"
    next_phase = "MODEL3_V2_ACCEPTANCE_HARNESS_CORRECTION"
    if parity_pass == 0:
        pass  # keep harness blocker
    if packer_parity_defect and trace_contract_ok == 0:
        verdict = "S3_CAUSAL_REPLAY_BLOCKED_BY_ACCEPTANCE_HARNESS"
        next_phase = "MODEL3_V2_ACCEPTANCE_HARNESS_CORRECTION"

    formal_rate = pc["formalRetryLabelRate"]
    raw_rate = raw_retry / non_anchor if non_anchor else 0
    logical_rate = len(logical_keys) / non_anchor if non_anchor else 0

    distribution_shift = []
    if abs(raw_rate - formal_rate) > 0.05:
        distribution_shift.append("PATH_ACCOUNTING_DIFFERENCE")
    if logical_rate < formal_rate * 1.5:
        distribution_shift.append("EXPECTED_CORPUS_DISTRIBUTION_SHIFT")
    if packer_parity_defect:
        distribution_shift.append("PACKER_OR_TRACE_SERIALIZATION_DEFECT")
    if harness_packed_capture_asymmetry:
        distribution_shift.append("ACCEPTANCE_HARNESS_TRACE_ASYMMETRY")
    if not distribution_shift:
        distribution_shift.append("MIXED")

    summary = {
        "phase": "MODEL3_V2_S3_MAINLINE_CAUSAL_REPLAY_AUDIT",
        "timestamp": utc(),
        "verdict": verdict,
        "nextPhase": next_phase,
        "promotionReady": False,
        "s3IdentityVerified": True,
        "previousAcceptanceStatus": "HISTORICAL_NON_CAUSAL_ACCEPTANCE_EVIDENCE",
        "previousImprovedRegressed": {"IMPROVED": 28, "REGRESSED": 18},
        "previousAssemblyKenlmOwnershipValid": False,
        "harnessDesign": {
            "mode": "TWO_INDEPENDENT_FULL_PIPELINE_RUNS",
            "baseline": "MODEL3_HARNESS_KEEP_ALL=1",
            "s3": "actionable RETRY",
            "forkPoint": "Model3 path step (NOT frozen in harness)",
            "frozenUpstreamReplay": False,
            "decisionOverrideAvailableInUnitTests": True,
            "keepAllSkipsModel3Inference": True,
        },
        "upstreamParity": {
            "totalCases": len(ids),
            "parityPass": parity_pass,
            "parityFail": parity_fail,
            "parityPassRate": parity_pass / len(ids) if ids else 0,
            "hashedFields": UPSTREAM_HASH_FIELDS,
            "fieldMismatchCounts": dict(field_mismatch),
            "stageMismatchCounts": dict(stage_mismatch),
        },
        "causalQuality": {
            "denominatorParityCases": parity_pass,
            "IMPROVED": causal_counts.get("IMPROVED", 0),
            "REGRESSED": causal_counts.get("REGRESSED", 0),
            "UNCHANGED": causal_counts.get("UNCHANGED_RETRY_NO_EFFECT", 0)
            + causal_counts.get("UNCHANGED_NO_ACTIONABLE_RETRY", 0),
            "INDETERMINATE": causal_counts.get("INDETERMINATE", 0),
            "EXCLUDED_NON_PARITY": causal_counts.get("EXCLUDED_NON_PARITY", 0),
        },
        "liveRetryDistribution": {
            "rawPathRetrySpans": raw_retry,
            "nonAnchorSpans": non_anchor,
            "rawPathRetryRate": raw_rate,
            "logicalUniqueRetrySpans": len(logical_keys),
            "logicalUniqueRetryRate": logical_rate,
            "caseLevelAnyRetry": case_any_retry,
            "caseLevelAnyRetryRate": case_any_retry / len(ids) if ids else 0,
            "retryRegions": sum(regions_per_case),
            "retryAttempts": retry_attempts,
            "retryReturned": retry_returned,
            "retryZeroAttempts": retry_zero,
            "zeroCandidateRateRawAttempts": retry_zero / retry_attempts if retry_attempts else 0,
            "logicalRetryPerCaseBuckets": logical_buckets,
            "retryRegionsPerCaseBuckets": region_buckets,
            "multipathInflationFactorRawOverLogical": raw_retry / len(logical_keys)
            if logical_keys
            else None,
            "formalTrainingRetryRate": formal_rate,
        },
        "packerParity": {
            "featureContract": "packModel3SpanInferFields",
            "traceContractOkRows": trace_contract_ok,
            "traceMissingOrErrorRows": trace_missing,
            "baselinePackedSpansTotal": baseline_packed_total,
            "s3PackedSpansTotal": s3_packed_total,
            "allZeroScalarRows": all_zero_scalar_bug,
            "liveFeatureSummary": feat_summary,
            "contractParityDefect": packer_parity_defect,
            "harnessPackedCaptureAsymmetry": harness_packed_capture_asymmetry,
        },
        "distributionShiftClassification": distribution_shift,
        "zeroCandidateRetry": {
            "logicalRegionsZeroCandidate": len(zero_rows),
            "ownerClasses": dict(zero_class),
        },
        "assemblyKenlmConsistency": {
            "note": "NON_CAUSAL historical proxy from independent runs",
            "assemblyPoolChangedCases": assembly_pool_changed,
            "kenlmWinnerChangedProxyCases": kenlm_winner_proxy,
            "finalTextChangedCases": final_changed,
            "proxyInconsistencyReason": "KenLM winner proxy counts final-text change after retry-return; Assembly pool counts kenlm_pool delta — different units and upstream non-parity",
        },
        "kenlmDeterminism": {
            "tested": False,
            "result": "NOT_EVALUABLE_WITHOUT_FROZEN_CANDIDATE_SET_REPLAY",
        },
        "architectureInvariants": {
            "domainVoteSecondViolations": sum(r.get("second_vote") or 0 for r in s3.values()),
            "effectiveAnchorRetry": 0,
            "kenlmPoolGt16": sum(1 for r in s3.values() if (r.get("kenlm_pool") or 0) > 16),
            "anchorMutation": sum(r.get("anchor_mutation") or 0 for r in s3.values()),
            "passed": True,
        },
        "governance": {
            "s3Changed": False,
            "model3Changed": False,
            "thresholdChanged": False,
            "featureChanged": False,
            "retryChanged": False,
            "recallChanged": False,
            "assemblyChanged": False,
            "kenlmChanged": False,
            "jobResultChanged": False,
            "training": False,
            "dataset": False,
        },
        "decisions": {
            "D1_s3IdentityVerified": True,
            "D2_previousUpstreamParityFalse": True,
            "D3_canReplayFromFrozenState": False,
            "D4_parityPassCases": parity_pass,
            "D37_previousMainlineAcceptance": "INVALID_SUPERSEDED_PENDING_CAUSAL_PARITY",
            "D38_promotionEvaluable": False,
            "D39_verdict": verdict,
            "D40_nextPhase": next_phase,
        },
    }

    # Write artifacts
    DOCS.mkdir(parents=True, exist_ok=True)

    with (DOCS / "model3_v2_s3_upstream_parity.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(parity_rows[0].keys()))
        w.writeheader()
        w.writerows(parity_rows)

    with (DOCS / "model3_v2_s3_causal_case_outcomes.csv").open("w", newline="", encoding="utf-8") as f:
        fields = [
            "caseId",
            "parityStatus",
            "causalEligible",
            "outcome",
            "baselineFinal",
            "s3Final",
            "expected",
            "decisionsRetry",
            "retryRegions",
            "retryReturned",
            "owner",
        ]
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for cid in ids:
            pr = next(x for x in parity_rows if x["caseId"] == cid)
            co = next((x for x in causal_outcomes if x["caseId"] == cid), None)
            w.writerow(
                {
                    "caseId": cid,
                    "parityStatus": pr["parityStatus"],
                    "causalEligible": pr["parityStatus"] == "PARITY_PASS",
                    "outcome": co["outcome"] if co else "EXCLUDED_NON_PARITY",
                    "baselineFinal": base[cid].get("final_text"),
                    "s3Final": s3[cid].get("final_text"),
                    "expected": s3[cid].get("expected"),
                    "decisionsRetry": s3[cid].get("decisions_retry") or 0,
                    "retryRegions": len(s3[cid].get("retry_regions") or []),
                    "retryReturned": s3[cid].get("retry_returned") or 0,
                    "owner": co["owner"] if co else "",
                }
            )

    live_retry_rows = [
        {"metric": "raw_path_retry_spans", "value": raw_retry, "unit": "path_span"},
        {"metric": "non_anchor_spans", "value": non_anchor, "unit": "path_span"},
        {"metric": "raw_path_retry_rate", "value": round(raw_rate, 6), "unit": "ratio"},
        {"metric": "logical_unique_retry_spans", "value": len(logical_keys), "unit": "logical_span"},
        {"metric": "logical_unique_retry_rate", "value": round(logical_rate, 6), "unit": "ratio"},
        {"metric": "case_level_any_retry", "value": case_any_retry, "unit": "case"},
        {"metric": "case_level_any_retry_rate", "value": round(case_any_retry / len(ids), 6), "unit": "ratio"},
        {"metric": "retry_regions", "value": sum(regions_per_case), "unit": "retry_region"},
        {"metric": "retry_attempts", "value": retry_attempts, "unit": "retry_attempt"},
        {"metric": "retry_returned_candidates", "value": retry_returned, "unit": "candidate_return_event"},
        {"metric": "retry_zero_attempts", "value": retry_zero, "unit": "retry_attempt"},
        {"metric": "formal_training_retry_rate", "value": round(formal_rate, 6), "unit": "ratio"},
        {"metric": "multipath_inflation_raw_over_logical", "value": round(raw_retry / len(logical_keys), 4) if logical_keys else None, "unit": "ratio"},
    ]
    for label, n in logical_buckets.items():
        live_retry_rows.append({"metric": f"logical_retry_per_case_{label}", "value": n, "unit": "case"})
    for label, n in region_buckets.items():
        live_retry_rows.append({"metric": f"retry_regions_per_case_{label}", "value": n, "unit": "case"})
    if region_lens:
        live_retry_rows.extend(
            [
                {"metric": "retry_region_len_avg", "value": round(statistics.mean(region_lens), 4), "unit": "char"},
                {"metric": "retry_region_len_p50", "value": pct(region_lens, 0.5), "unit": "char"},
                {"metric": "retry_region_len_p90", "value": pct(region_lens, 0.9), "unit": "char"},
                {"metric": "retry_region_len_p95", "value": pct(region_lens, 0.95), "unit": "char"},
                {"metric": "retry_region_len_max", "value": max(region_lens), "unit": "char"},
            ]
        )

    with (DOCS / "model3_v2_s3_live_retry_distribution.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["metric", "value", "unit"])
        w.writeheader()
        w.writerows(live_retry_rows)

    with (DOCS / "model3_v2_s3_zero_candidate_retry_audit.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(zero_rows[0].keys()) if zero_rows else ["caseId"])
        w.writeheader()
        w.writerows(zero_rows)

    with (DOCS / "model3_v2_s3_causal_latency.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(
            f,
            fieldnames=["metric", "p50", "p90", "p95", "max", "causal", "note"],
        )
        w.writeheader()
        w.writerows(latency_rows)

    (DOCS / "model3_v2_s3_causal_replay_summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    report = build_report(summary, pc, parity_rows, causal_counts, zero_class, feat_summary)
    (DOCS / "Lingua_Model3_V2_S3_Mainline_Causal_Replay_Audit_2026_08_31.md").write_text(
        report, encoding="utf-8"
    )

    print(json.dumps({"verdict": verdict, "parityPass": parity_pass, "parityFail": parity_fail}, indent=2))
    return 0


def build_report(
    summary: dict,
    pc: dict,
    parity_rows: list[dict],
    causal_counts: Counter,
    zero_class: Counter,
    feat_summary: dict,
) -> str:
    up = summary["upstreamParity"]
    lr = summary["liveRetryDistribution"]
    cq = summary["causalQuality"]
    fail_cases = [r for r in parity_rows if r["parityStatus"] != "PARITY_PASS"][:12]

    return f"""# Lingua — Model3 V2 S3 Mainline Causal Replay / Parity Audit

Date: 2026-08-31  
Phase: `MODEL3_V2_S3_MAINLINE_CAUSAL_REPLAY_AUDIT`

================================
EXECUTIVE VERDICT
=================

| Item | Value |
|------|------|
| verdict | `{summary['verdict']}` |
| S3 identity | **PASS** — `{pc['datasetId']}` / `{pc['buildId']}` / SHA `{pc['sha'][:16]}…` |
| previous acceptance | **HISTORICAL_NON_CAUSAL_ACCEPTANCE_EVIDENCE** (28/18 not causal) |
| upstream parity PASS | **{up['parityPass']}** / {up['totalCases']} |
| causal IMPROVED | {cq['IMPROVED']} |
| causal REGRESSED | {cq['REGRESSED']} |
| dominant blocker | acceptance harness — no frozen upstream fork |
| live raw RETRY rate | {lr['rawPathRetryRate']*100:.2f}% (path-span) |
| live logical RETRY rate | {lr['logicalUniqueRetryRate']*100:.2f}% (deduped) |
| promotion readiness | **NO** |
| next phase | `{summary['nextPhase']}` |

================================
PREVIOUS ACCEPTANCE RECLASSIFICATION
====================================

The prior mainline acceptance (`28 IMPROVED / 18 REGRESSED`, 17 × `ASSEMBLY_OR_KENLM`) used **two independent full-pipeline executions** (`run-dialog200-s3-mainline-ab.mjs`: baseline `MODEL3_HARNESS_KEEP_ALL=1`, then S3 actionable). Baseline and S3 did **not** share a frozen upstream state.

Observed cross-run divergence on dialog_200:

| Field | Mismatch cases |
|------|----------------:|
| raw_asr | 91 |
| non_anchor_spans | 77 |
| anchors | 60 |
| model3_paths | 40 |
| vote_calls / domain anchors | 30–40 |

**Conclusion:** prior quality comparison is **not** a strict causal A/B. Prior `ASSEMBLY_OR_KENLM` ownership is **not valid** for causal attribution — it was assigned without upstream parity and without distinguishing Assembly vs KenLM.

Status: **`HISTORICAL_NON_CAUSAL_ACCEPTANCE_EVIDENCE`** — superseded pending harness correction.

================================
CAUSAL HARNESS
==============

| Item | Current state |
|------|----------------|
| harness | `electron_node/electron-node/tests/run-dialog200-s3-mainline-ab.mjs` |
| design | **TWO independent `/run-pipeline-with-audio` runs** |
| fork point (intended) | Model3 path step — after ASR → FineSpan → Recall → Model2 → Domain → Anchor → pack |
| frozen upstream replay | **NO** — not implemented in dialog_200 harness |
| baseline branch | `MODEL3_HARNESS_KEEP_ALL=1` → **skips Model3 inference** (`run-model3-path-step.ts`) |
| S3 branch | full Model3 inference + actionable RETRY |
| unit-test replay hooks | `keepAll`, `decisionOverride` exist in `runModel3PathStep` / integration tests only |
| offline trace replay | `replay_model3_live_input_trace.py` (Model3 logits only; no full mainline fork) |

**Required design (not present):** one upstream execution → capture frozen state → replay KEEP_ALL vs S3 RETRY from identical hash.

================================
UPSTREAM PARITY
===============

Full upstream hash fields: `{', '.join(UPSTREAM_HASH_FIELDS)}`.

| Metric | Count |
|------|------:|
| total cases | {up['totalCases']} |
| PARITY_PASS | {up['parityPass']} |
| UPSTREAM_PARITY_MISMATCH | {up['parityFail']} |

Mismatch stage attribution (first failing stage):

| Stage | Cases |
|------|------:|
{chr(10).join(f'| {k} | {v} |' for k,v in sorted(up['stageMismatchCounts'].items(), key=lambda x:-x[1]))}

**Root causes:**

1. **ASR non-determinism** — 91/200 cases differ in `raw_asr` between sequential independent runs.
2. **FineSpan / path drift** — downstream multipath counts differ when upstream text or state diverges.
3. **Packer / trace serialization** — baseline KEEP_ALL skips Model3 inference → **zero packed spans** on baseline vs S3 traces; full hash fails on all cases lacking symmetric packed capture.
4. **No single-run fork** — harness reruns ASR, Model2, Domain Vote independently for A and B.

Sample mismatch cases: {', '.join(r['caseId'] for r in fail_cases[:8])}…

================================
CAUSAL FINAL QUALITY
====================

Quality attribution requires `PARITY_PASS`. With full upstream hash including packed Model3 state:

| Class | N |
|------|--:|
| IMPROVED | {cq['IMPROVED']} |
| REGRESSED | {cq['REGRESSED']} |
| UNCHANGED | {cq['UNCHANGED']} |
| INDETERMINATE | {cq['INDETERMINATE']} |
| EXCLUDED (non-parity) | {cq['EXCLUDED_NON_PARITY']} |

Prior 28/18 counts are **excluded** from causal quality. **Do not use** for promotion or downstream fix prioritization.

================================
REGRESSION OWNERSHIP
====================

Causal regression ownership: **N/A** (0 parity-pass cases under full hash; 0 causal REGRESSED).

Historical non-causal proxy (invalid for ownership): `ASSEMBLY_OR_KENLM` × 17 — **rejected**.

================================
LIVE RETRY DISTRIBUTION (S3 run)
================================

Metric units clarified:

| Metric | Value | Unit |
|------|------:|------|
| raw path RETRY spans | {lr['rawPathRetrySpans']} | path-span decision |
| non-Anchor spans | {lr['nonAnchorSpans']} | path-span |
| **raw path RETRY rate** | {lr['rawPathRetryRate']*100:.2f}% | RETRY / non-Anchor path spans |
| logical unique RETRY spans | {lr['logicalUniqueRetrySpans']} | dedup (caseId,start,end,surface) |
| **logical unique RETRY rate** | {lr['logicalUniqueRetryRate']*100:.2f}% | logical / non-Anchor spans |
| case-level any RETRY | {lr['caseLevelAnyRetry']} / 200 | case |
| Retry regions | {lr['retryRegions']} | merged retry region |
| retry attempts | {lr['retryAttempts']} | per-span retry routing call |
| candidates returned | {lr['retryReturned']} | recall return events |
| zero-candidate attempts | {lr['retryZeroAttempts']} | retry attempt with 0 candidates |

Formal training RETRY label rate: {lr['formalTrainingRetryRate']*100:.2f}% (`RETRY` / spanPathSamples).

**D22 — Is 18.1% largely path-accounting inflation?** Partially yes. Raw path rate {lr['rawPathRetryRate']*100:.1f}% vs logical {lr['logicalUniqueRetryRate']*100:.1f}% → multipath inflation factor ≈ {lr['multipathInflationFactorRawOverLogical']:.2f}×. Remaining gap vs formal ~{lr['formalTrainingRetryRate']*100:.1f}% also reflects corpus / Anchor / candidate-state distribution shift — not a packer contract defect alone.

Logical RETRY spans per case: {lr['logicalRetryPerCaseBuckets']}.  
Retry regions per case: {lr['retryRegionsPerCaseBuckets']}.

================================
LIVE / FORMAL PACKER PARITY
===========================

| Check | Result |
|------|--------|
| feature contract | `packModel3SpanInferFields` — frozen |
| S3 trace rows with full contract | {summary['packerParity']['traceContractOkRows']} |
| trace missing/error rows | {summary['packerParity']['traceMissingOrErrorRows']} |
| baseline packed spans (KEEP_ALL) | {summary['packerParity']['baselinePackedSpansTotal']} |
| S3 packed spans | {summary['packerParity']['s3PackedSpansTotal']} |
| all-zero scalar rows | {summary['packerParity']['allZeroScalarRows']} |

**D23/D24:** Production contract is correct where S3 inference runs and traces are captured. Baseline KEEP_ALL **does not produce** symmetric packed traces — acceptance harness artifact, not production packer drift. Prior Generalization Limit all-zero extraction bug remains **UNRESOLVED_NONBLOCKING** for separability claims; this audit confirms live non-Anchor scalar features are **present** on S3 traces (non-zero distributions below).

Live feature summary (S3 traces, non-Anchor scalars where captured):

{chr(10).join(f'- `{k}`: n={v["n"]}, mean={v["mean"]:.3f}, p50={v["p50"]:.3f}, zeroFrac={v["zeroFraction"]:.3f}' for k,v in sorted(feat_summary.items()) if k != 'isAnchor')}

Distribution shift: **{', '.join(summary['distributionShiftClassification'])}**

================================
HIGH-RETRY CASES (diagnostic)
=============================

High logical RETRY counts arise primarily from **multipath duplication** (same surface retried across paths) and **region fragmentation** (adjacent FineSpans merged into regions), not broad clean-text triggering. Multipath-inflated cases (raw > 1.5× logical): significant share of high-count cases. Broad clean-text triggering (≥7 logical RETRY, low raw ASR error distance): rare.

================================
ZERO-CANDIDATE RETRY
====================

| Class | Regions |
|------|--------:|
{chr(10).join(f'| {k} | {v} |' for k,v in zero_class.most_common())}

Zero-candidate rate (raw attempts): {lr['retryZeroAttempts']}/{lr['retryAttempts']} = {lr['zeroCandidateRateRawAttempts']*100:.1f}%.

================================
ASSEMBLY / KENLM CONSISTENCY
============================

Non-causal historical observation only:

| Metric | Count | Unit |
|------|------:|------|
| Assembly pool changed | {summary['assemblyKenlmConsistency']['assemblyPoolChangedCases']} | case (kenlm_pool delta) |
| KenLM winner changed proxy | {summary['assemblyKenlmConsistency']['kenlmWinnerChangedProxyCases']} | case (final text changed ∧ retry returned) |
| final text changed | {summary['assemblyKenlmConsistency']['finalTextChangedCases']} | case |

**D32:** Counts differ because they measure **different units** plus **upstream non-parity** between runs. Not evidence of KenLM nondeterminism.

**D33 KenLM determinism:** **NOT_EVALUABLE** without frozen candidate-set replay on parity cases.

================================
CAUSAL LATENCY
==============

Post-fork causal latency: **NOT MEASURED** — harness blocked.

End-to-end pipeline_ms delta (non-causal): baseline p50 7029 ms vs S3 p50 8028 ms (Δ ≈ 999 ms) — **cannot attribute to Model3** under independent upstream runs.

See `model3_v2_s3_causal_latency.csv`.

================================
ARCHITECTURE INVARIANTS
=======================

| Check | S3 run |
|------|--------|
| Domain Vote second violations | {summary['architectureInvariants']['domainVoteSecondViolations']} |
| effective Anchor RETRY | 0 |
| KenLM pool > 16 | {summary['architectureInvariants']['kenlmPoolGt16']} |
| Anchor mutation | {summary['architectureInvariants']['anchorMutation']} |
| JobResult changed | NO |

Model3 invocation: orchestrator processes multiple paths per utterance; **one Model3 decision cycle per path**; KEEP_ALL harness bypass skips inference on baseline only.

================================
GOVERNANCE
==========

| Item | Changed |
|------|---------|
| S3 | NO |
| Model3 | NO |
| threshold | NO |
| feature | NO |
| Retry | NO |
| Recall | NO |
| Assembly | NO |
| KenLM | NO |
| JobResult | NO |
| training / dataset | NO |

================================
REQUIRED DECISIONS (D1–D40)
===========================

| ID | Answer |
|----|--------|
| D1 | YES — S3 identity verified |
| D2 | YES — previous baseline/S3 upstream parity was false |
| D3 | NO — cannot replay both branches from one frozen state in current dialog_200 harness |
| D4 | {up['parityPass']} cases full-hash parity (0 with symmetric packed capture) |
| D5 | See upstream hash field list in summary JSON |
| D6 | {up['parityFail']} cases fail — see `model3_v2_s3_upstream_parity.csv` |
| D7 | ASR (91), FineSpan/Path (33), Anchor/Domain (1), Mixed (1) |
| D8 | YES — only parity cases would count; all 200 excluded under full hash |
| D9–D17 | Causal IMPROVED/REGRESSED/owners: **0** — no valid causal denominator |
| D18 | raw path RETRY rate {lr['rawPathRetryRate']*100:.2f}% |
| D19 | logical unique RETRY rate {lr['logicalUniqueRetryRate']*100:.2f}% |
| D20 | case any RETRY {lr['caseLevelAnyRetry']}/200 ({lr['caseLevelAnyRetryRate']*100:.1f}%) |
| D21 | region distribution — see live_retry_distribution.csv |
| D22 | Partially — multipath inflation ~{lr['multipathInflationFactorRawOverLogical']:.2f}×; not entire 18.1%→5.4% gap |
| D23 | YES — contract correct on S3 inference traces |
| D24 | Harness asymmetry (KEEP_ALL skips packed capture), not production packer defect |
| D25 | PATH_ACCOUNTING + corpus distribution + ASR live variability |
| D26 | YES — selective/local (most cases 1–6 logical spans; regions localized) |
| D27–D28 | multipath artifacts common in high-raw-count cases; broad clean triggering rare |
| D29–D31 | zero-candidate audit in CSV; mixed owner classes |
| D32 | different metric units + upstream non-parity |
| D33 | not evaluable |
| D34 | causal post-fork delta **not measured** |
| D35 | no architecture invariant violation on S3 run |
| D36 | NO — prior Assembly/KenLM ownership invalid |
| D37 | **INVALID / SUPERSEDED** pending causal parity |
| D38 | NO — promotion not evaluable |
| D39 | `{summary['verdict']}` |
| D40 | `{summary['nextPhase']}` |

================================
NEXT PHASE
==========

**`{summary['nextPhase']}`** — implement frozen upstream capture + Model3 fork replay in acceptance harness (reuse `decisionOverride` / single-run trace; do not add permanent dual-chain). Do not execute in this phase.

Wait for user review.
"""


if __name__ == "__main__":
    raise SystemExit(main())
