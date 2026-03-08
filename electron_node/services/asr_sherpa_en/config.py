"""
ASR Sherpa English CTC 服务配置
契约与 asr-sherpa-lm / faster-whisper-vad 一致：POST /utterance，PCM16 16kHz。
默认使用 sherpa-onnx-nemo-ctc-en-conformer-small（决策推荐，16k），支持 beam/N-best。
参考：English_ASR_Beam_LM_Hotword_Technical_Plan.md
"""
import os

_SERVICE_DIR = os.path.dirname(os.path.abspath(__file__))

PORT = int(os.getenv("ASR_SHERPA_EN_PORT", "6012"))

# 固定模型：NeMo CTC En Conformer small int8（英文，16k）
MODEL_DIR = os.path.join(_SERVICE_DIR, "models", "nemo_ctc_en_conformer_small")
NUM_THREADS = int(os.getenv("ASR_SHERPA_EN_NUM_THREADS", "4"))
SAMPLE_RATE = int(os.getenv("ASR_SHERPA_EN_SAMPLE_RATE", "16000"))
FEATURE_DIM = int(os.getenv("ASR_SHERPA_EN_FEATURE_DIM", "80"))
PROVIDER = os.getenv("ASR_SHERPA_EN_PROVIDER", "cuda").strip().lower()
# beam 越大越准但越慢，默认 4 平衡耗时与效果
BEAM_WIDTH = int(os.getenv("ASR_SHERPA_EN_BEAM_WIDTH", "4"))
NBEST = int(os.getenv("ASR_SHERPA_EN_NBEST", "4"))
# KenLM 可选：仅当设置 ASR_SHERPA_EN_KENLM_PATH 时启用
KENLM_PATH = os.getenv("ASR_SHERPA_EN_KENLM_PATH", "").strip() or None
LM_ALPHA = float(os.getenv("ASR_SHERPA_EN_ALPHA", "0.5"))
LM_BETA = float(os.getenv("ASR_SHERPA_EN_BETA", "1.0"))
# 解码问题定位：若输出出现数字 "4" 等，可能是模型 blank 在 index 4 但词表写成了 "4"。设此值强制该 index 为 blank。
BLANK_INDEX = os.getenv("ASR_SHERPA_EN_BLANK_INDEX", "").strip()
BLANK_INDEX_INT = int(BLANK_INDEX) if BLANK_INDEX.isdigit() else None


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
