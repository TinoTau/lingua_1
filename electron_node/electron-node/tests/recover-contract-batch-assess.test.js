const { assessContractPass } = require('./lib/recover-contract-assess');

describe('recover contract batch assess', () => {
  it('passes when modified=0 but contract complete', () => {
    const extra = {
      recover_contract_version: 'historical-restore-v1',
      lexicon_runtime_status: 'ok',
      recover_lifecycle: { executed: true, gated: false, skipped: true, skipReason: 'no_window_expansion_candidate' },
      sentence_repair: {
        executed: true,
        modified: false,
        selectedText: '你好',
        replacements: [],
      },
      ctc_nbest_preserved: true,
      nbest_synthetic: false,
      segment_synthetic: false,
      asr_nbest_count: 4,
    };
    const result = assessContractPass(extra, { text_asr: '你好', text_translated: 'hello' });
    expect(result.pass).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it('fails when required contract field missing', () => {
    const result = assessContractPass({}, { text_asr: 'x', text_translated: 'y' });
    expect(result.pass).toBe(false);
    expect(result.failures.length).toBeGreaterThan(0);
  });

  it('fails on modified without replacement', () => {
    const extra = {
      recover_contract_version: 'historical-restore-v1',
      lexicon_runtime_status: 'ok',
      recover_lifecycle: { executed: true, gated: false, skipped: false, skipReason: null },
      sentence_repair: {
        executed: true,
        modified: true,
        selectedText: '改后',
        replacements: [],
        candidateSource: 'window_single',
      },
      ctc_nbest_preserved: true,
      nbest_synthetic: false,
      segment_synthetic: false,
      asr_nbest_count: 4,
    };
    const result = assessContractPass(extra, { text_asr: '改后', text_translated: 'x' });
    expect(result.pass).toBe(false);
    expect(result.failures).toContain('modified_without_replacement');
  });

  it('fails on ctc nbest lost', () => {
    const extra = {
      recover_contract_version: 'historical-restore-v1',
      lexicon_runtime_status: 'ok',
      recover_lifecycle: { executed: true, gated: false, skipped: false, skipReason: null },
      sentence_repair: { executed: true, modified: false },
      ctc_nbest_preserved: false,
      nbest_synthetic: false,
      segment_synthetic: false,
      asr_nbest_count: 4,
    };
    const result = assessContractPass(extra, { text_asr: 'x', text_translated: 'y' });
    expect(result.pass).toBe(false);
    expect(result.failures).toContain('ctc_nbest_lost');
  });
});
