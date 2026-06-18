import { describe, expect, it, jest } from '@jest/globals';

jest.mock('../node-config', () => ({
  loadNodeConfig: jest.fn(),
}));

import { loadNodeConfig } from '../node-config';
import { loadFwDetectorRuntimeConfig } from './fw-config';

const mockedLoadNodeConfig = loadNodeConfig as jest.MockedFunction<typeof loadNodeConfig>;

describe('loadFwDetectorRuntimeConfig kenlm subprocess', () => {
  it('legacy field names → compat read', () => {
    mockedLoadNodeConfig.mockReturnValue({
      features: {
        fwDetector: {
          kenlmBatchSubprocessTimeoutMs: 3000,
          kenlmBatchSubprocessMaxSentences: 10,
        },
      },
    });

    const cfg = loadFwDetectorRuntimeConfig();
    expect(cfg.kenlmSubprocessTimeoutMs).toBe(3000);
    expect(cfg.kenlmSubprocessMaxLines).toBe(10);
  });

  it('new field names take priority over legacy', () => {
    mockedLoadNodeConfig.mockReturnValue({
      features: {
        fwDetector: {
          kenlmSubprocessTimeoutMs: 4000,
          kenlmSubprocessMaxLines: 12,
          kenlmBatchSubprocessTimeoutMs: 3000,
          kenlmBatchSubprocessMaxSentences: 10,
        },
      },
    });

    const cfg = loadFwDetectorRuntimeConfig();
    expect(cfg.kenlmSubprocessTimeoutMs).toBe(4000);
    expect(cfg.kenlmSubprocessMaxLines).toBe(12);
  });
});
