/**
 * 会议室成员加入流程测试
 * 
 * 测试范围：
 * - 创建房间时自动添加创建者为第一个成员
 * - 其他成员通过房间码加入
 * - 成员列表同步和广播
 */

import { describe, it, expect, beforeEach } from 'vitest';

// 模拟 RoomMember 类型
interface RoomMember {
  participant_id: string;
  session_id?: string;
  display_name?: string;
  preferred_lang?: string;
  raw_voice_preferences?: Record<string, boolean>;
  joined_at?: number;
}

// 模拟房间管理器
class MockRoomManager {
  private rooms: Map<string, {
    roomCode: string;
    roomId: string;
    members: RoomMember[];
  }> = new Map();

  /**
   * 创建房间（创建者自动成为第一个成员）
   */
  createRoom(
    creatorSessionId: string,
    creatorDisplayName?: string,
    creatorPreferredLang?: string
  ): { roomCode: string; roomId: string; members: RoomMember[] } {
    // 生成房间码（简化版，实际应该使用随机数）
    const roomCode = Math.floor(100000 + Math.random() * 900000).toString();
    // 生成唯一房间ID（使用时间戳 + 随机数）
    const roomId = `room-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    // 创建者自动成为第一个成员
    const creator: RoomMember = {
      participant_id: creatorSessionId,
      session_id: creatorSessionId,
      display_name: creatorDisplayName,
      preferred_lang: creatorPreferredLang,
      raw_voice_preferences: {},
      joined_at: Date.now(),
    };

    const room = {
      roomCode,
      roomId,
      members: [creator],
    };

    this.rooms.set(roomCode, room);
    return room;
  }

  /**
   * 加入房间
   */
  joinRoom(
    roomCode: string,
    sessionId: string,
    displayName?: string,
    preferredLang?: string
  ): { success: boolean; members?: RoomMember[]; error?: string } {
    const room = this.rooms.get(roomCode);
    if (!room) {
      return { success: false, error: 'ROOM_NOT_FOUND' };
    }

    // 检查是否已经在房间中
    if (room.members.some(m => m.session_id === sessionId)) {
      return { success: false, error: 'ALREADY_IN_ROOM' };
    }

    // 添加成员
    const newMember: RoomMember = {
      participant_id: sessionId,
      session_id: sessionId,
      display_name: displayName,
      preferred_lang: preferredLang,
      raw_voice_preferences: {},
      joined_at: Date.now(),
    };

    room.members.push(newMember);
    return { success: true, members: [...room.members] };
  }

  /**
   * 获取房间成员列表
   */
  getRoomMembers(roomCode: string): RoomMember[] | null {
    const room = this.rooms.get(roomCode);
    return room ? [...room.members] : null;
  }

  /**
   * 获取房间信息
   */
  getRoom(roomCode: string): { roomCode: string; roomId: string; members: RoomMember[] } | null {
    const room = this.rooms.get(roomCode);
    return room ? { ...room } : null;
  }
}

describe('会议室成员加入流程', () => {
  let roomManager: MockRoomManager;

  beforeEach(() => {
    roomManager = new MockRoomManager();
  });

  describe('创建房间（创建者自动加入）', () => {
    it('创建房间时应该自动添加创建者为第一个成员', () => {
      const creatorSessionId = 'session-creator';
      const creatorDisplayName = 'Alice';
      const creatorPreferredLang = 'en';

      const room = roomManager.createRoom(
        creatorSessionId,
        creatorDisplayName,
        creatorPreferredLang
      );

      expect(room.members).toHaveLength(1);
      expect(room.members[0].session_id).toBe(creatorSessionId);
      expect(room.members[0].display_name).toBe(creatorDisplayName);
      expect(room.members[0].preferred_lang).toBe(creatorPreferredLang);
    });

    it('创建房间时应该生成6位数房间码', () => {
      const room = roomManager.createRoom('session-creator');
      
      expect(room.roomCode).toMatch(/^\d{6}$/);
    });

    it('创建房间时应该生成唯一的房间ID', () => {
      const room1 = roomManager.createRoom('session-creator-1');
      const room2 = roomManager.createRoom('session-creator-2');
      
      expect(room1.roomId).not.toBe(room2.roomId);
    });

    it('创建者应该自动拥有默认的原声传递偏好设置', () => {
      const room = roomManager.createRoom('session-creator');
      
      expect(room.members[0].raw_voice_preferences).toBeDefined();
      expect(room.members[0].raw_voice_preferences).toEqual({});
    });

    it('创建房间时可以不提供显示名称和偏好语言', () => {
      const room = roomManager.createRoom('session-creator');
      
      expect(room.members[0].session_id).toBe('session-creator');
      expect(room.members[0].display_name).toBeUndefined();
      expect(room.members[0].preferred_lang).toBeUndefined();
    });
  });

  describe('加入房间（其他成员）', () => {
    let roomCode: string;

    beforeEach(() => {
      // 先创建一个房间
      const room = roomManager.createRoom('session-creator', 'Alice', 'en');
      roomCode = room.roomCode;
    });

    it('其他成员应该能够通过房间码加入房间', () => {
      const result = roomManager.joinRoom(
        roomCode,
        'session-member-1',
        'Bob',
        'zh'
      );

      expect(result.success).toBe(true);
      expect(result.members).toHaveLength(2);
      expect(result.members![1].session_id).toBe('session-member-1');
      expect(result.members![1].display_name).toBe('Bob');
      expect(result.members![1].preferred_lang).toBe('zh');
    });

    it('加入房间时应该返回更新后的成员列表', () => {
      const result = roomManager.joinRoom(
        roomCode,
        'session-member-1',
        'Bob'
      );

      expect(result.success).toBe(true);
      expect(result.members).toHaveLength(2);
      expect(result.members![0].session_id).toBe('session-creator');
      expect(result.members![1].session_id).toBe('session-member-1');
    });

    it('加入不存在的房间应该返回错误', () => {
      const result = roomManager.joinRoom(
        '999999', // 不存在的房间码
        'session-member-1'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('ROOM_NOT_FOUND');
    });

    it('已经加入房间的成员不应该重复加入', () => {
      // 第一次加入
      const result1 = roomManager.joinRoom(
        roomCode,
        'session-member-1',
        'Bob'
      );
      expect(result1.success).toBe(true);

      // 第二次加入（应该失败）
      const result2 = roomManager.joinRoom(
        roomCode,
        'session-member-1',
        'Bob'
      );
      expect(result2.success).toBe(false);
      expect(result2.error).toBe('ALREADY_IN_ROOM');
    });

    it('多个成员应该能够依次加入房间', () => {
      // 第一个成员加入
      const result1 = roomManager.joinRoom(
        roomCode,
        'session-member-1',
        'Bob'
      );
      expect(result1.success).toBe(true);
      expect(result1.members).toHaveLength(2);

      // 第二个成员加入
      const result2 = roomManager.joinRoom(
        roomCode,
        'session-member-2',
        'Charlie'
      );
      expect(result2.success).toBe(true);
      expect(result2.members).toHaveLength(3);
    });

    it('加入房间时可以不提供显示名称和偏好语言', () => {
      const result = roomManager.joinRoom(
        roomCode,
        'session-member-1'
      );

      expect(result.success).toBe(true);
      expect(result.members![1].session_id).toBe('session-member-1');
      expect(result.members![1].display_name).toBeUndefined();
      expect(result.members![1].preferred_lang).toBeUndefined();
    });
  });

  describe('成员列表同步', () => {
    let roomCode: string;

    beforeEach(() => {
      const room = roomManager.createRoom('session-creator', 'Alice', 'en');
      roomCode = room.roomCode;
    });

    it('创建房间后应该能够获取成员列表', () => {
      const members = roomManager.getRoomMembers(roomCode);

      expect(members).not.toBeNull();
      expect(members).toHaveLength(1);
      expect(members![0].session_id).toBe('session-creator');
    });

    it('成员加入后应该能够获取更新后的成员列表', () => {
      roomManager.joinRoom(roomCode, 'session-member-1', 'Bob');
      const members = roomManager.getRoomMembers(roomCode);

      expect(members).toHaveLength(2);
      expect(members![0].session_id).toBe('session-creator');
      expect(members![1].session_id).toBe('session-member-1');
    });

    it('获取不存在的房间应该返回 null', () => {
      const members = roomManager.getRoomMembers('999999');

      expect(members).toBeNull();
    });
  });

  describe('完整流程测试', () => {
    it('应该支持完整的创建和加入流程', () => {
      // 步骤 1: 创建房间
      const room = roomManager.createRoom(
        'session-creator',
        'Alice',
        'en'
      );
      expect(room.members).toHaveLength(1);

      // 步骤 2: 第一个成员加入
      const result1 = roomManager.joinRoom(
        room.roomCode,
        'session-member-1',
        'Bob',
        'zh'
      );
      expect(result1.success).toBe(true);
      expect(result1.members).toHaveLength(2);

      // 步骤 3: 第二个成员加入
      const result2 = roomManager.joinRoom(
        room.roomCode,
        'session-member-2',
        'Charlie',
        'ja'
      );
      expect(result2.success).toBe(true);
      expect(result2.members).toHaveLength(3);

      // 验证最终成员列表
      const finalMembers = roomManager.getRoomMembers(room.roomCode);
      expect(finalMembers).toHaveLength(3);
      expect(finalMembers![0].session_id).toBe('session-creator');
      expect(finalMembers![1].session_id).toBe('session-member-1');
      expect(finalMembers![2].session_id).toBe('session-member-2');
    });

    it('应该支持创建者和其他成员使用不同的语言', () => {
      // 创建者使用英文
      const room = roomManager.createRoom(
        'session-creator',
        'Alice',
        'en'
      );

      // 成员1使用中文
      roomManager.joinRoom(room.roomCode, 'session-member-1', 'Bob', 'zh');

      // 成员2使用日文
      roomManager.joinRoom(room.roomCode, 'session-member-2', 'Charlie', 'ja');

      const members = roomManager.getRoomMembers(room.roomCode);
      expect(members![0].preferred_lang).toBe('en');
      expect(members![1].preferred_lang).toBe('zh');
      expect(members![2].preferred_lang).toBe('ja');
    });
  });
});

