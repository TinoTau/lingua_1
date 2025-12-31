"""
Aggregator core decision logic: Text Incompleteness Score + Language Stability Gate
Copy-paste friendly. No third-party deps.
"""

from __future__ import annotations
from dataclasses import dataclass
from typing import Optional, Literal

Mode = Literal["offline", "room"]
StreamAction = Literal["MERGE", "NEW_STREAM"]


@dataclass
class LangProbs:
    top1: str
    p1: float
    top2: Optional[str] = None
    p2: Optional[float] = None


@dataclass
class UtteranceInfo:
    text: str
    start_ms: int
    end_ms: int
    lang: LangProbs
    quality_score: Optional[float] = None
    is_final: bool = False
    is_manual_cut: bool = False


@dataclass
class AggregatorTuning:
    strong_merge_ms: int
    soft_gap_ms: int
    hard_gap_ms: int

    lang_stable_p: float
    lang_switch_margin: float
    lang_switch_requires_gap_ms: int

    score_threshold: int
    w_short: int
    w_very_short: int
    w_gap_short: int
    w_no_strong_punct: int
    w_ends_with_connective: int
    w_low_quality: int
    low_quality_threshold: float

    short_cjk_chars: int
    very_short_cjk_chars: int
    short_en_words: int
    very_short_en_words: int

    commit_interval_ms: int
    commit_len_cjk: int
    commit_len_en_words: int


def default_tuning(mode: Mode) -> AggregatorTuning:
    is_room = mode == "room"
    return AggregatorTuning(
        strong_merge_ms=600 if is_room else 700,
        soft_gap_ms=1000 if is_room else 1500,
        hard_gap_ms=1500 if is_room else 2000,

        lang_stable_p=0.80,
        lang_switch_margin=0.18 if is_room else 0.15,
        lang_switch_requires_gap_ms=500 if is_room else 600,

        score_threshold=3,
        w_short=2,
        w_very_short=3,
        w_gap_short=2,
        w_no_strong_punct=1,
        w_ends_with_connective=1,
        w_low_quality=1,
        low_quality_threshold=0.50 if is_room else 0.45,

        short_cjk_chars=9 if is_room else 10,
        very_short_cjk_chars=4,
        short_en_words=5 if is_room else 6,
        very_short_en_words=3,

        commit_interval_ms=900 if is_room else 1400,
        commit_len_cjk=22 if is_room else 30,
        commit_len_en_words=10 if is_room else 12,
    )


def decide_stream_action(
    prev: Optional[UtteranceInfo],
    curr: UtteranceInfo,
    mode: Mode,
    tuning: Optional[AggregatorTuning] = None,
) -> StreamAction:
    tuning = tuning or default_tuning(mode)
    if prev is None:
        return "NEW_STREAM"

    gap_ms = max(0, curr.start_ms - prev.end_ms)

    # Hard rules
    if curr.is_final or curr.is_manual_cut:
        return "NEW_STREAM"
    if gap_ms >= tuning.hard_gap_ms:
        return "NEW_STREAM"

    # Language stability gate
    if is_lang_switch_confident(prev.lang, curr.lang, gap_ms, tuning):
        return "NEW_STREAM"

    # Strong merge if extremely continuous
    if gap_ms <= tuning.strong_merge_ms:
        return "MERGE"

    score = text_incompleteness_score(prev, curr, gap_ms, tuning)
    if score >= tuning.score_threshold and gap_ms <= tuning.soft_gap_ms:
        return "MERGE"
    return "NEW_STREAM"


def is_lang_switch_confident(
    prev_lang: LangProbs,
    curr_lang: LangProbs,
    gap_ms: int,
    tuning: AggregatorTuning,
) -> bool:
    if gap_ms <= tuning.lang_switch_requires_gap_ms:
        return False
    if prev_lang.p1 < tuning.lang_stable_p or curr_lang.p1 < tuning.lang_stable_p:
        return False
    if prev_lang.top1 == curr_lang.top1:
        return False
    p2 = curr_lang.p2 or 0.0
    return (curr_lang.p1 - p2) >= tuning.lang_switch_margin


def text_incompleteness_score(
    prev: UtteranceInfo,
    curr: UtteranceInfo,
    gap_ms: int,
    tuning: AggregatorTuning,
) -> int:
    score = 0

    is_cjk = looks_like_cjk(curr.text)
    cjk_chars = count_cjk_chars(curr.text) if is_cjk else 0
    en_words = count_words(curr.text) if not is_cjk else 0

    short = (cjk_chars < tuning.short_cjk_chars) if is_cjk else (en_words < tuning.short_en_words)
    very_short = (cjk_chars < tuning.very_short_cjk_chars) if is_cjk else (en_words < tuning.very_short_en_words)

    if very_short:
        score += tuning.w_very_short
    elif short:
        score += tuning.w_short

    if gap_ms < (tuning.strong_merge_ms + 200):
        score += tuning.w_gap_short

    if not ends_with_strong_sentence_punct(curr.text):
        score += tuning.w_no_strong_punct

    if ends_with_connective_or_filler(curr.text):
        score += tuning.w_ends_with_connective

    q = curr.quality_score if curr.quality_score is not None else 1.0
    if q < tuning.low_quality_threshold:
        score += tuning.w_low_quality

    if (not ends_with_strong_sentence_punct(prev.text)) and gap_ms <= tuning.soft_gap_ms:
        score += 1

    return score


def should_commit(
    pending_text: str,
    last_commit_ts_ms: int,
    now_ms: int,
    mode: Mode,
    tuning: Optional[AggregatorTuning] = None,
) -> bool:
    tuning = tuning or default_tuning(mode)
    if (now_ms - last_commit_ts_ms) >= tuning.commit_interval_ms:
        return True
    if looks_like_cjk(pending_text):
        return count_cjk_chars(pending_text) >= tuning.commit_len_cjk
    return count_words(pending_text) >= tuning.commit_len_en_words


# ---------- helpers ----------

def ends_with_strong_sentence_punct(s: str) -> bool:
    t = s.strip()
    return bool(t) and t[-1] in "。！？.!?；;"


def looks_like_cjk(s: str) -> bool:
    for ch in s:
        u = ord(ch)
        if (0x3040 <= u <= 0x30FF) or (0x3400 <= u <= 0x4DBF) or (0x4E00 <= u <= 0x9FFF) or (0xAC00 <= u <= 0xD7AF):
            return True
    return False


def count_cjk_chars(s: str) -> int:
    n = 0
    for ch in s:
        u = ord(ch)
        if (0x3040 <= u <= 0x30FF) or (0x3400 <= u <= 0x4DBF) or (0x4E00 <= u <= 0x9FFF) or (0xAC00 <= u <= 0xD7AF):
            n += 1
    return n


def count_words(s: str) -> int:
    return len([w for w in s.strip().split() if w])


def ends_with_connective_or_filler(s: str) -> bool:
    t = s.strip().lower()
    if not t:
        return False

    en = ["and", "but", "so", "because", "then"]
    for w in en:
        if t == w or t.endswith(" " + w):
            return True

    zh = ["然后", "所以", "但是", "就是", "那个", "嗯", "呃"]
    ja = ["で", "から", "けど", "えっと"]
    ko = ["그리고", "근데", "그래서", "어", "음"]
    for w in zh + ja + ko:
        if t.endswith(w):
            return True
    return False
