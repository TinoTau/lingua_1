# 客户端 is_final=true 发送逻辑对比分析

**日期**: 2026-01-24  
**问题**: 每句话都只有后半句被识别出来，怀疑客户端过早发送 `is_final=true`

---

## 一、问题现象

从调度服务器日志可以看到：
- `utterance_index=0`: `reason="IsFinal"`, `accumulated_audio_duration_ms=3360` (3.36秒), `chunk_size=0`
- `utterance_index=2`: `reason="IsFinal"`, `accumulated_audio_duration_ms=1560` (1.56秒)

这说明客户端过早发送了 `is_final=true`，导致调度服务器立即触发 finalize。

---

## 二、客户端发送 `is_final=true` 的触发条件

### 2.1 触发场景

客户端在以下两种情况下会发送 `is_final=true`：

1. **用户手动点击发送按钮** (`sendCurrentUtterance()`)
2. **静音检测超时** (`onSilenceDetected()`)

### 2.2 sendFinal() 方法

**代码位置**: `webapp/web-client/src/websocket/audio_sender.ts:259-310`

```typescript
async sendFinal(): Promise<void> {
  if (!this.sessionId) {
    return;
  }

  try {
    if (this.useBinaryFrame && this.sessionId) {
      // Binary Frame 模式：发送 FINAL 帧
      // ...
    } else {
      // JSON 模式：发送一个空的 audio_chunk 消息，is_final=true
      const message = {
        type: 'audio_chunk',
        session_id: this.sessionId,
        seq: this.sequence++,
        is_final: true,
        payload: '', // 空 payload，只用于触发 finalize
      };
      this.sendCallback(JSON.stringify(message));
    }
  } catch (error) {
    // 错误处理
  }
}
```

---

## 三、静音检测逻辑

### 3.1 静音检测配置

**代码位置**: `webapp/web-client/src/websocket/audio_sender.ts`

```typescript
// 静音检测超时时间（默认 3 秒）
private silenceTimeoutMs: number = 3000;

// 静音检测回调
private onSilenceDetected = () => {
  this.sendFinal();
};
```

### 3.2 可能的问题

**问题**: 静音检测可能过于敏感，导致在句子中间误触发 `is_final=true`

**影响**: 导致音频被提前 finalize，前半句丢失

---

## 四、解决方案

### 4.1 优化静音检测

1. **增加最小音频时长检查**: 如果音频时长 < 1秒，不触发 finalize
2. **调整静音超时时间**: 从 3秒 增加到 5秒
3. **增加能量阈值检查**: 只有在能量低于阈值时才认为是静音

### 4.2 调度服务器端保护

1. **最小音频时长检查**: 如果 `accumulated_audio_duration_ms < 1000`，延迟 finalize
2. **音频质量检查**: 如果音频质量过低，延迟 finalize

---

**文档版本**: v1.0  
**最后更新**: 2026-01-24  
**状态**: 归档文档（历史记录）
