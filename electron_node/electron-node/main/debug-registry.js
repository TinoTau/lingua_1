/**
 * 调试脚本：检查服务注册表文件读取
 * 
 * 使用方法：
 *   node debug-registry.js
 */

const fs = require('fs');
const path = require('path');

// 尝试多个可能的路径
const possiblePaths = [
  path.join(__dirname, '../../services/installed.json'),
  path.join(__dirname, '../../../services/installed.json'),
  path.join(process.env.APPDATA || process.env.HOME, 'electron-node/services/installed.json'),
];

console.log('检查服务注册表文件...\n');

for (const filePath of possiblePaths) {
  console.log(`检查路径: ${filePath}`);
  if (fs.existsSync(filePath)) {
    console.log('✓ 文件存在');
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(content);
      console.log(`✓ JSON 格式正确`);
      console.log(`✓ 包含 ${Object.keys(data).length} 个服务`);
      console.log(`  服务列表: ${Object.keys(data).join(', ')}`);
      
      // 检查路径占位符
      const contentStr = JSON.stringify(data);
      if (contentStr.includes('{SERVICES_DIR}')) {
        console.log('⚠ 发现路径占位符 {SERVICES_DIR}，需要替换');
      } else {
        console.log('✓ 没有路径占位符');
      }
      
      // 显示第一个服务的详细信息
      const firstServiceId = Object.keys(data)[0];
      if (firstServiceId) {
        const firstService = data[firstServiceId];
        const firstVersion = Object.keys(firstService)[0];
        if (firstVersion) {
          const serviceInfo = firstService[firstVersion];
          console.log(`\n第一个服务示例:`);
          console.log(`  服务ID: ${serviceInfo.service_id}`);
          console.log(`  版本: ${serviceInfo.version}`);
          console.log(`  平台: ${serviceInfo.platform}`);
          console.log(`  安装路径: ${serviceInfo.install_path}`);
        }
      }
      
      console.log('\n✅ 注册表文件正常');
      process.exit(0);
    } catch (error) {
      console.log(`❌ 读取失败: ${error.message}`);
    }
  } else {
    console.log('✗ 文件不存在');
  }
  console.log('');
}

console.log('❌ 未找到注册表文件');
console.log('\n请确保 installed.json 文件位于以下位置之一:');
possiblePaths.forEach(p => console.log(`  - ${p}`));
process.exit(1);

