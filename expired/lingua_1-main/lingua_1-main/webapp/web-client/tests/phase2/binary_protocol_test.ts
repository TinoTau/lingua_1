import { describe, it, expect } from 'vitest';
import {
  encodeAudioChunkFrame,
  encodeFinalFrame,
  decodeBinaryFrame,
  isBinaryFrame,
  BinaryFrameType,
  AudioChunkBinaryFrame,
  FinalBinaryFrame,
} from '../../src/binary_protocol';

describe('Binary Protocol', () => {
  describe('encodeAudioChunkFrame', () => {
    it('should encode audio chunk frame correctly', () => {
      const frame: AudioChunkBinaryFrame = {
        frameType: BinaryFrameType.AUDIO_CHUNK,
        sessionId: 'test-session-123',
        seq: 42,
        timestamp: 1234567890,
        isFinal: false,
        audioData: new Uint8Array([1, 2, 3, 4, 5]),
      };

      const encoded = encodeAudioChunkFrame(frame);
      
      // 验证长度：12 bytes header + sessionId length + audioData length
      expect(encoded.length).toBe(12 + frame.sessionId.length + frame.audioData.length);
      
      // 验证可以解码
      const decoded = decodeBinaryFrame(encoded);
      expect(decoded.frameType).toBe(BinaryFrameType.AUDIO_CHUNK);
      expect((decoded as AudioChunkBinaryFrame).sessionId).toBe(frame.sessionId);
      expect((decoded as AudioChunkBinaryFrame).seq).toBe(frame.seq);
      expect((decoded as AudioChunkBinaryFrame).timestamp).toBe(frame.timestamp);
      expect((decoded as AudioChunkBinaryFrame).isFinal).toBe(frame.isFinal);
      expect((decoded as AudioChunkBinaryFrame).audioData).toEqual(frame.audioData);
    });

    it('should encode final audio chunk frame correctly', () => {
      const frame: AudioChunkBinaryFrame = {
        frameType: BinaryFrameType.AUDIO_CHUNK,
        sessionId: 'test-session-123',
        seq: 100,
        timestamp: 9876543210,
        isFinal: true,
        audioData: new Uint8Array([10, 20, 30]),
      };

      const encoded = encodeAudioChunkFrame(frame);
      const decoded = decodeBinaryFrame(encoded) as AudioChunkBinaryFrame;
      
      expect(decoded.isFinal).toBe(true);
      expect(decoded.audioData).toEqual(frame.audioData);
    });

    it('should handle long session IDs', () => {
      const longSessionId = 'a'.repeat(200);
      const frame: AudioChunkBinaryFrame = {
        frameType: BinaryFrameType.AUDIO_CHUNK,
        sessionId: longSessionId,
        seq: 1,
        timestamp: 1000,
        isFinal: false,
        audioData: new Uint8Array([1]),
      };

      const encoded = encodeAudioChunkFrame(frame);
      const decoded = decodeBinaryFrame(encoded) as AudioChunkBinaryFrame;
      
      expect(decoded.sessionId).toBe(longSessionId);
    });

    it('should throw error for session ID longer than 255 bytes', () => {
      const longSessionId = 'a'.repeat(256);
      const frame: AudioChunkBinaryFrame = {
        frameType: BinaryFrameType.AUDIO_CHUNK,
        sessionId: longSessionId,
        seq: 1,
        timestamp: 1000,
        isFinal: false,
        audioData: new Uint8Array([1]),
      };

      expect(() => encodeAudioChunkFrame(frame)).toThrow('Session ID too long');
    });
  });

  describe('encodeFinalFrame', () => {
    it('should encode final frame correctly', () => {
      const frame: FinalBinaryFrame = {
        frameType: BinaryFrameType.FINAL,
        sessionId: 'test-session-456',
        seq: 99,
        timestamp: 1234567890, // uint32 最大值是 4294967295
      };

      const encoded = encodeFinalFrame(frame);
      
      // 验证长度：10 bytes header + sessionId length
      expect(encoded.length).toBe(10 + frame.sessionId.length);
      
      // 验证可以解码
      const decoded = decodeBinaryFrame(encoded) as FinalBinaryFrame;
      expect(decoded.frameType).toBe(BinaryFrameType.FINAL);
      expect(decoded.sessionId).toBe(frame.sessionId);
      expect(decoded.seq).toBe(frame.seq);
      expect(decoded.timestamp).toBe(frame.timestamp);
    });
  });

  describe('decodeBinaryFrame', () => {
    it('should decode audio chunk frame correctly', () => {
      const frame: AudioChunkBinaryFrame = {
        frameType: BinaryFrameType.AUDIO_CHUNK,
        sessionId: 'test-session',
        seq: 123,
        timestamp: 1234567890, // uint32 最大值是 4294967295
        isFinal: false,
        audioData: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
      };

      const encoded = encodeAudioChunkFrame(frame);
      const decoded = decodeBinaryFrame(encoded) as AudioChunkBinaryFrame;
      
      expect(decoded.frameType).toBe(BinaryFrameType.AUDIO_CHUNK);
      expect(decoded.sessionId).toBe(frame.sessionId);
      expect(decoded.seq).toBe(frame.seq);
      expect(decoded.timestamp).toBe(frame.timestamp);
      expect(decoded.isFinal).toBe(frame.isFinal);
      expect(decoded.audioData).toEqual(frame.audioData);
    });

    it('should decode final frame correctly', () => {
      const frame: FinalBinaryFrame = {
        frameType: BinaryFrameType.FINAL,
        sessionId: 'final-session',
        seq: 456,
        timestamp: 1111111111,
      };

      const encoded = encodeFinalFrame(frame);
      const decoded = decodeBinaryFrame(encoded) as FinalBinaryFrame;
      
      expect(decoded.frameType).toBe(BinaryFrameType.FINAL);
      expect(decoded.sessionId).toBe(frame.sessionId);
      expect(decoded.seq).toBe(frame.seq);
      expect(decoded.timestamp).toBe(frame.timestamp);
    });

    it('should throw error for frame too short', () => {
      const shortFrame = new Uint8Array([1, 2, 3]);
      expect(() => decodeBinaryFrame(shortFrame)).toThrow('Binary frame too short');
    });

    it('should throw error for unknown frame type', () => {
      // 创建一个无效的帧类型
      const buffer = new ArrayBuffer(20);
      const view = new DataView(buffer);
      view.setUint8(0, 0xFF); // 无效的帧类型
      view.setUint8(1, 5); // session_id_len
      view.setUint32(2, 1, true); // seq
      view.setUint32(6, 1000, true); // timestamp
      
      const invalidFrame = new Uint8Array(buffer);
      expect(() => decodeBinaryFrame(invalidFrame)).toThrow('Unknown frame type');
    });
  });

  describe('isBinaryFrame', () => {
    it('should identify binary frames correctly', () => {
      const frame: AudioChunkBinaryFrame = {
        frameType: BinaryFrameType.AUDIO_CHUNK,
        sessionId: 'test',
        seq: 1,
        timestamp: 1000,
        isFinal: false,
        audioData: new Uint8Array([1]),
      };

      const encoded = encodeAudioChunkFrame(frame);
      expect(isBinaryFrame(encoded)).toBe(true);
    });

    it('should return false for empty data', () => {
      expect(isBinaryFrame(new Uint8Array(0))).toBe(false);
    });

    it('should return false for invalid frame type', () => {
      const invalidFrame = new Uint8Array([0xFF]);
      expect(isBinaryFrame(invalidFrame)).toBe(false);
    });

    it('should return true for valid frame types', () => {
      expect(isBinaryFrame(new Uint8Array([BinaryFrameType.AUDIO_CHUNK]))).toBe(true);
      expect(isBinaryFrame(new Uint8Array([BinaryFrameType.FINAL]))).toBe(true);
      expect(isBinaryFrame(new Uint8Array([BinaryFrameType.PING]))).toBe(true);
      expect(isBinaryFrame(new Uint8Array([BinaryFrameType.PONG]))).toBe(true);
    });
  });

  describe('round-trip encoding/decoding', () => {
    it('should preserve all data through encode/decode cycle', () => {
      const originalFrame: AudioChunkBinaryFrame = {
        frameType: BinaryFrameType.AUDIO_CHUNK,
        sessionId: 'round-trip-test-session-id',
        seq: 999,
        timestamp: 1234567890, // uint32 最大值是 4294967295
        isFinal: true,
        audioData: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]),
      };

      const encoded = encodeAudioChunkFrame(originalFrame);
      const decoded = decodeBinaryFrame(encoded) as AudioChunkBinaryFrame;
      
      expect(decoded.frameType).toBe(originalFrame.frameType);
      expect(decoded.sessionId).toBe(originalFrame.sessionId);
      expect(decoded.seq).toBe(originalFrame.seq);
      expect(decoded.timestamp).toBe(originalFrame.timestamp);
      expect(decoded.isFinal).toBe(originalFrame.isFinal);
      expect(decoded.audioData.length).toBe(originalFrame.audioData.length);
      expect(decoded.audioData).toEqual(originalFrame.audioData);
    });
  });
});

