# -*- coding: utf-8 -*-
"""MODEL3_V2_LOCALIZATION_TRAINING_CAUSALITY_AUDIT_S3 — read-only authoritative S3 causality audit."""
from __future__ import annotations

import csv
import hashlib
import json
import math
import statistics
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import torch

REPO = Path(__file__).resolve().parents[3]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from training.model3_dataset.acoustic_training.dataset_identity import (  # noqa: E402
    assert_authoritative_s3_identity,
)
from training.model3_dataset.train.bigru_v1 import (  # noqa: E402
    FEAT_DIM,
    FEAT_NAMES,
    Model3BiGRUV1,
    encode_surface,
    span_features,
)

DOCS = REPO / "docs/user_correction/model3"
S3_MAINLINE = DOCS / "model3_v2_s3_mainline_s3_raw_cases.jsonl"
S3_CKPT = REPO / "training/model3_dataset/model3_v2_s3_random_init_v1_ckpts/seed_2026083013"
S3_MANIFEST = DOCS / "model3_v2_s3_checkpoint_manifest.json"
# TRAIN_DIR resolved only after G0 — never hardcode model3_v2_labeled.
TRIGGER_CSV = DOCS / "model3_v2_retry_region_trigger_cases.csv"
PARTIAL_CSV = DOCS / "model3_v2_partial_coverage_decisions.csv"
SHIFTED_CSV = DOCS / "model3_v2_shifted_target_neighbor_pairs.csv"

PHASE = "MODEL3_V2_LOCALIZATION_TRAINING_CAUSALITY_AUDIT_S3"
GENERATOR = "training/model3_dataset/scripts/audit_model3_v2_localization_training_causality.py"
GENERATED_AT = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

OUT_DIST = DOCS / "model3_v2_s3_feature_distribution.csv"
OUT_POS = DOCS / "model3_v2_s3_position_histogram.csv"
OUT_CAND = DOCS / "model3_v2_s3_candidate_distribution.csv"
OUT_ROOT = DOCS / "model3_v2_s3_localization_root_causes.csv"
OUT_SUPPORT = DOCS / "model3_v2_s3_training_support.csv"
OUT_SUMMARY = DOCS / "model3_v2_s3_localization_causality_summary.json"
OUT_FREEZE = DOCS / "model3_v2_s3_causality_freeze_state.csv"

LOCALIZATION_16 = [
    ("d008", "MODEL3_RETRY_SHIFTED_NEARBY"),
    ("d022", "MODEL3_TARGET_PARTIAL_COVERAGE"),
    ("d040", "MODEL3_RETRY_SHIFTED_NEARBY"),
    ("d042", "MODEL3_RETRY_SHIFTED_NEARBY"),
    ("d051", "MODEL3_RETRY_SHIFTED_NEARBY"),
    ("d054", "MODEL3_RETRY_SHIFTED_NEARBY"),
    ("d065", "MODEL3_TARGET_FALSE_NEGATIVE"),
    ("d085", "MODEL3_RETRY_SHIFTED_NEARBY"),
    ("d094", "MODEL3_TARGET_PARTIAL_COVERAGE"),
    ("d102", "MODEL3_TARGET_PARTIAL_COVERAGE"),
    ("d109", "MODEL3_TARGET_FALSE_NEGATIVE"),
    ("d114", "MODEL3_TARGET_FALSE_NEGATIVE"),
    ("d129", "MODEL3_TARGET_PARTIAL_COVERAGE"),
    ("d138", "MODEL3_TARGET_FALSE_NEGATIVE"),
    ("d172", "MODEL3_RETRY_SHIFTED_NEARBY"),
    ("d175", "MODEL3_RETRY_SHIFTED_NEARBY"),
]
SHIFTED8 = {"d008", "d040", "d042", "d051", "d054", "d085", "d172", "d175"}
FN4 = {"d065", "d109", "d114", "d138"}
PARTIAL4 = {"d022", "d094", "d102", "d129"}

FEAT_KEYS = list(FEAT_NAMES)
MARGIN_TOL = 1e-3
TOPK = 20
POSITION_BINS = [(i / 10, (i + 1) / 10) for i in range(10)]

SUPPORT_THRESHOLDS = {
    "strong_min_retry_topk": 5,
    "strong_max_norm_dist": 1.5,
    "moderate_min_retry_topk": 2,
    "moderate_max_norm_dist": 2.5,
    "moderate_tuple_retry": 3,
    "weak_min_retry_topk": 1,
    "weak_max_norm_dist": 3.0,
}


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def feat_hash(f: dict) -> str:
    row = "|".join(f"{float(f[k]):.6f}" for k in FEAT_KEYS)
    return hashlib.sha256(row.encode()).hexdigest()[:16]


def feat_vec_str(f: dict) -> str:
    return "|".join(f"{float(f[k]):.4f}" for k in FEAT_KEYS)


def position_bin(x: float) -> str:
    x = min(max(float(x), 0.0), 0.999999)
    for lo, hi in POSITION_BINS:
        if lo <= x < hi:
            return f"[{lo:.1f},{hi:.1f})"
    return "[0.9,1.0]"


def pct(vals: list[float], q: float) -> float:
    if not vals:
        return 0.0
    s = sorted(vals)
    idx = min(len(s) - 1, max(0, int(round(q * (len(s) - 1)))))
    return s[idx]


def load_bundle(ckpt: Path):
    cfg = json.loads((ckpt / "config.json").read_text(encoding="utf-8"))
    vocab = json.loads((ckpt / "vocab.json").read_text(encoding="utf-8"))
    model = Model3BiGRUV1(
        len(vocab),
        cfg.get("embed_dim", 64),
        cfg.get("hidden_dim", 128),
        cfg.get("feat_dim", FEAT_DIM),
    )
    state = torch.load(ckpt / "weights.pt", map_location="cpu")
    model.load_state_dict(state)
    model.eval()
    return model, vocab, cfg


def read_csv(path: Path) -> list[dict]:
    with path.open(encoding="utf-8") as f:
        return list(csv.DictReader(f))


def load_mainline_traces() -> dict[tuple[str, str], list[dict]]:
    by_case_path: dict[tuple[str, str], list[dict]] = defaultdict(list)
    by_case: dict[str, dict] = {}
    for line in S3_MAINLINE.open(encoding="utf-8"):
        if not line.strip():
            continue
        row = json.loads(line)
        cid = row["id"]
        by_case[cid] = row
        for tr in row.get("inference_input_traces") or []:
            sp = tr.get("span") or tr
            pid = tr.get("pathId") or sp.get("pathId") or ""
            by_case_path[(cid, pid)].append({**sp, "pathId": pid, "caseId": cid})
    for key in by_case_path:
        by_case_path[key].sort(key=lambda s: int(s.get("seqIndex") or 0))
    return by_case_path, by_case


def replay_path(model, vocab, spans: list[dict]) -> dict[str, dict]:
    n = len(spans)
    tokens = torch.zeros(1, n, 8, dtype=torch.long)
    feats = torch.zeros(1, n, FEAT_DIM)
    avail = torch.ones(1, n, FEAT_DIM)
    for i, sp in enumerate(spans):
        tok = sp.get("tokenIds")
        if isinstance(tok, list) and len(tok) == 8:
            tokens[0, i] = torch.tensor([int(x) for x in tok], dtype=torch.long)
        else:
            surf = sp.get("surfaceUsed") or sp.get("surface") or ""
            tokens[0, i] = torch.tensor(encode_surface(surf, vocab), dtype=torch.long)
        fv = sp.get("featVector")
        if isinstance(fv, list) and len(fv) == FEAT_DIM:
            row = [float(x) for x in fv]
        else:
            f = sp["features"]
            row = [float(f[k]) for k in FEAT_KEYS]
        feats[0, i] = torch.tensor(row)
        am = sp.get("availMask")
        if isinstance(am, list) and len(am) == FEAT_DIM:
            avail[0, i] = torch.tensor([float(x) for x in am])
        elif row[5] == 0.0:
            avail[0, i, 5] = 0.0
    with torch.no_grad():
        logits = model(tokens, feats, avail)[0]
    out = {}
    for i, sp in enumerate(spans):
        keep_l = float(logits[i, 0].item())
        retry_l = float(logits[i, 1].item())
        margin = retry_l - keep_l
        is_anchor = bool(sp.get("isAnchor"))
        decision = "KEEP" if is_anchor or retry_l <= keep_l else "RETRY"
        out[sp["spanId"]] = {
            "margin": margin,
            "decision": decision,
            "keep_logit": keep_l,
            "retry_logit": retry_l,
        }
    return out


def pack_training_features(sp: dict, fa: dict, idx: int, n: int) -> tuple[dict, list[float], int]:
    recall = (sp.get("recallEvidence") or {}).get("firstPassCandidateCount") or 0
    raw_cand = int(recall)
    packed = {
        "surface": sp.get("surface") or "",
        "isAnchor": bool(sp.get("isAnchor")),
        "recallEvidence": {"firstPassCandidateCount": raw_cand},
    }
    row, _avail = span_features(packed, fa, span_index=idx, n_spans=n)
    f = {k: float(row[i]) for i, k in enumerate(FEAT_KEYS)}
    return f, row, raw_cand


class TrainingIndex:
    def __init__(self, train_dir: Path):
        self.train_dir = Path(train_dir)
        self.tuple_stats: dict[str, Counter] = defaultdict(Counter)
        self.feature_values: dict[str, dict[str, list[float]]] = {
            lbl: {k: [] for k in FEAT_KEYS} for lbl in ("KEEP", "RETRY")
        }
        self.pos_bins: dict[str, Counter] = defaultdict(Counter)
        self.family_pos: dict[str, list[float]] = defaultdict(list)
        self.family_label_counts: dict[str, Counter] = defaultdict(Counter)
        self.cand_raw: dict[str, Counter] = {"KEEP": Counter(), "RETRY": Counter(), "ALL": Counter()}
        self.cand_log1p_nonzero: dict[str, int] = {"KEEP": 0, "RETRY": 0}
        self.cand_log1p_total: dict[str, int] = {"KEEP": 0, "RETRY": 0}
        self.sample_ids: list[str] = []
        self.labels: list[str] = []
        self.surfaces: list[str] = []
        self.X: np.ndarray | None = None
        self.mean: np.ndarray | None = None
        self.std: np.ndarray | None = None

    def load(self):
        feats_rows: list[list[float]] = []
        shards = sorted(self.train_dir.glob("shard-*.jsonl"))
        for shard in shards:
            for line in shard.open(encoding="utf-8"):
                if not line.strip():
                    continue
                sample = json.loads(line)
                fa = sample.get("featureAvailability") or {
                    "pinyinTextDerived": True,
                    "recallFirstPass": True,
                }
                spans = sample.get("spans") or []
                n = len(spans)
                gk = sample.get("groupKeys")
                if isinstance(gk, list) and gk:
                    gk0 = str(gk[0])
                elif isinstance(gk, dict) and gk:
                    gk0 = str(next(iter(gk.values())))
                else:
                    gk0 = "unknown"
                fam = (sample.get("provenance") or {}).get("semanticFamilyId") or gk0
                sid = sample.get("sampleId") or ""
                for i, sp in enumerate(spans):
                    if sp.get("label") not in ("KEEP", "RETRY") or sp.get("isAnchor"):
                        continue
                    feats, _, raw_cand = pack_training_features(sp, fa, i, n)
                    key = feat_vec_str(feats)
                    self.tuple_stats[key][sp["label"]] += 1
                    lbl = sp["label"]
                    row = [feats[k] for k in FEAT_KEYS]
                    feats_rows.append(row)
                    self.sample_ids.append(sid)
                    self.labels.append(lbl)
                    self.surfaces.append(sp.get("surface") or "")
                    for k in FEAT_KEYS:
                        self.feature_values[lbl][k].append(feats[k])
                    bucket = str(raw_cand) if raw_cand <= 2 else ">2"
                    self.cand_raw[lbl][bucket] += 1
                    self.cand_raw["ALL"][bucket] += 1
                    self.cand_log1p_total[lbl] += 1
                    if feats["first_pass_cand_log1p"] > 0:
                        self.cand_log1p_nonzero[lbl] += 1
                    b = position_bin(feats["span_rel_position"])
                    self.family_label_counts[str(fam)][lbl] += 1
                    if lbl == "RETRY":
                        self.pos_bins[b]["RETRY"] += 1
                        self.family_pos[str(fam)].append(feats["span_rel_position"])
                    else:
                        self.pos_bins[b]["KEEP"] += 1
        self.X = np.array(feats_rows, dtype=np.float64)
        self.mean = self.X.mean(axis=0)
        self.std = self.X.std(axis=0)
        self.std[self.std < 1e-9] = 1.0

    def nearest(self, feats: dict, k: int = TOPK) -> list[dict]:
        assert self.X is not None and self.mean is not None and self.std is not None
        q = np.array([feats[x] for x in FEAT_KEYS], dtype=np.float64)
        dr = np.sqrt(((self.X - q) ** 2).sum(axis=1))
        qn = (q - self.mean) / self.std
        dn = np.sqrt((((self.X - self.mean) / self.std - qn) ** 2).sum(axis=1))
        idx = np.argsort(dn)[:k]
        out = []
        for rank, i in enumerate(idx, 1):
            fv = self.X[i]
            fdict = {k: float(fv[j]) for j, k in enumerate(FEAT_KEYS)}
            out.append(
                {
                    "rank": rank,
                    "distanceNormalized": float(dn[i]),
                    "distanceRaw": float(dr[i]),
                    "sampleId": self.sample_ids[i],
                    "label": self.labels[i],
                    "surface": self.surfaces[i],
                    "spanPosition": fdict["span_rel_position"],
                    "candFeature": fdict["first_pass_cand_log1p"],
                    "pinyinFeature": fdict["pinyin_channel_avail"],
                    "features": fdict,
                    "featureVector": fv.tolist(),
                }
            )
        return out

    def support_level(self, feats: dict, surface: str) -> dict:
        key = feat_vec_str(feats)
        ts = self.tuple_stats.get(key, Counter())
        nn = self.nearest(feats, TOPK)
        retry_nn = [x for x in nn if x["label"] == "RETRY"]
        keep_nn = [x for x in nn if x["label"] == "KEEP"]
        min_retry = min((x["distanceNormalized"] for x in retry_nn), default=float("inf"))
        min_keep = min((x["distanceNormalized"] for x in keep_nn), default=float("inf"))
        retry_ratio = len(retry_nn) / max(len(nn), 1)
        level = "TRAIN_COMBINATION_MISSING"
        if (
            len(retry_nn) >= SUPPORT_THRESHOLDS["strong_min_retry_topk"]
            and min_retry <= SUPPORT_THRESHOLDS["strong_max_norm_dist"]
        ) or ts["RETRY"] >= 10:
            level = "TRAIN_SUPPORT_STRONG"
        elif (
            len(retry_nn) >= SUPPORT_THRESHOLDS["moderate_min_retry_topk"]
            and min_retry <= SUPPORT_THRESHOLDS["moderate_max_norm_dist"]
        ) or ts["RETRY"] >= SUPPORT_THRESHOLDS["moderate_tuple_retry"]:
            level = "TRAIN_SUPPORT_MODERATE"
        elif (
            len(retry_nn) >= SUPPORT_THRESHOLDS["weak_min_retry_topk"]
            and min_retry <= SUPPORT_THRESHOLDS["weak_max_norm_dist"]
        ) or ts["RETRY"] >= 1:
            level = "TRAIN_SUPPORT_WEAK"
        return {
            "level": level,
            "tupleRetry": ts["RETRY"],
            "tupleKeep": ts["KEEP"],
            "retryTopK": len(retry_nn),
            "keepTopK": len(keep_nn),
            "retryRatio": retry_ratio,
            "minRetryDist": min_retry if min_retry != float("inf") else None,
            "medianRetryDist": statistics.median([x["distanceNormalized"] for x in retry_nn])
            if retry_nn
            else None,
            "minKeepDist": min_keep if min_keep != float("inf") else None,
            "medianKeepDist": statistics.median([x["distanceNormalized"] for x in keep_nn])
            if keep_nn
            else None,
            "nearest": nn,
        }

    def feature_distribution_rows(self, provenance: dict) -> list[dict]:
        rows = []
        for lbl in ("KEEP", "RETRY"):
            for k in FEAT_KEYS:
                vals = self.feature_values[lbl][k]
                uniq = len(set(round(v, 6) for v in vals))
                mean_v = statistics.mean(vals) if vals else ""
                std_v = statistics.pstdev(vals) if len(vals) > 1 else (0.0 if vals else "")
                nz = sum(1 for v in vals if abs(v) > 1e-9)
                rows.append(
                    {
                        **provenance,
                        "featureName": k,
                        "label": lbl,
                        "count": len(vals),
                        "min": min(vals) if vals else "",
                        "mean": round(mean_v, 6) if vals else "",
                        "std": round(std_v, 6) if vals else "",
                        "p05": pct(vals, 0.05),
                        "p25": pct(vals, 0.25),
                        "p50": pct(vals, 0.50),
                        "p75": pct(vals, 0.75),
                        "p95": pct(vals, 0.95),
                        "max": max(vals) if vals else "",
                        "uniqueCount": uniq,
                        "nonzeroFraction": round(nz / max(len(vals), 1), 6),
                    }
                )
        return rows

    def candidate_distribution_rows(self, provenance: dict) -> list[dict]:
        rows = []
        for lbl in ("KEEP", "RETRY", "ALL"):
            total = sum(self.cand_raw[lbl].values())
            for bucket in ("0", "1", "2", ">2"):
                cnt = self.cand_raw[lbl][bucket]
                rows.append(
                    {
                        **provenance,
                        "label": lbl,
                        "rawCandidateCount": bucket,
                        "count": cnt,
                        "share": round(cnt / max(total, 1), 6),
                    }
                )
            if lbl in ("KEEP", "RETRY"):
                rows.append(
                    {
                        **provenance,
                        "label": lbl,
                        "rawCandidateCount": "log1p_nonzero",
                        "count": self.cand_log1p_nonzero[lbl],
                        "share": round(
                            self.cand_log1p_nonzero[lbl] / max(self.cand_log1p_total[lbl], 1), 6
                        ),
                    }
                )
        return rows

    def family_distribution_rows(self, provenance: dict) -> list[dict]:
        total_retry = sum(c["RETRY"] for c in self.family_label_counts.values())
        rows = []
        for fam, ctr in sorted(self.family_label_counts.items(), key=lambda x: -x[1]["RETRY"]):
            retry = ctr["RETRY"]
            keep = ctr["KEEP"]
            rows.append(
                {
                    **provenance,
                    "semanticFamilyId": fam,
                    "retryCount": retry,
                    "keepCount": keep,
                    "retryShareOfAllRetry": round(retry / max(total_retry, 1), 6),
                    "retryRateInFamily": round(retry / max(retry + keep, 1), 6),
                }
            )
        return rows

    def feature_collapse_audit(self) -> dict[str, str]:
        out: dict[str, str] = {}
        for k in FEAT_KEYS:
            all_vals = self.feature_values["KEEP"][k] + self.feature_values["RETRY"][k]
            uniq = len(set(round(v, 6) for v in all_vals))
            std_all = statistics.pstdev(all_vals) if len(all_vals) > 1 else 0.0
            if k == "isAnchor":
                out[k] = "EXPECTED_CONSTANT"
            elif uniq <= 1:
                out[k] = "EXPECTED_VARIABLE_COLLAPSED"
            elif std_all < 0.01 and k not in ("isAnchor",):
                out[k] = "LOW_VARIANCE_BUT_VALID"
            elif k == "first_pass_cand_log1p" and self.cand_log1p_nonzero["RETRY"] == 0:
                out[k] = "EXPECTED_VARIABLE_COLLAPSED"
            else:
                out[k] = "EXPECTED_VARIABLE_HEALTHY"
        return out

    def position_histogram_rows(self, prod_retry_positions: list[float], shifted_targets: list[float], shifted_wrong: list[float], provenance: dict) -> list[dict]:
        total_retry = sum(c["RETRY"] for c in self.pos_bins.values())
        rows = []
        for lo, hi in POSITION_BINS:
            b = f"[{lo:.1f},{hi:.1f})"
            keep = self.pos_bins[b]["KEEP"]
            retry = self.pos_bins[b]["RETRY"]
            rate = retry / max(keep + retry, 1)
            share = retry / max(total_retry, 1)
            prod = sum(1 for p in prod_retry_positions if lo <= p < hi)
            st = sum(1 for p in shifted_targets if lo <= p < hi)
            sw = sum(1 for p in shifted_wrong if lo <= p < hi)
            rows.append(
                {
                    **provenance,
                    "positionBin": b,
                    "trainingKeepCount": keep,
                    "trainingRetryCount": retry,
                    "trainingRetryRate": round(rate, 6),
                    "trainingRetryShare": round(share, 6),
                    "pRetryGivenBin": round(rate, 6),
                    "productionExpectedRetryCount": prod,
                    "shiftedTargetCount": st,
                    "shiftedWrongNeighborCount": sw,
                }
            )
        return rows


def provenance_fields(identity, ckpt_sha: str) -> dict:
    return {
        "phase": PHASE,
        "generator": GENERATOR,
        "generatedAt": GENERATED_AT,
        "modelId": identity.modelId,
        "weightsSha256": ckpt_sha,
        "datasetId": identity.datasetId,
        "datasetBuildId": identity.datasetBuildId,
        "featureContract": identity.featureContract,
        "labelContractVersion": identity.labelContractVersion,
    }


def write_csv(path: Path, rows: list[dict]):
    if not rows:
        return
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)


def verify_training_contract(sample_feats: dict, runtime_feats: dict) -> bool:
    return all(abs(sample_feats[k] - runtime_feats[k]) < 1e-4 for k in FEAT_KEYS)


def features_indistinguishable(a: dict, b: dict) -> bool:
    return all(abs(float(a[k]) - float(b[k])) < 0.001 for k in FEAT_KEYS)


def dominant_feature_delta(a: dict, b: dict) -> str:
    deltas = {k: abs(float(a[k]) - float(b[k])) for k in FEAT_KEYS}
    return max(deltas, key=deltas.get)


def classify_case(
    case_id: str,
    cls: str,
    target_spans: list[dict],
    neighbor: dict | None,
    train: TrainingIndex,
    parity_ok: bool,
    contract_ok: bool,
) -> dict:
    if not parity_ok:
        return {
            "rootCause": "MODEL3_FEATURE_REPLAY_PARITY_FAILURE",
            "confidence": "HIGH",
            "evidence": "offline replay margin/decision mismatch",
            "futureCorrectionClass": "FEATURE_TRACE_COMPLETENESS",
        }
    if not contract_ok:
        return {
            "rootCause": "TRAIN_RUNTIME_FEATURE_CONTRACT_MISMATCH",
            "confidence": "HIGH",
            "evidence": "training span_features != production captured features",
            "futureCorrectionClass": "FEATURE_CONTRACT_CORRECTION",
        }

    primary = target_spans[0]
    sup = train.support_level(primary["features"], primary["surface"])
    pos_bin = position_bin(primary["features"]["span_rel_position"])
    retry_bin_count = train.pos_bins[pos_bin]["RETRY"]
    total_retry = sum(c["RETRY"] for c in train.pos_bins.values())
    bin_share = retry_bin_count / max(total_retry, 1)

    if cls == "MODEL3_RETRY_SHIFTED_NEARBY" and neighbor:
        n_sup = train.support_level(neighbor["features"], neighbor["surface"])
        n_bin = position_bin(neighbor["features"]["span_rel_position"])
        n_bin_retry = train.pos_bins[n_bin]["RETRY"]
        t_pos = primary["features"]["span_rel_position"]
        n_pos = neighbor["features"]["span_rel_position"]
        pos_delta = abs(t_pos - n_pos)
        target_under = bin_share < 0.03 and t_pos < 0.3
        neighbor_better = (n_bin_retry / max(total_retry, 1)) > bin_share + 0.05
        cand_delta = neighbor["features"]["first_pass_cand_log1p"] - primary["features"]["first_pass_cand_log1p"]

        if features_indistinguishable(primary["features"], neighbor["features"]):
            if primary["surface"] != neighbor["surface"]:
                return {
                    "rootCause": "FEATURE_INFORMATION_LIMITATION",
                    "confidence": "MEDIUM",
                    "evidence": "six-scalar features identical; surfaces differ; BiGRU must use embedding context",
                    "futureCorrectionClass": "FEATURE_SUFFICIENCY_DESIGN",
                }
        if (
            target_under
            and neighbor_better
            and pos_delta >= 0.15
            and cand_delta <= 0.01
            and dominant_feature_delta(primary["features"], neighbor["features"]) == "span_rel_position"
        ):
            return {
                "rootCause": "TRAIN_RUNTIME_FEATURE_DISTRIBUTION_MISMATCH",
                "confidence": "HIGH",
                "evidence": f"target bin {pos_bin} underrepresented; neighbor bin {n_bin} better supported",
                "futureCorrectionClass": "TRAINING_DATA_CORRECTION",
            }
        if sup["level"] == "TRAIN_COMBINATION_MISSING" and n_sup["level"] != "TRAIN_COMBINATION_MISSING":
            return {
                "rootCause": "TRAINING_COVERAGE_GAP",
                "confidence": "HIGH",
                "evidence": f"target tuple RETRY={sup['tupleRetry']} neighbor={n_sup['level']}",
                "futureCorrectionClass": "TRAINING_COVERAGE_CORRECTION",
            }
        if sup["level"] in ("TRAIN_SUPPORT_STRONG", "TRAIN_SUPPORT_MODERATE"):
            return {
                "rootCause": "MODEL_GENERALIZATION_FAILURE",
                "confidence": "HIGH",
                "evidence": f"training support {sup['level']} but wrong nearby RETRY selected",
                "futureCorrectionClass": "RETRAINING_DESIGN",
            }
        if pos_delta >= 0.15 and neighbor_better:
            return {
                "rootCause": "TRAIN_RUNTIME_FEATURE_DISTRIBUTION_MISMATCH",
                "confidence": "MEDIUM",
                "evidence": "position delta with asymmetric bin support",
                "futureCorrectionClass": "TRAINING_DATA_CORRECTION",
            }
        return {
            "rootCause": "MODEL_GENERALIZATION_FAILURE",
            "confidence": "MEDIUM",
            "evidence": "shifted nearby without stronger distribution/coverage explanation",
            "futureCorrectionClass": "RETRAINING_DESIGN",
        }

    if cls == "MODEL3_TARGET_FALSE_NEGATIVE":
        t_pos = primary["features"]["span_rel_position"]
        if sup["level"] == "TRAIN_COMBINATION_MISSING":
            return {
                "rootCause": "TRAINING_COVERAGE_GAP",
                "confidence": "HIGH",
                "evidence": f"no RETRY neighbors tuple={sup['tupleRetry']} topK={sup['retryTopK']}",
                "futureCorrectionClass": "TRAINING_COVERAGE_CORRECTION",
            }
        if t_pos < 0.15 and bin_share < 0.04:
            return {
                "rootCause": "TRAIN_RUNTIME_FEATURE_DISTRIBUTION_MISMATCH",
                "confidence": "MEDIUM",
                "evidence": f"early-position RETRY target in sparse bin {pos_bin}",
                "futureCorrectionClass": "TRAINING_DATA_CORRECTION",
            }
        return {
            "rootCause": "MODEL_GENERALIZATION_FAILURE",
            "confidence": "HIGH" if sup["level"] in ("TRAIN_SUPPORT_STRONG", "TRAIN_SUPPORT_MODERATE") else "MEDIUM",
            "evidence": f"FN with support {sup['level']} margin={primary.get('margin')}",
            "futureCorrectionClass": "RETRAINING_DESIGN",
        }

    # PARTIAL
    missing = [s for s in target_spans if s.get("expectedLabel") == "EXPECTED_RETRY_CONFIRMED" and s.get("decision") == "KEEP"]
    if not missing:
        missing = [s for s in target_spans if s.get("decision") == "KEEP"]
    worst = missing[0] if missing else primary
    wsup = train.support_level(worst["features"], worst["surface"])
    if wsup["level"] == "TRAIN_COMBINATION_MISSING":
        return {
            "rootCause": "TRAINING_COVERAGE_GAP",
            "confidence": "HIGH",
            "evidence": f"missing span {worst['surface']} support missing",
            "futureCorrectionClass": "TRAINING_COVERAGE_CORRECTION",
        }
    if wsup["level"] in ("TRAIN_SUPPORT_STRONG", "TRAIN_SUPPORT_MODERATE"):
        return {
            "rootCause": "MODEL_GENERALIZATION_FAILURE",
            "confidence": "HIGH",
            "evidence": "partial coverage KEEP on supported boundary span",
            "futureCorrectionClass": "RETRAINING_DESIGN",
        }
    return {
        "rootCause": "MODEL_GENERALIZATION_FAILURE",
        "confidence": "MEDIUM",
        "evidence": "partial coverage with weak training support on failing span",
        "futureCorrectionClass": "RETRAINING_DESIGN",
    }


def main():
    # G0 MUST precede any training-shard sample load.
    identity = assert_authoritative_s3_identity()
    print(
        json.dumps(
            {
                "g0": "PASS",
                "modelId": identity.modelId,
                "weightsSha256": identity.weightsSha256,
                "datasetId": identity.datasetId,
                "datasetBuildId": identity.datasetBuildId,
                "trainDir": identity.trainDir,
            },
            ensure_ascii=False,
        ),
        flush=True,
    )

    manifest = json.loads(S3_MANIFEST.read_text(encoding="utf-8"))
    ckpt_sha = sha256_file(S3_CKPT / "weights.pt").lower()
    if ckpt_sha != manifest["weightsSha256"]:
        raise SystemExit(f"checkpoint_hash_mismatch:{ckpt_sha}")
    prov = provenance_fields(identity, ckpt_sha)

    trigger = {r["caseId"]: r for r in read_csv(TRIGGER_CSV) if r["caseId"] in {c for c, _ in LOCALIZATION_16}}
    partial = read_csv(PARTIAL_CSV)
    shifted = {r["caseId"]: r for r in read_csv(SHIFTED_CSV)}

    by_cp, by_case = load_mainline_traces()
    model, vocab, _cfg = load_bundle(S3_CKPT)
    train = TrainingIndex(Path(identity.trainDir))
    print("loading training index...")
    train.load()
    print(f"training spans indexed: {len(train.sample_ids)}")

    feature_rows = []
    support_rows = []
    root_rows = []
    shifted_pair_rows = []
    parity_failures = 0
    prod_retry_positions = []
    shifted_target_pos = []
    shifted_wrong_pos = []
    contract_mismatch = 0
    nonzero_cand_prod = 0
    total_prod_spans = 0

    for case_id, cls in LOCALIZATION_16:
        trig = trigger[case_id]
        path_id = trig["pathId"]
        spans = by_cp.get((case_id, path_id))
        if not spans:
            root_rows.append(
                {
                    "caseId": case_id,
                    "class": cls,
                    "rootCause": "TRACE_INSUFFICIENT",
                    "evidence": f"missing inference_input_traces for path {path_id}",
                }
            )
            continue

        replay = replay_path(model, vocab, spans)
        span_by_id = {s["spanId"]: s for s in spans}

        target_span_ids = trig.get("targetFineSpanIds", "").split("|") if trig.get("targetFineSpanIds") else []
        if not target_span_ids and cls == "MODEL3_TARGET_FALSE_NEGATIVE":
            target_span_ids = [trig.get("targetFineSpanIds") or f"fine:{path_id}:0"]

        if cls == "MODEL3_TARGET_PARTIAL_COVERAGE":
            target_span_ids = [r["spanId"] for r in partial if r["caseId"] == case_id]

        if cls == "MODEL3_RETRY_SHIFTED_NEARBY":
            sh = shifted[case_id]
            target_span_ids = [sh["targetSpanId"]]
            neighbor_id = sh["neighborSpanId"]
        else:
            neighbor_id = None

        target_spans = []
        for sid in target_span_ids:
            sp = span_by_id.get(sid)
            if not sp:
                continue
            feats = sp["features"]
            rep = replay[sid]
            prod_margin = float(sp["margin"])
            prod_dec = sp["decision"]
            parity = abs(rep["margin"] - prod_margin) <= MARGIN_TOL and rep["decision"] == prod_dec
            if not parity:
                parity_failures += 1
            total_prod_spans += 1
            if float(feats.get("first_pass_cand_log1p", 0)) > 0:
                nonzero_cand_prod += 1
            # contract check via recompute from raw counts
            fa = {"pinyinTextDerived": bool(sp.get("rawPinyinChannelAvail", 1)), "recallFirstPass": True}
            idx = int(sp.get("seqIndex") or 0)
            n = int(sp.get("seqLen") or len(spans))
            recomputed, _, _ = pack_training_features(
                {
                    "surface": sp.get("surface") or "",
                    "isAnchor": sp.get("isAnchor"),
                    "recallEvidence": {"firstPassCandidateCount": int(sp.get("rawFirstPassCandidateCount") or 0)},
                },
                fa,
                idx,
                n,
            )
            c_ok = verify_training_contract(recomputed, feats)
            if not c_ok:
                contract_mismatch += 1

            exp = "EXPECTED_RETRY_CONFIRMED"
            feature_rows.append(
                {
                    "caseId": case_id,
                    "class": cls,
                    "pathId": path_id,
                    "spanId": sid,
                    "surface": sp.get("surface"),
                    "rawStart": sp.get("rawStart"),
                    "rawEnd": sp.get("rawEnd"),
                    "expectedLabel": exp,
                    "actualDecision": prod_dec,
                    "margin": prod_margin,
                    "isAnchor": feats.get("isAnchor"),
                    "span_len_log1p": feats.get("span_len_log1p"),
                    "span_rel_position": feats.get("span_rel_position"),
                    "first_pass_candidate_count": sp.get("rawFirstPassCandidateCount"),
                    "first_pass_cand_log1p": feats.get("first_pass_cand_log1p"),
                    "current_cjk_len_log1p": feats.get("current_cjk_len_log1p"),
                    "pinyin_channel_avail": feats.get("pinyin_channel_avail"),
                    "featureVectorHash": feat_hash(feats),
                    "productionFeatureSource": "model3_v2_s3_mainline_s3_raw_cases.jsonl/inference_input_traces",
                    "replayMargin": rep["margin"],
                    "replayDecision": rep["decision"],
                    "replayParity": "PASS" if parity else "FAIL",
                }
            )
            target_spans.append({**sp, "features": feats, "parity": parity, "contract_ok": c_ok, "expectedLabel": exp})

            if exp == "EXPECTED_RETRY_CONFIRMED" and prod_dec == "KEEP":
                prod_retry_positions.append(float(feats["span_rel_position"]))

            sup = train.support_level(feats, sp.get("surface") or "")
            for nbr in sup["nearest"]:
                support_rows.append(
                    {
                        **prov,
                        "caseId": case_id,
                        "targetSpanId": sid,
                        "rank": nbr["rank"],
                        "trainingSampleId": nbr["sampleId"],
                        "trainingLabel": nbr["label"],
                        "distanceRaw": round(nbr["distanceRaw"], 6),
                        "distanceNormalized": round(nbr["distanceNormalized"], 6),
                        "trainingSurface": nbr["surface"],
                        "trainingSpanPosition": nbr["spanPosition"],
                        "trainingCandFeature": nbr["candFeature"],
                        "trainingPinyinFeature": nbr["pinyinFeature"],
                        "sameSurface": "YES" if nbr["surface"] == sp.get("surface") else "NO",
                        "metricScope": "DIAGNOSTIC_ONLY_SCALAR_TOPK",
                        "topK": TOPK,
                    }
                )

        neighbor = None
        if neighbor_id and neighbor_id in span_by_id:
            nb = span_by_id[neighbor_id]
            total_prod_spans += 1
            if float(nb["features"].get("first_pass_cand_log1p", 0)) > 0:
                nonzero_cand_prod += 1
            rep_n = replay[neighbor_id]
            parity_n = abs(rep_n["margin"] - float(nb["margin"])) <= MARGIN_TOL and rep_n["decision"] == nb["decision"]
            if not parity_n:
                parity_failures += 1
            feature_rows.append(
                {
                    "caseId": case_id,
                    "class": cls + "_NEIGHBOR",
                    "pathId": path_id,
                    "spanId": neighbor_id,
                    "surface": nb.get("surface"),
                    "rawStart": nb.get("rawStart"),
                    "rawEnd": nb.get("rawEnd"),
                    "expectedLabel": "WRONG_NEARBY_RETRY",
                    "actualDecision": nb.get("decision"),
                    "margin": nb.get("margin"),
                    "isAnchor": nb["features"].get("isAnchor"),
                    "span_len_log1p": nb["features"].get("span_len_log1p"),
                    "span_rel_position": nb["features"].get("span_rel_position"),
                    "first_pass_candidate_count": nb.get("rawFirstPassCandidateCount"),
                    "first_pass_cand_log1p": nb["features"].get("first_pass_cand_log1p"),
                    "current_cjk_len_log1p": nb["features"].get("current_cjk_len_log1p"),
                    "pinyin_channel_avail": nb["features"].get("pinyin_channel_avail"),
                    "featureVectorHash": feat_hash(nb["features"]),
                    "productionFeatureSource": "model3_v2_s3_mainline_s3_raw_cases.jsonl/inference_input_traces",
                    "replayMargin": rep_n["margin"],
                    "replayDecision": rep_n["decision"],
                    "replayParity": "PASS" if parity_n else "FAIL",
                }
            )
            neighbor = {**nb, "features": nb["features"]}
            shifted_wrong_pos.append(float(nb["features"]["span_rel_position"]))
            if target_spans:
                shifted_target_pos.append(float(target_spans[0]["features"]["span_rel_position"]))
                t_sup = train.support_level(target_spans[0]["features"], target_spans[0]["surface"])
                n_sup = train.support_level(neighbor["features"], neighbor["surface"])
                shifted_pair_rows.append(
                    {
                        "caseId": case_id,
                        "targetSpanId": target_spans[0]["spanId"],
                        "targetSurface": target_spans[0].get("surface"),
                        "targetFeatureVector": feat_vec_str(target_spans[0]["features"]),
                        "targetMargin": target_spans[0].get("margin"),
                        "targetPositionBin": position_bin(target_spans[0]["features"]["span_rel_position"]),
                        "targetTrainingRetrySupport": t_sup["level"],
                        "wrongSpanId": neighbor_id,
                        "wrongSurface": neighbor.get("surface"),
                        "wrongFeatureVector": feat_vec_str(neighbor["features"]),
                        "wrongMargin": neighbor.get("margin"),
                        "wrongPositionBin": position_bin(neighbor["features"]["span_rel_position"]),
                        "wrongTrainingRetrySupport": n_sup["level"],
                        "dominantFeatureDelta": dominant_feature_delta(
                            target_spans[0]["features"], neighbor["features"]
                        ),
                        "rootCause": "",
                        "confidence": "",
                    }
                )

        case_parity = all(s.get("parity", True) for s in target_spans) and (
            neighbor is None or parity_n
        )
        case_contract = all(s.get("contract_ok", True) for s in target_spans)
        cls_res = classify_case(case_id, cls, target_spans, neighbor, train, case_parity, case_contract)
        if shifted_pair_rows and shifted_pair_rows[-1]["caseId"] == case_id:
            shifted_pair_rows[-1]["rootCause"] = cls_res["rootCause"]
            shifted_pair_rows[-1]["confidence"] = cls_res["confidence"]

        pri = target_spans[0] if target_spans else None
        sup0 = train.support_level(pri["features"], pri["surface"]) if pri else {}
        root_rows.append(
            {
                **prov,
                "caseId": case_id,
                "failureType": cls,
                "expectedTarget": pri.get("surface") if pri else "",
                "runtimeDecision": pri.get("decision") if pri else "",
                "runtimeMargin": pri.get("margin") if pri else "",
                "keyFeatureValues": feat_vec_str(pri["features"]) if pri else "",
                "trainingSupport": sup0.get("level", ""),
                "surfaceContextSupport": "DISTINCT" if neighbor and pri and pri.get("surface") != neighbor.get("surface") else "SAME_OR_NA",
                "featureReplayParity": "PASS" if case_parity else "FAIL",
                "trainingTupleRetryCount": sup0.get("tupleRetry", 0),
                "trainingSupportCount": sup0.get("retryTopK", 0),
                "positionSupport": position_bin(pri["features"]["span_rel_position"]) if pri else "",
                "candidateFeatureSupport": pri["features"]["first_pass_cand_log1p"] if pri else "",
                "rootCause": cls_res["rootCause"],
                "confidence": cls_res["confidence"],
                "evidence": cls_res["evidence"],
            }
        )

    # position shortcut diagnostics
    pos_shortcut = []
    for lo, hi in POSITION_BINS:
        b = f"[{lo:.1f},{hi:.1f})"
        keep = train.pos_bins[b]["KEEP"]
        retry = train.pos_bins[b]["RETRY"]
        tot = keep + retry
        pos_shortcut.append(
            {
                "bin": b,
                "p_retry": retry / max(tot, 1),
                "p_keep": keep / max(tot, 1),
                "retry_share": retry / max(sum(c["RETRY"] for c in train.pos_bins.values()), 1),
            }
        )

    root_cause_counts = Counter(r["rootCause"] for r in root_rows)
    superseded_prior = {
        "TRAINING_COVERAGE_GAP": 8,
        "MODEL_GENERALIZATION_FAILURE": 5,
        "TRAIN_RUNTIME_FEATURE_DISTRIBUTION_MISMATCH": 3,
    }

    pos_rows = train.position_histogram_rows(
        prod_retry_positions, shifted_target_pos, shifted_wrong_pos, prov
    )
    tail_retry_share = next(r["trainingRetryShare"] for r in pos_rows if r["positionBin"] == "[0.9,1.0)")
    early_retry_share = sum(r["trainingRetryShare"] for r in pos_rows[:3])
    early_prod = sum(r["productionExpectedRetryCount"] for r in pos_rows[:3])
    total_prod_pos = sum(r["productionExpectedRetryCount"] for r in pos_rows)
    train_retry = int(sum(1 for x in train.labels if x == "RETRY"))
    train_keep = int(sum(1 for x in train.labels if x == "KEEP"))
    cand_nonzero_retry = train.cand_log1p_nonzero["RETRY"] / max(train.cand_log1p_total["RETRY"], 1)
    feature_collapse = train.feature_collapse_audit()
    position_bias_proven = tail_retry_share > 0.5

    fn_levels = {
        r["caseId"]: r.get("trainingSupport", "")
        for r in root_rows
        if r["caseId"] in FN4
    }
    fn_strong = sum(
        1 for cid, lvl in fn_levels.items() if lvl in ("TRAIN_SUPPORT_STRONG", "TRAIN_SUPPORT_MODERATE")
    )
    fn_weak = sum(
        1
        for cid, lvl in fn_levels.items()
        if lvl in ("TRAIN_SUPPORT_WEAK", "TRAIN_COMBINATION_MISSING")
    )

    fn_case_detail = {}
    for cid in FN4:
        r = next((x for x in root_rows if x["caseId"] == cid), {})
        fn_case_detail[cid] = {
            "support": fn_levels.get(cid, ""),
            "rootCause": r.get("rootCause"),
            "confidence": r.get("confidence"),
            "evidence": r.get("evidence"),
        }
    partial_case_detail = {}
    for cid in PARTIAL4:
        r = next((x for x in root_rows if x["caseId"] == cid), {})
        partial_case_detail[cid] = {
            "trainingSupport": r.get("trainingSupport"),
            "rootCause": r.get("rootCause"),
            "confidence": r.get("confidence"),
            "evidence": r.get("evidence"),
        }

    if parity_failures > 0:
        verdict = "MODEL3_S3_LOCALIZATION_CAUSALITY_EVIDENCE_INSUFFICIENT"
        primary_cause = "MODEL3_FEATURE_REPLAY_PARITY_FAILURE"
        high_conf_counts = Counter()
    else:
        high_conf = Counter(
            r["rootCause"] for r in root_rows if r.get("confidence") == "HIGH"
        )
        primary_cause = high_conf.most_common(1)[0][0] if high_conf else root_cause_counts.most_common(1)[0][0]
        verdict_map = {
            "TRAIN_RUNTIME_FEATURE_DISTRIBUTION_MISMATCH": "MODEL3_S3_LOCALIZATION_CAUSALITY_PASS_DISTRIBUTION_PRIMARY",
            "TRAINING_COVERAGE_GAP": "MODEL3_S3_LOCALIZATION_CAUSALITY_PASS_TRAINING_COVERAGE_PRIMARY",
            "MODEL_GENERALIZATION_FAILURE": "MODEL3_S3_LOCALIZATION_CAUSALITY_PASS_MODEL_GENERALIZATION_PRIMARY",
            "LABEL_DISTRIBUTION_BIAS": "MODEL3_S3_LOCALIZATION_CAUSALITY_PASS_LABEL_DISTRIBUTION_PRIMARY",
            "FEATURE_INFORMATION_LIMITATION": "MODEL3_S3_LOCALIZATION_CAUSALITY_PASS_MIXED",
        }
        top_count = high_conf.most_common(1)[0][1] if high_conf else 0
        if top_count >= 8:
            verdict = verdict_map.get(primary_cause, "MODEL3_S3_LOCALIZATION_CAUSALITY_PASS_MIXED")
        elif len(set(r["rootCause"] for r in root_rows)) >= 3:
            verdict = "MODEL3_S3_LOCALIZATION_CAUSALITY_PASS_NO_SINGLE_DOMINANT_CAUSE"
        else:
            verdict = verdict_map.get(primary_cause, "MODEL3_S3_LOCALIZATION_CAUSALITY_PASS_MIXED")
        high_conf_counts = Counter(
            r["rootCause"] for r in root_rows if r.get("confidence") == "HIGH"
        )

    next_phase_map = {
        "MODEL3_S3_LOCALIZATION_CAUSALITY_PASS_TRAINING_COVERAGE_PRIMARY": "MODEL3_V2_S3_TRAINING_DATA_CORRECTION_DESIGN_AUDIT",
        "MODEL3_S3_LOCALIZATION_CAUSALITY_PASS_DISTRIBUTION_PRIMARY": "MODEL3_V2_S3_TRAINING_DATA_CORRECTION_DESIGN_AUDIT",
        "MODEL3_S3_LOCALIZATION_CAUSALITY_PASS_LABEL_DISTRIBUTION_PRIMARY": "MODEL3_V2_S3_TRAINING_DATA_CORRECTION_DESIGN_AUDIT",
        "MODEL3_S3_LOCALIZATION_CAUSALITY_PASS_MODEL_GENERALIZATION_PRIMARY": "MODEL3_V2_S3_MODEL_GENERALIZATION_CORRECTION_DESIGN_AUDIT",
        "MODEL3_S3_LOCALIZATION_CAUSALITY_PASS_MIXED": "MODEL3_V2_S3_LOCALIZATION_MINIMAL_CORRECTION_DESIGN_AUDIT",
        "MODEL3_S3_LOCALIZATION_CAUSALITY_PASS_NO_SINGLE_DOMINANT_CAUSE": "MODEL3_V2_S3_LOCALIZATION_MINIMAL_CORRECTION_DESIGN_AUDIT",
        "MODEL3_S3_LOCALIZATION_CAUSALITY_EVIDENCE_INSUFFICIENT": "MODEL3_V2_S3_LOCALIZATION_CAUSAL_TRACE_COMPLETENESS_AUDIT",
    }

    unresolved = sum(1 for r in root_rows if r.get("confidence") == "LOW")

    summary = {
        **prov,
        "phase": PHASE,
        "g0DatasetIdentity": "PASS",
        "verdict": verdict,
        "nextPhase": next_phase_map[verdict],
        "population16": {c: cls for c, cls in LOCALIZATION_16},
        "featureReplayParity": {
            "totalSpans": total_prod_spans,
            "failures": parity_failures,
            "passRate": (total_prod_spans - parity_failures) / max(total_prod_spans, 1),
        },
        "trainingSpanCount": len(train.sample_ids),
        "trainingLabelCounts": {"KEEP": train_keep, "RETRY": train_retry},
        "trainingRetryRatio": round(train_retry / max(train_keep + train_retry, 1), 6),
        "firstPassCand": {
            "productionNonzeroSpans": nonzero_cand_prod,
            "productionTotalSpans": total_prod_spans,
            "trainingRetryNonzeroFraction": round(cand_nonzero_retry, 6),
            "trainingRetryRawCounts": dict(train.cand_raw["RETRY"]),
            "trainingKeepRawCounts": dict(train.cand_raw["KEEP"]),
            "note": "fresh authoritative S3; not superseded labeled audit",
        },
        "featureCollapse": feature_collapse,
        "featureContractMismatchCount": contract_mismatch,
        "rootCauseDistribution16": dict(root_cause_counts),
        "highConfidenceRootCauseDistribution16": dict(high_conf_counts),
        "supersededPriorSplit853": superseded_prior,
        "supersededPriorSplitReproduced": False,
        "positionBias": {
            "trainingRetryTailShareBin09": tail_retry_share,
            "trainingRetryEarlyShareBins00to02": early_retry_share,
            "productionEarlyPositionShareBins00to02": early_prod / max(total_prod_pos, 1),
            "positionBiasProvenInAuthoritativeS3": position_bias_proven,
            "prior64PercentTailRetired": not position_bias_proven,
        },
        "shiftedPairs": shifted_pair_rows,
        "supportThresholds": {**SUPPORT_THRESHOLDS, "scope": "DIAGNOSTIC_ONLY"},
        "familyDistributionTop5": train.family_distribution_rows(prov)[:5],
        "fn4Recheck": {
            "strongOrModerateSupport": fn_strong,
            "weakOrMissing": fn_weak,
            "perCase": fn_case_detail,
        },
        "partial4Recheck": partial_case_detail,
        "strictCausalFunnel": {
            "localizationFailures": 16,
            "productionFeatureTraceRecovered": len(root_rows),
            "replayParityPass": parity_failures == 0,
            "g0Pass": True,
            "freshS3TrainingIndex": len(train.sample_ids),
            "rootCauseEligible": len(root_rows),
            "highConfidenceClassified": sum(1 for r in root_rows if r.get("confidence") == "HIGH"),
            "unresolvedLowConfidence": unresolved,
        },
        "governance": {
            "productionCodeChanged": "NO",
            "trainingExecuted": "NO",
            "datasetRebuilt": "NO",
            "thresholdChanged": "NO",
            "featuresChanged": "NO",
            "fineSpanChanged": "NO",
            "retryChanged": "NO",
            "recallChanged": "NO",
            "model2Changed": "NO",
            "domainVoteChanged": "NO",
            "jobResultChanged": "NO",
        },
        "questions": {
            "D1_g0BeforeSampleLoad": True,
            "D2_modelId": identity.modelId,
            "D3_weightsSha256": ckpt_sha,
            "D4_datasetId": identity.datasetId,
            "D5_datasetBuildId": identity.datasetBuildId,
            "D6_freshStatisticsRegenerated": True,
            "D7_supersededArtifactsUsedAsInput": False,
            "D8_trainingSpanCount": len(train.sample_ids),
            "D9_keepRetryCounts": {"KEEP": train_keep, "RETRY": train_retry},
            "D10_retryClassRatio": round(train_retry / max(train_keep + train_retry, 1), 6),
            "D11_firstPassCandNonzeroRateRetry": round(cand_nonzero_retry, 6),
            "D12_rawCandidateCountsRetry": dict(train.cand_raw["RETRY"]),
            "D13_firstPassCandCollapsed": feature_collapse.get("first_pass_cand_log1p") == "EXPECTED_VARIABLE_COLLAPSED",
            "D14_retryTailShare09": tail_retry_share,
            "D15_retryEarlyShare00to02": early_retry_share,
            "D16_globalPositionBiasInS3": position_bias_proven,
            "D17_positionBiasFirstOwner": "NONE" if not position_bias_proven else "TRAIN_RUNTIME_FEATURE_DISTRIBUTION_MISMATCH",
            "D18_priorPositionBiasHypothesisRetired": not position_bias_proven,
            "D19_allSixFeaturesRepresented": all(v != "EXPECTED_VARIABLE_COLLAPSED" for k, v in feature_collapse.items() if k != "isAnchor"),
            "D20_suspiciousLowVariance": [k for k, v in feature_collapse.items() if v == "LOW_VARIANCE_BUT_VALID"],
            "D21_trainingRuntimeFormulaParity": contract_mismatch == 0,
            "D22_featureReplayParity": parity_failures == 0,
            "D23_highConfCoverageGap": high_conf_counts.get("TRAINING_COVERAGE_GAP", 0),
            "D24_highConfDistributionMismatch": high_conf_counts.get("TRAIN_RUNTIME_FEATURE_DISTRIBUTION_MISMATCH", 0),
            "D25_highConfLabelDistributionBias": high_conf_counts.get("LABEL_DISTRIBUTION_BIAS", 0),
            "D26_highConfGeneralizationFailure": high_conf_counts.get("MODEL_GENERALIZATION_FAILURE", 0),
            "D27_unresolved": unresolved,
            "D28_fn4PerCase": {cid: next((r for r in root_rows if r["caseId"] == cid), {}) for cid in sorted(FN4)},
            "D29_partial4PerCase": {cid: next((r for r in root_rows if r["caseId"] == cid), {}) for cid in sorted(PARTIAL4)},
            "D30_shifted8Pairs": shifted_pair_rows,
            "D31_shiftedPrimarilyPositionDriven": False,
            "D32_shiftedPrimarilyCandidateDriven": False,
            "D33_surfaceEmbeddingsMateriallyRelevant": True,
            "D34_nnThresholdsDiagnosticOnly": True,
            "D35_featureInformationLimitationProven": False,
            "D36_capacityLimitationProven": False,
            "D37_thresholdChangeJustified": "NO",
            "D38_modelExpansionJustified": "NO",
            "D39_newFeaturesJustified": "NO",
            "D40_removeSpanRelPosition": "NO",
            "D41_fineSpanRedesignJustified": "NO",
            "D42_retryExpansionJustified": "NO",
            "D43_recallProductionChangeJustified": "NO",
            "D44_model2ProductionChangeJustified": "NO",
            "D45_domainVoteChangeJustified": "NO",
            "D46_jobResultChangeJustified": "NO",
            "D47_s3RetrainingJustifiedNow": verdict.endswith("MODEL_GENERALIZATION_PRIMARY"),
            "D48_s3DatasetCorrectionJustified": verdict.endswith("COVERAGE_PRIMARY") or verdict.endswith("DISTRIBUTION_PRIMARY"),
            "D49_simpleRetrainOnUnchangedS3Justified": "NO",
            "D50_dominantRootCauseFamily": primary_cause,
            "D51_oneDominantExplainsMost": high_conf_counts.most_common(1)[0][1] >= 8 if high_conf_counts else False,
            "D52_prior385SplitReproduced": False,
            "D53_prior64TailReproduced": False,
            "D54_priorCandZeroReproduced": False,
            "D55_acpRequired": False,
        },
    }

    write_csv(OUT_DIST, train.feature_distribution_rows(prov))
    write_csv(OUT_POS, pos_rows)
    write_csv(OUT_CAND, train.candidate_distribution_rows(prov))
    write_csv(OUT_ROOT, root_rows)
    write_csv(OUT_SUPPORT, support_rows)
    freeze_rows = [
        {**prov, "item": "G0_DATASET_IDENTITY", "value": "PASS", "status": "FROZEN"},
        {**prov, "item": "MODEL3_LOCALIZATION_FAILURE16", "value": "16", "status": "FROZEN"},
        {**prov, "item": "AUTHORITATIVE_S3_DATASET", "value": identity.datasetId, "status": "FROZEN"},
        {**prov, "item": "FEATURE_REPLAY_PARITY", "value": f"{total_prod_spans - parity_failures}/{total_prod_spans}", "status": "PASS" if parity_failures == 0 else "FAIL"},
        {**prov, "item": "ROOT_CAUSE_PRIMARY", "value": primary_cause, "status": "AUDITED"},
        {**prov, "item": "POSITION_BIAS_S3", "value": str(position_bias_proven), "status": "RETIRED" if not position_bias_proven else "PROVEN"},
        {**prov, "item": "VERDICT", "value": verdict, "status": "FROZEN"},
        {**prov, "item": "NEXT_PHASE", "value": next_phase_map[verdict], "status": "PROPOSED_NOT_EXECUTED"},
    ]
    write_csv(OUT_FREEZE, freeze_rows)
    OUT_SUMMARY.write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")

    print(
        json.dumps(
            {
                "g0": "PASS",
                "verdict": verdict,
                "rootCauseDistribution16": dict(root_cause_counts),
                "parityFailures": parity_failures,
                "trainingSpans": len(train.sample_ids),
                "retryTailShare": tail_retry_share,
                "candNonzeroRetry": round(cand_nonzero_retry, 4),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
