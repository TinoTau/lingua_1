# P4 Sentence-Level Rerank + Tone Pinyin 开发冻结方案

> **已升级至 V1.1**：见 [`P4_Sentence_Level_Rerank_TonePinyin_开发冻结方案_V1_1.md`](./P4_Sentence_Level_Rerank_TonePinyin_开发冻结方案_V1_1.md)

V1 摘要（核心冻结点）：
- Metadata Gate 保留
- maxSpans=4
- maxSentenceCandidates=16
- base+domain 合计 limit
- Tone Pinyin 排序不过滤
- Sentence-Level KenLM Rerank
- applyFwSpanReplacements 保留
- useSentenceLevelRerank 回滚开关

补充清单：[`P4_Sentence_Level_Rerank_TonePinyin_开发冻结方案_补充清单_V1_1.md`](./P4_Sentence_Level_Rerank_TonePinyin_开发冻结方案_补充清单_V1_1.md)
