/**
 * ESBuild 清理脚本
 * 用于在程序退出时自动清理所有 ESBuild 进程
 */

const { exec } = require('child_process');
const os = require('os');

function cleanupEsbuild() {
  const platform = os.platform();
  
  if (platform === 'win32') {
    // Windows: 使用 taskkill 终止 esbuild 进程
    exec('taskkill /F /IM esbuild.exe 2>nul', (error) => {
      if (error && !error.message.includes('not found')) {
        console.error('清理 ESBuild 进程时出错:', error.message);
      } else {
        console.log('已清理 ESBuild 进程');
      }
    });
  } else {
    // Linux/Mac: 使用 pkill 终止 esbuild 进程
    exec('pkill -f esbuild 2>/dev/null', (error) => {
      if (error && error.code !== 1) { // code 1 表示没有找到进程，这是正常的
        console.error('清理 ESBuild 进程时出错:', error.message);
      } else {
        console.log('已清理 ESBuild 进程');
      }
    });
  }
}

// 如果直接运行此脚本
if (require.main === module) {
  cleanupEsbuild();
  process.exit(0);
}

// 导出函数供其他模块使用
module.exports = { cleanupEsbuild };
