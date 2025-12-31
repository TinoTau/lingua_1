/**
 * 测试 type 级能力聚合逻辑（capability_by_type）
 */
import { describe, it, expect, jest } from '@jest/globals';
import { ServiceType, ServiceStatus, DeviceType } from '../../../shared/protocols/messages';
import { NodeAgent } from '../../main/src/agent/node-agent';

// 轻量级 logger mock（jest.config 已映射到 __mocks__/logger.ts，这里仅确保类型存在）
jest.mock('../../main/src/logger', () => ({
  __esModule: true,
  default: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

type InstalledServiceLite = {
  service_id: string;
  type: ServiceType;
  device: DeviceType;
  status: ServiceStatus;
};

// 构造 NodeAgent，所需依赖全部使用最小桩实现
function createAgent(): NodeAgent {
  const dummyInferenceService: any = {
    getInstalledModels: async () => [],
    getCurrentJobCount: () => 0,
    getFeaturesSupported: () => ({}),
    setAggregatorManager: jest.fn(), // 添加缺失的方法
    setAggregatorMiddleware: jest.fn(), // 添加缺失的方法
  };
  return new NodeAgent(dummyInferenceService, undefined, undefined, undefined, undefined);
}

describe('capability_by_type aggregation', () => {
  it('ASR ready when there is GPU+running impl', async () => {
    const agent = createAgent() as any;
    const installed: InstalledServiceLite[] = [
      { service_id: 'faster-whisper-vad', type: ServiceType.ASR, device: 'gpu', status: 'running' },
    ];
    const res = await agent.getCapabilityByType(installed);
    const asr = res.find((c: any) => c.type === ServiceType.ASR);
    expect(asr?.ready).toBe(true);
    expect(asr?.ready_impl_ids).toContain('faster-whisper-vad');
  });

  it('ASR not ready when only CPU running', async () => {
    const agent = createAgent() as any;
    const installed: InstalledServiceLite[] = [
      { service_id: 'faster-whisper-vad', type: ServiceType.ASR, device: 'cpu', status: 'running' },
    ];
    const res = await agent.getCapabilityByType(installed);
    const asr = res.find((c: any) => c.type === ServiceType.ASR);
    expect(asr?.ready).toBe(false);
    expect(asr?.reason).toBe('only_cpu_running');
  });

  it('ASR not ready when GPU impl installed but not running', async () => {
    const agent = createAgent() as any;
    const installed: InstalledServiceLite[] = [
      { service_id: 'faster-whisper-vad', type: ServiceType.ASR, device: 'gpu', status: 'stopped' },
    ];
    const res = await agent.getCapabilityByType(installed);
    const asr = res.find((c: any) => c.type === ServiceType.ASR);
    expect(asr?.ready).toBe(false);
    expect(asr?.reason).toBe('gpu_impl_not_running');
  });

  it('ASR not ready when no impl', async () => {
    const agent = createAgent() as any;
    const installed: InstalledServiceLite[] = [];
    const res = await agent.getCapabilityByType(installed);
    const asr = res.find((c: any) => c.type === ServiceType.ASR);
    expect(asr?.ready).toBe(false);
    expect(asr?.reason).toBe('no_impl');
  });

  it('Multiple types: ASR ready, TTS not ready', async () => {
    const agent = createAgent() as any;
    const installed: InstalledServiceLite[] = [
      { service_id: 'node-inference', type: ServiceType.ASR, device: 'gpu', status: 'running' },
      { service_id: 'piper-tts', type: ServiceType.TTS, device: 'gpu', status: 'stopped' },
    ];
    const res = await agent.getCapabilityByType(installed);
    const asr = res.find((c: any) => c.type === ServiceType.ASR);
    const tts = res.find((c: any) => c.type === ServiceType.TTS);
    expect(asr?.ready).toBe(true);
    expect(tts?.ready).toBe(false);
    expect(tts?.reason).toBe('gpu_impl_not_running');
  });
});

