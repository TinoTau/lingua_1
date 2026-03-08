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
  // 仅当元数据缺失时用 serviceId 友好名回退（用户安装的服务以 registry 元数据为准）
  const fallbackMap: Record<string, string> = {
    'nmt-m2m100': 'NMT 翻译服务',
    'piper-tts': 'TTS 语音合成 (Piper)',
    'your-tts': 'YourTTS 语音克隆',
    'faster-whisper-vad': 'FastWhisperVad 语音识别',
    'asr-sherpa-lm': 'ASR Sherpa-LM (多语言 CTC)',
    'asr-sherpa-en': 'ASR Sherpa English CTC',
    'speaker-embedding': 'Speaker Embedding 服务',
    'phonetic-correction-zh': '同音纠错服务 (ZH)',
    'punctuation-restore': '断句服务 (中英)',
    'semantic-repair-en-zh': '语义修复 (中英)',
  };
  return fallbackMap[serviceId] || serviceId;
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
