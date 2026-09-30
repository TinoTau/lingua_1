"""Model2 retrieval package — FineSpan-authoritative path (Phase 7G).

Authoritative: finespan_retrieval.retrieve_for_finespan
Legacy spike helpers retained for diagnostics; whole-utterance is NOT authoritative.
"""

from training.model2.retrieval.finespan import FineSpanView, materialize_finespans_from_asr
from training.model2.retrieval.finespan_retrieval import (
    retrieve_for_finespan,
    retrieve_utterance_via_finespans,
)
from training.model2.retrieval.normalize import normalize_for_lexicon_lookup, strip_tone
from training.model2.retrieval.profile_query import (
    ExpandedQuery,
    active_relations_from_bias,
    generate_profile_queries,
    hypothesize_intended_syllables,
    load_direction_contract,
)
from training.model2.retrieval.spike_retriever import (
    ProfileRetrievalConfig,
    ProfileRetrievalHit,
    ProfileRetrievalResult,
    merge_pools,
    retrieve_profile_candidates,
)

__all__ = [
    "ExpandedQuery",
    "FineSpanView",
    "ProfileRetrievalConfig",
    "ProfileRetrievalHit",
    "ProfileRetrievalResult",
    "active_relations_from_bias",
    "generate_profile_queries",
    "hypothesize_intended_syllables",
    "load_direction_contract",
    "materialize_finespans_from_asr",
    "normalize_for_lexicon_lookup",
    "strip_tone",
    "merge_pools",
    "retrieve_profile_candidates",
    "retrieve_for_finespan",
    "retrieve_utterance_via_finespans",
]
