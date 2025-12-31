"use strict";
/**
 * Opus 编解码工具模块
 * 提供 Opus 编码和解码功能，用于 Pipeline 中的音频处理
 *
 * 注意：此模块将 Opus 编解码功能从服务中拆分出来，统一在 Pipeline 中处理
 * 统一使用 opus-decoder 库进行解码（与 Web 客户端一致）
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.decodeOpusToPcm16 = decodeOpusToPcm16;
exports.encodePcm16ToOpusBuffer = encodePcm16ToOpusBuffer;
exports.convertWavToOpus = convertWavToOpus;
const logger_1 = __importDefault(require("../logger"));
const opus_encoder_1 = require("./opus-encoder");
// Opus 解码器实例（单例，复用解码器）
let decoderInstance = null;
let decoderConfig = null;
let decoderInitPromise = null;
/**
 * 初始化 Opus 解码器
 * @param sampleRate 采样率（默认 16000）
 * @param channels 声道数（默认 1，单声道）
 */
async function initializeOpusDecoder(sampleRate = 16000, channels = 1) {
    // 如果已经初始化且配置相同，直接返回
    if (decoderInstance && decoderConfig) {
        if (decoderConfig.sampleRate === sampleRate && decoderConfig.channels === channels) {
            return;
        }
        // 配置不同，需要重新初始化
        if (decoderInstance.free) {
            decoderInstance.free();
        }
        decoderInstance = null;
        decoderConfig = null;
    }
    // 如果正在初始化，等待完成
    if (decoderInitPromise) {
        await decoderInitPromise;
        return;
    }
    decoderInitPromise = (async () => {
        try {
            // 延迟导入 opus-decoder
            // 注意：在 Jest 测试环境中，可能需要使用 require 而不是动态 import
            let opusDecoderModule;
            try {
                const dynamicImport = new Function('specifier', 'return import(specifier)');
                opusDecoderModule = await dynamicImport('opus-decoder');
            }
            catch (importError) {
                // 如果动态导入失败（如 Jest 环境），尝试使用 require
                if (importError.code === 'ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING_FLAG') {
                    // Jest 环境，使用 require（如果可用）
                    try {
                        opusDecoderModule = require('opus-decoder');
                    }
                    catch (requireError) {
                        throw new Error('opus-decoder is not available. Please install it: npm install opus-decoder');
                    }
                }
                else {
                    throw importError;
                }
            }
            const { OpusDecoder } = opusDecoderModule;
            // 验证采样率
            const validSampleRates = [8000, 12000, 16000, 24000, 48000];
            if (!validSampleRates.includes(sampleRate)) {
                const closestRate = validSampleRates.reduce((prev, curr) => {
                    return Math.abs(curr - sampleRate) < Math.abs(prev - sampleRate) ? curr : prev;
                });
                logger_1.default.warn({
                    originalRate: sampleRate,
                    targetRate: closestRate,
                }, `Sample rate ${sampleRate} not supported by Opus decoder, using ${closestRate} instead`);
                sampleRate = closestRate;
            }
            // 创建解码器实例
            decoderInstance = new OpusDecoder({
                sampleRate: sampleRate,
                channels: channels,
            });
            // 等待 WASM 编译完成
            if (decoderInstance.ready) {
                await decoderInstance.ready;
            }
            decoderConfig = { sampleRate, channels };
            logger_1.default.info(`Opus decoder initialized: sampleRate=${sampleRate}, channels=${channels}`);
        }
        catch (error) {
            logger_1.default.error({ error: error.message }, 'Failed to initialize Opus decoder');
            decoderInstance = null;
            decoderConfig = null;
            throw error;
        }
        finally {
            decoderInitPromise = null;
        }
    })();
    await decoderInitPromise;
}
/**
 * 解码 Opus 音频为 PCM16
 *
 * 使用 opus-decoder 库进行解码（与 Web 客户端一致）
 *
 * @param opusDataBase64 Opus 编码的音频数据（Base64 字符串）
 * @param sampleRate 采样率（默认 16000）
 * @returns PCM16 音频数据（Buffer）
 */
async function decodeOpusToPcm16(opusDataBase64, sampleRate = 16000) {
    try {
        // 初始化解码器
        await initializeOpusDecoder(sampleRate, 1);
        if (!decoderInstance) {
            throw new Error('Opus decoder initialization failed');
        }
        // 解码 Base64 数据
        const opusData = Buffer.from(opusDataBase64, 'base64');
        // 处理 Opus packet 格式（Plan A：length-prefixed packets）
        // Web 客户端发送的格式：每个 packet 前有 2 字节的长度前缀（小端序）
        const decodedChunks = [];
        let offset = 0;
        const frameHeaderSize = 2; // 帧长度前缀的大小（字节）
        let packetCount = 0;
        let validPacketCount = 0;
        let invalidPacketCount = 0;
        let decodeErrorCount = 0;
        logger_1.default.debug({
            opusDataLength: opusData.length,
            sampleRate,
        }, 'Starting Opus packet decoding (Plan A format)');
        while (offset < opusData.length) {
            // 检查是否有足够的数据读取帧长度前缀
            if (offset + frameHeaderSize > opusData.length) {
                logger_1.default.warn({
                    offset,
                    totalLength: opusData.length,
                    remainingBytes: opusData.length - offset,
                }, 'Incomplete Opus packet header at end of data');
                break;
            }
            // 读取 packet 长度（小端序，uint16）
            const packetLength = opusData.readUInt16LE(offset);
            offset += frameHeaderSize;
            packetCount++;
            // 检查 packet 长度是否合理
            if (packetLength === 0) {
                logger_1.default.warn({
                    packetIndex: packetCount,
                    offset,
                }, 'Zero-length Opus packet detected, skipping');
                invalidPacketCount++;
                continue;
            }
            if (packetLength > 4096) {
                logger_1.default.warn({
                    packetIndex: packetCount,
                    packetLength,
                    offset,
                }, 'Opus packet length exceeds maximum (4096 bytes), skipping');
                invalidPacketCount++;
                continue;
            }
            // 检查是否有足够的数据读取完整的 packet
            if (offset + packetLength > opusData.length) {
                logger_1.default.warn({
                    packetIndex: packetCount,
                    packetLength,
                    offset,
                    totalLength: opusData.length,
                    availableBytes: opusData.length - offset,
                }, 'Incomplete Opus packet data');
                break;
            }
            // 提取 packet 数据
            const packetData = opusData.slice(offset, offset + packetLength);
            offset += packetLength;
            try {
                // 解码 packet
                // 注意：opus-decoder 库使用 decodeFrame() 方法，而不是 decode() 方法
                const decoded = decoderInstance.decodeFrame(packetData);
                if (decoded && decoded.channelData && decoded.channelData.length > 0) {
                    // 单声道或多声道合并
                    if (decoded.channelData.length === 1) {
                        if (decoded.channelData[0].length > 0) {
                            decodedChunks.push(decoded.channelData[0]);
                            validPacketCount++;
                        }
                        else {
                            logger_1.default.debug({
                                packetIndex: packetCount,
                                packetLength,
                            }, 'Decoded packet has empty channel data, skipping');
                        }
                    }
                    else {
                        // 多声道合并为单声道
                        const merged = new Float32Array(decoded.channelData[0].length);
                        for (let i = 0; i < merged.length; i++) {
                            let sum = 0;
                            for (let ch = 0; ch < decoded.channelData.length; ch++) {
                                sum += decoded.channelData[ch][i];
                            }
                            merged[i] = sum / decoded.channelData.length;
                        }
                        if (merged.length > 0) {
                            decodedChunks.push(merged);
                            validPacketCount++;
                        }
                        else {
                            logger_1.default.debug({
                                packetIndex: packetCount,
                                packetLength,
                            }, 'Merged multi-channel packet has empty data, skipping');
                        }
                    }
                }
                else {
                    logger_1.default.debug({
                        packetIndex: packetCount,
                        packetLength,
                        hasDecoded: !!decoded,
                        hasChannelData: decoded && !!decoded.channelData,
                        channelDataLength: decoded && decoded.channelData ? decoded.channelData.length : 0,
                    }, 'Decoded packet has no valid channel data, skipping');
                }
            }
            catch (decodeError) {
                decodeErrorCount++;
                logger_1.default.warn({
                    error: decodeError instanceof Error ? decodeError.message : String(decodeError),
                    packetIndex: packetCount,
                    packetLength,
                    offset,
                    packetDataPreview: packetData.slice(0, Math.min(16, packetData.length)).toString('hex'),
                }, 'Failed to decode Opus packet, skipping');
                // 继续处理下一个 packet
            }
        }
        logger_1.default.info({
            totalPackets: packetCount,
            validPackets: validPacketCount,
            invalidPackets: invalidPacketCount,
            decodeErrors: decodeErrorCount,
            decodedChunks: decodedChunks.length,
            opusDataLength: opusData.length,
        }, 'Opus packet decoding summary');
        if (decodedChunks.length === 0) {
            const errorMessage = `No audio data decoded from Opus packets. Processed ${packetCount} packets: ${validPacketCount} valid, ${invalidPacketCount} invalid, ${decodeErrorCount} decode errors. Opus data length: ${opusData.length} bytes. This may indicate that the audio data is not in Plan A format (length-prefixed packets).`;
            logger_1.default.error({
                packetCount,
                validPacketCount,
                invalidPacketCount,
                decodeErrorCount,
                opusDataLength: opusData.length,
                opusDataPreview: opusData.slice(0, Math.min(32, opusData.length)).toString('hex'),
            }, errorMessage);
            throw new Error(errorMessage);
        }
        // 合并所有解码后的 chunks
        const totalLength = decodedChunks.reduce((sum, chunk) => sum + chunk.length, 0);
        const mergedAudio = new Float32Array(totalLength);
        let mergedOffset = 0;
        for (const chunk of decodedChunks) {
            mergedAudio.set(chunk, mergedOffset);
            mergedOffset += chunk.length;
        }
        // 将 Float32Array 转换为 PCM16 Buffer
        const pcm16Buffer = Buffer.allocUnsafe(mergedAudio.length * 2);
        for (let i = 0; i < mergedAudio.length; i++) {
            // 将 float32 [-1.0, 1.0] 转换为 int16 [-32768, 32767]
            const int16Value = Math.max(-32768, Math.min(32767, Math.round(mergedAudio[i] * 32768)));
            pcm16Buffer.writeInt16LE(int16Value, i * 2);
        }
        logger_1.default.info({
            opusDataLength: opusData.length,
            pcm16DataLength: pcm16Buffer.length,
            decodedSamples: mergedAudio.length,
            sampleRate,
            duration: (mergedAudio.length / sampleRate).toFixed(2) + 's',
        }, 'Opus audio decoded to PCM16 successfully');
        return pcm16Buffer;
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger_1.default.error({
            error,
            opusDataLength: opusDataBase64.length,
            sampleRate,
            errorMessage,
        }, 'Failed to decode Opus audio');
        throw new Error(`Opus decoding failed: ${errorMessage}`);
    }
}
/**
 * 编码 PCM16 音频为 Opus
 *
 * @param pcm16Data PCM16 音频数据（Buffer）
 * @param sampleRate 采样率（默认 16000）
 * @param channels 声道数（默认 1，单声道）
 * @returns Opus 编码的音频数据（Buffer）
 */
async function encodePcm16ToOpusBuffer(pcm16Data, sampleRate = 16000, channels = 1) {
    // 检查 Opus 编码器是否可用
    if (!(0, opus_encoder_1.isOpusEncoderAvailable)()) {
        const reason = process.env.OPUS_ENCODING_ENABLED === 'false'
            ? 'disabled_by_env'
            : 'not_initialized';
        logger_1.default.error({
            reason,
            opusEncodingEnabled: process.env.OPUS_ENCODING_ENABLED !== 'false',
        }, 'Opus encoder is not available');
        throw new Error(`Opus encoder is not available (reason: ${reason})`);
    }
    try {
        // 使用现有的编码函数
        const opusData = await (0, opus_encoder_1.encodePcm16ToOpus)(pcm16Data, sampleRate, channels);
        // 验证 Opus 数据是否有效
        if (!opusData || opusData.length === 0) {
            throw new Error('Opus encoding produced empty data');
        }
        // 检查是否全为零
        const hasNonZero = opusData.some((byte) => byte !== 0);
        if (!hasNonZero) {
            logger_1.default.error({
                opusSize: opusData.length,
                pcm16Size: pcm16Data.length,
                sampleRate,
            }, 'Opus encoding produced all-zero data');
            throw new Error('Opus encoding produced all-zero data');
        }
        return opusData;
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger_1.default.error({
            error,
            pcm16Size: pcm16Data.length,
            sampleRate,
            channels,
            errorMessage,
        }, 'Opus encoding failed');
        throw new Error(`Opus encoding failed: ${errorMessage}`);
    }
}
/**
 * 将 WAV Buffer 转换为 Opus 编码的 Buffer
 *
 * @param wavBuffer WAV 格式的音频数据（Buffer）
 * @returns Opus 编码的音频数据（Buffer）
 */
async function convertWavToOpus(wavBuffer) {
    try {
        // 解析 WAV 文件，提取 PCM16 数据和元信息
        const { pcm16Data, sampleRate, channels } = (0, opus_encoder_1.parseWavFile)(wavBuffer);
        // 编码为 Opus
        const opusData = await encodePcm16ToOpusBuffer(pcm16Data, sampleRate, channels);
        logger_1.default.debug({
            wavSize: wavBuffer.length,
            opusSize: opusData.length,
            compression: (wavBuffer.length / opusData.length).toFixed(2),
            sampleRate,
            channels,
        }, 'WAV converted to Opus successfully');
        return opusData;
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger_1.default.error({
            error,
            wavSize: wavBuffer.length,
            errorMessage,
        }, 'Failed to convert WAV to Opus');
        throw new Error(`Failed to convert WAV to Opus: ${errorMessage}`);
    }
}
