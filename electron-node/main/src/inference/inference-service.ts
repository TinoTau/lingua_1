import { ModelManager } from '../model-manager/model-manager';

export interface Job {
  job_id: string;
  session_id: string;
  utterance_index: number;
  src_lang: string;
  tgt_lang: string;
  audio_data: string; // base64 encoded
}

export interface JobResult {
  transcript: string;
  translation: string;
  audio: string; // base64 encoded TTS audio
}

export class InferenceService {
  private modelManager: ModelManager;
  private currentJobs: Set<string> = new Set();

  constructor(modelManager: ModelManager) {
    this.modelManager = modelManager;
  }

  async processJob(job: Job): Promise<JobResult> {
    this.currentJobs.add(job.job_id);

    try {
      // TODO: 实现实际的推理逻辑
      // 1. 解码音频数据
      // 2. 运行 ASR（语音识别）
      // 3. 运行 NMT（机器翻译）
      // 4. 运行 TTS（语音合成）
      // 5. 返回结果

      // 临时返回模拟结果
      const result: JobResult = {
        transcript: '模拟识别文本',
        translation: 'Mock translation text',
        audio: '', // base64 encoded audio
      };

      return result;
    } finally {
      this.currentJobs.delete(job.job_id);
    }
  }

  getCurrentJobCount(): number {
    return this.currentJobs.size;
  }

  getInstalledModels(): string[] {
    return this.modelManager.getInstalledModels().map(m => m.model_id);
  }
}

