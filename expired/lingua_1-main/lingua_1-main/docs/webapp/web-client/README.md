# Web 客户端文档

## 文档索引

### 核心文档

- [架构设计](./ARCHITECTURE.md) - 系统架构和核心模块说明
- [Phase 2 实现总结](./PHASE2_IMPLEMENTATION_SUMMARY.md) - Phase 2 功能实现（Binary Frame、Opus编码）
- [Phase 3 开发计划](./DEVELOPMENT_PLAN_PHASE3.md) - Phase 3 开发计划和状态

### 功能实现

- [文本显示与同步](./TEXT_DISPLAY_AND_SYNC.md) - 文本显示与音频播放同步机制
- [TTS 播放与 UI](./TTS_PLAYBACK_AND_UI.md) - TTS 播放器和 UI 更新实现
- [背压实现](./BACKPRESSURE_IMPLEMENTATION.md) - 客户端背压与降级机制
- [Session Init 协议增强](./SESSION_INIT_PROTOCOL_ENHANCEMENT.md) - Session Init 协议增强说明
- [VAD 与状态机重构](./VAD_AND_STATE_MACHINE_REFACTOR.md) - VAD 静音过滤和状态机设计

### 兼容性与调试

- [调度服务器兼容性修复](./SCHEDULER_COMPATIBILITY_FIX.md) - 与调度服务器的兼容性修复
- [Session Init 与 Opus 兼容性分析](./SESSION_INIT_AND_OPUS_COMPATIBILITY_ANALYSIS.md) - Session Init 协议与 Opus 编码兼容性
- [调试指南](./DEBUGGING_GUIDE.md) - 日志查看和问题诊断

### 其他文档

- [内存监控与自动播放](./MEMORY_MONITORING_AND_AUTO_PLAYBACK.md) - 内存监控和自动播放机制
- [音频缓冲区内存分析](./AUDIO_BUFFER_MEMORY_ANALYSIS.md) - 音频缓冲区内存使用分析
- [UI 改进与功能](./UI_IMPROVEMENTS_AND_FEATURES.md) - UI 改进和功能说明

## 快速导航

### 新开发者

1. 阅读 [架构设计](./ARCHITECTURE.md) 了解系统整体结构
2. 查看 [Phase 2 实现总结](./PHASE2_IMPLEMENTATION_SUMMARY.md) 了解最新功能
3. 参考 [调试指南](./DEBUGGING_GUIDE.md) 进行问题排查

### 功能开发

- **文本显示**: [文本显示与同步](./TEXT_DISPLAY_AND_SYNC.md)
- **TTS 播放**: [TTS 播放与 UI](./TTS_PLAYBACK_AND_UI.md)
- **背压机制**: [背压实现](./BACKPRESSURE_IMPLEMENTATION.md)
- **协议增强**: [Session Init 协议增强](./SESSION_INIT_PROTOCOL_ENHANCEMENT.md)

### 问题排查

- **连接问题**: [调度服务器兼容性修复](./SCHEDULER_COMPATIBILITY_FIX.md)
- **调试方法**: [调试指南](./DEBUGGING_GUIDE.md)
- **兼容性**: [Session Init 与 Opus 兼容性分析](./SESSION_INIT_AND_OPUS_COMPATIBILITY_ANALYSIS.md)
