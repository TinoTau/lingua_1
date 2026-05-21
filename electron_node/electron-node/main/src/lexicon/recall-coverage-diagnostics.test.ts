import { buildRecallCoverageDiagnostics } from './recall-coverage-diagnostics';
import { emptyWindowRecallDiagnostics } from './window-recall-diagnostics';

describe('buildRecallCoverageDiagnostics', () => {
  it('有 WindowCandidate 时返回 null', () => {
    const d = emptyWindowRecallDiagnostics();
    d.windowCandidateCount = 1;
    const runtime = {
      getConfusionObservedStrings: () => ['候选生成'],
    } as never;
    expect(buildRecallCoverageDiagnostics('我们要做后选生城', runtime, d)).toBeNull();
  });

  it('无窗时输出 closestObserved', () => {
    const d = emptyWindowRecallDiagnostics();
    d.windowCandidateCount = 0;
    d.noWindowBucket = 'no_observed_substring';
    d.windowsEnumerated = 12;
    const runtime = {
      getConfusionObservedStrings: () => ['候选生成', '上线计划'],
      recallHotwordsByObserved: () => [],
    } as never;
    const cov = buildRecallCoverageDiagnostics('我们要做后选生城流程', runtime, d);
    expect(cov?.closestObserved).toBeTruthy();
    expect(cov?.whyRejected).toBeTruthy();
    expect(cov?.sampleWindowText.length).toBeGreaterThan(0);
  });
});
