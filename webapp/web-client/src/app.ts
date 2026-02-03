import { StateMachine } from './state_machine';
import { SessionState, RoomMember } from './types';
import { Recorder } from './recorder';
import { WebSocketClient } from './websocket_client';
import { TtsPlayer } from './tts_player';
import { AsrSubtitle } from './asr_subtitle';
import { AudioMixer } from './audio_mixer';
import { Config, DEFAULT_CONFIG, ServerMessage, FeatureFlags, SilenceFilterConfig } from './types';
import { ObservabilityManager, ObservabilityMetrics } from './observability';
import { AudioCodecConfig } from './audio_codec';
import { BackpressureState } from './websocket_client';
import { TranslationDisplayManager } from './app/translation_display';
import { SessionManager } from './app/session_manager';
import { RoomManager } from './app/room_manager';
import { WebRTCManager } from './app/webrtc_manager';
import { logger } from './logger';
import { handleServerMessage, ServerMessageHandlerContext } from './app/message_handler';
import { AppPlayback } from './app/playback';
import { handleStateChange } from './app/state_callbacks';
import { addTtsAudioToMixer } from './app/room_tts';
import { createAndAttachAudioMixerOutput, setupAppCallbacks } from './app/init_callbacks';

/**
 * 涓诲簲鐢ㄧ被
 * 鏁村悎鎵€鏈夋ā鍧?
 */
export class App {
  private stateMachine: StateMachine;
  private recorder: Recorder;
  private wsClient: WebSocketClient;
  private ttsPlayer: TtsPlayer;
  private asrSubtitle: AsrSubtitle;
  private audioMixer: AudioMixer;
  private config: Config;
  // 娉ㄦ剰锛歛udioBuffer 宸茬Щ鑷?SessionManager
  // 褰撳墠 utterance 鐨?trace_id 鍜?group_id锛堢敤浜?TTS_PLAY_ENDED锛?
  private currentTraceId: string | null = null;
  private currentGroupId: string | null = null;
  // 闊抽娣锋帶鍣ㄨ緭鍑烘祦锛堢敤浜庢挱鏀撅級
  private audioMixerOutput: HTMLAudioElement | null = null;
  // 鍙娴嬫€х鐞嗗櫒
  private observability: ObservabilityManager | null = null;
  
  // 鏂版ā鍧?
  private translationDisplay: TranslationDisplayManager;
  private sessionManager: SessionManager;
  private roomManager: RoomManager;
  private webrtcManager: WebRTCManager;
  private appPlayback: AppPlayback;

  // Pipeline 閰嶇疆锛堢敱鐢ㄦ埛閫夋嫨锛?
  public pipelineConfig?: {
    use_asr?: boolean;
    use_nmt?: boolean;
    use_tts?: boolean;
    use_tone?: boolean;
  };

  constructor(config: Partial<Config> = {}) {
    // 浠?localStorage 璇诲彇鑷姩鎾斁閰嶇疆锛堝鏋滃瓨鍦級
    const savedAutoPlay = localStorage.getItem('tts_auto_play');
    const autoPlayConfig = savedAutoPlay !== null ? savedAutoPlay === 'true' : undefined;
    
    this.config = { 
      ...DEFAULT_CONFIG, 
      ...config,
      // 濡傛灉閰嶇疆涓病鏈夋寚瀹?autoPlay锛屼娇鐢?localStorage 涓殑鍊硷紝鍚﹀垯浣跨敤榛樿鍊?
      autoPlay: config.autoPlay !== undefined ? config.autoPlay : (autoPlayConfig !== undefined ? autoPlayConfig : DEFAULT_CONFIG.autoPlay),
    };

    // 鍒濆鍖栧彲瑙傛祴鎬х鐞嗗櫒锛堝鏋滈厤缃簡涓婃姤 URL锛?
    if (this.config.observabilityReportUrl) {
      this.observability = new ObservabilityManager(
        this.config.observabilityReportUrl,
        this.config.observabilityReportIntervalMs || 60000
      );
    }

    // 鍒濆鍖栨ā鍧?
    this.stateMachine = new StateMachine();
    this.recorder = new Recorder(this.stateMachine, this.config);
    this.wsClient = new WebSocketClient(
      this.stateMachine,
      this.config.schedulerUrl,
      this.config.reconnectConfig,
      this.config.clientVersion
    );

    // Phase 2: 璁剧疆闊抽缂栬В鐮佸櫒閰嶇疆
    // 浣跨敤 opus 缂栫爜浠ュ噺灏忎紶杈撴暟鎹噺
    const codecConfig: AudioCodecConfig = this.config.audioCodecConfig || {
      codec: 'opus', // 浣跨敤 Opus 缂栫爜
      sampleRate: 16000,
      channelCount: 1,
      frameSizeMs: 20, // 榛樿 20ms 甯?
      application: 'voip', // VOIP 妯″紡锛岄€傚悎瀹炴椂璇煶閫氫俊
      bitrate: 24000, // 璁剧疆 24 kbps for VOIP锛堟帹鑽愬€硷紝骞宠　璐ㄩ噺鍜屽甫瀹斤級
    };
    this.wsClient.setAudioCodecConfig(codecConfig);
    console.log('Audio codec config set:', codecConfig.codec);

    this.ttsPlayer = new TtsPlayer(this.stateMachine);
    this.asrSubtitle = new AsrSubtitle('app');
    this.audioMixer = new AudioMixer();

    // 鍒濆鍖栨柊妯″潡
    this.translationDisplay = new TranslationDisplayManager();
    this.roomManager = new RoomManager(this.wsClient, this.audioMixer);
    this.webrtcManager = new WebRTCManager(this.wsClient, this.audioMixer);
    this.sessionManager = new SessionManager(
      this.stateMachine,
      this.recorder,
      this.wsClient,
      this.ttsPlayer,
      this.asrSubtitle,
      this.translationDisplay
    );
    this.appPlayback = new AppPlayback({
      sessionManager: this.sessionManager,
      stateMachine: this.stateMachine,
      recorder: this.recorder,
      wsClient: this.wsClient,
      ttsPlayer: this.ttsPlayer,
      translationDisplay: this.translationDisplay,
      getCurrentTraceId: () => this.currentTraceId,
      getCurrentGroupId: () => this.currentGroupId,
      setCurrentTraceId: (v) => {
        this.currentTraceId = v;
      },
      setCurrentGroupId: (v) => {
        this.currentGroupId = v;
      },
      displayPendingTranslationResults: () => this.translationDisplay.displayPendingTranslationResults(),
    });

    // 鍒濆鍖栭煶棰戞贩鎺у櫒杈撳嚭
    this.audioMixerOutput = createAndAttachAudioMixerOutput(this.audioMixer);
    setupAppCallbacks(this.getCallbacksContext());

    // 搴旂敤鏃ュ織閰嶇疆锛堝鏋滈厤缃簡鑷姩淇濆瓨锛?
    // 娉ㄦ剰锛氶渶瑕佸湪logger绯荤粺鍒濆鍖栧悗璁剧疆
    if (this.config.logConfig) {
      // logger鏄崟渚嬶紝宸茬粡鍒濆鍖栵紝鐩存帴浣跨敤
      logger.setLogConfig(this.config.logConfig);
      console.log('[App] 鏃ュ織閰嶇疆宸插簲鐢?', this.config.logConfig);
    }
  }

  /** Callback context for init_callbacks */
  private getCallbacksContext() {
    return {
      stateMachine: this.stateMachine,
      recorder: this.recorder,
      wsClient: this.wsClient,
      sessionManager: this.sessionManager,
      translationDisplay: this.translationDisplay,
      ttsPlayer: this.ttsPlayer,
      appPlayback: this.appPlayback,
      observability: this.observability,
      getMessageHandlerContext: () => this.getMessageHandlerContext(),
      onStateChange: (newState: SessionState, oldState: SessionState) => this.onStateChange(newState, oldState),
    };
  }


  /**
   * 鐘舵€佸彉鍖栧鐞?
   */
  private onStateChange(newState: SessionState, oldState: SessionState): void {
    handleStateChange(
      {
        sessionManager: this.sessionManager,
        stateMachine: this.stateMachine,
        recorder: this.recorder,
      },
      newState,
      oldState
    );
  }


  /**
   * 闊抽甯у鐞?
   * 娉ㄦ剰锛氶潤闊宠繃婊ゅ湪 Recorder 涓鐞嗭紝杩欓噷鍙帴鏀舵湁鏁堣闊冲抚
   * 鍙湁鏈夋晥璇煶鎵嶄細琚紦瀛樺拰鍙戦€侊紝闈欓煶鐗囨瀹屽叏涓嶅彂閫?
   */
  // 娉ㄦ剰锛氶煶棰戝抚澶勭悊鍜岄潤闊虫娴嬪凡绉昏嚦 SessionManager
  // 鍥炶皟宸茬洿鎺ュ鎵樼粰 SessionManager锛岃繖閲屼笉鍐嶉渶瑕佸鐞?

  /**
   * 鏈嶅姟鍣ㄦ秷鎭鐞嗕笂涓嬫枃锛堜緵 message_handler 浣跨敤锛?
   */
  private getMessageHandlerContext(): ServerMessageHandlerContext {
    return {
      getIsSessionActive: () => this.sessionManager.getIsSessionActive(),
      asrSubtitle: this.asrSubtitle,
      translationDisplay: this.translationDisplay,
      observability: this.observability,
      getCurrentTraceId: () => this.currentTraceId,
      setCurrentTraceId: (v) => {
        this.currentTraceId = v;
      },
      getCurrentGroupId: () => this.currentGroupId,
      setCurrentGroupId: (v) => {
        this.currentGroupId = v;
      },
      getState: () => this.stateMachine.getState(),
      roomManager: this.roomManager,
      webrtcManager: this.webrtcManager,
      leaveRoom: () => this.leaveRoom(),
      handleTtsAudioForRoomMode: (base64) => this.handleTtsAudioForRoomMode(base64),
      notifyTtsAudioAvailable: () => this.appPlayback.notifyTtsAudioAvailable(),
      startTtsPlayback: () => this.appPlayback.startTtsPlayback(),
      ttsPlayer: this.ttsPlayer,
      config: this.config,
    };
  }

  /**
   * 鏈嶅姟鍣ㄦ秷鎭鐞?
   */
  private async onServerMessage(message: ServerMessage): Promise<void> {
    await handleServerMessage(this.getMessageHandlerContext(), message);
  }

  /** @deprecated 宸茶縼绉昏嚦 app/playback锛屼繚鐣欑┖瀹炵幇渚涘洖璋冨崰浣?*/
  private onPlaybackIndexChange(utteranceIndex: number): void {
    this.appPlayback.onPlaybackIndexChange(utteranceIndex);
  }

  /** @deprecated 宸茶縼绉昏嚦 app/playback */
  private onMemoryPressure(pressure: 'normal' | 'warning' | 'critical'): void {
    this.appPlayback.onMemoryPressure(pressure);
  }

  /** @deprecated 宸茶縼绉昏嚦 app/playback */
  private onPlaybackStarted(): void {
    this.appPlayback.onPlaybackStarted();
  }

  /** @deprecated 宸茶縼绉昏嚦 app/playback */
  private onPlaybackFinished(): void {
    this.appPlayback.onPlaybackFinished();
  }

  async startTtsPlayback(): Promise<void> {
    return this.appPlayback.startTtsPlayback();
  }

  pauseTtsPlayback(): void {
    this.appPlayback.pauseTtsPlayback();
  }

  getTtsAudioDuration(): number {
    return this.appPlayback.getTtsAudioDuration();
  }

  hasPendingTtsAudio(): boolean {
    return this.appPlayback.hasPendingTtsAudio();
  }

  isTtsPlaying(): boolean {
    return this.appPlayback.isTtsPlaying();
  }

  getMemoryPressure(): 'normal' | 'warning' | 'critical' {
    return this.appPlayback.getMemoryPressure();
  }

  isTtsPaused(): boolean {
    return this.appPlayback.isTtsPaused();
  }

  toggleTtsPlaybackRate(): number {
    return this.appPlayback.toggleTtsPlaybackRate();
  }

  getTtsPlaybackRate(): number {
    return this.appPlayback.getTtsPlaybackRate();
  }

  getTtsPlaybackRateText(): string {
    return this.appPlayback.getTtsPlaybackRateText();
  }


  /**
   * 澶勭悊鎴块棿妯″紡涓嬬殑 TTS 闊抽
   * @param base64Audio base64 缂栫爜鐨勯煶棰戞暟鎹?
   */
  private async handleTtsAudioForRoomMode(base64Audio: string): Promise<void> {
    await addTtsAudioToMixer(this.audioMixer, base64Audio);
  }

  /**
   * 杩炴帴鏈嶅姟鍣紙鍗曞悜妯″紡锛?
   * @param srcLang 婧愯瑷€
   * @param tgtLang 鐩爣璇█
   * @param features 鍙€夊姛鑳芥爣蹇楋紙鐢辩敤鎴烽€夋嫨锛?
   */
  async connect(srcLang: string = 'zh', tgtLang: string = 'en', features?: FeatureFlags): Promise<void> {
    try {
      await this.sessionManager.connect(srcLang, tgtLang, features, this.pipelineConfig);
      // 璁板綍杩炴帴鎴愬姛
      if (this.observability) {
        this.observability.recordConnectionSuccess();
      }
    } catch (error) {
      // 璁板綍杩炴帴澶辫触
      if (this.observability) {
        this.observability.recordConnectionFailure();
      }
      throw error;
    }
  }

  /**
   * 杩炴帴鏈嶅姟鍣紙鍙屽悜妯″紡锛?
   * @param langA 璇█ A
   * @param langB 璇█ B
   * @param features 鍙€夊姛鑳芥爣蹇楋紙鐢辩敤鎴烽€夋嫨锛?
   */
  async connectTwoWay(langA: string = 'zh', langB: string = 'en', features?: FeatureFlags): Promise<void> {
    try {
      await this.sessionManager.connectTwoWay(langA, langB, features, this.pipelineConfig);
      // 璁板綍杩炴帴鎴愬姛
      if (this.observability) {
        this.observability.recordConnectionSuccess();
      }
    } catch (error) {
      // 璁板綍杩炴帴澶辫触
      if (this.observability) {
        this.observability.recordConnectionFailure();
      }
      throw error;
    }
  }

  /**
   * 寮€濮嬫暣涓細璇濓紙鎸佺画杈撳叆+杈撳嚭妯″紡锛?
   */
  async startSession(): Promise<void> {
    await this.sessionManager.startSession();
  }

  /**
   * 缁撴潫鏁翠釜浼氳瘽
   */
  async endSession(): Promise<void> {
    await this.sessionManager.endSession();
  }

  /**
   * 鍙戦€佸綋鍓嶈鐨勮瘽锛堟帶鍒惰璇濊妭濂忥級
   * 鍙戦€佸悗缁х画鐩戝惉锛堜繚鎸佸湪 INPUT_RECORDING 鐘舵€侊級
   * 浣跨敤 Utterance 娑堟伅锛屾敮鎸?opus 缂栫爜
   */
  async sendCurrentUtterance(): Promise<void> {
    await this.sessionManager.sendCurrentUtterance();
  }

  /**
   * 鏇存柊闈欓煶杩囨护閰嶇疆
   */
  updateSilenceFilterConfig(config: Partial<SilenceFilterConfig>): void {
    this.recorder.updateSilenceFilterConfig(config);
  }

  /**
   * 鑾峰彇闈欓煶杩囨护閰嶇疆
   */
  getSilenceFilterConfig(): SilenceFilterConfig {
    return this.recorder.getSilenceFilterConfig();
  }

  /**
   * 鑾峰彇鑳屽帇鐘舵€?
   */
  getBackpressureState(): BackpressureState {
    return this.wsClient.getBackpressureState();
  }

  /**
   * 鑾峰彇閲嶈繛娆℃暟
   */
  getReconnectAttempts(): number {
    return this.wsClient.getReconnectAttempts();
  }

  /**
   * 寮€濮嬪綍闊筹紙淇濈暀姝ゆ柟娉曚互鍏煎鏃т唬鐮侊紝浣嗘帹鑽愪娇鐢?startSession锛?
   * @deprecated 浣跨敤 startSession() 浠ｆ浛
   */
  async startRecording(): Promise<void> {
    await this.startSession();
  }

  /**
   * 鍋滄褰曢煶锛堜繚鐣欐鏂规硶浠ュ吋瀹规棫浠ｇ爜锛屼絾鎺ㄨ崘浣跨敤 sendCurrentUtterance 鎴?endSession锛?
   * @deprecated 浣跨敤 sendCurrentUtterance() 鎴?endSession() 浠ｆ浛
   */
  stopRecording(): void {
    if (this.sessionManager.getIsSessionActive()) {
      // 濡傛灉浼氳瘽杩涜涓紝浣跨敤 sendCurrentUtterance
      this.sendCurrentUtterance();
    } else {
      // 濡傛灉浼氳瘽鏈紑濮嬶紝鐩存帴鍋滄
      if (this.stateMachine.getState() === SessionState.INPUT_RECORDING) {
        this.recorder.stop();
        this.stateMachine.stopRecording();
      }
    }
  }

  /**
   * 鏂紑杩炴帴
   */
  disconnect(): void {
    // 濡傛灉姝ｅ湪鎴块棿涓紝鍏堥€€鍑烘埧闂?
    if (this.roomManager.getIsInRoom() && this.roomManager.getCurrentRoomCode()) {
      this.leaveRoom();
    }

    // 鍏抽棴鎵€鏈?WebRTC 杩炴帴
    this.webrtcManager.closeAllConnections();

    // 鍋滄闊抽娣锋帶鍣?
    this.audioMixer.stop();

    // 绉婚櫎闊抽娣锋帶鍣ㄨ緭鍑哄厓绱?
    if (this.audioMixerOutput) {
      this.audioMixerOutput.remove();
      this.audioMixerOutput = null;
    }

    this.sessionManager.disconnect();

    // 閿€姣佸彲瑙傛祴鎬х鐞嗗櫒
    if (this.observability) {
      this.observability.destroy();
      this.observability = null;
    }
  }

  /**
   * 鑾峰彇鍙娴嬫€ф寚鏍?
   */
  getObservabilityMetrics(): Readonly<ObservabilityMetrics> | null {
    return this.observability ? this.observability.getMetrics() : null;
  }

  /**
   * 鍒涘缓鎴块棿
   * 鍒涘缓鑰呰嚜鍔ㄦ垚涓虹涓€涓垚鍛?
   * @param displayName 鏄剧ず鍚嶇О锛堝彲閫夛級
   * @param preferredLang 鍋忓ソ璇█锛堝彲閫夛級
   */
  createRoom(displayName?: string, preferredLang?: string): void {
    this.roomManager.createRoom(displayName, preferredLang);
  }

  /**
   * 鍔犲叆鎴块棿
   * @param roomCode 鎴块棿鐮侊紙6浣嶆暟瀛楋級
   * @param displayName 鏄剧ず鍚嶇О锛堝彲閫夛級
   * @param preferredLang 鍋忓ソ璇█锛堝彲閫夛級
   */
  joinRoom(roomCode: string, displayName?: string, preferredLang?: string): void {
    this.roomManager.joinRoom(roomCode, displayName, preferredLang);
  }

  /**
   * 閫€鍑烘埧闂?
   */
  leaveRoom(): void {
    // 濡傛灉浼氳瘽姝ｅ湪杩涜锛屽厛缁撴潫浼氳瘽
    if (this.sessionManager.getIsSessionActive()) {
      this.sessionManager.endSession();
    }

    // 鍏抽棴鎵€鏈?WebRTC 杩炴帴
    this.webrtcManager.closeAllConnections();

    // 閫€鍑烘埧闂?
    this.roomManager.leaveRoom();
  }

  /**
   * 鑾峰彇褰撳墠鎴块棿鐮?
   */
  getCurrentRoomCode(): string | null {
    return this.roomManager.getCurrentRoomCode();
  }

  /**
   * 鑾峰彇鎴块棿鎴愬憳鍒楄〃
   */
  getRoomMembers(): RoomMember[] {
    return this.roomManager.getRoomMembers();
  }

  /**
   * 妫€鏌ユ槸鍚﹀湪鎴块棿涓?
   */
  getIsInRoom(): boolean {
    return this.roomManager.getIsInRoom();
  }

  /**
   * 鑾峰彇褰撳墠浼氳瘽 ID
   */
  getSessionId(): string | null {
    return this.wsClient.getSessionId();
  }

  /**
   * 妫€鏌?WebSocket 鏄惁宸茶繛鎺?
   */
  isConnected(): boolean {
    const connected = this.wsClient.isConnected();
    console.log('[App] isConnected() 璋冪敤:', connected);
    return connected;
  }

  /**
   * 璁剧疆鍘熷０浼犻€掑亸濂?
   */
  setRawVoicePreference(roomCode: string, targetSessionId: string, receiveRawVoice: boolean): void {
    this.wsClient.setRawVoicePreference(roomCode, targetSessionId, receiveRawVoice);
    // WebRTCManager 浼氶€氳繃 syncPeerConnections 鑷姩绠＄悊杩炴帴
    this.webrtcManager.syncPeerConnections();
  }

  // WebRTC 鐩稿叧鏂规硶宸茬Щ鑷?WebRTCManager

  /**
   * 鏇存柊鎴块棿鎴愬憳鍒楄〃骞跺悓姝?WebRTC 杩炴帴
   */
  // syncPeerConnections 宸茬Щ鑷?WebRTCManager

  /**
   * 璁剧疆鑷姩鎾斁妯″紡
   * @param enabled 鏄惁鍚敤鑷姩鎾斁锛坱rue=鑷姩鎾斁妯″紡锛宖alse=鎵嬪姩鎾斁妯″紡锛?
   */
  setAutoPlay(enabled: boolean): void {
    this.config.autoPlay = enabled;
    // 淇濆瓨鍒?localStorage锛屼互渚夸笅娆″惎鍔ㄦ椂浣跨敤
    localStorage.setItem('tts_auto_play', enabled.toString());
    console.log('[App] 鑷姩鎾斁妯″紡宸叉洿鏂?', enabled ? '鑷姩鎾斁妯″紡' : '鎵嬪姩鎾斁妯″紡');
  }

  /**
   * 鑾峰彇鑷姩鎾斁妯″紡
   * @returns 鏄惁鍚敤鑷姩鎾斁
   */
  getAutoPlay(): boolean {
    return this.config.autoPlay ?? false;
  }

  /**
   * 鍒囨崲鑷姩鎾斁妯″紡
   * @returns 鍒囨崲鍚庣殑鑷姩鎾斁鐘舵€?
   */
  toggleAutoPlay(): boolean {
    const newState = !this.getAutoPlay();
    this.setAutoPlay(newState);
    return newState;
  }

  /**
   * 鑾峰彇褰撳墠鐘舵€?
   */
  getState(): SessionState {
    return this.stateMachine.getState();
  }

  // 娉ㄦ剰锛歝oncatAudioBuffers 宸茬Щ鑷?SessionManager

  /**
   * 鑾峰彇鐘舵€佹満瀹炰緥锛堢敤浜?UI 璁块棶锛?
   * @internal
   */
  getStateMachine(): StateMachine {
    return this.stateMachine;
  }
}

