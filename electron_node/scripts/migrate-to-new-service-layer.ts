/**
 * 迁移脚本：从旧的 installed.json 生成新的 service.json 文件
 * 
 * 使用方法：
 *   ts-node migrate-to-new-service-layer.ts [services_dir]
 * 
 * 示例：
 *   ts-node migrate-to-new-service-layer.ts D:/Programs/github/lingua_1/electron_node/services
 */

import * as fs from 'fs';
import * as path from 'path';

interface InstalledServiceVersion {
  version: string;
  platform: string;
  installed_at: string;
  service_id: string;
  service_json_path?: string;
  install_path: string;
  size_bytes?: number;
}

interface InstalledServices {
  [serviceId: string]: {
    [versionPlatform: string]: InstalledServiceVersion;
  };
}

interface ServiceDefinition {
  id: string;
  name: string;
  type: string;
  device?: string;
  port?: number;
  exec: {
    command: string;
    args: string[];
    cwd: string;
  };
  version?: string;
  description?: string;
}

// 服务类型映射（基于旧的硬编码）
const SERVICE_TYPE_MAP: Record<string, string> = {
  'faster-whisper-vad': 'asr',
  'node-inference': 'asr',
  'nmt-m2m100': 'nmt',
  'piper-tts': 'tts',
  'speaker-embedding': 'tone',
  'your-tts': 'tone',
  'semantic-repair-zh': 'semantic',
  'semantic-repair-en': 'semantic',
  'en-normalize': 'semantic',
  'semantic-repair-en-zh': 'semantic',
};

// 服务启动命令映射（基于已知的服务）
const SERVICE_EXEC_MAP: Record<string, { command: string; args: string[] }> = {
  'faster-whisper-vad': { command: 'python', args: ['main.py'] },
  'nmt-m2m100': { command: 'python', args: ['server.py'] },
  'piper-tts': { command: 'python', args: ['server.py'] },
  'speaker-embedding': { command: 'python', args: ['server.py'] },
  'your-tts': { command: 'python', args: ['server.py'] },
  'semantic-repair-zh': { command: 'python', args: ['main.py', '--port', '5010'] },
  'semantic-repair-en': { command: 'python', args: ['main.py', '--port', '5011'] },
  'en-normalize': { command: 'python', args: ['main.py', '--port', '5012'] },
  'semantic-repair-en-zh': { command: 'python', args: ['main.py', '--port', '5013'] },
};

// 服务端口映射
const SERVICE_PORT_MAP: Record<string, number> = {
  'semantic-repair-zh': 5010,
  'semantic-repair-en': 5011,
  'en-normalize': 5012,
  'semantic-repair-en-zh': 5013,
};

function loadInstalledJson(servicesDir: string): InstalledServices {
  const installedPath = path.join(servicesDir, 'installed.json');
  
  if (!fs.existsSync(installedPath)) {
    console.log(`⚠️  installed.json not found at ${installedPath}`);
    return {};
  }

  const content = fs.readFileSync(installedPath, 'utf-8');
  const installed: InstalledServices = JSON.parse(content);

  // 替换路径占位符
  const servicesDirNormalized = servicesDir.replace(/\\/g, '/');
  const installedStr = JSON.stringify(installed).replace(/{SERVICES_DIR}/g, servicesDirNormalized);
  return JSON.parse(installedStr);
}

function generateServiceJson(service: InstalledServiceVersion): ServiceDefinition {
  const serviceId = service.service_id;
  
  // 确定服务类型
  const type = SERVICE_TYPE_MAP[serviceId] || 'unknown';
  if (type === 'unknown') {
    console.warn(`⚠️  Unknown service type for ${serviceId}, defaulting to 'unknown'`);
  }

  // 确定启动命令
  const exec = SERVICE_EXEC_MAP[serviceId] || { command: 'python', args: ['main.py'] };
  
  // 确定端口
  const port = SERVICE_PORT_MAP[serviceId];

  // 生成友好的名称
  const name = serviceId
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

  const serviceDef: ServiceDefinition = {
    id: serviceId,
    name,
    type,
    device: 'gpu', // 默认 GPU
    exec: {
      command: exec.command,
      args: exec.args,
      cwd: '.', // 相对于 service.json 所在目录
    },
    version: service.version,
    description: `Auto-generated service definition for ${name}`,
  };

  if (port) {
    serviceDef.port = port;
  }

  return serviceDef;
}

function migrateService(
  serviceId: string,
  versions: { [versionPlatform: string]: InstalledServiceVersion },
  servicesDir: string
): boolean {
  // 选择最新的版本（按安装时间排序）
  const sortedVersions = Object.values(versions).sort((a, b) => {
    return new Date(b.installed_at).getTime() - new Date(a.installed_at).getTime();
  });

  if (sortedVersions.length === 0) {
    console.warn(`⚠️  No versions found for ${serviceId}`);
    return false;
  }

  const latestVersion = sortedVersions[0];
  const installPath = latestVersion.install_path;

  // 检查安装路径是否存在
  if (!fs.existsSync(installPath)) {
    console.warn(`⚠️  Install path not found for ${serviceId}: ${installPath}`);
    return false;
  }

  // 检查是否已经有 service.json
  const serviceJsonPath = path.join(installPath, 'service.json');
  if (fs.existsSync(serviceJsonPath)) {
    console.log(`✅ service.json already exists for ${serviceId}, skipping`);
    return true;
  }

  // 生成 service.json
  const serviceDef = generateServiceJson(latestVersion);

  try {
    fs.writeFileSync(serviceJsonPath, JSON.stringify(serviceDef, null, 2), 'utf-8');
    console.log(`✅ Created service.json for ${serviceId} at ${serviceJsonPath}`);
    return true;
  } catch (error) {
    console.error(`❌ Failed to create service.json for ${serviceId}:`, error);
    return false;
  }
}

function backupInstalledJson(servicesDir: string): void {
  const installedPath = path.join(servicesDir, 'installed.json');
  const backupPath = path.join(servicesDir, 'installed.json.backup');

  if (fs.existsSync(installedPath) && !fs.existsSync(backupPath)) {
    fs.copyFileSync(installedPath, backupPath);
    console.log(`📦 Backed up installed.json to ${backupPath}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('Usage: ts-node migrate-to-new-service-layer.ts [services_dir]');
    console.log('Example: ts-node migrate-to-new-service-layer.ts D:/Programs/github/lingua_1/electron_node/services');
    process.exit(1);
  }

  const servicesDir = args[0];

  if (!fs.existsSync(servicesDir)) {
    console.error(`❌ Services directory not found: ${servicesDir}`);
    process.exit(1);
  }

  console.log('🚀 Starting migration...');
  console.log(`📂 Services directory: ${servicesDir}`);
  console.log('');

  // 备份 installed.json
  backupInstalledJson(servicesDir);

  // 加载 installed.json
  const installed = loadInstalledJson(servicesDir);
  const serviceIds = Object.keys(installed);

  if (serviceIds.length === 0) {
    console.log('⚠️  No services found in installed.json');
    process.exit(0);
  }

  console.log(`📋 Found ${serviceIds.length} services in installed.json:`);
  serviceIds.forEach(id => console.log(`   - ${id}`));
  console.log('');

  // 迁移每个服务
  let successCount = 0;
  let failCount = 0;

  for (const serviceId of serviceIds) {
    const versions = installed[serviceId];
    const success = migrateService(serviceId, versions, servicesDir);
    if (success) {
      successCount++;
    } else {
      failCount++;
    }
  }

  console.log('');
  console.log('✨ Migration completed!');
  console.log(`   Success: ${successCount}`);
  console.log(`   Failed: ${failCount}`);
  console.log('');
  console.log('📝 Next steps:');
  console.log('   1. Review the generated service.json files');
  console.log('   2. Adjust exec commands and ports if needed');
  console.log('   3. Test the new service layer by running the application');
  console.log('   4. If everything works, you can delete installed.json (backup is saved as installed.json.backup)');
}

main().catch(error => {
  console.error('❌ Migration failed:', error);
  process.exit(1);
});
