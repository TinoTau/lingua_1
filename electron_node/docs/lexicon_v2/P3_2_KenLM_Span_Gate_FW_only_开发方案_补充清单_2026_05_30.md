# P3.2 KenLM Span Gate（FW-only）开发方案 — 补充约束与开发清单

版本：V1.0  
日期：2026-05-30  
依据：`P3_2_KenLM_Span_Gate_FW_only_开发方案_2026_05_30.md` + 当前仓库代码对照  
类型：开发前补充（只读审计延伸，不含实现）

---

## 1. 文档目的

对照开发方案与 **实际代码 / 冻结合约 / Phase 3 批测结论**，列出：

1. 方案中 **未写清或需修正** 的实现细节  
2. 开发时必须遵守的 **硬约束**  
3. 方案 Target List **遗漏的文件与任务**  
4. 验收前的 **Check List（可勾选）**

---

## 2. 执行摘要：必须补充的 Top 10

| # | 问题 | 补充要求 |
|---|------|----------|
| 1 | §5.4 映射缺字段 | `FwSpanDiagnostics` **无 `source` 字段**；映射必须含 `domain`、`candidates: []`、`applied: false` |
| 2 | §7.2 文本来源错误 | **禁止** `ctx.segmentForJobResult` 作 gate 输入；仅用 `ctx.rawAsrText`（SSOT） |
| 3 | `fw-config.ts` 未列入改动 | 必须扩展 `loadFwDetectorRuntimeConfig()` 加载 `spanGateMode` / `kenlmSpanGate` |
| 4 | `enableKenLMGate=false` 时 gate 失效 | Gate 模式须 **独立创建 scorer**，或强制 gate 与 veto 共用 KenLM 且文档化依赖 |
| 5 | `preFilterMaxWindows` 无算法 | 必须定义粗筛规则（建议：`no_speech_prob` + stopword 后 top-N） |
| 6 | 模式名 `kenlm_gate_filter` 与实际不符 | 算法 **完全替代** detector，无 filter 步骤；命名易误导，实现按 **replace** 理解 |
| 7 | 0 span 时 orchestrator 早退未细化 | 须 **跳过** `runFwTopKDecisionPipeline`，`segmentForJobResult=rawText`，`reason=no_spans` |
| 8 | 性能字段拆分缺失 | 现有仅 `kenlmTiming`（veto）；须新增 `kenlmSpanGate` + 更新批测脚本 |
| 9 | V2 `repair_target` 问题仍在 | Span gate **不解决** Pick 门控失效；`FW apply≤20` 可能仍失败，需 P3.3 或接受调参 |
| 10 | `freeze-contract.test.ts` 静态断言 | orchestrator 须 **保留** `createSpanDetectorHint` 字符串（legacy 分支），否则冻结合约单测失败 |

---

## 3. 方案与代码差异（需修正的设计点）

### 3.1 数据结构

**方案 §5.4 `mapKenlmGateSpanToFwSpan` 不完整。**

当前 `FwSpanDiagnostics`（`fw-detector/types.ts`）必填：

```typescript
{
  text, start, end,
  domain: string,           // 方案未写 → 建议 'general'
  riskScore: number,
  signals: FwDetectorSignal[], // 需新增信号类型
  candidates: [],           // 方案未写 → 必须 []
  applied: false,           // 方案未写
  // 无 source 字段
}
```

**必须新增：**

| 项 | 位置 | 说明 |
|----|------|------|
| `FwDetectorSignal` | `types.ts` | 增加 `'kenlm_local_low_prob'` |
| `KenlmSpanGateDiagnostics` | `types.ts` 或 `kenlm-span-selector.ts` | 挂到 `FwDetectorResult` |
| `FwDetectorResult.kenlmSpanGate?` | `types.ts` | 方案 §9.1 的 job extra 来源 |

**禁止**在 span 上添加 `source: 'kenlm_span_gate'`（类型不存在）；gate 来源写入 `FwDetectorResult.kenlmSpanGate.mode` 或 `configSnapshot.spanGateMode`。

### 3.2 Orchestrator 接入（§7.2）

**当前代码**（`fw-detector-orchestrator.ts:129`）：

```typescript
const rawText = (ctx.rawAsrText ?? '').trim();
```

**方案样例错误：**

```typescript
text: ctx.rawAsrText ?? ctx.segmentForJobResult ?? ''  // ❌ 违反 SSOT
```

**补充约束：**

- Gate 输入 **仅** `rawText`（与 asr-step 写入一致）
- `segmentForJobResult` 在 FW step **输出侧**由 `applyFwSpanReplacements` 写入，不能作输入

### 3.3 配置加载链（方案遗漏）

方案只列 `node-config-types.ts` / `node-config-defaults.ts`，但运行时读取在：

| 文件 | 必须改动 |
|------|----------|
| `fw-detector/fw-config.ts` | 扩展 `FwDetectorRuntimeConfig` + `loadFwDetectorRuntimeConfig()` |
| `fw-detector/fw-detector-orchestrator.ts` | 分支 + diagnostics |
| `fw-detector/types.ts` | 信号 / 结果类型 |

`configSnapshot` 现仅含 `maxSpans/spanDetectBudget/...`（orchestrator:130-144），须追加 `spanGateMode`、`kenlmSpanGate`。

### 3.4 `failOpenToLegacyDetector` 与方案矛盾

| 来源 | 说法 |
|------|------|
| §4.1 配置 | `failOpenToLegacyDetector: false` |
| §13 风险 | KenLM 不可用 → **fail closed，不 fallback legacy** |
| §14 Cursor | 无 span 时 **不 fallback legacy detector** |

**建议：**

- 实现阶段 **删除该配置项** 或固定为 `false` 且不读取  
- 避免实现者误开 fallback 导致 span/job 回到 12

### 3.5 模式命名 vs 行为

方案标题为 `kenlm_gate_filter`，但 §3.2 / §6 算法 **不调用** `detectSuspiciousSpansV1`，实质为 **replace（only）**。

**开发约定：**

- 配置值沿用 `kenlm_gate_filter`（与方案一致）
- 实现文档/internal 注释标明：**非「detector 后再 filter」**，而是 **KenLM gate 作为唯一 span 源**
- legacy 分支仅在 `spanGateMode=legacy_detector` 时走 `detectSuspiciousSpansV1`

---

## 4. 代码边界与冻结约束

### 4.1 允许修改（方案 + 补充）

| 文件 | 说明 |
|------|------|
| **新增** `asr-repair/kenlm-span-selector.ts` | 核心 gate |
| **新增** `asr-repair/kenlm-span-selector.test.ts` | 单测 |
| `fw-detector/fw-detector-orchestrator.ts` | 接入 + 早退 |
| `fw-detector/fw-config.ts` | 配置加载 |
| `fw-detector/types.ts` | 类型扩展 |
| `node-config-types.ts` / `node-config-defaults.ts` | 默认项 |
| `fw-detector/freeze-contract.test.ts` | 允许 **追加** gate 相关断言；勿删 legacy 断言 |
| `tests/run-lexicon-v2-phase3-only-audit-batch.js` | 新 diagnostics 字段 |
| `tests/analyze-phase3-only-audit.mjs` | gate/veto 分层 |
| **可选** `scripts/fw-detector-gate.mjs` | 断言 gate 模块不被 CTC/legacy 主链 import |

### 4.2 禁止修改（方案 + 代码确认）

| 文件/模块 | 冻结依据 |
|-----------|----------|
| `asr-repair/kenlm-span-gate.ts` | 方案 §2.4；weak_veto 语义 |
| `fw-detector/fw-topk-decision-pipeline.ts` | 方案 §7.3；P1.2b 唯一决策链 |
| `fw-detector/suspicious-span-detector-v1.ts` | 方案 §14；detector 层不改动 |
| `fw-detector/apply-span-replacements.ts` | 方案 §14 |
| `pipeline/steps/*` 顺序 | ASR→FW→AGG→DEDUP→TRANS |
| `pipeline/post-asr-routing.ts` SSOT | 禁止 raw/asr fallback |
| CTC / `services/*` | 无 KenLM span selector 引用（已确认） |

### 4.3 共享模块边界

| 模块 | 说明 |
|------|------|
| `phonetic-correction/lm-scorer.ts` | Sentence KenLM 子进程；FW gate **复用** `createKenlmBatchScorer()`，**不修改** lm-scorer |
| `legacy/recover/*` | 可 import `kenlm-scorer.ts`，**不得** import `kenlm-span-selector.ts` |
| `pipeline/steps/phonetic-correction-step.ts` | 独立 HTTP 同音纠错步骤，与 FW KenLM **无关**；勿混淆 |

### 4.4 `fw-detector-gate.mjs` 冻结合约

当前强制 `node-config-defaults` 含：

```text
spanDetectBudget: 12
candidateRequireRepairTarget: true
kenlmGateMode: 'weak_veto'
```

**补充：**

- P3.2 默认 `spanGateMode=kenlm_gate_filter` **可以新增**，但 **勿删除** `spanDetectBudget: 12`（legacy 回滚路径仍依赖）
- `maxSpans: 2` 在 defaults 已存在，legacy 路径下 **仍不生效**（已知问题）；gate 的 `kenlmSpanGate.maxSpans=2` 才是 P3.2 生效点

### 4.5 `freeze-contract.test.ts` 静态检查

```typescript
expect(orchSrc).toContain('createSpanDetectorHint');
expect(orchSrc).toContain('runFwTopKDecisionPipeline');
```

**约束：** legacy 分支必须保留 `createSpanDetectorHint()` 调用；gate 分支可以不调用，但 **import/legacy 路径字符串** 须仍在 orchestrator 源文件中。

---

## 5. KenLM 实现约束（代码事实）

### 5.1 能力边界

| 能力 | 现状 | 对方案影响 |
|------|------|------------|
| 整句 score | ✅ `CharLmScorer.score()` | baseline |
| batch | ✅ `scoreBatch()` | 内部 **顺序** spawn query，非真并行 |
| 局部分数 | ❌ | 必须用 delete-span pseudo delta |
| 模型复用 | ✅ `getLmScorer()` 单例 | gate + veto 共用同一 scorer 实例 |
| 单次 query 成本 | ⚠️ 每句一次子进程 | `preFilterMaxWindows=20` → 最多 **21 query/job**（gate） |

### 5.2 Scorer 创建与 `enableKenLMGate`

当前 orchestrator（209 行）：

```typescript
const kenlmScorer = enableKenLMGate ? createKenlmBatchScorer() : null;
```

**补充约束：**

- `kenlm_gate_filter` 模式下 **即使 veto 关闭，gate 仍需 scorer**
- 推荐：`const kenlmScorer = (enableKenLMGate || isKenlmSpanGateEnabled(config)) ? createKenlmBatchScorer() : null`
- KenLM 不可用（`getLmScorer()` null）→ gate 返回 `skippedReason: 'kenlm_unavailable'`，**0 span，skip FW**（与 §13 一致）

### 5.3 两次 KenLM 与缓存（方案未写，建议 P1）

| 项 | 现状 | 建议 |
|----|------|------|
| baseline 重复计算 | veto 每个 span 的 `scoreSpanCandidateSentences` 都重算 `rawText` | P1：将 gate 的 `baselineNorm` 传入 pipeline（**不改** kenlm-span-gate.ts 则需 orchestrator 层缓存统计 only） |
| query 计数 | `summary.kenlmQueryCount` 仅 veto | 新增 `kenlmSpanGateQueryCount` + `kenlmVetoQueryCount` |

### 5.4 `minLocalDelta` 量纲

`normalizedScore = sigmoid(score/10)`，范围约 (0,1)。**0.05** 在 normalized 空间很小。

**补充：**

- 单测用 mock scorer 验证阈值逻辑
- dialog_200 调参阶段记录 delta 分布（P2）
- 删除 span 后 **标点/空格** 变化可能影响 LM：delete-span 后需 trim 或保持与 `tokenizeForLm` 一致

---

## 6. 窗口枚举与 Recall 对齐

### 6.1 枚举实现

`suspicious-span-detector-v1.ts` 已有 `enumerateCjkSpans`（CJK `\u4e00-\u9fff\u3400-\u4dbf`）。

**约束：**

- **禁止**修改 detector 文件 → 在 `kenlm-span-selector.ts` **复制同等逻辑** 或抽到 `asr-repair/cjk-window-enumerate.ts`（新 shared 模块，detector 暂不迁移）
- 方案 §8.1 `findCjkSegments` 与现有 regex **需对齐**，避免 gate 与 legacy 枚举不一致

### 6.2 Recall 音节门控

`local-span-recall.ts`：音节数 **2~5** 才 recall。

**约束：**

- `minSpanChars=2, maxSpanChars=4` 与 recall 兼容
- 若未来 `maxSpanChars=5`，仍 OK
- **1 字 span** 不应被 gate 选中（枚举已排除）

### 6.3 stopword 与 cafe case

方案 stopword 含「需要、大概、可以、一下」等，**可能误杀** cafe 场景真实错误 span 周边窗口。

**补充：**

- stopword 列表 **可配置**（方案 §13 已提）
- §13「domain anchor 豁免」：**不得**恢复全句 12 span 扫描；仅允许 **豁免 stopword 过滤**（非跳过 gate）
- golden case：`dialog_200` 中 `scenario=lexicon_homophone` / cafe 类 wav 须单列回归

### 6.4 `preFilterMaxWindows` 粗筛（方案缺失，必须定义）

建议在 `kenlm-span-selector.ts` 实现 **KenLM 调用前** 粗筛：

```text
1. enumerate → stopword filter
2. 若 ctx.asrSegments 可用：优先保留 no_speech_prob > threshold 的 window
3. 其余按 window 长度 / 位置启发式排序
4. 取 top preFilterMaxWindows（默认 20）
5. 再 scoreBatch
```

**禁止：** 用 Lexicon 命中反推 span（方案 §11 已列，此处强调）。

---

## 7. Orchestrator 行为补充（0 span / 早退）

方案 §6.5：无 span → skip FW。须明确实现：

```text
gateResult.spans.length === 0
  → 不调用 runFwTopKDecisionPipeline
  → ctx.segmentForJobResult = rawText（或跳过 apply，approved=[]）
  → summary: spanCount=0, appliedCount=0, kenlmQueryCount=0
  → reason: 'no_spans' | gate diagnostics.skippedReason
  → triggered: false
  → 仍写入 kenlmSpanGate diagnostics
  → recallV2Diagnostics：span 列表为空或 flush 0 invocations
```

**注意：** 当前 `resolveResultReason` 在 `appliedCount=0 && spans.length=0` 时返回 `'no_spans'`（orchestrator:84-85），可直接复用。

---

## 8. Lexicon V2 与 Phase 3 批测约束

### 8.1 批测配置（必须）

P3.2 验证应在 **Phase 3 Only** 环境：

```json
{
  "features": {
    "fwDetector": {
      "spanGateMode": "kenlm_gate_filter",
      "kenlmSpanGate": { "enabled": true, "maxSpans": 2 },
      "useLexiconRuntimeV2Recall": true,
      "useIndustryRouting": false
    },
    "lexiconRuntimeV2": {
      "maxBaseCandidates": 2,
      "maxDomainCandidates": 3,
      "maxIdiomCandidates": 0
    }
  }
}
```

**补充：**

- `%APPDATA%\lingua-electron-node\electron-node-config.json` 覆盖 defaults；改 defaults **不够**
- 改代码后须 **重新 build + 重启 Electron 节点**

### 8.2 仍存在的 V2 质量风险

Hotfix 已证：`repair_target=1` 在 V2 候选上 **100%**，`candidateRequireRepairTarget` 在 Pick 层 **无效**。

**约束/预期：**

- P3.2 **不负责**修复 repair_target 标注
- 若 gate 将 span 压到 2 但 homophone 仍命中，apply 可能仍 **>20**
- 验收失败时：先调 `minLocalDelta`/stopword，再考虑 P3.3 lexicon 质量；回滚时 **同时** `spanGateMode=legacy_detector` + `useLexiconRuntimeV2Recall=false`（方案 §13）

### 8.3 SQL LIMIT 保持

`lexicon-v2/recall-span-topk-v2.ts` / hotfix LIMIT **不改**；gate 减少 invocation 后 LIMIT 才有意义。

---

## 9. 诊断与批测脚本补充

### 9.1 现有批测缺口

| 脚本 | 现状 | 须补充 |
|------|------|--------|
| `run-lexicon-v2-phase3-only-audit-batch.js` | 读 `fw.kenlmTiming`（veto） | 读 `fw.kenlmSpanGate` |
| `analyze-phase3-only-audit.mjs` | `sent_to_kenlm` 来自 recall diagnostics | 增加 `span_count`、`gate_ms`、`veto_ms` |
| `contractRow` | 无 span/job 断言 | 汇总 `fw.spans.length` |

### 9.2 建议 `FwDetectorResult` 字段

```typescript
kenlmSpanGate?: KenlmSpanGateDiagnostics;
kenlmTiming?: { batchMs; queryCount };  // 现有 = veto
// configSnapshot 增加 spanGateMode
```

### 9.3 Job extra 样例（与方案 §9 对齐）

```json
{
  "fw_detector_step_ms": 850,
  "fw_detector": {
    "configSnapshot": { "spanGateMode": "kenlm_gate_filter" },
    "summary": { "spanCount": 2, "kenlmQueryCount": 6 },
    "kenlmSpanGate": {
      "enumeratedCount": 38,
      "preFilteredCount": 12,
      "scoredCount": 12,
      "selectedCount": 2,
      "kenlmSpanGateMs": 134,
      "kenlmSpanGateQueryCount": 13
    },
    "kenlmTiming": { "batchMs": 716, "queryCount": 6 }
  }
}
```

**命名约定：** JSON 用 snake_case 批测友好字段（与现有 `kenlmTiming` 混用 camelCase 需在 result-builder 层统一或脚本兼容两种）。

---

## 10. 测试清单（在方案 §10 基础上补充）

### 10.1 单元测试

- [ ] `FwDetectorSignal` 含 `kenlm_local_low_prob` 编译通过
- [ ] `mapKenlmGateSpanToFwSpan` 含 `candidates:[]`、`applied:false`、`domain`
- [ ] delete-span 后空串/纯标点 window 被跳过
- [ ] `spansOverlap` 与 `pickApprovedReplacementsGreedy` 一致（half-open）
- [ ] KenLM scorer null → `skippedReason: kenlm_unavailable`，spans=[]
- [ ] `preFilterMaxWindows` 限制 scoreBatch 输入长度 ≤ N+1
- [ ] legacy 模式回归：`spanGateMode=legacy_detector` 行为与现网一致

### 10.2 冻结合约

- [ ] `npm run test -- freeze-contract` PASS
- [ ] `node scripts/fw-detector-gate.mjs` PASS
- [ ] orchestrator 仍含 `createSpanDetectorHint` + `runFwTopKDecisionPipeline`

### 10.3 批测 / 验收

- [ ] 新建或复用 `run-lexicon-v2-phase3-p32-batch.js`（建议独立输出 JSON）
- [ ] dialog_200 200/200 PASS（`fw-detector-contract-assess`）
- [ ] span/job P50 ≤ 2，P95 ≤ 2
- [ ] recall invocations 降 ≥80%（相对 ~2300）
- [ ] FW apply ≤ 20
- [ ] fw_degraded = 0
- [ ] CER ≤ 35.93%
- [ ] cafe homophone case 仍 PASS
- [ ] CTC 路径无 `kenlm-span-selector` import（ripgrep 或 gate 脚本）

---

## 11. 完整 Target List（方案 + 补充）

### P0 核心

| ID | Target | 方案 | 补充 |
|----|--------|------|------|
| P0-1 | `kenlm-span-selector.ts` | ✅ | 含 preFilter 算法 |
| P0-2 | CJK window 枚举 | ✅ | 对齐 `CJK_RUN` regex |
| P0-3 | stopword filter | ✅ | 可配置路径 |
| P0-4 | delete-span pseudo | ✅ | NFKC 与 tokenize 一致 |
| P0-5 | scoreBatch gate | ✅ | scorer 独立于 enableKenLMGate |
| P0-6 | top-N 非重叠 | ✅ | 复用 `spansOverlap` |
| P0-7 | orchestrator 接入 | ✅ | rawText only + 早退 |
| P0-8 | pipeline 不变 | ✅ | — |
| P0-9 | diagnostics | ✅ | `FwDetectorResult.kenlmSpanGate` |
| P0-10 | feature flag | ✅ | APPDATA + defaults |
| **P0-11** | **`fw-config.ts` 扩展** | ❌ | **新增** |
| **P0-12** | **`types.ts` 信号/诊断类型** | 部分 | **新增** |
| **P0-13** | **gate 模式 scorer 创建逻辑** | ❌ | **新增** |
| **P0-14** | **0 span orchestrator 早退** | 部分 | **新增** |

### P1 测试 / 批测

| ID | Target |
|----|--------|
| P1-1 ~ P1-5 | 方案单测 |
| **P1-6** | 更新 `analyze-phase3-only-audit.mjs` gate/veto 拆分 |
| **P1-7** | 更新 batch.js 读取 `kenlmSpanGate` |
| **P1-8** | `freeze-contract.test.ts` gate 模式断言（可选） |
| P1-9 | dialog_200 全量 + 对比 Phase 2/3 Hotfix JSON |

### P2 调参

| ID | Target | 补充 |
|----|--------|------|
| P2-1 | minLocalDelta | 记录 delta 分布 |
| P2-2 | preFilterMaxWindows | 目标 gate query ≤15/job |
| P2-3 | stopword | cafe 豁免策略 |
| P2-4 | cafe case | manifest scenario 过滤 |
| P2-5 | span/job ≤2 | 批测统计 |

---

## 12. 风险补充（相对方案 §13）

| 风险 | 方案处理 | **代码审计补充** |
|------|----------|------------------|
| Gate 比 veto 更慢 | 降 preFilter | gate 21 query + veto 6 query 可能 **仍慢于** Hotfix 13 query；须监控 `fw_detector_step_ms` |
| apply 仍高 | 调 minLocalDelta | **V2 repair_target 100%** 可能主导；gate  alone 不够 |
| 漏检 ASR 错误 | 调阈值 | delete-span 对 **插入型错误**（钟**贝**）有效；**替换型**（少→贝）可能 delta 小 |
| KenLM 不可用 | skip FW | 与 veto unavailable 行为一致；`text_asr=raw` |
| 回滚 | legacy_detector | **同时**关 `useLexiconRuntimeV2Recall` 隔离变量 |
| 冻结合约破坏 | — | 勿删 `spanDetectBudget:12`；勿改 orchestrator 必含字符串 |

---

## 13. 开发前 Check List（总表）

### 架构 / 冻结

- [ ] 已阅读 `P3_2_KenLM_Span_Gate_FW_only_开发方案_2026_05_30.md`
- [ ] 已阅读 `Lexicon_Runtime_V2_P3_2_KenLM_Span_Gate_开发前只读审计报告_2026_05_30.md`
- [ ] 已阅读 `Lexicon_Runtime_V2_Phase3_Detector_Explosion_只读审计报告_2026_05_30.md`
- [ ] 不改 `kenlm-span-gate.ts` / `fw-topk-decision-pipeline.ts` / detector v1
- [ ] 不改 pipeline 步骤顺序
- [ ] Gate 仅 orchestrator import
- [ ] Gate 输入仅 `rawAsrText`

### 配置

- [ ] `fw-config.ts` 加载新配置
- [ ] defaults 保留 legacy 冻结项（`spanDetectBudget:12` 等）
- [ ] 批测 APPDATA 显式开启 V2 recall + gate
- [ ] 回滚路径文档化（legacy + 可选关 V2）

### 实现

- [ ] `FwSpanDiagnostics` 映射字段完整
- [ ] `FwDetectorSignal` 扩展
- [ ] preFilter 算法已定义
- [ ] 0 span 早退跳过 pipeline
- [ ] scorer 在 gate 模式可用
- [ ] stopword 可配置
- [ ] 非重叠选择用 `spansOverlap`

### 诊断 / 测试

- [ ] `kenlmSpanGateMs` / `kenlmVetoMs` 可分离
- [ ] 批测脚本已更新
- [ ] 单测 + freeze-contract + fw-gate PASS
- [ ] dialog_200 验收指标可量化

### 验收（方案 §12）

- [ ] 200/200 PASS
- [ ] span/job ≤ 2
- [ ] recall ↓≥80%
- [ ] FW apply ≤ 20
- [ ] fw_degrade = 0
- [ ] CER ≤ Phase 2
- [ ] KenLM 总耗时 < Phase 3 Hotfix
- [ ] CTC 无 gate import

---

## 14. 相关文档

| 文档 | 路径 |
|------|------|
| 本开发方案 | `P3_2_KenLM_Span_Gate_FW_only_开发方案_2026_05_30.md` |
| P3.2 开发前审计 | `Lexicon_Runtime_V2_P3_2_KenLM_Span_Gate_开发前只读审计报告_2026_05_30.md` |
| Detector Explosion 审计 | `Lexicon_Runtime_V2_Phase3_Detector_Explosion_只读审计报告_2026_05_30.md` |
| P3 Hotfix 验证 | `Lexicon_Runtime_V2_P3_Hotfix_验证报告_2026_05_30.md` |
| FW 冻结合约 | `docs/ASR_FW_MAIN_CHAIN_FROZEN_FINAL.md` |
| fw-gate 脚本 | `scripts/fw-detector-gate.mjs` |

---

**结论：** 开发方案方向正确，可直接进入实现；但必须按本章补充 **类型映射、rawText SSOT、fw-config 加载、scorer 依赖、preFilter 算法、早退路径、批测字段拆分、V2 repair_target 风险** 后再开工，否则易与冻结合约或 Phase 3 批测口径冲突。
