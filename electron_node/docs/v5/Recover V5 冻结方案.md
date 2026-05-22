Recover V5 冻结方案：Scored Legal Lexicon TopK Recall

版本：V5-Freeze
日期：2026-05-22
状态：冻结版架构方案（开发前最终版）

一、方案目标

当前 Recover V4 已恢复：

CTC n-best
→ 多窗口
→ 拼音候选
→ SentenceCandidate
→ KenLM rerank

但当前最大瓶颈已经变成：

真实世界 ASR 错误
无法进入 WindowCandidate

根因：

observed/confusion coverage 不足

因此：

Recover V4.2 不再以：

observed/confusion 显式映射

为核心。

而是升级为：

Scored Legal Lexicon TopK Recall

即：

拼音窗口
→ 合法词 TopK
→ SentenceCandidate
→ KenLM 句级过滤
二、核心原则（冻结）
P1：候选必须来自合法词库

禁止：

动态造词
自由拼音生成
无限 near_phoneme

允许：

词库合法词

候选必须来源于：

scored lexicon
P2：拼音只是 lookup key

拼音作用：

查词

不是：

生成词

即：

window pinyin
→ lookup
→ legal terms

而不是：

runtime 拼音自由组合
P3：候选必须带 priorScore

每个词必须带：

{
  "word": "候选生成",
  "pinyin": "hou xuan sheng cheng",
  "priorScore": 8.5
}

priorScore 来源：

运营方定期维护

Recover 不负责学习。

P4：KenLM 只负责句级过滤

KenLM 不能：

从无限候选中找答案

KenLM 只能：

在 TopK 候选句中
选择最通顺句子
P5：窗口必须由 n-best 差异触发

禁止：

全句滑窗

窗口来源必须是：

top1 与 n-best 差异 span
三、最终冻结工作流

冻结链路：

CTC n-best
→ diff span detection
→ context expansion
→ 2/3/4/5 字切片
→ pinyin normalize
→ scored lexicon TopK lookup
→ WindowCandidate
→ SentenceCandidate combination
→ KenLM rerank
→ safety gates
→ applySentenceRepair
四、Diff Span Gate（冻结）
输入

来自：

CTC hypotheses

例如：

top1:
候选生层

nbest:
候选生成
输出

diff span：

生层 ↔ 生成

并扩：

左右各 1~2 字

形成 context window。

五、Window Expansion（冻结）
窗口来源

只允许：

diff span context

禁止：

全句扫描
切片长度（冻结）

允许：

2 字
3 字
4 字
5 字

禁止：

1 字
6+ 字

原因：

1 字歧义过高
6+ 字组合爆炸
六、Scored Lexicon（冻结）
词条结构

冻结：

{
  "id": "term-0001",
  "word": "候选生成",
  "pinyin": "hou xuan sheng cheng",
  "priorScore": 8.5,
  "frequency": 100,
  "domain": "asr",
  "enabled": true,
  "tags": ["technical"]
}
priorScore

来源：

运营方维护

Recover 不自动学习。

七、TopK Recall（冻结）
recall 规则
window pinyin
→ lookup same/near pinyin
→ legal term TopK
TopK（冻结）
2 字词
Top5
3 字词
Top5
4 字词
Top3
5 字词
Top2

原因：

4/5 字通常是：
成语
专名
术语

误修风险更高。

八、Candidate Score（冻结）
candidateScore

冻结：

candidateScore =
priorScore
+ phoneticSimilarity
+ exactLengthBonus
+ domainBoost
- editDistancePenalty
不允许

禁止：

只按 phoneticSimilarity 排序

否则：

合法随机词
会大量进入候选池
九、多窗口组合（冻结）
maxActiveWindows

冻结：

2

第一版不允许：

3+

原因：

组合爆炸
maxCandidatesPerWindow

冻结：

5
maxSentenceCandidates

冻结：

32
十、KenLM（冻结）
KenLM 职责

只负责：

句级过滤

不负责：

自由搜索
输入

KenLM 只接收：

SentenceCandidate

不是：

全量同音词
十一、安全门控（冻结）
不修条件

必须 skip：

no_diff_span
n-best 无差异
no_topk_candidate
没有合法词候选
low_candidate_score
candidateScore 太低
kenlm_worse_than_baseline
句子通顺度明显更差
replacement_count_exceeded
replacement 太多
十二、Baseline 约束（冻结）
raw hypothesis

允许：

作为 baseline score reference

禁止：

raw hypothesis 直接 final pick

否则：

会退回 V2 rerank 架构
十三、多音字约束（冻结）

禁止：

runtime 全量多音组合

正确方式：

词条保存完整 pinyin

例如：

{
  "word": "银行",
  "pinyin": "yin hang"
}
十四、中英混合（冻结）

必须允许：

AI
GPU
taxi
cafe
hospital

作为：

合法 token

进入词库。

十五、可观测性（冻结）

每个候选必须输出：

{
  "windowText": "...",
  "windowPinyin": "...",
  "candidate": "...",
  "candidatePinyin": "...",
  "candidateScore": 8.5,
  "priorScore": 8.0,
  "phoneticScore": 0.96,
  "termLength": 3,
  "rankInTopK": 1,
  "source": "lexicon_pinyin_topk",
  "kenlmScore": -12.3,
  "picked": true
}

禁止：

console-only diagnostics

必须进入：

result json
十六、阶段边界（冻结）
V4.2 负责
Scored Lexicon TopK Recall
V4.2 不负责
KenLM 调权重
ASR 模型训练
Cross-segment recall
near_phoneme 无限扩展
semantic rewrite
LLM rerank
十七、最终目标

Recover V4.2 的目标不是：

无限生成候选

而是：

从：
有限高质量合法词
生成：
有限高质量句级候选
再由 KenLM 选择最通顺结果
十八、最终冻结结论

Recover V4.2 最终冻结为：

CTC n-best 差异驱动
+
Scored Legal Lexicon TopK Recall
+
有限多窗口组合
+
KenLM 句级过滤

这是当前：

性能
复杂度
可维护性
识别质量

之间最合理的平衡点。

---

## 十九、已确认架构决策（2026-05-22）

详细条文见 [Recover_V5_Frozen_Decisions_2026-05-22.md](./Recover_V5_Frozen_Decisions_2026-05-22.md)。

| 决策 | 结论 |
|------|------|
| V5 vs V4 recall | **彻底替换** V4 主链，不保留 observed/滑窗主路径 |
| Near pinyin | **允许**，音节差 ≤2、同词长、禁全表扫描 |
| Active windows | **固定 2** |
| Runtime 学习 | **绝对禁止**（prior 仅运营/build） |
| 英文 token | **仅 exact lookup**（bundle 显式 pinyin） |
| KenLM baseline | **`kenlmBaselineTolerance = 0.15`** |
| Chunk / 窗区 | **禁止跨 chunk**；**仅在 diff context 内** 做 2–3 + 4–5 双尺度 TopK（禁止整 chunk、无 diff 不扫窗） |