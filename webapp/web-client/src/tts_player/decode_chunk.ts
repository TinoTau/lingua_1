/**
 * TTS 音频块解码：base64 → Float32（PCM16 / Opus）
 * 从 TtsPlayer.addAudioChunk 拆出，不改变行为
 */

import type { AudioCodecConfig, AudioDecoder } from '../audio_codec';
import { createAudioDecoder } from '../audio_codec';

export type DecodeResult = {
  float32: Float32Array;
  decoder: AudioDecoder | null;
};

/**
 * 将 base64 编码的 TTS 音频解码为 Float32Array。
 * 若格式为 opus 会使用并可能更新 decoder；pcm16 不依赖 decoder。
 */
export async function decodeBase64TtsChunk(
  base64Data: string,
  ttsFormat: string,
  sampleRate: number,
  currentTtsFormat: string,
  existingDecoder: AudioDecoder | null
): Promise<DecodeResult> {
  const binaryString = atob(base64Data);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  let decoder: AudioDecoder | null = existingDecoder;
  if (ttsFormat !== currentTtsFormat || !decoder) {
    const codecConfig: AudioCodecConfig = {
      codec: ttsFormat === 'opus' ? 'opus' : 'pcm16',
      sampleRate,
      channelCount: 1,
    };
    decoder = createAudioDecoder(codecConfig);
  }

  let float32Array: Float32Array;
  if (ttsFormat === 'opus') {
    if (!decoder) {
      throw new Error('Opus decoder not initialized');
    }
    float32Array = await decoder.decode(bytes);
  } else {
    const int16Array = new Int16Array(bytes.buffer);
    float32Array = new Float32Array(int16Array.length);
    for (let i = 0; i < int16Array.length; i++) {
      float32Array[i] = int16Array[i] / 32768.0;
    }
  }

  return { float32: float32Array, decoder };
}
