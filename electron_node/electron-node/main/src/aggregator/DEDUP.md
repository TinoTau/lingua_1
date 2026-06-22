# Duplicate Guard & Dedup — 冻结合约 V1.0

**状态：** FINAL FROZEN（2026-06-22）  
**代码根：** `electron_node/electron-node/main/src/aggregator/` · `pipeline/steps/dedup-step.ts`

---

## 1. 职责分离

| 机制 | 文件 | 职责 |
|------|------|------|
| **Duplicate Guard** | `dedup.ts` → `sanitizeSegmentForOutput` | 单段内重复片段裁剪（前缀循环等） |
| **边界 Dedup** | `dedup.ts` → `dedupMerge` / `dedupMergePrecise` | 跨 utterance 边界重叠裁剪 |
| **Job Dedup** | `agent/postprocess/dedup-stage.ts` | 同 `job_id` TTL 去重，决定是否发送 |

三者职责独立，禁止混用。

---

## 2. Pipeline 顺序（冻结）

```text
Enhancement（可选，默认 OFF）
  ↓
sanitizeSegmentForOutput          ← Duplicate Guard
  ↓
ctx.segmentForJobResult 写点
  ↓
DedupStage（job_id only）
  ↓
Translation
```

入口：`pipeline/steps/dedup-step.ts` → `runDedupStep`

DedupStage **禁止**做文本去重，仅做 job_id 级发送决策。

---

## 3. Single Ownership

| 项 | SSOT |
|----|------|
| 唯一责任函数 | `sanitizeSegmentForOutput()` |
| 唯一调用点 | `pipeline/steps/dedup-step.ts` |
| 唯一写点 | `ctx.segmentForJobResult` |

禁止第二调用点、第二写点。Aggregator 内 **不得**再调用 `detectInternalRepetition`（已迁移并删除 export）。

---

## 4. API

```typescript
type DuplicateRule =
  | 'prefix_repeat'
  | 'half_duplicate'
  | 'tail_duplicate'
  | 'partial_duplicate'
  | 'none';

interface DuplicateSanitizeTrace {
  applied: boolean;
  rule: DuplicateRule;
  repeatUnit?: string;
  repeatCount?: number;
  beforeLength: number;
  afterLength: number;
}

export function sanitizeSegmentForOutput(text: string): SanitizeSegmentResult;
```

Context 字段（仅 `runDedupStep` 写入）：

- `duplicateSanitizeApplied?: boolean`  
- `duplicateSanitizeTrace?: DuplicateSanitizeTrace`

Result 字段：`extra.duplicate_sanitize`（即使 `applied=false` 也必须输出 trace）

---

## 5. Phase 顺序（严格）

```text
Phase 1 — PrefixRepeat
  ↓
Phase 2 — Half/Tail/Partial（自 legacy detectInternalRepetition 迁移）
  ↓
Phase 3 — Trim
```

禁止调整顺序。

---

## 6. Prefix Repeat 规则

| 参数 | 值 |
|------|-----|
| `MIN_REPEAT` | 3 |
| `MIN_UNIT_LEN` | 2 |
| `MAX_UNIT_LEN` | 16 |

计长：UTF-16 code unit。枚举 `L = 2..16`，条件 `count >= 3`。

选择优先级：**count 最大 → unit 最短 → 最先发现**

### Case A — Prefix × N，无 Tail

输入：`您好,我定,` × 37 → 输出：`您好,我定,`

### Case B — Prefix × N + Tail

输入：`您好,我定,` × 3 + `订单显示已发货` → 输出：`订单显示已发货`（**禁止**保留前缀）

---

## 7. Phase 2 行为（迁移保留）

保留 50% duplicate、tail duplicate、60%–90% partial duplicate 行为，与 legacy 一致。

### 叠词策略

| 输入 | applied | 输出 |
|------|---------|------|
| `谢谢谢谢` / `好的好的` | false | 原样 |
| `谢谢谢谢谢谢`（三叠） | true | `谢谢` |

---

## 8. 禁止处理范围

本轮 **不**修改：Schema V2 · KenLM · Domain Vote · Interval Assembly · FW Span Assembly · ASR · Aggregation NEW_STREAM 回写逻辑

---

## 9. freeze-contract 断言

- `dedup-step.ts` 必须 `import sanitizeSegmentForOutput`  
- DEDUP 步在 TRANSLATION 前  
- `segmentForJobResult` 写点白名单

---

## 10. 验证

```powershell
cd electron_node/electron-node
npx jest --testPathPattern="dedup.sanitize|dedup-step|freeze-contract"
```

关键 fixture：d067（schema-v2-dialog200-summary.json，禁止人工改写）
