# Pinyin-IME-V2 文档

> **状态**：**V2.0 已冻结**（2026-06-03）— Span Discovery 使命已完成  
> **架构 SSOT**：[ARCHITECTURE.md](./ARCHITECTURE.md)  
> **词典**：[DICTIONARY.md](./DICTIONARY.md)

## 唯一主链（FW 活动路径）

```text
rawAsrText → Pinyin-IME-V2 → HintGate → Recall → Candidate Builder → KenLM → Apply → segmentForJobResult
```

**代码**：`electron_node/electron-node/main/src/fw-detector/pinyin-ime-v2/`  
**编排**：`fw-detector-orchestrator.ts`（`resolvePinyinImeV2Spans`）

## 配置

`features.pinyinImeV2`（默认 `enabled: true`，`topK: 5`，`directRepair: false`）

## 常用命令

```powershell
cd D:\Programs\github\lingua_1\electron_node\electron-node
$env:PROJECT_ROOT = "D:\Programs\github\lingua_1"

npm run build:main
npm run pinyin-ime-v2:export:all    # 见 DICTIONARY.md
npx jest --testPathPattern="pinyin-ime-v2|freeze-contract"
node scripts/fw-detector-gate.mjs
```

## 模块内代码文档

| 文档 | 路径 |
|------|------|
| FW Detector（Recall/KenLM/Apply） | `main/src/fw-detector/README.md` |
| Lexicon v3 Runtime | `docs/lexicon-v3/ARCHITECTURE.md` |

## 本目录文件

| 文件 | 说明 |
|------|------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 冻结架构、IME 设计、约束、责任边界 |
| [DICTIONARY.md](./DICTIONARY.md) | IME 词典导出与数据文件 |
| `import/single_char_dictionary.tsv` | 单字层数据（非 Markdown） |

**已移除**：Phase 开发报告、Dialog200/性能/冻结就绪等审计与测试报告、V1.0/V1.1 实施方案与草案（内容已并入 ARCHITECTURE 或废弃）。

## 冻结后

- **允许**：Bug Fix、Regression、Freeze Contract、文档修正  
- **禁止**：IME 功能扩展、TopK>5、新 Span 来源、Lattice/Backpointer、绕过 Recall/KenLM  
- **下一阶段**（非 IME）：**KenLM Audit**
