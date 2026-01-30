/**
 * Node Agent Registration Handler
 * 处理节点注册相关的逻辑
 */

import WebSocket from 'ws';
import {
  NodeRegisterMessage,
  InstalledModel,
  InstalledService,
  CapabilityByType,
} from '../../../../shared/protocols/messages';
import { InferenceService } from '../inference/inference-service';
import logger from '../logger';
import { HardwareInfoHandler } from './node-agent-hardware';
import { LanguageCapabilityDetector } from './node-agent-language-capability';

export class RegistrationHandler {
  private languageDetector: LanguageCapabilityDetector;

  constructor(
    private ws: WebSocket | null,
    private nodeId: string | null,
    private inferenceService: InferenceService,
    private hardwareHandler: HardwareInfoHandler,
    private getInstalledServices: () => Promise<InstalledService[]>,
    private getCapabilityByType: (services: InstalledService[]) => Promise<CapabilityByType[]>
  ) {
    this.languageDetector = new LanguageCapabilityDetector();
  }

  /**
   * 注册节点
   */
  async registerNode(): Promise<void> {
    if (!this.ws) {
      logger.warn({}, 'Cannot register node: WebSocket is null');
      return;
    }

    if (this.ws.readyState !== WebSocket.OPEN) {
      logger.warn({ readyState: this.ws.readyState }, 'Cannot register node: WebSocket is not OPEN');
      return;
    }

    logger.info({ readyState: this.ws.readyState }, 'Starting node registration');

    try {
      // 获取硬件信息
      logger.info({}, '[1/6] Getting hardware info...');
      const hardware = await this.hardwareHandler.getHardwareInfo();
      logger.info({ gpus: hardware.gpus?.length || 0 }, '[1/6] Hardware info retrieved');

      // 获取已安装的模型
      const installedModels = await this.inferenceService.getInstalledModels();
      logger.debug({ modelCount: installedModels.length }, 'Installed models retrieved');

      // 获取服务实现列表与按类型聚合的能力
      const installedServicesAll = await this.getInstalledServices();
      logger.info({ 
        serviceCount: installedServicesAll.length,
        services: installedServicesAll.map(s => `${s.service_id}:${s.type}:${s.status}`)
      }, 'Installed services retrieved');

      const capabilityByType = await this.getCapabilityByType(installedServicesAll);
      logger.debug({ 
        capabilityCount: capabilityByType.length,
      }, 'Capability by type retrieved');

      // 获取语言能力
      const languageCapabilities = await this.languageDetector.detectLanguageCapabilities(
        installedServicesAll,
        installedModels,
        capabilityByType
      );
      logger.debug({ 
        asr_languages: languageCapabilities.asr_languages?.length || 0,
        tts_languages: languageCapabilities.tts_languages?.length || 0,
        nmt_capabilities: languageCapabilities.nmt_capabilities?.length || 0
      }, 'Language capabilities detected');

      // 获取支持的功能
      const featuresSupported = this.inferenceService.getFeaturesSupported();
      logger.debug({ features: featuresSupported }, 'Features supported retrieved');

      // 对齐协议规范：node_register 消息格式
      const message: NodeRegisterMessage = {
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
      logger.info({
        node_id: this.nodeId,
        capability_schema_version: message.capability_schema_version,
        platform: message.platform,
        gpus: hardware.gpus?.length || 0,
        installed_services_count: installedServicesAll.length,
        capability_by_type_count: capabilityByType.length,
        message_length: messageStr.length,
        ws_readyState: this.ws.readyState,
      }, 'Sending node registration message');

      logger.debug({ message: messageStr }, 'Node registration message content');

      if (this.ws.readyState !== WebSocket.OPEN) {
        logger.error({ readyState: this.ws.readyState }, 'WebSocket is not OPEN when trying to send registration message');
        return;
      }

      this.ws.send(messageStr);
      logger.info({}, 'Registration message sent');
      logger.info({ message_length: messageStr.length }, 'Node registration message sent successfully');
    } catch (error) {
      const errorDetails = {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        name: error instanceof Error ? error.name : undefined,
        error: error,
      };
      logger.error(errorDetails, 'Failed to register node');
    }
  }

  /**
   * 更新 WebSocket 和 nodeId（用于重连场景）
   */
  updateConnection(ws: WebSocket | null, nodeId: string | null): void {
    this.ws = ws;
    this.nodeId = nodeId;
  }
}
