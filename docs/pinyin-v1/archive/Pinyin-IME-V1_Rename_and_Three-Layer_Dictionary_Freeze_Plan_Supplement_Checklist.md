# Pinyin-IME-V1 重命名与三层词典 — Freeze Plan 补充约束清单

> **对照文档**：[Pinyin-IME-V1 Rename & Three-Layer Dictionary Freeze Plan.md](./Pinyin-IME-V1%20Rename%20%26%20Three-Layer%20Dictionary%20Freeze%20Plan.md)（**当前为空文件，须由本清单回填正文**）  
> **代码基准**：`electron_node/electron-node/tests/spike/`、`package.json`、`node_runtime/lexicon/v3/`（2026-06-03）  
> **关联审计**：[Pinyin_IME_V1_Naming_and_Dictionary_Audit_2026_06_03.md](./Pinyin_IME_V1_Naming_and_Dictionary_Audit_2026_06_03.md)  
> **架构补充**：[Pinyin_IME_Decoder_Spike_V1_Architecture_Supplement.md](./Pinyin_IME_Decoder_Spike_V1_Architecture_Supplement.md)

**用途**：开发前只读补充；**优先级**高于 Spike 临时习惯，**低于** Lexicon V3.1 / FW / Patch / Scheduler 冻结合约。  
**说明**：不改变 FINAL Architecture 定位；pinyin-ime-v1 仍为**离线 Spike**，未入主链。

---

## 0. 文档状态说明

| 项 | 状态 |
|----|------|
| Freeze Plan 主文档 | **空白**，无法从中读取冻结条款 |
| 本清单 | 基于实际代码 + 审计报告 + V1 架构补充，列出 **必须写入 Freeze Plan** 的条目 |
| 实施方式 | 开发前将本清单 §1–§12 合并进 Freeze Plan；实施时逐项勾选 |

---

## 1. Freeze Plan 正文建议骨架（当前缺失）

下列章节应在主 Freeze Plan 中**显式出现**（本清单为每节待填内容）：

| 章节 | 须在 Freeze Plan 中冻结的内容 |
|------|------------------------------|
| §1 范围与 Non-Goals | 仅 `tests/spike/`；不进 `main/src`；不第二套 Runtime |
| §2 正式命名 | `pinyin-ime-v1`、`base/domain/target_dictionary` |
| §3 废弃命名 | `repair-only`、`spike:ime:*`、`ime_dict.txt`（IME 层） |
| §4 三层词典语义 | 叠加模型；target 不可替代 base 整句解码 |
| §5 SQLite 边界 | 不改 schema；Exporter 只读 |
| §6 导出/加载契约 | TSV 字段、路径、合并算法 |
| §7 npm scripts | 新旧对照与过渡期 |
| §8 Sidecar 契约 | 端口、HTTP、env |
| §9 Dialog200 / Freeze Gate | KPI 与子集定义 |
| §10 主链接入前置 | 引用 freeze-contract + 新开关键 |
| §11 验收与回滚 | 文件删除范围 |

---

## 2. 冻结边界补充（继承 + pinyin-ime-v1 专用）

### 2.1 继承自架构补充 B-01～B-10（🔒 Spike 不得破坏）

| # | 约束 | 代码依据 | pinyin-ime-v1 要求 |
|---|------|----------|-------------------|
| B-01 | 不读 CTC / `asrNbest` | `asr-step.ts` | 批测仅用 `extra.raw_asr_text` |
| B-02 | 不写 `rawAsrText` | `asr-step.ts` 单写点 | Spike 只读 |
| B-03 | 不写 `segmentForJobResult` | 白名单写点 | Spike 不写 JobContext |
| B-04 | 评估不混 `text_asr` SSOT | `post-asr-routing.ts` | `run-pinyin-ime-*` 已遵守；文档/报告须分栏 raw vs final |
| B-05 | Spike 不进 `fw-detector/` | `freeze-contract.test.ts` | 保持 `tests/spike/` 隔离 |
| B-06～B-10 | 不改 ASR 策略 / Pipeline 表 / Aggregator / Patch / Scheduler | 各模块 | Exporter **只读** `lexicon.sqlite` |

### 2.2 pinyin-ime-v1 专用冻结（⚠ 当前代码未满足）

| # | 约束 | 代码现状 | Freeze Plan 必须写明 |
|---|------|----------|---------------------|
| V1-01 | **禁止** IME 产物写入 `node_runtime/lexicon/` | ☑ 仅 `tests/spike/tmp/` | 三层 TSV 仅 under `tmp/pinyin-ime-v1/` |
| V1-02 | **禁止** 以 `repair-only` 作为词典层名称 | ✗ CLI `--repair-only`、README、`export:repair` | 仅允许 `target_dictionary` / `export:target` |
| V1-03 | **禁止** 仅用 `target_dictionary` 调用整句 decode | ✗ 当前单文件加载，无分层 | 解码前 **必须** merge base+domain+target |
| V1-04 | **禁止** 在 Spike 引入第二套 SQLite | ☑ 只读 v3 bundle | 外部基础词库若需，走 V3 导入（见 §7） |
| V1-05 | `repair_target` **保留为 SQLite 字段名** | ☑ | 文档与导出列可映射为 `target_boost`，不得改表结构 |
| V1-06 | idiom 并入 **base_dictionary** | 现 Exporter 将 idiom 与 base 混导同一文件 | Freeze：idiom_lexicon → base_dictionary 行集，不单独第四层文件（除非未来显式修订） |
| V1-07 | `industry_routing_lexicon` **不**进 IME 短语表 | 现 Exporter 未导出 routing | 仅 `routing_boost.json` 或 sidecar `enabledDomains` 元数据 |
| V1-08 | 解码输入 SSOT | `textToPinyinStream(raw)` | 固定 `pinyin-pro` `toneType: 'none'`；禁止对 `text_asr` 做 IME |
| V1-09 | KenLM 门控对齐主链 | `kenlm-spike.mjs` `MIN_DELTA_TO_REPLACE=0.03` | 与 `fw-config` `minDeltaToReplace` 一致；变更须文档化 |
| V1-10 | would-apply 须命中 repair_target 词 | `wouldApplyWithRepairTarget` + SQLite index | 索引语义改名 `target_dictionary_index`，逻辑不变 |

---

## 3. 命名冻结对照表（必须写入 Freeze Plan §2–§3）

### 3.1 正式命名（冻结）

| 类别 | 冻结名称 |
|------|----------|
| 项目 | `pinyin-ime-v1` |
| 导出命令前缀 | `pinyin-ime-v1-export`（日志）；npm：`spike:pinyin-ime-v1:export:*` |
| 评估 | `pinyin-ime-v1-spike` |
| 报告 | `pinyin-ime-v1-report` |
| 词典层 | `base_dictionary`、`domain_dictionary`、`target_dictionary` |
| 产物目录 | `tests/spike/tmp/pinyin-ime-v1/` |
| 环境变量 | `PINYIN_IME_V1_PORT`（默认 5031）、`PINYIN_IME_V1_DICT_DIR` |
| Sidecar | `pinyin-ime-v1-sidecar` |

### 3.2 废弃命名（冻结禁止在新代码/文档中出现）

| 废弃 | 替换 |
|------|------|
| `repair-only` / `--repair-only` | `--layer target` 或 `export:target` |
| `spike:ime:export:repair` | `spike:pinyin-ime-v1:export:target` |
| `spike:ime:*` | `spike:pinyin-ime-v1:*` |
| `ime_dict.txt`（作为 SSOT 文件名） | `base_dictionary.txt` 等三层 + 可选 `merged.txt` |
| `repair dictionary` / `repair-only mode` | `target_dictionary`（boost 层） |
| `defaultImeDictPath()` | `defaultPinyinImeV1DictDir()` |
| `repair-target-index.mjs` | `target-dictionary-index.mjs` |

### 3.3 代码中仍使用废弃名的位置（实施时须改）

| 文件 | 当前 |
|------|------|
| `export-lexicon-v3-ime-dict.mjs` | `--repair-only`、`ime_dict.txt` |
| `package.json` L64–69 | `spike:ime:*` |
| `lib/paths.mjs` | `defaultImeDictPath()` → `ime_dict.txt` |
| `lib/repair-target-index.mjs` | 文件名 + 注释 |
| `README.md`、`Implementation_Notes.md`、测试报告 2026-06-03 | 多处 `repair-only` |

---

## 4. 三层词典冻结定义（与代码差距）

### 4.1 语义冻结（Freeze Plan 核心）

```
整句 decode 词表 = merge(base_dictionary, domain_dictionary)
target_dictionary → 仅用于 imeWeight / target_boost 加成（repair_target=1）
禁止：load(target_dictionary only) 作为唯一 decode 词表
```

### 4.2 各层 SQL 来源（冻结，不改 schema）

| 层 | SQLite 来源 | WHERE（冻结） | 当前 Exporter |
|----|-------------|---------------|---------------|
| **base_dictionary** | `base_lexicon` + `idiom_lexicon` | `enabled=1`；base 建议 `is_alias=0` | ☑ 两表合并；**未**拆文件 |
| **domain_dictionary** | `domain_lexicon` | `enabled=1`；含 `domain_id` | ☑ 混在同一 TSV |
| **target_dictionary** | 三表 | `enabled=1 AND repair_target=1` | ☑ `--repair-only` 过滤；**语义错误命名** |

### 4.3 数据事实约束（⚠ 必须写入 Freeze Plan，否则误导）

只读统计 `node_runtime/lexicon/v3/lexicon.sqlite`（2026-06-03）：

| 表 | enabled=1 | repair_target=1 | is_alias=1 |
|----|-----------|-----------------|------------|
| base_lexicon | 50000 | **50000 (100%)** | 0 |
| idiom_lexicon | 22192 | **22192 (100%)** | 0 |
| domain_lexicon | 25 | **25 (100%)** | **16** |
| industry_routing_lexicon | 9 行 | — | keyword 路由 |

**冻结说明**：

1. 在当前 bundle 下，`export:target` 与 `export:all` **行数等价**；不能用行数区分 target 层。
2. `target_dictionary` 的冻结语义是 **boost 元数据层**，不是「子集词表」。
3. `domain_dictionary` 仅 25 行（16 alias），**不足以**覆盖 Dialog200 领域；扩词须走 **Lexicon V3 Patch/资产**，禁止 Spike 私有 SSOT。
4. README 声称「repair-only 无法覆盖功能词」在**当前数据**下不成立；失败主因是 **dict_dp + 拼音对齐 + 未分层 merge**（见审计 §9）。

### 4.4 alias 冻结规则

| 场景 | 冻结 |
|------|------|
| base/idiom | 当前无 alias 行 → 直接导出 surface |
| domain | `is_alias=1` 行进入 domain_dictionary，须带 `canonical`；Exporter **当前未输出** `canonical_word` 列 |
| 解码 | alias 行 `imeWeight *= aliasPenalty`（建议 0.85，须在 Freeze Plan 写死初值） |

### 4.5 当前解码器与三层差距（实施验收项）

| 能力 | `ime-dict-decoder.mjs` 现状 | 冻结后要求 |
|------|---------------------------|------------|
| 输入文件 | 单 TSV，读 3 列 | 读三层或 merged manifest |
| prior / boost | 仅用 `prior` | 使用派生 `imeWeight`（含 target/domain boost） |
| domain | 忽略 TSV domain 列 | `enabledDomains` 影响 domain boost |
| beam | `beamWidth=48` 硬编码 | Freeze Plan 可冻结初值，调参须记录在 report |

---

## 5. 字段映射冻结（SQLite → pinyin-ime-v1 TSV）

须在 Freeze Plan 附表冻结；**第一阶段不改 SQLite**。

| SQLite | pinyin-ime-v1 列 | 备注 |
|--------|------------------|------|
| （导出层） | `dictionary_type` | `base` \| `domain` \| `target` |
| `word` | `surface` | |
| `canonical_word` | `canonical` | domain alias **必须**导出；**当前缺失** |
| `pinyin_key` | `pinyin` | `\|` → 空格 |
| `tone_pinyin_key` | `tone_pinyin` | 可选列 |
| `prior_score` | `weight` | |
| （派生） | `imeWeight` | Exporter 计算，见 §6 |
| `repair_target` | `target_boost` | 0/1 |
| `domain_id` | `domain_id` | 仅 domain 层 |
| `is_alias` | `is_alias` | |
| `enabled` | — | 仅导出过滤条件 |

**当前 TSV（legacy）**：`word\tpinyin\tprior\trepair_target\tdomain\tis_alias` — Freeze Plan 须声明 **兼容读取期限**（建议：v1 脚本同时支持 legacy 一版迭代）。

---

## 6. 权重策略冻结（不改 schema）

| # | 冻结条款 | 说明 |
|---|----------|------|
| W-01 | **不新增** SQLite `imeWeight` 列 | 第一阶段 |
| W-02 | `imeWeight` **仅** Exporter 派生 | |
| W-03 | 建议初值（须在 Freeze Plan 写死，可调须 bump report 版本） | `imeWeight = prior_score * (target_boost ? 1.25 : 1.0) * (is_alias ? 0.85 : 1.0) * domainBoost` |
| W-04 | `target_boost` 行 **不得** 从 merge 词表删除 | 仅加权 |
| W-05 | `domainBoost` 默认 1.0；命中 `industry_routing_lexicon` 时 1.1～1.3 | 须导出 routing 侧车 JSON |
| W-06 | 与主链 `repairTargetScoreBoost` | 当前 DEFAULT **0**；Spike boost 与主链解耦，避免误以为已对齐 |

---

## 7. 基础词典缺口 — Freeze Plan 须明确的决策

| 方案 | 冻结态度 |
|------|----------|
| **A** 现有 base+idiom 导出 | **默认采纳**；先实现三层 merge 再评估 |
| **B** 外部词库导入 V3 SQLite | 允许，须经 Lexicon 管线；**非** Spike 私有 |
| **C** Spike-only external base | **冻结禁止** 作为主链或长期 SSOT |

**补充约束**：若 A 复测后 top5 仍≈0，Freeze Plan 须触发 **libpinyin 对照分支**（GPL 门禁），而非直接加 C。

---

## 8. Sidecar / 接口冻结补充

| 项 | 当前代码 | Freeze Plan 建议 |
|----|----------|------------------|
| 文件 | `ime-sidecar-server.mjs` | 重命名 `pinyin-ime-v1-sidecar.mjs` |
| 端口 | `PINYIN_IME_SPIKE_PORT` → 5031 | `PINYIN_IME_V1_PORT` |
| 词典路径 | 单文件 `PINYIN_IME_DICT_PATH` | `PINYIN_IME_V1_DICT_DIR` 含三层 |
| `GET /health` | ☑ 有 | 保留 |
| `POST /decode` | ☑ `{ pinyin, topK }` | 保留；可选增 `POST /pinyin-ime-v1/decode` 别名 |
| 请求扩展 | ✗ 无 | 冻结可选：`profile`、`enabledDomains` |
| 响应 | 无 `ok`/`source` | 冻结增加：`ok: true`、`source: "pinyin-ime-v1"` |
| 后端标识 | `dict_dp` / `libpinyin_cli` | 文档化；`dict_dp` 标注为 v1 后备 |
| GPL | 进程隔离 | 未接 libpinyin 前不得声称 IME 生产就绪 |

---

## 9. npm scripts 冻结对照（实施 checklist）

| 冻结后 script | 替代当前 | 状态 |
|---------------|----------|------|
| `spike:pinyin-ime-v1:export:all` | `spike:ime:export` | ☐ |
| `spike:pinyin-ime-v1:export:base` | （无） | ☐ |
| `spike:pinyin-ime-v1:export:domain` | （无） | ☐ |
| `spike:pinyin-ime-v1:export:target` | `spike:ime:export:repair` | ☐ |
| `spike:pinyin-ime-v1:sidecar` | `spike:ime:sidecar` | ☐ |
| `spike:pinyin-ime-v1:dialog200` | `spike:ime:dialog200` | ☐ |
| `spike:pinyin-ime-v1:dialog200:sidecar` | `spike:ime:dialog200:sidecar` | ☐ |
| `spike:pinyin-ime-v1:analyze` | `spike:ime:analyze` | ☐ |

**过渡期冻结**：允许保留旧 script **一个迭代** 作为 alias 并打印 deprecation warning；Freeze Plan 须写截止日期。

---

## 10. 产物路径冻结（⚠ 代码与文档不一致）

| 产物 | 当前路径 | 冻结路径 |
|------|----------|----------|
| 词典 | `tests/spike/tmp/ime_dict.txt` | `tests/spike/tmp/pinyin-ime-v1/base_dictionary.txt` 等 |
| P3 结果 | `spike-dialog200-results.json` | `pinyin-ime-v1-dialog200-results.json` |
| P4 JSON | `spike-report-summary.json` | `pinyin-ime-v1-report-summary.json` |
| P4 Markdown | `electron_node/docs/pinyin-v1/spike-report-latest.md` | **`docs/pinyin-v1/pinyin-ime-v1-report-latest.md`**（仓库根） |

**必须修复**：`analyze-pinyin-ime-spike.mjs` L112–115 指向 `electron_node/docs/...`，与 `docs/pinyin-v1/` 分裂。

---

## 11. Dialog200 / Freeze Gate 冻结（继承 §十六）

### 11.1 子集定义（与 `lib/subsets.mjs` 一致，须冻结）

| 子集 | 可操作定义 |
|------|------------|
| detector_miss | `!fw_triggered && cer(raw,ref)>0.15` |
| recall_empty | `fw_triggered && (reason===no_candidates \|\| candidateCount===0)` |
| lexicon_missing | `lexicon_runtime_status!=='ok'` 或 `lexicon_unavailable` |

### 11.2 KPI 门槛（冻结）

| ID | 门槛 | 当前（2026-06-03 基线） |
|----|------|------------------------|
| G-01 | detector_miss **top5** > 15% | **0%**（未过） |
| G-02 | recall_empty **top3** > 25% | N/A（子集 n=0） |
| G-03 | IME **P95** < 200ms | **1ms**（已过，dict 空候选） |
| G-04 | KenLM would-apply 劣化 < 5% | 未达标 |
| G-05 | GPL/合规 | 未决 |

### 11.3 复测前置冻结（与 `常用命令` 对齐）

1. `lexicon:rebuild-sqlite`（Electron ABI 119）  
2. `lexiconRecall.enabled=true`（当前 DEFAULT **false**，须配置覆盖）  
3. Dialog200 batch → `fw-detector-dialog-200-batch-result.json`  
4. `export:all` + 三层 merge → `dialog200` → `analyze`  
5. 报告**分栏**：ASR raw / FW / Lexicon Runtime / pinyin-ime-v1  

---

## 12. 主链接入前置（冻结，本轮不做）

| # | 条件 | 引用 |
|---|------|------|
| M-01 | Lexicon Runtime OK | 批测 `lexicon_runtime_status` |
| M-02 | Dialog200 FW 基线可测 | 契约 pass rate |
| M-03 | pinyin-ime-v1 Freeze Gate 通过 | §11 |
| M-04 | `features.fwDetector.imeCandidateGenerator.enabled` 默认 false | 架构补充 F-03 |
| M-05 | 仍走 `applyFwSpanReplacements` | F-04 |
| M-06 | freeze-contract 扩展审计 | 未启动 |
| M-07 | 插入点仅 `fw-sentence-rerank-pipeline` 内部 | F-01 |

---

## 13. 实施顺序冻结（回答「先命名还是先导出」）

**冻结顺序（不得调换）：**

| 阶段 | 内容 | 验收 |
|------|------|------|
| **Phase 0** | 将本清单 + 审计结论写入 Freeze Plan 主文档 | 主文档非空 |
| **Phase 1** | 命名清理（scripts、路径、env、日志前缀、文档） | 无新增 `repair-only` 字符串 |
| **Phase 2** | 三层 Exporter + `loadPinyinImeV1Dictionaries()` + merge/boost | 三层文件存在；decode 非空（抽样） |
| **Phase 3** | Lexicon ABI + Dialog200 在线批测 | `lexicon_runtime_ok_count>0` |
| **Phase 4** | pinyin-ime-v1 dialog200 + analyze | Gate 报告 |
| **Phase 5** | 可选 libpinyin / 算法 | GPL 门禁后 |

**禁止**：在 Phase 1 完成前仅跑 `export:all` 旧脚本并宣称 v1 完成。

---

## 14. 风险与 Non-Goals（须并入 Freeze Plan）

| ID | 内容 |
|----|------|
| R-01 | `repair_target` 全表为 1 导致 target 层语义稀释 |
| R-02 | domain 词表过小（25 行） |
| R-03 | ASR 字面拼音 ≠ 正确读音 → IME 上限 |
| R-04 | `dict_dp` 非生产 IME；0 候选不证明词库无用 |
| R-05 | 报告路径双份导致 SSOT 混乱 |
| N-01 | 不替代 Metadata Gate / Detector |
| N-02 | 不替代 Lexicon V3.1 Runtime reload |
| N-03 | 不修改 Text Chain / ASR Fix |

---

## 15. 开发前勾选清单（Checklist）

实施 pinyin-ime-v1 重命名与三层词典前，逐项 ☑：

### 15.1 文档

- [ ] Freeze Plan 主文档已从空白回填（§1 骨架）
- [ ] 本补充清单已评审并链接进 Freeze Plan
- [ ] `Pinyin_IME_V1_Naming_and_Dictionary_Audit_2026_06_03.md` 结论已吸收
- [ ] 架构补充 B-01～B-10、G-01～G-05 仍有效

### 15.2 命名

- [ ] `package.json` scripts 已按 §9 重命名或 alias + deprecation
- [ ] 删除/替换 `--repair-only` CLI
- [ ] 产物改为 `base/domain/target_dictionary.txt`
- [ ] 环境变量改为 `PINYIN_IME_V1_*`

### 15.3 三层词典

- [ ] Exporter 输出三层文件 + manifest（版本、rowCount、schemaVersion）
- [ ] 解码器 merge 三层；target 仅 boost
- [ ] idiom → base_dictionary 已文档化
- [ ] routing → `routing_boost.json` 或等价
- [ ] domain alias 导出 `canonical` 列

### 15.4 权重

- [ ] `imeWeight` 派生公式与 Freeze Plan W-03 一致
- [ ] legacy TSV 兼容策略已定义

### 15.5 测试

- [ ] `analyze` 输出至 `docs/pinyin-v1/pinyin-ime-v1-report-latest.md`
- [ ] Dialog200 报告分栏四项指标
- [ ] `npm rebuild better-sqlite3`（系统 Node）与 `lexicon:rebuild-sqlite`（Electron）文档分离

### 15.6 主链

- [ ] 确认无 `main/src` diff
- [ ] 确认未改 `freeze-contract.test.ts`（除非单独立项）

---

## 16. 最终必答（对照 Freeze Plan 空白缺口）

| # | 问题 | 清单结论 |
|---|------|----------|
| 1 | Freeze Plan 是否需要补充？ | **是**；主文档为空，**必须**以本清单为蓝本回填 |
| 2 | 命名是否冻结为 pinyin-ime-v1？ | **是** |
| 3 | repair-only 是否废弃（IME 层）？ | **是** |
| 4 | 三层是否强制？ | **是**；且须 merge 后 decode |
| 5 | 是否改 schema？ | **否**（第一阶段） |
| 6 | 当前 Exporter 是否满足冻结？ | **否**；单文件 + 错误命名 |
| 7 | 是否先命名再导出？ | **是**（§13 Phase 1→2） |
| 8 | 最大代码事实风险？ | **repair_target 全为 1** + **domain 25 行** + **analyze 路径错误** |

---

*清单版本：2026-06-03 | 只读审计产出，未修改代码与配置*
