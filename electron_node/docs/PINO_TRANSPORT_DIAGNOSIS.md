# Pino Transport 日志问题诊断

## 问题描述

日志文件不再自动生成，之前是正常工作的。

## 可能原因分析

### 1. Pino Transport 在 Electron 中的已知问题

**问题**: Pino 7.0+ 使用 worker threads 来运行 transport。在 Electron 环境中，worker threads 可能无法正确解析模块路径，导致 transport 静默失败。

**证据**:
- 代码本身没有变化（与旧版本一致）
- 在普通 Node.js 中测试，pino transport 可以正常工作
- 但在 Electron 中可能失败

### 2. Transport 初始化是异步的

**问题**: `pino.transport()` 是异步初始化的。如果初始化失败，错误可能被吞掉，导致：
- 没有日志输出到文件
- 没有错误提示
- 应用继续运行，但日志功能失效

### 3. 缺少错误处理

**当前代码问题**:
```typescript
logger = pino({
  level: logLevel,
  transport: {
    targets: [
      {
        target: 'pino/file',
        level: logLevel,
        options: {
          destination: logFile,
        },
      },
    ],
  },
});
```

**缺少**:
- Transport 初始化的错误处理
- Worker thread 失败的回退机制
- 错误日志输出

## 诊断步骤

### 步骤1: 检查是否有错误被吞掉

在 `logger.ts` 中添加错误处理：

```typescript
try {
  logger = pino({
    level: logLevel,
    transport: {
      targets: [...],
    },
  });
  
  // 测试日志是否工作
  logger.info({ test: true }, 'Logger initialized');
  
} catch (error) {
  console.error('[Logger] Failed to initialize pino transport:', error);
  // 回退到基本logger
  logger = pino({ level: logLevel });
}
```

### 步骤2: 检查 Transport 是否真的在工作

添加 transport 事件监听：

```typescript
// pino transport 是异步的，需要等待初始化
const transport = pino.transport({
  targets: [...]
});

transport.on('error', (err) => {
  console.error('[Logger] Transport error:', err);
});

logger = pino({ level: logLevel }, transport);
```

### 步骤3: 检查 Electron 环境

在 Electron 中，worker threads 的模块解析可能不同。检查：
- `process.versions.electron` - Electron 版本
- `process.versions.node` - Node.js 版本
- 是否有 worker_threads 相关的错误

### 步骤4: 检查日志文件权限

确认：
- 日志目录是否可写
- 日志文件是否被其他进程锁定
- 磁盘空间是否充足

## 可能的解决方案

### 方案1: 使用同步文件写入（避免 worker threads）

使用 `pino.destination()` 而不是 `pino/file` transport：

```typescript
import pino from 'pino';
import * as fs from 'fs';

const fileStream = pino.destination({
  dest: logFile,
  append: true,
  mkdir: true,
});

logger = pino({ level: logLevel }, fileStream);
```

**优点**: 在主线程运行，不依赖 worker threads
**缺点**: 可能影响性能（但通常可接受）

### 方案2: 使用 multistream（主线程）

```typescript
import pino from 'pino';

const streams = [
  { stream: pino.destination(logFile) },  // 文件
  { stream: process.stdout }              // 控制台
];

logger = pino({ level: logLevel }, pino.multistream(streams));
```

**优点**: 完全在主线程，兼容性好
**缺点**: 需要处理 pretty 格式化

### 方案3: 添加错误处理和回退

保持现有代码，但添加错误处理：

```typescript
let logger: pino.Logger;

try {
  // 尝试使用 transport
  logger = pino({
    level: logLevel,
    transport: {
      targets: [...],
    },
  });
  
  // 验证 transport 是否工作
  setTimeout(() => {
    logger.info({ diagnostic: true }, 'Transport test');
  }, 1000);
  
} catch (error) {
  console.error('[Logger] Transport failed, using fallback:', error);
  // 回退到基本 logger + 手动文件写入
  logger = pino({ level: logLevel });
  
  // 手动添加文件输出
  const fs = require('fs');
  const logStream = fs.createWriteStream(logFile, { flags: 'a' });
  // ... 手动处理日志写入
}
```

## 推荐方案

**推荐使用方案1或方案2**，因为：
1. 避免了 Electron 中 worker threads 的问题
2. 更可靠，不依赖异步初始化
3. 性能影响通常可接受（日志写入通常是异步的）

## 下一步

1. **先诊断**: 添加错误处理，确认是否是 transport 初始化失败
2. **再修复**: 根据诊断结果，选择合适的解决方案
3. **验证**: 确保日志文件正常生成
