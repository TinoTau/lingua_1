# R0/R1 测试修复：逐文件最小 Patch 清单（仅测试）+ 回归 Checklist（v1）

> 结论前提（已确认）：  
> - Job1 MaxDuration finalize 后 **pending 不存在**（pendingDurationMs=0）  
> - 因此 `mergePendingMaxDurationAudio` **不会被调用**，R0/R1 无法触发“pending 合并”分支  
> - finalize reason 为 undefined → 最终 fallback 为 `NORMAL`  
>
> 因此本轮修复 **仅修改测试文件**：将 R0/R1 用例构造改为“确定产生 pending 残段”的输入，避免依赖 7s/8.58s 等不稳定切分假设。

---

## 0. 修复目标（验收口径）

完成本 patch 后：

1) R0/R1 用例必须能稳定触发：**Job1 产生 pendingMaxDurationAudio**（>0ms）。  
2) R0 用例：pending + Job2 合并后仍 < `MIN_ACCUMULATED_DURATION_FOR_ASR_MS`，应进入 HOLD/继续 pending（或 `shouldReturnEmpty=true`，以你们实现为准）。  
3) R1 用例：pending + Job2 合并后 ≥ `MIN_ACCUMULATED_DURATION_FOR_ASR_MS`，应触发 merge 并进入正常发送；reason 应为合并原因（如 `NORMAL_MERGE`）。  
4) 所有断言必须增加“前置条件断言”，若 pending 未产生，测试应在前置条件处失败（避免误导定位）。

---

## 1. 逐文件最小 Patch 清单（仅测试文件）

### 文件 1：`electron_node/electron-node/main/src/pipeline-orchestrator/__tests__/audio-aggregator.test.ts`
> 若你的测试路径不同，以实际为准；关键词：`describe("R0")`, `describe("R1")`, `MAX_DURATION`, `MIN_ACCUMULATED_DURATION_FOR_ASR_MS`

#### Patch 1：替换 R0/R1 的音频时长构造（禁止依赖“7s/8.58s 产生残段”的隐式行为）
**当前问题**
- 使用 7s/8.58s 这类时长，残段是否落入 pending 依赖 batching 切分副作用，导致 pending=0。

**修改方式（推荐：使用“MAX + δ”的确定构造）**
定义辅助常量（放在 R0/R1 describe 内即可，避免影响其它用例）：

- `MAX_MS = MAX_DURATION_MS`（从被测模块读常量或复制当前配置）
- `MIN_MS = MIN_ACCUMULATED_DURATION_FOR_ASR_MS`（同上）
- `DELTA_PENDING_MS = 2200`（确保产生残段）
- `JOB1_MS = MAX_MS + DELTA_PENDING_MS`（必有 pending ≈ 2200ms）

然后：

- **R0：** `JOB2_MS = MIN_MS - DELTA_PENDING_MS - 200`  
  （确保合并后仍 < MIN；例如 MIN=5000, DELTA=2200, JOB2=2600 → 合并=4800）
- **R1：** `JOB2_MS = MIN_MS - DELTA_PENDING_MS + 500`  
  （确保合并后 ≥ MIN；例如 MIN=5000, DELTA=2200, JOB2=3300 → 合并=5500）

> 说明：不要写死 2000/3500，改为根据 MIN/DELTA 计算，避免以后 MIN 调整导致测试再次失效。

---

#### Patch 2：在 Job1 finalize 后增加“前置条件断言”（强制确认 pending 存在）
在 R0/R1 用例中，Job1 执行 MaxDuration finalize 后立即加入：

- `expect(buffer.pendingMaxDurationAudio).toBeDefined()`
- `expect(pendingDurationMs).toBeGreaterThan(0)`

若你无法直接取到 pendingDurationMs：
- 取 `pendingBufferBytes` 或 `pendingSampleCount` 并断言 >0
- 或调用你们现有的 `calculateDurationMs(pendingBuffer)` 工具方法（若测试内可用）

> 目的：当未来切分逻辑变化导致 pending 不产生时，测试会立刻失败并指向前提不成立，而不是在后续 reason/shouldReturnEmpty 上产生“伪失败”。

---

#### Patch 3：调整 R0 断言（合并后仍不足 MIN 的预期）
根据你们当前实现，R0 的断言应当对齐到“继续等待”的行为，而不是对“shouldReturnEmpty”做硬编码（除非你们就是用该字段表达 HOLD）。

推荐断言优先级如下（择其一，按你们实现字段存在与否选择）：

**选项 A（推荐）：断言动作/状态字段**
- `expect(result.action).toBe("HOLD")`
- 或 `expect(result.shouldHoldPendingMaxDur).toBe(true)`

**选项 B（次选）：若你们确实用 shouldReturnEmpty 表达 HOLD**
- `expect(result.shouldReturnEmpty).toBe(true)`
- 同时断言 `result.reason == "PENDING_MAXDUR_HOLD"`（如有）

> 注意：R0 的关键是“未达 MIN 不送 ASR”，不是“返回空”。若你们实现后来改为显式 HOLD，测试应当仍通过。

---

#### Patch 4：调整 R1 断言（必须先确认 merge 发生）
在 R1 中，先断言“merge 路径被触发”（不依赖日志）：

- `expect(buffer.pendingMaxDurationAudio).toBeDefined()`（Job1 后）
- Job2 finalize 后：`expect(buffer.pendingMaxDurationAudio).toBeUndefined()`（已被 flush/消耗，按实现）或 `expect(sentToAsr).toBe(true)`

然后再断言 reason：
- `expect(result.reason).toBe("NORMAL_MERGE")`（或你们实现中的合并 reason 常量）

---

#### Patch 5：去掉对 “pending 不存在时仍期望 NORMAL_MERGE” 的断言分支
由于已确认 pending 不存在时 merge 不发生，因此任何“merge 相关 reason”断言都必须建立在 pending 前置条件通过之后。

---

### 文件 2（可选）：`electron_node/electron-node/main/src/pipeline-orchestrator/__tests__/test-audio-factory.ts`
> 如果你的测试用例通过工厂方法构造音频（如 `makeAudio(durationMs)`），建议做一个最小增强，便于用样本数精确控制时长。

#### Patch（可选）：支持按 sampleCount 构造
- 新增 `makePcm16AudioBySamples(sampleCount, sampleRate)`  
- 测试用例使用 samples 计算 duration，避免 ms → bytes 的四舍五入误差

> 可选原因：只有当你们当前 makeAudio(durationMs) 在边界处存在 rounding 误差导致偶发 pending=0 时才需要做。

---

## 2. 回归 Checklist（仅测试层面）

### R0/R1 核心回归（必须）
- [ ] R0：Job1 后 pending 必须存在（前置断言通过）  
- [ ] R0：pending + Job2 合并后 < MIN → 不送 ASR / 继续 pending（HOLD 或 shouldHoldPendingMaxDur=true）  
- [ ] R1：Job1 后 pending 必须存在（前置断言通过）  
- [ ] R1：pending + Job2 合并后 ≥ MIN → 触发 merge 并送 ASR；reason= NORMAL_MERGE（或等价）

### 原有回归（不得回退）
- [ ] R2：TTL force flush 用例仍通过  
- [ ] R3：ASR failure 不应触发 empty 核销  
- [ ] R4：真空音频才允许 empty  
- [ ] R5：originalJobIds 头部对齐可解释性测试仍通过（如存在）

---

## 3. 交付说明（给 Code Review）

- 本 patch **仅改测试文件**，不修改任何业务逻辑与阈值。  
- 通过“MAX + δ”的构造方式，消除用例对 batching 切分副作用的依赖。  
- 通过前置断言，确保未来若 pending 机制变化，失败点可直接定位到“前提不成立”。

