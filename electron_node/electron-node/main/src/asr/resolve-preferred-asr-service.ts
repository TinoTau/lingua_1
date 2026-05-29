/**
 * ASR 服务偏好：FW-only 模式固定 faster-whisper-vad；否则 Recover CTC 路由。
 */

import { isFwDetectorEngineEnabled } from '../fw-detector/fw-mode';

const FW_SERVICE = 'faster-whisper-vad';
const CTC_ZH_SERVICE = 'asr-sherpa-lm';
const CTC_EN_SERVICE = 'asr-sherpa-en';

function langBase(lang: string): string {
  return lang.toLowerCase().split('-')[0];
}

/**
 * @param effectiveSrcLang LID 或 job 明确源语言；auto 且无 LID 时为 undefined
 */
export function resolvePreferredAsrServiceId(
  effectiveSrcLang: string | undefined
): string | undefined {
  if (isFwDetectorEngineEnabled()) {
    return FW_SERVICE;
  }

  if (!effectiveSrcLang?.trim()) {
    return CTC_ZH_SERVICE;
  }
  const base = langBase(effectiveSrcLang);
  if (base === 'en') {
    return CTC_EN_SERVICE;
  }
  if (base === 'zh' || base === 'yue') {
    return CTC_ZH_SERVICE;
  }
  return undefined;
}
