# 调度服务器配置说明

## 概述

节点端通过 WebSocket 连接到调度服务器。调度服务器地址可以通过配置文件进行配置，适用于生产环境部署。

## 配置文件位置

配置文件位于 Electron 的用户数据目录：
- **Windows**: `%APPDATA%\electron-node\electron-node-config.json`
- **macOS**: `~/Library/Application Support/electron-node/electron-node-config.json`
- **Linux**: `~/.config/electron-node/electron-node-config.json`

## 配置格式

配置文件为 JSON 格式，示例：

```json
{
  "servicePreferences": {
    "rustEnabled": true,
    "nmtEnabled": true,
    "ttsEnabled": true,
    "yourttsEnabled": false
  },
  "scheduler": {
    "url": "ws://scheduler.example.com:5010/ws/node"
  }
}
```

## 配置优先级

调度服务器地址的读取优先级（从高到低）：

1. **配置文件** (`scheduler.url`) - 推荐用于生产环境
2. **环境变量** (`SCHEDULER_URL`) - 用于临时配置或开发环境
3. **默认值** (`ws://localhost:5010/ws/node`) - 仅用于本地开发

## 配置示例

### 本地开发环境

```json
{
  "scheduler": {
    "url": "ws://localhost:5010/ws/node"
  }
}
```

### 生产环境（使用域名）

```json
{
  "scheduler": {
    "url": "wss://scheduler.lingua.example.com/ws/node"
  }
}
```

### 生产环境（使用 IP 地址）

```json
{
  "scheduler": {
    "url": "ws://192.168.1.100:5010/ws/node"
  }
}
```

### 使用 WSS（安全 WebSocket）

如果调度服务器支持 HTTPS/WSS，使用 `wss://` 协议：

```json
{
  "scheduler": {
    "url": "wss://scheduler.example.com/ws/node"
  }
}
```

## 配置步骤

### 方法 1：手动创建配置文件

1. 找到 Electron 用户数据目录（见上方路径）
2. 创建或编辑 `electron-node-config.json` 文件
3. 添加 `scheduler.url` 配置项
4. 重启节点端应用

### 方法 2：使用示例配置文件

1. 复制 `electron-node-config.example.json` 到用户数据目录
2. 重命名为 `electron-node-config.json`
3. 修改 `scheduler.url` 为实际的调度服务器地址
4. 重启节点端应用

## 验证配置

启动节点端后，查看日志输出，应该能看到：

```
调度服务器地址已配置: ws://scheduler.example.com:5010/ws/node
已连接到调度服务器
```

如果连接失败，检查：
1. 配置文件格式是否正确（JSON 格式）
2. 调度服务器地址是否正确
3. 网络连接是否正常
4. 防火墙是否允许连接

## 注意事项

1. **协议选择**：
   - `ws://` - 普通 WebSocket（HTTP）
   - `wss://` - 安全 WebSocket（HTTPS），推荐用于生产环境

2. **端口**：
   - 默认端口为 `5010`
   - 如果使用反向代理（如 Nginx），可能不需要指定端口

3. **路径**：
   - 节点端连接路径固定为 `/ws/node`
   - 不要修改路径，否则无法连接

4. **域名 vs IP**：
   - 生产环境推荐使用域名，便于维护和迁移
   - IP 地址适用于内网部署

5. **配置文件更新**：
   - 修改配置文件后需要重启节点端才能生效
   - 配置文件格式错误会导致使用默认配置

## 故障排查

### 问题：无法连接到调度服务器

**可能原因**：
- 配置文件格式错误
- 调度服务器地址不正确
- 网络连接问题
- 防火墙阻止连接

**解决方法**：
1. 检查配置文件 JSON 格式是否正确
2. 验证调度服务器地址是否可访问
3. 检查网络连接和防火墙设置
4. 查看节点端日志获取详细错误信息

### 问题：配置文件不生效

**可能原因**：
- 配置文件路径不正确
- 配置文件格式错误
- 节点端未重启

**解决方法**：
1. 确认配置文件在正确的用户数据目录
2. 验证 JSON 格式是否正确
3. 重启节点端应用

