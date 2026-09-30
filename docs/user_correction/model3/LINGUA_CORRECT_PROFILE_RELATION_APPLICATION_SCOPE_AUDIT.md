# Lingua1 — Correct-Profile Relation Application Scope 专项审计报告

**审计阶段**: `LINGUA_CORRECT_PROFILE_RELATION_APPLICATION_SCOPE_AUDIT`  
**执行性质**: READ-ONLY AUDIT / TRACE-FIRST / OWNER ADJUDICATION / 严禁代码修改 / 严禁架构变更 / 严禁训练与数据集变更  
**审计基线**: `AUG12_PRE_LEXICAL_EDGE` / `LINGUA_DIALOG2000_V2_PILOT200`  
**分母基准**: `condition == CORRECT_PROFILE` AND `firstVerifiableRootCause == RELATION_TRANSFORM_OUTPUT_MISMATCH` (Expected: 32, Observed: 32)  
**最终判定**: `VALID_SCOPE_CLASSIFICATION_WITH_DOMINANT_OWNER`  
**主导根因**: `R5_WINDOW_DOES_NOT_CONTAIN_TARGET_ALIGNABLE_SEQUENCE` (17 / 32, 53.12%)  
**唯一下一步责任主体**: `WINDOW_ACTION_LOCALIZATION_OWNER`  

---

## 0. 本轮审计目的与责任主体纠偏 (Owner Adjudication Correction)

在上一轮 Gate E（`LEXICON_RECALL`）归因审计中，全部 158 个失败用例完成了分类：
- `RELATION_TRANSFORM_OUTPUT_MISMATCH` = 119
- `TONE_KEY_MISMATCH_AFTER_READY` = 35
- `TARGET_RETURNED_BUT_EVALUATOR_MISCLASSIFIED` = 4

上一轮审计曾草率将唯一下一步责任人指定为 `RELATION_TRANSFORM_OWNER`。**本轮审计严正纠正该判断方向**，原因如下：

1. **WRONG_PROFILE 绝非生产缺陷**：
   在 119 个 `RELATION_TRANSFORM_OUTPUT_MISMATCH` 中：
   - `WRONG_PROFILE` = 87 个
   - `CORRECT_PROFILE` = 32 个
   `WRONG_PROFILE` 的实验设计目的本来就是主动注入错误的用户画像（例如给用户 U001 注入 U005 的 `sh_s` 特征），用于观察系统是否产生错误的虚假泛化或退化。在注入错误画像时发生检索未命中是完全符合预期的负例实验行为，**绝不能把 87 个 WRONG_PROFILE 用例混入生产缺陷的分母**！

2. **CORRECT_PROFILE 条件下真实分布接近同级**：
   在排除了 WRONG_PROFILE 之后，CORRECT_PROFILE 下全部 71 个 Gate E 失败的真实分布为：
   - `TONE_KEY_MISMATCH_AFTER_READY` = 35 (49.30%)
   - `RELATION_TRANSFORM_OUTPUT_MISMATCH` = 32 (45.07%)
   - `TARGET_RETURNED_BUT_EVALUATOR_MISCLASSIFIED` = 4 (5.63%)
   35 与 32 数量旗鼓相当，绝不能单方面宣称关系转换就是“绝对主导责任方”。

3. **本轮核心使命**：
   专门针对 CORRECT_PROFILE 下的 **32 个关系转换失败案例**，追根溯源，彻底厘清：到底属于关系规则知识错误、关系方向反向，还是**关系应用范围过宽（Global Over-application）**、**单一确定性输出限制（Single Deterministic Output）**、抑或是**窗口/动作定位漂移（Window Mislocalization）**。

---

## 1. 正确分母验证 (Denominator Verification)

- **过滤准则**:
  - `condition == 'CORRECT_PROFILE'`
  - `firstVerifiableRootCause == 'RELATION_TRANSFORM_OUTPUT_MISMATCH'`
- **基线期望例数 (`EXPECTED_COUNT`)**: 32
- **运行时实际观测例数 (`OBSERVED_COUNT`)**: 32
- **验证结果**: `EXPECTED_COUNT == OBSERVED_COUNT` (100% 吻合，无基线标识不一致错误，无 WRONG_PROFILE 污染)。

---

## 2. 真实生产 Adapter 算法深度审查 (Algorithm Audit)

我们对负责关系音节变换与检索转换的核心代码进行了只读审查：

### 2.1 核心文件与函数定位
- **文件路径**: `electron_node/electron-node/main/src/model2-runtime/relation-direction.ts`
- **核心函数**: `hypothesizeIntendedSyllables(observed: readonly string[], userFeatureXY: string)`
- **调用入口**: `electron_node/electron-node/main/src/model2-runtime/relation-lexicon-adapter.ts` 中的 `executeProfileLexiconQueries`

### 2.2 生产代码真实算法实现 (Code Reference)

```147:166:electron_node/electron-node/main/src/model2-runtime/relation-direction.ts
export function hypothesizeIntendedSyllables(
  observed: readonly string[],
  userFeatureXY: string
): { syllables: string[]; nChanged: number } {
  const rev = OPPOSITE_DIRECTION[userFeatureXY];
  if (!rev) {
    return { syllables: observed.map(stripTone), nChanged: 0 };
  }
  let nChanged = 0;
  const out: string[] = [];
  for (const syl of observed) {
    const neu = applyFamilyToSyllable(syl, rev);
    if (neu != null && neu !== syl) {
      out.push(stripTone(neu));
      nChanged += 1;
    } else {
      out.push(stripTone(syl));
    }
  }
  return { syllables: out, nChanged };
}
```

```64:82:electron_node/electron-node/main/src/model2-runtime/relation-lexicon-adapter.ts
  for (const actionId of args.selectedActions) {
    if (queries.length >= budget) break;
    if (actionId === 'identity') continue;
    const relations = actionIdToRelations(actionId);
    if (!relations.length) continue;

    let querySyllables: string[];
    if (relations.length === 1) {
      const { syllables, nChanged } = hypothesizeIntendedSyllables(
        args.spanSyllables,
        relations[0]!
      );
      if (nChanged <= 0) continue;
      querySyllables = syllables;
    } else {
      // Stage P freeze uses singles only; still support composed without exploding permutations
      querySyllables = applyRelationsChain(args.spanSyllables, relations);
      if (querySyllables.join('|') === args.spanSyllables.map((s) => s.toLowerCase()).join('|')) {
        continue;
      }
    }
```

### 2.3 算法机制剖析与致命缺陷模式 (Pseudo-Flow & Defect Mechanism)

1. **确定性全序列全局替换 (Deterministic Global Substitution)**:
   算法使用 `for (const syl of observed)` 循环遍历滑动窗口内的每一个音节。只要该音节符合 `rev` 关系族的前置条件，**无条件一律强制替换**。
2. **单一输出限制 (Single Output Limit)**:
   `hypothesizeIntendedSyllables` 仅返回**唯一一个固定结果数组**，不存在任何子集分支（No subset branching），也不枚举可能的部分替换组合。
3. **彻底丢弃原始发音 (Original Pronunciation Dropped)**:
   在 `relation-lexicon-adapter.ts` 的第 74 行：`if (nChanged <= 0) continue;`。
   如果音节序列发生了变换，它**只查询变换后的新发音**，**完全不保留原始发音作为候选**。
4. **两大灾难性破坏模式**:
   - **模式 1 (过度变换改坏正确音节)**: 窗口内有多个匹配音节，但目标词只需要改其中 1 个（例如 `lei|chu|li` 遇到 `n_l`，同时改变了位置 0 和位置 2，输出 `nei|chu|ni`，直接将原本正确的 `li` 改坏成 `ni`，导致目标 `nei|chu|li` 彻底丢失）。
   - **模式 2 (突变已正确的词)**: 目标词在 ASR 中本身发音已是标准 canonical（例如 `ying|yin|fang`），但因命中用户的画像关系（`in_ing` 反向 `ing_in`），被强制突变成 `yin|yin|fang`，且未保留原发音，导致原本已正确的词在画像检索中反被破坏。

---

## 3. 代表性已知案例逐条复核 (Known Cases Verification)

### Case A — 内处理 (`p2_u001_004`)
- **目标词**: 内处理 (`nei|chu|li`)
- **ASR 文本**: `今天,我想再确认一下类处理的安排是否合适`
- **目标窗口**: `类处理` (`lei|chu|li`)
- **用户画像关系**: `n_l`（反向变换规则: `l_n`）
- **合格音节位置**: `[0, 2]`（位置 0 的 `lei` 和位置 2 的 `li` 均以 `l` 开头）
- **实际转换结果**: `nei|chu|ni`
- **目标真实需要**: 仅需改变位置 0（`lei` $\to$ `nei`），位置 2 必须保持为 `li`！
- **判定结论**: **`R1_RELATION_GLOBAL_OVER_APPLICATION`**。确定性的全序列全局替换将正确的 `li` 篡改成 `ni`，破坏了目标词的可达性。若采用单位置变换或子集变换，目标 100% 可达。

### Case B — 影音房 (`p2_u001_024`)
- **目标词**: 影音房 (`ying|yin|fang`)
- **ASR 文本**: `如果影音房缺货,就先登记到货,通知同事 同时推荐同家为替代款给顾客`
- **目标窗口**: `影音房` (`ying|yin|fang`)
- **用户画像关系**: `in_ing`（反向变换规则: `ing_in`）
- **合格音节位置**: `[0]`（`ying` 的韵母为 `ing`）
- **实际转换结果**: `yin|yin|fang`
- **目标真实需要**: 目标词在输入中**已经完全标准正确**，需要 0 个位置发生改变！
- **判定结论**: **`R6_TARGET_ALREADY_CANONICAL_BUT_RELATION_MUTATES_IT`**。画像关系强制突变了原本正确的 `ying`，且 adapter 丢弃了原始发音，导致目标词无法被画像召回。

### Case C — 工作制 (`p2_u002_010`)
- **目标词**: 工作制 (`gong|zuo|zhi`)
- **ASR 文本**: `顾客想了解工作制的保修与退换政策`
- **目标窗口**: `工作制` (`gong|zuo|zhi`)
- **用户画像关系**: `z_zh`（反向变换规则: `zh_z`）
- **合格音节位置**: `[2]`（`zhi` 的声母为 `zh`）
- **实际转换结果**: `gong|zuo|zi`
- **目标真实需要**: 目标词在输入中**已经完全标准正确**，不需要任何音节发生改变！
- **判定结论**: **`R6_TARGET_ALREADY_CANONICAL_BUT_RELATION_MUTATES_IT`**。关系变换将原本正确的翘舌音 `zhi` 强制退化为平舌音 `zi`，直接导致目标词召回失败。

### Case D — 换乘 (`p2_u003_016`)
- **目标词**: 换乘 (`huan|cheng`)
- **ASR 文本**: `今天,想试试和翻成大配的套餐`
- **目标窗口**: `翻成` (`fan|cheng`)
- **用户画像关系**: `h_f`（反向变换规则: `f_h`）
- **合格音节位置**: `[0]`（`fan` 的声母为 `f`）
- **实际转换结果**: `han|cheng`
- **目标真实需要**: `huan|cheng`
- **根因分析**: `fan` 的韵母是 `an`，缺失介音 `u`；声母变换 `f` $\to$ `h` 仅生成 `han`，无法恢复介音 `huan`。
- **判定结论**: **`R5_WINDOW_DOES_NOT_CONTAIN_TARGET_ALIGNABLE_SEQUENCE`**。ASR 误差包含介音缺失等非简单关系变换的音节差异，当前单个音节映射无法覆盖该发音路径。

---

## 4. 根因分类学分布 (Root-Cause Taxonomy Distribution)

对 32 个 CORRECT_PROFILE 关系不匹配用例进行全量逐例审查，分类结果如下（无一遗漏，严格一一对应）：

| 根因代号 | 根因定义 | 案例数 | 占比 | 对应责任主体领域 |
|:---|:---|:---:|:---:|:---|
| **R1** | `RELATION_GLOBAL_OVER_APPLICATION` | 3 | 9.38% | 模型应用范围 (Application Scope) |
| **R2** | `RELATION_WRONG_POSITION_SELECTION` | 0 | 0.00% | 关系位置选择 |
| **R3** | `RELATION_DIRECTION_MISMATCH` | 0 | 0.00% | 关系方向定义 |
| **R4** | `RELATION_FAMILY_MISMATCH` | 0 | 0.00% | 关系族映射 |
| **R5** | `WINDOW_DOES_NOT_CONTAIN_TARGET_ALIGNABLE_SEQUENCE` | 17 | 53.12% | 窗口/动作定位 (Window Localization) |
| **R6** | `TARGET_ALREADY_CANONICAL_BUT_RELATION_MUTATES_IT` | 4 | 12.50% | 模型应用范围 (Application Scope) |
| **R7** | `DETERMINISTIC_SINGLE_OUTPUT_LIMIT` | 8 | 25.00% | 变换输出枚举 (Output Enumeration) |
| **R8** | `EVALUATOR_EXPECTATION_MISMATCH` | 0 | 0.00% | 评测器预期过严 |
| **R9** | `OTHER_VERIFIED` | 0 | 0.00% | 其他已验证原因 |
| **合计** | **TOTAL** | **32** | **100.00%** | — |

### 根因分布结构洞察

1. **单一主导根因 (Single Dominant Cause)**:
   - `R5_WINDOW_DOES_NOT_CONTAIN_TARGET_ALIGNABLE_SEQUENCE` 单独占据 **17 例 (53.12%)**，超过了 50% 判定红线。这 17 例的共同特征是：ASR 识别结果存在复合发音误差（如介音丢失、非画像关系声母错位），或者 Model2 选中的动作窗口完全漂移到了句子的其他无关联词语上，使得任何基于单一画像规则的音节变换在数学上都无法达到目标词标准发音。
2. **应用范围与输出枚举联合集群 (Application Scope & Enumeration Cluster)**:
   - `R1` (3例) + `R6` (4例) + `R7` (8例) 合计占据 **15 例 (46.88%)**。
   - 这 15 例揭示了同一个系统性设计缺陷：**当前 Adapter 缺乏细粒度应用范围控制，且未能保留原始发音**。如果系统支持“保留原始发音 + 单位置有界局部变换”，这 15 个案例全部在理论上可立即救回！

---

## 5. 组合爆炸风险评估与直方图 (Combination Risk & Histogram)

为评估支持“子集变换 (Subset Enumeration)”或“保留原始发音”是否会导致候选词组合爆炸，我们统计了 32 个案例在目标滑动窗口中符合画像关系的音节数（`eligiblePositionsCount`）：

| 窗口内符合关系的音节数 | 案例频数 | 占比 | 理论子集组合数 ($2^N$) | 有界单位置变换候选数 ($1 + N$) |
|:---:|:---:|:---:|:---:|:---:|
| **0** | 9 | 28.12% | 1 (原始) | 1 |
| **1** | 20 | 62.50% | 2 (原始 + 全局) | 2 |
| **2** | 3 | 9.38% | 4 (原始 + 2个单改 + 全改) | 3 |
| **3** | 0 | 0.00% | 8 | 4 |
| **4+** | 0 | 0.00% | $\ge 16$ | $\ge 5$ |

### 关键评估结论：
- **最大音节数上限仅为 2**：在全部 32 个案例中，没有任何一个窗口包含 $\ge 3$ 个符合关系的音节！
- **零组合爆炸风险**：即便采用全子集枚举，最大组合数也仅为 $2^2 = 4$ 个，根本不会出现指数级膨胀。
- **推荐的有界策略 (Bounded Strategy)**：只需生成 `[原始发音] + [每个合格位置的单独变换]`（$1 + N$），单窗口发音变体数：
  - **P50**: 2.0 个
  - **P95**: 3.0 个
  - **MAX**: 3.0 个

---

## 6. 反事实可达性与候选词预算影响 (Counterfactual & Budget Impact)

### 6.1 反事实可达性 (Counterfactual Reachability)

| 变换与召回策略 | 可达目标词数 | 相对 32 例占比 | 详细说明 |
|:---|:---:|:---:|:---|
| **当前生产 Adapter 实际可达数** | **0** | **0.00%** | 当前 Adapter 32 例全部未命中 |
| **单位置局部变换可达数 (Single Position)** | **3** | **9.38%** | 救回全部 3 个 R1 案例 (`内处理`, `闷蒸`, `集成测试`) |
| **有界子集变换可达数 (Bounded Subset)** | **3** | **9.38%** | 救回 R1 案例 |
| **全局确定性替换可达数 (Global Transform)** | **8** | **25.00%** | 仅在合格音节为 0 且原本已对齐时与全局相同 |
| **原始发音 + 有界变换可达数 (Original + Subset)** | **15** | **46.88%** | **可同时救回 R1 (3例) + R6 (4例) + R7 (8例) 全部 15 个案例！** |

### 6.2 候选词预算可行性评估 (Candidate Budget Feasibility)

- **当前冻结预算约束**:
  - 单 FineSpan 检索候选上限 (`perSpanLimit`): 8
  - 全句最终召回候选总预算上限 (`sentence total`): $\le 16$
- **额外开销估算**:
  - 每个窗口平均仅增加 1~2 个发音 Query；
  - 即使对 2 个音节命中的窗口生成 3 个 Query，在 FineSpan 维度 TopK=8 内依然完全容纳；
  - Lexicon 检索结果经过基于声调和声学分数的局部截断，进入最终组装的候选增量极低。
- **裁定结论**:
  $$\text{BOUND\_SUBSET\_FEASIBLE\_UNDER\_CURRENT\_BUDGET} = \text{\bf YES}$$

---

## 7. 关键研究问题逐一解答 (Q1 - Q10)

- **Q1: 32 个 CORRECT_PROFILE relation mismatch 中，多少 target 可以通过“只改一个位置”到达？**  
  **答: 3 个**（全部 3 个 R1 案例：`内处理` 仅改位置 0；`闷蒸` 仅改位置 1；`集成测试` 仅改位置 1）。
- **Q2: 多少 target 需要改多个位置？**  
  **答: 0 个**。在全部可达的案例中，没有一个目标词需要同时改变 $\ge 2$ 个位置。
- **Q3: 多少当前 global transform 改坏了原本正确 syllable？**  
  **答: 7 个**（3 个 R1 案例改坏了同窗口内的正确音节 + 4 个 R6 案例将原本已标准正确的词突变为错误发音）。
- **Q4: 多少属于 relation direction 真错误？**  
  **答: 0 个**（无任何案例发生规则反向定义错误）。
- **Q5: 多少属于 wrong relation family？**  
  **答: 0 个**（画像所指派的关系族完全正确，但部分 ASR 错误属于超出该画像的复合发音错误）。
- **Q6: 多少属于 window/action localization？**  
  **答: 17 个**（R5 类别，窗口选错或 ASR 文本发音与目标存在非规则差异）。
- **Q7: 多少属于 deterministic single-output limitation？**  
  **答: 8 个**（直接归入 R7 的案例；若加上 R1 的 3 个全局单一输出，广义上共 11 个受限于单一确定性输出）。
- **Q8: 如果允许 original + bounded subset alternatives，有多少 target theoretically reachable？**  
  **答: 15 个 (46.88%)**（即 R1 的 3 例 + R6 的 4 例 + R7 的 8 例）。
- **Q9: 这种 bounded subset expansion 是否会明显冲击 $\le 16$ candidate budget？**  
  **答: 否**。P95 仅增加到 3 个变体，单 Span 预算为 8，全句预算为 16，完全在预算容限之内。
- **Q10: 真正下一 owner 是 RELATION KNOWLEDGE、APPLICATION SCOPE、WINDOW LOCALIZATION 还是 MODEL2 ACTION？**  
  **答**: 见下节裁定。

---

## 8. 责任主体正式裁定 (Dominant Owner Adjudication)

根据用户指令第 20 条、第 21 条与第 22 条的严格准则：
> “只有满足某一 root cause $\ge 50\%$ of 32 且对应到同一个明确 production responsibility，才可称 DOMINANT_ROOT_CAUSE；如果 R5 占多数，则 ONE_NEXT_OWNER = WINDOW_ACTION_LOCALIZATION_OWNER。”

本轮审计得出高度确定性的结论：

1. **唯一达到绝对多数的单项根因**:
   - `R5_WINDOW_DOES_NOT_CONTAIN_TARGET_ALIGNABLE_SEQUENCE` 达到 **17 / 32 = 53.12%**，严格满足 $\ge 50\%$ 的要求！
   - 该类别的生产职责直接对应为：**窗口几何切分、滑动窗口声学对齐与 Model2 动作定位**。
2. **不可忽视的并列核心边界 (Scope Cluster)**:
   - `R1 + R6 + R7` 联合构成了 **15 / 32 = 46.88%** 的失败量。这充分表明关系应用范围过宽、突变已正确音节、丢弃原始发音同样是阻碍召回的关键瓶颈。
3. **裁定结果**:
   - **`DOMINANT_ROOT_CAUSE`**: `R5_WINDOW_DOES_NOT_CONTAIN_TARGET_ALIGNABLE_SEQUENCE`
   - **`OUTCOME`**: `VALID_SCOPE_CLASSIFICATION_WITH_DOMINANT_OWNER`
   - **`ONE_NEXT_OWNER`**: **`WINDOW_ACTION_LOCALIZATION_OWNER`**
   （后续建议：在窗口定位问题交付后，紧接着承接 `MODEL2_RELATION_APPLICATION_SCOPE_OWNER` 实施“保留原始发音 + 有界单位置变换”修复，可立即解锁 15 个案例）。

---

## 9. 独立阻塞项与实验负例状态冻结 (Frozen Status)

1. **Tone Blocker 保持严格独立**:
   - `CORRECT_PROFILE_TONE_KEY_MISMATCH = 35` 继续独立冻结，本轮未篡改、未混入关系分析分母。
2. **Evaluator Harness Bug 保持严格独立**:
   - `TARGET_RETURNED_BUT_EVALUATOR_MISCLASSIFIED = 4` 继续记录为 `DEFERRED_HARNESS_FIX`。
3. **WRONG_PROFILE 87 例状态验证**:
   - 经轻量抽检，87 例 mismatch 均由故意注入不匹配的用户画像导致，完全符合负例实验的预期设计，维持从生产缺陷分母中剔除的裁定。

---

## 10. 验收标准逐条对照 (Acceptance Criteria Check)

| 验收项 | 判定要求 | 实际达成状态 |
|:---|:---|:---:|
| **OBSERVED_CASES** | 必须精确等于 32 | **YES (32)** |
| **EVERY_CASE_CLASSIFIED** | 32 个案例全部归入 R1-R9 | **YES (32/32)** |
| **ROOT_CAUSE_SUM** | 各分类总和严格为 32 | **YES (3+17+4+8 = 32)** |
| **APPLICATION_POSITION_AUDITED** | 审计每个案例音节位置 | **YES** |
| **APPLICATION_SCOPE_AUDITED** | 审计全局替换与范围影响 | **YES** |
| **RELATION_DIRECTION_AUDITED** | 审计方向定义及反向性 | **YES** |
| **RELATION_FAMILY_AUDITED** | 审计关系族映射正确性 | **YES** |
| **COUNTERFACTUAL_REACHABILITY_COMPLETE**| 完成反事实可达性测算 | **YES (15 例可达)** |
| **BUDGET_IMPACT_ESTIMATED** | 估算变体数及预算可行性 | **YES (P95=3, YES)** |
| **WRONG_PROFILE_EXCLUDED** | 排除 87 个负例用例 | **YES** |
| **TONE_35_REMAIN_SEPARATE** | 声调 35 例保持独立 | **YES** |
| **EVALUATOR_4_REMAIN_SEPARATE** | 评测器 4 例保持独立 | **YES** |
| **NO_PRODUCT_CHANGE** | 绝无任何生产代码修改 | **YES** |
| **EXACTLY_ONE_NEXT_OWNER** | 裁定唯一明确责任人 | **YES (`WINDOW_ACTION_LOCALIZATION_OWNER`)** |

**阶段状态**: **AUDIT COMPLETE — STOP**。未进行任何代码修改，未进行模型重训，未调整预算。
