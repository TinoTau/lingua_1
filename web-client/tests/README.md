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
└── stage3.2/              # 阶段 3.2：功能选择功能测试
    ├── README.md          # 阶段 3.2 测试说明
    ├── mod.ts             # 模块导出
    ├── feature_selection_test.ts
    ├── websocket_client_feature_test.ts
    └── TEST_REPORT.md
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

