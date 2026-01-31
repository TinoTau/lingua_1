/**
 * Phase 2 测试：SemanticRepairStage（统一入口）
 * 验证语义修复Stage的语言路由功能
 */

import { SemanticRepairStage } from './semantic-repair-stage';
import { SemanticRepairServiceInfo } from '../node-agent-services-semantic-repair';
import { JobAssignMessage } from '@shared/protocols/messages';
import { TaskRouter } from '../../task-router/task-router';
import { SemanticRepairStageZH } from './semantic-repair-stage-zh';
import { SemanticRepairStageEN } from './semantic-repair-stage-en';
import { EnNormalizeStage } from './en-normalize-stage';

jest.mock('./semantic-repair-stage-zh');
jest.mock('./semantic-repair-stage-en');
jest.mock('./en-normalize-stage');

describe('SemanticRepairStage - Phase 2', () => {
  let stage: SemanticRepairStage;
  let mockTaskRouter: TaskRouter | null;
  let mockInstalledServices: SemanticRepairServiceInfo;
  let mockConfig: any;

  beforeEach(() => {
    mockTaskRouter = {} as TaskRouter;
    mockInstalledServices = {
      zh: true,
      en: true,
      enNormalize: true,
      services: [
        { serviceId: 'semantic-repair-zh', status: 'running' },
        { serviceId: 'semantic-repair-en', status: 'running' },
        { serviceId: 'en-normalize', status: 'running' },
      ],
    };
    mockConfig = {
      zh: { enabled: true, qualityThreshold: 0.70 },
      en: { normalizeEnabled: true, repairEnabled: true, qualityThreshold: 0.70 },
    };

    // Mock子Stage的process方法
    (SemanticRepairStageZH as jest.MockedClass<typeof SemanticRepairStageZH>).mockImplementation(() => ({
      process: jest.fn().mockResolvedValue({
        textOut: '修复后的中文文本',
        decision: 'REPAIR' as const,
        confidence: 0.85,
        reasonCodes: ['LOW_QUALITY_SCORE'],
      }),
    } as any));

    (SemanticRepairStageEN as jest.MockedClass<typeof SemanticRepairStageEN>).mockImplementation(() => ({
      process: jest.fn().mockResolvedValue({
        textOut: 'Repaired English text',
        decision: 'REPAIR' as const,
        confidence: 0.90,
        reasonCodes: ['LOW_QUALITY_SCORE'],
      }),
    } as any));

    (EnNormalizeStage as jest.MockedClass<typeof EnNormalizeStage>).mockImplementation(() => ({
      process: jest.fn().mockResolvedValue({
        normalizedText: 'Normalized text',
        normalized: true,
        reasonCodes: ['NUMBER_NORMALIZED'],
      }),
    } as any));

    stage = new SemanticRepairStage(mockTaskRouter, mockInstalledServices, mockConfig);
  });

  const createJob = (srcLang: string = 'zh'): JobAssignMessage => ({
    job_id: 'job_123',
    session_id: 'session_456',
    utterance_index: 0,
    src_lang: srcLang,
    tgt_lang: 'en',
    trace_id: 'trace_789',
  } as JobAssignMessage);

  describe('process', () => {
    it('应该在文本为空时返回PASS', async () => {
      const job = createJob();
      const result = await stage.process(job, '', 0.8);

      expect(result.textOut).toBe('');
      expect(result.decision).toBe('PASS');
      expect(result.confidence).toBe(1.0);
      expect(result.reasonCodes).toContain('EMPTY_TEXT');
    });

    it('应该正确路由中文文本到SemanticRepairStageZH', async () => {
      const job = createJob('zh');
      const result = await stage.process(job, '测试文本', 0.65);

      expect(result.textOut).toBe('修复后的中文文本');
      expect(result.decision).toBe('REPAIR');
      expect(result.confidence).toBe(0.85);
      expect(result.semanticRepairApplied).toBe(true);
    });

    it('应该正确路由英文文本到EnNormalizeStage和SemanticRepairStageEN', async () => {
      const job = createJob('en');
      const result = await stage.process(job, 'Hello world', 0.65);

      expect(result.textOut).toBe('Repaired English text');
      expect(result.decision).toBe('REPAIR');
      expect(result.confidence).toBe(0.90);
      expect(result.semanticRepairApplied).toBe(true);
    });

    it('应该在不支持的语言时抛出 SEM_REPAIR_UNSUPPORTED_LANG', async () => {
      const job = createJob('fr');
      await expect(stage.process(job, 'Bonjour', 0.8)).rejects.toThrow('SEM_REPAIR_UNSUPPORTED_LANG');
    });

    it('应该在中文Stage不可用时抛出 SEM_REPAIR_UNAVAILABLE', async () => {
      const servicesWithoutZH: SemanticRepairServiceInfo = {
        ...mockInstalledServices,
        zh: false,
      };
      const stageWithoutZH = new SemanticRepairStage(mockTaskRouter, servicesWithoutZH, mockConfig);

      const job = createJob('zh');
      await expect(stageWithoutZH.process(job, '测试文本', 0.65)).rejects.toThrow('SEM_REPAIR_UNAVAILABLE');
    });

    it('应该在 ZH stage 错误时抛出（不降级为 PASS）', async () => {
      (SemanticRepairStageZH as jest.MockedClass<typeof SemanticRepairStageZH>).mockImplementation(() => ({
        process: jest.fn().mockRejectedValue(new Error('Service error')),
      } as any));

      const servicesWithError: SemanticRepairServiceInfo = {
        ...mockInstalledServices,
        zh: true,
      };
      const stageWithError = new SemanticRepairStage(mockTaskRouter, servicesWithError, mockConfig);

      const job = createJob('zh');
      await expect(stageWithError.process(job, '测试文本', 0.65)).rejects.toThrow('Service error');
    });
  });
});
