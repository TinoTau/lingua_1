# Job8 合并译文与 NMT 接口说明（2026-01-29）

**问题**：集成测试中 Job8 再次出现合并译文（上下文句 + 当前句被一起返回）。  
**结论**：NMT 已使用分隔符（`SEPARATOR` / `SEP_MARKER`）；合并译文来自提取失败时回退到 **FULL_ONLY**（返回完整输出）。**不需要**“回到之前用分隔符的方式”——当前就是用分隔符；需要的是在 FULL_ONLY 回退时尽量只返回「当前句」部分。

---

## 1. NMT 接口与分隔符（当前逻辑）

- **节点端**（`translation-stage.ts`）：  
  - 将**上一句原文**作为 `context_text` 传入（截断 200 字），当前句为 `text`。  
  - NMT 输入格式由服务端决定；服务端用分隔符拼接。

- **NMT 服务**（`nmt_m2m100/nmt_service.py`）：  
  - 输入：`input_text = f"{req.context_text}{SEPARATOR}{req.text}"`  
  - `SEPARATOR = " ⟪⟪SEP_MARKER⟫⟫ "`（及若干变体在 `SEPARATOR_TRANSLATIONS`、`SEP_MARKER_VARIANTS`）。  
  - 模型可能把上下文和当前句都翻译并输出；服务用 **extract_translation** 按哨兵序列/SEP_MARKER 提取**仅当前句译文**。

- **提取逻辑**（`translation_extractor.py`）：  
  1. 若 `context_text` 为空 → 直接返回完整译文（FULL_ONLY，无合并问题）。  
  2. 有 context 时：先按哨兵/SEP_MARKER 定位，取其后为当前句（SENTINEL）；失败则 align_fallback、再 SINGLE_ONLY；  
  3. 若仍失败 → 原先直接返回完整输出（**FULL_ONLY**），会把「上下文译文 + 当前句译文」一起返回，即**合并译文**。

因此：**合并译文 = 提取失败后回退到 FULL_ONLY**。  
**不需要**“恢复分隔符”——分隔符一直在用；需要的是**减少 FULL_ONLY 时返回整段合并内容**。

---

## 2. 本次修改：FULL_ONLY 时的「最后一段」回退

在 **FULL_ONLY** 的两处回退（“兜底策略2” 与 `except` 分支）中，**先**尝试从完整输出里按分隔符/SEP_MARKER 变体做一次「取最后一段」：

- 新增 `try_extract_last_segment_from_full(out)`：  
  - 在所有 `SEPARATOR_TRANSLATIONS`、`SEP_MARKER_VARIANTS` 中找**最后一次**出现位置；  
  - 取该位置之后的子串为「当前句」候选，清理残留标记后若非空则返回。  
- 若该函数返回非空 → 使用该段作为译文，`extraction_mode = "FULL_ONLY_LAST_SEGMENT"`。  
- 若仍无法得到有效段落 → 再回退到原逻辑（返回完整输出，`FULL_ONLY`）。

这样在哨兵/对齐都失败时，只要输出里仍包含分隔符或 SEP_MARKER，就有机会只返回最后一段，避免把整段合并译文交给客户端。

---

## 3. 代码与配置位置

| 位置 | 说明 |
|------|------|
| `electron_node/services/nmt_m2m100/config.py` | `SEPARATOR`、`SEPARATOR_TRANSLATIONS`、`SEP_MARKER_VARIANTS` |
| `electron_node/services/nmt_m2m100/nmt_service.py` | 拼接 `context_text + SEPARATOR + text`，调用 `extract_translation` |
| `electron_node/services/nmt_m2m100/translation_extractor.py` | `extract_translation`、`find_sentinel_position`、`try_extract_last_segment_from_full`（新增） |
| `electron_node/electron-node/main/src/agent/postprocess/translation-stage.ts` | 传 `context_text`（上一句原文，截断 200 字） |

---

## 4. 兜底路径日志（便于异常时定位）

所有兜底路径统一使用前缀 **`[NMT Service] EXTRACTION_FALLBACK`**，便于在日志中一次性检索：

- **`EXTRACTION_FALLBACK mode=FULL_ONLY`**：最终使用了完整输出（可能含合并译文），可看同行的 `reason=` 与 `out_preview=` 定位原因。
- **`EXTRACTION_FALLBACK mode=FULL_ONLY_LAST_SEGMENT`**：使用了「最后一段」兜底，可看 `segment_preview=` 确认取到的内容。
- **`EXTRACTION_FALLBACK last_segment_from_full=no_separator`**：完整输出中未找到分隔符，导致无法取最后一段。
- **`EXTRACTION_FALLBACK last_segment_from_full=ok`**：成功从完整输出中取到最后一段。

建议：出现合并译文或异常时，在 NMT 服务日志中 **grep `EXTRACTION_FALLBACK`**，即可快速看到本次请求走了哪条兜底路径及预览内容。

---

## 5. 若仍出现合并译文

1. **看 NMT 日志**：搜索 **`EXTRACTION_FALLBACK`** 或 `extraction_mode` / `FULL_ONLY` / `FULL_ONLY_LAST_SEGMENT`。  
   - 若多为 `FULL_ONLY`：说明「最后一段」未取到（输出中无分隔符或格式异常）。  
   - 若为 `FULL_ONLY_LAST_SEGMENT` 仍合并：可能是取到的“最后一段”仍含多句，需再收紧切分或增加分隔符变体。

2. **看输出格式**：若模型把 `⟪⟪SEP_MARKER⟫⟫` 翻译成其他语言/形态，需在 `SEPARATOR_TRANSLATIONS` 或 `SEP_MARKER_VARIANTS` 中补充对应变体，以便 `find_sentinel_position` / `try_extract_last_segment_from_full` 能识别。

3. **Job2 音频丢失**：见 `JOB2_AUDIO_LOSS_AND_NO_RETURN_ANALYSIS_2026_01_29.md`——根因是 NMT 返回空译文，与合并译文为不同问题。
