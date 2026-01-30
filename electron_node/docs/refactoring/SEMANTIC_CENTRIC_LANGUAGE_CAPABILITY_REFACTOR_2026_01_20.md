# SEMANTIC_CENTRIC_LANGUAGE_CAPABILITY_REFACTOR_2026_01_20

语言能力体系重构方案（以语义修复服务为中心）
版本：2026-01-20
面向：节点端开发 / 服务编排 / 语言能力模块实现人员

---

# 1. 背景与目标

当前语言能力计算存在以下关键问题：

1. **语义修复服务是核心依赖**，但现有逻辑将其当作“可选过滤器”，导致语言对被意外清空。
2. 服务状态 starting → stopped 的错误映射导致 NodeAgent 在启动早期看到“无服务”，使所有能力值为 0。
3. 语言能力计算逻辑耦合度高、条件复杂且带补丁（如延迟注册、等待健康检查）。
4. 当一个语义修复服务只覆盖部分语种（如 `semantic-repair-zh`），现有 AND 过滤会导致所有 182 个语言对被砍掉。

为了保持代码逻辑“尽可能简单易懂、方便排查问题”，必须通过**架构方法**解决，而不是用大量补丁来掩盖问题。

本次重构的目标是：

> **建立一套“以语义修复为中心”的语言能力计算模型，使语义修复成为硬依赖，同时保持代码单纯且可测试，不依赖延迟、补丁或时序技巧。**

---

# 2. 架构原则（核心三条）

## 2.1 语义修复 = 翻译能力的硬依赖

* 节点没有任何语义修复服务 ⇒ 节点不得对外公布任何语言对。
* 原因：无语义增强，翻译文本质量不可接受。

## 2.2 “源语言语义修复”是必要条件，“目标语言语义修复”是可选增强

* 对于语言对 (src→tgt)：

  * `src` 必须被 semantic-repair 覆盖（输入质量必须保证）
  * `tgt` 如被 semantic 覆盖，可记为增强，但不是砍掉语言对的理由

## 2.3 语言能力计算必须是纯函数

* 不依赖服务启动时序
* 不依赖健康检查
* 不依赖延迟或轮询
* NodeAgent 只负责上报，不决策策略

---

# 3. 服务状态修正（必须执行的前置步骤）

现有问题：

* runtime.status=starting 被 buildInstalledServices 映射成 stopped
* 导致 NodeAgent 错误地看到整个节点无服务
* 诱发语言对计算 = 0

## 解决方案（方案 1）

修改 buildInstalledServices：

```ts
status:
  runtime.status === "running" || runtime.status === "starting"
    ? "running"
    : runtime.status === "error"
    ? "error"
    : "stopped";
```

影响范围：

* NodeAgent
* 语言能力计算
* 跨进程服务查询

该修复属于“技术性 bugfix”，并不改变架构逻辑。

---

# 4. 以语义修复为中心的语言能力计算设计（方案 3C）

语言能力由以下能力源决定：

* `asrLanguages: string[]`
* `ttsLanguages: string[]`
* `nmtCapabilities: { src: string; tgt: string }[]`
* `semanticLanguages: string[]`

其中：

* `semanticLanguages` = 所有正在运行的 semantic-repair / en-normalize 服务的语言集合
* 至少需要存在一个语义服务，否则语言对 = []（硬依赖）

## 4.1 语言对计算规则（最终方案）

语言对 (src→tgt) 需同时满足：

1. `src ∈ asrLanguages`
2. `tgt ∈ ttsLanguages`
3. `semanticLanguages` 非空（节点必须有语义服务）
4. **`src ∈ semanticLanguages`（源语言必须具备语义修复）**
5. NMT 支持该转换：存在 `src→tgt`

## 4.2 目标语言语义修复是可选增强

* 如果 `tgt ∈ semanticLanguages`：语言对将带上 `semantic_on_tgt = true`
* 但不是删掉语言对的必要条件

---

# 5. 语言对计算的纯函数实现（可复制给开发）

```ts
function computeSemanticCentricLanguagePairs(
  asrLanguages: string[],
  ttsLanguages: string[],
  nmtCapabilities: { src: string; tgt: string }[],
  semanticLanguages: string[]
) {
  const asrSet = new Set(asrLanguages);
  const ttsSet = new Set(ttsLanguages);
  const semanticSet = new Set(semanticLanguages);

  // 语义修复 = 必须：没有语义服务，整个节点不提供翻译能力
  if (semanticSet.size === 0) {
    return [];
  }

  const pairs = [];

  for (const { src, tgt } of nmtCapabilities) {
    // 基础 ASR / TTS 能力
    if (!asrSet.has(src)) continue;
    if (!ttsSet.has(tgt)) continue;

    // 语义修复硬依赖：源语言必须经过 semantic
    if (!semanticSet.has(src)) continue;

    pairs.push({
      src,
      tgt,
      semantic_on_src: true,
      semantic_on_tgt: semanticSet.has(tgt)
    });
  }

  return pairs;
}
```

**特点：**

* 单纯、可测试、无异步
* 不依赖服务启动时序
* 不依赖健康检查
* 不会产生“全部语言对意外清空”等异常
* 完全体现“语义修复为核心”的设计理念

---

# 6. NodeAgent 的职责（不参与策略）

NodeAgent 仅负责：

1. 构建 InstalledService 快照
2. 构建各类型能力（ASR/TTS/NMT/Semantic）
3. 调用计算函数获得 pairs
4. 上报给调度端

NodeAgent 不应：

* 自己定义策略
* 自己决定“是否允许翻译”
* 自己引入复杂状态机

这样，所有逻辑集中在一个单点函数中，使系统容易排查和测试。

---

# 7. 样例输出（NodeAgent → Scheduler）

```json
{
  "asr_languages": ["zh", "en"],
  "tts_languages": ["zh", "en"],
  "semantic_languages": ["zh"],
  "nmt_capabilities": [
    { "src": "zh", "tgt": "en" },
    { "src": "en", "tgt": "zh" }
  ],
  "language_pairs": [
    { "src": "zh", "tgt": "en", "semantic_on_src": true, "semantic_on_tgt": false }
  ],
  "semantic_core_ready": true
}
```

在本例中：

* 节点只部署了语义修复 zh → zh
* 因此只有 `src = zh` 的语言对被保留
* en→zh 不满足语义修复硬条件 → 被过滤

该行为完全符合产品要求。

---

# 8. 开发任务列表（Task List）

## P0（必须完成，阻塞级）

* [ ] 修复 buildInstalledServices 中的 starting → running 映射
* [ ] NodeAgent 使用修正后的 InstalledService
* [ ] 删除旧的 semantic 过滤逻辑（包含 src/tgt 双端 AND）
* [ ] 实现 computeSemanticCentricLanguagePairs（纯函数版本）
* [ ] NodeAgent 心跳调用该纯函数，替换现有语言对计算链路

## P1（高优先级）

* [ ] 删除延迟注册（30 秒等待）逻辑
* [ ] 删除依赖健康检查的语言对再计算逻辑
* [ ] 日志输出统一改为：

  * asr/tts/nmt/semantic 统计
  * 最终语言对数量
  * semantic_on_tgt 统计

## P2（优化）

* [ ] 为 computeSemanticCentricLanguagePairs 添加单元测试

  * 无语义 → 返回 []
  * 有语义但不覆盖 src → 过滤语言对
  * 目标语言被 semantic 覆盖 → semantic_on_tgt = true
* [ ] 将语言对计算逻辑单独放入文件（便于复用）

  * `services/language/capabilityEngine.ts`

## P3（文档 & 稳定性）

* [ ] 更新节点端架构文档
* [ ] 更新服务端调度策略说明
* [ ] 加入开发日志示例（方便排查语言能力问题）

---

# 9. 重构完成后的系统状态

完成后，系统将具备：

* 对语义修复服务的**严格硬依赖**
* 清晰且完全可预测的语言对计算逻辑
* 单点维护（一个纯函数），极易排查
* 无时序补丁、无延迟依赖
* 在“缺少语义服务”这一业务前提下，节点能给出明确且可信的语言能力

这套机制可以长期稳定，不会因服务时序、服务数量、服务扩展而破裂。

---

# 10. 最终结论

本方案以语义修复服务为核心，将语言能力定义为一条“语义增强后的完整翻译流水线”，并使用最小且纯粹的架构组件实现：

1. 语义修复是翻译硬门槛
2. 源语言必须语义覆盖
3. 目标语言语义为增强，不影响可用性
4. 语言能力计算是纯函数，彻底消除补丁与时序依赖

这使得代码逻辑极其清晰，调试成本极低，适合长期维护和未来扩展。

---
