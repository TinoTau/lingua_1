# FW Repair V4 — Configuration SSOT

**状态：** Framework Frozen · 2026-06-19  
**SSOT 源：** `node-config-defaults.ts` · `tests/freeze-config-ssot.json` · `fw-config.ts`  
**Parity 测试：** `freeze-config-ssot.test.ts`

---

## 1. Framework Config（禁止未经新合约修改）

以下键定义 **FW Repair V4 框架行为**。变更须 bump Framework 合约版本并通过 `freeze-contract.test.ts`。

| 键 | 默认 | 语义 | 修改规则 |
|----|------|------|----------|
| `features.fwDetector.enableKenLMGate` | `true` | 关闭则永不 pick | ❌ 冻结 |
| `features.fwDetector.kenlmGateMode` | `weak_veto` | span 级 KenLM 模式 | ❌ 冻结 |
| `features.fwDetector.minDeltaToReplace` | **`3.0`** | Raw Log Delta pick 阈值 | ❌ 冻结 |
| `scoreMode`（代码常量） | **`raw_log_delta`** | pick 单位；写入 configSnapshot | ❌ 冻结 |
| `features.fwDetector.toneTimestampOnlyEnabled` | `true` | Tone-First Recall 开关（无独立 enableToneRecall） | ❌ 冻结 |
| `features.fwDetector.candidateRequireRepairTarget` | `true` | span apply 需 repairTarget | ❌ 冻结 |
| `features.fwDetector.spanAssemblyV4Enabled` | `true` | 恒 V4；`false` 仅 warn | ❌ 冻结 |
| `features.fwDetector.maxSentenceCandidates` | `16` | 句组合上限 | ❌ 冻结 |
| `features.fwDetector.kenlmSubprocessTimeoutMs` | `5000` | batch spawn 超时 | ❌ 冻结 |
| `features.fwDetector.kenlmSubprocessMaxLines` | `17` | 单次 batch 最大非空句数 | ❌ 冻结 |
| `features.pinyinImeV2.directRepair` | `false` | IME 不得 bypass FW | ❌ 冻结 |
| `features.lexiconRecall.enabled` | `false` | Legacy recall 路径断开 | ❌ 冻结 |
| `asr.engine` | `fw_detector_v1` | FW 主链 ASR 路由 | ❌ 冻结 |

**已废止（不得在新配置中使用）：**

- `minDeltaToReplace = 0.03`（normalized 域，已移除）
- `kenlmBatchSubprocessEnabled` · `kenlmBatchSubprocessFallbackToSerial` · `kenlmRuntimeMode`
- `spanAssemblyV3Enabled` · `useSentenceLevelRerank`

**兼容只读（旧键映射，不参与 V4 pick）：**

- `kenlmDeltaThreshold` → `@deprecated`
- `kenlmBatchSubprocessTimeoutMs` → `kenlmSubprocessTimeoutMs`
- `kenlmBatchSubprocessMaxSentences` → `kenlmSubprocessMaxLines`

---

## 2. Lexicon Operations Config（允许运营调整）

以下键/数据 **不改变框架算法**，仅影响词库覆盖与候选池内容。

| 键 / 数据 | 默认 | 用途 | 修改规则 |
|-----------|------|------|----------|
| `features.fwDetector.minPrior` | `0.5` | 候选 prior 下限 | ✅ 运营 |
| `features.fwDetector.enabledDomains` | profile 驱动 | domain recall 范围 | ✅ 运营 |
| `features.lexiconRuntimeV2.bundlePath` | `node_runtime/lexicon/v3` | runtime bundle | ✅ deploy |
| `features.lexiconRuntimeV2.maxBaseCandidates` | `2` | base TopK 上限 | ✅ 运营 |
| `features.lexiconRuntimeV2.maxDomainCandidates` | `3` | domain TopK 上限 | ✅ 运营 |
| sqlite `repair_target` |  per row | span apply 资格 | ✅ Patch |
| sqlite `domain_id` / word rows | per row | domain recall | ✅ Patch |
| confusion seed jsonl | 资产 | ASR 混淆簇 | ✅ import |
| Patch Service | HTTP/CLI | 在线增词 + reload | ✅ 运营 |

**扩词不需要新增 Framework 配置键。**

---

## 3. Diagnostics Config（观测，不改 pick 逻辑）

| 键 | 生产默认 | 说明 |
|----|----------|------|
| `spanAssemblyV4DiagnosticsEnabled` | `false` | 开 summary/trace |
| `spanAssemblyV4DiagnosticsLevel` | `summary` | `summary` \| `trace` |
| `spanAssemblyV4DiagnosticsTargetIds` | `[]` | trace case 过滤 |
| `lexiconRuntimeV2.recallDiagnosticsEnabled` | `true` | V2 recall job diagnostics |

---

## 4. Pinyin IME V2（Framework 边界内）

| 键 | 默认 |
|----|------|
| `features.pinyinImeV2.enabled` | `true` |
| `features.pinyinImeV2.topK` | `5` |
| `features.pinyinImeV2.maxApprovedSpans` | `4` |

---

## 5. configSnapshot（运行时观测）

`runFwDetectorOrchestrator` 写入 Job diagnostics，须包含：

`pipelinePath: 'v4'` · `minDeltaToReplace` · `scoreMode: 'raw_log_delta'` · `toneTimestampOnlyEnabled` · `enableKenLMGate`

**不得再写入：** `spanAssemblyV3Enabled` · `useSentenceLevelRerank`

---

## 6. 配置修改决策树

```text
是否改变 pick / recall / assembly / KenLM / apply 算法？
  ├─ 是 → 禁止（需新 Framework 合约）
  └─ 否 → 是否仅改变词库内容或 prior/domain 阈值？
           ├─ 是 → Lexicon Operations（Patch / import / reload）
           └─ 否 → 是否仅改变 diagnostics 粒度？
                    └─ 是 → 允许（不改 SSOT 默认亦可 patch 批测脚本）
```

---

## 7. 相关文档

- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [LEXICON_OPERATIONS.md](./LEXICON_OPERATIONS.md)
- [kenlm/KENLM_RUNTIME.md](./kenlm/KENLM_RUNTIME.md)
