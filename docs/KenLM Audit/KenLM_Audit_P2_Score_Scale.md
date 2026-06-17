# KenLM Audit P2 — Score Scale

**审计日期：** 2026-06-17  
**数据批次：** dialog_200 冻结批测（81 案）

---

## 目标

解释为何 `maxDelta ≈ 0.0001`（均值）、`P95 ≈ 0.0027`，并判断 `minDeltaToReplace=0.03` 与当前 score 体系是否匹配。

---

## 代码位置

| 环节 | 文件 | 函数 |
|------|------|------|
| KenLM 原始分 | `phonetic-correction/lm-scorer.ts` | `runKenlmQuery` → `parseQueryLine` |
| 归一化 | `asr-repair/sentence-rerank/kenlm-scorer.ts` | `normalizeLmScore` |
| Delta 计算 | `fw-detector/rerank-fw-sentences.ts` | `rerankFwSentences` |
| Gate 阈值 | `fw-detector/fw-config.ts` | `minDeltaToReplace ?? 0.03` |

---

## 调用链（Score 子链）

```text
sentence (raw | candidate)
  → tokenizeForLm(text)
  → KenLM query → score (log-prob sum, 负值)
  → normalizedScore = 1 / (1 + exp(-score / 10))
  → delta = normalizedScore(candidate) - normalizedScore(raw)
  → pickedIsRaw = (maxDelta < minDeltaToReplace)
```

---

## 审计回答

### 1. KenLM 原始返回值

KenLM `query` 输出 `Total: <score> OOV: <n>`：

- **score**：整句 token 序列的对数概率之和（通常为 **大负数**，句越长绝对值越大）
- **OOV**：未登录 token 数（字符级模型下多为 0）

示例（d001）：

| 句 | 原始 score | OOV |
|----|-----------|-----|
| raw | **-97.79** | 0 |
| best candidate | **-86.80** | 0 |

原始分差约 **+11.0 log-prob**，但经 sigmoid 压缩后 normalized 差仅 **0.000113**。

### 2. 是否存在 normalize / length penalty / scale / clamp / round？

| 处理 | 是否存在 | 位置 |
|------|----------|------|
| **normalize（sigmoid）** | **是** | `1 / (1 + exp(-score / 10))` |
| length penalty | **否** | 无句长归一；长句 raw score 更负 |
| scale（除 /10） | **是** | sigmoid 输入 `score/10` |
| clamp | **否** | |
| round | **否** | IEEE 双精度 |

```4:6:electron_node/electron-node/main/src/asr-repair/sentence-rerank/kenlm-scorer.ts
function normalizeLmScore(score: number): number {
  return 1 / (1 + Math.exp(-score / 10));
}
```

**无 per-token 平均、无句长除法。**

### 3. Delta 公式（完整展开）

设：

- \( s_0 \) = raw 的 KenLM Total score  
- \( s_i \) = 第 \( i \) 个 candidate 的 KenLM Total score  

则：

\[
\text{norm}(s) = \frac{1}{1 + e^{-s/10}}
\]

\[
\delta_i = \text{norm}(s_i) - \text{norm}(s_0)
\]

\[
\text{maxDelta} = \max_i \delta_i
\]

\[
\text{pickedIsRaw} = (\text{maxDelta} < \text{minDeltaToReplace})
\]

代码对应：

```52:60:electron_node/electron-node/main/src/fw-detector/rerank-fw-sentences.ts
  for (let i = 0; i < candidates.length; i++) {
    const norm = batch.scores[i + 1]?.normalizedScore ?? baselineNorm;
    const delta = norm - baselineNorm;
    deltas.push(delta);
    if (delta > bestDelta) {
      bestDelta = delta;
      bestIndex = i;
    }
  }
```

### 4. 逐步计算示例（d001）

| 步骤 | raw | best candidate |
|------|-----|----------------|
| ① KenLM Total | -97.79381 | -86.80369 |
| ② score / 10 | -9.779381 | -8.680369 |
| ③ exp(-score/10) | 17500.6 | 5889.9 |
| ④ norm = 1/(1+exp) | **0.00005660** | **0.00016986** |
| ⑤ delta = norm_c - norm_r | — | **0.00011326** |
| ⑥ vs minDelta 0.03 | — | **不通过**（0.00011 ≪ 0.03） |

即使 raw 与 candidate 原始分差 11 log-prob，sigmoid 将两者都映射到 **接近 0 的极小正数**，差值落在 **10⁻⁴ 量级**。

### 5. Delta 理论范围

**normalizedScore 值域：** (0, 1)

- \( s \to -\infty \) → norm → 0  
- \( s = 0 \) → norm = 0.5  
- \( s \to +\infty \) → norm → 1  

**delta 值域：** (-1, 1)，但实际受句长与 sigmoid 饱和约束。

**81 案实测分布：**

| 统计量 | maxDelta |
|--------|----------|
| 均值 | 0.000176 |
| P50 | 0 |
| P95 | **0.002773** |
| 最大 | 0.007483（d079） |

| 分桶 | 案数 |
|------|------|
| delta < 0 | 26 |
| delta = 0 | 22 |
| 0 ~ 0.001 | 23 |
| 0.001 ~ 0.01 | 10 |
| 0.01 ~ 0.03 | 0 |
| ≥ 0.03 | **0** |

**理论可达上界（极端）：** 若 candidate score → 0、raw score → -200，norm 差约 0.5；但真实 ASR 句长 20~40 token，分数区间集中在 -60 ~ -120，norm 均在 **10⁻⁵ ~ 10⁻³**，delta 几乎不可能达到 0.03。

### 6. minDeltaToReplace=0.03 是否与当前 score 体系匹配？

| 对比 | 数值 |
|------|------|
| 配置阈值 | **0.03** |
| 批测 maxDelta 最大 | **0.00748** |
| 比值 | 阈值约为观测最大 delta 的 **4 倍** |
| P95 / 阈值 | 0.00277 / 0.03 ≈ **9%** |

**判定：不匹配。** 在当前 sigmoid(score/10) 体系下，0.03 位于 normalized 空间的「极高置信」区，81 案 **无一** 可达。

---

## 统计结果

- maxDelta 均值 **0.000176**，P95 **0.002773**，与观测「≈0.0001 / ≈0.0027」一致  
- 根因：**sigmoid 压缩 + 无句长归一 + 阈值 0.03 数量级偏差**

---

## PASS / FAIL

| 维度 | 判定 |
|------|------|
| Score 公式可追溯 | **PASS** |
| Delta 计算正确 | **PASS** |
| minDeltaToReplace 与 delta 尺度匹配 | **FAIL** |

**综合：FAIL（尺度与 gate 阈值严重失配）**

---

## 风险项

1. **Sigmoid 将负 log-prob 压到 ~10⁻⁵**，delta 天然为 10⁻⁴~10⁻³，gate 0.03 在数学上几乎不可达。  
2. **无句长归一**：长句 absolute score 更负，但 delta 仍受 sigmoid 饱和限制，无法靠「换更短句」显著拉大 norm 差。  
3. **26 案 maxDelta < 0**：candidate 组合 LM 分低于 raw，说明多 span 联合替换可能整体更差。  
4. **rawScore 未持久化**，线上只能看到 delta，难以直接审计 LM 原始分。

---

## 结论

`maxDelta ≈ 0.0001`、`P95 ≈ 0.0027` 的原因：**KenLM 返回大负数 log-prob 总和 → sigmoid(score/10) 映射到极小正数 → 两数之差落在 10⁻⁴ 量级**。  

KenLM 并非「不给通过」因为模型不认识词（OOV=0），而是因为 **Apply gate 阈值 0.03 与 normalized delta 尺度相差约 2~3 个数量级**。  

**问题位于：Score 归一化层 + Delta Gate 阈值层**（非 Assembly / Recall）。
