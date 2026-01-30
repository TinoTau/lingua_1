# NMT 使用自带 context 接口说明（2026-01-29）

## 一、节点端行为

- **使用 NMT 自带的 context 入参**：调用 NMT 时传 `text`（当前句）与 `context_text`（上一句原文），由 NMT 接口分别接收，**节点不做拼接、不做剪辑**。
- **context 来源**：`aggregatorManager.getLastCommittedText(session_id, utterance_index)`，即上一句已提交的 ASR/语义修复后文本。
- **长度限制**：若上一句超过 200 字，只取最后 200 字作为 `context_text`，避免过长上下文触发服务端异常行为。

**代码**：`electron_node/electron-node/main/src/agent/postprocess/translation-stage.ts`。

---

## 二、NMT 服务约定

- **入参**：`text` = 当前要译的一句，`context_text` = 上一句原文（可选）。
- **预期**：NMT 仅用 `context_text` 做消歧（指代、多义词等），**输出应仅为 `text` 的译文**，不得把 context 的译文拼进结果。
- 若服务端把 context 与 text 一起译出或拼进返回，会导致整段合并译文（如 Job13+），需在 **NMT 服务侧** 修正：context 仅参与内部推理，不参与输出。

---

## 三、单测

- **文件**：`main/src/agent/postprocess/translation-stage.context.test.ts`
- **内容**：
  - 有上一句时，NMT 被调用时带 `context_text`；
  - 无上一句时，`context_text` 为 undefined；
  - aggregatorManager 为 null 时，`context_text` 为 undefined；
  - 上一句超过 200 字时，只传最后 200 字。

---

## 四、其它问题（未在节点端修改）

| 现象 | 根因 | 建议 |
|------|------|------|
| Job1/Job2 截断导致译文意思相反 | 音频切分边界，节点 segmentForJobResult 正确。 | 在音频聚合/切分策略调整。 |
| Job6 丢失句首 | 哪段音频送 ASR / 切分与归属。 | 在音频/ASR 侧排查。 |
| Job7 译文里出现 SEP_PARC | NMT 模型把特殊 token 当正文输出。 | 在 NMT 服务/解码中修复。 |
