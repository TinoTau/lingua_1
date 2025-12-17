/**
 * 测试向上查找 services 目录的逻辑
 */

const fs = require('fs');
const path = require('path');

// 模拟编译后的 __dirname（从 electron-node/main 目录）
const scriptDir = __dirname;
const simulatedDirname = path.join(scriptDir, 'electron-node/main/src');
console.log('脚本目录:', scriptDir);
console.log('模拟 __dirname:', simulatedDirname);
console.log('');

// 向上查找 services/installed.json
let currentDir = simulatedDirname;
let projectServicesDir = null;

console.log('开始向上查找 services/installed.json...\n');

for (let i = 0; i < 10; i++) {
    const testPath = path.join(currentDir, 'services', 'installed.json');
    console.log(`第 ${i + 1} 级: ${currentDir}`);
    console.log(`  测试路径: ${testPath}`);
    console.log(`  存在: ${fs.existsSync(testPath)}`);

    if (fs.existsSync(testPath)) {
        projectServicesDir = path.join(currentDir, 'services');
        console.log(`\n✓ 找到 services 目录: ${projectServicesDir}`);
        break;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
        console.log('\n已到达根目录，停止查找');
        break;
    }
    currentDir = parentDir;
    console.log('');
}

if (projectServicesDir) {
    console.log('\n✅ 成功找到 services 目录');
    console.log('路径:', projectServicesDir);

    // 测试读取
    const installedPath = path.join(projectServicesDir, 'installed.json');
    const data = JSON.parse(fs.readFileSync(installedPath, 'utf-8'));
    console.log(`\n✓ 成功读取 installed.json`);
    console.log(`  包含 ${Object.keys(data).length} 个服务`);
    console.log(`  服务列表: ${Object.keys(data).join(', ')}`);
} else {
    console.log('\n❌ 未找到 services 目录');
}

