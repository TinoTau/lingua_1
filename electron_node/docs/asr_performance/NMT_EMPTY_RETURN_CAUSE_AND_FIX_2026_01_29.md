# 为何备份代码 NMT 有返回值、正式代码 NMT 返回空（2026-01-29）

## 现象

- **备份代码**：NMT 调用正常，能拿到译文。
- **正式代码**：向 nmt-m2m100 发请求，HTTP 200，但 `translatedText` 为空。

## 根因（与备份的差异）

1. **NMT 只认具体语言代码**  
   M2M100 的 `tokenizer.src_lang` / `get_lang_id(tgt_lang)` 只支持 **ISO 639-1**（如 `zh`、`en`），**不支持 `"auto"`**。

2. **正式代码曾把 `"auto"` 传给 NMT**  
   在 `translation-step` 里：
   - `sourceLang = job.src_lang`，若 `job.src_lang === 'auto'` 且 **未** 设置 `ctx.detectedSourceLang`，则传给 NMT 的仍是 `"auto"`。
   - `targetLang = ctx.detectedTargetLang || job.tgt_lang`，若 job 里是 `tgt_lang === 'auto'` 且未检测到目标语言，也会把 `"auto"` 传给 NMT。
   - 聚合步骤（aggregation-step）里已有「auto → lang_a」的 fallback，但**翻译步骤之前没有**，导致 NMT 收到非法语言代码，可能抛错或产生空输出；HTTP 仍可能 200。

3. **备份代码为何能工作**  
   备份若满足其一，就不会把 `"auto"` 传给 NMT：
   - job 里多为显式 `src_lang`/`tgt_lang`（如 `zh`/`en`），或  
   - 双向模式下 `ctx.detectedSourceLang` / `ctx.detectedTargetLang` 在翻译前已设置好，或  
   - 使用的 NMT/调度方式与当前不同，从未传过 `"auto"`。

## 修改说明（2026-01-29）

在 **`electron_node/electron-node/main/src/pipeline/steps/translation-step.ts`** 中，与 aggregation-step 对齐，在调用 NMT 前**强制把 `"auto"` 落成具体语言**，且不新增多余分支：

- **源语言**：若 `job.src_lang === 'auto'` 且没有 `ctx.detectedSourceLang`，则用 `job.lang_a` 作为源语言。
- **目标语言**：若 `targetLang === 'auto'`，则用 `job.lang_b` 作为目标语言。

这样传给 NMT 的 `src_lang` / `tgt_lang` 始终为 M2M100 支持的语言代码，避免因 `"auto"` 导致空译文。

## 建议验证

1. 跑一轮集成/长句测试，确认 NMT 返回的 `translatedText` 非空。  
2. 在 **NMT 服务日志**（或节点端「NMT INPUT」日志）中确认请求体里的 `src_lang`、`tgt_lang` 已为 `zh`/`en` 等，而不再是 `auto`。  
3. 若仍出现空译文，再查 NMT 服务端：  
   - 模型是否加载成功；  
   - 是否有 `filter_punctuation_only` 等把结果滤成空；  
   - `extract_translation` 在带 `context_text` 时是否提取失败导致返回空串。
