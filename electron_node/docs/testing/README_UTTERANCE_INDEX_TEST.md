# UtteranceIndex修复测试说明

## 快速开始

### 1. 安装依赖

```powershell
pip install websockets
```

### 2. 启动服务

**启动调度服务器**：
```powershell
cd d:\Programs\github\lingua_1
.\scripts\start_central_server.ps1 --scheduler
```

**启动节点服务**（新终端）：
```powershell
.\scripts\start_electron_node.ps1
```

### 3. 运行测试

```powershell
cd electron_node/services/test
python test_utterance_index_fix.py --audio chinese.wav
```

## 测试说明

这个测试脚本会：
1. 将音频文件分割成3个短chunk
2. 模拟发送3个job（Job 623, 624, 625）
3. 前两个job的音频会被缓存
4. 第三个job会触发合并处理
5. 验证返回结果的utteranceIndex是否正确

## 预期结果

- ✓ 所有结果的utteranceIndex都正确（0, 1, 2）
- ✓ 日志中有 "Created original job with original utterance_index" 记录
- ✓ 没有 "Task arrived too late" 错误

## 详细文档

- `UTTERANCE_INDEX_FIX_TEST_GUIDE.md` - 完整测试指南
- `UTTERANCE_INDEX_FIX_QUICK_TEST.md` - 快速测试清单
