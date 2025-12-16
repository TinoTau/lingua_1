import { useState, useRef } from 'react';

export function useVAD() {
  const [audioBuffer, setAudioBuffer] = useState<Float32Array | null>(null);
  const bufferRef = useRef<Float32Array[]>([]);

  const detectSpeech = async (audioData: Float32Array): Promise<boolean> => {
    // TODO: 实现轻量 VAD 检测
    // 使用 WebRTC VAD 或简单的能量阈值检测
    
    // 简化实现：基于能量阈值
    const energy = calculateEnergy(audioData);
    const threshold = 0.01; // 可调整的阈值
    
    return energy > threshold;
  };

  const calculateEnergy = (audioData: Float32Array): number => {
    let sum = 0;
    for (let i = 0; i < audioData.length; i++) {
      sum += audioData[i] * audioData[i];
    }
    return Math.sqrt(sum / audioData.length);
  };

  return {
    detectSpeech,
    audioBuffer,
  };
}

