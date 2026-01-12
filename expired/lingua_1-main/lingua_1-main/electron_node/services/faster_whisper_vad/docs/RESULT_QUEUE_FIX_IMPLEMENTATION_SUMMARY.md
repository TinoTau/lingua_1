# 结果队列 Gap Timeout 修复实施总结

**日期**: 2025-12-25  
**状态**: ✅ **已实施**

---

## 修复概述

根据实现指南 `RESULT_QUEUE_GAP_TOLERANCE_AND_ASR_UX_FIX_IMPLEMENTATION_GUIDE.md`，已成功实施结果队列防卡死机制（P0 优先级）。

---

## 已实施的修复

### 1. 添加 MissingResult 消息类型 ✅

**文件**: `central_server/scheduler/src/messages/session.rs`

- 在 `SessionMessage` enum 中添加了 `MissingResult` 变体
- 包含字段：`session_id`, `utterance_index`, `reason`, `created_at_ms`, `trace_id`

**文件**: `webapp/web-client/src/types.ts`

- 添加了 `MissingResultMessage` 接口
- 将其添加到 `ServerMessage` 类型联合

### 2. 重构结果队列实现 ✅

**文件**: `central_server/scheduler/src/managers/result_queue.rs`

**主要变更**:
- 将 `Vec<QueuedResult>` 改为 `BTreeMap<u64, SessionMessage>`，提高查找和排序效率
- 添加 `SessionQueueState` 结构，包含：
  - `expected`: 下一个期望的 utterance_index
  - `pending`: 待处理的结果（BTreeMap）
  - `gap_timeout_ms`: Gap 超时时间（默认 5 秒）
  - `gap_wait_start_ms`: 开始等待 expected 的时间戳
  - `pending_max`: Pending 上限（默认 200）
  - `consecutive_missing`: 连续 Missing 计数
  - `missing_reset_threshold`: Missing 重置阈值（默认 20）

**核心逻辑**:
- `get_ready_results()` 实现 gap timeout 机制：
  1. 如果 `expected` 已到达，直接放行
  2. 如果 `expected` 未到达且超时（5秒），生成 `MissingResult` 占位结果并继续
  3. 如果未超时，停止等待
- `add_result()` 实现 pending 上限保护：
  - 如果 pending 超过上限（200），优先丢弃最远的结果
- `should_reset_session()` 检查是否应该重置会话（连续 Missing 过多）

### 3. Web 端处理 MissingResult ✅

**文件**: `webapp/web-client/src/app.ts`

- 在 `onServerMessage()` 中添加了 `missing_result` 处理逻辑
- 默认行为：静默丢弃，但记录 debug 日志
- 不显示给用户，不缓存，直接返回

---

## 配置参数

### 默认值（已实施）
- `gap_timeout_ms`: 5000ms (5秒)
- `pending_max`: 200
- `missing_reset_threshold`: 20

### 可配置性
- 可以通过 `ResultQueueManager::new_with_config()` 自定义配置
- 当前使用默认值，符合实现指南建议

---

## 工作原理

### 正常流程
1. 结果按 `utterance_index` 顺序到达
2. 队列按顺序放行结果
3. Web 端持续收到输出

### Gap Timeout 流程
1. 如果某个 `utterance_index` 的结果在 5 秒内未到达
2. 队列生成 `MissingResult` 占位结果
3. `expected_index` 推进到下一个
4. 后续已到达的结果可以继续放行
5. Web 端持续收到输出（包括 Missing 占位）

### Pending 溢出保护
1. 如果 pending 队列超过 200 个结果
2. 优先丢弃最远的结果（最大 `utterance_index`）
3. 避免内存无限增长

### 会话重置机制
1. 如果连续 Missing 达到 20 个
2. `should_reset_session()` 返回 `true`
3. 上层可以触发会话重置或要求 Web 端重新建立 session

---

## 测试建议

### 单元测试（Rust）
1. ✅ `expected` 连续到达：应顺序输出
2. ✅ 缺口未超时：不输出 Missing
3. ✅ 缺口超时：输出 Missing 且 `expected++`
4. ✅ pending 乱序到达：gap 超时后继续放行后续
5. ✅ pending 超限：不会 OOM，策略生效

### 集成测试（端到端）
- 模拟 `utterance_index`: 1,2,4,5（缺 3）
- 观察：5 秒后输出 `MissingResult(3)`，随后立即输出 4,5（若已到）
- Web 端持续有输出

---

## 待实施的 P1 功能

### 1. 调度服务器侧跨 utterance 去重
- 对每个 session 维护最近 N 条文本（建议 N=10）
- exact match 直接丢弃
- prefix/suffix 重叠做合并
- overlap 拼接去重

### 2. ASR 音频证据化
- 节点端保存解码后的 PCM16 → WAV
- 保存点：ASR 入参前（即将送入 faster-whisper 前）
- WAV 参数：16kHz / mono / s16le

---

## 兼容性说明

### 向后兼容
- ✅ 保留了 `set_result_deadline()` 方法（已废弃，但保持兼容性）
- ✅ Web 端对 `MissingResult` 的处理是静默的，不影响现有功能

### 协议变更
- ✅ 新增 `MissingResult` 消息类型，但 Web 端已正确处理
- ✅ 不影响现有的 `TranslationResult` 消息

---

## 下一步行动

1. **立即**: 重新编译调度服务器和 Web 客户端
2. **立即**: 进行集成测试，验证 gap timeout 机制
3. **短期**: 实施调度服务器侧跨 utterance 去重（P1）
4. **短期**: 实施 ASR 音频证据化（P1）

---

## 相关文档

- `RESULT_QUEUE_GAP_TOLERANCE_AND_ASR_UX_FIX_IMPLEMENTATION_GUIDE.md` - 实现指南
- `STATUS_REPORT_FOR_DECISION_MAKERS.md` - 状态报告
- `ASR_ACCURACY_AND_QUEUE_ISSUES.md` - 问题诊断

---

**修复完成时间**: 2025-12-25  
**实施人员**: AI Assistant  
**状态**: ✅ 已完成，等待测试验证

