# KenLM Audit P4 — Candidate Quality

**审计日期：** 2026-06-17  
**抽样：** d001 + 20 条 apply=0 样本（按 maxDelta 降序，81 案全部为 apply=0）

---

## 目标

确认进入 KenLM 的 candidate 句是否优于 raw；统计替换模式；检查 bestCandidate 是否引入新错误。

---

## 代码位置

| 环节 | 文件 |
|------|------|
| 句候选生成 | `fw-detector/build-sentence-candidates.ts` |
| 最优句选择 | `fw-detector/rerank-fw-sentences.ts` |
| 诊断输出 | `fw-detector/types.ts` → `FwSentenceRerankDiagnostics.topCandidates` |

**说明：** 本审计只评 **送入 KenLM 的句子文本**，不讨论 Assembly / Recall 生成逻辑。

---

## 调用链

```text
spanSets → buildSentenceCandidates → combination.text
  → KenLM scoreBatch
  → argmax(delta) → topCandidates[0] 为 delta 最高句
```

---

## 统计结果（81 案）

| 指标 | 值 |
|------|-----|
| apply=0 | **81 / 81** |
| top-1 replacementCount 均值 | **4.27** |
| 单替换（=1） | 7 案（8.6%） |
| 多替换（>1） | 74 案（91.4%） |
| 零替换 | 0 |

**结论：** 送入 KenLM 的几乎全是 **多 span 联合替换句**，非单词级微调。

---

## 抽样明细（d001 + 20 案）

### d001（cafe，maxDelta=0.000113）

| 字段 | 内容 |
|------|------|
| raw | `你好,我想點一杯熱拿鐵鐘貝少糖 深便溫 以下今天有蓝美马分吗?` |
| ref | `你好，我想点一杯热拿铁，中杯，少糖。顺便问一下今天有蓝莓马芬吗？` |
| best candidate | `你好,我想點一杯熱拿铁中杯少糖 身边溫 以下今天有蓝莓马芬吗?` |
| 替换数量 | **8** |
| 主要替换 | `鐘貝→中杯`、`蓝美马分→蓝莓马芬`、`拿鐵→拿铁`（部分） |
| 残留错误 | `深便溫→身边溫`（未修）、`顺便问一下` 整段缺失、繁简混排 |
| vs raw | **部分优于 raw**（中杯、蓝莓马芬正确），**未优于 ref** |
| 新错误 | 未引入明显新词，但 **未消除 ASR 乱码区** |

### 高 delta 样本摘要

| id | maxDelta | repl | raw 问题 | candidate 改进 | 仍存问题 |
|----|----------|------|----------|------------------|----------|
| d079 | 0.00748 | 6 | 繁体 `開通` `帶` `麼` | 简繁混改 `带` `证件` | 仍繁简混排 |
| d036 | 0.00687 | 5 | `立财` `等急` | `在那里` 等 | `立财` 未改、`等急` 未改 |
| d081 | 0.00453 | 2 | 繁体 `請問理財` | `在哪里` | `理睬` 误替换 |
| d048 | 0.00293 | 5 | `少病` `小背` | `小杯` | **`烧饼`** 替换 `少冰`（新错误） |
| d012 | 0.00277 | 7 | `我過敏` | `报告` `时候` | **`我国民`** 新错误 |
| d003 | 0.00245 | 5 | `烧病` `小背` | 部分冰/杯 | 仍有 `烧病` |
| d001 | 0.00011 | 8 | 多处 ASR 错 | 中杯、马芬 | 顺便问、深便溫 |

（完整 21 条见 `tests/experiments/kenlm-audit-batch-stats.json`）

---

## 替换类型统计（top-1 candidate）

| 类型 | 定义 | 比例 |
|------|------|------|
| 单替换 | replacementCount = 1 | 8.6% |
| 多替换 | replacementCount > 1 | 91.4% |
| 混合替换 | 同一句含 phonetic + domain 等多 source span | 多数案（span 来自不同 recall source） |

---

## bestCandidate 是否优于 raw？

| 判定 | 案数（目测 + delta 方向） | 说明 |
|------|--------------------------|------|
| **LM 分更高（delta>0）** | 55 / 81 | KenLM 认为 candidate 更好 |
| **LM 分更低（delta<0）** | 26 / 81 | 联合替换整体更差 |
| **语义优于 raw** | ~60% | 至少修对部分 ASR 错词 |
| **语义劣于或引入新错** | ~15% | 如 d048 `烧饼`、d012 `我国民` |
| **与 ref 等价** | **0** | 无案达到 ref 质量 |

**bestCandidate 在语义上「多数略优于 raw」，但远未达到 ref；部分案引入明显新错误。**

---

## 典型案例

### 案例 A — delta 最高仍不 Apply（d079）

- raw：`我想開通短信提醒需要帶什麼證件`  
- best：`我想開通短信提醒需要带什麼证件`  
- delta=0.00748 < 0.03 → **KenLM 认可改进但 gate 阻断**  
- 质量：简繁混排，优于 raw 的「帶/證件」部分  

### 案例 B — candidate 引入新错误（d048）

- raw：`少病`  
- best：`烧饼`（替换 `少冰` 目标）  
- delta>0 → **LM 反而偏好含错句**  
- 说明：**delta 高 ≠ 语义正确**

### 案例 C — 多替换稀释收益（d001）

- 8 处替换中 2~3 处有效，其余 span 错误或乱码未触达  
- maxDelta 仅 0.00011 → 全句 LM 提升极弱  

---

## PASS / FAIL

| 维度 | 判定 |
|------|------|
| candidate 整体优于 raw（语义） | **部分 PASS**（多数有局部改进） |
| candidate 无新错误 | **FAIL** |
| bestCandidate 达 ref 质量 | **FAIL** |
| 句子适合 KenLM 判别 | **FAIL**（多替换 + 混排 + 残留乱码） |

**综合：FAIL（质量不足以支撑可靠 Apply，且部分引入新错）**

---

## 风险项

1. **91% 为多替换句**，一处坏替换可拉低整句 LM 分（26 案 delta<0）。  
2. **bestCandidate 按 delta 选**，d048 等案 LM 偏好含 **烧饼** 的句。  
3. **乱码/未 recall 区段**（d001「顺便问一下」）无法靠 span 替换改善。  
4. 即使质量最好的 d079（delta=0.0075），仍 **低于 gate 0.03**。

---

## 结论

送入 KenLM 的 candidate **多数在局部词级优于 raw**，但 **没有任何案达到 ref 句质量**；约 15% 引入新错误；91% 为多 span 联合句，错误 span 拖累整句 score。  

KenLM 不给通过：**一方面 delta 尺度不足（P2）**；另一方面 **即使 delta 最高的句仍含明显 ASR/替换错误**，LM 无法区分「略好」与「够好」。  

**问题位于：KenLM 输入句质量层 + Delta 尺度层**（非 Apply 映射逻辑）。
