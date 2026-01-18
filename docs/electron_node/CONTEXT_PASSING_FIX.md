# Context传递修复

## 修复日期
2026-01-17

## 问题描述

**问题**: Context使用了语义修复前的文本（有乱码），导致NMT翻译质量下降

**现象**:
- Utterance [7]的NMT使用了来自[1]的错误context（有乱码）
- Utterance [8]的NMT使用了语义修复前的文本作为context（有乱码）

**根本原因**:

1. **Context保存时机不对**：
   - `updateRecentCommittedText()`在**聚合阶段**保存文本（`aggregator-state.ts` 第299行）
   - 但**语义修复在聚合之后**进行（`semantic-repair-step.ts`）
   - 因此保存到`recentCommittedText`的是**修复前的文本**（可能有乱码）

2. **Context获取使用了保存的文本**：
   - `getLastCommittedText()`从`recentCommittedText`获取文本（`aggregator-manager.ts` 第253行）
   - 因此获取到的也是**修复前的文本**（有乱码）

**代码流程**:
```
聚合阶段 → updateRecentCommittedText(修复前的文本) 
  ↓
语义修复阶段 → 修复文本（但recentCommittedText中仍是修复前的文本）
  ↓
翻译阶段 → getLastCommittedText() → 返回修复前的文本 ❌
```

---

## 修复方案

### 修复1：添加更新最后一个提交文本的方法

**文件**: `electron_node/electron-node/main/src/aggregator/aggregator-state-context.ts`

**添加方法**:
```typescript
/**
 * 更新最后一个提交的文本（用于语义修复后更新）
 * 如果最后一个元素与原始文本匹配，则替换为修复后的文本
 */
updateLastCommittedText(originalText: string, repairedText: string): void {
  // 检查最后一个元素是否与原始文本匹配
  // 如果匹配，替换为修复后的文本
}
```

### 修复2：在语义修复完成后更新recentCommittedText

**文件**: `electron_node/electron-node/main/src/pipeline/steps/semantic-repair-step.ts`

**修改**: 在语义修复完成后，如果文本被修复了，调用`updateLastCommittedTextAfterRepair`更新`recentCommittedText`

```typescript
if (ctx.repairedText !== textToRepair && services.aggregatorManager) {
  services.aggregatorManager.updateLastCommittedTextAfterRepair(
    job.session_id,
    textToRepair,
    ctx.repairedText
  );
}
```

---

## 修复后的流程

```
聚合阶段 → updateRecentCommittedText(修复前的文本) 
  ↓
语义修复阶段 → 修复文本 → updateLastCommittedTextAfterRepair(修复后的文本) ✅
  ↓
翻译阶段 → getLastCommittedText() → 返回修复后的文本 ✅
```

---

## 测试验证

修复后，应该验证：
1. Context使用的是修复后的文本（没有乱码）
2. NMT翻译质量提高
3. 没有引入新的问题

---

## 相关文档

- `TEST_RESULT_ROOT_CAUSE_ANALYSIS.md` - 根因分析
- `TEST_RESULT_DETAILED_ANALYSIS.md` - 详细分析
