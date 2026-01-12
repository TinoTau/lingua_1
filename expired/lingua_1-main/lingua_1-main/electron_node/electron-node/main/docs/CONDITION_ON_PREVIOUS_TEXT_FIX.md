# condition_on_previous_text 修复

**日期**: 2025-12-25  
**状态**: ✅ **已修复**

---

## 问题描述

虽然 `faster_whisper_vad_service.py` 中 `UtteranceRequest.condition_on_previous_text` 的默认值已设置为 `False`，但日志显示实际运行时仍然是 `True`。

---

## 根本原因

在 `electron_node/electron-node/main/src/task-router/task-router.ts` 中，`condition_on_previous_text` 被硬编码为 `true`：

```typescript
const requestBody: any = {
  // ...
  condition_on_previous_text: true, // ❌ 硬编码为 true
  // ...
};
```

这导致即使 `faster_whisper_vad_service.py` 中默认值是 `False`，实际请求时仍然传递了 `True`。

---

## 修复方案

**文件**: `electron_node/electron-node/main/src/task-router/task-router.ts`

**修改**：
```typescript
const requestBody: any = {
  // ...
  condition_on_previous_text: false, // ✅ 改为 false，避免重复识别
  // ...
};
```

---

## 影响

### 修复前

- `condition_on_previous_text=True` 导致 ASR 重复识别
- 当上下文文本和当前音频内容相同时，模型会重复输出
- 即使去重功能执行了，但仍然会占用节点端资源

### 修复后

- `condition_on_previous_text=False` 禁用条件生成
- 仍然可以使用 `initial_prompt` 作为提示来提高识别准确率
- 可以显著减少重复识别的可能性

---

## 验证

### 测试步骤

1. 重新编译 Node.js 服务
2. 重启 `faster-whisper-vad` 服务
3. 进行集成测试
4. 查看日志确认 `condition_on_previous_text=False`

### 预期结果

**ASR 服务日志**：
```
ASR 参数: condition_on_previous_text=False
```

**ASR Worker 日志**：
```
transcribe() 参数: condition_on_previous_text=False
```

---

## 相关文档

- `electron_node/services/faster_whisper_vad/docs/CONTEXT_REPEAT_ISSUE_ROOT_CAUSE.md` - 上下文重复问题根本原因
- `electron_node/services/faster_whisper_vad/docs/ISSUE_STATUS_REPORT.md` - 问题状态报告

