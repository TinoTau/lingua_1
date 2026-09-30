"""Unit tests for Stage A model contracts (mask / no term_id table)."""

from __future__ import annotations

import torch

from training.model2.model.model_v1 import Model2Config, Model2StageAV1, count_parameters


def _dummy_batch(b: int = 2, p: int = 8):
    return {
        "span_char_ids": torch.randint(1, 100, (b, 16)),
        "left_char_ids": torch.randint(0, 100, (b, 24)),
        "right_char_ids": torch.randint(0, 100, (b, 24)),
        "syllable_ids": torch.randint(0, 50, (b, 8)),
        "syllable_count": torch.tensor([2] * b),
        "relative_position": torch.tensor([0.5] * b),
        "phonetic_condition": torch.zeros(b, 16),
        "phonetic_mask": torch.zeros(b, 16, dtype=torch.long),
        "tone_condition": torch.zeros(b, 12),
        "tone_mask": torch.zeros(b, 12, dtype=torch.long),
        "domain_prior": torch.zeros(b, 12),
        "domain_mask": torch.zeros(b, 12, dtype=torch.long),
        "phonetic_profile_acoustically_realized": torch.zeros(b, dtype=torch.long),
        "cand_char_ids": torch.randint(1, 100, (b, p, 16)),
        "cand_syl_ids": torch.randint(0, 50, (b, p, 8)),
        "cand_syl_count": torch.ones(b, p, dtype=torch.long) * 2,
        "cand_term_type_oh": torch.tensor([[[1.0, 0.0]] * p] * b),
        "cand_personal": torch.zeros(b, p, 3),
        "cand_domain": torch.zeros(b, p, 2),
        "pool_mask": torch.ones(b, p, dtype=torch.bool),
    }


def test_param_budget_under_warning():
    m = Model2StageAV1(Model2Config(syl_vocab=377))
    counts = count_parameters(m)
    n = counts["trainable_total"]
    assert n < 500_000, n
    assert n < 2_000_000
    # shared counted once
    assert counts["by_module"]["shared"] > 0
    assert counts["by_module"]["query_encoder"] < counts["by_module"]["shared"]
    assert counts["by_module"]["candidate_encoder"] < counts["by_module"]["shared"]


def test_mask_invariance_unit():
    m = Model2StageAV1(Model2Config(syl_vocab=377))
    m.eval()
    batch = _dummy_batch()
    with torch.no_grad():
        s0 = m(batch)["scores"]
        batch2 = dict(batch)
        batch2["phonetic_condition"] = torch.randn_like(batch["phonetic_condition"])
        batch2["tone_condition"] = torch.randn_like(batch["tone_condition"])
        s1 = m(batch2)["scores"]
    assert torch.allclose(s0, s1, atol=1e-6)


def test_no_term_id_embedding_table():
    m = Model2StageAV1(Model2Config(syl_vocab=377))
    names = [n for n, _ in m.named_parameters()]
    assert not any("term_id" in n for n in names)
    # Candidate path must go through shared char/syl tables
    assert any("shared.char_emb" in n for n in names)
    assert any("candidate_encoder" in n for n in names)


def test_term_positive_filter_and_hn_flag():
    from training.model2.training.dataset import classify_positive_bucket

    term = classify_positive_bucket(
        {"metadata": {"target_term": "上线", "source_type": "TTS_ASR_SYNTHETIC"}, "target": {"target_span": "上线"}},
        {"sample_kind": "POSITIVE", "source_type": "TTS_ASR_SYNTHETIC"},
    )
    non_term = classify_positive_bucket(
        {"metadata": {"target_term": "上线", "source_type": "TTS_ASR_SYNTHETIC"}, "target": {"target_span": "请"}},
        {"sample_kind": "POSITIVE", "source_type": "TTS_ASR_SYNTHETIC"},
    )
    rule = classify_positive_bucket(
        {"metadata": {"target_term": "南宁", "source_type": "RULE_SYNTHETIC"}, "target": {"target_span": "南宁"}},
        {"sample_kind": "POSITIVE", "source_type": "RULE_SYNTHETIC"},
    )
    assert term == "TERM_POSITIVE"
    assert non_term == "NON_TERM_POSITIVE"
    assert rule == "RULE_POSITIVE"
