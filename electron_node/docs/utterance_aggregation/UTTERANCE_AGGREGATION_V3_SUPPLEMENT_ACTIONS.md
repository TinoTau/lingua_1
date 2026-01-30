# Utterance Aggregation v3 补充动作说明（交付开发部门）

> 本文档用于 **v3 最简统一架构完成后的最终补充动作**。  
> 这些动作 **不涉及新增业务逻辑、不增加保险层**，仅用于：
>
> - 锁定已验证的正确行为
> - 防止后续迭代回退为“补丁式复杂度”
>
> 完成本文档中的两项内容后，本轮 v3 改造可视为 **结构性完成**。

---

## 一、补充动作总览（必须完成）

### 补充动作 A：最小行为级自动化测试（2–3 条即可）
目的：  
防止 **短句策略 / 完全包含 / 重复发送** 在未来改动中被无意破坏。

### 补充动作 B：写死 2 条架构不变量（Invariant）
目的：  
防止未来开发人员在“不理解整体设计”的情况下重新引入隐藏决策或多次 Trim。

---

## 二、补充动作 A：最小行为级自动化测试

> 原则：  
> - **不做全量自动化**
> - 只锁定 *最容易回退*、*最隐蔽* 的 3 类行为

### A1. 必须自动化的 3 条用例

#### 用例 A1-1：20–40 字短句 + 超时发送（B1-3）

**场景说明**  
- 20–40 字文本应先 HOLD
- 超过 3000ms 无新输入后必须 SEND
- 不得被任何 commit / length 逻辑提前触发

**测试步骤（伪代码）**
```
input: text(len=25)
expect: Gate -> HOLD

wait: 3000ms (no new input)
expect: Gate -> SEND(reason=HOLD_TIMEOUT_SEND)
```

**锁定风险**
- 防止未来有人重新引入 “长度触发 commit”
- 防止 HOLD 逻辑被误删

---

#### 用例 A1-2：完全包含（MERGED_INTO_PREVIOUS）（B2-1）

**场景说明**  
- incoming 完全被 lastCommittedText 覆盖
- 不得发送文本
- 必须显式 DROP，并输出取消信号

**测试步骤（伪代码）**
```
given lastCommittedText = "我今天去上班的时候下雨了"

input: "我今天去上班"

expect:
- action = DROP
- reason = MERGED_INTO_PREVIOUS
- no text sent
- cancel signal present (e.g. mergedFromUtteranceIndex)
```

**锁定风险**
- 防止 TextProcessor 或 trim 逻辑再次通过“空文本”隐式触发行为
- 防止 GPU arbiter / 语义修复任务泄漏

---

#### 用例 A1-3：完全重复发送防护（B3-1）

**场景说明**
- 已成功发送的文本再次出现
- 必须被 Drop
- 不得再次 SEND

**测试步骤（伪代码）**
```
given lastSentText = "天气很好"

input: "天气很好"

expect:
- action = DROP
- reason = DUPLICATE_EXACT
```

**锁定风险**
- 防止账本更新顺序错误
- 防止 send 失败 / 重试路径引入重复发送

---

### A2. 实施建议（不限制具体测试框架）

- 可使用：
  - Jest / Vitest（Node / TS）
  - pytest（Python 服务）
- 建议使用 **参数化测试**
- 测试不需要 mock 全链路：
  - 只需构造 Gate 输入 + ledger 状态
  - 验证 Gate 输出（action / reason）

---

## 三、补充动作 B：架构不变量（Invariant）声明

> 原则：  
> - **只写约束，不写逻辑**
> - 不新增任何 if / 分支 / 兜底
> - 作为“工程级路牌”，防止走回头路

### Invariant 1：Gate 输出语义不变量

**建议位置**
- `TextForwardMergeManager` 顶部注释
- 或 `decideGateAction()` 函数注释

**建议文本**
```
/// Invariant:
/// processText / decideGateAction 永远返回完整 mergedText。
/// 禁止返回裁剪片段（如 dedupResult.text）。
/// 所有 SEND/HOLD/DROP 决策必须基于完整 mergedText。
```

---

### Invariant 2：TextProcessor 责任边界不变量

**建议位置**
- `AggregatorStateTextProcessor.processText()` 注释

**建议文本**
```
/// Invariant:
/// AggregatorStateTextProcessor 只负责 MERGE 组内的尾部整形（hangover）。
/// 禁止在此处决定 SEND / HOLD / DROP。
/// 禁止通过空字符串或特殊值隐式触发丢弃。
```

---

## 四、完成标准（交付验收）

当以下条件全部满足时，本轮 v3 改造可标记为 **DONE**：

- [ ] 用例 A1-1 / A1-2 / A1-3 至少以自动化形式执行一次
- [ ] 两条 Invariant 已写入代码或设计文档
- [ ] 未新增任何 trim / drop / commit 相关分支
- [ ] Gate 决策点仍唯一

---

## 五、结论

> 当前 v3 已经在 **架构层面完成**。  
> 本文档中的补充动作只是：
>
> - 把“已验证的正确性”固化下来  
> - 防止未来在不知情的情况下重新引入复杂度  
>
> **完成后无需再进行功能性改造。**
