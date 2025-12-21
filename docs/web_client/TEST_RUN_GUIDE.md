# Web 客户端单元测试运行指南

## 运行测试

### 方法 1：使用 npm 脚本（推荐）

```bash
cd webapp/web-client
npm test
```

### 方法 2：使用 npx vitest

```bash
cd webapp/web-client
npx vitest run
```

### 方法 3：监听模式（开发时使用）

```bash
cd webapp/web-client
npm run test:watch
```

### 方法 4：生成覆盖率报告

```bash
cd webapp/web-client
npm run test:coverage
```

## 测试配置

测试配置位于 `vitest.config.ts`：

- **测试环境**: `happy-dom` (浏览器 DOM 模拟)
- **测试文件模式**: `tests/**/*_test.ts`, `tests/**/*.test.ts`, `tests/**/*.spec.ts`
- **覆盖率提供者**: `v8`

## 测试文件结构

```
tests/
├── stage2.1/              # 阶段 2.1 测试
│   ├── state_machine_test.ts
│   └── asr_subtitle_test.ts
├── stage2.1.3/            # Utterance Group 测试
│   └── utterance_group_test.ts
├── stage3.2/              # 功能选择测试
│   ├── feature_selection_test.ts
│   └── websocket_client_feature_test.ts
├── session_mode/          # 会话模式测试
│   ├── state_machine_session_test.ts
│   ├── app_session_test.ts
│   ├── webclient_session_integration_test.ts
│   └── two_way_mode_test.ts
└── room_mode/             # 会议室模式测试
    ├── raw_voice_preference_test.ts
    └── room_join_test.ts
```

## 常见问题

### 1. 依赖未安装

如果测试失败，请先安装依赖：

```bash
npm install
```

### 2. TypeScript 类型错误

检查类型错误：

```bash
npx tsc --noEmit
```

### 3. 测试环境问题

确保 `vitest.config.ts` 中配置了正确的测试环境：

```typescript
test: {
  environment: 'happy-dom',
  // ...
}
```

## 预期输出

成功运行测试后，应该看到类似以下输出：

```
✓ tests/stage2.1/state_machine_test.ts (XX tests)
✓ tests/stage2.1/asr_subtitle_test.ts (XX tests)
✓ tests/stage2.1.3/utterance_group_test.ts (XX tests)
✓ tests/stage3.2/feature_selection_test.ts (XX tests)
✓ tests/session_mode/state_machine_session_test.ts (XX tests)
...

Test Files:  XX passed (XX)
     Tests:  XX passed (XX)
  Start at:  XX:XX:XX
  Duration:  X.XXs
```

## 手动运行测试

如果自动运行有问题，可以手动执行：

1. 打开 PowerShell 或终端
2. 进入项目目录：`cd d:\Programs\github\lingua_1\webapp\web-client`
3. 运行测试：`npm test`

测试结果会显示在终端中。
