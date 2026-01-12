/**
 * Aggregator 测试向量运行脚本
 * 使用编译后的代码运行测试向量
 */

const path = require('path');

// 动态导入编译后的测试文件
try {
  // 先尝试从编译后的位置导入
  const testPath = path.join(__dirname, '../main/electron-node/tests/aggregator-test-vectors.js');
  const testModule = require(testPath);
  
  if (testModule && testModule.runAllTestVectors) {
    console.log('运行 Aggregator 测试向量（使用编译后的代码）...\n');
    testModule.runAllTestVectors();
  } else {
    console.error('错误: 无法找到 runAllTestVectors 函数');
    process.exit(1);
  }
} catch (error) {
  console.error('错误: 无法加载测试文件');
  console.error('请先运行: npm run build:main');
  console.error('详细错误:', error.message);
  process.exit(1);
}

