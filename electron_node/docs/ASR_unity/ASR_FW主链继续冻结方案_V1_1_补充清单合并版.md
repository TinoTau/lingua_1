# ASR→FW 主链继续冻结方案 V1.1（补充清单合并版）

本版本基于 V1 冻结方案与《补充清单（代码对照版）》合并。

## 关键修订

### 1. 冻结状态更新

SSOT 改造已完成：

- segmentForJobResult 为唯一业务文本源
- repairedText 已退出主链
- FW Detector → Aggregation → Translation 已统一

因此原文档中“当前唯一问题为 repairedText vs segmentForJobResult”调整为：

> 已于 V1.1 落地完成，本文件作为冻结验收与门禁文档。

---

## 2. Fallback 冻结规则

### Translation

优先级：

segmentForJobResult
→ asrText
→ ''

禁止：

- rawAsrText
- repairedText

manual_cut / dialog_200 验收路径：

必须命中：

source=segmentForJobResult

---

### Result Builder

优先级：

segmentForJobResult
→ asrText
→ ''

禁止：

- rawAsrText 作为 text_asr
- repairedText 作为 text_asr

extra.raw_asr_text：

始终来自 rawAsrText

---

## 3. Session 边界说明

允许存在：

RollingTurn.finalText

其语义：

segmentForJobResult ?? rawAsrText

仅用于 Session 快照。

不属于 JobContext SSOT。

允许保留：

HTTP / Intent wire 中的 repairedText 字段名

但值来自 finalText。

不得参与 NMT 输入。

---

## 4. 写锁冻结规则

isSegmentWriteLocked()

定义：

ctx.asrRepairApplied === true

FW Detector：

仅当：

decision.approved.length > 0

时置锁。

KenLM 全 veto：

不上锁。

5015：

使用 semanticRepairApplied。

5016 / 5017：

lock 时必须 skip。

---

## 5. Aggregation 冻结规则

currentSegment 优先级：

segmentForJobResult
→ rawAsrText(FW)
→ asrText

non-finalize：

- append segment
- deferTranslation=true
- 不清空 segment

finalize：

- segmentForJobResult = full turn text
- Translation 使用 full turn

---

## 6. FW 双开关约束

engine:

asr.engine=fw_detector_v1

feature:

features.fwDetector.enabled=true

冻结默认路径：

engine=true
feature=true

批测必须满足双开。

---

## 7. Dedup 冻结约束

Dedup：

只读写 segmentForJobResult

位置：

DEDUP → TRANSLATION

defer 场景：

随 post-ASR routing skip。

---

## 8. 冻结门禁补充

新增必须满足：

- getTextForTranslation 不得读取 repairedText
- buildJobResult 不得读取 repairedText
- text_asr 与 Translation Input 同源
- FW currentSegment 回退链符合文档
- Session finalText 不参与 Pipeline SSOT
- dialog_200(50) 无 source 分叉

---

## 9. 当前冻结状态

已满足：

- segmentForJobResult SSOT
- repairedText 退出主链
- freeze-contract PASS
- pipeline tests PASS
- dialog_200(50) PASS
- Recover 未回主链
- CTC/Sherpa 未进默认主链

待补：

- multi-chunk finalize E2E 集成测试
- translation_input_source 是否进入 result.extra 的决策
- 历史审计文档更新

---

## 10. 冻结结论

除 multi-chunk finalize E2E 与少量文档同步项外，

当前：

ASR
→ FW Detector
→ Aggregation
→ Dedup
→ Translation

已经满足冻结条件。

后续优化方向：

- Recall Coverage
- 行业词库
- Session Hot Cache
- Barge-in
- UI 流畅度

不再修改主链控制流。
