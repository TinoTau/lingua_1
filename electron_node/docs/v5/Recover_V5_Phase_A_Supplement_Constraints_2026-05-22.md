# Recover V5 Phase A — 代码补充说明与实施约束

**对应方案**：[Recover_V5_Phase_A_Scored_Lexicon_Data_Foundation_2026-05-22.md](./Recover_V5_Phase_A_Scored_Lexicon_Data_Foundation_2026-05-22.md)  
**冻结决策**：[Recover_V5_Frozen_Decisions_2026-05-22.md](./Recover_V5_Frozen_Decisions_2026-05-22.md)（D-04、D-05）  
**日期**：2026-05-22  
**性质**：基于当前仓库只读代码的 Phase A 落地约束（非方案正文重复）

---

## 0. 已确认决策（实施必须遵守）

| 决策 | 对本 Phase 的要求 |
|------|-------------------|
| **D-04** | priorScore **仅**来自 build/运营；runtime **禁止** `priorScoreFromFrequency` 进索引 |
| **D-05** | 英文 token 入库须带显式 lookup pinyin；manifest `mixed_token_count` |

---

## 1. 当前代码基线（必须知晓）

### 1.1 运行时类型（`hotword-types.ts`）

```typescript
HotwordEntry = { id, word, pinyin: string[], frequency, domain?, enabled }
```

- **无** `priorScore`、`tags` 字段
- `WindowCandidate.source`：`hotword | exact | confusion_evidence | fuzzy_observed`（Phase C 才引入 `lexicon_pinyin_topk`）

### 1.2 priorScore 推导（非运营分）

- `pinyin-index.ts`：`priorScoreFromFrequency(frequency) = log1p(max(1, frequency))`
- `hotword-recall.ts` `toHit()` 一律调用上述函数
- **约束**：Phase A 完成前，任何「无 prior 不进 TopK」逻辑只能加在 **loader/索引构建**，不得改 `hotword-recall` 主路径（方案要求 Phase A 不改 recall）

### 1.3 SQLite 表结构（`build-lexicon-bundle.mjs` L199–206）

```sql
lexicon_terms (id, word, pinyin TEXT, frequency, domain, enabled)
-- 无 prior_score、tags 列
```

### 1.4 Manifest（`build-lexicon-bundle.mjs` L287–296）

当前字段：

```json
{
  "version": "recover-v2-hotword-seed-v1",
  "checksum", "createdAt", "backend", "bundle_tag",
  "hotword_count", "confusion_count", "seed_path"
}
```

**无** `scored_lexicon_version`、`terms_without_prior_count` 等 V5 统计。

### 1.5 Runtime 加载（`lexicon-runtime.ts`）

| 行为 | 实现 |
|------|------|
| Bundle 路径 | `PROJECT_ROOT/node_runtime/lexicon/current` 或 `LEXICON_BUNDLE_PATH` |
| 无 PROJECT_ROOT | `status: error`，不静默降级 |
| pinyin 解析 | `parsePinyinField`：空格/`,`/`/` 分词，normalize 为 `[a-z0-9]` |
| pinyin 回退 | 无 DB pinyin 时 `textToSyllables(word)`（CJK 用 `pinyin-pro`） |
| 索引 | `buildHotwordPinyinIndex`：仅 `enabled` 且非空 word；桶内按 **frequency DESC** |
| confusion | 表 `lexicon_confusions(observed → hotword_id)`，Phase A **保留**（C 阶段再降级主路径） |

### 1.6 构建脚本约束（`build-lexicon-bundle.mjs`）

| 常量/规则 | 值 | V5 影响 |
|-----------|-----|---------|
| `MAX_WORD_LEN` | 8 | Phase A 可保留入库 8 字，Phase B 窗长仍限 2–5 |
| `frequencyFromPriority` | 10→100, 5→50, 默认→10 | 可作 **initial priorScore** 迁移公式，须写入 manifest 说明 |
| seed 无 pinyin | hotword **跳过**（warning） | 与 V5「pinyin 必填」一致 |
| sqlite 占用 | EBUSY 抛错 | 构建前须关 Electron 节点 |

### 1.7 环境变量（不可破坏）

- `PROJECT_ROOT`：runtime + `prepare-recover-test.mjs` + 批测
- `LEXICON_BUNDLE_PATH`：覆盖 bundle 目录
- 默认数据：`electron-node/data/lexicon/zh_asr_confusions_seed_high_quality.jsonl`

---

## 2. Phase A 必须补充的实现项

### 2.1 Schema 迁移（P0）

| 项 | 动作 |
|----|------|
| SQLite | `ALTER`/重建：`prior_score REAL NOT NULL`、`tags TEXT`（JSON 数组字符串） |
| `HotwordEntry` | 增加 `priorScore: number`、`tags?: string[]` |
| `LexiconManifest`（`lexicon-types.ts`） | 扩展 V5 统计字段；**保持** `version`/`checksum` 校验逻辑 |

**约束**：`readManifest` + `verifySqliteChecksum`（`lexicon-manifest.ts`）必须仍通过；改 manifest 需同步 `checksum.txt`。

### 2.2 priorScore 规则（冻结）

1. **构建时**：seed 有 `priorScore` 用之；仅有 `priority`/`frequency` 时生成 `initial_prior_score` 并写入 manifest 字段 `prior_score_migration: "frequency_log1p_v1"`。
2. **运行时**：`mapHotwordRow` 读 `prior_score`；若 NULL → **不进入** `buildHotwordPinyinIndex`（计数 `terms_without_prior_skipped`）。
3. **禁止**：runtime 再调用 `priorScoreFromFrequency` 作为 TopK 依据（可保留为迁移脚本专用，标记 `@deprecated`）。

### 2.3 enabled 与索引

- 当前已跳过 `!entry.enabled`（`pinyin-index.ts` L16–17）— **保持**
- Phase A 单测须断言：disabled 词不在 `getPinyinIndexSize()` 桶内

### 2.4 tags / domain

- `domain` 已入库；Phase A 只存不用于打分（打分在 Phase C `domainBoost`）
- `tags`：JSON 数组；构建时校验为 string[]

### 2.5 中英混合 token（Phase A 仅数据层）

| 现状 | 补充 |
|------|------|
| `textToSyllables` 对无 CJK 返回 `[]` | 词条 **必须** 在 jsonl/sqlite 提供显式 `pinyin`（如 `ei ai`、`di diu pu`） |
| `isValidHotwordWord` 仅检查长度 1–8 | 允许纯 ASCII 词（如 `GPU`）入库 |
| manifest | 增加 `mixed_token_count`（word 匹配 `/[A-Za-z]/` 且无 CJK） |

**约束**：Phase A **不**改 `enumerate-asr-windows` / 窗枚举（无 CJK 仍不产生窗）。

### 2.6 confusion 表（Phase A 保留）

- `lexicon_confusions` 与 seed 迁移逻辑 **不要删除**
- Phase C 才 feature-flag 主召回；Phase A 构建脚本仍输出 confusions.jsonl

---

## 3. 与后续 Phase 的接口契约（Phase A 必须预留）

| 出口 | 供 Phase B/C 使用 |
|------|-------------------|
| `HotwordEntry.priorScore` | `candidate-score.ts` 的 prior 项 |
| `HotwordEntry.pinyin[]` | `lookupTopKByPinyin` 的 key（`syllablesKey`） |
| `LexiconManifest.terms_with_prior_count` | 批测 gate：= enabled_term_count |
| `RecoverQualityConfig` stub | 见下节 |

### 3.1 qualityConfig stub（Phase A 允许）

在 `RecoverQualityConfig`（`quality-config.ts`）**仅新增可选字段默认值**，不接入 recall：

```typescript
// Phase A stub — 默认值冻结，Phase B/C/D 接线
allowedWindowLengths?: number[];      // default [2,3,4,5]
diffContextLeft?: number;               // default 2
diffContextRight?: number;            // default 2
topKByTermLength?: Record<string, number>;
maxActiveWindows?: number;            // default 2
minCandidateScore?: number;           // default 0
kenlmBaselineTolerance?: number;      // default 0
```

`result-builder.ts` 已输出 `qualityConfig: getRecoverQualityConfig()` — 扩展类型即可生效。

---

## 4. 实施约束（禁止项）

| ID | 约束 |
|----|------|
| A-C1 | Phase A **不得**修改 `window-recall.ts`、`hotword-recall.ts` 召回顺序 |
| A-C2 | Phase A **不得**修改 `sentence-repair-step.ts`、`rerank.ts` |
| A-C3 | Phase A **不得**将 `RECOVER_CONTRACT_VERSION` 改为 v5（属 Phase E） |
| A-C4 | 构建失败不得写半成品 sqlite 到 `current`（保持 tmp + rename） |
| A-C5 | 兼容旧 bundle：若 sqlite 无 `prior_score` 列，runtime `status: error` 并提示 rebuild（**禁止**静默 frequency 推导进索引） |
| A-C6 | `hotwords.jsonl` / `confusions.jsonl` 字段扩展须向后兼容旧行（新字段可选，构建脚本必填 prior） |

---

## 5. 文件级修改清单

| 文件 | 变更 |
|------|------|
| `electron-node/scripts/build-lexicon-bundle.mjs` | schema、prior 校验、manifest 统计、mixed_token_count |
| `main/src/lexicon/hotword-types.ts` | priorScore、tags |
| `main/src/lexicon/lexicon-types.ts` | LexiconManifest 扩展 |
| `main/src/lexicon/lexicon-runtime.ts` | mapHotwordRow、索引排除无 prior |
| `main/src/lexicon/pinyin-index.ts` | 桶排序改为 priorScore DESC（仍 Phase A 可只做索引侧） |
| `main/src/recover-quality/quality-config.ts` | V5 stub 字段 |
| `main/src/node-config-types.ts` | lexiconRecall 下可选 V5 字段 |
| `main/src/lexicon/lexicon-runtime.test.ts` | prior 必填、enabled、mixed token |
| **新建** `main/src/lexicon/scored-lexicon-manifest.test.ts` | manifest 统计验收 |

---

## 6. 测试与验收（对齐现有 harness）

| 命令 | 用途 |
|------|------|
| `npm run build:lexicon-bundle` | 构建 bundle |
| `npm run init:lexicon-bundle` | 转发 build（deprecated 别名） |
| `npx jest lexicon-runtime.test.ts pinyin-index.test.ts` | runtime 单测 |
| `node tests/run-dialog-200-batch.js`（可选） | Phase A 仅要求 **不崩**、契约仍为 historical-restore-v1 |

**Pass 条件**：

```text
terms_without_prior_count = 0
enabled_term_count > 0
manifest.scored_lexicon_version = "v5"
现有 lexicon-runtime.test.ts 全绿
```

---

## 7. 风险与决策点

| 风险 | 处理 |
|------|------|
| 全量 seed 无 priorScore | 构建脚本用 frequency 生成 initial prior，manifest 标注迁移版本 |
| 旧节点缓存 sqlite | 文档要求 `npm run build:lexicon-bundle` + 重启节点 |
| `priorScoreFromFrequency` 删除破坏旧测试 | Phase A 保留函数但标记 deprecated，索引不用 |

---

## 8. 依赖关系

```text
Phase A 完成 → Phase B（diff 窗仍用 syllables/textToSyllables）
             → Phase C（TopK 依赖 priorScore + pinyin 索引）
```

Phase B/C **不得**在 Phase A manifest 未达标时启动 TopK 主路径。
