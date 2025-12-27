/**
 * 房间管理模块单元测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RoomManager } from '../../src/app/room_manager';
import { WebSocketClient } from '../../src/websocket_client';
import { AudioMixer } from '../../src/audio_mixer';
import { StateMachine } from '../../src/state_machine';

describe('RoomManager', () => {
  let manager: RoomManager;
  let wsClient: WebSocketClient;
  let audioMixer: AudioMixer;

  beforeEach(() => {
    const stateMachine = new StateMachine();
    wsClient = new WebSocketClient(stateMachine, 'ws://localhost:8080');
    audioMixer = new AudioMixer();
    manager = new RoomManager(wsClient, audioMixer);
  });

  it('应该能够获取房间状态', () => {
    expect(manager.getIsInRoom()).toBe(false);
    expect(manager.getCurrentRoomCode()).toBeNull();
    expect(manager.getRoomMembers()).toEqual([]);
  });

  it('应该能够设置房间码', () => {
    manager.setRoomCode('123456');
    expect(manager.getCurrentRoomCode()).toBe('123456');
    expect(manager.getIsInRoom()).toBe(true);
  });

  it('应该能够更新成员列表', () => {
    const members = [
      { session_id: 'session1', display_name: 'User1' },
      { session_id: 'session2', display_name: 'User2' }
    ];
    manager.updateMembers(members);
    expect(manager.getRoomMembers()).toEqual(members);
    expect(manager.getIsInRoom()).toBe(true);
  });

  it('应该能够获取显示名称', () => {
    expect(manager.getDisplayName()).toBe('User');
  });
});

