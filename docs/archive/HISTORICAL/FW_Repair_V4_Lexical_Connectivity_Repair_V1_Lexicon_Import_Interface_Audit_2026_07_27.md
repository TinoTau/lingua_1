<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: CURRENT SSOT + Acceptance Records
Archive Path: docs/archive/HISTORICAL/FW_Repair_V4_Lexical_Connectivity_Repair_V1_Lexicon_Import_Interface_Audit_2026_07_27.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: CURRENT SSOT + Acceptance Records

# FW Repair V4 — Lexical Connectivity Repair V1 · Lexicon Import Interface Audit

| Field | Value |
|-------|-------|
| Date | 2026-07-27 |
| Nature | **Lexicon Import Interface Audit + Single-Character / Spoken Connector Patch Readiness**（只读） |
| Authority | 实际代码 / 现有 Patch V4 合约 / Schema V2 build / operational `node_runtime/lexicon/v3` / LexicalEdge Quality Audit |
| Code / SQLite / Bundle / Contract 修改 | **无** |

---

## 1. Executive Summary

当前词库导入存在 **三代能力并存**：

| 链路 | 入口 | 对连通性补丁的可用性 |
|------|------|----------------------|
| **Patch Importer V4**（推荐增量） | `npm run lexicon:patch:import:electron` | 多领域追加、prior/source 修正、2–5 字 addTerm **可用** |
| **Full Build V2 Shadow** | `lexicon:build:v2-shadow` → `prepare:v3-runtime` | 2–3 字 **base** 可用；**显式拒绝单字** |
| **Patch V3**（遗留） | `lexicon:patch:apply*` | 覆盖式 tags；**不应**再用于本轮补丁 |

对计划补充的 A–E 组：

| Group | 目标 | 导入接口结论 |
|-------|------|--------------|
| A 功能单字 | base 单字 | **未就绪**（见阻塞） |
| B 业务连接单字 | 同上 | **未就绪** |
| C 2–3 字口语连接词 | canonical / base | **条件就绪**（Full Build base 或 V4+domain） |
| D canonical prior/source 修正 | 如「麻烦」 | **就绪**（`updateTermFields`） |
| E 一词多领域 | append tags | **就绪**（`appendDomainTags` + MAX merge） |

`length(word)=1 = 0` 的主因是 **种子从未包含单字（A）**；Full Build 另有 **主动拒绝单字（B）**；即便强行写入，**Recall 仍拒绝 length&lt;2 窗口（运行时阻塞）**。

---

## 2. Final Verdict

```text
LEXICON IMPORT INTERFACE: CONDITIONAL

MINIMAL IMPORT FIX REQUIRED BEFORE PATCH
```

### 阻塞（生成 / 导入 Group A/B 单字补丁前必须解决）

| # | 阻塞文件 | 阻塞函数 / 规则 | 错误数据行为 | 最小修复范围 | 影响现有词库？ |
|---|----------|-----------------|--------------|--------------|----------------|
| 1 | `scripts/lexicon/lib/v2-classify-row.mjs` | `classifyLexiconV2Row` → `one_char` / `base_len_invalid` | Full Build **拒绝**全部 1 字 | 允许受控 1 字进入 **base** tier（白名单，非全汉字） | 仅 rebuild 后生效；不改旧行 |
| 2 | `main/src/lexicon-patch-v4/patch-validator-v4.ts` + `sqlite-applier-v4.ts` | `validateDomainTags` **强制**非空；`addTerm` `tier='domain'`；`rematerializeTerm` **要求** tags | 无法导入「无 domain 的 base 单字」；只能绑细领域 → 违背「单字不绑 domain」 | 新增明确的 base 写入路径（空 tags→`base_lexicon`），或文档化唯一合法 workaround | 新 op 不影响旧数据 |
| 3 | `main/src/lexicon-v2/recall-span-topk-v2.ts`（及 `local-span-recall.ts` `MIN_SYLLABLES=2`） | `syllables.length < 2` → 空 hits | **即使入库，单字 Window 永不召回** | 允许 length=1 走 `base_lexicon` 查询 | 行为变更；需回归；**非本轮可改，但是连通性前置** |

### 不阻塞（可先做）

```text
Group D — updateTermFields（麻烦 prior/source）
Group E — appendDomainTags（订单等多领域）
Group C — 2–3 字：优先 Full Build base seed；或 V4 addTerm + 真实细领域
```

**禁止**本轮直接导入任何词条。**禁止**用「把所有单字绑到全部细领域」或「降低全局 minPrior」作为主方案。

---

## 3. Current Import Architecture

```text
[增量推荐]
Patch JSON (lexicon-patch-v4)
  → parse / hash / schema validate
  → Pre Gate (granularity + alias + append-semantics)
  → applyLexiconPatchToSqliteV4  (transaction)
       → term INSERT / UPDATE
       → term_domain_tags UPSERT (MAX weight) 或 DELETE+INSERT (dangerous)
       → rematerializeTerm → domain_lexicon / routing / ngrams
  → writeBundleManifestsAfterPatch
  → runtime gate
  → optional source-jsonl sync
  → reports/lexicon-import/<patchId>_*.json

[全量重建]
Seed JSONL (多文件)
  → parse-rows / validate-seed / v2-classify-row
  → term-ssot-build + tier writers
  → build-v2-shadow-bundle → node_runtime/lexicon/v2_shadow
  → prepare:v3-runtime → node_runtime/lexicon/v3   ← operational SSOT
  → gate:v3-runtime
  → LexiconRuntimeV2.loadFromBundleDir
```

运行时召回读：`base_lexicon` + `idiom_lexicon` + `domain_lexicon`(按 fine domain) + `term_pinyin_ngrams`；**不是**直接扫 `term` 表做 span hit（`term`/`term_domain_tags` 是 Schema V2 SSOT，经物化供 domain 路径使用）。

---

## 4. Import Entry Points

| # | 项 | 路径 | 函数 / 符号 | 调用关系 | 输入 | 输出 |
|---|----|------|-------------|----------|------|------|
| 1 | 标准 Patch 格式 | `…/industry_pack_v2/patches/*.patch.json`；类型 `patch-types-v4.ts` | `LexiconPatchV4` / `PatchOperationV4` | Importer 读取 | JSON | operations[] |
| 2 | 导入命令 | `electron_node/electron-node/package.json` | `lexicon:patch:import:electron` | CLI → importer | patch 路径 | report |
| 3 | 主入口 | `scripts/lexicon/lexicon-patch-import-v4-for-electron.mjs` → `lib/run-lexicon-patch-import-v4.mjs` | `runLexiconPatchImportV4`（9 步） | npm script | argv | status/report |
| 4 | Parser | `patch-io-v4`（dist）/ seed: `lib/parse-rows.mjs` | `loadLexiconPatchV4FromFile` / `parseSeedRow` | Importer / build | file | patch/rows |
| 5 | Validator | `patch-validator-v4.ts`；seed: `validate-seed.mjs` | `validateLexiconPatchV4` | step 3 | patch+manifest | error\|null |
| 6 | Normalizer | `pinyin-resolve.ts`；`lib/normalize.mjs`；`v2-pinyin-key.mjs` | `resolvePinyinKey` / `resolveTonePinyinKey` | apply / build | word+pinyin | `a\|b` keys |
| 7 | Term upsert | `sqlite-applier-v4.ts` `applyOne`/`addTerm`；V3: `sqlite-patch-applier.ts` | INSERT（V4 先碰撞检测） | transaction | op | term row |
| 8 | tags 写入 | `sqlite-applier-v4.ts` `UPSERT_TAG_SQL` / `appendDomainTagsForTerm` | ON CONFLICT MAX(weight) | addTerm/append | tags | term_domain_tags |
| 9 | Domain 解析 | `profile-registry.ts` `assertRegistryDomain`；hierarchy: `buildHierarchyRowsFromRegistry` | whitelist + parent | validate/build | domain_id | ok/null |
| 10 | SQLite rebuild | `lib/build-v2-shadow-bundle.mjs` `writeSqliteBundle` | tmp+rename | seed | v2_shadow sqlite |
| 11 | Manifest | `lexicon-patch-v3/manifest-writer.ts` `writeBundleManifestsAfterPatch` | apply 后 | db+patch | manifest/stats/checksum |
| 12 | Publish 路径 | `prepare-lexicon-v3-runtime-from-shadow.mjs` | `node_runtime/lexicon/v3/` | prepare | shadow | operational bundle |
| 13 | 回滚 | 文档 `PATCH_IMPORTER_V4.md` §6；`_backup_manifest_migration/` | **人工**整目录还原 / 反向 patch / 全量重建 | — | — |
| 14 | 验收测试 | `test:lexicon-patch-v4-e2e`；`lexicon:gate:v3-runtime`；alias/granularity gates | runners | patch/bundle | PASS/FAIL |

Seed（非 Patch）校验入口：`npm run lexicon:validate` → `validate-lexicon-seed.mjs`。

---

## 5. Accepted File Format

**正式增量补丁：唯一推荐 `JSON`，`patchSchemaVersion: "lexicon-patch-v4"`。**

不是用户草稿里的裸 `{ word, pinyin, is_base, … }` 对象数组。

真实最小 `addTerm` 样例（来自现网 patch，字段名以代码为准）：

```json
{
  "patchId": "example-connectivity-spoken-v1",
  "patchSchemaVersion": "lexicon-patch-v4",
  "baseVersion": 10,
  "nextVersion": 11,
  "hash": "sha256:…",
  "operations": [
    {
      "op": "addTerm",
      "word": "请问",
      "pinyin": "qing wen",
      "tone_pinyin_key": "qing3|wen4",
      "domain_tags": ["coffee"],
      "domain_weights": { "coffee": 1 },
      "prior_score": 0.85,
      "repair_target": true,
      "enabled": true,
      "source": "connectivity_spoken_v1"
    }
  ]
}
```

Full Build seed JSONL（`lexiconLayer: "base"`）用于无 domain 的 2–3 字 base，见 §21。

**不存在**标准 CSV / 裸 SQL patch 输入。

---

## 6. Field Contract

### Patch V4 `addTerm`（真实）

| 字段 | 必填？ | 说明 |
|------|--------|------|
| `op` | 是 | `"addTerm"` |
| `word` | 是 | CJK；上限 **5** 个汉字（`MAX_EXPANSION_CJK_LEN`）；**无最小长度** |
| `pinyin_key` 或 `pinyin` | 是（二选一） | 见 §14 |
| `domain_tags` | **是，且 length≥1** | 必须全部通过 `assertRegistryDomain` |
| `domain_weights` | 否 | key ⊆ tags；缺省 weight=1.0 |
| `prior_score` | 否 | 默认 **0.85**；若给则必须 **>0** |
| `tone_pinyin_key` / `pinyin` 推调 | 否 | 可自动从 word/pinyin 推导 |
| `source` | 否 | 默认 `"patch-v4"` |
| `enabled` | 否 | 默认 true |
| `repair_target` | 否 | 默认 false |
| `term_id` | 否 | 显式 id；碰撞则失败 |

### 用户草稿字段对照（不得当作既定格式）

| 草稿字段 | 真实状态 |
|----------|----------|
| `pinyin` | ✅ 支持（空格分音节） |
| `prior` | ❌ 应为 `prior_score` |
| `is_base` | ❌ **不存在** |
| `domain_tags: []` | ❌ **非法**（`missing_domain_tags`） |
| `source: "canonical"` | ⚠️ 非枚举强制；字符串自由，但勿用 `*homophone_variant*` |

### 非法值（会 FAIL）

```text
空 domain_tags
registry 外 domain
word CJK 长度 > 5
denylist 词（EXPANSION_DENY_LIST）
prior_score ≤ 0
hash / baseVersion 不匹配
addTerm 撞 (word,pinyin_key) 或 term_id
replaceDomainTagsDangerous 无 dangerous:true + reason
```

---

## 7. Single-Character Support

| 检查点 | 结论 | 证据 |
|--------|------|------|
| 1. V4 parser 允许 length=1 | **是** | `validateGranularity` 仅上限 |
| 2. V4 validator 拒绝单字 | **否** | 无 min length |
| 3. Full Build normalization 丢弃 | **分类器拒绝** | `v2-classify-row.mjs` `one_char` / `base` 要求 2–3 |
| 4. dedupe 视单字无效 | Full Build：reject；V4：按正常 term | — |
| 5. SQLite schema 允许 | **是** | `term.word TEXT`；`base_lexicon.word TEXT` 无 CHECK |
| 6. Recall 查询单字 | **否** | `recall-span-topk-v2.ts:255` `syllables.length < 2`；`local-span-recall` `MIN_SYLLABLES=2` |
| 7. build 过滤单字 | Full Build：**是** | `one_char` |
| 8. manifest 统计单字 | 有 `rejectStats.one_char`；现网历史为 **0** | 说明种子未含单字 |

### 为何 operational `length(word)=1 = 0`？

```text
主因 A. 输入数据从未包含单字
     （rejectStats.one_char = 0 → 过滤器未“杀光”种子，而是根本没有候选）

辅因 B. parser/validator（Full Build）主动拒绝
     （若未来 seed 加入单字，仍会被 one_char / base_len_invalid 挡下）

非主因 C/D/E. rebuild/publish 丢失 / 旧策略清空 — 无证据表明曾有单字后被抹掉
```

**最终归类：A（主）+ B（Full Build 硬闸）+ Recall length&lt;2（即使导入也无效）。**

---

## 8. Spoken-Term Support（2–3 字）

目标词：我想 / 请问 / 谢谢 / 帮我 / 可以 / 麻烦 / 一下 / 有没有 / 怎么 / 这里 / 那里 / 这个 / 那个

| 问题 | 结论 |
|------|------|
| 普通口语禁止入库？ | **无**此类硬过滤（仅 denylist 短语与粒度上限） |
| 必须绑定 domain？ | **V4 addTerm：必须**；**Full Build base layer：否** |
| 允许作为 base？ | Full Build `lexiconLayer:"base"` + 无细领域 → `base_lexicon` |
| source 默认变 variant？ | V4 默认 `patch-v4`；seed 仅当 source **包含** `homophone_variant` 才 prior=0.35 |
| prior 默认过低？ | 默认 **0.85** ≥ minPrior 0.5；显式低 prior 才会被滤 |

「麻烦」现状见 §9（不是“口语禁止”，而是 **错误 variant 行 + 缺 canonical**）。

---

## 9. Canonical / Variant Semantics

| 概念 | 真实职责 |
|------|----------|
| `term` 行 | Schema V2 词条 SSOT；`source`/`prior_score`/`tier` |
| `homophone_variant` | **不是**独立表；出现在 `source` 字符串中；seed 默认 prior **0.35**；Alias Contract **禁止新增**此类独立 word 行 |
| `alias` | 合法 `alias_type` 枚举；经 `addLegalAlias` / 物化 `domain_lexicon.is_alias=1`；非法 ASR 谐音不得作独立 term |
| `confusion` | Full Build **直接 reject**（`confusion_row`） |
| `prior` | `term.prior_score`；Recall 再与 `minPrior` 比较 |

### 「麻烦」根因判定

```text
HOMOPHONE_VARIANT_WORDS 含「麻烦」（expansion-v1_1/terms-manifest.cjs）
种子侧「马芬」aliases 曾含「麻烦」（把口语词当 ASR 表面）
operational term 仅见 prior=0.35 / source=*homophone_variant*

判定：
  缺少 canonical term（正确口语「麻烦」高 prior）
+ 源数据错误（把「麻烦」当马芬谐音独立行）
+ cleanup 主要删 domain_lexicon 行，未建立正确 canonical
≠ 单纯 upsert 覆盖（无第二高 prior 行可被覆盖的证据）
```

修复应使用 **`updateTermFields`**（已存在 term）抬升 `prior_score`、改正 `source`；**不要**再 `addTerm` 撞车；**不要**再标 `homophone_variant`。

---

## 10. Prior / minPrior Semantics

| 角色 | 值 |
|------|-----|
| 运行时门控 | `fwConfig.minPrior = 0.5` |
| V4 默认 prior | `DEFAULT_PRIOR_SCORE_V4 = 0.85` |
| Seed 默认 | 0.85；source 含 `homophone_variant` → 0.35 |
| Patch 更新 | `updateTermFields.fields.prior_score` → **overwrite** |
| 同 word 多来源 | 碰撞键 `(word,pinyin_key)`；V4 addTerm **拒绝**第二行；Full Build `Math.max(prior)` 合并 |
| Recall 使用 | 命中行自身 `priorScore`，再 `>= minPrior` |

**优先通过 canonical 数据修正（抬 prior / 改正 source），不得建议降低全局 minPrior。**

---

## 11. Base / Domain Model

| 存储 | 含义 |
|------|------|
| `base_lexicon` | 通用 2–3 字（及未来若开放的单字）tier；**Recall 不依赖 domain scope** |
| `idiom_lexicon` | 4 字成语 |
| `term` + `term_domain_tags` | Schema V2 SSOT；多对多 |
| `domain_lexicon` | **物化层**（非 SSOT）；按 domain_id 召回 |
| `domain_hierarchy` | 粗→细；来自 `profile-registry.json` 的 `parent`；**patch 不得改** |
| `domain_aliases` | **代码中不存在该表**；勿新增 |

```text
一个 term 可以有多个 term_domain_tags（多对多）✅
V4 addTerm 不能表示「纯 base、零 domain」❌（强制 tags + rematerialize 要求 tags）
「同时是 base + 多 domain」：数据模型上 base 表与 term 表并行，不是同一行的两个 flag
```

粗领域：registry `parent`（如 restaurant）；细领域：registry `id`（coffee…）；`general` **不进入** Recall fine scope。

---

## 12. Multi-Domain Insert Semantics（最高优先级）

### 正确路径（V4）

```text
addTerm + domain_tags:[A,B]
  → 逐 tag INSERT … ON CONFLICT DO UPDATE SET weight=MAX(...)

后续 patch:
appendDomainTags + domain_tags:[C,D]
  → 同样 UPSERT MAX → 保留 A,B，追加 C,D
```

### 禁止路径

```text
replaceDomainTagsDangerous → DELETE 全部 tags 再插入（需 dangerous+reason）
V3 replaceTermTags → 覆盖式（本轮不要用）
term.domain_id 单列 — schema 中不存在
```

### 审计问题对照

| 问题 | 答案 |
|------|------|
| 1. tags 逐项插入？ | ✅ |
| 2. INSERT OR REPLACE 覆盖旧标签？ | append：**否**（MAX upsert） |
| 3. 先 DELETE 旧标签？ | 仅 dangerous / updateDomainWeights 权重重写路径 |
| 4. 重复导入幂等？ | 同 patch_id：history 防重；同 tag：weight MAX 幂等 |
| 5. 只加新领域保留旧？ | ✅ `appendDomainTags` |
| 6. 同 patch 重复词？ | 两个 `addTerm` 同 (word,py) → **第二失败**；应 1×addTerm 含全部 tags，或 add+append |
| 7. 多文件重复词？ | 第二文件必须用 `appendDomainTags`，不能再 `addTerm` |

**两次导入（restaurant,coffee）再（hotel,transport）→ 最终四域：语义上已由冻结 SQL 保证**；须用两次 `append`/`add+append`，不可第二次 `addTerm`。

---

## 13. Duplicate / Upsert Semantics

| 场景 | 行为 |
|------|------|
| 同 word + 同 pinyin_key | `term_already_exists`（V4 addTerm） |
| 同 word + 不同 pinyin_key | **允许共存**；后续按 word 解析须带 `term_id` |
| 同 word + 不同 source | 仍按 (word,pinyin_key) 碰撞；应用 `updateTermFields` 改 source |
| UNIQUE | `term.id` PK；`UNIQUE(word,pinyin_key)`；`term_domain_tags(term_id,domain_id)` PK |
| prior 修正 | UPDATE 字段；**不删** Candidate/Evidence（运行时非持久化到词库） |

---

## 14. Pinyin / Tone Format

| 输入 | 支持？ | 归一结果 |
|------|--------|----------|
| `pinyin: "wo3"` / `"qing wen"` | ✅ | 分音节 → `pinyin_key` 用 `\|` 连接 |
| `pinyin_key: "qing\|wen"` | ✅ 优先 | 原样 trim |
| `tone_pinyin_key: "qing3\|wen4"` | ✅ | 存 tone 列 |
| `wǒ` 声调符 | 依赖 `pinyin-pro` / normalize | **补丁请勿依赖**；写数字调 |
| JSON array | ❌ 非字段格式 | — |
| 空格 / `,` `/` `\|` 分隔 | ✅（`split(/[\s,/|]+/)`） | — |

**后续补丁唯一标准：**

```text
pinyin: "qing wen"          // 无调、空格分音节
tone_pinyin_key: "qing3|wen4"  // 数字调 + |
prior_score: 0.85
```

多音字：同 word 不同 `pinyin_key` 分行。轻声用 `5` 或库内既有约定；`ü` 按现有 `normalizeSyllable`（补丁侧写 `lv`/`ü` 前先 dry-run 验证）。

---

## 15. Length Rules

| 规则 | 存在位置 | 行为 |
|------|----------|------|
| 1 字禁止 | Full Build `v2-classify-row` | reject `one_char` / base_len |
| 1 字禁止 | V4 | **无** |
| 4–5 字 | Full Build domain 2–5；idiom=4 | 分类接受/拒绝 |
| >5 字 | V4 `MAX_EXPANSION_CJK_LEN=5` | reject |
| 运营「主要 2–3 字」 | **文档 / 人工流程** | 非 V4 硬编码「禁单字」 |

**不得把运营规则错误硬编码成“禁止所有单字”之后又期望 Lattice length-1 连通——当前 Full Build 已硬编码禁单字，与连通性目标冲突。**

---

## 16. Source Enum

代码中 **无封闭枚举**；`source` 为自由字符串。

约定（后续补丁）：

| 用途 | 推荐 source |
|------|-------------|
| 单字 / 功能词（待接口修复后） | `connectivity_base_char_v1` |
| 口语连接词 | `connectivity_spoken_v1` |
| prior 修正 | `connectivity_canonical_fix_v1` |
| 多领域通用词 | `connectivity_multidomain_v1` |

**禁止：** `*homophone_variant*`、把正常词写成 variant。

历史可见：`industry_pack_v2`、`domain_seed_v1`、`patch-v4` 等。

---

## 17. Transaction / Rollback

| 项 | 行为 |
|----|------|
| V4 apply | `db.transaction(() => { for ops…; history insert })` → **全量原子** |
| 单条失败 | 抛 `PatchApplyErrorV4` → **整批回滚** |
| 非法 domain | validate 阶段 FAIL，不 apply |
| 静默跳过 | **无**（碰撞/校验显式失败） |
| 自动备份 operational | **无**；依赖人工 snapshot / 报告 checksum |

正式导入前必须：复制 `node_runtime/lexicon/v3` 整目录。

---

## 18. Rebuild / Publish

```text
增量 Patch：直接修改 operational SQLite（v3），再写 manifest/checksum
            —— 冻结流程允许，但须先备份

全量：seed → v2_shadow（tmp+atomic rename）→ prepare → v3
```

| 项 | 说明 |
|----|------|
| bundleVersion | manifest 整数；patch `nextVersion = baseVersion+1` |
| checksum | sha256 文件 |
| runtime reload | 进程需重新 `loadFromBundleDir`（Importer 报告字段；非热替换保证） |

**禁止**在未备份时对运行中 bundle 做不可逆实验。

---

## 19. Acceptance SQL（按真实 schema）

```sql
-- 单字数量
SELECT COUNT(*) AS single_char_terms
FROM term
WHERE length(word) = 1;

SELECT COUNT(*) AS single_char_base
FROM base_lexicon
WHERE length(word) = 1;

-- 功能字抽查（term）
SELECT word, pinyin_key, tone_pinyin_key, prior_score, source, enabled, tier
FROM term
WHERE word IN ('我','你','的','了','吗','请','问','能','想','点')
ORDER BY word;

-- 同步查 base（连通性真正依赖的无 domain 路径）
SELECT word, pinyin_key, prior_score, source, enabled
FROM base_lexicon
WHERE word IN ('我','你','的','了','吗','请','问','能','想','点')
ORDER BY word;

-- 多领域
SELECT t.word, tdt.domain_id, tdt.weight
FROM term t
JOIN term_domain_tags tdt ON tdt.term_id = t.id
WHERE t.word IN ('订单','预订','前台','杯','单')
ORDER BY t.word, tdt.domain_id;

-- 口语 / 修正
SELECT word, pinyin_key, prior_score, source, enabled
FROM term
WHERE word IN ('麻烦','谢谢','我想','请问')
ORDER BY word;
```

注：库中 **无** `domain` 名表；领域名为 `term_domain_tags.domain_id` 字符串。

---

## 20. Dry-Run / Validation

| 能力 | 有？ | 命令 |
|------|------|------|
| dry-run | ✅ V4 | `npm run lexicon:patch:import -- patch.json --dry-run` |
| validate-only / pre-gate | ✅ | `lexicon:patch-build-gate`；`scan-alias-legality` |
| hash | ✅ | `lexicon:compute-patch-hash:v4` |
| diff preview / domain merge report | 部分（import report / append stats） | apply 后 report |
| V3 dry-run | ❌ | — |

最安全现有验证顺序：

```text
1. 整目录备份 v3
2. compute-patch-hash:v4
3. patch-build-gate
4. import --dry-run
5. （修复接口后）正式 import:electron
6. 上述 Acceptance SQL
7. lexicon:gate:v3-runtime
8. 重跑 LexicalEdge quality probe（非本轮）
```

**本轮不开发新 dry-run 框架。**

---

## 21. Recommended Patch Structure

```text
推荐文件类型：JSON（lexicon-patch-v4）
编码：UTF-8
```

### 拆分文件（推荐）

| 文件 | Group | 原因 |
|------|-------|------|
| `connectivity-D-canonical-fix.patch.json` | D | 仅 `updateTermFields`；可先独立上线 |
| `connectivity-E-multidomain-append.patch.json` | E | 仅 `appendDomainTags`；依赖已有 term |
| `connectivity-C-spoken-base.jsonl` + Full Build | C | 无 domain 口语 → **base seed**，勿硬绑 domain |
| `connectivity-C-spoken-domain.patch.json` | C 备选 | 若必须走 V4，需真实细领域 tags |
| `connectivity-A-base-chars.*` | A/B | **接口修复前不要生成/导入** |

**不要**把 A–E 塞进单一巨 patch：失败原子回滚成本高，且 A 依赖未完成修复。

### 可直接接受的样例

**单字（接口修复后的目标形态 — 当前 V4 尚不能无 tags 导入）：**

```json
{
  "op": "addTerm",
  "word": "我",
  "pinyin": "wo",
  "tone_pinyin_key": "wo3",
  "prior_score": 0.95,
  "source": "connectivity_base_char_v1",
  "domain_tags": ["coffee"]
}
```

> 上例仅证明「当前 V4 语法可过校验」；**语义上不推荐**用细领域伪装 base。真正 base 单字需 §2 修复后再定字段。

**base 双字（Full Build seed JSONL）：**

```json
{
  "type": "canonical_term",
  "word": "谢谢",
  "pinyin": "xie xie",
  "tonePinyinKey": "xie4|xie5",
  "priorScore": 0.9,
  "source": "connectivity_spoken_v1",
  "enabled": true,
  "lexiconLayer": "base",
  "domains": [],
  "repairTarget": false
}
```

**多领域（V4）：**

```json
{
  "op": "addTerm",
  "word": "订单",
  "pinyin": "ding dan",
  "tone_pinyin_key": "ding4|dan1",
  "domain_tags": ["coffee", "food_order"],
  "domain_weights": { "coffee": 1, "food_order": 1 },
  "prior_score": 0.9,
  "source": "connectivity_multidomain_v1"
}
```

```json
{
  "op": "appendDomainTags",
  "word": "订单",
  "domain_tags": ["tourism_hotel", "transport"],
  "domain_weights": { "tourism_hotel": 1, "transport": 1 }
}
```

**canonical prior 修正：**

```json
{
  "op": "updateTermFields",
  "word": "麻烦",
  "fields": {
    "prior_score": 0.85,
    "source": "connectivity_canonical_fix_v1"
  }
}
```

---

## 22. Risks

1. **只灌单字到 `term`/`domain_lexicon` 却不改 Recall** → 连通性指标仍为 0。  
2. **用 `general` 当 domain_tags** → validate 可能过，但 Recall scope **跳过 general** → 仍无命中。  
3. **第二次 `addTerm` 同词** → 整包事务失败。  
4. **误用 `replaceDomainTagsDangerous`** → 抹掉旧领域。  
5. **继续 `homophone_variant` source** → prior 0.35 + 合约违规。  
6. **未备份直接 import** → 回滚仅靠人工。  
7. **把 base 口语全部绑细领域** → Vote/领域污染，违背补丁分层意图。

---

## 23. KEEP

```text
Patch Importer V4 九步流水线
appendDomainTags + ON CONFLICT MAX(weight) 冻结 SQL
updateTermFields（prior/source 修正）
碰撞键 (word, pinyin_key) / term_id
profile-registry 领域白名单
domain_hierarchy 只读
transaction 全量原子 apply
--dry-run / pre-gate / hash / gate:v3-runtime
base_lexicon 作为无 domain 召回路径（2–3 字已通）
```

---

## 24. MODIFY（未来最小修复，本轮不执行）

```text
1. v2-classify-row：受控允许 1 字 → base（白名单）
2. Patch V4：支持无 domain 的 base 写入（或 addBaseTerm），rematerialize 不强制 tags
3. recall-span-topk-v2 / local-span-recall：允许 length=1 查 base_lexicon
4. homophone cleanup：对「麻烦」类误伤词改为 canonical fix，而非仅删 domain 行
```

---

## 25. RESTORE

```text
无证据表明「曾经支持单字 base 后被删代码」。
应恢复的是产品意图与数据：
  - 合法口语「麻烦」应为高 prior canonical，而非 variant
  - Lattice 1..5 Window 与 Recall 最小长度应对齐（当前 Recall 仍停在历史 2..5）
```

---

## 26. DELETE（建议，不执行）

```text
停止使用 V3 覆盖式 replaceTermTags 做多领域扩展
停止新增 source=*homophone_variant* 独立 word 行
不要用 replaceDomainTagsDangerous 做“追加领域”
```

---

## 27. NEW（仅允许）

```text
NEW 词库 patch 文件（D/E 可先写；A/B 等接口修复）
NEW 导入验证测试（单字 base 命中、append 四域幂等、麻烦 prior≥0.5）
NEW SQL 验收脚本（§19）
禁止新业务中间层 / 第二套 schema / 新 alias 配置文件
```

---

## 28. Target List

```text
[x] 定位标准导入入口
[x] 确认真实输入格式
[x] 确认单字支持
[x] 确认 2–3 字 canonical 支持
[x] 确认 prior/source 语义
[x] 确认 base 表示方式
[x] 确认多领域追加语义
[x] 确认重复词 upsert
[x] 确认 domain tags 不覆盖
[x] 确认拼音标准格式
[x] 确认事务与回滚
[x] 确认 rebuild/publish
[x] 生成可执行验收 SQL
[x] 给出正式 patch 样例
```

---

## 29. Check List

```text
[x] 本轮未修改代码
[x] 本轮未修改词库
[x] 本轮未修改 SQLite
[x] 本轮未修改 Contract
[x] 未假设导入字段（对照 patch-types-v4 / 真实 patch）
[x] 未假设封闭 source 枚举
[x] 未假设 pinyin 格式（对照 pinyin-resolve）
[x] 已验证 length=1 全链路（build 拒 / V4 可写但需 tags / Recall 拒）
[x] 已验证一词多领域（UPSERT MAX）
[x] 已验证重复导入幂等语义（代码级；未实写库）
[x] 已验证旧 domain tags 保留语义（append 路径）
[x] 已反查「麻烦」异常来源
[x] 已给出可直接接受的文件样例
```

---

## 30. Final Recommendation

```text
LEXICON IMPORT INTERFACE: CONDITIONAL

MINIMAL IMPORT FIX REQUIRED BEFORE PATCH
```

**立刻可准备（仍不执行导入）：**

1. Group D patch：`麻烦` `updateTermFields` prior≥0.85、source 去 variant  
2. Group E patch：`appendDomainTags` 多领域  
3. Group C：Full Build `lexiconLayer:base` JSONL（谢谢/请问/我想…）

**单字 Group A/B：生成补丁前必须完成最小三角修复：**

```text
Full Build 允许受控单字 → base_lexicon
  且/或 V4 无 domain base 写入
  且 Recall 允许 length=1 查 base
```

在此之前导入单字 **不能**声明为 Lexical Connectivity 修复，只会造成「库里有字、边上无边」的假进度。

---

## Appendix — 关键代码锚点

```104:109:electron_node/electron-node/scripts/lexicon/lib/v2-classify-row.mjs
if (charLen === 1) {
  return reject('one_char', '1-char words are not allowed');
}
```

```30:33:electron_node/electron-node/main/src/lexicon-patch-v4/patch-validator-v4.ts
function validateDomainTags(tags: string[] | undefined, index: number): PatchValidationErrorV4 | null {
  if (!tags?.length) {
    return { code: 'missing_domain_tags', message: `operations[${index}]: domain_tags required` };
  }
```

```82:87:electron_node/electron-node/main/src/lexicon-patch-v4/sqlite-applier-v4.ts
const UPSERT_TAG_SQL = `
  INSERT INTO term_domain_tags (term_id, domain_id, weight)
  VALUES (@term_id, @domain_id, @weight)
  ON CONFLICT(term_id, domain_id) DO UPDATE SET
    weight = MAX(weight, excluded.weight)
`;
```

```255:262:electron_node/electron-node/main/src/lexicon-v2/recall-span-topk-v2.ts
  if (topK <= 0 || syllables.length < 2 || syllables.length > 5 || !syllables.length) {
    return {
      hits: [],
      ...
    };
  }
```
