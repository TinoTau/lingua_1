"""ToneModule — Phase3 acoustic slice payload types."""
from dataclasses import dataclass, field
from typing import List, Literal, Optional

ToneSkippedReason = Literal["no_audio", "no_timestamps", "non_zh", "model_error"]


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
class UtteranceAcousticTonePayload:
    tone_enabled: bool
    acoustic_tone_slices: List[AcousticToneSlice] = field(default_factory=list)
    slice_count: int = 0
    tone_confidence_avg: Optional[float] = None
    skipped_reason: Optional[ToneSkippedReason] = None

    def as_dict(self) -> dict:
        out = {
            "toneEnabled": self.tone_enabled,
            "acousticToneSlices": [s.as_dict() for s in self.acoustic_tone_slices],
            "sliceCount": self.slice_count,
        }
        if self.tone_confidence_avg is not None:
            out["toneConfidenceAvg"] = self.tone_confidence_avg
        if self.skipped_reason is not None:
            out["skippedReason"] = self.skipped_reason
        return out


# Backward-compatible alias for internal imports during migration
UtteranceTonePayload = UtteranceAcousticTonePayload
