/**
 * GpuArbiter acquire 准入决策（从 gpu-arbiter.ts 迁出）
 * 仅迁移实现，不改变接口与逻辑。
 */

import { GpuAdmissionState } from './types';
import type { GpuTaskType } from './types';

export type AcquireAdmissionDecision = 'ACQUIRE_NOW' | 'ENQUEUE';

/**
 * 根据 GPU 状态、队列、任务类型与优先级决定立即获取或入队
 */
export function getAcquireDecision(
  admissionState: GpuAdmissionState,
  isLocked: boolean,
  queueLength: number,
  taskType: GpuTaskType,
  priority: number
): AcquireAdmissionDecision {
  const isHighPressure = admissionState === GpuAdmissionState.HIGH_PRESSURE;

  if (isHighPressure && !isLocked && queueLength === 0 && taskType === 'ASR' && priority >= 90) {
    return 'ACQUIRE_NOW';
  }

  if (isHighPressure) {
    if (priority >= 70 && !isLocked) {
      return 'ACQUIRE_NOW';
    }
    return 'ENQUEUE';
  }

  if (!isLocked) {
    return 'ACQUIRE_NOW';
  }

  return 'ENQUEUE';
}
