# 节点端 Import 移至头部 & 重复逻辑罗列（2026-01）

**决策审议**：重复逻辑的上下游流程与审议要点已整理为独立文档，供决策部门审议：  
→ **[重复逻辑及上下游流程_决策审议_2026_01.md](./重复逻辑及上下游流程_决策审议_2026_01.md)**

---

## 一、Import 移至头部（已完成）

**约定**：仅移动**静态** `import ... from '...'` 到文件顶部；`require()` / `await import()` 保留在函数内，不移动。

### 已修改文件

| 文件 | 改动说明 |
|------|----------|
| `main/src/index.ts` | 原：第 6–9 行 import，第 11–12 行 `installDiagnosticHooks(); setupCudaPath();`，第 14–27 行再有静态 import。现：所有静态 import（6–22 行）集中在顶部，随后再执行 `installDiagnosticHooks(); setupCudaPath();`。`require('path')` / `require('electron')` 仍在 `app.whenReady()` 内，未动。 |
| `main/src/agent/postprocess/semantic-repair-stage.test.ts` | 原：第 6–9 行 import，中间 `jest.mock(...)`，第 16–18 行再有 import。现：所有 import 移至最前（6–12 行），再跟 `jest.mock(...)`。 |
| `main/src/agent/postprocess/translation-stage.context.test.ts` | 原：第 6–9 行 import，中间 `jest.mock(...)`，第 15–16 行再有 import。现：所有 import 移至最前（6–11 行），再跟 `jest.mock(...)`。 |

### 未改动的（符合约定）

- **动态 require/import**：如 `inference-service.ts`、`dedup-step.ts`、`node-agent-job-processor.ts`、`index.ts` 内 `require('path')`/`require('electron')`、`window-manager`、`model-manager`、`port-manager`、`system-resources.ts` 等函数内 `require('child_process')` 等，一律保留在原位。

---

## 二、重复逻辑罗列（供确认后再实施）

以下为计划文档与扫描结果汇总，**是否合并请由你确认**。

### 1. 计划中已列、当前实现状态

| 项 | 计划描述 | 当前状态 |
|----|----------|----------|
| **空音频 / 空 buffer 检查** | `audio-aggregator.ts` 内「当前为空且无 pending 则返回 EMPTY」抽成 `shouldReturnEmptyInput(...)`，主流程多处调用。 | **已做**：`audio-aggregator-buffer-lifecycle.ts` 已导出 `shouldReturnEmptyInput`，`audio-aggregator.ts` 在两处（约 233、476 行）调用，无重复内联实现。 |
| **Buffer 创建** | `audio-aggregator.ts` 中「新建 buffer」与「新 epoch buffer」结构相同，抽成 `createEmptyBuffer(...)`。 | **已做**：`audio-aggregator-buffer-lifecycle.ts` 已导出 `createEmptyBuffer`，主文件通过该函数创建 buffer，无重复创建逻辑。 |

以上两项无需再合并。

### 2. 可选重复/一致化（需你确认是否做）

| 项 | 位置与说明 | 建议 |
|----|------------|------|
| **sessionId 作 bufferKey 的临时兼容** | `audio-aggregator.ts` 中两处：`clearBuffer(sessionId)`（约 855 行）、`getBufferStatus(sessionId)`（约 941 行）均为 `const bufferKey = sessionId;  // 临时兼容`。为兼容旧 API 用 sessionId 当 key。 | 若后续统一改为 bufferKey 入参，可抽成例如 `sessionIdToBufferKey(sessionId: string): string` 或保留注释即可；当前仅为两处相同写法，非大块重复逻辑。 |
| **测试中 buildBufferKey 的重复调用** | `audio-aggregator.test.ts` 等测试里多处 `const bufferKey = buildBufferKey(job)` 或 `buildBufferKey(jobA1)`。 | 属测试写法一致，一般不视为「重复逻辑合并」对象；若你希望测试也抽公共 helper 可再做。 |

### 3. 其它扫描结论

- **pipeline-orchestrator**：未发现新的、与「空 buffer 判断」或「buffer 创建」同级别的重复实现。
- **aggregator / task-router**：未发现与计划中两项同类的重复逻辑。

---

## 三、后续建议

1. **Import**：若后续在新文件中出现「中间或尾部还有静态 import」，可继续按本节约定移至头部。
2. **重复逻辑**：上述 2 中两项若确认要合并，再单独做小改动（如抽 `sessionIdToBufferKey` 或测试 helper），并保持行为与现有注释一致。
