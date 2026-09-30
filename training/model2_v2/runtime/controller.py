"""V2 expansion controller — deterministic (B1) and neural-gated (B2).

MODEL = relation/expansion controller; LEXICON = lexical memory.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional

import torch

from training.model2.candidates.index import CandidateIndexMetaV1
from training.model2.retrieval.finespan import FineSpanView
from training.model2.retrieval.finespan_retrieval import (
    FineSpanRetrievalResult,
    retrieve_for_finespan,
    retrieve_utterance_via_finespans,
)
from training.model2.retrieval.profile_query import generate_profile_queries
from training.model2.retrieval.spike_retriever import ProfileRetrievalConfig
from training.model2_v2.runtime.active_set import DEFAULT_ACTIVE_SET, ActiveSetPolicyV1


@dataclass
class ControllerConfig:
    max_queries: int = 8
    max_profile_candidates: int = 8
    max_spans_scan: int = 10
    neural_threshold: float = 0.35
    k_profile_candidates: int = 8


def deterministic_bias(
    phonetic_bias: Optional[dict[str, float]],
    policy: Optional[ActiveSetPolicyV1] = None,
) -> dict[str, float]:
    pol = policy or DEFAULT_ACTIVE_SET
    return pol.filter_bias(phonetic_bias)


def neural_gated_bias(
    model: Any,
    span_syllables: list[str],
    phonetic_bias: Optional[dict[str, float]],
    *,
    policy: Optional[ActiveSetPolicyV1] = None,
    threshold: float = 0.35,
    device: Optional[torch.device] = None,
) -> dict[str, float]:
    """Activate only relations present in profile AND scored above threshold."""
    from training.model2_v2.model.relation_activator import encode_inputs

    pol = policy or DEFAULT_ACTIVE_SET
    filtered = pol.filter_bias(phonetic_bias)
    if not filtered:
        return {}
    device = device or next(model.parameters()).device
    x_span, x_prof = encode_inputs(span_syllables, filtered, device=device)
    model.eval()
    with torch.no_grad():
        logits = model(x_span, x_prof)[0]
        probs = torch.sigmoid(logits).cpu().tolist()
    out: dict[str, float] = {}
    for i, rel in enumerate(pol.active_relations):
        if rel not in filtered:
            continue
        if float(probs[i]) >= threshold:
            out[rel] = float(filtered[rel])
    return out


def retrieve_span_v2(
    index: CandidateIndexMetaV1,
    span: FineSpanView,
    phonetic_bias: Optional[dict[str, float]],
    *,
    cfg: Optional[ProfileRetrievalConfig] = None,
    policy: Optional[ActiveSetPolicyV1] = None,
) -> FineSpanRetrievalResult:
    bias = deterministic_bias(phonetic_bias, policy)
    return retrieve_for_finespan(index, span, bias, cfg=cfg)


def retrieve_utterance_v2(
    index: CandidateIndexMetaV1,
    spans: list[FineSpanView],
    phonetic_bias: Optional[dict[str, float]],
    target_term_id: str,
    *,
    cfg: Optional[ProfileRetrievalConfig] = None,
    max_spans_scan: int = 10,
    mode: str = "deterministic",
    model: Any = None,
    neural_threshold: float = 0.35,
) -> dict[str, Any]:
    """Authoritative utterance path via FineSpans only (no whole-utterance query)."""
    if mode == "empty":
        return retrieve_utterance_via_finespans(
            index, spans, {}, target_term_id, cfg=cfg, max_spans_scan=max_spans_scan
        )
    if mode == "neural":
        if model is None:
            raise ValueError("neural mode requires model")
        raw = deterministic_bias(phonetic_bias)
        # Runtime-safe: gate using applicable spans only (no target length oracle)
        from training.model2.retrieval.profile_query import hypothesize_intended_syllables

        gated: dict[str, float] = {}
        applicable = []
        for sp in spans:
            for fam in raw:
                _, n = hypothesize_intended_syllables(sp.span_syllables, fam)
                if n > 0:
                    applicable.append(sp)
                    break
        for sp in (applicable or spans)[:3]:
            g = neural_gated_bias(
                model, sp.span_syllables, raw, threshold=neural_threshold
            )
            for k, v in g.items():
                gated[k] = max(gated.get(k, 0.0), v)
        return retrieve_utterance_via_finespans(
            index, spans, gated, target_term_id, cfg=cfg, max_spans_scan=max_spans_scan
        )
    bias = deterministic_bias(phonetic_bias)
    return retrieve_utterance_via_finespans(
        index, spans, bias, target_term_id, cfg=cfg, max_spans_scan=max_spans_scan
    )


def expansion_preview(
    span_syllables: list[str],
    phonetic_bias: Optional[dict[str, float]],
) -> list[dict[str, Any]]:
    qs = generate_profile_queries(span_syllables, deterministic_bias(phonetic_bias))
    return [
        {
            "syllables": q.syllables,
            "relation": q.relation_used,
            "reverse": q.reverse_family_applied,
            "n_changed": q.n_positions_changed,
        }
        for q in qs
    ]
