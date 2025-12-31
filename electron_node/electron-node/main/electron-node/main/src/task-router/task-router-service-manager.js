"use strict";
/**
 * Task Router Service Manager
 * 处理服务端点管理相关的逻辑
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskRouterServiceManager = void 0;
const logger_1 = __importDefault(require("../logger"));
const messages_1 = require("../../../../shared/protocols/messages");
class TaskRouterServiceManager {
    constructor(pythonServiceManager, rustServiceManager, serviceRegistryManager) {
        this.pythonServiceManager = pythonServiceManager;
        this.rustServiceManager = rustServiceManager;
        this.serviceRegistryManager = serviceRegistryManager;
    }
    /**
     * 刷新服务端点列表
     */
    async refreshServiceEndpoints() {
        const endpoints = new Map();
        // 初始化每个服务类型的列表
        [messages_1.ServiceType.ASR, messages_1.ServiceType.NMT, messages_1.ServiceType.TTS, messages_1.ServiceType.TONE].forEach((type) => {
            endpoints.set(type, []);
        });
        // 从服务管理器获取运行中的服务
        const installedServices = await this.getInstalledServices();
        logger_1.default.debug({
            installedServicesCount: installedServices.length,
            installedServices: installedServices.map(s => ({
                service_id: s.service_id,
                type: s.type,
                status: s.status,
            })),
        }, 'Refreshing service endpoints');
        for (const service of installedServices) {
            if (service.status !== 'running') {
                logger_1.default.debug({ serviceId: service.service_id, status: service.status }, 'Skipping non-running service');
                continue;
            }
            const endpoint = await this.createServiceEndpoint(service);
            if (endpoint) {
                const existing = endpoints.get(service.type) || [];
                existing.push(endpoint);
                endpoints.set(service.type, existing);
                logger_1.default.debug({
                    serviceId: endpoint.serviceId,
                    baseUrl: endpoint.baseUrl,
                    port: endpoint.port,
                    serviceType: endpoint.serviceType,
                }, 'Created service endpoint');
            }
            else {
                logger_1.default.warn({
                    serviceId: service.service_id,
                    serviceType: service.type,
                }, 'Failed to create service endpoint (port not available)');
            }
        }
        logger_1.default.info({
            asr: endpoints.get(messages_1.ServiceType.ASR)?.map(e => ({ serviceId: e.serviceId, baseUrl: e.baseUrl })) || [],
            nmt: endpoints.get(messages_1.ServiceType.NMT)?.map(e => ({ serviceId: e.serviceId, baseUrl: e.baseUrl })) || [],
            tts: endpoints.get(messages_1.ServiceType.TTS)?.map(e => ({ serviceId: e.serviceId, baseUrl: e.baseUrl })) || [],
            tone: endpoints.get(messages_1.ServiceType.TONE)?.map(e => ({ serviceId: e.serviceId, baseUrl: e.baseUrl })) || [],
        }, 'Service endpoints refreshed');
        return endpoints;
    }
    /**
     * 创建服务端点
     */
    async createServiceEndpoint(service) {
        const port = await this.getServicePort(service.service_id);
        if (!port) {
            logger_1.default.warn({
                serviceId: service.service_id,
                serviceType: service.type,
                status: service.status,
            }, 'Cannot create service endpoint: port not available');
            return null;
        }
        const endpoint = {
            serviceId: service.service_id,
            serviceType: service.type,
            baseUrl: `http://127.0.0.1:${port}`,
            port,
            status: service.status,
        };
        logger_1.default.debug({
            serviceId: endpoint.serviceId,
            baseUrl: endpoint.baseUrl,
            port: endpoint.port,
            serviceType: endpoint.serviceType,
            status: endpoint.status,
        }, 'Created service endpoint');
        return endpoint;
    }
    /**
     * 获取服务端口
     */
    async getServicePort(serviceId) {
        // 服务ID到端口的映射
        const portMap = {
            'faster-whisper-vad': 6007,
            'node-inference': 5009,
            'nmt-m2m100': 5008,
            'piper-tts': 5006,
            'your-tts': 5004,
            'speaker-embedding': 5003,
        };
        // 首先尝试从映射表获取
        if (portMap[serviceId]) {
            logger_1.default.debug({ serviceId, port: portMap[serviceId], source: 'portMap' }, 'Got service port from portMap');
            return portMap[serviceId];
        }
        // 尝试从服务管理器获取
        if (serviceId === 'node-inference' && this.rustServiceManager) {
            const status = this.rustServiceManager.getStatus();
            if (status?.port) {
                return status.port;
            }
        }
        // 尝试从Python服务管理器获取
        const pythonServiceNameMap = {
            'nmt-m2m100': 'nmt',
            'piper-tts': 'tts',
            'your-tts': 'yourtts',
            'speaker-embedding': 'speaker_embedding',
            'faster-whisper-vad': 'faster_whisper_vad',
        };
        const pythonServiceName = pythonServiceNameMap[serviceId];
        if (pythonServiceName && this.pythonServiceManager) {
            const status = this.pythonServiceManager.getServiceStatus(pythonServiceName);
            if (status?.port) {
                return status.port;
            }
        }
        return null;
    }
    /**
     * 获取已安装的服务列表
     */
    async getInstalledServices() {
        const result = [];
        // 从服务注册表获取
        if (this.serviceRegistryManager) {
            try {
                await this.serviceRegistryManager.loadRegistry();
                const installed = this.serviceRegistryManager.listInstalled();
                for (const service of installed) {
                    const running = this.isServiceRunning(service.service_id);
                    result.push({
                        service_id: service.service_id,
                        type: this.getServiceType(service.service_id),
                        device: 'gpu',
                        status: running ? 'running' : 'stopped',
                        version: service.version || '2.0.0',
                    });
                }
            }
            catch (error) {
                logger_1.default.error({ error }, 'Failed to get installed services from registry');
            }
        }
        // 补充Python服务
        if (this.pythonServiceManager) {
            const pythonServices = ['nmt', 'tts', 'yourtts', 'speaker_embedding', 'faster_whisper_vad'];
            for (const serviceName of pythonServices) {
                const serviceId = this.getServiceIdFromPythonName(serviceName);
                const status = this.pythonServiceManager.getServiceStatus(serviceName);
                if (status?.running) {
                    result.push({
                        service_id: serviceId,
                        type: this.getServiceType(serviceId),
                        device: 'gpu',
                        status: 'running',
                        version: '2.0.0',
                    });
                }
            }
        }
        // 补充Rust服务
        if (this.rustServiceManager) {
            const status = this.rustServiceManager.getStatus();
            if (status?.running) {
                result.push({
                    service_id: 'node-inference',
                    type: messages_1.ServiceType.ASR, // node-inference 可以作为 ASR 服务
                    device: 'gpu',
                    status: 'running',
                    version: '2.0.0',
                });
            }
        }
        return result;
    }
    /**
     * 检查服务是否运行
     */
    isServiceRunning(serviceId) {
        if (serviceId === 'node-inference' && this.rustServiceManager) {
            const status = this.rustServiceManager.getStatus();
            return status?.running === true;
        }
        const pythonServiceNameMap = {
            'nmt-m2m100': 'nmt',
            'piper-tts': 'tts',
            'your-tts': 'yourtts',
            'speaker-embedding': 'speaker_embedding',
            'faster-whisper-vad': 'faster_whisper_vad',
        };
        const pythonServiceName = pythonServiceNameMap[serviceId];
        if (pythonServiceName && this.pythonServiceManager) {
            const status = this.pythonServiceManager.getServiceStatus(pythonServiceName);
            return status?.running === true;
        }
        return false;
    }
    /**
     * 获取服务类型
     */
    getServiceType(serviceId) {
        const typeMap = {
            'faster-whisper-vad': messages_1.ServiceType.ASR,
            'node-inference': messages_1.ServiceType.ASR,
            'nmt-m2m100': messages_1.ServiceType.NMT,
            'piper-tts': messages_1.ServiceType.TTS,
            'your-tts': messages_1.ServiceType.TTS,
            'speaker-embedding': messages_1.ServiceType.TONE,
        };
        return typeMap[serviceId] || messages_1.ServiceType.ASR;
    }
    /**
     * 从Python服务名获取服务ID
     */
    getServiceIdFromPythonName(serviceName) {
        const map = {
            nmt: 'nmt-m2m100',
            tts: 'piper-tts',
            yourtts: 'your-tts',
            speaker_embedding: 'speaker-embedding',
            faster_whisper_vad: 'faster-whisper-vad',
        };
        return map[serviceName] || serviceName;
    }
}
exports.TaskRouterServiceManager = TaskRouterServiceManager;
