/** 用户显式选择：是否在启动时自动拉起各 service（仅由 UI / set-service-preferences 写入） */
export type ServicePreferences = Record<string, boolean>;

/** 上次退出时各 service 的实际运行快照（观测用，不影响下次 auto-start） */
export type ServiceLastRuntimeState = Record<string, boolean>;

/**
 * 指标收集配置
 * 支持热插拔：根据配置和服务状态动态决定收集哪些指标
 */
export interface MetricsConfig {
  enabled?: boolean;
  metrics?: {
    rerun?: boolean;
    asr?: boolean;
    nmt?: boolean;
    tts?: boolean;
    [key: string]: boolean | undefined;
  };
}

export interface NodeConfig {
  /** 用户选择：启动时是否 auto-start 各 service */
  servicePreferences: ServicePreferences;
  /** 上次退出时的运行快照（不覆盖 servicePreferences） */
  serviceLastRuntimeState?: ServiceLastRuntimeState;
  scheduler?: { url?: string };
  modelHub?: { url?: string };
  services?: {
    baseUrl?: string;
    phoneticCorrectionUrl?: string;
    punctuationRestoreUrl?: string;
  };
  testServer?: { port?: number };
  lid?: {
    enabled?: boolean;
    modelPath?: string;
    encoderFile?: string;
    decoderFile?: string;
  };
  metrics?: MetricsConfig;
  asr?: {
    /** `fw_detector_v1` — FW-only 主链（faster-whisper-vad + span detector） */
    engine?: 'fw_detector_v1' | string;
  };
  features?: {
    enablePostProcessTranslation?: boolean;
    enableS1PromptBias?: boolean;
    enableS2Rescoring?: boolean;
    phoneticCorrection?: {
      /** 节点级是否启用 5016 同音纠错（默认 false） */
      enabled?: boolean;
    };
    semanticRepair?: {
      /** 节点级是否启用 5015 语义修复 HTTP（默认 false） */
      enabled?: boolean;
      zh?: { qualityThreshold?: number; forceForShortSentence?: boolean };
      en?: { qualityThreshold?: number };
      cache?: { maxSize?: number; ttlMs?: number; modelVersion?: string };
      modelIntegrityCheck?: { enabled?: boolean; checkInterval?: number };
    };
    punctuationRestore?: {
      /** 节点级是否启用 5017 断句（默认 false，不扩大强制主链） */
      enabled?: boolean;
    };
    lexiconRecall?: {
      /** 节点级是否启用 SQLite 词库 recall preview（默认 false） */
      enabled?: boolean;
      /** 每句最多写回 span 数（默认 2；expansion 循环 1..max） */
      maxReplacements?: number;
      /** @deprecated 使用 selectionMinPhoneticScore */
      minPhoneticScore?: number;
      /** 窗 recall 最低音近分（默认 0.5） */
      recallMinPhoneticScore?: number;
      /** fuzzy pinyin 音节长度差上限（Q1.7 默认 2） */
      recallFuzzyPinyinMaxSyllableDelta?: number;
      /** expansion 最低音近分（默认 0.5，禁止与 selectionMin 混用） */
      expansionMinPhoneticScore?: number;
      /** final selection 最低音近分（默认 0.85） */
      selectionMinPhoneticScore?: number;
      /** sentence expansion 池上限（V5 冻结默认 32） */
      maxSentenceCandidates?: number;
      /** near-tie multi-window guardrail epsilon（默认 0.005） */
      multiWindowScoreEpsilon?: number;
      allowedWindowLengths?: number[];
      diffContextLeft?: number;
      diffContextRight?: number;
      topKByTermLength?: Record<string, number>;
      maxActiveWindows?: number;
      minCandidateScore?: number;
      kenlmBaselineTolerance?: number;
      crossSegmentRecallEnabled?: boolean;
      contractVersion?: 'v5-scored-lexicon-topk' | 'historical-restore-v1';
    };
    lexiconV2?: {
      enabled?: boolean;
      /** Phase 2：写入 session.lexiconSessionIntent（默认 false） */
      sessionIntentWriteEnabled?: boolean;
      /** 是否调度 CPU LLM Intent（Recover 仍可用 lexiconV2.enabled） */
      intentEnabled?: boolean;
      /** Final Spec: only cpu_llm is supported */
      intentMode?: 'cpu_llm';
      cpuWorker?: {
        serviceUrl?: string;
        modelPath?: string;
        timeoutMs?: number;
        promptPackVersion?: string;
        maxContextTurns?: number;
        maxSummaryChars?: number;
        metricsEnabled?: boolean;
        warmupEnabled?: boolean;
        warmupTimeoutMs?: number;
        healthRefreshIntervalMs?: number;
        recoveryEnabled?: boolean;
        recoveryMaxRetries?: number;
        recoveryBackoffMs?: number[];
        recoveryRestartService?: boolean;
      };
      /** finalized turn 后 flush patch proposals（jsonl） */
      patchProposalDir?: string;
    };
    /** Phase 1：Lexicon Runtime V2 SQL 查询（默认 true，FW 主链 recall） */
    lexiconRuntimeV2?: {
      enabled?: boolean;
      bundlePath?: string;
      lruBucketCacheSize?: number;
      /** P3 hotfix: SQL LIMIT for base tier (default 2) */
      maxBaseCandidates?: number;
      /** P3 hotfix: SQL LIMIT per domain query; merge caps total domain rows (default 3) */
      maxDomainCandidates?: number;
      /** P3 hotfix: idiom tier SQL LIMIT; 0 = disabled (default 0) */
      maxIdiomCandidates?: number;
      /** Attach recall tier diagnostics to fw_detector result */
      recallDiagnosticsEnabled?: boolean;
    };
    sessionAffinity?: {
      enabled?: boolean;
      snapshotPath?: string;
    };
    fwDetector?: {
      enabled?: boolean;
      disableAsrRerun?: boolean;
      /** @deprecated Span cap SSOT is fwMetadataSpanGate.maxSpans */
      maxSpans?: number;
      spanDetectBudget?: number;
      topK?: number;
      minPrior?: number;
      minRiskScore?: number;
      enableKenLMGate?: boolean;
      kenlmGateMode?: 'hard_gate' | 'weak_veto';
      kenlmDeltaThreshold?: number;
      kenlmVetoThreshold?: number;
      finalScoreWeights?: {
        pinyin?: number;
        prior?: number;
        domain?: number;
        kenlm?: number;
      };
      enabledDomains?: string[];
      domainAnchorPath?: string;
      windowChars?: number;
      minSpanChars?: number;
      maxSpanChars?: number;
      noSpeechProbThreshold?: number;
      recallMinPhoneticScore?: number;
      candidateRequireRepairTarget?: boolean;
      repairTargetScoreBoost?: number;
      /** P3.2: KenLM span gate mode — kenlm_gate_filter replaces legacy detector spans */
      spanGateMode?: 'legacy_detector' | 'kenlm_gate_filter' | 'fw_metadata_gate';
      kenlmSpanGate?: {
        enabled?: boolean;
        maxSpans?: number;
        minSpanChars?: number;
        maxSpanChars?: number;
        minLocalDelta?: number;
        stopwordFilterEnabled?: boolean;
        preFilterMaxWindows?: number;
      };
      /** P3.3: FW ASR metadata span gate */
      fwMetadataSpanGate?: {
        enabled?: boolean;
        maxSpans?: number;
        minSpanChars?: number;
        maxSpanChars?: number;
        wordProbabilityThreshold?: number;
        segmentAvgLogprobThreshold?: number;
        allowAliasExactHit?: boolean;
        allowSegmentFallbackScan?: boolean;
        fallbackLegacyMaxSpans?: number;
      };
      signalWeights?: Partial<Record<string, number>>;
      /** Phase 3: V2 tier recall (base + domain + idiom). Requires lexiconRuntimeV2.enabled. */
      useLexiconRuntimeV2Recall?: boolean;
      /** Phase 4: topicKeywords → industry_routing_lexicon domain resolution. Requires useLexiconRuntimeV2Recall. */
      useIndustryRouting?: boolean;
      /** P4: sentence-level KenLM rerank (false = P3.3 per-span topK rollback). */
      useSentenceLevelRerank?: boolean;
      maxSentenceCandidates?: number;
      minDeltaToReplace?: number;
    };
    /** Pinyin IME V2 — span proposal (Phase 2+; orchestrator wired in Phase 3). */
    pinyinImeV2?: {
      enabled?: boolean;
      topK?: number;
      maxApprovedSpans?: number;
      minSupportCount?: number;
      minSpanChars?: number;
      maxSpanChars?: number;
      minSyllables?: number;
      maxSyllables?: number;
      /** Must remain false — IME never direct-repairs text. */
      directRepair?: false;
      replaceLegacyDetector?: boolean;
      dictDir?: string;
      enabledDomains?: string[];
    };
  };
  gpuArbiter?: {
    enabled?: boolean;
    gpuKeys?: string[];
    defaultQueueLimit?: number;
    defaultHoldMaxMs?: number;
    gpuUsageThreshold?: number;
    gpuUsage?: {
      sampleIntervalMs?: number;
      cacheTtlMs?: number;
      baseHighWater?: number;
      baseLowWater?: number;
      dynamicAdjustment?: {
        enabled?: boolean;
        longAudioThresholdMs?: number;
        highWaterBoost?: number;
        lowWaterBoost?: number;
        adjustmentTtlMs?: number;
      };
    };
    policies?: {
      ASR?: { priority?: number; maxWaitMs?: number; busyPolicy?: 'WAIT' | 'SKIP' | 'FALLBACK_CPU' };
      NMT?: { priority?: number; maxWaitMs?: number; busyPolicy?: 'WAIT' | 'SKIP' | 'FALLBACK_CPU' };
      TTS?: { priority?: number; maxWaitMs?: number; busyPolicy?: 'WAIT' | 'SKIP' | 'FALLBACK_CPU' };
      SEMANTIC_REPAIR?: { priority?: number; maxWaitMs?: number; busyPolicy?: 'WAIT' | 'SKIP' | 'FALLBACK_CPU' };
      PHONETIC_CORRECTION?: { priority?: number; maxWaitMs?: number; busyPolicy?: 'WAIT' | 'SKIP' | 'FALLBACK_CPU' };
      PUNCTUATION_RESTORE?: { priority?: number; maxWaitMs?: number; busyPolicy?: 'WAIT' | 'SKIP' | 'FALLBACK_CPU' };
    };
  };
  sequentialExecutor?: {
    enabled?: boolean;
    maxWaitMs?: number;
    timeoutCheckIntervalMs?: number;
  };
  textLength?: {
    minLengthToKeep?: number;
    minLengthToSend?: number;
    maxLengthToWait?: number;
    waitTimeoutMs?: number;
  };
}
