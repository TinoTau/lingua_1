# Web 客户端快速开始指南

## 启动方式

### 方式 1：使用启动脚本（推荐）

从项目根目录运行：

```powershell
.\scripts\start_web_client.ps1
```

启动脚本会自动：
- ✅ 检查 Node.js 和 npm 是否安装
- ✅ 检查并安装依赖（如果未安装）
- ✅ 检查端口 9001 是否被占用
- ✅ 创建日志目录并配置日志轮转（5MB）
- ✅ 启动开发服务器

### 方式 2：手动启动

```bash
cd webapp/web-client
npm install
npm run dev
```

## 访问地址

开发服务器启动后，访问：

```
http://localhost:9001
```

## 配置

### 调度服务器地址

默认调度服务器地址：`ws://localhost:5010/ws/session`

可以通过环境变量修改：

```powershell
$env:SCHEDULER_URL = "ws://192.168.1.100:5010/ws/session"
.\scripts\start_web_client.ps1
```

### 日志文件

日志文件位置：`webapp/web-client/logs/web-client.log`

- 日志文件大小限制：5MB
- 超过限制后自动轮转，添加时间戳后缀
- 日志包含时间戳

## 运行测试

```bash
cd webapp/web-client
npm test
```

运行测试查看测试结果

## 构建生产版本

```bash
cd webapp/web-client
npm run build
```

构建输出在 `webapp/web-client/dist/` 目录。

## 故障排除

### 端口被占用

如果端口 9001 被占用，启动脚本会：
1. 尝试自动终止占用端口的 Node.js 进程
2. 如果无法终止，会提示手动处理

### 依赖安装失败

```bash
cd webapp/web-client
rm -rf node_modules package-lock.json
npm install
```

### 调度服务器连接失败

1. 确保调度服务器已启动（`.\scripts\start_scheduler.ps1`）
2. 检查调度服务器地址是否正确
3. 检查防火墙设置

## 相关文档

- **项目说明**: `webapp/README.md`
- **文档索引**: `webapp/docs/README.md`
- **Web客户端文档**: `webapp/web-client/docs/README.md`
