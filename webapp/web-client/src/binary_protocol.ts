/**
 * Binary Frame 协议实现
 * Phase 2: WebSocket Binary Frame 格式
 */

/**
 * 二进制帧类型
 */
export enum BinaryFrameType {
  AUDIO_CHUNK = 0x01,
  FINAL = 0x02,
  PING = 0x10,
  PONG = 0x11,
}

/**
 * 音频块二进制帧格式
 * 
 * Header (12 bytes):
 * - frame_type: uint8 (1 byte) - 帧类型
 * - session_id_len: uint8 (1 byte) - session_id 长度
 * - seq: uint32 (4 bytes, little-endian) - 序列号
 * - timestamp: uint32 (4 bytes, little-endian) - 时间戳（毫秒）
 * - is_final: uint8 (1 byte) - 是否为结束帧 (0/1)
 * - reserved: uint8 (1 byte) - 保留字段
 * 
 * Payload:
 * - session_id: string (UTF-8, session_id_len bytes)
 * - audio_data: Uint8Array (剩余字节)
 */
export interface AudioChunkBinaryFrame {
  frameType: BinaryFrameType.AUDIO_CHUNK;
  sessionId: string;
  seq: number;
  timestamp: number;
  isFinal: boolean;
  audioData: Uint8Array;
}

/**
 * 结束帧二进制格式
 * 
 * Header (10 bytes):
 * - frame_type: uint8 (1 byte)
 * - session_id_len: uint8 (1 byte)
 * - seq: uint32 (4 bytes, little-endian)
 * - timestamp: uint32 (4 bytes, little-endian)
 * 
 * Payload:
 * - session_id: string (UTF-8, session_id_len bytes)
 */
export interface FinalBinaryFrame {
  frameType: BinaryFrameType.FINAL;
  sessionId: string;
  seq: number;
  timestamp: number;
}

export type BinaryFrame = AudioChunkBinaryFrame | FinalBinaryFrame;

/**
 * 编码音频块为二进制帧
 */
export function encodeAudioChunkFrame(frame: AudioChunkBinaryFrame): Uint8Array {
  const sessionIdBytes = new TextEncoder().encode(frame.sessionId);
  const sessionIdLen = sessionIdBytes.length;
  
  if (sessionIdLen > 255) {
    throw new Error('Session ID too long (max 255 bytes)');
  }
  
  // Header: 12 bytes
  // Payload: sessionIdBytes + audioData
  const totalLength = 12 + sessionIdLen + frame.audioData.length;
  const buffer = new ArrayBuffer(totalLength);
  const view = new DataView(buffer);
  const uint8View = new Uint8Array(buffer);
  
  let offset = 0;
  
  // frame_type
  view.setUint8(offset, frame.frameType);
  offset += 1;
  
  // session_id_len
  view.setUint8(offset, sessionIdLen);
  offset += 1;
  
  // seq (little-endian)
  view.setUint32(offset, frame.seq, true);
  offset += 4;
  
  // timestamp (little-endian)
  view.setUint32(offset, frame.timestamp, true);
  offset += 4;
  
  // is_final
  view.setUint8(offset, frame.isFinal ? 1 : 0);
  offset += 1;
  
  // reserved
  view.setUint8(offset, 0);
  offset += 1;
  
  // session_id
  uint8View.set(sessionIdBytes, offset);
  offset += sessionIdLen;
  
  // audio_data
  uint8View.set(frame.audioData, offset);
  
  return uint8View;
}

/**
 * 编码结束帧为二进制帧
 */
export function encodeFinalFrame(frame: FinalBinaryFrame): Uint8Array {
  const sessionIdBytes = new TextEncoder().encode(frame.sessionId);
  const sessionIdLen = sessionIdBytes.length;
  
  if (sessionIdLen > 255) {
    throw new Error('Session ID too long (max 255 bytes)');
  }
  
  // Header: 10 bytes
  // Payload: sessionIdBytes
  const totalLength = 10 + sessionIdLen;
  const buffer = new ArrayBuffer(totalLength);
  const view = new DataView(buffer);
  const uint8View = new Uint8Array(buffer);
  
  let offset = 0;
  
  // frame_type
  view.setUint8(offset, frame.frameType);
  offset += 1;
  
  // session_id_len
  view.setUint8(offset, sessionIdLen);
  offset += 1;
  
  // seq (little-endian)
  view.setUint32(offset, frame.seq, true);
  offset += 4;
  
  // timestamp (little-endian)
  view.setUint32(offset, frame.timestamp, true);
  offset += 4;
  
  // session_id
  uint8View.set(sessionIdBytes, offset);
  
  return uint8View;
}

/**
 * 解码二进制帧
 */
export function decodeBinaryFrame(data: Uint8Array): BinaryFrame {
  if (data.length < 10) {
    throw new Error('Binary frame too short (minimum 10 bytes)');
  }
  
  // 创建一个新的 ArrayBuffer 视图，确保正确的偏移
  const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  const view = new DataView(buffer);
  let offset = 0;
  
  // frame_type
  const frameType = view.getUint8(offset);
  offset += 1;
  
  // session_id_len
  const sessionIdLen = view.getUint8(offset);
  offset += 1;
  
  if (data.length < 10 + sessionIdLen) {
    throw new Error('Binary frame too short for session_id');
  }
  
  // seq
  const seq = view.getUint32(offset, true);
  offset += 4;
  
  // timestamp
  const timestamp = view.getUint32(offset, true);
  offset += 4;
  
  if (frameType === BinaryFrameType.AUDIO_CHUNK) {
    // 对于 AUDIO_CHUNK，格式是：is_final, reserved, session_id, audio_data
    if (data.length < 12 + sessionIdLen) {
      throw new Error('Binary frame too short for audio chunk');
    }
    
    // is_final
    const isFinal = view.getUint8(offset) !== 0;
    offset += 1;
    
    // reserved
    offset += 1;
    
    // session_id (在 is_final 和 reserved 之后)
    if (offset + sessionIdLen > data.length) {
      throw new Error('Binary frame too short for session_id');
    }
    
    const sessionIdBytes = new Uint8Array(buffer, offset, sessionIdLen);
    const sessionId = new TextDecoder().decode(sessionIdBytes);
    offset += sessionIdLen;
    
    // audio_data
    const audioData = new Uint8Array(buffer, offset, data.length - offset);
    
    return {
      frameType: BinaryFrameType.AUDIO_CHUNK,
      sessionId,
      seq,
      timestamp,
      isFinal,
      audioData,
    };
  } else if (frameType === BinaryFrameType.FINAL) {
    // 对于 FINAL，session_id 在 timestamp 之后
    if (data.length < 10 + sessionIdLen) {
      throw new Error('Binary frame too short for session_id');
    }
    
    const sessionIdBytes = new Uint8Array(buffer, offset, sessionIdLen);
    const sessionId = new TextDecoder().decode(sessionIdBytes);
    
    return {
      frameType: BinaryFrameType.FINAL,
      sessionId,
      seq,
      timestamp,
    };
  } else {
    throw new Error(`Unknown frame type: ${frameType}`);
  }
}

/**
 * 检查数据是否为二进制帧（通过检查第一个字节是否为已知的帧类型）
 */
export function isBinaryFrame(data: Uint8Array): boolean {
  if (data.length === 0) {
    return false;
  }
  
  const frameType = data[0];
  return Object.values(BinaryFrameType).includes(frameType as BinaryFrameType);
}

