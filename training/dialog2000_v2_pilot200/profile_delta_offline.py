# -*- coding: utf-8 -*-
"""Offline ProfileDelta apply — mirrors central_server/api-gateway/src/profile_delta.rs EMA."""

from __future__ import annotations

from copy import deepcopy
from typing import Any

PHONETIC_EMA_ALPHA = 0.25
LEXICAL_EMA_ALPHA = 0.25
BIAS_CLAMP = 5.0
ALLOWED_PHONETIC_KEYS = {
    "n_l",
    "l_n",
    "zh_z",
    "z_zh",
    "ch_c",
    "c_ch",
    "sh_s",
    "s_sh",
    "an_ang",
    "ang_an",
    "en_eng",
    "eng_en",
    "in_ing",
    "ing_in",
    "f_h",
    "h_f",
}


def empty_user_profile() -> dict[str, Any]:
    return {
        "schema_version": 2,
        "profile_version": 0,
        "phonetic_bias": {},
        "tone_bias": {},
        "personal_terms": [],
        "personal_term_evidence": {},
        "resolved_lexical_terms": {},
        "unresolved_lexical_observations": [],
        "legacy_free_text_personal_terms": [],
        "confusion_bias": {},
        "domain_bias": {},
        "long_term_domain_evidence": {},
    }


def _clamp_bias(v: float) -> float:
    return max(-BIAS_CLAMP, min(BIAS_CLAMP, v))


def phonetic_ema(old: float, evidence: float, weight: float) -> float:
    alpha = PHONETIC_EMA_ALPHA * max(0.0, min(1.0, weight))
    return _clamp_bias(old * (1.0 - alpha) + evidence * alpha)


def lexical_ema(old: float, weight: float) -> float:
    alpha = LEXICAL_EMA_ALPHA * max(0.0, min(1.0, weight))
    return max(0.0, min(1.0, old * (1.0 - alpha) + 1.0 * alpha))


def apply_profile_delta(
    current: dict[str, Any],
    *,
    source_event_id: str,
    phonetic_updates: list[dict[str, Any]] | None = None,
    personal_term_updates: list[dict[str, Any]] | None = None,
    term_id_resolver: callable | None = None,
) -> dict[str, Any]:
    """Apply one delta. term_id_resolver(surface) -> (term_id|None, surface)."""
    next_p = deepcopy(current)
    next_p["schema_version"] = 2
    phonetic_bias = dict(next_p.get("phonetic_bias") or {})
    for u in phonetic_updates or []:
        key = u["feature_key"]
        if key not in ALLOWED_PHONETIC_KEYS:
            continue
        old = float(phonetic_bias.get(key, 0.0))
        phonetic_bias[key] = phonetic_ema(old, float(u["evidence"]), float(u["weight"]))
    next_p["phonetic_bias"] = {k: v for k, v in phonetic_bias.items() if v != 0.0}

    unresolved = list(next_p.get("unresolved_lexical_observations") or [])
    evidence = dict(next_p.get("personal_term_evidence") or {})
    resolved = dict(next_p.get("resolved_lexical_terms") or {})
    personal_terms = list(next_p.get("personal_terms") or [])

    for t in personal_term_updates or []:
        surface = (t.get("term") or "").strip()
        if not surface:
            continue
        weight = float(t.get("weight", 1.0))
        term_id = None
        if term_id_resolver is not None:
            term_id, surface = term_id_resolver(surface)
        if term_id:
            old = float(evidence.get(term_id, 0.0))
            evidence[term_id] = lexical_ema(old, weight)
            prev = resolved.get(term_id) or {
                "term_id": term_id,
                "surface": surface,
                "evidence": 0.0,
                "confirm_count": 0,
            }
            prev = dict(prev)
            prev["surface"] = surface
            prev["evidence"] = evidence[term_id]
            prev["confirm_count"] = int(prev.get("confirm_count", 0)) + 1
            resolved[term_id] = prev
            if surface not in personal_terms:
                personal_terms.append(surface)
        else:
            unresolved.append(
                {
                    "surface": surface,
                    "reason": "LEXICON_UNAVAILABLE_OR_UNRESOLVED",
                    "source_event_id": source_event_id,
                }
            )
            # Isolation tracking still needs a stable id:
            syn = f"surface:{surface}"
            old = float(evidence.get(syn, 0.0))
            evidence[syn] = lexical_ema(old, weight)

    next_p["personal_term_evidence"] = evidence
    next_p["resolved_lexical_terms"] = resolved
    next_p["unresolved_lexical_observations"] = unresolved[-100:]
    next_p["personal_terms"] = personal_terms[:100]
    next_p["profile_version"] = int(current.get("profile_version") or 0) + 1
    return next_p
