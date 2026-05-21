/**
 * 应用初始化模块（简化版）
 * 使用新的服务层架构，移除复杂的 installed.json/current.json 逻辑
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { NodeAgent } from '../agent/node-agent-simple';
import { ModelManager } from '../model-manager/model-manager';
import { InferenceService } from '../inference/inference-service';
import { loadNodeConfig, saveNodeConfig, getServicesBaseUrl } from '../node-config';
import { logLexiconStartupContract } from '../lexicon/lexicon-startup';
import { logSentenceKenlmStartupStatus } from '../phonetic-correction/sentence-kenlm-startup';
import { registerModelHandlers } from '../ipc-handlers/model-handlers';
import {
  initServiceLayer,
  registerServiceIpcHandlers,
  getServiceRunner,
  ServiceProcessRunner,
  ServiceEndpointResolver,
} from '../service-layer';
import { cleanupOrphanedProcessesOnStartup } from '../service-layer/port-cleanup';
import { getServiceRegistry } from '../service-layer/ServiceRegistrySingleton';
import {
  createServiceSnapshotGetter,
  createResourceSnapshotGetter
} from '../service-layer/ServiceSnapshots';
import logger from '../logger';

/**
 * 服务管理器引用（新架构）
 */
export interface ServiceManagers {
  nodeAgent: NodeAgent | null;
  modelManager: ModelManager | null;
  inferenceService: InferenceService | null;
  serviceRunner: ServiceProcessRunner | null;  // 统一的进程启动器
  endpointResolver: ServiceEndpointResolver | null;  // endpoint解析器
}

/**
 * 初始化服务目录路径
 */
function initializeServicesDirectory(): string {
  if (process.env.SERVICES_DIR) {
    return process.env.SERVICES_DIR;
  }

  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
  if (isDev) {
    // 尝试找到项目根目录下的 electron_node/services
    // 查找包含 service.json 文件的 services 目录（更明确的标记）
    let currentDir = __dirname;
    for (let i = 0; i < 15; i++) {  // 增加查找深度
      const servicesPath = path.join(currentDir, 'services');

      // 检查是否存在，并且至少包含一个 service.json 文件
      if (fs.existsSync(servicesPath)) {
        try {
          const entries = fs.readdirSync(servicesPath);
          const hasServiceJson = entries.some(entry => {
            const serviceJsonPath = path.join(servicesPath, entry, 'service.json');
            return fs.existsSync(serviceJsonPath);
          });

          if (hasServiceJson) {
            logger.info({ servicesDir: servicesPath }, 'Using project services directory (development mode)');
            return servicesPath;
          }
        } catch (error) {
          // 忽略读取错误，继续向上查找
        }
      }

      const parentDir = path.dirname(currentDir);
      if (parentDir === currentDir) {
        break;
      }
      currentDir = parentDir;
    }

    logger.warn({}, 'Could not find services directory in project, falling back to userData');
  }

  // 回退到 userData/services
  const userData = app.getPath('userData');
  const servicesDir = path.join(userData, 'services');

  // 确保目录存在
  if (!fs.existsSync(servicesDir)) {
    fs.mkdirSync(servicesDir, { recursive: true });
    logger.info({ servicesDir }, 'Created services directory');
  }

  return servicesDir;
}

/**
 * 初始化所有服务（简化版）
 */
export async function initializeServicesSimple(): Promise<ServiceManagers> {
  console.log('\n🔥 使用新架构初始化...\n');

  const managers: ServiceManagers = {
    nodeAgent: null,
    modelManager: null,
    inferenceService: null,
    serviceRunner: null,
    endpointResolver: null,
  };

  // 1. 初始化服务层（扫描 services 目录，构建 ServiceRegistry）
  const servicesDir = initializeServicesDirectory();
  logger.info({ servicesDir }, '🔧 Initializing service layer');

  // initServiceLayer会设置全局ServiceRegistry单例
  const { registry, runner } = await initServiceLayer(servicesDir);
  logger.info(
    {
      serviceCount: registry.size,
      serviceIds: Array.from(registry.keys())
    },
    '✅ Service layer initialized'
  );

  // 启动前清理：扫描 registry 预期端口，终止断电/崩溃后的遗留进程
  await cleanupOrphanedProcessesOnStartup(registry);

  // 2. 复用 initServiceLayer 创建的 ServiceProcessRunner（getServiceRunner 与 managers.serviceRunner 指向同一实例）
  managers.serviceRunner = runner;
  logger.info({}, '✅ ServiceProcessRunner ready');

  // 3. 创建endpoint解析器（用于InferenceService查找服务）；baseUrl 来自配置
  managers.endpointResolver = new ServiceEndpointResolver(getServiceRegistry(), getServicesBaseUrl);
  logger.info({}, '✅ ServiceEndpointResolver created');

  // 4. 注册服务相关的 IPC handlers
  registerServiceIpcHandlers();
  logger.info({}, '✅ Service IPC handlers registered');

  // 5. 初始化 ModelManager
  managers.modelManager = new ModelManager();
  logger.info({}, '✅ ModelManager created');

  // 6. 初始化 InferenceService（使用新架构，直接传入registry）
  // ✅ 从全局单例获取registry，确保使用同一个实例
  managers.inferenceService = new InferenceService(
    managers.modelManager,
    getServiceRegistry(),
    undefined, // aggregatorManager
    undefined, // aggregatorMiddleware
    null // servicesHandler
  );
  logger.info({}, '✅ InferenceService created (new architecture)');

  // 7. 设置任务回调（暂时保留，后续可能移除）
  managers.inferenceService.setOnTaskProcessedCallback((serviceName: string) => {
    logger.debug({ serviceName }, 'Task processed');
  });

  managers.inferenceService.setOnTaskStartCallback(() => {
    logger.debug({}, 'Task started');
  });

  managers.inferenceService.setOnTaskEndCallback(() => {
    logger.debug({}, 'Task ended');
  });

  // 8. 初始化 NodeAgent (✅ Day 2 Refactor: 使用快照函数)
  const getServiceSnapshot = createServiceSnapshotGetter(getServiceRegistry());
  const getResourceSnapshot = createResourceSnapshotGetter();

  managers.nodeAgent = new NodeAgent(
    managers.inferenceService,
    managers.modelManager,
    getServiceSnapshot,
    getResourceSnapshot
  );
  logger.info({}, '✅ NodeAgent created (Day 2: snapshot-based)');

  console.log('\n✅ 新架构初始化完成！\n');
  console.log('📊 统计：');
  const finalRegistry = getServiceRegistry();
  console.log(`   - 服务数量: ${finalRegistry.size}`);
  console.log(`   - 服务ID: ${Array.from(finalRegistry.keys()).join(', ')}`);
  console.log('\n');

  return managers;
}

/**
 * 加载并验证配置文件
 */
export function loadAndValidateConfig(): void {
  const configPath = path.join(app.getPath('userData'), 'electron-node-config.json');
  const configExists = fs.existsSync(configPath);

  logger.info(
    {
      configPath,
      configExists,
    },
    'Loading user service preferences from config file...'
  );

  const config = loadNodeConfig();
  const prefs = config.servicePreferences;

  logger.info(
    {
      configPath,
      servicePreferences: prefs,
    },
    'User service preferences loaded successfully'
  );

  logLexiconStartupContract();
  logSentenceKenlmStartupStatus();

  // 确保配置文件存在
  if (!configExists) {
    logger.info({ configPath }, 'Config file not found (first launch), saving default configuration...');
    saveNodeConfig(config);
    logger.info({ servicePreferences: config.servicePreferences }, 'Default configuration saved');
  }
}

/**
 * 启动服务（根据用户偏好）
 * 简化版：只处理 Rust 和 Python 服务，其他服务通过 ServiceSupervisor 管理
 */
export async function startServicesByPreference(
  managers: ServiceManagers
): Promise<void> {
  const config = loadNodeConfig();
  const prefs = config.servicePreferences;
  const registry = getServiceRegistry();
  if (!registry || !managers.serviceRunner) {
    if (!managers.serviceRunner) logger.warn({}, 'Service runner not initialized, skipping auto-start');
    return;
  }

  logger.info({ servicePreferences: prefs }, 'Auto-starting services by preference');

  (async () => {
    for (const entry of registry.values()) {
      if (prefs[entry.def.id] !== true) continue;
      try {
        logger.info({ serviceId: entry.def.id }, 'Auto-starting service...');
        await managers.serviceRunner!.start(entry.def.id);
        logger.info({ serviceId: entry.def.id }, 'Service started');
      } catch (error) {
        logger.error({ error: error instanceof Error ? error.message : 'Unknown', serviceId: entry.def.id }, 'Failed to auto-start service');
      }
    }
  })().catch((error: Error) => {
    logger.error({ error: error.message }, 'Failed to start services by preference');
  });
}

/**
 * 应用启动逻辑（简化版）
 */
export async function startAppSimple(): Promise<ServiceManagers> {
  logger.info({}, '========================================');
  logger.info({}, '   Node Application Starting');
  logger.info({}, '========================================');

  // 1. 加载配置
  loadAndValidateConfig();

  // 2. 初始化所有服务
  const managers = await initializeServicesSimple();

  // 3. 注册 IPC handlers
  registerModelHandlers(managers.modelManager);
  // 注：runtime handlers 已在 index.ts 的 app.whenReady() 中注册

  // 4. 根据用户偏好启动服务
  await startServicesByPreference(managers);

  // NodeAgent 的 start() 由 index.ts 在 initializeServices() 返回后统一调用，此处不再重复
  logger.info({}, '========================================');
  logger.info({}, '   Node Application Started');
  logger.info({}, '========================================');

  return managers;
}
