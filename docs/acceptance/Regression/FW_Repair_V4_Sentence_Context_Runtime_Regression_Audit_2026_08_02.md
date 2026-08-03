<!-- Documentation Hierarchy Metadata
Status: **ACCEPTANCE_RECORD**
Superseded By: Evidence only — not CURRENT
Archive Path: docs/acceptance/Regression/FW_Repair_V4_Sentence_Context_Runtime_Regression_Audit_2026_08_02.md
-->

> **ACCEPTANCE_RECORD** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: Evidence only — not CURRENT

# FW Repair V4 — Sentence Context Runtime Regression Audit

| Field | Value |
|-------|-------|
| Date | 2026-08-02 |
| Nature | **READ ONLY · NODE RUNTIME REGRESSION · REAL SENTENCE CONTEXT** |
| Input | 22 `DELETE_RUNTIME_SAFE` compounds |
| Sentences | **44** (>=44; >=2 / term) |
| Status | **REGRESSION_FOUND** |

---

## 1. Question

把 22 个 `DELETE_RUNTIME_SAFE` 词放进**真实完整句子**后，Probe 排除完整 term，节点端 Domain / Assembly / KenLM / Final 是否仍完全一致？

---

## 2. Method

1. 每词 ≥2 条自然句（陈述 + 业务），禁止 surface-only / 两词拼接。
2. **WITH**：生产 `runSpanAssemblyV4Orchestrator`（FineSpan→Recall→LexicalEdge→Segmentation→Domain Vote→Bucket→Assembly→KenLM）。
3. **WITHOUT**：Probe Proxy 过滤 `lookup*` 中 `word === compoundTerm`（不改 Source / SQLite / Runtime / KenLM）。
4. Mandatory Tone：句级 char tones + compound 区间覆盖 DB `tone_pinyin_key`；并通过 **ASR word timestamps**（orchestrator 会忽略直接传入的 wordTimeSpans）对齐 `acousticSlices`，使生产入口可激活 Tone Recall。
5. **硬判定（§十四）**：Domain / Assembly（数量+内容） / KenLM Top3+Top1 / Final / Coverage 任一不一致 → `NODE_RUNTIME_REGRESSION`。
6. Bucket 单独变化记为 soft（报告中披露），在 Domain/Assembly/KenLM/Final 全一致时不单独判 REGRESSION。
7. 若且仅当 **全部句子 IDENTICAL** → 正式确认 `DELETE_RUNTIME_SAFE` 可进 Source Cleanup。

Artifacts:

- [sentence_runtime_regression.csv](./sentence_runtime_regression.csv)
- `docs/tone-v2/_audit_scratch/sentence_runtime_regression/`

---

## 3. Summary

| Metric | Count |
|--------|------:|
| Sentences | **44** |
| NODE_RUNTIME_IDENTICAL | **42** |
| NODE_RUNTIME_REGRESSION | **2** |
| soft BUCKET-only (still IDENTICAL) | 31 |
| DOMAIN_VOTE regressions | 2 |

```text
IDENTICAL  42 / 44
REGRESSION 2 / 44
```

### Domain Vote regressions（重点）

- **单元测试** · 请在合并前确保单元测试全部通过。 · WITH=[tech_ai] → WITHOUT=[]
- **神经网络** · 我们正在训练神经网络模型。 · WITH=[coffee, tech_ai] → WITHOUT=[coffee]

### Per-term identical rate

| Term | Sentences | Identical | Regression |
|------|----------:|----------:|-----------:|
| 专家系统 | 2 | 2 | 0 |
| 单元测试 | 2 | 1 | 1 |
| 回归测试 | 2 | 2 | 0 |
| 安检通道 | 2 | 2 | 0 |
| 循环网络 | 2 | 2 | 0 |
| 正则策略 | 2 | 2 | 0 |
| 注册中心 | 2 | 2 | 0 |
| 流量镜像 | 2 | 2 | 0 |
| 测试数据 | 2 | 2 | 0 |
| 熔断策略 | 2 | 2 | 0 |
| 特征工程 | 2 | 2 | 0 |
| 神经网络 | 2 | 1 | 1 |
| 联系电话 | 2 | 2 | 0 |
| 视频会议 | 2 | 2 | 0 |
| 训练数据 | 2 | 2 | 0 |
| 迁移学习 | 2 | 2 | 0 |
| 迷你吧 | 2 | 2 | 0 |
| 邀请函 | 2 | 2 | 0 |
| 配置中心 | 2 | 2 | 0 |
| 配置文件 | 2 | 2 | 0 |
| 降级策略 | 2 | 2 | 0 |
| 集成测试 | 2 | 2 | 0 |

---

## 4. Regressions（必须列出）

### 单元测试 — 请在合并前确保单元测试全部通过。

- Reasons: DOMAIN_VOTE
- WITH Domain: [tech_ai]
- WITHOUT Domain: []
- WITH Assembly: ["请在合并前确保单元测试全部通过。"]
- WITHOUT Assembly: ["请在合并前确保单元测试全部通过。"]
- WITH KenLM Top3: ["请在合并前确保单元测试全部通过。"]
- WITHOUT KenLM Top3: ["请在合并前确保单元测试全部通过。"]
- WITH Final: 请在合并前确保单元测试全部通过。
- WITHOUT Final: 请在合并前确保单元测试全部通过。

### 神经网络 — 我们正在训练神经网络模型。

- Reasons: DOMAIN_VOTE
- WITH Domain: [coffee, tech_ai]
- WITHOUT Domain: [coffee]
- WITH Assembly: ["我闷蒸在训练神经网络模型。","我们正在训练神经网络模型。"]
- WITHOUT Assembly: ["我闷蒸在训练神经网络模型。","我们正在训练神经网络模型。"]
- WITH KenLM Top3: ["我闷蒸在训练神经网络模型。","我们正在训练神经网络模型。"]
- WITHOUT KenLM Top3: ["我闷蒸在训练神经网络模型。","我们正在训练神经网络模型。"]
- WITH Final: 我闷蒸在训练神经网络模型。
- WITHOUT Final: 我闷蒸在训练神经网络模型。


---

## 5. Focus Terms（§八）

### 神经网络

#### [陈述] 我们正在训练神经网络模型。

**Verdict:** `NODE_RUNTIME_REGRESSION` (DOMAIN_VOTE) · soft: BUCKET

| Metric | WITH | WITHOUT |
|--------|------|---------|
| Span coverage | complete | complete |
| LexicalEdge | 4 | 3 |
| Paths | 2 | 1 |
| Domain Vote | [coffee, tech_ai] | [coffee] |
| Bucket | 3 | 1 |
| Assembly count | 2 | 2 |
| Assembly candidates | ["我闷蒸在训练神经网络模型。","我们正在训练神经网络模型。"] | ["我闷蒸在训练神经网络模型。","我们正在训练神经网络模型。"] |
| KenLM Top3 | ["我闷蒸在训练神经网络模型。","我们正在训练神经网络模型。"] | ["我闷蒸在训练神经网络模型。","我们正在训练神经网络模型。"] |
| Final | 我闷蒸在训练神经网络模型。 | 我闷蒸在训练神经网络模型。 |

#### [业务] 神经网络模型已经部署完成。

**Verdict:** `NODE_RUNTIME_IDENTICAL` · soft: BUCKET

| Metric | WITH | WITHOUT |
|--------|------|---------|
| Span coverage | complete | complete |
| LexicalEdge | 3 | 2 |
| Paths | 2 | 1 |
| Domain Vote | [] | [] |
| Bucket | 2 | 1 |
| Assembly count | 1 | 1 |
| Assembly candidates | ["神经网络模型已经部署完成。"] | ["神经网络模型已经部署完成。"] |
| KenLM Top3 | ["神经网络模型已经部署完成。"] | ["神经网络模型已经部署完成。"] |
| Final | 神经网络模型已经部署完成。 | 神经网络模型已经部署完成。 |

### 迁移学习

#### [陈述] 团队决定采用迁移学习加速冷启动。

**Verdict:** `NODE_RUNTIME_IDENTICAL` · soft: BUCKET

| Metric | WITH | WITHOUT |
|--------|------|---------|
| Span coverage | complete | complete |
| LexicalEdge | 3 | 2 |
| Paths | 2 | 1 |
| Domain Vote | [] | [] |
| Bucket | 2 | 1 |
| Assembly count | 1 | 1 |
| Assembly candidates | ["团队决定采用迁移学习加速冷启动。"] | ["团队决定采用迁移学习加速冷启动。"] |
| KenLM Top3 | ["团队决定采用迁移学习加速冷启动。"] | ["团队决定采用迁移学习加速冷启动。"] |
| Final | 团队决定采用迁移学习加速冷启动。 | 团队决定采用迁移学习加速冷启动。 |

#### [业务] 迁移学习实验在验证集上提升明显。

**Verdict:** `NODE_RUNTIME_IDENTICAL` · soft: BUCKET

| Metric | WITH | WITHOUT |
|--------|------|---------|
| Span coverage | complete | complete |
| LexicalEdge | 3 | 2 |
| Paths | 2 | 1 |
| Domain Vote | [] | [] |
| Bucket | 2 | 1 |
| Assembly count | 1 | 1 |
| Assembly candidates | ["迁移学习实验在验证集上提升明显。"] | ["迁移学习实验在验证集上提升明显。"] |
| KenLM Top3 | ["迁移学习实验在验证集上提升明显。"] | ["迁移学习实验在验证集上提升明显。"] |
| Final | 迁移学习实验在验证集上提升明显。 | 迁移学习实验在验证集上提升明显。 |

### 特征工程

#### [陈述] 算法同学这周重点优化特征工程流水线。

**Verdict:** `NODE_RUNTIME_IDENTICAL` · soft: BUCKET

| Metric | WITH | WITHOUT |
|--------|------|---------|
| Span coverage | complete | complete |
| LexicalEdge | 3 | 2 |
| Paths | 2 | 1 |
| Domain Vote | [] | [] |
| Bucket | 2 | 1 |
| Assembly count | 1 | 1 |
| Assembly candidates | ["算法同学这周重点优化特征工程流水线。"] | ["算法同学这周重点优化特征工程流水线。"] |
| KenLM Top3 | ["算法同学这周重点优化特征工程流水线。"] | ["算法同学这周重点优化特征工程流水线。"] |
| Final | 算法同学这周重点优化特征工程流水线。 | 算法同学这周重点优化特征工程流水线。 |

#### [业务] 特征工程结果已经写入特征存储服务。

**Verdict:** `NODE_RUNTIME_IDENTICAL` · soft: BUCKET

| Metric | WITH | WITHOUT |
|--------|------|---------|
| Span coverage | complete | complete |
| LexicalEdge | 3 | 2 |
| Paths | 2 | 1 |
| Domain Vote | [] | [] |
| Bucket | 2 | 1 |
| Assembly count | 1 | 1 |
| Assembly candidates | ["特征工程结果已经写入特征存储服务。"] | ["特征工程结果已经写入特征存储服务。"] |
| KenLM Top3 | ["特征工程结果已经写入特征存储服务。"] | ["特征工程结果已经写入特征存储服务。"] |
| Final | 特征工程结果已经写入特征存储服务。 | 特征工程结果已经写入特征存储服务。 |

### 单元测试

#### [陈述] 开发同学今天补齐了核心模块的单元测试。

**Verdict:** `NODE_RUNTIME_IDENTICAL` · soft: BUCKET

| Metric | WITH | WITHOUT |
|--------|------|---------|
| Span coverage | complete | complete |
| LexicalEdge | 5 | 4 |
| Paths | 2 | 1 |
| Domain Vote | [] | [] |
| Bucket | 2 | 1 |
| Assembly count | 1 | 1 |
| Assembly candidates | ["开发同学今天补齐了核心模块的单元测试。"] | ["开发同学今天补齐了核心模块的单元测试。"] |
| KenLM Top3 | ["开发同学今天补齐了核心模块的单元测试。"] | ["开发同学今天补齐了核心模块的单元测试。"] |
| Final | 开发同学今天补齐了核心模块的单元测试。 | 开发同学今天补齐了核心模块的单元测试。 |

#### [业务] 请在合并前确保单元测试全部通过。

**Verdict:** `NODE_RUNTIME_REGRESSION` (DOMAIN_VOTE) · soft: BUCKET

| Metric | WITH | WITHOUT |
|--------|------|---------|
| Span coverage | complete | complete |
| LexicalEdge | 3 | 2 |
| Paths | 2 | 1 |
| Domain Vote | [tech_ai] | [] |
| Bucket | 2 | 1 |
| Assembly count | 1 | 1 |
| Assembly candidates | ["请在合并前确保单元测试全部通过。"] | ["请在合并前确保单元测试全部通过。"] |
| KenLM Top3 | ["请在合并前确保单元测试全部通过。"] | ["请在合并前确保单元测试全部通过。"] |
| Final | 请在合并前确保单元测试全部通过。 | 请在合并前确保单元测试全部通过。 |

### 回归测试

#### [陈述] 我们计划在发版前完成完整回归测试。

**Verdict:** `NODE_RUNTIME_IDENTICAL` · soft: BUCKET

| Metric | WITH | WITHOUT |
|--------|------|---------|
| Span coverage | complete | complete |
| LexicalEdge | 3 | 2 |
| Paths | 2 | 1 |
| Domain Vote | [] | [] |
| Bucket | 2 | 1 |
| Assembly count | 1 | 1 |
| Assembly candidates | ["我们计划在发版前完成完整回归测试。"] | ["我们计划在发版前完成完整回归测试。"] |
| KenLM Top3 | ["我们计划在发版前完成完整回归测试。"] | ["我们计划在发版前完成完整回归测试。"] |
| Final | 我们计划在发版前完成完整回归测试。 | 我们计划在发版前完成完整回归测试。 |

#### [业务] 回归测试报告已经同步给质量保障团队。

**Verdict:** `NODE_RUNTIME_IDENTICAL` · soft: BUCKET

| Metric | WITH | WITHOUT |
|--------|------|---------|
| Span coverage | complete | complete |
| LexicalEdge | 4 | 3 |
| Paths | 2 | 1 |
| Domain Vote | [] | [] |
| Bucket | 2 | 1 |
| Assembly count | 2 | 2 |
| Assembly candidates | ["回归测试报告已精通步给质量保障团队。","回归测试报告已经同步给质量保障团队。"] | ["回归测试报告已精通步给质量保障团队。","回归测试报告已经同步给质量保障团队。"] |
| KenLM Top3 | ["回归测试报告已精通步给质量保障团队。","回归测试报告已经同步给质量保障团队。"] | ["回归测试报告已精通步给质量保障团队。","回归测试报告已经同步给质量保障团队。"] |
| Final | 回归测试报告已精通步给质量保障团队。 | 回归测试报告已精通步给质量保障团队。 |

### 集成测试

#### [陈述] 联调阶段必须覆盖主要路径的集成测试。

**Verdict:** `NODE_RUNTIME_IDENTICAL` · soft: BUCKET

| Metric | WITH | WITHOUT |
|--------|------|---------|
| Span coverage | complete | complete |
| LexicalEdge | 3 | 2 |
| Paths | 2 | 1 |
| Domain Vote | [] | [] |
| Bucket | 2 | 1 |
| Assembly count | 1 | 1 |
| Assembly candidates | ["联调阶段必须覆盖主要路径的集成测试。"] | ["联调阶段必须覆盖主要路径的集成测试。"] |
| KenLM Top3 | ["联调阶段必须覆盖主要路径的集成测试。"] | ["联调阶段必须覆盖主要路径的集成测试。"] |
| Final | 联调阶段必须覆盖主要路径的集成测试。 | 联调阶段必须覆盖主要路径的集成测试。 |

#### [业务] 集成测试用例已经挂到持续集成流水线。

**Verdict:** `NODE_RUNTIME_IDENTICAL` · soft: BUCKET

| Metric | WITH | WITHOUT |
|--------|------|---------|
| Span coverage | complete | complete |
| LexicalEdge | 3 | 2 |
| Paths | 2 | 1 |
| Domain Vote | [] | [] |
| Bucket | 2 | 1 |
| Assembly count | 1 | 1 |
| Assembly candidates | ["集成测试用例已经挂到持续集成流水线。"] | ["集成测试用例已经挂到持续集成流水线。"] |
| KenLM Top3 | ["集成测试用例已经挂到持续集成流水线。"] | ["集成测试用例已经挂到持续集成流水线。"] |
| Final | 集成测试用例已经挂到持续集成流水线。 | 集成测试用例已经挂到持续集成流水线。 |

### 配置文件

#### [陈述] 请检查本地配置文件中的数据库地址。

**Verdict:** `NODE_RUNTIME_IDENTICAL` · soft: BUCKET

| Metric | WITH | WITHOUT |
|--------|------|---------|
| Span coverage | complete | complete |
| LexicalEdge | 3 | 2 |
| Paths | 2 | 1 |
| Domain Vote | [] | [] |
| Bucket | 2 | 1 |
| Assembly count | 1 | 1 |
| Assembly candidates | ["请检查本地配置文件中的数据库地址。"] | ["请检查本地配置文件中的数据库地址。"] |
| KenLM Top3 | ["请检查本地配置文件中的数据库地址。"] | ["请检查本地配置文件中的数据库地址。"] |
| Final | 请检查本地配置文件中的数据库地址。 | 请检查本地配置文件中的数据库地址。 |

#### [业务] 配置文件变更需要走变更审批流程。

**Verdict:** `NODE_RUNTIME_IDENTICAL` · soft: BUCKET

| Metric | WITH | WITHOUT |
|--------|------|---------|
| Span coverage | complete | complete |
| LexicalEdge | 3 | 2 |
| Paths | 2 | 1 |
| Domain Vote | [] | [] |
| Bucket | 2 | 1 |
| Assembly count | 1 | 1 |
| Assembly candidates | ["配置文件变更需要走变更审批流程。"] | ["配置文件变更需要走变更审批流程。"] |
| KenLM Top3 | ["配置文件变更需要走变更审批流程。"] | ["配置文件变更需要走变更审批流程。"] |
| Final | 配置文件变更需要走变更审批流程。 | 配置文件变更需要走变更审批流程。 |

### 训练数据

#### [陈述] 模型效果依赖高质量的训练数据。

**Verdict:** `NODE_RUNTIME_IDENTICAL` · soft: BUCKET

| Metric | WITH | WITHOUT |
|--------|------|---------|
| Span coverage | complete | complete |
| LexicalEdge | 3 | 2 |
| Paths | 2 | 1 |
| Domain Vote | [tech_ai] | [tech_ai] |
| Bucket | 2 | 1 |
| Assembly count | 1 | 1 |
| Assembly candidates | ["模型效果依赖高质量的训练数据。"] | ["模型效果依赖高质量的训练数据。"] |
| KenLM Top3 | ["模型效果依赖高质量的训练数据。"] | ["模型效果依赖高质量的训练数据。"] |
| Final | 模型效果依赖高质量的训练数据。 | 模型效果依赖高质量的训练数据。 |

#### [业务] 训练数据批次已完成标注并入库。

**Verdict:** `NODE_RUNTIME_IDENTICAL` · soft: BUCKET

| Metric | WITH | WITHOUT |
|--------|------|---------|
| Span coverage | complete | complete |
| LexicalEdge | 3 | 2 |
| Paths | 2 | 1 |
| Domain Vote | [tech_ai] | [tech_ai] |
| Bucket | 2 | 1 |
| Assembly count | 1 | 1 |
| Assembly candidates | ["训练数据批次已完成标注并入库。"] | ["训练数据批次已完成标注并入库。"] |
| KenLM Top3 | ["训练数据批次已完成标注并入库。"] | ["训练数据批次已完成标注并入库。"] |
| Final | 训练数据批次已完成标注并入库。 | 训练数据批次已完成标注并入库。 |

### 测试数据

#### [陈述] 请不要把生产订单混入测试数据集合。

**Verdict:** `NODE_RUNTIME_IDENTICAL` · soft: BUCKET

| Metric | WITH | WITHOUT |
|--------|------|---------|
| Span coverage | complete | complete |
| LexicalEdge | 3 | 2 |
| Paths | 2 | 1 |
| Domain Vote | [] | [] |
| Bucket | 2 | 1 |
| Assembly count | 1 | 1 |
| Assembly candidates | ["请不要把生产订单混入测试数据集合。"] | ["请不要把生产订单混入测试数据集合。"] |
| KenLM Top3 | ["请不要把生产订单混入测试数据集合。"] | ["请不要把生产订单混入测试数据集合。"] |
| Final | 请不要把生产订单混入测试数据集合。 | 请不要把生产订单混入测试数据集合。 |

#### [业务] 测试数据已脱敏并导入联调环境。

**Verdict:** `NODE_RUNTIME_IDENTICAL` · soft: BUCKET

| Metric | WITH | WITHOUT |
|--------|------|---------|
| Span coverage | complete | complete |
| LexicalEdge | 4 | 3 |
| Paths | 2 | 1 |
| Domain Vote | [] | [] |
| Bucket | 2 | 1 |
| Assembly count | 2 | 2 |
| Assembly candidates | ["测试数据依托敏并导入联调环境。","测试数据已脱敏并导入联调环境。"] | ["测试数据依托敏并导入联调环境。","测试数据已脱敏并导入联调环境。"] |
| KenLM Top3 | ["测试数据依托敏并导入联调环境。","测试数据已脱敏并导入联调环境。"] | ["测试数据依托敏并导入联调环境。","测试数据已脱敏并导入联调环境。"] |
| Final | 测试数据依托敏并导入联调环境。 | 测试数据依托敏并导入联调环境。 |

### 流量镜像

#### [陈述] 我们准备对关键接口开启流量镜像。

**Verdict:** `NODE_RUNTIME_IDENTICAL` · soft: BUCKET

| Metric | WITH | WITHOUT |
|--------|------|---------|
| Span coverage | complete | complete |
| LexicalEdge | 3 | 2 |
| Paths | 2 | 1 |
| Domain Vote | [] | [] |
| Bucket | 2 | 1 |
| Assembly count | 1 | 1 |
| Assembly candidates | ["我们准备对关键接口开启流量镜像。"] | ["我们准备对关键接口开启流量镜像。"] |
| KenLM Top3 | ["我们准备对关键接口开启流量镜像。"] | ["我们准备对关键接口开启流量镜像。"] |
| Final | 我们准备对关键接口开启流量镜像。 | 我们准备对关键接口开启流量镜像。 |

#### [业务] 流量镜像已经导向影子集群进行对比验证。

**Verdict:** `NODE_RUNTIME_IDENTICAL` · soft: BUCKET

| Metric | WITH | WITHOUT |
|--------|------|---------|
| Span coverage | complete | complete |
| LexicalEdge | 3 | 2 |
| Paths | 2 | 1 |
| Domain Vote | [] | [] |
| Bucket | 2 | 1 |
| Assembly count | 1 | 1 |
| Assembly candidates | ["流量镜像已经导向影子集群进行对比验证。"] | ["流量镜像已经导向影子集群进行对比验证。"] |
| KenLM Top3 | ["流量镜像已经导向影子集群进行对比验证。"] | ["流量镜像已经导向影子集群进行对比验证。"] |
| Final | 流量镜像已经导向影子集群进行对比验证。 | 流量镜像已经导向影子集群进行对比验证。 |

### 熔断策略

#### [陈述] 调用下游超时后会触发熔断策略保护。

**Verdict:** `NODE_RUNTIME_IDENTICAL`

| Metric | WITH | WITHOUT |
|--------|------|---------|
| Span coverage | complete | complete |
| LexicalEdge | 2 | 2 |
| Paths | 1 | 1 |
| Domain Vote | [] | [] |
| Bucket | 1 | 1 |
| Assembly count | 2 | 2 |
| Assembly candidates | ["调用下游超时后会出发熔断策略保护。","调用下游超时后会触发熔断策略保护。"] | ["调用下游超时后会出发熔断策略保护。","调用下游超时后会触发熔断策略保护。"] |
| KenLM Top3 | ["调用下游超时后会出发熔断策略保护。","调用下游超时后会触发熔断策略保护。"] | ["调用下游超时后会出发熔断策略保护。","调用下游超时后会触发熔断策略保护。"] |
| Final | 调用下游超时后会出发熔断策略保护。 | 调用下游超时后会出发熔断策略保护。 |

#### [业务] 熔断策略阈值已按错误率重新校准。

**Verdict:** `NODE_RUNTIME_IDENTICAL`

| Metric | WITH | WITHOUT |
|--------|------|---------|
| Span coverage | complete | complete |
| LexicalEdge | 2 | 2 |
| Paths | 1 | 1 |
| Domain Vote | [] | [] |
| Bucket | 1 | 1 |
| Assembly count | 2 | 2 |
| Assembly candidates | ["熔断策略阈之一按错误率重新校准。","熔断策略阈值已按错误率重新校准。"] | ["熔断策略阈之一按错误率重新校准。","熔断策略阈值已按错误率重新校准。"] |
| KenLM Top3 | ["熔断策略阈之一按错误率重新校准。","熔断策略阈值已按错误率重新校准。"] | ["熔断策略阈之一按错误率重新校准。","熔断策略阈值已按错误率重新校准。"] |
| Final | 熔断策略阈之一按错误率重新校准。 | 熔断策略阈之一按错误率重新校准。 |

### 降级策略

#### [陈述] 高峰时段会自动启用降级策略。

**Verdict:** `NODE_RUNTIME_IDENTICAL`

| Metric | WITH | WITHOUT |
|--------|------|---------|
| Span coverage | complete | complete |
| LexicalEdge | 1 | 1 |
| Paths | 1 | 1 |
| Domain Vote | [] | [] |
| Bucket | 1 | 1 |
| Assembly count | 1 | 1 |
| Assembly candidates | ["高峰时段会自动启用降级策略。"] | ["高峰时段会自动启用降级策略。"] |
| KenLM Top3 | ["高峰时段会自动启用降级策略。"] | ["高峰时段会自动启用降级策略。"] |
| Final | 高峰时段会自动启用降级策略。 | 高峰时段会自动启用降级策略。 |

#### [业务] 降级策略生效后非核心接口将返回缓存结果。

**Verdict:** `NODE_RUNTIME_IDENTICAL`

| Metric | WITH | WITHOUT |
|--------|------|---------|
| Span coverage | complete | complete |
| LexicalEdge | 1 | 1 |
| Paths | 1 | 1 |
| Domain Vote | [] | [] |
| Bucket | 1 | 1 |
| Assembly count | 1 | 1 |
| Assembly candidates | ["降级策略生效后非核心接口将返回缓存结果。"] | ["降级策略生效后非核心接口将返回缓存结果。"] |
| KenLM Top3 | ["降级策略生效后非核心接口将返回缓存结果。"] | ["降级策略生效后非核心接口将返回缓存结果。"] |
| Final | 降级策略生效后非核心接口将返回缓存结果。 | 降级策略生效后非核心接口将返回缓存结果。 |

### 正则策略

#### [陈述] 网关侧更新了请求过滤的正则策略。

**Verdict:** `NODE_RUNTIME_IDENTICAL`

| Metric | WITH | WITHOUT |
|--------|------|---------|
| Span coverage | complete | complete |
| LexicalEdge | 2 | 2 |
| Paths | 1 | 1 |
| Domain Vote | [] | [] |
| Bucket | 1 | 1 |
| Assembly count | 1 | 1 |
| Assembly candidates | ["网关侧更新了请求过滤的正则策略。"] | ["网关侧更新了请求过滤的正则策略。"] |
| KenLM Top3 | ["网关侧更新了请求过滤的正则策略。"] | ["网关侧更新了请求过滤的正则策略。"] |
| Final | 网关侧更新了请求过滤的正则策略。 | 网关侧更新了请求过滤的正则策略。 |

#### [业务] 请复核线上正则策略是否误伤正常流量。

**Verdict:** `NODE_RUNTIME_IDENTICAL`

| Metric | WITH | WITHOUT |
|--------|------|---------|
| Span coverage | complete | complete |
| LexicalEdge | 1 | 1 |
| Paths | 1 | 1 |
| Domain Vote | [] | [] |
| Bucket | 1 | 1 |
| Assembly count | 1 | 1 |
| Assembly candidates | ["请复核线上正则策略是否误伤正常流量。"] | ["请复核线上正则策略是否误伤正常流量。"] |
| KenLM Top3 | ["请复核线上正则策略是否误伤正常流量。"] | ["请复核线上正则策略是否误伤正常流量。"] |
| Final | 请复核线上正则策略是否误伤正常流量。 | 请复核线上正则策略是否误伤正常流量。 |

### 视频会议

#### [陈述] 下午三点我们安排一次视频会议。

**Verdict:** `NODE_RUNTIME_IDENTICAL` · soft: BUCKET

| Metric | WITH | WITHOUT |
|--------|------|---------|
| Span coverage | complete | complete |
| LexicalEdge | 3 | 2 |
| Paths | 2 | 1 |
| Domain Vote | [meeting] | [meeting] |
| Bucket | 2 | 1 |
| Assembly count | 1 | 1 |
| Assembly candidates | ["下午三点我们安排一次视频会议。"] | ["下午三点我们安排一次视频会议。"] |
| KenLM Top3 | ["下午三点我们安排一次视频会议。"] | ["下午三点我们安排一次视频会议。"] |
| Final | 下午三点我们安排一次视频会议。 | 下午三点我们安排一次视频会议。 |

#### [业务] 视频会议链接已经发送给全体参会人。

**Verdict:** `NODE_RUNTIME_IDENTICAL` · soft: BUCKET

| Metric | WITH | WITHOUT |
|--------|------|---------|
| Span coverage | complete | complete |
| LexicalEdge | 3 | 2 |
| Paths | 2 | 1 |
| Domain Vote | [meeting] | [meeting] |
| Bucket | 2 | 1 |
| Assembly count | 1 | 1 |
| Assembly candidates | ["视频会议链接已经发送给全体参会人。"] | ["视频会议链接已经发送给全体参会人。"] |
| KenLM Top3 | ["视频会议链接已经发送给全体参会人。"] | ["视频会议链接已经发送给全体参会人。"] |
| Final | 视频会议链接已经发送给全体参会人。 | 视频会议链接已经发送给全体参会人。 |

### 联系电话

#### [陈述] 请在表单中填写准确的联系电话。

**Verdict:** `NODE_RUNTIME_IDENTICAL` · soft: BUCKET

| Metric | WITH | WITHOUT |
|--------|------|---------|
| Span coverage | complete | complete |
| LexicalEdge | 3 | 2 |
| Paths | 2 | 1 |
| Domain Vote | [] | [] |
| Bucket | 2 | 1 |
| Assembly count | 1 | 1 |
| Assembly candidates | ["请在表单中填写准确的联系电话。"] | ["请在表单中填写准确的联系电话。"] |
| KenLM Top3 | ["请在表单中填写准确的联系电话。"] | ["请在表单中填写准确的联系电话。"] |
| Final | 请在表单中填写准确的联系电话。 | 请在表单中填写准确的联系电话。 |

#### [业务] 客人的联系电话已同步到前台系统。

**Verdict:** `NODE_RUNTIME_IDENTICAL` · soft: BUCKET

| Metric | WITH | WITHOUT |
|--------|------|---------|
| Span coverage | complete | complete |
| LexicalEdge | 3 | 2 |
| Paths | 2 | 1 |
| Domain Vote | [] | [] |
| Bucket | 2 | 1 |
| Assembly count | 1 | 1 |
| Assembly candidates | ["客人的联系电话已同步到前台系统。"] | ["客人的联系电话已同步到前台系统。"] |
| KenLM Top3 | ["客人的联系电话已同步到前台系统。"] | ["客人的联系电话已同步到前台系统。"] |
| Final | 客人的联系电话已同步到前台系统。 | 客人的联系电话已同步到前台系统。 |

### 迷你吧

#### [陈述] 客房里的迷你吧提供饮料和小食。

**Verdict:** `NODE_RUNTIME_IDENTICAL`

| Metric | WITH | WITHOUT |
|--------|------|---------|
| Span coverage | complete | complete |
| LexicalEdge | 2 | 2 |
| Paths | 1 | 1 |
| Domain Vote | [] | [] |
| Bucket | 1 | 1 |
| Assembly count | 2 | 2 |
| Assembly candidates | ["客房里的迷你吧提供饮料和消失。","客房里的迷你吧提供饮料和小食。"] | ["客房里的迷你吧提供饮料和消失。","客房里的迷你吧提供饮料和小食。"] |
| KenLM Top3 | ["客房里的迷你吧提供饮料和消失。","客房里的迷你吧提供饮料和小食。"] | ["客房里的迷你吧提供饮料和消失。","客房里的迷你吧提供饮料和小食。"] |
| Final | 客房里的迷你吧提供饮料和消失。 | 客房里的迷你吧提供饮料和消失。 |

#### [业务] 迷你吧消费会自动计入房账。

**Verdict:** `NODE_RUNTIME_IDENTICAL`

| Metric | WITH | WITHOUT |
|--------|------|---------|
| Span coverage | complete | complete |
| LexicalEdge | 1 | 1 |
| Paths | 1 | 1 |
| Domain Vote | [] | [] |
| Bucket | 1 | 1 |
| Assembly count | 1 | 1 |
| Assembly candidates | ["迷你吧消费会自动计入房账。"] | ["迷你吧消费会自动计入房账。"] |
| KenLM Top3 | ["迷你吧消费会自动计入房账。"] | ["迷你吧消费会自动计入房账。"] |
| Final | 迷你吧消费会自动计入房账。 | 迷你吧消费会自动计入房账。 |

### 邀请函

#### [陈述] 主办方已经寄出纸质邀请函。

**Verdict:** `NODE_RUNTIME_IDENTICAL`

| Metric | WITH | WITHOUT |
|--------|------|---------|
| Span coverage | complete | complete |
| LexicalEdge | 1 | 0 |
| Paths | 1 | 1 |
| Domain Vote | [] | [] |
| Bucket | 1 | 1 |
| Assembly count | 1 | 1 |
| Assembly candidates | ["主办方已经寄出纸质邀请函。"] | ["主办方已经寄出纸质邀请函。"] |
| KenLM Top3 | ["主办方已经寄出纸质邀请函。"] | ["主办方已经寄出纸质邀请函。"] |
| Final | 主办方已经寄出纸质邀请函。 | 主办方已经寄出纸质邀请函。 |

#### [业务] 请凭邀请函在签到处领取胸卡。

**Verdict:** `NODE_RUNTIME_IDENTICAL`

| Metric | WITH | WITHOUT |
|--------|------|---------|
| Span coverage | complete | complete |
| LexicalEdge | 1 | 0 |
| Paths | 1 | 1 |
| Domain Vote | [] | [] |
| Bucket | 1 | 1 |
| Assembly count | 1 | 1 |
| Assembly candidates | ["请凭邀请函在签到处领取胸卡。"] | ["请凭邀请函在签到处领取胸卡。"] |
| KenLM Top3 | ["请凭邀请函在签到处领取胸卡。"] | ["请凭邀请函在签到处领取胸卡。"] |
| Final | 请凭邀请函在签到处领取胸卡。 | 请凭邀请函在签到处领取胸卡。 |


---

## 6. Remaining Terms

### 专家系统

#### [陈述] 我们正在升级公司内部的专家系统平台。

**Verdict:** `NODE_RUNTIME_IDENTICAL` · soft: BUCKET

| Metric | WITH | WITHOUT |
|--------|------|---------|
| Span coverage | complete | complete |
| LexicalEdge | 5 | 4 |
| Paths | 2 | 1 |
| Domain Vote | [coffee] | [coffee] |
| Bucket | 2 | 1 |
| Assembly count | 2 | 2 |
| Assembly candidates | ["我闷蒸在升级公司内部的专家系统平台。","我们正在升级公司内部的专家系统平台。"] | ["我闷蒸在升级公司内部的专家系统平台。","我们正在升级公司内部的专家系统平台。"] |
| KenLM Top3 | ["我闷蒸在升级公司内部的专家系统平台。","我们正在升级公司内部的专家系统平台。"] | ["我闷蒸在升级公司内部的专家系统平台。","我们正在升级公司内部的专家系统平台。"] |
| Final | 我闷蒸在升级公司内部的专家系统平台。 | 我闷蒸在升级公司内部的专家系统平台。 |

#### [业务] 专家系统已经接入客服知识库并通过验收。

**Verdict:** `NODE_RUNTIME_IDENTICAL`

| Metric | WITH | WITHOUT |
|--------|------|---------|
| Span coverage | complete | complete |
| LexicalEdge | 4 | 3 |
| Paths | 1 | 1 |
| Domain Vote | [] | [] |
| Bucket | 1 | 1 |
| Assembly count | 2 | 2 |
| Assembly candidates | ["专家系统一经接入客服知识库并通过验收。","专家系统已经接入客服知识库并通过验收。"] | ["专家系统一经接入客服知识库并通过验收。","专家系统已经接入客服知识库并通过验收。"] |
| KenLM Top3 | ["专家系统一经接入客服知识库并通过验收。","专家系统已经接入客服知识库并通过验收。"] | ["专家系统一经接入客服知识库并通过验收。","专家系统已经接入客服知识库并通过验收。"] |
| Final | 专家系统一经接入客服知识库并通过验收。 | 专家系统一经接入客服知识库并通过验收。 |

### 安检通道

#### [陈述] 旅客需要提前十分钟到达安检通道排队。

**Verdict:** `NODE_RUNTIME_IDENTICAL` · soft: BUCKET

| Metric | WITH | WITHOUT |
|--------|------|---------|
| Span coverage | complete | complete |
| LexicalEdge | 4 | 3 |
| Paths | 2 | 1 |
| Domain Vote | [] | [] |
| Bucket | 2 | 1 |
| Assembly count | 1 | 1 |
| Assembly candidates | ["旅客需要提前十分钟到达安检通道排队。"] | ["旅客需要提前十分钟到达安检通道排队。"] |
| KenLM Top3 | ["旅客需要提前十分钟到达安检通道排队。"] | ["旅客需要提前十分钟到达安检通道排队。"] |
| Final | 旅客需要提前十分钟到达安检通道排队。 | 旅客需要提前十分钟到达安检通道排队。 |

#### [业务] 安检通道临时关闭请改走二号口。

**Verdict:** `NODE_RUNTIME_IDENTICAL` · soft: BUCKET

| Metric | WITH | WITHOUT |
|--------|------|---------|
| Span coverage | complete | complete |
| LexicalEdge | 3 | 2 |
| Paths | 2 | 1 |
| Domain Vote | [] | [] |
| Bucket | 2 | 1 |
| Assembly count | 1 | 1 |
| Assembly candidates | ["安检通道临时关闭请改走二号口。"] | ["安检通道临时关闭请改走二号口。"] |
| KenLM Top3 | ["安检通道临时关闭请改走二号口。"] | ["安检通道临时关闭请改走二号口。"] |
| Final | 安检通道临时关闭请改走二号口。 | 安检通道临时关闭请改走二号口。 |

### 循环网络

#### [陈述] 研究人员正在改进循环网络的训练稳定性。

**Verdict:** `NODE_RUNTIME_IDENTICAL` · soft: BUCKET

| Metric | WITH | WITHOUT |
|--------|------|---------|
| Span coverage | complete | complete |
| LexicalEdge | 3 | 2 |
| Paths | 2 | 1 |
| Domain Vote | [] | [] |
| Bucket | 2 | 1 |
| Assembly count | 1 | 1 |
| Assembly candidates | ["研究人员正在改进循环网络的训练稳定性。"] | ["研究人员正在改进循环网络的训练稳定性。"] |
| KenLM Top3 | ["研究人员正在改进循环网络的训练稳定性。"] | ["研究人员正在改进循环网络的训练稳定性。"] |
| Final | 研究人员正在改进循环网络的训练稳定性。 | 研究人员正在改进循环网络的训练稳定性。 |

#### [业务] 循环网络推理服务已在预发环境上线。

**Verdict:** `NODE_RUNTIME_IDENTICAL` · soft: BUCKET

| Metric | WITH | WITHOUT |
|--------|------|---------|
| Span coverage | complete | complete |
| LexicalEdge | 3 | 2 |
| Paths | 2 | 1 |
| Domain Vote | [] | [] |
| Bucket | 2 | 1 |
| Assembly count | 1 | 1 |
| Assembly candidates | ["循环网络推理服务已在预发环境上线。"] | ["循环网络推理服务已在预发环境上线。"] |
| KenLM Top3 | ["循环网络推理服务已在预发环境上线。"] | ["循环网络推理服务已在预发环境上线。"] |
| Final | 循环网络推理服务已在预发环境上线。 | 循环网络推理服务已在预发环境上线。 |

### 注册中心

#### [陈述] 微服务会定时向注册中心上报健康状态。

**Verdict:** `NODE_RUNTIME_IDENTICAL` · soft: BUCKET

| Metric | WITH | WITHOUT |
|--------|------|---------|
| Span coverage | complete | complete |
| LexicalEdge | 4 | 3 |
| Paths | 2 | 1 |
| Domain Vote | [] | [] |
| Bucket | 2 | 1 |
| Assembly count | 2 | 2 |
| Assembly candidates | ["微服务会定时向注册中心上报健康状态。","微服务会定时向注册忠心上报健康状态。"] | ["微服务会定时向注册中心上报健康状态。","微服务会定时向注册忠心上报健康状态。"] |
| KenLM Top3 | ["微服务会定时向注册中心上报健康状态。","微服务会定时向注册忠心上报健康状态。"] | ["微服务会定时向注册中心上报健康状态。","微服务会定时向注册忠心上报健康状态。"] |
| Final | 微服务会定时向注册中心上报健康状态。 | 微服务会定时向注册中心上报健康状态。 |

#### [业务] 注册中心故障会导致新实例无法发现。

**Verdict:** `NODE_RUNTIME_IDENTICAL` · soft: BUCKET

| Metric | WITH | WITHOUT |
|--------|------|---------|
| Span coverage | complete | complete |
| LexicalEdge | 3 | 2 |
| Paths | 2 | 1 |
| Domain Vote | [] | [] |
| Bucket | 2 | 1 |
| Assembly count | 2 | 2 |
| Assembly candidates | ["注册中心故障会导致新实例无法发现。","注册忠心故障会导致新实例无法发现。"] | ["注册中心故障会导致新实例无法发现。","注册忠心故障会导致新实例无法发现。"] |
| KenLM Top3 | ["注册中心故障会导致新实例无法发现。","注册忠心故障会导致新实例无法发现。"] | ["注册中心故障会导致新实例无法发现。","注册忠心故障会导致新实例无法发现。"] |
| Final | 注册中心故障会导致新实例无法发现。 | 注册中心故障会导致新实例无法发现。 |

### 配置中心

#### [陈述] 应用启动时会从配置中心拉取参数。

**Verdict:** `NODE_RUNTIME_IDENTICAL` · soft: BUCKET

| Metric | WITH | WITHOUT |
|--------|------|---------|
| Span coverage | complete | complete |
| LexicalEdge | 3 | 2 |
| Paths | 2 | 1 |
| Domain Vote | [] | [] |
| Bucket | 2 | 1 |
| Assembly count | 2 | 2 |
| Assembly candidates | ["应用启动时会从配置中心拉取参数。","应用启动时会从配置忠心拉取参数。"] | ["应用启动时会从配置中心拉取参数。","应用启动时会从配置忠心拉取参数。"] |
| KenLM Top3 | ["应用启动时会从配置中心拉取参数。","应用启动时会从配置忠心拉取参数。"] | ["应用启动时会从配置中心拉取参数。","应用启动时会从配置忠心拉取参数。"] |
| Final | 应用启动时会从配置中心拉取参数。 | 应用启动时会从配置中心拉取参数。 |

#### [业务] 配置中心发布后请观察服务是否热更新成功。

**Verdict:** `NODE_RUNTIME_IDENTICAL` · soft: BUCKET

| Metric | WITH | WITHOUT |
|--------|------|---------|
| Span coverage | complete | complete |
| LexicalEdge | 4 | 3 |
| Paths | 2 | 1 |
| Domain Vote | [] | [] |
| Bucket | 2 | 1 |
| Assembly count | 2 | 2 |
| Assembly candidates | ["配置中心发布后请观察服务是否热更新成功。","配置忠心发布后请观察服务是否热更新成功。"] | ["配置中心发布后请观察服务是否热更新成功。","配置忠心发布后请观察服务是否热更新成功。"] |
| KenLM Top3 | ["配置中心发布后请观察服务是否热更新成功。","配置忠心发布后请观察服务是否热更新成功。"] | ["配置中心发布后请观察服务是否热更新成功。","配置忠心发布后请观察服务是否热更新成功。"] |
| Final | 配置中心发布后请观察服务是否热更新成功。 | 配置中心发布后请观察服务是否热更新成功。 |


---

## 7. Architecture Implication

### 不可确认 DELETE_RUNTIME_SAFE

存在 **2** 句 `NODE_RUNTIME_REGRESSION`。进入 Source Cleanup 前必须先处理上述回归句。

---

## 8. Target Checklist

| ID | Target | Result |
|----|--------|--------|
| T1 | 22 terms | PASS |
| T2 | ≥2 sentences / term | PASS |
| T3 | ≥44 sentences | PASS (44) |
| T4–T8 | Full node FineSpan→KenLM | PASS |
| T9–T13 | Domain/Bucket/Assembly/KenLM/Final compare | PASS |
| T14 | WITH/WITHOUT | PASS |
| T15–T19 | No Source/SQLite/Runtime/Validator/KenLM change | PASS |
| T20–T21 | CSV + Markdown | PASS |
| T22–T23 | Counts | IDENTICAL=42 REGRESSION=2 |
| T24 | Confirm DELETE_RUNTIME_SAFE if all identical | **BLOCKED** |
