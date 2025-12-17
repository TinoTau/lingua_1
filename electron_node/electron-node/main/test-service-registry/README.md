# 测试服务注册表

这个目录包含用于测试的节点端服务注册表文件，模拟所有服务都已安装的情况。

## 文件说明

- `installed.json`: 已安装服务列表，包含所有4个服务的安装信息
- `current.json`: 当前激活的服务列表，所有服务都已激活

## 包含的服务

根据 `central_server/model-hub/models/services/services_index.json`，包含以下服务：

1. **nmt-m2m100** (v1.0.0, windows-x64)
   - 安装时间: 2024-12-18T01:12:44.265Z
   - 安装路径: `{SERVICES_DIR}/nmt-m2m100/versions/1.0.0/windows-x64`

2. **node-inference** (v1.0.0, windows-x64)
   - 安装时间: 2024-12-18T01:13:00.219Z
   - 安装路径: `{SERVICES_DIR}/node-inference/versions/1.0.0/windows-x64`

3. **piper-tts** (v1.0.0, windows-x64)
   - 安装时间: 2024-12-18T01:13:00.336Z
   - 安装路径: `{SERVICES_DIR}/piper-tts/versions/1.0.0/windows-x64`

4. **your-tts** (v1.0.0, windows-x64)
   - 安装时间: 2024-12-18T01:13:03.916Z
   - 安装路径: `{SERVICES_DIR}/your-tts/versions/1.0.0/windows-x64`

## 使用方法

### 方法1: 手动复制到用户数据目录

1. 找到 Electron 应用的 `userData` 目录（通常在 `%APPDATA%/electron-node` 或类似位置）
2. 创建 `services/registry` 目录（如果不存在）
3. 将 `installed.json` 和 `current.json` 复制到 `services/registry/` 目录
4. 将文件中的 `{SERVICES_DIR}` 替换为实际的 `services` 目录路径（例如：`C:\Users\YourName\AppData\Roaming\electron-node\services`）

### 方法2: 使用脚本自动部署

可以创建一个脚本来自动部署这些文件：

```javascript
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const userData = app.getPath('userData');
const servicesDir = path.join(userData, 'services');
const registryDir = path.join(servicesDir, 'registry');

// 确保目录存在
fs.mkdirSync(registryDir, { recursive: true });

// 读取测试文件
const installedJson = fs.readFileSync(path.join(__dirname, 'installed.json'), 'utf-8');
const currentJson = fs.readFileSync(path.join(__dirname, 'current.json'), 'utf-8');

// 替换路径占位符
const installedContent = installedJson.replace(/{SERVICES_DIR}/g, servicesDir);
const currentContent = currentJson.replace(/{SERVICES_DIR}/g, servicesDir);

// 写入到实际位置
fs.writeFileSync(path.join(registryDir, 'installed.json'), installedContent);
fs.writeFileSync(path.join(registryDir, 'current.json'), currentContent);

console.log('测试服务注册表已部署到:', registryDir);
```

## 注意事项

1. **路径占位符**: 文件中的 `{SERVICES_DIR}` 需要替换为实际的 services 目录路径
2. **文件路径**: 确保安装路径中的目录结构存在（即使目录为空也可以用于测试）
3. **时间戳**: 安装时间和激活时间使用了 `services_index.json` 中的 `updated_at` 时间戳
4. **平台**: 当前只包含 `windows-x64` 平台的服务，如需其他平台，请参考 `services_index.json` 添加

## 测试场景

使用这些文件可以测试：

- ✅ 节点端服务管理页面显示已安装的服务
- ✅ 服务注册表加载和读取功能
- ✅ 服务列表查询和过滤
- ✅ 服务卸载功能（从注册表中删除）
- ✅ 心跳消息中包含已安装服务信息
- ✅ 调度服务器统计服务使用情况

