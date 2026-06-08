"""ToneModule P0 — frozen payload types."""
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
class ToneToken:
    token: str
    start: float
    end: float
    tone_posterior: TonePosterior
    confidence: float

    def as_dict(self) -> dict:
        return {
            "token": self.token,
            "start": self.start,
            "end": self.end,
            "tonePosterior": self.tone_posterior.as_dict(),
            "confidence": self.confidence,
        }


@dataclass
class UtteranceTonePayload:
    tone_enabled: bool
    tone_tokens: List[ToneToken] = field(default_factory=list)
    tone_token_count: int = 0
    tone_confidence_avg: Optional[float] = None
    skipped_reason: Optional[ToneSkippedReason] = None
    alignment_text: Optional[str] = None

    def as_dict(self) -> dict:
        out = {
            "toneEnabled": self.tone_enabled,
            "toneTokens": [t.as_dict() for t in self.tone_tokens],
            "toneTokenCount": self.tone_token_count,
        }
        if self.tone_confidence_avg is not None:
            out["toneConfidenceAvg"] = self.tone_confidence_avg
        if self.skipped_reason is not None:
            out["skippedReason"] = self.skipped_reason
        if self.alignment_text is not None:
            out["alignmentText"] = self.alignment_text
        return out
