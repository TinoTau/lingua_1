# 日志文件位置说明

## 问题诊断

如果找不到日志文件，可能的原因：
1. **应用还没有运行过** - 日志文件只在应用运行时创建
2. **工作目录不同** - 日志文件位置依赖于启动时的工作目录
3. **日志级别设置** - 如果日志级别太高，可能没有记录足够的日志

## 日志文件实际位置

### 1. Electron主进程日志

**代码位置**: `electron_node/electron-node/main/src/logger.ts`

**日志文件路径**:
```typescript
const baseDir = process.cwd();  // 当前工作目录
const logDir = path.join(baseDir, 'logs');
const logFile = path.join(logDir, 'electron-main.log');
```

**实际位置**:
- 如果从 `electron-node` 目录启动: `electron_node/electron-node/logs/electron-main.log`
- 如果从项目根目录启动: `electron_node/logs/electron-main.log`
- 如果从其他目录启动: `<启动目录>/logs/electron-main.log`

**检查方法**:
```bash
# 查找所有electron-main.log文件
Get-ChildItem -Path . -Filter "electron-main.log" -Recurse

# 或者
find . -name "electron-main.log" -type f
```

**日志格式**:
- 默认: JSON格式（pino）
- 如果设置 `LOG_FORMAT=pretty`: 控制台pretty，文件JSON

### 2. ASR服务日志

**代码位置**: 
- 主进程捕获: `electron_node/electron-node/main/src/python-service-manager/service-process.ts`
- Python服务自身: `electron_node/services/faster_whisper_vad/faster_whisper_vad_service.py`

**日志文件路径**:

#### A. 主进程捕获的日志
```typescript
const logFile = path.join(logDir, `${serviceId}.log`);
// 例如: electron_node/services/faster_whisper_vad/logs/faster-whisper-vad.log
```

#### B. Python服务自身的日志
```python
log_dir = 'logs'  # 相对路径，相对于服务启动目录
log_file = os.path.join(log_dir, 'faster-whisper-vad-service.log')
# 实际位置: electron_node/services/faster_whisper_vad/logs/faster-whisper-vad-service.log
```

**实际位置**:
- 主进程日志: `electron_node/services/faster_whisper_vad/logs/faster-whisper-vad.log`
- Python服务日志: `electron_node/services/faster_whisper_vad/logs/faster-whisper-vad-service.log`

**注意**: 两个日志文件可能都存在，内容可能不同：
- 主进程日志：包含stdout/stderr的完整输出，带时间戳
- Python服务日志：只包含Python logging模块的输出

### 3. NMT服务日志

**代码位置**: 
- 主进程捕获: `electron_node/electron-node/main/src/python-service-manager/service-process.ts`
- Python服务自身: `electron_node/services/nmt_m2m100/nmt_service.py`

**日志文件路径**:
- 主进程日志: `electron_node/services/nmt_m2m100/logs/nmt-m2m100.log`
- Python服务日志: `electron_node/services/nmt_m2m100/logs/nmt-service.log`

### 4. Rust推理服务日志

**代码位置**: `electron_node/electron-node/main/src/rust-service-manager/process-manager.ts`

**日志文件路径**:
- `electron_node/services/node-inference/logs/node-inference.log`

## 如何确认日志位置

### 方法1: 检查代码中的日志配置

查看以下文件中的日志路径配置：
1. `electron_node/electron-node/main/src/logger.ts` - Electron主进程
2. `electron_node/electron-node/main/src/python-service-manager/index.ts` - Python服务日志路径
3. `electron_node/services/faster_whisper_vad/faster_whisper_vad_service.py` - ASR服务日志

### 方法2: 运行时检查

在应用运行时，添加调试代码输出日志路径：

```typescript
// 在 logger.ts 中添加
console.log('Log file path:', logFile);
console.log('Log directory:', logDir);
console.log('Current working directory:', process.cwd());
```

### 方法3: 搜索日志文件

```bash
# Windows PowerShell
Get-ChildItem -Path . -Filter "*.log" -Recurse | Select-Object FullName

# Linux/Mac
find . -name "*.log" -type f
```

### 方法4: 检查进程工作目录

在应用运行时，检查进程的工作目录：

```typescript
// 在应用启动时输出
console.log('process.cwd():', process.cwd());
console.log('__dirname:', __dirname);
```

## 常见问题

### Q1: 为什么日志目录存在但没有文件？

**可能原因**:
1. 应用还没有运行过
2. 日志级别设置太高，没有记录任何日志
3. 日志写入权限问题
4. 应用启动失败，没有到达日志记录代码

**解决方法**:
1. 确保应用已经运行过
2. 设置 `LOG_LEVEL=info` 或 `LOG_LEVEL=debug`
3. 检查目录写入权限
4. 检查应用启动日志（控制台输出）

### Q2: 为什么日志文件在不同的位置？

**原因**: 
- Electron主进程日志使用 `process.cwd()`，取决于启动时的工作目录
- Python服务日志使用相对路径，取决于服务启动时的工作目录

**解决方法**:
- 使用绝对路径而不是相对路径
- 或者在应用启动时统一设置工作目录

### Q3: 如何确保日志文件在预期位置？

**建议**:
1. 使用绝对路径而不是相对路径
2. 在应用启动时明确设置工作目录
3. 在日志配置中输出日志文件路径（用于调试）

## 推荐的日志检查流程

1. **确认应用已运行**: 检查是否有进程在运行
2. **检查日志目录**: 确认logs目录是否存在
3. **搜索日志文件**: 使用上述方法搜索所有.log文件
4. **检查日志级别**: 确认LOG_LEVEL设置正确
5. **检查控制台输出**: 如果文件日志不可用，检查控制台输出

## 临时解决方案

如果找不到日志文件，可以：

1. **重定向控制台输出到文件**:
   ```bash
   npm start > app.log 2>&1
   ```

2. **在代码中添加调试输出**:
   ```typescript
   console.log('Log file:', logFile);
   console.log('Log dir exists:', fs.existsSync(logDir));
   ```

3. **使用环境变量控制日志位置**:
   ```bash
   export LOG_DIR=/path/to/logs
   ```

## 下一步

1. 运行应用并检查控制台输出，确认日志文件路径
2. 如果日志文件不在预期位置，修改代码使用绝对路径
3. 添加日志路径的调试输出，便于排查问题
