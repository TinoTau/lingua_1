# FW Repair V4 — KenLM Phase 03 First Training & Benchmark Regression

| Field | Value |
|-------|-------|
| Date | 2026-08-04 |
| Baseline | **FW_V4_FREEZE_2026_08_03** |
| Benchmark | **KENLM_BENCHMARK_V1**（75 Case，未修改） |
| Nature | **MODEL ONLY** · 全量语料重训 + Benchmark Regression |
| Verdict | **KENLM_FIRST_TRAIN_NOT_BETTER** |

---

## 1. Executive

| 项 | 值 |
|----|----|
| 训练成功 | YES |
| 新模型优于旧模型 | **NO** |
| 提升 Case | **0** |
| 下降 Case | **0** |
| 保持不变 | **75** |
| Correct before → after | **67 → 67** |
| Top1 改变 | **0** |
| Top1 改变且符合 Human Decision | **0** |
| 与旧模型 bit-identical | **YES** |
| 生产模型已替换 | **NO（保持旧模型）** |

---

## 2. Training

| Metric | Value |
|--------|------:|
| Corpus 行数 | 439490 |
| Token 数 | 19712111 |
| Vocabulary Size | 9964 |
| N-Gram 数量（Σ） | 5161652 |
| N-Gram by order | [9964,833530,4318158] |
| ARPA 大小 | 123776221 bytes |
| Binary 大小 | 34995949 bytes |
| NGram Order | 3 |
| Pruning | none |
| Discount | Modified Kneser-Ney (lmplz default) |
| Build | `lmplz -o 3 -S 50%` → `build_binary trie` |

新模型路径：`kenLM/model/phase03_first_train/`  
sha256（新旧相同）：`532a335a09a006d1ba674f808814ee1d40c5b1d8f3527ca980e96723e7a62a4c`

同语料、同参数重训 ⇒ **与生产 trie 字节级一致**，故 Benchmark 排序/分数无变化。未覆盖生产路径。

---

## 3. Answers

### Q1 — 训练是否成功？
**YES**

### Q2 — 新模型是否优于旧模型？
**NO**

### Q3 — 提升多少 Case？
**0**

### Q4 — 下降多少 Case？
**0**

### Q5 — 是否值得替换当前 KenLM？
**NO**

---

## 4. Failures after train（相对 Human Decision）

仍失败：**8**（与旧模型相同，因模型相同）

| Class | Count |
|-------|------:|
| Domain | 4 |
| Language | 4 |

未修改 Runtime / Recall / Candidate。

---

## 5. Final Verdict

```text
KENLM_FIRST_TRAIN_NOT_BETTER

训练成功。

但 Benchmark Regression 未优于当前模型。

保持旧模型。
```
