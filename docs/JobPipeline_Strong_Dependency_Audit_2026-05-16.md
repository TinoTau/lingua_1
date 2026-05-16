# JobPipeline Strong Dependency Audit

**审计日期**：2026-05-16  
**审计类型**：只读（未修改代码）  
**代码基线**：`electron_node/electron-node/main/src`（语义修复主链解耦实施后）

---

## 审计目标

确认当前 `JobPipeline` 中：

- 哪些服务是真正可热插拔的
- 哪些服务仍被主链强绑定
- 哪些服务缺失会导致整个链路停止
- 哪些服务只是 optional enhancement

**核心问题**：「没有哪个服务，整条链路就无法跑通？」

**交付物**：

1. 当前真实最小主链
2. 强绑定服务清单
3. fake optional 服务
4. hidden blocker
5. fail-open vs fail-closed 行为
6. 热插拔缺失点
7. 最小可运行节点配置

---

## 1. 总体结论

**结论：部分通过**

解耦后，**5015 / 5016 / 5017 已不再能单独拖死整条 Job**（步骤内 fail-open / skip，且 `TRANSLATION` 与 `shouldSendToSemanticRepair` 解耦）。但主链**并非全面 fail-open**，仍存在硬绑定与隐性阻断。

### 直接回答

> **「没有哪个服务，整条链路就无法跑通？」**

**不能简单说「是」**。取决于 `job.pipeline` 模式与「跑通」的定义：

| 目标 | 真正必需（运行时） | 可不装 / 可失败仍「完成 Job」 |
|------|-------------------|------------------------------|
| 纯文本翻译 `use_asr=false, use_nmt=true` | **NMT**（registry 有 `running` 端点）+ `TaskRouter` | ASR、TTS、5015/5016/5017 |
| 字幕 `use_asr+nmt, !tts` | **ASR + NMT** + `AudioAggregator`（注入 bundle） | TTS、5015/5016/5017 |
| 语音翻译 `use_asr+nmt+tts` | **ASR + NMT**（要译文）；**TTS**（要音频；失败只空音频，不 abort） | 5015/5016/5017 |
| 仅 ASR `use_asr, !nmt, !tts` | **ASR** | NMT、TTS、增强服务 |

**仍会导致整条 Job 失败（throw → `processJob` 失败）的主要项**：

1. **ASR**（启用时）：路由无端点、HTTP 失败、`src_lang=auto` 契约不满足、**GPU lease SKIPPED/TIMEOUT**
2. **基础设施**：`services.audioAggregator` 缺失（ASR 直接 throw）
3. **外层**：`InferenceService.processJob` catch 后向上 throw

**已可热插拔（缺失 → skip/degraded，pipeline 仍返回 `JobResult`）**：

- 5015 semantic repair
- 5016 phonetic correction
- 5017 punctuation restore（feature 默认关闭）
- TTS / YourTTS
- NMT 失败（`translation-step` catch → 空译文，不 throw）

**当前主链是否真正 fail-open？**  
**部分**：增强链 fail-open；**ASR 仍 fail-closed**；NMT/TTS 对「Job 成功返回」fail-open，对「有译文/有音频」仍强依赖。

---

## 2. 审计范围与文件清单

### 2.1 真实主链入口

```text
InferenceService.processJob
  → runJobPipeline (job-pipeline.ts)
    → inferPipelineMode / shouldExecuteStep
    → executeStep (pipeline-step-registry.ts)
    → buildJobResult (result-builder.ts)
```

后处理在 Pipeline 内以独立 step 实现（非旧 PostProcessCoordinator 单文件编排）：

```text
AGGREGATION → PHONETIC_CORRECTION → PUNCTUATION_RESTORE → SEMANTIC_REPAIR → DEDUP → TRANSLATION → TTS
```

门控集中：`post-asr-routing.ts`（`applyPostAggregationRouting`）。

### 2.2 已检查文件

| 文件 | 状态 |
|------|------|
| `pipeline/pipeline-mode-config.ts` | 存在 |
| `pipeline/pipeline-step-registry.ts` | 存在 |
| `pipeline/job-pipeline.ts` | 存在 |
| `pipeline/post-asr-routing.ts` | 存在 |
| `pipeline/steps/aggregation-step.ts` | 存在 |
| `pipeline/steps/asr-step.ts` | 存在 |
| `pipeline/steps/translation-step.ts` | 存在 |
| `pipeline/steps/tts-step.ts` | 存在 |
| `pipeline/steps/semantic-repair-step.ts` | 存在 |
| `pipeline/steps/phonetic-correction-step.ts` | 存在 |
| `pipeline/steps/punctuation-restore-step.ts` | 存在 |
| `pipeline/result-builder.ts` | 存在 |
| `pipeline/context/job-context.ts` | 存在 |
| `task-router/task-router-semantic-repair.ts` | 存在 |
| `task-router/task-router-nmt.ts` | 存在 |
| `task-router/task-router-tts.ts` | 存在 |
| `task-router/task-router-translation.ts` | **不存在**（NMT 在 `task-router-nmt.ts`） |
| `agent/postprocess/postprocess-semantic-repair-initializer.ts` | 存在 |
| `agent/postprocess/semantic-repair-stage.ts` | 存在 |
| `agent/postprocess/semantic-repair-stage-en.ts` | 存在 |
| `agent/postprocess/semantic-repair-stage-zh.ts` | 存在 |
| `inference/inference-service.ts` | 存在 |
| `webapp/shared/protocols/messages.ts` | 存在 |

---

## 3. 当前真实最小主链

### 3.1 模式推断（`inferPipelineMode`）

| 条件 | 模式 | 步骤序列 |
|------|------|----------|
| `use_asr + use_nmt + use_tts + use_tone` | PERSONAL_VOICE_TRANSLATION | … → TRANSLATION → YOURTTS |
| `use_asr + use_nmt + use_tts` | GENERAL_VOICE_TRANSLATION | … → TRANSLATION → TTS |
| `use_asr + use_nmt + !use_tts` | SUBTITLE_MODE | … → TRANSLATION |
| `use_asr + !use_nmt + !use_tts` | ASR_ONLY | ASR → AGG → … → DEDUP |
| `!use_asr + use_nmt + !use_tts` | TEXT_TRANSLATION | **仅 TRANSLATION** |
| 其它 | buildDynamicMode | 按 flag 拼装 |

### 3.2 流程图（通用语音）

```mermaid
flowchart LR
  ASR --> AGG
  AGG --> PH[PHONETIC?]
  PH --> PU[PUNCTUATION?]
  PU --> SEM[SEMANTIC?]
  SEM --> DEDUP
  DEDUP --> NMT[TRANSLATION?]
  NMT --> TTS[TTS?]
```

`?` = `shouldExecuteStep` 动态门控。

### 3.3 三条最小链

**Minimal text（调度配置）**

```text
TRANSLATION
```

**Minimal voice（要译文，不要音频）**

```text
ASR → AGGREGATION → [PHONETIC|PUNCTUATION|SEMANTIC 均可关] → DEDUP → TRANSLATION
```

**Full chain（通用语音）**

```text
ASR → AGG → PHONETIC → PUNCTUATION → SEMANTIC → DEDUP → TRANSLATION → TTS
```

**代码层面最小可运行**：

- 文本：**NMT-only**（`TEXT_TRANSLATION`）
- 语音文本输出：**ASR → NMT**
- 语音音频输出：**ASR → NMT → TTS**（TTS 失败仍返回 Job，音频为空）

---

## 4. 编排机制（实际 gating / throw）

### 4.1 `shouldExecuteStep`（`pipeline-mode-config.ts`）

| Step | 执行条件 |
|------|----------|
| ASR / AGGREGATION / DEDUP | `use_asr !== false` |
| PHONETIC_CORRECTION | `ctx.shouldRunPhoneticCorrection && isPhoneticCorrectionEnabled(job)` |
| PUNCTUATION_RESTORE | `ctx.shouldRunPunctuationRestore && isPunctuationRestoreEnabled()` |
| SEMANTIC_REPAIR | `ctx.shouldRunSemanticRepairHttp && isSemanticRepairEnabled(job)` |
| TRANSLATION | `use_nmt !== false && ctx.shouldAllowTranslation === true` |
| TTS | `use_tts !== false && use_tone !== true` |
| YOURTTS | `use_tone === true` |

聚合后写入（`post-asr-routing.ts`）：

- `shouldDeferTranslation` / `shouldAllowTranslation`
- `shouldRunPhoneticCorrection` / `shouldRunPunctuationRestore` / `shouldRunSemanticRepairHttp`
- legacy：`shouldSendToSemanticRepair = shouldRunSemanticRepairHttp`

### 4.2 `job-pipeline.ts` 步骤失败策略

```typescript
// job-pipeline.ts L134-146（摘要）
if (step === 'ASR' || step === 'PHONETIC_CORRECTION' || step === 'PUNCTUATION_RESTORE'
    || step === 'TRANSLATION' || step === 'SEMANTIC_REPAIR') {
  throw error;  // 关键步骤 → 整 Job 失败
} else {
  // 非关键步骤 → warn 并继续
}
```

**与实现脱节**：PHONETIC / PUNCTUATION / SEMANTIC / TRANSLATION 的 step 实现已 **catch 或不 throw**；实际会 abort 的主要是 **ASR**（及从 ASR 冒出的 GPU lease 错误）。

### 4.3 `ctx.shouldSend=false` 路径

| 写入方 | 读取方 | 行为 |
|--------|--------|------|
| `dedup-step` ← `DedupStage` | `translation-step`, `tts-step`, `yourtts-step`, `tone-step` | `return`，跳过 NMT/TTS，**不 abort** |

**已不再**：semantic-repair 设置 `shouldSend=false` 阻断翻译（解耦后已移除）。

---

## 5. 强绑定服务矩阵

| 服务 | Step | 未 running / 失败时 | 阻断主链？ | 类型 |
|------|------|---------------------|------------|------|
| **ASR** | ASR | throw | **是** | **required** |
| **AudioAggregator** | ASR | 未注入 → throw | **是**（语音路径） | **required** |
| **NMT** | TRANSLATION | throw → step catch → 空译文 | 否（Job 完成） | required（要译文时）/ step fail-open |
| **TTS** | TTS | catch → 空音频 | 否 | **real optional**（对 Job 完成） |
| **5015** | SEMANTIC_REPAIR | skip + fallback 原文 | 否 | **real optional** |
| **5016** | PHONETIC | catch，保留 segment | 否 | **real optional** |
| **5017** | PUNCTUATION | 默认不跑；跑了 fail-open | 否 | **real optional** |
| **Dedup** | DEDUP | `shouldSend=false` | 软阻断 NMT/TTS | **legacy blocker** |
| **GPU Arbiter** | 多步骤 | SKIPPED/TIMEOUT → throw | ASR **是** | **hidden blocker** |

### 5.1 分项行为（skip / throw / 清文本）

| 服务 | skip | degraded | throw 到 pipeline | shouldSend=false | clear repairedText | clear translatedText | abort |
|------|------|----------|---------------------|------------------|--------------------|----------------------|-------|
| ASR | 缓冲早退 | 低质量可空文本 | **是** | — | — | — | **是** |
| NMT | 门控 / 无文本 | — | **否** | dedup 后 | — | **是** | 否 |
| TTS | 无译文 / shouldSend | — | **否** | dedup | — | — | 否 |
| 5015 | initializer/stage/step | `semanticRepairDegraded` | **否** | 否 | defer 时 routing | — | 否 |
| 5016 | shouldExecute false | catch 继续 | **否** | — | — | — | 否 |
| 5017 | feature 默认关 | catch 继续 | **否** | — | — | — | 否 |

---

## 6. Fake optional 清单

| 项 | 说明 |
|----|------|
| `use_semantic` 缺省 **true** | 协议 optional，节点默认开 5015 |
| `use_phonetic` 缺省 **true** | 中文默认尝试 5016 |
| `job-pipeline` critical 列表 | 含 SEMANTIC/PHONETIC/PUNCTUATION/TRANSLATION，与 step fail-open **矛盾** |
| `waitForServicesReady` | 首 Job 等待 ASR+NMT+TTS 端点；字幕模式也等 TTS |
| `shouldSendToSemanticRepair`（聚合） | 名像 5015；实际驱动 `wantsPostAsrPipeline` → **defer 翻译** |
| `task-router-semantic-repair.ts` 文件头 | 仍写「失败即失败」；pipeline 路径已被 stage catch |

---

## 7. Hidden blocker 清单

| 机制 | 触发条件 | 后果 |
|------|----------|------|
| `applyPostAggregationRouting` defer | HOLD、`wantsPostAsrPipeline=false`、turn 未 finalize、空 segment | `shouldAllowTranslation=false`，`repairedText=''` |
| `ctx.shouldSend=false` | Dedup 重复 job_id | 跳过 TRANSLATION/TTS |
| 翻译输入为空 | repaired/segment/asr 皆空 | `translatedText=''` |
| ASR throw | 无服务、处理失败、auto 契约 | **整 Job 失败** |
| GPU lease SKIPPED/TIMEOUT | arbiter 启用 | ASR 路径可 abort；NMT 常被 translation-step 吞掉 |
| `audioBuffered` 早退 | ASR 缓冲 | 结果偏空，非 throw |

**解耦后已消除**：

- 5015 不可用 → 不再 `shouldSend=false`、不再清空 repairedText 阻 NMT

---

## 8. Fail-closed vs Fail-open

### 8.1 Fail-closed

| 层级 | 项 |
|------|-----|
| Pipeline | **ASR** throw 传播 |
| Router | ASR/NMT/TTS 无 `running` 端点 → throw |
| Router 5015 | 无 callback/endpoint/未 WARMED → throw（**被 stage catch → skip**） |
| GPU | lease SKIPPED/TIMEOUT → throw（ASR 直达 pipeline） |
| Inference | `processJob` rethrow |

### 8.2 Fail-open（已真实生效）

| 组件 | 行为 |
|------|------|
| `semantic-repair-step` | catch + `markSemanticRepairSkipped` |
| `phonetic-correction-step` / `punctuation-restore-step` | catch，保留原文 |
| `translation-step` | catch → `translatedText=''` |
| `tts-step` / `TTSStage` | catch → 空音频 |
| `SemanticRepairStageZH` / `EN` | catch → `skipped: true` |

---

## 9. HTTP / GPU 风险

### 9.1 Health gate 与 fetch

| 路径 | running 检查 | health / warmed |
|------|--------------|-----------------|
| ASR / NMT / TTS | registry `status === 'running'` | 无 warmed 要求 |
| 5016 / 5017 | 无；直接 `fetch` 配置 URL | 无 |
| 5015 | endpoint + `isServiceRunningCallback` | `SemanticRepairHealthChecker`（WARMED） |

**无 health gate 仍可能 fetch**：5016/5017（靠超时 + catch）；ASR/NMT/TTS 在 registry 标 `running` 后即 POST。

### 9.2 GPU lease

| 场景 | 行为 |
|------|------|
| `shouldExecuteStep` false | 不执行 step → **不申请 lease** |
| 5016/5017 执行时 | `withGpuLease('PHONETIC_CORRECTION'/'PUNCTUATION_RESTORE')` |
| 5015 ZH | `withGpuLease('SEMANTIC_REPAIR')`（失败 → stage skip） |
| arbiter 未启用 | dummy lease，直接执行 |

---

## 10. Profiling / Result 字段可信度

| 字段 | 结论 |
|------|------|
| `semantic_repair_ms` | **仓库无此字段** |
| `semantic_repair_applied` | 仅 `semanticRepairHttpApplied===true` |
| `semantic_repair_http_*` / `skipped` / `skip_reason` | 与 step/stage 一致 |
| `phonetic_applied` / `punctuation_applied` | **不存在** |
| `translation_applied` / `tts_applied` | **不存在** |
| `text_asr` | 来自 `ctx.repairedText`；defer 时可能空但 segment 有值 → warn |
| `should_send` | 仅 dedup；**不等于**是否调用 5015 |

---

## 11. 最小可运行节点配置

### 11.1 最小文本翻译节点

```json
{
  "pipeline": {
    "use_asr": false,
    "use_nmt": true,
    "use_tts": false,
    "use_semantic": false,
    "use_phonetic": false
  },
  "features": {
    "semanticRepair": { "enabled": false },
    "punctuationRestore": { "enabled": false }
  }
}
```

- **必须**：NMT（`running`）
- **可选**：全部 enhancement

### 11.2 最小语音翻译节点（要音频）

- **必须**：ASR、NMT、TTS（registry）；`AudioAggregator` + `TaskRouter`
- **推荐关闭**：`use_semantic: false`, `use_phonetic: false`, `punctuationRestore.enabled: false`

### 11.3 完整增强节点

- ASR + NMT + TTS +（可选）5015 / 5016 / 5017
- 增强全关时，主链 **ASR → NMT → TTS** 仍应正常

### 11.4 配置缺省（`node-config.ts`）

| 项 | 缺省 |
|----|------|
| `use_semantic` | **true** |
| `use_phonetic` | **true** |
| `features.semanticRepair.enabled` | **true** |
| `features.punctuationRestore.enabled` | **false** |

---

## 12. 热插拔缺失点

| 缺失点 | 说明 |
|--------|------|
| ASR fail-closed | 无法「无 ASR 跑语音 Job」；仅 TEXT_TRANSLATION 可绕过 |
| 首 Job `waitForServicesReady` | 不区分 pipeline 组合，硬等 ASR+NMT+TTS |
| `job-pipeline` critical 列表 | 与 step 实现不一致，误导运维/排障 |
| 5016/5017 无 running 探测 | 每次尝试 HTTP + 超时 |
| GPU lease 与 ASR | SKIPPED/TIMEOUT 仍可导致整 Job 失败 |
| `shouldSendToSemanticRepair` 命名 | 与 5015 脱钩，仍影响 defer 翻译 |
| Dedup `should_send` | 阻断 NMT/TTS 但 Job 仍「成功」返回 |

---

## 13. 建议下一步

### P0 — 必须解除的强绑定 / 文档债

1. **`job-pipeline.ts`**：critical 列表仅保留 **ASR**（或与 vibe「显式 skip」对齐）。
2. **`inference-service-ready.ts`**：按 `job.pipeline` 只等待需要的 ServiceType。
3. **`task-router-semantic-repair.ts`**：更新文件头注释，与 stage skip 一致。

### P1 — 建议 fail-open / 探测

1. ASR GPU lease：SKIPPED/TIMEOUT 降级策略（或配置化 hard fail）。
2. 5016/5017：执行前 `isServiceRunning` 或 registry 探测，避免无意义 fetch。

### P2 — Profiling cleanup

1. 增加 `phonetic_applied` / `punctuation_applied`（或统一 `*_http_applied`）。
2. `text_asr` 在 defer/skip 时回退 `segmentForJobResult` 的可观测性。

### P3 — Dead legacy cleanup

1. 重命名/废弃 `shouldSendToSemanticRepair` → `wantsPostAsrPipeline`。
2. 清理 router 与 pipeline 矛盾的「强制语义修复」注释。

### 最小 patch plan

| # | 改动 | 文件 |
|---|------|------|
| 1 | critical 列表仅 `ASR` | `job-pipeline.ts` |
| 2 | 按 pipeline 检查就绪服务 | `inference-service-ready.ts` |
| 3 |（可选）phonetic/punctuation 前置 running 检查 | `phonetic-correction-step.ts`, `punctuation-restore-step.ts` |

### 验收 smoke

| # | 场景 | 期望 |
|---|------|------|
| 1 | `use_asr=false, use_nmt=true` | 有 `text_translated`，无 ASR HTTP |
| 2 | `use_semantic=false`，停 5015 | Job 成功，有译文；`semantic_repair_skipped` 或 step 未执行 |
| 3 | 停 NMT | Job 返回，`text_translated` 空，无 pipeline throw |
| 4 | 停 TTS | Job 成功，`tts_audio` 空 |
| 5 | dedup 重复 job | `should_send=false`，无译文，pipeline 不 throw |

---

## 14. 关键代码索引

| 主题 | 路径 |
|------|------|
| 编排器 | `pipeline/job-pipeline.ts` |
| 模式与门控 | `pipeline/pipeline-mode-config.ts` |
| 聚合后门控 | `pipeline/post-asr-routing.ts` |
| 语义修复 step | `pipeline/steps/semantic-repair-step.ts` |
| 翻译 step | `pipeline/steps/translation-step.ts` |
| 结果构建 | `pipeline/result-builder.ts` |
| 配置缺省 | `node-config.ts` |
| 5015 路由 | `task-router/task-router-semantic-repair.ts` |
| NMT 路由 | `task-router/task-router-nmt.ts` |
| TTS 路由 | `task-router/task-router-tts.ts` |
| 首 Job 就绪 | `inference/inference-service-ready.ts` |
| 协议 pipeline | `webapp/shared/protocols/messages.ts` |

---

*本报告依据仓库当前代码静态审计生成，未执行端到端集成测试。*
