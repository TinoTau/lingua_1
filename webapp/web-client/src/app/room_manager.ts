/**
 * 房间管理模块
 * 负责管理房间的创建、加入、离开等操作
 */

import { RoomMember } from '../types';
import { WebSocketClient } from '../websocket_client';
import { AudioMixer } from '../audio_mixer';

/**
 * 房间管理器
 */
export class RoomManager {
  private wsClient: WebSocketClient;
  private audioMixer: AudioMixer;

  // 房间状态
  private currentRoomCode: string | null = null;
  private roomMembers: RoomMember[] = [];
  private displayName: string = 'User';
  private isInRoom: boolean = false;

  constructor(wsClient: WebSocketClient, audioMixer: AudioMixer) {
    this.wsClient = wsClient;
    this.audioMixer = audioMixer;
  }

  /**
   * 创建房间
   */
  createRoom(displayName?: string, preferredLang?: string): void {
    if (!this.wsClient.isConnected()) {
      console.error('WebSocket not connected, cannot create room');
      return;
    }

    this.wsClient.createRoom(displayName, preferredLang);
  }

  /**
   * 加入房间
   */
  joinRoom(roomCode: string, displayName?: string, preferredLang?: string): void {
    if (!this.wsClient.isConnected()) {
      console.error('WebSocket not connected, cannot join room');
      return;
    }

    // 验证房间码格式（6位数字）
    if (!/^\d{6}$/.test(roomCode)) {
      console.error('Invalid room code format, must be 6 digits');
      return;
    }

    this.displayName = displayName || 'User';
    this.wsClient.joinRoom(roomCode, displayName, preferredLang);
  }

  /**
   * 退出房间
   */
  leaveRoom(): void {
    if (!this.isInRoom || !this.currentRoomCode) {
      return;
    }

    // 移除所有远程流
    for (const member of this.roomMembers) {
      const memberId = member.session_id || member.participant_id;
      if (memberId !== this.wsClient.getSessionId()) {
        this.audioMixer.removeRemoteStream(memberId);
      }
    }

    this.wsClient.leaveRoom(this.currentRoomCode);

    // 清理房间状态
    this.currentRoomCode = null;
    this.roomMembers = [];
    this.isInRoom = false;
  }

  /**
   * 设置房间码
   */
  setRoomCode(roomCode: string): void {
    this.currentRoomCode = roomCode;
    this.isInRoom = true;
  }

  /**
   * 更新成员列表
   */
  updateMembers(members: RoomMember[]): void {
    this.roomMembers = members;
    this.isInRoom = true;
  }

  /**
   * 获取当前房间码
   */
  getCurrentRoomCode(): string | null {
    return this.currentRoomCode;
  }

  /**
   * 获取房间成员列表
   */
  getRoomMembers(): RoomMember[] {
    return this.roomMembers;
  }

  /**
   * 检查是否在房间中
   */
  getIsInRoom(): boolean {
    return this.isInRoom;
  }

  /**
   * 获取显示名称
   */
  getDisplayName(): string {
    return this.displayName;
  }
}

