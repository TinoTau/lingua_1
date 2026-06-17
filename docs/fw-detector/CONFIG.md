# FW Detector — 配置 SSOT

来源：`node-config-defaults.ts` + `tests/freeze-config-ssot.json`（parity 测试）。

## 引擎与 Pipeline

| 键 | 默认 | 说明 |
|----|------|------|
| `asr.engine` | `fw_detector_v1` | 启用 FW 主链 |
| `features.fwDetector.enabled` | `true` | FW 步骤开关 |
| `features.fwDetector.spanAssemblyV4Enabled` | `true` | **恒 V4**；`false` 仅 warn |
| `features.fwDetector.toneTimestampOnlyEnabled` | `true` | 声学声调时间戳对齐；**无**独立 `toneFirstRecallEnabled` |

## Recall / 候选

| 键 | 默认 |
|----|------|
| `features.lexiconRuntimeV2.enabled` | `true` |
| `features.fwDetector.minPrior` | `0.5` |
| `features.fwDetector.candidateRequireRepairTarget` | `true` |
| `features.lexiconRecall.enabled` | `false` |
| `features.lexiconRuntimeV2.maxDomainCandidates` | `3` |
| `features.lexiconRuntimeV2.maxIdiomCandidates` | `0` |

## KenLM / Apply

| 键 | 默认 | 说明 |
|----|------|------|
| `features.fwDetector.enableKenLMGate` | `true` | **必需**，否则不 pick |
| `features.fwDetector.kenlmGateMode` | `weak_veto` | |
| `features.fwDetector.maxSentenceCandidates` | `16` | |
| `features.fwDetector.minDeltaToReplace` | `0.03` | **V4 Apply pick 阈值** |
| `features.fwDetector.kenlmDeltaThreshold` | `0.8` | **@deprecated**，仅兼容读取，不参与 V4 rerank |

## Pinyin IME V2

| 键 | 默认 |
|----|------|
| `features.pinyinImeV2.enabled` | `true` |
| `features.pinyinImeV2.topK` | `5` |
| `features.pinyinImeV2.maxApprovedSpans` | `4` |
| `features.pinyinImeV2.directRepair` | `false` |

## Diagnostics（V4）

| 键 | 生产默认 | 说明 |
|----|----------|------|
| `features.fwDetector.spanAssemblyV4DiagnosticsEnabled` | `false` | 开启 summary/trace |
| `features.fwDetector.spanAssemblyV4DiagnosticsLevel` | `summary` | `summary` \| `trace` |
| `features.fwDetector.spanAssemblyV4DiagnosticsTargetIds` | `[]` | trace 级 case 过滤；批测 patch 设为 `['d001','d048']` |

### V2 Recall Diagnostics（trace 批测）

Lexicon recall diagnostics 由 `recallDiagnosticsEnabled` 控制（非 fwDetector 键）。  
Trace 批测须 **同时** 开启 V2 recall diagnostics + V4 diagnostics trace，见 [diagnostics/TRACE_FROZEN_V1_0_2.md](./diagnostics/TRACE_FROZEN_V1_0_2.md)。

Patch 脚本（不改 SSOT 默认文件）：`tests/patch-span-assembly-v4-config.mjs`

## configSnapshot（运行时观测）

orchestrator 写入：`pipelinePath: 'v4'`、`minDeltaToReplace`、`toneTimestampOnlyEnabled` 等。  
**不再写入** `spanAssemblyV3Enabled`、`useSentenceLevelRerank`。

## Historical / 无效开关

| 键 | 状态 |
|----|------|
| `useSentenceLevelRerank` | orchestrator **不读取** |
| `spanAssemblyV3Enabled` | **已删除** |
| `v3ToneTimestampOnlyEnabled` | 迁移至 `toneTimestampOnlyEnabled` |
| `toneFirstRecallEnabled` | **不存在**；Tone-First 随 `toneTimestampOnlyEnabled` 生效 |
