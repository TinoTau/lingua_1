/**
 * ModelManager capability_state 构建逻辑
 * 从 model-manager.ts 迁出，仅迁移实现，不改变接口。
 */

import type { ModelStatus } from '../../../../shared/protocols/messages';
import type { Registry, ModelInfo, InstalledModelVersion } from './types';

function mapToModelStatus(status: InstalledModelVersion['status']): ModelStatus {
  switch (status) {
    case 'ready':
      return 'ready';
    case 'downloading':
    case 'verifying':
    case 'installing':
      return 'downloading';
    case 'error':
      return 'error';
    default:
      return 'not_installed';
  }
}

/**
 * 根据 registry 与可用模型列表构建 capability_state（model_id -> ModelStatus）
 */
export function buildCapabilityState(
  registry: Registry,
  availableModels: ModelInfo[]
): Record<string, ModelStatus> {
  const capabilityState: Record<string, ModelStatus> = {};

  for (const model of availableModels) {
    const defaultVersion = model.default_version;
    const installedVersion = registry[model.id]?.[defaultVersion];

    if (!installedVersion) {
      capabilityState[model.id] = 'not_installed';
    } else {
      capabilityState[model.id] = mapToModelStatus(installedVersion.status);
    }
  }

  return capabilityState;
}
