<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: CURRENT SSOT + Acceptance Records
Archive Path: docs/archive/HISTORICAL/FW_Repair_V4_KEEP_AS_EXCEPTION_Runtime_Necessity_Audit_2026_08_02.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: CURRENT SSOT + Acceptance Records

# FW Repair V4 — Runtime Necessity Audit for KEEP_AS_EXCEPTION

| Field | Value |
|-------|-------|
| Date | 2026-08-02 |
| Nature | **READ ONLY · RUNTIME NECESSITY ONLY** |
| Input | 22 `KEEP_AS_EXCEPTION` (Batch-1 revalidation) |
| Status | **NECESSITY_AUDIT_READY** |
| Final labels | `KEEP_RUNTIME_REQUIRED` / `DELETE_RUNTIME_SAFE` only |

---

## 1. Question

删掉完整 term 后，Lattice / Assembly / Domain Vote / KenLM / 最终句子是否退化？

不是语言学“是不是术语”，而是 Runtime 反事实。

---

## 2. Method

1. Utterance = surface 本身（最短反事实）。
2. **Mandatory Tone fixtures**：从 candidate SQLite `tone_pinyin_key` 生成 `acousticSlices` + `wordTimeSpans`（`makeCharToneFixtures`），否则 Batch 1.1C Fail-Closed 下复合词 **不会进入 Probe**。
3. **WITH**：生产 `runLatticeFineSpanGeneration` + `runSpanAssemblyV4Orchestrator`。
4. **WITHOUT**：Probe Proxy 过滤所有 `lookup*` 命中中 `word === surface` 的完整 term（不改 Source / 不写 SQLite）。
5. 额外核对：`recallSpanTopKV2` Exact Recall WITH/WITHOUT。
6. **判定（§六 / §七）**：仅当 Span coverage / Domain Vote / Assembly 候选 / KenLM Top1 / 最终句子出现硬退化 → `KEEP_RUNTIME_REQUIRED`；若 Assembly·KenLM·最终句·Domain 完全一致 → `DELETE_RUNTIME_SAFE`（即使 LexicalEdge / Path 数量下降，也不因“固定技术术语”保留）。

Artifacts:

- [keep_exception_runtime_necessity.csv](./keep_exception_runtime_necessity.csv)
- `docs/tone-v2/_audit_scratch/keep_runtime_necessity/keep_exception_runtime_necessity.json`

---

## 3. Summary

| Verdict | Count |
|---------|------:|
| KEEP_RUNTIME_REQUIRED | **0** |
| DELETE_RUNTIME_SAFE | **22** |
| Total | 22 |

**KEEP_RUNTIME_REQUIRED:**  
_None_

**DELETE_RUNTIME_SAFE:**  
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

**WITH 中复合词未进入 Probe/Edges（排除完整 term 对 Lattice 无增量参与）:**  
- 正则策略
- 熔断策略
- 迷你吧
- 降级策略

Exclusion failures: _none_

---

## 4. Focus Item Detail（§八）

### 单元测试

**Verdict:** `DELETE_RUNTIME_SAFE`  
**Probe exclusion OK:** true  
**Compound in WITH Probe/Edges:** true (exact=true, edges=true)

| Metric | WITH | WITHOUT |
|--------|------|---------|
| Exact Recall hit (full term) | true | false |
| Span coverage | complete | complete |
| LexicalEdge count | 3 | 2 |
| Segmentation path count | 2 | 1 |
| Assembly / KenLM inputs | 1 | 1 |
| Domain Vote | [] | [] |
| Bucket | 1 | 1 |
| KenLM Top1 / final | 单元测试 | 单元测试 |

- WITH edge replacements: 0:2:单元, 0:4:单元测试, 2:4:测试
- WITHOUT edge replacements: 0:2:单元, 2:4:测试
- Diff reasons (hard): (none)
- Lattice note: Lattice edge/path count dropped but Assembly/KenLM/Domain/final unchanged → SAFE under §七

### 回归测试

**Verdict:** `DELETE_RUNTIME_SAFE`  
**Probe exclusion OK:** true  
**Compound in WITH Probe/Edges:** true (exact=true, edges=true)

| Metric | WITH | WITHOUT |
|--------|------|---------|
| Exact Recall hit (full term) | true | false |
| Span coverage | complete | complete |
| LexicalEdge count | 3 | 2 |
| Segmentation path count | 2 | 1 |
| Assembly / KenLM inputs | 1 | 1 |
| Domain Vote | [] | [] |
| Bucket | 1 | 1 |
| KenLM Top1 / final | 回归测试 | 回归测试 |

- WITH edge replacements: 0:2:回归, 0:4:回归测试, 2:4:测试
- WITHOUT edge replacements: 0:2:回归, 2:4:测试
- Diff reasons (hard): (none)
- Lattice note: Lattice edge/path count dropped but Assembly/KenLM/Domain/final unchanged → SAFE under §七

### 正则策略

**Verdict:** `DELETE_RUNTIME_SAFE`  
**Probe exclusion OK:** true  
**Compound in WITH Probe/Edges:** false (exact=false, edges=false)

| Metric | WITH | WITHOUT |
|--------|------|---------|
| Exact Recall hit (full term) | false | false |
| Span coverage | complete | complete |
| LexicalEdge count | 1 | 1 |
| Segmentation path count | 1 | 1 |
| Assembly / KenLM inputs | 1 | 1 |
| Domain Vote | [] | [] |
| Bucket | 1 | 1 |
| KenLM Top1 / final | 正则策略 | 正则策略 |

- WITH edge replacements: 0:2:正则
- WITHOUT edge replacements: 0:2:正则
- Diff reasons (hard): (none)
- Lattice note: (none)

### 流量镜像

**Verdict:** `DELETE_RUNTIME_SAFE`  
**Probe exclusion OK:** true  
**Compound in WITH Probe/Edges:** true (exact=true, edges=true)

| Metric | WITH | WITHOUT |
|--------|------|---------|
| Exact Recall hit (full term) | true | false |
| Span coverage | complete | complete |
| LexicalEdge count | 3 | 2 |
| Segmentation path count | 2 | 1 |
| Assembly / KenLM inputs | 1 | 1 |
| Domain Vote | [] | [] |
| Bucket | 1 | 1 |
| KenLM Top1 / final | 流量镜像 | 流量镜像 |

- WITH edge replacements: 0:2:流量, 0:4:流量镜像, 2:4:镜像
- WITHOUT edge replacements: 0:2:流量, 2:4:镜像
- Diff reasons (hard): (none)
- Lattice note: Lattice edge/path count dropped but Assembly/KenLM/Domain/final unchanged → SAFE under §七

### 测试数据

**Verdict:** `DELETE_RUNTIME_SAFE`  
**Probe exclusion OK:** true  
**Compound in WITH Probe/Edges:** true (exact=true, edges=true)

| Metric | WITH | WITHOUT |
|--------|------|---------|
| Exact Recall hit (full term) | true | false |
| Span coverage | complete | complete |
| LexicalEdge count | 3 | 2 |
| Segmentation path count | 2 | 1 |
| Assembly / KenLM inputs | 1 | 1 |
| Domain Vote | [] | [] |
| Bucket | 1 | 1 |
| KenLM Top1 / final | 测试数据 | 测试数据 |

- WITH edge replacements: 0:2:测试, 0:4:测试数据, 2:4:数据
- WITHOUT edge replacements: 0:2:测试, 2:4:数据
- Diff reasons (hard): (none)
- Lattice note: Lattice edge/path count dropped but Assembly/KenLM/Domain/final unchanged → SAFE under §七

### 熔断策略

**Verdict:** `DELETE_RUNTIME_SAFE`  
**Probe exclusion OK:** true  
**Compound in WITH Probe/Edges:** false (exact=false, edges=false)

| Metric | WITH | WITHOUT |
|--------|------|---------|
| Exact Recall hit (full term) | false | false |
| Span coverage | complete | complete |
| LexicalEdge count | 1 | 1 |
| Segmentation path count | 1 | 1 |
| Assembly / KenLM inputs | 1 | 1 |
| Domain Vote | [] | [] |
| Bucket | 1 | 1 |
| KenLM Top1 / final | 熔断策略 | 熔断策略 |

- WITH edge replacements: 0:2:熔断
- WITHOUT edge replacements: 0:2:熔断
- Diff reasons (hard): (none)
- Lattice note: (none)

### 特征工程

**Verdict:** `DELETE_RUNTIME_SAFE`  
**Probe exclusion OK:** true  
**Compound in WITH Probe/Edges:** true (exact=true, edges=true)

| Metric | WITH | WITHOUT |
|--------|------|---------|
| Exact Recall hit (full term) | true | false |
| Span coverage | complete | complete |
| LexicalEdge count | 3 | 2 |
| Segmentation path count | 2 | 1 |
| Assembly / KenLM inputs | 1 | 1 |
| Domain Vote | [] | [] |
| Bucket | 1 | 1 |
| KenLM Top1 / final | 特征工程 | 特征工程 |

- WITH edge replacements: 0:2:特征, 0:4:特征工程, 2:4:工程
- WITHOUT edge replacements: 0:2:特征, 2:4:工程
- Diff reasons (hard): (none)
- Lattice note: Lattice edge/path count dropped but Assembly/KenLM/Domain/final unchanged → SAFE under §七

### 神经网络

**Verdict:** `DELETE_RUNTIME_SAFE`  
**Probe exclusion OK:** true  
**Compound in WITH Probe/Edges:** true (exact=true, edges=true)

| Metric | WITH | WITHOUT |
|--------|------|---------|
| Exact Recall hit (full term) | true | false |
| Span coverage | complete | complete |
| LexicalEdge count | 3 | 2 |
| Segmentation path count | 2 | 1 |
| Assembly / KenLM inputs | 1 | 1 |
| Domain Vote | [] | [] |
| Bucket | 1 | 1 |
| KenLM Top1 / final | 神经网络 | 神经网络 |

- WITH edge replacements: 0:2:神经, 0:4:神经网络, 2:4:网络
- WITHOUT edge replacements: 0:2:神经, 2:4:网络
- Diff reasons (hard): (none)
- Lattice note: Lattice edge/path count dropped but Assembly/KenLM/Domain/final unchanged → SAFE under §七

### 联系电话

**Verdict:** `DELETE_RUNTIME_SAFE`  
**Probe exclusion OK:** true  
**Compound in WITH Probe/Edges:** true (exact=true, edges=true)

| Metric | WITH | WITHOUT |
|--------|------|---------|
| Exact Recall hit (full term) | true | false |
| Span coverage | complete | complete |
| LexicalEdge count | 3 | 2 |
| Segmentation path count | 2 | 1 |
| Assembly / KenLM inputs | 1 | 1 |
| Domain Vote | [] | [] |
| Bucket | 1 | 1 |
| KenLM Top1 / final | 联系电话 | 联系电话 |

- WITH edge replacements: 0:2:联系, 0:4:联系电话, 2:4:电话
- WITHOUT edge replacements: 0:2:联系, 2:4:电话
- Diff reasons (hard): (none)
- Lattice note: Lattice edge/path count dropped but Assembly/KenLM/Domain/final unchanged → SAFE under §七

### 视频会议

**Verdict:** `DELETE_RUNTIME_SAFE`  
**Probe exclusion OK:** true  
**Compound in WITH Probe/Edges:** true (exact=true, edges=true)

| Metric | WITH | WITHOUT |
|--------|------|---------|
| Exact Recall hit (full term) | true | false |
| Span coverage | complete | complete |
| LexicalEdge count | 3 | 2 |
| Segmentation path count | 2 | 1 |
| Assembly / KenLM inputs | 1 | 1 |
| Domain Vote | [] | [] |
| Bucket | 1 | 1 |
| KenLM Top1 / final | 视频会议 | 视频会议 |

- WITH edge replacements: 0:2:视频, 0:4:视频会议, 2:4:会议
- WITHOUT edge replacements: 0:2:视频, 2:4:会议
- Diff reasons (hard): (none)
- Lattice note: Lattice edge/path count dropped but Assembly/KenLM/Domain/final unchanged → SAFE under §七

### 训练数据

**Verdict:** `DELETE_RUNTIME_SAFE`  
**Probe exclusion OK:** true  
**Compound in WITH Probe/Edges:** true (exact=true, edges=true)

| Metric | WITH | WITHOUT |
|--------|------|---------|
| Exact Recall hit (full term) | true | false |
| Span coverage | complete | complete |
| LexicalEdge count | 3 | 2 |
| Segmentation path count | 2 | 1 |
| Assembly / KenLM inputs | 1 | 1 |
| Domain Vote | [] | [] |
| Bucket | 1 | 1 |
| KenLM Top1 / final | 训练数据 | 训练数据 |

- WITH edge replacements: 0:2:训练, 0:4:训练数据, 2:4:数据
- WITHOUT edge replacements: 0:2:训练, 2:4:数据
- Diff reasons (hard): (none)
- Lattice note: Lattice edge/path count dropped but Assembly/KenLM/Domain/final unchanged → SAFE under §七

### 迁移学习

**Verdict:** `DELETE_RUNTIME_SAFE`  
**Probe exclusion OK:** true  
**Compound in WITH Probe/Edges:** true (exact=true, edges=true)

| Metric | WITH | WITHOUT |
|--------|------|---------|
| Exact Recall hit (full term) | true | false |
| Span coverage | complete | complete |
| LexicalEdge count | 3 | 2 |
| Segmentation path count | 2 | 1 |
| Assembly / KenLM inputs | 1 | 1 |
| Domain Vote | [] | [] |
| Bucket | 1 | 1 |
| KenLM Top1 / final | 迁移学习 | 迁移学习 |

- WITH edge replacements: 0:2:迁移, 0:4:迁移学习, 2:4:学习
- WITHOUT edge replacements: 0:2:迁移, 2:4:学习
- Diff reasons (hard): (none)
- Lattice note: Lattice edge/path count dropped but Assembly/KenLM/Domain/final unchanged → SAFE under §七

### 迷你吧

**Verdict:** `DELETE_RUNTIME_SAFE`  
**Probe exclusion OK:** true  
**Compound in WITH Probe/Edges:** false (exact=false, edges=false)

| Metric | WITH | WITHOUT |
|--------|------|---------|
| Exact Recall hit (full term) | false | false |
| Span coverage | complete | complete |
| LexicalEdge count | 1 | 1 |
| Segmentation path count | 1 | 1 |
| Assembly / KenLM inputs | 1 | 1 |
| Domain Vote | [] | [] |
| Bucket | 1 | 1 |
| KenLM Top1 / final | 迷你吧 | 迷你吧 |

- WITH edge replacements: 0:2:迷你
- WITHOUT edge replacements: 0:2:迷你
- Diff reasons (hard): (none)
- Lattice note: (none)

### 配置文件

**Verdict:** `DELETE_RUNTIME_SAFE`  
**Probe exclusion OK:** true  
**Compound in WITH Probe/Edges:** true (exact=true, edges=true)

| Metric | WITH | WITHOUT |
|--------|------|---------|
| Exact Recall hit (full term) | true | false |
| Span coverage | complete | complete |
| LexicalEdge count | 3 | 2 |
| Segmentation path count | 2 | 1 |
| Assembly / KenLM inputs | 1 | 1 |
| Domain Vote | [] | [] |
| Bucket | 1 | 1 |
| KenLM Top1 / final | 配置文件 | 配置文件 |

- WITH edge replacements: 0:2:配置, 0:4:配置文件, 2:4:文件
- WITHOUT edge replacements: 0:2:配置, 2:4:文件
- Diff reasons (hard): (none)
- Lattice note: Lattice edge/path count dropped but Assembly/KenLM/Domain/final unchanged → SAFE under §七

### 降级策略

**Verdict:** `DELETE_RUNTIME_SAFE`  
**Probe exclusion OK:** true  
**Compound in WITH Probe/Edges:** false (exact=false, edges=false)

| Metric | WITH | WITHOUT |
|--------|------|---------|
| Exact Recall hit (full term) | false | false |
| Span coverage | complete | complete |
| LexicalEdge count | 1 | 1 |
| Segmentation path count | 1 | 1 |
| Assembly / KenLM inputs | 1 | 1 |
| Domain Vote | [] | [] |
| Bucket | 1 | 1 |
| KenLM Top1 / final | 降级策略 | 降级策略 |

- WITH edge replacements: 0:2:降级
- WITHOUT edge replacements: 0:2:降级
- Diff reasons (hard): (none)
- Lattice note: (none)

### 集成测试

**Verdict:** `DELETE_RUNTIME_SAFE`  
**Probe exclusion OK:** true  
**Compound in WITH Probe/Edges:** true (exact=true, edges=true)

| Metric | WITH | WITHOUT |
|--------|------|---------|
| Exact Recall hit (full term) | true | false |
| Span coverage | complete | complete |
| LexicalEdge count | 3 | 2 |
| Segmentation path count | 2 | 1 |
| Assembly / KenLM inputs | 1 | 1 |
| Domain Vote | [] | [] |
| Bucket | 1 | 1 |
| KenLM Top1 / final | 集成测试 | 集成测试 |

- WITH edge replacements: 0:2:集成, 0:4:集成测试, 2:4:测试
- WITHOUT edge replacements: 0:2:集成, 2:4:测试
- Diff reasons (hard): (none)
- Lattice note: Lattice edge/path count dropped but Assembly/KenLM/Domain/final unchanged → SAFE under §七


---

## 5. Remaining Items

### 专家系统

**Verdict:** `DELETE_RUNTIME_SAFE`  
**Probe exclusion OK:** true  
**Compound in WITH Probe/Edges:** true (exact=true, edges=true)

| Metric | WITH | WITHOUT |
|--------|------|---------|
| Exact Recall hit (full term) | true | false |
| Span coverage | complete | complete |
| LexicalEdge count | 3 | 2 |
| Segmentation path count | 2 | 1 |
| Assembly / KenLM inputs | 1 | 1 |
| Domain Vote | [] | [] |
| Bucket | 1 | 1 |
| KenLM Top1 / final | 专家系统 | 专家系统 |

- WITH edge replacements: 0:2:专家, 0:4:专家系统, 2:4:系统
- WITHOUT edge replacements: 0:2:专家, 2:4:系统
- Diff reasons (hard): (none)
- Lattice note: Lattice edge/path count dropped but Assembly/KenLM/Domain/final unchanged → SAFE under §七

### 安检通道

**Verdict:** `DELETE_RUNTIME_SAFE`  
**Probe exclusion OK:** true  
**Compound in WITH Probe/Edges:** true (exact=true, edges=true)

| Metric | WITH | WITHOUT |
|--------|------|---------|
| Exact Recall hit (full term) | true | false |
| Span coverage | complete | complete |
| LexicalEdge count | 3 | 2 |
| Segmentation path count | 2 | 1 |
| Assembly / KenLM inputs | 1 | 1 |
| Domain Vote | [] | [] |
| Bucket | 1 | 1 |
| KenLM Top1 / final | 安检通道 | 安检通道 |

- WITH edge replacements: 0:2:安检, 0:4:安检通道, 2:4:通道
- WITHOUT edge replacements: 0:2:安检, 2:4:通道
- Diff reasons (hard): (none)
- Lattice note: Lattice edge/path count dropped but Assembly/KenLM/Domain/final unchanged → SAFE under §七

### 循环网络

**Verdict:** `DELETE_RUNTIME_SAFE`  
**Probe exclusion OK:** true  
**Compound in WITH Probe/Edges:** true (exact=true, edges=true)

| Metric | WITH | WITHOUT |
|--------|------|---------|
| Exact Recall hit (full term) | true | false |
| Span coverage | complete | complete |
| LexicalEdge count | 3 | 2 |
| Segmentation path count | 2 | 1 |
| Assembly / KenLM inputs | 1 | 1 |
| Domain Vote | [] | [] |
| Bucket | 1 | 1 |
| KenLM Top1 / final | 循环网络 | 循环网络 |

- WITH edge replacements: 0:2:循环, 0:4:循环网络, 2:4:网络
- WITHOUT edge replacements: 0:2:循环, 2:4:网络
- Diff reasons (hard): (none)
- Lattice note: Lattice edge/path count dropped but Assembly/KenLM/Domain/final unchanged → SAFE under §七

### 注册中心

**Verdict:** `DELETE_RUNTIME_SAFE`  
**Probe exclusion OK:** true  
**Compound in WITH Probe/Edges:** true (exact=true, edges=true)

| Metric | WITH | WITHOUT |
|--------|------|---------|
| Exact Recall hit (full term) | true | false |
| Span coverage | complete | complete |
| LexicalEdge count | 3 | 2 |
| Segmentation path count | 2 | 1 |
| Assembly / KenLM inputs | 1 | 1 |
| Domain Vote | [] | [] |
| Bucket | 1 | 1 |
| KenLM Top1 / final | 注册中心 | 注册中心 |

- WITH edge replacements: 0:2:注册, 0:4:注册中心, 2:4:中心, 2:4:忠心
- WITHOUT edge replacements: 0:2:注册, 2:4:中心, 2:4:忠心
- Diff reasons (hard): (none)
- Lattice note: Lattice edge/path count dropped but Assembly/KenLM/Domain/final unchanged → SAFE under §七

### 邀请函

**Verdict:** `DELETE_RUNTIME_SAFE`  
**Probe exclusion OK:** true  
**Compound in WITH Probe/Edges:** true (exact=true, edges=true)

| Metric | WITH | WITHOUT |
|--------|------|---------|
| Exact Recall hit (full term) | true | false |
| Span coverage | complete | complete |
| LexicalEdge count | 1 | 0 |
| Segmentation path count | 1 | 1 |
| Assembly / KenLM inputs | 1 | 1 |
| Domain Vote | [] | [] |
| Bucket | 1 | 1 |
| KenLM Top1 / final | 邀请函 | 邀请函 |

- WITH edge replacements: 0:3:邀请函
- WITHOUT edge replacements: (none)
- Diff reasons (hard): (none)
- Lattice note: Lattice edge/path count dropped but Assembly/KenLM/Domain/final unchanged → SAFE under §七

### 配置中心

**Verdict:** `DELETE_RUNTIME_SAFE`  
**Probe exclusion OK:** true  
**Compound in WITH Probe/Edges:** true (exact=true, edges=true)

| Metric | WITH | WITHOUT |
|--------|------|---------|
| Exact Recall hit (full term) | true | false |
| Span coverage | complete | complete |
| LexicalEdge count | 3 | 2 |
| Segmentation path count | 2 | 1 |
| Assembly / KenLM inputs | 1 | 1 |
| Domain Vote | [] | [] |
| Bucket | 1 | 1 |
| KenLM Top1 / final | 配置中心 | 配置中心 |

- WITH edge replacements: 0:2:配置, 0:4:配置中心, 2:4:中心, 2:4:忠心
- WITHOUT edge replacements: 0:2:配置, 2:4:中心, 2:4:忠心
- Diff reasons (hard): (none)
- Lattice note: Lattice edge/path count dropped but Assembly/KenLM/Domain/final unchanged → SAFE under §七


---

## 6. Development Implication

### KEEP_RUNTIME_REQUIRED（Runtime 必需保留）
_none_

### DELETE_RUNTIME_SAFE（可与 DELETE_CONFIRMED 合并评估删除）
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

`KEEP_AS_EXCEPTION` / `fixed_technical_term` **不再作为最终开发依据**。本轮证据表明：多数项在排除完整 term 后，原子 LexicalEdge（或 fallback）仍拼出相同 Assembly / KenLM Top1 / 最终句。

---

## 7. Final Answer

```text
KEEP_RUNTIME_REQUIRED: 0 / 22
DELETE_RUNTIME_SAFE:   22 / 22

结论：这 22 个词中，没有因删除后 Coverage/Domain/Assembly/KenLM/最终句退化而必须保留；
其余 22 个在 Runtime 反事实上可依赖原子路径（或 fallback 字符路径）恢复等价结果，不应再因“术语例外”拦删除。
```
