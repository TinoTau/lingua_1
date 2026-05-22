/**
 * Recover historical-restore-v1 contract unit tests
 */

import { JobAssignMessage } from '@shared/protocols/messages';
import { JobContext } from './context/job-context';
import { buildJobResult } from './result-builder';
import {
  RECOVER_CONTRACT_VERSION_V5,
  buildRecoverContractExtra,
  buildRecoverLifecycleFromCtx,
  buildCtcContract,
} from './recover-contract';

jest.mock('../lexicon/lexicon-runtime-holder', () => ({
  ensureLexiconRuntimeLoaded: jest.fn(() => ({
    status: 'ok',
    manifestVersion: 'recover-v2-hotword-seed-v1',
  })),
}));

describe('recover-contract', () => {
  const baseJob = {
    job_id: 'j1',
    session_id: 's1',
    utterance_index: 0,
    src_lang: 'zh',
    tgt_lang: 'en',
    pipeline: { use_asr: true, use_nmt: true, use_tts: true, use_lexicon: true },
  } as JobAssignMessage;

  it('always emits lexicon_runtime_status and recover_contract_version', () => {
    const ctx: JobContext = {
      repairedText: '你好',
      translatedText: 'hello',
      asrNbest: [
        { rank: 0, text: '你好', score: -1 },
        { rank: 1, text: '您好', score: -2 },
      ],
      asrHypotheses: [{ text: '你好', rank: 0, score: -1, source: 'ctc' }],
      nbestSynthetic: false,
      ctcNbestPreserved: true,
      segmentSynthetic: false,
      lexiconRuntimeStatus: 'ok',
      lexiconManifestVersion: 'recover-v2-hotword-seed-v1',
      recoverLifecycle: { executed: true, gated: false, skipped: false, skipReason: null },
    };

    const result = buildJobResult(baseJob, ctx);
    expect(result.extra?.recover_contract_version).toBe(RECOVER_CONTRACT_VERSION_V5);
    expect(result.extra?.lexicon_runtime_status).toBe('ok');
    expect(result.extra?.recover_lifecycle?.executed).toBe(true);
    expect(result.extra?.sentence_repair).toBeDefined();
    expect(typeof result.extra?.ctc_nbest_preserved).toBe('boolean');
  });

  it('recover lifecycle skipped when lexicon gated off', () => {
    const job = {
      ...baseJob,
      pipeline: { use_asr: true, use_nmt: true, use_tts: true },
    } as JobAssignMessage;
    const lifecycle = buildRecoverLifecycleFromCtx(job, {}, 'job_use_lexicon_false');
    expect(lifecycle.gated).toBe(true);
    expect(lifecycle.executed).toBe(false);
    expect(lifecycle.skipReason).toBe('job_use_lexicon_false');
  });

  it('sentence_repair separates executed and modified', () => {
    const ctx: JobContext = {
      repairedText: '本段',
      translatedText: 'seg',
      lexiconRuntimeStatus: 'ok',
      recoverLifecycle: { executed: true, gated: false, skipped: true, skipReason: 'no_window_expansion_candidate' },
      recoverLifecycleSkipReason: 'no_window_expansion_candidate',
    };
    const contract = buildRecoverContractExtra(baseJob, ctx);
    expect(contract.sentence_repair.executed).toBe(true);
    expect(contract.sentence_repair.modified).toBe(false);
    expect(contract.sentence_repair.skipReason).toBe('no_window_expansion_candidate');
  });

  it('ctc contract preserves true n-best flags', () => {
    const ctx: JobContext = {
      asrNbest: [
        { rank: 0, text: 'a', score: -1 },
        { rank: 1, text: 'b', score: -2 },
      ],
      nbestSynthetic: false,
      ctcNbestPreserved: true,
      segmentSynthetic: true,
      aggregationResyncReason: 'segment_mismatch_ctc_preserved',
    };
    const ctc = buildCtcContract(ctx);
    expect(ctc.nbest_synthetic).toBe(false);
    expect(ctc.ctc_nbest_preserved).toBe(true);
    expect(ctc.segment_synthetic).toBe(true);
  });

  it('modified=false keeps contract fields', () => {
    const ctx: JobContext = {
      repairedText: '未改',
      translatedText: 'unchanged',
      lexiconRuntimeStatus: 'ok',
      recoverLifecycle: { executed: true, gated: false, skipped: false, skipReason: null },
      sentenceRepairExtra: {
        executed: true,
        modified: false,
        candidateSource: 'window_single',
        restore_metrics: {
          phonetic_expanded_sentence_candidates_count: 0,
          picked_from_phonetic_expansion_count: 0,
          picked_from_raw_ctc_nbest_count: 0,
          candidate_source_distribution: {
            raw_ctc_baseline: 0,
            window_single: 0,
            window_pair: 0,
            window_multi: 0,
          },
        },
        selectedText: '未改',
        baselineText: '未改',
        hypothesisIndex: 0,
        top1HypothesisIndex: 0,
        pickedReason: 'none',
        skipReason: null,
        replacements: [],
      },
    };
    const result = buildJobResult(baseJob, ctx);
    expect(result.extra?.sentence_repair?.modified).toBe(false);
    expect(result.extra?.sentence_repair?.executed).toBe(true);
  });
});
