/**
 * 静态分析编译后的代码，检查IPC handlers是否存在
 */

const fs = require('fs');
const path = require('path');

console.log('======================================');
console.log('IPC Handlers 静态检查');
console.log('======================================\n');

// 检查编译后的主文件
const indexJsPath = path.join(__dirname, 'main', 'electron-node', 'main', 'src', 'index.js');

if (!fs.existsSync(indexJsPath)) {
  console.error('❌ 编译产物不存在:', indexJsPath);
  console.error('请先运行: npm run build');
  process.exit(1);
}

console.log('✅ 找到编译产物:', indexJsPath);
console.log('文件大小:', (fs.statSync(indexJsPath).size / 1024).toFixed(2), 'KB\n');

// 读取文件内容
const content = fs.readFileSync(indexJsPath, 'utf8');

// 检查关键函数和handlers
const checks = [
  { name: 'registerSystemResourceHandlers 函数定义', pattern: /function registerSystemResourceHandlers\(managers\)/ },
  { name: 'registerSystemResourceHandlers 调用', pattern: /registerSystemResourceHandlers\(managers\)/ },
  { name: 'get-system-resources handler', pattern: /ipcMain\.handle\('get-system-resources'/ },
  { name: 'get-all-service-metadata handler', pattern: /ipcMain\.handle\('get-all-service-metadata'/ },
  { name: 'initializeServicesSimple 调用', pattern: /initializeServicesSimple\(\)/ },
  { name: 'registerModelHandlers 调用', pattern: /registerModelHandlers\(/ },
  { name: 'registerRuntimeHandlers 调用', pattern: /registerRuntimeHandlers\(/ },
  { name: 'Service layer initialized 日志', pattern: /Service layer initialized/ },
  { name: 'System resource IPC handlers registered 日志', pattern: /System resource IPC handlers registered/ },
];

console.log('检查关键代码片段:\n');

let passCount = 0;
let failCount = 0;

for (const check of checks) {
  const found = check.pattern.test(content);
  if (found) {
    console.log(`✅ ${check.name}`);
    passCount++;
  } else {
    console.log(`❌ ${check.name}`);
    failCount++;
  }
}

console.log('\n======================================');
console.log(`总计: ${checks.length} 项检查`);
console.log(`通过: ${passCount} 项`);
console.log(`失败: ${failCount} 项`);
console.log('======================================\n');

if (failCount > 0) {
  console.error('⚠️ 存在缺失的代码！');
  console.error('建议操作:');
  console.error('1. 确认源代码 src/index.ts 是否包含所有必要的代码');
  console.error('2. 重新编译: npm run build:main');
  console.error('3. 清理缓存: Remove-Item -Recurse -Force main\\electron-node');
  process.exit(1);
} else {
  console.log('✅ 所有关键代码片段都存在！');
  console.log('\n下一步: 运行应用查看运行时日志');
  console.log('npm run dev');
  process.exit(0);
}
