/**
 * Plan A Opus Packet格式单元测试
 * 
 * 测试Web端按照Plan A规范发送Opus packet的功能
 * Plan A格式：uint16_le packet_len + packet_bytes
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { OpusEncoderImpl, AudioCodecConfig } from '../../src/audio_codec';

describe('Plan A Opus Packet Format', () => {
  let encoder: OpusEncoderImpl;
  const sampleRate = 16000;
  const frameSizeMs = 20;
  const frameSize = Math.floor(sampleRate * frameSizeMs / 1000); // 320 samples

  beforeEach(async () => {
    const config: AudioCodecConfig = {
      codec: 'opus',
      sampleRate: sampleRate,
      channelCount: 1,
      frameSizeMs: frameSizeMs,
      application: 'voip',
    };
    encoder = new OpusEncoderImpl(config);
    // 等待编码器初始化
    await encoder.encode(new Float32Array(frameSize));
  });

  describe('encodePackets()', () => {
    it('should return packet array for single frame', async () => {
      const audioData = new Float32Array(frameSize);
      // 填充测试数据（正弦波）
      for (let i = 0; i < frameSize; i++) {
        audioData[i] = Math.sin((i / frameSize) * Math.PI * 2) * 0.5;
      }

      const packets = await encoder.encodePackets(audioData);

      expect(packets).toBeInstanceOf(Array);
      expect(packets.length).toBe(1);
      expect(packets[0]).toBeInstanceOf(Uint8Array);
      expect(packets[0].length).toBeGreaterThan(0);
    });

    it('should return multiple packets for multiple frames', async () => {
      // 创建3个完整帧的音频数据
      const audioData = new Float32Array(frameSize * 3);
      for (let i = 0; i < audioData.length; i++) {
        audioData[i] = Math.sin((i / audioData.length) * Math.PI * 2) * 0.5;
      }

      const packets = await encoder.encodePackets(audioData);

      expect(packets.length).toBe(3);
      packets.forEach(packet => {
        expect(packet).toBeInstanceOf(Uint8Array);
        expect(packet.length).toBeGreaterThan(0);
      });
    });

    it('should handle incomplete frame by padding', async () => {
      // 创建不完整的帧（只有一半）
      const incompleteFrameSize = Math.floor(frameSize / 2);
      const audioData = new Float32Array(incompleteFrameSize);
      for (let i = 0; i < incompleteFrameSize; i++) {
        audioData[i] = Math.sin((i / incompleteFrameSize) * Math.PI * 2) * 0.5;
      }

      const packets = await encoder.encodePackets(audioData);

      // 应该返回1个packet（填充后的完整帧）
      expect(packets.length).toBe(1);
      expect(packets[0]).toBeInstanceOf(Uint8Array);
      expect(packets[0].length).toBeGreaterThan(0);
    });

    it('should return empty array for empty input', async () => {
      const audioData = new Float32Array(0);
      const packets = await encoder.encodePackets(audioData);

      expect(packets.length).toBe(0);
    });
  });

  describe('Plan A Format Packing', () => {
    /**
     * 模拟sendUtterance中的Plan A格式打包逻辑
     */
    function packPlanAFormat(packets: Uint8Array[]): Uint8Array {
      const packetDataParts: Uint8Array[] = [];
      let totalSize = 0;

      for (const packet of packets) {
        if (packet.length === 0) continue;

        // packet_len (uint16_le, 2 bytes)
        const lenBuffer = new ArrayBuffer(2);
        const lenView = new DataView(lenBuffer);
        lenView.setUint16(0, packet.length, true); // little-endian

        packetDataParts.push(new Uint8Array(lenBuffer));
        packetDataParts.push(packet);

        totalSize += 2 + packet.length;
      }

      // 合并所有packet数据
      const result = new Uint8Array(totalSize);
      let offset = 0;
      for (const part of packetDataParts) {
        result.set(part, offset);
        offset += part.length;
      }

      return result;
    }

    it('should pack single packet with length prefix', () => {
      const packet = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
      const packed = packPlanAFormat([packet]);

      // 应该包含：2字节长度前缀 + 4字节数据 = 6字节
      expect(packed.length).toBe(6);

      // 验证长度前缀（little-endian）
      const lenView = new DataView(packed.buffer, 0, 2);
      const packetLen = lenView.getUint16(0, true);
      expect(packetLen).toBe(4);

      // 验证数据内容
      expect(packed[2]).toBe(0x01);
      expect(packed[3]).toBe(0x02);
      expect(packed[4]).toBe(0x03);
      expect(packed[5]).toBe(0x04);
    });

    it('should pack multiple packets correctly', () => {
      const packet1 = new Uint8Array([0x01, 0x02]);
      const packet2 = new Uint8Array([0x03, 0x04, 0x05]);
      const packet3 = new Uint8Array([0x06]);
      const packed = packPlanAFormat([packet1, packet2, packet3]);

      // 应该包含：3个packet，每个2字节长度前缀 + 数据
      // (2+2) + (2+3) + (2+1) = 12字节
      expect(packed.length).toBe(12);

      // 验证第一个packet
      const len1 = new DataView(packed.buffer, 0, 2).getUint16(0, true);
      expect(len1).toBe(2);
      expect(packed[2]).toBe(0x01);
      expect(packed[3]).toBe(0x02);

      // 验证第二个packet
      const len2 = new DataView(packed.buffer, 4, 2).getUint16(0, true);
      expect(len2).toBe(3);
      expect(packed[6]).toBe(0x03);
      expect(packed[7]).toBe(0x04);
      expect(packed[8]).toBe(0x05);

      // 验证第三个packet
      const len3 = new DataView(packed.buffer, 9, 2).getUint16(0, true);
      expect(len3).toBe(1);
      expect(packed[11]).toBe(0x06);
    });

    it('should skip empty packets', () => {
      const packet1 = new Uint8Array([0x01, 0x02]);
      const emptyPacket = new Uint8Array(0);
      const packet2 = new Uint8Array([0x03, 0x04]);
      const packed = packPlanAFormat([packet1, emptyPacket, packet2]);

      // 应该只包含2个packet（跳过空packet）
      // (2+2) + (2+2) = 8字节
      expect(packed.length).toBe(8);

      // 验证第一个packet
      const len1 = new DataView(packed.buffer, 0, 2).getUint16(0, true);
      expect(len1).toBe(2);

      // 验证第二个packet（应该是packet2，因为emptyPacket被跳过）
      const len2 = new DataView(packed.buffer, 4, 2).getUint16(0, true);
      expect(len2).toBe(2);
      expect(packed[6]).toBe(0x03);
      expect(packed[7]).toBe(0x04);
    });

    it('should handle maximum packet size (65535 bytes)', () => {
      const maxPacket = new Uint8Array(65535).fill(0xAA);
      const packed = packPlanAFormat([maxPacket]);

      expect(packed.length).toBe(65537); // 2字节长度 + 65535字节数据

      const lenView = new DataView(packed.buffer, 0, 2);
      const packetLen = lenView.getUint16(0, true);
      expect(packetLen).toBe(65535);
    });
  });

  describe('End-to-End Plan A Format', () => {
    it('should encode and pack audio data in Plan A format', async () => {
      // 创建2个完整帧的音频数据
      const audioData = new Float32Array(frameSize * 2);
      for (let i = 0; i < audioData.length; i++) {
        audioData[i] = Math.sin((i / audioData.length) * Math.PI * 2) * 0.5;
      }

      // 1. 编码为packet数组
      const packets = await encoder.encodePackets(audioData);
      expect(packets.length).toBe(2);

      // 2. 打包为Plan A格式
      const packetDataParts: Uint8Array[] = [];
      let totalSize = 0;

      for (const packet of packets) {
        if (packet.length === 0) continue;

        const lenBuffer = new ArrayBuffer(2);
        const lenView = new DataView(lenBuffer);
        lenView.setUint16(0, packet.length, true);

        packetDataParts.push(new Uint8Array(lenBuffer));
        packetDataParts.push(packet);

        totalSize += 2 + packet.length;
      }

      const packed = new Uint8Array(totalSize);
      let offset = 0;
      for (const part of packetDataParts) {
        packed.set(part, offset);
        offset += part.length;
      }

      // 3. 验证格式
      expect(packed.length).toBeGreaterThan(0);
      
      // 验证第一个packet的长度前缀
      const len1 = new DataView(packed.buffer, 0, 2).getUint16(0, true);
      expect(len1).toBe(packets[0].length);
      expect(len1).toBeGreaterThan(0);
      expect(len1).toBeLessThanOrEqual(4096); // 合理的Opus packet大小上限

      // 验证可以解析出所有packet
      let currentOffset = 0;
      const parsedPackets: Uint8Array[] = [];
      
      while (currentOffset < packed.length) {
        if (currentOffset + 2 > packed.length) break;
        
        const packetLen = new DataView(packed.buffer, currentOffset, 2).getUint16(0, true);
        if (packetLen === 0 || packetLen > 4096) break;
        
        if (currentOffset + 2 + packetLen > packed.length) break;
        
        const packetData = packed.slice(currentOffset + 2, currentOffset + 2 + packetLen);
        parsedPackets.push(packetData);
        
        currentOffset += 2 + packetLen;
      }

      expect(parsedPackets.length).toBe(2);
      expect(parsedPackets[0].length).toBe(packets[0].length);
      expect(parsedPackets[1].length).toBe(packets[1].length);
    });

    it('should produce format compatible with node-side PacketFramer', async () => {
      // 创建测试音频数据
      const audioData = new Float32Array(frameSize * 3);
      for (let i = 0; i < audioData.length; i++) {
        audioData[i] = Math.sin((i / audioData.length) * Math.PI * 4) * 0.3;
      }

      // 编码和打包
      const packets = await encoder.encodePackets(audioData);
      
      const packetDataParts: Uint8Array[] = [];
      let totalSize = 0;

      for (const packet of packets) {
        if (packet.length === 0) continue;

        const lenBuffer = new ArrayBuffer(2);
        const lenView = new DataView(lenBuffer);
        lenView.setUint16(0, packet.length, true);

        packetDataParts.push(new Uint8Array(lenBuffer));
        packetDataParts.push(packet);

        totalSize += 2 + packet.length;
      }

      const packed = new Uint8Array(totalSize);
      let offset = 0;
      for (const part of packetDataParts) {
        packed.set(part, offset);
        offset += part.length;
      }

      // 模拟节点端的PacketFramer解析逻辑
      const parsedPackets: Array<{ seq: number | null; data: Uint8Array }> = [];
      let buffer = new Uint8Array(packed);
      let bufferOffset = 0;

      while (bufferOffset < buffer.length) {
        // 检查是否有足够的数据读取长度前缀
        if (bufferOffset + 2 > buffer.length) break;

        // 读取packet长度（uint16_le）
        const lenView = new DataView(buffer.buffer, bufferOffset, 2);
        const packetLen = lenView.getUint16(0, true);

        // 验证packet长度合理
        if (packetLen === 0 || packetLen > 4096) {
          break; // 协议错误
        }

        // 检查是否有足够的数据读取完整packet
        if (bufferOffset + 2 + packetLen > buffer.length) {
          break; // 数据不足
        }

        // 提取packet数据
        const packetData = buffer.slice(bufferOffset + 2, bufferOffset + 2 + packetLen);
        parsedPackets.push({ seq: null, data: packetData });

        bufferOffset += 2 + packetLen;
      }

      // 验证解析结果
      expect(parsedPackets.length).toBe(3);
      parsedPackets.forEach((parsed, index) => {
        expect(parsed.data.length).toBe(packets[index].length);
        // 验证数据内容匹配
        for (let i = 0; i < parsed.data.length; i++) {
          expect(parsed.data[i]).toBe(packets[index][i]);
        }
      });
    });
  });

  describe('Base64 Encoding Compatibility', () => {
    it('should produce base64-encodable data', async () => {
      const audioData = new Float32Array(frameSize);
      for (let i = 0; i < frameSize; i++) {
        audioData[i] = Math.sin((i / frameSize) * Math.PI * 2) * 0.5;
      }

      const packets = await encoder.encodePackets(audioData);
      
      // 打包为Plan A格式
      const packetDataParts: Uint8Array[] = [];
      let totalSize = 0;

      for (const packet of packets) {
        if (packet.length === 0) continue;

        const lenBuffer = new ArrayBuffer(2);
        const lenView = new DataView(lenBuffer);
        lenView.setUint16(0, packet.length, true);

        packetDataParts.push(new Uint8Array(lenBuffer));
        packetDataParts.push(packet);

        totalSize += 2 + packet.length;
      }

      const packed = new Uint8Array(totalSize);
      let offset = 0;
      for (const part of packetDataParts) {
        packed.set(part, offset);
        offset += part.length;
      }

      // Base64编码（模拟sendUtterance中的逻辑）
      let base64: string;
      if (packed.length < 65536) {
        base64 = btoa(String.fromCharCode(...packed));
      } else {
        const chunks: string[] = [];
        for (let i = 0; i < packed.length; i += 8192) {
          const chunk = packed.slice(i, i + 8192);
          chunks.push(String.fromCharCode(...chunk));
        }
        base64 = btoa(chunks.join(''));
      }

      // 验证可以解码
      const decoded = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
      expect(decoded.length).toBe(packed.length);
      
      // 验证数据完整性
      for (let i = 0; i < decoded.length; i++) {
        expect(decoded[i]).toBe(packed[i]);
      }
    });
  });
});

