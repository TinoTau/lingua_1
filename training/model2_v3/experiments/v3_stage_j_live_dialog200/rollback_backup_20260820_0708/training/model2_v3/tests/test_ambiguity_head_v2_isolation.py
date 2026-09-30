"""AmbiguityHeadV2 + MinimalContextEncoderV1 isolation from frozen P/D."""

from __future__ import annotations

import torch

from training.model2_v3.policy.ambiguity_head_v2 import AmbiguityHeadV2, N_AMBIGUITY_LOGITS, SINGLE_CHAR_CANDIDATE_CAP
from training.model2_v3.policy.minimal_context_encoder_v1 import CTX_WIN, char_bucket_id, encode_window
from training.model2_v3.policy.model import RetrievalPolicyV3, pack_batch_inputs
from training.model2_v3.tests.test_ambiguity_head_skeleton import CKPT, EXPECTED_PARAMS, EXPECTED_SHA256, sha256_file


def test_v2_does_not_change_pd_forward_or_param_count_default() -> None:
    ckpt = torch.load(CKPT, map_location="cpu", weights_only=False)
    base = RetrievalPolicyV3(with_domain_head=True)
    base.load_state_dict(ckpt["state_dict"], strict=True)
    assert base.param_count() == EXPECTED_PARAMS
    v2 = RetrievalPolicyV3(with_domain_head=True, with_ambiguity_head=True, ambiguity_version="v2")
    v2.load_state_dict(ckpt["state_dict"], strict=False)
    assert isinstance(v2.ambiguity_head, AmbiguityHeadV2)
    assert v2.param_count() > EXPECTED_PARAMS
    x = pack_batch_inputs([["shi"]], [{}], [{"base_pool": 0, "query_budget": 8, "cand_budget": 8}], feature_hash="v1")
    with torch.no_grad():
        a = base(*x)
        b = v2(*x)
    assert set(a) == set(b)
    assert "ambiguity_logits" not in b
    assert torch.allclose(a["action_logits"], b["action_logits"])
    assert torch.allclose(a["domain_action_logits"], b["domain_action_logits"])


def test_v2_batch_dim_and_mask() -> None:
    m = RetrievalPolicyV3(with_domain_head=True, with_ambiguity_head=True, ambiguity_version="v2")
    b, k = 3, SINGLE_CHAR_CANDIDATE_CAP
    left = torch.zeros(b, CTX_WIN, dtype=torch.long)
    right = torch.zeros(b, CTX_WIN, dtype=torch.long)
    left[0] = torch.tensor(encode_window("银行附近", "left"))
    right[0] = torch.tensor(encode_window("走路", "right"))
    cand = torch.zeros(b, k, dtype=torch.long)
    cand[0, 0] = char_bucket_id("行")
    cand[0, 1] = char_bucket_id("形")
    mask = torch.zeros(b, k)
    mask[0, :2] = 1
    mask[1, :3] = 1
    tone = torch.zeros(b, k)
    py = torch.zeros(b, k, dtype=torch.long)
    with torch.no_grad():
        logits = m.ambiguity_head(left, right, cand, tone, py, mask)
    assert logits.shape == (b, N_AMBIGUITY_LOGITS)
    assert torch.isneginf(logits[0, 3]) or logits[0, 3] < -1e8


def test_v2_strict_load_still_works_without_head() -> None:
    assert sha256_file(CKPT) == EXPECTED_SHA256
    ckpt = torch.load(CKPT, map_location="cpu", weights_only=False)
    m = RetrievalPolicyV3(with_domain_head=True)
    missing, unexpected = m.load_state_dict(ckpt["state_dict"], strict=True)
    assert not missing and not unexpected
    v2 = RetrievalPolicyV3(with_domain_head=True, with_ambiguity_head=True, ambiguity_version="v2")
    miss, unexp = v2.load_state_dict(ckpt["state_dict"], strict=False)
    assert all("ambiguity_head" in x for x in miss)
    assert not unexp
