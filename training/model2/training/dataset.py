"""Stage A dataset: enrich TrainRows + torch Dataset."""

from __future__ import annotations

import hashlib
import json
import random
from pathlib import Path
from typing import Any, Optional

import torch
from torch.utils.data import Dataset

from training.model2.candidates.index import CandidateIndexMetaV1, CandidateRecord
from training.model2.contract import (
    CONTEXT_CHAR_MAX,
    DOMAIN_DIM,
    PHONETIC_DIM,
    SPAN_CHAR_MAX,
    SYLLABLE_MAX,
    TONE_DIM,
)
from training.model2.encoding.char_hash import encode_span_chars
from training.model2.encoding.syllable_vocab import SyllableVocabV1
from training.model2.fuzzy.pool import FuzzyPoolRequestV1, build_fuzzy_pool
from training.model2.model.condition_relation import observed_syllables_for_relation, relation_matrix_for_pool


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    rows = []
    with path.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def load_candidate_index(jsonl: Path, meta: Path) -> CandidateIndexMetaV1:
    meta_d = json.loads(meta.read_text(encoding="utf-8"))
    records = []
    for line in jsonl.open(encoding="utf-8"):
        d = json.loads(line)
        records.append(CandidateRecord(**d))
    idx = CandidateIndexMetaV1(
        candidate_index_version=meta_d["candidate_index_version"],
        lexicon_snapshot_id=meta_d["lexicon_snapshot_id"],
        candidate_count=meta_d["candidate_count"],
        records=records,
    )
    idx.rebuild_indexes()
    return idx


def classify_positive_bucket(sample: dict[str, Any], row: dict[str, Any]) -> str:
    """TERM_POSITIVE | NON_TERM_POSITIVE | RULE_POSITIVE | OTHER."""
    if row.get("sample_kind") != "POSITIVE":
        return "OTHER"
    source = row.get("source_type") or sample.get("metadata", {}).get("source_type")
    if source == "RULE_SYNTHETIC":
        return "RULE_POSITIVE"
    planned = (sample.get("metadata") or {}).get("target_term")
    target_span = (sample.get("target") or {}).get("target_span") or ""
    span_targets_term = bool(
        planned
        and (
            target_span == planned
            or planned in target_span
            or target_span in planned
        )
    )
    if span_targets_term:
        return "TERM_POSITIVE"
    return "NON_TERM_POSITIVE"


def enrich_trainrows(
    rows: list[dict[str, Any]],
    samples_by_id: dict[str, dict[str, Any]],
    index: CandidateIndexMetaV1,
    vocab: SyllableVocabV1,
) -> list[dict[str, Any]]:
    """Add derived fields without TTS/ASR re-run. FuzzyPool V1 generation unchanged."""
    out = []
    for row in rows:
        r = dict(row)
        sid = r["sample_id"]
        sample = samples_by_id.get(sid) or {}
        bucket = classify_positive_bucket(sample, r)
        r["positive_bucket"] = bucket
        r["is_term_positive"] = bucket == "TERM_POSITIVE"
        r["ignored_for_model2_recall"] = bucket == "NON_TERM_POSITIVE"
        r["is_rule_positive"] = bucket == "RULE_POSITIVE"

        syls = list(r.get("span_syllables") or [])

        # Hard-negative injection identity ≠ phonetic distance
        is_injected = False
        hn_tid = r.get("hard_negative_term_id")
        if r.get("sample_kind") == "HARD_NEGATIVE" and hn_tid and r.get("hard_negative_in_pool"):
            # Recompute native pool (no injection) to detect append-only HN.
            req = FuzzyPoolRequestV1(
                span_text=r["span_text"],
                span_syllables=syls,
                span_syllable_count=len(syls),
                max_pool_size=16,
                distance_threshold=2,
                lexicon_snapshot_id=index.lexicon_snapshot_id,
            )
            native = build_fuzzy_pool(index, req)
            is_injected = hn_tid not in set(native.term_ids())
        r["is_injected_hard_negative"] = is_injected

        # Distances for deterministic baseline (native phonetic only; injected → None)
        distances: list[Optional[int]] = []
        priors: list[float] = []
        from training.model2.phonetic.syllables import levenshtein_syllables

        for tid in r.get("fuzzy_pool_term_ids") or []:
            rec = index.by_term_id.get(tid)
            priors.append(float(rec.prior_score) if rec else 0.0)
            if is_injected and tid == hn_tid:
                distances.append(None)  # not a phonetic distance feature
            elif rec and syls:
                distances.append(levenshtein_syllables(syls, rec.syllables))
            else:
                distances.append(0)
        r["fuzzy_pool_distances"] = distances
        r["fuzzy_pool_priors"] = priors

        # NEGATIVE rows often have empty FuzzyPool (long/no-change spans).
        # Training-only distractors teach NO_MATCH; FuzzyPool V1 is unchanged.
        r["uses_training_distractors"] = False
        r["training_distractor_term_ids"] = []
        if r.get("sample_kind") == "NEGATIVE" and not (r.get("fuzzy_pool_term_ids") or []):
            r["training_distractor_term_ids"] = sample_negative_distractors(
                r["trainrow_id"], list(index.by_term_id.keys()), k=8
            )
            r["uses_training_distractors"] = True
        out.append(r)
    return out


def sample_negative_distractors(trainrow_id: str, universe: list[str], k: int = 8) -> list[str]:
    digest = hashlib.sha256(trainrow_id.encode("utf-8")).digest()
    rng = random.Random(int.from_bytes(digest[:8], "little"))
    if len(universe) <= k:
        return list(universe)
    return rng.sample(universe, k)


def precompute_candidate_tensors(
    index: CandidateIndexMetaV1,
    vocab: SyllableVocabV1,
) -> dict[str, dict[str, Any]]:
    """Fixed surface/pinyin features per term_id (identity only for lookup)."""
    cache: dict[str, dict[str, Any]] = {}
    for rec in index.records:
        tt = [1.0, 0.0] if rec.term_type == "domain" else [0.0, 1.0]
        cache[rec.term_id] = {
            "char_ids": encode_span_chars(rec.surface),
            "syl_ids": vocab.encode(rec.syllables),
            "syl_count": min(rec.syllable_count, SYLLABLE_MAX),
            "term_type_oh": tt,
            "surface": rec.surface,
            "syllables": list(rec.syllables or []),
        }
    return cache


class StageADataset(Dataset):
    """Filtered views for positive / negative / hard-negative losses."""

    def __init__(
        self,
        rows: list[dict[str, Any]],
        cand_cache: dict[str, dict[str, Any]],
        *,
        mode: str = "all",
        max_pool: int = 16,
    ):
        self.cand_cache = cand_cache
        self.max_pool = max_pool
        self.mode = mode
        self.rows = [r for r in rows if self._keep(r)]

    def _keep(self, r: dict[str, Any]) -> bool:
        kind = r["sample_kind"]

        def _src_ok(row: dict[str, Any]) -> bool:
            src = row.get("source_type")
            return src in ("TTS_ASR_SYNTHETIC", "TTS_PRONUNCIATION_CORRUPTED") or bool(
                row.get("is_pronunciation_positive")
            )

        if self.mode == "term_positive":
            return (
                r.get("is_term_positive")
                and r.get("target_in_pool")
                and r.get("positive_pool_index") is not None
                and _src_ok(r)
                and not r.get("context_target_leak")
            )
        if self.mode == "negative":
            return kind == "NEGATIVE"
        if self.mode == "hard_negative":
            return kind == "HARD_NEGATIVE" and r.get("is_injected_hard_negative")
        if self.mode == "eval_term_positive":
            return (
                r.get("is_term_positive")
                and r.get("target_in_pool")
                and r.get("positive_pool_index") is not None
                and _src_ok(r)
                and not r.get("context_target_leak")
            )
        return kind in ("POSITIVE", "NEGATIVE", "HARD_NEGATIVE")

    def __len__(self) -> int:
        return len(self.rows)

    def __getitem__(self, idx: int) -> dict[str, Any]:
        r = self.rows[idx]
        pool_ids = list(r.get("fuzzy_pool_term_ids") or [])[: self.max_pool]
        if not pool_ids and r.get("training_distractor_term_ids"):
            pool_ids = list(r["training_distractor_term_ids"])[: self.max_pool]
        p = len(pool_ids)
        char_ids = []
        syl_ids = []
        syl_count = []
        term_type = []
        for tid in pool_ids:
            c = self.cand_cache.get(tid)
            if c is None:
                char_ids.append([0] * SPAN_CHAR_MAX)
                syl_ids.append([0] * SYLLABLE_MAX)
                syl_count.append(0)
                term_type.append([0.0, 1.0])
            else:
                char_ids.append(c["char_ids"])
                syl_ids.append(c["syl_ids"])
                syl_count.append(c["syl_count"])
                term_type.append(c["term_type_oh"])
        # pad pool to max_pool
        while len(char_ids) < self.max_pool:
            char_ids.append([0] * SPAN_CHAR_MAX)
            syl_ids.append([0] * SYLLABLE_MAX)
            syl_count.append(0)
            term_type.append([0.0, 0.0])

        pers = list(r.get("candidate_personal_features") or [])[: self.max_pool]
        dom = list(r.get("candidate_domain_features") or [])[: self.max_pool]
        while len(pers) < self.max_pool:
            pers.append([0.0, 0.0, 0.0])
            dom.append([0.0, 0.0])
        pers = [x if x else [0.0, 0.0, 0.0] for x in pers]
        dom = [x if x else [0.0, 0.0] for x in dom]

        pool_mask = [True] * p + [False] * (self.max_pool - p)

        hn_idx = None
        if r.get("hard_negative_term_id") and r.get("hard_negative_term_id") in pool_ids:
            hn_idx = pool_ids.index(r["hard_negative_term_id"])

        src_syls = observed_syllables_for_relation(r)
        cand_syl_lists = []
        for tid in pool_ids:
            c = self.cand_cache.get(tid) or {}
            cand_syl_lists.append(list(c.get("syllables") or []))
        while len(cand_syl_lists) < self.max_pool:
            cand_syl_lists.append([])
        rel = relation_matrix_for_pool(src_syls, cand_syl_lists, max_pool=self.max_pool)

        return {
            "trainrow_id": r["trainrow_id"],
            "sample_id": r["sample_id"],
            "sample_kind": r["sample_kind"],
            "split": r.get("split", "train"),
            "span_char_ids": torch.tensor(r["span_char_ids"], dtype=torch.long),
            "left_char_ids": torch.tensor(r["left_char_ids"], dtype=torch.long),
            "right_char_ids": torch.tensor(r["right_char_ids"], dtype=torch.long),
            "syllable_ids": torch.tensor(r["syllable_ids"], dtype=torch.long),
            "syllable_count": torch.tensor(r["syllable_count"], dtype=torch.long),
            "relative_position": torch.tensor(r["relative_position"], dtype=torch.float),
            "phonetic_condition": torch.tensor(r["phonetic_condition"], dtype=torch.float),
            "phonetic_mask": torch.tensor(r["phonetic_mask"], dtype=torch.long),
            "tone_condition": torch.tensor(r["tone_condition"], dtype=torch.float),
            "tone_mask": torch.tensor(r["tone_mask"], dtype=torch.long),
            "domain_prior": torch.tensor(r["domain_prior"], dtype=torch.float),
            "domain_mask": torch.tensor(r["domain_mask"], dtype=torch.long),
            "phonetic_profile_acoustically_realized": torch.tensor(
                r.get("phonetic_profile_acoustically_realized", 0), dtype=torch.long
            ),
            "cand_char_ids": torch.tensor(char_ids, dtype=torch.long),
            "cand_syl_ids": torch.tensor(syl_ids, dtype=torch.long),
            "cand_syl_count": torch.tensor(syl_count, dtype=torch.long),
            "cand_term_type_oh": torch.tensor(term_type, dtype=torch.float),
            "cand_personal": torch.tensor(pers, dtype=torch.float),
            "cand_domain": torch.tensor(dom, dtype=torch.float),
            "pool_mask": torch.tensor(pool_mask, dtype=torch.bool),
            "pool_len": torch.tensor(p, dtype=torch.long),
            "positive_pool_index": torch.tensor(
                r["positive_pool_index"] if r.get("positive_pool_index") is not None else -1,
                dtype=torch.long,
            ),
            "hard_negative_index": torch.tensor(
                hn_idx if hn_idx is not None else -1, dtype=torch.long
            ),
            "is_injected_hard_negative": torch.tensor(
                1 if r.get("is_injected_hard_negative") else 0, dtype=torch.long
            ),
            "fuzzy_pool_term_ids": pool_ids,
            "fuzzy_pool_distances": (r.get("fuzzy_pool_distances") or [])[:p],
            "fuzzy_pool_priors": (r.get("fuzzy_pool_priors") or [])[:p],
            "target_term_id": r.get("target_term_id"),
            "user_group_key": (r.get("provenance") or {}).get("user_group_key"),
            "is_pronunciation_positive": torch.tensor(
                1 if r.get("is_pronunciation_positive") else 0, dtype=torch.long
            ),
            "condition_supervision_weight": torch.tensor(
                float(r.get("condition_supervision_weight") or 1.0), dtype=torch.float
            ),
            "cand_relation_features": torch.tensor(rel, dtype=torch.float),
            "is_no_change": torch.tensor(1 if r.get("is_no_change") else 0, dtype=torch.long),
        }


def collate_stage_a(batch: list[dict[str, Any]]) -> dict[str, Any]:
    keys_tensor = [
        "span_char_ids",
        "left_char_ids",
        "right_char_ids",
        "syllable_ids",
        "syllable_count",
        "relative_position",
        "phonetic_condition",
        "phonetic_mask",
        "tone_condition",
        "tone_mask",
        "domain_prior",
        "domain_mask",
        "phonetic_profile_acoustically_realized",
        "cand_char_ids",
        "cand_syl_ids",
        "cand_syl_count",
        "cand_term_type_oh",
        "cand_personal",
        "cand_domain",
        "pool_mask",
        "pool_len",
        "positive_pool_index",
        "hard_negative_index",
        "is_injected_hard_negative",
        "is_pronunciation_positive",
        "condition_supervision_weight",
        "cand_relation_features",
        "is_no_change",
    ]
    out: dict[str, Any] = {}
    for k in keys_tensor:
        out[k] = torch.stack([b[k] for b in batch], dim=0)
    for k in (
        "trainrow_id",
        "sample_id",
        "sample_kind",
        "split",
        "fuzzy_pool_term_ids",
        "fuzzy_pool_distances",
        "fuzzy_pool_priors",
        "target_term_id",
        "user_group_key",
    ):
        out[k] = [b[k] for b in batch]
    return out


def write_enriched_jsonl(rows: list[dict[str, Any]], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")


def dataset_manifest(rows: list[dict[str, Any]]) -> dict[str, Any]:
    from collections import Counter

    buckets = Counter(r.get("positive_bucket", "OTHER") for r in rows)
    kinds = Counter(r["sample_kind"] for r in rows)
    splits = Counter(r.get("split") for r in rows)
    ignored = sum(1 for r in rows if r.get("ignored_for_model2_recall"))
    injected = sum(1 for r in rows if r.get("is_injected_hard_negative"))
    term_pos_trainable = sum(
        1
        for r in rows
        if r.get("is_term_positive")
        and r.get("target_in_pool")
        and r.get("source_type") == "TTS_ASR_SYNTHETIC"
    )
    return {
        "n_rows": len(rows),
        "sample_kinds": dict(kinds),
        "positive_buckets": dict(buckets),
        "splits": dict(splits),
        "ignored_non_term_positive_count": ignored,
        "injected_hard_negative_count": injected,
        "term_positive_trainable": term_pos_trainable,
        "negative_empty_pool_count": sum(
            1
            for r in rows
            if r.get("sample_kind") == "NEGATIVE" and not (r.get("fuzzy_pool_term_ids") or [])
        ),
        "negative_with_training_distractors": sum(
            1 for r in rows if r.get("uses_training_distractors")
        ),
        "note": "NON_TERM_POSITIVE excluded from Model2 lexicon recall positive loss.",
    }
