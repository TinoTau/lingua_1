# AudioAggregator 改造分步执行说明

本次改造（移除 MaxDuration 仅追加不输出、恢复 10s 输出）拆成多步，每步单独执行、验证后再进行下一步，避免一次性改动导致 OOM 或难以定位问题。

**约定**：bufferKey 保持为 turnId（`buildBufferKey(job)` = turn_id|tgt_lang），不改为 sessionId。

---

## 当前状态（改造已完成）

- **已完成**：类型中已移除 `PENDING_MAXDUR`、`pendingMaxDuration*`；`finalize-merge` 仅保留 `mergePendingTimeoutAudio`、`mergePendingSmallSegments`；`audio-aggregator.ts` 主流程无 MaxDuration 仅追加路径，10s 或 manual/timeout 即输出；`audio-aggregator-maxduration-handler.ts` 已删除；测试已改为使用 `pendingTimeoutAudio` 或重命名 describe/it。
- **bufferKey**：保持 `buildBufferKey(job)` = turn_id|tgt_lang，未改为 sessionId。

---

## 步骤 1：恢复类型定义（保证可编译）

**目标**：把类型恢复到“仍有 MaxDuration 路径”的完整状态，保证全量编译、运行无类型错误。

**操作**：在 `audio-aggregator-types.ts` 中恢复：

- `BufferState` 增加 `'PENDING_MAXDUR'`
- `AudioBuffer` 增加 `pendingMaxDurationAudio?`、`pendingMaxDurationAudioCreatedAt?`、`pendingMaxDurationJobInfo?`
- `AudioChunkResult.reason` 增加 `'TURN_NOT_FLUSHED' | 'FORCE_FLUSH_PENDING_MAXDUR_TTL' | 'ASR_FAILURE_PARTIAL'`

**验证**：`npm run build` 或 `npx tsc --noEmit` 通过，无类型报错。

---

## 步骤 2：移除 finalize-merge 中的 mergePendingMaxDurationAudio

**目标**：删除 `mergePendingMaxDurationAudio` 实现，不再在合并逻辑里处理 MaxDuration pending。

**操作**：

- 在 `audio-aggregator-finalize-merge.ts` 中删除整个 `mergePendingMaxDurationAudio` 函数（从 `export function mergePendingMaxDurationAudio` 到该函数结束的 `};`）。
- 不修改其他文件。

**验证**：编译通过。此时 `finalize-handler` 仍会 **import 并调用** 该函数，需在步骤 3 中一并移除调用。

---

## 步骤 3：finalize-handler 不再调用 mergePendingMaxDurationAudio

**目标**：Finalize 时不再合并 pendingMaxDurationAudio。

**操作**：

- 在 `audio-aggregator-finalize-handler.ts` 中：
  - 删除对 `mergePendingMaxDurationAudio` 的 import 与调用。
  - 删除所有与 `buffer.pendingMaxDurationAudio` 相关的分支（如 `if (buffer.pendingMaxDurationAudio) { ... }`）。
  - `FinalizeResult.reason` 中去掉 `FORCE_FLUSH_PENDING_MAXDUR_TTL`、`PENDING_MAXDUR_HOLD` 等与 MaxDuration 相关的 reason。

**验证**：编译通过；手动或单测跑一条 finalize 流程，确认无运行时错误。

---

## 步骤 4：buffer-lifecycle 去掉 pendingMaxDuration

**目标**：创建/删除/过期逻辑不再依赖 pendingMaxDuration。

**操作**：

- 在 `audio-aggregator-buffer-lifecycle.ts` 中：
  - `shouldReturnEmptyInput` 中去掉对 `buffer.pendingMaxDurationAudio` 的判断。
  - `deleteBufferFromMap` 日志中去掉 `pendingMaxDurationAudioLength`、`hasPendingMaxDuration`。
  - `cleanupExpiredBuffersFromMap` 中去掉对 `pendingMaxDurationAudio` / `pendingMaxDurationAudioCreatedAt` 的 TTL 与日志。

**验证**：编译通过；可选：跑与 buffer 生命周期相关的单测。

---

## 步骤 5：audio-aggregator 主流程移除 MaxDuration 仅追加路径

**目标**：MaxDuration 不再“只追加不输出”；达到 10s 或 manual/timeout 即输出（与备份逻辑一致）。

**操作**：

- 在 `audio-aggregator.ts` 中：
  - 删除 `isMaxDurationTriggered` 分支中“只追加、return shouldReturnEmpty”的整段逻辑（不再设置 `state = 'PENDING_MAXDUR'`、不操作 `pendingMaxDurationAudio`）。
  - MaxDuration 的 job 与普通 chunk 同等对待：只往当前 buffer 追加；是否输出由 `shouldProcessNow`（10s / manual / timeout）决定。
  - `shouldProcessNow` 中恢复“达到 MIN_AUTO_PROCESS_DURATION_MS（10s）即处理”，且**不要**因 `isMaxDurationTriggered` 而排除。
  - 删除所有对 `pendingMaxDurationAudio`、`pendingMaxDurationJobInfo`、`state === 'PENDING_MAXDUR'` 的读写与分支。
  - 清理/删除 buffer 时只判断 `pendingTimeoutAudio`（及现有 pendingSmallSegments），不再判断 `pendingMaxDurationAudio`。

**验证**：编译通过；跑 audio-aggregator 相关单测；必要时跑一次端到端或集成，确认无 OOM、无重复处理。

---

## 步骤 6：类型与其余引用收尾

**目标**：类型与所有调用处一致，删除无用代码。

**操作**：

- 在 `audio-aggregator-types.ts` 中再次移除：
  - `BufferState` 中的 `'PENDING_MAXDUR'`
  - `AudioBuffer` 中的 `pendingMaxDurationAudio?`、`pendingMaxDurationAudioCreatedAt?`、`pendingMaxDurationJobInfo?`
  - `AudioChunkResult.reason` 中与 MaxDuration 相关的取值。
- ~~在 `original-job-result-dispatcher.ts` 中去掉 `hasPendingMaxDurationAudio` 及相关逻辑~~（**该文件已移除**：OriginalJobResultDispatcher 已作为死代码删除，无需修改。）
- 删除或停用 `audio-aggregator-maxduration-handler.ts`（若已无引用可删文件）。
- `job-pipeline.ts` 中保持 `clearBufferByKey(buildBufferKey(job))`，不改为 sessionId。
- 更新或删除依赖 MaxDuration / pendingMaxDuration 的测试（如 `audio-aggregator.test.ts` 中的相关用例；`original-job-result-dispatcher.test.ts` 已随组件移除而删除）。

**验证**：全量编译与测试通过；跑一次完整流程确认无 OOM、无重复 job。

---

## 执行顺序小结

1. **步骤 1**：恢复类型（本说明写完后先执行此步，保证可编译）。
2. **步骤 2**：删除 `mergePendingMaxDurationAudio` 函数。
3. **步骤 3**：finalize-handler 去掉对 MaxDuration pending 的调用与分支。
4. **步骤 4**：buffer-lifecycle 去掉 pendingMaxDuration。
5. **步骤 5**：audio-aggregator 主流程移除 MaxDuration 仅追加路径并恢复 10s 输出。
6. **步骤 6**：类型与 dispatcher、maxduration-handler、测试等收尾。

每步执行后建议：保存、编译、必要时跑单测或小范围场景，确认无 OOM 再进入下一步。

---

## OOM 原因与修复（改造完成后仍 OOM）

**原因**：buffers Map 按 `bufferKey = turn_id|tgt_lang` 累积，但从未在「turn 结束」时清理，导致 Map 只增不减 → 内存持续增长 → OOM。

**修复（仅按 turn 清理，单一路径）**：

1. **turn 内 segment 失败**：`job-pipeline` 在 ASR/TRANSLATION/SEMANTIC_REPAIR 失败时调用 `clearBufferByKey(buildBufferKey(job))`，清理该 turn 的 buffer。
2. **turn 的最后一个 job 结果返回后**：`job-pipeline` 在正常返回 `buildJobResult` 前，若本 job 为 manual/timeout finalize（即 turn 结束），调用 `clearBufferByKey(buildBufferKey(job))`，清理该 turn 的 buffer。
3. **用户断线（孤儿 turn）兜底**：`InferenceService` 构造函数中每 1 分钟调用一次 `audioAggregator.cleanupExpiredBuffers()`。`cleanupExpiredBuffers` 内部按空闲 > 5 分钟清理 buffer 并打日志，仅此一处定时清理，用于从未收到 manual/timeout finalize 的孤儿 turn。

控制流仅上述三处，便于排查。
