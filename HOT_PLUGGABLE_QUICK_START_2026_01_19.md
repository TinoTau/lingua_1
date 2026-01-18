# 热插拔服务架构 - 快速开始指南

**日期**: 2026-01-19  
**状态**: ✅ 已实现热插拔架构

---

## 🎯 现在可以做什么？

### ✅ 零代码添加新服务

用户从官网下载新服务后：
1. 解压到 `electron_node/services/` 目录
2. 重启 Electron 应用
3. **服务自动显示，立即可用！**

**不再需要**:
- ❌ 修改 TypeScript 类型定义
- ❌ 修改界面显示名映射
- ❌ 修改配置接口
- ❌ 重新编译代码

---

## 📋 添加新服务的步骤

### 步骤1: 准备服务包

**目录结构**:
```
electron_node/services/your_new_service/
├── service.json          ← 服务元数据（必须）
├── service.py            ← 服务代码
├── requirements.txt      ← Python 依赖
├── config.py             ← 配置文件
├── models/               ← 模型目录（如需要）
└── README.md             ← 文档
```

### 步骤2: 编写 service.json

**必填字段**:
```json
{
  "service_id": "your-new-service",
  "name": "Your New Service",
  "name_zh": "您的新服务",
  "type": "semantic-repair",
  "port": 5020,
  "enabled": true,
  "version": "1.0.0"
}
```

**关键字段说明**:

| 字段 | 说明 | 示例 |
|------|------|------|
| `service_id` | 服务唯一标识（kebab-case） | `"your-new-service"` |
| `name` | 英文名称 | `"Your New Service"` |
| `name_zh` | 中文名称（**界面显示**） | `"您的新服务"` |
| `type` | 服务类型（**决定分类**） | `"semantic-repair"` |
| `port` | 服务端口 | `5020` |
| `enabled` | 是否默认启用 | `true` |

**可选字段**:
```json
{
  "deprecated": false,
  "deprecated_reason": "",
  "languages": ["en", "zh"],
  "gpu_required": true,
  "vram_estimate": 2048,
  "startup_command": "python",
  "startup_args": ["service.py"]
}
```

---

### 步骤3: 注册服务到 installed.json

**文件**: `electron_node/services/installed.json`

**添加条目**:
```json
{
  "your-new-service": {
    "1.0.0::windows-x64": {
      "service_id": "your-new-service",
      "version": "1.0.0",
      "platform": "windows-x64",
      "installed_at": "2026-01-19T12:00:00.000Z",
      "install_path": "D:/Programs/github/lingua_1/electron_node/services/your_new_service",
      "size_bytes": 1000000
    }
  }
}
```

**注意**: 
- `install_path` 必须是绝对路径
- `service_id` 必须与 service.json 中的一致

---

### 步骤4: 重启 Electron 应用

```bash
# 关闭节点端，然后重新启动
```

### 步骤5: 验证

1. **打开服务管理界面**
   - ✅ 应该看到 "您的新服务"（从 name_zh 读取）
   - ✅ 服务卡片自动显示
   - ✅ 可以点击开关启动/停止

2. **打开浏览器控制台（F12）**
   ```javascript
   // 应该看到：
   Loaded service metadata: {
     "your-new-service": {
       name_zh: "您的新服务",
       type: "semantic-repair",
       ...
     }
   }
   
   Discovered semantic repair services: [
     "semantic-repair-zh",
     "semantic-repair-en",
     "en-normalize",
     "semantic-repair-en-zh",
     "your-new-service"  // ✅ 新服务被发现
   ]
   ```

---

## 🧪 测试新架构

### 测试1: 添加虚拟服务

创建一个虚拟服务来测试热插拔功能：

```bash
# 1. 创建服务目录
mkdir electron_node/services/test_hotplug

# 2. 创建 service.json
cat > electron_node/services/test_hotplug/service.json << 'EOF'
{
  "service_id": "test-hotplug-001",
  "name": "Hot Plug Test Service",
  "name_zh": "热插拔测试服务",
  "type": "semantic-repair",
  "port": 5999,
  "enabled": true,
  "deprecated": false,
  "languages": ["en"]
}
EOF
```

**在 installed.json 中添加**:
```json
"test-hotplug-001": {
  "1.0.0::windows-x64": {
    "service_id": "test-hotplug-001",
    "version": "1.0.0",
    "platform": "windows-x64",
    "installed_at": "2026-01-19T12:00:00.000Z",
    "install_path": "D:/Programs/github/lingua_1/electron_node/services/test_hotplug",
    "size_bytes": 1000
  }
}
```

**重启节点端后**:
- ✅ 应该看到 "热插拔测试服务"
- ✅ 显示在服务管理界面
- ✅ 完全零代码修改

---

## 📊 service.json 完整模板

### 最小模板（必填字段）

```json
{
  "service_id": "my-service",
  "name": "My Service",
  "name_zh": "我的服务",
  "type": "semantic-repair",
  "port": 5020,
  "enabled": true,
  "version": "1.0.0"
}
```

### 完整模板（所有字段）

```json
{
  "service_id": "my-service",
  "name": "My Awesome Service",
  "name_zh": "我的超棒服务",
  "description": "Service description in English",
  "description_zh": "服务的中文描述",
  "version": "1.0.0",
  "type": "semantic-repair",
  "language": "multi",
  "languages": ["zh", "en", "fr"],
  "port": 5020,
  "enabled": true,
  "deprecated": false,
  "deprecated_reason": "",
  "replaces": ["old-service-1", "old-service-2"],
  "gpu_required": true,
  "vram_estimate": 2048,
  "max_concurrency": 2,
  "startup_command": "python",
  "startup_args": ["service.py"],
  "health_check": {
    "endpoint": "/health",
    "timeout_ms": 5000
  },
  "model": {
    "name": "model-name",
    "type": "llm",
    "quantization": "int4",
    "path": "models"
  },
  "features": {
    "feature1": true,
    "feature2": false
  },
  "supported_operations": {
    "zh": ["repair"],
    "en": ["repair", "normalize"]
  },
  "endpoints": [
    {
      "path": "/repair",
      "method": "POST",
      "language": "multi",
      "description": "Repair text",
      "description_zh": "修复文本"
    }
  ]
}
```

---

## 🎯 支持的服务类型

### 当前支持的 type 值

| type | ServiceType 枚举 | 说明 |
|------|----------------|------|
| `"asr"` | `ServiceType.ASR` | 语音识别服务 |
| `"nmt"` | `ServiceType.NMT` | 翻译服务 |
| `"tts"` | `ServiceType.TTS` | 语音合成服务 |
| `"tone"` | `ServiceType.TONE` | 音色服务 |
| `"semantic-repair"` | `ServiceType.SEMANTIC` | 语义修复服务 |

### 添加新类型

如果需要支持新的服务类型：

**修改**: `node-agent-services.ts`

```typescript
const serviceTypeEnumMap: Record<string, ServiceType> = {
  'asr': ServiceType.ASR,
  'nmt': ServiceType.NMT,
  'tts': ServiceType.TTS,
  'tone': ServiceType.TONE,
  'semantic-repair': ServiceType.SEMANTIC,
  'your-new-type': ServiceType.YOUR_NEW_TYPE,  // 添加新类型
};
```

**注意**: 还需要在 `messages.ts` 中定义 `ServiceType.YOUR_NEW_TYPE` 枚举值

---

## 🔍 调试技巧

### 检查服务是否被发现

**浏览器控制台（F12）**:
```javascript
// 查看服务元数据
Loaded service metadata: {...}

// 查看发现的服务
Discovered semantic repair services: [...]

// 查看服务状态
Semantic repair services: [...]
```

### 检查 service.json 是否正确

**常见问题**:
1. ❌ `service_id` 拼写错误
2. ❌ `type` 字段不正确（必须是 `"semantic-repair"`）
3. ❌ JSON 格式错误（多余逗号、引号不匹配等）
4. ❌ `install_path` 在 installed.json 中不正确

**验证方法**:
```bash
# 验证 JSON 格式
python -m json.tool service.json

# 检查文件路径
ls -la electron_node/services/your_service/service.json
```

---

## 📚 示例：添加法语语义修复服务

### 完整示例

**1. 创建服务目录**:
```bash
mkdir electron_node/services/semantic_repair_fr
```

**2. 创建 service.json**:
```json
{
  "service_id": "semantic-repair-fr",
  "name": "Semantic Repair Service - French",
  "name_zh": "法语语义修复服务",
  "version": "1.0.0",
  "type": "semantic-repair",
  "language": "fr",
  "languages": ["fr"],
  "port": 5016,
  "enabled": true,
  "gpu_required": true,
  "vram_estimate": 2048,
  "startup_command": "python",
  "startup_args": ["service.py"],
  "health_check": {
    "endpoint": "/health",
    "timeout_ms": 5000
  }
}
```

**3. 创建服务代码** (`service.py`):
```python
from fastapi import FastAPI
app = FastAPI()

@app.post("/repair")
async def repair(request: dict):
    return {
        "decision": "PASS",
        "text_out": request.get("text_in"),
        "confidence": 1.0
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=5016)
```

**4. 注册到 installed.json**:
```json
"semantic-repair-fr": {
  "1.0.0::windows-x64": {
    "service_id": "semantic-repair-fr",
    "version": "1.0.0",
    "platform": "windows-x64",
    "installed_at": "2026-01-19T12:00:00.000Z",
    "install_path": "D:/Programs/github/lingua_1/electron_node/services/semantic_repair_fr",
    "size_bytes": 50000
  }
}
```

**5. 重启节点端**

**6. 验证**:
- ✅ 界面显示 "法语语义修复服务"
- ✅ 可以启动/停止
- ✅ 心跳上报 `semantic_languages: ["fr"]`
- ✅ 完全零代码修改！

---

## 🚀 立即体验

### 重新编译并测试

```bash
# 1. 重新编译
cd D:\Programs\github\lingua_1\electron_node\electron-node
npm run build

# 2. 启动节点端（在另一个终端）
# 启动 Electron 应用

# 3. 观察效果
# - 打开服务管理界面
# - 应该看到所有 semantic-repair 服务
# - 每个服务显示正确的中文名称
# - 弃用服务标记 "(已弃用)"
```

### 验证服务发现

**浏览器控制台输出（F12）**:
```javascript
Loaded service metadata: {
  "semantic-repair-zh": {...},
  "semantic-repair-en": {...},
  "en-normalize": {...},
  "semantic-repair-en-zh": {...}  // ✅ 新服务
}

Discovered semantic repair services: [
  "semantic-repair-zh",
  "semantic-repair-en",
  "en-normalize",
  "semantic-repair-en-zh"  // ✅ 自动发现
]
```

---

## ✅ 重构成果

### 修改的文件

| 文件 | 改动 | 目的 |
|------|------|------|
| **semantic-repair-service-manager/index.ts** | 类型 + 发现逻辑 | 动态发现服务 |
| **node-agent-services.ts** | 从 JSON 读取类型 | 动态类型映射 |
| **runtime-handlers.ts** | 新增元数据API | 提供元数据 |
| **preload.ts** | 放宽类型 + 新API | IPC 接口 |
| **ServiceManagement.tsx** | 动态渲染 | 界面显示 |

**总计**: 5个文件

### 代码改进

- **TypeScript 类型**: 联合类型 → `string`（灵活）
- **服务发现**: 硬编码列表 → 动态扫描（自动）
- **显示名**: 硬编码映射 → 从 JSON 读取（动态）
- **类型映射**: 硬编码映射 → 从 JSON 读取（动态）

---

## 🎉 核心优势

### 1. 真正的热插拔 ⭐⭐⭐

```
下载服务 → 解压 → 重启 → 自动显示
```

**零代码修改，完全配置驱动**

### 2. 用户友好 ⭐⭐⭐

- 服务名称自动显示为中文（`name_zh`）
- 弃用服务自动标记
- 端口、语言等信息自动获取

### 3. 开发者友好 ⭐⭐

- 添加服务不需要修改现有代码
- TypeScript 编译永不失败
- 维护成本大幅降低

### 4. 符合设计理念 ⭐⭐⭐

> "让用户从官网下载新的服务进行使用，并且支持热插拔启动服务"

✅ **现在真正实现了！**

---

## 📚 相关文档

- [HOT_PLUGGABLE_SERVICE_ARCHITECTURE_ANALYSIS_2026_01_19.md](./HOT_PLUGGABLE_SERVICE_ARCHITECTURE_ANALYSIS_2026_01_19.md) - 架构分析
- [HOT_PLUGGABLE_REFACTOR_COMPLETE_2026_01_19.md](./HOT_PLUGGABLE_REFACTOR_COMPLETE_2026_01_19.md) - 重构完成报告
- [UNIFIED_SERVICE_COMPLETE_2026_01_19.md](./UNIFIED_SERVICE_COMPLETE_2026_01_19.md) - 统一服务总结

---

**完成时间**: 2026-01-19  
**状态**: ✅ **热插拔架构已实现，请重新编译并测试！**
