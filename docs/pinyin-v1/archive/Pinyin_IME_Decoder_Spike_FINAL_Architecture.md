# Pinyin IME Decoder Spike FINAL Architecture
版本：V1.0 FINAL
日期：2026-06-03

# 一、项目背景

当前 FW 主链：

AudioAggregator
→ FW ASR
→ Detector
→ Recall
→ KenLM
→ NMT

已确认：

- FW 仅提供 Top1
- 无可用 token posterior
- 无可用 lattice
- 中文 words[] 基本为单字
- Detector Miss 为当前最大损失来源

目标不是替换 FW。

目标是验证：

Pinyin IME Decoder 是否能够作为 Candidate Generator，为现有链路提供高价值候选。

---

# 二、冻结架构边界

禁止修改：

- AudioAggregator
- ASR切片逻辑
- ASR Text Chain Fix
- Lexicon V3.1 Runtime
- Scheduler
- Patch Service
- NMT
- TTS

禁止新增：

- JSONL Runtime
- Active Bundle
- Dynamic Bundle
- 第二套 Runtime
- 第二套词库系统

允许：

- 独立 Spike
- Sidecar
- CLI工具
- 临时导出词表

---

# 三、系统定位

不是：

- 新ASR
- 新Detector
- 新Lexicon
- 新Runtime

而是：

Candidate Generator Spike

流程：

rawAsrText
↓
Pinyin Converter
↓
IME Decoder
↓
TopK Candidate Sentences
↓
Diff Generator
↓
KenLM / Sentence Rerank
↓
Final Selection

---

# 四、总体架构

## 4.1 离线 Spike 阶段

Dialog200
↓
rawAsrText
↓
拼音流
↓
IME Decoder
↓
TopK候选句
↓
Reference对比
↓
统计命中率

## 4.2 未来可选接入点

仅允许：

FW Detector之后

或

Recall Empty之后

作为Fallback Candidate Generator。

禁止直接改写最终文本。

---

# 五、模块设计

## 5.1 Lexicon Exporter

职责：

从 Lexicon V3.1 SQLite 导出 IME词典。

来源：

node_runtime/lexicon/v3/lexicon.sqlite

导出条件：

enabled=1

repair_target=1

可选：

domain_id
prior_score
alias

输出：

ime_dict.txt

---

## 5.2 Pinyin Converter

职责：

中文转拼音。

示例：

后选生成和上限计划

→

hou xuan sheng cheng he shang xian ji hua

建议：

复用现有 pinyin-pro。

---

## 5.3 IME Decoder

职责：

拼音流

→

TopK中文候选。

接口：

Input:

{
  "pinyin":"hou xuan sheng cheng",
  "topK":10
}

Output:

{
  "candidates":[
    "候选生成",
    "后选生成",
    "厚选生成"
  ]
}

---

## 5.4 Diff Generator

职责：

rawAsrText

vs

candidate sentence

生成替换差异。

示例：

后选生成
→
候选生成

上限计划
→
上线计划

---

## 5.5 KenLM Reuse

禁止重写。

直接复用现有：

rerankFwSentences

输入：

TopK Candidate Sentences

输出：

Best Candidate

---

# 六、数据结构

## CandidateSentence

```ts
interface CandidateSentence {
  sentence: string;
  score?: number;
  source: "ime";
}
```

## CandidateDiff

```ts
interface CandidateDiff {
  source: string;
  target: string;
}
```

## SpikeResult

```ts
interface SpikeResult {
  rawAsrText: string;
  reference: string;

  top1Hit: boolean;
  top3Hit: boolean;
  top5Hit: boolean;
  top10Hit: boolean;

  candidates: CandidateSentence[];
}
```

# 七、目录规划

tests/
└── spike/
    ├── export-lexicon-v3-ime-dict.mjs
    ├── run-pinyin-ime-dialog200-spike.mjs
    ├── analyze-pinyin-ime-spike.mjs
    └── tmp/

禁止修改主链。

---

# 八、开发阶段

## P1

SQLite导出器

目标：

SQLite
↓
IME Dictionary

验收：

成功导出 repair_target 词表。

## P2

IME Sidecar

目标：

拼音
↓
TopK候选

验收：

返回 Top10 候选。

## P3

Dialog200 Spike

目标：

批量验证。

统计：

Top1
Top3
Top5
Top10

## P4

分析报告

输出：

命中率
延迟
失败分类

---

# 九、Sidecar协议

请求：

POST /decode

{
  "pinyin":"hou xuan sheng cheng",
  "topK":10
}

响应：

{
  "candidates":[
    {
      "text":"候选生成",
      "score":0.91
    }
  ]
}

---

# 十、Lexicon映射规范

SQLite字段

canonical
↓
IME主词条

alias
↓
用户词典

priorScore
↓
候选排序权重

domain_id
↓
Domain Boost

repair_target
↓
是否导出

---

# 十一、Dialog200验证方案

样本：

- Detector Miss
- Recall Empty
- Lexicon Missing

流程：

raw_asr_text
↓
拼音流
↓
IME Decoder
↓
TopK Candidate
↓
Reference 对比

统计：

Top1
Top3
Top5
Top10

---

# 十二、Target List

必须完成：

- SQLite导出器
- IME词典生成
- IME Sidecar
- TopK候选生成
- Dialog200批量测试
- 命中率统计
- 延迟统计
- Markdown报告

必须复用：

- Lexicon V3.1
- pinyin-pro
- KenLM
- Sentence Rerank

---

# 十三、Check List

架构检查：

- 不修改Scheduler
- 不修改Patch Service
- 不修改Runtime
- 不新增JSONL
- 不新增Bundle切换

数据检查：

- 仅读SQLite
- 不新增词库系统

测试检查：

- Dialog200全量
- Detector Miss子集
- Recall Empty子集

结果检查：

- Top1命中率
- Top3命中率
- Top5命中率
- Top10命中率
- P50
- P95

---

# 十四、风险分析

技术风险：

- libpinyin GPL风险
- Windows编译风险
- Domain词覆盖不足
- 中英混杂候选不足

业务风险：

- TopK命中率过低
- 候选爆炸
- KenLM无法有效区分

控制策略：

- 仅Spike
- 不进主链
- 不改冻结架构

---

# 十五、回滚方案

因为不修改主链。

回滚方式：

删除：

tests/spike/

即可。

无需：

- 数据迁移
- Runtime回滚
- 配置回滚

---

# 十六、Freeze Gate

进入下一阶段前必须满足：

Top5命中率 > 15%

Recall Empty Top3 > 25%

P95 < 200ms

否则：

归档Spike。

禁止进入主链。

---

# 十七、Explicit Non Goals

本方案不负责：

- 通用ASR错误检测
- 替代Detector
- 替代Lexicon V3.1
- 替代KenLM
- 替代NMT
- 替代Scheduler

本方案仅验证：

Pinyin IME Decoder

是否能够为现有FW后处理链提供高价值候选。
