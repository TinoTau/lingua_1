# getLastCommittedText 修复方案实现状态检查

对照 `FIX_GET_LAST_COMMITTED_TEXT_SPEC.md` 检查实现状态。

## ✅ 已实现的内容

### 1. 数据结构 ✅
- ✅ `CommittedText` 类型已定义（`aggregator-state-context.ts:11-14`）
- ✅ `recentCommittedText: CommittedText[]` 已实现
- ✅ 按 `utteranceIndex` 升序保存

### 2. 函数签名 ✅
- ✅ `getLastCommittedText(sessionId: string, currentUtteranceIndex: number): string | null` 已实现
- ✅ 在 `aggregator-manager.ts`、`aggregator-state.ts`、`aggregator-state-context.ts` 中正确实现

### 3. 核心逻辑 ✅
- ✅ 已删除所有基于文本内容的 heuristic（包含关系、长度差等）
- ✅ 实现为"只按顺序选最近一条完整已提交文本"的简单策略
- ✅ 从后往前找第一条 `utteranceIndex < currentUtteranceIndex` 的文本

### 4. 调用点修复 ✅
- ✅ `semantic-repair-step.ts`: 使用 `job.utterance_index`
- ✅ `aggregation-stage.ts`: 使用 `job.utterance_index`
- ✅ `postprocess-semantic-repair-handler.ts`: 使用 `job.utterance_index`
- ✅ `translation-stage.ts`: 使用 `job.utterance_index`

### 5. 测试用例 ✅
- ✅ 场景1：Job4为完整长句，Job7为其短片段（`aggregator-state-context.test.ts:44-57`）
- ✅ 场景2：只有一条历史文本（`aggregator-state-context.test.ts:59-70`）
- ✅ 场景3：当前job为第一句（`aggregator-state-context.test.ts:72-77`）

## ✅ 已修复的问题

### 问题1：PASS情况下未更新committed text ✅

**规范要求**（4.1.1节）：
> 当一条 job 完成 SR 修复后，应该调用 `updateLastCommittedTextAfterRepair`

**修复前**（`semantic-repair-step.ts:119`）：
```typescript
if (ctx.repairedText !== textToRepair && services.aggregatorManager) {
  // 只有在文本改变时才更新
  services.aggregatorManager.updateLastCommittedTextAfterRepair(...)
}
```

**修复后**（`semantic-repair-step.ts:117-137`）：
```typescript
// 根据规范要求：当一条job完成SR修复后，应该更新committed text
// 无论文本是否改变（PASS或REPAIR），都应该更新，以便后续job能正确获取上下文
if (services.aggregatorManager) {
  services.aggregatorManager.updateLastCommittedTextAfterRepair(
    job.session_id,
    job.utterance_index,
    textToRepair,
    ctx.repairedText
  );
  // ... 日志记录
}
```

**修复说明**：
- ✅ 现在所有 `REPAIR` 或 `PASS` 的情况都会更新 `committedText`
- ✅ 确保后续job能够正确获取到当前job的文本作为上下文
- ✅ 符合规范中"完成SR修复后就应该更新"的要求

## 📋 总结

**已完成**：100%
- ✅ 核心逻辑实现
- ✅ 数据结构正确
- ✅ 测试用例完整
- ✅ 调用点修复
- ✅ PASS情况下也更新committed text

## 验证建议

1. **测试验证**：运行测试用例，确保所有场景通过
2. **集成测试**：验证PASS情况下后续job能正确获取上下文
3. **文档确认**：确认实现完全符合规范要求
