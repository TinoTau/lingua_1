"""Stage B user-conditioned training probe helpers."""

from training.model2.stage_b.condition import (
    OPPOSITE_DIRECTION,
    PHONETIC_FEATURE_INDEX_V1,
    fidelity_supervision_weight,
    load_fidelity_weights,
    profile_vectors_from_bias,
    strength_to_prob,
)

__all__ = [
    "OPPOSITE_DIRECTION",
    "PHONETIC_FEATURE_INDEX_V1",
    "fidelity_supervision_weight",
    "load_fidelity_weights",
    "profile_vectors_from_bias",
    "strength_to_prob",
]
