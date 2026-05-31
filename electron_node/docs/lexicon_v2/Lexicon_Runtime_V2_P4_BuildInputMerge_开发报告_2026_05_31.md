# Lexicon Runtime V2 — P4 Build 输入合并 + domain_patch 灌库 开发报告

版本：V1.0  
日期：2026-05-31  
**范围：** V2 shadow build 递归读取 `entries.jsonl`（含 `domain_patch_zh_v2`）→ SQLite；P4 主链未改  
**依据：** domain_patch Build 链路审计结论（B：build 未读 patch）

---

## 1. 开发目标

| 目标 | 说明 |
|------|------|
| Build 输入 | `--input` 指向词库资产根目录时，递归读取各 pack 下 `entries.jsonl` |
| 禁止 Runtime 读 JSONL | 仅 build 阶段读 seed；Runtime 仍只加载 `lexicon_v2.sqlite` |
| 不依赖 combined_with_patch | 不再手工合并 `combined_with_domain_patch_entries.jsonl` |
| 不改 P4 主链 | Recall / Sentence Rerank / KenLM / Metadata Gate **无改动** |

---

## 2. 修改文件

| 文件 | 变更 |
|------|------|
| `scripts/lexicon/lib/paths.mjs` | `resolveV2ShadowInputFiles()` 递归 `entries.jsonl`；`defaultV2ShadowSeedPath()` |
| `scripts/lexicon/build-lexicon-v2-shadow.mjs` | 使用新 resolver；日志列出每个 seed 文件；传 `seedInputRels` |
| `scripts/lexicon/lib/build-v2-shadow-bundle.mjs` | manifest/stats 增加 `seed_inputs`；`seed_path` 为资产根目录 |
| `scripts/lexicon/lib/v2-shadow-stats.mjs` | `seed_root` / `seed_inputs` 统计字段 |
| `scripts/lexicon/build-v2-shadow-for-electron.mjs` | **新增** Electron ABI 下执行 build |
| `scripts/lexicon/lib/run-cmd.mjs` | 支持 `env` 覆盖 |
| `scripts/lexicon/lib/resolve-v2-shadow-input.test.mjs` | **新增** 输入解析 + classify 单测 |
| `main/src/lexicon-v2/lexicon-types-v2.ts` | `LexiconManifestV2.seed_inputs?` |
| `package.json` | `lexicon:build:v2-shadow` → electron wrapper；`lexicon:test:v2-shadow-input` |

**未修改：** `lexicon-runtime-v2.ts` 加载逻辑、FW orchestrator、Recall/Rerank 路径

---

## 3. Build 行为

### 3.1 输入解析规则

```text
--input <file.jsonl>     → 单文件（兼容 legacy combined）
--input <asset_root>/   → 递归所有 **/entries.jsonl
                         → 排除 combined_entries.jsonl / rejected.jsonl 等（非 entries 文件名）
```

P1.3 资产根目录默认解析为 4 个文件：

1. `base_zh_v2/entries.jsonl`
2. `common5_zh_v2/entries.jsonl`
3. `domain_patch_zh_v2/entries.jsonl`
4. `idiom_zh_v2/entries.jsonl`

### 3.2 分类（不变）

| lexiconLayer | SQLite 表 |
|--------------|-------------|
| base | base_lexicon |
| idiom | idiom_lexicon |
| domain / domain_patch | domain_lexicon |
| common5 | rejected（common5_deferred） |

### 3.3 Build 命令

```powershell
cd electron_node/electron-node
npm run lexicon:build:v2-shadow
# 或显式：
npm run lexicon:build:v2-shadow -- --input ../docs/lexicon-assets/.../p1_3_lexicon_zh_v2
```

---

## 4. Build 产物验收

**路径：** `node_runtime/lexicon/v2_shadow/`

| 表 | 行数 | 说明 |
|----|------|------|
| base_lexicon | 50,000 | |
| idiom_lexicon | 22,192 | |
| **domain_lexicon** | **25** | 9 canonical + 16 alias |
| industry_routing_lexicon | 9 | |
| rejected | 897 | common5_deferred |

**domain_lexicon 分布：** `restaurant` × 25（canonical 9：中杯、大杯、小杯、美式、拿铁、摩卡、马芬、蓝莓、蓝莓马芬）

**manifest：**

- `schemaVersion`: `lexicon-v2-shadow-v2`
- `seed_path`: 资产根目录
- `seed_inputs`: 上述 4 个 `entries.jsonl`（含 `domain_patch_zh_v2/entries.jsonl`）

**Runtime 启动验证：**

```text
lexiconRuntimeV2.tables: {"base":50000,"idiom":22192,"domain":25,"routing":9}
```

---

## 5. 与 P4 批测的关系

| 项 | 状态 |
|----|------|
| SQLite 含专业词库 | ✅ domain_lexicon=25 |
| P4 批测 `domain_hits` | **仍为 0**（批测 `lexicon_v2_intent_enabled=false`，profile=general → `active_domain=base_only`，不查 domain SQL） |
| P4 apply / CER | 与 domain=0 轮次基本一致（见测试报告） |

**结论：** Build 侧问题已解决；Recall 侧 domain 命中需 Intent/Industry Routing 或 non-general profile（不在本轮 build 范围）。

---

## 6. Target List

| # | Target | 状态 |
|---|--------|------|
| T1 | 递归 `entries.jsonl` | ✅ |
| T2 | domain_patch 进 build | ✅ |
| T3 | manifest `seed_inputs` | ✅ |
| T4 | domain_lexicon > 0 | ✅ 25 行 |
| T5 | restaurant 域 | ✅ |
| T6 | Runtime 只读 SQLite | ✅ |
| T7 | 单测 `resolve-v2-shadow-input` | ✅ PASS |
| T8 | Electron build wrapper | ✅ |

---

## 7. Check List

| # | 检查项 | 结果 |
|---|--------|------|
| C1 | 4 个 entries.jsonl 出现在 build 日志 | ✅ |
| C2 | combined_entries 非必须输入 | ✅ |
| C3 | SQLite domain 行数 | ✅ 25 |
| C4 | manifest seed_inputs 含 patch 路径 | ✅ |
| C5 | Runtime domain count | ✅ 25 |
| C6 | P4 代码未改 | ✅ |
| C7 | `npm run lexicon:test:v2-shadow-input` | ✅ PASS |

---

**开发完成。**
