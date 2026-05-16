# 增强服务热插拔解绑 — 执行前补充信息

**日期**：2026-05-16  
**用途**：对照决策部门《增强服务热插拔解绑改造方案》设计任务，在**进入 patch plan 设计 / 实施前**需确认或补充的信息。  
**依据**：

- 决策部门方案（T1–T8 + Checklist + Smoke）
- 只读审计：[JobPipeline_Strong_Dependency_Audit_2026-05-16.md](./JobPipeline_Strong_Dependency_Audit_2026-05-16.md)
- 当前代码：`electron_node/electron-node/main/src`

**结论摘要**：**可以启动「审计 + patch plan 设计」**，但有多项**产品/配置缺省**与**技术缺口**必须先拍板；否则 patch 范围与验收标准会漂移。下文按「已满足 / 部分满足 / 未满足」与「待决策清单」组织。

---

## 1. 执行前总判断

| 维度 | 判断 |
|------|------|
| 是否具备设计 patch plan 的条件 | **是**（主链与增强边界已基本清晰） |
| 是否可直接大规模重构 | **否**（决策要求本轮仅设计；且有多处待拍板） |
| 与上轮语义修复解耦的关系 | T3 大部分已完成；T1/T2/T7/T8 仍有关键缺口 |
| 最大阻塞风险 | **5016 端口冲突**（`phonetic_correction_zh` vs `your_tts`）；**增强默认开启**与决策「默认 optional」不一致 |

---

## 2. 决策方案 vs 当前代码（T1–T8 差距表）

| 任务 | 目标（决策） | 当前实现（2026-05-16） | 设计 patch 前需补充 |
|------|--------------|------------------------|---------------------|
| **T1 PHONETIC / 5016** | not running → skip、无 fetch、无 lease | `shouldExecuteStep` 仅看配置+`shouldRunPhoneticCorrection`；**无 running gate**；step 内 `withGpuLease` 后 **直接 fetch**；失败 catch（fail-open） | 是否将 `use_phonetic` **缺省改为 false**；`features.phoneticCorrection.enabled` 是否新增；running 探测 API（registry vs health） |
| **T2 PUNCTUATION / 5017** | 默认不参与主链 | `features.punctuationRestore.enabled` **默认 false** ✓；开启后同样 **无 running gate**，有 fetch+lease | `punctuation_ms/calls` 字段是否新建；与 `shouldSendToSemanticRepair` 解耦已 ✓ |
| **T3 SEMANTIC / 5015** | 无残留强绑定 | step/stage skip ✓；**defer 时仍 `repairedText=''`**（聚合 HOLD，非 5015）；`job-pipeline` 仍将 SEMANTIC 标为 critical（legacy） | 是否把 HOLD/defer 清空 `repairedText` 纳入本轮；router 注释与实现不一致需文档化 |
| **T4 speaker_embedding** | 不在最小主链 | **未进入 `JobPipeline` step**；`node-agent-job-processor` 按 `job.features.speaker_identification` **尝试启动**服务，失败 warn 继续 | `speaker_embedding` 是否算 enhancement 范围；是否禁止 job 级自动 pull-up 服务 |
| **T5 your_tts** | 非默认 TTS | 默认 TTS 为 `piper-tts`（5009）；`YOURTTS` 仅 `use_tone=true`；**your_tts 与 phonetic 均声明 port 5016** | **必须决策：5016 归谁**；是否改 `your_tts` 端口或禁止同时安装 |
| **T6 EN normalize-only** | 不标 `semantic_repair_applied` | `EnNormalizeStage` **纯规则、无 HTTP** ✓；`processEnglish` 仅 HTTP 成功设 `semanticRepairHttpApplied` ✓；`en_normalize_applied` 已有 | 是否在 SEMANTIC step **未执行**时也写 `en_normalize_applied=false` 显式字段 |
| **T7 GPU lease** | disabled/not running 不申请 lease | **未满足**：PH/PU/SEM 均在 step/stage 入口 `withGpuLease`，**running/health 判断在 lease 之后**（5015 在 router 内） | 统一「EnhancementGate」：先 gate 再 lease 再 HTTP |
| **T8 profiling** | skipped/applied/http_ms 分离 | 5015 部分字段已有；**无** `phonetic_*` / `punctuation_*` / `*_ms` 体系 | 字段命名规范、是否进 `JobResult` 顶层或 `extra`、调度端是否消费 |

---

## 3. 必须在执行前拍板的产品/配置决策

### 3.1 增强服务缺省策略（影响 T1/T2/T3 验收 Smoke 1）

决策文案建议：`false` 或 **service running 才执行**。当前代码：

| 配置项 | 当前缺省 | 决策方案建议 | 冲突 |
|--------|----------|--------------|------|
| `job.pipeline.use_semantic` | **true** | 建议改为 **false** 或保持 true 但要求 5015 running gate | Smoke 1「全关」需调度显式传 `use_semantic: false` |
| `job.pipeline.use_phonetic` | **true** | 建议改为 **false** | 否则中文 job 仍会尝试 5016 fetch（10s 超时） |
| `features.semanticRepair.enabled` | **true** | 可与 use_semantic 双层；需定义优先级 | |
| `features.punctuationRestore.enabled` | **false** ✓ | 与决策一致 | |
| `features.phoneticCorrection.enabled` | **不存在** | 需新增或仅用 `use_phonetic` | 决策写了两种配置名 |

**待决策 Q1**：增强缺省是「全关」还是「开配置但 not running 则 skip」？  
**待决策 Q2**：`use_phonetic` 与 `features.phoneticCorrection.enabled` 是 AND 还是单层？

### 3.2 「跑通」与成功定义（影响 Checklist / Smoke）

| 项 | 决策 Checklist 写法 | 当前代码事实 | 待补充 |
|----|---------------------|--------------|--------|
| `JobResult.ok=true` | 有 | **`JobResult` 无 `ok` 字段**；失败多为 `processJob` throw | 成功定义改为：`processJob` 不 throw + `should_send`？或新增 `ok` |
| `text_asr` 非空 | 有 | 来自 `repairedText`；**defer/HOLD 时可能空** | Smoke 是否允许「中间 job 空 asr」 |
| `tts_audio` 非空 | 有 | TTS 失败为 **空字符串**，Job 仍返回 | 「valid」是否包含空音频 |
| 首 Job 就绪 | 未写 | `waitForServicesReady` 硬等 ASR+NMT+TTS | 是否纳入本轮改为按 pipeline 等待 |

**待决策 Q3**：验收「Job 成功」的权威信号是什么？  
**待决策 Q4**：Smoke 1 是否包含 **turn HOLD / 未 finalize** 场景，还是仅「单段 SEND」？

### 3.3 端口与部署（T5，阻塞级）

已核实 `service.json`：

| 服务 | service id | port |
|------|------------|------|
| phonetic_correction_zh | phonetic-correction-zh | **5016** |
| your_tts | your-tts | **5016** |
| piper_tts | piper-tts | 5009 |
| speaker_embedding | speaker-embedding | 5014 |
| semantic_repair_en_zh | （registry id `semantic-repair-en-zh`） | 5015（惯例，以实现为准） |

**待决策 Q5**：5016 端口归属与互斥安装策略（改端口 / 禁用其一 / 文档禁止同机启两个）。  
**待决策 Q6**：`use_tone=true` 个人语音路径是否仍属「enhancement」还是独立产品模式（仍依赖 YOURTTS，非 piper）。

### 3.4 范围边界：未列入 Pipeline 的 enhancement

决策提到「其它 rerank / postprocess enhancement」。代码中存在但 **不在 JobPipeline step 序列**：

| 能力 | 位置 | 默认 | 是否纳入本轮 |
|------|------|------|--------------|
| `enableS1PromptBias` | `pipeline-orchestrator-asr.ts` | false | 待确认 |
| `enableS2Rescoring` | node-config | false | 待确认 |
| `enablePostProcessTranslation` | node-config | true | 待确认（可能影响 NMT 候选） |
| `speaker_identification` → 启动 speaker_embedding | `node-agent-job-processor.ts` | job 级 | 待确认 |
| `tone-step.ts` | 存在文件，**未注册** `pipeline-step-registry` | — | 死代码或遗留？ |
| LID + Router | `asr-step` | 按 job | 是否算 enhancement |

**待决策 Q7**：本轮 patch plan 是否包含 S1/S2/PostProcessTranslation，还是严格 T1–T8？

### 3.5 聚合 / 去重语义（非服务，但影响「不清空文本」）

决策要求 enhancement 缺失时「不清空文本、不阻断 NMT」。以下 **非 enhancement down**，但行为类似 blocker：

| 机制 | 行为 | 是否纳入解绑改造 |
|------|------|------------------|
| `applyPostAggregationRouting` defer | `repairedText=''`，`shouldAllowTranslation=false` | 待决策（产品 HOLD 逻辑） |
| `DedupStage` | `shouldSend=false` → 跳过 NMT/TTS | 待决策（是否算 enhancement） |
| `job-pipeline` critical 列表 | PH/PU/SEM/TRANSLATION 标 critical | 建议 P0 仅留 ASR（与决策一致） |

**待决策 Q8**：HOLD/defer/dedup 是否在本轮改为「不阻断 NMT」，还是单独立项？

---

## 4. 技术设计前需补全的调研项（建议列入 patch plan 第 0 阶段）

以下可在设计阶段用 **只读脚本/单测** 完成，不必等产品决策全部结束，但**验收前**必须闭合。

| # | 调研项 | 方法 | 产出 |
|---|--------|------|------|
| R1 | 5015 running gate 与 GPU lease 顺序 | 读 `semantic-repair-stage-zh.ts` + trace | 「先 gate 再 lease」改造点清单 |
| R2 | 5016/5017 running 探测统一接口 | 对齐 5015：`isServiceRunningCallback` + `/health`？ | `EnhancementServiceGate` 接口草案 |
| R3 | `selectServiceEndpoint(TTS)` 在 `use_tone=false` 时是否可能选到 your-tts | 读 registry + `task-router-tts.ts` | T5 风险说明 |
| R4 | 调度端下发 job 的默认 `pipeline` / `features` | 查 scheduler / webapp 默认 | Smoke 1 配置模板 |
| R5 | GPU arbiter `PHONETIC_CORRECTION` policy 的 SKIP 行为 | 读 `gpu-lease-helper.ts` | 是否与「不申请 lease」等价 |
| R6 | 是否存在 enhancement HTTP 的集成测试 harness | 查 `pipeline-job-flow.test` 等 | Smoke 自动化可行性 |

---

## 5. 建议的 patch plan 结构（本轮仅设计，不实施）

供下一阶段《Enhancement Service Hot-Plug Cleanup Report》直接复用：

### Phase 0 — 决策闭合（本文档 Q1–Q8）

- 输出：《增强服务缺省与验收定义》一页纸

### Phase 1 — P0 行为一致（小 patch，低风险）

1. `job-pipeline.ts`：critical 仅 `ASR`
2. `inference-service-ready.ts`：按 `job.pipeline` 等待服务
3. 文档：5016 端口策略

### Phase 2 — EnhancementGate（T1/T2/T3/T7 核心）

1. 新增 `enhancement-gate.ts`（或扩展 `post-asr-routing.ts`）
   - 输入：serviceId / feature flag / running / health
   - 输出：`shouldRun*` + `skipReason`（写入 ctx）
2. PH/PU/SEM step：**gate →（可选）lease → HTTP**
3. 5016/5017：**not running 时不 fetch、不 lease**

### Phase 3 — Profiling（T8）

1. `job-context` + `result-builder` 增加：
   - `phonetic_correction_skipped` / `_applied` / `_http_called`（命名待决策）
   - `punctuation_restore_*`
   - 可选 `*_ms`（step vs http 分离）

### Phase 4 — 外围（T4/T5/T6）

1. speaker_embedding：job 级启动改为显式 optional
2. your_tts：端口或 registry 互斥
3. EN normalize：确认仅写 `en_normalize_applied`

### Phase 5 — 验收

- 决策方 Smoke 1–4 + 单元测试矩阵

---

## 6. 验收 Smoke 环境前置条件（执行前检查清单）

| 项 | 要求 |
|----|------|
| ASR | registry `running`，已知 serviceId（如 faster-whisper / sherpa） |
| NMT | `m2m100` 5008 running |
| TTS | `piper-tts` 5009 running |
| 5015/5016/5017 | 按 case 显式启停；**不可同时假设 5016 上 phonetic+your_tts** |
| 节点配置 | `electron-node-config.json` 与 job.pipeline 对齐 Smoke 表 |
| 调度 job | 提供标准 `JobAssignMessage` 样例（含/不含 turn_id、finalize） |
| 观测 | 日志关键字 + `JobResult` 字段；**无统一 metrics 埋点时需手工 grep HTTP** |
| GPU arbiter | 记录 enabled/disabled；Smoke 1 建议 **arbiter off** 与 **on** 各跑一遍 |

---

## 7. 与决策 Checklist 的对照（设计前自检）

| Checklist 条目 | 设计前状态 |
|----------------|------------|
| 全 enhancement 关闭仍可 ASR→NMT→TTS | **需显式关 use_semantic/use_phonetic**；否则仍会 hit 5016 |
| 5016 未启动不 fetch | **未满足**（会 fetch 后 catch） |
| 5016 未启动不 lease | **未满足** |
| 5017 未启动不 POST | **默认不跑** ✓；开启后 **未满足** running gate |
| 5015 未启动不 POST /repair | **部分满足**（router throw → stage skip；可能已拿 lease） |
| 不设置 shouldSend=false（5015） | **满足** ✓ |
| 不清空 repairedText（5015 down） | **满足** ✓；**defer 仍会清空** |
| speaker_embedding 不在最小主链 | **满足** ✓ |
| your_tts 不参与默认 TTS | **满足** ✓；**端口冲突未解** |
| EN normalize 不标 semantic_repair_applied | **满足** ✓ |
| disabled enhancement 不 lease | **未满足** |
| skipped/applied 区分 | **5015 部分**；PH/PU **缺字段** |

---

## 8. 是否可以进入「ASR→NMT→TTS 基础链路回归」

| 条件 | 状态 |
|------|------|
| 基础三服务定义清晰 | ✓ |
| 增强默认不拖死主链（配置层） | **需 Q1/Q2 缺省拍板** |
| 5016 端口冲突有部署策略 | **需 Q5** |
| 验收成功定义明确 | **需 Q3/Q4** |
| T7 lease 顺序有改造方案 | 可先设计，后实施 |

**建议**：在 **Q1、Q3、Q5** 闭合后，即可并行：

1. 编写《Enhancement Service Hot-Plug Cleanup》patch plan 正文  
2. 启动 **Smoke 1** 的手工/脚本回归（ASR+NMT+TTS，全 enhancement 显式关闭）

---

## 9. 待决策问题汇总（请决策部门回复）

| ID | 问题 | 建议选项 |
|----|------|----------|
| Q1 | 增强服务缺省开还是关？ | A 全关缺省 / B 开但 not running skip |
| Q2 | phonetic 配置单层还是双层？ | A 仅 `use_phonetic` / B 加 `features.phoneticCorrection.enabled` |
| Q3 | Job 成功验收信号？ | A `processJob` 不 throw / B 新增 `JobResult.ok` / C 字段组合 |
| Q4 | Smoke 是否覆盖 HOLD/defer turn？ | A 仅 SEND / B 含 turn 未 finalize |
| Q5 | 5016 端口策略？ | A 改 your_tts 端口 / B 互斥安装 / C 弃用 your_tts |
| Q6 | `use_tone` 路径归属？ | A enhancement / B 独立产品模式 |
| Q7 | S1/S2/PostProcessTranslation 范围？ | A 纳入 T* / B 本轮排除 |
| Q8 | HOLD/defer/dedup 是否改阻断？ | A 本轮不改 / B 一并解绑 |

---

## 10. 相关文档

- [JobPipeline_Strong_Dependency_Audit_2026-05-16.md](./JobPipeline_Strong_Dependency_Audit_2026-05-16.md)
- [semantic_repair_mainchain_decoupling_plan_revised.md](./semantic_repair_mainchain_decoupling_plan_revised.md)（T3 已实施部分）

---

*本文档为执行前补充信息，不包含代码修改。决策闭合后，应产出《Enhancement Service Hot-Plug Cleanup Report》设计稿（含修改文件列表与分 phase patch）。*


---

# 4. 决策部门补充结论（执行约束）

以下内容为基于当前审计结果的最终执行约束，用于避免 patch plan 漂移。

## 4.1 ASR / NMT / TTS 不属于解绑范围

以下服务属于节点固定基础能力：

```text
ASR
NMT
TTS
```

它们不是 enhancement。

因此：

```text
service missing
→ fail-closed
```

是允许的。

本轮不对以下内容做热插拔：

- ASR availability
- NMT availability
- TTS availability
- waitForServicesReady 对基础服务的等待

---

## 4.2 真正需要解绑的是 enhancement service

以下服务必须满足：

```text
disabled / not running
→ skip
→ no HTTP
→ no GPU lease
→ no text clearing
→ no translation block
```

包括：

```text
PHONETIC_CORRECTION / 5016
PUNCTUATION_RESTORE / 5017
SEMANTIC_REPAIR / 5015
speaker_embedding
your_tts
normalize-only enhancement
```

---

## 4.3 当前最高优先级 blocker

### A. 5016 端口冲突

当前：

```text
phonetic_correction_zh
your_tts
```

均声明：

```text
5016
```

必须在 patch plan 前明确：

```text
5016 归 phonetic_correction_zh
```

建议：

```text
your_tts 改端口
或彻底移出默认节点安装
```

否则：

```text
service registry
health
GPU lease
```

都会产生伪冲突。

---

### B. Enhancement running gate 缺失

当前：

```text
step
→ withGpuLease
→ fetch
```

而不是：

```text
running gate
→ lease
→ HTTP
```

这是当前 enhancement “半绑定”的核心原因。

---

# 5. 建议的统一 EnhancementGate 设计

建议不要每个 step 各写一套 gate。

新增统一 helper，例如：

```ts
shouldRunEnhancementService({
  enabled,
  serviceId,
  registry,
  health,
})
```

统一行为：

```text
disabled
→ skip

not registered
→ skip

not running
→ skip

health failed
→ skip
```

且：

```text
skip before GPU lease
```

---

## 5.1 推荐 skip 输出

统一：

```json
{
  "skipped": true,
  "skip_reason": "SERVICE_NOT_RUNNING"
}
```

不要：

```text
throw
ctx.shouldSend=false
ctx.repairedText=''
```

---

# 6. 建议的 Profiling 规范

当前：

```text
semantic_repair_ms
punctuation_ms
```

可能只是：

```text
空 step timing
```

不是：

```text
真实 HTTP 推理
```

建议：

| 字段 | 含义 |
|---|---|
| `*_step_ms` | step 总耗时 |
| `*_http_ms` | 真实 HTTP 推理耗时 |
| `*_skipped` | 是否 skip |
| `*_applied` | 是否真正修改文本 |
| `*_degraded` | 是否 fallback |
| `*_http_called` | 是否发出 HTTP |

---

# 7. 最终推荐的 Enhancement 缺省策略

建议最终默认：

| Enhancement | 默认 |
|---|---|
| semantic repair | disabled |
| phonetic correction | disabled |
| punctuation restore | disabled |
| speaker embedding | disabled |
| your_tts | disabled |

只有：

```text
service running
AND feature enabled
```

时才进入 enhancement path。

---

# 8. 推荐 Patch 顺序（最终版）

## P0

```text
5016 running gate
5017 running gate
5015 running gate cleanup
```

---

## P1

```text
EnhancementGate helper
lease-before-gate cleanup
```

---

## P2

```text
profiling / report cleanup
```

---

## P3

```text
dead enhancement path cleanup
legacy your_tts cleanup
```

---

# 9. 最终验收目标

最终目标不是：

```text
所有 enhancement 永远运行
```

而是：

```text
ASR + NMT + TTS
始终稳定运行
```

同时：

```text
enhancement service
可插拔
可缺失
可关闭
可失败
```

并且：

```text
不影响主翻译链。
```
