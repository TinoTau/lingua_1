# Tone Module — 架构（P0 冻结）

**版本**：ToneModule **P0**  
**代码**：`electron_node/services/faster_whisper_vad/tone_module/`  
**FW 集成**：`main/src/fw-detector/tone-time-align.ts`、`tone-match-score.ts`、`lexicon/tone-recall-sort.ts`

---

## 1. 目标

| 做 | 不做 |
|----|------|
| 从**音频**估计声调概率 | 从汉字反查拼音声调 |
| 为 Recall 提供 **Ranking Signal** | 直接替换 ASR 文本 |
| 与 FW Word Timestamp 对齐 | 修改 IME / HintGate / KenLM pick 逻辑 |

**设计原则**：Tone 来自音频；独立模块；仅排序加权；默认 **非 Hard Filter**（V4 Tone Score Restoration 后）。

---

## 2. 组件

| 组件 | 路径 | 职责 |
|------|------|------|
| 推理 | `tone_module/inference.py` | Mel + CNN → 每音节 tone 分布 |
| 分类器 | `tone_module/classifier.py` | 模型加载与前向 |
| 训练 | `tone_module/train_tone_cnn.py` | 离线训练 |
| ASR 挂载 | `faster_whisper_vad/api_routes.py` | `run_tone_inference`，写入 response extra |
| 时间对齐 | `fw-detector/tone-time-align.ts` | timestamp-only 切片对齐 |
| 打分 SSOT | `fw-detector/tone-match-score.ts` | `computeToneScoreResult` |
| Recall 排序 | `lexicon/tone-recall-sort.ts` | penalty × candidateScore |

模型权重：部署于 `tone_module/models/`（具体文件名以仓库为准）。

---

## 3. 数据流

```text
POST /asr (faster_whisper_vad)
  → VAD + Whisper decode
  → run_tone_inference(audio, word_times)
  → extra.toneModule / utteranceAcousticTone

Job pipeline (fw-detector-step)
  → ctx 携带 tone payload
  → runFwDetectorV4Path
      → recallTopKForWindows
          → resolveTimestampToneState (shared/tone-recall)
          → computeToneScoreResult per hit
          → candidateScore *= tonePenalty
```

---

## 4. ToneScoreResult 契约

```typescript
interface ToneScoreResult {
  toneCompatible: boolean;
  tonePenalty: number;       // 1.0 | 0.8 等 SSOT 常量
  toneReason: 'match' | 'mismatch' | 'no_pattern';
}
```

| toneReason | 含义 |
|------------|------|
| `match` | 声学 pattern 与候选 tone key 一致 |
| `mismatch` | 不一致，施加 penalty |
| `no_pattern` | 无声调 pattern，penalty=1.0，不计入 fallback |

---

## 5. Timestamp-Only 对齐

默认 `toneTimestampOnlyEnabled: true`：

- 使用 ASR **词级时间戳** 与 alignment 文本切片
- **禁止**依赖逐字 char-scan 作为主路径（遗留仅单测）
- 诊断：`windowTimeHitCount`、`toneOverlapMissCount` 等（`CoarseAssemblyToneDiagnostics`）

---

## 6. Diagnostics 字段

| 字段 | 含义 |
|------|------|
| `recallToneCompatibleCount` | `toneReason === 'match'` |
| `recallToneFallbackCount` | `tonePenalty < 1.0`（penalized，非删除） |
| `recallToneIncompatibleCount` | **deprecated alias** of fallback |

---

## 7. 与 Lexicon 字段

词库命中携带 `tonePinyinKey` / `acousticTonePattern`（window 级）。  
Parent fragment 层同样走 penalty 排序，**不** filter 掉 incompatible。

---

## 8. 冻结约束

| 允许 | 禁止 |
|------|------|
| 模型重训、阈值标定（独立流程） | Tone Hard Gate 恢复（filter 掉候选） |
| 诊断字段扩展（deprecated 标注） | IME 内嵌声调推断 |
| Bug fix、单测更新 | 修改 Recall SQL 语义 |

---

## 9. 验收与单测

| 范围 | 测试 |
|------|------|
| 打分 SSOT | `tone-match-score.test.ts` |
| 时间对齐 | `tone-time-align.test.ts` |
| V4 Recall 集成 | `span-assembly-v4-tone-score.test.ts` |
| 实验脚本 | `tests/experiments/tone-module-*.mjs`（非 CI 门禁） |

---

## 10. 相关文档

| 文档 | 路径 |
|------|------|
| FW 主链 | [../fw-detector/ARCHITECTURE.md](../fw-detector/ARCHITECTURE.md) §6 |
| ASR 服务 | `electron_node/services/faster_whisper_vad/README.md`（需补 tone 字段时以 `api_routes.py` 为准） |
