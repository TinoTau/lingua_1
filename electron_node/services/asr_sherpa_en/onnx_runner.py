"""
英文 CTC ONNX 前向：输入 fbank (1, T, 80)，输出 log_probs。仅适配 Conformer small（输入 layout (1, 80, T)）。
"""
import logging
from typing import Optional, Tuple

import numpy as np

try:
    import onnxruntime as ort
except ImportError:
    ort = None

logger = logging.getLogger(__name__)

_session = None
_input_names = None
_output_names = None
_output_vocab_size = None


def load_session(model_path: str, provider: str, num_threads: int = 1) -> bool:
    """加载 ONNX，仅支持 CUDA。"""
    global _session, _input_names, _output_names, _output_vocab_size
    if (provider or "").strip().lower() != "cuda":
        raise ValueError("CTC 服务仅支持 GPU：PROVIDER=cuda，onnxruntime-gpu，venv 启动。")
    if ort is None:
        logger.error("onnxruntime 未安装，请安装 onnxruntime-gpu")
        return False
    opts = ort.SessionOptions()
    opts.intra_op_num_threads = num_threads
    opts.inter_op_num_threads = max(1, num_threads)
    sess = ort.InferenceSession(
        model_path,
        sess_options=opts,
        providers=["CUDAExecutionProvider"],
    )
    _session = sess
    _input_names = [x.name for x in sess.get_inputs()]
    _output_names = [x.name for x in sess.get_outputs()]
    _output_vocab_size = None
    if sess.get_outputs():
        shape = sess.get_outputs()[0].shape
        if len(shape) >= 3 and isinstance(shape[-1], int):
            _output_vocab_size = int(shape[-1])
    logger.info("ONNX loaded: inputs=%s outputs=%s vocab_size=%s", _input_names, _output_names, _output_vocab_size)
    return True


def run(features: np.ndarray, features_length: int) -> Tuple[Optional[np.ndarray], Optional[np.ndarray]]:
    """fbank (1, T, 80) -> 转成 (1, 80, T) 送入 ONNX -> log_probs。"""
    if _session is None:
        return None, None
    x = np.asarray(features, dtype=np.float32)
    if x.ndim == 3 and x.shape[-1] == 80:
        x = np.transpose(x, (0, 2, 1))
    feed = {}
    for inp_i in _session.get_inputs():
        if "len" in inp_i.name.lower() or inp_i.name.endswith("_lens"):
            feed[inp_i.name] = np.array([features_length], dtype=np.int64)
        else:
            feed[inp_i.name] = x
    out = _session.run(_output_names, feed)
    out0 = out[0]
    log_probs_length = out[1] if len(out) > 1 else np.array([out0.shape[1]], dtype=np.int64)
    if np.max(out0) > 10 or np.min(out0) < -50:
        x = out0.astype(np.float64)
        x_max = np.max(x, axis=-1, keepdims=True)
        x = x - x_max
        exp_x = np.exp(x)
        log_probs = (x - np.log(np.sum(exp_x, axis=-1, keepdims=True) + 1e-12)).astype(np.float32)
    else:
        log_probs = out0.astype(np.float32)
    return log_probs, log_probs_length


def get_output_vocab_size() -> Optional[int]:
    return _output_vocab_size
