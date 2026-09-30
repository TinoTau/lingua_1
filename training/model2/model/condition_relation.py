"""CandidateConditionCompatibility V1 — deterministic observed→candidate relations."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Optional, Sequence

from training.model2.contract import PHONETIC_DIM, PHONETIC_FEATURE_INDEX_V1, PHONETIC_FEATURE_KEYS
from training.model2.pronunciation.pronunciation_syllable import PronunciationSyllable

CONTRACT_PATH = (
    Path(__file__).resolve().parents[1] / "stage_b" / "phonetic_relation_direction_contract_v1.json"
)

# user_feature X_Y: match when source has Y and candidate has X
# (canonical X confused as observed Y → repair observed Y back to candidate X)
_FEATURE_PAIR: dict[str, tuple[str, str, str]] = {
    # feature: (component_kind, canonical/X, observed/Y)
    "n_l": ("initial", "n", "l"),
    "l_n": ("initial", "l", "n"),
    "zh_z": ("initial", "zh", "z"),
    "z_zh": ("initial", "z", "zh"),
    "ch_c": ("initial", "ch", "c"),
    "c_ch": ("initial", "c", "ch"),
    "sh_s": ("initial", "sh", "s"),
    "s_sh": ("initial", "s", "sh"),
    "f_h": ("initial", "f", "h"),
    "h_f": ("initial", "h", "f"),
    "an_ang": ("final", "an", "ang"),
    "ang_an": ("final", "ang", "an"),
    "en_eng": ("final", "en", "eng"),
    "eng_en": ("final", "eng", "en"),
    "in_ing": ("final", "in", "ing"),
    "ing_in": ("final", "ing", "in"),
}


def load_relation_contract() -> dict:
    return json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))


def _parse(syl: str) -> Optional[PronunciationSyllable]:
    return PronunciationSyllable.from_compact(syl or "")


def _comp(syl: PronunciationSyllable, kind: str) -> str:
    return syl.initial if kind == "initial" else syl.final


def relation_features_for_pair(
    source_syllables: Sequence[str],
    candidate_syllables: Sequence[str],
) -> list[float]:
    """
    Normalized count per direction:
      matched_relation_count / max(1, aligned_syllable_count)
    """
    src = [_parse(s) for s in source_syllables]
    cand = [_parse(s) for s in candidate_syllables]
    src = [s for s in src if s is not None]
    cand = [c for c in cand if c is not None]
    n = min(len(src), len(cand))
    counts = [0.0] * PHONETIC_DIM
    if n <= 0:
        return counts
    for i in range(n):
        s, c = src[i], cand[i]
        for feat, (kind, canon, obs) in _FEATURE_PAIR.items():
            if _comp(s, kind) == obs and _comp(c, kind) == canon:
                counts[PHONETIC_FEATURE_INDEX_V1[feat]] += 1.0
    return [x / float(n) for x in counts]


def synthesize_observed_syllables(
    canonical_syllables: Sequence[str],
    family: Optional[str],
) -> list[str]:
    """
    Reconstruct intended observed side for relation features.

    Trainrows currently store span_syllables from source_pinyin (canonical GT),
    not ASR/corrupted syllables. Without regenerating TTS, apply the family's
    X→Y substitution to obtain the observed Y side used by the relation contract.
    """
    from training.model2.pronunciation.syllable_substitution import apply_family_to_syllable

    if not family or family not in _FEATURE_PAIR:
        return list(canonical_syllables)
    out: list[str] = []
    for syl in canonical_syllables:
        neu = apply_family_to_syllable(syl, family)
        out.append(neu if neu else syl)
    return out


def observed_syllables_for_relation(row: dict) -> list[str]:
    """Choose observed syllables for CandidateRelation (does not mutate FuzzyPool)."""
    canonical = list(row.get("span_syllables") or [])
    fam = row.get("corruption_family") or (row.get("provenance") or {}).get("corruption_family")
    # Prefer explicit field if ever present
    if row.get("observed_syllables"):
        return list(row["observed_syllables"])
    if row.get("is_pronunciation_positive") and fam:
        synth = synthesize_observed_syllables(canonical, str(fam))
        if synth != canonical:
            return synth
    # Fallback: ASR surface G2P when length-compatible
    span_text = row.get("span_text") or ""
    if span_text and canonical:
        try:
            from training.model2.fuzzy.pool import text_to_syllables

            obs = text_to_syllables(span_text)
            if obs and abs(len(obs) - len(canonical)) <= 1:
                return obs
        except Exception:
            pass
    return canonical


def relation_matrix_for_pool(
    source_syllables: Sequence[str],
    candidate_syllable_lists: Sequence[Sequence[str]],
    *,
    max_pool: int,
) -> list[list[float]]:
    out: list[list[float]] = []
    for cands in list(candidate_syllable_lists)[:max_pool]:
        out.append(relation_features_for_pair(source_syllables, cands))
    while len(out) < max_pool:
        out.append([0.0] * PHONETIC_DIM)
    return out


def user_relation_interaction(
    user_condition: Sequence[float],
    relation_features: Sequence[float],
    phonetic_mask: Sequence[int],
) -> list[float]:
    return [
        float(user_condition[i]) * float(relation_features[i]) * float(phonetic_mask[i])
        for i in range(PHONETIC_DIM)
    ]


def assert_contract_examples() -> None:
    """Hard examples from Phase 6B §14."""
    # 奶 nai3, user n→l, observed lai3 → boosts n_l not l_n
    rel = relation_features_for_pair(["lai3"], ["nai3"])
    assert rel[PHONETIC_FEATURE_INDEX_V1["n_l"]] > 0.0
    assert rel[PHONETIC_FEATURE_INDEX_V1["l_n"]] == 0.0
    # zh→z observed z, candidate zh → zh_z
    rel2 = relation_features_for_pair(["zan1"], ["zhan1"])
    assert rel2[PHONETIC_FEATURE_INDEX_V1["zh_z"]] > 0.0
    assert rel2[PHONETIC_FEATURE_INDEX_V1["z_zh"]] == 0.0
    # multi-syllable normalized
    rel3 = relation_features_for_pair(["lai3", "lai3"], ["nai3", "nai3"])
    assert abs(rel3[PHONETIC_FEATURE_INDEX_V1["n_l"]] - 1.0) < 1e-9
    # synthesize observed from canonical for trainrow repair
    obs = synthesize_observed_syllables(["dou", "nai"], "n_l")
    assert obs[1].startswith("l")
    rel4 = relation_features_for_pair(obs, ["dou", "nai"])
    assert rel4[PHONETIC_FEATURE_INDEX_V1["n_l"]] > 0.0


assert list(PHONETIC_FEATURE_KEYS)  # keep keys imported for contract alignment
