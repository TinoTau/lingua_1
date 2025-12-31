# Web端音频发送和播放逻辑总结

## 一、音频发送逻辑

### 1.1 发送流程

#### 1.1.1 流式发送（`audio_chunk`）
- **触发时机**：录音器每10ms产生一帧音频数据
- **发送频率**：每100ms发送一次（累积10帧）
- **编码格式**：Opus（Plan A格式，packet-based）
- **消息类型**：`audio_chunk`
- **关键参数**：
  - `is_final: false`（流式发送时）
  - `payload`: base64编码的Opus音频数据

#### 1.1.2 手动发送（`utterance`）
- **触发时机**：用户点击"发送"按钮
- **发送内容**：当前累积的所有音频数据
- **编码格式**：Opus（Plan A格式，packet-based）
- **消息类型**：`utterance`
- **关键参数**：
  - `utterance_index`: 当前话语索引
  - `manual_cut: true`
  - `audio`: base64编码的完整Opus音频数据

#### 1.1.3 静音检测触发
- **触发时机**：检测到连续静音超过阈值
- **处理流程**：
  1. 发送剩余的音频数据（`audio_chunk`，`is_final: false`）
  2. 发送finalize信号（`audio_chunk`，`is_final: true`）
  3. 停止录音

### 1.2 关键配置参数

#### 1.2.1 静音检测配置
```typescript
silenceTimeoutMs: 3000  // 3秒（静音超时阈值）
tailBufferMs: 250       // 尾部缓冲（静音检测后延迟触发）
```

#### 1.2.2 VAD静音过滤配置
```typescript
enabled: true
threshold: 0.015                    // RMS阈值
attackThreshold: 0.01              // 进入语音阈值（更宽松）
releaseThreshold: 0.003            // 退出语音阈值（更宽松，避免误判）
windowMs: 100                      // 窗口大小
attackFrames: 3                    // 连续3帧语音才开始发送
releaseFrames: 20                  // 连续20帧静音才停止发送（200ms）
```

#### 1.2.3 Opus编码配置
```typescript
codec: 'opus'
sampleRate: 16000
channelCount: 1
frameSizeMs: 20                    // 20ms帧
application: 'voip'                 // VOIP模式
bitrate: 24000                     // 24kbps
```

### 1.3 发送逻辑细节

#### 1.3.1 Opus编码格式
- **Plan A格式**：每个Opus packet前面加上2字节的长度前缀
- **Packet大小限制**：最大65535字节
- **编码方法**：使用`encodePackets()`生成packet数组，然后打包

#### 1.3.2 背压控制
- **暂停发送**：当背压状态为`pause`时，音频数据加入队列
- **降速发送**：当背压状态为`throttle`时，音频数据加入队列
- **正常发送**：当背压状态为`normal`时，直接发送

## 二、音频播放逻辑

### 2.1 接收流程

#### 2.1.1 接收TTS音频
- **消息类型**：`translation_result`
- **关键字段**：
  - `tts_audio`: base64编码的音频数据
  - `tts_format`: 音频格式（'pcm16' | 'opus'）
  - `utterance_index`: 话语索引
  - `text_asr`: 原文
  - `text_translated`: 译文

#### 2.1.2 音频解码
- **PCM16格式**：直接转换Int16Array到Float32Array
- **Opus格式**：使用Opus解码器解码

#### 2.1.3 添加到缓冲区
- **存储结构**：`AudioBufferWithIndex[]`
- **关联信息**：每个音频块关联`utterance_index`，用于文本显示同步

### 2.2 播放触发条件

#### 2.2.1 自动播放条件
1. **第一段音频**：`utterance_index === 0` 且 `bufferCount === 1` 且状态为 `INPUT_RECORDING`
2. **内存压力过高**：缓存时长 >= 80% 最大缓存时长（20秒）且状态为 `INPUT_RECORDING`
3. **大音频预触发**：添加大音频会导致超过缓存限制时，在添加前触发播放

#### 2.2.2 手动播放
- **触发方式**：用户点击播放按钮
- **条件**：状态为 `INPUT_RECORDING` 且有pending audio

### 2.3 关键配置参数

#### 2.3.1 缓存配置
```typescript
maxBufferDuration: 25秒              // 最大缓存时长
sampleRate: 16000                   // 采样率
```

#### 2.3.2 内存压力阈值
```typescript
normal: < 50% 最大缓存时长          // < 12.5秒
warning: >= 50% 且 < 80%           // >= 12.5秒 且 < 20秒
critical: >= 80%                    // >= 20秒
```

#### 2.3.3 内存监控
```typescript
checkInterval: 2000ms               // 每2秒检查一次内存
```

### 2.4 播放逻辑细节

#### 2.4.1 播放流程
1. 检查是否有待播放音频
2. 获取第一个音频块（不移除）
3. 通知App显示对应的文本（通过`playbackIndexChangeCallback`）
4. 创建AudioBufferSourceNode并播放
5. 播放完成后移除音频块，播放下一个

#### 2.4.2 缓存清理策略
- **播放时**：不清理缓存（避免播放时丢失音频）
- **未播放时**：
  - 超过最大缓存时长：保留30%缓存，清理其余
  - 内存压力critical：清理50%缓存
  - 页面进入后台：保留30%缓存

#### 2.4.3 播放倍速
- **可选倍速**：1.0x, 1.25x, 1.5x, 2.0x
- **切换方式**：循环切换
- **实时更新**：播放中切换倍速会立即生效

### 2.5 错误处理

#### 2.5.1 音频丢弃处理
- **丢弃原因**：
  1. 缓存已满（超过25秒）
  2. 内存压力过高
  3. 会话已结束
- **处理方式**：
  - 显示文本并标记`[播放失败]`
  - 保存翻译结果（带失败标记）

#### 2.5.2 会话状态检查
- **添加前检查**：如果会话已结束，丢弃音频
- **添加后检查**：如果会话在异步操作期间结束，记录警告但不清理缓冲区

## 三、关键超时和阈值总结

### 3.1 发送相关
| 参数 | 值 | 说明 |
|------|-----|------|
| `silenceTimeoutMs` | 3000ms | 静音超时阈值 |
| `tailBufferMs` | 250ms | 尾部缓冲延迟 |
| `releaseFrames` | 20帧 | VAD静音检测帧数（约200ms） |
| `attackFrames` | 3帧 | VAD语音检测帧数（约30ms） |
| `frameSizeMs` | 20ms | Opus帧大小 |
| 发送频率 | 100ms | 每10帧（100ms）发送一次 |

### 3.2 播放相关
| 参数 | 值 | 说明 |
|------|-----|------|
| `maxBufferDuration` | 25秒 | 最大缓存时长 |
| `normalThreshold` | 12.5秒 | 正常内存压力阈值（50%） |
| `warningThreshold` | 20秒 | 警告内存压力阈值（80%） |
| `criticalThreshold` | 20秒 | 严重内存压力阈值（80%） |
| `checkInterval` | 2000ms | 内存检查间隔 |
| `keepDuration` | 7.5秒 | 清理时保留的缓存（30%） |

### 3.3 自动播放触发条件
| 条件 | 说明 |
|------|------|
| 第一段音频 | `utterance_index === 0` 且 `bufferCount === 1` |
| 内存压力 | 缓存时长 >= 20秒（80%） |
| 大音频预触发 | 添加大音频会导致超过25秒限制 |

## 四、状态机交互

### 4.1 会话状态
- **INPUT_READY**：准备输入（未开始会话）
- **INPUT_RECORDING**：正在录音（会话进行中）
- **PLAYING_TTS**：正在播放TTS音频

### 4.2 状态转换
- **开始会话**：`INPUT_READY` → `INPUT_RECORDING`
- **开始播放**：`INPUT_RECORDING` → `PLAYING_TTS`
- **播放完成**：`PLAYING_TTS` → `INPUT_RECORDING`（会话进行中）或 `INPUT_READY`（会话未开始）
- **结束会话**：任何状态 → `INPUT_READY`

### 4.3 状态相关限制
- **录音**：仅在 `INPUT_RECORDING` 状态下处理音频帧
- **播放**：仅在 `INPUT_RECORDING` 状态下自动播放
- **静音检测**：仅在 `INPUT_RECORDING` 状态下触发

## 五、数据流图

```
录音器 (10ms/帧)
  ↓
SessionManager.onAudioFrame()
  ↓
累积10帧 (100ms)
  ↓
AudioSender.sendAudioChunk()
  ↓
Opus编码 (Plan A格式)
  ↓
WebSocket发送
  ↓
调度服务器
  ↓
节点处理
  ↓
返回 translation_result
  ↓
App.onServerMessage()
  ↓
TtsPlayer.addAudioChunk()
  ↓
解码并添加到缓冲区
  ↓
自动播放/手动播放
  ↓
AudioContext播放
```

## 六、注意事项

1. **Opus编码格式**：必须使用Plan A格式（packet-based），不能使用连续流格式
2. **缓存限制**：最大25秒，超过会自动清理
3. **内存监控**：每2秒检查一次，critical时自动清理50%缓存
4. **播放同步**：通过`utterance_index`关联音频和文本
5. **错误处理**：音频丢弃时显示文本并标记`[播放失败]`
6. **状态管理**：严格遵循状态机，不同状态下行为不同

