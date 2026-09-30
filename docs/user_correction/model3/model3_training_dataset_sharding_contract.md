# Model3 Training Dataset Sharding Contract

**Status:** FROZEN (format audit 2026-08-23)

---

## Format

- **JSONL** only for V1 training shards  
- **No** training DB / index service for V1  

## Layout

```text
training/model3_dataset/<datasetVersion>/
  dataset_manifest.json
  train/shard-00000.jsonl
  train/shard-00001.jsonl
  ...
  dev/shard-00000.jsonl
  test/shard-00000.jsonl
  sidecar/   # optional audit / corruption provenance
```

## Samples per shard

**5,000–10,000** `MODEL3_TRAINING_SAMPLE_V1` rows per shard (prefer ~10k).

Train / dev / test are **separate directories**; never mix splits in one shard file.

## Split assignment

- **Group split only** on `groupKeys.sourceSentenceId` (+ `contrastGroupId` co-bound)  
- **Random row split:** FORBIDDEN  
- Same base sentence family → same split  

## Checksums

Each shard file: **SHA256** recorded in manifest.  
Manifest also records full-dataset checksum identity (ordered shard hash list).

## Sidecar

Large `corruptions[]` / generation debug → `sidecar/<sampleId>.json` or sidecar JSONL batches.  
Training shards stay loader-thin.
