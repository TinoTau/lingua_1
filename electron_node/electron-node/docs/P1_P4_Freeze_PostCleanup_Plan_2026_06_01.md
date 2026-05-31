# P1~P4 冻结后精简收尾方案（Phase P1/P2 Cleanup Plan）

> **补充清单与约束：** [P1_P4_Freeze_PostCleanup_Plan_补充清单_2026_06_01.md](./P1_P4_Freeze_PostCleanup_Plan_补充清单_2026_06_01.md) · [Final Supplement](./P1_P4_PostCleanup_Final_Supplement_2026_06_01.md)

## 目标

P1~P4 主链已经冻结：

ASR → Metadata Gate → Lexicon Runtime V2 → Sentence Rerank → Apply → NMT

后续不再优化主链逻辑。

本阶段目标：

- 降低维护成本
- 隔离 Legacy
- 收敛配置
- 增加 Freeze Guard

---

## 建议实施项

### P1（推荐）

1. Legacy FW Detector 归档
2. JobContext Legacy 分区
3. Freeze Guard 文档
4. Result Builder 收敛
5. 测试配置统一引用 freeze-config-ssot

### P2（延后）

1. Recover Context 迁移
2. 5015~5017 enhancement 化
3. Legacy Result Extra 迁移
4. Pipeline Template 解耦

---

## 架构目标

fw-detector/

- metadata-gate
- sentence-rerank
- apply
- legacy/

JobContext:

interface JobContext {
  rawAsrText: string;
  segmentForJobResult: string;
  legacy?: LegacyContext;
}

LegacyContext:

interface LegacyContext {
  recover?: unknown;
  ctc?: unknown;
  nbest?: unknown;
  windowRecall?: unknown;
}

---

## Freeze Guard

禁止新增：

- segmentForJobResult 新写回点
- 新 Span 来源
- 新 Recall 实现
- 新 Rerank 决策链

唯一允许：

- Metadata Gate
- Lexicon Runtime V2
- Sentence Rerank
- applyFwSpanReplacements

---

## Target List

### P1

- legacy/fw-detector 归档
- JobContext Legacy 分区
- Freeze Guard 文档
- Result Builder 收敛
- 测试配置统一引用 SSOT

### P2

- Recover Context 迁移
- 5015~5017 enhancement 化
- Legacy Result Extra 迁移
- Pipeline Template 解耦

---

## Check List

### 行为

- dialog_200 结果一致
- CER 不变
- apply 数量不变
- degrade 不增加

### 性能

- pipeline P95 不变
- metadata gate P95 不变
- rerank P95 不变

### 架构

- Metadata Gate 唯一 Span 来源
- Lexicon Runtime V2 唯一 Recall
- Sentence Rerank 唯一决策链
- applyFwSpanReplacements 唯一 Apply
- segmentForJobResult 唯一 NMT 输入

### Legacy

- Legacy 不进入默认路径
- Recover 不进入 FW 主链
- CTC 不进入 FW 主链
- 5015~5017 默认关闭
