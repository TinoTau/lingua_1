# electron_node 代码整理计划（2026-01）

**原则**：只做代码迁移与拆分，不改变任何接口、参数、返回结果与代码逻辑；异步如需要可用状态机管理；Import 静态部分移至文件头部。

---

## 一、已完成的拆分（示例）

### 1. text-forward-merge-manager.ts（原 563 行 → 约 365 行）

- **新增文件**：
  - `main/src/agent/postprocess/text-forward-merge-types.ts`：公共类型 `ForwardMergeResult`、`GateDecisionParams`、`GateDecisionResult`、`PendingEntry`。
  - `main/src/agent/postprocess/text-forward-merge-gate.ts`：Gate 决策函数 `decideGateAction(params): GateDecisionResult`，从 manager 迁出。
- **主文件**：`text-forward-merge-manager.ts` 从类型文件导入类型并 re-export `ForwardMergeResult`，从 gate 模块调用 `decideGateAction`，在 HOLD 时根据返回的 `pendingEntry` 写入 `pendingTexts`。
- **对外接口**：未改。`TextForwardMergeManager` 的 `processText`、`getPendingText`、`clearPendingText`、`clearAllPendingTexts` 签名与行为不变；`ForwardMergeResult` 仍由 manager 文件 re-export。
- **单测**：`text-forward-merge-manager.test.ts` 34 个用例全部通过。

---

## 二、超过 500 行的源码文件与建议拆分

| 文件 | 行数 | 建议拆分方式（仅迁移，不改接口与逻辑） |
|------|------|----------------------------------------|
| `pipeline-orchestrator/audio-aggregator.ts` | 983 | 将 buffer 生命周期（创建/删除/cleanup）、空音频检查与 TTL 检查等抽到 `audio-aggregator-buffer-lifecycle.ts` 或沿用现有 *-handler 模块；主文件只保留 `processAudioChunk` 主流程与对外 API。 |
| `main/index.ts` | 641 | 将启动步骤、IPC 注册、资源监控等拆到 `index-startup.ts`、`index-ipc.ts` 等，index 只做顺序调用与导出，不改变启动与 IPC 行为。 |
| `pipeline-orchestrator/audio-aggregator-finalize-handler.ts` | 786 | 将合并/分段逻辑抽到 `audio-aggregator-finalize-merge.ts` 等子模块，handler 只做编排与现有导出。 |
| `pipeline-orchestrator/original-job-result-dispatcher.ts` | 602 | 将片段收集、完成判定、回调触发等抽到 `original-job-result-dispatcher-internal.ts`，对外类与接口不变。 |
| `aggregator/aggregator-state.ts` | 578 | 将状态转换、commit 分支等抽到 `aggregator-state-transitions.ts`，state 类只做委托与现有导出。 |
| `gpu-arbiter/gpu-arbiter.ts` | 531 | 将队列/租约逻辑抽到现有或新增 *-queue、*-lease 模块，主文件保留对外 API。 |
| `agent/postprocess/text-forward-merge-manager.ts` | 530→365 | ✅ 已完成：Gate 决策与类型拆到 `text-forward-merge-gate.ts`、`text-forward-merge-types.ts`。 |
| `sequential-executor/sequential-executor.ts` | 541 | 将队列/状态机逻辑抽到 `sequential-executor-queue.ts` 等，对外 `execute` 等接口不变。 |
| `service-layer/ServiceProcessRunner.ts` | 549 | 将进程启动/健康检查/日志等抽到 *-runner-internal，Runner 类只做委托。 |

拆分时统一约定：

- 新模块只做实现迁移，不新增对外接口；主文件保留原有 export 与类/方法签名。
- 参数、返回值、异常与分支逻辑与原实现一致；必要时用状态机理清异步顺序，但不改变可观测行为。

---

## 三、重复逻辑合并（建议，未实施）

- **空音频 / 空 buffer 检查**：`audio-aggregator.ts` 内多处「当前为空且无 pending 则返回 EMPTY」可抽成单一纯函数 `shouldReturnEmptyInput(buffer, currentAudio, currentDurationMs)`，主流程多处调用，不改变条件与返回值。
- **Buffer 创建**：`audio-aggregator.ts` 中「新建 buffer」与「新 epoch buffer」结构相同，可抽成 `createEmptyBuffer(bufferKey, sessionId, utteranceIndex, nowMs, epoch)`，两处改为调用该函数。

合并时仅抽取实现，不改变分支条件与返回结构。

---

## 四、Import 移至文件头部

- **静态 import**：若某文件顶部已有部分 `import`，中间或尾部还有静态 `import`，应全部移至文件顶部，保持顺序与逻辑不变。
- **动态 require() / await import()**：用于按需加载、循环依赖或条件加载的，移至头部会改变加载时机与逻辑，**本次不修改**；保留在函数内。涉及文件示例：
  - `inference-service.ts`：`require('../agent/postprocess/dedup-stage')` 等
  - `index.ts`：`require('path')`、`require('electron')`、`await import('./node-config')` 等
  - `dedup-step.ts`：`require('../../agent/postprocess/dedup-stage')`
  - `node-agent-job-processor.ts`：`await import('../utils/opus-codec')`
  - 以及 `window-manager`、`python-service-manager`、`model-manager`、`port-manager` 等中的 require/动态 import

---

## 五、状态机（异步方法）

- 仅在「有必要且不改变接口与逻辑」时引入：例如将 `processAudioChunk` 内「OPEN → PENDING_TIMEOUT / PENDING_MAXDUR → FINALIZING → CLOSED」显式写成状态机表或枚举，便于维护，不改变分支与返回值。
- 当前未在本次拆分中新增状态机；若后续拆分 `audio-aggregator`、`sequential-executor` 等，可一并标注状态与迁移表。

---

## 六、后续执行顺序建议

1. 按上表对 >500 行文件逐项拆分（先 audio-aggregator，再 index、finalize-handler、dispatcher、aggregator-state、gpu-arbiter、sequential-executor、ServiceProcessRunner）。
2. 每拆一个文件后跑该模块及相关单测，确认无回归。
3. 对静态 import 分散的文件做「Import 移至头部」扫描并修改；动态 require/import 保持不动。
4. 重复逻辑合并可在拆分稳定后单独做，每次只合并一类（如空音频检查、buffer 创建）。

当前仅完成 **text-forward-merge-manager** 的拆分与类型/Gate 抽离，作为示例与模板；其余项待按上述顺序实施。
