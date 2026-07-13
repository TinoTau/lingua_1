"""DatasetAdapter for OpenSLR SLR93 AISHELL-3 audio + lars76 MFA TextGrid alignment."""
from __future__ import annotations

import os
import shutil
import tarfile
import zipfile
from typing import Optional
from urllib.request import urlretrieve

from tone_module.dataset.cache_layout import CacheLayout
from tone_module.dataset.dataset_contract import DatasetManifest, DatasetMetadata

DEFAULT_DATASET_ID = "openslr_aishell3"
DEFAULT_DATASET_VERSION = "v1"
DEFAULT_TGZ_NAME = "data_aishell3.tgz"
DEFAULT_TEXTGRID_ZIP_NAME = "aishell3_textgrid_files.zip"

OPENSRL_SLR93_TGZ_URL = "https://www.openslr.org/resources/93/data_aishell3.tgz"
LARS76_TEXTGRID_ZIP_URL = (
    "https://github.com/lars76/forced-alignment-chinese/releases/latest/download/"
    "aishell3_textgrid_files.zip"
)

DEFAULT_SOURCE = "https://www.openslr.org/93 + lars76 forced-alignment-chinese"
DEFAULT_LICENSE = "AISHELL-3: Apache-2.0; TextGrid: see lars76 repo LICENSE"
DEFAULT_DATASET_VERSION_LABEL = "openslr_slr93_full"
DEFAULT_ALIGNMENT_SOURCE = "lars76_aishell3_textgrid"
DEFAULT_ALIGNMENT_PROVIDER = "textgrid_pinyin_v1"


def _link_or_copy_tree(src: str, dest: str) -> None:
    if os.path.lexists(dest):
        return
    parent = os.path.dirname(dest)
    if parent:
        os.makedirs(parent, exist_ok=True)
    try:
        os.symlink(src, dest, target_is_directory=True)
    except OSError:
        shutil.copytree(src, dest)


def _download_file(url: str, dest: str) -> None:
    if os.path.isfile(dest):
        return
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    print(f"Downloading {url} -> {dest} ...")
    urlretrieve(url, dest)


def _extract_tgz(tgz_path: str, dest_dir: str) -> None:
    marker = os.path.join(dest_dir, ".extracted")
    if os.path.isfile(marker):
        return
    os.makedirs(dest_dir, exist_ok=True)
    print(f"Extracting {tgz_path} -> {dest_dir} ...")
    with tarfile.open(tgz_path, "r:*") as archive:
        archive.extractall(dest_dir)
    with open(marker, "w", encoding="utf-8") as handle:
        handle.write("ok\n")


def _extract_zip(zip_path: str, dest_dir: str) -> None:
    marker = os.path.join(dest_dir, ".extracted")
    if os.path.isfile(marker):
        return
    os.makedirs(dest_dir, exist_ok=True)
    print(f"Extracting {zip_path} -> {dest_dir} ...")
    with zipfile.ZipFile(zip_path) as archive:
        archive.extractall(dest_dir)
    with open(marker, "w", encoding="utf-8") as handle:
        handle.write("ok\n")


class OpenSlrAishell3DatasetAdapter:
    """Materialize OpenSLR AISHELL-3 audio and lars76 TextGrid into a versioned cache slot."""

    def __init__(
        self,
        *,
        version: str = DEFAULT_DATASET_VERSION,
        openslr_tgz_url: str = OPENSRL_SLR93_TGZ_URL,
        textgrid_zip_url: str = LARS76_TEXTGRID_ZIP_URL,
        openslr_tgz: str | None = None,
        textgrid_zip: str | None = None,
        local_audio_root: str | None = None,
        local_textgrid_root: str | None = None,
        skip_download: bool = False,
        source: str = DEFAULT_SOURCE,
        license_note: str = DEFAULT_LICENSE,
        alignment_provider: str = DEFAULT_ALIGNMENT_PROVIDER,
    ) -> None:
        self.version = version
        self.dataset_id = DEFAULT_DATASET_ID
        self.openslr_tgz_url = openslr_tgz_url
        self.textgrid_zip_url = textgrid_zip_url
        self.openslr_tgz = openslr_tgz or os.environ.get("OPENSRL_AISHELL3_TGZ")
        self.textgrid_zip = textgrid_zip or os.environ.get("AISHELL3_TEXTGRID_ZIP")
        self.local_audio_root = local_audio_root
        self.local_textgrid_root = local_textgrid_root
        self.skip_download = skip_download
        self.source = source
        self.license_note = license_note
        self.alignment_provider = alignment_provider

    def materialize(self, cache_dir: str) -> DatasetManifest:
        layout = CacheLayout(cache_dir)
        existing = layout.read_manifest(self.dataset_id, self.version)
        if existing and layout.is_materialized_root_valid(existing.materialized_root):
            return existing

        metadata = DatasetMetadata(
            dataset_version=DEFAULT_DATASET_VERSION_LABEL,
            source=self.source,
            license=self.license_note,
            alignment_provider=self.alignment_provider,
        )
        materialized_root = layout.materialized_root(self.dataset_id, self.version)
        audio_dir = os.path.join(materialized_root, "audio")
        alignment_dir = os.path.join(materialized_root, "alignment")
        archives_dir = layout.archives_dir(self.dataset_id, self.version)
        os.makedirs(archives_dir, exist_ok=True)

        if self.local_audio_root and os.path.isdir(self.local_audio_root):
            _link_or_copy_tree(self.local_audio_root, audio_dir)
        else:
            archive_tgz = os.path.join(archives_dir, DEFAULT_TGZ_NAME)
            source_tgz = self.openslr_tgz
            if source_tgz and os.path.isfile(source_tgz) and not os.path.isfile(archive_tgz):
                shutil.copy2(source_tgz, archive_tgz)
            if not os.path.isfile(archive_tgz) and not self.skip_download:
                _download_file(self.openslr_tgz_url, archive_tgz)
            if not os.path.isfile(archive_tgz):
                raise FileNotFoundError(
                    "AISHELL-3 audio not found. Provide --openslr-tgz, --local-audio-root, "
                    "or OPENSRL_AISHELL3_TGZ, or allow download."
                )
            _extract_tgz(archive_tgz, audio_dir)

        if self.local_textgrid_root and os.path.isdir(self.local_textgrid_root):
            _link_or_copy_tree(self.local_textgrid_root, alignment_dir)
        else:
            archive_zip = os.path.join(archives_dir, DEFAULT_TEXTGRID_ZIP_NAME)
            source_zip = self.textgrid_zip
            if source_zip and os.path.isfile(source_zip) and not os.path.isfile(archive_zip):
                shutil.copy2(source_zip, archive_zip)
            if not os.path.isfile(archive_zip) and not self.skip_download:
                _download_file(self.textgrid_zip_url, archive_zip)
            if not os.path.isfile(archive_zip):
                raise FileNotFoundError(
                    "AISHELL-3 TextGrid zip not found. Provide --textgrid-zip, "
                    "--local-textgrid-root, or AISHELL3_TEXTGRID_ZIP, or allow download."
                )
            _extract_zip(archive_zip, alignment_dir)

        if not layout.is_materialized_root_valid(materialized_root):
            raise RuntimeError(
                f"Materialized AISHELL-3 root is invalid (missing wav or TextGrid): {materialized_root}"
            )

        manifest = DatasetManifest(
            dataset_id=self.dataset_id,
            version=self.version,
            materialized_root=materialized_root,
            metadata=metadata,
            alignment_source=DEFAULT_ALIGNMENT_SOURCE,
        )
        layout.write_manifest(manifest)
        return manifest
