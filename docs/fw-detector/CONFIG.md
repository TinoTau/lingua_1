# FW Detector — 配置 SSOT

来源：`node-config-defaults.ts` + `tests/freeze-config-ssot.json`（parity 测试）。

## 引擎与 Pipeline

| 键 | 默认 | 说明 |
|----|------|------|
| `asr.engine` | `fw_detector_v1` | 启用 FW 主链 |
| `features.fwDetector.enabled` | `true` | FW 步骤开关 |
| `features.fwDetector.spanAssemblyV4Enabled` | `true` | **恒 V4**；`false` 仅 warn |
| `features.fwDetector.toneTimestampOnlyEnabled` | `true` | 声学声调时间戳对齐 |

## Recall / 候选

| 键 | 默认 |
|----|------|
| `features.lexiconRuntimeV2.enabled` | `true` |
| `features.fwDetector.minPrior` | `0.5` |
| `features.fwDetector.candidateRequireRepairTarget` | `true` |
| `features.lexiconRecall.enabled` | `false` |

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

## Diagnostics

| 键 | 默认 |
|----|------|
| `features.fwDetector.spanAssemblyV4DiagnosticsEnabled` | `false` |
| `features.fwDetector.spanAssemblyV4DiagnosticsLevel` | `summary` |

## configSnapshot（运行时观测）

orchestrator 写入：`pipelinePath: 'v4'`、`minDeltaToReplace`、`toneTimestampOnlyEnabled` 等。  
**不再写入** `spanAssemblyV3Enabled`、`useSentenceLevelRerank`。

## Historical / 无效开关

| 键 | 状态 |
|----|------|
| `useSentenceLevelRerank` | orchestrator **不读取** |
| `spanAssemblyV3Enabled` | **已删除** |
| `v3ToneTimestampOnlyEnabled` | 迁移至 `toneTimestampOnlyEnabled` |
