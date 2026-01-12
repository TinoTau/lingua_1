"use strict";
/**
 * PostProcessCoordinator - Semantic Repair Initializer
 * 处理语义修复Stage的初始化逻辑（基于服务发现）
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SemanticRepairInitializer = void 0;
const semantic_repair_stage_1 = require("./semantic-repair-stage");
const node_config_1 = require("../../node-config");
const logger_1 = __importDefault(require("../../logger"));
class SemanticRepairInitializer {
    constructor(servicesHandler, taskRouter) {
        this.servicesHandler = servicesHandler;
        this.taskRouter = taskRouter;
        this.initialized = false;
        this.initPromise = null;
        this.semanticRepairStage = null;
    }
    /**
     * 初始化语义修复Stage（基于服务发现）
     * Phase 2: 实现SemanticRepairStage初始化
     */
    async initialize() {
        // 如果已经有初始化进行中，等待它完成
        if (this.initPromise) {
            await this.initPromise;
            return;
        }
        // 创建初始化Promise
        this.initPromise = (async () => {
            try {
                if (!this.servicesHandler || !this.taskRouter) {
                    logger_1.default.debug({}, 'SemanticRepairInitializer: ServicesHandler or TaskRouter not available, skipping initialization');
                    this.initialized = true;
                    return;
                }
                // 获取已安装的语义修复服务
                const installedServices = await this.servicesHandler.getInstalledSemanticRepairServices();
                if (!installedServices.zh && !installedServices.en && !installedServices.enNormalize) {
                    logger_1.default.info({}, 'SemanticRepairInitializer: No semantic repair services installed, skipping initialization');
                    this.initialized = true;
                    return;
                }
                // 读取配置
                const nodeConfig = (0, node_config_1.loadNodeConfig)();
                const semanticRepairConfig = nodeConfig.features?.semanticRepair || {};
                // 构建Stage配置
                const stageConfig = {
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
                this.semanticRepairStage = new semantic_repair_stage_1.SemanticRepairStage(this.taskRouter, installedServices, stageConfig);
                this.initialized = true;
                logger_1.default.info({
                    zh: installedServices.zh,
                    en: installedServices.en,
                    enNormalize: installedServices.enNormalize,
                }, 'SemanticRepairInitializer: SemanticRepairStage initialized successfully');
            }
            catch (error) {
                logger_1.default.error({ error: error.message, stack: error.stack }, 'SemanticRepairInitializer: Failed to initialize semantic repair stage');
                this.initialized = true; // 即使失败也标记为已初始化，避免阻塞
                this.semanticRepairStage = null;
            }
            finally {
                this.initPromise = null;
            }
        })();
        await this.initPromise;
    }
    /**
     * 重新初始化语义修复Stage（用于热插拔）
     * Phase 2: 实现重新初始化机制
     */
    async reinitialize() {
        logger_1.default.info({}, 'SemanticRepairInitializer: Reinitializing semantic repair stage');
        this.initialized = false;
        this.initPromise = null;
        this.semanticRepairStage = null;
        await this.initialize();
    }
    /**
     * 检查是否已初始化
     */
    isInitialized() {
        return this.initialized;
    }
    /**
     * 获取初始化Promise（用于等待初始化完成）
     */
    getInitPromise() {
        return this.initPromise;
    }
    /**
     * 获取SemanticRepairStage实例
     */
    getSemanticRepairStage() {
        return this.semanticRepairStage;
    }
}
exports.SemanticRepairInitializer = SemanticRepairInitializer;
