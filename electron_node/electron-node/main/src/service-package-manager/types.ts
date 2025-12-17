/**
 * ServicePackageManager 类型定义
 */

export interface ServiceJson {
  service_id: string;
  version: string;
  platforms: {
    [platform: string]: PlatformConfig;
  };
  health_check: HealthCheck;
  env_schema?: Record<string, any>;
}

export interface PlatformConfig {
  entrypoint: string;
  exec: {
    type: 'argv';
    program: string;
    args: string[];
    cwd: string;
  };
  default_port: number;
  files: {
    requires: string[];
    optional?: string[];
  };
}

export interface HealthCheck {
  type: 'http';
  endpoint: string;
  timeout_ms: number;
  startup_grace_ms: number;
}

export interface ServiceVariant {
  version: string;
  platform: string;
  artifact: {
    type: string;
    url: string;
    sha256: string;
    size_bytes: number;
    etag?: string;
  };
  signature?: {
    alg: string;
    key_id: string;
    value_b64: string;
    signed_payload: {
      service_id: string;
      version: string;
      platform: string;
      sha256: string;
    };
  };
}

export interface ServiceInfo {
  service_id: string;
  name: string;
  latest_version: string;
  variants: ServiceVariant[];
}

