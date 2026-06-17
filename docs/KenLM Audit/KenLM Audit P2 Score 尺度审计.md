# KenLM Audit P2

## Score 尺度审计

目标：

解释：

为什么：

maxDelta

≈ 0.0001

P95

≈ 0.0027

---

审计：

KenLM score

delta

normalizedScore

相关代码。

---

回答：

### 1

KenLM 原始返回值。

---

### 2

是否进行了：

归一化

长度惩罚

缩放

Clamp

Round

其它处理。

---

### 3

delta 公式。

完整展开。

---

### 4

举例：

raw

candidate

score

delta

逐步计算。

---

### 5

统计：

delta

理论范围。

---

### 6

判断：

minDeltaToReplace=0.03

是否与当前 score 尺度匹配。

---

禁止修改代码。

只回答：

当前 score 体系是否合理。
