/**
 * 注册本地开发的服务到服务注册表
 * 用于开发环境，将本地服务目录注册到 installed.json
 */

const fs = require('fs');
const path = require('path');

const SERVICES_DIR = __dirname;
const INSTALLED_JSON = path.join(SERVICES_DIR, 'installed.json');
const CURRENT_JSON = path.join(SERVICES_DIR, 'current.json');

// 要注册的服务列表
const SERVICES_TO_REGISTER = [
  {
    serviceId: 'en-normalize',
    version: '1.0.0',
    servicePath: path.join(SERVICES_DIR, 'en_normalize'),
  },
  {
    serviceId: 'semantic-repair-zh',
    version: '1.0.0',
    servicePath: path.join(SERVICES_DIR, 'semantic_repair_zh'),
  },
  {
    serviceId: 'semantic-repair-en',
    version: '1.0.0',
    servicePath: path.join(SERVICES_DIR, 'semantic_repair_en'),
  },
];

// 获取平台ID
function getPlatformId() {
  const platform = process.platform;
  const arch = process.arch;
  
  if (platform === 'win32') {
    return arch === 'x64' ? 'windows-x64' : 'windows-x86';
  } else if (platform === 'darwin') {
    return arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64';
  } else if (platform === 'linux') {
    return arch === 'arm64' ? 'linux-arm64' : 'linux-x64';
  }
  return 'unknown';
}

// 计算目录大小（字节）
function calculateDirSize(dirPath) {
  let totalSize = 0;
  
  function calculateSize(currentPath) {
    const stats = fs.statSync(currentPath);
    
    if (stats.isFile()) {
      totalSize += stats.size;
    } else if (stats.isDirectory()) {
      const files = fs.readdirSync(currentPath);
      for (const file of files) {
        // 跳过 node_modules, venv, __pycache__, .git 等目录
        if (file === 'node_modules' || file === 'venv' || file === '__pycache__' || file === '.git' || file === 'target') {
          continue;
        }
        calculateSize(path.join(currentPath, file));
      }
    }
  }
  
  try {
    calculateSize(dirPath);
  } catch (error) {
    console.warn(`Warning: Failed to calculate size for ${dirPath}: ${error.message}`);
  }
  
  return totalSize;
}

// 注册服务
function registerService(serviceId, version, servicePath, platform) {
  // 检查服务目录是否存在
  if (!fs.existsSync(servicePath)) {
    console.error(`Error: Service directory not found: ${servicePath}`);
    return false;
  }
  
  // 检查 service.json 是否存在
  const serviceJsonPath = path.join(servicePath, 'service.json');
  if (!fs.existsSync(serviceJsonPath)) {
    console.error(`Error: service.json not found: ${serviceJsonPath}`);
    return false;
  }
  
  // 读取 installed.json
  let installed = {};
  if (fs.existsSync(INSTALLED_JSON)) {
    try {
      installed = JSON.parse(fs.readFileSync(INSTALLED_JSON, 'utf-8'));
    } catch (error) {
      console.warn(`Warning: Failed to parse installed.json: ${error.message}`);
      installed = {};
    }
  }
  
  // 计算服务大小
  const sizeBytes = calculateDirSize(servicePath);
  
  // 创建服务条目
  const key = `${version}::${platform}`;
  const entry = {
    service_id: serviceId,
    version: version,
    platform: platform,
    installed_at: new Date().toISOString(),
    install_path: servicePath.replace(/\\/g, '/'), // 统一使用正斜杠
    size_bytes: sizeBytes,
  };
  
  // 添加到注册表
  if (!installed[serviceId]) {
    installed[serviceId] = {};
  }
  installed[serviceId][key] = entry;
  
  // 写入 installed.json
  fs.writeFileSync(INSTALLED_JSON, JSON.stringify(installed, null, 2), 'utf-8');
  console.log(`✅ Registered ${serviceId} ${version} (${platform})`);
  console.log(`   Path: ${servicePath}`);
  console.log(`   Size: ${(sizeBytes / 1024 / 1024).toFixed(2)} MB`);
  
  // 更新 current.json
  let current = {};
  if (fs.existsSync(CURRENT_JSON)) {
    try {
      current = JSON.parse(fs.readFileSync(CURRENT_JSON, 'utf-8'));
    } catch (error) {
      console.warn(`Warning: Failed to parse current.json: ${error.message}`);
      current = {};
    }
  }
  
  current[serviceId] = {
    version: version,
    platform: platform,
    service_json_path: serviceJsonPath.replace(/\\/g, '/'),
    install_path: servicePath.replace(/\\/g, '/'),
  };
  
  fs.writeFileSync(CURRENT_JSON, JSON.stringify(current, null, 2), 'utf-8');
  console.log(`✅ Set ${serviceId} as current`);
  
  return true;
}

// 主函数
function main() {
  console.log('='.repeat(60));
  console.log('Registering Local Services');
  console.log('='.repeat(60));
  console.log('');
  
  const platform = getPlatformId();
  console.log(`Platform: ${platform}`);
  console.log(`Services Directory: ${SERVICES_DIR}`);
  console.log('');
  
  let successCount = 0;
  let failCount = 0;
  
  for (const service of SERVICES_TO_REGISTER) {
    console.log(`Registering ${service.serviceId}...`);
    if (registerService(service.serviceId, service.version, service.servicePath, platform)) {
      successCount++;
    } else {
      failCount++;
    }
    console.log('');
  }
  
  console.log('='.repeat(60));
  console.log(`Registration Complete: ${successCount} succeeded, ${failCount} failed`);
  console.log('='.repeat(60));
  
  if (failCount > 0) {
    process.exit(1);
  }
}

// 运行
main();
