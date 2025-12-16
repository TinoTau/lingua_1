// ===== 错误类型 =====

export class ModelNotAvailableError extends Error {
  constructor(
    public modelId: string,
    public version: string,
    public reason: 'not_installed' | 'downloading' | 'verifying' | 'error'
  ) {
    super(`Model ${modelId}@${version} unavailable: ${reason}`);
    this.name = 'ModelNotAvailableError';
  }
}

