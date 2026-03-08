# 英文 CTC 解码说明（asr_sherpa_en）

**服务**：`services/asr_sherpa_en`（NeMo CTC En Conformer small + pyctcdecode）。  
**目的**：解码链路、blank/词表配置、输出异常「4」的定位与可选修复。

---

## 1. 现象与结论

- 英文 CTC 偶发输出**数字 "4"** 或重复词；同一音频不同请求可能有无 "4" 的结果。
- **结论**：属解码/词表映射（blank index）或 pyctcdecode/上游问题；词表内 index 4 已确认为字母 `t`，blank=1024 已置空；若仍出 "4" 可通过 EN_CTC_DIAG 日志做分流（见下）。

---

## 2. 解码链路与可能问题

| 阶段 | 位置 | 可能问题 |
|------|------|----------|
| 输入 | PCM16 → 服务 | 采样率/声道/格式错误 → 特征错 |
| 特征 | `features.py` waveform_to_fbank | CMVN/维度与模型不一致 |
| 模型 | `onnx_runner.py` | 输入 (1,80,T)、vocab_size 与 tokens 不一致 |
| 词表 | `ctc_decode.py` _load_labels | blank 索引设错 → 某 index 被当文本输出 |
| 解码 | `ctc_decode.py` decode_beams | pyctcdecode 用 labels 映射 |

---

## 3. 诊断日志（如何看）

- **build_decoder 时**：日志 `CTC decoder contract: model_id=... tokens_hash=... blank_index=... blank_index_override=... first_20=[...]`。看 index 4 对应 `"4"` 还是 `""` 或字母。
- **decode 时**：首条 beam 打 `CTC decode beam0 raw=...`，可判断 "4" 是否来自解码层。
- **出现「4」时**：`service_main` 打 `EN_CTC_DIAG trace_id=... beam0_raw=... final_text=...`。在服务日志或节点 `logs/electron-main.log` 中 **grep `EN_CTC_DIAG`**，用 beam0_raw 与 final_text 分流：beam0_raw 含 "4" → 解码/词表；不含 → 后续处理。

---

## 4. 已实现措施

### 4.1 静音 argmax 脚本

- **路径**：`scripts/confirm_blank_index.py`
- **用法**：`python scripts/confirm_blank_index.py` 或 `python scripts/confirm_blank_index.py 1.5`
- **作用**：静音跑 ONNX，每帧 argmax，出现最多的 index 即 blank；并打印 tokens 前 15 行。

### 4.2 blank 可配置与启动断言

- **环境变量**：`ASR_SHERPA_EN_BLANK_INDEX`（如 `4`），在 `build_decoder` 中作为 `blank_index_override` 生效。
- **启动断言**：生效后 `labels[blank_index]==""` 必须成立，否则 RuntimeError。
- **日志**：启动时打 `CTC decoder contract: ... blank_index_override=... first_20=...`。

### 4.3 tokens 格式自检

- `_sanity_check_labels(labels)`：前 20 项中单数字/单非字母过多则拒绝启动（`tokens format mismatch`），避免 symbol/id 反了。

---

## 5. 如何确认模型的 blank index

- NeMo CTC 常见为 **index 0** 或 **最后一维**。
- 查看 `models/nemo_ctc_en_conformer_small/tokens.txt` 格式（symbol id 或 id symbol）。
- 用 `confirm_blank_index.py` 跑静音，出现最多的 index 即为 blank。

---

## 6. 可选修改（若确认 blank 在 index 4）

在 `build_decoder` 中「按名字置空 <blk>/<blank>」之后，可从 config 读 `BLANK_INDEX` 并执行：

```python
if BLANK_INDEX_OVERRIDE is not None and 0 <= BLANK_INDEX_OVERRIDE < len(labels):
    labels[BLANK_INDEX_OVERRIDE] = ""
```

当前已支持环境变量 `ASR_SHERPA_EN_BLANK_INDEX`，无需改代码。

---

## 7. 若 index 4 不是 blank（模型真在预测 "4"）

可考虑：短段门禁（如 <800ms 不识别）、输出合法性检查（非法/数字比例过高返回 ASR_OUTPUT_INVALID）、或后处理过滤单独数字。建议先通过 EN_CTC_DIAG 确认 "4" 来源再决定。

---

## 8. 词表与「4」的已确认结论

- 静音 argmax：**blank = 1024**，已置空。
- tokens.txt：index 4 对应 **`t`**（字母），非数字 "4"；词表内无单字符 "4"。
- 若输出仍出现 "4"，可能来自：pyctcdecode 内部、词表其他位置（如全角）、或节点/聚合层。出现 "4" 时抓 **beam0 raw** 对比即可分流。
