/**
 * 原声传递偏好实时切换功能测试
 * 
 * 测试范围：
 * - 原声传递偏好的设置和检查
 * - WebRTC 连接的建立和断开逻辑
 * - 成员列表更新时的连接同步
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// 模拟 RoomMember 类型
interface RoomMember {
  participant_id: string;
  session_id?: string;
  display_name?: string;
  preferred_lang?: string;
  raw_voice_preferences?: Record<string, boolean>;
  joined_at?: number;
}

// 模拟原声传递偏好管理类
class RawVoicePreferenceManager {
  private roomMembers: RoomMember[] = [];
  private currentSessionId: string | null = null;
  private peerConnections: Map<string, MockPeerConnection> = new Map();
  private connectionCallbacks: {
    onConnect?: (memberId: string) => void;
    onDisconnect?: (memberId: string) => void;
  } = {};

  constructor(currentSessionId: string) {
    this.currentSessionId = currentSessionId;
  }

  /**
   * 设置连接回调（用于测试）
   */
  setConnectionCallbacks(callbacks: {
    onConnect?: (memberId: string) => void;
    onDisconnect?: (memberId: string) => void;
  }): void {
    this.connectionCallbacks = callbacks;
  }

  /**
   * 设置成员列表
   */
  setRoomMembers(members: RoomMember[]): void {
    this.roomMembers = members;
  }

  /**
   * 检查是否应该接收某个成员的原声
   */
  shouldReceiveRawVoice(targetSessionId: string): boolean {
    if (!this.currentSessionId) {
      return false;
    }

    // 查找目标成员
    const targetMember = this.roomMembers.find(
      m => (m.session_id || m.participant_id) === targetSessionId
    );

    if (!targetMember) {
      return false;
    }

    // 检查偏好设置（默认接收）
    const rawVoicePrefs = targetMember.raw_voice_preferences || {};
    return rawVoicePrefs[this.currentSessionId] !== false;
  }

  /**
   * 设置原声传递偏好
   */
  setRawVoicePreference(targetSessionId: string, receiveRawVoice: boolean): void {
    // 更新成员偏好（模拟服务器更新）
    const targetMember = this.roomMembers.find(
      m => (m.session_id || m.participant_id) === targetSessionId
    );

    if (targetMember) {
      if (!targetMember.raw_voice_preferences) {
        targetMember.raw_voice_preferences = {};
      }
      if (this.currentSessionId) {
        targetMember.raw_voice_preferences[this.currentSessionId] = receiveRawVoice;
      }
    }

    // 实时切换 WebRTC 连接
    if (receiveRawVoice) {
      this.ensurePeerConnection(targetSessionId);
    } else {
      this.closePeerConnection(targetSessionId);
    }
  }

  /**
   * 确保与目标成员的 WebRTC 连接存在
   */
  private ensurePeerConnection(targetSessionId: string): void {
    // 如果连接已存在，直接返回
    if (this.peerConnections.has(targetSessionId)) {
      return;
    }

    // 创建模拟连接
    const pc = new MockPeerConnection(targetSessionId);
    this.peerConnections.set(targetSessionId, pc);

    // 触发连接回调
    if (this.connectionCallbacks.onConnect) {
      this.connectionCallbacks.onConnect(targetSessionId);
    }
  }

  /**
   * 关闭与目标成员的 WebRTC 连接
   */
  private closePeerConnection(targetSessionId: string): void {
    const pc = this.peerConnections.get(targetSessionId);
    if (pc) {
      pc.close();
      this.peerConnections.delete(targetSessionId);

      // 触发断开回调
      if (this.connectionCallbacks.onDisconnect) {
        this.connectionCallbacks.onDisconnect(targetSessionId);
      }
    }
  }

  /**
   * 同步 WebRTC 连接状态
   */
  syncPeerConnections(): void {
    if (!this.currentSessionId) {
      return;
    }

    // 遍历所有成员，确保连接状态与偏好一致
    for (const member of this.roomMembers) {
      const memberId = member.session_id || member.participant_id;

      // 跳过自己
      if (memberId === this.currentSessionId) {
        continue;
      }

      const shouldReceive = this.shouldReceiveRawVoice(memberId);
      const hasConnection = this.peerConnections.has(memberId);

      if (shouldReceive && !hasConnection) {
        // 应该接收但没有连接：建立连接
        this.ensurePeerConnection(memberId);
      } else if (!shouldReceive && hasConnection) {
        // 不应该接收但有连接：断开连接
        this.closePeerConnection(memberId);
      }
    }

    // 清理已离开的成员的连接
    const activeMemberIds = new Set(
      this.roomMembers.map(m => m.session_id || m.participant_id)
    );
    for (const [memberId] of this.peerConnections.entries()) {
      if (!activeMemberIds.has(memberId)) {
        this.closePeerConnection(memberId);
      }
    }
  }

  /**
   * 获取连接数量（用于测试）
   */
  getConnectionCount(): number {
    return this.peerConnections.size;
  }

  /**
   * 检查是否有连接（用于测试）
   */
  hasConnection(memberId: string): boolean {
    return this.peerConnections.has(memberId);
  }
}

// 模拟 RTCPeerConnection
class MockPeerConnection {
  private memberId: string;
  private closed: boolean = false;

  constructor(memberId: string) {
    this.memberId = memberId;
  }

  close(): void {
    this.closed = true;
  }

  isClosed(): boolean {
    return this.closed;
  }
}

describe('原声传递偏好实时切换功能', () => {
  let manager: RawVoicePreferenceManager;
  let connectionEvents: Array<{ type: 'connect' | 'disconnect'; memberId: string }>;

  beforeEach(() => {
    connectionEvents = [];
    manager = new RawVoicePreferenceManager('session-a');
    manager.setConnectionCallbacks({
      onConnect: (memberId) => {
        connectionEvents.push({ type: 'connect', memberId });
      },
      onDisconnect: (memberId) => {
        connectionEvents.push({ type: 'disconnect', memberId });
      },
    });
  });

  describe('偏好检查逻辑', () => {
    it('应该默认接收所有成员的原声（偏好未设置）', () => {
      const members: RoomMember[] = [
        {
          participant_id: 'session-b',
          session_id: 'session-b',
          display_name: 'User B',
        },
      ];
      manager.setRoomMembers(members);

      expect(manager.shouldReceiveRawVoice('session-b')).toBe(true);
    });

    it('应该接收明确设置为 true 的成员的原声', () => {
      const members: RoomMember[] = [
        {
          participant_id: 'session-b',
          session_id: 'session-b',
          display_name: 'User B',
          raw_voice_preferences: {
            'session-a': true,
          },
        },
      ];
      manager.setRoomMembers(members);

      expect(manager.shouldReceiveRawVoice('session-b')).toBe(true);
    });

    it('不应该接收明确设置为 false 的成员的原声', () => {
      const members: RoomMember[] = [
        {
          participant_id: 'session-b',
          session_id: 'session-b',
          display_name: 'User B',
          raw_voice_preferences: {
            'session-a': false,
          },
        },
      ];
      manager.setRoomMembers(members);

      expect(manager.shouldReceiveRawVoice('session-b')).toBe(false);
    });

    it('应该忽略不存在的成员', () => {
      const members: RoomMember[] = [];
      manager.setRoomMembers(members);

      expect(manager.shouldReceiveRawVoice('session-nonexistent')).toBe(false);
    });
  });

  describe('实时切换功能', () => {
    it('切换到"接收"时应该立即建立连接', () => {
      const members: RoomMember[] = [
        {
          participant_id: 'session-b',
          session_id: 'session-b',
          display_name: 'User B',
          raw_voice_preferences: {
            'session-a': false, // 初始状态：不接收
          },
        },
      ];
      manager.setRoomMembers(members);

      // 切换到接收
      manager.setRawVoicePreference('session-b', true);

      expect(manager.hasConnection('session-b')).toBe(true);
      expect(connectionEvents).toEqual([
        { type: 'connect', memberId: 'session-b' },
      ]);
    });

    it('切换到"不接收"时应该立即断开连接', () => {
      const members: RoomMember[] = [
        {
          participant_id: 'session-b',
          session_id: 'session-b',
          display_name: 'User B',
          raw_voice_preferences: {
            'session-a': true, // 初始状态：接收
          },
        },
      ];
      manager.setRoomMembers(members);

      // 先建立连接
      manager.setRawVoicePreference('session-b', true);
      connectionEvents.length = 0; // 清空事件

      // 切换到不接收
      manager.setRawVoicePreference('session-b', false);

      expect(manager.hasConnection('session-b')).toBe(false);
      expect(connectionEvents).toEqual([
        { type: 'disconnect', memberId: 'session-b' },
      ]);
    });

    it('重复设置相同偏好不应该重复建立连接', () => {
      const members: RoomMember[] = [
        {
          participant_id: 'session-b',
          session_id: 'session-b',
          display_name: 'User B',
        },
      ];
      manager.setRoomMembers(members);

      // 第一次设置
      manager.setRawVoicePreference('session-b', true);
      connectionEvents.length = 0;

      // 第二次设置相同偏好
      manager.setRawVoicePreference('session-b', true);

      expect(manager.hasConnection('session-b')).toBe(true);
      expect(connectionEvents).toEqual([]); // 不应该有新的连接事件
    });
  });

  describe('连接同步功能', () => {
    it('成员列表更新时应该自动同步连接状态', () => {
      // 初始成员列表（都接收）
      const members1: RoomMember[] = [
        {
          participant_id: 'session-b',
          session_id: 'session-b',
          display_name: 'User B',
        },
        {
          participant_id: 'session-c',
          session_id: 'session-c',
          display_name: 'User C',
        },
      ];
      manager.setRoomMembers(members1);
      manager.syncPeerConnections();

      expect(manager.getConnectionCount()).toBe(2);
      expect(manager.hasConnection('session-b')).toBe(true);
      expect(manager.hasConnection('session-c')).toBe(true);

      // 更新成员列表（B 被屏蔽）
      const members2: RoomMember[] = [
        {
          participant_id: 'session-b',
          session_id: 'session-b',
          display_name: 'User B',
          raw_voice_preferences: {
            'session-a': false, // 被屏蔽
          },
        },
        {
          participant_id: 'session-c',
          session_id: 'session-c',
          display_name: 'User C',
        },
      ];
      manager.setRoomMembers(members2);
      connectionEvents.length = 0;
      manager.syncPeerConnections();

      expect(manager.getConnectionCount()).toBe(1);
      expect(manager.hasConnection('session-b')).toBe(false);
      expect(manager.hasConnection('session-c')).toBe(true);
      expect(connectionEvents).toEqual([
        { type: 'disconnect', memberId: 'session-b' },
      ]);
    });

    it('应该自动清理已离开成员的连接', () => {
      const members1: RoomMember[] = [
        {
          participant_id: 'session-b',
          session_id: 'session-b',
          display_name: 'User B',
        },
        {
          participant_id: 'session-c',
          session_id: 'session-c',
          display_name: 'User C',
        },
      ];
      manager.setRoomMembers(members1);
      manager.syncPeerConnections();

      expect(manager.getConnectionCount()).toBe(2);

      // 成员 C 离开
      const members2: RoomMember[] = [
        {
          participant_id: 'session-b',
          session_id: 'session-b',
          display_name: 'User B',
        },
      ];
      manager.setRoomMembers(members2);
      connectionEvents.length = 0;
      manager.syncPeerConnections();

      expect(manager.getConnectionCount()).toBe(1);
      expect(manager.hasConnection('session-b')).toBe(true);
      expect(manager.hasConnection('session-c')).toBe(false);
      expect(connectionEvents).toEqual([
        { type: 'disconnect', memberId: 'session-c' },
      ]);
    });

    it('应该跳过自己的连接', () => {
      const members: RoomMember[] = [
        {
          participant_id: 'session-a', // 自己
          session_id: 'session-a',
          display_name: 'User A',
        },
        {
          participant_id: 'session-b',
          session_id: 'session-b',
          display_name: 'User B',
        },
      ];
      manager.setRoomMembers(members);
      manager.syncPeerConnections();

      expect(manager.getConnectionCount()).toBe(1);
      expect(manager.hasConnection('session-a')).toBe(false);
      expect(manager.hasConnection('session-b')).toBe(true);
    });
  });

  describe('多成员场景', () => {
    it('应该正确处理多个成员的偏好设置', () => {
      const members: RoomMember[] = [
        {
          participant_id: 'session-b',
          session_id: 'session-b',
          display_name: 'User B',
          raw_voice_preferences: {
            'session-a': true,
          },
        },
        {
          participant_id: 'session-c',
          session_id: 'session-c',
          display_name: 'User C',
          raw_voice_preferences: {
            'session-a': false,
          },
        },
        {
          participant_id: 'session-d',
          session_id: 'session-d',
          display_name: 'User D',
          // 未设置偏好，默认接收
        },
      ];
      manager.setRoomMembers(members);
      manager.syncPeerConnections();

      expect(manager.getConnectionCount()).toBe(2);
      expect(manager.hasConnection('session-b')).toBe(true);
      expect(manager.hasConnection('session-c')).toBe(false);
      expect(manager.hasConnection('session-d')).toBe(true);
    });

    it('应该支持动态添加新成员', () => {
      const members1: RoomMember[] = [
        {
          participant_id: 'session-b',
          session_id: 'session-b',
          display_name: 'User B',
        },
      ];
      manager.setRoomMembers(members1);
      manager.syncPeerConnections();

      expect(manager.getConnectionCount()).toBe(1);

      // 添加新成员
      const members2: RoomMember[] = [
        ...members1,
        {
          participant_id: 'session-c',
          session_id: 'session-c',
          display_name: 'User C',
        },
      ];
      manager.setRoomMembers(members2);
      connectionEvents.length = 0;
      manager.syncPeerConnections();

      expect(manager.getConnectionCount()).toBe(2);
      expect(connectionEvents).toEqual([
        { type: 'connect', memberId: 'session-c' },
      ]);
    });
  });
});

