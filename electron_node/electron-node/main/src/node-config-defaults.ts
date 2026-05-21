import type { NodeConfig } from './node-config-types';

/** 默认配置：所有 URL 等默认值仅在此定义，运行时由 electron-node-config.json 覆盖。 */
export const DEFAULT_CONFIG: NodeConfig = {
  servicePreferences: {},
  scheduler: { url: 'ws://127.0.0.1:5010/ws/node' },
  modelHub: { url: 'http://127.0.0.1:5000' },
  services: {
    baseUrl: 'http://127.0.0.1',
    phoneticCorrectionUrl: 'http://127.0.0.1:5016',
    punctuationRestoreUrl: 'http://127.0.0.1:5017',
  },
  testServer: { port: 5020 },
  lid: {
    enabled: true,
    modelPath: 'models/sherpa-onnx-lid',
    encoderFile: 'tiny-encoder.int8.onnx',
    decoderFile: 'tiny-decoder.int8.onnx',
  },
  metrics: {
    enabled: true,
    metrics: { rerun: true, asr: true },
  },
  features: {
    enablePostProcessTranslation: true,
    enableS1PromptBias: false,
    enableS2Rescoring: false,
    phoneticCorrection: { enabled: false },
    semanticRepair: { enabled: false },
    punctuationRestore: { enabled: false },
    lexiconRecall: {
      enabled: false,
      maxReplacements: 2,
      recallMinPhoneticScore: 0.5,
      recallFuzzyPinyinMaxSyllableDelta: 2,
      expansionMinPhoneticScore: 0.5,
      selectionMinPhoneticScore: 0.85,
      maxSentenceCandidates: 16,
      multiWindowScoreEpsilon: 0.005,
    },
  },
  textLength: {
    minLengthToKeep: 6,
    minLengthToSend: 20,
    maxLengthToWait: 40,
    waitTimeoutMs: 3000,
  },
};
