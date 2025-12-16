"use strict";
// ===== 错误类型 =====
Object.defineProperty(exports, "__esModule", { value: true });
exports.ModelNotAvailableError = void 0;
class ModelNotAvailableError extends Error {
    constructor(modelId, version, reason) {
        super(`Model ${modelId}@${version} unavailable: ${reason}`);
        this.modelId = modelId;
        this.version = version;
        this.reason = reason;
        this.name = 'ModelNotAvailableError';
    }
}
exports.ModelNotAvailableError = ModelNotAvailableError;
