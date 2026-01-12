/**
 * PostProcessCoordinator - Semantic Repair Initializer
 * 处理语义修复Stage的初始化逻辑（基于服务发现）
 */

import { ServicesHandler } from '../node-agent-services';
import { TaskRouter } from '../../task-router/task-router';
import { SemanticRepairStage, SemanticRepairStageConfig } from './semantic-repair-stage';
import { loadNodeConfig } from '../../node-config';
import logger from '../../logger';

export class SemanticRepairInitializer {
  private initialized: boolean = false;
  private initPromise: Promise<void> | null = null;
  private semanticRepairStage: SemanticRepairStage | null = null;

  constructor(
    private servicesHandler: ServicesHandler | null | undefined,
    private taskRouter: TaskRouter | null | undefined
  ) {}

  /**
   * 初始化语义修复Stage（基于服务发现）
   * Phase 2: 实现SemanticRepairStage初始化
   */
  async initialize(): Promise<void> {
    // 如果已经有初始化进行中，等待它完成
    if (this.initPromise) {
      await this.initPromise;
      return;
    }

    // 创建初始化Promise
    this.initPromise = (async () => {
      try {
        if (!this.servicesHandler || !this.taskRouter) {
          logger.debug(
            {},
            'SemanticRepairInitializer: ServicesHandler or TaskRouter not available, skipping initialization'
          );
          this.initialized = true;
          return;
        }

        // 获取已安装的语义修复服务
        const installedServices = await this.servicesHandler.getInstalledSemanticRepairServices();

        if (!installedServices.zh && !installedServices.en && !installedServices.enNormalize) {
          logger.info(
            {},
            'SemanticRepairInitializer: No semantic repair services installed, skipping initialization'
          );
          this.initialized = true;
          return;
        }

        // 读取配置
        const nodeConfig = loadNodeConfig();
        const semanticRepairConfig = nodeConfig.features?.semanticRepair || {};

        // 构建Stage配置
        const stageConfig: SemanticRepairStageConfig = {
          zh: {
            enabled: installedServices.zh,
            qualityThreshold: semanticRepairConfig.zh?.qualityThreshold || 0.70,
            forceForShortSentence: semanticRepairConfig.zh?.forceForShortSentence || false,
          },
          en: {
            normalizeEnabled: installedServices.enNormalize,
            repairEnabled: installedServices.en,
            qualityThreshold: semanticRepairConfig.en?.qualityThreshold || 0.70,
          },
        };

        // 初始化SemanticRepairStage
        this.semanticRepairStage = new SemanticRepairStage(
          this.taskRouter,
          installedServices,
          stageConfig
        );

        this.initialized = true;
        logger.info(
          {
            zh: installedServices.zh,
            en: installedServices.en,
            enNormalize: installedServices.enNormalize,
          },
          'SemanticRepairInitializer: SemanticRepairStage initialized successfully'
        );
      } catch (error: any) {
        logger.error(
          { error: error.message, stack: error.stack },
          'SemanticRepairInitializer: Failed to initialize semantic repair stage'
        );
        this.initialized = true; // 即使失败也标记为已初始化，避免阻塞
        this.semanticRepairStage = null;
      } finally {
        this.initPromise = null;
      }
    })();

    await this.initPromise;
  }

  /**
   * 重新初始化语义修复Stage（用于热插拔）
   * Phase 2: 实现重新初始化机制
   */
  async reinitialize(): Promise<void> {
    logger.info({}, 'SemanticRepairInitializer: Reinitializing semantic repair stage');
    this.initialized = false;
    this.initPromise = null;
    this.semanticRepairStage = null;
    await this.initialize();
  }

  /**
   * 检查是否已初始化
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * 获取初始化Promise（用于等待初始化完成）
   */
  getInitPromise(): Promise<void> | null {
    return this.initPromise;
  }

  /**
   * 获取SemanticRepairStage实例
   */
  getSemanticRepairStage(): SemanticRepairStage | null {
    return this.semanticRepairStage;
  }
}
