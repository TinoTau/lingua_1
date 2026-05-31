# P1~P4 冻结后精简方案

> **补充清单与约束：** [P1_P4_Freeze_Simplification_Plan_补充清单_2026_05_31.md](./P1_P4_Freeze_Simplification_Plan_补充清单_2026_05_31.md)

## 核心结论

P0 必做：
- 删除死配置
- 修正类型注释与默认值不一致
- maxSpans 收敛为 fwMetadataSpanGate.maxSpans
- 扩展 freeze-contract
- 文档化 enableKenLMGate 对 P4 为必需

P1 建议：
- rollback 配置隔离
- legacy/fw-detector 归档
- freeze-config-ssot
- 初始化写回收敛验证

P2 延后：
- Recover Context 归档
- 5015~5017 enhancement 化
- Legacy Result Extra 迁移
- Pipeline Template 解耦

## Target List

### P0
- 删除死配置
- 修正 node-config-types
- maxSpans 单一来源
- Freeze Contract 扩展
- KenLM P4 文档化

### P1
- rollback 配置隔离
- legacy/fw-detector 归档
- freeze-config-ssot
- 初始化写回收敛验证

### P2
- Recover Context 归档
- 5015~5017 enhancement 化
- Legacy Result Extra 迁移
- Pipeline Template 解耦

## Check List
- dialog_200 结果不变
- CER 不变
- apply 不变
- pipeline P95 不变
- Metadata Gate 唯一 Span 来源
- Lexicon Runtime V2 唯一 Recall
- Sentence Rerank 唯一决策链
- applyFwSpanReplacements 唯一 Apply
- segmentForJobResult 唯一 NMT 输入
