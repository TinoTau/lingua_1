"""Versioned cache slots for multiple datasets / alignment sources."""
from __future__ import annotations

import json
import os
from typing import Optional

from tone_module.dataset.dataset_contract import DatasetManifest, DatasetMetadata


class CacheLayout:
    """`{cache_dir}/datasets/{dataset_id}/{version}/` — not a single global extract root."""

    def __init__(self, cache_dir: str) -> None:
        self.cache_dir = cache_dir

    def slot_dir(self, dataset_id: str, version: str) -> str:
        return os.path.join(self.cache_dir, "datasets", dataset_id, version)

    def manifest_path(self, dataset_id: str, version: str) -> str:
        return os.path.join(self.slot_dir(dataset_id, version), "manifest.json")

    def materialized_root(self, dataset_id: str, version: str) -> str:
        return os.path.join(self.slot_dir(dataset_id, version), "materialized")

    def archives_dir(self, dataset_id: str, version: str) -> str:
        return os.path.join(self.slot_dir(dataset_id, version), "archives")

    def legacy_extract_root(self) -> str:
        """Pre-P6-D layout (read-only fallback for data_mini migration)."""
        return os.path.join(self.cache_dir, "extracted", "dataset")

    def read_manifest(self, dataset_id: str, version: str) -> Optional[DatasetManifest]:
        path = self.manifest_path(dataset_id, version)
        if not os.path.isfile(path):
            return None
        with open(path, encoding="utf-8") as handle:
            payload = json.load(handle)
        meta = payload.get("metadata", {})
        metadata = DatasetMetadata(
            dataset_version=meta.get("dataset_version", payload.get("dataset_id", dataset_id)),
            source=meta.get("source", ""),
            license=meta.get("license", ""),
            alignment_provider=meta.get("alignment_provider", ""),
            speaker_count=meta.get("speaker_count"),
            utterance_count=meta.get("utterance_count"),
            syllable_count=meta.get("syllable_count"),
        )
        return DatasetManifest(
            dataset_id=payload["dataset_id"],
            version=payload["version"],
            materialized_root=payload["materialized_root"],
            metadata=metadata,
            alignment_source=payload.get("alignment_source", "default"),
        )

    def write_manifest(self, manifest: DatasetManifest) -> None:
        slot = self.slot_dir(manifest.dataset_id, manifest.version)
        os.makedirs(slot, exist_ok=True)
        payload = {
            "dataset_id": manifest.dataset_id,
            "version": manifest.version,
            "materialized_root": manifest.materialized_root,
            "alignment_source": manifest.alignment_source,
            "metadata": {
                "dataset_version": manifest.metadata.dataset_version,
                "source": manifest.metadata.source,
                "license": manifest.metadata.license,
                "alignment_provider": manifest.metadata.alignment_provider,
                "speaker_count": manifest.metadata.speaker_count,
                "utterance_count": manifest.metadata.utterance_count,
                "syllable_count": manifest.metadata.syllable_count,
            },
        }
        with open(self.manifest_path(manifest.dataset_id, manifest.version), "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2)
            handle.write("\n")

    def is_materialized_root_valid(self, root: str) -> bool:
        if not root or not os.path.isdir(root):
            return False
        has_wav = False
        has_textgrid = False
        for dirpath, _, filenames in os.walk(root):
            for name in filenames:
                if name.lower().endswith(".wav"):
                    has_wav = True
                if name.endswith(".TextGrid"):
                    has_textgrid = True
                if has_wav and has_textgrid:
                    return True
        return False
