"use strict";
/**
 * Node Agent Registration Handler
 * 处理节点注册相关的逻辑
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RegistrationHandler = void 0;
const ws_1 = __importDefault(require("ws"));
const logger_1 = __importDefault(require("../logger"));
const node_agent_language_capability_1 = require("./node-agent-language-capability");
class RegistrationHandler {
    constructor(ws, nodeId, inferenceService, hardwareHandler, getInstalledServices, getCapabilityByType) {
        this.ws = ws;
        this.nodeId = nodeId;
        this.inferenceService = inferenceService;
        this.hardwareHandler = hardwareHandler;
        this.getInstalledServices = getInstalledServices;
        this.getCapabilityByType = getCapabilityByType;
        this.languageDetector = new node_agent_language_capability_1.LanguageCapabilityDetector();
    }
    /**
     * 注册节点
     */
    async registerNode() {
        if (!this.ws) {
            logger_1.default.warn({}, 'Cannot register node: WebSocket is null');
            return;
        }
        if (this.ws.readyState !== ws_1.default.OPEN) {
            logger_1.default.warn({ readyState: this.ws.readyState }, 'Cannot register node: WebSocket is not OPEN');
            return;
        }
        logger_1.default.info({ readyState: this.ws.readyState }, 'Starting node registration');
        try {
            // 获取硬件信息
            logger_1.default.debug({}, 'Getting hardware info...');
            const hardware = await this.hardwareHandler.getHardwareInfo();
            logger_1.default.debug({ gpus: hardware.gpus?.length || 0 }, 'Hardware info retrieved');
            // 获取已安装的模型
            logger_1.default.debug({}, 'Getting installed models...');
            const installedModels = await this.inferenceService.getInstalledModels();
            logger_1.default.debug({ modelCount: installedModels.length }, 'Installed models retrieved');
            // 获取服务实现列表与按类型聚合的能力
            logger_1.default.debug({}, 'Getting installed services...');
            const installedServicesAll = await this.getInstalledServices();
            logger_1.default.debug({ serviceCount: installedServicesAll.length }, 'Installed services retrieved');
            logger_1.default.debug({}, 'Getting capability by type...');
            const capabilityByType = await this.getCapabilityByType(installedServicesAll);
            logger_1.default.debug({ capabilityCount: capabilityByType.length }, 'Capability by type retrieved');
            // 获取语言能力
            logger_1.default.debug({}, 'Detecting language capabilities...');
            const languageCapabilities = await this.languageDetector.detectLanguageCapabilities(installedServicesAll, installedModels, capabilityByType);
            logger_1.default.debug({
                asr_languages: languageCapabilities.asr_languages?.length || 0,
                tts_languages: languageCapabilities.tts_languages?.length || 0,
                nmt_capabilities: languageCapabilities.nmt_capabilities?.length || 0
            }, 'Language capabilities detected');
            // 获取支持的功能
            logger_1.default.debug({}, 'Getting features supported...');
            const featuresSupported = this.inferenceService.getFeaturesSupported();
            logger_1.default.debug({ features: featuresSupported }, 'Features supported retrieved');
            // 对齐协议规范：node_register 消息格式
            const message = {
                type: 'node_register',
                node_id: this.nodeId || null, // 首次连接时为 null
                version: '2.0.0', // TODO: 从 package.json 读取
                capability_schema_version: '2.0', // ServiceType 能力模型版本
                platform: this.hardwareHandler.getPlatform(),
                hardware: hardware,
                installed_models: installedModels,
                // 上报全部已安装实现（含运行状态），调度按 type 聚合
                // 如果为空数组，则发送 undefined 以匹配 Option<Vec<InstalledService>>
                installed_services: installedServicesAll.length > 0 ? installedServicesAll : undefined,
                capability_by_type: capabilityByType,
                features_supported: featuresSupported,
                accept_public_jobs: true, // TODO: 从配置读取
                language_capabilities: languageCapabilities,
            };
            const messageStr = JSON.stringify(message);
            logger_1.default.info({
                node_id: this.nodeId,
                capability_schema_version: message.capability_schema_version,
                platform: message.platform,
                gpus: hardware.gpus?.length || 0,
                installed_services_count: installedServicesAll.length,
                capability_by_type_count: capabilityByType.length,
                capabilityByType,
                message_length: messageStr.length,
                ws_readyState: this.ws.readyState,
            }, 'Sending node registration message');
            logger_1.default.debug({ message: messageStr }, 'Node registration message content');
            if (this.ws.readyState !== ws_1.default.OPEN) {
                logger_1.default.error({ readyState: this.ws.readyState }, 'WebSocket is not OPEN when trying to send registration message');
                return;
            }
            this.ws.send(messageStr);
            logger_1.default.info({ message_length: messageStr.length }, 'Node registration message sent successfully');
        }
        catch (error) {
            const errorDetails = {
                message: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
                name: error instanceof Error ? error.name : undefined,
                error: error,
            };
            logger_1.default.error(errorDetails, 'Failed to register node');
        }
    }
    /**
     * 更新 WebSocket 和 nodeId（用于重连场景）
     */
    updateConnection(ws, nodeId) {
        this.ws = ws;
        this.nodeId = nodeId;
    }
}
exports.RegistrationHandler = RegistrationHandler;
