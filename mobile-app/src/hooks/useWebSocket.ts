import { useState, useRef, useCallback } from 'react';

export function useWebSocket() {
  const [connected, setConnected] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const connect = useCallback(async (pairingCode?: string) => {
    const schedulerUrl = process.env.SCHEDULER_URL || 'ws://localhost:8080/ws/session';
    const ws = new WebSocket(schedulerUrl);

    ws.onopen = () => {
      console.log('WebSocket 连接已建立');
      setConnected(true);

      // 发送会话初始化消息
      ws.send(JSON.stringify({
        type: 'init_session',
        src_lang: 'zh',
        tgt_lang: 'en',
        pairing_code: pairingCode,
      }));
    };

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      
      switch (message.type) {
        case 'session_created':
          setSessionId(message.session_id);
          break;
        case 'translation_result':
          // TODO: 处理翻译结果
          console.log('收到翻译结果:', message);
          break;
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
    manualCut: boolean
  ) => {
    if (!wsRef.current || !sessionId) {
      console.error('WebSocket 未连接或会话未创建');
      return;
    }

    // 将音频转换为 base64
    const base64Audio = arrayBufferToBase64(audioData);

    wsRef.current.send(JSON.stringify({
      type: 'utterance',
      session_id: sessionId,
      utterance_index: utteranceIndex,
      manual_cut: manualCut,
      src_lang: 'zh',
      tgt_lang: 'en',
      audio: base64Audio,
    }));
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

