"use strict";
/**
 * Node Agent Services Handler - Semantic Repair Service Discovery
 * 处理语义修复服务发现相关的逻辑
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SemanticRepairServiceDiscovery = void 0;
const logger_1 = __importDefault(require("../logger"));
class SemanticRepairServiceDiscovery {
    constructor(serviceRegistryManager, isServiceRunning) {
        this.serviceRegistryManager = serviceRegistryManager;
        this.isServiceRunning = isServiceRunning;
    }
    /**
     * 获取已安装的语义修复服务列表
     * 返回已安装且运行中的语义修复服务信息
     */
    async getInstalledSemanticRepairServices() {
        const result = {
            zh: false,
            en: false,
            enNormalize: false,
            services: [],
        };
        // 语义修复服务ID列表
        const semanticRepairServiceIds = [
            'semantic-repair-zh',
            'semantic-repair-en',
            'en-normalize',
        ];
        // 从服务注册表获取已安装的服务
        if (this.serviceRegistryManager) {
            try {
                await this.serviceRegistryManager.loadRegistry();
                const installed = this.serviceRegistryManager.listInstalled();
                for (const service of installed) {
                    if (semanticRepairServiceIds.includes(service.service_id)) {
                        const running = this.isServiceRunning(service.service_id);
                        const status = running ? 'running' : 'stopped';
                        result.services.push({
                            serviceId: service.service_id,
                            status,
                            version: service.version,
                        });
                        // 更新对应语言的状态
                        if (service.service_id === 'semantic-repair-zh') {
                            result.zh = running;
                        }
                        else if (service.service_id === 'semantic-repair-en') {
                            result.en = running;
                        }
                        else if (service.service_id === 'en-normalize') {
                            result.enNormalize = running;
                        }
                    }
                }
            }
            catch (error) {
                logger_1.default.error({ error }, 'Failed to get installed semantic repair services from registry');
            }
        }
        logger_1.default.debug({
            zh: result.zh,
            en: result.en,
            enNormalize: result.enNormalize,
            services: result.services,
        }, 'Getting installed semantic repair services');
        return result;
    }
    /**
     * 检查语义修复服务是否运行
     * @param serviceId 服务ID（'semantic-repair-zh' | 'semantic-repair-en' | 'en-normalize'）
     */
    isSemanticRepairServiceRunning(serviceId) {
        if (serviceId === 'semantic-repair-zh' ||
            serviceId === 'semantic-repair-en' ||
            serviceId === 'en-normalize') {
            return this.isServiceRunning(serviceId);
        }
        return false;
    }
}
exports.SemanticRepairServiceDiscovery = SemanticRepairServiceDiscovery;
