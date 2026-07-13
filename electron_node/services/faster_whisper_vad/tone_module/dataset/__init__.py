"""Tone Training Foundation — dataset adapters and alignment providers."""
from tone_module.dataset.adapter_hf_zip import (
    DEFAULT_DATASET_REPO,
    DEFAULT_DATASET_ZIP,
    HuggingFaceZipDatasetAdapter,
    dataset_id_from_repo,
)
from tone_module.dataset.adapter_openslr_aishell3 import (
    DEFAULT_DATASET_ID as OPENSRL_AISHELL3_DATASET_ID,
    OpenSlrAishell3DatasetAdapter,
)
from tone_module.dataset.alignment_textgrid import TextGridPinyinAlignmentProvider
from tone_module.dataset.cache_layout import CacheLayout
from tone_module.dataset.dataset_contract import (
    DatasetAdapter,
    DatasetManifest,
    DatasetMetadata,
    SyllableSample,
    AlignmentProvider,
    enrich_manifest_counts,
)
from tone_module.dataset.pipeline import (
    aishell3_pipeline,
    default_data_mini_pipeline,
    load_syllable_samples,
)

__all__ = [
    "AlignmentProvider",
    "CacheLayout",
    "DatasetAdapter",
    "DatasetManifest",
    "DatasetMetadata",
    "DEFAULT_DATASET_REPO",
    "DEFAULT_DATASET_ZIP",
    "HuggingFaceZipDatasetAdapter",
    "OPENSRL_AISHELL3_DATASET_ID",
    "OpenSlrAishell3DatasetAdapter",
    "SyllableSample",
    "TextGridPinyinAlignmentProvider",
    "aishell3_pipeline",
    "dataset_id_from_repo",
    "default_data_mini_pipeline",
    "enrich_manifest_counts",
    "load_syllable_samples",
]
