# 快速开始指南

## 前置要求

### 开发环境

- **Rust**: 1.70+ (用于调度服务器和节点推理服务)
- **Node.js**: 18+ (用于 Electron 和移动端)
- **Python**: 3.10+ (用于模型库服务)
- **CUDA**: 12.1+ (可选，用于 GPU 加速)

### 系统要求

- **操作系统**: Windows 10/11, macOS, Linux
- **内存**: 8GB+ (推荐 16GB)
- **存储**: 10GB+ (用于模型文件)

## 安装步骤

### 1. 克隆项目

```bash
git clone <repository-url>
cd lingua_1
```

### 2. 启动模型库服务

```powershell
cd model-hub
python -m venv venv
.\venv\Scripts\activate  # Windows
# source venv/bin/activate  # Linux/macOS
pip install -r requirements.txt
python src/main.py
```

服务将在 `http://localhost:5000` 启动。

### 3. 启动调度服务器

```powershell
cd scheduler
cargo build --release
cargo run --release
```

服务将在 `http://localhost:8080` 启动。

### 4. 启动 API Gateway（可选）

如果需要对外提供 API 服务：

```powershell
cd api-gateway
cargo build --release
cargo run --release
```

服务将在 `http://localhost:8081` 启动。

**注意**: API Gateway 需要先启动调度服务器。

### 5. 启动 Electron Node 客户端

```powershell
cd electron-node
npm install
npm run build
npm start
```

### 6. 启动移动端客户端

```powershell
cd mobile-app
npm install
npm start
```

## 一键启动（Windows）

使用提供的 PowerShell 脚本：

```powershell
.\scripts\start_all.ps1
```

这将启动所有服务。

## 配置

### 调度服务器配置

编辑 `scheduler/config.toml`:

```toml
[server]
port = 8080
host = "0.0.0.0"

[model_hub]
base_url = "http://localhost:5000"
storage_path = "./models"
```

### API Gateway 配置

编辑 `api-gateway/config.toml`:

```toml
[server]
port = 8081
host = "0.0.0.0"

[scheduler]
url = "ws://localhost:8080/ws/session"

[rate_limit]
default_max_rps = 100
default_max_sessions = 10
```

### Electron Node 客户端配置

设置环境变量：

```powershell
$env:SCHEDULER_URL = "ws://localhost:8080/ws/node"
$env:MODEL_HUB_URL = "http://localhost:5000"
```

### 移动端客户端配置

在 `mobile-app/App.tsx` 中修改：

```typescript
const schedulerUrl = 'ws://your-scheduler-url:8080/ws/session';
```

## 使用流程

### 1. 启动节点

1. 启动 Electron Node 客户端
2. 等待连接到调度服务器
3. 安装所需的模型（ASR/NMT/TTS）
4. （可选）启用需要的功能模块（音色识别、语速控制等）

### 2. 启动移动端

1. 启动移动端应用
2. （可选）输入 6 位配对码连接到指定节点
3. 点击"连接"按钮

### 3. 开始翻译

1. 按住"按住说话"按钮开始录音
2. 说话时，系统会自动检测语音段
3. 点击"结束本句"按钮手动截断
4. （可选）选择需要的功能（音色识别、语速控制等）
5. 等待翻译结果并播放

### 4. 管理功能模块（可选）

在 Electron Node 客户端中：

1. 打开"功能模块管理"界面
2. 启用/禁用需要的可选功能模块
3. 模块状态会实时更新，无需重启服务

支持的功能模块：
- 音色识别 (Speaker Identification)
- 音色生成 (Voice Cloning)
- 语速识别 (Speech Rate Detection)
- 语速控制 (Speech Rate Control)
- 情感分析 (Emotion Detection)
- 个性化适配 (Persona Adaptation)

## 故障排除

### 调度服务器无法启动

- 检查端口 8080 是否被占用
- 检查 Rust 是否正确安装
- 查看日志输出

### 节点无法连接

- 检查调度服务器是否运行
- 检查 WebSocket URL 是否正确
- 检查防火墙设置

### 模型下载失败

- 检查模型库服务是否运行
- 检查网络连接
- 检查存储空间

## 使用 API Gateway（对外 API）

### 创建租户

目前租户管理使用内存存储，生产环境建议使用数据库。

### REST API 示例

```bash
curl -X POST http://localhost:8081/v1/speech/translate \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -F "audio=@audio.wav" \
  -F "src_lang=zh" \
  -F "tgt_lang=en"
```

### WebSocket API 示例

```javascript
const ws = new WebSocket('ws://localhost:8081/v1/stream', {
  headers: {
    'Authorization': 'Bearer YOUR_API_KEY'
  }
});

ws.onopen = () => {
  ws.send(JSON.stringify({
    type: 'start',
    src_lang: 'zh',
    tgt_lang: 'en'
  }));
};
```

详细 API 文档请参考 [对外开放 API 文档](./PUBLIC_API.md)

## 运行测试

### 运行单元测试

```bash
cd scheduler
cargo test --test stage1_1
```

这将运行阶段一.1的所有单元测试（46个测试）。

### 查看测试报告

```bash
# Windows
type scheduler\tests\stage1.1\TEST_REPORT.md

# Linux/macOS
cat scheduler/tests/stage1.1/TEST_REPORT.md
```

## 下一步

- 查看 [架构文档](./ARCHITECTURE.md) 了解系统设计
- 查看 [模块化功能设计](./MODULAR_FEATURES.md) 了解可选功能模块（文档开头包含快速参考）
- 查看 [协议规范](./PROTOCOLS.md) 了解 WebSocket 消息协议
- 查看 [对外开放 API 文档](./PUBLIC_API.md) 了解对外 API 设计
- 运行测试验证功能：`cargo test --test stage1_1`
- 查看测试报告了解测试覆盖情况
- 参与开发，查看 [开发指南](./DEVELOPMENT.md)（待完善）

