import { classifyNoWindowBucket } from './no-window-bucket';
import { emptyWindowRecallDiagnostics } from './window-recall-diagnostics';

describe('classifyNoWindowBucket', () => {
  it('labels no observed substring when no confusion spans', () => {
    const diagnostics = emptyWindowRecallDiagnostics();
    diagnostics.confusionSpansOnSegment = 0;
    diagnostics.confusionSpansFuzzyOnSegment = 0;
    expect(
      classifyNoWindowBucket({
        segmentTextLength: 20,
        diagnostics,
        confusionObservedCount: 10,
      })
    ).toBe('no_observed_substring');
  });
});
