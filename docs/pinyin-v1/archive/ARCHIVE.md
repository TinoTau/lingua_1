# Pinyin-IME-V1 归档说明

> **状态**：已退役（2026-06）— 由 [Pinyin-IME-V2](../../pinyin-v2/README.md) 取代

## 历史概要

V1 为 decoder spike 与三层词典（base / common5 / domain_patch）试验，曾探索：

- 单字层 TSV 导入（见 `import/`）
- KenLM 与 span 覆盖度验证（**未进入**当前主链）
- 重命名为 V2 前的冻结方案草案

## 与当前主链关系

| 项 | V1 | 当前（V4） |
|----|-----|------------|
| IME 入口 | `resolvePinyinImeV2Spans` 等（已删） | `extractRawCoarseBoundaries` |
| 词典 | 三层 JSONL 试验 | Lexicon V3 bundle + IME V2 导出 |
| FW Pipeline | 无 V4 | `runFwDetectorV4Path` |

**代码库中无 V1 活动引用**；`import/` 仅保留词典样本与 manifest 供追溯。

## 保留文件

| 路径 | 说明 |
|------|------|
| `import/pinyin-ime-v1_single_char_dictionary_v2_2500.*` | 单字层导入数据 |
| `import/pinyin-ime-v1_single_char_dictionary_v2_2500_README.md` | 导入格式说明 |

开发/测试/审计报告与冻结方案长文已移除；现行规范见 [pinyin-v2/ARCHITECTURE.md](../../pinyin-v2/ARCHITECTURE.md)。
