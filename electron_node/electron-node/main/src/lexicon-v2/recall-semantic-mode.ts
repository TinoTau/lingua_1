/**
 * Explicit Recall semantic mode (LINGUA-ACP-MODEL3-RETRY-STAGE2-TONE-RELAXATION-V1).
 * Do not infer recovery from missing Tone patterns.
 */

/** First-pass / default: Mandatory Tone exact (Batch 1.1C). */
export const RECALL_MODE_TONE_EXACT = 'tone_exact' as const;

/**
 * Model3 RETRY Stage2 only: pinyin required, Tone hard gate off,
 * retainedDomains preserved as domainIds.
 */
export const RECALL_MODE_MODEL3_RETRY_PINYIN_DOMAIN_RECOVERY =
  'model3_retry_pinyin_domain_recovery' as const;

export type RecallSemanticMode =
  | typeof RECALL_MODE_TONE_EXACT
  | typeof RECALL_MODE_MODEL3_RETRY_PINYIN_DOMAIN_RECOVERY;

export function isModel3RetryPinyinDomainRecovery(
  mode: RecallSemanticMode | undefined
): boolean {
  return mode === RECALL_MODE_MODEL3_RETRY_PINYIN_DOMAIN_RECOVERY;
}
