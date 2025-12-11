import { ModelManager } from '../model-manager/model-manager';
import type { JobAssignMessage } from '../../../shared/protocols/messages';
import type { InstalledModel, FeatureFlags } from '../../../shared/protocols/messages';

export interface JobResult {
  text_asr: string;
  text_translated: string;
  tts_audio: string; // base64 encoded TTS audio
  tts_format?: string;
  extra?: {
    emotion?: string | null;
    speech_rate?: number | null;
    voice_style?: string | null;
    [key: string]: unknown;
  };
}

export class InferenceService {
  private modelManager: ModelManager;
  private currentJobs: Set<string> = new Set();

  constructor(modelManager: ModelManager) {
    this.modelManager = modelManager;
  }

  async processJob(job: JobAssignMessage): Promise<JobResult> {
    this.currentJobs.add(job.job_id);

    try {
      // TODO: 实现实际的推理逻辑
      // 1. 解码音频数据（从 base64）
      // 2. 运行 ASR（语音识别）
      // 3. 运行 NMT（机器翻译）
      // 4. 运行 TTS（语音合成）
      // 5. 处理可选功能模块（如果启用）
      // 6. 返回结果

      // 临时返回模拟结果
      const result: JobResult = {
        text_asr: '模拟识别文本',
        text_translated: 'Mock translation text',
        tts_audio: '', // base64 encoded audio
        tts_format: job.audio_format || 'pcm16',
        extra: job.features ? {
          emotion: job.features.emotion_detection ? 'neutral' : null,
          speech_rate: job.features.speech_rate_detection ? 1.0 : null,
          voice_style: job.features.voice_style_detection ? 'neutral' : null,
        } : undefined,
      };

      return result;
    } finally {
      this.currentJobs.delete(job.job_id);
    }
  }

  getCurrentJobCount(): number {
    return this.currentJobs.size;
  }

  getInstalledModels(): InstalledModel[] {
    // 从 ModelManager 获取已安装的模型，转换为协议格式
    const installed = this.modelManager.getInstalledModels();
    
    // TODO: 需要从 ModelManager 获取完整的模型元数据（包括 kind, src_lang, tgt_lang, dialect）
    // 目前返回基本结构，实际应该从 ModelMetadata 中获取完整信息
    return installed.map(m => {
      // 从 model_id 推断模型类型（临时方案，实际应该从元数据获取）
      let kind: 'asr' | 'nmt' | 'tts' | 'vad' | 'emotion' | 'other' = 'other';
      if (m.model_id.includes('asr') || m.model_id.includes('whisper')) {
        kind = 'asr';
      } else if (m.model_id.includes('nmt') || m.model_id.includes('m2m')) {
        kind = 'nmt';
      } else if (m.model_id.includes('tts') || m.model_id.includes('piper')) {
        kind = 'tts';
      } else if (m.model_id.includes('vad') || m.model_id.includes('silero')) {
        kind = 'vad';
      } else if (m.model_id.includes('emotion')) {
        kind = 'emotion';
      }

      return {
        model_id: m.model_id,
        kind: kind,
        src_lang: null, // TODO: 从元数据获取
        tgt_lang: null, // TODO: 从元数据获取
        dialect: null, // TODO: 从元数据获取
        version: m.version || '1.0.0',
        enabled: true, // TODO: 从配置获取
      };
    });
  }

  getFeaturesSupported(): FeatureFlags {
    // TODO: 根据实际安装的模型和启用的模块返回支持的功能
    // 这里返回一个示例，实际应该根据模型和模块状态动态生成
    return {
      emotion_detection: false,
      voice_style_detection: false,
      speech_rate_detection: false,
      speech_rate_control: false,
      speaker_identification: false,
      persona_adaptation: false,
    };
  }
}

