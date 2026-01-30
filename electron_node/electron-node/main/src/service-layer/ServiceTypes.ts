/**
 * 服务层类型定义
 * 单一数据源，简化服务发现和管理逻辑
 */

/**
 * 服务定义 - 从 service.json 读取
 */
export interface ServiceDefinition {
  id: string;           // 唯一服务 ID，例如 "asr_faster_whisper"
  name: string;         // 展示名称，例如 "ASR Faster Whisper"
  type: "asr" | "nmt" | "tts" | "semantic" | "tone" | string;
  device?: "cpu" | "gpu" | "auto";
  port?: number;        // 服务端口（如果是 HTTP/gRPC 服务）
  exec: {
    command: string;    // 启动命令，例如 "python" 或某个绝对路径
    args: string[];     // 启动参数列表
    cwd: string;        // 服务工作目录（相对路径，相对于 service.json 所在目录）
  };
  version?: string;     // 版本号，例如 "1.0.0"
  tags?: string[];      // 标签，用于能力聚合与过滤
  description?: string; // 服务描述
}

/**
 * 运行时状态 - 由服务管理器维护
 */
export interface ServiceRuntime {
  status: "stopped" | "starting" | "running" | "stopping" | "error";
  pid?: number;             // 进程 ID（若在 running）
  port?: number;            // 实际监听的端口
  lastExitCode?: number;    // 上次退出码
  lastError?: string;       // 最近一次错误信息
  startedAt?: Date;         // 启动时间
}

/**
 * 服务条目 - 定义 + 运行时状态
 */
export interface ServiceEntry {
  def: ServiceDefinition;
  runtime: ServiceRuntime;
  installPath: string;      // 服务安装路径（绝对路径）
}

/**
 * 服务注册表 - 单一数据源
 * key = service_id (def.id)
 */
export type ServiceRegistry = Map<string, ServiceEntry>;

/**
 * NodeAgent 使用的服务信息格式（兼容协议）
 */
export interface InstalledService {
  service_id: string;
  type: string;
  device?: string;
  status: "running" | "stopped" | "error";
  version?: string;
}

/**
 * 能力聚合结果（按类型）
 */
export interface CapabilityByType {
  type: string;
  ready: boolean;
  ready_impl_ids?: string[];
  reason?: string;
}
