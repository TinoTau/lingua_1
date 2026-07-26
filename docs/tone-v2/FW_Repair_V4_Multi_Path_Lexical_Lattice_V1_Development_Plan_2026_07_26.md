# FW Repair V4 多路径词汇词图 Fine Span 完全重构方案

**文档性质**：开发实施方案  
**目标版本**：Multi-Path Lexical Lattice V1  
**日期**：2026-07-26  
**适用范围**：FW 整句结果进入 ASR 后处理后，至 KenLM 候选评分之前  
**架构原则**：唯一主链、单一事实来源、完全替换旧实现、无兼容双链路  
**前置审计**：`FW_Repair_V4_Multi_Path_Lexical_Lattice_Pre_Development_Audit_2026_07_26.md`

---

# 一、方案结论

当前生产实现采用：

```text
LTR Cursor
→ 每个 Cursor 生成局部 2～5 音节窗口
→ commitBestFormalFineSpan
→ 提交唯一 Fine Span
→ Cursor 跳转到已提交 Span 末尾
→ 不保留其他分界路径
```

该实现只能产生一条贪心切分序列，无法同时保留：

```text
yi bei | na tie | shao bing
```

和：

```text
yi bei na | tie shao bing
```

等不同边界组合。

审计已经确认，唯一 Fine Span 的决定权位于：

```text
runLtrFineSpanGeneration
commitBestFormalFineSpan
cursor = formalSpan.syllableEnd
```

后续 Domain Vote、Sentence Assembly 和 KenLM 当前均建立在唯一 `FormalFineSpan[]` 的假设之上。

本次重构将彻底移除旧 LTR 唯一提交机制，建立唯一新主链：

```text
FW 整句音节坐标
→ 生成全句连续 1～5 音节窗口
→ 词库 Recall
→ 构建 LexicalEdge
→ 枚举有限完整 SegmentationPath
→ 每条 Path 独立 Domain Vote
→ 每条 Path 独立 SameDomain Assembly
→ 合并所有 Path 候选
→ 全局最多 16 条
→ KenLM 统一评分
```

重构完成后：

* 不保留旧 LTR Fine Span 主链；
* 不保留 feature flag 切换；
* 不保留 shadow 对比链路；
* 不保留兼容 fallback 到旧算法；
* 不存在两个 Fine Span SSOT；
* 新的 `SegmentationPath[]` 是唯一 Fine Span 分界事实来源。

---

# 二、重构目标

## 2.1 功能目标

系统应能够对同一句整句拼音保留多种完整分界路径。

例如输入：

```text
yi bei na tie shao bing
```

词库若存在相关词条，系统应能够同时建立：

```text
Path A:
[0,2] | [2,4] | [4,6]

yi bei | na tie | shao bing
一杯   | 拿铁   | 少冰
```

以及：

```text
Path B:
[0,3] | [3,6]

yi bei na | tie shao bing
已被拿    | 贴烧饼
```

两条路径分别执行：

```text
Path-specific Domain Vote
→ Path-specific SameDomain
→ Path-specific Sentence Assembly
```

最终形成不同候选句并交给 KenLM。

Fine Span 层不判断最终哪句话更通顺。最终语言通顺度由 KenLM 统一评分。

---

## 2.2 架构目标

| 决策 | 唯一所有者 |
|------|------------|
| 音节坐标 | `UtteranceSyllableCoordinate` |
| 连续窗口生成 | Lexical Lattice Window Generator |
| 窗口候选合法性 | SQLite 运营词库 Recall |
| Span 边界候选 | `LexicalEdge` |
| 完整分界组合 | `SegmentationPath` |
| 领域判断 | 每条 Path 内的 Domain Vote |
| SameDomain 桶 | 每条 Path 的 Assembly |
| 候选句数量治理 | 全局 Sentence Candidate Allocator |
| 最终语言评分 | KenLM |
| 最终 Trace | Path-aware Trace Contract |

---

## 2.3 性能目标

```text
最大窗口长度 = 5
全局 SegmentationPath 有界
全局 Sentence Candidate <= 16
KenLM 输入数量不增加
Candidate 数组在不同 Path 间共享引用
SQLite 不新增索引
SQLite 不创建临时表
SQLite 不创建持久化运行时中间表
```

---

# 三、非目标

* 修改 Tone 模型 / FW 时间戳 / 重训 KenLM
* 修改词库运营规则或 Schema
* 修改 Domain Vote 计票公式
* LLM / KenLM 参与分界
* 候选词全排列 / 网络级逐字流式
* 新增 SQLite 索引或临时表
* 新旧链路兼容层

---

# 四、SSOT 重构原则

## 4.1 新 Fine Span SSOT

重构后：`SegmentationPath[]` 是唯一 Fine Span 分界结果。

```text
SegmentationPath
  └─ LexicalEdge[]
       └─ WindowCandidate[]
```

`FormalFineSpan[]` 若仍被后续模块需要，只能作为：

```text
SegmentationPath → materializeFormalFineSpans(path) → Vote / Assembly Adapter
```

投影不得反向修改 Path，不得持久为第二份分界 SSOT。

## 4.2 词库 SSOT

正式 LexicalEdge = 该音节窗口至少召回一个正式词库 Candidate。

## 4.3 领域 SSOT

`term_domain_tags` → Candidate `domains[]` 在进入 Lattice 前完整装配。Vote / Assembly / KenLM 零 SQL。

## 4.4 文档 SSOT

旧「LTR 唯一 Fine Span / 全 Formal 一次 Vote」描述将被本方案替换；验收后同步改冻结文档并重冻。

---

# 五、开发前严格确认与隔离

## 5.1 代码基线冻结

独立分支例如：`feature/fw-v4-multi-path-lexical-lattice-v1`

记录：Git SHA、Node/Electron、better-sqlite3、SQLite、词库、配置、KenLM、dialog_200 版本。

## 5.2 基线产物

架构调用链、dialog_200、SQL/耗时/内存、KenLM 输入数、Fine Span / Vote / Assembly Trace。

## 5.3 修改范围白名单

允许：orchestrator、LTR/window/recall 编排、Path DTO、vote/assembly **caller**、candidate merge、KenLM metadata adapter、diagnostics、freeze tests、architecture docs。

禁止默认改：FW acoustic、Tone 推理、Vote 计票内核、KenLM scorer、词库 Schema/导入、`term_domain_tags` 语义。

## 5.4 旧链隔离

新主链不调用旧 LTR；无 feature flag；无 shadow；最终合并前删除旧生产入口。

## 5.5 开发前必确认事项

（本方案文本即书面确认来源；Phase 0 报告中勾选）

```text
[x] SegmentationPath[] 成为唯一 Fine Span SSOT
[x] 正式窗口范围为 1～5 音节
[x] 正式单字 Edge 必须来自正式词库
[x] fallback 单字与 lexical 单字严格区分
[x] coarse span 不再硬切断窗口
[x] coarse span 仅保留为软参考、gap 和 Trace
[x] 不同 boundaryKey 必须能够同时保留
[x] 同 boundaryKey 多 Candidate 不展开成多 Path
[x] 每 Path 独立 Domain Vote
[x] 每 Path 独立 SameDomain Assembly
[x] 全局候选总数仍然最多 16
[x] KenLM 负责跨 Path 最终评分
[x] 不新增索引
[x] 不使用临时表
[x] 不保留旧新双链
```

---

# 六、目标主链

```text
runFwDetectorOrchestrator
  → runFwDetectorV4Path
    → runSpanAssemblyV4Orchestrator
      → buildUtteranceSyllableCoordinate
      → partitionCoarseSpans
      → buildLexicalWindowQueries
      → recallLexicalWindows
      → buildLexicalEdges
      → enumerateCompleteSegmentationPaths
      → for each path:
           materializePathFineSpans
           voteDomainsForPath
           assembleSameDomainCandidatesForPath
      → allocateGlobalSentenceCandidates
      → mergeCandidateTrace
    → runFwSentenceRerankFromPrefilled
      → KenLM scoreBatch
```

旧 `runLtrFineSpanGeneration` / `commitBestFormalFineSpan` / `cursor = syllableEnd` **不得**继续拥有生产决策权。

---

# 七～十七、数据结构 / 窗口 / Recall / Edge / Path / Vote / Assembly / Compatibility / 16 / KenLM

## Normative Contract（固定引用）

```text
Normative Contract:
  docs/tone-v2/FW_Repair_V4_Multi_Path_Lexical_Lattice_V1_Implementation_Contract_V1.0.0_2026_07_26.md

Version:
  1.0.0

Status:
  APPROVED FOR IMPLEMENTATION

SHA256:
  sha256:9aab5652d2ae4d5834ea68f912e45d22904985288ca8a03499a93813ac0bf64e

Precedence:
  如本 Plan 与 Implementation Contract V1.0.0 冲突，以 Implementation Contract V1.0.0 为准。
```

禁止以“聊天原文 / 用户原稿 / 此前讨论”作为规范来源。DTO、fallback 注入、Path 裁剪、coarse 权限、Trace 字段以 Contract V1.0.0 正文为准。

关键冻结摘要（非完整规范，细节见 Contract）：

* 窗口：全句连续 `1..5`，`[start,end)` 音节坐标
* Edge：同 `(start,end)` 唯一；多候选挂载不展开 Path
* Path：`Bounded Complete Segmentation Path Enumeration`；`boundaryKey` 去重；位置限宽 + 完整 Path 上限（探测值 8，**NOT FINAL**）
* fallback：仅对 lexical 不可达 gap 注入；`fallback length = 1`；无领域票
* Vote/Assembly：按 Path 隔离；计票公式不变
* CompatibilityGraph：KEEP 同 Span 兼容 / DELETE 已由 Path 保证的重叠裁决；禁止跨 Path 边
* 全局 ≤16；同文多来源 Trace 保留
* KenLM：`string[]` + 外置 `Map<text, GlobalSentenceCandidate>`

---

# 十八、旧逻辑删除清单

```text
runLtrFineSpanGeneration 作为生产 Fine Span SSOT
commitBestFormalFineSpan 唯一决策
cursor = formalSpan.syllableEnd 贪心所有权
只从当前 cursor 生成局部窗口
2～5 正式窗 + 1 字仅旧 fallback 合同
全句统一 Domain Vote
单 Formal 序列 Assembly 假设
generateGlobalWindows / truncateWindows 死代码
Parent lookupTermDomainTagsInScope 循环
旧 LTR freeze contract / 无多路径断言
shadow/兼容残留
```

---

# 十九、开发阶段划分

| Phase | 内容 |
|-------|------|
| **0** | 分支、基线、合同草稿、Delete Matrix；**不改运行逻辑** |
| **1** | 全句 1～5 窗、Recall 去重、LexicalEdge；不接 Vote |
| **2** | Path 枚举；删除 LTR commit |
| **3** | Path 隔离 Vote/Assembly；Compatibility 清理 |
| **4** | 全局 16 + KenLM Trace |
| **5** | Parent tags 批量、prepared 复用（禁复杂 Batch SQL 除非证明瓶颈） |
| **6** | 旧链删除、文档重冻、独立审计 |

---

# 二十～二十七、诊断 / 验证 / 验收 / Target / Check / 交付

验收与诊断字段以 **Implementation Contract V1.0.0** §8–§13 及本 Plan 第十九～二十八章（若正文完整内嵌）为准。  
Phase 0.5 起禁止引用“用户原稿”。若章节未完整内嵌，一律回退到 Contract V1.0.0。

全部满足后方可宣布完成并重冻：

```text
FW → Coordinate → 1～5 Window → Recall → LexicalEdge[]
→ SegmentationPath[] → Path Vote → Path Assembly
→ Global ≤16 → KenLM → Top-K
```

禁止回潮：LTR 唯一 commit、全路径统一 Vote、跨路径组句、第二套词库/领域、双链、兼容 fallback。

## Phase Gate（更新）

```text
Phase 0 单独完成合同草稿 ≠ READY FOR PHASE 1
必须完成 Phase 0.5（可复现 baseline + Contract V1.0.0）后才可标记 READY FOR PHASE 1
```
