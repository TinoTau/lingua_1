/**
 * WebRTC 管理模块
 * 负责管理 WebRTC 连接的建立和维护
 */

import { RoomMember } from '../types';
import { WebSocketClient } from '../websocket_client';
import { AudioMixer } from '../audio_mixer';

/**
 * WebRTC 管理器
 */
export class WebRTCManager {
  private wsClient: WebSocketClient;
  private audioMixer: AudioMixer;
  private peerConnections: Map<string, RTCPeerConnection> = new Map();
  private localStream: MediaStream | null = null;
  private currentRoomCode: string | null = null;
  private roomMembers: RoomMember[] = [];

  constructor(wsClient: WebSocketClient, audioMixer: AudioMixer) {
    this.wsClient = wsClient;
    this.audioMixer = audioMixer;
  }

  /**
   * 设置房间信息
   */
  setRoomInfo(roomCode: string | null, members: RoomMember[]): void {
    this.currentRoomCode = roomCode;
    this.roomMembers = members;
  }

  /**
   * 确保与目标成员的 WebRTC 连接存在
   */
  async ensurePeerConnection(roomCode: string, targetSessionId: string): Promise<void> {
    // 如果连接已存在，直接返回
    if (this.peerConnections.has(targetSessionId)) {
      return;
    }

    try {
      // 获取本地音频流（如果还没有）
      if (!this.localStream) {
        this.localStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
      }

      // 创建 RTCPeerConnection
      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
        ],
      });

      // 添加本地音频轨道
      this.localStream.getAudioTracks().forEach(track => {
        pc.addTrack(track, this.localStream!);
      });

      // 处理远程音频流
      pc.ontrack = async (event) => {
        const remoteStream = event.streams[0];
        console.log('[WebRTCManager] 收到远程音频流:', targetSessionId, remoteStream);

        // 将远程流添加到音频混控器
        try {
          await this.audioMixer.addRemoteStream(targetSessionId, remoteStream);
        } catch (error) {
          console.error('[WebRTCManager] 添加远程音频流到混控器失败:', error);
        }
      };

      // 处理 ICE candidate
      pc.onicecandidate = (event) => {
        if (event.candidate && this.currentRoomCode) {
          this.wsClient.sendWebRTCIce(this.currentRoomCode, targetSessionId, event.candidate);
        }
      };

      // 存储连接
      this.peerConnections.set(targetSessionId, pc);

      // 创建 offer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // 发送 offer
      if (this.currentRoomCode) {
        this.wsClient.sendWebRTCOffer(this.currentRoomCode, targetSessionId, offer);
      }

      console.log('[WebRTCManager] WebRTC 连接已建立:', targetSessionId);
    } catch (error) {
      console.error('[WebRTCManager] 建立 WebRTC 连接失败:', error);
    }
  }

  /**
   * 关闭与目标成员的 WebRTC 连接
   */
  closePeerConnection(targetSessionId: string): void {
    const pc = this.peerConnections.get(targetSessionId);
    if (pc) {
      pc.close();
      this.peerConnections.delete(targetSessionId);

      // 从音频混控器中移除远程流
      this.audioMixer.removeRemoteStream(targetSessionId);

      console.log('[WebRTCManager] WebRTC 连接已关闭:', targetSessionId);
    }
  }

  /**
   * 处理 WebRTC offer
   */
  async handleWebRTCOffer(_roomCode: string, fromSessionId: string, sdp: RTCSessionDescriptionInit): Promise<void> {
    try {
      // 检查是否应该接收该成员的原声
      const shouldReceive = this.shouldReceiveRawVoice(fromSessionId);
      if (!shouldReceive) {
        console.log('[WebRTCManager] 忽略 WebRTC offer: 已屏蔽该成员的原声', fromSessionId);
        return;
      }

      // 获取或创建连接
      let pc = this.peerConnections.get(fromSessionId);
      if (!pc) {
        // 获取本地音频流（如果还没有）
        if (!this.localStream) {
          this.localStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
          });
        }

        // 创建 RTCPeerConnection
        pc = new RTCPeerConnection({
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
          ],
        });

        // 添加本地音频轨道
        this.localStream.getAudioTracks().forEach(track => {
          pc!.addTrack(track, this.localStream!);
        });

        // 处理远程音频流
        pc.ontrack = async (event) => {
          const remoteStream = event.streams[0];
          console.log('[WebRTCManager] 收到远程音频流:', fromSessionId, remoteStream);

          // 将远程流添加到音频混控器
          try {
            await this.audioMixer.addRemoteStream(fromSessionId, remoteStream);
          } catch (error) {
            console.error('[WebRTCManager] 添加远程音频流到混控器失败:', error);
          }
        };

        // 处理 ICE candidate
        pc.onicecandidate = (event) => {
          if (event.candidate && this.currentRoomCode) {
            this.wsClient.sendWebRTCIce(this.currentRoomCode, fromSessionId, event.candidate);
          }
        };

        this.peerConnections.set(fromSessionId, pc);
      }

      // 设置远程描述
      await pc.setRemoteDescription(sdp);

      // 创建 answer
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      // 发送 answer
      if (this.currentRoomCode) {
        this.wsClient.sendWebRTCAnswer(this.currentRoomCode, fromSessionId, answer);
      }
    } catch (error) {
      console.error('[WebRTCManager] 处理 WebRTC offer 失败:', error);
    }
  }

  /**
   * 处理 WebRTC answer
   */
  async handleWebRTCAnswer(fromSessionId: string, sdp: RTCSessionDescriptionInit): Promise<void> {
    const pc = this.peerConnections.get(fromSessionId);
    if (pc) {
      try {
        await pc.setRemoteDescription(sdp);
        console.log('[WebRTCManager] WebRTC answer 已处理:', fromSessionId);
      } catch (error) {
        console.error('[WebRTCManager] 处理 WebRTC answer 失败:', error);
      }
    }
  }

  /**
   * 处理 WebRTC ICE candidate
   */
  async handleWebRTCIce(fromSessionId: string, candidate: RTCIceCandidateInit): Promise<void> {
    const pc = this.peerConnections.get(fromSessionId);
    if (pc) {
      try {
        await pc.addIceCandidate(candidate);
      } catch (error) {
        console.error('[WebRTCManager] 处理 WebRTC ICE candidate 失败:', error);
      }
    }
  }

  /**
   * 检查是否应该接收某个成员的原声
   */
  private shouldReceiveRawVoice(targetSessionId: string): boolean {
    const currentSessionId = this.wsClient.getSessionId();
    if (!currentSessionId) {
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
    return rawVoicePrefs[currentSessionId] !== false;
  }

  /**
   * 同步 WebRTC 连接
   */
  syncPeerConnections(): void {
    if (!this.currentRoomCode) {
      return;
    }

    const currentSessionId = this.wsClient.getSessionId();
    if (!currentSessionId) {
      return;
    }

    // 遍历所有成员，确保连接状态与偏好一致
    for (const member of this.roomMembers) {
      const memberId = member.session_id || member.participant_id;

      // 跳过自己
      if (memberId === currentSessionId) {
        continue;
      }

      const shouldReceive = this.shouldReceiveRawVoice(memberId);
      const hasConnection = this.peerConnections.has(memberId);

      if (shouldReceive && !hasConnection) {
        // 应该接收但没有连接：建立连接
        this.ensurePeerConnection(this.currentRoomCode, memberId);
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
   * 关闭所有连接
   */
  closeAllConnections(): void {
    for (const [memberId] of this.peerConnections.entries()) {
      this.closePeerConnection(memberId);
    }
  }

  /**
   * 停止本地音频流
   */
  stopLocalStream(): void {
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }
  }
}

