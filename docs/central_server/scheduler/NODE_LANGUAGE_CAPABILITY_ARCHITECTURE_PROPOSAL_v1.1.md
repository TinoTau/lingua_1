# 节点语言能力上报与调度架构 —— 修订版技术方案（v1.1）

> 本文档为《NODE_LANGUAGE_CAPABILITY_ARCHITECTURE_PROPOSAL.md》的修订版（v1.1），
> 目标是在**不破坏现有 ServiceType 调度逻辑**的前提下，
> 引入**语言感知调度能力**，避免任务被分配到不支持目标语言/语言对的节点。

---

## 1. 修订背景与目标

### 1.1 现存问题
- 节点端仅按 `service_type`（ASR / NMT / TTS）上报能力
- 调度端无法判断节点是否支持具体语言或语言对
- 导致任务被错误分配，失败率和重试率升高

### 1.2 修订目标
- 节点端显式上报语言能力
- 调度端在 node selection 阶段进行语言过滤
- 保持向后兼容，不影响旧节点

---

## 2. 能力模型修订（核心）

### 2.1 拆分语言能力维度

```ts
interface NodeLanguageCapabilities {
  asr_languages?: string[];
  tts_languages?: string[];
  nmt_capabilities?: NmtCapability[];
}
```

---

### 2.2 NMT 能力表达（避免 pair 爆炸）

```ts
interface NmtCapability {
  model_id: string;
  languages: string[];
  rule: "any_to_any" | "any_to_en" | "en_to_any";
  blocked_pairs?: { src: string; tgt: string }[];
}
```

---

### 2.3 语言代码规范化（新增）

所有语言字段在进入索引前必须规范化，例如：

- `zh-CN` → `zh`
- `pt-BR` → `pt`

---

## 3. 节点端能力生成逻辑

### 3.1 能力来源优先级
1. manual_override
2. service_capabilities_endpoint
3. installed_model_inference

仅统计 `READY` 状态的服务。

---

## 4. 调度端索引结构

```ts
LanguageCapabilityIndex {
  byNmtPair: Map<LangPair, Set<NodeId>>
  byAsrLang: Map<Lang, Set<NodeId>>
  byTtsLang: Map<Lang, Set<NodeId>>
}
```

---

## 5. auto 源语言处理策略

当 `src_lang = auto`：
1. 必须支持 `tgt_lang`（NMT + TTS）
2. ASR 覆盖语言多者优先
3. 文本翻译可跳过 ASR 过滤

---

## 6. 调度流程修订

```text
candidate_nodes
 → filter service_type
 → filter nmt pair
 → filter tts lang
 → filter asr lang / auto
 → sort by load / gpu / coverage
```

---

## 7. 观测与失败原因补充

新增 NoAvailableNodeBreakdown：
- LANG_PAIR_UNSUPPORTED
- ASR_LANG_UNSUPPORTED
- TTS_LANG_UNSUPPORTED
- SRC_AUTO_NO_CANDIDATE

---

## 8. 向后兼容

- language_capabilities 为 optional
- 未上报语言能力节点仅用于 fallback

---

## 9. 实施建议

### Phase 1
- 能力模型拆分
- 语言规范化
- 调度端过滤

### Phase 2
- 覆盖度排序
- 动态禁用失败语言对

---

## 10. 结论

该修订方案：
- 解决节点语言不匹配导致的误调度
- 不显著增加调度复杂度
- 支持未来多语言、多模型扩展

**建议作为 v1.1 正式方案实施。**
