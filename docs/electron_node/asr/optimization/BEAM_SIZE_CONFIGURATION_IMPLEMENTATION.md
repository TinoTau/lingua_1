# Beam Size 配置化实现总结

## 概述

将 `beam_size` 及相关 ASR 参数从硬编码改为配置文件管理，提高可维护性和灵活性。

## 实现内容

### 1. Electron Node 配置（TypeScript）

#### 1.1 配置文件结构
- **文件**: `electron_node/electron-node/main/src/node-config.ts`
- **配置文件**: `electron-node-config.json`（位于 Electron userData 目录）

#### 1.2 新增配置接口
```typescript
export interface ASRConfig {
  beam_size?: number;  // 默认 10
  temperature?: number;  // 默认 0.0
  patience?: number;  // 默认 1.0
  compression_ratio_threshold?: number;  // 默认 2.4
  log_prob_threshold?: number;  // 默认 -1.0
  no_speech_threshold?: number;  // 默认 0.6
}
```

#### 1.3 配置示例
```json
{
  "asr": {
    "beam_size": 10,
    "temperature": 0.0,
    "patience": 1.0,
    "compression_ratio_threshold": 2.4,
    "log_prob_threshold": -1.0,
    "no_speech_threshold": 0.6
  }
}
```

#### 1.4 TaskRouter 修改
- **文件**: `electron_node/electron-node/main/src/task-router/task-router.ts`
- 添加 `loadASRConfig()` 方法加载配置
- 添加 `getASRConfig()` 方法获取配置（带默认值）
- 修改 `beam_size` 从配置读取：`beam_size: this.getASRConfig().beam_size ?? 10`

### 2. Python ASR 服务配置

#### 2.1 配置文件
- **文件**: `electron_node/services/faster_whisper_vad/config.py`
- 支持从环境变量读取，提供默认值

#### 2.2 新增配置项
```python
BEAM_SIZE = int(os.getenv("ASR_BEAM_SIZE", "10"))
TEMPERATURE = float(os.getenv("ASR_TEMPERATURE", "0.0"))
PATIENCE = float(os.getenv("ASR_PATIENCE", "1.0"))
COMPRESSION_RATIO_THRESHOLD = float(os.getenv("ASR_COMPRESSION_RATIO_THRESHOLD", "2.4"))
LOG_PROB_THRESHOLD = float(os.getenv("ASR_LOG_PROB_THRESHOLD", "-1.0"))
NO_SPEECH_THRESHOLD = float(os.getenv("ASR_NO_SPEECH_THRESHOLD", "0.6"))
```

#### 2.3 服务使用配置
- **文件**: `electron_node/services/faster_whisper_vad/faster_whisper_vad_service.py`
- `UtteranceRequest` 类的默认值从 `config.py` 导入
- 例如：`beam_size: int = BEAM_SIZE`

### 3. Rust 客户端

- **文件**: `electron_node/services/node-inference/src/faster_whisper_vad_client.rs`
- 保持硬编码 `beam_size: 10`（因为主要调用路径通过 TypeScript，TypeScript 会从配置读取）

## 配置优先级

### Electron Node (TypeScript)
1. **配置文件** (`electron-node-config.json`) - 最高优先级
2. **默认值** (代码中定义)

### Python ASR 服务
1. **环境变量** (如 `ASR_BEAM_SIZE`) - 最高优先级
2. **默认值** (`config.py` 中定义)

## 使用方法

### 方法 1：修改 Electron Node 配置文件

编辑 `electron-node-config.json`（位于 Electron userData 目录）：
```json
{
  "asr": {
    "beam_size": 15,
    "temperature": 0.0
  }
}
```

### 方法 2：使用环境变量（Python 服务）

启动 Python ASR 服务前设置环境变量：
```bash
export ASR_BEAM_SIZE=15
export ASR_TEMPERATURE=0.0
python faster_whisper_vad_service.py
```

## 修改的文件列表

1. ✅ `electron_node/electron-node/main/src/node-config.ts` - 添加 ASR 配置接口和默认值
2. ✅ `electron_node/electron-node/main/src/task-router/task-router.ts` - 从配置读取 beam_size
3. ✅ `electron_node/electron-node/main/electron-node-config.example.json` - 添加 ASR 配置示例
4. ✅ `electron_node/services/faster_whisper_vad/config.py` - 添加 ASR 参数配置
5. ✅ `electron_node/services/faster_whisper_vad/faster_whisper_vad_service.py` - 从配置读取默认值

## 向后兼容性

- ✅ 如果配置文件中没有 `asr` 部分，使用代码中的默认值
- ✅ 如果配置项缺失，使用默认值（例如 `beam_size` 默认 10）
- ✅ Python 服务支持环境变量，也支持代码默认值

## 验证方法

1. **检查 TypeScript 配置加载**：
   - 修改 `electron-node-config.json` 中的 `beam_size`
   - 重启 Electron Node 服务
   - 查看日志确认配置已加载

2. **检查 Python 服务配置**：
   - 设置环境变量 `ASR_BEAM_SIZE=15`
   - 重启 Python ASR 服务
   - 查看日志确认配置已加载（日志会显示 `ASR Parameters: beam_size=15`）

3. **检查实际使用**：
   - 进行语音识别测试
   - 查看 ASR 服务日志，确认 `beam_size` 值正确

## 注意事项

1. **配置文件位置**：
   - Electron Node 配置文件位于 `app.getPath('userData')/electron-node-config.json`
   - 不同平台路径不同（Windows: `%APPDATA%`, macOS: `~/Library/Application Support`, Linux: `~/.config`）

2. **配置生效时机**：
   - TypeScript 配置：需要重启 Electron Node 服务
   - Python 环境变量：需要重启 Python ASR 服务

3. **配置合并**：
   - TypeScript 配置使用深度合并，只覆盖提供的字段
   - Python 环境变量会完全覆盖默认值

## 总结

现在 `beam_size` 及相关 ASR 参数都已配置化：
- ✅ TypeScript 从配置文件读取
- ✅ Python 从环境变量或配置文件读取
- ✅ 所有位置都有合理的默认值
- ✅ 向后兼容，不影响现有功能

