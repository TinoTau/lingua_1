# AudioAggregator 业务逻辑排查：逐文件最小 Patch 清单（仅测试文件 / 测试注入点）（v1）

> 目标：在**不修改业务代码**的前提下，通过“测试注入 + 可见的状态快照”把 AudioAggregator 的问题定位到单一环节：  
> **切分 / 时长口径 / pending 生命周期 / 空核销 / 归属(ownerJobId) / 发送**。
>
> 约束：本清单只允许改动：
> - `__tests__` 下测试文件
> - 测试辅助工厂（test-audio-factory）
> - Jest mock（logger 等）  
> 不允许修改生产源文件（除非你们已有“测试编译开关”，本清单不依赖该开关）。

---

## 0. 交付验收标准（完成后你能得到什么）

完成本 patch 后，每次 R0–R5（及新增用例）运行都应满足：

1) **不依赖 logger** 也能从返回值/spy 拿到关键快照（pendingExists、duration、reason、ownerJobId）。  
2) 能明确回答四个问题：
   - pending 是否被意外清空/覆盖
   - mergedDurationMs 是否等于 pending + incoming（容差内）
   - empty 核销是否只发生在“确实无音频”
   - 多 job 归属是否可解释且不吞 job

---

## 1. 逐文件 Patch 清单

### 文件 1：`main/src/pipeline-orchestrator/__tests__/audio-aggregator.test.ts`

#### Patch 1.1：引入统一的 Debug Snapshot 采集器（测试侧）
**目的**：不改业务代码，通过 spy 捕获 AudioAggregator 对外输出（或内部关键函数调用参数），形成“状态机快照”。

**做法（任选其一，优先 A）**

**A. Spy 发送到 ASR 的调用（推荐）**
- 定位关键词：`sendToAsr`, `asrClient`, `dispatchAsr`, `requestAsr`
- 使用 `jest.spyOn(asrClient, "transcribe")`（或你们实际方法名）
- 记录每次调用的入参字段：
  - `ownerJobId` / `jobId`
  - `originalJobIds`
  - `audioDurationMs`（若没有则由 bytes 计算）
  - `reason`（若有）
- 同时记录每次 finalize 的返回对象（result）

**B. Mock/Spy finalize handler 输出**
- 定位关键词：`handleFinalize`, `finalize`, `FinalizeResult`
- `jest.spyOn(finalizeModule, "handleFinalize")` 捕获其返回值
- 记录：
  - `shouldReturnEmpty`
  - `reason`
  - `segmentsCount`
  - `pending flags`（若返回里有）

> 选择 A 的原因：ASR 调用是“不可掩盖”的外部效应，最适合用于断言“是否不该送却送了”。

---

#### Patch 1.2：加入测试内 helper（统一 duration 口径 + 容差）
在测试文件顶部添加（仅测试侧）：

- `bytesToMsPcm16LE(bytes: number, sampleRate=16000): number`
- `const DURATION_TOLERANCE_MS = 80`（或你们确认的最小容差）
- 断言 helper：
  - `expectApprox(actual, expected, tol=DURATION_TOLERANCE_MS)`

**目的**：后续所有 duration 断言都统一口径，避免“测试算时长”和“业务算时长”互相打架。

---

#### Patch 1.3：取消跳过，恢复 R0–R5 全套执行（CI 口径）
- 将 `describe.skip` / `it.skip` 全部移除（或改为默认执行）
- 若有耗时用例（TTL），允许使用 `jest.setTimeout(...)`，但不允许 skip

---

#### Patch 1.4：新增用例：pending 生命周期跨 job 保持（定位 pending 被清空/覆盖）
新增测试用例（建议命名）：
- `pending_should_persist_across_jobs_when_merge_still_below_min()`

**构造**
1) Job1：确保产生 pending（你们已修 R0/R1 的确定构造可以复用）
2) Job2：确保合并后仍 < MIN（应继续 HOLD/pending）

**断言（不依赖日志）**
- Job1 后：`pendingExists == true`（通过“是否发生 ASR 调用 + 返回 action”间接判断；或通过已有测试工厂暴露的 pending 观察）
- Job2 后：
  - 不应发生 ASR 调用
  - 不应出现 empty 核销
  - 若可观测 pending：pending 仍存在且 duration 增加或至少不为 0

> 备注：如果当前测试层无法直接读取 pending 状态，可用“ASR 未被调用 + result.action=HOLD”作为替代观测。

---

#### Patch 1.5：新增用例：mergedDurationMs 关系校验（定位 duration 口径不一致）
新增测试用例：
- `merged_duration_should_equal_pending_plus_incoming_within_tolerance()`

**做法**
- 使用 spy 捕获：
  - pending 音频字节数（从你们的 test factory 或已构造变量）
  - incoming 音频字节数
  - ASR 调用中的实际音频 bytes（或其长度）
- 断言：
  - `mergedMs ≈ pendingMs + incomingMs`（容差内）

**判定**
- 若不成立：业务侧 duration 口径存在不一致（会导致 MIN/TTL 分支走错）

---

#### Patch 1.6：新增用例：空核销必须严格（定位“吞 job”）
新增测试用例：
- `empty_finalize_should_only_happen_when_input_duration_is_zero_and_no_pending()`

**构造**
- Case A：inputDurationMs == 0，segments==0 → 允许 empty
- Case B：inputDurationMs > 0 但 ASR 失败/返回空 → 不允许 empty（应 PARTIAL/MISSING）

**断言**
- empty 只能发生在 Case A
- Case B 必须能观察到“未 empty 且 job 未消失”的输出（至少有 reason）

---

#### Patch 1.7：新增用例：多 job 归属可解释且不吞 job（定位 ownerJobId/归属策略问题）
新增测试用例：
- `multi_job_batch_should_be_explainable_and_must_not_empty_close_non_owner_jobs()`

**构造**
- 构造 originalJobIds = [A, B, C]（或最少 A,B）
- 只够产生一次 ASR 输出（按你们现行策略应归属 A）

**断言**
- 输出中 `ownerJobId == A`
- B/C 不应被“empty 核销”提前关闭（除非其确实无音频）
- 若 B/C 没有独立输出，必须能从 spy 捕获的字段解释（归属策略所致）

---

### 文件 2：`main/src/pipeline-orchestrator/__tests__/test-audio-factory.ts`（或你们实际的测试音频工厂）

#### Patch 2.1：去随机化（移除 Math.random 噪声）
你们当前静音段如果使用 `Math.random()`，改为确定性实现（二选一）：

**A. 固定交替序列（推荐）**
- 静音段全部写 0，或写 0/1 交替（低幅值）

**B. 固定种子 PRNG**
- 实现简单 LCG：`seed = (seed * 1664525 + 1013904223) >>> 0`
- 用 seed 生成 [-1,1] 的确定性噪声

> 目的：避免能量切分对随机噪声敏感，导致 pending 偶发不稳定。

---

#### Patch 2.2：新增按 samples 精确生成的 API（降低 rounding 误差）
新增：
- `makePcm16BySamples(sampleCount: number, amplitude?: number): Buffer`
- `samplesToMs(sampleCount: number, sampleRate=16000): number`

并让现有 `makePcm16ByMs(ms)` 内部改为通过 samples 生成（仍属于测试辅助，不影响生产）。

---

#### Patch 2.3：新增“可控切分模式”生成器（减少对 splitAudioByEnergy 的耦合）
新增一个生成器，直接构造“明显的长停顿”模式，确保切分算法稳定触发：

- `makePausePatternAudio({ speakMs, pauseMs, repeats })`

并在生成器末尾返回：
- `totalMs`
- `expectedSegmentsMin`（至少 2）
用于测试前置断言。

---

### 文件 3：`main/src/pipeline-orchestrator/__tests__/__mocks__/logger.ts`（若存在）

#### Patch 3.1：确保排查期日志可见（但不依赖日志）
- 将 mock 的 `debug/info/warn/error` 映射到 `console.*`
- 或提供 `logger._buffer` 收集日志供断言（推荐）

> 注意：即便做了该 patch，核心断言仍建议使用 spy/返回值快照，而不是依赖日志文本。

---

## 2. 测试注入点清单（用于快速 grep 定位）

在测试侧优先注入/spy 的函数（按价值排序）：

1) **ASR 调用入口**：`asrClient.transcribe` / `requestAsr` / `sendToAsr`
2) **finalize 入口/出口**：`handleFinalize` / `finalizeMaxDuration`
3) **batching 切分**（仅用于二分法实验）：`splitAudioByEnergy` / `findLongestPauseAndSplit`

---

## 3. 回归 Checklist（以“定位业务问题”为目标）

### 必跑（定位闭环）
- [ ] R0：合并后 < MIN 必须 HOLD（不送 ASR）
- [ ] R1：合并后 ≥ MIN 必须送 ASR，reason 为 merge 类
- [ ] 新增：pending 跨 job 保持（未达 MIN 不应清空）
- [ ] 新增：mergedDuration ≈ pending+incoming（容差内）
- [ ] 新增：empty 核销严格（仅真空输入）
- [ ] 新增：多 job 归属可解释且不吞 job

### 不得回退（稳定性护栏）
- [ ] R2：TTL force flush 仍通过（pending 不应无限等待）
- [ ] R3：ASR failure 不触发 empty 核销
- [ ] R4：真空音频允许 empty
- [ ] R5：originalJobIds 头部对齐可解释性仍成立

---

## 4. 输出要求（开发提交 PR 时必须附上）

- [ ] 运行命令与结果摘要（R0–R5 + 新增用例）
- [ ] 失败时必须贴出 Debug Snapshot（字段见 Patch 1.1），禁止只贴日志文本
- [ ] 对每个失败用例给出定位结论：属于 pending 生命周期 / duration 口径 / empty 核销 / 归属策略 / 切分耦合 的哪一类（只能选一个主因）

