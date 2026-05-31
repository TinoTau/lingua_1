# P3.3 FW Apply 质量退化只读审计报告

**审计类型**：只读（未修改任何生产代码）  
**审计日期**：2026-05-31  
**前置条件**：P3.3 FW Metadata Span Gate 已验证成功（span≤2、recall↓98%、pipeline P95≈4s）；**本轮不审计 Span Gate / Metadata / 性能 / Industry Routing / V2 SQL 实现细节**  
**核心问题**：24 次 FW apply、5 次 CER 改善、14 次 CER 劣化 → avg CER **36.35%** 仍高于 Phase 2 **35.93%**

**数据来源**：

- `electron_node/electron-node/tests/lexicon-v2-phase3-p33-batch-result.json`
- `electron_node/electron-node/tests/lexicon-v2-phase3-p33-quality-perf.json`
- `node_runtime/lexicon/v2_shadow/lexicon_v2.sqlite`（只读 SQL）
- 代码：`main/src/fw-detector/*`、`main/src/asr-repair/*`、`main/src/lexicon/*`、`main/src/lexicon-v2/*`

---

## 1. 执行摘要

| 结论项 | 判定 |
|--------|------|
| **主因** | **候选质量 + RepairTarget 策略**（非 Span Gate） |
| **次因** | **KenLM weak_veto 对短句几乎失效**（delta 近 0，永远 > -0.2 阈值） |
| **14 条 degrade 根因分类** | **A（Span 区域对、Candidate 错）13 条**；**D（RepairTarget 不合理）14/14**；**B（KenLM 错放行）0 条独立**；**C（Alias 选错）1 条连带** |
| **下一步路线** | **P3.4-A：RepairTarget / 词库质量（收益最高、风险最低）**；weak_veto 加 floor 为 P3.4-B |

### 1.1 数字摘要（dialog_200 全量）

| 指标 | 值 |
|------|-----|
| FW apply job 数 | **23**（共 **24** 次 span 替换；d119 双 span） |
| CER 改善 | **5**（d012、d043、d088、d102、d200） |
| CER 劣化 | **14** |
| CER 不变（apply 但 CER 不变） | **4**（d007、d047、d110、d182） |
| 净 CER 影响 | +0.33 pp（36.02% → 36.35%） |

### 1.2 一句话结论

**14 次修坏，几乎全部是因为「低置信 span 触发了 recall，而从拼音桶召回的同音词本身就不该作为 repairTarget」，KenLM weak_veto 因归一化分过近而无法否决；不是「候选排序公式错了」，而是「候选池里就没有正确答案」。**

---

## 2. Candidate Ranking 真实路径

### 2.1 决策链（Apply 前）

```text
runFwTopKDecisionPipeline (fw-topk-decision-pipeline.ts)
  → recallSpanTopK (local-span-recall.ts → recallSpanTopKV2)
  → scoreRecallHits
       ├─ buildCandidateSentencesForSpan
       ├─ scoreSpanCandidateSentences (kenlm-span-gate.ts)  // weak_veto 过滤
       └─ computeCandidateFinalScore (candidate-scorer.ts)    // 加权 finalScore
  → pickBestCandidatePerSpan (pick-approved-replacements.ts) // 每 span 取最高 finalScore 且 !vetoed
  → pickApprovedReplacementsGreedy                          // 全局按 finalScore 贪心、去重叠
  → applyFwSpanReplacements (apply-span-replacements.ts)
```

**orchestrator 入口**：`fw-detector-orchestrator.ts` L321–343 调用上述 pipeline，**Apply 前无其它排序分支**。

### 2.2 最终排序依据：**finalScore（非 candidateScore，非 KenLM 单独）**

`pickBestCandidatePerSpan` 明确：

```19:27:electron_node/electron-node/main/src/fw-detector/pick-approved-replacements.ts
/** Per span: highest finalScore among non-vetoed candidates. */
export function pickBestCandidatePerSpan(...) {
  const eligible = candidates
    .filter((c) => !c.vetoed)
    .sort((a, b) => b.finalScore - a.finalScore);
```

`finalScore` 计算（`fw-topk-decision-pipeline.ts` L104–136 + `candidate-scorer.ts` L30–45）：

| 分量 | 权重（默认） | 说明 |
|------|-------------|------|
| phoneticScore | **0.4** | 拼音相似度 |
| priorScore | **0.3** | 词库 prior |
| domainMatched | **0.2** | 命中 enabled domain → 1，否则 0.5 |
| kenlmDelta（归一化） | **0.1** | `(clamp(delta,-1,1)+1)/2`；**veto 已先行置 finalScore=0** |

**candidateScore**（recall 阶段 `prior + phonetic + domainBoost - editPenalty`）**不直接进入 pick**；仅通过 recall 排序进 topK，再参与 finalScore 的部分分量。

**KenLM 角色**：

1. **Gate**：`vetoed=true` → `finalScore=0`，不参与排序  
2. ** Tie-break 贡献**：仅 10% 权重；本轮 degrade 案例 delta ≈ 0，kenlm 贡献 ≈ 0.5×0.1

### 2.3 本轮 degrade 上的排序表现

| 现象 | 说明 |
|------|------|
| 单候选 span | **13/14 job** 每 span 仅 **1** 个非 veto 候选 → 排序退化为「有就用」 |
| 多候选 span | d064（一起/一齐/仪器）、d188（我市/卧室）→ 选 **finalScore 最高** 的错误同音词 |
| 正确候选 | **24 次 apply 中 0 次** 出现 manifest 参考词（如 美式、大杯、问一下） |

---

## 3. Weak Veto 真实规则

### 3.1 代码路径

`scoreSpanCandidateSentences` → `evaluateKenlmDecision`（`kenlm-span-gate.ts`）

### 3.2 输入 / 输出

| 项 | 值 |
|----|-----|
| 输入 | `rawText`（原句）+ 各候选 **整句** `candidateSentence` |
| 打分 | `scorer.scoreBatch([rawText, ...candidates])` |
| delta | `candidateNorm - baselineNorm` |
| 模式 | **`weak_veto`**（配置默认，`kenlmVetoThreshold: -0.2`） |

### 3.3 判断条件

```46:61:electron_node/electron-node/main/src/asr-repair/kenlm-span-gate.ts
  const vetoed = input.delta < input.vetoThreshold;
  return {
    approved: !vetoed,
    vetoed,
    reason: vetoed ? 'vetoed_worse_than_threshold' : 'not_worse_than_threshold',
  };
```

| 模式 | approve 条件 | veto 条件 |
|------|-------------|-----------|
| `weak_veto` | `delta >= vetoThreshold`（**默认 ≥ -0.2**） | `delta < -0.2` |
| `hard_gate` | `delta >= deltaThreshold`（**0.8**） | 否则 veto |

**本轮运行配置**（APPDATA + `fw-config.ts` 默认）：`kenlmGateMode=weak_veto`，`kenlmVetoThreshold=-0.2`，`kenlmDeltaThreshold=0.8`（hard_gate 未启用）。

### 3.4 是否存在「delta 太小仍 accept」？

**是，且在本轮批测中为系统性现象。**

| 统计 | 14 条 degrade 的 KenLM delta |
|------|------------------------------|
| 范围 | **-0.0018 ~ -0.000015** |
| 是否触发 veto（< -0.2） | **0 / 14** |
| reason | 全部为 **`not_worse_than_threshold`** |
| baselineNorm / candidateNorm | 多为 **10⁻³ ~ 10⁻⁵** 量级（短句 KenLM 归一化分极低） |

单元测试已证明 `-0.08` 仍 accept（`kenlm-span-gate.test.ts`）；本轮实际 delta 比 -0.08 **小两个数量级**，veto **不可能触发**。

**结论**：weak_veto 在本链路中 **不是「错放了明显更差句」**，而是 **「对同音替换几乎永远放行」**；真正错误来自 **候选词本身**。

---

## 4. RepairTarget 分布

### 4.1 V2 Shadow SQLite 实测（`lexicon_v2.sqlite`，enabled=1）

| 层 | 总行数 | repair_target=**1** | repair_target=**0** |
|----|--------|----------------------|---------------------|
| **base_lexicon** | **50,000** | **50,000 (100%)** | **0** |
| **idiom_lexicon** | **22,192** | **22,192 (100%)** | **0** |
| **domain_lexicon** | **0** | — | — |

Build 拒绝 **897** 行 `common5_deferred`，但 **入库条目 repair_target 全部为 1**。

### 4.2 高频功能词抽样（base_lexicon，repair_target=1）

| 词 | repair_target | prior_score |
|----|---------------|-------------|
| 我们 | 1 | 0.99 |
| 可以 | 1 | 0.9715 |
| 然后 | 1 | 0.8887 |
| 因为 | 1 | 0.9329 |
| 已经 | 1 | 0.9532 |
| 现在 | 1 | 0.9304 |
| 不要 | 1 | 0.8834 |
| 一下 | 1 | 0.7997 |
| 没事 | 1 | 0.6951 |
| 补药 | 1 | 0.564 |
| 以下 | 1 | 0.8461 |
| 可疑 | 1 | 0.6719 |

**存在大量普通词 / 功能词 / 同音陷阱词仍允许修复。**

### 4.3 运行时过滤

`candidateRequireRepairTarget` 默认 **true**（`fw-config.ts` L182–183），但 **只过滤 repairTarget=false**；在 **100% repair_target=1** 词库下 **等价于无过滤**。

---

## 5. Alias 占比

### 5.1 Apply 中 source 字段

| source | apply 次数（24 次替换） |
|--------|-------------------------|
| `lexicon_pinyin_topk` | **24 / 24 (100%)** |
| `alias_exact` / `alias_pinyin` | **0** |

**没有任何一次 apply 走 alias_exact 候选源**；即使 span signals 含 `alias_exact_hit`（如 d002），最终 pick 仍来自 **拼音 TopK**。

### 5.2 Alias 与 apply 关系

| 类型 | job | 说明 |
|------|-----|------|
| alias 触发 span、拼音 pick **劣化** | d002 | span=美食（alias hit）→ pick **没事**（应为美式） |
| alias 相关、CER 不变 | d047、d182 | 大背→大悲（同音替换，CER 不变） |
| alias 触发 span、未进 apply | 若干 | metadata gate `aliasHitCount>0` 但 recall/veto 未 apply |

**Alias 系统对 span 召回有效，但未将 alias 正确映射到 canonical 应用；成功 CER 改善 5 条均来自繁简转换（這個/我們→简中），非 alias 同音修复。**

---

## 6. Apply 分类统计

### 6.1 按词库层 / 来源

| 类别 | apply job | improve | degrade | unchanged | 说明 |
|------|-----------|---------|---------|-----------|------|
| **A Alias 触发 span** | 3 | 0 | 1 | 2 | d002、d047、d182 |
| **B Base（lexicon_pinyin_topk）** | **23** | 5 | 14 | 4 | 全部 apply 的 source |
| **C Domain** | 0 | 0 | 0 | 0 | domain_lexicon 空表 |
| **D Idiom** | 0 | 0 | 0 | 0 | maxIdiomCandidates=0 |
| **E 其它** | 0 | 0 | 0 | 0 | — |

### 6.2 按 CER 结果（23 job / 24 替换）

| 结果 | job 数 | id |
|------|--------|-----|
| **improve** | 5 | d012、d043、d088、d102、d200 |
| **degrade** | 14 | d002、d037、d046、d054、d064、d082、d091、d098、d119、d136、d172、d179、d181、d188 |
| **unchanged** | 4 | d007、d047、d110、d182 |

### 6.3 5 条 improve 的真实性质

| id | 替换 | 性质 |
|----|------|------|
| d012、d102 | 這個→这个 | **繁简归一**（非语义 ASR 修复） |
| d043、d088、d200 | 我們→我们 | **繁简归一** |

**没有任何 improve 来自 cafe/tech 等同音纠错（如 钟贝→中杯）。**

---

## 7. 14 条 Degrade Case 逐条分析

| id | 场景 | 原 ASR → Final | Span → Candidate | KenLM | 劣化原因 | 分类 |
|----|------|----------------|------------------|-------|----------|------|
| **d002** | cafe | 美食… → **没事**… | 美食 → **没事** | δ=-0.0014 ✓ | 应为「美式」；拼音桶同音 **没事** | **A + D** |
| **d037** | restaurant | …不要像蔡… → …**补药**像蔡… | 不要 → **补药** | δ=-0.0011 ✓ | 「不要」ASR 正确；**补药**为谐音污染 | **A + D** |
| **d046** | cafe | …温习一下 → …温习**以下** | 一下 → **以下** | δ≈0 ✓ | 「问一下」被切成低置信 **一下**；**以下**语义错误 | **A + D** |
| **d054** | taxi | …可以吗 → …**可疑**吗 | 可以 → **可疑** | δ≈0 ✓ | 「可以」正确；**可疑**同音 | **A + D** |
| **d064** | tech | …一起评估 → …**一齐**评估 | 一起 → **一齐**（胜仪器） | δ=-0.00007 ✓ | 「一起」正确；同音词竞争 | **A + D** |
| **d082** | restaurant | 同 d037 模式 | 不要 → **补药** | δ=-0.00076 ✓ | 同上 | **A + D** |
| **d091** | cafe | …问一下 → …问**以下** | 一下 → **以下** | δ≈0 ✓ | 同 d046 模式 | **A + D** |
| **d098** | taxi | …大概… → …**搭盖**… | 大概 → **搭盖** | δ=-0.00055 ✓ | 「大概」应为保留；**搭盖**无意义 | **A + D** |
| **d119** | classroom | …一下午叫码,**可以**… → …**以下**午…,**可疑**… | 一下→以下；可以→可疑 | 均 ✓ | **双 span 双错**；低置信误触 + 同音陷阱 | **A + D** |
| **d136** | cafe | …问一下 → …问**以下** | 一下 → **以下** | δ≈0 ✓ | 同 d046 | **A + D** |
| **d172** | restaurant | 同 d037 | 不要 → **补药** | δ=-0.0010 ✓ | 同上 | **A + D** |
| **d179** | homophone | …已经确认 → …**一经**确认 | 已经 → **一经** | δ=-0.0010 ✓ | 「已经」正确 | **A + D** |
| **d181** | cafe | …温习一下 → …温习**以下** | 一下 → **以下** | δ≈0 ✓ | 同 d046 | **A + D** |
| **d188** | taxi | …我是点声 → …**卧室**点声 | 我是 → **卧室**（胜我市） | δ=-0.00010 ✓ | 「十点十分」误听区域；**卧室**更错 | **A + D** |

### 7.1 Degrade 模式聚类

| 错误模式 | 次数 | 占比 |
|----------|------|------|
| **一下 → 以下** | **7** | 50% |
| **不要 → 补药** | **4** | 29% |
| **可以 → 可疑** | **2** | 14% |
| 其它（没事/一齐/搭盖/一经/卧室） | 各 1 | — |

### 7.2 分类汇总（14 条）

| 分类 | 计数 | 说明 |
|------|------|------|
| **A Span 区域合理、Candidate 错误** | **13** | 低置信 span 指向 ASR 错误区，但 recall 无正确词 |
| **B Candidate 对、KenLM 错放行** | **0** | 候选本身错误，非 KenLM 单独问题 |
| **C Alias 错** | **1** | d002 alias 触发但未导向 canonical |
| **D RepairTarget 不合理** | **14** | 所选词均为 repair_target=1 的同音陷阱 |
| **E 其它** | **0** | — |

---

## 8. Candidate Pool 统计

### 8.1 配置上限

| 层 | LIMIT |
|----|-------|
| base | 2 |
| domain | 3 |
| idiom | 0 |
| merge cap | **5** |
| topK（FW pick 前） | **3** |

### 8.2 批测 `candidate_count_after_merge`（41 次 span recall）

| 指标 | 值 |
|------|-----|
| count | 41 |
| **P50** | **1** |
| **P95** | **2** |
| **MAX** | **2** |
| avg | **1.0** |

### 8.3 低质量候选是否进入排序？

**是。** 原因：

1. merge 后常仅 **1–2** 个候选，且均为 **同拼音 bucket 高 prior 同音字**  
2. **100% repair_target=1**，`candidateRequireRepairTarget` 无法剔除  
3. **无 manifest 参考词**进入 pool（正确词未入库或未进 bucket Top2）  
4. KenLM weak_veto 对 **delta≈0** 不 veto  

---

## 9. P3.4 优先级建议

> 约束：不改 Span Gate / Metadata Gate / KenLM Span Gate / 架构 / 新服务

### P3.4-A（首选：收益最高、风险最低、改动最小）

**RepairTarget + 候选质量（词库/build 层）**

1. **修复 V2 shadow build**：`repair_target` 不能默认全 1；恢复 `common5`/功能词 **repair_target=0** 或拒绝入 base  
2. **同音陷阱 blacklist**：一下/以下、不要/补药、可以/可疑、已经/一经 等 **禁止互修**  
3. **seed 增补 domain 正确词**（美式、大杯、问一下…）并设 **repair_target=1**  
4. **保持** `candidateRequireRepairTarget=true`（待词库修正后生效）

**预期**：直接消除 14 degrade 中 **≥12** 条（一下/不要/可以/已经 系列）

### P3.4-B（次优：Weak Veto 加 floor）

1. 对 **normalizedScore 极低**（如 baseline < 0.01）的 batch，改用 **绝对分差** 或 **require delta > -ε**（如 -0.05）  
2. 或 short-sentence **fail-closed**（单 span 替换不改变 CER 时 skip apply）  

**风险**：可能误杀 d012 等繁简 improve；需与 A 联调

### P3.4-C（最后：Alias 应用链）

1. `alias_exact_hit` span **优先 canonical_exact / alias_exact 源**，而非拼音 TopK 竞争  
2. alias materialize 时写入 **canonical word** 为首选候选  

**风险**：改动 pick 链，需回归 alias homophone 边界

---

## 10. Target List

| ID | 模块 | 文件 | 动作 |
|----|------|------|------|
| T1 | V2 build | `scripts/lexicon/lib/v2-materialize-aliases.mjs`、`migrate-seed.mjs` | repair_target 默认值与 seed 字段对齐 |
| T2 | V2 classify | `scripts/lexicon/lib/v2-classify-row.mjs` | common5 / 功能词 tier 拒绝或 rt=0 |
| T3 | V2 bundle | `node_runtime/lexicon/v2_shadow/` | 重建 sqlite；rt=1 占比降至合理区间 |
| T4 | FW pick | `fw-topk-decision-pipeline.ts` | alias span 候选源优先级（P3.4-C） |
| T5 | KenLM | `kenlm-span-gate.ts` + config | 短句 delta floor / fail-closed（P3.4-B） |
| T6 | Seed | `combined_entries.jsonl` / domain packs | 补正确词 + 陷阱词 rt=0 |
| T7 | 回归 | `tests/run-lexicon-v2-phase3-p33-batch.js` | degrade ≤2、apply 精准率 ↑ |

---

## 11. Check List

### 11.1 开发前

- [ ] 确认 V2 sqlite `repair_target=1` 占比目标（建议 base **<30%** 或仅 domain/idiom 高 prior 为 1）
- [ ] 列出 14 degrade 涉及词对的 seed 修正表
- [ ] 确认 `candidateRequireRepairTarget` 在 rt 修正后仍默认 true
- [ ] 评估繁简 improve（5 条）是否需单独 whitelist

### 11.2 开发后

- [ ] dialog_200：`fw_degraded ≤ 2`（或 0）
- [ ] `fw_improved` 含至少 1 条 **语义同音**（非纯繁简）
- [ ] avg CER final **≤ 35.93%**（Phase 2 基线）
- [ ] apply job 数 **≤ 15**（减少误触）
- [ ] 14 degrade 模式（一下→以下 等）**归零**
- [ ] merge P95 ≤ 2 保持；span/job ≤ 2 不回退

### 11.3 禁止项

- [ ] 未改 Span Gate / Metadata Gate
- [ ] 未恢复 KenLM Span Gate
- [ ] 未引入新服务

---

## 12. 路线判定（回答用户核心问题）

| 问题 | 答案 |
|------|------|
| 问题在候选质量还是 KenLM weak_veto？ | **主因候选质量 / RepairTarget（~93%）**；KenLM 为 **次因**（放行机制过宽，但未「选对词后被 KenLM 改坏」） |
| 14 条是否「Span 对、Candidate 错」？ | **是（13/14）** |
| 下一步应走哪条路线？ | **P3.4 RepairTarget / Lexicon Quality（P3.4-A）**；开发量小、风险低、直接对应 degrade 模式 |
| weak_veto 调参是否优先？ | **否**；单独调 `-0.2` 无法解决 delta≈0 的系统性放行，且无法产生正确候选 |

---

**审计人**：只读代码 + 批测 JSON + V2 sqlite 查询  
**关联报告**：`Lexicon_Runtime_V2_P3_3_测试报告_dialog200_2026_05_31.md`
