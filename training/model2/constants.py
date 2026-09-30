"""Frozen generator / dataset version identifiers for Model2 synth probe."""

GENERATOR_VERSION = "model2-synth-generator-v1"
DATASET_ID = "model2-synth-probe-v1"
SCHEMA_VERSION = 1
PHONETIC_SCHEMA_VERSION = "phonetic-node-align-v1"
CARRIER_VERSION = "carrier_templates_v1"
NORMALIZER_VERSION = "corr-normalizer-v1"
ALIGNER_VERSION = "align-codepoints-v1"

DEFAULT_TTS_SERVICE_ID = "piper-tts"
DEFAULT_TTS_VOICE = "zh_CN-huayan-medium"
DEFAULT_TTS_PORT = 5009

DEFAULT_ASR_SERVICE_ID = "faster-whisper-vad"
DEFAULT_ASR_PORT = 6007
DEFAULT_ASR_SAMPLE_RATE = 16000

REPO_ROOT_MARKERS = ("central_server", "electron_node", "training")
