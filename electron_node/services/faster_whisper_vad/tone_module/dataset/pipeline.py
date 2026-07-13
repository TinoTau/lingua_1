"""Dataset pipeline orchestration: Adapter → AlignmentProvider → SyllableSample[]."""
from __future__ import annotations

from typing import List, Tuple

from tone_module.dataset.alignment_textgrid import TextGridPinyinAlignmentProvider
from tone_module.dataset.adapter_hf_zip import HuggingFaceZipDatasetAdapter
from tone_module.dataset.adapter_openslr_aishell3 import OpenSlrAishell3DatasetAdapter
from tone_module.dataset.dataset_contract import (
    AlignmentProvider,
    DatasetAdapter,
    DatasetManifest,
    SyllableSample,
    enrich_manifest_counts,
)


def load_syllable_samples(
    adapter: DatasetAdapter,
    alignment: AlignmentProvider,
    cache_dir: str,
) -> Tuple[List[SyllableSample], DatasetManifest]:
    manifest = adapter.materialize(cache_dir)
    samples = alignment.collect_samples(manifest.materialized_root)
    manifest = enrich_manifest_counts(manifest, samples)
    return samples, manifest


def default_data_mini_pipeline(
    cache_dir: str,
    *,
    dataset_repo: str,
    dataset_zip: str,
) -> Tuple[List[SyllableSample], DatasetManifest]:
    adapter = HuggingFaceZipDatasetAdapter(dataset_repo=dataset_repo, dataset_zip=dataset_zip)
    alignment = TextGridPinyinAlignmentProvider()
    return load_syllable_samples(adapter, alignment, cache_dir)


def aishell3_pipeline(
    cache_dir: str,
    *,
    openslr_tgz: str | None = None,
    textgrid_zip: str | None = None,
    local_audio_root: str | None = None,
    local_textgrid_root: str | None = None,
    skip_download: bool = False,
) -> Tuple[List[SyllableSample], DatasetManifest]:
    adapter = OpenSlrAishell3DatasetAdapter(
        openslr_tgz=openslr_tgz,
        textgrid_zip=textgrid_zip,
        local_audio_root=local_audio_root,
        local_textgrid_root=local_textgrid_root,
        skip_download=skip_download,
    )
    alignment = TextGridPinyinAlignmentProvider()
    return load_syllable_samples(adapter, alignment, cache_dir)
