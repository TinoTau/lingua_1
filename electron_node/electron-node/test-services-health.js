/**
 * 服务健康检查脚本
 * 检查节点端各个服务是否正常运行
 */

const axios = require('axios');

const SERVICES = [
  { name: 'Faster Whisper VAD (ASR)', url: 'http://127.0.0.1:6007/health' },
  { name: 'NMT M2M100', url: 'http://127.0.0.1:5008/health' },
  { name: 'Piper TTS', url: 'http://127.0.0.1:5006/health' },
];

async function checkServiceHealth(name, url) {
  try {
    const response = await axios.get(url, { timeout: 5000 });
    return { name, status: 'healthy', code: response.status };
  } catch (error) {
    return { name, status: 'unhealthy', error: error.message };
  }
}

async function main() {
  console.log('============================================================');
  console.log('节点端服务健康检查');
  console.log('============================================================\n');

  const results = await Promise.all(
    SERVICES.map(service => checkServiceHealth(service.name, service.url))
  );

  let allHealthy = true;
  results.forEach(result => {
    const icon = result.status === 'healthy' ? '✅' : '❌';
    console.log(`${icon} ${result.name}: ${result.status}`);
    if (result.error) {
      console.log(`   错误: ${result.error}`);
      allHealthy = false;
    }
  });

  console.log('\n============================================================');
  if (allHealthy) {
    console.log('✅ 所有服务健康检查通过');
  } else {
    console.log('❌ 部分服务健康检查失败');
  }
  console.log('============================================================');
}

main().catch(console.error);
