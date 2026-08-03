<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: CURRENT SSOT + Acceptance Records
Archive Path: docs/archive/HISTORICAL/Tone_V2_Phase1_Supplement_Document_Audit_2026_06_29.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: CURRENT SSOT + Acceptance Records

# Tone V2 Phase 1 Supplement 文档 — 第二轮补充审计报告

**审计日期：** 2026-06-29  
**审计对象：** [Tone V2 Phase 1 Development Plan Supplement.md](./Tone%20V2%20Phase%201%20Development%20Plan%20Supplement.md)  
**对照：** 主方案、Pre-Audit、首轮 Supplement Audit、当前仓库代码  
**模式：** 只读 — 不修改代码与文档

**裁决：CONDITIONAL PASS**

Supplement 文档已吸收首轮审计 **S-01~S-25** 中绝大部分条目，可作为 Phase 1 实施 SSOT。**仍存：** ① Supplement 自身 1 处术语错误；② Phase 1 **待执行** 清理/实现与代码不一致；③ 若干 **隐含门控与边界** 尚未写入 Supplement。

---

## Executive Summary

| 维度 | 结论 |
|------|------|
| Supplement vs 冻结架构 | **一致** — 单链路、DELETE guard、Feature baseline、Loader fail-closed |
| Supplement vs 当前代码 | **方案领先代码** — guard/orphan/测试/文档 **未删未改**；Loader **未建** |
| 首轮审计项覆盖 | **~90% 已写入 Supplement** |
| 新增发现 | 7 条（术语、隐含门控、验收粒度、交付物命名） |
| 可开始 Phase 1 开发 | **是** — 以 Supplement + 本报告 §一 剩余项同步执行 |

---

## 一、Supplement 已覆盖项（核对 PASS）

以下首轮缺口 **已在 Supplement 中明确**，无需重复开项，开发时按 §22 Target List 执行即可：

| 原 ID | Supplement 章节 | 状态 |
|-------|-----------------|------|
| Loader 边界 / fail-closed / singleton | §3 | ✅ 文档 |
| Feature baseline `p0-v1` | §5 | ✅ 文档 |
| mel_mean/std 与 featureVersion | §6 | ✅ 文档 |
| HTTP vs Node skippedReason 分层 | §7 | ⚠️ §7.2 有误，见 R-01 |
| dedup 前推理 | §8 | ✅ 文档 |
| 音节对齐 / no pattern | §9 | ✅ 文档 |
| HTTP 早退无 tone | §10 | ✅ 文档 |
| ASR rerun 非 Phase 1 | §11 | ✅ 文档 |
| diagnostics.toneModule 挂载 | §12 | ✅ 文档 |
| DELETE Assembly Tone Guard | §13 | ✅ 文档；**代码未执行** |
| DELETE orphan filter | §14 | ✅ 文档；**代码未执行** |
| 别名 / 类型清理 | §15 | ✅ 文档；**代码未执行** |
| 文档 SSOT FROZEN_V1_2 | §16 | ✅ 文档；**文档未同步** |
| GATE-RANK-02/04 | §17 | ✅ 文档；**测试未修复** |
| Semantic 反事实 | §18 | ⚠️ 部分单测存在，见 R-06 |
| Regression FW vs Node E2E | §19 | ✅ 文档 |

---

## 二、剩余补充项清单

| ID | 补充内容 | 来源 | 风险 | 影响范围 | 建议 |
|----|----------|------|------|----------|------|
| **R-01** | **§7.2 术语错误**：`no_pattern` 列为 Node `toneSkippedReason`；代码中 `no_pattern` 是 **`toneReason`**（`tone-match-score.ts:9`），属于 **per-hit 诊断**，不是 utterance 级 `toneSkippedReason`（仅 `tone_timestamp_disabled` / `no_acoustic_slices`，`tone-recall.ts:15-26`） | 设计缺失（Supplement 笔误） | **MEDIUM** | Diagnostics Contract、验收混淆 | **MODIFY** Supplement §7.2：删 `no_pattern`；增「`toneReason` 属 WindowCandidate/Recall hit，非 skippedReason」 |
| **R-02** | **Phase 1 清理未执行**：`apply-tone-assembly-guard.ts`、`filter-domain-candidates-per-span.ts`、guard 单测、`UtteranceTonePayload*` 别名仍存在 | 代码 vs Supplement §13–15 | **HIGH** | Architecture Drift | **DELETE**（Phase 1 首 sprint，Supplement 已裁定） |
| **R-03** | **文档 SSOT 未同步**：`RANKING_V1_2.md`、`diagnostics/FROZEN.md`、`freeze/FROZEN.md`、`ARCHITECTURE.md:29,56,73` 仍写 Tone Guard | 架构漂移 | **MEDIUM** | 文档误导 | **MODIFY** 按 Supplement §16 |
| **R-04** | **`GATE-RANK-02` 仍断言 `pickTopKFromBuckets`**（`freeze-contract.test.ts:537`），生产无此符号 | 测试发现 | **MEDIUM** | Regression 假绿 | **MODIFY** 按 Supplement §17.1 |
| **R-05** | **`GATE-RANK-04` 仍为 guard 正向单测**（`ranking-repair.test.ts:52`），未迁入 `freeze-contract` 负向断言 | 测试发现 | **MEDIUM** | Supplement §17.2 未落地 | **MODIFY** 删正向测试 + 在 `freeze-contract.test.ts` 增「orchestrator 无 guard import」 |
| **R-06** | **Semantic 反事实缺集成级用例**：Supplement §18 要求 `toneTimestampOnlyEnabled=false` → plain SQL / no penalty；现有 **`span-assembly-v4-tone-score.test.ts` 仅测 penalty 数学**，无 config 开关集成测试 | 设计缺失 + 测试发现 | **MEDIUM** | §18 Semantic Acceptance | **MODIFY** 增 `recall-topk-for-windows` 或 orchestrator 级反事实单测 |
| **R-07** | **缺失类型仍被 import**：`RankedSpanCandidateSet`、`ToneGuardBlockTrace` 在 guard/filter 中引用，`domain-assembly-types.ts` **未定义** | 代码实现 | **MEDIUM** | TS 构建 / orphan | **DELETE** 随 R-02 一并移除 |
| **R-08** | **`toneGuardBlockedCount`**（`types.ts:350`）无赋值；Supplement §13 要求删除 | 架构漂移 | **LOW** | Diagnostics | **DELETE** |
| **R-09** | **Loader 模块未建**：无 `contract.py` / `loader.py`（Supplement §3.1 Target） | 设计预期 | **HIGH** | Phase 1 Goal B | **MODIFY** Phase 1 实现（非文档缺口） |
| **R-10** | **独立 Contract Freeze SSOT 文件未指定**：主方案隐含 `TONE_V2_CONTRACT_FREEZE.md`；Supplement 未列为交付物 | 设计缺失 | **LOW** | 文档治理 | **MODIFY** Supplement §22 增「输出 `TONE_V2_CONTRACT_FREEZE.md` 或扩写 `tone-module/ARCHITECTURE.md` §11」 |
| **R-11** | **Word timestamps 隐含前提未写**：Tone 依赖 ASR `word_timestamps=True`（`asr_worker_process.py:188`）；无 timestamps → `skippedReason=no_timestamps` | 代码实现 + 隐含前提 | **MEDIUM** | Runtime Contract | **MODIFY** Supplement §8/§9 增「ASR word_timestamps 为 Effective 前提」 |
| **R-12** | **短词过滤门控**：`MIN_SLICE_SEC=0.02`（`inference.py:17,87-90`）跳过短 word → slice 数减少，加剧 §9 音节不对齐 | 代码实现 | **MEDIUM** | Recall pattern 命中率 | **MODIFY** Feature/对齐附录记录 Expected |
| **R-13** | **Multi-batch 时间轴合并**：`asr-step.ts` 对 `acousticToneSlices` 做 `normalizeAcousticSlices` + `offsetAcousticSlices`；Supplement 未描述 batch offset 契约 | 代码实现 + 隐含前提 | **MEDIUM** | `ctx.acousticToneSlices` SSOT | **MODIFY** Runtime Contract 增「多 batch utterance 全局时间 offset 合并」 |
| **R-14** | **非 16kHz 简单 resample**：`mel.py:49-57` 在 `sample_rate≠16000` 时用线性插值；Supplement §5 冻结 16kHz 但未禁止/说明 fallback 行为 | 代码实现 | **LOW** | Feature Contract | **MODIFY** §5 增「非 16kHz 为防御路径，生产 ASR 输出 16kHz；featureVersion 不变」 |
| **R-15** | **`featureVersion` 不匹配时的 Load 行为**：Supplement §3.3 列 `feature mismatch` fail-closed，未定义 **npz 无 featureVersion 字段** 时默认 `p0-v1` 还是拒绝 | 设计缺失 | **MEDIUM** | Loader Contract | **MODIFY** §4/§6：缺失 metadata → 假定 `p0-v1` + 可选 warning diagnostics |
| **R-16** | **`loadError` 字段映射**：Supplement §12 允许 `loadError`；现 `classifier.load_error` 为内部字符串，**未**写入 HTTP `diagnostics.toneModule` | 代码实现 | **LOW** | Phase 1 diagnostics 接线 | **MODIFY** Phase 1 实现时映射；Supplement 注明源字段名 |
| **R-17** | **`v3ToneTimestampOnlyEnabled` 废弃别名**（`node-config-types.ts:210`）仍存 | 代码实现 | **LOW** | 配置漂移 | **DELETE** 或 Supplement **KEEP** 至下一大版本 |
| **R-18** | **`tone_module/` 审计产物**：`_audit_*.json`、`_audit_env_probe.py`、`_validate_queue_recovery.py` | 代码实现 | **LOW** | API 所有权 | **DELETE** 或移出模块（Supplement §24 已提） |
| **R-19** | **FW `/utterance` 503 `detail.reason`**（queue_full 等）导致 `toneReached=false` — 非 Tone Schema，但影响 Runtime 验收统计 | 测试发现 | **INFO** | audit / acceptance | **KEEP** Supplement §10 交叉引用 FW readiness；Regression 注明 |
| **R-20** | **Pydantic `skippedReason: Optional[str]`** 未 Literal 收紧（`api_models.py:39`） | 代码实现 | **LOW** | HTTP 契约验证 | **MODIFY** Phase 1 可选 |
| **R-21** | **TTS `tone-stage.ts`** 与声学 Tone 同名域 — Supplement 未提及 | 代码实现 | **INFO** | 新人误读 | **KEEP** + 可选 §1 增「非 FW acoustic tone」一句 |

---

## 三、Exists vs Effective（代码现状 vs Supplement 承诺）

| 项 | Exists | Effective | Supplement | 差距 |
|----|--------|-----------|------------|------|
| P0 Runtime 主链 | ✅ | ✅ | §2 | 无 |
| Feature baseline 文档化 | ✅ Supplement | ✅ `mel.py` | §5 | 无 |
| Loader Foundation | ❌ | — | §3 | **R-09 待实现** |
| DELETE guard | 代码在 | ❌ | §13 DELETE | **R-02 未执行** |
| Orphan filter | 代码在 | ❌ | §14 DELETE | **R-02 未执行** |
| GATE-RANK-02 对齐 | 测试在 | ❌ 假断言 | §17.1 | **R-04** |
| Semantic config 反事实 | 单元部分 | ⚠️ | §18 | **R-06** |
| 文档 SSOT | 冲突 | — | §16 | **R-03** |
| Metadata diagnostics | ❌ 未接线 | — | §12 | Phase 1 待做 |
| Recall tone | ✅ | ✅ | §2 | 无 |
| KenLM/Apply tone-free | ✅ | ✅ | §2 | 无 |

---

## 四、Supplement 与冻结设计一致性

### 4.1 一致（KEEP）

- Runtime hop、Posterior Provider 定位、单 Decision 所有权（Recall/Ranking）
- Fail-closed 语义与禁止 bootstrap/shadow/offline
- DELETE Assembly Tone Guard 裁定（与 `FROZEN_V1_2.md` 一致）
- FW 生产路径 `disableAsrRerun=true` 边界
- `_audit_post_recovery.json` 200/200 与 Supplement §19 回归目标兼容

### 4.2 Supplement 优于当前代码（Phase 1 待执行，非矛盾）

Supplement 描述 **目标态**；下列为 **已知 lag**，不构成方案错误：

```text
guard / orphan / 别名 / toneGuardBlockedCount → 待 DELETE
contract.py / loader.py → 待 MODIFY 新增
GATE-RANK-02/04 → 待 MODIFY
RANKING_V1_2 等文档 → 待 MODIFY
```

### 4.3 Supplement 需修正（MODIFY 文档本身）

- **R-01** `no_pattern` ≠ `toneSkippedReason`

---

## 五、Required Repair Matrix

| 动作 | 项 |
|------|-----|
| **KEEP** | Supplement §1–12 主体；Runtime/Data/Ownership；fail-closed；Recall/Ranking tone；KenLM/Apply tone-free；Queue recovery；§11 rerun 边界 |
| **MODIFY** | Supplement §7.2（R-01）；§22 增 Freeze SSOT 交付物（R-10）；§5/§8/§9 增 R-11~R-15；测试 R-04~R-06；Loader R-09/R-16；文档 R-03 |
| **RESTORE** | **无** |
| **DELETE** | R-02 guard/orphan/别名；R-08 toneGuardBlockedCount；R-18 审计产物；R-17 可选废弃 alias |

---

## 六、风险矩阵

| 等级 | 数量 | 代表 |
|------|------|------|
| **HIGH** | 2 | R-02 清理未执行、R-09 Loader 未建 |
| **MEDIUM** | 11 | R-01, R-03~R-07, R-11~R-13, R-15 |
| **LOW** | 6 | R-08, R-10, R-14, R-16~R-18, R-20 |
| **INFO** | 2 | R-19, R-21 |

---

## 七、与首轮 Supplement Audit 关系

| 首轮 ID | 第二轮状态 |
|---------|------------|
| S-01~S-06, S-08~S-15, S-18~S-25 | **已写入 Supplement** |
| S-07 Feature baseline | **Supplement §5** |
| S-16 Loader 生命周期 | **Supplement §3.2** |
| S-17 diagnostics 挂载 | **Supplement §12**（R-16 补 loadError 映射细节） |

首轮审计文档 [Tone_V2_Phase1_Development_Plan_Supplement_Audit_2026_06_29.md](./Tone_V2_Phase1_Development_Plan_Supplement_Audit_2026_06_29.md) 可被本报告 ** supersede ** 作为 Phase 1 实施前最新只读结论。

---

## 八、Final Verdict

### **CONDITIONAL PASS**

**Supplement 文档质量：** 可 as Phase 1 开发约束 SSOT；修正 **R-01** 后即可冻结为实施输入。

**代码与 Supplement 差距：** 属 **Phase 1 未开工** 的正常 lag；**不得**在 guard/orphan 未 DELETE、GATE-RANK-02 未修复前宣称 Phase 1 完成。

**Phase 1 开工顺序建议：**

1. **MODIFY** Supplement R-01、R-10、R-11~R-15（文档，1 次 PR）  
2. **DELETE** R-02、R-08 + **MODIFY** R-03~R-05（漂移清理）  
3. **MODIFY** R-09 Loader + R-16 diagnostics 接线  
4. **MODIFY** R-06 反事实集成测试  
5. 跑 Supplement §19 Regression → 对照 §23 Check List  

---

*本报告为只读审计；未修改 Supplement、主方案或代码。*
