import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  TextInput,
  Alert,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useSession } from './src/hooks/useSession';
import { useAudioPipeline } from './src/hooks/useAudioPipeline';
import { SessionConfig } from './src/models/SessionConfig';
import { TranslationSegment } from './src/models/TranslationSegment';

export default function App() {
  const [pairingCode, setPairingCode] = useState<string>('');
  const [sessionConfig, setSessionConfig] = useState<SessionConfig>({
    srcLang: 'zh',
    tgtLang: 'en',
    enableEmotion: false,
    enableVoiceStyle: false,
    enableSpeechRate: false,
  });

  const {
    connect,
    disconnect,
    sendAudioChunk,
    sessionState,
    segments,
    currentLanguage,
    isConnected,
    isConnecting,
    isReconnecting,
    realtimeClient,
  } = useSession({
    schedulerUrl: 'ws://localhost:5010/ws/session',
    platform: 'ios',
    clientVersion: '1.0.0',
  });

  const { start: startAudio, stop: stopAudio, flush, isRunning: isAudioRunning } = useAudioPipeline({
    enabled: isConnected,
    realtimeClient: realtimeClient || null,
  });

  const handleConnect = async () => {
    try {
      await connect(sessionConfig, pairingCode || undefined);
    } catch (error) {
      Alert.alert('连接失败', error instanceof Error ? error.message : '未知错误');
    }
  };

  const handleDisconnect = () => {
    stopAudio();
    disconnect();
  };

  const handleStartRecording = async () => {
    if (!isConnected) {
      Alert.alert('提示', '请先连接服务器');
      return;
    }

    try {
      await startAudio();
    } catch (error) {
      Alert.alert('启动录音失败', error instanceof Error ? error.message : '未知错误');
    }
  };

  const handleStopRecording = async () => {
    try {
      await stopAudio();
    } catch (error) {
      console.error('停止录音失败:', error);
    }
  };

  const handleManualCut = () => {
    flush();
  };

  const getStatusText = () => {
    if (isConnecting) return '连接中...';
    if (isReconnecting) return '重连中...';
    if (isConnected) return '已连接';
    return '未连接';
  };

  const getStatusColor = () => {
    if (isConnected) return '#4CAF50';
    if (isConnecting || isReconnecting) return '#FF9800';
    return '#757575';
  };

  return (
    <View style={styles.container}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        <Text style={styles.title}>Lingua 语音翻译</Text>

        {/* 连接状态 */}
        <View style={styles.statusSection}>
          <View style={[styles.statusIndicator, { backgroundColor: getStatusColor() }]}>
            <Text style={styles.statusText}>{getStatusText()}</Text>
          </View>
          {currentLanguage && (
            <Text style={styles.languageText}>
              检测语言: {currentLanguage.lang} ({Math.round(currentLanguage.confidence * 100)}%)
            </Text>
          )}
        </View>

        {/* 连接配置 */}
        <View style={styles.connectionSection}>
          <TextInput
            style={styles.input}
            placeholder="输入6位配对码（可选）"
            value={pairingCode}
            onChangeText={setPairingCode}
            maxLength={6}
            editable={!isConnected}
          />
          <View style={styles.langRow}>
            <TextInput
              style={[styles.input, styles.langInput]}
              placeholder="源语言 (zh/en/ja/ko)"
              value={sessionConfig.srcLang}
              onChangeText={(text) => setSessionConfig({ ...sessionConfig, srcLang: text })}
              editable={!isConnected}
            />
            <Text style={styles.arrow}>→</Text>
            <TextInput
              style={[styles.input, styles.langInput]}
              placeholder="目标语言"
              value={sessionConfig.tgtLang}
              onChangeText={(text) => setSessionConfig({ ...sessionConfig, tgtLang: text })}
              editable={!isConnected}
            />
          </View>
          {!isConnected ? (
            <TouchableOpacity
              style={[styles.button, styles.connectButton]}
              onPress={handleConnect}
              disabled={isConnecting}
            >
              {isConnecting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>连接</Text>
              )}
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.button, styles.disconnectButton]}
              onPress={handleDisconnect}
            >
              <Text style={styles.buttonText}>断开</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* 录音控制 */}
        {isConnected && (
          <View style={styles.recordingSection}>
            <TouchableOpacity
              style={[styles.recordButton, isAudioRunning && styles.recordButtonActive]}
              onPressIn={handleStartRecording}
              onPressOut={handleStopRecording}
              disabled={!isConnected}
            >
              <Text style={styles.recordButtonText}>
                {isAudioRunning ? '录音中...' : '按住说话'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.cutButton}
              onPress={handleManualCut}
              disabled={!isAudioRunning}
            >
              <Text style={styles.cutButtonText}>结束本句</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* 翻译结果 */}
        {segments.length > 0 && (
          <View style={styles.translationSection}>
            <Text style={styles.sectionTitle}>翻译结果</Text>
            {segments.map((segment) => (
              <View key={segment.id} style={styles.segmentItem}>
                <Text style={styles.segmentSrc}>{segment.textSrc}</Text>
                <Text style={styles.segmentTgt}>{segment.textTgt}</Text>
              </View>
            ))}
          </View>
        )}

        {/* 错误信息 */}
        {sessionState.errorMessage && (
          <View style={styles.errorSection}>
            <Text style={styles.errorText}>错误: {sessionState.errorMessage}</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingTop: 60,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center',
  },
  statusSection: {
    marginBottom: 20,
    alignItems: 'center',
  },
  statusIndicator: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 16,
    marginBottom: 8,
  },
  statusText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  languageText: {
    fontSize: 12,
    color: '#666',
  },
  connectionSection: {
    marginBottom: 30,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 12,
    marginBottom: 10,
    fontSize: 16,
  },
  langRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  langInput: {
    flex: 1,
    marginBottom: 0,
  },
  arrow: {
    marginHorizontal: 10,
    fontSize: 18,
    color: '#666',
  },
  button: {
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 10,
  },
  connectButton: {
    backgroundColor: '#2196F3',
  },
  disconnectButton: {
    backgroundColor: '#f44336',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  recordingSection: {
    alignItems: 'center',
    marginBottom: 30,
  },
  recordButton: {
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: '#f0f0f0',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  recordButtonActive: {
    backgroundColor: '#f44336',
  },
  recordButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
  },
  cutButton: {
    padding: 15,
    borderRadius: 8,
    backgroundColor: '#FF9800',
  },
  cutButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  translationSection: {
    marginTop: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  segmentItem: {
    padding: 15,
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    marginBottom: 10,
  },
  segmentSrc: {
    fontSize: 16,
    color: '#333',
    marginBottom: 5,
  },
  segmentTgt: {
    fontSize: 16,
    color: '#2196F3',
    fontWeight: 'bold',
  },
  errorSection: {
    padding: 15,
    backgroundColor: '#ffebee',
    borderRadius: 8,
    marginTop: 20,
  },
  errorText: {
    color: '#c62828',
    fontSize: 14,
  },
});
