# Web 客户端测试

## 测试结构

测试文件按阶段组织在独立路径中：

```
web-client/tests/
├── README.md              # 本文件
├── stage2.1/              # 阶段 2.1：核心功能测试
│   ├── README.md          # 阶段 2.1 测试说明
│   ├── mod.ts             # 模块导出
│   ├── state_machine_test.ts
│   ├── asr_subtitle_test.ts
│   └── TEST_REPORT.md
├── stage3.2/              # 阶段 3.2：功能选择功能测试
│   ├── README.md          # 阶段 3.2 测试说明
│   ├── mod.ts             # 模块导出
│   ├── feature_selection_test.ts
│   ├── websocket_client_feature_test.ts
│   └── TEST_REPORT.md
└── session_mode/          # 会话模式测试
    ├── mod.ts             # 模块导出
    ├── state_machine_session_test.ts
    └── webclient_session_integration_test.ts
└── room_mode/             # 会议室模式测试
    ├── mod.ts             # 模块导出
    └── raw_voice_preference_test.ts
```

## 运行测试

### 运行所有测试

```bash
npm test
```

### 监听模式（开发时使用）

```bash
npm run test:watch
```

### 生成覆盖率报告

```bash
npm run test:coverage
```

## 测试阶段

### 阶段 2.1：核心功能单元测试 ✅

- ✅ 状态机模块测试（纯单元测试）
- ✅ ASR 字幕模块测试（DOM 单元测试）
- ⏸️ WebSocket 客户端模块测试（需要浏览器环境，暂不测试）

详细说明请参考 [阶段 2.1 测试文档](./stage2.1/README.md)

### 阶段 3.2：功能选择单元测试 ✅

- ✅ FeatureFlags 类型和功能选择逻辑测试
- ✅ WebSocket 客户端 features 参数传递测试
- ✅ 功能选择与语言选择组合测试

详细说明请参考 [阶段 3.2 测试文档](./stage3.2/README.md)

### 会话模式测试 ✅

- ✅ 状态机会话模式测试（`state_machine_session_test.ts`）
  - 会话生命周期管理
  - 播放完成后状态切换逻辑（会话模式 vs 非会话模式）
  - 多次发送流程
  - 状态转换序列验证
- ✅ WebClient 会话模式集成测试（`webclient_session_integration_test.ts`）
  - 会话开始和结束流程
  - 发送当前话语流程（模拟 webClient 中的状态转换）
  - 状态切换逻辑验证
  - 边界情况处理
- ✅ 双向模式（面对面模式）测试（`two_way_mode_test.ts`）
  - 连接逻辑（双向模式 vs 单向模式）
  - 语言配置（中英、日英、韩英等）
  - 功能标志传递
  - 消息格式验证
  - 模式对比
  - 边界情况处理

**测试结果**: ✅ 全部通过（34 个测试用例，3 个测试文件）

**注意**: 这些测试主要验证状态机的会话模式逻辑和双向模式的连接逻辑，因为 webClient 的 App 类依赖浏览器 API（Recorder、WebSocket、TTS Player）。完整的 App 类集成测试需要在浏览器环境中进行。

### 会议室模式测试 ✅

- ✅ 原声传递偏好实时切换测试（`raw_voice_preference_test.ts`）
  - 偏好检查逻辑（默认接收、明确设置、不存在的成员）
  - 实时切换功能（切换到接收/不接收、重复设置）
  - 连接同步功能（成员列表更新、自动清理、跳过自己）
  - 多成员场景（多个成员偏好、动态添加成员）
- ✅ 会议室成员加入流程测试（`room_join_test.ts`）
  - 创建房间时自动添加创建者为第一个成员
  - 创建房间时生成6位数房间码和唯一房间ID
  - 其他成员通过房间码加入房间
  - 成员列表同步和广播
  - 错误处理（房间不存在、重复加入）
  - 完整流程测试（创建和多个成员加入）

**测试结果**: ✅ 全部通过（28 个测试用例，2 个测试文件）

**注意**: 这些测试主要验证会议室模式的逻辑，使用模拟的 RoomManager。完整的 WebRTC 连接测试需要在浏览器环境中进行。

### 阶段 2：集成测试（待实现）

- [ ] 完整应用流程测试
- [ ] Recorder 模块测试（需要浏览器环境）
- [ ] TtsPlayer 模块测试（需要浏览器环境）
- [ ] 端到端测试

## 测试工具

- **Vitest**: 测试框架
- **happy-dom**: DOM 环境模拟
- **@vitest/coverage-v8**: 代码覆盖率

## 注意事项

- 所有测试都是纯单元测试，不依赖外部服务
- AsrSubtitle 测试使用 happy-dom 提供 DOM 环境
- WebSocket 客户端、Recorder 和 TtsPlayer 模块需要浏览器环境，将在集成测试中覆盖

