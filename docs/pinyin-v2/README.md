# Pinyin-IME-V2 文档

> **状态**：**V2.0 已冻结**（Span Discovery）— 在 V4 主链中职责为 **粗边界**  
> **架构 SSOT**：[ARCHITECTURE.md](./ARCHITECTURE.md)  
> **词典**：[DICTIONARY.md](./DICTIONARY.md)

## V4 主链中的位置

```text
rawAsrText → extractRawCoarseBoundaries (pinyin-ime-v2)
  → Global Window → Recall → … → Apply
```

**不再**作为 `resolvePinyinImeV2Spans` 编排入口（已随 V2/V3 Pipeline 退役删除）。

**代码**：`electron_node/electron-node/main/src/fw-detector/pinyin-ime-v2/`  
**FW 总览**：[../fw-detector/README.md](../fw-detector/README.md)

## 配置

`features.pinyinImeV2`（默认 `enabled: true`，`topK: 5`，`directRepair: false`）

## 常用命令

```powershell
cd D:\Programs\github\lingua_1\electron_node\electron-node
$env:PROJECT_ROOT = "D:\Programs\github\lingua_1"
npm run build:main
npm run pinyin-ime-v2:export:all
npx jest --testPathPattern="pinyin-ime-v2|freeze-contract"
node scripts/fw-detector-gate.mjs
```

## 本目录

| 文件 | 说明 |
|------|------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | IME 内部管线、SpanSelector、冻结约束 |
| [DICTIONARY.md](./DICTIONARY.md) | 词典导出 |
| `import/single_char_dictionary.tsv` | 单字层数据 |

**已移除**：本目录及 `docs/tone` 下全部审计/测试/开发报告。

## 冻结后

- **允许**：Bug Fix、Regression、Freeze Contract、文档与 V4 主链对齐  
- **禁止**：TopK>5、新 Span 直进主链、Lattice/Backpointer、`directRepair`
