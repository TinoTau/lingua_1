"use strict";
/**
 * 语言能力检测 - 模型元数据管理
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ModelMetadataManager = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const logger_1 = __importDefault(require("../../logger"));
/**
 * 模型元数据管理器
 */
class ModelMetadataManager {
    constructor() {
        this.modelMetadata = [];
        this.metadataLoaded = false;
    }
    /**
     * 加载模型语言能力元数据
     */
    loadModelMetadata() {
        try {
            const metadataPath = path.join(__dirname, '../../config/model-language-metadata.json');
            if (fs.existsSync(metadataPath)) {
                const content = fs.readFileSync(metadataPath, 'utf-8');
                const data = JSON.parse(content);
                this.modelMetadata = data.models || [];
                this.metadataLoaded = true;
                logger_1.default.debug({ modelCount: this.modelMetadata.length }, 'Model language metadata loaded');
            }
            else {
                logger_1.default.warn({ path: metadataPath }, 'Model language metadata file not found');
            }
        }
        catch (error) {
            logger_1.default.error({ error }, 'Failed to load model language metadata');
        }
    }
    /**
     * 查找模型元数据
     */
    findModelMetadata(modelId, modelType) {
        if (!modelId || !this.metadataLoaded) {
            return undefined;
        }
        return this.modelMetadata.find(meta => meta.model_id === modelId && meta.model_type === modelType);
    }
    /**
     * 获取所有模型元数据
     */
    getAllModelMetadata() {
        return this.modelMetadata;
    }
}
exports.ModelMetadataManager = ModelMetadataManager;
