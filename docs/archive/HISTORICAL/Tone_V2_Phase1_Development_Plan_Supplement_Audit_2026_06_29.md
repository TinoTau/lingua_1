<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: CURRENT SSOT + Acceptance Records
Archive Path: docs/archive/HISTORICAL/Tone_V2_Phase1_Development_Plan_Supplement_Audit_2026_06_29.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: CURRENT SSOT + Acceptance Records

# Tone V2 Phase 1 开发方案 — 补充审计报告

**审计日期：** 2026-06-29  
**审计对象：** [Tone V2 Phase 1 — Contract Freeze & Loader Foundation Development Plan.md](./Tone%20V2%20Phase%201%20—%20Contract%20Freeze%20%26%20Loader%20Foundation%20Development%20Plan.md)  
**对照依据：** 实际代码、`Tone_V2_Contract_Freeze_Pre_Audit_2026_06_29.md`、`docs/tone-module/ARCHITECTURE.md`、`docs/fw-detector/assembly/FROZEN_V1_2.md`  
**模式：** 只读 — 不修改代码、不新增设计

**裁决：CONDITIONAL PASS** — 方案方向与冻结架构一致，可进入 Phase 1 开发；**必须先补齐本报告 § 一 高优先级补充项**，并执行 § 四 DELETE/MODIFY 清单，否则 Contract Freeze 文档将与代码/测试漂移。

---

## Executive Summary

| 维度 | 结论 |
|------|------|
| 方案 vs 冻结 Runtime | **一致** — 单链路 FW→Recall，无第二 Pipeline |
| 方案 vs 当前代码 | **部分一致** — P0 主链 Effective；Loader **未实现**（方案预期） |
| 方案 vs Pre-Audit | **已收敛** — 方案明确 **DELETE Assembly Tone Guard**，消除 Pre-Audit「KEEP 或 MODIFY」二义 |
| 主要缺口 | Loader 实现细节、Feature 基线数值、测试/文档漂移、orphan 代码未删 |
| Exists 但不 Effective | `applyToneAssemblyGuard`、`filter-domain-candidates-per-span`（平行实现）、`toneGuardBlockedCount` |
| 功能存在且 Effective | `run_tone_inference`→Recall penalty、fail-closed、`toneTimestampOnlyEnabled` |

---

## 一、补充项清单

| ID | 补充内容 | 来源 | 风险 | 影响范围 | 建议 |
|----|----------|------|------|----------|------|
| **S-01** | **Loader Foundation 零实现**：无 `contract.py`、Loader Interface、Metadata 结构体；`ToneClassifier._load()` 仍直连 npz | 设计缺失（Phase 1 待建）+ 代码实现 | **HIGH** | Goal B 全部 | **MODIFY** 方案 §五/§七 补充：模块路径、与 `get_tone_classifier()` 单例关系、Load/Unload 线程模型 |
| **S-02** | **Assembly Tone Guard 未删除**：`apply-tone-assembly-guard.ts` 仍存在；方案 §三/§十五 要求 DELETE | 架构漂移 + 设计已裁定 | **MEDIUM** | Assembly 文档、单测、类型 | **DELETE** guard + `ranking-repair.test.ts` GATE-RANK-04 或改为「已删除」负向测试 |
| **S-03** | **文档 SSOT 冲突**：`RANKING_V1_2.md` / `ARCHITECTURE.md` / `diagnostics/FROZEN.md` 仍写 `applyToneAssemblyGuard`；`FROZEN_V1_2.md` 与生产一致 | 架构漂移 | **MEDIUM** | FW 文档、Phase 1 验收 | **MODIFY** 文档以 `FROZEN_V1_2.md` 为 SSOT；删 toneGuard 流水线描述 |
| **S-04** | **`GATE-RANK-02` 测试漂移**：断言 `pickTopKFromBuckets`；生产 `assemble-domain-aware-span-sets.ts` 使用 `selectPerSpanCandidates` + `stableSortPicks`，**无** `pickTopKFromBuckets` | 测试发现 | **MEDIUM** | `freeze-contract.test.ts` 可信度 | **MODIFY** 测试对齐 `selectPerSpanCandidates` / `sameDomainCandidates` |
| **S-05** | **缺失类型定义**：`RankedSpanCandidateSet`、`ToneGuardBlockTrace` 被 import 但 `domain-assembly-types.ts` **未导出** | 代码实现 | **MEDIUM** | guard/filter 文件、TS 构建 | **DELETE** 引用方（随 S-02）或 **MODIFY** 补类型（若保留 guard） |
| **S-06** | **`filter-domain-candidates-per-span.ts` orphan**：生产 `runDomainAwareAssembly` 使用 `assemble-domain-aware-span-sets.ts` 内联 `filterDomainCandidatesPerSpan`；独立 filter 文件仅被 `ranking-repair.test.ts` 引用 | 代码实现 | **LOW** | Ranking 测试 | **DELETE** orphan 文件或 **MODIFY** 合并为唯一实现 |
| **S-07** | **Feature Contract 无数值 SSOT**：`mel.py` 固定 `N_MELS=80, SAMPLE_RATE=16000, N_FFT=512, HOP=160`；方案 §四/§八 仅抽象「Mel/Window/SR」，未写 Phase 1 `featureVersion` 基线 | 设计缺失 | **HIGH** | Loader Metadata、V2 模型替换 | **MODIFY** Freeze 文档写入 **P0 featureVersion=1** 及常量表 |
| **S-08** | **npz 可选键 `mel_mean`/`mel_std`**：影响特征归一化；方案未说明与 `featureVersion` 绑定规则 | 代码实现 | **MEDIUM** | Backend/Loader 验证 | **MODIFY** Metadata Contract：缺键行为 = runtime 无归一化 |
| **S-09** | **HTTP 早退无 `tone`**：音频质量/空 transcript 路径 `api_routes.py:234-241, 397-430` 返回无 `tone` 字段 | 代码实现 + 隐含前提 | **LOW** | Contract 验收、audit 统计 | **KEEP** — Freeze 文档明确「非 ASR 成功路径 optional absent」 |
| **S-10** | **dedup 边界**：Tone 在 dedup **前**推理（`api_routes.py:281-289`），返回 segments 经 dedup 后重建；Recall 消费 **pre-dedup 对齐的 processed_audio + 原始 word timestamps** | 代码实现 + 隐含前提 | **MEDIUM** | Feature/对齐语义 | **KEEP** — Contract 冻结「推理对齐 processed_audio；不得改为 dedup 后推理」 |
| **S-11** | **双层 skippedReason**：HTTP 4 枚举（Py/TS 一致）；Node `toneSkippedReason` 另含 `tone_timestamp_disabled`、`no_acoustic_slices`（`tone-recall.ts`） | 设计缺失 | **LOW** | Diagnostics Contract | **MODIFY** Freeze 区分 `HTTP skippedReason` vs `Node toneSkippedReason` |
| **S-12** | **Pydantic `skippedReason: Optional[str]`** 未收紧 Literal（`api_models.py:39`） | 代码实现 | **LOW** | HTTP Contract 验证 | **MODIFY** Phase 1 可选 Literal；不 blocking |
| **S-13** | **ASR rerun 丢弃 tone**：`task-router-asr-rerun.ts:121-129` 构建 `ASRResult` 未复制 `tone` | 代码实现 | **LOW** | 非 FW 路径 | **KEEP** `disableAsrRerun: true`（`node-config-defaults.ts:87`）；Freeze 声明 FW 生产不启用 rerun |
| **S-14** | **Semantic Acceptance 无具体测试指针**：方案 §十七 要求 disable/enable 反事实，未映射到 `span-assembly-v4-tone-score.test.ts` / config 开关 | 设计缺失 | **MEDIUM** | Phase 1 验收 | **MODIFY** 方案 §十三 增加：`toneTimestampOnlyEnabled=false` 反事实用例 |
| **S-15** | **Regression `d001 probe` 前置条件未写**：需 Electron Node + FW；非 FW 直连（`d001-timestamp-tone-probe.mjs` 历史失败） | 测试发现 | **MEDIUM** | §十二 Regression List | **MODIFY** 方案区分 **FW-only** vs **Node E2E** 回归 |
| **S-16** | **Loader Interface 缺边界**：方案 §五 列 `Load/Unload/Ready/Metadata/Backend`，未定义：失败是否抛错、是否替换进程内 singleton、Unload 后 inference 行为 | 设计缺失 | **HIGH** | Loader Foundation | **MODIFY** 补充 fail-closed 与 `get_tone_classifier()` 生命周期 |
| **S-17** | **Diagnostics 新字段未定义挂载点**：`backend/modelVersion/featureVersion/modelHash` optional — 未指定写入 `p0_diagnostics.toneModule` 还是仅 Loader 内部 | 设计缺失 | **MEDIUM** | §九 Diagnostics | **MODIFY** 明确仅 `diagnostics.toneModule` optional，不进 Recall |
| **S-18** | **迁移别名未清理**：`UtteranceTonePayload` / `UtteranceTonePayloadModel`（`tone_types.py:64`, `api_models.py:43`） | 代码实现 | **LOW** | 命名漂移 | **DELETE** Phase 1 清理别名 |
| **S-19** | **`tone_module/` 审计产物**：`_audit_*.json`、`_audit_env_probe.py`、`_validate_queue_recovery.py` 非模块 API | 代码实现 | **LOW** | 仓库卫生 | **DELETE** 或移出 `tone_module/`（非 Contract） |
| **S-20** | **`toneGuardBlockedCount`**（`types.ts:350`）无任何赋值 — 文档仍承诺 | 架构漂移 | **LOW** | Diagnostics | **DELETE** 字段或标注 deprecated；随 S-03 文档同步 |
| **S-21** | **TTS `tone-stage.ts` 命名混淆**：与声学 Tone 无关（文件头已注释）；方案未提及 | 代码实现 | **INFO** | 新人误读 | **KEEP** 注释；可选 **MODIFY** 文档「非 FW Tone」 |
| **S-22** | **音节对齐硬门控**：slice 数 ≠ 音节数 → 无 pattern → plain SQL（`tone-time-align.ts`）；方案未写 | 代码实现 | **MEDIUM** | Recall Effective 率 | **MODIFY** Freeze 附录「对齐前提」 |
| **S-23** | **Queue Recovery 与 Tone**：方案 §十一 要求 Queue Recovery 未改变；FW recovery 在 ASR 层，Tone 未单独测 recovery 后 slices | 测试发现 | **LOW** | FW ops | **KEEP** — 已 200/200 post-recovery；Regression 保留 FW readiness 测试 |
| **S-24** | **方案禁止「Model Registry 完整实现」但未定义与 Loader 边界**：Loader `Metadata()` vs Registry 关系 | 设计缺失 | **MEDIUM** | Phase 2 入口 | **MODIFY** 方案 §五 一句：Registry 属 Phase 2+ |
| **S-25** | **Acceptance「Assembly 无 Tone Decision」**：生产已满足（仅 score 间接）；需验收 **guard 已 DELETE** 而非「未接线」 | 设计缺失 + 代码 | **MEDIUM** | §十三 Acceptance | **MODIFY** 验收项：`grep applyToneAssemblyGuard` 生产 orchestrator 无引用 |

---

## 二、Exists vs Effective 专项

| 能力 | Exists | Effective | 说明 | 建议 |
|------|--------|-----------|------|------|
| `run_tone_inference` | ✅ | ✅ | ASR 200 + gates | **KEEP** |
| `UtteranceResponse.tone` | ✅ | ⚠️ | 早退路径 absent | **KEEP** + 文档 S-09 |
| `ctx.acousticToneSlices` | ✅ | ✅ | Recall 唯一输入 | **KEEP** |
| Recall tone_exact + ×0.8 | ✅ | ✅ | 反事实：关 `toneTimestampOnlyEnabled` | **KEEP** |
| Assembly per-span by score | ✅ | ⚠️ 间接 | penalty 已 baked-in | **KEEP** |
| `applyToneAssemblyGuard` | ✅ | ❌ | 第二 Decision Point（方案禁止） | **DELETE** |
| `filter-domain-candidates-per-span.ts` | ✅ | ❌ | 非 orchestrator 路径 | **DELETE** |
| `toneGuardBlockedCount` | 类型存在 | ❌ | 无写入 | **DELETE** |
| KenLM / Apply tone | ❌ | ❌ | intentional | **KEEP** |
| Loader Interface | ❌ | — | Phase 1 待建 | **MODIFY** |
| fail-closed | ✅ | ✅ | classifier + inference | **KEEP** |
| bootstrap weights | ❌ | ❌ | 已移除 | **KEEP** 禁止 RESTORE |

---

## 三、方案与代码一致性核对

### 3.1 已一致（KEEP）

| 方案条款 | 代码证据 |
|----------|----------|
| Runtime hop 不变 | `api_routes.py:281` → `asr-step.ts:262` → `fw-detector-v4-path.ts` → `recall-topk-for-windows.ts` |
| Tone = Posterior Provider | `inference.py:52-132`；无 Node Tone Step |
| KenLM/Apply 无 tone | `rerank-fw-sentences.ts`；`apply-span-replacements.ts` |
| Fail-closed | `classifier.py:51-57,79-82`；`inference.py:80-83` |
| 禁止第二条链路 | `freeze-contract.test.ts:636-664` TONE-PRE-V2-4 |
| 200/200 运行态 | `docs/tone-v2/_audit_post_recovery.json` `utteranceCount=200` |

### 3.2 方案要求但未完成（Phase 1 合法待办）

| 方案 Target | 状态 |
|-------------|------|
| Loader Foundation / Interface | **未实现** — S-01, S-16 |
| Metadata Contract 结构体 | **未实现** — S-17 |
| Contract Freeze **文档化** | 分散在 `tone-module/ARCHITECTURE.md` §11，缺独立 Freeze SSOT 文件 |
| 文档同步 | **未完成** — S-03 |

### 3.3 方案与代码冲突（须处理）

| 冲突 | 方案 | 代码 | 建议 |
|------|------|------|------|
| Assembly Tone Guard | **DELETE** §三、§十五 | 文件+单测仍在 | **DELETE** S-02 |
| Ranking 文档 | 无 guard | `RANKING_V1_2.md` 有 guard | **MODIFY** S-03 |
| Pre-Audit vs Phase 1 | Pre-Audit 曾写「KEEP 或 MODIFY guard」 | Phase 1 **DELETE** | **KEEP** Phase 1 为准 |

---

## 四、Required Repair Matrix（汇总）

| 动作 | 项 |
|------|-----|
| **KEEP** | Runtime/Data/Ownership 主链；fail-closed；Recall tone；`toneTimestampOnlyEnabled`；`disableAsrRerun`；KenLM/Apply tone-free；Queue Recovery；无 shadow/offline/bootstrap |
| **MODIFY** | 方案补充 S-01/07/08/11/14-17/22/24/25；Loader 实现；Freeze SSOT 独立文档；`freeze-contract` GATE-RANK-02；Pydantic Literal（可选）；文档 SSOT |
| **RESTORE** | **无** — 禁止恢复 shadow/offline/bootstrap |
| **DELETE** | `apply-tone-assembly-guard.ts`；orphan filter（或合并后删重复）；`UtteranceTonePayload*` 别名；toneGuard 文档承诺；`toneGuardBlockedCount`；`tone_module/_audit_*` 产物（可选） |

---

## 五、方案章节级补充建议

### §五 Loader Foundation

需补充：

- 建议路径：`tone_module/contract.py`（Metadata dataclass）、`tone_module/loader.py`（Interface）
- `Load(path) -> Metadata` 失败 → 与现 `classifier` fail-closed 同语义
- **不得**新增 HTTP/Node 字段（方案 §六 已写，需加「Loader 错误仅映射为现有 `skippedReason=model_error`」）
- Singleton：`get_tone_classifier()` 与 `Unload()` 交互（重 Load 是否允许热替换）

### §八 数据结构

需补充 **P0 Feature 基线**（来源：代码 `mel.py:7-12`）：

| 常量 | 值 |
|------|-----|
| sampleRate | 16000 |
| nMels | 80 |
| nFft | 512 |
| hopLength | 160 |
| fMin / fMax | 50 / 7600 |
| minSliceSec | 0.02 |

建议 `featureVersion: "p0-v1"` 写入 Metadata Contract（optional，不进 Decision）。

### §十三 Acceptance Criteria

需补充：

| 验收项 | 验证方式 |
|--------|----------|
| Semantic 反事实 | `toneTimestampOnlyEnabled=false` → recall 无 penalty（已有 config + 单测可扩展） |
| Guard 已删除 | orchestrator 无 `applyToneAssemblyGuard` import |
| Loader fail-closed | 扩展 `test_classifier_fail_closed` 或新 loader 单测 |
| Node E2E | `d001 probe` **条件项**：Node 已启动 |

### §十七 Semantic Acceptance

映射现有测试：

- `span-assembly-v4-tone-score.test.ts`
- `tone-match-score.test.ts`
- `freeze-contract.test.ts` TONE-PRE-V2-3

---

## 六、风险矩阵

| 等级 | 数量 | 代表项 |
|------|------|--------|
| **HIGH** | 3 | S-01 Loader 未定义、S-07 Feature 基线、S-16 Loader 生命周期 |
| **MEDIUM** | 12 | S-02~06 文档/测试/guard orphan、S-10 dedup 边界、S-14~17 验收/Metadata |
| **LOW** | 7 | S-09/12/13/18~20/23 |
| **INFO** | 1 | S-21 命名 |

---

## 七、Final Verdict

### **CONDITIONAL PASS**

**可以**按当前 Phase 1 方案进入 Contract Freeze + Loader Foundation 开发，**条件**：

1. 开发启动前将本报告 **S-01、S-07、S-16** 写入方案或独立 `TONE_V2_CONTRACT_FREEZE.md` SSOT  
2. Phase 1 首 sprint 执行 **DELETE** Assembly Tone Guard（S-02）并 **MODIFY** 文档（S-03）  
3. 修复 **GATE-RANK-02** 测试漂移（S-04），避免假绿 Regression Gate  
4. Regression List 区分 FW-only 与 Node E2E（S-15）

**不得冻结（即使 Phase 1 完成前）：**

- 未接线的 Metadata 字段为 Runtime Required  
- toneGuard 作为 Effective Decision（方案已 DELETE）  
- KenLM/Apply tone 扩展  

**Freeze 后可修改 vs 禁止：**

| 可修改 | 禁止 |
|--------|------|
| Loader/Backend 实现、npz 格式、Mel 实现（bump featureVersion）、模型权重 | Required Schema、Runtime hop、Recall SQL 语义、fail-closed、第二 Pipeline |

---

## 附录：关键代码索引

| 主题 | 路径 |
|------|------|
| Tone 推理 | `electron_node/services/faster_whisper_vad/tone_module/inference.py` |
| Fail-closed | `tone_module/classifier.py` |
| Feature | `tone_module/mel.py` |
| HTTP 挂载 | `api_routes.py:281-296` |
| Context | `pipeline/steps/asr-step.ts:262-266` |
| Recall | `span-assembly-v4/recall-topk-for-windows.ts` |
| Guard（待 DELETE） | `span-assembly-v4/apply-tone-assembly-guard.ts` |
| 生产 Assembly | `span-assembly-v4/assemble-domain-aware-span-sets.ts` |
| 冻结测试 | `fw-detector/freeze-contract.test.ts` |
| 文档 SSOT（生产） | `docs/fw-detector/assembly/FROZEN_V1_2.md` |
| 文档漂移 | `docs/fw-detector/assembly/RANKING_V1_2.md` |

---

*本报告为只读审计产物；未修改开发方案或代码。*
