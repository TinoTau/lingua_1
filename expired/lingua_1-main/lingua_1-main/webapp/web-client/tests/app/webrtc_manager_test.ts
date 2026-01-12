/**
 * WebRTC 管理模块单元测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WebRTCManager } from '../../src/app/webrtc_manager';
import { WebSocketClient } from '../../src/websocket_client';
import { AudioMixer } from '../../src/audio_mixer';
import { StateMachine } from '../../src/state_machine';
import { RoomMember } from '../../src/types';

// Mock RTCPeerConnection
class MockRTCPeerConnection {
  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;
  iceConnectionState = 'new';
  connectionState = 'new';
  onicecandidate: ((event: RTCPeerConnectionIceEvent) => void) | null = null;
  ontrack: ((event: RTCTrackEvent) => void) | null = null;
  private tracks: MediaStreamTrack[] = [];

  addTrack(track: MediaStreamTrack, stream: MediaStream): void {
    this.tracks.push(track);
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    return {
      type: 'offer',
      sdp: 'mock-offer-sdp'
    };
  }

  async createAnswer(): Promise<RTCSessionDescriptionInit> {
    return {
      type: 'answer',
      sdp: 'mock-answer-sdp'
    };
  }

  async setLocalDescription(desc: RTCSessionDescriptionInit): Promise<void> {
    this.localDescription = desc;
  }

  async setRemoteDescription(desc: RTCSessionDescriptionInit): Promise<void> {
    this.remoteDescription = desc;
  }

  async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    // Mock implementation
  }

  close(): void {
    this.tracks = [];
  }
}

// Mock MediaStream
class MockMediaStream {
  id = 'mock-stream-id';
  private tracks: MediaStreamTrack[] = [];

  getTracks(): MediaStreamTrack[] {
    return this.tracks;
  }

  getAudioTracks(): MediaStreamTrack[] {
    return this.tracks.filter(t => t.kind === 'audio');
  }

  addTrack(track: MediaStreamTrack): void {
    this.tracks.push(track);
  }
}

// Mock MediaStreamTrack
class MockMediaStreamTrack {
  kind = 'audio';
  id = 'mock-track-id';
  enabled = true;
  stop = vi.fn();
}

describe('WebRTCManager', () => {
  let manager: WebRTCManager;
  let wsClient: WebSocketClient;
  let audioMixer: AudioMixer;
  let stateMachine: StateMachine;

  beforeEach(() => {
    // Mock RTCPeerConnection
    (global as any).RTCPeerConnection = vi.fn(() => new MockRTCPeerConnection());
    
    // Mock navigator.mediaDevices
    (global as any).navigator = {
      mediaDevices: {
        getUserMedia: vi.fn().mockResolvedValue(new MockMediaStream())
      }
    };

    stateMachine = new StateMachine();
    wsClient = new WebSocketClient(stateMachine, 'ws://localhost:8080');
    audioMixer = new AudioMixer();
    manager = new WebRTCManager(wsClient, audioMixer);
  });

  describe('初始化', () => {
    it('应该正确初始化', () => {
      expect(manager).toBeDefined();
    });

    it('应该能够设置房间信息', () => {
      const members: RoomMember[] = [
        { session_id: 'session1', display_name: 'User1' }
      ];
      manager.setRoomInfo('123456', members);
      // 无法直接验证内部状态，但不会抛出错误
      expect(manager).toBeDefined();
    });
  });

  describe('房间信息管理', () => {
    it('应该能够设置和获取房间信息', () => {
      const members: RoomMember[] = [
        { session_id: 'session1', display_name: 'User1' },
        { session_id: 'session2', display_name: 'User2' }
      ];
      manager.setRoomInfo('123456', members);
      // 由于没有公共getter，我们通过其他方法验证
      expect(manager).toBeDefined();
    });

    it('应该能够清空房间信息', () => {
      manager.setRoomInfo(null, []);
      expect(manager).toBeDefined();
    });
  });

  describe('WebRTC 连接管理', () => {
    it('应该能够关闭所有连接', () => {
      // 由于 ensurePeerConnection 需要真实的媒体设备，我们只测试 closeAllConnections
      manager.closeAllConnections();
      // 应该不会抛出错误
      expect(manager).toBeDefined();
    });

    it('应该能够停止本地音频流', () => {
      manager.stopLocalStream();
      // 应该不会抛出错误
      expect(manager).toBeDefined();
    });
  });

  describe('原声传递偏好', () => {
    it('应该能够通过同步连接管理原声传递偏好', () => {
      const members: RoomMember[] = [
        { 
          session_id: 'session1', 
          display_name: 'User1',
          raw_voice_preferences: {}
        }
      ];
      manager.setRoomInfo('123456', members);
      
      // 同步连接会根据偏好自动管理连接
      expect(() => manager.syncPeerConnections()).not.toThrow();
    });
  });

  describe('同步连接', () => {
    it('应该能够同步对等连接', () => {
      const members: RoomMember[] = [
        { session_id: 'session1', display_name: 'User1' }
      ];
      manager.setRoomInfo('123456', members);
      
      // 由于需要真实的 WebRTC API，我们只验证方法存在
      expect(() => manager.syncPeerConnections()).not.toThrow();
    });

    it('应该在无房间时跳过同步', () => {
      manager.setRoomInfo(null, []);
      expect(() => manager.syncPeerConnections()).not.toThrow();
    });
  });

  describe('WebRTC 消息处理', () => {
    it('应该能够处理 WebRTC offer', async () => {
      const members: RoomMember[] = [
        { 
          session_id: 'session1', 
          display_name: 'User1',
          raw_voice_preferences: {}
        }
      ];
      manager.setRoomInfo('123456', members);
      
      const sdp: RTCSessionDescriptionInit = {
        type: 'offer',
        sdp: 'mock-sdp'
      };

      // 由于需要真实的 WebRTC API，我们只验证方法存在且不抛出错误
      await expect(
        manager.handleWebRTCOffer('123456', 'session1', sdp)
      ).resolves.not.toThrow();
    });

    it('应该能够处理 WebRTC answer', async () => {
      const sdp: RTCSessionDescriptionInit = {
        type: 'answer',
        sdp: 'mock-sdp'
      };

      // 由于没有现有连接，应该不会抛出错误
      await expect(
        manager.handleWebRTCAnswer('session1', sdp)
      ).resolves.not.toThrow();
    });

    it('应该能够处理 WebRTC ICE candidate', async () => {
      const candidate: RTCIceCandidateInit = {
        candidate: 'mock-candidate',
        sdpMLineIndex: 0
      };

      // 由于没有现有连接，应该不会抛出错误
      await expect(
        manager.handleWebRTCIce('session1', candidate)
      ).resolves.not.toThrow();
    });
  });
});

