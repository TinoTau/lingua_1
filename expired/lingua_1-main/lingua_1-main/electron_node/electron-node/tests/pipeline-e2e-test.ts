/**
 * 节点端Pipeline端到端测试
 * 
 * 测试完整的服务流程：
 * 1. ASR (faster-whisper-vad) - 语音识别
 * 2. NMT (nmt-m2m100) - 机器翻译
 * 3. 验证结果能正确返回
 * 
 * 注意：此测试需要以下服务正在运行：
 * - faster-whisper-vad (端口 6007)
 * - nmt-m2m100 (端口 5008)
 */

import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const ASR_SERVICE_URL = 'http://127.0.0.1:6007';
const NMT_SERVICE_URL = 'http://127.0.0.1:5008';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  details?: any;
}

const results: TestResult[] = [];

function recordResult(name: string, passed: boolean, error?: string, details?: any) {
  results.push({ name, passed, error, details });
  const icon = passed ? '✅' : '❌';
  console.log(`${icon} ${name}${error ? `: ${error}` : ''}`);
  if (details) {
    console.log(`   详情: ${JSON.stringify(details, null, 2)}`);
  }
}

/**
 * 检查服务是否可用
 */
async function checkServiceHealth(url: string, serviceName: string): Promise<boolean> {
  try {
    const response = await axios.get(`${url}/health`, { timeout: 5000 });
    return response.status === 200;
  } catch (error: any) {
    recordResult(`${serviceName} 健康检查`, false, error.message);
    return false;
  }
}

/**
 * 读取测试音频文件并转换为base64
 */
function loadTestAudio(): string {
  // 使用一个简单的测试音频文件（如果存在）
  // 或者生成一个模拟的base64编码的Opus数据
  // 这里我们使用Plan A格式：uint16_le packet_len + packet_bytes
  
  // 创建一个模拟的Opus packet（20ms，16kHz，单声道）
  // 实际测试中应该使用真实的Opus编码音频
  const packetLen = 61; // 示例packet长度
  const packet = Buffer.alloc(packetLen, 0x80); // 填充示例数据
  
  // Plan A格式：uint16_le packet_len + packet_bytes
  const buffer = Buffer.alloc(2 + packetLen);
  buffer.writeUInt16LE(packetLen, 0);
  packet.copy(buffer, 2);
  
  return buffer.toString('base64');
}

/**
 * 测试ASR服务
 */
async function testASRService(): Promise<{ text: string; language: string } | null> {
  try {
    const audioBase64 = loadTestAudio();
    const jobId = `test-asr-${Date.now()}`;
    
    const response = await axios.post(
      `${ASR_SERVICE_URL}/utterance`,
      {
        job_id: jobId,
        src_lang: 'zh',
        tgt_lang: 'zh',
        audio: audioBase64,
        audio_format: 'opus',
        sample_rate: 16000,
        task: 'transcribe',
        beam_size: 5,
        condition_on_previous_text: true,
        use_context_buffer: true,
        use_text_context: true,
        enable_streaming_asr: false,
      },
      { timeout: 30000 }
    );
    
    if (response.status === 200 && response.data.text) {
      return {
        text: response.data.text,
        language: response.data.language || 'zh',
      };
    }
    
    recordResult('ASR服务测试', false, '响应格式不正确', response.data);
    return null;
  } catch (error: any) {
    recordResult('ASR服务测试', false, error.message, {
      status: error.response?.status,
      data: error.response?.data,
    });
    return null;
  }
}

/**
 * 测试NMT服务
 */
async function testNMTService(text: string): Promise<string | null> {
  try {
    const response = await axios.post(
      `${NMT_SERVICE_URL}/v1/translate`,
      {
        text: text,
        src_lang: 'zh',
        tgt_lang: 'en',
        context_text: text,
      },
      { timeout: 30000 }
    );
    
    if (response.status === 200 && response.data.text) {
      return response.data.text;
    }
    
    recordResult('NMT服务测试', false, '响应格式不正确', response.data);
    return null;
  } catch (error: any) {
    recordResult('NMT服务测试', false, error.message, {
      status: error.response?.status,
      data: error.response?.data,
    });
    return null;
  }
}

/**
 * 测试完整的Pipeline流程
 */
async function testFullPipeline(): Promise<boolean> {
  console.log('\n[测试完整Pipeline]');
  
  // 1. 测试ASR
  console.log('  1. 测试ASR服务...');
  const asrResult = await testASRService();
  if (!asrResult) {
    recordResult('完整Pipeline测试', false, 'ASR服务失败');
    return false;
  }
  recordResult('ASR服务', true, undefined, { text: asrResult.text, language: asrResult.language });
  
  // 2. 测试NMT
  console.log('  2. 测试NMT服务...');
  const translatedText = await testNMTService(asrResult.text);
  if (!translatedText) {
    recordResult('完整Pipeline测试', false, 'NMT服务失败');
    return false;
  }
  recordResult('NMT服务', true, undefined, { translated: translatedText });
  
  // 3. 验证结果
  console.log('  3. 验证结果...');
  if (asrResult.text && translatedText) {
    recordResult('完整Pipeline测试', true, undefined, {
      asr_text: asrResult.text,
      translated_text: translatedText,
    });
    return true;
  }
  
  recordResult('完整Pipeline测试', false, '结果验证失败');
  return false;
}

/**
 * 主测试函数
 */
async function main() {
  console.log('='.repeat(60));
  console.log('节点端Pipeline端到端测试');
  console.log('='.repeat(60));
  console.log();
  
  // 检查服务健康状态
  console.log('[步骤1] 检查服务健康状态');
  const asrHealthy = await checkServiceHealth(ASR_SERVICE_URL, 'faster-whisper-vad');
  const nmtHealthy = await checkServiceHealth(NMT_SERVICE_URL, 'nmt-m2m100');
  
  if (!asrHealthy || !nmtHealthy) {
    console.log('\n❌ 服务不可用，请确保以下服务正在运行：');
    console.log(`  - faster-whisper-vad: ${ASR_SERVICE_URL}`);
    console.log(`  - nmt-m2m100: ${NMT_SERVICE_URL}`);
    process.exit(1);
  }
  
  recordResult('服务健康检查', true);
  
  // 测试完整Pipeline
  const pipelineSuccess = await testFullPipeline();
  
  // 输出测试总结
  console.log('\n' + '='.repeat(60));
  console.log('测试总结');
  console.log('='.repeat(60));
  
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  
  console.log(`总计: ${results.length} 个测试`);
  console.log(`通过: ${passed} 个`);
  console.log(`失败: ${failed} 个`);
  
  if (failed > 0) {
    console.log('\n失败的测试:');
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  ❌ ${r.name}: ${r.error}`);
    });
  }
  
  console.log('\n' + '='.repeat(60));
  
  if (pipelineSuccess) {
    console.log('✅ 所有测试通过！Pipeline工作正常。');
    process.exit(0);
  } else {
    console.log('❌ 测试失败！请检查服务状态和日志。');
    process.exit(1);
  }
}

// 运行测试
main().catch((error) => {
  console.error('测试执行失败:', error);
  process.exit(1);
});

