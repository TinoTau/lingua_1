# 内存监控与自动播放功能实现总结

## 实现时间
2024年（当前日期）

## 已实现功能

### 1. ✅ 内存监控

**实现位置**: `webapp/web-client/src/tts_player.ts`

**功能**:
- 每2秒检查一次内存使用情况
- 使用两种方法检测内存压力：
  1. **Performance API**（如果支持）：检测 JavaScript 堆内存使用率
  2. **缓存时长估算**：根据缓存时长占最大缓存时长的比例估算

**内存压力等级**:
- **normal**（正常）: < 50%
- **warning**（警告）: 50% - 80%
- **critical**（严重）: ≥ 80%

**关键代码**:
```typescript
private checkMemoryPressure(): void {
  // 检测内存使用率
  if ('memory' in performance) {
    const usagePercent = (usedMB / limitMB) * 100;
    if (usagePercent >= 80) pressure = 'critical';
    else if (usagePercent >= 50) pressure = 'warning';
  }
  
  // 根据缓存时长估算
  const bufferDurationPercent = (bufferDuration / maxBufferDuration) * 100;
  if (bufferDurationPercent >= 80) pressure = 'critical';
  else if (bufferDurationPercent >= 50 && pressure === 'normal') {
    pressure = 'warning';
  }
}
```

### 2. ✅ 播放按钮闪烁效果

**实现位置**: `webapp/web-client/src/ui/renderers.ts`

**功能**:
- 内存压力达到 **50%**（warning）时，播放按钮开始闪烁
- 闪烁效果：
  - 每500ms切换一次颜色
  - 黄色背景 + 黄色阴影（警告色）
  - 绿色背景（正常色）
- 播放时自动停止闪烁

**视觉效果**:
```typescript
// 闪烁效果
playPauseBtn.style.boxShadow = '0 0 20px rgba(255, 193, 7, 0.8)';
playPauseBtn.style.backgroundColor = '#ffc107'; // 黄色警告
```

**触发条件**:
- 内存压力 = `warning`（50%）
- 当前状态 = `INPUT_RECORDING`
- 有待播放音频
- 未正在播放

### 3. ✅ 自动播放（打断用户发言）

**实现位置**: `webapp/web-client/src/app.ts`

**功能**:
- 内存压力达到 **80%**（critical）时，自动开始播放
- 自动清理50%的缓存以释放内存
- 显示紧急提示："⚠️ 内存压力过高，自动播放中..."

**触发条件**:
- 内存压力 = `critical`（80%）
- 当前状态 = `INPUT_RECORDING`
- 有待播放音频
- 未正在播放

**关键代码**:
```typescript
if (pressure === 'critical') {
  const currentState = this.stateMachine.getState();
  const hasPendingAudio = this.ttsPlayer.hasPendingAudio();
  
  if (currentState === SessionState.INPUT_RECORDING && 
      hasPendingAudio && 
      !this.ttsPlayer.getIsPlaying()) {
    console.warn('[App] 内存压力过高，自动开始播放以释放内存');
    this.startTtsPlayback();
  }
}
```

### 4. ⚠️ 压缩存储（待实现）

**当前状态**:
- Opus 编码/解码器框架已存在（`audio_codec.ts`）
- 但实际实现需要集成第三方库（如 `opus-media-recorder` 或 `opus.js`）
- 服务器端需要支持 Opus 格式返回

**后续实现建议**:
1. 集成 Opus 解码库
2. 修改 `tts_player.ts` 的 `addAudioChunk` 方法，支持 Opus 解码
3. 在服务器端实现 Opus 编码返回
4. 添加编解码器协商机制

## 工作流程

### 正常流程
```
用户说话 → VAD过滤静音 → 发送有效语音 → 接收TTS音频 → 缓存累积
                                                          ↓
                                                    内存监控（每2秒）
                                                          ↓
                                                    [normal] 继续缓存
```

### 内存压力50%（警告）
```
内存监控检测到50%压力
        ↓
触发 warning 回调
        ↓
播放按钮开始闪烁（黄色警告）
        ↓
提醒用户播放音频
```

### 内存压力80%（严重）
```
内存监控检测到80%压力
        ↓
触发 critical 回调
        ↓
自动清理50%缓存
        ↓
自动开始播放（打断用户发言）
        ↓
显示紧急提示："⚠️ 内存压力过高，自动播放中..."
        ↓
停止闪烁（因为正在播放）
```

## 内存监控详细说明

### 检测方法

#### 方法1：Performance API（优先）
```typescript
if ('memory' in performance) {
  const memory = performance.memory;
  const usagePercent = (memory.usedJSHeapSize / memory.jsHeapSizeLimit) * 100;
}
```

**支持情况**:
- Chrome/Edge: ✅ 支持
- Firefox: ❌ 不支持
- Safari: ❌ 不支持

#### 方法2：缓存时长估算（降级方案）
```typescript
const bufferDurationPercent = (currentDuration / maxBufferDuration) * 100;
```

**适用场景**:
- 所有浏览器
- Performance API 不支持时的降级方案

### 监控频率

- **检查间隔**: 2秒
- **日志频率**: 每10次检查记录一次（避免日志过多）

### 内存压力处理

| 压力等级 | 阈值 | 处理方式 |
|---------|------|---------|
| normal | < 50% | 正常缓存，无特殊处理 |
| warning | 50% - 80% | 播放按钮闪烁提醒 |
| critical | ≥ 80% | 自动清理50%缓存 + 自动播放 |

## UI 效果说明

### 播放按钮闪烁

**正常状态**:
- 背景色: `#28a745`（绿色）
- 阴影: 无

**闪烁状态**（warning）:
- 背景色: `#ffc107`（黄色） ↔ `#28a745`（绿色）
- 阴影: `0 0 20px rgba(255, 193, 7, 0.8)` ↔ 无
- 切换频率: 每500ms

### 紧急提示

**critical 状态**:
- 状态文本: "⚠️ 内存压力过高，自动播放中..."
- 文本颜色: `#dc3545`（红色）
- 持续时间: 3秒后恢复

## 代码结构

### TtsPlayer 类新增方法

```typescript
// 内存监控
setMemoryPressureCallback(callback: MemoryPressureCallback): void
startMemoryMonitoring(): void
stopMemoryMonitoring(): void
checkMemoryPressure(): void
handleCriticalMemoryPressure(): void
getMemoryPressure(): 'normal' | 'warning' | 'critical'
destroy(): void // 清理资源
```

### App 类新增方法

```typescript
// 内存压力处理
onMemoryPressure(pressure: 'normal' | 'warning' | 'critical'): void
getMemoryPressure(): 'normal' | 'warning' | 'critical'
```

### UI 新增功能

```typescript
// 播放按钮闪烁
startBlink(): void
stopBlink(): void

// 内存压力监听
window.onMemoryPressure = (pressure) => { ... }
```

## 测试建议

### 1. 内存压力测试

```typescript
// 模拟内存压力
// 方法1：快速累积大量音频
for (let i = 0; i < 100; i++) {
  await ttsPlayer.addAudioChunk(largeAudioChunk);
}

// 方法2：手动设置缓存时长（测试用）
// 修改 maxBufferDuration 为较小值
```

### 2. 闪烁效果测试

- 观察播放按钮在内存压力50%时是否开始闪烁
- 验证闪烁频率和颜色变化
- 确认播放时闪烁停止

### 3. 自动播放测试

- 验证内存压力80%时是否自动播放
- 确认是否清理了50%缓存
- 检查是否显示紧急提示
- 验证是否打断了用户发言（停止录音）

## 注意事项

1. **内存监控开销**: 每2秒检查一次，开销很小
2. **自动播放打断**: 可能会打断用户发言，但这是必要的保护措施
3. **浏览器兼容性**: Performance API 不是所有浏览器都支持，已实现降级方案
4. **闪烁频率**: 500ms 切换一次，不会过于频繁影响用户体验

## 后续优化方向

1. **压缩存储**: 集成 Opus 解码，降低90%内存占用
2. **智能清理**: 根据实际内存使用情况动态调整清理策略
3. **用户提示**: 在UI中显示内存使用率（可选）
4. **配置选项**: 允许用户调整内存压力阈值

## 总结

✅ **已实现**:
- 内存监控（每2秒检查）
- 播放按钮闪烁（50%压力时）
- 自动播放（80%压力时）
- 自动缓存清理（80%压力时）

⚠️ **待实现**:
- Opus 压缩存储（需要集成第三方库和服务器支持）

所有功能已通过代码审查，无 linter 错误。

