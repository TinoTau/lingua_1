/**
 * WAV 解析与 PCM16 转换
 * 从 opus-encoder.ts 迁出，仅迁移实现，不改变接口。
 */

/**
 * 将 PCM16 (Int16Array) 转换为 Float32Array
 * @param pcm16Data PCM16 音频数据（Buffer）
 * @returns Float32Array 音频数据（范围 [-1.0, 1.0]）
 */
export function pcm16ToFloat32(pcm16Data: Buffer): Float32Array {
  const int16Array = new Int16Array(
    pcm16Data.buffer,
    pcm16Data.byteOffset,
    pcm16Data.length / 2
  );
  const float32Array = new Float32Array(int16Array.length);
  for (let i = 0; i < int16Array.length; i++) {
    float32Array[i] = Math.max(-1.0, Math.min(1.0, int16Array[i] / 32768.0));
  }
  return float32Array;
}

/**
 * 解析 WAV 文件，提取 PCM16 音频数据
 */
export function parseWavFile(wavBuffer: Buffer): { pcm16Data: Buffer; sampleRate: number; channels: number } {
  if (wavBuffer.length < 44) {
    throw new Error('Invalid WAV file: too short');
  }

  const riffHeader = wavBuffer.toString('ascii', 0, 4);
  if (riffHeader !== 'RIFF') {
    throw new Error('Invalid WAV file: missing RIFF header');
  }

  const waveHeader = wavBuffer.toString('ascii', 8, 12);
  if (waveHeader !== 'WAVE') {
    throw new Error('Invalid WAV file: missing WAVE header');
  }

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

  const pcm16Data = wavBuffer.subarray(dataOffset, dataOffset + dataSize);

  return {
    pcm16Data,
    sampleRate,
    channels,
  };
}
