# Pinyin IME V1 命名统一与三层词典方案 — 只读审计报告

**日期**：2026-06-03  
**审计类型**：只读（未修改代码、配置、`package.json`、SQLite、主链）  
**正式项目名**：`pinyin-ime-v1`  
**审计范围**：`electron_node/electron-node/tests/spike/`、`package.json` 中 `spike:ime:*`、`node_runtime/lexicon/v3/`（只读）

---

## 1. Executive Summary

| 结论 | 说明 |
|------|------|
| Spike 第一轮已交付 | 导出器、dict_dp 解码、sidecar、Dialog200 离线批测、KenLM 镜像、Freeze Gate 分析均已存在于 `tests/spike/` |
| **无 `main/src` 改动** | `main/src` 内无 `tests/spike` / `ime_dict` 引用 |
| 临时命名普遍存在 | `repair-only`、`spike:ime:*`、`ime_dict.txt`、`repair-target-index` 等需统一为 `pinyin-ime-v1` 语义 |
| **三层词典在 SQLite 层可行** | 无需修改 `lexicon-v3-four-table-v1` schema；通过 Exporter 派生即可 |
| **当前 `--repair-only` 与全量在行数上等价** | 现网 bundle 中 `enabled=1` 行 **全部** `repair_target=1`（base 50000 / idiom 22192 / domain 25）；过滤条件未缩小词表 |
| 第一轮 0 候选主因 | **非**「行数过少」，而是 **dict_dp 单文件加载**、**ASR 字面→拼音流与词表音节不对齐**、以及 **未实现三层合并/boost**；需先 `export:all` + 分层加载复测后再下结论 |
| 下一轮建议顺序 | **① 命名与目录清理 → ② 三层 Exporter + 合并加载器 → ③ Lexicon Runtime ABI 修复后 Dialog200 复测**（不要先做算法优化） |

---

## 2. Current Spike Inventory

### 2.1 `tests/spike/` 文件列表与职责

| 文件 | 职责 |
|------|------|
| `export-lexicon-v3-ime-dict.mjs` | P1：只读 SQLite → 单文件 `tmp/ime_dict.txt`；支持 `--repair-only` |
| `ime-sidecar-server.mjs` | P2：HTTP `GET /health`、`POST /decode`；`dict_dp` 或 `PINYIN_IME_DECODE_CMD` |
| `run-pinyin-ime-dialog200-spike.mjs` | P3：读批测 JSON + manifest → 拼音流 → 解码 → diff → KenLM 模拟 |
| `analyze-pinyin-ime-spike.mjs` | P4：汇总命中率、Freeze Gate → `spike-report-summary.json` + Markdown |
| `README.md` | 使用说明（仍含 `repair-only` / `spike:ime:*` 表述） |
| `lib/paths.mjs` | `PROJECT_ROOT`、v3 bundle、`defaultImeDictPath()`、`defaultManifestPath()` |
| `lib/pinyin-stream.mjs` | `rawAsrText` → `pinyin-pro` 无声调音节流 |
| `lib/ime-dict-decoder.mjs` | `dict_dp` beam 解码；**仅读** word/pinyin/prior 三列 |
| `lib/diff-align.mjs` | 字符级 diff → replacement spans |
| `lib/kenlm-spike.mjs` | KenLM 批测镜像（不 import 主链） |
| `lib/repair-target-index.mjs` | SQLite 只读 `repair_target=1` 词集；KenLM would-apply 门控 |
| `lib/subsets.mjs` | detector_miss / recall_empty / lexicon_missing 子集 |
| `lib/metrics.mjs` | CER、hit@K、分位数 |
| `tmp/ime_dict.txt` | 导出产物（gitignore） |
| `spike-dialog200-results.json` | P3 原始结果 |
| `spike-report-summary.json` | P4 JSON 摘要 |
| `.gitignore` | 忽略 `tmp/` 等 |

**运行时数据文件**（非源码）：`spike-dialog200-results.json`、`spike-report-summary.json`、`tmp/ime_dict.txt`。

### 2.2 当前 npm scripts（`package.json`，只读摘录）

| Script | 命令 |
|--------|------|
| `spike:ime:export` | `export-lexicon-v3-ime-dict.mjs`（全量 enabled） |
| `spike:ime:export:repair` | 同上 + `--repair-only` |
| `spike:ime:sidecar` | `ime-sidecar-server.mjs` |
| `spike:ime:dialog200` | `run-pinyin-ime-dialog200-spike.mjs --local` |
| `spike:ime:dialog200:sidecar` | 同上（无 `--local`） |
| `spike:ime:analyze` | `analyze-pinyin-ime-spike.mjs` |

### 2.3 当前导出模式（代码事实）

- **数据源**：`base_lexicon` + `idiom_lexicon` + `domain_lexicon`（**未**读 `industry_routing_lexicon`）
- **条件**：`enabled = 1`；可选 `AND repair_target = 1`（`--repair-only`）
- **输出格式**：TSV 头注释 + 行：`word \t pinyin \t prior \t repair_target \t domain \t is_alias`
- **拼音**：`pinyin_key` 中 `|` → 空格
- **默认路径**：`tests/spike/tmp/ime_dict.txt`（`defaultImeDictPath()`）
- **解码器实际使用列**：仅 `word`、`pinyin`（prior）；**忽略** repair_target / domain / is_alias 列

### 2.4 Sidecar 协议（当前）

- **端口**：`PINYIN_IME_SPIKE_PORT`（默认 **5031**）
- **词典**：`PINYIN_IME_DICT_PATH` 或 `defaultImeDictPath()`
- **POST `/decode`** 请求：`{ pinyin, topK }`（空格分音节拼音串）
- **响应**：`{ backend: "dict_dp"|"libpinyin_cli", candidates: [{ text, score }] }`（无 `ok` / `source` 字段）
- **未实现**：`profile`、`enabledDomains`

### 2.5 分析报告输出路径

| 产物 | 路径 |
|------|------|
| P3 结果 | `tests/spike/spike-dialog200-results.json` |
| P4 JSON | `tests/spike/spike-report-summary.json` |
| P4 Markdown | `electron_node/docs/pinyin-v1/spike-report-latest.md`（`analyze` 内 `path.resolve(__dirname, '../../../docs/pinyin-v1/...')` 指向 **electron_node/docs**，与仓库根 `docs/pinyin-v1/` 不一致） |

### 2.6 `main/src` 改动

**无。** Spike 未接入 `fw-detector/`、`pipeline/`、`lexicon-v2/` Runtime 加载路径。

---

## 3. Temporary Naming Audit

### 3.1 代码与配置中的临时命名

| 文件 | 行号（约） | 当前名称 | 问题 | 建议替换 |
|------|------------|----------|------|----------|
| `export-lexicon-v3-ime-dict.mjs` | 3, 17–20, 66, 98 | `ime_dict.txt`、`--repair-only`、`repairOnly` | 「repair-only」易被理解为正式词典层 | CLI：`--layer target`；产物：`target_dictionary.txt`；脚本名：`pinyin-ime-v1-export.mjs` |
| `package.json` | 64–69 | `spike:ime:*` | 与正式名 `pinyin-ime-v1` 不一致 | 见 §10 Script Rename Plan |
| `lib/paths.mjs` | 65–66 | `defaultImeDictPath()` → `ime_dict.txt` | 单词典文件语义 | `defaultPinyinImeV1DictDir()` + 三层文件名 |
| `lib/repair-target-index.mjs` | 文件名 + 注释 | `repair-target` | SQLite 字段可保留；**模块名**应体现 target_dictionary | `target-dictionary-index.mjs` |
| `ime-sidecar-server.mjs` | 4, 12–14, 20, 120 | `PINYIN_IME_SPIKE_*`、`[spike:sidecar]` | Spike 临时环境变量 | `PINYIN_IME_V1_*`；日志前缀 `[pinyin-ime-v1-sidecar]` |
| `run-pinyin-ime-dialog200-spike.mjs` | 文件名、`repairIndex` | `pinyin-ime-dialog200-spike` | 可保留 spike 后缀但宜加 `v1` | `run-pinyin-ime-v1-dialog200.mjs` |
| `analyze-pinyin-ime-spike.mjs` | 117 | `Pinyin IME Spike Report` | 报告标题 | `Pinyin IME V1 Report` |
| `README.md` | 17–49 | `repair-only`、`spike:ime:*` | 文档误导（见 §8） | 全面改为 `pinyin-ime-v1` 与三层词典名 |
| `lib/ime-dict-decoder.mjs` | 3 | `dict_dp` | 可保留为 backend 标识 | 文档中标注为 `pinyin-ime-v1-dict-dp` 后端 |

### 3.2 文档中的临时命名（需同步，非代码）

| 文件 | 相关内容 |
|------|----------|
| `docs/pinyin-v1/Pinyin_IME_Decoder_Spike_Implementation_Notes.md` | `spike:ime:*`、`ime_dict.txt` |
| `docs/pinyin-v1/Pinyin_IME_Decoder_Spike_Development_Report_2026_06_03.md` | `repair-only` 模式描述 |
| `docs/pinyin-v1/Pinyin_IME_Decoder_Dialog200_Test_Report_2026_06_03.md` | `spike:ime:export:repair` |
| `docs/pinyin-v1/Pinyin_IME_Decoder_Spike_V1_Architecture_Supplement.md` | `ime_dict.txt`、`repair_target` 导出子集表述 |

### 3.3 明确保留（非废弃）

| 名称 | 原因 |
|------|------|
| SQLite 字段 `repair_target` | Lexicon V3.1 冻结字段，继续存在 |
| `buildRepairTargetIndex` / KenLM 门控逻辑 | 语义对应 **target_dictionary** _boost_，非「repair-only 词典」 |
| `main/src/legacy/asr-repair/*` 中 “repair-only” | 历史 Legacy 模块注释，**与 pinyin-ime-v1 无关**，不在本轮重命名范围 |

### 3.4 未发现的命名

- `repair-export`、`ime-repair-mode`、`target-only export`：**代码库中无**精确匹配（仅文档/口语层面的 `repair-only`）。

---

## 4. Pinyin IME V1 Naming Standard

| 类别 | 正式命名 |
|------|----------|
| 项目 | `pinyin-ime-v1` |
| 导出 | `pinyin-ime-v1-export`（脚本/日志前缀） |
| 离线评估 | `pinyin-ime-v1-spike` |
| 报告 | `pinyin-ime-v1-report`（如 `pinyin-ime-v1-report-latest.md`） |
| 词典层 | `base_dictionary`、`domain_dictionary`、`target_dictionary` |
| 产物目录建议 | `tests/spike/tmp/pinyin-ime-v1/` |
| 合并产物（可选） | `pinyin_ime_v1_merged.txt`（仅 spike 临时，不写 `node_runtime/`） |
| 环境变量前缀 | `PINYIN_IME_V1_PORT`、`PINYIN_IME_V1_DICT_DIR` |
| Sidecar 服务名（建议） | `pinyin-ime-v1-sidecar` |
| 废弃称谓 | `repair-only`、`repair-export`、`ime-repair-mode`、`repair dictionary`（指 IME 层时） |

---

## 5. Three-layer Dictionary Design

### 5.1 目标语义

```
base_dictionary      → 整句切分与通用语言覆盖（必选）
domain_dictionary    → 领域增强（叠加）
target_dictionary    → repair_target=1 优先修复/boost（叠加，不可替代 base）
```

解码时：**合并加载** base + domain + target（target 对 prior/imeWeight 加成），禁止仅用 target 层跑整句 beam。

### 5.2 与当前 Exporter 差距

| 能力 | 当前 | pinyin-ime-v1 需要 |
|------|------|---------------------|
| 分层导出 | 单文件合并 | 三个文件 + 可选 merged |
| base 范围 | base+idiom+domain 混导 | base **含 idiom** 建议并入 base_dictionary；domain 独立 |
| target 语义 | SQL 过滤 repair_target（现网等价全量） | **独立文件** + 加载时 boost |
| domain 过滤 | 无 `--domain` | `export:domain --domain-id travel` |
| 解码器 | 单 dict | `loadPinyinImeV1Dictionaries({ base, domain, target })` |

---

## 6. Pinyin IME V1 Dictionary Feasibility Report

**SQLite 现状**（`node_runtime/lexicon/v3/manifest.json`，只读统计 2026-06-03）：

| 表 | enabled=1 行数 | repair_target=1 | is_alias=1 |
|----|----------------|-----------------|------------|
| `base_lexicon` | 50000 | 50000（100%） | 0 |
| `idiom_lexicon` | 22192 | 22192 | 0 |
| `domain_lexicon` | 25 | 25 | 16 |
| `industry_routing_lexicon` | 9 | — | N/A（keyword 路由） |

### 6.1 必答清单

| # | 问题 | 结论 |
|---|------|------|
| 1 | base_dictionary 能否从 base_lexicon 导出？ | **能**。`WHERE enabled=1 AND is_alias=0`（当前 base 无 alias 行） |
| 2 | domain_dictionary 能否从 domain_lexicon 导出？ | **能**。含 `domain_id`；建议 canonical（`is_alias=0`）与 alias 行分处理 |
| 3 | target_dictionary 能否从 repair_target=1 过滤？ | **能**。跨 base/idiom/domain 三表 UNION；**注意**现网全部 enabled 行均为 1，target 层宜作 **boost 元数据** 而非行集过滤 |
| 4 | alias 进哪一层？ | **domain**：alias 行（16/25）进 domain_dictionary，并带 `canonical` 指向；**base/idiom** 当前无 alias 行。解码时 alias 可作为独立 surface，prior 继承 canonical |
| 5 | idiom 进 base 还是跳过？ | 建议 **并入 base_dictionary**（与现 Exporter 一致），不单独第四层；idiom 提供多字固定搭配，利于 beam |
| 6 | industry_routing_lexicon 用途？ | **仅 domain boost / 路由**（keyword→domain_id），**不**作为 IME 短语表；导出为 `routing_boost.json` 供 profile 使用 |
| 7 | 是否必须改 SQLite schema？ | **否**（本轮优先） |
| 8 | 是否可通过 Exporter 派生？ | **是** |

**优先判断**：**不改 schema**；扩展 Exporter + Spike 加载器即可。

---

## 7. Dictionary Mapping Report

### 7.1 SQLite → Pinyin IME V1 词典行

| SQLite 字段 | 词典字段 | 说明 |
|-------------|----------|------|
| （导出层） | `dictionary_type` | `base` \| `domain` \| `target` |
| `word` | `surface` | 显示/解码用字形 |
| `canonical_word` | `canonical` | alias 时必填；否则 = surface |
| `is_alias` | `is_alias` | 1 → alias penalty |
| `aliases`（JSON） | — | Exporter 可展开为多行 surface；当前未展开 |
| `pinyin_key` | `pinyin` | `\|` → 空格，无声调 |
| `tone_pinyin_key` | `tone_pinyin` | 可选；与 FW tone 距离对齐时用 |
| `prior_score` | `weight` / 派生 `imeWeight` | 见 §8 |
| `repair_target` | `target_boost` | 1 → target 层标记或 score 加成 |
| `enabled` | — | Exporter 过滤 `enabled=1` |
| `domain_id` | `domain_id` | domain_dictionary 必填 |
| `normalized` | （可选） | 可与 surface 相同 |
| `source` | （可选） | 溯源/调试 |

### 7.2 建议 TSV 头（pinyin-ime-v1）

```
# dictionary_type\tsurface\tcanonical\tpinyin\ttone_pinyin\tweight\ttarget_boost\tdomain_id\tis_alias
```

当前 Spike TSV（`word\tpinyin\tprior\trepair_target\tdomain\tis_alias`）可在 v1 中 **兼容读取**，但应标记为 legacy 格式。

---

## 8. Weight Strategy Feasibility Report

| # | 问题 | 结论 |
|---|------|------|
| 1 | 是否需要新增 `imeWeight` SQLite 字段？ | **不需要**（第一阶段） |
| 2 | 能否在 Exporter 派生 `imeWeight`？ | **能**。例如：`imeWeight = prior_score * (repair_target ? targetBoost : 1) * (is_alias ? aliasPenalty : 1) * lengthFactor` |
| 3 | prior_score → IME frequency 是否可行？ | **可行**。`dict_dp` 已用 `prior` 作 beam score；需标定缩放（与 libpinyin 频率域可能不同） |
| 4 | target_dictionary 是否应高于 base？ | **是**。加载合并时对 `target_boost=1` 词条 **加分**（而非单独解码） |
| 5 | domain_dictionary 是否按 domain_id boost？ | **是**。结合 `industry_routing_lexicon` + 请求 `enabledDomains`（sidecar 未来字段） |

**建议公式（Exporter 派生，可调参）**：

```text
imeWeight = prior_score
          * (repair_target ? 1.25 : 1.0)    // target_dictionary boost
          * (is_alias ? 0.85 : 1.0)           // alias penalty
          * domainBoost(domain_id, profile) // 默认 1.0，命中 routing 时 1.1~1.3
```

**第一阶段**：不改 schema；`ime-dict-decoder.mjs` 读取派生后的 `imeWeight` 替代裸 `prior_score`。

---

## 9. Base Dictionary Gap Report

### 9.1 当前 base_lexicon 是否足够？

| 事实 | 含义 |
|------|------|
| base 50000 行、全部 enabled、无 alias | **数据量**足以支撑通用短语 beam |
| 第一轮测试未跑 `spike:ime:export` 全量命名路径 | 实际跑的是 `export:repair`，但在现网 bundle 下 **行数=全量 72217** |
| 仍 0 candidates | 主因是 **拼音流与音节链对齐** + **单层 dict_dp**，而非 base 行数缺失 |

### 9.2 是否需要外部基础中文词典？

| 方案 | 描述 | 风险 |
|------|------|------|
| **A. 仅现有 base_lexicon + idiom** | 推荐首选 | 低；符合 L-09 单 Runtime |
| **B. 外部词典导入 V3 SQLite** | 经 `lexicon` 管线进 base_lexicon | 中；需审核 prior/拼音质量 |
| **C. Spike 专用 external base** | 仅 `tests/spike/tmp` | **高** — 易形成第二套词库，**禁止主链使用** |

**明确约束**：若需增补通用词，**必须**走 Lexicon V3.1 管理（方案 A 或 B），**不得**在 `node_runtime/` 外长期维护平行 SSOT。

### 9.3 domain 覆盖缺口

`domain_lexicon` 仅 **25** 行（16 alias），远小于 Dialog200 领域场景需求；**domain_dictionary 层需扩种**（仍通过 V3 Patch/资产，非 Spike 私有词库）。

---

## 10. Sidecar Naming and Interface Report

| 项 | 当前 | 建议 |
|----|------|------|
| 脚本/进程名 | `ime-sidecar-server.mjs` | `pinyin-ime-v1-sidecar.mjs` |
| 端口 env | `PINYIN_IME_SPIKE_PORT` | `PINYIN_IME_V1_PORT`（默认 5031 可保留） |
| 路径 | `POST /decode` | **短期保留** `/decode`；可选别名 `POST /pinyin-ime-v1/decode` |
| 请求体 | `{ pinyin, topK }` | 增加 `profile`、`enabledDomains`（可选） |
| 响应 | 无 `ok`/`source` | 对齐建议：`{ ok: true, candidates: [{ text, score, source: "pinyin-ime-v1" }] }` |
| 词典加载 | 单文件 | 目录：`PINYIN_IME_V1_DICT_DIR` 含三层 TSV |

**GPL**：继续 **进程隔离** sidecar；不在 Electron 内静态链接 libpinyin（与可行性审计一致）。

---

## 11. Script Rename Plan

（**只审计，未改 `package.json`**）

| 旧 script | 新 script（建议） |
|-----------|-------------------|
| `spike:ime:export` | `spike:pinyin-ime-v1:export:all` |
| `spike:ime:export:repair` | `spike:pinyin-ime-v1:export:target` |
| — | `spike:pinyin-ime-v1:export:base` |
| — | `spike:pinyin-ime-v1:export:domain` |
| `spike:ime:sidecar` | `spike:pinyin-ime-v1:sidecar` |
| `spike:ime:dialog200` | `spike:pinyin-ime-v1:dialog200` |
| `spike:ime:dialog200:sidecar` | `spike:pinyin-ime-v1:dialog200:sidecar` |
| `spike:ime:analyze` | `spike:pinyin-ime-v1:analyze` |

**CLI 旗标重命名**：

| 旧 | 新 |
|----|-----|
| `--repair-only` | `--layer target` 或子命令 `export:target` |
| `--out ime_dict.txt` | `--out-dir tmp/pinyin-ime-v1/` 生成 `base_dictionary.txt` 等 |

**产物命名**：

| 旧 | 新 |
|----|-----|
| `ime_dict.txt` | `base_dictionary.txt` + `domain_dictionary.txt` + `target_dictionary.txt` |
| `spike-dialog200-results.json` | `pinyin-ime-v1-dialog200-results.json` |
| `spike-report-summary.json` | `pinyin-ime-v1-report-summary.json` |
| `spike-report-latest.md` | `pinyin-ime-v1-report-latest.md`（输出到 `docs/pinyin-v1/`） |

---

## 12. Pinyin IME V1 Retest Plan

### 12.1 前置（节点端 / Lexicon）

1. `npm run lexicon:rebuild-sqlite`（Electron ABI，MODULE 119）
2. 确认 `%APPDATA%\lingua-electron-node\electron-node-config.json` 中 **`lexiconRecall.enabled=true`**
3. 启动节点，确认日志 `lexicon_runtime_status: ok`
4. `node tests/run-dialog200-timed-batch.mjs --max-minutes 15 "<dialog_200>"`

### 12.2 pinyin-ime-v1 Spike

5. `npm rebuild better-sqlite3`（系统 Node 跑 Exporter）
6. `spike:pinyin-ime-v1:export:all`（或 base + domain + target 分层）
7. `spike:pinyin-ime-v1:dialog200`（加载三层合并）
8. `spike:pinyin-ime-v1:analyze`

### 12.3 指标分离（报告必须分栏）

| 维度 | 数据源 |
|------|--------|
| ASR raw quality | `analyze-dialog200-quality-perf.mjs`（raw CER） |
| FW Detector quality | 批测 JSON `fw_*`、`text_changed` |
| Lexicon Runtime status | `lexicon_runtime_status` / `lexicon_runtime_ok_count` |
| pinyin-ime-v1 candidate quality | `pinyin-ime-v1-dialog200-results.json` topK / refInDiff |

---

## 13. Mainline Entry Gate Report

**pinyin-ime-v1 仍为离线 Spike**；入主链前（与 `freeze-contract.test.ts`、FINAL §十六 一致）：

| # | 条件 | 当前状态 |
|---|------|----------|
| 1 | Lexicon Runtime OK | **未满足**（ABI + config） |
| 2 | Dialog200 基线正常 | ASR 可测；FW/词库 **未测** |
| 3 | pinyin-ime-v1 Top5 命中率 | **0%**（detector_miss 子集） |
| 4 | KenLM would-apply 通过率 | **0%** |
| 5 | GPL / Windows sidecar 风险 | **未决**（需法务 + Win11 P95） |
| 6 | freeze-contract 扩展方案审计 | **未完成** — 入主链前须单独立项，不得默认 Spike 结果替代 FW 契约 |

**禁止**：在未过 Gate 时修改 `fw-detector/`、`main/src/pipeline`、Text Chain、Patch Service。

---

## 14. Risks

| 风险 | 级别 | 说明 |
|------|------|------|
| `repair_target=1` 全表化 | 高 | 无法区分 target/boost 与全量；Seed/标注策略需与 Lexicon 团队对齐 |
| 命名债务 | 中 | 文档/脚本/环境变量混用 `ime` 与 `repair-only`，阻碍 v1 维护 |
| 第二套词库 | 高 | 若用 external base 仅放 Spike tmp |
| `dict_dp` 假阴性 | 高 | 全量词表仍可能 0 候选；需 libpinyin 对照或改进拼音对齐 |
| 报告路径漂移 | 低 | analyze 写到 `electron_node/docs/...` |
| domain 词表过小 | 中 | 25 行不足以覆盖 Dialog200 场景 |
| GPL sidecar | 中 | 主链接入法务门槛 |

---

## 15. Final Recommendation

1. **立即采纳**正式项目名 **`pinyin-ime-v1`** 与三层词典命名（base / domain / target）。
2. **废弃** IME 层的 `repair-only` 称谓；CLI 改为 `export:target`；SQLite 字段 **`repair_target` 保留**。
3. **`target_dictionary`** 在语义上替代「repair-only 词典」说法，但实现上为 **boost 叠加层**，不能单独解码。
4. **必须**实施三层词典（Exporter + 加载合并）；当前单文件 Exporter 不满足架构目标。
5. **SQLite 支持三层导出，无需改 schema**。
6. **不要**为 pinyin-ime-v1 第一阶段改 schema；`imeWeight` Exporter 派生。
7. **base_lexicon（+ idiom）在数量上足够**；第一轮失败不能归因于「未导出 base」而应归因于对齐与加载逻辑。
8. **暂不需要**外部基础词典；若评测仍不足，优先 **方案 B 导入 V3**，禁止方案 C 进主链。
9. 外部词典若需要，**必须纳入 Lexicon V3.1 管理**。
10. **下一轮开发顺序**：**命名清理 + 三层 Exporter/加载器** → 再 Dialog200 / pinyin-ime-v1 全量复测 → 最后再考虑 dict_dp 算法或 libpinyin。

---

## 16. 最终必答题（基于代码事实）

| # | 问题 | 答案 |
|---|------|------|
| 1 | 是否确认统一命名为 pinyin-ime-v1？ | **是** |
| 2 | repair-only 是否应废弃？ | **是**（作 IME 导出/模式名）；**否**（作 SQLite 字段名） |
| 3 | target_dictionary 是否替代 repair-only？ | **是**（命名与语义层） |
| 4 | 是否需要三层词典？ | **是** |
| 5 | 当前 SQLite 是否支持三层导出？ | **是** |
| 6 | 是否需要立即修改 SQLite schema？ | **否** |
| 7 | 当前 base_lexicon 是否足够？ | **量上足够**；domain 层过薄；解码失败需先修 Exporter/加载/拼音对齐 |
| 8 | 是否需要外部基础词典？ | **现阶段不需要**；视全量三层复测后再定 |
| 9 | 若需要，是否应纳入 Lexicon V3.1？ | **是**（若走 B 方案） |
| 10 | 下一轮先做命名清理还是全量导出？ | **先做命名清理 + 三层 Exporter/合并加载**，再 `export:all` 复测 |

---

## 附录 A：下一轮 pinyin-ime-v1 正式开发工作清单（建议）

| 优先级 | 工作项 |
|--------|--------|
| P0 | 重命名 npm scripts、CLI、环境变量、产物文件名；修正 analyze 输出到 `docs/pinyin-v1/` |
| P0 | 实现 `export:base` / `export:domain` / `export:target` / `export:all` |
| P0 | `loadPinyinImeV1Dictionaries()` 三层合并 + target/domain boost |
| P1 | 更新 `pinyin-ime-v1-sidecar` 请求/响应契约 |
| P1 | `target-dictionary-index.mjs` 重命名；KenLM 门控文档化 |
| P2 | Dialog200 复测 + 与 FW/Lexicon 指标分栏报告 |
| P3 | libpinyin CLI 对照实验（GPL 决策前） |

---

*审计方法：静态阅读 `tests/spike/**`、`package.json`、`main/src/lexicon-patch-v3/row-materialize.ts`；只读查询 `node_runtime/lexicon/v3/lexicon.sqlite`；未安装依赖、未改主链。*
