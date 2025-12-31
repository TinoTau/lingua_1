"use strict";
/**
 * Node Agent Services Handler
 * 处理服务管理相关的逻辑
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ServicesHandler = void 0;
const messages_1 = require("../../../../shared/protocols/messages");
const logger_1 = __importDefault(require("../logger"));
class ServicesHandler {
    constructor(serviceRegistryManager, rustServiceManager, pythonServiceManager) {
        this.serviceRegistryManager = serviceRegistryManager;
        this.rustServiceManager = rustServiceManager;
        this.pythonServiceManager = pythonServiceManager;
    }
    /**
     * 获取已安装的服务包列表
     * 包括：
     * 1. 从服务注册表中读取的已注册服务
     * 2. 实际运行但未在注册表中的本地服务（如 faster-whisper-vad、speaker-embedding）
     */
    async getInstalledServices() {
        const result = [];
        const defaultVersion = '2.0.0';
        const serviceTypeMap = {
            'faster-whisper-vad': messages_1.ServiceType.ASR,
            'node-inference': messages_1.ServiceType.ASR,
            'nmt-m2m100': messages_1.ServiceType.NMT,
            'piper-tts': messages_1.ServiceType.TTS,
            'speaker-embedding': messages_1.ServiceType.TONE,
            'your-tts': messages_1.ServiceType.TONE,
        };
        const defaultDevice = 'gpu';
        const pushService = (service_id, status, version) => {
            const type = serviceTypeMap[service_id];
            if (!type) {
                logger_1.default.warn({ service_id }, 'Unknown service_id, skipped when building installed_services');
                return;
            }
            // 去重：若已存在则更新状态
            const existingIndex = result.findIndex(s => s.service_id === service_id);
            const entry = {
                service_id,
                type,
                device: defaultDevice,
                status,
                version: version || defaultVersion,
            };
            if (existingIndex >= 0) {
                result[existingIndex] = entry;
            }
            else {
                result.push(entry);
            }
        };
        // 1. 从服务注册表获取已注册的服务
        if (this.serviceRegistryManager) {
            try {
                await this.serviceRegistryManager.loadRegistry();
                const installed = this.serviceRegistryManager.listInstalled();
                logger_1.default.debug({
                    installedCount: installed.length,
                    installed: installed.map((s) => ({
                        service_id: s.service_id,
                        version: s.version,
                        platform: s.platform
                    }))
                }, 'Getting installed services from registry for heartbeat');
                installed.forEach((service) => {
                    const running = this.isServiceRunning(service.service_id);
                    pushService(service.service_id, running ? 'running' : 'stopped', service.version);
                });
            }
            catch (error) {
                logger_1.default.error({ error }, 'Failed to get installed services from registry');
            }
        }
        // 2. 补充实际运行但未在注册表中的本地服务（Python）
        const serviceIdMap = {
            nmt: 'nmt-m2m100',
            tts: 'piper-tts',
            yourtts: 'your-tts',
            speaker_embedding: 'speaker-embedding',
            faster_whisper_vad: 'faster-whisper-vad',
        };
        if (this.pythonServiceManager) {
            const pythonServiceNames = ['nmt', 'tts', 'yourtts', 'speaker_embedding', 'faster_whisper_vad'];
            for (const serviceName of pythonServiceNames) {
                const serviceId = serviceIdMap[serviceName];
                const alreadyAdded = result.some(s => s.service_id === serviceId);
                if (!alreadyAdded) {
                    const status = this.pythonServiceManager.getServiceStatus(serviceName);
                    if (status?.running) {
                        pushService(serviceId, 'running');
                        logger_1.default.debug({ serviceId, serviceName }, 'Added running service to installed services list (not in registry)');
                    }
                }
            }
        }
        // 3. 补充 Rust 服务（node-inference）
        if (this.rustServiceManager && typeof this.rustServiceManager.getStatus === 'function') {
            const rustStatus = this.rustServiceManager.getStatus();
            const alreadyAdded = result.some(s => s.service_id === 'node-inference');
            if (!alreadyAdded && rustStatus?.running) {
                pushService('node-inference', 'running');
                logger_1.default.debug({}, 'Added node-inference to installed services list (not in registry)');
            }
        }
        logger_1.default.info({
            totalCount: result.length,
            services: result.map(s => `${s.service_id}:${s.status}`),
        }, 'Getting installed services for heartbeat (type-level)');
        return result;
    }
    /**
     * 检查服务是否正在运行
     * 根据 service_id 映射到对应的服务管理器并检查运行状态
     */
    isServiceRunning(serviceId) {
        try {
            // 服务 ID 到服务管理器的映射
            if (serviceId === 'node-inference') {
                // node-inference 通过 RustServiceManager 管理
                if (this.rustServiceManager && typeof this.rustServiceManager.getStatus === 'function') {
                    const status = this.rustServiceManager.getStatus();
                    return status?.running === true;
                }
            }
            else if (serviceId === 'nmt-m2m100') {
                // nmt-m2m100 通过 PythonServiceManager 管理（服务名是 'nmt'）
                if (this.pythonServiceManager && typeof this.pythonServiceManager.getServiceStatus === 'function') {
                    const status = this.pythonServiceManager.getServiceStatus('nmt');
                    return status?.running === true;
                }
            }
            else if (serviceId === 'piper-tts') {
                // piper-tts 通过 PythonServiceManager 管理（服务名是 'tts'）
                if (this.pythonServiceManager && typeof this.pythonServiceManager.getServiceStatus === 'function') {
                    const status = this.pythonServiceManager.getServiceStatus('tts');
                    return status?.running === true;
                }
            }
            else if (serviceId === 'your-tts') {
                // your-tts 通过 PythonServiceManager 管理（服务名是 'yourtts'）
                if (this.pythonServiceManager && typeof this.pythonServiceManager.getServiceStatus === 'function') {
                    const status = this.pythonServiceManager.getServiceStatus('yourtts');
                    return status?.running === true;
                }
            }
            else if (serviceId === 'speaker-embedding') {
                // speaker-embedding 通过 PythonServiceManager 管理（服务名是 'speaker_embedding'）
                if (this.pythonServiceManager && typeof this.pythonServiceManager.getServiceStatus === 'function') {
                    const status = this.pythonServiceManager.getServiceStatus('speaker_embedding');
                    return status?.running === true;
                }
            }
            else if (serviceId === 'faster-whisper-vad') {
                // faster-whisper-vad 通过 PythonServiceManager 管理（服务名是 'faster_whisper_vad'）
                if (this.pythonServiceManager && typeof this.pythonServiceManager.getServiceStatus === 'function') {
                    const status = this.pythonServiceManager.getServiceStatus('faster_whisper_vad');
                    return status?.running === true;
                }
            }
            // 未知的服务 ID 或服务管理器不可用，返回 false
            return false;
        }
        catch (error) {
            logger_1.default.error({ error, serviceId }, 'Failed to check service running status');
            return false;
        }
    }
    /**
     * 动态检测是否应该收集 Rerun 指标
     * 检查是否有 ASR 服务运行（Rerun 功能依赖 ASR）
     */
    shouldCollectRerunMetrics(installedServices) {
        // Rerun 功能需要 ASR 服务支持
        const hasASRService = installedServices.some(s => s.type === messages_1.ServiceType.ASR && s.status === 'running');
        return hasASRService;
    }
    /**
     * 动态检测是否应该收集 ASR 指标
     * 检查是否有 ASR 服务运行
     */
    shouldCollectASRMetrics(installedServices) {
        const hasASRService = installedServices.some(s => s.type === messages_1.ServiceType.ASR && s.status === 'running');
        return hasASRService;
    }
    /**
     * 聚合 type 级可用性：同一类型只要有 GPU+running 的实现即 ready
     */
    async getCapabilityByType(installedServices) {
        const types = [messages_1.ServiceType.ASR, messages_1.ServiceType.NMT, messages_1.ServiceType.TTS, messages_1.ServiceType.TONE];
        const capability = [];
        for (const t of types) {
            const runningGpu = installedServices.filter(s => s.type === t && s.device === 'gpu' && s.status === 'running');
            if (runningGpu.length > 0) {
                capability.push({
                    type: t,
                    ready: true,
                    ready_impl_ids: runningGpu.map(s => s.service_id),
                });
                continue;
            }
            const anyInstalled = installedServices.some(s => s.type === t);
            const anyRunning = installedServices.some(s => s.type === t && s.status === 'running');
            const anyGpu = installedServices.some(s => s.type === t && s.device === 'gpu');
            let reason = 'no_impl';
            if (anyInstalled && anyGpu && !anyRunning)
                reason = 'gpu_impl_not_running';
            else if (anyInstalled && anyRunning && !anyGpu)
                reason = 'only_cpu_running';
            else if (anyInstalled && !anyRunning)
                reason = 'no_running_impl';
            capability.push({
                type: t,
                ready: false,
                reason,
            });
        }
        logger_1.default.debug({ capability }, 'Built capability_by_type');
        return capability;
    }
}
exports.ServicesHandler = ServicesHandler;
