"""Training Foundation — dataset contract (not Runtime SSOT)."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional, Protocol, runtime_checkable


@dataclass(frozen=True)
class SyllableSample:
    """Canonical training sample between Alignment and Feature Extraction."""

    wav_path: str
    start: float
    end: float
    label: int  # 0..4 => t1..t5


@dataclass
class DatasetMetadata:
    """Training-side dataset description (optional artifact / diagnostics only)."""

    dataset_version: str
    source: str
    license: str
    alignment_provider: str
    speaker_count: Optional[int] = None
    utterance_count: Optional[int] = None
    syllable_count: Optional[int] = None

    def to_metrics_dict(self) -> dict:
        out = {
            "datasetVersion": self.dataset_version,
            "source": self.source,
            "license": self.license,
            "alignmentProvider": self.alignment_provider,
        }
        if self.speaker_count is not None:
            out["speakerCount"] = self.speaker_count
        if self.utterance_count is not None:
            out["utteranceCount"] = self.utterance_count
        if self.syllable_count is not None:
            out["syllableCount"] = self.syllable_count
        return out


@dataclass
class DatasetManifest:
    """Materialized dataset index for a cache slot."""

    dataset_id: str
    version: str
    materialized_root: str
    metadata: DatasetMetadata
    alignment_source: str = "default"


@runtime_checkable
class DatasetAdapter(Protocol):
    """Downloads / materializes a dataset root for alignment providers."""

    dataset_id: str
    version: str

    def materialize(self, cache_dir: str) -> DatasetManifest:
        ...


@runtime_checkable
class AlignmentProvider(Protocol):
    """Produces SyllableSample list from a materialized dataset root."""

    provider_id: str

    def collect_samples(self, dataset_root: str) -> List[SyllableSample]:
        ...


def enrich_manifest_counts(manifest: DatasetManifest, samples: List[SyllableSample]) -> DatasetManifest:
    """Fill utterance/syllable/speaker counts on manifest metadata."""
    import os
    import re

    utterances = {os.path.basename(s.wav_path) for s in samples}
    speakers: set[str] = set()
    speaker_re = re.compile(r"(SSB\d+)", re.IGNORECASE)
    for sample in samples:
        match = speaker_re.search(sample.wav_path.replace("\\", "/"))
        if match:
            speakers.add(match.group(1).upper())
    manifest.metadata.utterance_count = len(utterances)
    manifest.metadata.syllable_count = len(samples)
    manifest.metadata.speaker_count = len(speakers) if speakers else None
    return manifest
