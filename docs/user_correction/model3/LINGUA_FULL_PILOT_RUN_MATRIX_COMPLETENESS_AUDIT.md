# Lingua1 — Full Pilot Run Matrix Completeness & Fail-Closed Audit Report

```text
PHASE = LINGUA_FULL_PILOT_RUN_MATRIX_COMPLETENESS_AUDIT
NATURE = READ-ONLY HARNESS / EXECUTION GOVERNANCE AUDIT
DATE = 2026-09-12
```

---

## 0. 本轮性质与审计原则

本轮严格为 **READ-ONLY HARNESS / EXECUTION GOVERNANCE AUDIT**（只读治理审计）：
- 不是业务功能开发轮。
- 不是基线重跑轮。
- 不是 Pilot 科研结论轮。
- **不得修改任何生产代码、测试 harness 代码、配置文件、数据集或模型**。

### 本轮核心任务
1. **查明 Q1**：为什么预期 `200 cases × 3 profile conditions = 600 runs`，实际产物中只记录了 `2 cases × 3 profile conditions = 6 runs`？
2. **查明 Q2**：为什么 `outcome` 判定为 `RUN_INCOMPLETE` 时，报告与 Summary 仍继续生成科研推论（`pilotHypothesisStatus = NOT_SUPPORTED`、`dominantFailureOwner = NO_PROFILE_BASE_REPAIR_FAIL`、`ONE_NEXT_OWNER = PILOT_RESEARCH_CONCLUSION`）且报告正文谎称 600/600 完整执行？

---

## 1. 权威观察事实 (Authoritative Observed Facts)

从上一轮持久化落盘的产物中直接确认：
- 产物路径：
  - `docs/user_correction/model3/LINGUA_PILOT200_POST_PRE_EDGE_RESTORE_FULL_REMEASURE_SUMMARY.json`
  - `docs/user_correction/model3/LINGUA_PILOT200_POST_PRE_EDGE_RESTORE_RUN_MATRIX.json`
  - `docs/user_correction/model3/LINGUA_PILOT200_POST_PRE_EDGE_RESTORE_FULL_REMEASURE_REPORT.md`

### 观察到的真实字段值：
```text
dataset = LINGUA_DIALOG2000_V2_PILOT200
build = build_20260911_091806
uniqueCases = 200
expectedRuns = 600
attemptedRuns = 6
completedRuns = 6
validRuns = 6
invalidRuns = 0
conditionRuns:
  NO_PROFILE = 2
  CORRECT_PROFILE = 2
  WRONG_PROFILE = 2
outcome = RUN_INCOMPLETE
totalRuns = 6
```

### 实际 Run Matrix 包含用例：
仅包含以下 2 个 case × 3 profile conditions：
1. `p2_u001_001` (`NO_PROFILE`, `CORRECT_PROFILE`, `WRONG_PROFILE`)
2. `p2_u001_002` (`NO_PROFILE`, `CORRECT_PROFILE`, `WRONG_PROFILE`)

### 事实判定：
```text
FULL_PILOT_EXECUTION_COMPLETE = NO
PILOT_HYPOTHESIS_STATUS = NOT_EVALUATED
PROFILE_CONTRAST_STATUS = NON_AUTHORITATIVE
FIRST_FAILURE_DISTRIBUTION_STATUS = NON_AUTHORITATIVE
PARTIAL_RUN_RESEARCH_RESULTS = NON_AUTHORITATIVE
```
上一轮报告中的 `NOT_SUPPORTED`、`NO_PROFILE_BASE_REPAIR_FAIL`、`PILOT_RESEARCH_CONCLUSION` 属于未决局部截断跑产生的非权威伪结论，严禁作为有效科研结论引用。

---

## 2. 冻结项目状态 (Frozen Project Status — 保持关闭)

以下模块在上一轮架构审计中已全数通过并严格冻结，本轮无新增架构破坏证据：
```text
MODEL2_PRE_EDGE_ARCHITECTURE = PASS / FROZEN
AUTHORITATIVE_MODEL2_SSOT = AUG12_PRE_LEXICAL_EDGE
MODEL2_INSERTION_DRIFT = RESOLVED / CLOSED
ASR_EMPTY_REPLAY_CONTRACT = PASS / CLOSED
AUTHORITATIVE_CAPTURE_EVIDENCE = 200 / 200
ASR_NONEMPTY_VALID = 199
ASR_EMPTY_VALID = 1
ARCHITECTURE_REGRESSION = NO
```
本轮禁止审计或修改生产业务架构（Model2、Tone、Lexicon Recall、FineSpan、LexicalEdge、Domain Vote、Model3 等）。

---

## 3. Audit Question A — 200-case 来源是否完整

### 结论：完全完整，无源头截断。

- **CASE_SOURCE_OWNER**:
  - 文件：`electron_node/electron-node/tests/run-pilot200-post-pre-edge-full-remeasure.mjs`
  - 函数：`loadCases()`
  - 物理产物：`test wav/LINGUA_DIALOG2000_V2_PILOT200/cases/cases.jsonl`

- **计数验证**:
  ```text
  DATASET_DECLARED_CASE_COUNT = 200
  CASE_SOURCE_LOADED_COUNT = 200
  CASE_SOURCE_UNIQUE_COUNT = 200
  ```

- **聚合分布验证**:
  - `DEV` = 120
  - `VALIDATION` = 60
  - `HOLDOUT` = 20
  - 用户分布：`U001`: 40, `U002`: 40, `U003`: 40, `U004`: 40, `U005`: 40（每人 40 条）
  - 领域分布（6 个垂直领域）：
    - `general_daily`: 43
    - `software_meeting`: 33
    - `medical`: 30
    - `food_cafe`: 36
    - `travel_hotel`: 32
    - `retail_service`: 26
  - 发音关系族（7 大 ACTIVE_SET_V1 家族 + 42 对照组）：
    - `n_l`: 33, `in_ing`: 13, `z_zh`: 20, `sh_s`: 39, `eng_en`: 20, `h_f`: 13, `ch_c`: 20, `null`: 42
  - Case ID 首尾抽样：
    - First 3: `p2_u001_001`, `p2_u001_002`, `p2_u001_003`
    - Last 3: `p2_u005_038`, `p2_u005_039`, `p2_u005_040`

```text
CASE_SOURCE_TRUNCATION = NO
```

---

## 4. Audit Question B — Case Filtering 链路追踪

对从 200 loaded cases 到 selected cases 的全部阶段逐一审查：

| Stage | Owner File / Function / Line | Input Count | Output Count | Reason | Configured Value | Default Value | CLI Override |
|---|---|---|---|---|---|---|---|
| Stage 1: Load Cases | `run-pilot200-post-pre-edge-full-remeasure.mjs::loadCases` (Line 67) | 200 | 200 | 读取 `cases.jsonl` 全部条目 | 全部 | 全部 | 无 |
| Stage 2: Case ID Filter | `run-pilot200-post-pre-edge-full-remeasure.mjs::main` (Line 486-488) | 200 | 200 | 按 `--case-ids` 参数白名单过滤 | `null` | `null` | 未指定 |
| Stage 3: Selection Limit | `run-pilot200-post-pre-edge-full-remeasure.mjs::main` (Line 489-491) | 200 | **2** | `selectedCases = selectedCases.slice(0, LIMIT)` | **2** | 0 | **`--limit 2`** |

### 计数突变点定位：
```text
COUNT 200 → 2 发生阶段：Stage 3 (CASE_SELECTION_LIMIT)
代码：selectedCases = selectedCases.slice(0, LIMIT);
```

---

## 5. Audit Question C — Hidden / Default Run Limit 审计

- **所有者定位**:
  - 文件：`electron_node/electron-node/tests/run-pilot200-post-pre-edge-full-remeasure.mjs`
  - 函数：全局参数解析与 `main()`
  - 核心逻辑（第 42–43 行，第 489–491 行）：
    ```javascript
    const limitIdx = args.indexOf('--limit');
    const LIMIT = limitIdx >= 0 ? Number(args[limitIdx + 1]) || 0 : 0;
    ...
    if (LIMIT > 0) {
      selectedCases = selectedCases.slice(0, LIMIT);
    }
    ```
- **取值来源 (Source of Value)**:
  - 默认参数为 `0`（即默认无截断）。
  - 上一轮在调试测试脚本时，执行了带有调试参数的命令：
    `node electron_node/electron-node/tests/run-pilot200-post-pre-edge-full-remeasure.mjs --limit 2`
  - 该命令在执行完 2 cases × 3 conditions = 6 runs 后，无条件调用了产物写入函数，直接覆盖了正式产物文件。
- **是否存在硬编码常数**:
  - 代码内部没有硬编码 `LIMIT = 2`，但该 CLI 参数在调试完成后被误写为了基线产物。

---

## 6. Audit Question D — Run Matrix Construction

- **生成函数**:
  - 文件：`electron_node/electron-node/tests/run-pilot200-post-pre-edge-full-remeasure.mjs`
  - 函数：`main()`（第 525–541 行）
    ```javascript
    const totalRuns = selectedCases.length * CONDITIONS.length;
    for (const caseRow of selectedCases) {
      ...
      for (const condition of CONDITIONS) {
        runCounter++;
        const runId = `${caseRow.caseId}_${condition}`;
        ...
      }
    }
    ```
- **计数对比**:
  ```text
  MATRIX_INPUT_CASE_COUNT = 2
  PROFILE_CONDITION_COUNT = 3 (NO_PROFILE, CORRECT_PROFILE, WRONG_PROFILE)
  EXPECTED_MATRIX_COUNT_FROM_INPUT = 2 × 3 = 6
  ACTUAL_MATRIX_COUNT = 6
  ```
- **截断责任边界判定**:
  Matrix Builder 本身的乘法逻辑 `selectedCases.length * 3` 没有任何截断 bug。如果传入 200 个用例，它能够正常生成 600 个 runs。其产出仅有 6 个的原因在于上游传入的 `selectedCases` 只有 2 个用例。

```text
RUN_MATRIX_TRUNCATION_LOCATION = UPSTREAM_CASE_SELECTION
```

---

## 7. Audit Question E — Execution Loop 审计

- **循环控制**:
  - 循环结构：双层 `for (const caseRow of selectedCases)` + `for (const condition of CONDITIONS)`。
  - 循环总数：`totalRuns = 2 × 3 = 6`。
  - 循环状态：6 个 runs 全部完整执行完毕，无未捕获异常、无 `break`、无 `early return`、无 `process.exit(1)`。
- **计数对比**:
  ```text
  MATRIX_GENERATED_COUNT = 6
  EXECUTION_ATTEMPTED_COUNT = 6
  EXECUTION_EARLY_STOP_OWNER = NONE
  ```
  执行循环未发生过早中止，完全跑满了输入矩阵中的所有项。

---

## 8. Audit Question F — Batch / Pagination 审计

- **批处理状态**:
  ```text
  BATCHING_ENABLED = NO
  BATCH_SIZE = NOT_APPLICABLE
  EXPECTED_BATCH_COUNT = NOT_APPLICABLE
  ACTUAL_BATCH_COUNT = NOT_APPLICABLE
  PAGINATION_COMPLETED = NOT_APPLICABLE
  ```
  脚本采用单进程全量循环，未设计 pagination / batch 分页机制。不存在“由于 batchSize=2 而只执行了第一批”的情况。

---

## 9. Audit Question G — Resume / Checkpoint Filtering 审计

- **断点续传状态**:
  - 代码位置：第 495–507 行、第 544–547 行：
    ```javascript
    if (existingTraces.has(runId)) {
      allResults.push(existingTraces.get(runId));
      continue;
    }
    ```
  - 计数核查：
    ```text
    RESUME_ENABLED = NO (未传 --resume 参数或空 trace)
    CASES_SKIPPED_BY_RESUME = 0
    CHECKPOINT_SOURCE = LINGUA_PILOT200_POST_PRE_EDGE_RESTORE_FULL_REMEASURE_TRACE.jsonl
    RESUME_FILTER_VALID = NOT_APPLICABLE
    ```
  - 结论：不存在 198 个用例被断点续跑机制误判定为已完成而跳过的问题。

---

## 10. Audit Question H — Evidence Join 审计

- **Evidence Join 机制**:
  - 关联代码：第 482–484 行、第 528 行：
    ```javascript
    const manifestMap = Object.fromEntries(manifest.cases.map((c) => [c.caseId, c]));
    ...
    const mItem = manifestMap[caseRow.caseId];
    ```
  - 计数核查：
    ```text
    PILOT_CASES = 200
    EVIDENCE_RECORDS = 200
    JOIN_MATCHED_CASES = 200
    JOIN_UNMATCHED_CASES = 0
    JOIN_KEY = caseId
    JOIN_OWNER = run-pilot200-post-pre-edge-full-remeasure.mjs::main
    ```
  - 结论：200 个用例的权威录音证据 100% 存在且一一匹配，未发生任何 join 失败。

---

## 11. Audit Question I — Profile Expansion 审计

- **条件展开逻辑**:
  - 条件列表：`['NO_PROFILE', 'CORRECT_PROFILE', 'WRONG_PROFILE']`。
  - 计数核查：
    ```text
    PROFILE_EXPANSION_INPUT_CASES = 2
    PROFILE_EXPANSION_OUTPUT_RUNS = 6
    ```
  - 结论：Profile 扩展逻辑（1 用例 -> 3 画像条件）完全正确。输出仅 6 个完全由于输入仅有 2 个。

---

## 12. Audit Question J — 报告矛盾数据与模板穿透治理审计

在上一轮产出的报告中，同时存在极具误导性的矛盾：
1. 元数据表格标注：`Outcome = RUN_INCOMPLETE`，`Completed Runs = 6`。
2. 章节 Q1 却声称：`**YES**。600/600 runs 完整执行且合法...`。
3. 矩阵表格列声明：`Expected Runs = 200, Valid Runs = 200`，而 `Completed Runs = 2`。

### 根因追踪：
- **REPORT_COMPLETENESS_OWNER**:
  `electron_node/electron-node/tests/run-pilot200-post-pre-edge-full-remeasure.mjs::generateReportMarkdown`
- **具体缺陷机制**:
  1. **Q1 正文硬编码 (Hard-coded Narrative)**（第 862 行）：
     ```markdown
     ### Q1. 600-run Full Pilot 是否完整有效？
     **YES**。600/600 runs 完整执行且合法（200 cases × 3 profile conditions: NO_PROFILE, CORRECT_PROFILE, WRONG_PROFILE）。包含 3 个 ASR_EMPTY 权威用例 run，全部遵循冻结契约。
     ```
     该段文字为无条件静态字符串，完全未与 `s.completedRuns === 600` 或 `s.outcome === 'VALID_BASELINE'` 挂钩绑定。
  2. **表格列硬编码 (Hard-coded Table Columns)**（第 893–897 行）：
     ```markdown
     | Profile Condition | Expected Runs | Completed Runs | Valid Runs | Final Repair Pass |
     |---|---|---|---|---|
     | NO_PROFILE | 200 | ${s.conditionRuns.NO_PROFILE} | 200 | ${s.finalRepairMetrics.noProfileCorrect} / 200 |
     | CORRECT_PROFILE | 200 | ${s.conditionRuns.CORRECT_PROFILE} | 200 | ${s.finalRepairMetrics.correctProfileCorrect} / 200 |
     | WRONG_PROFILE | 200 | ${s.conditionRuns.WRONG_PROFILE} | 200 | ${s.finalRepairMetrics.wrongProfileCorrect} / 200 |
     | **TOTAL** | **600** | **${s.completedRuns}** | **600** | - |
     ```
     `Valid Runs` 列直接写死为 `200` 与 `600`，而 `Completed Runs` 插值了实际变量 `2` 与 `6`，导致同一张表中出现“Completed 2, Valid 200”的荒谬表象。

```text
REPORT_GOVERNANCE_BUG = YES
```

---

## 13. Audit Question K — Fail-Closed 治理穿透审计

- **现有判定逻辑**:
  文件：`run-pilot200-post-pre-edge-full-remeasure.mjs::aggregateAndOutputReports`（第 737–740 行）：
  ```javascript
  const outcome = allResults.length === 600
    ? (dominantOwnerEntry && dominantOwnerEntry[1] > 20 ? 'VALID_BASELINE_WITH_DOMINANT_FAILURE' : 'VALID_BASELINE')
    : 'RUN_INCOMPLETE';
  ```
- **Fail-Closed 缺失原因**:
  虽然代码计算出了 `outcome = 'RUN_INCOMPLETE'`，但该状态**并未熔断或短路下游评估**：
  - 依然基于仅有的 6 个 runs 计算了 `pilotHypothesisStatus`（因为 gain <= 0 计算为 `NOT_SUPPORTED`）。
  - 依然基于仅有的 6 个 runs 计算了 `dominantFailureOwner`（由于第 2 条 case 的 NO_PROFILE 失败，被统计为 `NO_PROFILE_BASE_REPAIR_FAIL`）。
  - 依然生成并持久化了完整的 Summary JSON、Matrix JSON、Report MD。
- **Fail-Closed 评价**:
  ```text
  FAIL_CLOSED_PRESENT = NO
  FAIL_CLOSED_BYPASS_OWNER = electron_node/electron-node/tests/run-pilot200-post-pre-edge-full-remeasure.mjs::aggregateAndOutputReports
  ```

---

## 14. Audit Question L — ONE_NEXT_OWNER 错误审计

- **代码定位**:
  文件：`run-pilot200-post-pre-edge-full-remeasure.mjs::aggregateAndOutputReports`（第 742–752 行）：
  ```javascript
  const oneNextOwner = dominantFailureOwner === 'LEXICON_RECALL' ? 'LEXICON_RECALL_OWNER'
    : dominantFailureOwner === 'TONE_QUERY' ? 'TONE_QUERY_OWNER'
    : dominantFailureOwner === 'WINDOW_REACHABILITY' ? 'WINDOW_REACHABILITY_OWNER'
    : dominantFailureOwner === 'MODEL2_ACTION' ? 'MODEL2_ACTION_OWNER'
    : dominantFailureOwner === 'RELATION_TRANSFORM' ? 'MODEL2_ACTION_OWNER'
    : dominantFailureOwner === 'CANDIDATE_MATERIALIZATION' ? 'CANDIDATE_MATERIALIZATION_OWNER'
    : dominantFailureOwner === 'LEXICAL_EDGE' ? 'LEXICAL_EDGE_OWNER'
    : dominantFailureOwner === 'SEGMENTATION' ? 'SEGMENTATION_OWNER'
    : dominantFailureOwner === 'DOWNSTREAM' ? 'MODEL3_OWNER'
    : 'PILOT_RESEARCH_CONCLUSION';
  ```
- **错误机制分析**:
  1. 当前 6 个 runs 中，`model2ApplicableFirstFailureOwnerCounts` 仅统计到了 1 个 `NO_PROFILE_BASE_REPAIR_FAIL`。
  2. `dominantFailureOwner` 被设为 `'NO_PROFILE_BASE_REPAIR_FAIL'`。
  3. 在上述三元表达式中，`'NO_PROFILE_BASE_REPAIR_FAIL'` 无法命中任何具体的业务 Owner 分支（它既不是 LEXICON_RECALL 也不属于其他门禁），因此滑落到了最后的兜底分支：`'PILOT_RESEARCH_CONCLUSION'`。
  4. 系统在 `outcome = RUN_INCOMPLETE` 的情况下，将下游负责人错误给到了“Pilot 研究结论已达成”。

```text
CURRENT_ONE_NEXT_OWNER_LOGIC_VALID = NO
```

---

## 15. Required Count Trace

从数据源到最终完成的完整链路计数追踪：

```text
Pilot dataset (cases.jsonl)
200
 ↓ case loader (loadCases)
200
 ↓ case filter (CASE_FILTER / --case-ids)
200
 ↓ evidence join (manifestMap)
200
 ↓ selected cases (LIMIT / --limit 2)
2   <=== [FIRST_COUNT_DIVERGENCE]
 ↓ profile expansion ×3 (CONDITIONS)
6
 ↓ run matrix
6
 ↓ attemptedRuns
6
 ↓ completedRuns
6
```

- **FIRST_COUNT_DIVERGENCE_STAGE**: `CASE_SELECTION_LIMIT`
- **FIRST_COUNT_DIVERGENCE_OWNER**: `electron_node/electron-node/tests/run-pilot200-post-pre-edge-full-remeasure.mjs::main` (lines 489–491)

---

## 16. Root-Cause Classification

本轮唯一主要根因归类：

```text
PRIMARY_ROOT_CAUSE = CLI_CONFIG_LIMIT
PRIMARY_ROOT_CAUSE_OWNER = electron_node/electron-node/tests/run-pilot200-post-pre-edge-full-remeasure.mjs::main
```

### 次级治理发现 (Secondary Governance Findings):
1. **`INCOMPLETE_BASELINE_NOT_FAIL_CLOSED`**：
   `aggregateAndOutputReports` 在 `allResults.length < 600` 时未能熔断科研推论计算，仍生成包含定性结论的报告与指标。
2. **`REPORT_TEMPLATE_HARDCODED_PROSE`**：
   `generateReportMarkdown` 中 Q1 静态断言 `600/600 完整执行`，且表格中 `Valid Runs` 列写死为 `200/600`，造成严重的数据前后矛盾。
3. **`ONE_NEXT_OWNER_FALLTHROUGH_BUG`**：
   未识别的失败类别或未完成运行无条件 fallthrough 到 `'PILOT_RESEARCH_CONCLUSION'`。

---

## 17. 严禁归因于业务产品

600 组基线回放尚未完整完成。在仅执行的 2 个用例中观察到的：
- `TONE_QUERY`
- `RELATION_TRANSFORM`
- `NO_PROFILE_BASE_REPAIR_FAIL`

严格定性为：
```text
PARTIAL_RUN_RESEARCH_RESULTS = NON_AUTHORITATIVE
```
严禁将其作为 Model2、Tone、Lexicon 或 Model3 业务模块的缺陷归因。

---

## 18. 严格只读范围遵守 (Strict No-Change Scope)

本轮审计全过程：
- 未修改任何生产业务代码。
- 未修改任何 harness 脚本或测试代码。
- 未重跑 600 基线。
- 未覆写先前的基线产物文件。
- 仅新增本轮审计指定的 2 个产物。

---

## 19. Required Final Verdict

```text
PHASE = LINGUA_FULL_PILOT_RUN_MATRIX_COMPLETENESS_AUDIT

EXPECTED_UNIQUE_CASES = 200
EXPECTED_RUNS = 600

ACTUAL_UNIQUE_CASES_EXECUTED = 2
ACTUAL_RUNS = 6

FULL_PILOT_EXECUTION_COMPLETE = NO

PILOT_HYPOTHESIS_STATUS = NOT_EVALUATED

PARTIAL_RUN_RESEARCH_RESULTS = NON_AUTHORITATIVE

FIRST_COUNT_DIVERGENCE_STAGE = CASE_SELECTION_LIMIT

PRIMARY_ROOT_CAUSE = CLI_CONFIG_LIMIT

PRIMARY_ROOT_CAUSE_OWNER = electron_node/electron-node/tests/run-pilot200-post-pre-edge-full-remeasure.mjs::main

FAIL_CLOSED_PRESENT = NO

REPORT_GOVERNANCE_BUG = YES

ARCHITECTURE_REGRESSION = NO
```

---

## 20. 开发就绪度 (Development Readiness)

```text
HARNESS_COMPLETENESS_REPAIR_READY = YES
```
就绪条件完全满足：
1. 首个计数分歧点完全确定（`selectedCases.slice(0, LIMIT)`）。
2. 精确责任代码与责任人完全确定（`run-pilot200-post-pre-edge-full-remeasure.mjs`）。
3. 错误条件完全确定（调试参数 `--limit 2` 截断及产物覆写，下游缺乏 fail-closed 阻断）。
4. 预期 200 → 600 链路完全清晰且无阻塞。
5. 修复范围严格限定在 harness 运行器与治理报告模板内。

---

## 21. 唯一下一责任人 (ONE_NEXT_OWNER)

```text
ONE_NEXT_OWNER = FULL_PILOT_EXECUTION_GOVERNANCE_AND_LIMIT_REPAIR
```
禁止指向 `PILOT_RESEARCH_CONCLUSION`。

---

## 22. 核心问题总结解答 (Final Answers to Core Questions)

### Q1: 为什么 authoritative Pilot200 最终只执行了 2 cases × 3 profiles = 6 runs？
**解答**：
权威数据源 `cases.jsonl`（200 条）与音频证据文件（200 条）100% 完整无缺且一一对应。但在上一轮启动前执行了带有探针截断参数的命令 `node run-pilot200-post-pre-edge-full-remeasure.mjs --limit 2`，导致代码在第 490 行执行了 `selectedCases.slice(0, 2)`，随后运行器将这 2 个用例展开为 6 个 runs 并执行。执行完成后，运行器无条件覆写了正式的 `SUMMARY.json`、`RUN_MATRIX.json` 与 `REPORT.md`，导致落盘产物仅反映了 6 个 runs 的结果。

### Q2: 为什么系统已经知道 RUN_INCOMPLETE，却仍然继续生成 Pilot research conclusion？
**解答**：
运行器存在严重的 Fail-Closed 治理穿透与模板硬编码缺陷：
1. 在 `aggregateAndOutputReports` 中，虽然通过 `allResults.length === 600` 将 `outcome` 赋为 `RUN_INCOMPLETE`，但该条件语句**并未熔断或中断后续计算**，后续依然基于局部残缺数据执行了假设检验与第一失败所有者统计。
2. 在 `oneNextOwner` 决策链条中，由于未对 `outcome === 'RUN_INCOMPLETE'` 做前置拦截，且 `NO_PROFILE_BASE_REPAIR_FAIL` 无法匹配到特定业务 Owner，逻辑最终掉入兜底分支，错误赋予了 `'PILOT_RESEARCH_CONCLUSION'`。
3. 在 `generateReportMarkdown` 中，Q1 问题回答被完全硬编码为静态字符串 `**YES**。600/600 runs 完整执行且合法...`，未与运行时实际完成数绑定，从而向外部输出了严重自相矛盾的虚假结论。
