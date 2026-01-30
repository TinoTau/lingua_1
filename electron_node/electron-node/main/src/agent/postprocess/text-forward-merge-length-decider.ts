/**
 * Text Forward Merge - Length Decision Config
 * 文本长度决策配置接口
 */

export interface LengthDecisionConfig {
  minLengthToKeep: number;      // 最小保留长度
  minLengthToSend: number;       // 最小发送长度
  maxLengthToWait: number;       // 最大等待长度
  waitTimeoutMs: number;         // 等待超时时间
}

