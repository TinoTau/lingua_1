# 繁体仍输出与同音纠错未生效说明

## 现象

- ASR 输出为繁体（如「這場的場景是一般的場景」「防具能夠被完整的識別出來…」），经语义修复后仍为繁体。
- Prompt 要求「若输入为繁体，输出请统一为简体」，但实际未转换。
- 同音/近音纠错（phonetic）对这类句子也未见修改（`textChanged: false`）。

## 原因分析

### 1. 为什么还是繁体？

语义修复流水线是：**同音纠错（phonetic_correct）→ LLM 语义修复**。

- **同音纠错**：当前 `phonetic/confusion_set.py` 里的同音字组 **只包含简体字**（如「识」「别」「与」「语」），**不包含繁体字**（如「識」「別」「與」「場」「夠」「說」）。因此对「這場的場景…」等句，`get_replaceable_positions()` 查不到任何可替换位点，`phonetic_correct()` 直接返回原文，**不会做繁→简**。
- **LLM**：输入仍是繁体，Prompt 虽要求「输出请统一为简体」「若输入为繁体则转简体」，但本地小模型（LlamaCpp）**指令遵从不稳定**，经常原样或近似原样返回繁体，导致最终 `text_out` 仍是繁体。

因此：**没有强制繁→简的步骤**，仅靠 Prompt 不足以保证输出为简体。

### 2. Phonetic 纠错有没有生效？

**对当前这批繁体 ASR 文本，phonetic 纠错实质上未生效。**

- 同音候选来自 `confusion_set.py` 的 `SAME_PINYIN_GROUPS`，只建了 **简体** 的「字 → 同音组」映射。
- 输入为繁体时，句中字符（如「場」「景」「夠」「識」「與」）**不在映射里**，`get_replaceable_positions()` 返回空，不会生成任何候选，LM 打分与选优都不会执行，`phonetic_correct()` 直接返回原文。
- 因此：**phonetic 模块“跑过了”，但没有可替换位点，所以没有任何纠错效果**；若 ASR 给的是简体，同音纠错才会在已配置的同音组上生效。

## 建议改动（保证简体 + 让 phonetic 生效）

1. **在中文流水线最前增加一步「繁→简」**
   - 使用 [OpenCC](https://github.com/BYVoid/OpenCC)（或其它库）将 `text_in` 先转为简体，再送入 `phonetic_correct` 和 LLM。
   - 这样：  
     - 同音字组（简体）能匹配到字符，phonetic 纠错可以正常生效；  
     - LLM 看到的也是简体，更符合「输出请使用简体中文」的设定。

2. **（可选）在 LLM 输出后再做一次繁→简**
   - 若模型仍偶尔输出繁体，可在最终 `text_out` 上再做一次 OpenCC 繁→简，保证返回给节点的一律是简体。

3. **（可选）扩展 confusion_set**
   - 若希望在不改流水线的前提下对部分繁体做同音纠错，可在同音组中为常用字增加繁体字形，使 `get_replaceable_positions` 能识别繁体位点；但维护成本较高，优先推荐「先繁→简再 phonetic」的方案。

实现上，在 `zh_repair_processor.py` 的 `process()` 入口对 `text_in` 做一次 OpenCC 繁→简，再将结果交给现有的 `phonetic_correct` 和 `self.engine.repair()` 即可；若在出口再对 `text_out` 做一次繁→简，可进一步保证输出始终为简体。
