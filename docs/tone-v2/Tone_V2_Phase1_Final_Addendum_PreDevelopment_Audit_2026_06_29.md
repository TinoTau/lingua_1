# Tone V2 Phase 1 Final Addendum — 开发前合规审计

**审计日期：** 2026-06-29  
**审计对象：** [Tone V2 Phase 1 Supplement — Final Contract Addendum.md](./Tone%20V2%20Phase%201%20Supplement%20%E2%80%94%20Final%20Contract%20Addendum.md)  
**上位 SSOT：** 主方案、Development Plan Supplement、Pre-Audit、Supplement Document Audit、Constitution、`docs/tone-module/ARCHITECTURE.md`  
**模式：** 只读 — 不开发、不改代码

**裁决：CONDITIONAL PASS — 修正 Addendum §1.1 后方可作为开发输入**

---

## Executive Summary

Final Addendum **正确补齐** 第二轮审计 R-01、R-10~R-15、R-06、R-19 等条目，与冻结 Runtime **方向一致**，且 **未新增 Pipeline / 第二 Decision**。

**阻塞项（1）：** §1.1 将 `tone_exact` / `tone_mismatch` 等 **与冻结代码不一致的枚举** 写成 `toneReason` 示例，与 SSOT `tone-match-score.ts`（`match|mismatch|no_pattern`）及 **`toneLookupStage`**（`tone_exact|plain_fallback|…`）**混用** — 开发若照 Addendum 字面实现将构成 **Architecture Drift**。

**Phase 1 完成门（§11）与代码现状：** Loader / Contract Freeze 文档 / Cleanup / 测试修复 **均未完成** — 属预期；开发须按 §11 逐项验收，不得跳过 Cleanup 宣称完成。

---

## 一、Addendum 条款 vs 冻结设计 / 代码

| Addendum § | 内容 | 与 SSOT 一致 | 与当前代码一致 | 备注 |
|------------|------|--------------|----------------|------|
| §1.1 skippedReason vs toneReason | 分层职责 | ⚠️ **toneReason 枚举示例错误** | ✅ 代码已分层 | 见 **B-01** |
| §2 Word Timestamp | ASR `word_timestamps=true` | ✅ | ✅ `asr_worker_process.py:188` | Effective 前提 |
| §3 Slice Acoustic Origin | dedup 前推理、声学来源 | ✅ | ✅ `api_routes.py` 顺序 | 与 Supplement §8 一致 |
| §4 Multi-Batch | normalize + offset → 全局轴 | ✅ | ✅ `asr-step.ts:262-266,179` | `segmentOffsetSec=cumulativeTimeSec` |
| §5 Feature 16kHz / p0-v1 | 防御 resample 不 bump version | ✅ | ✅ `mel.py:49-57` | 与 Supplement §5 一致 |
| §6 Metadata 缺 featureVersion → p0-v1 | + `metadataWarning` | ✅ 设计 | ❌ 未实现 | Phase 1 Loader 待做 |
| §7 loadError → diagnostics.toneModule | 不进 Decision | ✅ | ❌ 未接线 | Phase 1 待做 |
| §8 TONE_V2_CONTRACT_FREEZE.md | 唯一 Freeze SSOT | ✅ | ❌ 文件不存在 | Phase 1 交付物 |
| §9 Semantic 反事实 config | toneTimestampOnlyEnabled | ✅ | ⚠️ 仅单元测 | 见 **B-05** |
| §10 FW vs Node E2E | 分层 Regression | ✅ | ✅ 审计已区分 | d001 需 Node |
| §11 Completion Gate | Cleanup + Tests | ✅ | ❌ 多项未完成 | 开发验收清单 |
| §12 Architecture | 单链路 | ✅ | ✅ 主链 Effective | guard 待 DELETE |

---

## 二、阻塞与补充项清单

| ID | 项 | 来源 | 风险 | 影响 | Expected | Actual | 建议 |
|----|-----|------|------|------|----------|--------|------|
| **B-01** | **§1.1 toneReason 枚举与代码/ARCHITECTURE §4 冲突** | Addendum 笔误 vs 冻结 SSOT | **CRITICAL** | 开发可能改 enum / 新增 tone_mismatch | `toneReason`: `match\|mismatch\|no_pattern`；SQL 阶段用 **`toneLookupStage`**: `tone_exact\|plain_fallback\|plain_only_no_pattern` | Addendum 写 `tone_exact`、`tone_mismatch`、`tone_pattern` 为 toneReason 示例 | **MODIFY Addendum §1.1** — 不得改代码 enum |
| **B-02** | Phase 1 Cleanup 未执行 | Supplement + Addendum §11 vs 代码 | **HIGH** | 假完成 / Drift | guard/orphan/alias 已 DELETE | 仍存在 `apply-tone-assembly-guard.ts`、`filter-domain-candidates-per-span.ts`、别名 | **DELETE**（§11 硬性门） |
| **B-03** | GATE-RANK-02/04 未修复 | Addendum §11 vs 代码 | **HIGH** | Regression 假绿 | 测生产 `selectPerSpanCandidates` | 仍断言 `pickTopKFromBuckets`；GATE-RANK-04 正向 guard | **MODIFY** 测试 |
| **B-04** | Loader / contract.py 未建 | Addendum §6-7 + §11 | **HIGH** | Goal B | `contract.py` + `loader.py` | 无 | **MODIFY** Phase 1 实现 |
| **B-05** | §9 反事实缺 config 集成测 | Addendum §9 vs 测试 | **MEDIUM** | Exists≠Effective | `toneTimestampOnlyEnabled=false` → 无 penalty | 仅有 penalty 数学单测 | **MODIFY** 增 recall 级反事实 |
| **B-06** | `MIN_SLICE_SEC=0.02` 未写入 Addendum | 代码隐含 | **MEDIUM** | slice 数≠音节数 | 文档化 Expected | 仅 `inference.py:17` | **MODIFY** Addendum §3 或 Feature 附录一句 |
| **B-07** | 文档 Tone Guard 未删 | Addendum §11 vs docs | **MEDIUM** | 文档 Drift | 无 guard 描述 | `RANKING_V1_2.md` 等仍有 | **MODIFY** 文档 |
| **B-08** | `metadataWarning=featureVersion_missing` | Addendum §6 新增 | **LOW** | 新 optional diagnostics | 允许 optional | 未实现 | **KEEP** — Phase 1 实现时接入，不得 Required |
| **B-09** | `toneGuardBlockedCount` 仍在 types | Addendum §11 | **LOW** | 死字段 | 删除 | `types.ts:350` | **DELETE** |
| **B-10** | guard 引用 `pick.toneReason` 但 pick 类型无字段 | 代码 Drift | **LOW** | 即使接线也无效 | — | `apply-tone-assembly-guard.ts` vs `domain-assembly-types.ts` | **DELETE** guard（§11） |

---

## 三、Exists vs Effective（开发前基线）

| 能力 | Exists | Effective | Addendum 要求 | 开发注意 |
|------|--------|-----------|---------------|----------|
| `run_tone_inference` | ✅ | ✅ | §12 | **KEEP** 挂载点 |
| word_timestamps → slices | ✅ | ✅ | §2 | **KEEP** |
| multi-batch offset | ✅ | ✅ | §4 | **KEEP** `asr-step` 逻辑 |
| `toneReason` match/mismatch/no_pattern | ✅ | ✅ Recall 排序 | §1.1（修正后） | **禁止**改 enum |
| `toneLookupStage` tone_exact | ✅ | ✅ SQL | §1.1 应单列 | 勿并入 toneReason |
| Assembly Tone Guard | ✅ 文件 | ❌ | §11 DELETE | **不得**接线 |
| Loader metadata | ❌ | — | §6-7 | Phase 1 新建 |
| Semantic config 反事实 | 部分单测 | ⚠️ | §9 | 必须补集成测 |
| Contract Freeze 文档 | ❌ | — | §8 | 必须交付 |

---

## 四、Addendum 不得被开发曲解的冻结点

以下 **必须以代码 + `tone-module/ARCHITECTURE.md` 为准**，Addendum 修正 B-01 后与之对齐：

```typescript
// tone-match-score.ts — 冻结
type ToneReason = 'match' | 'mismatch' | 'no_pattern';

// tone-recall-sort.ts — 冻结（与 toneReason 分离）
type ToneLookupStage = 'tone_exact' | 'plain_fallback' | 'plain_only_no_pattern';
```

```python
# tone_types.py — HTTP skippedReason 四值
ToneSkippedReason = "no_audio" | "no_timestamps" | "non_zh" | "model_error"
```

**禁止**因 Addendum §1.1 示例新增：`tone_mismatch`、`tone_pattern`、`tone_exact` 作为 `toneReason`。

---

## 五、Phase 1 开发前强制核对（Frozen Architecture Verification）

开发 **第一天** 必须完成（只读核对 + 记录 Expected/Actual）：

### 5.1 历史 / 旁路 / 重复（DELETE 候选）

| 检查 | 命令/路径 | 预期 |
|------|-----------|------|
| Assembly guard 无生产引用 | `span-assembly-v4-orchestrator.ts`、`assemble-domain-aware-span-sets.ts` | 无 `applyToneAssemblyGuard` |
| 实际 | **FAIL** — 文件仍在，orchestrator 未引用但 guard 文件存在 | → **DELETE** |
| Orphan filter | 生产仅用 `assemble-domain-aware-span-sets.ts` 内联 filter | **DELETE** `filter-domain-candidates-per-span.ts` |
| 第二 Tone 链路 | `freeze-contract.test.ts` TONE-PRE-V2-4 | 无 shadow/offline |
| bootstrap | `classifier.py` | 无 bootstrap 权重 |

### 5.2 主链 Effective（KEEP）

| Hop | 验证 |
|-----|------|
| FW → HTTP tone | `audit_runtime_acceptance --part all` 或 d001 FW 探测 |
| → ctx.acousticToneSlices | 静态：`asr-step.ts` + `fw-detector-v4-path.ts` |
| → Recall penalty | `span-assembly-v4-tone-score.test.ts` + 反事实 B-05 |
| KenLM/Apply 无 tone | `freeze-contract.test.ts` TONE-PRE-V2-2 |

### 5.3 禁止项（Constitution + 主方案）

不得新增：CRNN、Registry 完整实现、Gateway Tone、**Historical Issue:** Offline/Shadow（现行不存在）、第二条 Pipeline、Assembly tone Decision、未文档化权重/门控。

---

## 六、Required Repair Matrix（Addendum + 代码）

| 动作 | 项 |
|------|-----|
| **KEEP** | Addendum §2–5、§10–12（修正 §1.1 后）；Runtime hop；fail-closed；Recall/Ranking tone；multi-batch offset；Feature p0-v1 |
| **MODIFY** | **Addendum §1.1（B-01 必做）**；Loader/contract/diagnostics（§6-7）；测试 B-03/B-05；文档 B-07；交付 `TONE_V2_CONTRACT_FREEZE.md`（§8） |
| **RESTORE** | **无** |
| **DELETE** | B-02 guard/orphan/alias；B-09 toneGuardBlockedCount；Supplement §13–15 已列项 |

---

## 七、开发报告 mandatory 字段（Constitution 合规）

每项变更须含：

```text
Expected（冻结设计/Addendum/Supplement）
Actual（代码行为）
Impact（Recall/Ranking/HTTP/Loader）
处理方式：KEEP | MODIFY | RESTORE | DELETE
Frozen Architecture Verification：主链 hop 是否不变；Tone 是否仍仅 Posterior Provider
```

**不得**因「代码已存在」保留 guard、orphan filter 或与 `tone-match-score.ts` 冲突的 enum。

---

## 八、Phase 1 §11 Completion Gate — 当前状态快照

| 门控项 | 状态（2026-06-29 代码） |
|--------|-------------------------|
| Runtime Hop / Schema 未变 | ✅ 尚未开发破坏 |
| TONE_V2_CONTRACT_FREEZE.md | ❌ |
| Loader Foundation | ❌ |
| Assembly Guard DELETE | ❌ 待删 |
| Orphan Filter DELETE | ❌ 待删 |
| GATE-RANK-02 修正 | ❌ |
| GATE-RANK-04 负向 | ❌ |
| Semantic 反事实集成 | ❌ |
| dialog_200 / FW Readiness | ✅ 已有 post-recovery 基线 |

---

## 九、Final Verdict

### **CONDITIONAL PASS**

| 问题 | 答案 |
|------|------|
| Addendum 可否作为开发输入？ | **可以**，**必须先 MODIFY §1.1（B-01）** |
| 是否允许凭空创造 Contract？ | **否** — B-01 即为反例，须对齐 ARCHITECTURE §4 |
| 开发前是否须 DELETE 漂移代码？ | **是** — §11 Cleanup 为完成门，非可选项 |
| Exists vs Effective 是否已文档化？ | **是** — Addendum §9 + 本报告 §三 |
| 开发后如何验 Frozen Architecture？ | Supplement §19 Regression + §11 全部门 + 反事实 B-05 |

**建议开发顺序：**

1. **MODIFY** Addendum §1.1（文档 PR，无代码）  
2. **DELETE** B-02/B-09 + **MODIFY** B-03/B-07（漂移清理）  
3. **MODIFY** B-04 Loader + §8 Contract Freeze 文档  
4. **MODIFY** B-05 反事实测试  
5. 全量 Regression → 开发报告逐条 Expected/Actual  

---

## 附录：SSOT 引用链

```text
Constitution
  → 主方案 Phase 1
  → Development Plan Supplement
  → Final Contract Addendum（本文件，§1.1 待修正）
  → tone-module/ARCHITECTURE.md §4 ToneScoreResult
  → freeze-contract.test.ts TONE-PRE-V2-*
```

---

*只读审计；未修改 Addendum、代码或 Constitution。*
