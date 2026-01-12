/**
 * 会话管理 Hook
 * 整合 RealtimeClient、音频管线、TTS 播放
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { RealtimeClient, RealtimeClientDelegate } from '../services/RealtimeClient';
import { AudioPlayerService } from '../services/AudioPlayerService';
import { SessionConfig, SessionStatus, SessionState } from '../models/SessionConfig';
import { TranslationSegment } from '../models/TranslationSegment';
import { AudioChunk } from '../models/AudioChunk';

export interface UseSessionConfig {
  schedulerUrl?: string;
  platform?: 'android' | 'ios' | 'web';
  clientVersion?: string;
}

export function useSession(config: UseSessionConfig = {}) {
  const [sessionState, setSessionState] = useState<SessionState>({
    status: SessionStatus.Idle,
  });
  const [segments, setSegments] = useState<TranslationSegment[]>([]);
  const [currentLanguage, setCurrentLanguage] = useState<{ lang: string; confidence: number } | null>(null);

  const clientRef = useRef<RealtimeClient | null>(null);
  const playerRef = useRef<AudioPlayerService | null>(null);

  // 初始化服务
  useEffect(() => {
    const client = new RealtimeClient({
      schedulerUrl: config.schedulerUrl,
      platform: config.platform || 'ios',
      clientVersion: config.clientVersion || '1.0.0',
    });

    const player = new AudioPlayerService({
      sampleRate: 16000,
      channels: 1,
      bitDepth: 16,
    });

    // 设置委托
    const delegate: RealtimeClientDelegate = {
      onSessionCreated: (sessionId: string) => {
        setSessionState({
          status: SessionStatus.Active,
          sessionId,
        });
      },
      onTranslationResult: (segment: TranslationSegment) => {
        setSegments((prev) => [...prev, segment]);

        // 自动播放 TTS 音频
        if (segment.ttsAudio) {
          player.playPcm16(segment.ttsAudio).catch((error) => {
            console.error('播放 TTS 失败:', error);
          });
        }
      },
      onLanguageDetected: (lang: string, confidence: number) => {
        setCurrentLanguage({ lang, confidence });
      },
      onError: (error: string) => {
        setSessionState((prev) => ({
          ...prev,
          status: SessionStatus.Error,
          errorMessage: error,
        }));
      },
      onConnectionStatusChanged: (connected: boolean) => {
        if (!connected && sessionState.status === SessionStatus.Active) {
          setSessionState((prev) => ({
            ...prev,
            status: SessionStatus.Reconnecting,
          }));
        }
      },
    };

    client.setDelegate(delegate);

    clientRef.current = client;
    playerRef.current = player;

    return () => {
      client.disconnect();
      player.stop();
    };
  }, [config.schedulerUrl, config.platform, config.clientVersion, sessionState.status]);

  // 连接会话
  const connect = useCallback(async (sessionConfig: SessionConfig, pairingCode?: string) => {
    const client = clientRef.current;
    if (!client) {
      throw new Error('RealtimeClient 未初始化');
    }

    setSessionState({
      status: SessionStatus.Connecting,
    });

    try {
      await client.connect(sessionConfig, pairingCode);
    } catch (error) {
      setSessionState({
        status: SessionStatus.Error,
        errorMessage: error instanceof Error ? error.message : '连接失败',
      });
      throw error;
    }
  }, []);

  // 断开会话
  const disconnect = useCallback(() => {
    const client = clientRef.current;
    if (client) {
      client.disconnect();
    }

    setSessionState({
      status: SessionStatus.Ended,
    });
    setSegments([]);
    setCurrentLanguage(null);
  }, []);

  // 发送音频块
  const sendAudioChunk = useCallback((chunk: AudioChunk, manualCut: boolean = false) => {
    const client = clientRef.current;
    if (client && client.getIsConnected()) {
      client.sendAudioChunk(chunk, manualCut);
    }
  }, []);

  // 获取连接状态
  const isConnected = sessionState.status === SessionStatus.Active;
  const isConnecting = sessionState.status === SessionStatus.Connecting;
  const isReconnecting = sessionState.status === SessionStatus.Reconnecting;

  return {
    connect,
    disconnect,
    sendAudioChunk,
    sessionState,
    segments,
    currentLanguage,
    isConnected,
    isConnecting,
    isReconnecting,
    realtimeClient: clientRef.current,
  };
}

