"""Emit Positive / Negative / HardNegative TrainingSampleV1 from alignment."""

from __future__ import annotations

from typing import Any, Optional

from training.model2.alignment.align import AlignedCorrectionSpan, align_codepoints
from training.model2.export.training_sample import (
    SyntheticMetadataV1,
    TrainingSampleCondition,
    TrainingSampleInput,
    TrainingSampleKind,
    TrainingSampleMetadata,
    TrainingSampleTarget,
    TrainingSampleV1,
    TrainingSourceType,
    default_schema_version,
    deterministic_sample_id,
    hash_user_group,
)
from training.model2.phonetic.syllables import syllables_key, text_to_syllables


def _norm_cmp(a: str, b: str) -> bool:
    return "".join(a.split()) == "".join(b.split())


def target_span_correct(gt: str, hyp: str, target_term: Optional[str]) -> bool:
    if _norm_cmp(gt, hyp):
        return True
    if target_term and target_term in hyp and target_term in gt:
        # Core term present in both — treat as NO_CHANGE for Model2 recall gate
        return True
    return False


def _source_type_from_meta(synthetic_meta: SyntheticMetadataV1) -> TrainingSourceType:
    raw = synthetic_meta.source_type
    try:
        return TrainingSourceType(raw)
    except ValueError:
        return TrainingSourceType.TTS_ASR_SYNTHETIC


def build_samples_from_asr(
    *,
    sample_plan_id: str,
    gt_text: str,
    hyp_text: str,
    target_term: Optional[str],
    domain: Optional[str],
    pseudo_user_group_id: str,
    synthetic_meta: SyntheticMetadataV1,
    target_pinyin: Optional[str] = None,
) -> list[TrainingSampleV1]:
    """Build POSITIVE (from ASR error spans) or NEGATIVE (exact/core-term OK)."""
    ug = hash_user_group(pseudo_user_group_id)
    synth = synthetic_meta.to_dict()
    event_id = f"synth-event-{sample_plan_id}"
    source_type = _source_type_from_meta(synthetic_meta)
    # realized flag from synthetic metadata (pronunciation-corrupted probe)
    realized = bool(synth.get("phonetic_profile_acoustically_realized"))
    not_realized = not realized

    if target_span_correct(gt_text, hyp_text, target_term):
        sid = deterministic_sample_id("ts", sample_plan_id, "NEG", gt_text, hyp_text)
        # N2: already-correct term span with a real fuzzy neighborhood.
        # N1: full-utterance span (often empty pool) when no term is available.
        if target_term and target_term in hyp_text:
            src = target_term
            neg_type = "N2"
        else:
            src = hyp_text
            neg_type = "N1"
        synth_n = dict(synth)
        synth_n["negative_type"] = neg_type
        return [
            TrainingSampleV1(
                schema_version=default_schema_version(),
                sample_id=sid,
                input=TrainingSampleInput(
                    source_span=src,
                    local_context=hyp_text,
                    source_pinyin=syllables_key(text_to_syllables(src)) or None,
                    available_tone_info=None,
                ),
                condition=TrainingSampleCondition(
                    source_profile_version=None,
                    profile_version_ref=None,
                    phonetic_profile_not_acoustically_realized=not_realized,
                ),
                target=TrainingSampleTarget(target_span="NO_CHANGE"),
                metadata=TrainingSampleMetadata(
                    source_type=source_type,
                    sample_kind=TrainingSampleKind.NEGATIVE,
                    correction_event_id=event_id,
                    user_group_key=ug,
                    target_term=target_term,
                    domain=domain,
                    synthetic=synth_n,
                ),
            )
        ]

    spans = align_codepoints(hyp_text, gt_text)
    if not spans:
        return []

    out: list[TrainingSampleV1] = []
    for i, span in enumerate(spans):
        if span.operation.value == "DELETE" and not span.target_text:
            if not span.source_text:
                continue
        src = span.source_text
        tgt = span.target_text or (target_term or "")
        if not tgt and span.operation.value == "DELETE":
            continue
        py = target_pinyin or syllables_key(text_to_syllables(src)) or None
        sid = deterministic_sample_id("ts", sample_plan_id, "POS", i, src, tgt)
        out.append(
            TrainingSampleV1(
                schema_version=default_schema_version(),
                sample_id=sid,
                input=TrainingSampleInput(
                    source_span=src,
                    local_context=hyp_text,
                    source_pinyin=py,
                    available_tone_info=None,
                ),
                condition=TrainingSampleCondition(
                    phonetic_profile_not_acoustically_realized=not_realized,
                ),
                target=TrainingSampleTarget(target_span=tgt if tgt else "NO_CHANGE"),
                metadata=TrainingSampleMetadata(
                    source_type=source_type,
                    sample_kind=TrainingSampleKind.POSITIVE,
                    correction_event_id=event_id,
                    user_group_key=ug,
                    target_term=target_term,
                    domain=domain,
                    synthetic=synth,
                ),
            )
        )
    return out


def build_hard_negative(
    *,
    sample_plan_id: str,
    hyp_text: str,
    biased_term: str,
    domain: Optional[str],
    pseudo_user_group_id: str,
    synthetic_meta: SyntheticMetadataV1,
) -> Optional[TrainingSampleV1]:
    """Bias suppression: utterance does NOT contain personal/high-bias term."""
    if biased_term in hyp_text:
        return None
    ug = hash_user_group(pseudo_user_group_id)
    synth = synthetic_meta.to_dict()
    synth["hard_negative_biased_term"] = biased_term
    sid = deterministic_sample_id("ts", sample_plan_id, "HN", biased_term)
    return TrainingSampleV1(
        schema_version=default_schema_version(),
        sample_id=sid,
        input=TrainingSampleInput(
            source_span=hyp_text,
            local_context=hyp_text,
            source_pinyin=syllables_key(text_to_syllables(hyp_text)) or None,
            available_tone_info=None,
        ),
        condition=TrainingSampleCondition(
            phonetic_profile_not_acoustically_realized=True,
        ),
        target=TrainingSampleTarget(target_span="NO_MATCH"),
        metadata=TrainingSampleMetadata(
            source_type=TrainingSourceType.TTS_ASR_SYNTHETIC,
            sample_kind=TrainingSampleKind.HARD_NEGATIVE,
            correction_event_id=f"synth-event-{sample_plan_id}-hn",
            user_group_key=ug,
            target_term=biased_term,
            domain=domain,
            synthetic=synth,
        ),
    )


def build_rule_synthetic_pair(
    *,
    sample_plan_id: str,
    source_span: str,
    target_span: str,
    context: str,
    pseudo_user_group_id: str,
    domain: Optional[str] = None,
) -> TrainingSampleV1:
    """Explicit text corruption — MUST use RULE_SYNTHETIC provenance."""
    meta = SyntheticMetadataV1(
        source_type=TrainingSourceType.RULE_SYNTHETIC.value,
        source_text_corpus="confusion_seed_rule",
        corruption_strategy="RULE_TEXT",
        corruption_parameters={"note": "text-level only; not acoustic"},
        phonetic_profile_not_acoustically_realized=True,
        tone_stage="NOT_RUN",
    )
    return TrainingSampleV1(
        schema_version=default_schema_version(),
        sample_id=deterministic_sample_id("ts", sample_plan_id, "RULE", source_span, target_span),
        input=TrainingSampleInput(
            source_span=source_span,
            local_context=context,
            source_pinyin=syllables_key(text_to_syllables(source_span)) or None,
        ),
        condition=TrainingSampleCondition(phonetic_profile_not_acoustically_realized=True),
        target=TrainingSampleTarget(target_span=target_span),
        metadata=TrainingSampleMetadata(
            source_type=TrainingSourceType.RULE_SYNTHETIC,
            sample_kind=TrainingSampleKind.POSITIVE,
            correction_event_id=f"rule-event-{sample_plan_id}",
            user_group_key=hash_user_group(pseudo_user_group_id),
            target_term=target_span,
            domain=domain,
            synthetic=meta.to_dict(),
        ),
    )
