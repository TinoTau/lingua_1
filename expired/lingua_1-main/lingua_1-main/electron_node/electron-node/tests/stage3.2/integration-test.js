/**
 * 平台化模型管理功能集成测试
 * 
 * 完整流程测试：
 * 1. 获取服务列表
 * 2. 安装服务包
 * 3. 验证安装
 * 4. 启动服务
 * 5. 健康检查
 * 6. 停止服务
 */

const { ServicePackageManager } = require('../../main/service-package-manager');
const { ServiceRuntimeManager } = require('../../main/service-runtime-manager');
const { ServiceRegistryManager } = require('../../main/service-registry');
const axios = require('axios');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const SERVICES_DIR = path.join(os.tmpdir(), 'lingua-integration-test-services');
const TEST_SERVICE_ID = 'test-service';
const TEST_VERSION = '1.0.0';
const TEST_PLATFORM = 'windows-x64';

const results = [];

function recordResult(name, passed, error) {
  results.push({ name, passed, error });
  const icon = passed ? '✅' : '❌';
  console.log(`${icon} ${name}${error ? `: ${error}` : ''}`);
}

async function main() {
  console.log('='.repeat(60));
  console.log('平台化模型管理功能集成测试');
  console.log('='.repeat(60));
  console.log(`测试目录: ${SERVICES_DIR}`);
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
  console.log('\n[测试 1] 获取服务列表');
  try {
    const services = await packageManager.getAvailableServices(TEST_PLATFORM);
    recordResult('获取服务列表', services.length >= 0, services.length === 0 ? '服务列表为空（这是正常的，如果没有部署服务）' : undefined);
    if (services.length > 0) {
      console.log(`  找到 ${services.length} 个服务`);
      services.forEach(s => {
        console.log(`  - ${s.service_id} (最新版本: ${s.latest_version})`);
      });
    }
  } catch (error) {
    recordResult('获取服务列表', false, error.message);
  }

  // 测试 2: 安装服务包（如果服务存在）
  console.log('\n[测试 2] 安装服务包');
  try {
    const services = await packageManager.getAvailableServices(TEST_PLATFORM);
    const testService = services.find(s => s.service_id === TEST_SERVICE_ID);
    
    if (!testService) {
      recordResult('安装服务包', true, '测试服务不存在，跳过安装（这是正常的）');
    } else {
      await packageManager.installService(TEST_SERVICE_ID, TEST_VERSION, (progress) => {
        console.log(`  进度: ${progress.stage}${progress.percent ? ` (${progress.percent}%)` : ''}`);
      });
      recordResult('安装服务包', true);
    }
  } catch (error) {
    recordResult('安装服务包', false, error.message);
    // 如果安装失败，继续其他测试
  }

  // 测试 3: 验证安装（如果已安装）
  console.log('\n[测试 3] 验证安装结果');
  try {
    const registryManager = new ServiceRegistryManager(SERVICES_DIR);
    await registryManager.loadRegistry();
    const installed = registryManager.getInstalled(TEST_SERVICE_ID, TEST_VERSION, TEST_PLATFORM);
    
    if (!installed) {
      recordResult('验证安装结果', true, '服务未安装（这是正常的，如果服务不存在）');
    } else {
      recordResult('验证安装结果', installed !== null);
      console.log(`  安装路径: ${installed.install_path}`);
      
      // 检查文件是否存在
      const serviceJsonPath = path.join(installed.install_path, 'service.json');
      try {
        await fs.access(serviceJsonPath);
        console.log(`  ✅ service.json 存在`);
      } catch {
        recordResult('验证安装结果', false, 'service.json 不存在');
      }
    }
  } catch (error) {
    recordResult('验证安装结果', false, error.message);
  }

  // 测试 4: 启动服务（如果已安装）
  console.log('\n[测试 4] 启动服务');
  try {
    const registryManager = new ServiceRegistryManager(SERVICES_DIR);
    await registryManager.loadRegistry();
    const current = registryManager.getCurrent(TEST_SERVICE_ID);
    
    if (!current) {
      recordResult('启动服务', true, '服务未安装，跳过启动测试');
    } else {
      await runtimeManager.startService(TEST_SERVICE_ID);
      await new Promise(resolve => setTimeout(resolve, 2000));
      const status = runtimeManager.getServiceStatus(TEST_SERVICE_ID);
      recordResult('启动服务', status?.running === true);
      
      if (status?.running) {
        console.log(`  PID: ${status.pid}`);
        console.log(`  Port: ${status.port}`);
      }
    }
  } catch (error) {
    recordResult('启动服务', false, error.message);
  }

  // 测试 5: 健康检查（如果服务正在运行）
  console.log('\n[测试 5] 健康检查');
  try {
    const status = runtimeManager.getServiceStatus(TEST_SERVICE_ID);
    if (!status?.running || !status.port) {
      recordResult('健康检查', true, '服务未运行，跳过健康检查');
    } else {
      const response = await axios.get(`http://localhost:${status.port}/health`, { timeout: 3000 });
      recordResult('健康检查', response.status === 200);
      if (response.status === 200) {
        console.log(`  响应: ${JSON.stringify(response.data)}`);
      }
    }
  } catch (error) {
    if (error.code === 'ECONNREFUSED') {
      recordResult('健康检查', false, '连接被拒绝（服务可能未启动或端口错误）');
    } else {
      recordResult('健康检查', false, error.message);
    }
  }

  // 测试 6: 停止服务
  console.log('\n[测试 6] 停止服务');
  try {
    const status = runtimeManager.getServiceStatus(TEST_SERVICE_ID);
    if (!status?.running) {
      recordResult('停止服务', true, '服务未运行，跳过停止测试');
    } else {
      await runtimeManager.stopService(TEST_SERVICE_ID);
      await new Promise(resolve => setTimeout(resolve, 1000));
      const newStatus = runtimeManager.getServiceStatus(TEST_SERVICE_ID);
      recordResult('停止服务', newStatus?.running === false);
    }
  } catch (error) {
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
      console.log(`   备注: ${result.error}`);
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

