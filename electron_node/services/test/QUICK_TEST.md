# 快速测试指南

## 一键测试流程

### 1. 确保服务已启动

```powershell
# 终端1: 启动调度服务器
.\scripts\start_central_server.ps1 --scheduler

# 终端2: 启动 Electron Node
.\scripts\start_electron_node.ps1
```

### 2. 安装测试依赖

```bash
pip install websockets
```

### 3. 运行测试

```bash
cd electron_node/services/test

# 测试中文转英文
python test_translation_pipeline.py --audio chinese.wav --src-lang zh --tgt-lang en

# 测试英文转中文
python test_translation_pipeline.py --audio english.wav --src-lang en --tgt-lang zh
```

## 测试流程说明

1. **脚本连接调度服务器** (`ws://localhost:5010/ws/session`)
2. **创建会话** - 获取 `session_id`
3. **加载音频文件** - 读取 `chinese.wav` 或 `english.wav`
4. **发送音频数据** - 将音频编码为base64并发送
5. **调度服务器分配任务** - 根据节点能力和负载选择electron node
6. **Electron Node执行任务链**:
   - ASR（语音识别）→ 识别源文本
   - NMT（机器翻译）→ 翻译文本
   - TTS（语音合成）→ 生成翻译后的音频
7. **返回结果** - 包含识别的文本、翻译文本和TTS音频
8. **保存结果** - TTS音频保存到 `output_translated_audio.pcm`

## 预期结果

- ✓ 会话创建成功
- ✓ 节点分配成功
- ✓ 收到ASR识别结果（可能包含部分结果）
- ✓ 收到翻译结果
- ✓ TTS音频文件已保存

## 故障排除

### 如果节点未分配
- 确认 Electron Node 已启动并连接到调度服务器
- 查看调度服务器日志确认节点注册状态

### 如果任务处理失败
- 查看 Electron Node 日志
- 确认推理服务正常运行（端口 5009）
- 确认Python服务运行（NMT: 5008, TTS: 5006）
- 确认模型文件存在

### 如果连接失败
- 确认调度服务器在运行（端口 5010）
- 检查防火墙设置
- 确认WebSocket地址正确

## 查看详细说明

更多详细信息请参考 [README.md](README.md)

