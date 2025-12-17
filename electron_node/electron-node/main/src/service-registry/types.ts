/**
 * ServiceRegistry 类型定义
 */

export interface InstalledServiceVersion {
  version: string;
  platform: string;
  installed_at: string;
  service_id: string;
  service_json_path: string;
  install_path: string;
}

export interface CurrentService {
  service_id: string;
  version: string;
  platform: string;
  activated_at: string;
  service_json_path: string;
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

