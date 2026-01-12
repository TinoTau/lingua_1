/**
 * Opus 音频编码工具
 * 使用 @minceraftmc/opus-encoder (WebAssembly) 进行编码
 * 不会修改环境变量，不会影响其他服务（如 NMT）
 * 
 * 注意：使用延迟导入，避免在模块加载时初始化，确保不影响其他服务（如 NMT）的启动
 */

import logger from '../logger';

// 延迟导入 @minceraftmc/opus-encoder，避免在模块加载时初始化
// 这样可以确保不会影响其他服务（如 NMT）的启动
// 类型定义（在运行时动态导入）
type OpusEncoderType = any;
type OpusApplicationType = any;

// Opus 编码器实例（单例，复用编码器）
let encoderInstance: OpusEncoderType | null = null;
let encoderConfig: { sampleRate: number; channels: number } | null = null;
let encoderInitPromise: Promise<void> | null = null;
let opusAvailable = false;
let opusCheckAttempted = false;

/**
 * 初始化 Opus 编码器
 * @param sampleRate 采样率（默认 16000）
 * @param channels 声道数（默认 1，单声道）
 */
async function initializeOpusEncoder(
  sampleRate: number = 16000,
  channels: number = 1
): Promise<void> {
  // 如果已经初始化且配置相同，直接返回
  if (encoderInstance && encoderConfig) {
    if (encoderConfig.sampleRate === sampleRate && encoderConfig.channels === channels) {
      return;
    }
    // 配置不同，需要重新初始化
    encoderInstance.free();
    encoderInstance = null;
    encoderConfig = null;
  }

  // 如果正在初始化，等待完成
  if (encoderInitPromise) {
    await encoderInitPromise;
    return;
  }

  encoderInitPromise = (async () => {
    try {
      // 延迟导入 @minceraftmc/opus-encoder，避免在模块加载时初始化
      // 这样可以确保不会影响其他服务（如 NMT）的启动
      // 使用 Function 构造函数来动态执行 import()，避免 TypeScript 编译器将其转换为 require()
      // 因为 @minceraftmc/opus-encoder 是 ES Module，不能使用 require() 导入
      const dynamicImport = new Function('specifier', 'return import(specifier)');
      const opusModule = await dynamicImport('@minceraftmc/opus-encoder');
      const { OpusEncoder, OpusApplication } = opusModule;
      
      // 验证采样率
      const validSampleRates = [8000, 12000, 16000, 24000, 48000];
      if (!validSampleRates.includes(sampleRate)) {
        // 如果采样率不支持，使用最接近的支持值
        // 对于 22050 Hz，优先使用 16000 Hz（更接近，且 Web 端也使用 16000）
        const closestRate = validSampleRates.reduce((prev, curr) => {
          return Math.abs(curr - sampleRate) < Math.abs(prev - sampleRate) ? curr : prev;
        });
        logger.warn(
          {
            originalRate: sampleRate,
            targetRate: closestRate,
          },
          `Sample rate ${sampleRate} not supported by Opus, using ${closestRate} instead`
        );
        sampleRate = closestRate as 8000 | 12000 | 16000 | 24000 | 48000;
      }

      // 创建编码器实例
      encoderInstance = new OpusEncoder({
        sampleRate: sampleRate as 8000 | 12000 | 16000 | 24000 | 48000,
        application: OpusApplication.VOIP, // 使用 VOIP 模式（低延迟）
      });

      // 等待 WASM 编译完成
      await encoderInstance.ready;

      // 设置比特率为 24 kbps（与 Web 端一致）
      try {
        if (typeof (encoderInstance as any).setBitrate === 'function') {
          (encoderInstance as any).setBitrate(24000);
          logger.debug('Opus encoder bitrate set to 24 kbps');
        } else if (typeof (encoderInstance as any).bitrate !== 'undefined') {
          (encoderInstance as any).bitrate = 24000;
          logger.debug('Opus encoder bitrate set to 24 kbps (via property)');
        }
      } catch (error) {
        logger.warn('Failed to set Opus bitrate, using default');
      }

      encoderConfig = { sampleRate, channels };
      opusAvailable = true;
      logger.info(`Opus encoder initialized: sampleRate=${sampleRate}, channels=${channels}`);
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to initialize Opus encoder');
      opusAvailable = false;
      encoderInstance = null;
      encoderConfig = null;
      throw error;
    } finally {
      encoderInitPromise = null;
    }
  })();

  await encoderInitPromise;
}

/**
 * 检查 Opus 编码器是否可用
 */
export function isOpusEncoderAvailable(): boolean {
  if (!opusCheckAttempted) {
    opusCheckAttempted = true;
    // 不再检查环境变量，Opus 编码是必需的
    // @minceraftmc/opus-encoder 是纯 JavaScript/WASM，总是可用（除非初始化失败）
    opusAvailable = true;
  }
  return opusAvailable;
}

/**
 * 将 PCM16 (Int16Array) 转换为 Float32Array
 * @param pcm16Data PCM16 音频数据（Buffer）
 * @returns Float32Array 音频数据（范围 [-1.0, 1.0]）
 */
function pcm16ToFloat32(pcm16Data: Buffer): Float32Array {
  const int16Array = new Int16Array(
    pcm16Data.buffer,
    pcm16Data.byteOffset,
    pcm16Data.length / 2
  );
  const float32Array = new Float32Array(int16Array.length);
  for (let i = 0; i < int16Array.length; i++) {
    // 将 int16 [-32768, 32767] 转换为 float32 [-1.0, 1.0]
    float32Array[i] = Math.max(-1.0, Math.min(1.0, int16Array[i] / 32768.0));
  }
  return float32Array;
}

/**
 * 解析 WAV 文件，提取 PCM16 音频数据
 */
export function parseWavFile(wavBuffer: Buffer): { pcm16Data: Buffer; sampleRate: number; channels: number } {
  // WAV 文件格式：
  // - 0-3: "RIFF"
  // - 4-7: 文件大小
  // - 8-11: "WAVE"
  // - 12-15: "fmt "
  // - 16-19: fmt chunk size
  // - 20-21: audio format (1 = PCM)
  // - 22-23: num channels
  // - 24-27: sample rate
  // - 28-31: byte rate
  // - 32-33: block align
  // - 34-35: bits per sample
  // - 36-39: "data"
  // - 40-43: data chunk size
  // - 44+: audio data

  if (wavBuffer.length < 44) {
    throw new Error('Invalid WAV file: too short');
  }

  // 检查 RIFF header
  const riffHeader = wavBuffer.toString('ascii', 0, 4);
  if (riffHeader !== 'RIFF') {
    throw new Error('Invalid WAV file: missing RIFF header');
  }

  // 检查 WAVE header
  const waveHeader = wavBuffer.toString('ascii', 8, 12);
  if (waveHeader !== 'WAVE') {
    throw new Error('Invalid WAV file: missing WAVE header');
  }

  // 查找 fmt chunk
  let offset = 12;
  let fmtChunkFound = false;
  let sampleRate = 16000;
  let channels = 1;
  let bitsPerSample = 16;

  while (offset < wavBuffer.length - 8) {
    const chunkId = wavBuffer.toString('ascii', offset, offset + 4);
    const chunkSize = wavBuffer.readUInt32LE(offset + 4);

    if (chunkId === 'fmt ') {
      fmtChunkFound = true;
      const audioFormat = wavBuffer.readUInt16LE(offset + 8);
      if (audioFormat !== 1) {
        throw new Error(`Unsupported audio format: ${audioFormat} (only PCM format 1 is supported)`);
      }
      channels = wavBuffer.readUInt16LE(offset + 10);
      sampleRate = wavBuffer.readUInt32LE(offset + 12);
      bitsPerSample = wavBuffer.readUInt16LE(offset + 22);
      break;
    }

    offset += 8 + chunkSize;
  }

  if (!fmtChunkFound) {
    throw new Error('Invalid WAV file: fmt chunk not found');
  }

  // 查找 data chunk
  offset = 12;
  let dataChunkFound = false;
  let dataOffset = 0;
  let dataSize = 0;

  while (offset < wavBuffer.length - 8) {
    const chunkId = wavBuffer.toString('ascii', offset, offset + 4);
    const chunkSize = wavBuffer.readUInt32LE(offset + 4);

    if (chunkId === 'data') {
      dataChunkFound = true;
      dataOffset = offset + 8;
      dataSize = chunkSize;
      break;
    }

    offset += 8 + chunkSize;
  }

  if (!dataChunkFound) {
    throw new Error('Invalid WAV file: data chunk not found');
  }

  // 提取 PCM16 数据
  const pcm16Data = wavBuffer.subarray(dataOffset, dataOffset + dataSize);

  return {
    pcm16Data,
    sampleRate,
    channels,
  };
}

/**
 * 将 PCM16 音频数据编码为 Opus 格式
 * @param pcm16Data PCM16 音频数据（Buffer）
 * @param sampleRate 采样率（默认 16000）
 * @param channels 声道数（默认 1，单声道）
 * @returns Opus 编码后的数据（Buffer）
 */
export async function encodePcm16ToOpus(
  pcm16Data: Buffer,
  sampleRate: number = 16000,
  channels: number = 1
): Promise<Buffer> {
  // 检查是否可用
  if (!isOpusEncoderAvailable()) {
    throw new Error('Opus encoding is disabled or not available');
  }

  try {
    // 保存原始采样率（用于日志和验证）
    const originalSampleRate = sampleRate;
    
    // 检查采样率是否被调整（initializeOpusEncoder 内部会调整不支持的采样率）
    const validSampleRates = [8000, 12000, 16000, 24000, 48000];
    let targetSampleRate = sampleRate;
    if (!validSampleRates.includes(sampleRate)) {
      // 对于 22050 Hz，强制使用 16000 Hz（更接近，且 Web 端也使用 16000）
      // 24000 Hz 虽然更接近，但会导致帧大小不匹配问题
      if (sampleRate === 22050) {
        targetSampleRate = 16000;
        logger.warn(
          {
            originalRate: originalSampleRate,
            targetRate: targetSampleRate,
            pcm16Length: pcm16Data.length,
            reason: '22050Hz not supported, using 16000Hz (closer than 24000Hz and matches web client)',
          },
          `Sample rate ${originalSampleRate}Hz not supported, using ${targetSampleRate}Hz encoder`
        );
      } else {
        // 对于其他不支持的采样率，选择最接近的支持值
        targetSampleRate = validSampleRates.reduce((prev, curr) => {
          return Math.abs(curr - sampleRate) < Math.abs(prev - sampleRate) ? curr : prev;
        });
        logger.warn(
          {
            originalRate: originalSampleRate,
            targetRate: targetSampleRate,
            pcm16Length: pcm16Data.length,
          },
          `Sample rate ${originalSampleRate}Hz not supported, using ${targetSampleRate}Hz encoder`
        );
      }
    }
    
    // 初始化编码器（如果尚未初始化或配置不同）
    await initializeOpusEncoder(targetSampleRate, channels);

    if (!encoderInstance || !encoderConfig) {
      throw new Error('Opus encoder initialization failed');
    }
    
    // 使用编码器的实际采样率（可能已被调整）
    const encoderSampleRate = encoderConfig.sampleRate;

    // 验证输入数据
    if (!pcm16Data || pcm16Data.length === 0) {
      throw new Error('PCM16 data is empty or invalid');
    }
    
    // 检查 PCM16 数据是否全为零
    const pcm16HasNonZero = pcm16Data.some((byte: number) => byte !== 0);
    if (!pcm16HasNonZero) {
      logger.warn(
        {
          pcm16Length: pcm16Data.length,
          sampleRate,
        },
        'PCM16 input data is all zeros, Opus encoding may produce invalid result'
      );
      // 不抛出错误，允许继续处理（可能是静音）
    }

    // 将 PCM16 转换为 Float32Array
    const float32Data = pcm16ToFloat32(pcm16Data);
    
    // 验证转换后的数据
    if (float32Data.length === 0) {
      throw new Error('Float32 conversion produced empty array');
    }
    
    // 检查 Float32 数据范围（使用循环避免栈溢出）
    let float32Min = float32Data[0];
    let float32Max = float32Data[0];
    for (let i = 1; i < float32Data.length; i++) {
      if (float32Data[i] < float32Min) float32Min = float32Data[i];
      if (float32Data[i] > float32Max) float32Max = float32Data[i];
    }
    logger.debug(
      {
        float32Length: float32Data.length,
        float32Range: `[${float32Min.toFixed(3)}, ${float32Max.toFixed(3)}]`,
        sampleRate,
      },
      'PCM16 converted to Float32'
    );

    // Opus 帧大小：20ms
    // 关键：当采样率不匹配时，必须使用编码器的采样率计算帧大小
    // 因为编码器是用特定采样率初始化的，它期望特定大小的帧
    const frameSizeMs = 20;
    let frameSize: number;
    
    if (originalSampleRate !== encoderSampleRate) {
      // 采样率不匹配：使用编码器的采样率计算帧大小
      // 这样编码器才能正确处理帧
      frameSize = Math.floor((encoderSampleRate * frameSizeMs) / 1000);
      const originalFrameSize = Math.floor((originalSampleRate * frameSizeMs) / 1000);
      logger.warn(
        {
          originalRate: originalSampleRate,
          encoderRate: encoderSampleRate,
          frameSize,
          originalFrameSize,
          float32Length: float32Data.length,
          expectedFrames: Math.ceil(float32Data.length / frameSize),
          note: 'Using encoder sample rate for frame size calculation due to sample rate mismatch',
        },
        `Sample rate mismatch: audio is ${originalSampleRate}Hz but encoder uses ${encoderSampleRate}Hz. Using frame size ${frameSize} (based on encoder rate) instead of ${originalFrameSize} (based on original rate). Audio will be resampled by the encoder.`
      );
      // 注意：使用编码器的采样率计算帧大小，编码器会自动处理采样率转换
    } else {
      // 采样率匹配：使用原始采样率计算帧大小
      frameSize = Math.floor((originalSampleRate * frameSizeMs) / 1000);
    }

    const opusPackets: Uint8Array[] = [];

    // 按帧编码
    for (let offset = 0; offset < float32Data.length; offset += frameSize) {
      const remaining = float32Data.length - offset;
      const currentFrameSize = Math.min(frameSize, remaining);

      let frame: Float32Array;
      if (currentFrameSize === frameSize) {
        // 完整帧
        frame = float32Data.slice(offset, offset + frameSize);
      } else {
        // 最后一帧不足，用零填充
        frame = new Float32Array(frameSize);
        frame.set(float32Data.slice(offset, offset + currentFrameSize), 0);
        // 剩余部分已经是 0（Float32Array 默认值为 0）
      }

      // 编码帧
      const encodedPacket = encoderInstance.encodeFrame(frame);
      
      // 验证编码后的数据是否有效
      if (!encodedPacket || encodedPacket.length === 0) {
        logger.warn(
          {
            frameIndex: opusPackets.length,
            frameSize: frame.length,
            sampleRate,
          },
          'Opus encodeFrame returned empty packet, skipping'
        );
        continue; // 跳过空包
      }
      
      // 检查是否全为零（全零数据 base64 编码后会全是 'A'）
      const hasNonZero = encodedPacket.some((byte: number) => byte !== 0);
      if (!hasNonZero) {
        // 计算帧数据范围（使用循环避免栈溢出）
        let frameMin = frame[0];
        let frameMax = frame[0];
        for (let i = 1; i < frame.length; i++) {
          if (frame[i] < frameMin) frameMin = frame[i];
          if (frame[i] > frameMax) frameMax = frame[i];
        }
        logger.warn(
          {
            frameIndex: opusPackets.length,
            frameSize: frame.length,
            packetLength: encodedPacket.length,
            sampleRate,
            frameDataRange: `[${frameMin.toFixed(3)}, ${frameMax.toFixed(3)}]`,
          },
          'Opus encodeFrame returned all-zero packet, this may indicate encoding failure'
        );
        // 仍然添加，但记录警告
      }
      
      opusPackets.push(encodedPacket);
    }

    // 检查是否有有效的包
    if (opusPackets.length === 0) {
      throw new Error('Opus encoding produced no valid packets');
    }

    // 合并所有 Opus packets，在每个帧前添加长度前缀（2 字节，小端序）
    // 这样 Web 端就可以知道每个帧的边界，正确分割多个帧
    const frameHeaderSize = 2; // 每个帧的长度前缀（字节）
    const totalSize = opusPackets.reduce((sum, packet) => sum + frameHeaderSize + packet.length, 0);
    const result = Buffer.alloc(totalSize);
    let resultOffset = 0;
    for (const packet of opusPackets) {
      // 写入帧长度前缀（2 字节，小端序，最大 65535 字节）
      if (packet.length > 65535) {
        throw new Error(`Opus frame too large: ${packet.length} bytes (max 65535)`);
      }
      result.writeUInt16LE(packet.length, resultOffset);
      resultOffset += frameHeaderSize;
      // 写入帧数据
      result.set(packet, resultOffset);
      resultOffset += packet.length;
    }

    // 验证最终结果是否全为零
    const resultHasNonZero = result.some((byte: number) => byte !== 0);
    if (!resultHasNonZero) {
      logger.error(
        {
          pcm16DataLength: pcm16Data.length,
          resultLength: result.length,
          packetCount: opusPackets.length,
          sampleRate,
        },
        'Opus encoding produced all-zero result, this indicates encoding failure'
      );
      throw new Error('Opus encoding produced all-zero result, encoding may have failed');
    }

    logger.debug(
      {
        pcm16Length: pcm16Data.length,
        opusLength: result.length,
        compression: (pcm16Data.length / result.length).toFixed(2),
        frameCount: opusPackets.length,
        sampleRate,
      },
      'Encoded PCM16 to Opus successfully'
    );

    return result;
  } catch (error) {
    logger.error({ error }, 'Failed to encode PCM16 to Opus');
    throw error;
  }
}

/**
 * 同步版本的 encodePcm16ToOpus（为了向后兼容）
 * 注意：实际上仍然是异步的，但返回 Promise
 * @deprecated 建议使用异步版本
 */
export function encodePcm16ToOpusSync(
  pcm16Data: Buffer,
  sampleRate: number = 16000,
  channels: number = 1
): Buffer {
  // 这个函数实际上无法同步执行，因为需要等待 WASM 初始化
  // 为了向后兼容，我们抛出错误，提示使用异步版本
  throw new Error(
    'encodePcm16ToOpusSync is not supported with @minceraftmc/opus-encoder. ' +
    'Please use encodePcm16ToOpus (async) instead.'
  );
}
