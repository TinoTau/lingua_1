"""ToneModule — Phase3 acoustic slice payload types."""
from dataclasses import dataclass, field
from typing import List, Literal, Optional

ToneSkippedReason = Literal["no_audio", "no_timestamps", "non_zh", "model_error"]

ToneEvidenceProductionStatus = Literal[
    "slice_created",
    "short_duration_skipped",
    "feature_extraction_failed",
    "inference_output_missing",
    "invalid_word_time",
]


@dataclass
class TonePosterior:
    t1: float
    t2: float
    t3: float
    t4: float
    t5: float

    def as_dict(self) -> dict:
        return {
            "t1": self.t1,
            "t2": self.t2,
            "t3": self.t3,
            "t4": self.t4,
            "t5": self.t5,
        }


@dataclass
class AcousticToneSlice:
    start: float
    end: float
    tone_posterior: TonePosterior
    confidence: float

    def as_dict(self) -> dict:
        return {
            "start": self.start,
            "end": self.end,
            "tonePosterior": self.tone_posterior.as_dict(),
            "confidence": self.confidence,
        }


@dataclass
class ToneEvidenceProductionDiagnostic:
    """Why a Word did or did not produce a real AcousticToneSlice (not Evidence itself)."""

    word: str
    start: float
    end: float
    duration: float
    segment_index: int
    status: ToneEvidenceProductionStatus
    error_code: Optional[str] = None

    def as_dict(self) -> dict:
        out = {
            "word": self.word,
            "startSec": self.start,
            "endSec": self.end,
            "durationSec": self.duration,
            "segmentIndex": self.segment_index,
            "status": self.status,
        }
        if self.error_code is not None:
            out["errorCode"] = self.error_code
        return out


@dataclass
class UtteranceAcousticTonePayload:
    tone_enabled: bool
    acoustic_tone_slices: List[AcousticToneSlice] = field(default_factory=list)
    slice_count: int = 0
    tone_confidence_avg: Optional[float] = None
    skipped_reason: Optional[ToneSkippedReason] = None
    evidence_production: List[ToneEvidenceProductionDiagnostic] = field(default_factory=list)

    def as_dict(self) -> dict:
        out = {
            "toneEnabled": self.tone_enabled,
            "acousticToneSlices": [s.as_dict() for s in self.acoustic_tone_slices],
            "sliceCount": self.slice_count,
            "evidenceProduction": [d.as_dict() for d in self.evidence_production],
        }
        if self.tone_confidence_avg is not None:
            out["toneConfidenceAvg"] = self.tone_confidence_avg
        if self.skipped_reason is not None:
            out["skippedReason"] = self.skipped_reason
        return out
