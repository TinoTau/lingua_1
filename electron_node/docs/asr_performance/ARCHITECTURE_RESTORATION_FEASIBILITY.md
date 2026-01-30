# 架构恢复可行性：原始设计 vs 当前实现

**日期**：2026-01-28  
**问题**：原始设计的架构是否还在？逻辑是否完整？改回去的改动量？

---

## 一、原始设计架构完整性检查

### 1.1 核心架构组件（✅ 都在）

| 组件 | 文件 | 状态 | 说明 |
|------|------|------|------|
| **唯一编排器** | `pipeline/job-pipeline.ts` | ✅ 完整 | `runJobPipeline` 按步骤序列执行，最后返回 `buildJobResult(job, ctx)` |
| **统一结果构建** | `pipeline/result-builder.ts` | ✅ 完整 | `buildJobResult` 从 `ctx` 构建 `JobResult`，逻辑完整 |
| **统一发送点** | `agent/node-agent-simple.ts` | ✅ 基本完整 | `processJob` 返回后统一发送（除了 asr-step 的发送） |
| **步骤串联** | `pipeline/steps/*.ts` | ✅ 完整 | 各步骤（ASR/AGGREGATION/SEMANTIC_REPAIR/DEDUP/TRANSLATION/TTS）都写入 `ctx`，交给下一步 |

### 1.2 数据流（✅ 逻辑完整）

**无 originalJobIds 时（正常路径）**：
```
runAsrStep
  → ASR 结果写入 ctx.asrText（第 470 行或 478 行）
  → AGGREGATION 读取 ctx.asrText，写入 ctx.aggregatedText
  → SEMANTIC_REPAIR 读取 ctx.aggregatedText，写入 ctx.repairedText
  → DEDUP 读取 ctx.repairedText
  → TRANSLATION 读取 ctx.repairedText，写入 ctx.translatedText
  → TTS 读取 ctx.translatedText，写入 ctx.ttsAudio
  → buildJobResult(job, ctx) → 返回 JobResult
  → node-agent-simple 统一发送
```
**逻辑完整**：各服务串联，结果写入 ctx，最后统一返回。

**有 originalJobIds 时（违反设计的路径）**：
```
runAsrStep
  → 对每个 original job：
    → dispatcher callback 触发
    → runJobPipeline(originalJob, originalCtx) → 返回 result
    → ❌ 立即发送：services.resultSender.sendJobResult(originalJobMsg, result, ...)
  → container 的 ctx.asrText 未被填充（为空）
  → container 的 pipeline 继续（但 ctx 为空）
  → buildJobResult(job, ctx) → finalResult.text_asr 为空
  → node-agent-simple 发送空结果（ASR_EMPTY）
```
**逻辑不完整**：original job 的结果未回填到 container 的 ctx。

---

## 二、架构恢复可行性

### 2.1 架构基础（✅ 完整）

- ✅ **唯一编排器**：`runJobPipeline` 逻辑完整，支持 `providedCtx`（跳过 ASR）
- ✅ **结果构建**：`buildJobResult` 从 `ctx` 读取所有字段，逻辑完整
- ✅ **步骤串联**：各步骤都写入 `ctx`，逻辑完整
- ✅ **统一发送点**：`node-agent-simple` 统一发送，逻辑完整

**结论**：原始设计的架构**都在且逻辑完整**，只是有 `originalJobIds` 时的路径违反了设计。

### 2.2 需要恢复的部分

| 部分 | 当前状态 | 需要恢复 |
|------|----------|----------|
| **original job 结果回填** | ❌ 未实现：直接发送，不回填 | ✅ 需要：将 result 回填到 container 的 ctx |
| **container ctx 填充** | ❌ 未填充：当有 originalJobIds 时，ctx.asrText 为空 | ✅ 需要：从 original job 的 result 回填 |
| **空容器处理** | ❌ 在 asr-step 内发送 | ✅ 需要：回填空结果到 container，或统一在 node-agent 发送 |

---

## 三、改动量评估

### 3.1 核心改动（中等）

**文件**：`pipeline/steps/asr-step.ts`

**当前代码**（第 196-234 行）：
```ts
const result = await runJobPipeline({
  job: originalJobMsg,
  services,
  ctx: originalCtx,
});

// ❌ 当前：立即发送
if (services.resultSender) {
  services.resultSender.sendJobResult(originalJobMsg, result, ...);
}
```

**需要改为**：
```ts
const result = await runJobPipeline({
  job: originalJobMsg,
  services,
  ctx: originalCtx,
});

// ✅ 恢复：回填到 container 的 ctx
// 方案 A：single original job（container === original job）
if (originalJobIds.length === 1 && originalJobIds[0] === job.job_id) {
  // container 就是 original job，直接回填 result 到 container 的 ctx
  ctx.asrText = result.text_asr;
  ctx.asrSegments = result.segments;
  ctx.aggregatedText = result.text_asr_repaired || result.text_asr;
  ctx.repairedText = result.text_asr_repaired;
  ctx.translatedText = result.text_translated;
  ctx.ttsAudio = result.tts_audio;
  // ... 其他字段
} else {
  // 方案 B：multiple original jobs（需要合并或选择）
  // 设计决策：如何合并多个 original job 的结果？
  // - 选项 1：合并所有 original job 的 text_asr
  // - 选项 2：只使用第一个或最后一个 original job 的结果
  // - 选项 3：container 的 pipeline 只处理第一个 original job，其他单独处理
}
```

**改动复杂度**：
- **简单情况**（single original job，container === original job）：**小改动**（约 10-20 行）
- **复杂情况**（multiple original jobs）：**中等改动**（需要设计合并策略，约 30-50 行）

### 3.2 清理改动（小）

| 文件 | 改动 | 行数 |
|------|------|------|
| `pipeline/steps/asr-step.ts` | 移除 `services.resultSender.sendJobResult` 调用（第 204-212 行） | ~10 行 |
| `pipeline/steps/asr-step.ts` | 移除空容器检测中的 `sendJobResult`（第 301 行） | ~10 行 |
| `pipeline/result-builder.ts` | 移除 `originalJobResultsAlreadySent` 字段（第 31 行） | 1 行 |
| `agent/node-agent-simple.ts` | 移除 `originalJobResultsAlreadySent` 判断（第 354-357 行） | ~5 行 |

**总计**：约 25-30 行清理代码。

### 3.3 待解决的设计问题

1. **multiple original jobs 的处理**：
   - 场景：一个 container job 对应多个 original jobs（音频被分片到多个 job）
   - 问题：如何将多个 original job 的结果回填到 container 的 ctx？
   - 选项：
     - **选项 A**：合并所有 original job 的 `text_asr`（按 utterance_index 或 batchIndex 排序）
     - **选项 B**：container 的 pipeline 只处理第一个 original job，其他 original job 的结果如何处理？
     - **选项 C**：container 的 pipeline 处理所有 original job 的合并结果

2. **pendingMaxDurationAudio 的处理**：
   - 场景：original job 有 pendingMaxDurationAudio，dispatcher 的 callback 可能延迟触发
   - 问题：如何确保在 container 的 pipeline 完成前，pending 的结果能回填到 container 的 ctx？
   - 选项：
     - **选项 A**：container 的 pipeline 等待所有 original job 的 callback 完成（同步等待）
     - **选项 B**：container 的 pipeline 不等待，但 dispatcher 的 callback 异步回填（需要同步机制）
     - **选项 C**：container 的 pipeline 先处理已收到的 original job 结果，pending 的结果后续通过其他机制处理

3. **空容器的处理**：
   - 场景：检测到 emptyJobIds（未分配任何 segment 的 job）
   - 问题：空容器的结果如何回填到 container？
   - 选项：
     - **选项 A**：空容器不回填，统一在 node-agent 发送时处理（检查 finalResult 是否为空）
     - **选项 B**：空容器回填空结果到 container 的 ctx，container 的 pipeline 继续处理

---

## 四、改动量总结

### 4.1 改动规模

| 类型 | 文件数 | 代码行数 | 复杂度 |
|------|--------|----------|--------|
| **核心改动**（回填逻辑） | 1 | 20-50 行 | 中等（需设计合并策略） |
| **清理改动**（移除发送） | 3 | 25-30 行 | 小（直接删除） |
| **设计决策** | - | - | 高（需明确 multiple/pending/空容器策略） |

**总改动量**：**中等**（约 50-80 行代码，但需要先做设计决策）

### 4.2 风险评估

| 风险 | 等级 | 说明 |
|------|------|------|
| **multiple original jobs 合并逻辑** | 中 | 需要明确合并策略，可能影响结果正确性 |
| **pendingMaxDurationAudio 同步** | 中高 | 需要确保回填时机正确，避免 reintroduce Job1 丢失问题 |
| **空容器处理** | 低 | 逻辑相对简单 |
| **回归测试** | 中 | 需要覆盖 single/multiple/pending/空容器等场景 |

---

## 五、建议

### 5.1 可行性结论

- ✅ **架构基础完整**：原始设计的架构都在，逻辑完整
- ✅ **改动量可控**：核心改动约 50-80 行，清理改动约 25-30 行
- ⚠️ **需要先做设计决策**：multiple original jobs、pendingMaxDurationAudio、空容器的处理策略

### 5.2 实施建议

1. **先做设计决策**：
   - multiple original jobs：选择合并策略（选项 A/B/C）
   - pendingMaxDurationAudio：选择同步机制（选项 A/B/C）
   - 空容器：选择处理方式（选项 A/B）

2. **分阶段实施**：
   - **阶段 1**：single original job（container === original job）的回填逻辑（简单，约 20 行）
   - **阶段 2**：multiple original jobs 的合并逻辑（需设计决策，约 30-50 行）
   - **阶段 3**：pendingMaxDurationAudio 的同步机制（需设计决策，约 20-30 行）
   - **阶段 4**：清理代码（移除发送、移除标记，约 25-30 行）

3. **测试覆盖**：
   - single original job 场景
   - multiple original jobs 场景
   - pendingMaxDurationAudio 场景
   - 空容器场景
   - 无 originalJobIds 场景（向后兼容）

---

## 六、结论

- **原始设计的架构都在且逻辑完整** ✅
- **改回去的改动量：中等**（约 50-80 行核心代码 + 25-30 行清理代码）
- **需要先做设计决策**：multiple original jobs、pendingMaxDurationAudio、空容器的处理策略
- **建议分阶段实施**：先做 simple case（single original job），再做复杂场景

---

*以上为架构恢复可行性分析，供决策参考。*
