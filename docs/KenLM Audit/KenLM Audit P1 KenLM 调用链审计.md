# KenLM Audit P1

## KenLM 调用链审计

目标：

确认：

SentenceCandidate
→ KenLM
→ Delta
→ Apply

链路无缺失。

---

请审计：

runFwSentenceRerankFromPrefilled()

及相关调用链。

---

回答：

### 1

raw sentence

在哪里加入候选集。

---

### 2

candidate sentence

在哪里加入候选集。

---

### 3

KenLM 实际评分数量。

输出：

raw

candidate

total

---

### 4

是否存在：

候选未进入 KenLM

raw 未进入 KenLM

重复评分

跳过评分

---

### 5

KenLM 输出结构。

包括：

rawScore

bestScore

bestSentence

delta

pickedIsRaw

---

### 6

Apply 最终使用哪些字段。

---

输出：

调用链图

数据结构图

问题清单

PASS/FAIL
