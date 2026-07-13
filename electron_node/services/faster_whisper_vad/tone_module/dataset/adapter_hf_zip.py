"""DatasetAdapter for HuggingFace dataset repos shipping a zip archive (default: data_mini)."""
from __future__ import annotations

import os
import zipfile

from tone_module.dataset.cache_layout import CacheLayout
from tone_module.dataset.dataset_contract import DatasetManifest, DatasetMetadata

DEFAULT_DATASET_REPO = "CS5647Team3/data_mini"
DEFAULT_DATASET_ZIP = "data_mini.zip"
DEFAULT_DATASET_VERSION = "v1"


def dataset_id_from_repo(dataset_repo: str) -> str:
    return dataset_repo.replace("/", "_").replace("\\", "_")


class HuggingFaceZipDatasetAdapter:
    """Materialize HF `dataset_repo` + `dataset_zip` into a versioned cache slot."""

    def __init__(
        self,
        *,
        dataset_repo: str = DEFAULT_DATASET_REPO,
        dataset_zip: str = DEFAULT_DATASET_ZIP,
        version: str = DEFAULT_DATASET_VERSION,
        source: str | None = None,
        license_note: str = "See upstream dataset license (AISHELL-3 subset: Apache-2.0)",
        alignment_provider: str = "textgrid_pinyin_v1",
    ) -> None:
        self.dataset_repo = dataset_repo
        self.dataset_zip = dataset_zip
        self.version = version
        self.dataset_id = dataset_id_from_repo(dataset_repo)
        self.source = source or dataset_repo
        self.license_note = license_note
        self.alignment_provider = alignment_provider

    def materialize(self, cache_dir: str) -> DatasetManifest:
        layout = CacheLayout(cache_dir)
        existing = layout.read_manifest(self.dataset_id, self.version)
        if existing and layout.is_materialized_root_valid(existing.materialized_root):
            return existing

        metadata = DatasetMetadata(
            dataset_version=self.dataset_repo,
            source=self.source,
            license=self.license_note,
            alignment_provider=self.alignment_provider,
        )
        materialized = layout.materialized_root(self.dataset_id, self.version)

        legacy_root = layout.legacy_extract_root()
        if layout.is_materialized_root_valid(legacy_root) and self.dataset_repo == DEFAULT_DATASET_REPO:
            manifest = DatasetManifest(
                dataset_id=self.dataset_id,
                version=self.version,
                materialized_root=legacy_root,
                metadata=metadata,
                alignment_source="legacy_extracted_dataset",
            )
            layout.write_manifest(manifest)
            return manifest

        os.makedirs(layout.archives_dir(self.dataset_id, self.version), exist_ok=True)
        os.makedirs(materialized, exist_ok=True)

        zip_path = os.path.join(cache_dir, self.dataset_zip)
        archive_path = os.path.join(layout.archives_dir(self.dataset_id, self.version), self.dataset_zip)
        if not os.path.isfile(zip_path) and not os.path.isfile(archive_path):
            from huggingface_hub import hf_hub_download

            print(f"Downloading {self.dataset_repo}/{self.dataset_zip} ...")
            hf_hub_download(
                self.dataset_repo,
                self.dataset_zip,
                repo_type="dataset",
                local_dir=cache_dir,
            )
        if os.path.isfile(zip_path) and not os.path.isfile(archive_path):
            import shutil

            shutil.copy2(zip_path, archive_path)

        extract_zip = archive_path if os.path.isfile(archive_path) else zip_path
        print(f"Extracting {extract_zip} ...")
        with zipfile.ZipFile(extract_zip) as zf:
            zf.extractall(materialized)

        content_root = materialized
        if not layout.is_materialized_root_valid(content_root):
            nested = os.path.join(materialized, "dataset")
            if layout.is_materialized_root_valid(nested):
                content_root = nested

        manifest = DatasetManifest(
            dataset_id=self.dataset_id,
            version=self.version,
            materialized_root=content_root,
            metadata=metadata,
            alignment_source="hf_zip",
        )
        layout.write_manifest(manifest)
        return manifest
