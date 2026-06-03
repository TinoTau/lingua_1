# Pinyin IME V1 Decoder Capability Audit

**日期**：2026-06-03  
**审计类型**：只读（未修改代码/配置/主链）  
**范围**：`tests/spike/lib/ime-dict-decoder.mjs`、`dict-load.mjs`、`pinyin-stream.mjs`、`run-pinyin-ime-v1-dialog200.mjs`、`pinyin-ime-v1-sidecar.mjs`、`kenlm-spike.mjs`  
**数据**：`tmp/pinyin-ime-v1/base_dictionary.txt`（72193 行）、`pinyin-ime-v1-dialog200-results.json`（117 cases）

**结论先行**：当前 pinyin-ime-v1 已完成 **词典工程 + 极简 beam 路径匹配器（dict_dp）**，**尚未**完成可称为生产级 **Pinyin IME Decoder** 的能力栈。Dialog200 `topK=0` 的主因是 **严格全音节覆盖 + 无单字/unknown/gap**，而非三层词典导出失败。

---

## 1. Executive Summary

| 问题 | 答案 |
|------|------|
| 是否已完成真正 IME Decoder？ | **否** — 仅为 **dictionary path matcher + 有限 beam** |
| 更像词典工程还是解码器工程？ | **词典工程为主（~70%）**；解码器 **~30%**（基础 beam，无 IME 核心机制） |
| dict_dp 是否过于严格？ | **是** — 要求 **100% 音节序列被词典短语无缝覆盖** |
| topK=0 主因？ | **B 严格路径匹配** + **F 无功能单字连接** + **ASR 字面拼音链错误**（非单纯缺词） |
| 是否允许入主链？ | **否** |

---

## 2. Implementation Coverage Matrix

| # | 能力 | 状态 | 代码依据 |
|---|------|------|----------|
| 1 | Trie / Prefix Index | **Partial** | 仅 `byFirst`（首音节 → 词条列表），无完整前缀 Trie |
| 2 | Beam Search | **Done** | `decodeSyllablesTopK`，`BEAM_WIDTH=48` |
| 3 | Path Scoring | **Partial** | 累加 `prior`/`imeWeight`，无语言模型路径分 |
| 4 | Unknown Token | **Missing** | 无 `<unk>` / 单音节占位 |
| 5 | Gap Penalty | **Missing** | 不允许跳过音节 |
| 6 | Partial Decode | **Missing** | 仅返回 `pos === syllables.length` 的完整路径 |
| 7 | Candidate Reconstruction | **Done** | `text = state.text + entry.word` |
| 8 | TopK Candidate Generation | **Done** | 完整路径去重后取 topK |
| 9 | Candidate Sentence Ranking | **Partial** | KenLM rerank 有实现，**依赖先有候选** |
| 10 | Multi-pronunciation Handling | **Missing** | 每 surface 单一 `pinyin_key` |
| 11 | Near-Pinyin Matching | **Missing** | 音节必须 exact match |
| 12 | English Mixed Text Handling | **Partial** | 非 CJK 整句标 `english_mixed`；CJK 段内英文标点混排未切分 |
| 13 | Segment Boundary Discovery | **Missing** | 整段 CJK 一次转拼音，无 ASR 断句/VAD 对齐 |
| 14 | Function Single Character Support | **Missing** | 导出 base **0 条单字** |
| 15 | Content Single Character Fallback | **Missing** | 同上 |
| 16 | Candidate Diff Generation | **Done** | `diff-align.mjs` |
| 17 | KenLM Would Apply | **Done** | `kenlm-spike.mjs` + `target-dictionary-index` |
| 18 | Long Sentence Decode | **Partial** | 无长度硬限，但 **长句更易在某音节断链 → 0 候选** |
| 19 | Domain Boost | **Done** | domain 层 merge + `enabledDomains` 过滤 |
| 20 | Target Boost | **Done** | target 键 ×1.25 |

**Done：5 | Partial：8 | Missing：7**

---

## 3. dict_dp Mechanism Report

**审计对象**：`lib/ime-dict-decoder.mjs`

| # | 问题 | 结论 |
|---|------|------|
| 1 | 是否是真正 IME Decoder？ | **否**。无音节 lattice、无 unk/gap、无分词歧义消解，是 **词典驱动的确定性短语拼接** |
| 2 | 是否只是严格词典路径匹配？ | **是**。每一步必须在 `byFirst[syllables[pos]]` 中找到 **音节完全相等** 的词条 |
| 3 | 是否要求完整路径覆盖？ | **是**。`finished = beam.filter(s => s.pos === syllables.length)`，少一个音节即 **0 输出** |
| 4 | 是否支持 unknown token？ | **否** |
| 5 | 是否支持 gap？ | **否** |
| 6 | 是否支持 partial decode？ | **否**（不返回未走完的路径作候选） |
| 7 | 是否支持 beam fallback？ | **否**。`next.length === 0` 时 **直接 break**，无降级 |
| 8 | 是否支持 segmentation ambiguity？ | **否**。无重叠切分竞争，仅固定短语长度匹配 |
| 9 | 是否支持长句？ | **算法上可跑**；**效果上** 27–37 音节 Dialog200 句 **0/87 完整解码** |
| 10 | topK=0 根本原因？ | 见 §6；核心是 **早停断链**（多数在音节 0–12 处 `nextSize=0`） |

**机制示意**：

```
syllables[0..N) ──► beam 每步：从 byFirst[syl[pos]] 找 len 音节完全匹配的 phrase
                  ──► 若无匹配：beam 清空 → 结束 → topK=0
                  ──► 若有匹配且 pos==N：输出候选
```

---

## 4. Single Character Strategy Report

### 4.1 词长分布（merge 后 decode 词表，72112 entries）

| 字数 | 数量 | 占比（约） |
|------|------|-----------|
| 1 字 | **0** | 0% |
| 2 字 | 40514 | 56.1% |
| 3 字 | 9486 | 13.1% |
| 4 字 | 22192 | 30.7% |
| 5 字 | 0 | 0% |
| >5 字 | 0 | 0% |

来源：`base_dictionary.txt`（`is_alias=0`）+ `domain_dictionary.txt`；idiom 多为 4 字。

### 4.2 首音节分支度（beam 爆炸风险）

| 首音节 | 词条数 |
|--------|--------|
| yi | 1713 |
| shi | 1232 |
| ji | 1074 |
| bu | 963 |

`BEAM_WIDTH=48` 可抑制宽度，但 **无单字桥接** 时仍会在错误 ASR 音节处 **断链**（非爆炸而是 **过早死亡**）。

### 4.3 功能/实义/生僻单字

| 类别 | 导出词典中 | 代码是否区分 |
|------|------------|--------------|
| A. Function Single Character（这/那/去/来/在/和/了/的/吗/呢/啊/把/给） | **0** | **否** |
| B. Content Single Character（车/票/药/…） | **0** | **否** |
| C. Rare Single Character | **0** | **否** |

### 4.4 必答

| # | 问题 | 答案 |
|---|------|------|
| 1 | 是否导出大量单字？ | **否，0 条** |
| 2 | 单字是否参与主路径？ | **否**（不存在） |
| 3 | Beam Explosion 风险？ | **中等**（首音节分支上千）；当前主要问题是 **断链** 而非爆炸 |
| 4 | 无单字是否导致路径断裂？ | **是**。ASR 错字→错音节链→无 2–4 字短语可衔接→**nextSize=0** |

**建议约束（下一轮文档）**：

- 功能单字：**受控白名单**，低 prior，仅用于连接；**不**进入主 beam 全量竞争
- 内容单字：**fallback 层**，仅在 beam 断链时启用
- 生僻单字：**默认禁止** 进入 decode 索引

---

## 5. TopK Zero Root Cause Report

**样本**：`pinyin-ime-v1-dialog200-results.json`（117 cases；87 有 CJK 拼音流，30 `english_mixed`）

**聚合**：

| 指标 | 值 |
|------|-----|
| 完整句候选 >0 | **0 / 87** |
| 前缀 4–12 音节可解码 | **38 / 87** |
| english_mixed（无/空 raw） | **30** |

### 5.1 十例抽样

| id | rawAsrText（节选） | 音节数 | 断链位置 | nextSize@断链 | 分类 |
|----|-------------------|--------|----------|---------------|------|
| d001 | 你好…热拿铁钟贝少糖… | 27 | pos **2**（`wo`） | 0 | **B+F** |
| d002 | 麻烦帮我做一杯美食… | 16 | pos **2**（`bang`） | 0 | **B+F** |
| d003 | 请问这款燕麦拿铁… | 19 | pos **2**（`zhe`） | 0 | **B+F** |
| d004 | 小陈客户反馈…包错… | 32 | pos **12**（`bao`） | 0 | **B**（前缀可部分解码） |
| d005 | 今天…订单中台… | 37 | pos **2**（`de`） | 0 | **B+F** |
| d006 | 跟会员系统… | 28 | pos **0**（`gen`） | 0 | **B+A?** |
| d007 | 师傅去中关村… | 30 | pos **2**（`qu`） | 0 | **B+F** |
| d008 | 麻烦送我到国贸… | 26 | pos **2**（`song`） | 0 | **B+F** |
| d009 | 去望京SOHO… | 19 | pos **8**（`huan`） | 0 | **B** |
| d010 | 医生您好…血常规 | 20 | pos **4**（`wo`） | 0 | **B+F** |

**分类说明**：

- **A 词典缺失**：少数首音节无池（如 d006 `gen` pool=71 但 nextSize=0 — 更似 **B** 非缺池）
- **B 严格路径匹配**：**主因** — 后续音节序列无法被任一 2–4 字词条覆盖
- **C/D/E**：无 unknown/gap/partial → 断链即失败
- **F 无功能单字**：无法在「你好」与「我想」等之间用单字/助词桥接错误音节
- **G 中英混排**：30 条无 CJK 流（504/空 ASR）；有 CJK 的句中混排未单独处理

**典型断链（d001）**：

```
pinyin: ni hao | wo xiang dian yi bei re na tie ...
step0: ni → 匹配「你好」等 → pos=2
step1: wo → pool 82 条，但无词条 syllables = wo,xiang,... 与 ASR 链对齐 → nextSize=0 → topK=0
```

---

## 6. Required Data Report

下一轮 **Decoder 开发** 需补充的数据（非命名/导出）：

| # | 数据 | 用途 |
|---|------|------|
| 1 | 词元长度分布（已有：2/3/4 为主，**0 单字**） | 确认 fallback 策略 |
| 2 | 功能单字白名单覆盖率 | 连接词/助词是否够 |
| 3 | 内容单字 fallback 集规模与 prior | 断链恢复 |
| 4 | domain 词在 Dialog200 的命中率 | 26 行 domain 是否够 |
| 5 | target boost 有效对（surface 在 ASR 错句中出现率） | 避免无效 boost |
| 6 | 同音 vs 非同音 ASR 错误占比 | 决定 near-pinyin 优先级 |
| 7 | ASR 拼音链 vs 参考句拼音链 CER | 量化「字面拼音输入」上限 |
| 8 | candidate=0 样本按 A–H 分类计数 | 指导 decoder 迭代 |
| 9 | beam 断链 pos 分布直方图 | 验证单字/unk 插入点 |
| 10 | libpinyin 同批 topK 对照 | 判断 dict_dp 上限 |

---

## 7. Required Constraint Report

建议写入 Freeze Plan / 架构补充：

| # | 约束 |
|---|------|
| 1 | **禁止** 每句 decode 查 SQLite；仅启动时加载内存索引 |
| 2 | 必须使用 **内存索引**（`byFirst` 或 Trie）；可预热 sidecar |
| 3 | **soft limit**：beam width、候选池 per syllable（如 512） |
| 4 | **hard limit**：音节数 ≤80、topK ≤16、decode 超时 |
| 5 | **decode P95** < 200ms（Spike Gate 已有） |
| 6 | **function single character**：白名单 + 低 prior + 限频进入 beam |
| 7 | **content single character fallback**：仅断链时启用 |
| 8 | **rare single character ban**：默认不进索引 |
| 9 | **2–5 字词元** 为主路径；单字为例外通道 |
| 10 | **target_dictionary 只能 boost**，不可替代 base merge |
| 11 | **candidate 不得直接写** `segmentForJobResult` / `text_asr` |
| 12 | 入主链前 **必须** KenLM would-apply 门控 + FW apply 路径 |

---

## 8. Next Development Direction Report

| 选项 | 描述 | 改动量 | topK>0 可能性 | 冻结架构符合 | 风险 |
|------|------|--------|---------------|--------------|------|
| **C** | 功能单字 + 基础词元补全 | 小–中 | **中–高** | **高** | 低 |
| **A** | dict_dp + unknown/gap/partial | 中 | **中** | **高** | 中（控制流变复杂） |
| **B** | libpinyin 对照 | 中 | **高** | 中（GPL sidecar） | 中–高 |
| **D** | Lexicon-aware Detector | 大 | 中（不同路径） | 高 | 低 |
| **E** | 训练小模型 | 很大 | 不确定 | 低 | **最高** |

**推荐排序**：**C → A → B → D → E**

| 问题 | 答案 |
|------|------|
| 改动最小？ | **C**（数据+白名单单字层） |
| 最可能 topK 非零？ | **B**（真 IME）或 **C+A**（补桥接） |
| 最符合冻结架构？ | **C / A**（仍在 `tests/spike/`） |
| 风险最大？ | **E** |

---

## 9. 最终必答

| # | 问题 | 答案 |
|---|------|------|
| 1 | 是否已完成真正 IME Decoder？ | **否** |
| 2 | 词典工程 vs 解码器工程？ | **偏词典工程**；解码器为 **最小 beam 匹配器** |
| 3 | dict_dp 是否过于严格？ | **是** |
| 4 | topK=0 主因？ | **严格全路径匹配 + 无单字/unk/gap + ASR 字面拼音错误**（30 条另为无文本） |
| 5 | 是否需要 unknown/gap/partial？ | **需要**（至少 partial + 断链 fallback） |
| 6 | 是否需要功能单字层？ | **需要**（受控白名单） |
| 7 | 是否需要内容单字 fallback？ | **需要**（当前 0 单字导致无法桥接） |
| 8 | 是否需要 libpinyin 对照？ | **需要**（验证 dict_dp 上限 & GPL 决策） |
| 9 | 下一轮先补 decoder 还是数据？ | **先补数据（功能/内容单字层 + 断链统计）再改 decoder** |
| 10 | 是否允许进入主链？ | **否** |

---

## 10. 附录：与 libpinyin 路径差异

| 维度 | 当前 dict_dp | 典型 IME（libpinyin） |
|------|--------------|------------------------|
| 输入 | ASR 字面逐字拼音 | 用户音节流 / 词级输入 |
| 词表 | Lexicon 2–4 字短语 | 系统词库 + 单字 + n-gram |
| 断链 | 失败 | 单字 / 模糊音节 |
| 输出 | 完整句或空 | n-best 句子 |

Sidecar 已预留 `PINYIN_IME_DECODE_CMD` → `libpinyin_cli`，**未在本轮启用**。

---

*审计方法：静态读码 + 只读运行 `base_dictionary` 统计与 beam trace；未改仓库。*
