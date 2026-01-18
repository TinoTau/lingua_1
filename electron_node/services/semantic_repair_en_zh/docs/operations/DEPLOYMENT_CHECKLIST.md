# 部署验证清单

**服务ID**: `semantic-repair-en-zh`  
**服务目录**: `semantic_repair_en_zh`  
**端口**: 5015  
**更新日期**: 2026-01-19

---

## ✅ 已完成的修改

### 1. 目录重命名
- [x] 从 `unified_semantic_repair` 重命名为 `semantic_repair_en_zh`

### 2. 服务配置
- [x] 创建 `service.json`（服务ID: `semantic-repair-en-zh`）
- [x] 端口配置：5015
- [x] 启动命令：`python service.py`

### 3. 代码更新
- [x] 更新 `SemanticRepairServiceManager` 类型定义
- [x] 添加到服务初始化列表
- [x] 更新模型服务检查逻辑（7处修改）
- [x] 更新已安装服务过滤器

### 4. 文档更新
- [x] README.md 路径引用
- [x] SERVICE_REGISTRATION.md 路径引用
- [x] FILE_MANIFEST.md 路径引用
- [x] IMPLEMENTATION_COMPLETE_2026_01_19.md 路径引用
- [x] IMPLEMENTATION_REPORT_2026_01_19.md 路径引用
- [x] UNIFIED_SEMANTIC_REPAIR_IMPLEMENTATION_SUMMARY.md 路径引用

### 5. 代码验证
- [x] Python 代码无硬编码路径
- [x] 文档中无遗留旧路径名

---

## 🔍 部署前检查清单

### 环境检查

- [ ] Python 3.8+ 已安装
- [ ] pip 可用
- [ ] GPU 驱动已安装（如果使用 GPU）

### 依赖安装

```bash
cd D:\Programs\github\lingua_1\electron_node\services\semantic_repair_en_zh
pip install -r requirements.txt
```

检查项：
- [ ] fastapi 已安装
- [ ] uvicorn 已安装
- [ ] pydantic 已安装
- [ ] llama-cpp-python 已安装（如果使用 GPU）

### 模型检查

**重要**: 新服务只使用本目录下的模型文件。

检查模型是否存在：
- [ ] 中文模型：`models/qwen2.5-3b-instruct-zh-gguf/*.gguf`
- [ ] 英文模型：`models/qwen2.5-3b-instruct-en-gguf/*.gguf`

如果模型不存在，请参考：
- [ ] [模型安装指南](./MODELS_SETUP_GUIDE.md) - 详细安装步骤
- [ ] 从旧服务复制或创建链接

### 端口检查

```bash
# Windows
netstat -ano | findstr :5015

# 如果端口被占用，停止占用进程或修改配置
```

- [ ] 端口 5015 可用

---

## 🚀 启动测试

### 1. 手动启动测试

```bash
cd D:\Programs\github\lingua_1\electron_node\services\semantic_repair_en_zh
python service.py
```

预期输出：
```
================================================================================
[Unified SR] ===== Starting Unified Semantic Repair Service =====
================================================================================
[Unified SR] Configuration loaded:
[Unified SR]   Host: 127.0.0.1
[Unified SR]   Port: 5015
[Unified SR]   Timeout: 30s
[Unified SR]   Enabled processors:
[Unified SR]     - zh_repair (Chinese Semantic Repair)
[Unified SR]     - en_repair (English Semantic Repair)
[Unified SR]     - en_normalize (English Normalize)
[Unified SR] Service ready with 3 processor(s)
================================================================================
```

检查项：
- [ ] 服务启动成功
- [ ] 端口 5015 监听中
- [ ] 3个处理器加载成功
- [ ] 无错误信息

### 2. 健康检查测试

```bash
curl http://localhost:5015/health
```

预期响应：
```json
{
  "status": "healthy",
  "processors": {
    "zh_repair": {
      "status": "healthy",
      "processor_type": "model",
      "initialized": true,
      "warmed": true,
      "model_loaded": true
    },
    "en_repair": {
      "status": "healthy",
      "processor_type": "model",
      "initialized": true,
      "warmed": true,
      "model_loaded": true
    },
    "en_normalize": {
      "status": "healthy",
      "processor_type": "rule_engine",
      "initialized": true,
      "warmed": true,
      "rules_loaded": true
    }
  }
}
```

检查项：
- [ ] 全局状态为 "healthy"
- [ ] 所有处理器状态为 "healthy"
- [ ] 模型处理器显示 model_loaded: true
- [ ] 规则处理器显示 rules_loaded: true

### 3. API 功能测试

#### 中文修复
```bash
curl -X POST http://localhost:5015/zh/repair \
  -H "Content-Type: application/json" \
  -d "{\"job_id\":\"test-zh\",\"session_id\":\"s1\",\"text_in\":\"你号\"}"
```

检查项：
- [ ] 返回 200 状态码
- [ ] decision 字段存在
- [ ] text_out 字段存在
- [ ] processor_name 为 "zh_repair"

#### 英文修复
```bash
curl -X POST http://localhost:5015/en/repair \
  -H "Content-Type: application/json" \
  -d "{\"job_id\":\"test-en\",\"session_id\":\"s1\",\"text_in\":\"helo\"}"
```

检查项：
- [ ] 返回 200 状态码
- [ ] processor_name 为 "en_repair"

#### 英文标准化
```bash
curl -X POST http://localhost:5015/en/normalize \
  -H "Content-Type: application/json" \
  -d "{\"job_id\":\"test-norm\",\"session_id\":\"s1\",\"text_in\":\"HELLO\"}"
```

检查项：
- [ ] 返回 200 状态码
- [ ] processor_name 为 "en_normalize"

### 4. 通过 Electron Node 启动测试

```typescript
// 在 Electron Node 中
const status = await semanticRepairServiceManager.getServiceStatus('semantic-repair-en-zh');
console.log('服务状态:', status);

// 启动服务
await semanticRepairServiceManager.startService('semantic-repair-en-zh');

// 等待服务就绪
await new Promise(resolve => setTimeout(resolve, 30000)); // 等待30秒

// 检查状态
const newStatus = await semanticRepairServiceManager.getServiceStatus('semantic-repair-en-zh');
console.log('启动后状态:', newStatus);
```

检查项：
- [ ] 服务可以通过管理器启动
- [ ] 状态正确更新（running: true）
- [ ] PID 正确记录
- [ ] 端口号正确（5015）

---

## 🧪 单元测试

```bash
cd D:\Programs\github\lingua_1\electron_node\services\semantic_repair_en_zh
pytest tests/ -v
```

预期结果：
- [ ] 所有测试通过（15个测试）
- [ ] BaseProcessor 测试通过（5个）
- [ ] ProcessorWrapper 测试通过（5个）
- [ ] Config 测试通过（5个）

---

## 📊 性能测试（可选）

### 并发测试
测试10个并发请求：
```bash
# 使用 PowerShell
1..10 | ForEach-Object -Parallel {
    curl -X POST http://localhost:5015/zh/repair `
      -H "Content-Type: application/json" `
      -d "{\"job_id\":\"test-$_\",\"session_id\":\"s1\",\"text_in\":\"你号\"}"
}
```

检查项：
- [ ] 所有请求都返回响应
- [ ] 无超时错误
- [ ] 响应时间合理（< 5秒）

### 超时测试
测试超时降级：
```bash
# 需要模拟慢推理，可以暂时将 config.py 中的 timeout 设置为 1 秒
```

---

## 🔄 与旧服务对比测试

### 功能对等性测试

对同一输入，比较旧服务和新服务的输出：

**旧方式（3个服务）**：
```bash
# 中文修复
curl -X POST http://localhost:5013/repair \
  -d "{\"job_id\":\"t1\",\"session_id\":\"s1\",\"text_in\":\"你号\",\"lang\":\"zh\"}"

# 英文修复
curl -X POST http://localhost:5011/repair \
  -d "{\"job_id\":\"t2\",\"session_id\":\"s1\",\"text_in\":\"helo\",\"lang\":\"en\"}"

# 英文标准化
curl -X POST http://localhost:5012/normalize \
  -d "{\"job_id\":\"t3\",\"session_id\":\"s1\",\"text_in\":\"HELLO\"}"
```

**新方式（统一服务）**：
```bash
# 中文修复
curl -X POST http://localhost:5015/zh/repair \
  -d "{\"job_id\":\"t1\",\"session_id\":\"s1\",\"text_in\":\"你号\"}"

# 英文修复
curl -X POST http://localhost:5015/en/repair \
  -d "{\"job_id\":\"t2\",\"session_id\":\"s1\",\"text_in\":\"helo\"}"

# 英文标准化
curl -X POST http://localhost:5015/en/normalize \
  -d "{\"job_id\":\"t3\",\"session_id\":\"s1\",\"text_in\":\"HELLO\"}"
```

检查项：
- [ ] 输出结果一致或相似
- [ ] 响应时间可比
- [ ] 决策逻辑相同

---

## 📋 部署决策

根据测试结果，选择部署方式：

### 方案 A：完全替换（推荐）
- 停止并卸载旧的3个服务
- 只使用 `semantic-repair-en-zh`
- 更新所有调用方代码

优点：
- 简化部署和维护
- 减少资源占用
- 统一服务管理

### 方案 B：并行运行（过渡期）
- 保留旧服务
- 同时运行新服务（不同端口）
- 逐步迁移调用方

优点：
- 风险较低
- 可以逐步验证
- 随时回退

### 方案 C：按需选择
- 根据场景选择使用哪个服务
- 轻量场景使用旧服务
- 统一管理场景使用新服务

---

## ✅ 部署完成确认

全部检查项通过后，确认部署完成：

- [ ] 所有检查项已完成
- [ ] 服务运行稳定
- [ ] API 功能正常
- [ ] 文档已更新
- [ ] 团队已通知

---

**状态**: ⏳ 待验证测试  
**下一步**: 运行部署前检查清单中的所有测试项  
**负责人**: ___________  
**完成日期**: ___________
