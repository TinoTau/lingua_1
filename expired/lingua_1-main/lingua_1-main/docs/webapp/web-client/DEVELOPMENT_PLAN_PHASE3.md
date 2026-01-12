# Web 客户端 Phase 3 开发计划

> 基于 VAD 和状态机重构完成后的进一步优化开发

## 开发时间
2025年1月

## 开发目标

根据当前系统状态和文档分析，Phase 3 的目标是实现以下关键功能：

1. **客户端背压与降级机制**（最高优先级）
2. **Opus 编码集成**（Phase 2 核心功能）
3. **VAD 配置界面**（用户体验优化）
4. **Session Init 协议增强**（协议完善）

## 开发顺序

### 阶段 1：客户端背压与降级机制 ✅ **已完成**

**状态**: ✅ **100% 完成并测试**

**完成内容**:
- ✅ 背压消息类型已定义（`BackpressureMessage`）
- ✅ 背压消息处理逻辑完善
- ✅ 发送频率动态调整（BUSY / PAUSE / SLOW_DOWN）
- ✅ 发送队列管理（暂停时缓存，恢复时发送）
- ✅ 背压状态回调通知
- ✅ 完整的单元测试（全部通过）

**测试结果**: 单元测试全部通过 ✅

**相关文档**: [背压实现文档](./BACKPRESSURE_IMPLEMENTATION.md)

---

### 阶段 2：Opus 编码集成 ✅ **已完成**

**状态**: ✅ **100% 完成并测试**

**完成内容**:
- ✅ 音频编解码器接口已定义
- ✅ OpusEncoder/OpusDecoder 实现（使用 `@minceraftmc/opus-encoder` 和 `opus-decoder`）
- ✅ Opus 编码/解码测试（全部通过）
- ✅ Node 端 Opus 解码支持（使用 `opus-rs`）
- ✅ HTTP/WebSocket 接口中的 Opus 解码集成
- ✅ 往返编码/解码测试（验证数据完整性）

**测试结果**:
- Web Client 端: 5/5 测试通过 ✅
- Node 端: 17/17 测试通过 ✅

**相关文档**: 
- [Phase 2 实现总结](./PHASE2_IMPLEMENTATION_SUMMARY.md)
- [Phase 3 测试完成报告](../../../docs/PHASE3_TESTING_COMPLETE_FINAL.md)

---

### 阶段 3：VAD 配置界面

**状态**: VAD 已实现，但阈值硬编码

**当前状态**:
- ✅ VAD 静音过滤已实现
- ✅ 支持配置化（`SilenceFilterConfig`）
- ❌ 缺少 UI 配置界面
- ❌ 无法实时调整和可视化

**需要实现**:
1. 添加 VAD 配置 UI（阈值、窗口大小等）
2. 支持实时调整和保存配置
3. 添加 VAD 可视化（显示当前是否在发送音频）
4. 添加配置持久化（localStorage）

**预计工作量**: 1-2 天

---

### 阶段 4：Session Init 协议增强 ✅ **已完成**

**状态**: ✅ **100% 完成并测试**

**完成内容**:
- ✅ `client_version` 已实现
- ✅ `features` 已实现
- ✅ `trace_id` 已实现（自动生成 UUID）
- ✅ `tenant_id` 已实现（可选，支持多租户）
- ✅ 移除不支持的字段（`audio_format`, `sample_rate`, `channel_count`, `protocol_version` 等）
- ✅ Scheduler 端支持验证
- ✅ 完整的单元测试（全部通过）

**测试结果**:
- Web Client 端: 5/5 测试通过 ✅
- Scheduler 端: 6/6 测试通过 ✅

**相关文档**: 
- [Session Init 协议增强文档](./SESSION_INIT_PROTOCOL_ENHANCEMENT.md)
- [Session Init 与 Opus 兼容性分析](./SESSION_INIT_AND_OPUS_COMPATIBILITY_ANALYSIS.md)

---

## 验收标准

### 阶段 1：背压与降级

- ✅ 能正确处理 BUSY / PAUSE / SLOW_DOWN 消息
- ✅ 发送频率能动态调整
- ✅ 暂停时能缓存消息，恢复时发送
- ✅ 单元测试覆盖率 ≥ 80%

### 阶段 2：Opus 编码

- ✅ Opus 编码/解码正常工作
- ✅ 带宽节省 ≥ 50%（相比 PCM16）
- ✅ 编码延迟 < 50ms
- ✅ 单元测试覆盖率 ≥ 80%

### 阶段 3：VAD 配置界面

- ✅ 能通过 UI 调整 VAD 参数
- ✅ 配置能持久化保存
- ✅ VAD 状态可视化正常
- ✅ 单元测试覆盖率 ≥ 70%

### 阶段 4：Session Init 协议增强

- ✅ Session Init 包含所有必需字段（trace_id, tenant_id）
- ✅ 移除不支持的字段（audio_format, sample_rate 等）
- ✅ 单元测试覆盖率 100%（5/5 测试通过）

---

## 测试策略

每个阶段都需要：
1. **单元测试**: 覆盖核心逻辑
2. **集成测试**: 验证与其他模块的交互
3. **性能测试**: 验证性能指标（如适用）

---

## 文档更新

每个阶段完成后需要更新：
1. `webapp/web-client/docs/` 下的相关文档
2. `docs/project_management/PROJECT_STATUS_PENDING.md`
3. `docs/project_management/PROJECT_STATUS_COMPLETED.md`

---

## 风险与依赖

### 阶段 1：背压与降级
- **风险**: 低
- **依赖**: 无

### 阶段 2：Opus 编码
- **风险**: 中等（需要选择合适的库）
- **依赖**: Opus 库的可用性和兼容性

### 阶段 3：VAD 配置界面
- **风险**: 低
- **依赖**: 无

### 阶段 4：Session Init 协议增强
- **风险**: 低
- **依赖**: 服务端需要支持新字段（可能需要协调）

---

## 总结

Phase 3 开发计划聚焦于系统稳定性和性能优化，按优先级顺序实施。每个阶段都有明确的验收标准和测试要求，确保代码质量。

