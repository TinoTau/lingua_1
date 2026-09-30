"""Ambiguity head skeleton + frozen P/D checkpoint compatibility.

No training. Frozen expA must still load strictly without ambiguity weights.
"""

from __future__ import annotations

import hashlib
from pathlib import Path

import torch

from training.model2_v3.policy.ambiguity_head_v1 import AmbiguityHeadV1, N_AMBIGUITY_LOGITS
from training.model2_v3.policy.model import HIDDEN, N_ACTIONS, RetrievalPolicyV3, pack_batch_inputs
from training.model2_v3.policy.domain_actions import N_DOMAIN_ACTIONS

REPO = Path(__file__).resolve().parents[3]
CKPT = (
    REPO
    / "training"
    / "model2_v3"
    / "experiments"
    / "v3_stage_j_p_preservation"
    / "training"
    / "expA_frozen_trunk.pt"
)
EXPECTED_SHA256 = "d66847be010f0953382243c7cc664a683e37bf6d112f33b463b68eb7fbeabeda"
EXPECTED_PARAMS = 47210


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def test_default_model_has_no_ambiguity_head_and_same_forward_keys() -> None:
    m = RetrievalPolicyV3(with_domain_head=True)
    assert m.ambiguity_head is None
    assert m.param_count() == EXPECTED_PARAMS
    x = pack_batch_inputs([["shi"]], [{}], [{"base_pool": 0, "query_budget": 8, "cand_budget": 8}], feature_hash="v1")
    with torch.no_grad():
        out = m(*x)
    assert set(out) == {"action_logits", "query_budget_logits", "cand_budget_logits", "domain_action_logits"}
    assert out["action_logits"].shape[-1] == N_ACTIONS
    assert out["domain_action_logits"].shape[-1] == N_DOMAIN_ACTIONS
    assert "ambiguity_logits" not in out


def test_optional_head_does_not_change_pd_forward_keys() -> None:
    m = RetrievalPolicyV3(with_domain_head=True, with_ambiguity_head=True)
    assert isinstance(m.ambiguity_head, AmbiguityHeadV1)
    assert m.param_count() > EXPECTED_PARAMS
    x = pack_batch_inputs([["shi"]], [{}], [{"base_pool": 0}], feature_hash="v1")
    with torch.no_grad():
        out = m(*x)
        h = m.encode(*x)
        logits = m.ambiguity_head(
            h,
            torch.zeros(1, 8, 16),
            torch.ones(1, 8),
        )
    assert "ambiguity_logits" not in out
    assert logits.shape == (1, N_AMBIGUITY_LOGITS)


def test_frozen_checkpoint_still_strict_loads() -> None:
    assert CKPT.is_file()
    assert sha256_file(CKPT) == EXPECTED_SHA256
    ckpt = torch.load(CKPT, map_location="cpu", weights_only=False)
    sd = ckpt["state_dict"]
    assert "ambiguity_head.score.weight" not in sd
    model = RetrievalPolicyV3(with_domain_head=True)
    missing, unexpected = model.load_state_dict(sd, strict=True)
    assert not missing and not unexpected
    assert model.param_count() == EXPECTED_PARAMS
    x = pack_batch_inputs([["wo"]], [{"n_l": 0.0}], [{"base_pool": 1, "query_budget": 8, "cand_budget": 8}], feature_hash="v1")
    with torch.no_grad():
        out = model(*x)
    assert out["action_logits"].shape == (1, N_ACTIONS)
    assert out["domain_action_logits"].shape[-1] == N_DOMAIN_ACTIONS
