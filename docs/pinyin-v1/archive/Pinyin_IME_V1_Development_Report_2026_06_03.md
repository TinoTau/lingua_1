# Pinyin IME V1 — 开发报告

**日期**：2026-06-03  
**范围**：`pinyin-ime-v1` 重命名与三层词典（仅 `tests/spike/`，未接入主链）  
**依据**：[Pinyin-IME-V1_Rename_and_Three-Layer_Dictionary_Freeze_Plan_V1_1_Supplement.md](./Pinyin-IME-V1_Rename_and_Three-Layer_Dictionary_Freeze_Plan_V1_1_Supplement.md)

---

## 1. 交付摘要

| 项 | 状态 |
|----|------|
| 正式命名 `pinyin-ime-v1` | 已完成 |
| 三层词典导出 | `base` / `domain` / `target` + `routing_boost.json` |
| 合并加载 + target boost | `lib/dict-load.mjs` |
| `imeWeight` Exporter 派生 | `lib/dict-weight.mjs`（W-03） |
| Sidecar / Dialog200 / Analyze | `pinyin-ime-v1-*.mjs` |
| npm scripts | `spike:pinyin-ime-v1:*`（`spike:ime:*` deprecated 转发） |
| `main/src` | **无改动** |

---

## 2. 架构与模块

```
Lexicon V3 sqlite (只读)
  → pinyin-ime-v1-export (--layer base|domain|target|all)
  → tmp/pinyin-ime-v1/{base,domain,target}_dictionary.txt

raw_asr_text → pinyin-stream → loadPinyinImeV1Dictionaries (merge base+domain, target boost)
  → dict_dp beam → topK → diff → KenLM (可选) → 报告
```

| 文件 | 职责 |
|------|------|
| `pinyin-ime-v1-export.mjs` | 分层导出 + `export_manifest.json` |
| `lib/dict-export-core.mjs` | SQL → TSV（含 canonical、imeWeight） |
| `lib/dict-load.mjs` | merge 解码词表 + target 加成 |
| `lib/ime-dict-decoder.mjs` | dict_dp |
| `pinyin-ime-v1-sidecar.mjs` | `POST /decode`、`POST /pinyin-ime-v1/decode` |
| `run-pinyin-ime-v1-dialog200.mjs` | 离线批测 |
| `analyze-pinyin-ime-v1.mjs` | Freeze Gate → `docs/pinyin-v1/pinyin-ime-v1-report-latest.md` |
| `lib/target-dictionary-index.mjs` | KenLM would-apply 门控 |

---

## 3. 三层词典（导出实测）

| 层 | 行数 | 来源 |
|----|------|------|
| base_dictionary | 72193 | base_lexicon + idiom_lexicon（`is_alias=0`） |
| domain_dictionary | 26 | domain_lexicon（含 canonical） |
| target_dictionary | 72218 | 三表 `repair_target=1`（当前 bundle 与全量行数接近，语义为 **boost 层**） |
| routing_boost | 9 | industry_routing_lexicon |

产物目录：`electron_node/electron-node/tests/spike/tmp/pinyin-ime-v1/`

---

## 4. 与旧 Spike 的差异

| 旧 | 新 |
|----|-----|
| `repair-only` / `ime_dict.txt` | `target_dictionary` + 三层 TSV |
| 单文件 prior | `imeWeight` 派生（target×1.25、alias×0.85） |
| 仅 merge 隐式全表 | 显式 `loadPinyinImeV1Dictionaries()` |
| `spike:ime:*` | `spike:pinyin-ime-v1:*` |

**冒烟**：`jin tian tao lun` → 候选 `今天讨论`（三层 merge 后 beam 可出句）。

---

## 5. 冻结边界遵守

- B-01～B-10：Spike 只读 `extra.raw_asr_text`，不写 JobContext / 不改 FW Pipeline。
- V1-01：产物仅 `tests/spike/tmp/pinyin-ime-v1/`。
- SQLite schema：**未修改**。

---

## 6. 已知限制

1. **长句 ASR 拼音流**：整句 `pinyin-pro` 音节链与词典短语对齐困难，Dialog200 上常 **0 候选**（非 base 行数不足）。
2. **节点端 Lexicon**：`better-sqlite3` ABI（127 vs 119）未在本机复测中修复 → FW/词库路径未跑通（见测试报告）。
3. **Freeze Gate**：Top5 / would-apply 未达标，**不推荐入主链**。
4. **GPL**：libpinyin 对照未做。

---

## 7. 命令速查

```powershell
cd electron_node\electron-node
$env:PROJECT_ROOT = "D:\Programs\github\lingua_1"
npm run spike:pinyin-ime-v1:export:all
npm run spike:pinyin-ime-v1:dialog200
npm run spike:pinyin-ime-v1:analyze
```

---

## 8. 回滚

删除 `tests/spike/` 与 `package.json` 中 `spike:pinyin-ime-v1:*` / `spike:ime:*` 即可。
