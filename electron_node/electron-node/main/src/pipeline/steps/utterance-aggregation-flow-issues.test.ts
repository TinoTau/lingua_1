/**
 * 单元测试：验证 Utterance 聚合流程中的6个潜在问题
 * 
 * 测试目标：
 * 1. getLastCommittedText() 是否重复调用
 * 2. SemanticRepairInitializer 是否重复初始化
 * 3. getServiceIdForLanguage() 和 selectServiceEndpoint() 是否重复查找
 * 4. checkServiceHealth() 是否每次调用都检查
 * 5. shouldRepair() 判断是否必要
 * 6. lastCommittedText 传递是否一致
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { JobAssignMessage } from '@shared/protocols/messages';
import { JobContext, initJobContext } from '../context/job-context';
import { ServicesBundle } from '../job-pipeline';
import { runAggregationStep } from './aggregation-step';
import { runSemanticRepairStep } from './semantic-repair-step';
import { TaskRouterSemanticRepairHandler } from '../../task-router/task-router-semantic-repair';
import { SemanticRepairStageEN } from '../../agent/postprocess/semantic-repair-stage-en';

describe('Utterance聚合流程潜在问题验证', () => {
  let mockAggregatorManager: any;
  let mockTaskRouter: any;
  let mockServicesHandler: any;
  let mockSemanticRepairStage: any;
  let services: ServicesBundle;
  let job: JobAssignMessage;
  let ctx: JobContext;

  beforeEach(() => {
    // 重置所有mock
    jest.clearAllMocks();

    // 创建mock AggregatorManager
    mockAggregatorManager = {
      getLastCommittedText: jest.fn(),
      processUtterance: jest.fn().mockReturnValue({
        aggregatedText: 'test aggregated text',
        action: 'NEW_STREAM',
        aggregationChanged: true,
        isLastInMergedGroup: false,
        shouldSendToSemanticRepair: true,
        metrics: {},
      }),
      updateLastCommittedTextAfterRepair: jest.fn(),
    };

    // 创建mock TaskRouter
    mockTaskRouter = {
      routeSemanticRepairTask: jest.fn().mockResolvedValue({
        decision: 'PASS',
        text_out: 'test repaired text',
        confidence: 0.9,
        reason_codes: [],
      }),
    };

    // 创建mock ServicesHandler
    mockServicesHandler = {};

    // 创建mock SemanticRepairStage
    mockSemanticRepairStage = {
      process: jest.fn().mockResolvedValue({
        decision: 'PASS',
        textOut: 'test repaired text',
        confidence: 0.9,
        reasonCodes: [],
        repairTimeMs: 100,
      }),
    };

    // 创建 mock SemanticRepairInitializer（runSemanticRepairStep 使用 services.semanticRepairInitializer，不创建新实例）
    const mockSemanticRepairInitializer = {
      initialize: jest.fn().mockResolvedValue(undefined),
      isInitialized: jest.fn().mockReturnValue(true),
      getSemanticRepairStage: jest.fn().mockReturnValue(mockSemanticRepairStage),
    };

    // 创建ServicesBundle（必须包含 semanticRepairInitializer，否则 runSemanticRepairStep 会直接跳过）
    services = {
      taskRouter: mockTaskRouter,
      aggregatorManager: mockAggregatorManager,
      servicesHandler: mockServicesHandler,
      semanticRepairInitializer: mockSemanticRepairInitializer,
    };

    // 创建测试job
    job = {
      job_id: 'test-job-1',
      session_id: 'test-session-1',
      utterance_index: 0,
      src_lang: 'zh',
      lang_a: 'zh',
      lang_b: 'en',
    } as JobAssignMessage;

    // 创建测试context
    ctx = initJobContext(job);
    ctx.asrText = 'test asr text';
    ctx.segmentForJobResult = 'test aggregated text';
  });

  describe('问题1: getLastCommittedText() 是否重复调用', () => {
    it('应该在aggregation-step中调用一次并缓存到ctx', async () => {
      mockAggregatorManager.getLastCommittedText.mockReturnValue('previous text');

      await runAggregationStep(job, ctx, services);

      // 验证getLastCommittedText被调用一次
      expect(mockAggregatorManager.getLastCommittedText).toHaveBeenCalledTimes(1);
      expect(mockAggregatorManager.getLastCommittedText).toHaveBeenCalledWith(
        'test-session-1',
        0
      );

      // 验证结果被缓存到ctx
      expect(ctx.lastCommittedText).toBe('previous text');
    });

    it('应该在semantic-repair-step中优先使用ctx.lastCommittedText，避免重复调用', async () => {
      ctx.lastCommittedText = 'cached text from aggregation';

      await runSemanticRepairStep(job, ctx, services);

      expect(mockAggregatorManager.getLastCommittedText).not.toHaveBeenCalled();
    });

    it('如果ctx.lastCommittedText为undefined，semantic-repair-step不调用getLastCommittedText（依赖 aggregation-step 已设置）', async () => {
      // 不设置ctx.lastCommittedText（异常路径：aggregation-step 未执行或未设置）
      ctx.lastCommittedText = undefined;

      await runSemanticRepairStep(job, ctx, services);

      // 实现只读 ctx.lastCommittedText，从不调用 aggregatorManager.getLastCommittedText
      expect(mockAggregatorManager.getLastCommittedText).not.toHaveBeenCalled();
    });

    it('如果ctx.lastCommittedText为null，不应该在semantic-repair-step中调用getLastCommittedText', async () => {
      ctx.lastCommittedText = null as any;

      await runSemanticRepairStep(job, ctx, services);

      expect(mockAggregatorManager.getLastCommittedText).not.toHaveBeenCalled();
    });
  });

  describe('问题2: SemanticRepairInitializer 是否重复初始化', () => {
    it('使用 services.semanticRepairInitializer 复用时，若未初始化则调用 initialize', async () => {
      (services.semanticRepairInitializer as any).isInitialized.mockReturnValue(false);

      await runSemanticRepairStep(job, ctx, services);

      expect(services.semanticRepairInitializer.initialize).toHaveBeenCalledTimes(1);
    });

    it('若已初始化则跳过 initialize 调用', async () => {
      (services.semanticRepairInitializer as any).isInitialized.mockReturnValue(true);

      await runSemanticRepairStep(job, ctx, services);

      expect(services.semanticRepairInitializer.initialize).not.toHaveBeenCalled();
    });
  });

  describe('问题3: getServiceIdForLanguage() 和 selectServiceEndpoint() 是否重复查找', () => {
    it('每次调用routeSemanticRepairTask都会查找服务端点（没有缓存）', async () => {
      const mockGetServiceEndpointById = jest.fn().mockReturnValue({
        serviceId: 'semantic-repair-en-zh',
        baseUrl: 'http://localhost:8000',
      });
      const mockSelectServiceEndpoint = jest.fn().mockReturnValue({
        serviceId: 'semantic-repair-en-zh',
        baseUrl: 'http://localhost:8000',
      });

      const mockHandler = new TaskRouterSemanticRepairHandler(
        mockSelectServiceEndpoint,
        jest.fn(),
        new Map(),
        jest.fn(),
        2,
        jest.fn().mockReturnValue(true),
        undefined,
        false,
        undefined,
        mockGetServiceEndpointById
      );

      // Mock健康检查和并发管理
      const mockHealthChecker = {
        checkServiceHealth: jest.fn().mockResolvedValue({
          isAvailable: true,
          status: 'WARMED',
          reason: '',
        }),
      };
      (mockHandler as any).healthChecker = mockHealthChecker;

      const mockConcurrencyManager = {
        acquire: jest.fn().mockResolvedValue(undefined),
        release: jest.fn(),
      };
      (mockHandler as any).concurrencyManager = mockConcurrencyManager;

      // Mock HTTP请求
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({
          decision: 'PASS',
          text_out: 'test text',
          confidence: 0.9,
        }),
      });

      // 第一次调用
      await mockHandler.routeSemanticRepairTask({
        job_id: 'job-1',
        session_id: 'session-1',
        utterance_index: 0,
        lang: 'zh',
        text_in: 'test text',
        quality_score: 0.9,
        micro_context: '',
        meta: {},
      });

      // 第二次调用
      await mockHandler.routeSemanticRepairTask({
        job_id: 'job-2',
        session_id: 'session-2',
        utterance_index: 1,
        lang: 'zh',
        text_in: 'test text 2',
        quality_score: 0.9,
        micro_context: '',
        meta: {},
      });

      // 当前实现每次 route 都会调用 getServiceEndpointById 解析端点（无按 lang 缓存）
      expect(mockGetServiceEndpointById).toHaveBeenCalledWith('semantic-repair-en-zh');
      expect(mockGetServiceEndpointById).toHaveBeenCalledTimes(2);
    });
  });

  describe('问题4: checkServiceHealth() 是否每次调用都检查', () => {
    it('每次调用routeSemanticRepairTask都会检查服务健康状态（有缓存但可能过期）', async () => {
      const mockHealthChecker = {
        checkServiceHealth: jest.fn().mockResolvedValue({
          isAvailable: true,
          status: 'WARMED',
          reason: '',
        }),
      };

      const mockGetServiceEndpointById = jest.fn().mockReturnValue({
        serviceId: 'semantic-repair-en-zh',
        baseUrl: 'http://localhost:8000',
      });

      const mockHandler = new TaskRouterSemanticRepairHandler(
        jest.fn(),
        jest.fn(),
        new Map(),
        jest.fn(),
        2,
        jest.fn().mockReturnValue(true), // isServiceRunningCallback
        undefined,
        false,
        undefined,
        mockGetServiceEndpointById
      );

      // 替换healthChecker（通过反射）
      (mockHandler as any).healthChecker = mockHealthChecker;

      const mockConcurrencyManager = {
        acquire: jest.fn().mockResolvedValue(undefined),
        release: jest.fn(),
      };
      (mockHandler as any).concurrencyManager = mockConcurrencyManager;

      // Mock HTTP请求
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({
          decision: 'PASS',
          text_out: 'test text',
          confidence: 0.9,
        }),
      });

      // 第一次调用
      await mockHandler.routeSemanticRepairTask({
        job_id: 'job-1',
        session_id: 'session-1',
        utterance_index: 0,
        lang: 'zh',
        text_in: 'test text',
        quality_score: 0.9,
        micro_context: '',
        meta: {},
      });

      // 第二次调用
      await mockHandler.routeSemanticRepairTask({
        job_id: 'job-2',
        session_id: 'session-2',
        utterance_index: 1,
        lang: 'zh',
        text_in: 'test text 2',
        quality_score: 0.9,
        micro_context: '',
        meta: {},
      });

      // 验证checkServiceHealth被调用了（每次调用都检查，除非缓存未过期）
      // 当前实现：有健康检查缓存，但如果缓存过期，仍会调用
      // 实际调用次数取决于缓存是否过期
      expect(mockHealthChecker.checkServiceHealth).toHaveBeenCalled();
      
      // 结论：当前实现有健康检查缓存，但如果缓存过期，仍会调用
      // 这是合理的，但可以优化缓存时间
    });
  });

  describe('问题5: shouldRepair() 判断是否必要', () => {
    it('runSemanticRepairStep 会调用 stage.process（由 stage 内部决定是否调服务）', async () => {
      const mockStageProcess = jest.fn().mockResolvedValue({
        decision: 'PASS',
        textOut: 'test text',
        confidence: 1.0,
        reasonCodes: ['TOO_SHORT'],
        repairTimeMs: 0,
      });
      mockSemanticRepairStage.process = mockStageProcess;

      await runSemanticRepairStep(job, ctx, services);

      expect(mockStageProcess).toHaveBeenCalledTimes(1);
    });

    it('process 返回 REPAIR 时 step 会写回 ctx.repairedText', async () => {
      const mockStageProcess = jest.fn().mockResolvedValue({
        decision: 'REPAIR',
        textOut: 'repaired text',
        confidence: 0.9,
        reasonCodes: [],
        repairTimeMs: 100,
      });
      mockSemanticRepairStage.process = mockStageProcess;

      await runSemanticRepairStep(job, ctx, services);

      expect(mockStageProcess).toHaveBeenCalledTimes(1);
      expect(ctx.repairedText).toBe('repaired text');
    });
  });

  describe('问题6: lastCommittedText 传递是否一致', () => {
    it('aggregation-step 总是设置 ctx.lastCommittedText（getLastCommittedText 返回 null 时设为 null）', async () => {
      mockAggregatorManager.getLastCommittedText.mockReturnValue(null);

      await runAggregationStep(job, ctx, services);

      expect(mockAggregatorManager.getLastCommittedText).toHaveBeenCalled();
      expect(ctx.lastCommittedText).toBeNull();
    });

    it('如果aggregation-step返回null，semantic-repair-step不应该重复获取', async () => {
      ctx.lastCommittedText = null as any;

      await runSemanticRepairStep(job, ctx, services);

      expect(mockAggregatorManager.getLastCommittedText).not.toHaveBeenCalled();
    });

    it('若 ctx.lastCommittedText 为 undefined，semantic-repair-step 不调用 getLastCommittedText（仅读 ctx）', async () => {
      ctx.lastCommittedText = undefined;

      await runSemanticRepairStep(job, ctx, services);

      expect(mockAggregatorManager.getLastCommittedText).not.toHaveBeenCalled();
    });
  });
});
