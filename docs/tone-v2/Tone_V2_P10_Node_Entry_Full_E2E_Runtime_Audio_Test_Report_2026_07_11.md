# Tone V2 P10 — Node Entry Full E2E Runtime Audio Test Report

**Date:** 2026-07-11  
**Test Type:** Live Runtime E2E（Node 接收入口 → 完整 Pipeline）  
**Artifact（正式 Runtime）:** `tone_cnn_p0.npz` + `numpy_p0` + `mel_mean_80_v1`  
**Artifact（离线对比）:** `tone_cnn_p1_v1_full.npz` + `numpy_p1` + `feature_v2`  
**采集输出:** `tmp/tone_p10_node_e2e/`（`e2e_report.json` + 22 fixture 子目录）  
**采集脚本:** `electron_node/services/faster_whisper_vad/scripts/tone_p10_node_e2e_validation.mjs`（v2，修复 `node_response` 写入）

---

## 1. Executive Summary

本轮在 **真实启动 Node test server（:5020）与 FW（:6008，节点托管）** 前提下，从 `POST /run-pipeline-with-audio` 跑通 **22 条真实中文 Piper TTS WAV**，采集 Node E2E、FW-direct 隔离对比与 P1 离线 posterior 对比。

| 维度 | 结论 |
|------|------|
| Node → FW 真链路 | **已跑通** — 22/22 HTTP 200，`asrServiceId=faster-whisper-vad` |
| 正式 Tone Runtime | **仍为 p0**（非 P1 full Node E2E 验收） |
| Silero VAD | **真实加载**（P10 测试模式：`TONE_P10_VAD_CPU=1`，CPU EP） |
| 多段 VAD 拼接样本 | **未触发** — 22/22 `vadSegmentCount=1`（TTS 连续语料） |
| P1 offline argmax 变化率 | **7.0%**（501 词级对比，raw vs processed 域） |
| Tone → Recall 排序影响 | **本轮未观测到 top-1 / final candidate 变化**（5 条 tone-sensitive mock 对比） |
| FW 端口 | **6008**（本机 6007 bind 被 Chrome 出站源端口占用，见 §2.3） |

### Final Verdict: **CONDITIONAL PASS**

| 分项 | 裁决 |
|------|------|
| Node → FW → Tone → Recall → Final Candidate 是否真实跑通？ | **是**（Gate A 满足） |
| P1 full artifact 是否已通过 Node E2E 结构验收？ | **否** — 正式链仍为 **p0** |
| P1 full artifact 是否已通过生产质量验收？ | **否** |
| 是否需要按 Runtime 音频域重训？ | **是（建议）** — 与 P10 离线审计一致 |
| P10 Direct Replacement 是否可以继续？ | **是（接线/结构）** — 完成 P1 切换与多段 VAD 补测前为条件性 |

---

## 2. 服务启动记录

### 2.1 环境

| 项目 | 值 |
|------|-----|
| Python | 3.10.11 |
| Node.js | v24.15.0 |
| FW venv | `electron_node/services/faster_whisper_vad/.venv` |
| ASR 模型 | `models/faster-whisper-medium`（CUDA, `int8_float16`） |
| Silero VAD | `models/vad/silero/silero_vad_official.onnx`（CPU EP，测试门控） |
| Tone artifact（正式） | `tone_module/models/tone_cnn_p0.npz` |
| `TONE_MODEL_PATH` | 未单独覆盖（走 classifier 默认 p0 路径） |

### 2.2 依赖服务矩阵

| 服务 | 端口 | 启动方式 | 必须 | 状态 | 日志 |
|------|-----:|----------|------|------|------|
| FW ASR | **6008** | Electron `ServiceProcessRunner` 自动启动 | 是 | ✅ running | `services/faster_whisper_vad/logs/faster-whisper-vad-service.log` |
| Node test server | 5020 | Electron `startTestServer` | 是 | ✅ listening | `electron-node/logs/electron-main.log` |
| Lexicon V3 bundle | — | Node 内嵌 SQLite | 是（Recall） | ✅ loaded | electron-main.log `[LEXICON_RUNTIME_V2]` |
| KenLM | — | Node 内嵌 `query.exe` | 视 gate | ✅ ready | electron-main.log `[KENLM]` |
| NMT m2m100 | 5008 | 偏好自动启动 | 否（本测未依赖翻译质量） | ✅ running | — |
| Scheduler | 5010 | — | 否 | ❌ ECONNREFUSED（不影响 :5020 批测） | — |

### 2.3 端口 6007 → 6008 说明（BLOCKER 级环境问题）

本机 `6007` **无法 bind**（`Errno 10048`）：Chrome（PID 11108）占用本机 `192.168.68.56:6007` 作为出站源端口。  
测试专用改法：

- `service.json` → `port: 6008`
- `service.json` env → `FASTER_WHISPER_VAD_PORT: "6008"`
- `ServiceProcessRunner.ts` → 启动 `faster-whisper-vad` 时同步 `FASTER_WHISPER_VAD_PORT`

**曾出现过的启动失败根因：** 仅改 `service.json.port` 而未同步 Python 环境变量 → Electron 健康检查 `:6008`、FW 绑定 `:6007` → Registry 永不 ready。

### 2.4 启动命令

```powershell
# 用户配置（测试前写入）
# %APPDATA%\lingua-electron-node\electron-node-config.json
#   servicePreferences.faster-whisper-vad = true

$env:PROJECT_ROOT = "D:\Programs\github\lingua_1"
$env:NODE_ENV = "production"
cd electron_node\electron-node
.\node_modules\electron\dist\electron.exe .
```

本轮 Electron PID：**29920**；FW 由 Registry 托管，health：`http://127.0.0.1:6008/health`。

### 2.5 Readiness 快照（采集开始时）

```json
{
  "nodePort": 5020,
  "fwPort": 6008,
  "utterance_ready": true,
  "asr_model_loaded": true,
  "vad_model_loaded": true,
  "device": "cuda"
}
```

---

## 3. Node 入口与 Payload

### 3.1 请求样例（d001）

```http
POST http://127.0.0.1:5020/run-pipeline-with-audio
Content-Type: application/json
```

```json
{
  "wavPath": "D:\\Programs\\github\\lingua_1\\test wav\\dialog_200\\dialog_d001.wav",
  "srcLang": "zh",
  "tgtLang": "en",
  "use_lexicon": true,
  "is_manual_cut": true,
  "enableKenLMGate": true,
  "session_id": "p10-e2e-d001-<ts>",
  "lexicon_v2_intent_enabled": false
}
```

### 3.2 实测链路（d001）

```text
dialog_d001.wav (16 kHz mono, 6.10 s)
  → convertWavToOpus (~21 KB Opus)
  → decodeOpusToPcm16 (~195 KB PCM16)
  → AudioAggregator（2 batch：约 3.3 s + 2.8 s）
  → POST http://127.0.0.1:6008/utterance（pcm16 × 2）
  → preprocess_pcm_f32 + Silero VAD（单段）→ processed_audio
  → Faster-Whisper → WordInfo
  → Tone Runtime（p0）→ AcousticToneSlice（12，已 offset）
  → FW Detector V4 → Recall → KenLM gate
  → Final ASR text（未应用 span 替换：appliedCount=0）
```

---

## 4. 测试样本

| 类别 | 数量 | Fixture ID 示例 |
|------|-----:|-----------------|
| 合计 | **22** | d001, d049–d055, d043–d045, d088–d090, d025–d032 |
| tone-sensitive / cafe | ≥5 | d001（cafe）, d043–d045, d088 |
| 含停顿（TTS 内标点） | 多条 | 语料有标点，但 VAD 未切多段 |
| 低音量/噪声 | 0 专选 | dialog_200 TTS 干净语料 |
| 历史失败/歧义 | 1+ | d001（杯/貝、少糖、马芬） |

> **不足：** 未达规格「≥3 低音量/噪声专选」；**多段 VAD（segment≥2）0 条**。

---

## 5. 聚合结果

| 指标 | 值 |
|------|-----|
| Node E2E 成功 | **22 / 22** |
| FW-direct 成功 | **22 / 22** |
| 总 WordInfo（FW-direct 侧） | **501** |
| Runtime Tone slice 合计 | **351** |
| posterior finite 比例 | **100%**（351/351） |
| low-margin slice 比例（top1−top2 < 0.15） | **18.8%**（66/351） |
| P1 offline argmax 变化率 | **7.0%** |
| 平均 Node 请求延迟 | **~6.2 s** |
| 平均 FW `/utterance` 延迟 | **~2.5 s** |
| 平均 pipeline_ms | **~6.2 s** |
| 平均 Tone inference（FW diag） | **~9.9 ms** |
| VAD 多段 fixture | **0** |

---

## 6. d001 详细 Trace（代表样本）

### 6.1 Ground Truth（最小人工标注）

```yaml
fixture_id: d001
text: "你好，我想点一杯热拿铁，中杯，少糖。顺便问一下今天有蓝莓马芬吗？"
tokens:
  - word: 杯
    pinyin: bei
    tone: 1          # 目标正确词
    note: ASR 输出「貝/贝」，非发音标签
  - word: 少
    pinyin: shao
    tone: 3          # 目标正确发音
    note: P1 offline raw→runtime argmax 3→4（低 margin）
  - word: 蓝莓马芬
    pinyin: lan mei ma fen
    note: ASR「蓝没马分」— 识别错误，非 Tone 标签
```

### 6.2 ASR / WordInfo

| 字段 | Node E2E | FW-direct（整段 raw PCM） |
|------|----------|---------------------------|
| text | `你好,我想點一杯熱拿鐵中貝少糖 今天有蓝没马分吗?` | `你好,我想点一杯热拿铁钟贝少糖 身边问以下今天有蓝莓马芬吗?` |
| batch 数 | **2** | 1 |
| WordInfo 数（FW-direct） | — | 24 |
| Runtime Tone slices | **12** | 24（未做 Node offset） |

> **Group A vs B 差异显著：** 同一 WAV 的 PCM，经 **Node Opus 往返 + Aggregator 切分** 与 **整段 FW-direct** 的 ASR 文本不同；马芬句在 FW-direct 中识别更接近「蓝莓马芬」。

### 6.3 Tone（正式 p0 vs P1 离线）

| 项目 | 正式 Runtime（Node E2E） | P1 offline 对比 |
|------|--------------------------|-----------------|
| backend | `numpy_p0` | `numpy_p1` |
| featureVersion | `mel_mean_80_v1` | `feature_v2` |
| artifact | `tone_cnn_p0.npz` | `tone_cnn_p1_v1_full.npz` |
| d001 slice 数 | 12 | 24 词级 |
| skippedReason | null | — |
| argmax 变化词 | — | **贝**（t3→t4）、**糖** 相关词（见 `p1_offline_compare.json`） |

### 6.4 Silero VAD（d001）

| 字段 | 值 |
|------|-----|
| vad_model_loaded | true |
| fw_vad_segment_count | **1** |
| 模式 | 段直接拼接（生产模式 B） |
| ASR/Tone 同 buffer | 是（同一 `processed_audio`） |

---

## 7. Recall 四变体（5 条 tone-sensitive）

| Fixture | Variant | appliedCount | 备注 |
|---------|---------|-------------:|------|
| d001 | Runtime（Node E2E） | 0 | FW triggered |
| d001 | Mock v3（disableTone 请求） | 0 | mock 未注入 tone slice，但 **未验证** 真正关闭声学 Tone |
| d001 | Mock v4（uniform） | 0 | 同上 |
| d045 | Runtime / v3 / v4 | **1** | 三变体 **相同**，Tone 未改变排序 |
| d043, d044, d088 | 各变体 | 0 | 无差异 |

**结论：** 本轮 **未观测到** Runtime posterior 差异传播到 Recall top-1 或 Final Candidate 变化；`run-lexicon-mock` **不支持** `disableTone` / `uniformTonePosterior` 参数（请求被忽略），v3/v4 仅为「无声学 slice 的 mock 重跑」，**不能**作为严格四变体验收。

---

## 8. Node E2E vs FW-direct 隔离

| 组 | 路径 | d001 ASR 摘要 |
|----|------|---------------|
| **A** | raw WAV → Node → FW | `…中貝少糖 今天有蓝没马分吗?`（2 batch） |
| **B** | Node 解码 PCM16 → FW direct | 与 A 的 Node 路径等价（脚本用整段 WAV PCM 作 B/C 探针） |
| **C** | raw WAV PCM → FW direct | `…钟贝少糖 身边问以下今天有蓝莓马芬吗?` |

**Opus / Aggregator 影响：** A 与 C 文本不一致 → **显著**。  
**VAD 影响：** 本轮所有样本 `vadSegmentCount=1` → **无法量化多段拼接影响**。

---

## 9. 验收 Gate

### Gate A — Node / FW 真链路 ✅

- [x] Node `:5020` 启动
- [x] FW 启动（`:6008`，节点托管）
- [x] 22 条真实 WAV 从 Node 入口成功
- [x] Node → FW 可观测（electron-main.log `6008/utterance`）
- [x] ASR WordInfo 返回
- [x] AcousticToneSlice 返回（Node extra.`utterance_tone`）
- [x] Recall / FW Detector 执行
- [x] Final candidate 可观测（本批 appliedCount 多为 0）

### Gate B — Audio contract ⚠️ PARTIAL

- [x] ASR 与 Tone 同 `processed_audio`（FW 设计 + diag）
- [x] WordInfo 相对 processed_audio 时间轴
- [ ] **至少 1 条多段 VAD（segment≥2）** — **未满足**
- [x] Node batch offset（d001：12 slices = 2×batch 词级合并）

### Gate C — Tone impact ⚠️ PARTIAL

- [x] 5 条 tone-sensitive fixture 尝试四变体
- [ ] 严格四变体（Runtime / raw P1 / disabled / uniform）— **mock 层未实现注入**
- [ ] 证明 Tone 改变候选排序 — **本轮未发生**

---

## 10. 必须直接回答的 27 问（摘要）

| # | 问题 | 答案 |
|---|------|------|
| 1 | FW 是否真实启动？ | **是**（:6008，节点托管） |
| 2 | Node test server 是否真实启动？ | **是**（:5020） |
| 3 | Node 是否接收到 WAV 路径？ | **是** |
| 4 | WAV 是否经 Opus 编码？ | **是**（`runPipelineWithAudio`） |
| 5 | Opus 是否解码为 PCM16？ | **是** |
| 6 | AudioAggregator 是否切分？ | **是**（d001：2 batch） |
| 7 | Node 发给 FW 的音频？ | Opus 解码后 PCM16，按 batch POST |
| 8 | Silero VAD 是否真实运行？ | **是**（CPU EP 测试模式） |
| 9 | 是否出现多段 VAD？ | **否**（0/22） |
| 10 | ASR 与 Tone 同 audio hash？ | **是**（FW 内同一 processed_audio） |
| 11 | WordInfo 相对 processed_audio？ | **是** |
| 12 | Node 是否正确 offset AcousticToneSlice？ | **是**（d001：12 slices） |
| 13 | 正式 Tone Runtime？ | **p0** |
| 14 | P1 full Node E2E？ | **否** |
| 15 | 每条样本 Tone slice 数？ | 6–29（见 `e2e_report.json`） |
| 16 | posterior 全 finite？ | **是**（100%） |
| 17 | low-margin 比例？ | **18.8%** |
| 18 | Runtime vs raw argmax 变化率？ | **7.0%**（P1 offline） |
| 19 | 变化中改善/退化？ | **未做 GT 发音级标注批测** |
| 20 | Tone 改变 Recall top-1？ | **本轮未观测到** |
| 21 | Tone 改变 Final Candidate？ | **本轮未观测到** |
| 22 | Opus 显著影响 posterior？ | **间接是**（改变 ASR 词界与文本） |
| 23 | VAD 拼接显著影响？ | **本轮无法评估**（无多段） |
| 24 | WordInfo 边界 vs 预处理？ | **Opus/切分对 ASR 文本影响大于单段 VAD** |
| 25 | full artifact 需重训？ | **建议按 Runtime 域重训 P1** |
| 26 | P10 Direct Replacement 可继续？ | **是（条件性）** |
| 27 | 生产质量验收条件？ | **未具备**（p0 正式链 + 无 P1 在线 + 无多段 VAD 证明） |

---

## 11. Temporary / Test-only Changes

| 文件 | 改动 | 范围 |
|------|------|------|
| `services/faster_whisper_vad/service.json` | `port: 6008`，`FASTER_WHISPER_VAD_PORT`，`TONE_P10_VAD_CPU=1` | 测试环境 |
| `ServiceProcessRunner.ts` | 同步 `FASTER_WHISPER_VAD_PORT` ← `entry.def.port` | 防端口错位 |
| `models.py` | `TONE_P10_VAD_CPU` / `TONE_P10_PREFER_CUDA_BIN_CUDNN` 门控 | 默认关闭 |
| `electron-node-config.json`（用户目录） | `faster-whisper-vad: true` | 测试自动启动 |
| `tone_p10_node_e2e_validation.mjs` | 修复 `body: data`；创建 `fw/` 目录 | 采集脚本 |
| `tone_p10_start_fw.ps1` 等 | P10 一次性启动/审计脚本 | 非生产 |

**禁止改动遵守：** 未修改 Tone 决策规则、Recall 排序、p0→P1 正式切换、模型权重。

---

## 12. BLOCKER / HIGH / MEDIUM / LOW

| 级别 | 项 |
|------|-----|
| **BLOCKER** | 本机 `6007` bind 失败 — 已用 **6008** 规避；生产部署需端口策略 |
| **HIGH** | 正式 Runtime 仍为 **p0**，非 P1 full — **不可声称 P1 E2E 完成** |
| **HIGH** | **0 条多段 VAD** — Gate B 未完整 |
| **HIGH** | `run-lexicon-mock` **不支持** Tone 四变体注入 |
| **MEDIUM** | Opus + Aggregator 使 ASR 与 FW-direct 差异显著 |
| **MEDIUM** | 22 条无专选低音量/噪声样本 |
| **LOW** | `opusRoundtrip` 探针 `parse_failed`（logger 前缀污染 JSON） |
| **LOW** | Scheduler :5010 未启动（批测无影响） |

---

## 13. Required Before P10 Acceptance

1. 正式将 Tone Runtime 切换为 **P1 full**（`numpy_p1` + `tone_cnn_p1_v1_full.npz`）并完成 Node E2E 回归。  
2. 补 **≥1 条多段 Silero VAD** 真实语音（非 TTS 连续句）全链路 trace。  
3. 实现 **测试层** Recall 四变体注入（或专用 harness），禁止改生产排序逻辑。  
4. 按 Runtime 预处理域 **重建 Feature Cache 并重训** 后做生产质量验收。  
5. 生产环境解决 **6007 端口冲突** 或统一配置为可用端口并同步 env。

---

## 14. Final Verdict

| 裁决 | 结果 |
|------|------|
| **总裁决** | **CONDITIONAL PASS** |
| Node → FW → Tone → Recall → Final Candidate | **已真实跑通** |
| P1 full Node E2E 结构验收 | **未通过**（正式链为 p0） |
| P1 full 生产质量验收 | **未通过** |
| Runtime 音频域重训 | **建议执行** |
| P10 Direct Replacement | **可继续开发/接线** |

---

## 15. 附录：Fixture 一览

| ID | Scenario | Node ms | Tone slices | VAD segs | P1 argmax Δ |
|----|----------|--------:|------------:|---------:|------------:|
| d001 | cafe | 12036 | 12 | 1 | 2 |
| d049 | meeting | — | 16 | 1 | 4 |
| d050 | tech_ai | — | — | 1 | 1 |
| d051 | meeting | — | 9 | 1 | 1 |
| d052 | tourism_route | — | 15 | 1 | 3 |
| d053 | tourism_pickup | — | 29 | 1 | 1 |
| d054 | tourism_transport | — | 17 | 1 | 1 |
| d055 | medical | — | 21 | 1 | 3 |
| d043–d045 | meeting/tech | — | — | 1 | 0–2 |
| d088–d090 | meeting/tech | — | — | 1 | 1–3 |
| d025–d032 | hr/edu/hotel | — | — | 1 | 0–2 |

完整数字见 `tmp/tone_p10_node_e2e/e2e_report.json` 与各 `summary.json`。

---

*Report generated from live run `2026-07-11T09:09:46Z`, collection v2 with fixed Node response capture.*
