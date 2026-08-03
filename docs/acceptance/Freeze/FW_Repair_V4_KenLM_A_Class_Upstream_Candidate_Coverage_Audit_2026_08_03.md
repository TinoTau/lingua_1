# FW Repair V4 — KenLM A-Class Upstream Candidate Coverage Audit

| Field | Value |
|-------|-------|
| Date | 2026-08-03 |
| Nature | **READ ONLY** · Upstream Candidate Coverage · A-Class Root Cause |
| Freeze Baseline | **FW_V4_FREEZE_2026_08_03** |
| Code / Model / Threshold / Lexicon / Caps | **UNCHANGED** |
| Probe | `docs/tone-v2/_audit_scratch/kenlm-a-class-upstream-coverage-probe.mjs` |
| Artifacts | [`kenlm_a_class_upstream_2026_08_03/`](./kenlm_a_class_upstream_2026_08_03/) |
| Verdict | **UPSTREAM_FIX_REQUIRED** |

---

## 1. Executive Conclusion

7 个真实噪声案例全部为 A 类：正确句从未进入 KenLM Batch（B=0, C=0, PASS=0）。

观测路径与 KenLM Capability Baseline 一致（无 ASR 声学 Tone payload）。在 **Batch 1.1C Mandatory Tone Recall（Fail Closed，无 Plain Fallback）** 下：

```text
observed Exact Recall candidates = 0 / 7 cases
observed LexicalEdge = 0
KenLM input = Raw-only（每案 candidateCount=1，异文=0）
```

FIRST_MISSING_STAGE 分布：

| FIRST_MISSING_STAGE | N | Cases |
|---------------------|--:|-------|
| SQLITE | 3 | snack-01, trigger-01, threshold-01 |
| EXACT_RECALL | 4 | nn-train-01, nn-train-01b, center-01, sync-01 |

Primary Root Cause 分布：

| Primary | N | 含义 |
|---------|--:|------|
| LEXICON_TERM_MISSING | 3 | 小食 / 触发 / 阈值 正式词不存在 |
| LEXICON_KEY_ERROR | 1 | 「我们」tone_pinyin_key=wo3\|men0（tone0 无法被声学 pattern 生成） |
| RECALL_QUERY_MISS | 3 | 噪声窗拼音无法命中正确词，或 Tone Gate 使 Exact 全空 |

**结论：正确候选主要在 KenLM 之前丢失。当前不能优化 KenLM。**

---

## 2. Freeze Baseline

```text
FW_V4_FREEZE_2026_08_03

ASR Raw → FineSpan/Lattice → Exact Recall → Domain Vote
→ SameDomain Bucket → Assembly → CrossPath → KenLM(Score/Rank/Pick)
```

本轮未修改：FineSpan/Lattice、Exact Recall、Domain Presence Vote、SameDomain Bucket、Assembly、CrossPath、Atomicity、Tone Contract、KenLM Runtime Boundary、任何 cap/threshold/TopK、词库/标签/Source/SQLite。

冻结参数（观测）：

| Param | Value |
|-------|-------|
| exactTopK | 2 |
| windowMin/MaxSyllables | 2 / 5 |
| maxSentenceCandidates | 16 |
| toneTimestampOnlyEnabled | true |
| Tone Recall | Mandatory Tone-first；`plainFallbackHitCount` 恒为 0 |

---

## 3. Input Case Verification

来源：`kenlm_validation_case_inventory_resolved.csv` + baseline `kenlm_capability_case_summary.csv`（noise_inventory）。未替换测试文本。

| caseId | noise → correct | raw / expected（摘要） | ABC |
|--------|-----------------|------------------------|-----|
| nn-train-01 | 我闷蒸在 → 我们正在 | …闷蒸在升级… / …我们正在升级… | A |
| nn-train-01b | 闷蒸 → 正在 | …闷蒸在训练… / …正在训练… | A |
| center-01 | 忠心 → 中心 | …注册忠心… / …注册中心… | A |
| snack-01 | 消失 → 小食 | …饮料和消失 / …饮料和小食 | A |
| sync-01 | 已精通步 → 已经同步 | …已精通步给… / …已经同步给… | A |
| trigger-01 | 出发 → 触发 | …会出发熔断… / …会触发熔断… | A |
| threshold-01 | 阈之一 → 阈值 | …阈之一按… / …阈值已按… | A |

---

## 4. Stage Funnel Method

逐案检查：

```text
Formal Source → SQLite → Exact Recall → WindowCandidate
→ LexicalEdge → SegmentationPath → Domain/Budget
→ Assembly → CrossPath → KenLM Input
```

Ground truth **仅**用于离线归因；未注入 Recall / Assembly / KenLM。

另做 **with-tone counterfactual**（仅审计）：对噪声相关 Window 用声学 Tone pattern 调用同一 `recallSpanTopKV2`，区分「词不存在 / 键错误 / Tone Gate / 拼音窗不匹配」。

---

## 5. Lexicon Presence

合法原子路径依据冻结 Atomicity（禁止为迎合 Case 新增整词复合）。

| surface | formalTermExists | pinyinKey | tonePinyinKey | domains | source | projection |
|---------|------------------|-----------|---------------|---------|--------|------------|
| 我们 | Y | wo\|men | **wo3\|men0** | (base) | industry_pack_v2 | base |
| 正在 | Y | zheng\|zai | zheng4\|zai4 | (base) | industry_pack_v2 | base |
| 中心 | Y | zhong\|xin | zhong1\|xin1 | (base) | industry_pack_v2 | base |
| 已经 | Y | yi\|jing | yi3\|jing1 | (base) | industry_pack_v2 | base |
| 同步 | Y | tong\|bu | tong2\|bu4 | (base) | industry_pack_v2 | base |
| **小食** | **N** | — | — | — | — | missing |
| **触发** | **N** | — | — | — | — | missing |
| **阈值** | **N** | — | — | — | — | missing |
| 我们正在 / 已经同步 | N（预期） | — | — | — | — | 复合禁止新增 |

噪声词存在：忠心、消失、出发、闷蒸（coffee domain）。

---

## 6. Pinyin / Tone Query

### 6.1 观测路径（无声学 Tone）

`resolveToneRecallReadiness` → `caller_disabled` / `no_pattern` → Exact Recall **空集**。  
分类：**PLAIN_FALLBACK_NOT_REACHED**（1.1C 已删除 Plain 回填）。

### 6.2 原子自检（with-tone，离线）

| surface | 结果 | 分类 |
|---------|------|------|
| 正在 / 中心 / 已经 / 同步 | rank=1 可命中 | HIT |
| 我们 | tone0 → acoustic key 无法构建；wo3\|men1..5 均不匹配 DB wo3\|men0 | **TONE_KEY_MISMATCH** |
| 小食 / 触发 / 阈值 | 无 term | **TERM_MISSING** |

### 6.3 同音竞争（center-01）

`zhong1|xin1` → offline hits：`中心`, `忠心`（exactTopK=2 可同时保留）。观测路径因 Tone Gate 两者皆未进入生产 Recall。

---

## 7. FineSpan / Window Coverage

噪声区均有相关 Window（relatedWindowCount 10–30）。分类：

| Case | windowClass | 说明 |
|------|-------------|------|
| nn-train-01 / sync-01 | MULTI_WINDOW_COMPOSITION_REQUIRED | 需相邻原子窗组合 |
| nn-train-01b | WINDOW_EXISTS | 噪声窗 `men\|zheng` 存在，但目标拼音为 `zheng\|zai` |
| center/snack/trigger/threshold | WINDOW_EXISTS | 长度匹配窗存在；缺词或缺 Tone 命中 |

未恢复 LTR / Beam / Parent Fragment。

---

## 8. Recall Candidate Results

**观测：7/7 案 observedCandidateCount=0，expected 未生成（非 TopK 删除）。**

with-tone 反证（摘要）：

| Case | 噪声相关窗命中（CF） | 正确原子是否出现 |
|------|----------------------|------------------|
| center-01 | `zhong\|xin` → 忠心, **中心** | 是 |
| sync-01 | `yi\|jing` → **已经** | 是（部分） |
| nn-train-01b | `men\|zheng` → 闷蒸；`zheng\|zai`→正在（邻窗，非噪声替换跨度） | 噪声窗否 |
| trigger-01 | `chu\|fa` → 出发 only | 触发无 |
| snack/threshold | 无正确 surface | 词缺失 |

**Query Miss vs TopK Drop：观测阶段为 Query/Gate Miss，不是 TopK Drop。**

---

## 9–14. Edge / Path / Domain / Budget / Assembly / CrossPath / KenLM

因 Exact Recall 空：

| Stage | 观测结果 |
|-------|----------|
| LexicalEdge | 0 edges carrying expected |
| SegmentationPath | 无 expected atom edge；仅 fallback 覆盖 |
| Domain / Bucket / Budget | 无 expected 候选可投票/入桶 |
| Assembly | 无正确/部分正确异文句 |
| CrossPath | 每案 1 条，文本=Raw |
| KenLM Batch | `kenlmInputTexts=[raw]`；`correctTextPresent=false`；**非** KENLM_INPUT_BINDING_BUG |

---

## 15. KenLM Input Reconciliation

| caseId | candidateCount | kenlmInputTexts | correctTextPresent |
|--------|---------------:|-----------------|--------------------|
| 全部 7 | 1 | Raw only | false |

Raw Candidate ≡ CrossPath ≡ KenLM Batch（退化为 Raw 自复制）。上游丢失，非 KenLM binding bug。

---

## 16. Case-by-Case Traces

### nn-train-01（我闷蒸在 → 我们正在）

- 原子：我们 + 正在（禁止整词「我们正在」）
- SQLITE：两原子均存在
- **我们 tone_pinyin_key=wo3|men0** → 声学无法生成 tone0 → Tone Exact 永不命中；无 Plain Fallback
- Window：需 `wo|men` + `zheng|zai` 多窗组合
- FIRST_MISSING：**EXACT_RECALL**
- Primary：**LEXICON_KEY_ERROR**
- Secondary：PLAIN_FALLBACK_NOT_REACHED；后续即便键修复仍需 ASSEMBLY 组合

### nn-train-01b（闷蒸 → 正在）

- 正在存在且自检 HIT
- 噪声窗拼音 `men|zheng` ≠ `zheng|zai`；CF 在噪声窗只召回「闷蒸」
- FIRST_MISSING：**EXACT_RECALL**
- Primary：**RECALL_QUERY_MISS**

### center-01（忠心 → 中心）

- 中心/忠心同键同调；CF 下二者均入 Top2
- 观测无 Tone → Recall 空
- FIRST_MISSING：**EXACT_RECALL**
- Primary：**RECALL_QUERY_MISS**（PLAIN_FALLBACK_NOT_REACHED）
- Secondary：Tone 可用后 Recall 可过；需再验 Edge/Assembly（本轮观测未到达）

### snack-01（消失 → 小食）

- **小食** term/base 均不存在
- FIRST_MISSING：**SQLITE**
- Primary：**LEXICON_TERM_MISSING**

### sync-01（已精通步 → 已经同步）

- 原子 已经+同步存在；整词「已经同步」不存在（合法）
- 观测 Tone Gate → Recall 空
- CF：噪声对齐窗可召回「已经」等原子线索
- FIRST_MISSING：**EXACT_RECALL**
- Primary：**RECALL_QUERY_MISS**
- Secondary：COUNTERFACTUAL_NEXT → ASSEMBLY_COMPOSITION_MISS

### trigger-01（出发 → 触发）

- **触发** 不存在；出发存在并会占用 `chu|fa`
- FIRST_MISSING：**SQLITE**
- Primary：**LEXICON_TERM_MISSING**

### threshold-01（阈之一 → 阈值）

- **阈值** 不存在；expected 全文为「阈值已…」（长度对齐），仍不得新增非法复合
- FIRST_MISSING：**SQLITE**
- Primary：**LEXICON_TERM_MISSING**

---

## 17. Primary Root Cause Distribution

```text
LEXICON_TERM_MISSING   3
RECALL_QUERY_MISS      3
LEXICON_KEY_ERROR      1
```

无：RECALL_TOPK_DROP / BUDGET_DROP / CROSSPATH_CAP_DROP / KENLM_INPUT_BINDING_BUG。

---

## 18. Data vs Capacity vs Runtime Classification

| 类型 | Cases | 说明 |
|------|-------|------|
| **数据能力** | 7/7 | 缺词（3）、tone0 键错误（1）、拼音窗不匹配/Tone Gate 无 Plain（3） |
| 参数容量 | 0 | 未观察到正确候选被 TopK/Budget/Path cap 截断 |
| Runtime 实现 | 0 | 无「候选已在 CrossPath 但 KenLM 丢失」 |
| 合法架构限制 | 次级 | 多原子组合（我们正在 / 已经同步）需 Assembly 多窗共存；本轮未到达 |

不得解释为「需要重设计冻结主链」。

---

## 19. Overfit Safety Check

生产静态扫描（fw-detector / lexicon-v2，排除 test）：

| Hit | 判定 |
|-----|------|
| `v4-diagnostics-config.ts` 含 `caseId ===` | 仅 diagnostics targetId 匹配，**非** expected 注入 |

未发现：按 caseId 改候选、expectedText 注入 Recall、专属词条白名单。

本轮审计未修改任何生产代码/词库。

---

## 20. Recommended Next Phase

```text
UPSTREAM_FIX_REQUIRED
```

唯一下一阶段：**上游数据/召回可达性修复**（按 FIRST_MISSING_STAGE），不是 KenLM 模型优化。

建议顺序（实施属后续轮次，本轮不改）：

1. 补齐正式原子：小食、触发、阈值（符合 Atomicity）
2. 修复「我们」tone 键（消除 tone0 / 与声学可生成键对齐）
3. 评估无 Tone payload 时的观测合同：当前 Fail-Closed 使文本-only 审计路径 Exact 全空（合同已冻结，是否放宽属独立变更，本轮禁止）
4. 再复测 center/sync 的 Edge→Assembly 多窗组合

---

## 21. Target List

| ID | Status |
|----|--------|
| T1 精确读取 7 个 A 类案例 | DONE |
| T2 正式 Source 对账 | DONE |
| T3 SQLite 对账 | DONE |
| T4 pinyin/tone key 对账 | DONE |
| T5 Window 覆盖 | DONE |
| T6 相关 Window Recall 全量导出 | DONE |
| T7 Query Miss vs TopK Drop | DONE（观测=Miss/Gate，非 TopK） |
| T8→T14 Edge/Path/Domain/Budget/Assembly/CrossPath/KenLM | DONE（上游空导致后续全空） |
| T15 FIRST_MISSING_STAGE 7/7 | DONE |
| T16 Primary 唯一 | DONE |
| T17 数据/容量/实现/架构分类 | DONE |
| T18–T21 不改 Framework/词库/注入/KenLM | DONE |
| T22 下一阶段仍非 KenLM 优化 | DONE |

---

## 22. Check List

```text
[x] Baseline = FW_V4_FREEZE_2026_08_03
[x] 未修改代码
[x] 未修改 Source
[x] 未修改 SQLite
[x] 未修改词库
[x] 未修改 Domain Tags
[x] 未修改 Tone
[x] 未修改任何 cap
[x] 未修改 KenLM
[x] 已追踪 7/7 Case
[x] 已定位 7/7 FIRST_MISSING_STAGE
[x] 已生成五份 CSV
[x] 已完成生产过拟合静态检查
[x] 已给出唯一下一阶段
```

---

## 23. Final Verdict

```text
UPSTREAM_FIX_REQUIRED

7 个真实噪声案例中的正确候选
主要在 KenLM 输入之前丢失。

当前不能优化 KenLM。

必须依据 FIRST_MISSING_STAGE，
仅修复已定位的数据、容量或实现问题，
不得重新设计冻结 Framework。
```

### 产物清单

| File | Location |
|------|----------|
| `kenlm_a_class_stage_funnel.csv` | `docs/acceptance/Freeze/kenlm_a_class_upstream_2026_08_03/` |
| `kenlm_a_class_recall_candidates.csv` | 同上 |
| `kenlm_a_class_path_trace.csv` | 同上 |
| `kenlm_a_class_assembly_trace.csv` | 同上 |
| `kenlm_a_class_root_causes.csv` | 同上 |
| `case_traces.json` | 同上（完整逐案 JSON） |
| 副本 | `docs/tone-v2/_audit_scratch/kenlm_a_class_upstream_2026_08_03/` |
