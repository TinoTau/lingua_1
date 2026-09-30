#!/usr/bin/env python3
"""Phase 7D — Missing-target capability test (diagnostic only).

Markers: PHASE7D_AUDIT / NOT_FOR_RUNTIME / NOT_FROZEN
Deliberately remove correct target from FuzzyPool, run Stage A (+ optional Stage B empty/correct),
measure TargetIntroductionRate. Expected for closed-set ranker: 0.
"""

from __future__ import annotations

import argparse
import json
import random
import sys
from copy import deepcopy
from pathlib import Path
from typing import Any

import torch
from torch.utils.data import DataLoader

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from training.model2.encoding.syllable_vocab import SyllableVocabV1
from training.model2.stage_b.active_feature_mask import BOUND_FEATURES_V1
from training.model2.training.config import StageATrainConfig
from training.model2.training.dataset import (
    StageADataset,
    collate_stage_a,
    enrich_trainrows,
    load_candidate_index,
    load_jsonl,
    precompute_candidate_tensors,
)
from training.model2.training.stage_b_trainer import load_stage_a_checkpoint

MARKERS = ["PHASE7D_AUDIT", "NOT_FOR_RUNTIME", "NOT_FROZEN"]


def dump(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")


def strip_target(row: dict) -> dict | None:
    ids = list(row.get("fuzzy_pool_term_ids") or [])
    tgt = row.get("positive_pool_index")
    tid = row.get("target_term_id")
    if not ids or tgt is None or tid is None:
        return None
    if int(tgt) < 0 or int(tgt) >= len(ids):
        return None
    if ids[int(tgt)] != tid:
        # still remove tid if present
        if tid not in ids:
            return None
        tgt = ids.index(tid)
    rr = deepcopy(row)
    keep = [i for i in range(len(ids)) if i != int(tgt)]
    if not keep:
        return None
    rr["fuzzy_pool_term_ids"] = [ids[i] for i in keep]
    for key in ("fuzzy_pool_distances", "fuzzy_pool_priors", "candidate_personal_features", "candidate_domain_features"):
        arr = list(rr.get(key) or [])
        if len(arr) == len(ids):
            rr[key] = [arr[i] for i in keep]
    rr["positive_pool_index"] = None
    rr["target_in_pool"] = False
    rr["_stripped_target"] = tid
    rr["_pool_before"] = len(ids)
    rr["_pool_after"] = len(rr["fuzzy_pool_term_ids"])
    return rr


@torch.no_grad()
def collect_ranked_ids(model, rows, cand_cache, cfg, top_k: int = 16) -> list[dict]:
    """Rank pool; return whether stripped target appears (should never)."""
    device = next(model.parameters()).device
    model.eval()
    # StageADataset eval requires target_in_pool — bypass by using mode=all and manual scoring
    out = []
    for r in rows:
        ids = list(r.get("fuzzy_pool_term_ids") or [])
        if not ids:
            out.append({"introduced": False, "top_ids": [], "n": 0})
            continue
        # build one-item dataset via temporary row with fake positive index 0 for collate only
        tmp = deepcopy(r)
        tmp["target_in_pool"] = True
        tmp["positive_pool_index"] = 0
        tmp["is_term_positive"] = True
        tmp["sample_kind"] = "POSITIVE"
        tmp["source_type"] = tmp.get("source_type") or "TTS_ASR_SYNTHETIC"
        ds = StageADataset([tmp], cand_cache, mode="eval_term_positive", max_pool=cfg.max_pool)
        if len(ds) == 0:
            out.append({"introduced": False, "top_ids": [], "n": 0, "skip": True})
            continue
        batch = collate_stage_a([ds[0]])
        batch_t = {k: v.to(device) if torch.is_tensor(v) else v for k, v in batch.items()}
        scores = model(batch_t)["scores"][0]
        p = int(batch_t["pool_len"][0].item())
        order = scores[:p].argsort(descending=True).tolist()
        ranked = [ids[i] for i in order if i < len(ids)]
        stripped = r.get("_stripped_target")
        introduced = stripped in ranked  # impossible unless model invents IDs — check ID set
        # also check if any score path added NO_MATCH as lexical — NO_MATCH is not a term_id
        out.append(
            {
                "introduced": introduced,
                "stripped_in_input_pool": stripped in ids,
                "top_ids": ranked[:top_k],
                "n": len(ids),
                "sample_id": r.get("sample_id"),
                "family": r.get("corruption_family"),
                "target": stripped,
            }
        )
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--rows-dir", type=Path, default=ROOT / "training/model2/dataset/baseline_v1/stage_b_trainrows")
    ap.add_argument("--samples", type=Path, default=ROOT / "training/model2/dataset/baseline_v1/training_samples.jsonl")
    ap.add_argument("--stage-a", type=Path, default=ROOT / "training/model2/experiments/stage_a_baseline_v1/model2-stageA-baseline-m0.pt")
    ap.add_argument("--out", type=Path, default=ROOT / "training/model2/experiments/phase7d_audit/missing_target_capability_test.json")
    ap.add_argument("--n", type=int, default=250)
    ap.add_argument("--seed", type=int, default=20260816)
    args = ap.parse_args()

    raw = load_jsonl(args.rows_dir / "model2_train_rows.jsonl")
    samples = {s["sample_id"]: s for s in load_jsonl(args.samples)} if args.samples.exists() else {}
    index = load_candidate_index(args.rows_dir / "candidate_index.jsonl", args.rows_dir / "candidate_index_meta.json")
    vocab = SyllableVocabV1.load(args.rows_dir / "syl-vocab-v1.json")
    rows = enrich_trainrows(raw, samples, index, vocab) if samples else raw
    cand_cache = precompute_candidate_tensors(index, vocab)

    # eligible: pronunciation positive, BOUND family preferred, target in pool
    cand = [
        r
        for r in rows
        if r.get("is_term_positive")
        and r.get("target_in_pool")
        and r.get("positive_pool_index") is not None
        and r.get("target_term_id")
        and (r.get("corruption_family") in BOUND_FEATURES_V1 or r.get("is_pronunciation_positive"))
    ]
    rng = random.Random(args.seed)
    rng.shuffle(cand)
    selected = []
    by_fam: dict[str, int] = {}
    for r in cand:
        fam = r.get("corruption_family") or "OTHER"
        if by_fam.get(fam, 0) >= max(1, args.n // max(1, len(BOUND_FEATURES_V1))):
            if fam in BOUND_FEATURES_V1 and sum(by_fam.get(f, 0) for f in BOUND_FEATURES_V1) >= args.n:
                continue
        stripped = strip_target(r)
        if stripped is None:
            continue
        selected.append(stripped)
        by_fam[fam] = by_fam.get(fam, 0) + 1
        if len(selected) >= args.n:
            break

    cfg = StageATrainConfig(device="cpu")
    model = load_stage_a_checkpoint(args.stage_a, use_condition_in_score=False, syl_vocab=vocab.to_dict()["size"])
    model.eval()
    results = collect_ranked_ids(model, selected, cand_cache, cfg)

    n = len(results)
    introduced = sum(1 for x in results if x.get("introduced"))
    still_absent = sum(1 for x in results if not x.get("introduced") and not x.get("skip"))
    # Model2NewRecall@K: fraction where target appears in top-K of OUTPUT set
    # For closed-set, always 0 if we only emit input IDs
    def new_recall_at(k: int) -> float:
        hit = 0
        for x in results:
            if x.get("skip"):
                continue
            tgt = x.get("target")
            tops = x.get("top_ids") or []
            if tgt in tops[:k]:
                hit += 1
        return hit / max(1, still_absent + introduced)

    report = {
        "markers": MARKERS,
        "n_tested": n,
        "family_counts": by_fam,
        "target_before_model2": "absent (deliberately stripped from FuzzyPool)",
        "TargetIntroductionRate": introduced / max(1, n),
        "Model2NewRecall@1": new_recall_at(1),
        "Model2NewRecall@3": new_recall_at(3),
        "Model2NewRecall@K": new_recall_at(16),
        "n_introduced": introduced,
        "n_still_absent": still_absent,
        "architectural_conclusion": "CURRENT MODEL2 IS A CLOSED-SET RANKER",
        "evidence": (
            "After stripping target_term_id from fuzzy_pool_term_ids, Stage A forward only scores "
            "remaining pool (+NO_MATCH). Output top_ids are always a permutation of input IDs; "
            "stripped target never reappears."
        ),
        "examples": results[:20],
    }
    dump(args.out, report)
    print(json.dumps({k: report[k] for k in ("n_tested", "TargetIntroductionRate", "Model2NewRecall@1", "Model2NewRecall@3", "architectural_conclusion")}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
