# FW Word Timestamps / Word 边界只读审计

> **日期：** 2026-06-02  
> **性质：** 只读事实分析；未改代码、配置、FW 服务；未提交 Patch  
> **代码依据：** `faster_whisper_vad/asr_worker_process.py`、`faster-whisper-asr-strategy.ts`、`fw-metadata-span-gate.ts`  
> **实证数据：** `electron_node/electron-node/tests/audit-fw-word-boundary-data.json`（dialog_200 **d001–d100**，100 条，与生产同 transcribe 参数）  
> **复现：** `D:\Python\Python310\python.exe tests/audit-fw-word-boundary.py`（只读审计脚本，非生产代码）

---

## 执行摘要

| 问题 | 结论 |
|------|------|
| 是否启用 `word_timestamps` | **是**（Python worker 硬编码 `True`） |
| 是否返回 `segments[].words[]` | **是**（含 `word/start/end/probability`） |
| 中文 word 平均长度 | **1.09 字**（中位 **1**，P95 **2**） |
| FW word 更接近 | **A 单字为主（91%）**，少量双字/三字 |
| 是否天然具备「词/短语级 Span 边界」 | **否** — 需 **2–4 字滑窗合并** 或 **Lexicon 文本扫描** |
| Detector Miss 主因（相对 word 边界） | **probability gate + 2–4 字窗约束**，非「没有 words[]」 |
| 是否需要 Jieba/HanLP 级外部分词 | **非必须**；FW 已给 **字级时间戳** |
| 是否仍需 Lexicon-aware / Span Generator | **是** — 把字级 token 提升为 **repair 窗** |

**一句话：** FW 已做 **Whisper 字级/近字级切分 + 时间戳 + probability**，**没有**做「候選生成 / 上线计划 / 内科」级语义词边界；当前 Detector 的 2–4 字 CJK 窗是在 **字流上二次切窗**，不是直接使用 FW 短语。

---

## 第一部分 — FW Word Configuration Report

### 1.1 Python Worker（`asr_worker_process.py`）

| 参数 | 生产值 | 说明 |
|------|--------|------|
| **`word_timestamps`** | **`True`** | 硬编码，不可通过 HTTP 关闭 |
| **`vad_filter`** | **`False`** | Whisper 内置 VAD 关闭；前置 **Silero VAD** 已在 `api_routes` 裁切 |
| **`beam_size`** | 请求传入，默认 **`config.BEAM_SIZE=1`** | |
| **`best_of`** | 可选；**FW P0 路径 Node 不传** | `faster-whisper-asr-strategy.ts` 在 `isFwDetectorEngineEnabled()` 时不传 `best_of` |
| **`temperature`** | 请求传入；FW P0 **固定 0** | |
| **`condition_on_previous_text`** | 请求传入；Node FW P0 **false** | |
| **`language`** | 来自 `task.language` / `src_lang`（zh） | 非 auto 时显式中文 |

### 1.2 Node 调用（`faster-whisper-asr-strategy.ts`，FW Detector 引擎开启）

| 参数 | 值 |
|------|-----|
| `beam_size` | **1** |
| `temperature` | **0** |
| `condition_on_previous_text` | **false** |
| `use_context_buffer` | **false** |
| `use_text_context` | **false** |
| `best_of` | **未发送** |
| ASR rerun | **关闭**（`disableAsrRerun`） |

### 1.3 环境默认（`config.py`）

| 项 | 默认 |
|----|------|
| `ASR_BEAM_SIZE` | 1 |
| `ASR_TEMPERATURE` | 0.0 |
| 模型 | 本地 `faster-whisper-medium`（本审计与批测一致） |

---

## 第二部分 — FW Raw Response Schema

**HTTP `UtteranceResponse`（`api_models.py`）：**

```json
{
  "text": "string",
  "segments": [
    {
      "text": "string",
      "start": 0.0,
      "end": 2.92,
      "no_speech_prob": null,
      "avg_logprob": -0.26,
      "compression_ratio": null,
      "words": [
        {
          "word": "你好,",
          "start": 0.0,
          "end": 0.42,
          "probability": 0.765
        }
      ]
    }
  ],
  "language": "zh",
  "language_probability": null,
  "duration": 3.6,
  "vad_segments": [[0, 57600]],
  "diagnostics": { "audio_segmentation": { ... } }
}
```

**Node 侧类型：** `SegmentInfo.words?: AsrWordInfo[]` → 写入 `ctx.asrSegments` → `fw-metadata-span-gate` 读取 `segment.words[].word/probability`。

**批测 JSON 不导出 `words[]`**；本审计通过 **同参 transcribe** 单独采样（见 `meta.transcribe_kwargs`）。

---

## 第三部分 — Word Length Distribution Report

**样本：** dialog_200 **d001–d100**（n=**100**）

| 指标 | 值 |
|------|-----|
| 总 word token 数 | **2074** |
| CJK token 数 | **2063** |
| **平均 CJK 长度** | **1.09 字** |
| **中位** | **1 字** |
| 最短 / 最长 | **1 / 3 字** |
| **P95** | **2 字** |

### 粒度分类（CJK token）

| 类 | 含义 | 数量 | 占比 |
|----|------|------|------|
| **A** | 单字 | **1887** | **91.0%** |
| **B** | 双字 | **167** | **8.1%** |
| **C** | 3–4 字短词 | **9** | **0.4%** |
| D/E | 短语 / 长片段 | **0** | **0%** |

**回答：FW word 平均是 A（单字）**；偶发 B（如「今天」「我想」「问题」「需要」）；**几乎不出现**「候選生成」「上线计划」级 D/E 短语 token。

---

## 第四部分 — Span Boundary Example Report

### 4.1 reference: 候選生成 / 上线计划（tech）

**case d019** — ref 含「后选生城」「上线计化」

| 参考概念 | FW 实际切分 |
|----------|-------------|
| 候選生成 | `候` `选` `生` `成`（各 1 字；错误 ASR 亦为字级） |
| 上线计划 | `上` `线` `计` `划`（各 1 字） |

连续字 concat 可 **substring 命中**「候选生成」「上线计划」，但 **无单一 word token** 对应。

### 4.2 reference: 内科还有号吗（medical）

**case d011**

| 参考 | FW words |
|------|----------|
| 内科 | `内` + `客`（ASR 错字，仍 1 字/token） |
| 挂号处 | `挂` `号` `出` … |

**phrase_match「内科」：** **未命中**（ref 为「内科」，hyp 为「内客」）。

### 4.3 reference: 血常规（medical）

**case d010** — `些` `常` `规` 三字分离；**无「血常规」token**。

### 4.4 reference: 国贸（travel）

**case d008** — `国` `贸` 两 token；双字地名 **可拼接定位**。

### 4.5 reference: 热拿铁（cafe）

**case d001** — `热` `拿` `铁` 三 token；**phrase_match 命中**（concat）。

### 4.6 双字 token 示例（非单字）

d011: `还有`、`开始`；d001: `你好,`、`我想`、`今天`；d045: `问题`（2 字）。

---

## 第五部分 — Detector Miss Word Boundary Report

**来源：** post-fix 批测中 **未触发** 样本 + 本审计 **d045/d065** 等（100 条内）。

### 5.1 d045

| 项 | 内容 |
|----|------|
| ref | 关于**后选生城**和**上线计化**… |
| hyp（审计 transcribe） | 關於後,**雪**/**生**/**成** 和**尚**/**憲** **計**/**劃** … |
| FW words | 单字为主：`雪` `生` `成` `計` `劃` … |
| 低 prob token | 仅 `成` **0.25**、部分标点/low；**計/劃 prob > 0.97** |

**若 Detector 不看 probability、只用 word 边界：**  
**不能**直接得到 span「後選生成」或「上限計劃」— 错误字形分散在 **多个 1 字 token**；高 prob 的 `計` `劃` 也不会进 low_word_probability gate。

### 5.2 d065

| 项 | 内容 |
|----|------|
| ref | …**上线计划**窗口，**后选生城**模块… |
| FW words | `計` `劃` 分列；`後` `選` `生,` `成` 分列 |
| 短语级定位 | **需 4 字滑窗** on 字流，**非** FW 现成 word |

### 5.3 小结

| 能力 | 字级 FW word | 2–4 字 Detector 窗 | Lexicon 文本 scan |
|------|--------------|-------------------|-------------------|
| 定位「計+劃」 | ✓ 两 token | ✓ 可合并 | ✓ |
| 定位「后选生城」级 | ✗ 4+ 单字 | △ 需组合/多 span | ✓ alias |
| 定位 ASR 整句错短语 | ✗ | △ 受 maxSpanChars=4 限 | △ |

**Detector Miss 在 word 边界维度：** FW **提供了字级锚点**，但 **不提供** 业务词边界；Miss 仍主要来自 **gate 信号**（prob/alias）而非缺少 `words[]`。

---

## 第六部分 — Word Probability Distribution Report

**100 条样本，2074 tokens**

| 指标 | 全量 | 错误句 token（cer>0） |
|------|------|----------------------|
| 平均 probability | **0.894** | **0.884** |
| 中位 | **0.981** | **0.976** |
| **prob > 0.8 且所在句错误** | — | **1385 tokens** |

**高置信错误：** **非常普遍** — 错误句中大量 token 仍 **>0.8**（如 d045 的 `計`/`劃`、d001 的 `备`/`便`）。

**回答：** 是的，**经常出现 probability > 0.8 但字/词明显错误**；当前 Metadata Gate（threshold **0.65**）**无法**覆盖这类错误。

---

## 第七部分 — Word Boundary Utility Report

| 指标 | 值 |
|------|-----|
| 单 token 即可能错误窗（启发式） | **15** 案 |
| 需多 token 组合才覆盖错误 | **68** 案 |
| 参考短语在 FW 字 concat 上命中 | **4 / 21（19.0%）** |

**重合率解读：** FW word 边界与「真实错误边界（词/短语）」**低重合**；字级边界 **适合时间对齐** 与 **2–4 字滑窗**，不适合 **直接当 Lexicon term span**。

---

## 第八部分 — Segmentation Requirement Report

### 8.1 仅用 FW word 是否足够？

| 用途 | 是否足够 |
|------|----------|
| 时间戳 / 对齐 ASR 文本 | **足够** |
| 单字/双字 low-prob 检测 | **足够**（当前 Detector 路径） |
| 「候選生成」「上线计划」级 span | **不足** |
| 4 字以上短语错误 | **不足** |

### 8.2 是否需要 Jieba / HanLP / PKUSeg？

**非必须。** FW 已输出 **更细** 的字级序列；外部分词器提供的是 **语义词界**，与 FW **正交**。若目标是从字流找 **2–4 字 repair 窗**，**滑窗 + Lexicon** 比引入通用分词器 **更贴业务**。

### 8.3 是否需要 Lexicon-aware segmentation？

**是（与现架构一致）。** 本批 alias_exact_hit 仍有效（如「钟贝」2 字），但 **依赖文本扫描**，非 FW 直接输出「钟贝」token（d001 为 `中`+`备` 或 `热`+`拿`+`铁`）。

### 8.4 是否需要额外 Span Generator？

**是。** 在字级 `words[]` 之上需要 **Span Generator**（现有体现：`minSpanChars=2/maxSpanChars=4` 合并、alias scan、可选 legacy fallback），把字流 **提升** 为 repair 候选窗。

---

## 第九部分 — Detector Feasibility Report

基于 **字级 FW words + 100 条实证**：

| 方案 | 机制 | 理论收益 | 限制 |
|------|------|----------|------|
| **A** | FW word + probability | **低** | 错误 token 常 **高 prob**；本批 prob gate 仅覆盖 ~25% trigger |
| **B** | FW word + Lexicon scan | **中** | 依赖词库 alias/term 在 **文本** 上命中；与 word 边界 **弱耦合** |
| **C** | B + KenLM 句级 | **中低** | 有候选时 KenLM 仍 **pickedIsRaw**（post-fix 批测） |
| **D** | 额外 NLP 分词 + A/B | **中** | 成本↑；对 **字级错误** 不优于 **Lexicon 滑窗** |

**相对 word 边界本身：** 提升 Detector **不靠** 更细 FW 切分（已够细），而靠 **Span 生成策略**（多字合并、lexicon、非 prob 信号）。

---

## 第十部分 — 最终结论

| # | 问题 | 答案 |
|---|------|------|
| 1 | 是否启用 word_timestamps？ | **是** |
| 2 | 是否返回 words[]？ | **是** |
| 3 | 中文 word 平均长度？ | **1.09 字**（中位 1） |
| 4 | 更接近单字/词/短语？ | **单字为主（91%）**，少量双字 |
| 5 | 是否天然具备 Span 边界价值？ | **部分** — 时间对齐 + 字级 prob；**不具备** 业务短语边界 |
| 6 | Detector Miss 主因？ | **probability gate + 2–4 字窗/alias 覆盖**，**不是** 缺少 words[] |
| 7 | 是否需要 NLP 分词器？ | **非必须** |
| 8 | 是否需要 Lexicon-aware segmentation？ | **需要**（与现 alias/Recall 一致） |
| 9 | 若只做一个方向？ | **Span Generator（字流→2–4 字 repair 窗 + Lexicon 锚定）**，而非调 FW 分词 |

### FW 已经做了多少「分词」工作？

```text
Silero VAD 语音段
  → Whisper transcribe(word_timestamps=True)
  → 输出：字级/近字级 token + start/end + probability
  → 不做：中文词法分析、领域短语切分、Lexicon 对齐
```

**FW 完成了「声学→字序列+置信度」；未完成「字序列→业务 repair span」。** 后者仍是 Node 侧 Detector / Lexicon 的职责。

---

## 附录 — 数据文件

| 文件 | 说明 |
|------|------|
| `tests/audit-fw-word-boundary-data.json` | 100 条逐 case words、probability、focus/miss 分析 |
| `tests/audit-fw-word-boundary.py` | 只读复现脚本（同 `asr_worker_process` transcribe kwargs） |
