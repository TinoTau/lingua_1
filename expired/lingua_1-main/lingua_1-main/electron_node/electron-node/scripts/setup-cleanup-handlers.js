/**
 * 设置进程退出时的清理处理器
 * 在程序意外中断时自动清理 ESBuild 进程
 */

const { cleanupEsbuild } = require('./cleanup-esbuild');

// 注册清理函数
function setupCleanupHandlers() {
  // 正常退出信号
  process.on('SIGINT', () => {
    console.log('\n收到 SIGINT 信号，正在清理...');
    cleanupEsbuild();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\n收到 SIGTERM 信号，正在清理...');
    cleanupEsbuild();
    process.exit(0);
  });

  // 未捕获的异常
  process.on('uncaughtException', (error) => {
    console.error('未捕获的异常:', error);
    cleanupEsbuild();
    process.exit(1);
  });

  // 未处理的 Promise 拒绝
  process.on('unhandledRejection', (reason, promise) => {
    console.error('未处理的 Promise 拒绝:', reason);
    cleanupEsbuild();
    process.exit(1);
  });

  // 进程退出（最后的清理机会）
  process.on('exit', (code) => {
    cleanupEsbuild();
  });

  console.log('已设置 ESBuild 自动清理处理器');
}

// 如果直接运行此脚本
if (require.main === module) {
  setupCleanupHandlers();
  // 保持进程运行以测试清理功能
  console.log('清理处理器已设置，按 Ctrl+C 测试清理功能...');
  process.stdin.resume();
}

module.exports = { setupCleanupHandlers };
