# FIX_GET_LAST_COMMITTED_TEXT_SPEC
## getLastCommittedText 修复方案（去除异常 heuristic 的简化版本）

版本：v1.0  
适用范围：AggregatorManager / 上下文选择逻辑 / SR/NMT 上下文注入

---

## 1. 修复目标

本方案只做一件事：

> **把 getLastCommittedText 修复成“永远只返回最近一条已提交完整句”的简单版本，  
> 不再包含任何“长度差 > 0.5 × currentTextLen 就跳过”之类的启发式逻辑。**

即：

- 不再根据“包含关系”“长度差”等规则跳过任何历史文本  
- 不做智能判断，只要是“当前 Job 之前最近一次已提交的完整文本”，就作为上下文  
- 如果没有历史文本，则返回 `null`（没有上下文）

---

## 2. 当前问题回顾（仅作为背景）

在旧实现中，getLastCommittedText roughly 是这么做的（简化版）：

```ts
function getLastCommittedText(sessionId: string, currentText: string): string | null {
  const committed = getCommittedTextList(sessionId)  // 按时间倒序
  for (const item of committed) {
    const text = item.text

    if (text.includes(currentText) &&
        text.length - currentText.length > currentText.length * 0.5) {
      // 认为这是一句“更长的合并结果”，跳过
      continue
    }

    return text
  }
  return null
}
```

问题在于：

- 当 currentText 非常短，且是上一句的一小段时（例如 job7 是 job4 的一小截），  
  上一条正确的句子会因为 `contains + 长度差` 被跳过，  
  结果错误地退回到更早的句子（job1），导致上下文错乱。

本方案 **删除上述逻辑**，改为最简单、可预测的版本。

---

## 3. 新设计：API 行为说明

### 3.1 函数签名（示意）

```ts
function getLastCommittedText(
  sessionId: string,
  currentUtteranceIndex: number
): string | null
```

或如果当前实现中没有 index，也可以用 `jobId` / `committedAt` 排序，但关键点是：

- 只看 “时间/顺序上在当前 job 之前的最后一条完整文本”  
- 不基于文本内容做任何过滤/跳过

### 3.2 行为约定

1. 查询当前 session 的 **committed 文本列表**（SR 修复后写入的最终文本），按时间或 utterance_index 升序保存，例如：

   ```ts
   type CommittedText = {
     utteranceIndex: number
     text: string
   }
   ```

2. 在这份列表中，找到所有 `utteranceIndex < currentUtteranceIndex` 的项，取其中 **utteranceIndex 最大的一条**，返回其 `text`。

3. 如果没有任何 `utteranceIndex < currentUtteranceIndex` 的项，返回 `null`（没有上下文）。

4. **不再判断**：
   - 历史文本是否包含 currentText  
   - 长度差是否大于某个阈值  
   - 也不再基于文本内容做“跳过”。

---

## 4. 新实现伪代码

### 4.1 带 utteranceIndex 的实现（推荐）

假设我们在 session 级别维护如下结构：

```ts
type CommittedText = {
  utteranceIndex: number
  text: string
}

class AggregatorSessionState {
  committedTexts: CommittedText[]  // 按 utteranceIndex 升序保存
}
```

#### 4.1.1 写入 committed 文本

当一条 job 完成 SR 修复后：

```ts
function updateLastCommittedTextAfterRepair(
  sessionId: string,
  utteranceIndex: number,
  repairedText: string
): void {
  const state = getOrCreateSessionState(sessionId)
  state.committedTexts.push({
    utteranceIndex,
    text: repairedText,
  })
  // 可选：如有需要，可以限制长度（例如只保留最近 N 条）
}
```

#### 4.1.2 新版 getLastCommittedText

```ts
function getLastCommittedText(
  sessionId: string,
  currentUtteranceIndex: number
): string | null {
  const state = getSessionState(sessionId)
  if (!state) return null

  const list = state.committedTexts
  if (!list || list.length === 0) return null

  // 假设 list 已按 utteranceIndex 升序
  // 则从末尾往前找第一条 utteranceIndex < currentUtteranceIndex
  for (let i = list.length - 1; i >= 0; i--) {
    const item = list[i]
    if (item.utteranceIndex < currentUtteranceIndex) {
      return item.text
    }
  }

  // 没有比当前 index 小的，说明这是第一句
  return null
}
```

**关键点：**

- 按顺序找最近一条，不检查包含关系  
- 不关心文本内容，只关心“顺序靠前且最近”  

---

### 4.2 如果目前没有 utteranceIndex（备用版本）

如果当前系统只记录了“提交顺序”，没有 index，也可以按时间处理：

```ts
type CommittedText = {
  committedAt: number // 或 Date
  text: string
}

function getLastCommittedText(sessionId: string, currentCommittedAt: number): string | null {
  const state = getSessionState(sessionId)
  if (!state) return null

  const list = state.committedTexts
  if (!list || list.length === 0) return null

  let candidate: CommittedText | null = null
  for (const item of list) {
    if (item.committedAt < currentCommittedAt) {
      if (!candidate || item.committedAt > candidate.committedAt) {
        candidate = item
      }
    }
  }

  return candidate ? candidate.text : null
}
```

原则同样是：  
“选择当前之前，时间上最靠近的一条”。

---

## 5. 替换点说明

开发在落地时需要完成以下动作：

1. 找到现有 `AggregatorManager.getLastCommittedText(...)`  
2. 删除其中所有基于文本内容的 heuristic（尤其是 `includes + length diff`）  
3. 将实现替换为上述 **4.1 或 4.2** 的简化版本  
4. 确保 `updateLastCommittedTextAfterRepair` 写入的数据结构能够提供 `utteranceIndex` 或 `committedAt`  
5. 为以下场景新增测试用例：

   - 场景 1：Job4 为完整长句，Job7 为其短片段  
     - 期望：Job7 的 context = Job4 的文本（不会被跳过）  
   - 场景 2：只有一条历史文本  
     - 期望：永远使用那条文本作为 context  
   - 场景 3：当前 job 为第一句  
     - 期望：返回 null（无上下文）

---

## 6. 一句话总结（给开发看）

> 把 getLastCommittedText 改成“只按顺序选最近一条完整已提交文本”的简单策略，  
> 完全删除所有基于文本内容的 heuristic（包含关系、长度差等），  
> 这样上下文选择行为可预测、易理解，也不会再出现“短片段把上一句当成错误合并结果而被跳过”的问题。
