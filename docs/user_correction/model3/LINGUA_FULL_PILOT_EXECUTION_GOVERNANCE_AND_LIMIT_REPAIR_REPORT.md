# Lingua1 — Full Pilot Execution Governance & Limit Repair Report

```text
PHASE = LINGUA_FULL_PILOT_EXECUTION_GOVERNANCE_AND_LIMIT_REPAIR
NATURE = SINGLE-DELTA HARNESS GOVERNANCE REPAIR + ACCEPTANCE
DATE = 2026-09-12
```

---

## 1. Scope (本轮范围与执行边界)

本轮严格为 **SINGLE-DELTA HARNESS GOVERNANCE REPAIR + ACCEPTANCE**：
- **不是 Pilot200 正式重测**，本轮未执行正式 600-run baseline。
- **唯一目标**：修复 Full Pilot runner 的 execution completeness / partial-run / authoritative artifact / fail-closed 治理，使任何 probe / partial / limited run 都不能再冒充完整 Pilot baseline、不能覆盖 authoritative Full Pilot artifacts、不能生成 authoritative research conclusion。
- 修复完成并通过全面验收后立即 **STOP**，下一轮才正式执行 600-run Pilot200 重测。

---

## 2. Pre-change Defects (变更前缺陷总结)

上一轮只读审计中确证的核心缺陷：
1. **CLI 参数无隔离截断**：`--limit 2` 将选定用例截断为 2 条（6 runs），随后无条件覆盖了正式基线文件。
2. **Fail-Closed 治理穿透**：当 `outcome = 'RUN_INCOMPLETE'` 时，下游未熔断，依然计算研究结论（如将收益增量 0 计算为 `NOT_SUPPORTED`）。
3. **ONE_NEXT_OWNER 滑落缺陷**：未匹配到特定门禁的失败类型在残缺运行时兜底滑向 `'PILOT_RESEARCH_CONCLUSION'`。
4. **报告模板硬编码谎言**：Markdown 报告正文中静态写死 `600/600 runs 完整执行且合法`，且表格中 `Valid Runs` 列写死为 `200` 与 `600`。
5. **权威产物缺乏写入门禁**：Partial 探针直接覆写权威 Baseline 产物。

---

## 3. KEEP / MODIFY / DELETE / ADD

### KEEP (保持不变)
- `--limit N`：保留合法的单次调试/截断能力。
- `--case-ids ...`：保留 targeted case 回放能力。
- `--skip-start` 与 `--resume` 参数。
- `loadCases()`（200 cases）、`loadManifest()`（200 evidence records）、profile 展开逻辑。
- Model2 / ASR_EMPTY / 门禁 A–I 评估纯函数。
- 冻结的生产业务架构（Model2、Tone、Lexicon Recall、Model3 等，零变动）。

### MODIFY (修改强化)
- `run-pilot200-post-pre-edge-full-remeasure.mjs::main`：引入自动执行模式检测与 trace 路径分流。
- `run-pilot200-post-pre-edge-full-remeasure.mjs::aggregateAndOutputReports`：前置严密完整性校验与 Fail-Closed 控制流。
- `run-pilot200-post-pre-edge-full-remeasure.mjs::generateReportMarkdown`：去硬编码，所有文本、标题和表格与运行时实际完成数动态绑定。
- `oneNextOwner` 决策树：非完整运行强制指向全量重测，未知归因强制归为未决。

### DELETE (彻底删除)
- 删除 Q1 中硬编码的静态谎言 `"**YES**。600/600 runs 完整执行且合法..."`。
- 删除表格中写死的 `200` 与 `600` 列。
- 删除将未知或残缺结果兜底赋予 `'PILOT_RESEARCH_CONCLUSION'` 的错误分支。
- 删除 Partial 运行直接覆写 Authoritative 文件的调用路径。

### ADD (新增机制)
- `validatePilotCompleteness(allCases, allResults)`：严格核验 200 cases、600 unique runs、600 unique caseId×condition，以及 200/200/200 条件平衡。
- Authoritative Artifact Write Guard：权威产物写入物理门禁。
- 独立的 Partial 探针产物路径：`LINGUA_PILOT200_POST_PRE_EDGE_RESTORE_PARTIAL_PROBE_*`。
- 治理综合单测套件：`electron_node/electron-node/tests/test-pilot200-governance.mjs`。

---

## 4. FULL / PARTIAL Contract (模式划分契约)

运行器根据启动参数和选定用例集合自动划定模式，无需用户手动传入额外 flag：
- **`FULL` 模式**：
  - 未使用截断参数或 `LIMIT >= 200`
  - 未指定白名单参数或 `CASE_FILTER.size >= 200`
  - `selectedCases.length === 200`
  - 期望运行 `expectedRuns = 600`
- **`PARTIAL` 模式**：
  - 传入了 `0 < LIMIT < 200`（如 `--limit 2`）
  - 传入了 `--case-ids` 导致未选中全部 200 条
  - `selectedCases.length < 200`
  - 自动打上 `executionMode = 'PARTIAL'` 与 `authoritative = false` 标签。

---

## 5. Authoritative Completeness Invariant (权威完整性不变量)

执行权威基线判定的充要条件：

```text
AUTHORITATIVE_FULL_PILOT
IFF
uniqueCases == 200
AND
completedRuns == 600
AND
validRuns == 600
AND
conditionRuns.NO_PROFILE == 200
AND
conditionRuns.CORRECT_PROFILE == 200
AND
conditionRuns.WRONG_PROFILE == 200
AND
unique runId == 600
AND
unique (caseId × condition) == 600
```

只有当该充要条件完全成立时，运行器才允许计算基线指标并开放正式研究结论评估。

---

## 6. Artifact Isolation (产物隔离机制)

对任何 `PARTIAL` 或残缺运行，运行器使用独立产物文件树，绝对禁止覆写权威文件：

| 角色 | 权威文件 (Authoritative) | 探针/非权威文件 (Partial Probe) |
|---|---|---|
| **Trace** | `..._FULL_REMEASURE_TRACE.jsonl` | `..._PARTIAL_PROBE_TRACE.jsonl` |
| **Summary** | `..._FULL_REMEASURE_SUMMARY.json` | `..._PARTIAL_PROBE_SUMMARY.json` |
| **Matrix** | `..._FULL_REMEASURE_RUN_MATRIX.json` | `..._PARTIAL_PROBE_RUN_MATRIX.json` |
| **Report** | `..._FULL_REMEASURE_REPORT.md` | `..._PARTIAL_PROBE_REPORT.md` |

---

## 7. Fail-Closed Implementation (熔断流向实施)

```text
执行执行循环 (Replay Loop)
  ↓
收集 allResults
  ↓
调用 validatePilotCompleteness(allCases, allResults)
  ↓
判定 isAuthoritativeFullRun = (executionMode === 'FULL') && completeness.isValid
  ↓
[分支 A: isAuthoritativeFullRun === false (Fail-Closed)]
  ├─ outcome = 'RUN_INCOMPLETE'
  ├─ dominantFailureOwner = 'NOT_COMPUTED_FOR_INCOMPLETE_BASELINE'
  ├─ pilotHypothesisStatus = 'NOT_EVALUATED'
  ├─ profileContrastStatus = 'NON_AUTHORITATIVE'
  ├─ firstFailureDistributionStatus = 'NON_AUTHORITATIVE'
  ├─ partialRunResearchResults = 'NON_AUTHORITATIVE'
  ├─ oneNextOwner = 'PILOT200_POST_PRE_EDGE_RESTORE_FULL_REMEASURE'
  └─ 目标路径锁定为 PARTIAL 路径，权威文件受保不被修改。
  ↓
[分支 B: isAuthoritativeFullRun === true]
  ├─ 允许进入全量假设检验与业务归因计算
  └─ 写入权威路径
```

---

## 8. ONE_NEXT_OWNER Repair (唯一步骤责任人修复)

修复后的归因优先级：
1. **前置完整性检查**：如果基线未完成（`!isAuthoritativeFullRun`），无论局部观察到什么失败，`ONE_NEXT_OWNER` 一律指派为：
   `PILOT200_POST_PRE_EDGE_RESTORE_FULL_REMEASURE`
   绝对不给任何虚假研究结论。
2. **完整基线失败归因**：按门禁（LEXICON_RECALL、TONE_QUERY 等）分配对应业务责任人。
3. **未识别失败防护**：若出现未知类别，指派给 `'UNRESOLVED_MEASUREMENT_OWNER'`，绝不滑落至 `'PILOT_RESEARCH_CONCLUSION'`。

---

## 9. Report Generator Repair (报告生成器去硬编码)

- 增加顶部全局警示横幅：
  `> ⚠️ GOVERNANCE WARNING: PARTIAL / PROBE RUN (NON-AUTHORITATIVE)`
- Q1 回答绑定实际运行变量：
  `**NO**。本次仅执行了 ${s.completedRuns}/600 runs（覆盖 ${s.uniqueCases}/200 cases）...`
- Section 2 矩阵表格中，`Expected Runs`、`Completed Runs`、`Valid Runs` 与分条件计数完全动态对应。
- 研究问题 Q2–Q8 明确标记 `[NON-AUTHORITATIVE PARTIAL OBSERVATION]` 或 `[NOT EVALUATED]`。

---

## 10. Resume Semantics (断点续传语义)

- `--resume` 在 `PARTIAL` 模式下仅读取 `PARTIAL_PROBE_TRACE.jsonl`，在 `FULL` 模式下读取全量 trace。
- 断点恢复后的最终判定依然基于 `validatePilotCompleteness`。只有当 trace 中累计包含全部 600 个唯一 `caseId × condition` 时，才允许判定为 `FULL`。

---

## 11. ASR_EMPTY Regression (合法性回归确认)

- 用例 `p2_u001_001` 的 3 个 profile runs 处于 `ASR_EMPTY` 状态，这是真实录音证据的合法现象。
- 完整性校验器 `validatePilotCompleteness` 将其作为合法的 `VALID RUN` 纳入计数，不造成任何假阴性完整性误杀。

---

## 12. Tests A–G 验收结果汇总

| 测试用例 | 测试类型 | 测试目标与输入 | 预期与实测结果 | 结论 |
|---|---|---|---|---|
| **Test A** | 真实探针 | `--limit 2 --skip-start` | 选定 2 cases (6 runs)，模式标记 PARTIAL，fail-closed 生效，写入独立 PARTIAL 产物，权威产物未被触碰 | **PASS** |
| **Test B** | 目标探针 | `--case-ids p2_u001_001,p2_u001_002` | 选定 2 cases (6 runs)，模式标记 PARTIAL (CASE_IDS)，写入 PARTIAL 产物，权威产物未被触碰 | **PASS** |
| **Test C** | 仿真基线 | 200 cases × 3 profiles = 600 unique runs | 校验器返回 `isValid: true`，模式标记 FULL，允许写入权威基线路径 | **PASS** |
| **Test D** | 重复防护 | 600 条记录但包含重复 `runId` | 校验器精准拦截 `Duplicate runId detected`，自动 fail-close 并降级为 PARTIAL | **PASS** |
| **Test E** | 失衡防护 | 600 条记录但条件分布为 201/200/199 | 校验器拦截条件失衡，自动 fail-close 并降级为 PARTIAL | **PASS** |
| **Test F** | 空流回归 | 包含 `p2_u001_001` (ASR_EMPTY) × 3 | 确认为 valid runs，正常通过完整性校验 | **PASS** |
| **Test G** | 报告一致性 | 对 partial fixture 生成 Markdown | 确认无硬编码 600/600 谎言、无硬编码 200 列、包含警告横幅、责任人正确指派 | **PASS** |

---

## 13. Artifact Overwrite Check (权威产物哈希比对)

在经过 Test A 和 Test B 的真实执行后，对权威基线文件进行 SHA256 哈希比对：

| 权威基线文件路径 | 初始哈希 (SHA256) | 探针测试后哈希 (SHA256) | 是否覆写 |
|---|---|---|---|
| `docs/user_correction/model3/..._SUMMARY.json` | `fb096e87b53cdc0482190f001c84910267899e339a486e0bb41e21e358409ac8` | `fb096e87b53cdc0482190f001c84910267899e339a486e0bb41e21e358409ac8` | **NO (完全一致)** |
| `docs/user_correction/model3/..._RUN_MATRIX.json` | `66cd140d857a37eb0d6c845d9295aa4d4ee39e18022b369f17ac287e8aa08a3b` | `66cd140d857a37eb0d6c845d9295aa4d4ee39e18022b369f17ac287e8aa08a3b` | **NO (完全一致)** |
| `docs/user_correction/model3/..._REPORT.md` | `ac82efbc0ced8d647790a86af199ce0cbfcde50882611b842e790da6daff655d` | `ac82efbc0ced8d647790a86af199ce0cbfcde50882611b842e790da6daff655d` | **NO (完全一致)** |

权威基线文件受到 Write Guard 的物理保护，未发生任何非授权覆写。

---

## 14. Changed Files (变更文件列表)

1. `electron_node/electron-node/tests/run-pilot200-post-pre-edge-full-remeasure.mjs`：
   - 增加完整性校验纯函数 `validatePilotCompleteness`
   - 增加执行模式自动检测与路径分流
   - 实施 Fail-Closed 熔断与 Write Guard
   - 去除 Markdown 报告中的所有静态硬编码
2. `electron_node/electron-node/tests/test-pilot200-governance.mjs`：
   - 新增针对 Test C、D、E、F、G 的综合单测套件

---

## 15. Production Boundary Verification (生产边界验证)

```text
HARNESS_ONLY_CHANGE = YES
PRODUCT_CODE_CHANGE = NO
MODEL2_CHANGE = NO
TONE_CHANGE = NO
LEXICON_CHANGE = NO
MODEL3_CHANGE = NO
DATASET_CHANGE = NO
ARCHITECTURE_REGRESSION = NO
```
未修改任何生产核心源码、网络协议、模型推理、权重或数据集，生产业务架构严格保持冻结。

---

## 16. Acceptance Verdict (最终验收裁定)

```text
LIMIT_OPTION_PRESERVED = PASS
CASE_IDS_OPTION_PRESERVED = PASS
PARTIAL_RUN_CLASSIFICATION = PASS
PARTIAL_ARTIFACT_ISOLATION = PASS
AUTHORITATIVE_ARTIFACT_WRITE_GUARD = PASS
RUN_INCOMPLETE_FAIL_CLOSED = PASS
PILOT_HYPOTHESIS_NOT_EVALUATED_ON_PARTIAL = PASS
PROFILE_CONTRAST_NON_AUTHORITATIVE_ON_PARTIAL = PASS
DOMINANT_FAILURE_NOT_COMPUTED_ON_PARTIAL = PASS
ONE_NEXT_OWNER_FAIL_CLOSED = PASS
REPORT_HARDCODED_COMPLETENESS_REMOVED = PASS
REPORT_RUNTIME_COUNTS = PASS
600_RECORD_DUPLICATE_PROTECTION = PASS
200_200_200_CONDITION_COMPLETENESS = PASS
ASR_EMPTY_VALID_RUN_SEMANTICS = PASS
AUTHORITATIVE_ARTIFACT_OVERWRITE_BY_PROBE = NO
PRODUCT_CODE_CHANGE = NO
ARCHITECTURE_REGRESSION = NO

OVERALL_ACCEPTANCE = PASS
```

---

## 17. 唯一下一步 (ONE_NEXT_OWNER)

根据治理规则，本轮修复与验收已全部完成闭环，下一阶段正式执行真实 600-run Pilot200 重测：

```text
ONE_NEXT_OWNER = PILOT200_POST_PRE_EDGE_RESTORE_FULL_REMEASURE
```
*(本轮执行治理修复任务已完成，严格 STOP)*
