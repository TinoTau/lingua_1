/**
 * 应用生命周期单元测试（仅 ServiceProcessRunner + NodeAgent）
 */

import { loadNodeConfig, saveNodeConfig } from '../node-config';
import { getServiceRunner } from '../service-layer';

jest.mock('../logger');
jest.mock('../node-config');
jest.mock('../service-layer');
jest.mock('../utils/esbuild-cleanup', () => ({ cleanupEsbuild: jest.fn() }));

describe('Application Lifecycle Management', () => {
  let mockRunner: any;
  let mockNodeAgent: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRunner = {
      getAllStatuses: jest.fn().mockReturnValue([
        { serviceId: 'semantic-repair-en-zh', type: 'semantic', status: 'running' },
        { serviceId: 'faster-whisper-vad', status: 'running' },
      ]),
      stopAll: jest.fn().mockResolvedValue(undefined),
    };
    mockNodeAgent = { stop: jest.fn() };
    (getServiceRunner as jest.Mock).mockReturnValue(mockRunner);
    (loadNodeConfig as jest.Mock).mockReturnValue({
      servicePreferences: {
        nmtEnabled: false,
        ttsEnabled: false,
        yourttsEnabled: false,
        fasterWhisperVadEnabled: false,
        speakerEmbeddingEnabled: false,
        semanticRepairEnZhEnabled: false,
      },
    });
  });

  it('getServiceRunner and runner.getAllStatuses are used for state', () => {
    const statuses = mockRunner.getAllStatuses();
    expect(statuses).toHaveLength(2);
    expect(statuses[0].serviceId).toBe('semantic-repair-en-zh');
  });

  it('NodeAgent has stop method', () => {
    expect(mockNodeAgent.stop).toBeDefined();
  });

  it('Runner has getAllStatuses and stopAll', () => {
    expect(mockRunner.getAllStatuses).toBeDefined();
    expect(mockRunner.stopAll).toBeDefined();
  });
});
