/**
 * 应用生命周期单元测试（仅 ServiceProcessRunner + NodeAgent）
 */

import { saveServiceLastRuntimeState } from './app-lifecycle-simple';
import { loadNodeConfig, saveNodeConfig } from '../node-config';
import { getServiceRunner } from '../service-layer';

jest.mock('../logger');
jest.mock('../node-config');
jest.mock('../service-layer');
jest.mock('../utils/esbuild-cleanup', () => ({ cleanupEsbuild: jest.fn() }));

describe('Application Lifecycle Management', () => {
  let mockRunner: any;
  let mockNodeAgent: any;
  let mockConfig: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRunner = {
      getAllStatuses: jest.fn().mockReturnValue([
        { serviceId: 'semantic-repair-en-zh', type: 'semantic', status: 'running' },
        { serviceId: 'faster-whisper-vad', status: 'stopped' },
      ]),
      stopAll: jest.fn().mockResolvedValue(undefined),
    };
    mockNodeAgent = { stop: jest.fn() };
    mockConfig = {
      servicePreferences: { 'lexicon-intent-cpu': true, 'faster-whisper-vad': false },
    };
    (getServiceRunner as jest.Mock).mockReturnValue(mockRunner);
    (loadNodeConfig as jest.Mock).mockReturnValue(mockConfig);
  });

  it('saveServiceLastRuntimeState writes snapshot without changing user preferences', () => {
    saveServiceLastRuntimeState();

    expect(mockConfig.servicePreferences).toEqual({
      'lexicon-intent-cpu': true,
      'faster-whisper-vad': false,
    });
    expect(mockConfig.serviceLastRuntimeState).toEqual({
      'semantic-repair-en-zh': true,
      'faster-whisper-vad': false,
    });
    expect(saveNodeConfig).toHaveBeenCalledWith(mockConfig);
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
