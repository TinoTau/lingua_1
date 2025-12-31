/**
 * Aggregator 测试运行脚本
 * 使用编译后的代码运行测试
 */

const path = require('path');

// 动态导入编译后的测试文件
try {
  // 先尝试从编译后的位置导入
  const testPath = path.join(__dirname, '../main/electron-node/tests/aggregator-test.js');
  const testModule = require(testPath);
  
  if (testModule && testModule.runAllTests) {
    console.log('运行 Aggregator 单元测试（使用编译后的代码）...\n');
    testModule.runAllTests();
  } else {
    console.error('错误: 无法找到 runAllTests 函数');
    process.exit(1);
  }
} catch (error) {
  console.error('错误: 无法加载测试文件');
  console.error('请先运行: npm run build:main');
  console.error('详细错误:', error.message);
  process.exit(1);
}
