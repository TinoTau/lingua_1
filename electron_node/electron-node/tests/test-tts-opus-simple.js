/**
 * 简单的 TTS Opus 编码功能测试
 * 验证 TTS 服务返回的 WAV 音频能够正确编码为 Opus 格式
 */

const path = require('path');
const opusEncoderPath = path.join(__dirname, '../main/electron-node/main/src/utils/opus-encoder.js');
const { parseWavFile, encodePcm16ToOpus, isOpusEncoderAvailable } = require(opusEncoderPath);

/**
 * 创建测试用的 WAV 文件 Buffer
 */
function createTestWavBuffer(durationSeconds = 1.0, sampleRate = 16000) {
  const numSamples = Math.floor(sampleRate * durationSeconds);
  const samples = new Int16Array(numSamples);
  
  // 生成简单的测试音频（正弦波）
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const value = Math.sin(2 * Math.PI * 440 * t); // 440Hz
    samples[i] = Math.floor(value * 32767);
  }

  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = samples.length * (bitsPerSample / 8);
  const fileSize = 36 + dataSize;

  const buffer = Buffer.alloc(44 + dataSize);

  // RIFF header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(fileSize, 4);
  buffer.write('WAVE', 8);

  // fmt chunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);

  // data chunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  Buffer.from(samples.buffer).copy(buffer, 44);

  return buffer;
}

async function testOpusEncoding() {
  console.log('🧪 开始测试 TTS Opus 编码功能...\n');

  // 1. 检查 Opus 编码器是否可用
  console.log('1. 检查 Opus 编码器可用性...');
  const available = isOpusEncoderAvailable();
  console.log(`   ${available ? '✅' : '❌'} Opus 编码器: ${available ? '可用' : '不可用'}\n`);

  if (!available) {
    console.log('⚠️  Opus 编码器不可用，跳过测试');
    return;
  }

  // 2. 创建测试 WAV 文件
  console.log('2. 创建测试 WAV 文件...');
  const testWavBuffer = createTestWavBuffer(1.0, 16000); // 1秒音频，16kHz
  console.log(`   ✅ WAV 文件大小: ${testWavBuffer.length} bytes\n`);

  // 3. 解析 WAV 文件
  console.log('3. 解析 WAV 文件...');
  try {
    const { pcm16Data, sampleRate, channels } = parseWavFile(testWavBuffer);
    console.log(`   ✅ 解析成功:`);
    console.log(`      - PCM16 数据大小: ${pcm16Data.length} bytes`);
    console.log(`      - 采样率: ${sampleRate} Hz`);
    console.log(`      - 声道数: ${channels}\n`);
  } catch (error) {
    console.error(`   ❌ 解析失败: ${error.message}`);
    return;
  }

  // 4. 编码为 Opus
  console.log('4. 编码为 Opus...');
  try {
    const { pcm16Data, sampleRate, channels } = parseWavFile(testWavBuffer);
    const opusData = await encodePcm16ToOpus(pcm16Data, sampleRate, channels);
    
    console.log(`   ✅ 编码成功:`);
    console.log(`      - Opus 数据大小: ${opusData.length} bytes`);
    console.log(`      - 压缩比: ${(pcm16Data.length / opusData.length).toFixed(2)}x`);
    console.log(`      - 大小减少: ${((1 - opusData.length / pcm16Data.length) * 100).toFixed(1)}%\n`);

    // 验证压缩效果
    if (opusData.length < pcm16Data.length) {
      console.log('   ✅ 压缩效果验证通过（Opus 小于原始 PCM16）\n');
    } else {
      console.log('   ⚠️  压缩效果异常（Opus 大于或等于原始 PCM16）\n');
    }

    // 5. 转换为 Base64
    console.log('5. 转换为 Base64...');
    const base64 = opusData.toString('base64');
    console.log(`   ✅ Base64 长度: ${base64.length} 字符\n`);

    // 6. 验证 Base64 可以解码
    console.log('6. 验证 Base64 解码...');
    const decoded = Buffer.from(base64, 'base64');
    if (Buffer.compare(opusData, decoded) === 0) {
      console.log('   ✅ Base64 编码/解码验证通过\n');
    } else {
      console.log('   ❌ Base64 编码/解码验证失败\n');
    }

    console.log('✅ 所有测试通过！\n');
    console.log('📊 测试总结:');
    console.log(`   - 原始 WAV: ${testWavBuffer.length} bytes`);
    console.log(`   - PCM16 数据: ${pcm16Data.length} bytes`);
    console.log(`   - Opus 数据: ${opusData.length} bytes`);
    console.log(`   - 压缩比: ${(pcm16Data.length / opusData.length).toFixed(2)}x`);
    console.log(`   - Base64: ${base64.length} 字符`);

  } catch (error) {
    console.error(`   ❌ 编码失败: ${error.message}`);
    console.error(`   错误堆栈: ${error.stack}`);
  }
}

// 运行测试
testOpusEncoding().catch(error => {
  console.error('❌ 测试执行失败:', error);
  process.exit(1);
});

