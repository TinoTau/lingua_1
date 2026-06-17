# KenLM Audit P3 — Normalization

**审计日期：** 2026-06-17  
**数据批次：** d001 + dialog_200 批测

---

## 目标

确认 raw 与 candidate 进入 KenLM 前是否同口径；检查繁简、标点、空格、大小写、全角半角、中英混排、特殊字符处理是否一致。

---

## 代码位置

| 环节 | 文件 | 函数 |
|------|------|------|
| 句候选拼装 | `fw-detector/build-sentence-candidates.ts` | `applyReplacementsRightToLeft` |
| KenLM 入口归一 | `phonetic-correction/char-tokenize.ts` | `normalizeTextForLm` / `tokenizeForLm` |
| 训练对齐 | `scripts/kenlm/lib/tokenize_char.py` | `normalize_line` / `tokenize_line` |
| 语料预处理 | `scripts/kenlm/normalize_corpus.py` | NFKC + trim |

---

## 调用链

### raw 流程

```text
ASR rawText（原样字节，含繁简/标点/乱码）
  → rerankFwSentences: sentences[0] = rawText（无预处理）
  → lm-scorer.score(rawText)
       → tokenizeForLm(rawText)
            → normalizeTextForLm: NFKC + trim
            → 逐字 CJK / 拉丁连续 / 数字 / KEEP_PUNCT
            → 空格连接 token 串
       → KenLM query(stdin = tokenized)
```

### candidate 流程

```text
rawText + span replacements（字符串 splice，无 NFKC）
  → buildSentenceCandidates → SentenceCombination.text
  → rerankFwSentences: sentences[i+1] = candidate.text
  → lm-scorer.score(candidate.text)
       → tokenizeForLm（与 raw 完全相同路径）
       → KenLM query
```

---

## 逐步转换图（d001 实测）

| 步骤 | raw | best candidate |
|------|-----|----------------|
| ① 进入 KenLM 前原串 | `你好,我想點一杯熱拿鐵鐘貝少糖 深便溫 以下今天有蓝美马分吗?` | `你好,我想點一杯熱拿铁中杯少糖 身边溫 以下今天有蓝莓马芬吗?` |
| ② NFKC + trim | 同上（本句无全角 ASCII 需转换） | 同上 |
| ③ tokenizeForLm | `你 好 , 我 想 點 一 杯 熱 拿 鐵 鐘 貝 少 糖 深 便 溫 以 下 今 天 有 蓝 美 马 分 吗 ?` | `你 好 , 我 想 點 一 杯 熱 拿 铁 中 杯 少 糖 身 边 溫 以 下 今 天 有 蓝 莓 马 芬 吗 ?` |
| ④ KenLM OOV | 0 | 0 |

**差异仅在 token 内容（替换字），不在 tokenize 规则。**

---

## 分项检查

| 维度 | raw | candidate | KenLM 入口是否同规则 |
|------|-----|-----------|---------------------|
| **繁简** | 保留 ASR 原样（如 `點` `熱` `鐵`） | 替换词多为简（如 `铁` `中杯`） | **同规则**；但句内繁简混排是拼装产物，非 tokenize 差异 |
| **标点** | ASR `,` `?` 保留 | 继承 raw 区段标点 + 替换区无标点变化 | **同规则**（KEEP_PUNCT 一致） |
| **空格** | ASR 内空格跳过、不分 token | 同 | **同规则** |
| **大小写** | 拉丁段 `[A-Za-z][A-Za-z0-9]*` | 同 | **同规则** |
| **全角半角** | NFKC 归一 | 同 | **同规则** |
| **中英混排** | CJK 逐字 + 拉丁/数字段 | 同 | **同规则** |
| **特殊字符** | 不在 KEEP_PUNCT 且非 CJK/拉丁/数字 → **跳过** | 同 | **同规则** |

训练脚本 `tokenize_char.py` 与 Node `char-tokenize.ts` 注释声明 **规则一致**。

---

## 是否存在处理规则不一致？

| 层级 | 不一致？ | 说明 |
|------|----------|------|
| **KenLM 入口 tokenize** | **否** | raw / candidate 均走 `tokenizeForLm` |
| **句候选拼装（KenLM 前）** | **是（结构性）** | candidate 由 raw 局部替换生成，**未做 NFKC/繁简统一**；替换词简、未替换区繁，导致 **句内繁简混排** |
| **训练语料 vs 推理** | **部分** | 训练：`normalize_line`（NFKC）+ 新闻摘要；推理：ASR 噪声 + 乱码字符（如 ``）在 tokenize 时被 **丢弃** |

### d001 繁简混排示例

- raw：`點` `熱` `鐵`（繁）+ `蓝`（简）  
- candidate：`點` `熱`（未替换区繁）+ `铁` `中` `杯`（简）+ `溫`（繁，未修）  

**KenLM 对两者使用相同 tokenize，但 candidate 文本本身混排，与 ref 纯简不一致。**

---

## 统计结果

- KenLM 入口：**100% 同函数、同 KEEP_PUNCT、同 NFKC**  
- 句级拼装：**无统一繁简/标点规范化**  
- 乱码字符：tokenize **静默丢弃**（不计 OOV，也不计 token）

---

## PASS / FAIL

| 维度 | 判定 |
|------|------|
| KenLM adapter 层 raw/candidate 同口径 | **PASS** |
| 句候选生成层文本一致性 | **FAIL**（繁简/乱码区未统一） |
| 训练 tokenize 与推理 tokenize 对齐 | **PASS** |

**综合：PASS（KenLM 入口同口径）/ FAIL（candidate 句内文本质量混排）**

---

## 风险项

1. **替换只改 span，不 normalize 全句**，LM 看到的是「繁简混合句」，与 ref / 训练语料风格偏离。  
2. **非 KEEP_PUNCT 乱码被跳过**，raw 与 candidate 可能在乱码处 token 数相同但语义不同。  
3. **标点不统一**（`,` vs `，`）在 d001 均为半角逗号，未触发 NFKC 标点转换；其他案可能半角/全角并存。  
4. 归一化不一致 **不导致 delta 虚高**；反而可能压低 candidate 相对 raw 的 LM 优势。

---

## 结论

进入 KenLM 前，raw 与 candidate **共用同一 `tokenizeForLm` 路径**，不存在 adapter 层双轨规则。  

不一致发生在 **更上游的句候选拼装**：candidate 是 raw 的局部 patch，**未做全句繁简/标点统一**，导致送入 LM 的句子仍含 ASR 错误与混排。  

**KenLM 不给通过的主因不在 normalization 双轨**（见 P2 delta 尺度、P6 gate）； normalization 混排是 **candidate 质量风险**，非 gate 直接阻断项。

**问题位于：句候选文本层（拼装）> KenLM adapter 层（已对齐）**
