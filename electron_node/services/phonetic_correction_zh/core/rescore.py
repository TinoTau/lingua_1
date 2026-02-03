# -*- coding: utf-8 -*-
"""同音候选 + LM 打分 + delta 选优。"""

from typing import Optional

from .confusion_set import get_replaceable_positions, generate_candidates
from .lm_scorer import get_lm_scorer

MIN_LEN = 2
MAX_LEN = 120
DEFAULT_MAX_POSITIONS = 2
DEFAULT_MAX_CANDIDATES = 24
DEFAULT_DELTA = 1.0


def rescore_with_lm(
    text: str,
    service_dir: str,
    max_positions: int = DEFAULT_MAX_POSITIONS,
    max_candidates: int = DEFAULT_MAX_CANDIDATES,
    delta: float = DEFAULT_DELTA,
) -> tuple:
    """候选生成 → LM 打分 → 仅当 score(best) - score(original) >= delta 时替换。"""
    t = text.strip()
    if not t or len(t) < MIN_LEN or len(t) > MAX_LEN:
        return text, False, None, None
    scorer = get_lm_scorer(service_dir)
    if scorer is None:
        return text, False, None, None
    positions = get_replaceable_positions(t, max_positions)
    if not positions:
        return text, False, None, None
    candidates = generate_candidates(t, positions, max_candidates)
    orig_score, _ = scorer.score(t)
    best_text = t
    best_score = orig_score
    for i in range(1, len(candidates)):
        s, _ = scorer.score(candidates[i])
        if s > best_score:
            best_score = s
            best_text = candidates[i]
    delta_score = best_score - orig_score
    if delta_score < delta:
        return text, False, delta_score, len(candidates)
    return best_text, True, delta_score, len(candidates)


def phonetic_correct(
    text: str,
    service_dir: str,
    max_positions: int = DEFAULT_MAX_POSITIONS,
    max_candidates: int = DEFAULT_MAX_CANDIDATES,
    delta: float = DEFAULT_DELTA,
) -> str:
    """唯一入口：有 LM 则 rescore 选优，无 LM 或无可替换位点则返回原文。"""
    t = text.strip()
    if not t:
        return text
    result_text, _, _, _ = rescore_with_lm(
        text, service_dir, max_positions, max_candidates, delta
    )
    return result_text
