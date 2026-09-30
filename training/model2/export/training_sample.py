"""TrainingSample V1.1 Python mirror — additive fields; schema_version remains 1."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional
import hashlib
import json

from training.model2.constants import GENERATOR_VERSION
from training.model2.contract import TRAINING_SAMPLE_SCHEMA_VERSION


class TrainingSourceType(str, Enum):
    REAL_USER_CORRECTION = "REAL_USER_CORRECTION"
    TTS_ASR_SYNTHETIC = "TTS_ASR_SYNTHETIC"
    # Pronunciation corrupted BEFORE Piper; ASRHypothesis still from real ASR.
    TTS_PRONUNCIATION_CORRUPTED = "TTS_PRONUNCIATION_CORRUPTED"
    RULE_SYNTHETIC = "RULE_SYNTHETIC"
    PUBLIC_CORPUS = "PUBLIC_CORPUS"
    HUMAN_ANNOTATED = "HUMAN_ANNOTATED"


class TrainingSampleKind(str, Enum):
    POSITIVE = "POSITIVE"
    NEGATIVE = "NEGATIVE"
    HARD_NEGATIVE = "HARD_NEGATIVE"


class SpanOperation(str, Enum):
    REPLACE = "REPLACE"
    INSERT = "INSERT"
    DELETE = "DELETE"


@dataclass
class SyntheticMetadataV1:
    generator_version: str = GENERATOR_VERSION
    source_type: str = TrainingSourceType.TTS_ASR_SYNTHETIC.value
    source_text_corpus: str = "carrier_templates_v1+lexicon_v3"
    tts_service_id: Optional[str] = None
    tts_model_id: Optional[str] = None
    tts_model_version: Optional[str] = None
    tts_voice_id: Optional[str] = None
    tts_sample_rate: Optional[int] = None
    asr_service_id: Optional[str] = None
    asr_model_id: Optional[str] = None
    asr_model_version: Optional[str] = None
    asr_compute_type: Optional[str] = None
    corruption_strategy: Optional[str] = None
    corruption_parameters: Optional[dict[str, Any]] = None
    random_seed: Optional[int] = None
    audio_manifest_id: Optional[str] = None
    pseudo_user_group_id: Optional[str] = None
    target_term: Optional[str] = None
    domain_tags: Optional[list[str]] = None
    tone_stage: str = "NOT_RUN"
    phonetic_profile_not_acoustically_realized: bool = True
    phonetic_profile_acoustically_realized: bool = False
    observed_asr_phonetic_difference: Optional[str] = None
    hard_negative_biased_term: Optional[str] = None
    # Pronunciation-corrupted TTS probe (optional)
    ground_truth_text: Optional[str] = None
    tts_input_text: Optional[str] = None
    corruption_family: Optional[str] = None
    corruption_direction: Optional[str] = None
    target_original_syllables: Optional[list[str]] = None
    intended_corrupted_syllables: Optional[list[str]] = None
    tts_surface: Optional[str] = None
    tts_surface_resolution_method: Optional[str] = None
    tts_surface_resolver_version: Optional[str] = None
    realization_status: Optional[str] = None
    pseudo_user_id: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        return {k: v for k, v in asdict(self).items() if v is not None}


@dataclass
class ConditionMasksV1:
    """Availability masks — 0 means unknown/masked, not 'user has no bias'."""

    phonetic_mask: list[int] = field(default_factory=lambda: [0] * 16)
    tone_mask: list[int] = field(default_factory=lambda: [0] * 12)
    domain_mask: list[int] = field(default_factory=lambda: [0] * 12)
    profile_available: int = 0
    phonetic_profile_acoustically_realized: int = 0


@dataclass
class TrainingArtifactV1:
    """Derived training-only fields — NOT CorrectionEvent SSOT."""

    fuzzy_pool_term_ids: list[str] = field(default_factory=list)
    target_term_id: Optional[str] = None
    fuzzy_pool_version: Optional[str] = None
    candidate_index_version: Optional[str] = None


@dataclass
class TrainingSampleInput:
    source_span: str
    local_context: str
    source_pinyin: Optional[str] = None
    available_tone_info: Optional[Any] = None
    # V1.1 additive
    span_operation: Optional[str] = None
    context_left: Optional[str] = None
    context_right: Optional[str] = None
    span_start: Optional[int] = None
    span_end: Optional[int] = None


@dataclass
class TrainingSampleCondition:
    source_profile_version: Optional[int] = None
    profile_version_ref: Optional[int] = None
    phonetic_profile_not_acoustically_realized: bool = True
    # V1.1 additive
    user_condition_ref: Optional[str] = None
    condition_masks: Optional[dict[str, Any]] = None


@dataclass
class TrainingSampleTarget:
    target_span: str


@dataclass
class TrainingSampleMetadata:
    source_type: TrainingSourceType
    sample_kind: TrainingSampleKind
    correction_event_id: str
    user_group_key: str
    target_term: Optional[str] = None
    domain: Optional[str] = None
    normalizer_version: str = "corr-normalizer-v1"
    extractor_version: str = "model2-synth-extractor-v1"
    pipeline_version: Optional[str] = GENERATOR_VERSION
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    superseded_for_profile: bool = False
    exclude_from_default_positive_export: bool = False
    synthetic: Optional[dict[str, Any]] = None
    # V1.1 additive training artifact
    training: Optional[dict[str, Any]] = None


@dataclass
class TrainingSampleV1:
    schema_version: int
    sample_id: str
    input: TrainingSampleInput
    condition: TrainingSampleCondition
    target: TrainingSampleTarget
    metadata: TrainingSampleMetadata

    def to_dict(self) -> dict[str, Any]:
        inp = {k: v for k, v in asdict(self.input).items() if v is not None}
        cond = {k: v for k, v in asdict(self.condition).items() if v is not None}
        return {
            "schema_version": self.schema_version,
            "sample_id": self.sample_id,
            "input": inp,
            "condition": cond,
            "target": asdict(self.target),
            "metadata": {
                **{k: v for k, v in asdict(self.metadata).items() if v is not None or k in ("superseded_for_profile", "exclude_from_default_positive_export")},
                "source_type": self.metadata.source_type.value
                if isinstance(self.metadata.source_type, TrainingSourceType)
                else self.metadata.source_type,
                "sample_kind": self.metadata.sample_kind.value
                if isinstance(self.metadata.sample_kind, TrainingSampleKind)
                else self.metadata.sample_kind,
            },
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "TrainingSampleV1":
        md = d["metadata"]
        inp = d["input"]
        cond = d["condition"]
        # Filter known fields for forward compat
        input_fields = {f.name for f in TrainingSampleInput.__dataclass_fields__.values()}  # type: ignore
        cond_fields = {f.name for f in TrainingSampleCondition.__dataclass_fields__.values()}  # type: ignore
        return cls(
            schema_version=int(d.get("schema_version", TRAINING_SAMPLE_SCHEMA_VERSION)),
            sample_id=d["sample_id"],
            input=TrainingSampleInput(**{k: v for k, v in inp.items() if k in input_fields}),
            condition=TrainingSampleCondition(**{k: v for k, v in cond.items() if k in cond_fields}),
            target=TrainingSampleTarget(**d["target"]),
            metadata=TrainingSampleMetadata(
                source_type=TrainingSourceType(md["source_type"]),
                sample_kind=TrainingSampleKind(md["sample_kind"]),
                correction_event_id=md["correction_event_id"],
                user_group_key=md["user_group_key"],
                target_term=md.get("target_term"),
                domain=md.get("domain"),
                normalizer_version=md.get("normalizer_version", "corr-normalizer-v1"),
                extractor_version=md.get("extractor_version", "model2-synth-extractor-v1"),
                pipeline_version=md.get("pipeline_version"),
                created_at=md.get("created_at", datetime.now(timezone.utc).isoformat()),
                superseded_for_profile=bool(md.get("superseded_for_profile", False)),
                exclude_from_default_positive_export=bool(
                    md.get("exclude_from_default_positive_export", False)
                ),
                synthetic=md.get("synthetic"),
                training=md.get("training"),
            ),
        )


def stage_a_masks() -> ConditionMasksV1:
    return ConditionMasksV1(
        phonetic_mask=[0] * 16,
        tone_mask=[0] * 12,
        domain_mask=[0] * 12,
        profile_available=0,
        phonetic_profile_acoustically_realized=0,
    )


def deterministic_sample_id(prefix: str, *parts: Any) -> str:
    raw = "|".join(str(p) for p in parts)
    h = hashlib.sha256(raw.encode("utf-8")).hexdigest()[:24]
    return f"{prefix}-{h}"


def hash_user_group(user_id: str) -> str:
    h = hashlib.sha256(user_id.encode("utf-8")).hexdigest()[:16]
    return f"ug-{h}"


def dumps_jsonl(samples: list[TrainingSampleV1]) -> str:
    return "\n".join(json.dumps(s.to_dict(), ensure_ascii=False) for s in samples) + (
        "\n" if samples else ""
    )


def default_schema_version() -> int:
    return TRAINING_SAMPLE_SCHEMA_VERSION
