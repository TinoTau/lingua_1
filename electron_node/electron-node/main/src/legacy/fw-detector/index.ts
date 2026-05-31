/**
 * @deprecated Rollback-only FW detector chain (P1.2b per-span topK + weak_veto).
 * Not on frozen default path when useSentenceLevelRerank=true.
 */

export { runFwTopKDecisionPipeline } from './fw-topk-decision-pipeline';
export type { FwTopKDecisionInput, FwTopKDecisionResult } from './fw-topk-decision-pipeline';
