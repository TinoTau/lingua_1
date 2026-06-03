# Pinyin IME Decoder / libpinyin 候选生成 Spike 可行性审计

> **日期：** 2026-06-02  
> **性质：** 只读代码与生态调研；**未**改代码、配置、依赖或 Patch  
> **主题：** 在冻结 FW 架构下，评估「拼音输入法式解码器」作为 **Candidate Generator Spike** 的可行性  
> **关联审计：** [FW_Decoder_Capability_Audit_2026_06_02.md](./FW_Decoder_Capability_Audit_2026_06_02.md)、[FW_Quality_Audit_Post_Chain_Fix_2026_06_02.md](./FW_Quality_Audit_Post_Chain_Fix_2026_06_02.md)

---

## 1. Executive Summary

| 结论项 | 判定 |
|--------|------|
| **是否建议先做独立 Spike（方案 D）** | **是** — 唯一符合「不改冻结主链、可快速回滚」的路径 |
| **是否允许本轮接入主链** | **否** — 需 Spike 数据证明对 Detector Miss / Recall Empty 有净收益 |
| **是否需要改冻结架构** | **Spike 阶段：否**；**主链接入：是（受控扩展）** — 需在 `fw-detector` 内增加候选源，不替代 Metadata Gate / KenLM / Apply 白名单 |
| **libpinyin 是否适合 Spike 对象** | **有条件适合** — 句级拼音→中文 + nbest 与目标形态一致；**GPL-3.0** 与 **Windows 原生集成** 是主要 blocker |
| **librime 备选** | 更重、schema/词库体系独立；适合长期 IME 产品化，**不适合**最小 Spike |
| **能否替代 span detection / span recall** | **不能完全替代**；可 **补充** `no_spans` / 同音串错误，**不能**覆盖 alias exact、非同音 ASR 错字、repair_target 门控缺失 |
| **Lexicon V3.1 词库复用** | **可以** — 只读 SQLite 导出临时 phrase/user dict，**不得**新建 Runtime / JSONL Source |
| **是否值得继续推进** | **值得做只读 Spike 实验**（1–2 人日脚本 + sidecar），在 GPL/Windows 决策前 **不** 承诺主链 |

**一句话：** 技术上可把 IME 解码器挂在 **「句级候选 → 现有 `rerankFwSentences` → `applyFwSpanReplacements`」** 之后半段；工程上应 **先离线 dialog_200 Spike**，避免触碰冻结写点与 GPL 打包风险。

---

## 2. Current Frozen Architecture Boundary

以下边界来自当前代码与冻结合约（`freeze-contract.test.ts`、`fw-detector/README.md`），**本轮 Spike 不得违反**：

| 禁止项 | 代码事实 |
|--------|----------|
| 恢复 CTC 主链 | `isFwDetectorEngineEnabled()` 时 ASR 不写入 `ctx.asrNbest`（`asr-step.ts`） |
| 第二套 ASR / 改切片 / AudioAggregator | `runAsrStep` 仅合并 segment 文本，不改聚合器 |
| ASR Text Chain | `rawAsrText` / `asrMergeProbeText` / `segmentForJobResult` 初始化在 `asr-step`；FW 读 `rawAsrText` |
| Lexicon V3.1 单 Runtime + Patch | `lexicon-runtime-v2.ts` 读 `node_runtime/lexicon/v3`；Patch 走 `lexicon-patch-v3/` |
| 绕过 KenLM / 直接改 final | `rerankFwSentences` + `minDeltaToReplace`；`resolveBusinessAsrText` 仅 `segmentForJobResult` |
| FW 主链 import legacy asr-repair | `freeze-contract.test.ts` 静态禁止 |

**允许（Spike 语义下）：** 在 **不改变上述 SSOT** 的前提下，增加 **额外候选生成函数**，输出与 `SentenceCombination` 同构的结构，交给 **已有** KenLM 与 apply。

---

## 3. Current FW Post-processing Chain

### 3.1 Pipeline 步骤顺序

```
ASR (asr-step)
  → FW_SPAN_DETECTOR (fw-detector-step)
  → AGGREGATION (aggregation-step)
  → [5015/5016/5017 默认 OFF]
  → DEDUP → TRANSLATION → TTS
  → buildJobResult (result-builder-core / result-builder-fw)
```

注入点：`fw-detector/pipeline-mode-fw.ts` 在 `ASR` 后插入 `FW_SPAN_DETECTOR`；`AGGREGATION` 依赖 `FW_SPAN_DETECTOR`。

### 3.2 ASR → 文本 SSOT（Text Chain Fix）

| 字段 | 写入点 | 用途 |
|------|--------|------|
| `ctx.rawAsrText` | `asr-step.ts` 合并全部 segment 后 **一次赋值** | FW **唯一**业务基线（immutable） |
| `ctx.asrMergeProbeText` | 同 merged 文本 | 诊断 |
| `ctx.segmentForJobResult` | ASR 后 init；FW apply 后更新 | NMT / `text_asr` SSOT |
| `ctx.asrText` | 诊断 | **禁止**作 NMT 输入 |

### 3.3 FW 编排（`runFwDetectorOrchestrator`）

```
rawText = ctx.rawAsrText
  → resolveFwSpans (默认 fw_metadata_gate)
       · alias exact / segment avg_logprob / word prob
       · legacy fallback ≤1 span (可选)
  → 若 spanDiagnostics.length === 0 → early exit, segmentForJobResult = rawText, reason=no_spans
  → runFwSentenceRerankPipeline (默认) 或 runFwTopKDecisionPipeline (回滚)
       · 每 span: recallSpanTopK → V2 SQLite (pinyin_key + length)
       · buildSentenceCandidates (笛卡尔积, cap maxSentenceCandidates=16)
       · rerankFwSentences (KenLM batch, minDeltaToReplace=0.03)
       · mapSentenceToApprovedReplacements (candidateRequireRepairTarget=true)
  → applyFwSpanReplacements(rawText, approved)
  → ctx.asrRepairApplied = approved.length > 0
```

### 3.4 KenLM 位置

- 实现：`main/src/asr-repair/sentence-rerank/kenlm-scorer.ts` → `phonetic-correction/lm-scorer`
- FW 句级：`fw-detector/rerank-fw-sentences.ts`
- **不是**独立 top-level `kenlm/` 或 `sentence-rerank/` 目录（审计清单路径以 `asr-repair/sentence-rerank/` 为准）

### 3.5 与 post-fix 基线的关系

`FW_Quality_Audit_Post_Chain_Fix`（n=68 成功样本）：

- **Detector Miss** 仍约 **70%** 失败来源（28/40）— Metadata Gate 未标 span
- **Recall Empty** 在触发样本中 **41.2%**（7/17）
- **FW Applied = 0** — 有句级 rerank 但 KenLM 常 `pickedIsRaw`

IME Spike 应对齐失败标签：**no_spans**、**no_candidates**、**Detector Miss** 子集（同音/短语错误）。

---

## 4. Pinyin IME Decoder Concept（目标形态）

### 4.1 提议数据流

```
rawAsrText (错误汉字)
  → 拼音流（无调/有空格，如 pinyin-pro）
  → Pinyin IME Decoder (libpinyin 等)
  → topK 整句中文候选
  → 与 rawAsrText 做 diff → SpanReplacementPick[]
  → 现有 rerankFwSentences + applyFwSpanReplacements
```

### 4.2 与当前 FW 的差异

| 维度 | 当前 FW | IME Decoder Spike |
|------|---------|-------------------|
| 候选粒度 | **先 span** 再句级组合 | **先整句** 再反推 span |
| 候选来源 | Lexicon V2 `pinyin_key` 查表 | IME 内置词表 + ngram + **可导入 user dict** |
| 切分 | Metadata Gate（非 blind sliding） | IME 内部分词/消歧 |
| 爆炸控制 | `maxSentenceCandidates=16` + per-span limit | IME beam/LM；需 cap topK |

### 4.3 关键前提（易忽略）

1. **拼音来自错误汉字**：仅当错误字与正确字 **同音（或近音）** 时，「汉字→拼音→解码」才可能回到正确句；**非同音 ASR 错误**（如「讨论→头论」若拼音不同）IME **无法** 修复。  
2. **多音字**：`pinyin-pro` 默认消歧与 ASR 错字消歧 **不一致**，需 Spike 量化误差。  
3. **英文/数字**：libpinyin 以中文音节为主；需 **CJK 段切分** 或保留非 CJK 字面（与现有 `phonetic_correction` 路径类似）。

---

## 5. libpinyin Feasibility

### 5.1 定位

| 项 | 结论 |
|----|------|
| 是否 IME decoder core | **是** — 项目自述为 intelligent **sentence-based** 中文拼音输入法算法库 |
| 拼音串 → 中文 | **是** — `pinyin_parse_more_full_pinyins` + `pinyin_guess_sentence` |
| 句级 decode | **是** — `pinyin_guess_sentence` / `pinyin_get_sentence(instance, index, …)`（index 为 nbest） |
| 候选 / topK | **是** — `pinyin_get_n_candidate` / `pinyin_get_candidate`；句级 nbest 索引 |
| 自定义词库 / 词频 | **是** — user table、`importPinyinDictionary`（ibus-libpinyin 暴露）；phrase/bigram 表 |
| 简繁 | **间接** — 主表偏简体；繁体需 addon 或后处理 OpenCC（非 libpinyin 核心） |
| 英文混杂 | **弱** — 需分段；英文一般不进入 full pinyin parse |
| Windows / Node | **弱** — 官方生态偏 Linux/ibus；Windows 需 **自编译 DLL** 或 **sidecar 进程** |
| License | **GPL-3.0** — 与 Electron 闭源分发存在 **copyleft 风险**（需法务评审；Spike 可用 CLI/sidecar 隔离） |

### 5.2 典型 API 流程（C API，`pinyin.h`）

1. `pinyin_init` / `pinyin_alloc_instance`  
2. `pinyin_parse_more_full_pinyins(instance, "jin tian tao lun …")`  
3. `pinyin_guess_sentence(instance)`  
4. `pinyin_get_sentence(instance, index, &utf8_sentence)` — **index 为 nbest**  
5. 用户词典：`pinyin_import` / iterator 导出（见 ibus-libpinyin 封装）

### 5.3 Node 绑定现状

| 方式 | 可行性 |
|------|--------|
| 官方 npm 包 | **无** 维护良好的 libpinyin Node 绑定 |
| `pinyin-pro` / `@napi-rs/pinyin` | **仅汉字↔拼音**，**无** IME 句级解码 |
| **sidecar**（推荐 Spike） | C++ 小工具 / Python `ctypes` 调 `.so` / `.dll`，stdin 拼音 stdout JSON topK |
| **Python bridge** | 若有 `python-libpinyin` 或自写 binding，Spike 最快 |
| Electron 内嵌 | 需 native addon + GPL 合规，**不建议** 作为第一步 |

---

## 6. librime Feasibility（备选）

| 项 | librime | libpinyin |
|----|---------|-----------|
| 定位 | 全功能 Rime **引擎**（schema + translator + filter） | **算法库**，偏拼音解码 |
| 自定义词库 | YAML `*.dict.yaml` + `import_tables` | user phrase / binary dict |
| 简繁 | OpenCC filter 内置 | 需额外处理 |
| 体积/复杂度 | **高**（引擎、部署、schema） | **中**（库 + 数据目录） |
| Spike 适用性 | **低** — 引入第二套 IME 配置体系 | **中** — 更接近「解码器」单职能 |
| License | LGPL/BSD 组件混合（见各模块） | **GPL-3.0** 单一明确 |

**结论：** Spike 优先 **libpinyin**；librime 仅在需要 schema 级定制（云输入、繁简、英文混排）时再评估，**不符合**「最小 Spike」原则。

---

## 7. Integration Options（插入点 A–D）

### 方案 A：FW Detector 之后、Recall 之前（fallback candidate generator）

| 项 | 评估 |
|----|------|
| 改动 | `fw-detector-orchestrator.ts` 或 `fw-sentence-rerank-pipeline.ts` 注入 IME 句候选 |
| 冻结风险 | **中** — 触及主链编排；需冻结合约新增测试 |
| 回滚 | 配置开关 `features.fwDetector.imeCandidateGenerator.enabled` |
| Spike 适合度 | **中** |

### 方案 B：`no_spans` 时触发

| 项 | 评估 |
|----|------|
| 改动 | `runFwDetectorOrchestrator` 在 L316–321 early exit 分支改为「尝试 IME → 若有 diff 则走 rerank」 |
| 冻结风险 | **中偏高** — 改变 `no_spans` 语义 |
| 业务对齐 | **高** — 直接针对 Detector Miss（post-fix 基线 70% 失败） |
| Spike 适合度 | **中高**（主链第二阶段） |

### 方案 C：`Recall Empty` / `no_candidates` 时触发

| 项 | 评估 |
|----|------|
| 改动 | `runFwSentenceRerankPipeline` 在 `spanSets` 空或 recall 空时补候选 |
| 冻结风险 | **中** |
| 业务对齐 | **中** — 覆盖已触发但无替换词的案例 |
| Spike 适合度 | **中** |

### 方案 D：独立测试脚本，不接主链（dialog_200 Spike）

| 项 | 评估 |
|----|------|
| 改动 | `tests/spike-pinyin-ime-dialog200.mjs`（新文件，不改 `main/src`） |
| 冻结风险 | **无** |
| 回滚 | 删除脚本即可 |
| Spike 适合度 | **最高** |

### 推荐顺序

**D →（数据阳性）→ B 或 C →（GPL/Windows 解决后）→ A**

**优先考虑 D**，理由：

1. 不修改 `segmentForJobResult` 写点白名单  
2. 不触碰 `freeze-contract.test.ts`  
3. 可直接消费 `fw-detector-dialog-200-batch-result.json` 的 `extra.raw_asr_text`  
4. 与「不要复杂补丁」一致  

### 最小主链插入点（Spike 成功后）

**文件：** `fw-detector/fw-sentence-rerank-pipeline.ts`  
**位置：** `buildSentenceCandidates` **之前或并行**，合并 IME 产生的 `SentenceCombination[]`，总数仍 `slice(0, maxSentenceCandidates)`。  
**编排入口：** 仍只通过 `runFwDetectorOrchestrator` → **不** 新 Pipeline 步骤类型。

**适配层职责：**

1. `rawAsrText` → `pinyin-pro`（`toneType: 'none'`, `type: 'array'`）→ 空格 join  
2. sidecar → `string[]` topK sentences  
3. `diffAlign(raw, candidate)` → `{ start, end, word, repairTarget }[]`（repairTarget 查 V2 SQLite `repair_target`）  
4. 组装为 `SpanReplacementPick[][]` 或扁平 `SentenceCombination[]`  
5. 交给现有 `rerankFwSentences`

---

## 8. Lexicon V3.1 Data Reuse

### 8.1 SQLite 现状（`node_runtime/lexicon/v3/lexicon.sqlite`）

运行时表（`lexicon-runtime-v2.ts`）：

| 表 | 可用字段 |
|----|----------|
| `base_lexicon` | `pinyin_key`, `tone_pinyin_key`, `word`, `prior_score`, `repair_target`, `enabled`, `aliases`, `canonical_word`, `is_alias` |
| `idiom_lexicon` | 同上 |
| `domain_lexicon` | + `domain_id` |
| `industry_routing_lexicon` | `pinyin_key`, `keyword`, `domain_id`, `weight` |

`pinyin_key` 格式：`syllables.join('|')`（如 `hou|xuan|sheng|cheng`），与 FW 一致。

### 8.2 导出为 IME 词表（仅 Spike 临时文件）

| Lexicon 字段 | IME 用途 |
|--------------|----------|
| `word` + `pinyin_key` | user phrase / system phrase 行 |
| `prior_score` | 词频权重（需映射到 libpinyin 频率放大规则） |
| `repair_target=1` | Spike 统计子集；主链仍走 `candidateRequireRepairTarget` |
| `domain_id` | 分 domain 导出多个 addon dict，对话场景 boost |
| `enabled` | 过滤 |

**约束遵守：** 只读 `Database(readonly: true)`；导出到 `tests/spike/_tmp_ime_dict.txt`；**不** 新 JSONL Source、**不** `active_bundle`、**不** 第二 Runtime。

### 8.3 与现有 recall 的关系

- V2 recall：**span 长度 = 词长** SQL `length(word) = ?` — 精确窗  
- IME：**全局音节切分** — 可提出 **跨 span** 候选，但仍需 diff 落回 span 才能 `applyFwSpanReplacements`  
- **词库覆盖仍必要：** IME 内置通用词表 ≠ 领域 canonical；**Lexicon 导出**用于拉高领域词在 IME 内的排名，与 FW recall **互补**

---

## 9. Spike Validation Plan（设计 only，本轮不执行）

### 9.1 输入

| 来源 | 字段 |
|------|------|
| `tests/fw-detector-dialog-200-batch-result.json` | `extra.raw_asr_text`, `fw_detector.reason`, `fw_detector.summary` |
| `test wav/dialog_200/cases.manifest.json` | `utterance`（reference） |

**分层抽样：**

- 全量成功 case（~68）  
- 子集：**Detector Miss**（CER>0.15 且未触发）  
- 子集：**Recall Empty** / **no_candidates**  
- 子集：同音错字（CER 低但未 exact）

### 9.2 流程

```
1. raw_asr_text
2. CJK 段提取 + pinyin-pro → 拼音流
3. sidecar libpinyin → topK sentences (K=10)
4. char-level diff vs raw → 替换列表
5. 指标：
   - ref in top1/top3/top5/top10 (exact norm)
   - ref 是否出现在任一 diff 替换片段
   - 候选数、P50/P95 延迟
   - 失败案例分类（非同音 / 多音 / 英文 / 过长）
```

### 9.3 脚本建议（未来实现，非本轮）

| 文件 | 作用 |
|------|------|
| `tests/spike/pinyin-ime-decode-sidecar/` | C++ 或 Python 调 libpinyin |
| `tests/spike/export-lexicon-v3-ime-dict.mjs` | SQLite → dict 文本 |
| `tests/spike/run-pinyin-ime-dialog200-spike.mjs` | 批处理 + JSON 报告 |
| `tests/spike/analyze-pinyin-ime-spike.mjs` | 命中率汇总 |

### 9.4 成功门槛（建议）

| 指标 | 门槛（建议） |
|------|----------------|
| Detector Miss 子集 top5 命中率 | **>15%** 才考虑主链 B |
| Recall Empty 子集 top3 命中率 | **>25%** |
| P95 延迟（单句，PC） | **<200ms** sidecar |
| 劣化率（top1 更差） | **<5%** |

---

## 10. Risk Assessment

| 风险 | 等级 | 说明 |
|------|------|------|
| GPL-3.0 传染 | **高** | Electron 节点分发需隔离进程或动态链接合规方案 |
| Windows 构建 | **高** | 无官方 win32 预编译；CI/家用 PC 需 MSVC 或 WSL sidecar |
| 拼音推导错误 | **中** | 错字→拼音≠意图拼音；多音字 |
| 非同音 ASR 错误 | **高** | IME 无法修复；占 Dialog200 一定比例 |
| 与 KenLM 冲突 | **低** | 仍走 `minDeltaToReplace`；可能继续 `pickedIsRaw` |
| `repair_target` 门控 | **中** | IME 候选词需在 V3 标 `repair_target` 才 apply |
| 英文/数字句 | **中** | 需规则保留；否则 parse 失败 |
| 运行时复杂度 | **中** | sidecar + 每 job 1 次 decode；可仅 `no_spans` 触发降本 |
| 冻结合约回归 | **中**（主链） | 新增候选源需扩展 `freeze-contract` |
| 第二套词库误解 | **低**（若遵守导出临时文件） | 仅 Spike dict，不改 Runtime |

---

## 11. 必须回答的业务问题（§10）

| # | 问题 | 答案 |
|---|------|------|
| 1 | 能否避免 blind sliding window？ | **Spike 句级解码本身不用 sliding window**；主链仍保留 Metadata Gate，IME **不替换** Gate |
| 2 | 能否解决拼音切分候选爆炸？ | **在 IME 内部由 LM/beam 处理**；对外仍须 `maxSentenceCandidates` cap；优于笛卡尔积爆炸，但 **长句 topK 仍贵** |
| 3 | 能否替代 span proposal？ | **不能整体替代**；可 **减少** 对「同音 span recall」的依赖，**不能** 替代 alias/low-prob 信号 |
| 4 | 是否仍依赖词库覆盖？ | **是** — 领域词需 V3 导出 boost；否则 IME 通用词表偏新闻/通用语料 |
| 5 | 领域词 / 中英混杂 | **领域词：可** 通过 SQLite 导出优化；**英文：需** 切分保留，libpinyin 不擅长 |
| 6 | 节点运行时复杂度？ | sidecar + 一次 decode/句；**高于** 纯 FW，**低于** 多服务 LLM |
| 7 | 家用 PC？ | **可行** 若 sidecar 本地、按需触发；否则 WSL 增加运维负担 |
| 8 | 符合「不复杂补丁、不二套词库、不改冻结主链」？ | **仅方案 D 完全符合**；主链接入需开关且过 freeze 审计 |
| 9 | 是否建议进入 Spike？ | **建议进入（方案 D）** |
| 10 | 最小开发范围？ | ① sidecar POC ② SQLite→dict 导出 ③ dialog200 批测脚本 ④ 命中率报告；**不改** `main/src` |

---

## 12. Recommended Next Step

1. **法务/许可：** 确认 GPL sidecar 进程模式是否可接受（推荐 **进程隔离 + 仅 IPC**，不静态链接进 Electron）。  
2. **技术 POC（1–2 天）：** Linux/WSL 编译 libpinyin，实现 `echo "hou xuan" | ime-decode --top 10`。  
3. **Spike 批测：** 跑 §9 流程，对比 Detector Miss / Recall Empty 子集。  
4. **决策门：**  
   - 命中率达标 + GPL 可接受 → 设计 **方案 B**（`no_spans` 分支）+ `fw-config` 开关；  
   - 不达标 → 归档，**不** 进入主链。  
5. **明确不做：** CTC 恢复、新 Pipeline 步骤、替换 Lexicon V3.1/Patch/Scheduler、跳过 KenLM。

---

## 13. Explicit Non-goals

- 新 ASR、新 Runtime、新 JSONL Source Tree、dynamic/active_bundle  
- 恢复 CTC n-best 主链  
- 修改 AudioAggregator、ASR 切片、Text Chain Fix  
- libpinyin / IME 作为业务主链或替代 NMT/Scheduler/Patch Service  
- 直接写 `segmentForJobResult` 绕过 `applyFwSpanReplacements` 与 KenLM  
- 本轮安装依赖、提交代码、生成运行时代码  

---

## 附录 A — 审计文件索引

| 模块 | 路径 |
|------|------|
| ASR | `main/src/pipeline/steps/asr-step.ts` |
| FW 步骤 | `main/src/pipeline/steps/fw-detector-step.ts` |
| FW 编排 | `main/src/fw-detector/fw-detector-orchestrator.ts` |
| Metadata Gate | `main/src/fw-detector/fw-metadata-span-gate.ts` |
| 句级 Rerank | `main/src/fw-detector/fw-sentence-rerank-pipeline.ts` |
| KenLM | `main/src/asr-repair/sentence-rerank/kenlm-scorer.ts` |
| 候选组合 | `main/src/fw-detector/build-sentence-candidates.ts` |
| V2 Recall | `main/src/lexicon-v2/recall-span-topk-v2.ts`, `local-span-recall.ts` |
| Patch V3 | `main/src/lexicon-patch-v3/` |
| 聚合 | `main/src/pipeline/steps/aggregation-step.ts` |
| SSOT 路由 | `main/src/pipeline/post-asr-routing.ts` |
| Result | `main/src/pipeline/result-builder-core.ts` |
| 翻译输入 | `main/src/pipeline/steps/translation-step.ts` |
| 拼音工具 | `main/src/lexicon/phonetic/tone-pinyin.ts`（`pinyin-pro`） |
| Dialog200 | `tests/run-dialog200-timed-batch.mjs`, `tests/analyze-dialog200-quality-perf.mjs` |
| 词库 | `node_runtime/lexicon/v3/` |

---

## 附录 B — 最终结论（必填）

| 项 | 结论 |
|----|------|
| **是否建议先做独立 Spike** | **是（方案 D）** |
| **是否允许本轮接入主链** | **否** |
| **是否需要改冻结架构** | **Spike 否；主链接入时需要受控扩展（候选源 + 配置开关），不推翻冻结契约** |
| **License 风险** | **有 — libpinyin GPL-3.0** |
| **Windows 集成风险** | **有 — 需自编译或 WSL sidecar** |
| **是否值得继续推进** | **值得 — 仅限离线 Spike；主链待 Spike 数据与合规通过后决策** |

---

*本报告为可行性审计，不构成正式架构设计或实施承诺。*
