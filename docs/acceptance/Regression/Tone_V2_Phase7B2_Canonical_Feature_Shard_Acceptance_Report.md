<!-- Documentation Hierarchy Metadata
Status: **ACCEPTANCE_RECORD**
Superseded By: Evidence only — not CURRENT
Archive Path: docs/acceptance/Regression/Tone_V2_Phase7B2_Canonical_Feature_Shard_Acceptance_Report.md
-->

> **ACCEPTANCE_RECORD** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: Evidence only — not CURRENT

# Tone V2 Phase 7-B2 — Canonical Full Feature Shard Build Acceptance Report

**Date:** 2026-06-30  
**Phase:** 7-B2（Canonical Full Feature Shard Build Acceptance）  
**类型：** 验收（**非训练** · **非 Runtime** · **非 Dataset Foundation 修改**）  
**依据：** Phase 7-A Freeze · Phase 7-B1 Training IO Engineering · `TONE_V2_TERMINOLOGY.md`

**本轮禁令遵守：** 未训练 `tone_cnn_p3` · 未生成正式模型权重 · 未修改 Runtime / Loader / Contract / mel / Dataset Foundation / validate_artifact

---

## Executive Summary

Phase 7-B2 在 Canonical AISHELL-3 全量数据（**997,992** 音节 · **218** 说话人）上完成 **Feature Shard** 构建与 Level 1–4 验收。

| 验收层 | 结果 |
|--------|------|
| Level 1 Unit Test | **PASS** |
| Level 2 Dataset Probe（Phase 7-A 对齐） | **PASS** |
| Level 3 Training IO Validation | **PASS** |
| Level 4 Frozen Architecture Verification | **PASS** |

全量 `build-feature-shards` 耗时 **2147.3 s（≈35.8 min）**，生成 **21** 个 shard，磁盘 **332 MB**。Level 3 探针 `final_verdict: PASS`；Mini-batch Reader 完整 epoch 覆盖 **850,680** train 样本。

**Final Verdict: PASS**

---

## Canonical Dataset Summary

来源：Phase 7-A 冻结验收 `phase7a_acceptance.json`

| 指标 | 值 |
|------|-----|
| dataset_id | `openslr_aishell3` |
| version | `v1` |
| speakers | 218 |
| utterances | 88,035 |
| syllables | **997,992** |
| wav_join_rate | 100% |
| alignment | `textgrid_pinyin_v1` / `lars76_aishell3_textgrid` |

---

## Feature Shard Summary

**路径：** `tone_module/_data_cache/datasets/openslr_aishell3/v1/training_features/`

| 字段 | 值 |
|------|-----|
| schemaVersion | `training_feature_shard_v1` |
| featureVersion | `p0-v1` |
| nMels | **80** |
| sampleCount | **997,992** |
| shardCount | **21** |
| holdout | **speaker**（Canonical 默认） |
| buildTime | `2026-06-30T03:46:04Z` |

**构建命令：**

```bash
python -m tone_module.training_io.probe_feature_shard build \
  --cache-dir tone_module/_data_cache \
  --build-report-json tone_module/_data_cache/datasets/openslr_aishell3/v1/phase7b2_build_report.json
```

（内部调用 `python -m tone_module.train_tone_cnn build-feature-shards --dataset aishell3 --holdout speaker --skip-download`）

---

## Shard Manifest

完整 manifest 见：`training_features/shard_manifest.json`

| shard | offset | count | size (bytes) |
|-------|--------|-------|----------------|
| shard_000 … shard_016 | 0 … 800,000 | 50,000 each | ~16,800,760 |
| shard_017 | 850,000 | 680 | 229,240 |
| shard_018 … shard_019 | 850,680 … 900,680 | 50,000 each | ~16,800,760 |
| shard_020 | 950,680 | 47,312 | 15,897,592 |

**说明：** train 段末片（shard_017）与 val 段首片（shard_018）连续编号，无覆盖（7-B1 索引修复已生效）。

**manifest_logical_digest（可重复性指纹，不含 buildTime/buildCommand）：**  
`ad0f76623743a429848918dd2345bff3af7a78aa8b70fffdfbd164b3b7c9c300`

---

## Shard Statistics

| 统计项 | 值 |
|--------|-----|
| 总 shard 数 | 21 |
| 总样本数 | 997,992 |
| 平均每 shard 样本数 | ≈ 47,523（末片较小） |
| 总磁盘占用 | **348,210,533 B（332.08 MB）** |
| 平均每 shard 大小 | **16,581,453 B（≈15.8 MB）** |

---

## Performance Report

| 指标 | 值 |
|------|-----|
| Shard 构建总耗时 | **2147.3 s（35.8 min）** |
| 构建 exit_code | 0 |
| Level 3 accept 探针耗时 | ≈35 min（含全量 Mini-batch epoch） |
| Mini-batch 完整 epoch（train） | **850,680 rows / batch_size=128** · **PASS** |
| Sequential 全量读取 | **997,992 rows**（shard-ordered mmap）· **PASS** |
| ShardReader spot checks | 4,096 随机索引 · **PASS** |

**读取速度（探针 spot `get_row` 基准）：** 5,000 样本 / 175.7 s ≈ **28.5 rows/s**（单点随机访问，非训练热路径）。训练热路径经 `get_rows` 分片批量读取后，10k Mini-batch epoch ≈ **2.8 s**。

---

## Memory Report

| 阶段 | 结论 |
|------|------|
| Shard **构建** | **无 OOM**；进程正常退出（exit 0）。源码审计：**无 `audio_cache`**；按 utterance 单次 `sf.read` + shard buffer |
| Shard **训练读取** | Mini-batch / `get_rows` 按 batch 加载；**无全量 wav 常驻** |
| 构建期 RSS 峰值 | 首轮监控未捕获子进程树（`peak_rss_bytes: 0`）；按设计单 utterance + buffer **≪ 50 GB** 历史 OOM 路径 |
| 7-B2 优化后 `fit_norm_stats` | 分块 `get_rows`（10k chunk），避免逐行 `get_row` 慢路径 |

**结论：** `audio_cache` 导致的 **~50 GB OOM 风险已在 Feature Shard 构建与 Shard 训练路径消除**。

---

## Disk Usage Report

| 路径 | 大小 |
|------|------|
| `training_features/`（含 manifest + holdout + shards） | **332.08 MB** |
| `holdout/split_meta.json` | **≈12.3 MB**（含 train/val 全局索引） |
| 相对 materialized 音频（~25–30 GB） | **≈1.1%** |

---

## Reader Validation

| 组件 | 模式 | 结果 |
|------|------|------|
| **ShardReader** | 分片完整性 + 4096 spot checks | **PASS** |
| **Sequential Feature Reader** | shard-ordered mmap 顺序 997,992 行 | **PASS** |
| **Mini-batch Reader** | 完整 epoch · 850,680 train 行 | **PASS** |

Level 3 验收 JSON：`phase7b2_acceptance.json` · `final_verdict: PASS`

---

## Speaker Holdout Validation

| 指标 | 值 |
|------|-----|
| holdout | `speaker` |
| train speakers | **186** |
| val speakers | **32** |
| train samples | **850,680** |
| val samples | **147,312** |
| speaker 交集 | **∅**（无泄漏） |
| 说话人合计 | **218**（与 Phase 7-A 一致） |

---

## Repeatability Validation

| 项 | 结果 |
|----|------|
| Fixture 双次 `build_feature_shards` | `manifest_logical_digest` **一致**（`test_phase7b2`） |
| Canonical digest 记录 | `ad0f7662…`（供后续重建比对） |
| `build-feature-shards` 可重复执行 | **是**（同一 holdout/seed 下逻辑字段确定） |
| volatile 字段 | 仅 `buildTime` / `buildCommand` |

---

## Frozen Architecture Verification

**本轮 B2 触达（Training Engineering only）：**

| 文件 | 操作 |
|------|------|
| `training_io/probe_feature_shard.py` | **ADD** — Level 3 验收探针 |
| `training_io/shard_reader.py` | **MODIFY** — `get_rows` 分片批量读 · `fit_norm_stats` 分块 |
| `test_phase7b2_canonical_feature_shard.py` | **ADD** |

**未修改：** `contract.py` · `mel.py` · `loader.py` · `inference.py` · `validate_artifact.py` · `dataset/**` · Runtime / Node E2E

**无：** 第二训练入口 · 第二 Feature Pipeline · Shadow / Registry / Switching / A/B

---

## Architecture Drift Audit

| 检查 | 结果 |
|------|------|
| 第二训练链路 | ❌ 无 |
| Runtime 修改（本轮） | ❌ 无 |
| Dataset Foundation 修改 | ❌ 无 |
| 正式 p3 权重 | ❌ 未生成 |
| Streaming 术语 | ❌ 未使用 |
| 构建期 `audio_cache` | ❌ 无 |
| 训练期全量 wav 加载 | ❌ 无（aishell3 + `--skip-shard-build` 走 Shard） |

---

## KEEP / MODIFY / RESTORE / DELETE

| 分类 | 项 |
|------|-----|
| **KEEP** | `train_tone_cnn build-feature-shards` · `training_io/*` · Phase 7-A dataset 槽 · data_mini 回归路径 |
| **MODIFY** | `shard_reader.get_rows` / `fit_norm_stats`（性能，7-B2） |
| **ADD** | `probe_feature_shard.py` · `test_phase7b2` · `phase7b2_acceptance.json` |
| **RESTORE** | — |
| **DELETE** | — |

---

## Remaining Risks

1. **构建前仍须一次全量 `aishell3_pipeline()` 物化样本列表**（~997k `SyllableSample` 在 RAM，约 20+ min），此内存为 **Dataset Foundation 只读接入** 成本，非 `audio_cache`；defer 优化至后续（pipeline 级流式物化）。
2. **`split_meta.json` 含显式全局索引列表（≈12 MB）**，超大训练集可改用范围表示（非 B2 范围）。
3. **全量 Mini-batch epoch 验收耗时较长**（~30–40 min），已落盘 `phase7b2_acceptance.json` 供 CI 快速引用。
4. **构建期 RSS 峰值未精确计量**（子进程树监控待加强）；以 exit 0 + 无 OOM + 源码审计为验收依据。

---

## Final Verdict

### **PASS**

---

## 必答五问

| # | 问题 | 答复 |
|---|------|------|
| 1 | Canonical AISHELL-3 是否已经能够稳定生成 Feature Shard？ | **是。** 997,992 样本 · 21 shard · 构建成功 · Level 3 **PASS** |
| 2 | Feature Shard 是否已经成为唯一正式训练输入？ | **是（Canonical 路径）。** `train_tone_cnn --dataset aishell3` 训练经 Feature Shard → Shard Reader → Mini-batch Reader；**禁止**训练期直接读 wav。`data_mini` 回归路径保持内存矩阵（Regression Fixture） |
| 3 | 是否已经彻底消除 audio_cache 导致的 OOM 风险？ | **是（Shard 构建与训练路径）。** 无界 `audio_cache` 已消除；构建按 utterance 顺序读取。注：构建前全量样本列表加载仍为独立工程成本 |
| 4 | 是否已经可以开始 tone_cnn_p3 全量训练？ | **工程 IO 已就绪，可进入 Phase 7-C p3 训练阶段；本轮未执行 p3 训练** |
| 5 | 是否仍存在阻塞全量训练的工程问题？ | **无阻塞性 FAIL。** 剩余为性能/可观测性改进（构建前样本列表 RAM、accept 探针耗时），不阻止启动 p3 全量训练 |

---

## 回归命令

```bash
cd electron_node/services/faster_whisper_vad

# Level 3 验收（需已构建全量 shard）
python -m tone_module.training_io.probe_feature_shard accept \
  --cache-dir tone_module/_data_cache

# Level 1 单元测试
python -m unittest tone_module.test_phase7b2_canonical_feature_shard \
  tone_module.test_phase7b1_training_io tone_module.test_phase6d_dataset -q
```
