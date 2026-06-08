# Lexicon primaryDomain / domain recall 查询条件审计报告

**日期：** 2026-06-07  
**性质：** 只读审计（禁止改码 / 禁止补丁 / 禁止重构）  
**关联批测：** `electron_node/electron-node/tests/lexicon-tone-dialog200-batch-result.json`（200/200，`primaryDomain=general` 200/200，`domain_hits=0`，`active_domain=base_only`）

---

## 执行摘要

| 问题 | 结论 |
|------|------|
| `primaryDomain` 由谁赋值？ | 会话创建时 `createInitialProfile()` → `defaultGeneralProfile()`；CPU LLM intent 在 **turn 结束后异步** 推断并 **staging 到下一 turn**；`session-migration/import` 可注入；测试 mock 可设 `profilePrimaryDomain` |
| 是否存在冷启动死锁？ | **存在结构性风险**：`general` → `domainIds=[]` → 专业词（仅 domain 层）不可召回；首句若 IME 不产生 diff span，则 LLM 也缺少可修复信号；单 turn 批测 + `lexicon_v2_intent_enabled:false` 时死锁 **必然** |
| `general` 完全关闭 domain 是否合理？ | **对 P4 冻结语义合理**（profile 未明确时不应强 boost domain），但对 **餐饮等同音专业词**（`中杯/大杯` 仅在 `domain_lexicon`）在冷启动场景 **过于保守** |
| 最小应调哪个查询条件？ | `resolveDomainIdsForRecall()`（或在其旁新增 weak-fallback 解析器），**不建议**改 HintGate / Tone / KenLM / Apply |
| 只改 neighbor 还是也改正式 Recall？ | **推荐方案 1 先仅 neighbor**；方案 2 在验收通过后再扩到正式 Recall |
| 是否要改 CPU LLM？ | **非必须**；LLM 是慢路径，无法救首句单 turn；批测可注入 profile |
| 推荐最小方案 | 方案 1：`createLexiconNearNeighborProbe` 路径使用 `enabledDomains` 的 **limited weak domain fallback**（topK=1/域，降权，仅扩候选池） |

---

## 一、primaryDomain 字段来源审计

### 1.1 调用链（SSOT）

```text
POST /run-pipeline-with-audio (session_id, lexicon_v2_intent_enabled?)
  → job-pipeline.ts: beginSessionTurnProfile()
      → session-store.ts: ensureSession() 
          → createInitialProfile() → defaultGeneralProfile()  // primaryDomain='general'
      → activatePendingProfileForTurn()  // 若有 pendingProfile 且 turnNumber >= effectiveFromTurn
      → bindProfileSnapshotToContext(ctx, snapshot)
  → fw-detector-orchestrator.ts: runFwDetectorOrchestrator()
      → getProfileSnapshotFromContext(ctx) ?? defaultGeneralProfile()
      → resolvePinyinImeV2Spans({ profile, enabledDomains, minPrior })
          → createLexiconNearNeighborProbe(profile) 
              → recallSpanTopK(rawSpan, profile, topK=1, minPrior, enabledDomains)
      → runFwSentenceRerankPipeline() → recallSpanTopK(span, profile, topK, ...)
  → local-span-recall.ts: resolveRecallDomainIds(profile, enabledDomains)
      → [useIndustryRouting=false] resolveDomainIdsForRecall(profile)
      → [useIndustryRouting=true]  resolveRecallDomains({ sessionIntent, enabledDomains, runtimeV2 })
  → recall-span-topk-v2.ts: collectTierCandidates(domainIds)
      → lookupBaseByPinyinKey + lookupDomainByPinyinKey(domainId) + idiom
  → recordRecallSpanDiagnostics: active_domain = domainIds.join('|') || 'base_only'
  → job-pipeline.ts: finalizeSessionTurn()
      → scheduleIntentIfNeeded() [若 intent 启用]
          → cpu-intent-llm-worker → inferLexiconProfileDecision()
          → applyProfileDecision() → stagePendingProfile()  // 下一 turn 生效
```

### 1.2 赋值来源明细

| 来源 | 文件 | 时机 | 默认值 |
|------|------|------|--------|
| 会话创建 | `session-store.ts` L75 | `ensureSession()` 首次见到 `session_id` | `general` |
| 默认 profile | `profile-registry.ts` `defaultGeneralProfile()` | 同上 | `primaryDomain: 'general'`, `confidence: 1.0` |
| Turn 绑定 | `session-finalize.ts` `beginSessionTurnProfile()` | 每 job 开始 | 读 `session.activeLexiconProfile` 快照，turn 内不变 |
| CPU LLM | `session-finalize.ts` `scheduleIntentIfNeeded()` | **turn finalize 之后** 异步 | 需 `confidence >= 0.75` 且 `primary !== 'general'` 才切换 |
| Session migration | `session-migration.ts` import | 测试 / 节点迁移 | 显式注入 `activeLexiconProfile` |
| Mock pipeline | `inference-service.ts` L539 | mock-asr | `bindProfileSnapshotToContext({ primaryDomain: options.profilePrimaryDomain })` |

### 1.3 存储位置

| 层级 | 字段 | 说明 |
|------|------|------|
| Node 内存 | `SessionObject.activeLexiconProfile` | 权威状态 |
| Turn 快照 | `session.turnProfileSnapshot` | 单 turn 内固定 |
| Job 上下文 | `ctx.__lexiconProfileSnapshot` | FW / Recall 读取 |
| 诊断输出 | `extra.activeLexiconProfile` / `fw_detector.runtime.profilePrimary` | 批测可观测 |
| Migration 导出 | `activeLexiconProfile` + 可选 `pendingProfile` | 持久化 JSON |
| **不在** | request payload 的 `primaryDomain` 字段 | 批测 payload 无此字段 |
| **不在** | lexicon.sqlite / Redis | profile 不进词库 |

### 1.4 更新时机与滞后

1. **Turn N 开始**：绑定当前 `activeLexiconProfile`（或激活已到期的 `pendingProfile`）。
2. **Turn N 流水线**：FW Recall 使用上述快照（含 neighbor + 正式 recall）。
3. **Turn N 结束**：`finalizeSessionTurn` → 若 intent 调度触发，异步 LLM 推断。
4. **LLM 返回后**：`stagePendingProfile`，`effectiveFromTurn >= finalizedTurnCount + 1`。
5. **Turn N+1 开始**：`activatePendingProfileForTurn` 才真正切换 `primaryDomain`。

**关键：** 即使 intent 启用，**首个 turn 永远是 general**（除非 migration 预注入）。

### 1.5 与 `lexicon_v2_intent_enabled` 的关系

| 开关 | 路径 | 影响 |
|------|------|------|
| `lexicon_v2_intent_enabled: false`（dialog200 批测） | `job-pipeline.ts` L59 → `session.intentSchedulingEnabled = false` | `isSessionIntentSchedulingEnabled()` 返回 false → **永不调度 CPU LLM** |
| `features.lexiconV2.intentEnabled`（node config） | `lexicon-v2-config.ts` | 全局 intent 开关 |
| `features.lexiconV2.enabled` | 同上 | false 时 intent 也不调度 |

dialog200 批测同时满足：**新 session / 单 turn / intent 关闭 / 无 migration** → profile **恒为 general**。

### 1.6 为何 dialog200 200/200 都是 `general`

`run-dialog200-timed-batch.mjs`：

```javascript
session_id: `v31-d200-${caseDef.id}-${Date.now()}`,  // 每案独立新 session
lexicon_v2_intent_enabled: false,                     // 关闭 intent 调度
// 无 POST /session-migration/import
```

对比 `run-p4-freeze-batch.js --profile restaurant`：固定 `BATCH_SESSION_ID` + **先 import** `activeLexiconProfile.primaryDomain='restaurant'`。

---

## 二、primaryDomain 与 CPU LLM 的关系

### 2.1 CPU LLM 入口与调用时机

| 项 | 位置 |
|----|------|
| HTTP 客户端 | `cpu-llm-model-runner.ts` → `inferLexiconProfileDecision()` |
| Worker 队列 | `cpu-intent-llm-worker.ts`（单 worker，latest-only） |
| 调度策略 | `intent-job-scheduler.ts` `shouldScheduleIntentJob()` |
| Prompt 构建 | `lexicon-intent-prompt-builder.ts` |
| 决策解析 | `lexicon-profile-decision-parser.ts` |
| Profile 应用 | `active-lexicon-profile-manager.ts` `applyProfileDecision()` |
| Intent SSOT 写入 | `lexicon-session-intent.ts` `buildLexiconSessionIntentFromDecision()` |

**调用时机：仅在 `finalizeSessionTurn` 之后**，不在 ASR 修复前。

### 2.2 LLM 输入文本

`buildLexiconIntentRequest` 使用 `RollingTurn`：

- `rawAsrText`：原始 ASR
- `finalText`：`segmentForJobResult` 或 raw（含 FW 修复后文本，若已 apply）
- `activeProfileAtTurn`：该 turn 使用的 profile
- `recoverStats`：含 `noTopkCandidate`、`pickedSource`

LLM **不直接读** `domain_lexicon；它根据对话上下文推断 `primaryDomain`（restaurant / medical / …）。

### 2.3 与 ASR 修复的先后关系

```text
Turn N: ASR → FW(用 general profile) → 可能无 apply → finalText
        → finalize → 异步 LLM(读 raw+final)
Turn N+1: 若 LLM 昨 staged restaurant → 本 turn FW 才查 domain_lexicon.restaurant
```

### 2.4 冷启动闭环风险 — **明确判断：存在**

```text
domain 未知 (general)
  → resolveDomainIdsForRecall → []
  → 中杯/大杯等仅 domain 层词不可 recall
  → IME 可能 diffSpanCount=0（d001）或 neighbor 失败（钟贝/蓝美马分）
  → finalText 仍含错词
  → LLM 虽可能从「点一杯热拿铁」推断 restaurant，但：
       (a) dialog200 intent 关闭 → 永不推断
       (b) 单 turn session → 无 N+1
       (c) 即使有 N+1，首句错词已错过修复窗口
```

**结论：** 存在 **「domain 未知 → 不查专业词库 → 专业词修不出 → domain 继续未知」** 的结构性闭环；LLM 是 **慢路径**，不能单独解决首句 / 单 turn / intent-off 场景。

---

## 三、当前 domain recall 查询逻辑审计

### 3.1 核心代码行为

**`domain-recall-merge.ts` `resolveDomainIdsForRecall()`：**

```typescript
if (!primary || primary === 'general' || !isValidLLMDomain(primary)) {
  return [];
}
```

**`recall-span-topk-v2.ts` `collectTierCandidates()`：**

- `domainIds` 为空时：**不调用** `lookupDomainByPinyinKey`
- `active_domain` 诊断：`domainIds.length ? domainIds.join('|') : 'base_only'`
- `mergeSpanCandidatesCombined`：`hasActiveDomain=false` 时 **丢弃 domain tier**，仅 base + alias

**`isIndustryRoutingEnabled()`：** 默认 `features.fwDetector.useIndustryRouting !== true` → **关闭**。  
关闭时 `resolveRecallDomains()` 的 session_intent / industry_routing / anchor / enabled_domains 四级 fallback **全部不生效**。

### 3.2 状态矩阵

| primaryDomain 状态 | domainIds | 查 domain_lexicon | active_domain | 备注 |
|-------------------|-----------|-------------------|---------------|------|
| `restaurant` | `['restaurant', …secondary]` | **是**（primary + 合法 secondary） | `restaurant\|travel` 等 | secondary 经 `isValidLLMDomain` 过滤 |
| `general` | `[]` | **否** | `base_only` | 单元测试明确：`domain-recall-merge.test.ts` |
| `null` / `undefined` / `''` | `[]` | **否** | `base_only` | 同 general 分支 |
| `unknown`（非 registry 合法 id） | `[]` | **否** | `base_only` | `!isValidLLMDomain(primary)` |
| `restaurant` + `useIndustryRouting=true` | 可能走 intent/routing/anchor | 视 resolver | 非 `base_only` | **当前生产配置未启用** |

### 3.3 其他机制确认

| 问题 | 结论 |
|------|------|
| 是否只查 base + idiom？ | `general` 时：**是**（domain 层零查询） |
| domain 是否只能靠 primaryDomain 精确命中？ | **是**（routing 关闭时） |
| 是否有 fallback domain 查询？ | 代码有 `industry-routing-domain-resolver.ts`，但 **默认关闭** |
| 是否支持全 domain 弱召回？ | **否** |
| prior_score / domain_score 限制？ | `maxDomainCandidates=3`，`mergeSpanCandidatesCombined` perSpanLimit；neighbor 用 `topK=1` |

### 3.4 HintGate neighbor 路径

`resolve-pinyin-ime-v2-spans.ts`：

```typescript
recallSpanTopK(rawSpan, profile, 1, minPrior, enabledDomains)
```

与正式 Recall **共用** `resolveRecallDomainIds` → `general` 时 neighbor 也 **只看 base**。

---

## 四、目标逻辑 A/B/C 合理性评估

### 目标逻辑 A：general/null 时 limited domain fallback

**合理。** 与 P4「profile 未明确不强推 domain」不矛盾，若：

- fallback 候选 **低权重**（`domainBoost=0` 或 `FALLBACK_WEIGHT << PRIMARY`）
- 仅进入候选池，**不绕过** KenLM / Apply
- topK / 域数有硬上限

### 目标逻辑 B：restaurant 明确时扩大 domain 候选

**已部分实现。** `primaryDomain=restaurant` 时已查 `domain_lexicon.restaurant`；「更多近似音」取决于 `maxDomainCandidates` / `perSpanLimit`，**不在本次审计调整范围**（禁止调 IME TopK）。

### 目标逻辑 C：fallback 只扩 Recall 候选池

**合理且与架构一致。** HintGate neighbor 本质是 `recallSpanTopK(topK=1)` 探针；扩 domain 查询 **不改变** HintGate 决策结构（仍要求 `hits.length > 0`）。

### 最小需动函数/条件

| 优先级 | 位置 | 改动性质 |
|--------|------|----------|
| **P0** | `domain-recall-merge.ts` 新增 `resolveDomainIdsForWeakFallback(profile, enabledDomains)` | 返回 limited `enabledDomains` 子集 |
| **P0** | `local-span-recall.ts` `resolveRecallDomainIds` 或新增参数 `recallMode` | neighbor / formal 分流 |
| **P1** | `resolve-pinyin-ime-v2-spans.ts` `createLexiconNearNeighborProbe` | 传入 weak-fallback domainIds |
| 可选 | `merge-span-candidates.ts` | fallback 时 `hasActiveDomain` 语义 / 降序权重 |
| **不动** | `pinyin-ime-v2-hint-gate.ts` 门控逻辑 | 用户禁止改机制本身 |

---

## 五、HintGate neighbor 与 domain fallback

### 5.1 词库层事实（v3 seed / domain_patch）

| 词 | 层 | pinyin key (tone-less) | repairTarget |
|----|-----|------------------------|--------------|
| 中杯 | domain only | `zhong\|bei` | true |
| 大杯 | domain only | `da\|bei` | true |
| 小杯 | domain + **base** (prior 0.53) | `xiao\|bei` | true |
| 蓝莓马芬 | domain only | `lan\|mei\|ma\|fen` | true |
| 美式 | domain + base | `mei\|shi` | true |
| 美食 | **base** (prior 0.73) | `mei\|shi` | true |
| 大悲 | **base** (prior 0.61) | `da\|bei` | true |

### 5.2 Neighbor 探针表（假设 span 已到达 HintGate）

| rawSpan | expectedDomainCandidate | 当前 general 是否 neighbor | fallback domain 后是否 neighbor |
|---------|-------------------------|---------------------------|------------------------------|
| 钟贝 | 中杯 | **否**（base 无 `zhong\|bei` 桶；`中杯` 仅 domain） | **是**（restaurant domain） |
| 大悲 | 大杯 | **是，但是自匹配**（base 含 `大悲` 同 key，neighbor 通过但目标错误） | **是**（`大杯` prior 更高，topK=1 可命中正确词） |
| 小背 | 小杯 | **是**（base 已有 `小杯`） | **是** |
| 蓝美马分 | 蓝莓马芬 | **否**（4 字仅 domain） | **是**（restaurant domain） |

### 5.3 dialog_200 实测与上表差异

| 案例 | 实际 | 原因 |
|------|------|------|
| d001 钟贝 | 未测 neighbor | `diffSpanCount=0`，IME 未提议 span |
| d001 蓝美马分 | 未测 neighbor | 同上 |
| d002 大悲 | `gateDroppedNoNeighbor=2` | 有 15 个 diff span，但 **获批 0**；失败 span 可能非孤立 `大悲`，或 support/neighbor 组合未满足 |
| d002 美食 | 可能在 base 自匹配 | 不保证获批（support / maxApprovedSpans） |

**结论：** domain fallback **对钟贝/蓝美马分是必要条件**（general 下 lexicon 无命中）；对 **大悲** 可改善 top1 从「自匹配错词」→「大杯」；**不能替代 IME diff span 生成**（d001 仍卡在 IME 层）。

---

## 六、风险审计（general 下启用 limited domain fallback）

| 风险 | 评估 | 边界建议 |
|------|------|----------|
| 跨 domain 污染（医疗↔餐饮） | 中 | 只查 `enabledDomains`（FW 配置已白名单）；fallback `maxDomains≤2`；按 `priorScore` 截断 |
| 常用句误修 | 中低 | 保持 `repairTarget=true`；`minPrior≥0.5`；KenLM `minDeltaToReplace` 不变 |
| 候选数 / 性能 | 低中 | neighbor：`topK=1` 每域 1 次 SQL；正式 recall：`perSpanLimit` 不变；总 domain 查询 ≤ `enabledDomains.length` |
| KenLM delta | 低 | 仅多候选句，门控阈值不变 |
| Tone 排序 | 低 | Tone 仍只参与 recall sort，不改变 gate |
| IME TopK | **无** | 不修改 |
| false positive span | 中 | fallback **仅 neighbor** 时风险最小；正式 recall 需更严 prior 降权 |

### 风险边界建议

| 参数 | neighbor-only（方案 1） | neighbor + recall（方案 2） |
|------|-------------------------|------------------------------|
| domain fallback topK | 每域 SQL limit **1**，合计 hit **1** 即可 | 每域 **1–2**，merge cap 不变 |
| 使用范围 | **仅** `createLexiconNearNeighborProbe` | `recallSpanTopK` 全路径 |
| domain prior 降权 | `computeDomainBoost` 在 general profile 下已为 **0** | 可显式 `FALLBACK_DOMAIN_WEIGHT=0.25` |
| repair_target | 建议 **是** | **是** |
| enabled | 建议 **是** | **是** |
| 词长 | 维持 2–5 音节（已有） | 同左 |
| pinyin_key | 维持精确 key lookup（已有） | 同左 |

---

## 七、最小调整方案

### 方案 1：仅 HintGate neighbor 使用 domain fallback（**推荐首选**）

| 项 | 说明 |
|----|------|
| 修改位置 | `resolve-pinyin-ime-v2-spans.ts` + `domain-recall-merge.ts`（新函数）+ `local-span-recall.ts`（可选 `domainIdsOverride` 参数） |
| 查询条件 | `primaryDomain ∈ {general, null, unknown}` 且 `!isIndustryRoutingEnabled()` → `domainIds = filterValidLLMDomains(enabledDomains).slice(0, K)` |
| 候选限制 | neighbor 调用 `topK=1`；每域 lookup limit **1** |
| 风险 | **低**；不增加正式 span 候选多样性 |
| 适用性 | 解决「钟贝/蓝美马分 neighbor 失败」；**不解决** d001 `diffSpanCount=0` |

### 方案 2：neighbor + 正式 Recall 都使用 domain fallback

| 项 | 说明 |
|----|------|
| 修改位置 | `local-span-recall.ts` `resolveRecallDomainIds` |
| 查询条件 | 同方案 1，但全路径生效 |
| 候选限制 | 受 `maxDomainCandidates=3` 与 `perSpanLimit` 约束 |
| 风险 | **中**；更多 domain 候选进 KenLM |
| 适用性 | restaurant 单 turn 即可 recall `中杯`；需监控 false positive |

### 方案 3：primaryDomain 未知时查全部 domain + 降权

| 项 | 说明 |
|----|------|
| 修改位置 | `resolveRecallDomainIds` + `domain-boost-calculator.ts`（新增 `fallback` weight） |
| domain prior | general profile 下对 fallback domain 给 `0.25 * DOMAIN_BASE` |
| 是否推荐 | **不推荐为首选**；复杂度高，跨域污染风险最大 |

### 替代：启用 `useIndustryRouting=true`（配置级，非代码）

- 依赖 `sessionIntent.topicKeywordPinyinKeys` 或 anchor 文本
- 冷启动无 intent 时仍可能落到 `enabled_domains` 全量 union（方案 3 类似）
- **不能**替代 profile 注入；行为与方案 3 接近，可控性弱于显式 weak fallback

---

## 八、只读验收指标

### 8.1 Profile / domain 诊断

| 指标 | 通过条件 |
|------|----------|
| `domain_hits` | `primaryDomain=general` + fallback 启用后，餐饮案 **> 0**（neighbor 探针或 recall diag） |
| `active_domain` | `!= base_only` 或新增诊断字段 `active_domain_fallback=enabled_domains_weak` |
| contract | dialog_200 **仍 200/200 PASS** |

### 8.2 重点案例（d001 / d002 / d003）

| 检查项 | 说明 |
|--------|------|
| 钟贝 / 大悲 / 美食 / 小背 / 蓝美马分 → neighbor | 对比 fallback 前后 `gateDroppedNoNeighbor` |
| 进入 span | `approvedSpanCount > 0` 或 `fw_span_count > 0` |
| 进入 Recall | `fw_candidate_count > 0` |
| apply | **不要求** immediate `apply > 0`（KenLM 仍为第二断点） |

### 8.3 性能与质量护栏

| 指标 | 阈值 |
|------|------|
| pipeline P95 | 相对 baseline **不明显退化**（建议 < +5%） |
| false positive span | `fw_span_count` 增幅 < 20%（200 案） |
| ToneModule | 仍仅 `recall-span-topk-v2` sort；不参与 HintGate |
| KenLM query | 方案 1 应 **不变**；方案 2 允许适度增加 |

### 8.4 推荐验收命令

```powershell
# baseline（general，无 migration）
node electron_node/electron-node/tests/run-dialog200-timed-batch.mjs

# 对照（restaurant profile 注入）
node electron_node/electron-node/tests/run-p4-freeze-batch.js --profile restaurant

# 方案 1 实施后：同 dialog200 脚本，检查 domain_hits / neighbor / contract
```

---

## 九、最终结论（九问）

### Q1. primaryDomain 到底由谁赋值？

**Node SessionStore 默认值**（`general`）+ **可选 CPU LLM 异步推断**（turn 结束后，下一 turn 生效）+ **session-migration 注入** + 测试 mock。批测 dialog200 **仅走默认值**。

### Q2. 当前会话冷启动是否存在 domain recall 死锁？

**是。** `general → domainIds=[]` + 专业词仅在 domain 层 + 首句 IME 可能无 span + intent-off / 单 turn → 专业词 **不可修复**。

### Q3. general profile 下完全关闭 domain 是否合理？

**对冻结语义合理，对业务冷启动不合理。** 应区分「强 domain boost」（需明确 profile）与「弱 fallback 查询」（仅扩候选池）。

### Q4. 最小应该调整哪个查询条件？

**`resolveDomainIdsForRecall` 的分流条件**（或并列的 weak-fallback 解析器），由 neighbor 路径（方案 1）优先调用。

### Q5. 应该只影响 HintGate neighbor，还是也影响正式 Recall？

**先仅 neighbor（方案 1）**；验证后再扩正式 Recall（方案 2）。

### Q6. 是否需要修改 CPU LLM 逻辑？

**非必须。** LLM 无法解决首句单 turn；可作为慢路径补充，不能替代 fallback 查询。

### Q7. 是否需要修改测试脚本以注入 profile？

**建议作为对照组，非生产修复：** `run-p4-freeze-batch.js --profile restaurant` 已证明注入有效。dialog200 保持 general 可测冷启动；另跑 restaurant 批测验证 domain 路径。

### Q8. 推荐的最小开发方案是什么？

**方案 1：** 在 `createLexiconNearNeighborProbe` 调用链上，当 `primaryDomain` 为 general/null/unknown 时，对 `enabledDomains` 做 **limited weak domain lookup**（每域 top1，不改 HintGate 门控逻辑、不改 Tone/KenLM/Apply）。

### Q9. 风险和验收指标是什么？

见 **第六节** 与 **第八节**。核心护栏：contract 200/200、P95 不明显退化、false positive span 可控、Tone 仍仅 Recall 排序。

---

## 附录 A：关键文件索引

| 文件 | 职责 |
|------|------|
| `domain-recall-merge.ts` | `general` → `[]` |
| `local-span-recall.ts` | Recall 入口 + `resolveRecallDomainIds` |
| `recall-span-topk-v2.ts` | tier lookup + `active_domain` 诊断 |
| `resolve-pinyin-ime-v2-spans.ts` | neighbor 探针 |
| `session-store.ts` / `session-finalize.ts` | profile 生命周期 |
| `active-lexicon-profile-manager.ts` | LLM 决策应用 + hysteresis |
| `industry-routing-domain-resolver.ts` | 可选四级 fallback（默认关） |
| `run-dialog200-timed-batch.mjs` | 无 profile 注入批测 |
| `run-p4-freeze-batch.js` | restaurant profile 注入批测 |

## 附录 B：与 apply=0 审计的关系

本审计解决 **「domain 未参与 recall」** 断点；apply=0 另有一断点 **KenLM `minDeltaToReplace=0.03`**（66/66 `pickedIsRaw=true`）。即使 domain fallback 成功，**仍须** KenLM 门控放行才能 apply。两断点正交，需分别验收。

---

*本报告为只读审计产出，未修改任何运行时代码。*
