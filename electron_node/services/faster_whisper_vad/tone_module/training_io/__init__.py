"""Training Engineering — Feature Shard IO (not Dataset Foundation).

Feature Shard V2 is a training cache / materialized feature artifact only.
The canonical V2 Training Path is: SyllableSample → WordInfo Adapter → extract_feature.
"""
from tone_module.training_io.boundary_consistency import audit_boundary_consistency, require_boundary_consistency_pass
from tone_module.training_io.feature_shard import (
    DEFAULT_SHARD_TARGET_ROWS,
    build_feature_shards,
    load_shard_manifest,
    load_split_meta,
    manifest_is_valid,
    training_features_root,
)
from tone_module.training_io.feature_shard_v2 import (
    DEFAULT_SHARD_TARGET_ROWS as DEFAULT_SHARD_TARGET_ROWS_V2,
    build_feature_shards_v2,
    load_shard_manifest_v2,
    load_split_meta_v2,
    manifest_is_valid_v2,
    training_features_v2_root,
)
from tone_module.training_io.feature_cache_v2_parallel import (
    DEFAULT_NUM_WORKERS,
    benchmark_parallel_vs_sequential,
    build_feature_cache_v2_parallel,
    load_v2_training_features_from_cache,
)
from tone_module.training_io.shard_reader import (
    MiniBatchReader,
    SequentialFeatureReader,
    ShardReader,
    fit_norm_stats,
)
from tone_module.training_io.shard_reader_v2 import SequentialFeatureReaderV2, ShardReaderV2
from tone_module.training_io.speaker_holdout import (
    filter_samples_by_max_speakers,
    split_speaker_holdout_samples,
    speaker_id_from_path,
    truncate_samples,
)
from tone_module.training_io.syllable_to_wordinfo import syllable_sample_to_word_info
from tone_module.training_io.v2_training_path import (
    V2TrainingInputBatch,
    WordInfoAdapterTrace,
    build_v2_training_batch,
    extract_v2_training_row,
    group_samples_by_wav,
)

__all__ = [
    "DEFAULT_SHARD_TARGET_ROWS",
    "DEFAULT_SHARD_TARGET_ROWS_V2",
    "DEFAULT_NUM_WORKERS",
    "MiniBatchReader",
    "SequentialFeatureReader",
    "SequentialFeatureReaderV2",
    "ShardReader",
    "ShardReaderV2",
    "audit_boundary_consistency",
    "build_feature_shards",
    "build_feature_shards_v2",
    "build_feature_cache_v2_parallel",
    "benchmark_parallel_vs_sequential",
    "filter_samples_by_max_speakers",
    "fit_norm_stats",
    "load_shard_manifest",
    "load_shard_manifest_v2",
    "load_split_meta",
    "load_split_meta_v2",
    "manifest_is_valid",
    "manifest_is_valid_v2",
    "require_boundary_consistency_pass",
    "speaker_id_from_path",
    "split_speaker_holdout_samples",
    "syllable_sample_to_word_info",
    "training_features_root",
    "training_features_v2_root",
    "truncate_samples",
    "V2TrainingInputBatch",
    "WordInfoAdapterTrace",
    "build_v2_training_batch",
    "extract_v2_training_row",
    "group_samples_by_wav",
    "load_v2_training_features_from_cache",
]
