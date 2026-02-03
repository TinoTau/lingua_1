/**
 * WebSocket 连接阶段回调：构建 session_init、onMessage、onClose
 * 从 websocket_client 拆出，不改变接口与行为
 */

import type { SessionInitMessage, BackpressureMessage, FeatureFlags } from '../types';
import type { ConnectionManager } from './connection_manager';
import type { MessageHandler } from './message_handler';
import type { BackpressureManager } from './backpressure_manager';
import type { AudioSender } from './audio_sender';
import { logger } from '../logger';

export type PendingConnectParams = {
  srcLang?: string;
  tgtLang?: string;
  langA?: string;
  langB?: string;
  features?: FeatureFlags;
  mode: 'one_way' | 'two_way';
};

export function buildSessionInitMessage(
  params: PendingConnectParams,
  getClientVersion: () => string,
  getTenantId: () => string | null,
  traceId: string
): SessionInitMessage {
  if (params.mode === 'one_way') {
    return {
      type: 'session_init',
      client_version: getClientVersion(),
      platform: 'web',
      src_lang: params.srcLang!,
      tgt_lang: params.tgtLang!,
      dialect: null,
      features: params.features || {},
      pairing_code: null,
      mode: 'one_way',
      trace_id: traceId,
      tenant_id: getTenantId(),
    };
  }
  return {
    type: 'session_init',
    client_version: getClientVersion(),
    platform: 'web',
    src_lang: 'auto',
    tgt_lang: params.langB!,
    dialect: null,
    features: params.features || {},
    pairing_code: null,
    mode: 'two_way_auto',
    lang_a: params.langA!,
    lang_b: params.langB!,
    auto_langs: [params.langA!, params.langB!],
    trace_id: traceId,
    tenant_id: getTenantId(),
  };
}

export function createOnOpenCallback(
  params: PendingConnectParams,
  getClientVersion: () => string,
  getTenantId: () => string | null,
  traceId: string
): (ws: WebSocket) => void {
  const initMessage = buildSessionInitMessage(params, getClientVersion, getTenantId, traceId);
  return (ws: WebSocket) => {
    ws.send(JSON.stringify(initMessage));
  };
}

export function createOnMessageCallback(
  connectionManager: ConnectionManager,
  messageHandler: MessageHandler,
  backpressureManager: BackpressureManager,
  messageCallback: ((message: BackpressureMessage) => void) | null,
  audioSender: AudioSender
): (event: MessageEvent) => void {
  return (event: MessageEvent) => {
    connectionManager.resetHeartbeatTimeout();

    const dataLength = event.data instanceof Blob ? event.data.size : (typeof event.data === 'string' ? event.data.length : 'unknown');
    const dataPreview = typeof event.data === 'string' ? (event.data.length > 200 ? event.data.substring(0, 200) + '...' : event.data) : 'binary';
    let messageType = 'unknown';
    if (typeof event.data === 'string') {
      try {
        const parsed = JSON.parse(event.data);
        messageType = parsed.type || 'unknown';
      } catch {
        // ignore
      }
    }

    if (messageType === 'translation_result' || messageType === 'session_init_ack') {
      logger.info('WebSocketClient', '收到 WebSocket 消息', {
        message_type: messageType,
        data_type: typeof event.data,
        data_length: dataLength,
      });
    } else {
      logger.debug('WebSocketClient', '收到 WebSocket 消息', {
        message_type: messageType,
        data_type: typeof event.data,
        data_length: dataLength,
      });
    }

    void messageHandler.handleMessage(
      event,
      (message: BackpressureMessage) => {
        logger.debug('WebSocketClient', '处理背压消息');
        backpressureManager.handleBackpressure(message);
        if (messageCallback) {
          messageCallback(message);
        }
      },
      (sessionId: string) => {
        logger.info('WebSocketClient', `会话已创建: ${sessionId}`);
        connectionManager.setSessionId(sessionId);
        audioSender.setSessionId(sessionId);
        connectionManager.startHeartbeat();
        setTimeout(() => {
          audioSender.setProtocolConfig(
            messageHandler.getProtocolVersion() === '2.0',
            messageHandler.getNegotiatedCodec()
          );
          audioSender.setAudioEncoder(messageHandler.getAudioEncoder());
        }, 0);
      }
    ).catch((err) => {
      logger.error('WebSocketClient', 'handleMessage 异常', { error: err });
    });
  };
}

export function createOnCloseCallback(
  messageHandler: MessageHandler,
  audioSender: AudioSender,
  backpressureManager: BackpressureManager
): () => void {
  return () => {
    messageHandler.reset();
    audioSender.setSessionId(null);
    backpressureManager.clearSendQueue();
  };
}
