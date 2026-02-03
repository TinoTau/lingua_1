/**
 * 房间模式下 TTS 音频处理（base64 → 混控器）
 * 从 App 拆出，保持行为不变
 */

import { AudioMixer } from '../audio_mixer';

/**
 * 将 base64 TTS 音频解码并送入音频混控器
 */
export async function addTtsAudioToMixer(
  audioMixer: AudioMixer,
  base64Audio: string
): Promise<void> {
  try {
    const binaryString = atob(base64Audio);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const int16Array = new Int16Array(bytes.buffer);
    const float32Array = new Float32Array(int16Array.length);
    for (let i = 0; i < int16Array.length; i++) {
      float32Array[i] = int16Array[i] / 32768.0;
    }
    await audioMixer.addTtsAudio(float32Array);
  } catch (error) {
    console.error('处理 TTS 音频失败:', error);
  }
}
