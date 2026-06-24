# Alias Ownership Contract — FROZEN V1.0.0

**状态：** FROZEN（设计约束 · SSOT）  
**日期：** 2026-06-24  
**范围：** Lexicon Patch · Seed · Runtime alias 行（`is_alias=1`）  
**门禁：** `npm run lexicon:scan-alias-legality` · `npm run lexicon:patch-build-gate`

---

## 1. 一句话

**Alias 只做实体规范化；ASR 错字恢复归 Pinyin Recall / Tone Recall / Span / KenLM。**

---

## 2. Alias 允许类型（LEGAL）

| alias_type | 说明 | 示例 |
|------------|------|------|
| `TRAD_SIMPLIFIED` | 简繁映射 | 計劃 → 计划；候選 → 候选；機場 → 机场 |
| `EN_ZH_MAPPING` | 中英文对照 | hotel → 酒店；passport → 护照；check in → 入住 |
| `BRAND_PRODUCT` | 品牌 / 产品 / 专有名词 | Uber ↔ 优步；ChatGPT ↔ ChatGPT |
| `ENTITY_WRITING` | 同一实体合法写法 | 望京 SOHO ↔ 望京SOHO；预定 → 预订 |
| `STANDARD_ABBREV` | 正式缩写 | AI ↔ 人工智能；API ↔ 应用程序接口 |

**写入要求：** 每个 alias 必须声明 `alias_type`（Patch `aliasEntries[]` 或 manifest 等价结构）。

---

## 3. Alias 禁止类型（ILLEGAL）

| 违规类型 | 说明 | 示例 |
|----------|------|------|
| `ASR_HOMOPHONE` | ASR 同音字混淆 | 像蔡 → 香菜；告诉 → 高速；钟贝 → 中杯 |
| `ASR_NEAR_PHONE` | ASR 近音字混淆 | 巧可力 → 巧克力；连调 → 联调 |
| `TONE_CONFUSION` | 声调不匹配 ASR 错字 | 少病 → 少冰；大悲 → 大杯；终杯 → 中杯 |
| `PINYIN_RECALL_OWNED` | 拼音召回应负责的映射 | 后选 → 候选；生城 → 生成；计化 → 计划；借口 → 接口 |
| `TEST_ONLY_PATCH` | 测试专用修复词 | Expansion P1.5 批量 ASR alias |
| `PHRASE_ALIAS` | 短语 alias / confusion 行 | `候选生成`、`上线计划`（DENY_LIST） |

---

## 4. 职责冻结

| 层 | 职责 | 示例 |
|----|------|------|
| **Alias** | 实体规范化（§2 五类） | 計劃/计划、hotel/酒店 |
| **Pinyin Recall** | 同音字恢复 | 后选→候选、生城→生成、像蔡→香菜、告诉→高速 |
| **Tone Recall** | 声调恢复 | 少病→少冰、大悲→大杯、终杯→中杯 |
| **Fine Span** | 窗口切分与 span 组装 | — |
| **KenLM** | 句级选择与 Δ 门控 | — |

**禁止：** 将 ASR 错识别 surface 长期存入 `aliases[]` 或 `is_alias=1` 行。

---

## 5. 数据形态

### 5.1 Patch（推荐）

```json
{
  "entry": {
    "word": "计划",
    "aliasEntries": [
      { "alias": "計劃", "alias_type": "TRAD_SIMPLIFIED" },
      { "alias": "計畫", "alias_type": "TRAD_SIMPLIFIED" }
    ]
  }
}
```

### 5.2 禁止形态

```json
{
  "aliases": ["像蔡", "告诉"]
}
```

无 `alias_type` 的裸 `aliases[]` **不得**通过 Patch Build Gate。

### 5.3 Homophone 变体行

`domain_patch` 中 `source=domain_seed_v1_homophone_variant` 的 **独立 word 行** 视为非法 ASR surface，**禁止**新增。

---

## 6. 门禁

| 命令 | 说明 |
|------|------|
| `npm run lexicon:scan-alias-legality -- <patch.json>` | 单 patch alias 合法性 |
| `npm run lexicon:patch-build-gate -- <patch.json> [...]` | 粒度 + alias 联合门禁 |
| `node scripts/lexicon/scan-alias-legality.test.mjs` | 合约单测 |

**Patch Build 流程（冻结）：**

```text
build patch → scan-patch-granularity → scan-alias-legality → apply → gate:v3-runtime
```

---

## 7. 变更策略

| 允许 | 禁止 |
|------|------|
| 合法 alias 数据扩展（带 `alias_type`） | 修改 Recall / KenLM / Span / Tone Recall |
| Cleanup patch 移除非法 alias | 修改 Schema DDL |
| `scan-alias-legality` 规则收紧 | 无 `alias_type` 的新 alias |
| 文档 / gate 更新 | Domain Source / Context Prior 变更 |

---

## 8. 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| V1.0.0 | 2026-06-24 | 初始冻结；配套 `scan-alias-legality.mjs` |

---

## 9. 相关文档

| 文档 | 路径 |
|------|------|
| Lexicon 架构 | [ARCHITECTURE.md](./ARCHITECTURE.md) |
| FW 冻结 | [freeze/FROZEN.md](../fw-detector/freeze/FROZEN.md) |
| Illegal Cleanup | [ILLEGAL_ALIAS_CLEANUP.md](./ILLEGAL_ALIAS_CLEANUP.md) |
| Patch Importer V4 | [PATCH_IMPORTER_V4.md](./PATCH_IMPORTER_V4.md) |
| Storage Pipeline | [STORAGE_PIPELINE.md](./STORAGE_PIPELINE.md) |
| Expansion 词条包 | [LEXICON_EXPANSION_PACKAGE.md](./LEXICON_EXPANSION_PACKAGE.md) |
