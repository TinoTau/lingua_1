# 节点端Pipeline端到端测试说明

**日期**: 2025-12-25  
**目的**: 验证节点端完整服务流程（ASR → NMT）能正确工作并将结果返回给调度服务器

---

## 测试范围

### 1. 服务健康检查
- faster-whisper-vad 服务 (端口 6007)
- nmt-m2m100 服务 (端口 5008)

### 2. ASR服务测试
- 发送Opus音频数据（Plan A格式）
- 验证识别结果

### 3. NMT服务测试
- 发送ASR识别文本
- 验证翻译结果

### 4. TTS服务测试
- 发送NMT翻译文本
- 验证语音音频生成

### 5. 完整Pipeline测试
- ASR → NMT → TTS 完整流程
- 验证数据能正确流转

---

## 运行测试

### 前置条件

1. **确保服务正在运行**：
   ```bash
   # faster-whisper-vad 应该在端口 6007
   # nmt-m2m100 应该在端口 5008
   # piper-tts 应该在端口 5006
   ```

2. **编译TypeScript代码**：
   ```bash
   cd electron_node/electron-node
   npm run build:main
   ```

3. **运行测试**：
   ```bash
   # 使用Node.js直接运行编译后的JS文件
   node main/electron-node/main/src/tests/pipeline-e2e-test.js
   
   # 或者使用ts-node（如果已安装）
   npx ts-node tests/pipeline-e2e-test.ts
   ```

---

## 测试输出

### 成功示例
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
      "text": "你好世界",
      "language": "zh"
    }
  2. 测试NMT服务...
✅ NMT服务
   详情: {
      "translated": "Hello World"
    }
  3. 测试TTS服务...
✅ TTS服务
   详情: {
      "audio_length": 12345
    }
  4. 验证结果...
✅ 完整Pipeline测试
   详情: {
      "asr_text": "你好世界",
      "translated_text": "Hello World"
    }

============================================================
测试总结
============================================================
总计: 4 个测试
通过: 4 个
失败: 0 个

============================================================
✅ 所有测试通过！Pipeline工作正常。
```

### 失败示例
```
❌ ASR服务测试: Request failed with status code 404
   详情: {
     "status": 404,
     "data": {...}
   }
```

---

## 注意事项

1. **测试音频数据**：
   - 当前测试使用模拟的Opus数据
   - 实际测试中应使用真实的Opus编码音频文件
   - 音频格式必须符合Plan A规范（length-prefixed packets）

2. **服务端点**：
   - ASR: `http://127.0.0.1:6007/utterance`
   - NMT: `http://127.0.0.1:5008/v1/translate` ✅ (已修复)
   - TTS: `http://127.0.0.1:5006/synthesize`

3. **超时设置**：
   - ASR: 30秒
   - NMT: 30秒

4. **错误处理**：
   - 如果服务不可用，测试会立即失败
   - 详细的错误信息会显示在测试输出中

---

## 相关文件

- `electron_node/electron-node/tests/pipeline-e2e-test.ts` - 测试脚本
- `electron_node/electron-node/main/src/task-router/task-router.ts` - 任务路由（已修复NMT端点）
- `electron_node/services/faster_whisper_vad/docs/NMT_404_FIX_SUMMARY.md` - NMT端点修复说明

---

## 下一步

1. ✅ 修复NMT端点路径（已完成）
2. ✅ 创建端到端测试脚本（已完成）
3. ⏳ 运行测试验证修复
4. ⏳ 如果测试通过，验证数据能正确返回给调度服务器

