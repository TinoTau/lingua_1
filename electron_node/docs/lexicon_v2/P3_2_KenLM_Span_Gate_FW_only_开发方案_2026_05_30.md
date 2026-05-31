# P3.2 KenLM Span Gate 开发方案（FW-only / 不影响 CTC）

版本：V1.0  
日期：2026-05-30  
适用范围：Lingua_1 / electron-node / FW Detector 主链  
开发目标：在 FW 服务内部用 KenLM Span Gate 替代当前粗粒度 Detector span 入口，避免整句窗口枚举导致的 mass recall / mass apply。  
明确排除：CTC 服务、Recover legacy、ASR 主链、KenLM weak_veto 语义、NMT/TTS。

---

## 1. 执行摘要

当前 Phase 3 V2 Recall 失败的根因已经确认：

```text
不是 SQLite 慢
不是单 span 候选过多
不是 Industry Routing
不是 Session Intent
```

而是：

```text
当前 FW span 入口不可靠
```

目标流程：

```text
ASR raw text
→ KenLM Span Gate
→ 只输出 top 1~2 个局部不通顺 span
→ Lexicon Runtime V2 Recall
→ KenLM weak_veto
→ Apply
```

本方案要求：

```text
第一次 KenLM：找 span
第二次 KenLM：保留现有 weak_veto
```

并且：

```text
只在 FW 服务内实现
不影响 CTC 服务
不影响 legacy/recover
不改变 ASR→FW→Aggregation→Dedup→Translation 主链顺序
```

---

## 2. 设计原则

### 2.1 不做 Shadow

本轮不做 `kenlm_gate_shadow`。

原因：

```text
当前 Phase 3 性能和质量已经明显失败
继续保留 legacy detector 输出没有收益
```

直接实现：

```text
kenlm_gate_filter
```

作为 P3.2 模式。

### 2.2 不影响 CTC

禁止修改：

```text
CTC ASR
Sherpa
n-best
Recover
legacy/recover
```

新增代码仅由 FW orchestrator 调用，不得被 CTC service import。

### 2.3 不改主链

保持：

```text
ASR
→ FW_SPAN_DETECTOR
→ AGGREGATION
→ DEDUP
→ TRANSLATION
```

FW step 内部从 legacy detector spans 切换为 KenLM Span Gate spans。

### 2.4 不改 KenLM weak_veto

禁止修改：

```text
asr-repair/kenlm-span-gate.ts
scoreSpanCandidateSentences
evaluateKenlmDecision
kenlmVetoThreshold
```

KenLM Span Gate 是新增前置模块；现有 KenLM weak_veto 是后置模块。

---

## 3. 目标架构

### 3.1 当前失败路径

```text
ASR raw text
  ↓
detectSuspiciousSpansV1
  ↓
~12 spans / job
  ↓
Lexicon Runtime V2 Recall
  ↓
大量 span 命中候选
  ↓
KenLM weak_veto
  ↓
mass apply
```

### 3.2 新路径

```text
ASR raw text
  ↓
KenLM Span Gate
  ↓
top 1~2 low-probability spans
  ↓
Lexicon Runtime V2 Recall
  ↓
base/domain/idiom candidate lookup
  ↓
KenLM weak_veto
  ↓
Apply
```

### 3.3 FW 内部调用链

```text
fw-detector-step.ts
  → runFwDetectorOrchestrator()
      → createKenlmBatchScorer()
      → runKenlmSpanGate()
      → runFwTopKDecisionPipeline()
          → recallSpanTopK()
          → scoreSpanCandidateSentences()
          → pickBestCandidatePerSpan()
          → pickApprovedReplacementsGreedy()
      → applyFwSpanReplacements()
```

注意：

```text
detectSuspiciousSpansV1 不作为正式 span 来源
```

可以保留 legacy fallback，但默认不走。

---

## 4. 配置设计

### 4.1 新增配置

```ts
type FwDetectorConfig = {
  spanGateMode: 'legacy_detector' | 'kenlm_gate_filter';

  kenlmSpanGate: {
    enabled: boolean;
    maxSpans: number;
    minSpanChars: number;
    maxSpanChars: number;
    minLocalDelta: number;
    stopwordFilterEnabled: boolean;
    preFilterMaxWindows: number;
    failOpenToLegacyDetector: boolean;
  };
};
```

### 4.2 默认值

```json
{
  "features": {
    "fwDetector": {
      "spanGateMode": "kenlm_gate_filter",
      "kenlmSpanGate": {
        "enabled": true,
        "maxSpans": 2,
        "minSpanChars": 2,
        "maxSpanChars": 4,
        "minLocalDelta": 0.05,
        "stopwordFilterEnabled": true,
        "preFilterMaxWindows": 20,
        "failOpenToLegacyDetector": false
      }
    }
  }
}
```

### 4.3 回滚

如 P3.2 失败，回滚为：

```json
{
  "features": {
    "fwDetector": {
      "spanGateMode": "legacy_detector",
      "kenlmSpanGate": {
        "enabled": false
      }
    }
  }
}
```

---

## 5. 数据结构

### 5.1 KenLMSpanGateInput

```ts
export type KenLMSpanGateInput = {
  text: string;
  sourceLang: 'zh';
  maxSpans: number;
  minSpanChars: number;
  maxSpanChars: number;
  minLocalDelta: number;
  stopwordFilterEnabled: boolean;
  preFilterMaxWindows: number;
};
```

### 5.2 KenLMSpanGateSpan

```ts
export type KenLMSpanGateSpan = {
  text: string;
  start: number;
  end: number;
  score: number;
  delta: number;
  reason: 'kenlm_local_low_prob';
};
```

### 5.3 KenLMSpanGateResult

```ts
export type KenLMSpanGateResult = {
  spans: KenLMSpanGateSpan[];

  diagnostics: {
    enabled: boolean;
    mode: 'kenlm_gate_filter';
    enumeratedCount: number;
    preFilteredCount: number;
    scoredCount: number;
    selectedCount: number;
    baselineScore: number;
    baselineNorm: number;
    kenlmSpanGateMs: number;
    kenlmSpanGateQueryCount: number;
    skippedReason?: 'empty_text' | 'kenlm_unavailable' | 'no_low_prob_span';
  };
};
```

### 5.4 映射为 FwSpanDiagnostics

```ts
function mapKenlmGateSpanToFwSpan(
  span: KenLMSpanGateSpan
): FwSpanDiagnostics {
  return {
    text: span.text,
    start: span.start,
    end: span.end,
    riskScore: span.score,
    signals: ['kenlm_local_low_prob'],
    source: 'kenlm_span_gate'
  };
}
```

---

## 6. KenLM Span Gate 算法

### 6.1 推荐算法：Pseudo-candidate Delta

当前 KenLM 不提供 token-level / n-gram-level 局部分数。

因此采用：

```text
原句 score
vs
删除/替换某 span 后的 pseudo sentence score
```

来近似判断该 span 是否拉低局部通顺度。

### 6.2 算法步骤

```text
1. 输入 ASR raw text
2. 枚举 2~4 字 CJK window
3. 过滤 stopword / 纯功能词 / 重叠垃圾片段
4. 预筛最多 preFilterMaxWindows 个窗口
5. 对原句打分 baseline
6. 对每个 window 构造 pseudo sentence
7. 用 KenLM scoreBatch 打分
8. 计算 delta
9. 选择 delta 最异常的 top maxSpans
10. 输出 spans
```

### 6.3 Pseudo sentence 构造

推荐优先使用：

```text
delete-span
```

示例：

```text
原句：我要一个钟贝拿铁
span：钟贝
pseudo：我要一个拿铁
```

如果删除后句子更通顺，则说明原 span 可疑。

计算：

```ts
delta = pseudoNorm - baselineNorm;
score = delta;
```

如果：

```text
pseudoNorm - baselineNorm >= minLocalDelta
```

说明删除该 span 后句子明显更好，span 可疑。

### 6.4 Stopword 过滤

默认过滤：

```text
可以
我们
你们
他们
一下
这个
那个
什么
怎么
就是
如果
然后
但是
现在
今天
明天
昨天
需要
大概
应该
```

注意：stopword 只用于 KenLM Span Gate，不影响 Lexicon Runtime V2 / NMT / ASR。

### 6.5 Span 选择

规则：

```text
maxSpans = 2
不允许重叠
按 score 降序
同分时优先更短 span
再按 start 升序
```

如果没有 span 达到阈值：

```text
返回空 spans
FW step 不进行 Recall
直接输出原 ASR
```

---

## 7. 接口设计

### 7.1 新增文件

```text
main/src/asr-repair/kenlm-span-selector.ts
```

导出：

```ts
export async function selectKenlmSuspiciousSpans(
  scorer: KenLMScorer,
  input: KenLMSpanGateInput
): Promise<KenLMSpanGateResult>
```

### 7.2 Orchestrator 接入

文件：

```text
main/src/fw-detector/fw-detector-orchestrator.ts
```

修改点：

```ts
const scorer = createKenlmBatchScorer(...);

let spans: FwSpanDiagnostics[];

if (config.spanGateMode === 'kenlm_gate_filter' && config.kenlmSpanGate.enabled) {
  const gateResult = await selectKenlmSuspiciousSpans(scorer, {
    text: ctx.rawAsrText ?? ctx.segmentForJobResult ?? '',
    sourceLang: 'zh',
    ...config.kenlmSpanGate
  });

  spans = gateResult.spans.map(mapKenlmGateSpanToFwSpan);
  diagnostics.kenlmSpanGate = gateResult.diagnostics;
} else {
  spans = detectSuspiciousSpansV1(...);
}
```

### 7.3 Recall 输入

不改：

```ts
runFwTopKDecisionPipeline({
  spans,
  ...
})
```

保证：

```text
fw-topk-decision-pipeline.ts
```

无需修改。

---

## 8. 代码逻辑样例

### 8.1 Window 枚举

```ts
function enumerateCjkWindows(
  text: string,
  minLen: number,
  maxLen: number
): Array<{ text: string; start: number; end: number }> {
  const spans = [];

  for (const segment of findCjkSegments(text)) {
    for (let start = segment.start; start < segment.end; start++) {
      for (let len = minLen; len <= maxLen; len++) {
        const end = start + len;
        if (end <= segment.end) {
          spans.push({
            text: text.slice(start, end),
            start,
            end
          });
        }
      }
    }
  }

  return spans;
}
```

### 8.2 Pseudo Sentence

```ts
function deleteSpan(text: string, span: { start: number; end: number }): string {
  return text.slice(0, span.start) + text.slice(span.end);
}
```

### 8.3 Gate 评分

```ts
async function scoreKenlmGateWindows(
  scorer: KenLMScorer,
  text: string,
  windows: TextWindow[]
): Promise<KenLMSpanGateResult> {
  const variants = windows.map(w => deleteSpan(text, w));
  const result = await scorer.scoreBatch([text, ...variants]);

  const baseline = result.scores[0];

  const scored = windows.map((w, idx) => {
    const variantScore = result.scores[idx + 1];
    const delta = variantScore.normalizedScore - baseline.normalizedScore;

    return {
      ...w,
      delta,
      score: delta,
      reason: 'kenlm_local_low_prob' as const
    };
  });

  return selectTopNonOverlapping(scored);
}
```

### 8.4 选 Top N

```ts
function selectTopNonOverlapping(
  spans: KenLMSpanGateSpan[],
  maxSpans: number,
  minLocalDelta: number
): KenLMSpanGateSpan[] {
  const eligible = spans
    .filter(s => s.delta >= minLocalDelta)
    .sort((a, b) => b.score - a.score || (a.end - a.start) - (b.end - b.start) || a.start - b.start);

  const selected: KenLMSpanGateSpan[] = [];

  for (const span of eligible) {
    if (selected.length >= maxSpans) break;
    if (selected.some(s => spansOverlap(s, span))) continue;
    selected.push(span);
  }

  return selected;
}
```

---

## 9. 诊断输出

### 9.1 Job extra

```json
{
  "fw_detector": {
    "span_gate_mode": "kenlm_gate_filter",
    "kenlm_span_gate": {
      "enabled": true,
      "enumeratedCount": 38,
      "preFilteredCount": 12,
      "scoredCount": 12,
      "selectedCount": 2,
      "baselineNorm": 0.42,
      "kenlmSpanGateMs": 134,
      "kenlmSpanGateQueryCount": 13
    }
  }
}
```

### 9.2 性能字段

必须拆分：

```text
kenlm_span_gate_ms
kenlm_veto_ms
fw_detector_total_ms
recall_invocation_count
span_count
```

---

## 10. Target List

### P0：核心开发

| ID | Target |
|----|--------|
| P0-1 | 新增 `kenlm-span-selector.ts` |
| P0-2 | 实现 2~4 字 CJK window 枚举 |
| P0-3 | 实现 stopword filter |
| P0-4 | 实现 pseudo sentence 生成 |
| P0-5 | 实现 KenLM scoreBatch gate |
| P0-6 | 实现 top maxSpans 非重叠选择 |
| P0-7 | Orchestrator 接入 `kenlm_gate_filter` |
| P0-8 | 保持 `fw-topk-decision-pipeline.ts` 不变 |
| P0-9 | 输出 diagnostics |
| P0-10 | Feature flag 回滚 |

### P1：测试

| ID | Target |
|----|--------|
| P1-1 | 单元测试：window 枚举 |
| P1-2 | 单元测试：maxSpans=2 生效 |
| P1-3 | 单元测试：stopword 不进入 span |
| P1-4 | 单元测试：低概率 span 被选中 |
| P1-5 | 单元测试：无低概率 span skip FW |
| P1-6 | 批测 dialog_200 |
| P1-7 | 输出 CER / apply / degrade |
| P1-8 | 输出 gate/veto 性能拆分 |

### P2：调参

| ID | Target |
|----|--------|
| P2-1 | 调整 `minLocalDelta` |
| P2-2 | 调整 `preFilterMaxWindows` |
| P2-3 | 调整 stopword blacklist |
| P2-4 | 验证 cafe homophone case |
| P2-5 | 验证 span/job ≤ 2 |

---

## 11. Check List

### 架构

- [ ] 不修改 CTC 服务
- [ ] 不修改 Recover
- [ ] 不修改 ASR→FW→Aggregation→Dedup→Translation 顺序
- [ ] 不修改 KenLM weak_veto
- [ ] 不修改 `fw-topk-decision-pipeline.ts`
- [ ] 不修改 `segmentForJobResult`
- [ ] KenLM Span Gate 只在 FW orchestrator 内生效

### 功能

- [ ] `spanGateMode=kenlm_gate_filter`
- [ ] `maxSpans=2` 真实生效
- [ ] 没有 suspicious span 时 skip FW
- [ ] 只对 KenLM Gate span 进行 Lexicon Recall
- [ ] Lexicon Runtime V2 不反推 span
- [ ] topicKeywords 不参与 span 选择
- [ ] CTC 路径不 import KenLM Span Gate

### 性能

- [ ] `span/job ≤ 2`
- [ ] `recall invocation` 降低 80%+
- [ ] `kenlm_veto_ms` 明显下降
- [ ] `fw_detector P95` 低于 Phase 3 Hotfix
- [ ] `pipeline P95` 低于 Phase 3 Hotfix

### 质量

- [ ] dialog_200 200/200 PASS
- [ ] FW apply ≤ 20
- [ ] FW degrade = 0
- [ ] final CER ≤ Phase 2
- [ ] cafe 中杯类 case 仍可修复
- [ ] 普通功能词不再 mass apply

---

## 12. 验收标准

必须全部满足：

```text
dialog_200 = 200/200 PASS
span/job ≤ 2
recall invocation 降低 ≥80%
FW apply ≤ 20
FW degrade = 0
final CER ≤ Phase2 baseline
KenLM 总耗时 < Phase3 Hotfix
CTC tests PASS / CTC 路径无引用
```

---

## 13. 风险与处理

| 风险 | 处理 |
|------|------|
| KenLM Gate 误漏真实 span | 调低 minLocalDelta / 增加 maxSpans 到 3 临时验证 |
| KenLM Gate 仍太慢 | 降 preFilterMaxWindows / 增加粗筛 |
| stopword 误杀 | stopword 可配置 |
| cafe case 失效 | 增加 domain anchor 豁免，但不得恢复全句扫描 |
| KenLM 不可用 | fail closed：skip FW，不 fallback 到 legacy detector |
| 质量仍劣化 | 回滚 `spanGateMode=legacy_detector`，同时关闭 V2 recall |

---

## 14. Cursor 开发提示词

```text
请基于当前仓库开发 P3.2 KenLM Span Gate。

目标：
在 FW 服务内部用 KenLM Span Gate 替代 legacy detector span 入口。
不要做 shadow。
不要影响 CTC 服务。
不要修改 ASR→FW→Aggregation→Dedup→Translation 主链顺序。

核心流程：
ASR raw text
→ KenLM Span Gate
→ top 1~2 suspicious spans
→ Lexicon Runtime V2 Recall
→ KenLM weak_veto
→ Apply

允许新增：
- main/src/asr-repair/kenlm-span-selector.ts
- FW diagnostics 类型
- 配置项 spanGateMode / kenlmSpanGate
- 单元测试和批测分析字段

允许修改：
- fw-detector-orchestrator.ts
- node-config-types.ts
- node-config-defaults.ts
- 测试脚本 diagnostics 输出

禁止修改：
- CTC 服务
- legacy/recover
- fw-topk-decision-pipeline.ts
- kenlm-span-gate.ts
- suspicious-span-detector-v1.ts
- applyFwSpanReplacements
- segmentForJobResult
- Aggregation / Dedup / Translation

具体要求：
1. 新增 spanGateMode='kenlm_gate_filter'。
2. 默认启用 kenlmSpanGate.enabled=true。
3. maxSpans 默认 2。
4. 枚举中文 2~4 字窗口。
5. 使用 delete-span pseudo candidate。
6. 用 KenLM scoreBatch 计算 baseline 与 pseudo 句 delta。
7. 选择 top 2 non-overlapping spans。
8. stopword 不进入 span。
9. 无 span 时 skip FW，不 fallback legacy detector。
10. runFwTopKDecisionPipeline 只接收 KenLM Gate spans。
11. 现有 KenLM weak_veto 保持不变。
12. 输出 kenlm_span_gate_ms / kenlm_veto_ms / span_count / recall_invocation_count。
13. CTC 路径不得 import kenlm-span-selector。

验收：
- dialog_200 200/200 PASS
- span/job ≤ 2
- recall invocation 降低 ≥80%
- FW apply ≤ 20
- FW degrade = 0
- CER ≤ Phase2 baseline
- CTC tests PASS
```

---

## 15. 最终结论

本方案不是优化词库，也不是优化 SQLite。

它是修正 FW 的 span 入口：

```text
从：文本窗口枚举
改为：KenLM 局部低概率 span gate
```

从架构上恢复：

```text
先找可靠 span
再查词库候选
最后 KenLM veto
```
