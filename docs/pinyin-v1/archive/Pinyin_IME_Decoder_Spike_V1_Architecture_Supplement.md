# Pinyin IME Decoder Spike V1.0 — 架构补充文档

来源：Pinyin_IME_Decoder_Spike_Architecture_Supplement_Checklist
用途：作为 FINAL Architecture 的补充约束文档

说明：
- 本文档不替代 FINAL Architecture。
- 本文档用于开发前补充冻结边界、数据结构、接口约束、KenLM复用方式、Dialog200验证标准。
- 本文档中的约束优先级高于 Spike 开发阶段的临时实现习惯。
- 不允许突破 Lexicon V3.1、FW Detector、Patch Service、Scheduler 的冻结边界。

---

# Pinyin IME Decoder Spike — 架构补充与约束清单

> **对照文档：** [Pinyin_IME_Decoder_Spike_FINAL_Architecture.md](./Pinyin_IME_Decoder_Spike_FINAL_Architecture.md)（V1.0 FINAL，2026-06-03）  
> **代码基准：** `electron_node/electron-node/main/src/`（2026-06-03 仓库状态）  
> **关联：** [Pinyin_IME_Decoder_Feasibility_Audit_2026_06_02.md](./Pinyin_IME_Decoder_Feasibility_Audit_2026_06_02.md)

本文档列出 FINAL 架构中**未写清或与代码不一致**的项，供 Spike 实施前逐项勾选。不改变 FINAL 的定位（离线 Candidate Generator Spike、不进主链）。

---

## 1. 使用说明

| 标记 | 含义 |
|------|------|
| ☐ | 实施前待确认/待实现 |
| ☑ | 已在 FINAL 中覆盖且与代码一致 |
| ⚠ | FINAL 与代码不一致，**必须**按本清单修正 |
| 🔒 | 冻结合约/测试约束，Spike 不得破坏 |

---

## 2. 冻结边界补充（FINAL §二 未列项）

FINAL 已列禁止项；以下须**追加**到 Spike 自检（来自 `freeze-contract.test.ts`、`fw-detector/README.md`）：

| # | 约束 | 代码依据 | Spike 要求 |
|---|------|----------|------------|
| B-01 | 🔒 禁止恢复 CTC 主链 / 写入 `ctx.asrNbest` | `asr-step.ts`：`isFwDetectorEngineEnabled()` 时不写 nbest | Spike 不读 nbest、不依赖 CTC |
| B-02 | 🔒 禁止改 `rawAsrText` 写点 | 仅 `asr-step` 一处 `ctx.rawAsrText = mergedAsrText` | 只读 `extra.raw_asr_text` |
| B-03 | 🔒 禁止新增 `segmentForJobResult` 写点 | 白名单：`asr-step`、`fw-detector-*`、`aggregation`、`enhancement/*`、`legacy/*` | Spike **不写** JobContext |
| B-04 | 🔒 禁止 `resolveBusinessAsrText` fallback 到 `asrText`/`rawAsrText` | `post-asr-routing.ts` | Spike 评估用 `raw_asr_text`，不与 `text_asr` 混用 |
| B-05 | 🔒 FW 主链源文件禁止 static import `legacy/asr-repair` | `freeze-contract.test.ts` | Spike 代码放 `tests/spike/`，不 import 进 `fw-detector/` |
| B-06 | 禁止改 `faster-whisper-asr-strategy`（beam=1、condition_on_previous_text=false） | `task-router/faster-whisper-asr-strategy.ts` | 与 Spike 无关，但批测依赖该 ASR |
| B-07 | 禁止改 Pipeline 步骤表（不新增 `PINYIN_IME` 等 Step） | `pipeline-mode-config.ts` | 未来接入仅改 `fw-sentence-rerank-pipeline` 内部 |
| B-08 | 禁止改 `AudioAggregator` / `pipeline-orchestrator` | 冻结审计 | — |
| B-09 | 禁止改 `lexicon-patch-v3` / Patch 协议 | `lexicon-patch-v3/` | Exporter **只读** sqlite |
| B-10 | 禁止改 Scheduler / NodeAgent / IPC | — | — |

---

## 3. 主链事实校正（FINAL §一、§三）

| # | FINAL 表述 | 代码事实 | 补充约束 |
|---|------------|----------|----------|
| C-01 | 主链「Detector → Recall → KenLM」 | 实际为 **`FW_SPAN_DETECTOR` 一步**内：`resolveFwSpans` → `runFwSentenceRerankPipeline`（含 recall + `buildSentenceCandidates` + `rerankFwSentences`）→ `applyFwSpanReplacements` | Spike 文档应写清：**Recall 非独立 Pipeline 步骤** |
| C-02 | KenLM 在 NMT 前 | Pipeline 顺序：`ASR → FW_SPAN_DETECTOR → AGGREGATION → DEDUP → TRANSLATION` | Spike **不参与** AGGREGATION 之后步骤 |
| C-03 | 「Final Selection」 | 生产路径：`rerankFwSentences` + `minDeltaToReplace`（默认 **0.03**）→ `mapSentenceToApprovedReplacements` → `applyFwSpanReplacements`；常 `pickedIsRaw=true` | Spike 须区分指标：**① ref∈topK（IME）** vs **② KenLM 后 would-apply** |
| C-04 | Detector Miss 最大损失 | Post-fix 基线（n≈68）：约 **70%** 失败为未触发 + CER>0.15；**非** 全量 200 的 66 条旧数 | Dialog200 批测须注明 **manifest 子集/限时** |
| C-05 | FW 仅 Top1 | ASR HTTP 仅返回合并文本；无 lattice | Spike 输入仅用 `raw_asr_text` |

---

## 4. 词库路径与 Exporter（FINAL §5.1、§十）— ⚠

| # | 项 | FINAL | 代码 | 清单约束 |
|---|-----|-------|------|----------|
| L-01 | SQLite 路径 | `node_runtime/lexicon/v3/lexicon.sqlite` | 运行时默认：`features.lexiconRuntimeV2.bundlePath` = **`node_runtime/lexicon/v3`**（`node-config-defaults.ts`）；`resolveLexiconBundleDir()` 默认查 **`node_runtime/lexicon/current`** + `PROJECT_ROOT` | Exporter 必须：`path.join(PROJECT_ROOT, bundlePath, 'lexicon.sqlite')`，或支持 `LEXICON_BUNDLE_PATH` |
| L-02 | 表名 | 仅写「canonical」 | 实际表：**`base_lexicon`**、**`idiom_lexicon`**、**`domain_lexicon`**、**`industry_routing_lexicon`** | 导出须覆盖 **base + idiom + domain**（routing 可选） |
| L-03 | 字段名 | `canonical` / `alias` | SQL：`word`、`canonical_word`、`is_alias`、`aliases`（JSON）、`pinyin_key`、`tone_pinyin_key`、`prior_score`、`repair_target`、`enabled`、`domain_id` | 映射表见 §10.1 |
| L-04 | `pinyin_key` 格式 | 未说明 | 仓内格式：`hou|xuan|sheng`（`\|` 分隔，`lexicon-runtime-v2.ts`） | IME/libpinyin 输入多为 **空格分音节**；导出/解码前须 **`key.replace(/\|/g, ' ')`** |
| L-05 | `repair_target` | 导出条件 `=1` | 主链 `candidateRequireRepairTarget: true`（冻结默认） | Spike 命中统计建议 **两套**：全词表 / 仅 repair_target |
| L-06 | `enabled` | 未写 | `enabled = 1` 才参与 V2 查询 | Exporter **必须** `WHERE enabled = 1` |
| L-07 | `is_alias` | alias→用户词典 | 别名字段在同一表 `is_alias=1` | 导出格式须区分 **主词条 vs 别名行**（libpinyin user phrase 语法） |
| L-08 | schema | 未写 | `manifest.schemaVersion` = **`lexicon-v3-four-table-v1`** | 导出前校验 manifest；checksum 可选记录 |
| L-09 | 禁止第二套词库 | ☑ | 仅写 `tests/spike/tmp/ime_dict.txt`，**不**写入 `node_runtime/` | `tmp/` 加入 `.gitignore` |

### 10.1 建议字段映射（补充进 FINAL §十）

| SQLite | Spike / libpinyin |
|--------|-------------------|
| `word`（`is_alias=0`） | 系统/用户 phrase 主形 |
| `word`（`is_alias=1`）或 `aliases` 展开 | 用户词典别名行 |
| `pinyin_key` | 音节串（转空格） |
| `tone_pinyin_key` | 可选；与 FW `toneDistance` 一致时用 `pinyin-pro` num 调 |
| `prior_score` | 词频权重（需查 libpinyin 导入 API 频率缩放规则） |
| `domain_id` | 分文件导出 `ime_dict_{domain}.txt` 或 spike 内 boost 表 |
| `repair_target=1` | 导出子集 + KenLM 后 apply 模拟 |

---

## 5. Pinyin Converter（FINAL §5.2）— ⚠

| # | 项 | 补充约束 |
|---|-----|----------|
| P-01 | 库选择 | 复用 **`pinyin-pro`**（已在 `lexicon/phonetic/pinyin.ts`、`tone-pinyin.ts`） |
| P-02 | 声调策略 | FW recall 用 **`toneType: 'num'`**（`tone-pinyin.ts`）；通用音节 **`toneType: 'none'`**（`pinyin.ts`） | Spike 须 **固定一种** 并与 libpinyin `parse_more_full_pinyins` 一致；建议在 FINAL 写明默认：**none + 空格**，并做 ablation |
| P-03 | 规范化 | `normalizeSyllable()`：小写、去非 a-z0-9 | IME 输入前统一走同一函数 |
| P-04 | 非 CJK | `hasCjk()` 未命中则音节数组为空 | **禁止** 对纯英文句整句转拼音；须 **CJK 连续段** 转拼音，英文/数字 **字面保留**（与 ASR 输出一致） |
| P-05 | 繁体 | `pinyin-pro` 支持繁体转音 | Reference 对比用 `analyze-dialog200` 同款 **去标点 normalize**，注明繁简未统一转简体 |
| P-06 | 多音字 | 错字→拼音按 **字面** 消歧，不等于「正确句」读音 | Spike 失败分类增加 **`polyphone_mismatch`** |

---

## 6. IME Decoder / Sidecar（FINAL §5.3、§九）— ⚠

| # | 项 | 补充约束 |
|---|-----|----------|
| I-01 | 协议 | POST `/decode` JSON | 端口避开 **5003–5019、6007**（服务 `service.json`）；建议 **127.0.0.1:5031** 或可配置 `PINYIN_IME_SPIKE_PORT` |
| I-02 | 输出粒度 | 示例为 **短语级**「候选生成」 | libpinyin 句级 decode 输出为 **整句**；FINAL 示例应改为 **整句 candidate.text** |
| I-03 | topK | Sidecar `topK:10` | 主链 `maxSentenceCandidates: **16**`（冻结）；Spike 建议 topK=**10~16**，报告同时写 K=10 与 K=16 |
| I-04 | GPL-3.0 | FINAL §十四仅一句 | 补充：**进程隔离** sidecar，不静态链接进 Electron；Windows 交付前法务签字 |
| I-05 | Windows | 编译风险 | Spike 开发可 WSL/Linux；**批测脚本**须在目标环境（Win11）记录 P95 |
| I-06 | 词典加载 | 未写 | Sidecar 启动参数：`--dict tests/spike/tmp/ime_dict.txt`；支持热加载 **否**（每批测重启即可） |

---

## 7. Diff Generator（FINAL §5.4）— 需新增设计约束

FINAL 仅给二元组示例；主链需要 **`FwApprovedReplacement`**（`start`/`end`/`candidateText`）。

| # | 项 | 补充约束 |
|---|-----|----------|
| D-01 | 对齐算法 | 须 **字符级对齐**（建议 LCS/最小编辑），支持 **多处替换** | 禁止仅 `replaceAll` 子串（重叠/顺序错） |
| D-02 | Span 坐标 | `start`/`end` 相对 **rawAsrText** UTF-16 索引 | 与 `applyFwSpanReplacements` 一致 |
| D-03 | `repairTarget` | 每个 diff 的 `target` 字串须查 SQLite `repair_target` | 模拟主链：`candidateRequireRepairTarget=true` 时无 flag 的 diff **不计入 would-apply** |
| D-04 | 无差异候选 | candidate === raw | 丢弃，不送入 KenLM |
| D-05 | 长度变化 | IME 候选与 raw **等长** 不一定成立 | 须验证 `applyReplacementsRightToLeft` 对 **变长替换** 的行为；不等长时 Spike 记 `diff_align_failed` |
| D-06 | 与 `buildSentenceCandidates` 关系 | 未来接入可构造 `SentenceCombination` | 字段：`text`、`replacements: SpanReplacementPick[]`、`candidateScore`（可用 IME score 或 0） |

---

## 8. KenLM / Sentence Rerank 复用（FINAL §5.5、§十二）— ⚠

| # | 项 | 补充约束 |
|---|-----|----------|
| K-01 | 「直接复用 rerankFwSentences」 | 函数在 **`main/src/fw-detector/rerank-fw-sentences.ts`**（TypeScript） | 离线 Spike **不能** 仅从 `.mjs` 直接 import 源码 |
| K-02 | 可行复用方式（三选一，须在 P4 前定案） | ① `npm run build:main` + spike 脚本 `require('../main/dist/...')` ② 子进程调用 **test-server** 扩展 debug 端点（**禁止** 除非显式批准） ③ Spike 内复制 **最小** `scoreBatch` 逻辑（不推荐，易漂移） |
| K-03 | LM 依赖 | `createKenlmBatchScorer()` → `getLmScorer()` → 子进程 **KenLM query** | 环境变量：**`PROJECT_ROOT`**、**`CHAR_LM_PATH`**；默认模型路径见 `lm-scorer.ts`（`asr_sherpa_lm/.../zh_char_3gram.trie.bin` 等） |
| K-04 | fail-open | `getLmScorer()` 返回 null 时 `pickedIsRaw=true` | Spike 报告须记录 **`kenlm_unavailable` 比例** |
| K-05 | 阈值 | 未写 | 使用冻结默认 **`minDeltaToReplace: 0.03`**（`fw-config.ts` / `freeze-config-ssot.json`） |
| K-06 | 指标 | FINAL §十一仅 topK 命中 | **补充 KPI**：`kenlm_pick_non_raw_rate`、`kenlm_would_apply_rate`（在 repair_target 过滤后） |

---

## 9. 数据结构补充（FINAL §六）

建议在 FINAL 中扩展（Spike JSON schema）：

```ts
// 补充字段（Spike 报告用）
interface SpikeCaseMetrics {
  id: string;
  subset: 'detector_miss' | 'recall_empty' | 'lexicon_missing' | 'all' | 'homophone';
  rawAsrText: string;
  reference: string;
  pinyinStream: string;
  // IME
  top1Hit: boolean;
  top3Hit: boolean;
  top5Hit: boolean;
  top10Hit: boolean;
  refInAnyDiff: boolean;  // reference 片段是否出现在任一 diff target
  // KenLM（可选 P4）
  kenlmAvailable: boolean;
  kenlmPickedText?: string;
  kenlmPickedIsRaw?: boolean;
  kenlmWouldApply?: boolean;
  // 性能
  pinyinMs: number;
  imeMs: number;
  diffMs: number;
  kenlmMs?: number;
  // 分类
  failureClass?: 'non_homophone' | 'polyphone' | 'english_mixed' | 'ime_parse_fail' | 'diff_fail';
}
```

| # | 项 | 说明 |
|---|-----|------|
| S-01 | `CandidateDiff` 缺坐标 | 实现须增加 `start`、`end`、`repairTarget` |
| S-02 | `source: "ime"` | 未来若并行 FW recall，保留 `source` 字段 |

---

## 10. Dialog200 验证（FINAL §十一、§十三）— ⚠

### 10.1 样本分层（操作定义）

| 子集 | FINAL 名称 | **代码/数据可操作定义**（须在脚本中实现） |
|------|------------|------------------------------------------|
| 全量 | Dialog200 全量 | `cases.manifest.json` 与批测结果交集 |
| Detector Miss | Detector Miss | `fw_triggered === false` **且** `cer(raw, ref) > 0.15`（normalize 算法同 `analyze-dialog200-quality-perf.mjs`） |
| Recall Empty | Recall Empty | `fw_triggered === true` **且** (`fw_reason === 'no_candidates'` **或** `fw_candidate_count === 0`) |
| Lexicon Missing | Lexicon Missing | ⚠ FINAL 无代码枚举 | 建议定义为：`extra.lexicon_runtime_status !== 'ok'` **或** `fw_reason === 'lexicon_unavailable'`；须在 P3 脚本注释中固定 |
| 同音子集 | 未写 | 可选：`cer(raw,ref)>0` 且 raw 与 ref **tone-normalized 拼音键相同**（`textToToneSyllables`） |

### 10.2 批测前置条件

| # | 项 | 约束 |
|---|-----|------|
| T-01 | 输入 JSON | 优先读 `tests/fw-detector-dialog-200-batch-result.json`；字段 **`extra.raw_asr_text`** |
| T-02 | Reference | `test wav/dialog_200/cases.manifest.json` → `utterance` |
| T-03 | 在线批测 | `run-dialog200-timed-batch.mjs` 需 **test-server :5020** + **FW 服务栈**；与 **纯离线 Spike** 分离 |
| T-04 | 离线 Spike | **不强制** 重跑 200 条 ASR；可用已有 batch JSON |
| T-05 | 子集规模 | 当前 batch 可能 **限时截断**（如 69 条）；报告须写 `totalManifestCases` / `stoppedReason` |
| T-06 | 命中率 | 同时报告 **raw topK** 与 **normalize 后 exact**（与 quality-perf 一致） |

### 10.3 结果检查补充

| # | KPI | 门槛（与 FINAL §十六 一致） |
|---|-----|---------------------------|
| G-01 | Detector Miss 子集 **top5** | > **15%** |
| G-02 | Recall Empty 子集 **top3** | > **25%** |
| G-03 | Sidecar **P95** 延迟 | < **200ms** / 句（本机说明 CPU/GPU） |
| G-04 | KenLM would-apply 提升 | 相对 raw **非负**；劣化率 < **5%**（建议新增） |
| G-05 | GPL/合规 | 未通过则 **禁止** 进入主链，不论命中率 |

---

## 11. 目录与工程约束（FINAL §七）

| # | 项 | 补充 |
|---|-----|------|
| R-01 | `tests/spike/` | 当前**不存在**，新建即可 |
| R-02 | 不得修改 | 扩展：**不得**改 `main/src/**`、`shared/**`、`freeze-contract.test.ts`（Spike 阶段） |
| R-03 | 依赖 | Spike `package.json` **禁止** 加入 electron 主包 dependencies；sidecar 独立 `README` |
| R-04 | 产物 | `tests/spike/tmp/**`、`**/spike-report-*.json`、`**/spike-report-*.md` 建议 gitignore |
| R-05 | 文档 | 报告输出：`docs/pinyin-v1/spike-report-YYYYMMDD.md`（与 FINAL 分离） |

---

## 12. 开发阶段补充（FINAL §八）

| 阶段 | FINAL 目标 | 补充验收 |
|------|------------|----------|
| P1 Exporter | repair_target 词表 | ☑ 增加：行数、distinct `pinyin_key`、含 alias 行数；校验可读 manifest |
| P2 Sidecar | Top10 | 增加：空拼音、超长句（>80 字）、纯英文返回错误码 |
| P3 Dialog200 | 命中率 | 分层报告四表；附 **10 条** 失败 case 手工注释 |
| P4 分析 | 延迟 + 分类 | **必须** 含 KenLM 路径（若 K-02 定案）；失败分类见 `failureClass` |

**建议：** FINAL 流程图在 P3 与 P4 之间增加可选分支 **「KenLM 模拟」**，避免实现时只做 topK 命中却声称复用了 Sentence Rerank。

---

## 13. 未来接入约束（FINAL §4.2）— 补充

| # | 项 | 约束 |
|---|-----|------|
| F-01 | 允许插入点 | 仅 **`fw-detector-orchestrator.ts`** 或 **`fw-sentence-rerank-pipeline.ts`**；**禁止**新 Pipeline Step |
| F-02 | 优先触发 | `reason === 'no_spans'`（early exit 前）或 `no_candidates`（rerank 内） |
| F-03 | 配置开关 | 须 `features.fwDetector.imeCandidateGenerator.enabled`（**新增键**，默 false）；写入 `freeze-config-ssot.json` parity |
| F-04 | 仍走 apply | 禁止直接 `ctx.segmentForJobResult = imeSentence`；必须 `applyFwSpanReplacements` + `asrRepairApplied` |
| F-05 | Write lock | FW apply 后 `isSegmentWriteLocked`；IME 不得在 5015/5016/5017 之后绕过 |
| F-06 | Freeze Gate | 未达 §十六 阈值 **归档**，删除 `tests/spike/` 即可回滚（FINAL §十五 ☑） |

---

## 14. 风险与 Non-Goals 补充（FINAL §十四、§十七）

| # | 风险/范围 | 补充说明 |
|---|-----------|----------|
| N-01 | 非同音 ASR 错误 | IME **无法** 修复；Spike 须量化占比，避免高估 ROI |
| N-02 | 候选爆炸 | 句级 decode 由 libpinyin 控制；合并进主链时仍受 **`maxSentenceCandidates=16`** 限制 |
| N-03 | 替代 Detector | Metadata Gate 的 **alias exact / low word prob** 不可由 IME 替代 |
| N-04 | 替代 Lexicon V3.1 | IME 词表为 **导出副本**，Runtime reload **不** 自动同步 |
| N-05 | 5016 phonetic | `phonetic_correction_zh` 为 **另一 KenLM 服务**（HTTP 5016），与 FW sentence KenLM **不是同一条** |
| N-06 | 测试报告 | Spike 报告 **不是** 生产验收；勿与 `docs/lexicon-v3/*Audit*` 混为「已上线」 |

---

## 15. FINAL 文档修订建议（给架构维护者）

| 优先级 | 修订项 |
|--------|--------|
| P0 | §5.1 路径改为 `PROJECT_ROOT` + `bundlePath(v3)`；表名改为四表结构 |
| P0 | §5.2 明确 `pinyin-pro` 参数（tone none/num）及 CJK 分段 |
| P0 | §5.4 增加 span 坐标 + `repair_target` 查询 |
| P0 | §5.5 / §八 明确 KenLM 在 Spike 中的 **调用方式**（K-02） |
| P1 | §十一 固化 Lexicon Missing / Detector Miss 的 **脚本定义** |
| P1 | §六 扩展 `SpikeCaseMetrics` |
| P1 | §九 Sidecar 端口、整句输出、GPL 隔离 |
| P2 | 增加指向本清单与 Feasibility Audit 的链接 |

---

## 16. 实施前总勾选（一页纸）

```
冻结边界
  ☐ B-01 ~ B-10 无触碰主链写点

环境与数据
  ☐ PROJECT_ROOT 已设
  ☐ lexicon.sqlite 路径 = v3 bundle（非误用 current）
  ☐ KenLM trie + query 可执行（若做 P4）
  ☐ batch JSON / manifest 路径正确

Exporter
  ☐ L-01 ~ L-09
  ☐ pinyin_key 转空格音节

Converter + IME
  ☐ P-01 ~ P-06
  ☐ I-01 ~ I-06

Diff + KenLM
  ☐ D-01 ~ D-06
  ☐ K-01 ~ K-06

Dialog200
  ☐ T-01 ~ T-06
  ☐ G-01 ~ G-05

交付
  ☐ tests/spike/ 仅新增
  ☐ spike-report 入 docs/pinyin-v1/
  ☐ 未达 Freeze Gate 不提议主链
```

---

*本清单随代码变更需重新 diff；Spike 实施时以仓库 `freeze-contract.test.ts` 与 `fw-detector/README.md` 为准。*
