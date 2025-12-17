/**
 * ServiceRegistry 类型定义
 */

export interface InstalledServiceVersion {
  version: string;
  platform: string;
  installed_at: string;
  service_id: string;
  service_json_path?: string; // 可选：只有通过服务包管理器安装的服务才有 service.json
  install_path: string;
  size_bytes?: number; // 可选：服务包大小（字节），从 services_index.json 的 artifact.size_bytes 复制而来
}

export interface CurrentService {
  service_id: string;
  version: string;
  platform: string;
  activated_at: string;
  service_json_path?: string; // 可选：只有通过服务包管理器安装的服务才有 service.json
  install_path: string;
}

export interface InstalledServices {
  [service_id: string]: {
    [version_platform: string]: InstalledServiceVersion;  // key: "{version}::{platform}"
  };
}

export interface ServiceRegistry {
  installed: InstalledServices;
  current: {
    [service_id: string]: CurrentService;
  };
}

