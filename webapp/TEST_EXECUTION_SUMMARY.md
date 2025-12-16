# Web 客户端单元测试执行总结

## 测试执行状态

由于终端输出缓冲问题，无法直接捕获测试输出。但已确认：

### ✅ 测试配置完整

- ✅ `vitest.config.ts` 配置正确
- ✅ 测试文件结构完整
- ✅ `package.json` 中的测试脚本配置正确

### ✅ 测试文件列表

测试文件位于 `webapp/web-client/tests/` 目录：

1. **阶段 2.1 测试**
   - `stage2.1/state_machine_test.ts` - 状态机测试
   - `stage2.1/asr_subtitle_test.ts` - ASR 字幕测试

2. **阶段 2.1.3 测试**
   - `stage2.1.3/utterance_group_test.ts` - Utterance Group 测试

3. **阶段 3.2 测试**
   - `stage3.2/feature_selection_test.ts` - 功能选择测试
   - `stage3.2/websocket_client_feature_test.ts` - WebSocket 功能测试

4. **会话模式测试**
   - `session_mode/state_machine_session_test.ts` - 会话状态机测试
   - `session_mode/app_session_test.ts` - 应用会话测试
   - `session_mode/webclient_session_integration_test.ts` - 集成测试
   - `session_mode/two_way_mode_test.ts` - 双向模式测试

5. **会议室模式测试**
   - `room_mode/raw_voice_preference_test.ts` - 原声传递偏好测试
   - `room_mode/room_join_test.ts` - 房间加入测试

## 如何运行测试

### 方法 1：直接运行（推荐）

在 PowerShell 或终端中执行：

```bash
cd d:\Programs\github\lingua_1\webapp\web-client
npm test
```

### 方法 2：使用 npx

```bash
cd d:\Programs\github\lingua_1\webapp\web-client
npx vitest run
```

### 方法 3：监听模式

```bash
cd d:\Programs\github\lingua_1\webapp\web-client
npm run test:watch
```

### 方法 4：生成覆盖率报告

```bash
cd d:\Programs\github\lingua_1\webapp\web-client
npm run test:coverage
```

## 预期测试结果

成功运行后，应该看到：

- ✅ 所有测试文件被识别
- ✅ 测试用例执行
- ✅ 通过/失败的测试统计
- ✅ 测试执行时间

## 故障排除

### 如果测试无法运行

1. **检查依赖是否安装**：
   ```bash
   npm install
   ```

2. **检查 TypeScript 编译**：
   ```bash
   npx tsc --noEmit
   ```

3. **检查测试配置**：
   确保 `vitest.config.ts` 中的配置正确

4. **检查测试文件路径**：
   确保测试文件在 `tests/` 目录下，且文件名符合模式：
   - `*_test.ts`
   - `*.test.ts`
   - `*.spec.ts`

## 测试配置详情

### vitest.config.ts

```typescript
export default defineConfig({
  test: {
    environment: 'happy-dom', // 浏览器 DOM 模拟
    globals: true,
    include: [
      'tests/**/*_test.ts',
      'tests/**/*.test.ts',
      'tests/**/*.spec.ts'
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'tests/',
        '*.config.ts',
        '*.config.js',
      ],
    },
  },
});
```

## 下一步

请手动运行测试命令查看详细结果：

```bash
cd d:\Programs\github\lingua_1\webapp\web-client
npm test
```

测试结果将显示在终端中，包括：
- 每个测试文件的执行状态
- 通过的测试数量
- 失败的测试详情（如果有）
- 测试覆盖率（如果使用 coverage 模式）
