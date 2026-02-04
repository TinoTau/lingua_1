/** 只保留包含 error 的行，过滤 warning/info */
export function filterErrorLines(lastError: string | null | undefined): string | null {
  if (!lastError) return null;
  const errorLines = lastError
    .split('\n')
    .filter(line => {
      const lowerLine = line.toLowerCase();
      return lowerLine.includes('error') && !lowerLine.includes('warning');
    })
    .join('\n')
    .trim();
  return errorLines || null;
}

export function getServiceDisplayName(
  serviceId: string,
  serviceMetadata: Record<string, { name_zh?: string; name?: string; deprecated?: boolean }>
): string {
  const meta = serviceMetadata[serviceId];
  if (meta) {
    let name = meta.name_zh || meta.name;
    if (meta.deprecated) {
      name += ' (已弃用)';
    }
    return name;
  }
  const fallbackMap: Record<string, string> = {
    nmt: 'NMT 翻译服务',
    tts: 'TTS 语音合成 (Piper)',
    yourtts: 'YourTTS 语音克隆',
    faster_whisper_vad: 'FastWhisperVad语音识别服务',
    speaker_embedding: 'Speaker Embedding 服务',
    rust: '节点推理服务 (Rust)',
    'phonetic-correction-zh': '同音纠错服务 (ZH)',
    'punctuation-restore': '断句服务 (中英)',
  };
  return fallbackMap[serviceId] || serviceId;
}

export function getServiceId(serviceName: string): string {
  const map: Record<string, string> = {
    faster_whisper_vad: 'faster-whisper-vad',
    nmt: 'nmt-m2m100',
    tts: 'piper-tts',
    yourtts: 'your-tts',
    speaker_embedding: 'speaker-embedding',
  };
  return map[serviceName] || serviceName;
}

export function formatGpuUsageMs(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  } else if (ms < 60000) {
    return `${(ms / 1000).toFixed(2)}s`;
  } else if (ms < 3600000) {
    return `${(ms / 60000).toFixed(2)}min`;
  } else {
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${hours}h ${minutes}min ${seconds}s`;
  }
}
