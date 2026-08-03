<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: CURRENT SSOT + Acceptance Records
Archive Path: docs/archive/HISTORICAL/FW_Repair_V4_Node_Runtime_End_To_End_Execution_Audit_2026_07_30.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: CURRENT SSOT + Acceptance Records

# FW Repair V4 — Node Runtime End-to-End Execution Audit

| 字段 | 值 |
|------|-----|
| Date | 2026-07-30 |
| Nature | **READ-ONLY CODE AUDIT**（仅新增本审计报告；未改源码/测试/配置/脚本/既有文档） |
| Scope | Step7 `dialog_200` 验收真实运行层级 |
| Final Verdict | **PIPELINE_ONLY_CONFIRMED** |

---

## 1. Executive Summary

Step7 `dialog_200` **没有**启动 Electron Node Runtime、Scheduler、Job Queue，也 **没有**调用 `runFwDetectorOrchestrator`。

代码证据显示真实入口是：

```text
electron.exe (ELECTRON_RUN_AS_NODE=1)   ← 仅作 Electron ABI 的 Node 宿主
  → step7-final-freeze-dialog200-probe.mjs（顶层脚本，无 main()）
    → runSpanAssemblyV4Orchestrator({ rawText: c.text, ... })
```

输入来自 `cases.manifest.json` 的 **`text` 字符串**，不读 WAV/PCM，不经 ASR。KenLM scorer、NMT、TTS、Scheduler、ServiceRegistry **均未启动**。Lexicon SQLite **有真实打开与 Recall 查询**。

核心问题答案：**C（其它入口）** — 比选项 B 更浅一层：直接调用 Span-Assembly V4 Orchestrator，而非完整 FW Detector Orchestrator。

---

## 2. dialog_200 Entry Audit（Part A）

### 2.1 Step7（本轮冻结验收所用）

| 项 | 证据 |
|----|------|
| 入口文件 | `docs/tone-v2/_audit_scratch/step7-final-freeze-dialog200-probe.mjs` |
| 启动方式 | `ELECTRON_RUN_AS_NODE=1` + `electron.exe <probe.mjs>`（见文件头注释 L7–11） |
| `main()` | **不存在**；ESM 顶层顺序执行 |
| 真正执行函数 | `runSpanAssemblyV4Orchestrator`（L97–99 require；L145 调用） |
| 汇总自述 entry | `entry: 'runSpanAssemblyV4Orchestrator (Step 7 final freeze)'`（L276） |

### 2.2 Step6

| 项 | 证据 |
|----|------|
| 文件 | `docs/tone-v2/_audit_scratch/step6-ltr-removal-dialog200-probe.mjs` |
| 执行函数 | 同样 `runSpanAssemblyV4Orchestrator`（L93、L132） |

### 2.3 同族 Step / Phase probes（audit scratch）

| Probe | 真正执行函数 |
|-------|----------------|
| `step5-lattice-trace-dialog200-probe.mjs` | `runSpanAssemblyV4Orchestrator` |
| `step4-cross-path-merge-dialog200-probe.mjs` | `runSpanAssemblyV4Orchestrator` |
| `step3-orchestrator-lattice-cutover-dialog200-probe.mjs` | `runSpanAssemblyV4Orchestrator` |
| `step2-lattice-production-entry-dialog200-probe.mjs` | `runLatticeFineSpanGeneration` |
| `phase1-window-edge-dialog200-probe.mjs` | `runPhase1WindowEdgeHarness` |
| `phase2-path-dialog200-probe.mjs` | Phase1/2 harness |
| `phase2-path-dialog200-node-runtime-probe.mjs` | harness + SQLite 直查（仍非 Electron Runtime） |
| `dialog200-gt-ltr-probe.mjs` | 历史 LTR（已删除模块；HISTORICAL） |

### 2.4 真正的 Node Runtime / WAV E2E runners（**不是** Step7 所用）

| Runner | 路径 | 真实入口 |
|--------|------|----------|
| Timed batch | `electron_node/electron-node/tests/run-dialog200-timed-batch.mjs` | HTTP `POST /run-pipeline-with-audio`（需 test server :5020 + 已运行 Node） |
| Tone batch | `electron_node/electron-node/tests/tone-v2-dialog200-batch.js` | 对已启动 FW / Node 端口发请求（注释要求先启动 Electron Node） |

**Step7 未调用上述任一 runner。**

### 2.5 与 Step7 报告措辞对照（代码 vs 报告）

| Step7 报告位置 | 报告文字 | 代码事实 |
|----------------|----------|----------|
| §3 Production Architecture | `runFwDetectorOrchestrator → …` | 描述的是**冻结生产架构**，不是 probe 调用链 |
| §14 dialog_200 Results | `入口：runSpanAssemblyV4Orchestrator` | **与代码一致** |
| Executive Summary “真实生产 orchestrator” | 易被读成完整 Runtime E2E | 实际 = **Span-Assembly V4 生产函数直调** |

---

## 3. Real Call Chain（Part B）

### 3.1 Step7 真实调用链（文件 → 函数 → 方向）

```text
[Host]
electron_node/electron-node/node_modules/electron/dist/electron.exe
  env: ELECTRON_RUN_AS_NODE=1
  argv: step7-final-freeze-dialog200-probe.mjs
  说明: Electron 二进制以 Node 模式跑脚本；不进入 app.whenReady()
        ↓
[Probe top-level — 无 main()]
docs/tone-v2/_audit_scratch/step7-final-freeze-dialog200-probe.mjs
  require(dist/.../lexicon-runtime-v2.js) → LexiconRuntimeV2
  runtime.loadFromBundleDir(node_runtime/lexicon/v3)
  loadFwDetectorRuntimeConfig / loadPinyinImeV2* / resolveRecallScope
  JSON.parse(test wav/dialog_200/cases.manifest.json)
        ↓ for each case
  runSpanAssemblyV4Orchestrator({
    rawText: c.text,          // manifest 字符串，非 wav
    runtime, profile, recallDomainScope, minPrior, imeConfig, dict,
    domainPriors: []
    // 未传: acousticSlices, asrSegments, wordTimeSpans 相关输入
  })
        ↓
[PRODUCTION MODULE]
electron_node/.../span-assembly-v4/span-assembly-v4-orchestrator.ts
  export function runSpanAssemblyV4Orchestrator
        ↓
  buildUtteranceSyllableCoordinate
  partitionCoarseSpans
  buildWordTimeSpans(rawText, asrSegments??[], ...)   // ASR 段为空
  runLatticeFineSpanGeneration(...)
        ↓
[PRODUCTION MODULE]
lattice-fine-span-runtime.ts :: runLatticeFineSpanGeneration
  buildLexicalWindowQueries
  latticeHardBlockFilter
  createUtteranceRecallContext (默认开启)
  recallTopKForWindows → LexiconRuntimeV2 SQL
  edge / fallback / enumerateCompleteSegmentationPaths / materializePathFineSpans
        ↓ 返回 orchestrator
  per path: rebindToneForFineSpan → runDomainAwareAssembly → buildSentenceCandidates
  mergeCrossPathSentenceCandidates
  return { kenlmSentenceCandidates, latticeTrace, metrics, ... }
        ↓
[Probe]
  统计硬门；写 step7_final_freeze/*.json
  process.exit(0|2)
```

### 3.2 调用链在此终止

以下函数/模块在 Step7 probe 中 **无任何 require/call**：

* `main/src/index.ts` · `app.whenReady`
* `runFwDetectorOrchestrator` · `runFwDetectorV4Path`
* `runFwSentenceRerankFromPrefilled`
* `test-server.ts` · `/run-pipeline-with-audio`
* Scheduler / JobQueue / ServiceRegistry / NodeAgent

---

## 4. Runtime Bootstrap Audit（Part C）

| 符号 / 机制 | Step7 dialog_200 |
|-------------|------------------|
| `runNodeRuntime` | **NOT EXECUTED** |
| `createRuntime` / `bootstrapRuntime` | **NOT EXECUTED** |
| `RuntimeHost` | **NOT EXECUTED** |
| `NodeBootstrap` / `app-init-simple` | **NOT EXECUTED** |
| `Electron Main` (`app.whenReady`) | **NOT EXECUTED** |
| `Electron Worker` | **NOT EXECUTED** |
| `ServiceRegistry` / `ServiceProcessRunner` | **NOT EXECUTED** |
| `ELECTRON_RUN_AS_NODE=1` | **EXECUTED** — 仅 ABI 宿主，≠ Runtime 启动 |

证据：probe 从不 import `electron` 的 `app`；`index.ts` 的 `app.whenReady().then(...)` 不会因 `ELECTRON_RUN_AS_NODE` 脚本路径被加载。

---

## 5. Scheduler Audit（Part D）

| 检查 | 结果 |
|------|------|
| `schedule()` / `dispatch()` / `submitJob()` / `runJob()` | Step7 probe **无调用** |
| worker thread / job queue | **无** |
| HTTP Scheduler (5010) | **无** |

```text
Scheduler = NO
```

---

## 6. Job Lifecycle Audit（Part F）

```text
不存在 Job Create → Start → Running → Complete → Destroy
```

实际生命周期：

```text
for case in manifest:
  runSpanAssemblyV4Orchestrator(...)  // sync function call
  → return result object
```

**Job 生命周期：不存在。**

---

## 7. Service Startup Audit（Part E）

判定标准：真正实例化并运行，非仅存在于仓库。

| Service | 状态 | 代码依据 |
|---------|------|----------|
| ASR Service | **Not Started** | 无 wav；无 `/run-pipeline-with-audio`；无 ASR 进程 |
| Tone Service（声学模型进程） | **Not Started** | 未传 `acousticSlices`；无 Tone 服务启动 |
| Lexicon Runtime | **Started** | `new LexiconRuntimeV2()` + `loadFromBundleDir` + Recall SQL |
| KenLM Runtime（subprocess scorer） | **Not Started / Bypassed** | orchestrator 只组装 `kenlmSentenceCandidates`；probe **不**调用 `runFwSentenceRerankFromPrefilled` |
| NMT Service | **Not Started** | 无调用 |
| TTS Service | **Not Started** | 无调用（manifest 虽由历史 TTS 生成 wav，本 probe 不读 audio） |
| Pinyin IME dict | **Loaded in-process** | `loadPinyinImeV2Dictionaries` — 库内加载，非独立 Service 进程 |

Tone **映射代码路径**（`rebindToneForFineSpan`）可能在空/缺切片下执行，但这是 **库内函数**，不是 Tone Service Started。

---

## 8. Input Source Audit（Part G）

| 项 | 值 |
|----|-----|
| 真正输入类型 | **Sentence / Orchestrator DTO 字段 `rawText`** |
| 真正来源 | `test wav/dialog_200/cases.manifest.json` → `cases[].text` |
| WAV / RAW PCM | **未读取**（manifest 有 `file`/`audio` 字段，probe 未使用） |
| ASR JSON | **未使用** |
| FW JSON | **未使用** |

分类结论：**Sentence（manifest text）→ SpanAssemblyV4OrchestratorInput.rawText**

---

## 9. SQLite Usage Audit（Part H）

| 层 | Step7 是否真正访问 |
|----|-------------------|
| Lexicon SQLite (`better-sqlite3` via `LexiconRuntimeV2`) | **YES** — `loadFromBundleDir` 打开 DB；`recallTopKForWindows` 查询 |
| Utterance Recall Cache（进程内） | **YES（默认）** — lattice 默认 `createUtteranceRecallContext`；非独立 SQLite 服务 |
| 其它 Runtime Job Cache | **NO** |

不得仅因“代码里有 SQLite”下结论；本结论基于 probe → orchestrator → lattice → recall → `LexiconRuntimeV2` 的实链。

---

## 10. Module Execution Matrix（Part I）

```text
dialog_200 (manifest text)
  ↓ EXECUTED
step7-final-freeze-dialog200-probe.mjs
  ↓ EXECUTED (ABI host only)
electron.exe + ELECTRON_RUN_AS_NODE
  ↓ NOT EXECUTED
Electron Runtime / index.ts / app.whenReady
  ↓ NOT EXECUTED
Scheduler
  ↓ NOT EXECUTED
Job Queue
  ↓ NOT EXECUTED
ASR
  ↓ DIRECT CALL / EXECUTED
runSpanAssemblyV4Orchestrator  (= FW Span-Assembly 子链，非完整 FW path)
  ↓ EXECUTED
Lattice / Window / Recall / LexicalEdge / Path / Vote / Assembly / Cross-Path Merge
  ↓ EXECUTED (in-process)
Lexicon Runtime + SQLite Recall
  ↓ PARTIAL / LIBRARY ONLY
Tone rebind（无 Tone Service；无 acousticToneSlices 输入）
  ↓ BYPASSED
KenLM scorer subprocess / raw_log_delta apply
  ↓ NOT EXECUTED
NMT
  ↓ NOT EXECUTED
TTS
  ↓ NOT EXECUTED
WebSocket / JobResult 回传
  ↓ EXECUTED
写 audit JSON（本地文件系统）
```

| 模块 | 标记 |
|------|------|
| Electron Runtime | **NOT EXECUTED** |
| Scheduler | **NOT EXECUTED** |
| Job Queue | **NOT EXECUTED** |
| ASR | **NOT EXECUTED** |
| FW（完整 `runFwDetectorOrchestrator`） | **NOT EXECUTED** |
| FW Span-Assembly Orchestrator | **DIRECT CALL / EXECUTED** |
| Tone Service | **NOT EXECUTED** |
| Lexicon | **EXECUTED** |
| Recall | **EXECUTED** |
| Assembly | **EXECUTED** |
| KenLM Runtime | **BYPASSED**（仅候选池，无 scorer） |
| NMT | **NOT EXECUTED** |
| TTS | **NOT EXECUTED** |
| WebSocket | **NOT EXECUTED** |
| Result（JobResult） | **NOT EXECUTED**（本地 probe 摘要） |

---

## 11. Runtime vs Direct Call Comparison（Part 核心问题）

### 选项判定

| 选项 | 是否成立 |
|------|----------|
| **A** Electron Runtime → Scheduler → … → dialog_200 | **否** |
| **B** 直接 `runFwDetectorOrchestrator()` → dialog_200 | **否**（函数名不匹配；该函数未被 require/call） |
| **C** 其它入口 | **是** |

**C 的精确定义：**

```text
ELECTRON_RUN_AS_NODE 宿主
  → 直接 import/require dist 模块
  → runSpanAssemblyV4Orchestrator(rawText=manifest.text)
  → 返回 SpanAssembly 结果（含 prefilled KenLM pool，但不跑 KenLM）
```

相对 B：同属“直调生产库函数”，但停在 **Span-Assembly V4**，未进入：

```text
runFwDetectorOrchestrator
  → runFwDetectorV4Path
    → runSpanAssemblyV4Orchestrator
    → runFwSentenceRerankFromPrefilled
```

---

## 12. Test Classification（Part J）

```text
Pipeline Test（Production Orchestrator 子链集成）
偏 Integration Test
```

**不是** Full End-to-End Test / System Test / Runtime Test。

原因（代码级）：

1. 无 Electron App / Service 生命周期  
2. 无 Scheduler / Job  
3. 无音频与 ASR  
4. 输入为金标/manifest 文本，非 ASR 输出  
5. 无 KenLM 评分与 Apply Gate  
6. 无 NMT / 端到端 JobResult  

可准确描述为：

```text
Production Span-Assembly V4 Orchestrator × dialog_200 text corpus
Pipeline / Integration Acceptance Probe
```

---

## 13. Missing Steps Before True E2E（Part K）

仅列缺失项（禁止本轮开发）：

1. 启动真正 Electron Node（`main/src/index.ts` → `app.whenReady` → `initializeServices` / `startServicesByPreference`）  
2. 启动/就绪 ASR、Tone、KenLM、NMT 等 **Service 进程**（ServiceRegistry）  
3. 启动 Test Server / 节点 HTTP（如 `:5020`）或等价 Job 入口  
4. （若走集群路径）启动 Scheduler，经 Job Queue 提交  
5. 使用 `cases[].audio` / WAV（或 RAW PCM）作为输入，而非 `cases[].text`  
6. 经 ASR → FW（`runFwDetectorOrchestrator` / pipeline step）→ Tone 证据 → KenLM rerank → Apply →（可选）NMT  
7. 收集 JobResult / pipeline JSON，而非仅 Span-Assembly 返回对象  
8. 用现有 E2E runner 之一实际跑满 200：例如 `tests/run-dialog200-timed-batch.mjs` 或 `tests/tone-v2-dialog200-batch.js`（需前置 Runtime 已起）

---

## 14. Final Verdict

```text
PIPELINE_ONLY_CONFIRMED
```

当前 Step7 `dialog_200` **只是**：

```text
Production Orchestrator（准确：runSpanAssemblyV4Orchestrator）
Pipeline Integration Probe
```

**不是**：

```text
Electron Node Runtime End-to-End Test
```

### 证据摘要（不可省略）

1. Probe L97–99 / L145：唯一业务入口 = `runSpanAssemblyV4Orchestrator`  
2. Probe 无 `runFwDetectorOrchestrator` / `runFwDetectorV4Path` / `runFwSentenceRerankFromPrefilled`  
3. 输入 = `c.text`（Sentence），非 WAV  
4. `ELECTRON_RUN_AS_NODE` ≠ `app.whenReady` Runtime bootstrap  
5. Scheduler / Job / ASR / NMT / TTS / KenLM scorer = NOT EXECUTED  
6. Lexicon SQLite Recall = EXECUTED（库内，非 Runtime Service 编排）

---

## Appendix — 与选项 A/B 的一句话对照

| 问法 | 答案 |
|------|------|
| 是否真正启动 Electron Node Runtime？ | **否** |
| 是否 Scheduler E2E？ | **否** |
| 是否直接 `runFwDetectorOrchestrator`？ | **否** |
| 真实入口是谁？ | **`runSpanAssemblyV4Orchestrator`（C）** |
