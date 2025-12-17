# 平台化模型管理功能集成测试指南

**测试日期**: 2025-12-17  
**测试范围**: 平台化服务包管理系统完整流程测试

---

## 📋 测试前置条件

### 1. 环境准备

#### 必需软件
- Node.js 16+ 
- Python 3.10+（用于 Model Hub）
- 可用的 Model Hub 服务

#### 检查依赖

```bash
cd electron_node/electron-node
npm install
npm run build:main
```

#### 启动 Model Hub

```bash
# 在 central_server/model-hub 目录
cd ../../../central_server/model-hub
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
python src/main.py
```

验证 Model Hub 运行：
```bash
curl http://localhost:5000/
# 应该返回: {"message":"Lingua Model Hub Service v3","version":"3.0.0"}
```

---

## 🧪 测试步骤

### 阶段 1: Model Hub API 测试

#### 测试 1.1: 服务列表 API

```bash
# 测试获取所有服务
curl http://localhost:5000/api/services

# 测试按平台过滤
curl "http://localhost:5000/api/services?platform=windows-x64"

# 测试按服务ID过滤
curl "http://localhost:5000/api/services?service_id=nmt-zh-en"
```

**预期结果**:
- 返回 JSON 格式的服务列表
- 包含 `services` 数组
- 每个服务包含 `service_id`, `name`, `latest_version`, `variants`

#### 测试 1.2: 服务详情 API

```bash
# 测试获取单个服务变体
curl http://localhost:5000/api/services/nmt-zh-en/1.0.0/windows-x64
```

**预期结果**:
- 返回单个服务变体的详细信息
- 包含 `artifact` 和 `signature` 字段

#### 测试 1.3: 服务包下载 API

```bash
# 测试完整下载
curl -o test-service.zip http://localhost:5000/storage/services/nmt-zh-en/1.0.0/windows-x64/service.zip

# 测试断点续传
curl -H "Range: bytes=0-1023" -o test-service-part.zip http://localhost:5000/storage/services/nmt-zh-en/1.0.0/windows-x64/service.zip

# 测试 ETag（应该返回 304 Not Modified）
curl -H "If-None-Match: \"abc123\"" http://localhost:5000/storage/services/nmt-zh-en/1.0.0/windows-x64/service.zip
```

**预期结果**:
- 下载成功，文件大小正确
- Range 请求返回 206 Partial Content
- ETag 匹配时返回 304 Not Modified

---

### 阶段 2: 创建测试服务包

#### 步骤 2.1: 准备测试服务包结构

创建测试目录结构：

```bash
mkdir -p test-service-package
cd test-service-package

# 创建目录结构
mkdir -p app models runtime/python
```

#### 步骤 2.2: 创建 service.json

创建 `service.json` 文件：

```json
{
  "service_id": "test-service",
  "version": "1.0.0",
  "platforms": {
    "windows-x64": {
      "entrypoint": "app/main.py",
      "exec": {
        "type": "argv",
        "program": "runtime/python/python.exe",
        "args": ["app/main.py"],
        "cwd": "."
      },
      "default_port": 5101,
      "files": {
        "requires": ["service.json", "app/main.py"],
        "optional": ["runtime/"]
      }
    }
  },
  "health_check": {
    "type": "http",
    "endpoint": "/health",
    "timeout_ms": 3000,
    "startup_grace_ms": 10000
  },
  "env_schema": {
    "SERVICE_PORT": "int",
    "MODEL_PATH": "string"
  }
}
```

#### 步骤 2.3: 创建测试服务代码

创建 `app/main.py`：

```python
#!/usr/bin/env python3
"""测试服务"""
import os
import sys
from http.server import HTTPServer, BaseHTTPRequestHandler

PORT = int(os.environ.get('SERVICE_PORT', '5101'))

class HealthHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/health':
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(b'{"status":"ok"}')
        else:
            self.send_response(404)
            self.end_headers()

if __name__ == '__main__':
    server = HTTPServer(('127.0.0.1', PORT), HealthHandler)
    print(f'Test service running on port {PORT}')
    server.serve_forever()
```

#### 步骤 2.4: 打包服务包

```bash
# Windows (使用 PowerShell 或 Git Bash)
cd ..
powershell Compress-Archive -Path test-service-package\* -DestinationPath test-service-1.0.0-windows-x64.zip

# Linux/Mac
cd ..
zip -r test-service-1.0.0-windows-x64.zip test-service-package/
```

#### 步骤 2.5: 计算 SHA256 和签名

```bash
# 计算 SHA256
sha256sum test-service-1.0.0-windows-x64.zip  # Linux/Mac
certutil -hashfile test-service-1.0.0-windows-x64.zip SHA256  # Windows

# 签名（需要 Ed25519 私钥，这里省略）
# 实际应该使用签名工具生成签名
```

#### 步骤 2.6: 部署到 Model Hub

将服务包放到 Model Hub 的服务存储目录：

```bash
# 创建目录结构
mkdir -p ../../../central_server/model-hub/models/services/test-service/1.0.0/windows-x64

# 复制服务包
cp test-service-1.0.0-windows-x64.zip ../../../central_server/model-hub/models/services/test-service/1.0.0/windows-x64/service.zip
```

---

### 阶段 3: 节点端集成测试

#### 测试 3.1: 获取可用服务列表

创建测试脚本 `test-integration.ts`：

```typescript
import { ServicePackageManager } from '../main/src/service-package-manager';

async function testGetServices() {
  const manager = new ServicePackageManager('./test-services');
  
  console.log('测试：获取可用服务列表');
  try {
    const services = await manager.getAvailableServices('windows-x64');
    console.log('可用服务:', JSON.stringify(services, null, 2));
    return services.length > 0;
  } catch (error) {
    console.error('获取服务列表失败:', error);
    return false;
  }
}

testGetServices().then(success => {
  console.log('测试结果:', success ? '✅ 通过' : '❌ 失败');
  process.exit(success ? 0 : 1);
});
```

运行测试：

```bash
# 编译 TypeScript
npm run build:main

# 运行测试（需要创建测试运行脚本）
node main/service-package-manager/test-integration.js
```

#### 测试 3.2: 安装服务包

```typescript
async function testInstallService() {
  const manager = new ServicePackageManager('./test-services');
  
  console.log('测试：安装服务包');
  
  let progressCount = 0;
  const progressCallback = (progress: any) => {
    progressCount++;
    console.log(`进度 [${progressCount}]:`, progress);
  };
  
  try {
    await manager.installService('test-service', '1.0.0', progressCallback);
    console.log('✅ 服务包安装成功');
    return true;
  } catch (error) {
    console.error('❌ 服务包安装失败:', error);
    return false;
  }
}
```

#### 测试 3.3: 验证安装结果

```typescript
import { ServiceRegistryManager } from '../main/src/service-registry';
import * as fs from 'fs/promises';
import * as path from 'path';

async function testVerifyInstallation() {
  const servicesDir = './test-services';
  const registryManager = new ServiceRegistryManager(servicesDir);
  await registryManager.loadRegistry();
  
  console.log('测试：验证安装结果');
  
  // 检查 installed.json
  const installed = registryManager.getInstalled('test-service', '1.0.0', 'windows-x64');
  if (!installed) {
    console.error('❌ 服务未在注册表中找到');
    return false;
  }
  console.log('✅ 服务已注册:', installed);
  
  // 检查安装路径
  const installPath = installed.install_path;
  const serviceJsonPath = path.join(installPath, 'service.json');
  
  try {
    await fs.access(serviceJsonPath);
    console.log('✅ service.json 存在:', serviceJsonPath);
  } catch {
    console.error('❌ service.json 不存在:', serviceJsonPath);
    return false;
  }
  
  // 检查必需文件
  const requiredFiles = ['app/main.py'];
  for (const file of requiredFiles) {
    const filePath = path.join(installPath, file);
    try {
      await fs.access(filePath);
      console.log('✅ 文件存在:', filePath);
    } catch {
      console.error('❌ 文件不存在:', filePath);
      return false;
    }
  }
  
  return true;
}
```

#### 测试 3.4: 启动服务

```typescript
import { ServiceRuntimeManager } from '../main/src/service-runtime-manager';

async function testStartService() {
  const servicesDir = './test-services';
  const runtimeManager = new ServiceRuntimeManager(servicesDir);
  
  console.log('测试：启动服务');
  
  try {
    await runtimeManager.startService('test-service');
    console.log('✅ 服务启动成功');
    
    // 等待一小段时间让服务完全启动
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // 检查服务状态
    const status = runtimeManager.getServiceStatus('test-service');
    console.log('服务状态:', status);
    
    if (status?.running) {
      console.log('✅ 服务正在运行');
      console.log('  PID:', status.pid);
      console.log('  Port:', status.port);
      return true;
    } else {
      console.error('❌ 服务未运行');
      return false;
    }
  } catch (error) {
    console.error('❌ 服务启动失败:', error);
    return false;
  }
}
```

#### 测试 3.5: 健康检查

```typescript
import axios from 'axios';

async function testHealthCheck(port: number) {
  console.log('测试：健康检查');
  
  try {
    const response = await axios.get(`http://localhost:${port}/health`, {
      timeout: 3000,
    });
    
    if (response.status === 200) {
      console.log('✅ 健康检查通过:', response.data);
      return true;
    } else {
      console.error('❌ 健康检查失败，状态码:', response.status);
      return false;
    }
  } catch (error: any) {
    console.error('❌ 健康检查失败:', error.message);
    return false;
  }
}
```

#### 测试 3.6: 停止服务

```typescript
async function testStopService() {
  const servicesDir = './test-services';
  const runtimeManager = new ServiceRuntimeManager(servicesDir);
  
  console.log('测试：停止服务');
  
  try {
    await runtimeManager.stopService('test-service');
    console.log('✅ 服务停止成功');
    
    // 等待一小段时间让服务完全停止
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const status = runtimeManager.getServiceStatus('test-service');
    if (!status?.running) {
      console.log('✅ 服务已停止');
      return true;
    } else {
      console.error('❌ 服务仍在运行');
      return false;
    }
  } catch (error) {
    console.error('❌ 服务停止失败:', error);
    return false;
  }
}
```

#### 测试 3.7: 回滚测试

```typescript
async function testRollback() {
  const manager = new ServicePackageManager('./test-services');
  
  console.log('测试：服务回滚');
  
  try {
    await manager.rollbackService('test-service');
    console.log('✅ 服务回滚成功');
    return true;
  } catch (error: any) {
    if (error.message.includes('No previous version')) {
      console.log('ℹ️  没有上一个版本可回滚（这是正常的，因为只安装了一个版本）');
      return true;
    } else {
      console.error('❌ 服务回滚失败:', error);
      return false;
    }
  }
}
```

---

### 阶段 4: 完整流程测试脚本

创建完整的集成测试脚本 `integration-test.ts`：

```typescript
import { ServicePackageManager } from '../main/src/service-package-manager';
import { ServiceRuntimeManager } from '../main/src/service-runtime-manager';
import { ServiceRegistryManager } from '../main/src/service-registry';
import axios from 'axios';
import * as fs from 'fs/promises';
import * as path from 'path';

const SERVICES_DIR = './test-services';
const TEST_SERVICE_ID = 'test-service';
const TEST_VERSION = '1.0.0';
const TEST_PLATFORM = 'windows-x64';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

const results: TestResult[] = [];

function recordResult(name: string, passed: boolean, error?: string) {
  results.push({ name, passed, error });
  console.log(`${passed ? '✅' : '❌'} ${name}${error ? `: ${error}` : ''}`);
}

async function main() {
  console.log('='.repeat(60));
  console.log('平台化模型管理功能集成测试');
  console.log('='.repeat(60));
  console.log();

  // 清理测试目录
  try {
    await fs.rm(SERVICES_DIR, { recursive: true, force: true });
    console.log('清理测试目录...');
  } catch (error) {
    // 忽略错误
  }

  const packageManager = new ServicePackageManager(SERVICES_DIR);
  const runtimeManager = new ServiceRuntimeManager(SERVICES_DIR);

  // 测试 1: 获取服务列表
  try {
    const services = await packageManager.getAvailableServices(TEST_PLATFORM);
    recordResult('获取服务列表', services.length > 0);
  } catch (error: any) {
    recordResult('获取服务列表', false, error.message);
  }

  // 测试 2: 安装服务包
  try {
    await packageManager.installService(TEST_SERVICE_ID, TEST_VERSION);
    recordResult('安装服务包', true);
  } catch (error: any) {
    recordResult('安装服务包', false, error.message);
    process.exit(1); // 如果安装失败，退出
  }

  // 测试 3: 验证安装
  try {
    const registryManager = new ServiceRegistryManager(SERVICES_DIR);
    await registryManager.loadRegistry();
    const installed = registryManager.getInstalled(TEST_SERVICE_ID, TEST_VERSION, TEST_PLATFORM);
    recordResult('验证安装结果', installed !== null);
  } catch (error: any) {
    recordResult('验证安装结果', false, error.message);
  }

  // 测试 4: 启动服务
  try {
    await runtimeManager.startService(TEST_SERVICE_ID);
    await new Promise(resolve => setTimeout(resolve, 2000));
    const status = runtimeManager.getServiceStatus(TEST_SERVICE_ID);
    recordResult('启动服务', status?.running === true);
  } catch (error: any) {
    recordResult('启动服务', false, error.message);
  }

  // 测试 5: 健康检查
  try {
    const status = runtimeManager.getServiceStatus(TEST_SERVICE_ID);
    if (status?.port) {
      const response = await axios.get(`http://localhost:${status.port}/health`, { timeout: 3000 });
      recordResult('健康检查', response.status === 200);
    } else {
      recordResult('健康检查', false, '端口未分配');
    }
  } catch (error: any) {
    recordResult('健康检查', false, error.message);
  }

  // 测试 6: 停止服务
  try {
    await runtimeManager.stopService(TEST_SERVICE_ID);
    await new Promise(resolve => setTimeout(resolve, 1000));
    const status = runtimeManager.getServiceStatus(TEST_SERVICE_ID);
    recordResult('停止服务', status?.running === false);
  } catch (error: any) {
    recordResult('停止服务', false, error.message);
  }

  // 打印测试结果
  console.log();
  console.log('='.repeat(60));
  console.log('测试结果汇总');
  console.log('='.repeat(60));
  
  const passed = results.filter(r => r.passed).length;
  const total = results.length;
  
  results.forEach(result => {
    console.log(`${result.passed ? '✅' : '❌'} ${result.name}`);
    if (result.error) {
      console.log(`   错误: ${result.error}`);
    }
  });
  
  console.log();
  console.log(`总计: ${passed}/${total} 通过`);
  console.log('='.repeat(60));
  
  process.exit(passed === total ? 0 : 1);
}

main().catch(error => {
  console.error('测试执行失败:', error);
  process.exit(1);
});
```

---

## 🚀 快速测试脚本

创建一个简单的测试运行脚本 `run-integration-test.sh`（Linux/Mac）或 `run-integration-test.ps1`（Windows）：

### PowerShell 版本

```powershell
# run-integration-test.ps1
Write-Host "开始集成测试..." -ForegroundColor Green

# 编译
Write-Host "编译 TypeScript..." -ForegroundColor Yellow
npm run build:main

if ($LASTEXITCODE -ne 0) {
    Write-Host "编译失败!" -ForegroundColor Red
    exit 1
}

# 运行测试
Write-Host "运行集成测试..." -ForegroundColor Yellow
node main/service-package-manager/integration-test.js

exit $LASTEXITCODE
```

### Bash 版本

```bash
#!/bin/bash
# run-integration-test.sh

echo "开始集成测试..."

# 编译
echo "编译 TypeScript..."
npm run build:main

if [ $? -ne 0 ]; then
    echo "编译失败!"
    exit 1
fi

# 运行测试
echo "运行集成测试..."
node main/service-package-manager/integration-test.js

exit $?
```

---

## 📊 预期测试结果

### 成功场景

所有测试应该通过：
- ✅ 获取服务列表
- ✅ 安装服务包
- ✅ 验证安装结果
- ✅ 启动服务
- ✅ 健康检查
- ✅ 停止服务

### 失败场景测试

也可以测试以下失败场景：

1. **安装不存在的服务** - 应该抛出错误
2. **安装已存在的服务** - 应该跳过或报错
3. **SHA256 校验失败** - 应该拒绝安装
4. **签名验证失败** - 应该拒绝安装（如果启用）
5. **端口被占用** - 应该自动选择其他端口

---

## 🔍 调试技巧

### 查看日志

```bash
# 查看节点端日志
tail -f logs/electron-main.log

# 查看 Model Hub 日志
tail -f ../../../central_server/model-hub/logs/model-hub_*.log
```

### 检查文件系统

```bash
# 检查服务安装目录
ls -la test-services/test-service/versions/

# 检查注册表
cat test-services/registry/installed.json
cat test-services/registry/current.json
```

### 使用调试器

在 VS Code 中设置断点，使用调试配置运行测试。

---

## ✅ 测试检查清单

- [ ] Model Hub 服务运行正常
- [ ] 测试服务包已创建并部署到 Model Hub
- [ ] 服务包包含有效的 service.json
- [ ] 服务包 SHA256 正确
- [ ] 节点端代码已编译
- [ ] 所有依赖已安装
- [ ] 测试目录权限正确
- [ ] 端口可用（5101 等）

---

**测试完成日期**: ___________  
**测试结果**: ✅ / ❌  
**备注**: ___________

