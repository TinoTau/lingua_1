import { buildRecallCoverageDiagnostics } from './recall-coverage-diagnostics';
import { emptyWindowRecallDiagnostics } from './window-recall-diagnostics';

describe('buildRecallCoverageDiagnostics', () => {
  it('有 WindowCandidate 时返回 null', () => {
    const d = emptyWindowRecallDiagnostics();
    d.windowCandidateCount = 1;
    const runtime = {} as never;
    expect(buildRecallCoverageDiagnostics('我们要做后选生城', runtime, d)).toBeNull();
  });

  it('无窗时输出 canonical-only 诊断', () => {
    const d = emptyWindowRecallDiagnostics();
    d.windowCandidateCount = 0;
    d.noWindowBucket = 'no_observed_substring';
    d.windowsEnumerated = 12;
    const runtime = {} as never;
    const cov = buildRecallCoverageDiagnostics('我们要做后选生城流程', runtime, d);
    expect(cov?.whyRejected).toBeTruthy();
    expect(cov?.sampleWindowText.length).toBeGreaterThan(0);
  });
});
