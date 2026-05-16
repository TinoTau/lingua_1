import {
  checkEnhancementService,
  ENHANCEMENT_SERVICE_IDS,
} from './enhancement-gate';
import { setServiceRegistry } from '../service-layer/ServiceRegistrySingleton';
import type { ServiceRegistry, ServiceEntry } from '../service-layer/ServiceTypes';

function mockRegistry(runningIds: string[]): ServiceRegistry {
  const map = new Map<string, ServiceEntry>();
  for (const id of runningIds) {
    map.set(id, {
      def: { id, name: id, type: 'test', exec: { command: 'x', args: [], cwd: '.' } },
      runtime: { status: 'running' },
      installPath: '/tmp',
    });
  }
  return map;
}

describe('checkEnhancementService', () => {
  beforeEach(() => {
    setServiceRegistry(mockRegistry([ENHANCEMENT_SERVICE_IDS.PHONETIC]));
  });

  it('enabled=false → DISABLED', () => {
    expect(checkEnhancementService(ENHANCEMENT_SERVICE_IDS.PHONETIC, false)).toEqual({
      shouldRun: false,
      skipReason: 'DISABLED',
    });
  });

  it('not registered → NOT_REGISTERED', () => {
    expect(checkEnhancementService('missing-service', true)).toEqual({
      shouldRun: false,
      skipReason: 'NOT_REGISTERED',
    });
  });

  it('registered but stopped → NOT_RUNNING', () => {
    setServiceRegistry(mockRegistry([]));
    const map = mockRegistry([]);
    map.set(ENHANCEMENT_SERVICE_IDS.PHONETIC, {
      def: {
        id: ENHANCEMENT_SERVICE_IDS.PHONETIC,
        name: 'p',
        type: 'test',
        exec: { command: 'x', args: [], cwd: '.' },
      },
      runtime: { status: 'stopped' },
      installPath: '/tmp',
    });
    setServiceRegistry(map);
    expect(checkEnhancementService(ENHANCEMENT_SERVICE_IDS.PHONETIC, true)).toEqual({
      shouldRun: false,
      skipReason: 'NOT_RUNNING',
    });
  });

  it('running → shouldRun true', () => {
    expect(checkEnhancementService(ENHANCEMENT_SERVICE_IDS.PHONETIC, true)).toEqual({
      shouldRun: true,
    });
  });
});
