# Lexicon Runtime V2 — Phase 3 开发约束文档

版本：V1.0
日期：2026-05-30

## 状态结论

Phase 0：已验收冻结

Phase 1：已验收冻结

Phase 2：已验收冻结

Phase 3：允许启动，但必须在严格约束下进行。

---

## 一、Phase 3 唯一目标

实现 V2 Runtime Recall（base_lexicon + domain_lexicon + idiom_lexicon），仅替换 Recall 数据源，不改变 FW 决策链。

## 二、允许修改范围

允许修改：local-span-recall.ts

允许新增：
- recall-span-topk-v2.ts
- runtime-v2-recall-adapter.ts
- domain-recall-merge.ts

## 三、禁止修改范围

禁止修改：
- fw-topk-decision-pipeline.ts
- suspicious-span-detector-v1.ts
- applyFwSpanReplacements.ts
- kenlm-span-gate.ts
- segmentForJobResult
- Aggregation / Dedup / Translation

禁止修改主链顺序：
ASR → FW → Aggregation → Dedup → Translation

## 四、Session Intent 使用边界

允许使用：
- primaryDomain
- secondaryDomains

仅用于 domain_lexicon 查询。

禁止：topicKeywords 直接参与候选评分。

## 五、Recall 规则

无 Session Intent：base recall only

有 primaryDomain：base + domain recall

有 secondaryDomains：base + primary + secondary domain recall

unknown_domain：回退 base recall only。

## 六、候选合并

base + domain + idiom
→ merge
→ dedupe
→ score
→ KenLM weak_veto
→ pick

禁止 domain 或 idiom 覆盖 base。

## 七、输出契约

必须保持 LocalSpanRecallHit 完全不变。

## 八、Feature Flag

新增：features.fwDetector.useLexiconRuntimeV2Recall
默认 false。

false = V1 Recall
true = V2 Recall

## 九、回滚要求

出现以下任意情况立即回滚：
- dialog_200 FAIL
- CER 劣化
- Recall P95 超标
- KenLM 行为变化
- FW apply 异常增加

回滚方式：useLexiconRuntimeV2Recall=false

## 十、验收标准

- dialog_200：200/200 PASS
- FW 劣化 case = 0
- Recall P95 不高于 Phase2 +10%
- lexicon_runtime_status=ok（200/200）
- LocalSpanRecallHit 契约一致

## 十一、完成条件

满足：
- dialog_200 PASS
- CER 不劣化
- KenLM 不变
- Feature Flag 可回滚
- Session Intent 仅用于 Domain Recall
- TopicKeywords 不参与评分

则进入 Phase 4（Industry Routing）。
