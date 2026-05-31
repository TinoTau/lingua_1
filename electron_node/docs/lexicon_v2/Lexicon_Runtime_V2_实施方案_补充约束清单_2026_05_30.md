# Lexicon Runtime V2 实施方案 — 补充信息与约束清单

**版本：** V1.0  
**日期：** 2026-05-30  
**对照文档：** [Lexicon_Runtime_V2_实施方案_2026_05_30.md](./Lexicon_Runtime_V2_实施方案_2026_05_30.md)  
**代码依据：** 当前仓库 `electron_node/electron-node` 源码（只读核对）  
**关联审计：** [Lexicon_Runtime_V2_开发前只读代码审计报告_2026_05_30.md](./Lexicon_Runtime_V2_开发前只读代码审计报告_2026_05_30.md)

---

## 1. 文档用途

本清单在《Lexicon Runtime V2 技术实施方案（冻结主链版）》基础上，**对照实际代码**列出：

1. 实施方案中 **未写清或遗漏** 的信息  
2. 代码中 **已存在、方案必须遵守** 的约束  
3. 各 Phase **实施前必须补齐** 的决策与验收项  

**用法：** 开发 Phase 0 前逐项勾选；方案正文修订时可将 §2–§6 合并进实施方案 §十 Check List。

---

## 2. 实施方案遗漏项（需补充进方案正文）

### 2.1 架构与调用链

| # | 遗漏点 | 代码事实 | 建议补充 |
|---|--------|----------|----------|
| A1 | Phase 3 写「替换 `lookupTopKByPinyin`」 | FW 唯一入口是 **`recallSpanTopK`**（`local-span-recall.ts`），内部才调 `lookupTopKByPinyin`；下游 **`fw-topk-decision-pipeline.ts`** 只认 `LocalSpanRecallHit[]` | Phase 3 改造 **`local-span-recall.ts`**（或同级 `recall-span-v2.ts` 被其调用），**不要**改 `fw-topk-decision-pipeline` 的 KenLM/pick 段 |
| A2 | V2 merge 后输出形态未定义 | `scoreRecallHits` 需要：`word, priorScore, candidateScore, phoneticScore, source, domains, repairTarget` | V2 查询结果必须 **映射回 `LocalSpanRecallHit`**，字段契约与 V1 一致 |
| A3 | Alias 召回未提及 | V1：`lookupTopKByPinyin` + **`lookupAliasPinyinMatches`**（`alias-index.ts`）；`source` 为 `alias_pinyin` / `alias_exact`（`window-candidate-source.ts`） | V2 build 需 **alias 物化或二次索引**；merge 规则与 V1 `resolveWindowCandidateSource` 对齐 |
| A4 | 拉丁/混合 token 路径 | V1：`isMixedLatinToken` → `lookupExactLatin`（不走 pinyin bucket） | V2 需明确：latin 进 **哪张表** 或 Phase 3 前 **仍走 V1 exactIndex** |
| A5 | `domainBoost` 未提及 | `candidate-score.ts` → `computeDomainBoost(profile, hotword.domains)` | base 表无 `domains` 时：约定 **synthetic domains=[] 或 tier 标签**；domain 表 hit 应带 **`[domainId]`** 供 `domainMatched` 打分 |
| A6 | 二次 domain 过滤 | `fw-topk-decision-pipeline.ts:100` 对 recall hits 再算 **`matchEnabledDomain`** → `domainMatched` 进 `finalScore` | V2 不能仅「去掉 general 硬拒绝」；需定义 **tier 路由 vs enabledDomains** 谁优先（见 §3.2） |
| A7 | `fw-topk-decision-pipeline` 不可改 | 文件头注释：**唯一决策链 SSOT** | Phase 3 只允许换 **recall 输入**；禁止改 pick / D-greedy / KenLM 调用顺序 |
| A8 | Span 音节范围 | `local-span-recall.ts`：`MIN_SYLLABLES=2`, `MAX_SYLLABLES=5` | V2 按 **音节数 + 字长** 路由 base(2–3) / idiom(4) / domain(2–5?)，方案需写清路由表 |
| A9 | `common5` 分层 | P1.3 资产有 **`common5_zh_v2`**，实施方案 Build 输入未列 | 需决策：common5 归 **base**、**domain** 还是 **独立 tier** |
| A10 | Seed 路径命名 | 方案写 `base_zh_v1/`，仓库资产为 **`docs/lexicon-assets/.../base_zh_v2/`** | Build 输入应对齐 **实际资产路径** 与 `source_manifest.json` |

### 2.2 Build / Bundle

| # | 遗漏点 | 代码事实 | 建议补充 |
|---|--------|----------|----------|
| B1 | V1/V2 manifest 共存 | `assertLexiconManifestReady` **硬编码** `schemaVersion === 'final-v1'`（`scored-lexicon.ts`） | V2 Runtime **不得**走 V1 `LexiconRuntime.load()`；需 `assertLexiconManifestV2Ready` + **`schemaVersion: lexicon-v2-*`** |
| B2 | Bundle 路径 | V1 仅 `node_runtime/lexicon/current` + `LEXICON_BUNDLE_PATH`（`lexicon-bundle-path.ts`） | V2 需 **`LEXICON_V2_BUNDLE_PATH`** 或 `node_runtime/lexicon/v2_current` + 配置项 |
| B3 | 文件名 | V1：`manifest.json` + `lexicon.sqlite` | V2 方案已写 `manifest_v2.json` + `lexicon_v2.sqlite` — 需 **禁止** V1 loader 误读 V2 目录 |
| B4 | Electron SQLite ABI | `npm run lexicon:build` 含 **`lexicon:rebuild-sqlite`** | V2 shadow build 若用 `better-sqlite3` 测 runtime，同样需 **rebuild-sqlite** 文档 |
| B5 | `rejected.jsonl` | 构建脚本 **无**；P1.3 资产目录 **手工** 维护 `rejected.jsonl` | Phase 0 **`v2-shadow-stats.mjs` 应输出 `rejected_v2.jsonl`**（方案仅写 stats_v2.json） |
| B6 | validate 复用 | V1 validate 缺省 domains→`general`（`domain-registry.mjs`） | V2 classify **不得**把 domain 专词 validate 成 general；domain 行 **必须**显式非 general 域 |
| B7 | `prior_score` 尺度 | 0–1；build 拒绝 `prior_score <= 0` | 四表均需 **prior_score > 0** gate，与 V1 一致 |
| B8 | checksum 算法 | `sha256:` 前缀（`lib/checksum.mjs`） | V2 复用同一算法，写入 `manifest_v2.checksum` + `checksum.txt` |

### 2.3 Schema 草案修正（相对实施方案 §三）

| 表 | 方案现状 | 建议补充字段/约束 |
|----|----------|-------------------|
| `base_lexicon` | 无 `normalized` / `id` | 增加 `id TEXT`、`normalized TEXT`（与 V1 migrate 一致，便于 dedupe / 日志） |
| `idiom_lexicon` | 无 `repair_target` | FW 默认 **`candidateRequireRepairTarget: true`** — idiom 若可 pick，需 **`repair_target`** 列或明确永不 pick |
| `domain_lexicon` | 无 `source` / `normalized` | 建议与 base 对齐，便于审计 |
| `industry_routing_lexicon` | 无 PK | 建议 `PRIMARY KEY (pinyin_key, keyword, domain_id)` 或 UNIQUE；避免重复路由行 |
| 全局 | 无 `pinyin` 原文列 | 可选存 `pinyin TEXT`（空格分隔）便于 debug；**索引键仍以 `pinyin_key`** 为准 |

**`pinyin_key` 生成 SSOT（必须写入方案）：**

```text
syllables = pinyinSyllables(row.pinyin)  // build: scripts/lexicon/lib/pinyin-complete.mjs
pinyin_key = syllables.join('|')         // 与 runtime syllablesKey 一致
normalizeSyllable: [^a-z0-9]  stripped, lowercase
```

代码位置：`main/src/lexicon/pinyin-index.ts` → `syllablesKey`。

### 2.4 Session Intent

| # | 遗漏点 | 代码事实 | 建议补充 |
|---|--------|----------|----------|
| S1 | 配置开关 | `lexiconV2.enabled` 默认 **false**（`node-config-defaults.ts`）；**无** `lexiconRuntimeV2` 配置 | 方案需新增 **feature flags 表**（§4） |
| S2 | Profile 与 Intent 双轨 | Intent 成功还写 **`pendingProfile` / `activeLexiconProfile`**（`session-finalize.ts`） | `lexiconSessionIntent.primaryDomain` 必须与 **profile 同步** 规则文档化 |
| S3 | Profile 切换门限 | `applyProfileDecision`：`MIN_CONFIDENCE=0.75`，`MIN_LEAD=0.15`（`active-lexicon-profile-manager.ts`） | Intent 写 SSOT 时 **同一门限**；低 confidence 只更新 keywords 不切换 domain |
| S4 | Turn 绑定 | `bindProfileSnapshotToContext`（`turn-profile-binding.ts`） | Phase 2 增加 **`bindLexiconSessionIntentToContext`**，FW Phase 4 只读 ctx |
| S5 | Session 迁移 | `SessionMigrationPayload`（`types.ts`）含 `lexiconIntentSummary`，**无** `lexiconSessionIntent` | Phase 2 扩展 **`session-migration-v2`** 或字段追加 + 迁移测试 |
| S6 | `lexiconIntentSummary` | 仍在写入 | Phase 2 **双写**；Deprecation 时间表写入方案 |
| S7 | LLM prompt | `prompt_templates.py` **无** topicKeywords | Python + `lexicon-profile-decision-parser.ts` **同步扩展** |
| S8 | `topicKeywordPinyinKeys` | 方案写 LLM 输出 domain，**未写** Node 计算 | **禁止** LLM 输出 pinyin_key；统一 **`textToSyllables` + `syllablesKey`**（`phonetic/pinyin.ts`） |
| S9 | 单字 keyword | 无约束 | 单字 keyword 可进 **industry_routing**，**不得**进 base_lexicon recall |

### 2.5 测试与门禁

| # | 遗漏点 | 代码事实 | 建议补充 |
|---|--------|----------|----------|
| T1 | 静态 gate | `scripts/fw-detector-gate.mjs` + `freeze-contract.test.ts` | Phase 3 前：**freeze 例外文档** + gate 增加「V2 recall flag 下必须通过 dialog_200」 |
| T2 | 批测脚本 | `tests/run-fw-detector-dialog-200-batch.js` | Phase 3 **必跑**；记录 apply 率 / p50 pipeline |
| T3 | KenLM 回归 | `kenlm-span-gate.test.ts` | Phase 3 增加 **「weak_veto 行为字节级不变」** 断言 |
| T4 | V1 gate | `npm run lexicon:v3-gate` | V2 **独立** `lexicon:v2-shadow-gate`，勿破坏 V1 |
| T5 | Observability | `pipeline/lexicon-runtime-contract.ts` | Phase 1+ 扩展 **`lexicon_v2_runtime_status`** 等 extra 字段 |

---

## 3. 代码强制约束（实施方案必须显式写入）

### 3.1 冻结边界（比方案 §十一更细）

| 约束 | 代码 SSOT | 说明 |
|------|-----------|------|
| 主链步骤顺序 | `pipeline-mode-fw.ts`、`freeze-contract.test.ts` | ASR → FW_SPAN_DETECTOR → AGGREGATION → DEDUP → TRANSLATION |
| 业务文本 SSOT | `post-asr-routing.ts` → `resolveBusinessAsrText` | 只读 **`ctx.segmentForJobResult`** |
| FW 写回 | `applyFwSpanReplacements` | 方案已列；禁止改 overlap / greedy 语义 |
| KenLM | `asr-repair/kenlm-span-gate.ts` → `evaluateKenlmDecision` weak_veto | **`kenlmVetoThreshold` 默认 -0.2**；recall 在 KenLM **之前** |
| repairTarget pick | `fw-config.ts` 默认 **`candidateRequireRepairTarget: true`** | 无 `repair_target` 的候选 **不可 pick**（可进 recall） |
| Detector 分层 | `fw-detector-gate.mjs` | Detector **禁止** import recall / lexicon-runtime |
| Recover 隔离 | `freeze-contract.test.ts` | FW 源 **禁止** `legacy/recover`；**禁止**恢复 LEXICON_RECALL 步骤 |
| Orchestrator | 必须 **`runFwTopKDecisionPipeline`** | 禁止回退 `span-replacement-eval` / `pinyin-probe`（已删） |

### 3.2 Domain / general 策略（V2 核心约束）

| 约束 | V1 代码 | V2 要求 |
|------|---------|---------|
| 不用 general 作 FW 绕路 | `domain-filter.ts:13-14` 含 general → false | base/idiom **无 general 标签**；**禁止**把专业词标 general 进 V2 |
| enabledDomains 白名单 | `fw-config.ts` 默认 `tech_ai/travel/transport/restaurant` | Phase 3–4 需定义：Session **`primaryDomain`** 与 **`enabledDomains`** 关系（建议：recall 路由用 Session，**enabledDomains 作安全上限**） |
| domain_anchor | `fw-config.ts` → `domain_anchor.json` | Phase 4 fallback：`source=fallback_anchor`；**不替代** KenLM pick |
| LLM 不 pick 词条 | `prompt_templates.py` Rule 4 | 持久 gate；Intent 模块 **禁止** import `lookupTopKByPinyin` |

### 3.3 Recall 路由表（方案 §六需补充）

| span 条件 | 查询表 | 备注 |
|-----------|--------|------|
| 音节数 2–3，字长 2–3 | `base_lexicon` | 方案已定义 |
| 音节数 4，字长 4 | **`idiom_lexicon`**（+ 可选 domain 4 字专名） | 方案 P3 Target 未列 idiom，**与 §六矛盾** — 需统一 |
| 音节数 2–5 | `domain_lexicon(sessionDomain)` | `sessionDomain` Phase 3 可用 `profile.primaryDomain`；Phase 4 用 `lexiconSessionIntent` |
| merge 上限 | — | 建议 merge 后 **≤ topK×2** 再送 KenLM（DEC-V2-7） |
| dedupe | V1 `seen.has(hotword.id)` | V2 merge 按 **`id` 或 (tier, word)** dedupe |

### 3.4 Phase 0 硬约束

- [ ] **不**修改 `LexiconRuntime` / `lexicon-runtime-holder.ts` 行为  
- [ ] **不**修改 `local-span-recall.ts`  
- [ ] **不**替换 `node_runtime/lexicon/current`  
- [ ] 产出目录建议：`node_runtime/lexicon/v2_shadow/`（与 V1 隔离）  
- [ ] npm script 建议：`lexicon:build:v2-shadow`（**新增**，不改 `lexicon:build`）

---

## 4. Feature Flag 清单（方案未定义，实施前必填）

建议在 `node-config-types.ts` / `node-config-defaults.ts` 增加：

| 配置键 | 默认 | Phase | 作用 |
|--------|------|-------|------|
| `features.lexiconRuntimeV2.enabled` | `false` | P1 | 启用 V2 Runtime 加载（仍可不接 FW） |
| `features.lexiconRuntimeV2.bundlePath` | `node_runtime/lexicon/v2_shadow` | P1 | V2 bundle 目录 |
| `features.lexiconRuntimeV2.lruBucketCacheSize` | `512` | P1 | LRU 条数 |
| `features.lexiconV2.enabled` | `false`（已有） | P2 | CPU LLM Intent 调度 |
| `features.lexiconV2.sessionIntentWriteEnabled` | `false` | P2 | 写 `lexiconSessionIntent` |
| `features.fwDetector.useLexiconRuntimeV2Recall` | `false` | P3 | `recallSpanTopK` 走 V2 |
| `features.fwDetector.useIndustryRouting` | `false` | P4 | industry_routing 定域 |

**回滚：** 全部 flag `false` → 行为与现网 V1 一致。

---

## 5. 分 Phase 补充验收清单

### Phase 0 — Shadow Build

- [ ] 输入：`canonical_term` JSONL + `profile-registry.json`（复用 `validate-seed.mjs` 逻辑或 V2 专用 validate）  
- [ ] 分类规则文档：`v2-classify-row.mjs`（2/3 base、4 idiom、domain 专词、reject 理由码）  
- [ ] 输出：`manifest_v2.json`、`lexicon_v2.sqlite`、`checksum.txt`、`stats_v2.json`、**`rejected_v2.jsonl`**  
- [ ] stats 含：各表行数、pinyin_key 分布、per-bucket max、跨表冲突数  
- [ ] 与 V1 `combined_entries` diff 报告（可选脚本）  
- [ ] **零** runtime / 主链改动  

### Phase 1 — LexiconRuntimeV2

- [ ] 新 holder：**不**替换 `getLexiconRuntime()` 单例行为  
- [ ] SQL prepared statements + LRU（key = tier + domain + pinyin_key）  
- [ ] 单测：查询延迟、cache hit、manifest_v2 checksum  
- [ ] memory benchmark 脚本（对比 V1 全量 load）  
- [ ] **仍不**接 FW  

### Phase 2 — Session Intent SSOT

- [ ] 类型：`session-runtime/types.ts`  
- [ ] 写入：`session-finalize.ts` Intent 回调  
- [ ] 绑定：`turn-profile-binding.ts` + `job-context.ts`  
- [ ] 扩展：`services/lexicon_intent_cpu/prompt_templates.py` + parser  
- [ ] `result.extra` / `session-intent-diagnostics` 暴露 SSOT 摘要  
- [ ] **recall 仍 V1**；仅 diagnostics  
- [ ] session migration 测试更新  

### Phase 3 — V2 Recall

- [ ] 改造 **`local-span-recall.ts`**（feature flag 分支）  
- [ ] 输出契约 **`LocalSpanRecallHit`** 不变  
- [ ] alias / latin 策略已决策（§2.1 A3/A4）  
- [ ] idiom 路由已决策（§3.3）  
- [ ] **`freeze-contract` 例外 PR** + dialog_200 **200/200**  
- [ ] `fw-detector-gate.mjs` 更新  
- [ ] KenLM weak_veto 单测 **无 diff**  

### Phase 4 — Industry Routing

- [ ] `industry_routing_lexicon` seed + build  
- [ ] 定域：topicKeywordPinyinKeys → routes → 修正 primaryDomain  
- [ ] Fallback 链：LLM → routing → domain_anchor → enabledDomains union（见审计报告）  
- [ ] LLM 与 routing **冲突策略**（DEC-V2-4）已签字  

---

## 6. 待决策项（实施方案未闭合）

| ID | 问题 | 选项 | 审计建议 |
|----|------|------|----------|
| DEC-1 | P1.3 `common5_zh_v2` 归属 | base / domain / 丢弃 | 单独 **common tier** 或并入 domain |
| DEC-2 | Phase 3 是否启用 idiom 表 | 是 / 否 | **是**（与 §六 V2 流程一致）；4 字 span 查 idiom |
| DEC-3 | domain 专词长度上限 | 2–5 与 FW span 对齐 | 允许 2–5，build validate 与 FW `MAX_SYLLABLES=5` 一致 |
| DEC-4 | V2 merge 后 domainMatched | 沿用 enabledDomains / 仅 Session 域 | Session 主路由 + enabledDomains **安全裁剪** |
| DEC-5 | alias 实现 | build 物化行 / runtime 展开 JSON | build **物化 alias 行**（性能稳定） |
| DEC-6 | latin token | V1 exact 回退 / domain 表 | Phase 3 前 **V1 exactIndex 回退** 可接受 |
| DEC-7 | manifest 版本字符串 | `lexicon-v2-shadow-v1` | 与 V1 `final-v1` **永久区分** |
| DEC-8 | Freeze 例外范围 | 仅 local-span-recall | 书面批准 + dialog_200 gate |

---

## 7. 合并 Check List（方案 §十 + 本清单）

### 架构（冻结）

- [ ] 不修改 ASR→FW→AGG→DEDUP→TRANSLATION 顺序  
- [ ] 不修改 `segmentForJobResult` SSOT  
- [ ] 不修改 `kenlm-span-gate.ts` weak_veto 语义  
- [ ] 不修改 `fw-topk-decision-pipeline` pick/KenLM 段  
- [ ] 不恢复 Recover / 不 import `legacy/recover` 到 FW  
- [ ] Detector 不引用 lexicon recall  

### 数据

- [ ] base 仅 2/3 字 CJK，无专业词  
- [ ] idiom 独立表，4 字成语/熟语  
- [ ] domain 独立表，`domain_id` 非 general  
- [ ] industry_routing 独立表，有 PK/UNIQUE  
- [ ] `pinyin_key` = `syllablesKey`（与 runtime 一致）  
- [ ] 不把 general 作为 V2 FW 过滤绕路  
- [ ] alias 策略已决策并实现  
- [ ] common5 分层已决策  

### Runtime

- [ ] V1 `LexiconRuntime` 仍为默认  
- [ ] V2 独立 bundle 路径 + manifest schema  
- [ ] V2 不触发 `assertLexiconManifestReady(final-v1)`  
- [ ] SQL + LRU 单测通过  
- [ ] Feature flag 可一键回滚  

### Session

- [ ] `LexiconSessionIntent` 类型 + Session 字段  
- [ ] `JobContext` 只读绑定  
- [ ] topicKeywords LLM 输出 + Node pinyinKey  
- [ ] 与 profile 同步 / 门限 0.75  
- [ ] session migration 含新字段  
- [ ] LLM 不参与词条 pick（gate）  

### Recall（Phase 3+）

- [ ] `LocalSpanRecallHit` 契约不变  
- [ ] base ∪ domain ∪ idiom 路由表已实现  
- [ ] merge dedupe + topK 上限  
- [ ] `candidateRequireRepairTarget` 仍生效  
- [ ] dialog_200 全量 PASS  
- [ ] 无劣化 golden / false repair  

### Build（Phase 0+）

- [ ] `lexicon:build:v2-shadow` 命令  
- [ ] stats_v2 + rejected_v2  
- [ ] checksum 与 manifest 一致  
- [ ] 不覆盖 V1 current bundle  

---

## 8. 建议修订实施方案的章节映射

| 本清单章节 | 建议合并到实施方案 |
|------------|-------------------|
| §2.1–2.3 | §二 架构、§三 数据库、§六 Recall |
| §2.4 | §四 Session Intent |
| §3.3 | §六 Recall（新增路由表） |
| §4 | 新增 **§ Feature Flags** |
| §5 | 各 Phase 小节末尾 **验收标准** |
| §6 | 新增 **§ 待决策项** |
| §7 | 替换 §十 Check List |

---

## 9. 关键代码索引（实施时对照）

```
# V1 Build
scripts/lexicon/lib/build-bundle.mjs
scripts/lexicon/lib/migrate-seed.mjs
scripts/lexicon/lib/validate-seed.mjs

# V1 Runtime
main/src/lexicon/lexicon-runtime.ts
main/src/lexicon/lexicon-bundle-path.ts
main/src/lexicon/scored-lexicon.ts          # assertLexiconManifestReady final-v1

# FW Recall（Phase 3 改造点）
main/src/lexicon/local-span-recall.ts
main/src/lexicon/pinyin-topk-lookup.ts
main/src/fw-detector/fw-topk-decision-pipeline.ts

# Domain / Score
main/src/lexicon/domain-filter.ts
main/src/lexicon/candidate-score.ts
main/src/lexicon/domain-boost-calculator.ts

# Session / Intent
main/src/session-runtime/session-finalize.ts
main/src/session-runtime/types.ts
main/src/session-runtime/turn-profile-binding.ts
main/src/lexicon-v2/cpu-llm-model-runner.ts
services/lexicon_intent_cpu/prompt_templates.py

# Gate
scripts/fw-detector-gate.mjs
main/src/fw-detector/freeze-contract.test.ts
main/src/node-config-defaults.ts
```

---

**结论：** 《实施方案》方向与冻结主链 **一致**，可直接启动 **Phase 0**；但在 Phase 1 前必须闭合 **§4 Feature Flags** 与 **§6 待决策项**，并在 Phase 3 前补齐 **alias/idiom/latin、LocalSpanRecallHit 契约、freeze 例外** 等 §2–§3 约束，否则易与现网 `fw-topk-decision-pipeline` / `domain-filter` 行为冲突。
