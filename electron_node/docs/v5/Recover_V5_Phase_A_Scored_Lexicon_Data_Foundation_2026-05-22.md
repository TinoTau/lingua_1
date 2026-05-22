# Recover V5 Phase A 技术方案：Scored Lexicon Data Foundation

版本：V5-Phase-A  
日期：2026-05-22  
目标：建立 V5 的 scored legal lexicon 数据基础。

---

## 1. Phase A 目标

Phase A 只处理数据结构、构建脚本、manifest 与 runtime loader。

不做：

- diff span
- TopK lookup
- candidateScore
- KenLM gate
- 召回逻辑改造

Phase A 完成后，系统应具备：

```text
合法词条
+ pinyin
+ priorScore
+ frequency
+ domain
+ tags
+ enabled
```

并能被 runtime 稳定读取。

---

## 2. 当前差距

只读审计显示，当前已有 frequency 推导 priorScore 的影子能力，但缺少 manifest/runtime 级 priorScore 冻结、tags/domain/enabled 语义，以及“无 prior 不进 TopK”的硬约束。

---

## 3. Scored Lexicon Schema

冻结词条结构：

```json
{
  "id": "term-0001",
  "word": "候选生成",
  "pinyin": "hou xuan sheng cheng",
  "priorScore": 8.5,
  "frequency": 100,
  "domain": "general",
  "enabled": true,
  "tags": ["technical"]
}
```

字段说明：

| 字段 | 必填 | 说明 |
|---|---|---|
| id | 是 | 稳定词条 ID |
| word | 是 | 合法词 |
| pinyin | 是 | 词条级完整拼音 |
| priorScore | 是 | 运营维护分数 |
| frequency | 可选 | 可辅助 priorScore |
| domain | 可选 | domain boost 输入 |
| enabled | 是 | 是否启用 |
| tags | 可选 | 分类标签 |

---

## 4. 数据规则

### 4.1 priorScore

- priorScore 由运营方维护
- Recover 不学习 priorScore
- 若 legacy 数据只有 frequency，构建脚本可生成 initial priorScore
- 生成后必须写入 manifest
- runtime 不允许临时猜 priorScore

### 4.2 enabled

enabled=false 的词：

```text
不得进入 pinyin index
不得进入 TopK
不得作为 candidate
```

### 4.3 多音字

多音字不在 runtime 全量展开。

正确方式：

```text
词条自身保存完整 pinyin
```

### 4.4 中英混合

必须支持合法 token：

```text
AI / GPU / taxi / cafe / hospital / RTX4060
```

这些 token 不应被错误中文拼音化。

---

## 5. Manifest 扩展

manifest 必须新增：

```json
{
  "scored_lexicon_version": "v5",
  "term_count": 0,
  "enabled_term_count": 0,
  "terms_with_prior_count": 0,
  "terms_without_prior_count": 0,
  "pinyin_index_count": 0,
  "mixed_token_count": 0
}
```

验收：

```text
terms_without_prior_count = 0
enabled_term_count > 0
```

---

## 6. Target List

### A-01 冻结 HotwordEntry / LexiconEntry 类型

新增或确认字段：

- priorScore
- domain
- enabled
- tags

### A-02 修改 build-lexicon-bundle

要求：

- 生成 pinyin
- 校验 priorScore
- 输出 manifest 统计
- disabled 词不进索引

### A-03 修改 runtime loader

要求：

- 加载 scored lexicon
- 无 priorScore 的词拒绝进入 TopK 索引
- 输出 lexicon runtime diagnostics

### A-04 支持 mixed token

要求：

- 英文 token 保留
- 数字 token 保留
- 不强行中文拼音化

### A-05 输出质量配置快照

result.extra.qualityConfig 后续需包含 V5 字段，Phase A 可先输出 schema stub。

---

## 7. Check List

- [ ] LexiconEntry 包含 priorScore
- [ ] enabled=false 不进入候选索引
- [ ] terms_without_prior_count = 0
- [ ] manifest 输出 V5 scored lexicon 信息
- [ ] pinyin 为词条级，不是单字 runtime 组合
- [ ] mixed token 不被破坏
- [ ] runtime loader 能读取 scored lexicon
- [ ] 没有 priorScore 的词不会进入 TopK
- [ ] Phase A 不改 recall 主链
- [ ] Phase A 不改 KenLM

---

## 8. 测试计划

新增单元测试：

- lexicon schema validation
- priorScore required
- enabled false exclusion
- mixed token preservation
- manifest statistics
- pinyin field required

---

## 9. 验收标准

```text
build-lexicon-bundle PASS
manifest priorScore coverage = 100%
runtime loader PASS
现有 dialog_200 不崩
```
