"""Tests for AmbiguityClass V1 and context leak (no TTS)."""

from __future__ import annotations

from training.model2.ambiguity.taxonomy import classify_ambiguity, fuzzy_ambiguity_score, is_ambiguous_class
from training.model2.scripts.build_scale_plan import context_target_leak
from training.model2.scripts.build_scale_trainrows import context_leak


def test_equal_distance_class():
    dists = [1, 1, 2]
    score = fuzzy_ambiguity_score(target_distance=1, distances=dists, target_index=0)
    assert score["num_candidates_at_best_distance"] == 2
    assert score["target_is_unique_nearest"] is False
    cls = classify_ambiguity(
        target_distance=1,
        distances=dists,
        target_index=0,
        span_syllables=["a", "b"],
        candidate_pinyins=[["a", "b"], ["a", "c"], ["x", "y"]],
    )
    assert cls == "EQUAL_DISTANCE"
    assert is_ambiguous_class(cls)


def test_non_ambiguous_unique_nearest():
    dists = [0, 2, 2]
    cls = classify_ambiguity(
        target_distance=0,
        distances=dists,
        target_index=0,
        span_syllables=["a", "b"],
        candidate_pinyins=[["a", "b"], ["x", "y"], ["p", "q"]],
    )
    assert cls == "NON_AMBIGUOUS"
    # gap=1 but unique nearest still NON_AMBIGUOUS (distance baseline wins)
    cls2 = classify_ambiguity(
        target_distance=0,
        distances=[0, 1, 2],
        target_index=0,
        span_syllables=["a", "b"],
        candidate_pinyins=[["a", "b"], ["a", "c"], ["x", "y"]],
    )
    assert cls2 == "NON_AMBIGUOUS"


def test_context_leak_detects_repeat():
    assert context_target_leak("米尔福德的米尔福德游船", "米尔福德") is True
    assert context_target_leak("我想预订候选", "候选") is False
    assert context_leak("我想预订", "今天", "候选", "候") is False
    assert context_leak("候选附近的", "", "候选", "候") is True
