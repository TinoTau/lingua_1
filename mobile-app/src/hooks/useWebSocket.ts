import { useState, useRef, useCallback } from 'react';
import type { SessionInitMessage, SessionInitAckMessage, TranslationResultMessage, ErrorMessage } from '../../../shared/protocols/messages';

export interface WebSocketConfig {
  srcLang?: string;
  tgtLang?: string;
  dialect?: string | null;
  features?: {
    emotion_detection?: boolean;
    voice_style_detection?: boolean;
    speech_rate_detection?: boolean;
    speech_rate_control?: boolean;
    speaker_identification?: boolean;
    persona_adaptation?: boolean;
  };
  platform?: 'android' | 'ios' | 'web';
  clientVersion?: string;
}

export function useWebSocket() {
  const [connected, setConnected] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const configRef = useRef<WebSocketConfig>({});

  const connect = useCallback(async (pairingCode?: string, config?: WebSocketConfig) => {
    const schedulerUrl = process.env.SCHEDULER_URL || 'ws://localhost:8080/ws/session';
    const ws = new WebSocket(schedulerUrl);

    // 保存配置
    if (config) {
      configRef.current = config;
    }

    ws.onopen = () => {
      console.log('WebSocket 连接已建立');
      setConnected(true);

      // 发送会话初始化消息（对齐协议规范）
      const initMessage: SessionInitMessage = {
        type: 'session_init',
        client_version: configRef.current.clientVersion || '1.0.0',
        platform: configRef.current.platform || 'web',
        src_lang: configRef.current.srcLang || 'zh',
        tgt_lang: configRef.current.tgtLang || 'en',
        dialect: configRef.current.dialect || null,
        features: configRef.current.features,
        pairing_code: pairingCode || null,
      };

      ws.send(JSON.stringify(initMessage));
    };

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      
      switch (message.type) {
        case 'session_init_ack': {
          const ack = message as SessionInitAckMessage;
          setSessionId(ack.session_id);
          console.log('会话创建成功:', ack.session_id);
          break;
        }
        case 'translation_result': {
          const result = message as TranslationResultMessage;
          // TODO: 处理翻译结果
          console.log('收到翻译结果:', result);
          break;
        }
        case 'error': {
          const error = message as ErrorMessage;
          console.error('收到错误消息:', error.code, error.message);
          break;
        }
        default:
          console.log('收到消息:', message);
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket 错误:', error);
    };

    ws.onclose = () => {
      console.log('WebSocket 连接已关闭');
      setConnected(false);
      setSessionId(null);
    };

    wsRef.current = ws;
  }, []);

  const sendUtterance = useCallback(async (
    audioData: ArrayBuffer,
    utteranceIndex: number,
    manualCut: boolean,
    audioFormat: string = 'pcm16',
    sampleRate: number = 16000,
    overrideConfig?: {
      srcLang?: string;
      tgtLang?: string;
      dialect?: string | null;
      features?: {
        emotion_detection?: boolean;
        voice_style_detection?: boolean;
        speech_rate_detection?: boolean;
        speech_rate_control?: boolean;
        speaker_identification?: boolean;
        persona_adaptation?: boolean;
      };
    }
  ) => {
    if (!wsRef.current || !sessionId) {
      console.error('WebSocket 未连接或会话未创建');
      return;
    }

    // 将音频转换为 base64
    const base64Audio = arrayBufferToBase64(audioData);

    // 对齐协议规范：utterance 消息格式
    const utteranceMessage = {
      type: 'utterance' as const,
      session_id: sessionId,
      utterance_index: utteranceIndex,
      manual_cut: manualCut,
      src_lang: overrideConfig?.srcLang || configRef.current.srcLang || 'zh',
      tgt_lang: overrideConfig?.tgtLang || configRef.current.tgtLang || 'en',
      dialect: overrideConfig?.dialect !== undefined ? overrideConfig.dialect : (configRef.current.dialect || null),
      features: overrideConfig?.features || configRef.current.features,
      audio: base64Audio,
      audio_format: audioFormat,
      sample_rate: sampleRate,
    };

    wsRef.current.send(JSON.stringify(utteranceMessage));
  }, [sessionId]);

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setConnected(false);
    setSessionId(null);
  }, []);

  return {
    connect,
    sendUtterance,
    disconnect,
    connected,
    sessionId,
  };
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

