# Pinyin-IME-V2 — 词典与导出

**状态**：随 V2.0 冻结  
**代码**：`main/src/fw-detector/pinyin-ime-v2/pinyin-ime-v2-dict-load.ts`  
**脚本**：`electron_node/electron-node/scripts/pinyin-ime-v2/export-ime-dict.mjs`

---

## 1. 运行时路径

| 项 | 默认路径 |
|----|----------|
| IME 词典目录 | `{PROJECT_ROOT}/node_runtime/pinyin-ime-v2/dict/` |
| 配置覆盖 | `features.pinyinImeV2.dictDir` |
| 单字 TSV（构建输入） | `docs/pinyin-v2/import/single_char_dictionary.tsv` |

与 **Lexicon v3**（`node_runtime/lexicon/v3`）分离：IME 用拼音音节索引 `byFirst`，Recall 用 v3 SQLite。

---

## 2. 导出产物

`npm run pinyin-ime-v2:export:all` 生成：

| 文件 | 层 |
|------|-----|
| `base.tsv` | base |
| `domain_*.tsv` | domain（按领域） |
| `target.tsv` | target |

加载时合并为 `PinyinImeV2Dict`：`entries`、`byFirst`、`byFirstFallback`（单字 fallback）。

---

## 3. 导出命令

```powershell
cd D:\Programs\github\lingua_1\electron_node\electron-node
$env:PROJECT_ROOT = "D:\Programs\github\lingua_1"

npm run pinyin-ime-v2:export:all
npm run pinyin-ime-v2:export:base
npm run pinyin-ime-v2:export:domain
npm run pinyin-ime-v2:export:target
```

导出前需 v3 / 资产源可用（脚本从项目词库管线读取，见 `export-ime-dict.mjs` 头部说明）。

---

## 4. 词条字段（运行时）

```typescript
// PinyinImeV2DictEntry
{
  word: string;
  syllables: string[];   // 拼音音节序列
  prior: number;
  source: 'base' | 'domain' | 'target' | 'single_char' | 'fallback';
  singleCharRole?: ...;  // 单字角色
  isSingleChar?: boolean;
  isFallback?: boolean;
}
```

Decoder 按 **首音节** 查 `byFirst`；beam 宽度 **48**；输出 TopK **≤5**（配置 `topK`）。

---

## 5. 单字层

- 源：`docs/pinyin-v2/import/single_char_dictionary.tsv`
- 角色：`function_single_char`、`content_single_char`、`fallback` 等（见 `pinyin-ime-v2-single-char-roles.ts`）
- 用途：beam 断裂时 `byFirstFallback` 路径，**不**改变 TopK 过滤规则

---

## 6. 运维注意

| 场景 | 动作 |
|------|------|
| 词库更新后 | 重新 `export:all`，重启节点（或清 IME dict 缓存） |
| 测试隔离 | `resetPinyinImeV2DictCacheForTest()` |
| 词典不可用 | `resolvePinyinImeV2Spans` → `skippedReason: ime_dict_unavailable` |

---

## 7. 与 Lexicon v3 关系

| | IME 词典 | Lexicon v3 |
|---|----------|------------|
| 用途 | Span Proposal / decode | Recall 候选 |
| 存储 | TSV + 内存 Map | SQLite |
| 路径 | `pinyin-ime-v2/dict/` | `lexicon/v3/` |

两者 **不得** 混用为同一数据源。
