# 节点端Pipeline测试总结

**日期**: 2025-12-25  
**状态**: ✅ **测试脚本已创建，等待服务运行后测试**

---

## 已完成的工作

### 1. 修复NMT端点路径 ✅
- **问题**: 节点端请求 `/v1/nmt/translate`，但NMT服务实际端点是 `/v1/translate`
- **修复**: 已修改 `electron_node/electron-node/main/src/task-router/task-router.ts`
- **文件**: `electron_node/services/faster_whisper_vad/docs/NMT_404_FIX_SUMMARY.md`

### 2. 创建端到端测试脚本 ✅
- **文件**: `electron_node/electron-node/tests/pipeline-e2e-test-simple.js`
- **功能**: 测试完整的ASR → NMT pipeline流程
- **运行方式**: `npm run test:pipeline`

### 3. 测试覆盖范围
- ✅ 服务健康检查（faster-whisper-vad, nmt-m2m100）
- ✅ ASR服务测试（Plan A Opus解码）
- ✅ NMT服务测试（端点路径验证）
- ✅ 完整Pipeline流程测试

---

## 如何运行测试

### 前置条件

1. **启动节点端服务**：
   - faster-whisper-vad (端口 6007)
   - nmt-m2m100 (端口 5008)

2. **运行测试**：
   ```bash
   cd electron_node/electron-node
   npm run test:pipeline
   ```

### 预期输出

#### 成功情况
```
============================================================
节点端Pipeline端到端测试
============================================================

[步骤1] 检查服务健康状态
✅ 服务健康检查

[测试完整Pipeline]
  1. 测试ASR服务...
✅ ASR服务
   详情: {
      "text": "识别文本",
      "language": "zh"
    }
  2. 测试NMT服务...
✅ NMT服务
   详情: {
      "translated": "Translated text"
    }
  3. 验证结果...
✅ 完整Pipeline测试

============================================================
测试总结
============================================================
总计: 4 个测试
通过: 4 个
失败: 0 个

✅ Pipeline测试通过！服务流程正常。
```

---

## 测试验证点

### 1. ASR服务验证
- ✅ 端点: `http://127.0.0.1:6007/utterance`
- ✅ 格式: Plan A Opus packet格式
- ✅ 响应: 包含 `text` 和 `language` 字段

### 2. NMT服务验证
- ✅ 端点: `http://127.0.0.1:5008/v1/translate` (已修复)
- ✅ 请求格式: `{ text, src_lang, tgt_lang, context_text }`
- ✅ 响应: 包含 `text` 字段

### 3. Pipeline流程验证
- ✅ ASR → NMT 数据流转
- ✅ 结果完整性验证

---

## 数据返回给调度服务器的流程

### 完整流程

1. **调度服务器** → 发送 `job_assign` 消息（WebSocket）
2. **节点端 node-agent** → 接收并调用 `handleJob()`
3. **inference-service** → 调用 `processJob()`
4. **pipeline-orchestrator** → 依次执行：
   - **ASR任务** → faster-whisper-vad服务（端口 6007）
     - 输入：Opus音频数据（Plan A格式）
     - 输出：识别文本
   - **NMT任务** → nmt-m2m100服务（端口 5008）
     - 输入：ASR识别文本
     - 输出：翻译文本
   - **TTS任务** → piper-tts服务（端口 5006）
     - 输入：NMT翻译文本
     - 输出：语音音频（base64编码）
5. **node-agent** → 构造 `job_result` 消息
6. **节点端** → 通过WebSocket发送 `job_result` 给调度服务器

### job_result 消息格式

```typescript
{
  type: 'job_result',
  job_id: string,
  attempt_id: number,
  node_id: string,
  session_id: string,
  utterance_index: number,
  success: boolean,
  text_asr: string,           // ASR识别结果
  text_translated: string,     // NMT翻译结果
  tts_audio?: string,         // TTS音频（base64）
  tts_format?: string,
  extra?: object,
  processing_time_ms: number,
  trace_id: string,
  error?: {                   // 如果失败
    code: string,
    message: string,
    details?: object
  }
}
```

### 关键代码位置

- **接收job_assign**: `electron_node/electron-node/main/src/agent/node-agent.ts:700`
- **处理pipeline**: `electron_node/electron-node/main/src/pipeline-orchestrator/pipeline-orchestrator.ts:23`
- **发送job_result**: `electron_node/electron-node/main/src/agent/node-agent.ts:763`

---

## 下一步行动

1. ✅ **已完成**: 修复NMT端点路径
2. ✅ **已完成**: 创建测试脚本
3. ⏳ **待执行**: 启动服务并运行测试
4. ⏳ **待验证**: 确认数据能正确返回给调度服务器

---

## 相关文件

- `electron_node/electron-node/tests/pipeline-e2e-test-simple.js` - 测试脚本
- `electron_node/electron-node/main/src/task-router/task-router.ts` - 任务路由（已修复）
- `electron_node/electron-node/main/src/agent/node-agent.ts` - 节点代理（发送job_result）
- `electron_node/services/faster_whisper_vad/docs/NMT_404_FIX_SUMMARY.md` - 修复说明
- `electron_node/services/faster_whisper_vad/docs/PIPELINE_E2E_TEST_README.md` - 测试说明

---

## 注意事项

1. **测试音频数据**：
   - 当前测试使用模拟的Opus数据
   - 实际测试中应使用真实的Opus编码音频文件
   - 音频格式必须符合Plan A规范

2. **服务端点**：
   - ASR: `/utterance` ✅
   - NMT: `/v1/translate` ✅ (已修复)

3. **WebSocket连接**：
   - 测试脚本只测试HTTP服务
   - 实际的数据返回通过WebSocket完成
   - 需要启动完整的节点端应用才能测试WebSocket流程

