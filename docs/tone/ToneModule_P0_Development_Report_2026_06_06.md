# ToneModule P0 — 开发报告

**日期**：2026-06-06  
**依据文档**（优先级从高到低）：

1. [ToneModule P0 补充冻结方案（Mandatory Addendum）](./ToneModule%20P0%20%20补充冻结方案（Mandatory%20Addendum）.md)
2. [ToneModule P0 冻结开发方案](./ToneModule%20P0%20冻结开发方案.md)
3. [ToneModule P0 补充清单](./ToneModule_P0_Supplement_Checklist_2026_06_03.md)
4. [vibe coding 代码规范](../CODING/vibe%20coding代码规范)

**关联报告**：[ToneModule P0 CNN 训练报告](./ToneModule_P0_CNN_Training_Report_2026_06_06.md)

---

## 1. 目标与范围

本轮实现 **ToneModule P0** 两阶段架构：

| 阶段 | 位置 | 职责 |
|------|------|------|
| Phase A | FW Worker（Python） | `processed_audio` + word timestamps → `toneTokens` |
| Phase B | Node Pipeline（TypeScript） | `toneTokens` → `toneMatchScore` → 写入 `candidateScore` |

**P0 范围内**：仅 `zh`；整句 batch 推理；fail-open；不修改 IME / Recall SQL / Builder 笛卡尔积。

**P0 范围外**（未在本轮验收）：端到端 Apply 效果、Domain P2 句级 domain 分、FW 服务 README 更新。

---

## 2. 架构

```text
FW Worker (Phase A)
  processed_audio
    ↓ word timestamp 切片
  80-dim Mel（mean pool）
    ↓ Tone CNN (80→32→5)
  toneTokens[] + UtteranceTonePayload
    ↓ HTTP UtteranceResponse.tone（dedup 之前生成）
Node ASRResult.tone
    ↓ fw-detector-orchestrator
  span 字符索引 → queryToneTokens
    ↓ toneMatchScore vs candidate tone_pinyin_key
  finalCandidateScore = baseCandidateScore + wTone * toneMatchScore
    ↓ KenLM sentence rerank（不变）
  approved replacements
```

### 2.1 冻结约束遵守情况

| 约束 | 实现 |
|------|------|
| Tone 推理仅在 FW Worker | ✅ `tone_module/inference.py` |
| Node 不切 `ctx.audio` | ✅ 仅消费 HTTP `tone` |
| dedup 前生成 toneTokens | ✅ `api_routes.py` 在 Step 9.2 之前调用 |
| 顶层 `UtteranceResponse.tone` | ✅ 非 Segment.words 依赖 |
| 禁止 `textToToneSyllables(span.text)` 作 ASR query | ✅ 已从 rerank pipeline 删除 |
| 禁止 `toneDistance` 独立排序键 | ✅ 已删除；并入 candidateScore |
| ASR tone 仅来自 toneTokens | ✅ |
| 候选 tone：`tone_pinyin_key` → pinyin-pro fallback | ✅ `resolveTonePinyinKey` |
| 不新增未文档化 pipeline step / ctx 字段 | ✅ tone 挂 `ASRResult.tone` |
| batch 推理 | ✅ `classifier.predict_batch` |

---

## 3. 修改文件清单

### 3.1 FW Worker（Python）

| 文件 | 说明 |
|------|------|
| `tone_module/tone_types.py` | `TonePosterior`、`ToneToken`、`UtteranceTonePayload` |
| `tone_module/mel.py` | 80 维 log-Mel 特征（16 kHz） |
| `tone_module/classifier.py` | CPU MLP/CNN 推理；加载 `models/tone_cnn_p0.npz` |
| `tone_module/inference.py` | dedup 前 batch 推理入口 |
| `tone_module/train_tone_cnn.py` | 训练脚本（见训练报告） |
| `tone_module/models/tone_cnn_p0.npz` | 训练权重（~13 KB） |
| `tone_module/models/README.md` | 模型说明 |
| `tone_module/__init__.py` | 懒加载 `run_tone_inference` |
| `config.py` | 默认 `TONE_MODEL_PATH` → `tone_module/models/tone_cnn_p0.npz` |
| `api_models.py` | `UtteranceTonePayloadModel`、`UtteranceResponse.tone` |
| `api_routes.py` | ASR 后、dedup 前调用 Tone；diagnostics `toneModule` |
| `.gitignore` | 忽略 `tone_module/_data_cache/` |

**附带修复**：原 `tone_module/types.py` 与 Python 标准库 `types` 模块命名冲突，已重命名为 `tone_types.py`。

### 3.2 Node Pipeline（TypeScript）

| 文件 | 说明 |
|------|------|
| `task-router/types.ts` | `ToneToken`、`UtteranceTonePayload`；`ASRResult.tone` |
| `task-router/faster-whisper-asr-strategy.ts` | 解析 HTTP `response.data.tone` |
| `fw-detector/tone-match-score.ts` | span 映射 + `computeToneMatchScore` |
| `fw-detector/fw-tone-config.ts` | `wTone`（默认 1.0，`features.fwTone.wTone`） |
| `fw-detector/fw-sentence-rerank-pipeline.ts` | 移除 legacy tone 排序；加权 candidateScore |
| `fw-detector/fw-detector-orchestrator.ts` | 传入 `ctx.asrResult?.tone`；输出 `toneModule` diagnostics |
| `fw-detector/build-sentence-candidates.ts` | 可选 `toneMatchScore` / `baseCandidateScore` |
| `fw-detector/types.ts` | `FwToneModuleDiagnostics` |
| `node-config-types.ts` | `features.fwTone` 类型 |

### 3.3 测试

| 文件 | 说明 |
|------|------|
| `fw-detector/tone-match-score.test.ts` | toneMatchScore 单元测试（含 少冰/烧饼/哨兵 区分） |
| `fw-detector/fw-sentence-rerank-p4.test.ts` | 删除 legacy `toneDistance` 测试 |

---

## 4. 接口契约

### 4.1 HTTP — `UtteranceResponse.tone`

```ts
interface UtteranceTonePayload {
  toneEnabled: boolean;
  toneTokens: ToneToken[];
  toneTokenCount: number;
  toneConfidenceAvg?: number;
  skippedReason?: "no_audio" | "no_timestamps" | "non_zh" | "model_error";
}

interface ToneToken {
  token: string;
  start: number;
  end: number;
  tonePosterior: { t1; t2; t3; t4; t5: number };
  confidence: number;
}
```

挂接：`ASRResult.tone`（Node）；`UtteranceResponse.tone`（Python）。

### 4.2 Diagnostics

**FW `diagnostics.toneModule`**：

| 字段 | 含义 |
|------|------|
| `tone_inference_ms` | 整句 Tone 推理耗时 |
| `toneTokenCount` | token 数量 |
| `toneEnabled` | 是否成功启用 |
| `toneConfidenceAvg` | 平均 posterior 峰值 |
| `skippedReason` | 跳过原因 |

**Node `FwDetectorResult.toneModule`**：

| 字段 | 含义 |
|------|------|
| `toneEnabled` | ASR 侧是否启用 |
| `toneTokenCount` | 全句 token 数 |
| `wTone` | 配置权重 |
| `toneScoreAppliedCount` | 候选中 toneMatchScore > 0 的次数 |

### 4.3 打分公式

```text
toneMatchScore = mean( queryPosterior[syllable_i][candidateToneClass_i] )

finalCandidateScore = baseCandidateScore + wTone * toneMatchScore
```

- `queryPosterior`：span 字符范围对应的 `toneTokens`（声学）
- `candidateToneClass`：来自 `tone_pinyin_key`（如 `shao3|bing1`）或候选词 pinyin-pro
- `wTone` 默认 `1.0`，配置项 `features.fwTone.wTone`

排序：按 `candidateScore` 降序，再 `priorScore` 降序（**无**独立 tone sort key）。

---

## 5. 降级策略（fail-open）

| 条件 | 行为 |
|------|------|
| 非 `zh` | `toneEnabled=false`，`skippedReason=non_zh` |
| 无 audio | `skippedReason=no_audio` |
| 无 word timestamps | `skippedReason=no_timestamps` |
| 模型加载失败 | `skippedReason=model_error` |
| 上述任一 | ASR text 正常返回；Node `toneMatchScore=0` |

---

## 6. 单元测试

```text
npm test -- --testPathPattern="tone-match-score|fw-sentence-rerank-p4"

Test Suites: 2 passed
Tests:       10 passed
Time:        ~1.8s
```

**tone-match-score 关键用例**：

- `shao3|bing1` vs 声学 query `[t3, t4]`：少冰（bing4）得分高于烧饼（bing3）、哨兵（shao4|bing1 首音节不匹配）

---

## 7. Target List 完成情况

### FW

- [x] Tone CNN（80 Mel，5-class，CPU，batch）
- [x] toneTokens
- [x] UtteranceTonePayload
- [x] tone_inference_ms / toneTokenCount / toneConfidenceAvg diagnostics

### Pipeline

- [x] toneMatchScore
- [x] candidateScore 集成（`wTone * toneMatchScore`）

### Cleanup

- [x] 删除 toneDistance 排序
- [x] 删除 textToToneSyllables(span.text) Query 路径

### Check List（Mandatory Addendum §十七）

- [x] Tone 推理仅在 FW Worker
- [x] Node 不切音频
- [x] Dedup 不影响 toneTokens
- [x] Tone 不修改 Span / IME / Recall SQL
- [ ] 端到端 dialog_200 实测 — **未在本轮执行**（见 §8）

---

## 8. 未实现 / 待办

| 项 | 说明 |
|----|------|
| 端到端 dialog_200 联调 | 需启动节点 + FW 服务，用 `test wav/dialog_200` 抽样验证 toneTokens 回传与排序 |
| Domain P2 共存 | `+ wDomain * sentenceDomainMatchScore` 待 Domain P2 合入 |
| FW README | `UtteranceResponse.tone` 字段文档 |
| 生产级声学准确率 | 当前 CNN val_acc ≈ 73%（见训练报告）；可换更大数据集重训 |
| 整句 ≤20ms CPU 压测 | 需在 FW 服务运行时对 diagnostics `tone_inference_ms` 批量统计 |

---

## 9. 配置说明

```json
// node-config features（可选）
{
  "fwTone": {
    "wTone": 1.0
  }
}
```

```bash
# FW 服务（可选覆盖默认模型路径）
TONE_MODEL_PATH=/path/to/custom.npz
```

默认模型：`electron_node/services/faster_whisper_vad/tone_module/models/tone_cnn_p0.npz`

---

## 10. 结论

ToneModule P0 **代码与冻结契约对齐**：两阶段架构、dedup 解耦、legacy 文本 tone 排序已移除，声学 tone 已接入 FW rerank 的 `candidateScore` 路径。单元测试全部通过。声学模型已训练并落盘（见 [训练报告](./ToneModule_P0_CNN_Training_Report_2026_06_06.md)）。建议下一步进行 FW+Node 联调与 dialog_200 抽样验收。
