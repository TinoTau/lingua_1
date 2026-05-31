# Lexicon Runtime V2 — Phase 0 开发说明

**日期：** 2026-05-30  
**状态：** Phase 0 已实现（Shadow Build）  
**推进顺序（冻结）：** Phase 0 → Phase 1 → Phase 2（暂停验证）→ Phase 3 → Phase 4  
**禁止：** 跳过 Phase 2 直接做 Recall V2

---

## 1. 已实现内容

| 项 | 路径 |
|----|------|
| CLI | `npm run lexicon:build:v2-shadow` |
| 入口 | `scripts/lexicon/build-lexicon-v2-shadow.mjs` |
| 分类 | `scripts/lexicon/lib/v2-classify-row.mjs` |
| pinyin_key | `scripts/lexicon/lib/v2-pinyin-key.mjs` |
| Alias 物化 | `scripts/lexicon/lib/v2-materialize-aliases.mjs` |
| Bundle | `scripts/lexicon/lib/build-v2-shadow-bundle.mjs` |
| Stats | `scripts/lexicon/lib/v2-shadow-stats.mjs` |
| 单测 | `scripts/lexicon/lib/v2-classify-row.test.mjs` |

**未改动：** `LexiconRuntime` V1、FW 主链、`node_runtime/lexicon/current`

---

## 2. 输出目录

默认：`{PROJECT_ROOT}/node_runtime/lexicon/v2_shadow/`

| 文件 | 说明 |
|------|------|
| `lexicon_v2.sqlite` | 四表 SQLite |
| `manifest_v2.json` | `schemaVersion: lexicon-v2-shadow-v1` |
| `checksum.txt` | sha256 |
| `stats_v2.json` | 分表统计 + bucket |
| `rejected_v2.jsonl` | 拒绝行 |

---

## 3. 用法

```bash
cd electron_node/electron-node

# 单测
node scripts/lexicon/lib/v2-classify-row.test.mjs

# Shadow build（示例：P1.3 combined）
npm run lexicon:build:v2-shadow -- --input ../docs/lexicon-assets/p1_3_generic_zh_lexicon_v2_fw_domains/p1_3_lexicon_zh_v2/combined_entries.jsonl

# 指定输出目录
npm run lexicon:build:v2-shadow -- --input <seed.jsonl> --output D:/path/to/v2_shadow
```

**ABI 提示：** 若报 `NODE_MODULE_VERSION`，在 `electron-node` 下执行：

```bash
npm rebuild better-sqlite3
```

（与 V1 `lexicon:build` 相同；Electron 启动前仍需 `lexicon:rebuild-sqlite`。）

---

## 4. 分类规则（简要）

1. 优先 `lexiconLayer`：`base` / `idiom` / `domain_patch` / `domain`  
2. `common5` → **拒绝**（`common5_deferred`，待 DEC-1）  
3. 拉丁词 → **拒绝**（`latin_deferred_v1`，Phase 3 前走 V1 exact）  
4. 无 layer 时按字长 + tags/domain 推断  
5. domain 表行 **禁止** `general`  
6. Alias **build 物化** 为同表附加行（`is_alias=1`, `canonical_word`）  
7. `industry_routing_lexicon` 由 **domain  canonical** 自动生成（Phase 0 占位）

---

## 5. P1.3 combined 试跑结果（2026-05-30）

输入：`combined_entries.jsonl`（73089 行）

| 表 | 行数 |
|----|------|
| base_lexicon | 50000 |
| idiom_lexicon | 22192 |
| domain_lexicon | 0 |
| industry_routing | 0 |
| rejected | 897（均为 common5_deferred） |

说明：`combined_entries` 不含 `domain_patch`；domain/routing 需单独 merge patch 后再 build。

---

## 6. 下一步（按整合版暂停点）

| Phase | 内容 | 状态 |
|-------|------|------|
| **P0** | Shadow Build | ✅ 本提交 |
| **P1** | LexiconRuntimeV2 + SQL + LRU + flag | 待开发 |
| **P2** | LexiconSessionIntent + topicKeywords | 待开发；**Recall 仍 V1** |
| — | **暂停验证** | alias/idiom/common5/routing 决策 + Phase 2 可观测 |
| **P3** | `local-span-recall.ts` V2 | **禁止**在 P2 完成前启动 |
| **P4** | industry_routing 定域 | 最后 |

---

## 7. 参考文档

- [Lexicon_Runtime_V2_实施方案_补充整合版_2026_05_30.md](./Lexicon_Runtime_V2_实施方案_补充整合版_2026_05_30.md)
- [Lexicon_Runtime_V2_实施方案_补充约束清单_2026_05_30.md](./Lexicon_Runtime_V2_实施方案_补充约束清单_2026_05_30.md)
- [Lexicon_Runtime_V2_开发前只读代码审计报告_2026_05_30.md](./Lexicon_Runtime_V2_开发前只读代码审计报告_2026_05_30.md)
