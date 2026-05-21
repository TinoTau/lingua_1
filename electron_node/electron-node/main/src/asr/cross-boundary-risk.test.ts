import { buildCrossBoundaryRiskReport } from './cross-boundary-risk';

describe('buildCrossBoundaryRiskReport', () => {
  it('单 chunk 不报告', () => {
    expect(buildCrossBoundaryRiskReport('你好世界', ['世界'])).toBeNull();
  });

  it('跨边界 observed 报告风险', () => {
    const segment = '一二，三四';
    const report = buildCrossBoundaryRiskReport(segment, ['二，三']);
    expect(report?.crossBoundaryRisk).toBe(true);
    expect(report?.leftSegment).toBe('一二');
    expect(report?.rightSegment).toBe('三四');
    expect(report?.possibleObserved).toBe('二，三');
  });

  it('observed 完全落在单 chunk 内不报告', () => {
    const segment = '今天天气，很好';
    expect(buildCrossBoundaryRiskReport(segment, ['今天天气'])).toBeNull();
  });
});
