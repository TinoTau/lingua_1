import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  TextInput,
  Alert,
} from 'react-native';
import { Audio } from 'expo-av';
import { useVAD } from './src/hooks/useVAD';
import { useWebSocket } from './src/hooks/useWebSocket';

export default function App() {
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [translation, setTranslation] = useState<string>('');
  const [pairingCode, setPairingCode] = useState<string>('');
  const [sessionId, setSessionId] = useState<string | null>(null);

  const { detectSpeech, audioBuffer } = useVAD();
  const { connect, sendUtterance, disconnect, connected } = useWebSocket();

  useEffect(() => {
    // 初始化音频权限
    (async () => {
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('需要麦克风权限');
      }
    })();
  }, []);

  const startRecording = async () => {
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      setRecording(recording);
      setIsRecording(true);
    } catch (err) {
      console.error('启动录音失败', err);
    }
  };

  const stopRecording = async () => {
    if (!recording) return;

    setIsRecording(false);
    await recording.stopAndUnloadAsync();
    const uri = recording.getURI();
    
    // TODO: 处理音频并发送到服务器
    // 1. 读取音频文件
    // 2. 运行 VAD 检测
    // 3. 发送 utterance 到调度服务器

    setRecording(null);
  };

  const handleManualCut = async () => {
    // 手动截断当前句子
    if (recording) {
      await stopRecording();
      // 立即发送当前音频块
    }
  };

  const handleConnect = async () => {
    if (pairingCode) {
      // 使用配对码连接指定节点
      await connect(pairingCode);
    } else {
      // 随机节点模式
      await connect();
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Lingua 语音翻译</Text>

      <View style={styles.connectionSection}>
        <TextInput
          style={styles.input}
          placeholder="输入6位配对码（可选）"
          value={pairingCode}
          onChangeText={setPairingCode}
          maxLength={6}
        />
        <TouchableOpacity
          style={[styles.button, connected ? styles.buttonConnected : styles.buttonDisconnected]}
          onPress={handleConnect}
        >
          <Text style={styles.buttonText}>
            {connected ? '已连接' : '连接'}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.recordingSection}>
        <TouchableOpacity
          style={[styles.recordButton, isRecording && styles.recordButtonActive]}
          onPressIn={startRecording}
          onPressOut={stopRecording}
        >
          <Text style={styles.recordButtonText}>
            {isRecording ? '录音中...' : '按住说话'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.cutButton}
          onPress={handleManualCut}
          disabled={!isRecording}
        >
          <Text style={styles.cutButtonText}>结束本句</Text>
        </TouchableOpacity>
      </View>

      {translation && (
        <View style={styles.translationSection}>
          <Text style={styles.translationLabel}>翻译结果:</Text>
          <Text style={styles.translationText}>{translation}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 30,
  },
  connectionSection: {
    width: '100%',
    marginBottom: 30,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
  },
  button: {
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonConnected: {
    backgroundColor: '#4CAF50',
  },
  buttonDisconnected: {
    backgroundColor: '#2196F3',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  recordingSection: {
    width: '100%',
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
    width: '100%',
    padding: 15,
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
  },
  translationLabel: {
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  translationText: {
    fontSize: 16,
  },
});

