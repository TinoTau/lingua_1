# Lexicon 调号 Seed 补齐 — 开发报告

**日期：** 2026-06-07  
**范围：** P1.0 词库 `tone_pinyin_key` SSOT 补齐 + 构建链路修复 + runtime 重载  
**状态：** 已完成构建与部署；Node 已重启加载新 bundle

---

## 1. 目标

为 FW / ToneModule P0.5 提供带数字调号的 `tone_pinyin_key`，使同音桶内候选可按声学调号排序，而非全部退化为 plain `pinyin_key`。

---

## 2. 变更摘要

### 2.1 Seed 资产（用户提交）

| 文件 | 行数 | 新增字段 |
|------|------|----------|
| `electron_node/docs/lexicon-assets/.../base_zh_v2/entries.jsonl` | 50,000 | `tonePinyin`, `tonePinyinKey` |
| `.../idiom_zh_v2/entries.jsonl` | 22,192 | 同上 |
| `.../domain_patch_zh_v2/entries.jsonl` | 9 | 同上 |
| `.../common5_zh_v2/entries.jsonl` | 897 | 同上（构建仍拒绝入库） |

格式示例：

```json
{
  "word": "中杯",
  "pinyin": "zhong bei",
  "tonePinyin": "zhong1 bei1",
  "tonePinyinKey": "zhong1|bei1",
  "lexiconLayer": "domain_patch"
}
```

**Seed 校验（构建前）：** 四文件 JSON 合法率 100%；`tonePinyin` / `tonePinyinKey` 覆盖率 100%；音节数与 `pinyin` 对齐 100%。

### 2.2 构建脚本修复

**文件：** `electron_node/electron-node/scripts/lexicon/lib/parse-rows.mjs`

`parseCanonicalRow` 新增解析：

- `tonePinyin` / `tone_pinyin`
- `tonePinyinKey` / `tone_pinyin_key`

否则 `buildCanonicalRecord` → `resolveTonePinyinKey` 无法读取 seed 显式调号，会退化为无声调 `pinyin_key`。

### 2.3 离线重建

```powershell
cd electron_node\electron-node

npm run lexicon:build:v2-shadow -- --input D:\Programs\github\lingua_1\electron_node\docs\lexicon-assets\p1_3_generic_zh_lexicon_v2_fw_domains\p1_3_lexicon_zh_v2

Remove-Item -Recurse -Force ..\..\node_runtime\lexicon\v3   # --force 当前 CLI 未解析，需手动删除
npm run lexicon:prepare:v3-runtime
npm run lexicon:gate:v3-runtime
```

### 2.4 Runtime 重载

```powershell
$env:PROJECT_ROOT="D:\Programs\github\lingua_1"
.\scripts\start_electron_node.ps1
```

---

## 3. 产出物

| 产物 | 路径 |
|------|------|
| V3 runtime DB | `node_runtime/lexicon/v3/lexicon.sqlite` |
| Manifest | `node_runtime/lexicon/v3/manifest.json` |
| DB 审计 JSON | `electron_node/electron-node/tests/experiments/lexicon-tone-db-audit.json` |

**新 bundle 元数据：**

- `buildTime`: `2026-06-07T03:23:11.553Z`
- `checksum`: `sha256:84a1ed29c051b17397ac9be6c76738df837a9e320b030413c0e25d552d52f3a3`
- 表计数：`base=50000, idiom=22192, domain=25, routing=9`

---

## 4. 数据库调号验收

| 表 | 总行数 | 带数字调号 | 与 plain 相同 | 通过率 |
|----|--------|------------|---------------|--------|
| `base_lexicon` | 50,000 | 50,000 | 0 | 100% |
| `idiom_lexicon` | 22,192 | 22,192 | 0 | 100% |
| `domain_lexicon` | 25 | 25 | 0 | 100% |

抽样：

| 词 | pinyin_key | tone_pinyin_key |
|----|------------|-----------------|
| 中杯 | `zhong\|bei` | `zhong1\|bei1` |
| 美式 | `mei\|shi` | `mei3\|shi4` |
| 我们 | `wo\|men` | `wo3\|men5` |
| 精神文明 | `jing\|shen\|wen\|ming` | `jing1\|shen2\|wen2\|ming2` |

**结论：** 三张词条表 100% 含数字调号；`all_tables_pass: true`。

---

## 5. 架构说明

- **内容 SSOT：** 各 layer `entries.jsonl`（显式 `tonePinyinKey`）
- **物化链路：** `parse-rows` → `buildCanonicalRecord` → `resolveTonePinyinKey`（优先 `tonePinyinKeyField`）
- **运行时：** `lexicon-runtime-v2.ts` 只读 `tone_pinyin_key`，无需改动
- **common5：** 897 条仍在 shadow build 被拒绝（`common5_deferred`），与冻结策略一致

---

## 6. 已知限制 / 后续

1. `lexicon:prepare:v3-runtime --force` 未生效（`cli-args.mjs` 未解析 `force`），需手动删目录或补 CLI。
2. `build-lexicon-v2-shadow.mjs` 默认输入仍为 `defaultSeedPath()`（10k），生产构建须显式 `--input` 指向 p1_3 资产。
3. 词库调号已就绪；FW **apply=0** 仍为 ASR/span 链路问题，非词库缺失（见测试报告）。

---

## 7. 相关数据文件

- `tests/experiments/lexicon-tone-db-audit.json`
- `tests/lexicon-tone-dialog200-batch-result.json`
- `tests/experiments/lexicon-tone-dialog200-quality-perf.json`
