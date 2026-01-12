# Web-Client 调试指南

## 查看日志

### 调度服务器日志
位置：`central_server/scheduler/logs/scheduler.log`

查看最近的日志：
```powershell
Get-Content "central_server\scheduler\logs\scheduler.log" -Tail 100
```

### Web-Client 日志
位置：`webapp/web-client/logs/web-client.log`

## 常见问题诊断

### 1. 输出结果不正确

**可能原因**：
- ASR 识别错误（识别成了错误的文本）
- 语言设置不正确
- 节点端的 ASR 模型问题

**诊断步骤**：
1. 查看调度服务器日志，找到对应的 `trace_id`
2. 查找包含该 `trace_id` 的日志条目
3. 检查以下信息：
   - `Session created` - 查看 `src_lang` 和 `tgt_lang` 是否正确
   - `ASR Final 处理完成` - 查看 `asr_text` 字段，确认识别出的文本是否正确
   - `Received JobResult` - 查看 `text_asr` 和 `text_translated` 字段

**示例日志查询**：
```powershell
# 查找特定会话的日志
Get-Content "central_server\scheduler\logs\scheduler.log" | Select-String -Pattern "YOUR_TRACE_ID"
```

### 2. 连接问题

**检查点**：
- WebSocket 连接是否成功建立
- `session_init_ack` 消息是否收到
- 是否有错误消息

### 3. 音频传输问题

**检查点**：
- `audio_chunk` 消息是否包含 `session_id` 字段（已修复）
- 音频数据是否正确编码为 base64
- 服务器是否收到音频块

## 日志字段说明

### Session 创建日志
```
Session created
- trace_id: 追踪 ID
- session_id: 会话 ID
- src_lang: 源语言（如 "zh"）
- tgt_lang: 目标语言（如 "en"）
- mode: 翻译模式（"one_way" 或 "two_way_auto"）
```

### ASR 结果日志
```
ASR Final 处理完成，已添加到 Group
- trace_id: 追踪 ID
- session_id: 会话 ID
- asr_text: ASR 识别出的文本（重要！）
- asr_text_len: 文本长度
```

### 翻译结果日志
```
Received JobResult, adding to result queue
- trace_id: 追踪 ID
- job_id: 任务 ID
- session_id: 会话 ID
- text_asr: ASR 识别文本
- text_translated: 翻译后的文本
```

## 调试技巧

1. **使用浏览器控制台**：
   - 打开浏览器开发者工具（F12）
   - 查看 Console 标签页
   - 查看 Network 标签页，检查 WebSocket 消息

2. **启用详细日志**：
   - 调度服务器日志级别可以通过环境变量控制
   - 设置 `RUST_LOG=debug` 可以查看更详细的日志

3. **检查消息格式**：
   - 确保所有消息都包含必需的字段
   - 参考 `SCHEDULER_COMPATIBILITY_FIX.md` 了解消息格式要求

