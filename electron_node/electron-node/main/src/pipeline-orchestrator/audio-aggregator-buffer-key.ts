/**
 * AudioBuffer Key 生成工具
 * 
 * 功能：生成唯一、稳定、显式的 bufferKey
 * 
 * 规范：
 * - bufferKey = session_id [+ room_code] [+ input_stream_id / speaker_id]
 * - 若同一输入音频需要服务多个目标语言，则 target_lang 不应进入 key
 * - 若不同 target_lang 需要完全隔离，则 target_lang 必须进入 key
 * 
 * 设计原则：
 * - 唯一性：不同输入流必须有不同的 bufferKey
 * - 稳定性：同一输入流在整个生命周期内 bufferKey 不变
 * - 显式性：bufferKey 的生成规则清晰明确
 */

import { JobAssignMessage } from '@shared/protocols/messages';
import logger from '../logger';

export interface BufferKeyContext {
  sessionId: string;
  roomCode?: string;
  inputStreamId?: string;
  speakerId?: string;
  targetLang?: string;  // 仅在需要完全隔离时使用
}

/**
 * 构建 bufferKey
 * 
 * @param job JobAssignMessage
 * @param ctx 可选的上下文信息（用于房间模式、多输入流等场景）
 * @returns bufferKey 字符串
 */
export function buildBufferKey(
  job: JobAssignMessage,
  ctx?: Partial<BufferKeyContext>
): string {
  const sessionId = job.session_id;
  
  // 基础 key：session_id（必选）
  const keyParts: string[] = [sessionId];
  
  // 可选字段：room_code（房间模式）
  const roomCode = ctx?.roomCode || (job as any).room_code;
  if (roomCode) {
    keyParts.push(`room:${roomCode}`);
  }
  
  // 可选字段：input_stream_id 或 speaker_id（多输入流/多说话人）
  const inputStreamId = ctx?.inputStreamId || (job as any).input_stream_id;
  const speakerId = ctx?.speakerId || (job as any).speaker_id;
  if (inputStreamId) {
    keyParts.push(`stream:${inputStreamId}`);
  } else if (speakerId) {
    keyParts.push(`speaker:${speakerId}`);
  }
  
  // 可选字段：target_lang（仅在需要完全隔离时使用）
  // 注意：默认情况下，同一输入音频服务多个目标语言时，target_lang 不应进入 key
  // 只有在明确需要隔离不同 target_lang 的场景下，才将 target_lang 加入 key
  const targetLang = ctx?.targetLang;
  if (targetLang) {
    keyParts.push(`lang:${targetLang}`);
  }
  
  const bufferKey = keyParts.join('|');
  
  // 仅在开发/调试时打印日志（避免生产环境过多日志）
  if (logger && logger.debug) {
    logger.debug(
      {
        bufferKey,
        sessionId,
        roomCode,
        inputStreamId,
        speakerId,
        targetLang,
        keyParts,
      },
      'buildBufferKey: Generated buffer key'
    );
  }
  
  return bufferKey;
}

/**
 * 从 bufferKey 解析上下文信息（用于调试和日志）
 */
export function parseBufferKey(bufferKey: string): BufferKeyContext {
  const parts = bufferKey.split('|');
  const sessionId = parts[0];
  
  const context: BufferKeyContext = {
    sessionId,
  };
  
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    if (part.startsWith('room:')) {
      context.roomCode = part.substring(5);
    } else if (part.startsWith('stream:')) {
      context.inputStreamId = part.substring(7);
    } else if (part.startsWith('speaker:')) {
      context.speakerId = part.substring(8);
    } else if (part.startsWith('lang:')) {
      context.targetLang = part.substring(5);
    }
  }
  
  return context;
}
