/**
 * Recover V2：中文族 ASR 强制 CTC，避免 TaskRouter round-robin 落到 FW（top1-only）。
 */

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
