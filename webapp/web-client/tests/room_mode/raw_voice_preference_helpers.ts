/**
 * 原声传递偏好测试用：共享类型与模拟类
 */

export interface RoomMember {
  participant_id: string;
  session_id?: string;
  display_name?: string;
  preferred_lang?: string;
  raw_voice_preferences?: Record<string, boolean>;
  joined_at?: number;
}

export class MockPeerConnection {
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

export class RawVoicePreferenceManager {
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

  setConnectionCallbacks(callbacks: {
    onConnect?: (memberId: string) => void;
    onDisconnect?: (memberId: string) => void;
  }): void {
    this.connectionCallbacks = callbacks;
  }

  setRoomMembers(members: RoomMember[]): void {
    this.roomMembers = members;
  }

  shouldReceiveRawVoice(targetSessionId: string): boolean {
    if (!this.currentSessionId) {
      return false;
    }
    const targetMember = this.roomMembers.find(
      m => (m.session_id || m.participant_id) === targetSessionId
    );
    if (!targetMember) {
      return false;
    }
    const rawVoicePrefs = targetMember.raw_voice_preferences || {};
    return rawVoicePrefs[this.currentSessionId] !== false;
  }

  setRawVoicePreference(targetSessionId: string, receiveRawVoice: boolean): void {
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
    if (receiveRawVoice) {
      this.ensurePeerConnection(targetSessionId);
    } else {
      this.closePeerConnection(targetSessionId);
    }
  }

  private ensurePeerConnection(targetSessionId: string): void {
    if (this.peerConnections.has(targetSessionId)) {
      return;
    }
    const pc = new MockPeerConnection(targetSessionId);
    this.peerConnections.set(targetSessionId, pc);
    if (this.connectionCallbacks.onConnect) {
      this.connectionCallbacks.onConnect(targetSessionId);
    }
  }

  private closePeerConnection(targetSessionId: string): void {
    const pc = this.peerConnections.get(targetSessionId);
    if (pc) {
      pc.close();
      this.peerConnections.delete(targetSessionId);
      if (this.connectionCallbacks.onDisconnect) {
        this.connectionCallbacks.onDisconnect(targetSessionId);
      }
    }
  }

  syncPeerConnections(): void {
    if (!this.currentSessionId) {
      return;
    }
    for (const member of this.roomMembers) {
      const memberId = member.session_id || member.participant_id;
      if (memberId === this.currentSessionId) {
        continue;
      }
      const shouldReceive = this.shouldReceiveRawVoice(memberId);
      const hasConnection = this.peerConnections.has(memberId);
      if (shouldReceive && !hasConnection) {
        this.ensurePeerConnection(memberId);
      } else if (!shouldReceive && hasConnection) {
        this.closePeerConnection(memberId);
      }
    }
    const activeMemberIds = new Set(
      this.roomMembers.map(m => m.session_id || m.participant_id)
    );
    for (const [memberId] of this.peerConnections.entries()) {
      if (!activeMemberIds.has(memberId)) {
        this.closePeerConnection(memberId);
      }
    }
  }

  getConnectionCount(): number {
    return this.peerConnections.size;
  }

  hasConnection(memberId: string): boolean {
    return this.peerConnections.has(memberId);
  }
}
