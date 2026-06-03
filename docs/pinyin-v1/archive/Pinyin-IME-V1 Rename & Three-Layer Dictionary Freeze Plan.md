# Pinyin-IME-V1 重命名与三层词典 — Freeze Plan

> **实施状态**：代码已按 V1.1 补充落地（仅 `tests/spike/`）。  
> **约束全文**：[Pinyin-IME-V1_Rename_and_Three-Layer_Dictionary_Freeze_Plan_V1_1_Supplement.md](./Pinyin-IME-V1_Rename_and_Three-Layer_Dictionary_Freeze_Plan_V1_1_Supplement.md)

## 范围

- 正式名：`pinyin-ime-v1`
- 词典层：`base_dictionary`、`domain_dictionary`、`target_dictionary`（target 仅 boost）
- 不进 `main/src`；不改 Lexicon V3.1 SQLite schema

## 命令（冻结）

```powershell
npm run spike:pinyin-ime-v1:export:all
npm run spike:pinyin-ime-v1:dialog200
npm run spike:pinyin-ime-v1:analyze
```

详见 `electron_node/electron-node/tests/spike/README.md`。
