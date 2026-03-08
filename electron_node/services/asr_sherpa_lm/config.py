"""
ASR Sherpa-LM 服务配置
契约与 asr-sherpa-en / faster-whisper-vad 一致：POST /utterance，PCM16 16kHz。
默认使用 Omnilingual CTC 300M int8（1600+ 语言），支持 beam/N-best。
"""
import os

_SERVICE_DIR = os.path.dirname(os.path.abspath(__file__))

PORT = int(os.getenv("ASR_SHERPA_LM_PORT", "6011"))

# 固定模型：Omnilingual CTC 300M int8（多语言），不提供多模型切换
MODEL_DIR = os.path.join(_SERVICE_DIR, "models", "omnilingual_ctc_300m_int8")
NUM_THREADS = int(os.getenv("ASR_SHERPA_LM_NUM_THREADS", "1"))
SAMPLE_RATE = int(os.getenv("ASR_SHERPA_LM_SAMPLE_RATE", "16000"))
FEATURE_DIM = int(os.getenv("ASR_SHERPA_LM_FEATURE_DIM", "80"))
PROVIDER = os.getenv("ASR_SHERPA_LM_PROVIDER", "cuda").strip().lower()
BEAM_WIDTH = int(os.getenv("ASR_SHERPA_LM_BEAM_WIDTH", "4"))
NBEST = int(os.getenv("ASR_SHERPA_LM_NBEST", "4"))
# KenLM 可选：仅当设置 ASR_SHERPA_LM_KENLM_PATH 时启用，用于 n-best rerank
KENLM_PATH = os.getenv("ASR_SHERPA_LM_KENLM_PATH", "").strip() or None
LM_ALPHA = float(os.getenv("ASR_SHERPA_LM_ALPHA", "0.5"))
LM_BETA = float(os.getenv("ASR_SHERPA_LM_BETA", "1.0"))


def _load_config(model_dir: str):
    """返回 (tokens_path, model_path) 或 None。目录需含 tokens.txt 与 model.int8.onnx 或 model.onnx。"""
    if not model_dir or not os.path.isdir(model_dir):
        return None
    tokens = os.path.join(model_dir, "tokens.txt")
    if not os.path.isfile(tokens):
        return None
    for name in ("model.int8.onnx", "model.onnx"):
        model = os.path.join(model_dir, name)
        if os.path.isfile(model):
            return (tokens, model)
    return None


def get_model_config():
    """返回 (tokens_path, model_path) 或 None。"""
    return _load_config(MODEL_DIR)
