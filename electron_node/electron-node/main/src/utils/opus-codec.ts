/**
 * Opus 编解码工具模块
 * 提供 Opus 编码和解码功能，用于 Pipeline 中的音频处理
 * 统一使用 opus-decoder 库进行解码（与 Web 客户端一致）
 */

export { decodeOpusToPcm16 } from './opus-codec-decoder';
export { encodePcm16ToOpusBuffer, convertWavToOpus } from './opus-codec-encoder';
