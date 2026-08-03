<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: CURRENT SSOT + Acceptance Records
Archive Path: docs/archive/HISTORICAL/FW_Repair_V4_Domain_Semantic_Atomicity_Reconciliation_Audit_2026_08_02.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: CURRENT SSOT + Acceptance Records

# FW Repair V4 — Domain-Semantic Atomicity Reconciliation Audit

| Field | Value |
|-------|-------|
| Date | 2026-08-02 |
| Nature | **READ ONLY · DOMAIN-SEMANTIC ATOMICITY** |
| Scope | 22 terms only |
| Status | **DOMAIN_ATOMICITY_READY** |

---

## 1. Executive Conclusion

```text
DOMAIN_ATOMICITY_READY

DELETE_DOMAIN_SAFE: 14
KEEP_DOMAIN_ATOMIC: 2
REVIEW_DOMAIN_MODEL: 6
```

表面可拆 ≠ Domain Vote 可无损恢复。本轮以 **Surface Atomicity + Domain-semantic Atomicity** 双合同分类，不修改 Vote / Tags / Source。

---

## 2. Audit Scope

仅 22 个前序 `DELETE_RUNTIME_SAFE` 候选；复用 Sentence Context Audit 原 44 句；Probe 排除完整 term。

---

## 3. Frozen Vote Contract

- 仅 `domain_term` / `passive_domain_weak` 投票
- `base_term` 不投票
- FineSpan 对同 domain presence ≤ 1
- **不是 Bug**；本轮不改 Vote

---

## 4. Domain-Semantic Atomicity Contract（建议冻结）

允许作为 Atomicity 例外保留，当且仅当：

1. 表面可拆；
2. 领域语义不能由原子词无损承载；
3. 原子补标签会造成过宽污染；
4. 删除会损失有效领域 presence；
5. 该领域标签本身真实有效。

---

## 5. Input Term Inventory

- 专家系统
- 单元测试
- 回归测试
- 安检通道
- 循环网络
- 正则策略
- 注册中心
- 流量镜像
- 测试数据
- 熔断策略
- 特征工程
- 神经网络
- 联系电话
- 视频会议
- 训练数据
- 迁移学习
- 迷你吧
- 邀请函
- 配置中心
- 配置文件
- 降级策略
- 集成测试

---

## 6. Compound-to-Atom Domain Reconciliation

| surface | compoundDomains | segments | union | missing |
|---------|-----------------|----------|-------|---------|
| 专家系统 | [] | 专家\|系统 | [] | [] |
| 单元测试 | [tech_ai] | 单元\|测试 | [] | [tech_ai] |
| 回归测试 | [tech_ai] | 回归\|测试 | [] | [tech_ai] |
| 安检通道 | [] | 安检\|通道 | [] | [] |
| 循环网络 | [] | 循环\|网络 | [] | [] |
| 正则策略 | [] | 正则\|策略 | [] | [] |
| 注册中心 | [] | 注册\|中心 | [] | [] |
| 流量镜像 | [] | 流量\|镜像 | [] | [] |
| 测试数据 | [tech_ai] | 测试\|数据 | [] | [tech_ai] |
| 熔断策略 | [] | 熔断\|策略 | [] | [] |
| 特征工程 | [tech_ai] | 特征\|工程 | [] | [tech_ai] |
| 神经网络 | [tech_ai] | 神经\|网络 | [] | [tech_ai] |
| 联系电话 | [] | 联系\|电话 | [] | [] |
| 视频会议 | [meeting] | 视频\|会议 | [meeting] | [] |
| 训练数据 | [tech_ai] | 训练\|数据 | [tech_ai] | [] |
| 迁移学习 | [] | 迁移\|学习 | [] | [] |
| 迷你吧 | [tourism_hotel] | 迷你\|吧 | [] | [tourism_hotel] |
| 邀请函 | [] | 邀请\|函 | [] | [] |
| 配置中心 | [] | 配置\|中心 | [] | [] |
| 配置文件 | [tech_ai] | 配置\|文件 | [] | [tech_ai] |
| 降级策略 | [] | 降级\|策略 | [] | [] |
| 集成测试 | [tech_ai] | 集成\|测试 | [] | [tech_ai] |

---

## 7. Compound Domain Validity

| surface | validity |
|---------|----------|
| 专家系统 | `INSUFFICIENT_EVIDENCE` |
| 单元测试 | `COMPOUND_DOMAIN_VALID` |
| 回归测试 | `COMPOUND_DOMAIN_VALID` |
| 安检通道 | `INSUFFICIENT_EVIDENCE` |
| 循环网络 | `INSUFFICIENT_EVIDENCE` |
| 正则策略 | `INSUFFICIENT_EVIDENCE` |
| 注册中心 | `INSUFFICIENT_EVIDENCE` |
| 流量镜像 | `INSUFFICIENT_EVIDENCE` |
| 测试数据 | `COMPOUND_DOMAIN_VALID` |
| 熔断策略 | `INSUFFICIENT_EVIDENCE` |
| 特征工程 | `COMPOUND_DOMAIN_VALID` |
| 神经网络 | `COMPOUND_DOMAIN_VALID` |
| 联系电话 | `INSUFFICIENT_EVIDENCE` |
| 视频会议 | `COMPOUND_DOMAIN_VALID` |
| 训练数据 | `COMPOUND_DOMAIN_VALID` |
| 迁移学习 | `INSUFFICIENT_EVIDENCE` |
| 迷你吧 | `COMPOUND_DOMAIN_VALID` |
| 邀请函 | `INSUFFICIENT_EVIDENCE` |
| 配置中心 | `INSUFFICIENT_EVIDENCE` |
| 配置文件 | `COMPOUND_DOMAIN_VALID` |
| 降级策略 | `INSUFFICIENT_EVIDENCE` |
| 集成测试 | `COMPOUND_DOMAIN_VALID` |

---

## 8. Atom Tag Feasibility

| surface | feasibility | note |
|---------|-------------|------|
| 专家系统 | `ATOM_TAG_NOT_APPLICABLE` | missing=[] |
| 单元测试 | `ATOM_TAG_TOO_BROAD` | missing=[tech_ai] |
| 回归测试 | `ATOM_TAG_TOO_BROAD` | missing=[tech_ai] |
| 安检通道 | `ATOM_TAG_NOT_APPLICABLE` | missing=[] |
| 循环网络 | `ATOM_TAG_NOT_APPLICABLE` | missing=[] |
| 正则策略 | `ATOM_TAG_NOT_APPLICABLE` | missing=[] |
| 注册中心 | `ATOM_TAG_NOT_APPLICABLE` | missing=[] |
| 流量镜像 | `ATOM_TAG_NOT_APPLICABLE` | missing=[] |
| 测试数据 | `ATOM_TAG_TOO_BROAD` | missing=[tech_ai] |
| 熔断策略 | `ATOM_TAG_NOT_APPLICABLE` | missing=[] |
| 特征工程 | `ATOM_TAG_TOO_BROAD` | missing=[tech_ai] |
| 神经网络 | `ATOM_TAG_TOO_BROAD` | missing=[tech_ai] |
| 联系电话 | `ATOM_TAG_NOT_APPLICABLE` | missing=[] |
| 视频会议 | `ATOM_TAG_NOT_APPLICABLE` | missing=[] |
| 训练数据 | `ATOM_TAG_NOT_APPLICABLE` | missing=[] |
| 迁移学习 | `ATOM_TAG_NOT_APPLICABLE` | missing=[] |
| 迷你吧 | `ATOM_TAG_TOO_BROAD` | missing=[tourism_hotel] |
| 邀请函 | `ATOM_TAG_NOT_APPLICABLE` | missing=[] |
| 配置中心 | `ATOM_TAG_NOT_APPLICABLE` | missing=[] |
| 配置文件 | `ATOM_TAG_TOO_BROAD` | missing=[tech_ai] |
| 降级策略 | `ATOM_TAG_NOT_APPLICABLE` | missing=[] |
| 集成测试 | `ATOM_TAG_TOO_BROAD` | missing=[tech_ai] |

**禁止**自动 `compoundDomains → copy to every segment`。

---

## 9. Presence Vote Trace Method

WITH = production Lattice + Assembly；WITHOUT = Probe filter `word===compound`。  
复用原句；输出 eligible voters / DomainSet / scores / retained / buckets。  
`effectiveLost` = retained 丢失且曾由 **compound 候选**贡献的 domain；噪声（如闷蒸→coffee）记入 `noiseOnlyLost`。

---

## 10. 神经网络 Detailed Trace

### 神经网络

- termId: `term-e7a59ee7bb8fe7bd`
- compoundDomains: [tech_ai]
- segments: 神经 | 网络
- segmentDomains: 神经=[]; 网络=[]
- union / missing: [] / **[tech_ai]**
- compoundDomainValidity: `COMPOUND_DOMAIN_VALID`
- atomTagFeasibility: `ATOM_TAG_TOO_BROAD`
- classification: **`KEEP_DOMAIN_ATOMIC`**
- sourceAction: `KEEP_WITH_DOMAIN_ATOMIC_EXCEPTION`
- reason: Domain-semantic atomicity: surface recoverable by atoms, but fine domain presence lives only on compound; atom retag would be too broad/ambiguous

#### [陈述] 我们正在训练神经网络模型。

| | WITH | WITHOUT |
|--|------|---------|
| retainedDomains | [coffee, tech_ai] | [coffee] |
| domainScores | `{"coffee":1,"tech_ai":1}` | `{"coffee":1}` |
| compoundVote | [tech_ai] | — |
| effectiveLost | **[tech_ai]** | |
| noiseOnlyLost | [] | |
| Final | 我闷蒸在训练神经网络模型。 | 我闷蒸在训练神经网络模型。 |

Vote-eligible WITH:
- `闷蒸` source=domain_term domains=[coffee] **NOISE**
- `神经网络` source=domain_term domains=[tech_ai]

Vote-eligible WITHOUT:
- `闷蒸` source=domain_term domains=[coffee] **NOISE**

#### [业务] 神经网络模型已经部署完成。

| | WITH | WITHOUT |
|--|------|---------|
| retainedDomains | [] | [] |
| domainScores | `{}` | `{}` |
| compoundVote | [] | — |
| effectiveLost | **[]** | |
| noiseOnlyLost | [] | |
| Final | 神经网络模型已经部署完成。 | 神经网络模型已经部署完成。 |

Vote-eligible WITH:
_none_

Vote-eligible WITHOUT:
_none_


专项问答：

1. compound domains 是否 tech_ai？ **是** `[tech_ai]`，validity=`COMPOUND_DOMAIN_VALID`
2. 原子为何不投票？ `神经`/`网络` domains=[] → `base_term`
3. 补 tech_ai 是否过宽？ **是**（`神经` medical 碰撞；`网络` 泛化）→ `ATOM_TAG_TOO_BROAD`
4. 删除是否使错误领域成唯一 retained？ 陈述句 WITH=[coffee,tech_ai] WITHOUT=[coffee] — **tech_ai 丢失后噪声 coffee 可独留**（需与 compound 价值分开）
5. 是否 KEEP_DOMAIN_ATOMIC？ **`KEEP_DOMAIN_ATOMIC`**

---

## 11. 单元测试 Detailed Trace

### 单元测试

- termId: `term-e58d95e58583e6b5`
- compoundDomains: [tech_ai]
- segments: 单元 | 测试
- segmentDomains: 单元=[]; 测试=[]
- union / missing: [] / **[tech_ai]**
- compoundDomainValidity: `COMPOUND_DOMAIN_VALID`
- atomTagFeasibility: `ATOM_TAG_TOO_BROAD`
- classification: **`KEEP_DOMAIN_ATOMIC`**
- sourceAction: `KEEP_WITH_DOMAIN_ATOMIC_EXCEPTION`
- reason: Domain-semantic atomicity: surface recoverable by atoms, but fine domain presence lives only on compound; atom retag would be too broad/ambiguous

#### [陈述] 开发同学今天补齐了核心模块的单元测试。

| | WITH | WITHOUT |
|--|------|---------|
| retainedDomains | [] | [] |
| domainScores | `{}` | `{}` |
| compoundVote | [] | — |
| effectiveLost | **[]** | |
| noiseOnlyLost | [] | |
| Final | 开发同学今天补齐了核心模块的单元测试。 | 开发同学今天补齐了核心模块的单元测试。 |

Vote-eligible WITH:
_none_

Vote-eligible WITHOUT:
_none_

#### [业务] 请在合并前确保单元测试全部通过。

| | WITH | WITHOUT |
|--|------|---------|
| retainedDomains | [tech_ai] | [] |
| domainScores | `{"tech_ai":1}` | `{}` |
| compoundVote | [tech_ai] | — |
| effectiveLost | **[tech_ai]** | |
| noiseOnlyLost | [] | |
| Final | 请在合并前确保单元测试全部通过。 | 请在合并前确保单元测试全部通过。 |

Vote-eligible WITH:
- `单元测试` source=domain_term domains=[tech_ai]

Vote-eligible WITHOUT:
_none_


专项问答：

1. domains=tech_ai？ **是**，`COMPOUND_DOMAIN_VALID`
2. 原子不投票：`单元`/`测试` domains=[]
3. 补标签过宽？ **是**（`测试` 泛化）→ `ATOM_TAG_TOO_BROAD`
4. 删除后 retained：业务句 tech_ai→∅（无噪声独留）
5. 分类：**`KEEP_DOMAIN_ATOMIC`**

---

## 12. Remaining 20 Terms

### 专家系统

- termId: `term-e4b893e5aeb6e7b3`
- compoundDomains: []
- segments: 专家 | 系统
- segmentDomains: 专家=[]; 系统=[]
- union / missing: [] / **[]**
- compoundDomainValidity: `INSUFFICIENT_EVIDENCE`
- atomTagFeasibility: `ATOM_TAG_NOT_APPLICABLE`
- classification: **`DELETE_DOMAIN_SAFE`**
- sourceAction: `DELETE_SOURCE_ROW`
- reason: compoundDomains empty; Domain Vote does not depend on compound; surface already recoverable

#### [陈述] 我们正在升级公司内部的专家系统平台。

| | WITH | WITHOUT |
|--|------|---------|
| retainedDomains | [coffee] | [coffee] |
| domainScores | `{"coffee":1}` | `{"coffee":1}` |
| compoundVote | [] | — |
| effectiveLost | **[]** | |
| noiseOnlyLost | [] | |
| Final | 我闷蒸在升级公司内部的专家系统平台。 | 我闷蒸在升级公司内部的专家系统平台。 |

Vote-eligible WITH:
- `闷蒸` source=domain_term domains=[coffee] **NOISE**

Vote-eligible WITHOUT:
- `闷蒸` source=domain_term domains=[coffee] **NOISE**

#### [业务] 专家系统已经接入客服知识库并通过验收。

| | WITH | WITHOUT |
|--|------|---------|
| retainedDomains | [] | [] |
| domainScores | `{}` | `{}` |
| compoundVote | [] | — |
| effectiveLost | **[]** | |
| noiseOnlyLost | [] | |
| Final | 专家系统一经接入客服知识库并通过验收。 | 专家系统一经接入客服知识库并通过验收。 |

Vote-eligible WITH:
_none_

Vote-eligible WITHOUT:
_none_


### 回归测试

- termId: `term-e59b9ee5bd92e6b5`
- compoundDomains: [tech_ai]
- segments: 回归 | 测试
- segmentDomains: 回归=[]; 测试=[]
- union / missing: [] / **[tech_ai]**
- compoundDomainValidity: `COMPOUND_DOMAIN_VALID`
- atomTagFeasibility: `ATOM_TAG_TOO_BROAD`
- classification: **`REVIEW_DOMAIN_MODEL`**
- sourceAction: `KEEP_PENDING_DOMAIN_REVIEW`
- reason: compound has valid-looking fine domain tags and atoms cannot safely carry them, but current sentence fixtures did not activate compound as vote-eligible candidate — need clearer Vote Trace

#### [陈述] 我们计划在发版前完成完整回归测试。

| | WITH | WITHOUT |
|--|------|---------|
| retainedDomains | [] | [] |
| domainScores | `{}` | `{}` |
| compoundVote | [] | — |
| effectiveLost | **[]** | |
| noiseOnlyLost | [] | |
| Final | 我们计划在发版前完成完整回归测试。 | 我们计划在发版前完成完整回归测试。 |

Vote-eligible WITH:
_none_

Vote-eligible WITHOUT:
_none_

#### [业务] 回归测试报告已经同步给质量保障团队。

| | WITH | WITHOUT |
|--|------|---------|
| retainedDomains | [] | [] |
| domainScores | `{}` | `{}` |
| compoundVote | [] | — |
| effectiveLost | **[]** | |
| noiseOnlyLost | [] | |
| Final | 回归测试报告已精通步给质量保障团队。 | 回归测试报告已精通步给质量保障团队。 |

Vote-eligible WITH:
_none_

Vote-eligible WITHOUT:
_none_


### 安检通道

- termId: `term-e5ae89e6a380e980`
- compoundDomains: []
- segments: 安检 | 通道
- segmentDomains: 安检=[]; 通道=[]
- union / missing: [] / **[]**
- compoundDomainValidity: `INSUFFICIENT_EVIDENCE`
- atomTagFeasibility: `ATOM_TAG_NOT_APPLICABLE`
- classification: **`DELETE_DOMAIN_SAFE`**
- sourceAction: `DELETE_SOURCE_ROW`
- reason: compoundDomains empty; Domain Vote does not depend on compound; surface already recoverable

#### [陈述] 旅客需要提前十分钟到达安检通道排队。

| | WITH | WITHOUT |
|--|------|---------|
| retainedDomains | [] | [] |
| domainScores | `{}` | `{}` |
| compoundVote | [] | — |
| effectiveLost | **[]** | |
| noiseOnlyLost | [] | |
| Final | 旅客需要提前十分钟到达安检通道排队。 | 旅客需要提前十分钟到达安检通道排队。 |

Vote-eligible WITH:
_none_

Vote-eligible WITHOUT:
_none_

#### [业务] 安检通道临时关闭请改走二号口。

| | WITH | WITHOUT |
|--|------|---------|
| retainedDomains | [] | [] |
| domainScores | `{}` | `{}` |
| compoundVote | [] | — |
| effectiveLost | **[]** | |
| noiseOnlyLost | [] | |
| Final | 安检通道临时关闭请改走二号口。 | 安检通道临时关闭请改走二号口。 |

Vote-eligible WITH:
_none_

Vote-eligible WITHOUT:
_none_


### 循环网络

- termId: `term-e5beaae78eafe7bd`
- compoundDomains: []
- segments: 循环 | 网络
- segmentDomains: 循环=[]; 网络=[]
- union / missing: [] / **[]**
- compoundDomainValidity: `INSUFFICIENT_EVIDENCE`
- atomTagFeasibility: `ATOM_TAG_NOT_APPLICABLE`
- classification: **`DELETE_DOMAIN_SAFE`**
- sourceAction: `DELETE_SOURCE_ROW`
- reason: compoundDomains empty; Domain Vote does not depend on compound; surface already recoverable

#### [陈述] 研究人员正在改进循环网络的训练稳定性。

| | WITH | WITHOUT |
|--|------|---------|
| retainedDomains | [] | [] |
| domainScores | `{}` | `{}` |
| compoundVote | [] | — |
| effectiveLost | **[]** | |
| noiseOnlyLost | [] | |
| Final | 研究人员正在改进循环网络的训练稳定性。 | 研究人员正在改进循环网络的训练稳定性。 |

Vote-eligible WITH:
_none_

Vote-eligible WITHOUT:
_none_

#### [业务] 循环网络推理服务已在预发环境上线。

| | WITH | WITHOUT |
|--|------|---------|
| retainedDomains | [] | [] |
| domainScores | `{}` | `{}` |
| compoundVote | [] | — |
| effectiveLost | **[]** | |
| noiseOnlyLost | [] | |
| Final | 循环网络推理服务已在预发环境上线。 | 循环网络推理服务已在预发环境上线。 |

Vote-eligible WITH:
_none_

Vote-eligible WITHOUT:
_none_


### 正则策略

- termId: `term-e6ada3e58899e7ad`
- compoundDomains: []
- segments: 正则 | 策略
- segmentDomains: 正则=[]; 策略=[]
- union / missing: [] / **[]**
- compoundDomainValidity: `INSUFFICIENT_EVIDENCE`
- atomTagFeasibility: `ATOM_TAG_NOT_APPLICABLE`
- classification: **`DELETE_DOMAIN_SAFE`**
- sourceAction: `DELETE_SOURCE_ROW`
- reason: compoundDomains empty; Domain Vote does not depend on compound; surface already recoverable

#### [陈述] 网关侧更新了请求过滤的正则策略。

| | WITH | WITHOUT |
|--|------|---------|
| retainedDomains | [] | [] |
| domainScores | `{}` | `{}` |
| compoundVote | [] | — |
| effectiveLost | **[]** | |
| noiseOnlyLost | [] | |
| Final | 网关侧更新了请求过滤的正则策略。 | 网关侧更新了请求过滤的正则策略。 |

Vote-eligible WITH:
_none_

Vote-eligible WITHOUT:
_none_

#### [业务] 请复核线上正则策略是否误伤正常流量。

| | WITH | WITHOUT |
|--|------|---------|
| retainedDomains | [] | [] |
| domainScores | `{}` | `{}` |
| compoundVote | [] | — |
| effectiveLost | **[]** | |
| noiseOnlyLost | [] | |
| Final | 请复核线上正则策略是否误伤正常流量。 | 请复核线上正则策略是否误伤正常流量。 |

Vote-eligible WITH:
_none_

Vote-eligible WITHOUT:
_none_


### 注册中心

- termId: `term-e6b3a8e5868ce4b8`
- compoundDomains: []
- segments: 注册 | 中心
- segmentDomains: 注册=[]; 中心=[]
- union / missing: [] / **[]**
- compoundDomainValidity: `INSUFFICIENT_EVIDENCE`
- atomTagFeasibility: `ATOM_TAG_NOT_APPLICABLE`
- classification: **`DELETE_DOMAIN_SAFE`**
- sourceAction: `DELETE_SOURCE_ROW`
- reason: compoundDomains empty; Domain Vote does not depend on compound; surface already recoverable

#### [陈述] 微服务会定时向注册中心上报健康状态。

| | WITH | WITHOUT |
|--|------|---------|
| retainedDomains | [] | [] |
| domainScores | `{}` | `{}` |
| compoundVote | [] | — |
| effectiveLost | **[]** | |
| noiseOnlyLost | [] | |
| Final | 微服务会定时向注册中心上报健康状态。 | 微服务会定时向注册中心上报健康状态。 |

Vote-eligible WITH:
_none_

Vote-eligible WITHOUT:
_none_

#### [业务] 注册中心故障会导致新实例无法发现。

| | WITH | WITHOUT |
|--|------|---------|
| retainedDomains | [] | [] |
| domainScores | `{}` | `{}` |
| compoundVote | [] | — |
| effectiveLost | **[]** | |
| noiseOnlyLost | [] | |
| Final | 注册中心故障会导致新实例无法发现。 | 注册中心故障会导致新实例无法发现。 |

Vote-eligible WITH:
_none_

Vote-eligible WITHOUT:
_none_


### 流量镜像

- termId: `term-e6b581e9878fe995`
- compoundDomains: []
- segments: 流量 | 镜像
- segmentDomains: 流量=[]; 镜像=[]
- union / missing: [] / **[]**
- compoundDomainValidity: `INSUFFICIENT_EVIDENCE`
- atomTagFeasibility: `ATOM_TAG_NOT_APPLICABLE`
- classification: **`DELETE_DOMAIN_SAFE`**
- sourceAction: `DELETE_SOURCE_ROW`
- reason: compoundDomains empty; Domain Vote does not depend on compound; surface already recoverable

#### [陈述] 我们准备对关键接口开启流量镜像。

| | WITH | WITHOUT |
|--|------|---------|
| retainedDomains | [] | [] |
| domainScores | `{}` | `{}` |
| compoundVote | [] | — |
| effectiveLost | **[]** | |
| noiseOnlyLost | [] | |
| Final | 我们准备对关键接口开启流量镜像。 | 我们准备对关键接口开启流量镜像。 |

Vote-eligible WITH:
_none_

Vote-eligible WITHOUT:
_none_

#### [业务] 流量镜像已经导向影子集群进行对比验证。

| | WITH | WITHOUT |
|--|------|---------|
| retainedDomains | [] | [] |
| domainScores | `{}` | `{}` |
| compoundVote | [] | — |
| effectiveLost | **[]** | |
| noiseOnlyLost | [] | |
| Final | 流量镜像已经导向影子集群进行对比验证。 | 流量镜像已经导向影子集群进行对比验证。 |

Vote-eligible WITH:
_none_

Vote-eligible WITHOUT:
_none_


### 测试数据

- termId: `term-e6b58be8af95e695`
- compoundDomains: [tech_ai]
- segments: 测试 | 数据
- segmentDomains: 测试=[]; 数据=[]
- union / missing: [] / **[tech_ai]**
- compoundDomainValidity: `COMPOUND_DOMAIN_VALID`
- atomTagFeasibility: `ATOM_TAG_TOO_BROAD`
- classification: **`REVIEW_DOMAIN_MODEL`**
- sourceAction: `KEEP_PENDING_DOMAIN_REVIEW`
- reason: compound has valid-looking fine domain tags and atoms cannot safely carry them, but current sentence fixtures did not activate compound as vote-eligible candidate — need clearer Vote Trace

#### [陈述] 请不要把生产订单混入测试数据集合。

| | WITH | WITHOUT |
|--|------|---------|
| retainedDomains | [] | [] |
| domainScores | `{}` | `{}` |
| compoundVote | [] | — |
| effectiveLost | **[]** | |
| noiseOnlyLost | [] | |
| Final | 请不要把生产订单混入测试数据集合。 | 请不要把生产订单混入测试数据集合。 |

Vote-eligible WITH:
_none_

Vote-eligible WITHOUT:
_none_

#### [业务] 测试数据已脱敏并导入联调环境。

| | WITH | WITHOUT |
|--|------|---------|
| retainedDomains | [] | [] |
| domainScores | `{}` | `{}` |
| compoundVote | [] | — |
| effectiveLost | **[]** | |
| noiseOnlyLost | [] | |
| Final | 测试数据依托敏并导入联调环境。 | 测试数据依托敏并导入联调环境。 |

Vote-eligible WITH:
_none_

Vote-eligible WITHOUT:
_none_


### 熔断策略

- termId: `term-e78694e696ade7ad`
- compoundDomains: []
- segments: 熔断 | 策略
- segmentDomains: 熔断=[]; 策略=[]
- union / missing: [] / **[]**
- compoundDomainValidity: `INSUFFICIENT_EVIDENCE`
- atomTagFeasibility: `ATOM_TAG_NOT_APPLICABLE`
- classification: **`DELETE_DOMAIN_SAFE`**
- sourceAction: `DELETE_SOURCE_ROW`
- reason: compoundDomains empty; Domain Vote does not depend on compound; surface already recoverable

#### [陈述] 调用下游超时后会触发熔断策略保护。

| | WITH | WITHOUT |
|--|------|---------|
| retainedDomains | [] | [] |
| domainScores | `{}` | `{}` |
| compoundVote | [] | — |
| effectiveLost | **[]** | |
| noiseOnlyLost | [] | |
| Final | 调用下游超时后会出发熔断策略保护。 | 调用下游超时后会出发熔断策略保护。 |

Vote-eligible WITH:
_none_

Vote-eligible WITHOUT:
_none_

#### [业务] 熔断策略阈值已按错误率重新校准。

| | WITH | WITHOUT |
|--|------|---------|
| retainedDomains | [] | [] |
| domainScores | `{}` | `{}` |
| compoundVote | [] | — |
| effectiveLost | **[]** | |
| noiseOnlyLost | [] | |
| Final | 熔断策略阈之一按错误率重新校准。 | 熔断策略阈之一按错误率重新校准。 |

Vote-eligible WITH:
_none_

Vote-eligible WITHOUT:
_none_


### 特征工程

- termId: `term-e789b9e5be81e5b7`
- compoundDomains: [tech_ai]
- segments: 特征 | 工程
- segmentDomains: 特征=[]; 工程=[]
- union / missing: [] / **[tech_ai]**
- compoundDomainValidity: `COMPOUND_DOMAIN_VALID`
- atomTagFeasibility: `ATOM_TAG_TOO_BROAD`
- classification: **`REVIEW_DOMAIN_MODEL`**
- sourceAction: `KEEP_PENDING_DOMAIN_REVIEW`
- reason: compound has valid-looking fine domain tags and atoms cannot safely carry them, but current sentence fixtures did not activate compound as vote-eligible candidate — need clearer Vote Trace

#### [陈述] 算法同学这周重点优化特征工程流水线。

| | WITH | WITHOUT |
|--|------|---------|
| retainedDomains | [] | [] |
| domainScores | `{}` | `{}` |
| compoundVote | [] | — |
| effectiveLost | **[]** | |
| noiseOnlyLost | [] | |
| Final | 算法同学这周重点优化特征工程流水线。 | 算法同学这周重点优化特征工程流水线。 |

Vote-eligible WITH:
_none_

Vote-eligible WITHOUT:
_none_

#### [业务] 特征工程结果已经写入特征存储服务。

| | WITH | WITHOUT |
|--|------|---------|
| retainedDomains | [] | [] |
| domainScores | `{}` | `{}` |
| compoundVote | [] | — |
| effectiveLost | **[]** | |
| noiseOnlyLost | [] | |
| Final | 特征工程结果已经写入特征存储服务。 | 特征工程结果已经写入特征存储服务。 |

Vote-eligible WITH:
_none_

Vote-eligible WITHOUT:
_none_


### 联系电话

- termId: `term-e88194e7b3bbe794`
- compoundDomains: []
- segments: 联系 | 电话
- segmentDomains: 联系=[]; 电话=[]
- union / missing: [] / **[]**
- compoundDomainValidity: `INSUFFICIENT_EVIDENCE`
- atomTagFeasibility: `ATOM_TAG_NOT_APPLICABLE`
- classification: **`DELETE_DOMAIN_SAFE`**
- sourceAction: `DELETE_SOURCE_ROW`
- reason: compoundDomains empty; Domain Vote does not depend on compound; surface already recoverable

#### [陈述] 请在表单中填写准确的联系电话。

| | WITH | WITHOUT |
|--|------|---------|
| retainedDomains | [] | [] |
| domainScores | `{}` | `{}` |
| compoundVote | [] | — |
| effectiveLost | **[]** | |
| noiseOnlyLost | [] | |
| Final | 请在表单中填写准确的联系电话。 | 请在表单中填写准确的联系电话。 |

Vote-eligible WITH:
_none_

Vote-eligible WITHOUT:
_none_

#### [业务] 客人的联系电话已同步到前台系统。

| | WITH | WITHOUT |
|--|------|---------|
| retainedDomains | [] | [] |
| domainScores | `{}` | `{}` |
| compoundVote | [] | — |
| effectiveLost | **[]** | |
| noiseOnlyLost | [] | |
| Final | 客人的联系电话已同步到前台系统。 | 客人的联系电话已同步到前台系统。 |

Vote-eligible WITH:
_none_

Vote-eligible WITHOUT:
_none_


### 视频会议

- termId: `term-e8a786e9a291e4bc`
- compoundDomains: [meeting]
- segments: 视频 | 会议
- segmentDomains: 视频=[]; 会议=[meeting]
- union / missing: [meeting] / **[]**
- compoundDomainValidity: `COMPOUND_DOMAIN_VALID`
- atomTagFeasibility: `ATOM_TAG_NOT_APPLICABLE`
- classification: **`DELETE_DOMAIN_SAFE`**
- sourceAction: `DELETE_SOURCE_ROW`
- reason: segment domain union already covers compoundDomains; Vote not compound-dependent

#### [陈述] 下午三点我们安排一次视频会议。

| | WITH | WITHOUT |
|--|------|---------|
| retainedDomains | [meeting] | [meeting] |
| domainScores | `{"meeting":1}` | `{"meeting":1}` |
| compoundVote | [] | — |
| effectiveLost | **[]** | |
| noiseOnlyLost | [] | |
| Final | 下午三点我们安排一次视频会议。 | 下午三点我们安排一次视频会议。 |

Vote-eligible WITH:
- `会议` source=domain_term domains=[meeting]

Vote-eligible WITHOUT:
- `会议` source=domain_term domains=[meeting]

#### [业务] 视频会议链接已经发送给全体参会人。

| | WITH | WITHOUT |
|--|------|---------|
| retainedDomains | [meeting] | [meeting] |
| domainScores | `{"meeting":1}` | `{"meeting":1}` |
| compoundVote | [] | — |
| effectiveLost | **[]** | |
| noiseOnlyLost | [] | |
| Final | 视频会议链接已经发送给全体参会人。 | 视频会议链接已经发送给全体参会人。 |

Vote-eligible WITH:
- `会议` source=domain_term domains=[meeting]

Vote-eligible WITHOUT:
- `会议` source=domain_term domains=[meeting]


### 训练数据

- termId: `term-e8aeade7bb83e695`
- compoundDomains: [tech_ai]
- segments: 训练 | 数据
- segmentDomains: 训练=[tech_ai]; 数据=[]
- union / missing: [tech_ai] / **[]**
- compoundDomainValidity: `COMPOUND_DOMAIN_VALID`
- atomTagFeasibility: `ATOM_TAG_NOT_APPLICABLE`
- classification: **`DELETE_DOMAIN_SAFE`**
- sourceAction: `DELETE_SOURCE_ROW`
- reason: segment domain union already covers compoundDomains; Vote not compound-dependent

#### [陈述] 模型效果依赖高质量的训练数据。

| | WITH | WITHOUT |
|--|------|---------|
| retainedDomains | [tech_ai] | [tech_ai] |
| domainScores | `{"tech_ai":1}` | `{"tech_ai":1}` |
| compoundVote | [] | — |
| effectiveLost | **[]** | |
| noiseOnlyLost | [] | |
| Final | 模型效果依赖高质量的训练数据。 | 模型效果依赖高质量的训练数据。 |

Vote-eligible WITH:
- `训练` source=domain_term domains=[tech_ai]

Vote-eligible WITHOUT:
- `训练` source=domain_term domains=[tech_ai]

#### [业务] 训练数据批次已完成标注并入库。

| | WITH | WITHOUT |
|--|------|---------|
| retainedDomains | [tech_ai] | [tech_ai] |
| domainScores | `{"tech_ai":1}` | `{"tech_ai":1}` |
| compoundVote | [] | — |
| effectiveLost | **[]** | |
| noiseOnlyLost | [] | |
| Final | 训练数据批次已完成标注并入库。 | 训练数据批次已完成标注并入库。 |

Vote-eligible WITH:
- `训练` source=domain_term domains=[tech_ai]

Vote-eligible WITHOUT:
- `训练` source=domain_term domains=[tech_ai]


### 迁移学习

- termId: `term-e8bf81e7a7bbe5ad`
- compoundDomains: []
- segments: 迁移 | 学习
- segmentDomains: 迁移=[]; 学习=[]
- union / missing: [] / **[]**
- compoundDomainValidity: `INSUFFICIENT_EVIDENCE`
- atomTagFeasibility: `ATOM_TAG_NOT_APPLICABLE`
- classification: **`DELETE_DOMAIN_SAFE`**
- sourceAction: `DELETE_SOURCE_ROW`
- reason: compoundDomains empty; Domain Vote does not depend on compound; surface already recoverable

#### [陈述] 团队决定采用迁移学习加速冷启动。

| | WITH | WITHOUT |
|--|------|---------|
| retainedDomains | [] | [] |
| domainScores | `{}` | `{}` |
| compoundVote | [] | — |
| effectiveLost | **[]** | |
| noiseOnlyLost | [] | |
| Final | 团队决定采用迁移学习加速冷启动。 | 团队决定采用迁移学习加速冷启动。 |

Vote-eligible WITH:
_none_

Vote-eligible WITHOUT:
_none_

#### [业务] 迁移学习实验在验证集上提升明显。

| | WITH | WITHOUT |
|--|------|---------|
| retainedDomains | [] | [] |
| domainScores | `{}` | `{}` |
| compoundVote | [] | — |
| effectiveLost | **[]** | |
| noiseOnlyLost | [] | |
| Final | 迁移学习实验在验证集上提升明显。 | 迁移学习实验在验证集上提升明显。 |

Vote-eligible WITH:
_none_

Vote-eligible WITHOUT:
_none_


### 迷你吧

- termId: `term-e8bfb7e4bda0e590`
- compoundDomains: [tourism_hotel]
- segments: 迷你 | 吧
- segmentDomains: 迷你=[]; 吧=[]
- union / missing: [] / **[tourism_hotel]**
- compoundDomainValidity: `COMPOUND_DOMAIN_VALID`
- atomTagFeasibility: `ATOM_TAG_TOO_BROAD`
- classification: **`REVIEW_DOMAIN_MODEL`**
- sourceAction: `KEEP_PENDING_DOMAIN_REVIEW`
- reason: compound has valid-looking fine domain tags and atoms cannot safely carry them, but current sentence fixtures did not activate compound as vote-eligible candidate — need clearer Vote Trace

#### [陈述] 客房里的迷你吧提供饮料和小食。

| | WITH | WITHOUT |
|--|------|---------|
| retainedDomains | [] | [] |
| domainScores | `{}` | `{}` |
| compoundVote | [] | — |
| effectiveLost | **[]** | |
| noiseOnlyLost | [] | |
| Final | 客房里的迷你吧提供饮料和消失。 | 客房里的迷你吧提供饮料和消失。 |

Vote-eligible WITH:
_none_

Vote-eligible WITHOUT:
_none_

#### [业务] 迷你吧消费会自动计入房账。

| | WITH | WITHOUT |
|--|------|---------|
| retainedDomains | [] | [] |
| domainScores | `{}` | `{}` |
| compoundVote | [] | — |
| effectiveLost | **[]** | |
| noiseOnlyLost | [] | |
| Final | 迷你吧消费会自动计入房账。 | 迷你吧消费会自动计入房账。 |

Vote-eligible WITH:
_none_

Vote-eligible WITHOUT:
_none_


### 邀请函

- termId: `term-e98280e8afb7e587`
- compoundDomains: []
- segments: 邀请 | 函
- segmentDomains: 邀请=[]; 函=[]
- union / missing: [] / **[]**
- compoundDomainValidity: `INSUFFICIENT_EVIDENCE`
- atomTagFeasibility: `ATOM_TAG_NOT_APPLICABLE`
- classification: **`DELETE_DOMAIN_SAFE`**
- sourceAction: `DELETE_SOURCE_ROW`
- reason: compoundDomains empty; Domain Vote does not depend on compound; surface already recoverable

#### [陈述] 主办方已经寄出纸质邀请函。

| | WITH | WITHOUT |
|--|------|---------|
| retainedDomains | [] | [] |
| domainScores | `{}` | `{}` |
| compoundVote | [] | — |
| effectiveLost | **[]** | |
| noiseOnlyLost | [] | |
| Final | 主办方已经寄出纸质邀请函。 | 主办方已经寄出纸质邀请函。 |

Vote-eligible WITH:
_none_

Vote-eligible WITHOUT:
_none_

#### [业务] 请凭邀请函在签到处领取胸卡。

| | WITH | WITHOUT |
|--|------|---------|
| retainedDomains | [] | [] |
| domainScores | `{}` | `{}` |
| compoundVote | [] | — |
| effectiveLost | **[]** | |
| noiseOnlyLost | [] | |
| Final | 请凭邀请函在签到处领取胸卡。 | 请凭邀请函在签到处领取胸卡。 |

Vote-eligible WITH:
_none_

Vote-eligible WITHOUT:
_none_


### 配置中心

- termId: `term-e9858de7bdaee4b8`
- compoundDomains: []
- segments: 配置 | 中心
- segmentDomains: 配置=[]; 中心=[]
- union / missing: [] / **[]**
- compoundDomainValidity: `INSUFFICIENT_EVIDENCE`
- atomTagFeasibility: `ATOM_TAG_NOT_APPLICABLE`
- classification: **`DELETE_DOMAIN_SAFE`**
- sourceAction: `DELETE_SOURCE_ROW`
- reason: compoundDomains empty; Domain Vote does not depend on compound; surface already recoverable

#### [陈述] 应用启动时会从配置中心拉取参数。

| | WITH | WITHOUT |
|--|------|---------|
| retainedDomains | [] | [] |
| domainScores | `{}` | `{}` |
| compoundVote | [] | — |
| effectiveLost | **[]** | |
| noiseOnlyLost | [] | |
| Final | 应用启动时会从配置中心拉取参数。 | 应用启动时会从配置中心拉取参数。 |

Vote-eligible WITH:
_none_

Vote-eligible WITHOUT:
_none_

#### [业务] 配置中心发布后请观察服务是否热更新成功。

| | WITH | WITHOUT |
|--|------|---------|
| retainedDomains | [] | [] |
| domainScores | `{}` | `{}` |
| compoundVote | [] | — |
| effectiveLost | **[]** | |
| noiseOnlyLost | [] | |
| Final | 配置中心发布后请观察服务是否热更新成功。 | 配置中心发布后请观察服务是否热更新成功。 |

Vote-eligible WITH:
_none_

Vote-eligible WITHOUT:
_none_


### 配置文件

- termId: `term-e9858de7bdaee696`
- compoundDomains: [tech_ai]
- segments: 配置 | 文件
- segmentDomains: 配置=[]; 文件=[]
- union / missing: [] / **[tech_ai]**
- compoundDomainValidity: `COMPOUND_DOMAIN_VALID`
- atomTagFeasibility: `ATOM_TAG_TOO_BROAD`
- classification: **`REVIEW_DOMAIN_MODEL`**
- sourceAction: `KEEP_PENDING_DOMAIN_REVIEW`
- reason: compound has valid-looking fine domain tags and atoms cannot safely carry them, but current sentence fixtures did not activate compound as vote-eligible candidate — need clearer Vote Trace

#### [陈述] 请检查本地配置文件中的数据库地址。

| | WITH | WITHOUT |
|--|------|---------|
| retainedDomains | [] | [] |
| domainScores | `{}` | `{}` |
| compoundVote | [] | — |
| effectiveLost | **[]** | |
| noiseOnlyLost | [] | |
| Final | 请检查本地配置文件中的数据库地址。 | 请检查本地配置文件中的数据库地址。 |

Vote-eligible WITH:
_none_

Vote-eligible WITHOUT:
_none_

#### [业务] 配置文件变更需要走变更审批流程。

| | WITH | WITHOUT |
|--|------|---------|
| retainedDomains | [] | [] |
| domainScores | `{}` | `{}` |
| compoundVote | [] | — |
| effectiveLost | **[]** | |
| noiseOnlyLost | [] | |
| Final | 配置文件变更需要走变更审批流程。 | 配置文件变更需要走变更审批流程。 |

Vote-eligible WITH:
_none_

Vote-eligible WITHOUT:
_none_


### 降级策略

- termId: `term-e9998de7baa7e7ad`
- compoundDomains: []
- segments: 降级 | 策略
- segmentDomains: 降级=[]; 策略=[]
- union / missing: [] / **[]**
- compoundDomainValidity: `INSUFFICIENT_EVIDENCE`
- atomTagFeasibility: `ATOM_TAG_NOT_APPLICABLE`
- classification: **`DELETE_DOMAIN_SAFE`**
- sourceAction: `DELETE_SOURCE_ROW`
- reason: compoundDomains empty; Domain Vote does not depend on compound; surface already recoverable

#### [陈述] 高峰时段会自动启用降级策略。

| | WITH | WITHOUT |
|--|------|---------|
| retainedDomains | [] | [] |
| domainScores | `{}` | `{}` |
| compoundVote | [] | — |
| effectiveLost | **[]** | |
| noiseOnlyLost | [] | |
| Final | 高峰时段会自动启用降级策略。 | 高峰时段会自动启用降级策略。 |

Vote-eligible WITH:
_none_

Vote-eligible WITHOUT:
_none_

#### [业务] 降级策略生效后非核心接口将返回缓存结果。

| | WITH | WITHOUT |
|--|------|---------|
| retainedDomains | [] | [] |
| domainScores | `{}` | `{}` |
| compoundVote | [] | — |
| effectiveLost | **[]** | |
| noiseOnlyLost | [] | |
| Final | 降级策略生效后非核心接口将返回缓存结果。 | 降级策略生效后非核心接口将返回缓存结果。 |

Vote-eligible WITH:
_none_

Vote-eligible WITHOUT:
_none_


### 集成测试

- termId: `term-e99b86e68890e6b5`
- compoundDomains: [tech_ai]
- segments: 集成 | 测试
- segmentDomains: 集成=[]; 测试=[]
- union / missing: [] / **[tech_ai]**
- compoundDomainValidity: `COMPOUND_DOMAIN_VALID`
- atomTagFeasibility: `ATOM_TAG_TOO_BROAD`
- classification: **`REVIEW_DOMAIN_MODEL`**
- sourceAction: `KEEP_PENDING_DOMAIN_REVIEW`
- reason: compound has valid-looking fine domain tags and atoms cannot safely carry them, but current sentence fixtures did not activate compound as vote-eligible candidate — need clearer Vote Trace

#### [陈述] 联调阶段必须覆盖主要路径的集成测试。

| | WITH | WITHOUT |
|--|------|---------|
| retainedDomains | [] | [] |
| domainScores | `{}` | `{}` |
| compoundVote | [] | — |
| effectiveLost | **[]** | |
| noiseOnlyLost | [] | |
| Final | 联调阶段必须覆盖主要路径的集成测试。 | 联调阶段必须覆盖主要路径的集成测试。 |

Vote-eligible WITH:
_none_

Vote-eligible WITHOUT:
_none_

#### [业务] 集成测试用例已经挂到持续集成流水线。

| | WITH | WITHOUT |
|--|------|---------|
| retainedDomains | [] | [] |
| domainScores | `{}` | `{}` |
| compoundVote | [] | — |
| effectiveLost | **[]** | |
| noiseOnlyLost | [] | |
| Final | 集成测试用例已经挂到持续集成流水线。 | 集成测试用例已经挂到持续集成流水线。 |

Vote-eligible WITH:
_none_

Vote-eligible WITHOUT:
_none_


---

## 13. Domain Noise Separation

典型噪声：`我们正在…` → Recall `闷蒸` → `coffee`。  
`effectiveLost` 只计 compound 贡献过的 domain（如 tech_ai）；coffee 归 `noiseOnlyLost` / noise voters，**不作为 compound 领域价值**。

重点词 compound-only 结构：

- 专家系统: compound=[] missing=[] class=`DELETE_DOMAIN_SAFE`
- 回归测试: compound=[tech_ai] missing=[tech_ai] class=`REVIEW_DOMAIN_MODEL`
- 集成测试: compound=[tech_ai] missing=[tech_ai] class=`REVIEW_DOMAIN_MODEL`
- 特征工程: compound=[tech_ai] missing=[tech_ai] class=`REVIEW_DOMAIN_MODEL`
- 迁移学习: compound=[] missing=[] class=`DELETE_DOMAIN_SAFE`
- 训练数据: compound=[tech_ai] missing=[] class=`DELETE_DOMAIN_SAFE`
- 测试数据: compound=[tech_ai] missing=[tech_ai] class=`REVIEW_DOMAIN_MODEL`
- 流量镜像: compound=[] missing=[] class=`DELETE_DOMAIN_SAFE`
- 注册中心: compound=[] missing=[] class=`DELETE_DOMAIN_SAFE`
- 配置中心: compound=[] missing=[] class=`DELETE_DOMAIN_SAFE`
- 视频会议: compound=[meeting] missing=[] class=`DELETE_DOMAIN_SAFE`
- 迷你吧: compound=[tourism_hotel] missing=[tourism_hotel] class=`REVIEW_DOMAIN_MODEL`

---

## 14. DELETE_DOMAIN_SAFE List

- 专家系统 — compoundDomains empty; Domain Vote does not depend on compound; surface already recoverable
- 安检通道 — compoundDomains empty; Domain Vote does not depend on compound; surface already recoverable
- 循环网络 — compoundDomains empty; Domain Vote does not depend on compound; surface already recoverable
- 正则策略 — compoundDomains empty; Domain Vote does not depend on compound; surface already recoverable
- 注册中心 — compoundDomains empty; Domain Vote does not depend on compound; surface already recoverable
- 流量镜像 — compoundDomains empty; Domain Vote does not depend on compound; surface already recoverable
- 熔断策略 — compoundDomains empty; Domain Vote does not depend on compound; surface already recoverable
- 联系电话 — compoundDomains empty; Domain Vote does not depend on compound; surface already recoverable
- 视频会议 — segment domain union already covers compoundDomains; Vote not compound-dependent
- 训练数据 — segment domain union already covers compoundDomains; Vote not compound-dependent
- 迁移学习 — compoundDomains empty; Domain Vote does not depend on compound; surface already recoverable
- 邀请函 — compoundDomains empty; Domain Vote does not depend on compound; surface already recoverable
- 配置中心 — compoundDomains empty; Domain Vote does not depend on compound; surface already recoverable
- 降级策略 — compoundDomains empty; Domain Vote does not depend on compound; surface already recoverable

---

## 15. KEEP_DOMAIN_ATOMIC List

- 单元测试 — Domain-semantic atomicity: surface recoverable by atoms, but fine domain presence lives only on compound; atom retag would be too broad/ambiguous
- 神经网络 — Domain-semantic atomicity: surface recoverable by atoms, but fine domain presence lives only on compound; atom retag would be too broad/ambiguous

---

## 16. REVIEW_DOMAIN_MODEL List

- 回归测试 — compound has valid-looking fine domain tags and atoms cannot safely carry them, but current sentence fixtures did not activate compound as vote-eligible candidate — need clearer Vote Trace
- 测试数据 — compound has valid-looking fine domain tags and atoms cannot safely carry them, but current sentence fixtures did not activate compound as vote-eligible candidate — need clearer Vote Trace
- 特征工程 — compound has valid-looking fine domain tags and atoms cannot safely carry them, but current sentence fixtures did not activate compound as vote-eligible candidate — need clearer Vote Trace
- 迷你吧 — compound has valid-looking fine domain tags and atoms cannot safely carry them, but current sentence fixtures did not activate compound as vote-eligible candidate — need clearer Vote Trace
- 配置文件 — compound has valid-looking fine domain tags and atoms cannot safely carry them, but current sentence fixtures did not activate compound as vote-eligible candidate — need clearer Vote Trace
- 集成测试 — compound has valid-looking fine domain tags and atoms cannot safely carry them, but current sentence fixtures did not activate compound as vote-eligible candidate — need clearer Vote Trace

---

## 17. Source Action Matrix

| surface | action |
|---------|--------|
| 专家系统 | `DELETE_SOURCE_ROW` |
| 单元测试 | `KEEP_WITH_DOMAIN_ATOMIC_EXCEPTION` |
| 回归测试 | `KEEP_PENDING_DOMAIN_REVIEW` |
| 安检通道 | `DELETE_SOURCE_ROW` |
| 循环网络 | `DELETE_SOURCE_ROW` |
| 正则策略 | `DELETE_SOURCE_ROW` |
| 注册中心 | `DELETE_SOURCE_ROW` |
| 流量镜像 | `DELETE_SOURCE_ROW` |
| 测试数据 | `KEEP_PENDING_DOMAIN_REVIEW` |
| 熔断策略 | `DELETE_SOURCE_ROW` |
| 特征工程 | `KEEP_PENDING_DOMAIN_REVIEW` |
| 神经网络 | `KEEP_WITH_DOMAIN_ATOMIC_EXCEPTION` |
| 联系电话 | `DELETE_SOURCE_ROW` |
| 视频会议 | `DELETE_SOURCE_ROW` |
| 训练数据 | `DELETE_SOURCE_ROW` |
| 迁移学习 | `DELETE_SOURCE_ROW` |
| 迷你吧 | `KEEP_PENDING_DOMAIN_REVIEW` |
| 邀请函 | `DELETE_SOURCE_ROW` |
| 配置中心 | `DELETE_SOURCE_ROW` |
| 配置文件 | `KEEP_PENDING_DOMAIN_REVIEW` |
| 降级策略 | `DELETE_SOURCE_ROW` |
| 集成测试 | `KEEP_PENDING_DOMAIN_REVIEW` |

---

## 18. Domain Follow-up Matrix

| surface | follow-up |
|---------|-----------|
| 专家系统 | `NONE` |
| 单元测试 | `NONE` |
| 回归测试 | `REPROBE_OR_REVIEW_TAG_ACTIVATION` |
| 安检通道 | `NONE` |
| 循环网络 | `NONE` |
| 正则策略 | `NONE` |
| 注册中心 | `NONE` |
| 流量镜像 | `NONE` |
| 测试数据 | `REPROBE_OR_REVIEW_TAG_ACTIVATION` |
| 熔断策略 | `NONE` |
| 特征工程 | `REPROBE_OR_REVIEW_TAG_ACTIVATION` |
| 神经网络 | `NONE` |
| 联系电话 | `NONE` |
| 视频会议 | `NONE` |
| 训练数据 | `NONE` |
| 迁移学习 | `NONE` |
| 迷你吧 | `REPROBE_OR_REVIEW_TAG_ACTIVATION` |
| 邀请函 | `NONE` |
| 配置中心 | `NONE` |
| 配置文件 | `REPROBE_OR_REVIEW_TAG_ACTIVATION` |
| 降级策略 | `NONE` |
| 集成测试 | `REPROBE_OR_REVIEW_TAG_ACTIVATION` |

---

## 19. Target List Result

T1–T25: PASS（22 词对账、合法性、原子风险、Vote Trace、噪声分离、三类分类、未改 Vote/Tags/Source/Rebuild/Enforce）。

---

## 20. Check List Result

```text
[x] 未修改代码/Source/SQLite/Validator/Vote/Domain Tags
[x] 未 rebuild / enforce
[x] 22 条 compound+segment domains + Vote Trace
[x] compound tag 合法性 + atom 过宽风险
[x] 错误领域噪声分离
[x] 三类分类 + Markdown + CSV
```

---

## 21. Final Verdict

```text
DOMAIN_ATOMICITY_READY

DELETE_DOMAIN_SAFE = 14
KEEP_DOMAIN_ATOMIC = 2
REVIEW_DOMAIN_MODEL = 6

可据此进入最终 Source Cleanup 分拣（本轮仍未执行删除）。
```

CSV: [domain_semantic_atomicity_reconciliation.csv](./domain_semantic_atomicity_reconciliation.csv)
