# 服务自动启动配置管理

## 功能说明

节点端会记录用户对于服务自动启动的选择，并在用户手动启动/关闭服务时自动更新配置。

## 配置存储

### 配置文件位置

**Windows**:
```
%APPDATA%/electron-node/electron-node-config.json
```

**Linux/Mac**:
```
~/.config/electron-node/electron-node-config.json
```

### 配置结构

```typescript
interface ServicePreferences {
  rustEnabled: boolean;                    // Rust 推理服务自动启动
  nmtEnabled: boolean;                     // NMT 服务自动启动
  ttsEnabled: boolean;                     // TTS 服务自动启动
  yourttsEnabled: boolean;                 // YourTTS 服务自动启动
  fasterWhisperVadEnabled: boolean;       // Faster Whisper VAD 服务自动启动
  speakerEmbeddingEnabled: boolean;        // Speaker Embedding 服务自动启动
  semanticRepairZhEnabled?: boolean;      // semantic-repair-zh 自动启动
  semanticRepairEnEnabled?: boolean;       // semantic-repair-en 自动启动
  enNormalizeEnabled?: boolean;            // en-normalize 自动启动
}
```

## 自动更新机制

### 1. 用户手动启动服务

**触发时机**：用户通过 UI 手动启动服务

**行为**：
- 如果该服务的自动启动配置为 `false`，自动设置为 `true`
- 记录日志：`用户手动启动服务，已更新自动启动配置为是`

**实现位置**：
- `ipc-handlers/runtime-handlers.ts::start-python-service`
- `ipc-handlers/runtime-handlers.ts::start-rust-service`
- `ipc-handlers/runtime-handlers.ts::start-semantic-repair-service`

### 2. 用户手动关闭服务

**触发时机**：用户通过 UI 手动关闭服务

**行为**：
- 如果该服务的自动启动配置为 `true`，自动设置为 `false`
- 记录日志：`用户手动关闭服务，已更新自动启动配置为否`

**实现位置**：
- `ipc-handlers/runtime-handlers.ts::stop-python-service`
- `ipc-handlers/runtime-handlers.ts::stop-rust-service`
- `ipc-handlers/runtime-handlers.ts::stop-semantic-repair-service`

### 3. 用户通过设置界面修改

**触发时机**：用户通过设置界面修改自动启动配置

**行为**：
- 直接保存用户的选择
- 通过 `set-service-preferences` IPC handler 处理

**实现位置**：
- `ipc-handlers/runtime-handlers.ts::set-service-preferences`

## 服务映射关系

### Python 服务

| 服务名称 | 配置字段 |
|---------|---------|
| `nmt` | `nmtEnabled` |
| `tts` | `ttsEnabled` |
| `yourtts` | `yourttsEnabled` |
| `faster_whisper_vad` | `fasterWhisperVadEnabled` |
| `speaker_embedding` | `speakerEmbeddingEnabled` |

### Rust 服务

| 服务名称 | 配置字段 |
|---------|---------|
| `rust` | `rustEnabled` |

### 语义修复服务

| 服务ID | 配置字段 |
|--------|---------|
| `semantic-repair-zh` | `semanticRepairZhEnabled` |
| `semantic-repair-en` | `semanticRepairEnEnabled` |
| `en-normalize` | `enNormalizeEnabled` |

## 日志记录

### 启动服务日志

```
[INFO] 用户手动启动服务，已更新自动启动配置为是
  serviceName: "nmt"
```

### 关闭服务日志

```
[INFO] 用户手动关闭服务，已更新自动启动配置为否
  serviceName: "nmt"
```

### 配置保存日志

配置保存通过 `saveNodeConfig` 函数完成，该函数会：
1. 创建配置目录（如果不存在）
2. 将配置写入 JSON 文件
3. 使用格式化输出（2 空格缩进）

## 应用启动时的行为

**位置**：`index.ts::app.whenReady()`

**行为**：
1. 加载配置文件（`loadNodeConfig()`）
2. 读取 `servicePreferences` 配置
3. 根据配置自动启动对应的服务

**示例**：
```typescript
const config = loadNodeConfig();
const prefs = config.servicePreferences;

// 如果 rustEnabled 为 true，自动启动 Rust 服务
if (prefs.rustEnabled) {
  rustServiceManager.start();
}

// 如果 nmtEnabled 为 true，自动启动 NMT 服务
if (prefs.nmtEnabled) {
  pythonServiceManager.startService('nmt');
}
```

## 注意事项

1. **配置持久化**：配置保存在本地 JSON 文件中，应用重启后仍然有效

2. **自动更新条件**：
   - 只有在配置值与操作不一致时才更新（避免不必要的写入）
   - 例如：如果服务已经是自动启动（`true`），用户再次启动时不会更新配置

3. **日志记录**：所有配置更新都会记录日志，方便调试和追踪

4. **错误处理**：如果配置保存失败，会记录错误日志，但不会影响服务启动/停止操作

## 测试建议

1. **测试手动启动**：
   - 关闭服务的自动启动配置
   - 手动启动服务
   - 检查配置是否更新为 `true`
   - 重启应用，验证服务是否自动启动

2. **测试手动关闭**：
   - 开启服务的自动启动配置
   - 手动关闭服务
   - 检查配置是否更新为 `false`
   - 重启应用，验证服务是否不自动启动

3. **测试设置界面**：
   - 通过设置界面修改自动启动配置
   - 验证配置是否正确保存
   - 重启应用，验证配置是否生效
