/**
 * 部署测试服务注册表脚本
 * 
 * 将测试用的服务注册表文件部署到 Electron 应用的 userData 目录
 * 
 * 使用方法:
 *   node deploy-test-registry.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// 获取 Electron userData 目录
// 注意：这个脚本需要在 Electron 应用外部运行，所以需要手动指定路径
// 或者从环境变量读取
function getUserDataPath() {
  // 方法1: 从环境变量读取
  if (process.env.USER_DATA) {
    return process.env.USER_DATA;
  }

  // 方法2: 使用默认的 Electron userData 路径
  const platform = os.platform();
  let appDataPath;
  
  if (platform === 'win32') {
    appDataPath = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  } else if (platform === 'darwin') {
    appDataPath = path.join(os.homedir(), 'Library', 'Application Support');
  } else {
    appDataPath = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  }

  // Electron 应用的默认 userData 目录名（根据实际应用名称调整）
  const appName = process.env.ELECTRON_APP_NAME || 'electron-node';
  return path.join(appDataPath, appName);
}

function deployTestRegistry() {
  try {
    // 获取脚本所在目录
    const scriptDir = __dirname;
    
    // 读取测试文件
    const installedJsonPath = path.join(scriptDir, 'installed.json');
    const currentJsonPath = path.join(scriptDir, 'current.json');
    
    if (!fs.existsSync(installedJsonPath) || !fs.existsSync(currentJsonPath)) {
      console.error('错误: 找不到测试注册表文件');
      console.error('请确保 installed.json 和 current.json 文件存在');
      process.exit(1);
    }

    const installedJson = fs.readFileSync(installedJsonPath, 'utf-8');
    const currentJson = fs.readFileSync(currentJsonPath, 'utf-8');

    // 获取目标路径
    const userData = getUserDataPath();
    const servicesDir = path.join(userData, 'services');
    const registryDir = path.join(servicesDir, 'registry');

    console.log('目标目录:', registryDir);
    console.log('用户数据目录:', userData);

    // 确保目录存在
    fs.mkdirSync(registryDir, { recursive: true });
    console.log('✓ 目录已创建');

    // 替换路径占位符
    const installedContent = installedJson.replace(/{SERVICES_DIR}/g, servicesDir.replace(/\\/g, '/'));
    const currentContent = currentJson.replace(/{SERVICES_DIR}/g, servicesDir.replace(/\\/g, '/'));

    // 备份现有文件（如果存在）
    const installedTarget = path.join(registryDir, 'installed.json');
    const currentTarget = path.join(registryDir, 'current.json');
    
    if (fs.existsSync(installedTarget)) {
      const backupPath = installedTarget + '.backup.' + Date.now();
      fs.copyFileSync(installedTarget, backupPath);
      console.log('✓ 已备份现有 installed.json 到:', backupPath);
    }
    
    if (fs.existsSync(currentTarget)) {
      const backupPath = currentTarget + '.backup.' + Date.now();
      fs.copyFileSync(currentTarget, backupPath);
      console.log('✓ 已备份现有 current.json 到:', backupPath);
    }

    // 写入文件
    fs.writeFileSync(installedTarget, installedContent, 'utf-8');
    console.log('✓ installed.json 已部署');

    fs.writeFileSync(currentTarget, currentContent, 'utf-8');
    console.log('✓ current.json 已部署');

    console.log('\n✅ 测试服务注册表部署成功！');
    console.log('\n包含的服务:');
    console.log('  - nmt-m2m100 (v1.0.0, windows-x64)');
    console.log('  - node-inference (v1.0.0, windows-x64)');
    console.log('  - piper-tts (v1.0.0, windows-x64)');
    console.log('  - your-tts (v1.0.0, windows-x64)');
    console.log('\n现在可以启动 Electron 应用测试服务管理功能。');

  } catch (error) {
    console.error('❌ 部署失败:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// 运行部署
if (require.main === module) {
  console.log('开始部署测试服务注册表...\n');
  deployTestRegistry();
}

module.exports = { deployTestRegistry, getUserDataPath };

