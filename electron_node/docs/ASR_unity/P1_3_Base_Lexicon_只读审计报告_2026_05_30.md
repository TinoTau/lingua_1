# P1.3 Base Lexicon Builder — 只读代码审计报告

版本：V1.0（只读，无代码变更）  
日期：2026-05-30  
审计范围：Lexicon / FW Detector / local-span-recall / 现有 build 脚本  
主链状态：**已冻结** — 本报告不涉及主链控制流变更

---

## 执行摘要

| 问题 | 结论 |
|------|------|
| 是否已具备「导入基础中文词库」能力？ | **部分具备**：已有 **JSONL seed → validate → SQLite bundle** 全链路；**尚无**面向「2–3 字现代汉语基础词 + 严格过滤」的专用 Builder |
| 最接近现有代码的格式 | **格式 A：canonical_term JSONL**（非运行时直接读；经 `lexicon:build` 编译为 SQLite） |
| 运行时实际读什么？ | **`manifest.json` + `lexicon.sqlite` + `checksum.txt`**（内存构建 pinyin/exact/alias 索引） |
| 是否需要新增 Builder？ | **是** — 现有脚本面向 domain canonical 资产（travel/restaurant 等），**不含** base/idiom/domain 三分、2–3 字过滤、自由短语禁止、bucket 上限 |
| P1.3 最大缺口 | ① 词库内容与 P1.3 规则不匹配（现 seed 含大量 4+ 字短语）；② FW 默认 **`candidateRequireRepairTarget=true`**，仅 **`repairTarget:true`** 词条可被 pick（现仅 ~5 条） |

**建议路径：** 已有格式 → **扩展 seed 规范 + 新增 Base Lexicon Builder** → 仍走现有 `lexicon:build` 产出 SQLite bundle（**不必**改 FW 主链）。

---

## 一、当前词库加载入口

### 1.1 FW Detector 词库从哪里加载？

```
fw-detector-step.ts
  → fw-detector-orchestrator.ts
      ensureLexiconRuntimeLoaded()          // lexicon-runtime-holder.ts
      getLexiconRuntime()                   // lexicon-runtime.ts
  → runFwTopKDecisionPipeline()
      → recallSpanTopK(runtime, ...)
          → lookupTopKByPinyin(runtime, ...)
```

**加载实现：** `LexiconRuntime.load()` 只读打开 SQLite，全表 SELECT，内存构建 `pinyinIndex` / `exactIndex` / `aliasIndex`。

### 1.2 是否已有 lexicon bundle？

**是。** 当前生产 bundle：

| 项 | 值 |
|----|-----|
| 路径 | `{PROJECT_ROOT}/node_runtime/lexicon/current/` |
| manifest | `schemaVersion: final-v1`, `term_count: 2002` |
| seed 来源 | `data/lexicon/10k/lexicon_10k_canonical_merged.jsonl` |
| 域分布 | travel / transport / restaurant / tech_ai（各 ~500） |

另有 deploy seed：`data/lexicon/v3/lexicon_v3_5k_deploy.jsonl`（~4962 词，文档称 5k 阶梯）。

### 1.3 bundle 路径如何配置？

| 优先级 | 配置 | 解析函数 |
|--------|------|----------|
| 1 | 环境变量 `LEXICON_BUNDLE_PATH`（目录） | `resolveLexiconBundleDir()` |
| 2 | `PROJECT_ROOT/node_runtime/lexicon/current` | 同上 |
| 失败 | 无 `PROJECT_ROOT` 且无 `LEXICON_BUNDLE_PATH` | `status: error` |

配置项 **无** node-config 里的 bundle 路径字段；仅环境变量 + PROJECT_ROOT。

### 1.4 热加载 / runtime load / request payload load？

| 能力 | 状态 |
|------|------|
| 热加载 | **无** — `ensureLexiconRuntimeLoaded()` 单例懒加载一次 |
| 按 job payload 换词库 | **无** |
| 启动预加载 | Legacy `lexiconRecall.enabled=true` 时 `logLexiconStartupContract()` 预 load；FW 默认首 job 懒加载 |

### 1.5 无 bundle 时的 fallback

- `LexiconRuntime.status` → `missing` 或 `error`
- `recallSpanTopK` 得到空 hits → FW 不 apply
- KenLM weak_veto 仍可运行（无 replacement 候选）
- **无** 内置 fallback 词表或在线词库

### 1.6 `lexicon_runtime_status=ok` 由谁产生？

| 模块 | 职责 |
|------|------|
| `LexiconRuntime.load()` | 设置 `state.status = 'ok'` |
| `resolveLexiconRuntimeContract()` | `pipeline/lexicon-runtime-contract.ts` |
| `buildFwResultExtra()` | `result-builder.ts` 写入 `extra.lexicon_runtime_status` |

dialog_200 批测 `ok` 表示：**bundle 目录存在 + manifest/schema/checksum 通过 + SQLite 可读**。

### 1.7 `use_lexicon: true` 触发什么？

- **Legacy Recover**：影响 `shouldExecuteStep(LEXICON_RECALL)` 等
- **FW 主链**：`resolveLexiconRuntimeContract()` 在 `lexiconRecall.enabled=false` 时，若 FW feature 开且 `use_lexicon=true`，仍 **ensureLexiconRuntimeLoaded()** 并上报真实 status
- **FW orchestrator**：**不检查** `use_lexicon`；只要跑 FW step 就会 load runtime

### 1.8 `lexiconRecall.enabled=false` 与 FW local recall

**互相独立，共用同一 SQLite bundle：**

| | Legacy Recover | FW local recall |
|--|----------------|-----------------|
| 开关 | `features.lexiconRecall.enabled` | `asr.engine=fw_detector_v1` + `features.fwDetector.enabled` |
| 是否读 lexiconRecall 开关 | 是 | **否** |
| Recall API | `window-recall.ts`（n-best 窗） | `local-span-recall.ts` → `recallSpanTopK` |
| 生产默认 | false | true |

---

## 二、当前词库数据结构

### 2.1 Seed JSONL（build 输入 — **推荐 P1.3 扩展点**）

必需类型：`type: "canonical_term"`

| 字段 | Seed 名 | SQLite / 运行时 | 必需 | FW recall 使用 |
|------|---------|-----------------|------|----------------|
| 词面 | `word` / `term` | `word` | ✅ | ✅ |
| 归一化 | `normalized` | `normalized` | 可 auto | 索引 |
| 拼音 | `pinyin`（string 或 array） | `pinyin` → `string[]` | CJK 可 build 补全 | ✅ bucket key |
| 先验分 | `priorScore` / `prior_score` | `prior_score` | ✅ ∈ (0,1] | ✅ 排序 + minPrior |
| 频次 | `frequency` / `priority` | `frequency` | 可选 | 间接（build 算 prior） |
| 域 | `domains[]` / `domain` | `domains` JSON | ✅ 须在 registry | ✅ domain filter |
| 别名 | `aliases[]` | `aliases` JSON | 可选 | alias exact/pinyin |
| 修复目标 | `repairTarget` / `repair_target` | `repair_target` 0/1 | 可选 | ✅ **FW pick 门控** |
| 启用 | `enabled` | `enabled` 0/1 | 默认 true | ✅ |
| 来源 | `source` | `source` | validate 必需 | diagnostics |
| 标签 | `tags` | `tags` JSON | 可选 | 未用于 FW 排序 |
| ID | `termId` / `id` | `id` | 推荐 | dedup |

### 2.2 **不存在**于 FW 路径的字段

| 字段 | 状态 |
|------|------|
| `phraseCandidates` | **无** |
| `confusionMap` / confusion rows | **生产禁止**（validate 拒绝 `type: confusion`） |
| 运行时 `pinyinIndex` JSON 文件 | **无** — 内存 Map |
| `metadata` 块 | 仅 manifest 级 stats |

### 2.3 diagnostics 字段（manifest / extra）

`manifest.json`：`term_count`, `pinyin_index_count`, `domainDistribution`, `priorScoreDistribution`, `topPriorTerms`, `bundle_tag`, `seed_path` 等 — **不参与 recall 决策**。

---

## 三、当前拼音 recall 逻辑

### 3.1 调用链

```
recallSpanTopK(spanText, topK=3, minPrior=0.5, enabledDomains)
  syllables = textToSyllables(spanText)     // pinyin-pro, toneType:none
  lookupTopKByPinyin({ syllables, windowText, termLength, topK })
    exactKey = syllables.join('|')        // syllablesKey
    bucket = runtime.getPinyinBucket(exactKey)
    filter: word.length === termLength, enabled, priorScore>0
    score: prior + phonetic + domainBoost - editPenalty
    sort by candidateScore DESC → slice(0, topK)
  filter: priorScore >= minPrior, matchEnabledDomain
```

### 3.2 Pinyin normalize

- `normalizeSyllable`: lowercase, 去非 `[a-z0-9]`
- `textToSyllables`: **无声调**（`pinyin-pro` `toneType: 'none'`）
- Bucket key: `zhong|bei` 形式（`|` 分隔）

### 3.3 匹配模式

| 能力 | 状态 |
|------|------|
| 完整拼音 bucket 匹配 | ✅ 主路径 |
| 近音跨 bucket | ❌ 仅 bucket 内 `scorePinyinSimilarity`（Levenshtein 音节） |
| 多音字 | span 侧用 pinyin-pro 默认读音；seed 侧存显式 `pinyin` |
| 1 音节 span | ❌ `syllable_out_of_range`（MIN=2） |
| 6+ 音节 span | ❌ MAX_SYLLABLES=5 |

### 3.4 排序依据

1. **Build 时** bucket 内预排序：`priorScore DESC`（`pinyin-index.ts`）
2. **Lookup 时** 重算 `candidateScore` 再排序
3. **FW topK 后** KenLM weak_veto → `finalScore` → pick

**不是**纯词库顺序；**不是**纯 frequency（frequency 仅 build 时转 priorScore）。

### 3.5 KenLM 位置

**Recall 之后：** `recallSpanTopK` → `buildCandidateSentencesForSpan` → `scoreSpanCandidateSentences`（KenLM）→ `pickBestCandidatePerSpan`

### 3.6 Bucket 截断

| 层级 | 限制 |
|------|------|
| SQLite bucket 大小 | **无 build 上限**（同 key 可数百条） |
| Runtime lookup | **`topK` 截断**（FW 默认 **3**） |
| `minPrior` | 默认 0.5 |
| `minCandidateScore` | Recover quality config（FW 共用 lookup） |

**无** per-bucket max 10/20 的 build 侧 enforcement。

### 3.7 FW pick 额外门控（关键）

默认 `candidateRequireRepairTarget: true` → **仅 `repairTarget===true` 候选进入 pick 池**。

当前 bundle 中 `repairTarget:true` 仅少量（如 中杯/大杯/美式/马芬/蓝莓马芬）。**大量 base 词即使入 bucket，FW 也不会 pick。**

---

## 四、词库导入能力（现有脚本）

### 4.1 已有能力 ✅

| 能力 | 脚本 / 命令 |
|------|-------------|
| JSONL seed 校验 | `npm run lexicon:validate` → `validate-lexicon-seed.mjs` |
| 自动补 pinyin | `pinyin-complete.mjs` + `pinyin-pro` |
| 去重 | validate 检测 duplicate word |
| 生成 SQLite bundle | `npm run lexicon:build` → `build-lexicon-bundle.mjs` |
| manifest + checksum | `build-bundle.mjs` |
| 域白名单 | `profile-registry.json` |
| V3 资产导入 | `lexicon:import-v3-assets` / `import-v3-5k-assets` |
| diagnostics 报告 | `lexicon:report`, manifest stats |
| 冻结 gate | `lexicon:v3-gate` |

### 4.2 缺失能力 ❌（相对 P1.3 目标）

| 能力 | 状态 |
|------|------|
| 2–3 字 base / idiom / domain **分库** | 无 |
| 禁止 1 字词 | **无** validate 规则 |
| 禁止普通 4 字组合 | **无**（仅 warning：`length > 5`） |
| 禁止自由组合短语 | **无**（现 seed 含「机场接送」「酒店入住」等） |
| 低频 / 生僻过滤 | 仅 priorScore 阈值；无 corp freq 门槛 |
| per-bucket max candidates | **无** |
| rejected.jsonl 输出 | **无** |
| base_zh_v1 专用 manifest rules | **无** |

### 4.3 最小实现需新增（不改 FW 主链）

1. `scripts/lexicon/build-base-lexicon.ts`（或 `.mjs`）— 源词表 → filtered JSONL
2. `scripts/lexicon/validate-base-lexicon.ts` — P1.3 规则校验
3. 可选 `export-fw-bundle.ts` — 薄封装 `lexicon:build --seed ...`
4. `check-pinyin-buckets.ts` — bucket 大小 / 冲突报告

**运行时零改动** 即可加载：只要产出合法 canonical JSONL + 走现有 build。

---

## 五、三种候选格式评估

| 格式 | 与现有代码距离 | 长期维护 | 建议 |
|------|----------------|----------|------|
| **A: term list JSONL** | ⭐⭐⭐ **最近** — 已是 build 输入 | ⭐⭐⭐ 易 diff、分源合并 | **P1.3 主输入格式** |
| **B: bundle JSON entries[]** | ⭐ 运行时不用 | ⭐⭐ | 仅作 interchange；最终仍编译 SQLite |
| **C: prebuilt pinyinIndex JSON** | ⭐ 运行时不用 | ⭐⭐ 难维护 bucket | **不建议**；runtime 自建索引 |

**结论：**

- **生产路径：** `entries.jsonl`（A）→ `lexicon:build` → `lexicon.sqlite` + `manifest.json`
- **不必** 同时 ship `pinyin_index.json` 给 runtime；可作为 **build 中间产物 / QA**（`check-pinyin-buckets`）
- **应拆分** base / idiom / domain 三个 seed 文件（build 时 merge 或分 bundle_tag）
- **需要** manifest + checksum + stats；version 用 `bundle_tag` / `schemaVersion`

---

## 六、基础词库过滤规则

### 6.1 代码侧现有规则

| 规则 | 代码位置 | 严格度 |
|------|----------|--------|
| `MAX_WORD_LEN = 8` | `constants.mjs` | hard error |
| `RECALL_PREFERRED_MAX = 5` | warning only | 不 ban 4 字 |
| span 2–5 音节 | `local-span-recall.ts` | runtime |
| `termLength` 2–5 | `lookupTopKByPinyin` | runtime |
| confusion rows | validate reject | hard |
| domain 白名单 | `profile-registry.json` | hard |
| `priorScore > 0` | validate + runtime | hard |

**代码侧尚无 P1.3 base 规则** — 必须在 Builder 实现。

### 6.2 建议 Base Lexicon Builder 规则

```
base bundle:
  len in {2, 3} only
  banSingleChar: true
  banFreePhrase: true（不在现代汉语词表 / 非词典条目）
  minFreq: 可配置（如 Top 50k 字词表交集）
  maxBucketCandidates: 20（build 时截断 + rejected 记录）

idiom bundle:
  len == 4 && type == idiom | fixed_expression

domain bundle:
  len >= 5 OR proper_noun
  不 merge 进 base

repairTarget 标注策略（FW 相关）:
  - homophone-prone 词条 + 高 prior → repairTarget: true
  - 或 P1.3 后评估是否放宽 candidateRequireRepairTarget（属配置，非本审计改代码）
```

### 6.3 bucket 内排序建议（FW 目标）

1. **Runtime lookup 已按 candidateScore**（prior + phonetic + domainBoost）
2. **Build 预排序建议：** `priorScore DESC`（保持现状）
3. **Domain vs base：** 同 bucket 内 domain 词可略抬 prior（现 `domainBoost` 在 lookup 时加）；**不建议** domain 覆盖 base 到污染 homophone bucket — domain 专名应 **独立 domain bundle + enabledDomains 控制**
4. **低频词：** build 时 rejected + 提高 `minPrior` 等效过滤

---

## 七、建议导入产物结构

```
data/lexicon/zh/
  base_zh_v1/
    manifest.json          # build 输入 manifest（非 runtime manifest）
    entries.jsonl          # 2–3 字 base canonical_term
    rejected.jsonl         # 过滤原因
    stats.json             # 计数 / bucket 分布
  idiom_zh_v1/
    entries.jsonl          # 4 字成语/熟语
  domain_zh_v1/
    entries.jsonl          # 5+ 专名 / 场景词

# build 合并后输出（现有路径）
node_runtime/lexicon/current/
  manifest.json            # schemaVersion: final-v1
  lexicon.sqlite
  checksum.txt

# 可选 QA 中间产物
data/lexicon/zh/base_zh_v1/pinyin_index.preview.json
```

**manifest.json（builder 级）示例：** 见用户规格 §七 — 与现 `manifest.json` 字段兼容扩展 `rules` / `sources` 即可。

**Seed 行示例（与现代码兼容）：**

```json
{"type":"canonical_term","termId":"base-000001","word":"项目","normalized":"项目","pinyin":"xiang mu","priorScore":0.82,"frequency":120000,"domains":["general"],"source":"modern_common_words","repairTarget":false,"enabled":true,"tags":["base","len2"]}
{"type":"canonical_term","termId":"base-fw-0001","word":"中杯","normalized":"中杯","pinyin":"zhong bei","priorScore":0.95,"domains":["restaurant"],"aliases":["钟贝"],"source":"fw_homophone","repairTarget":true,"enabled":true,"tags":["base","len2","homophone"]}
```

注意：现 FW `enabledDomains` 默认 **不含 `general`** — base 词若仅挂 `general` 域，**recall 后会被 domain filter 掉**。P1.3 需决策：

- base 词挂 `general` + 扩展 FW `enabledDomains`，或
- base 词按场景复制到 travel/restaurant/…，或
- 新增 `base` domain 并加入 FW enabledDomains（**配置变更，非本审计改代码**）

---

## 八、建议新增脚本

| 脚本 | 输入 | 输出 | 职责 |
|------|------|------|------|
| `build-base-lexicon.mjs` | 原始词表 CSV/TXT/JSONL + 规则 YAML | `entries.jsonl`, `rejected.jsonl`, `stats.json` | 2–3 字过滤、freq 阈值、拼音生成、bucket 截断 |
| `validate-base-lexicon.mjs` | `entries.jsonl` | exit code + 报告 | P1.3 规则 hard validate |
| `export-fw-bundle.mjs` | 合并后的 seed JSONL | 调用现有 `build-lexicon-bundle` | 一键产出 runtime bundle |
| `check-pinyin-buckets.mjs` | seed 或 sqlite | bucket 大小报告、homophone 冲突 | QA：`zhong|bei` 含 中杯/钟表、不含 重备 |

---

## 九、测试建议

| 类别 | 用例 |
|------|------|
| 长度 | 1 字 reject；2/3 accept；普通 4 字 reject；成语进 idiom；5+ reject base |
| 自由组合 | 「项目维护」「模型部署」reject；「项目」「维护」accept |
| bucket | `zhong|bei` 含 中杯/钟表；不含 重备；max 20 生效 |
| FW recall | span「钟贝」→ recall「中杯」；`repairTarget` + domain 命中 |
| KenLM | recall 后 weak_veto 选句 |
| 集成 | base bundle + dialog_200；对比 raw/FW CER、apply/improve/degrade |

现有相关单测：`local-span-recall.test.ts`, `domain-filter.test.ts`, `lexicon-recall.test.ts`, `fw-topk-decision-pipeline.test.ts`。

---

## 十、Target List

### P0 — 确认格式 + 最小 Builder

- [ ] 冻结 canonical_term JSONL 字段映射（本文 §2.1）
- [ ] 实现 `build-base-lexicon`：2–3 字 + freq 过滤 → JSONL
- [ ] 实现 `validate-base-lexicon`
- [ ] 走现有 `lexicon:build` 产出 SQLite
- [ ] 明确 base 词 **domain 策略**（general vs 场景域 vs 扩 enabledDomains）
- [ ] 明确 **repairTarget 标注策略**（否则 FW 仍不 pick）

### P1 — bucket 限制 + rejected diagnostics

- [ ] per-bucket max 20 + `rejected.jsonl`
- [ ] `check-pinyin-buckets` + stats.json
- [ ] idiom / domain 分库 merge 脚本
- [ ] dialog_200 回归 + CER 对比

### P2 — 多来源合并 + versioned bundle

- [ ] manifest rules + bundle_tag 版本化
- [ ] 多源 merge（现代汉语词表 + FW homophone 补丁）
- [ ] alias 碰撞报告（现有 `alias-collision-report.mjs` 可复用）

---

## 十一、Check List

- [ ] Seed 行含 `type: canonical_term`
- [ ] 每行 `source` + valid `domains`
- [ ] `priorScore ∈ (0,1]`
- [ ] CJK 词可解析 pinyin（或 build 自动补）
- [ ] `npm run lexicon:validate` PASS
- [ ] `npm run lexicon:build` PASS
- [ ] `npm run lexicon:rebuild-sqlite`（Electron 前）
- [ ] `lexicon:v3-gate` PASS
- [ ] dialog_200 `lexicon_runtime_status=ok`
- [ ] FW homophone case（钟贝→中杯）仍 PASS
- [ ] 无 confusion rows 进 seed

---

## 十二、风险说明

| 风险 | 说明 | 缓解 |
|------|------|------|
| 词库过大候选污染 | 同 pinyin bucket 数百条 | build bucket max + prior 截断 |
| 低频词进 bucket | 如「重备」 | freq 阈值 + rejected |
| 多音字错误 | span 与 seed 读音不一致 | seed 显式 pinyin；aliases |
| 4 字组合词污染 | 现 seed 已有 | P1.3 builder 硬过滤 |
| domain 覆盖 base | 专名挤占 homophone bucket | 分库 + enabledDomains |
| repairTarget 过严 | 默认仅 5 词可 pick | homophone 标注策略或配置评估 |
| general 域不匹配 | base 挂 general 被 FW 滤掉 | domain 策略（§七） |

---

## 十三、结论：已有格式 vs 缺 Builder

```text
已有格式 → 直接生成词库文件（JSONL seed）✅ 可行
缺 Builder → 必须先开发 Base Lexicon Builder ⚠️ 必须

推荐行动：
1. 不新建 runtime 格式；沿用 JSONL → SQLite
2. 新增 P1.3 Builder + validate + bucket QA
3. 拆分 base / idiom / domain seed
4. 同步规划 repairTarget + domain 与 FW enabledDomains
5. 不修改 ASR→FW 主链；不恢复 Recover
```

---

## 附录：关键代码索引

| 模块 | 路径 |
|------|------|
| Runtime 加载 | `main/src/lexicon/lexicon-runtime.ts` |
| Bundle 路径 | `main/src/lexicon/lexicon-bundle-path.ts` |
| Pinyin lookup | `main/src/lexicon/pinyin-topk-lookup.ts` |
| FW recall | `main/src/lexicon/local-span-recall.ts` |
| FW 决策链 | `main/src/fw-detector/fw-topk-decision-pipeline.ts` |
| Runtime status | `main/src/pipeline/lexicon-runtime-contract.ts` |
| Build | `scripts/lexicon/lib/build-bundle.mjs` |
| Validate | `scripts/lexicon/lib/validate-seed.mjs` |
| 常量 | `scripts/lexicon/lib/constants.mjs`（MAX_WORD_LEN=8, RECALL_PREFERRED_MAX=5） |
| 文档 | `electron-node/docs/LEXICON.md`, `docs/FW_DETECTOR.md` |
