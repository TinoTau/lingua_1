# Web 客户端阶段 2.1 测试

## 测试范围

阶段 2.1 测试覆盖 Web 客户端的核心功能模块（纯单元测试）：

1. **状态机模块** (`state_machine_test.ts`)
   - 状态转换逻辑
   - 回调机制
   - 无效状态转换处理
   - 完整状态循环

2. **ASR 字幕模块** (`asr_subtitle_test.ts`)
   - 字幕初始化和显示
   - Partial 和 Final 字幕更新
   - 字幕清空功能

**注意**: WebSocket 客户端、Recorder 和 TtsPlayer 模块需要浏览器环境，将在后续集成测试中覆盖。

## 运行测试

```bash
# 安装依赖（如果还没有安装）
npm install

# 运行测试
npm test

# 运行测试并查看覆盖率
npm run test:coverage
```

## 测试状态

- ✅ 状态机模块测试：完整覆盖（纯单元测试）
- ✅ ASR 字幕模块测试：完整覆盖（DOM 单元测试）

## 注意事项

- 所有测试都是纯单元测试，不依赖外部服务
- AsrSubtitle 测试使用 happy-dom 提供 DOM 环境
- WebSocket 客户端、Recorder 和 TtsPlayer 模块需要浏览器环境，将在后续集成测试中覆盖

