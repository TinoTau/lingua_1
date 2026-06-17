# KenLM Audit P5 — Model Coverage

**审计日期：** 2026-06-17  
**模型：** `kenLM/model/zh_char_3gram.trie.bin`（字符级 3-gram）  
**训练语料：** `kenLM/corpus/zh_sentences.raw.txt`（Hugging Face 中文新闻摘要，约 43.9 万句）

---

## 目标

确认 KenLM 是否认识咖啡/餐饮/口语领域词；检查 arpa 词表、训练语料、OOV；统计抽样词与 Top100 领域/基础词覆盖率。

---

## 代码位置

| 环节 | 文件 |
|------|------|
| 模型路径解析 | `phonetic-correction/lm-scorer.ts` → `resolveCharLmModelPath` |
| Tokenize | `phonetic-correction/char-tokenize.ts` |
| 训练产物 | `kenLM/model/zh_char_3gram.arpa`（119 MB） |
| 训练说明 | `kenLM/README.md` |

---

## 调用链

```text
term / sentence
  → tokenizeForLm（字符级）
  → KenLM query(trie.bin)
  → Total + OOV count
```

字符级 LM：**OOV 以 token（字）为单位**，非词级。

---

## 模型与词表

| 项 | 值 |
|----|-----|
| ARPA 路径 | `kenLM/model/zh_char_3gram.arpa` |
| 1-gram 词表大小 | **9964**（含 `<unk>`, `<s>`, `</s>`） |
| 2-gram | 833,530 |
| 3-gram | 4,318,158 |
| 训练归一化 | NFKC + trim（`normalize_corpus.py`） |
| 语料域 | **新闻摘要**，非餐饮对话 |

---

## 抽样词 OOV 审计

| 词 | tokenized | ARPA 字 OOV | Query OOV | Query Score |
|----|-----------|-------------|-----------|-------------|
| 中杯 | 中 杯 | 0 | **0** | -8.30 |
| 少糖 | 少 糖 | 0 | **0** | -10.57 |
| 拿铁 | 拿 铁 | 0 | **0** | -9.59 |
| 蓝莓马芬 | 蓝 莓 马 芬 | 0 | **0** | -17.63 |
| 大杯 | 大 杯 | 0 | **0** | -8.41 |
| 热美式 | 热 美 式 | 0 | **0** | -13.16 |
| 带走 | 带 走 | 0 | **0** | -9.89 |
| 顺便问一下 | 顺 便 问 一 下 | 0 | **0** | -12.21 |

**抽样 OOV Rate：0 / 8 = 0%**（所有字均在词表内）

---

## Top100 覆盖率

来源：dialog_200 `cases.manifest.json` ref 句 bigram（字符对）。

| 集合 | 样本数 | 字覆盖率 | Bigram 覆盖率 | 未命中 |
|------|--------|----------|---------------|--------|
| **Top100 Domain**（scenario=cafe） | 100 | **100%** | **100%** | 无 |
| **Top100 Base**（全场景前 100 bigram） | 100 | **100%** | **100%** | 无 |

**说明：** 字符级词表 9964 字覆盖常用汉字；cafe 领域词由常用字组成，**不因 OOV 失分**。

---

## 训练语料与领域匹配

| 维度 | 评估 |
|------|------|
| 语料类型 | 新闻书面语 |
| 餐饮口语 n-gram | **未针对训练**；字表有、**组合概率未必高** |
| 抽样短句 score | -8 ~ -18（短句 log-prob，非 OOV 问题） |

d001 全句 raw score **-97.79**、candidate **-86.80**：句长 ~30 token，分数低因为 **累加 log-prob + 句长**，非不认识「拿铁」「中杯」。

---

## 统计结果

| 指标 | 值 |
|------|-----|
| Vocab size | 9964 |
| 抽样 8 词 OOV Rate | **0%** |
| Top100 Domain 字覆盖率 | **100%** |
| Top100 Base 字覆盖率 | **100%** |
| 批测 81 案 KenLM query OOV（d001 复核） | **0** |

---

## PASS / FAIL

| 维度 | 判定 |
|------|------|
| 领域词字级 OOV | **PASS** |
| 词表 / arpa 可加载 | **PASS** |
| 餐饮 domain n-gram 概率质量 | **未测 / 非 OOV 问题** |
| 模型域与 dialog_200 口语域匹配 | **FAIL**（语料域偏差，非字表缺失） |

**综合：PASS（无 OOV 阻断）/ 语料域 FAIL（不影响 OOV 统计）**

---

## 风险项

1. **字符级覆盖 ≠ 领域短语流畅**：「蓝莓马芬」字字认识，但 3-gram 在新闻语料中可能罕见 → **prob 低、delta 小**。  
2. **训练语料无餐饮对话**，口语 bigram（如「少糖」「中杯」） LM 先验弱于新闻常见搭配。  
3. **OOV 统计对字符 LM 过于乐观**；真正瓶颈是 **prob 绝对值与 sigmoid 压缩**（P2）。  
4. ARPA 未打包进 electron 运行时路径时依赖 `PROJECT_ROOT` 探测，属部署风险，与本次批测无关（query 已成功）。

---

## 结论

KenLM **认识**抽样领域词（OOV=0）；Top100 domain/base 字字命中。  

FW Apply=0 **不是因为模型 OOV 或不认识「中杯/拿铁/蓝莓马芬」**。  

未通过原因是：**整句 log-prob 经 sigmoid 后 delta 过小（P2）+ gate 0.03（P6）**；语料域为新闻而非口语，可能压低餐饮搭配的相对概率，但表现为 **delta 小** 而非 **OOV 拒识**。  

**问题位于：Score/Delta 层与 Gate 层，非 Model Coverage / OOV 层**
