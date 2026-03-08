"""
CTC ONNX 前向：输入 fbank，输出 log_probs。
输入: (1, T, 80) + length；输出: (1, T', vocab_size) + length。
兼容 sherpa-onnx CTC 模型（Omnilingual 等）。
"""
import logging
from typing import Optional, Tuple

import numpy as np

logger = logging.getLogger(__name__)

_session = None
_input_names = None
_output_names = None
_output_vocab_size = None
_input_is_waveform = False  # True 表示输入为 (N, num_samples) 波形，否则为 (N, T, 80) fbank


def _get_io_names(session):
    """从 session 取输入输出名（兼容不同导出命名）。"""
    inp = [x.name for x in session.get_inputs()]
    out = [x.name for x in session.get_outputs()]
    return inp, out


def load_session(model_path: str, provider: str, num_threads: int = 1) -> bool:
    """加载 ONNX 会话，仅支持 GPU（CUDA）。成功返回 True；provider 非 cuda 时直接抛错。"""
    global _session, _input_names, _output_names, _output_vocab_size, _input_is_waveform
    if (provider or "").strip().lower() != "cuda":
        raise ValueError(
            "CTC 服务仅支持 GPU：请设置 PROVIDER=cuda、安装 onnxruntime-gpu 并用 venv 启动。"
        )
    try:
        import onnxruntime as ort
    except ImportError:
        logger.error("onnxruntime 未安装，请安装 onnxruntime-gpu")
        return False
    opts = ort.SessionOptions()
    opts.intra_op_num_threads = num_threads
    sess = ort.InferenceSession(
        model_path,
        sess_options=opts,
        providers=["CUDAExecutionProvider"],
    )
    _session = sess
    _input_names, _output_names = _get_io_names(sess)
    _output_vocab_size = None
    if sess.get_outputs():
        shape = sess.get_outputs()[0].shape
        if len(shape) >= 3 and isinstance(shape[-1], int):
            _output_vocab_size = int(shape[-1])
    inp0 = sess.get_inputs()[0] if sess.get_inputs() else None
    _input_is_waveform = inp0 is not None and len(inp0.shape) == 2
    logger.info("ONNX loaded: inputs=%s outputs=%s vocab_size=%s waveform_input=%s", _input_names, _output_names, _output_vocab_size, _input_is_waveform)
    return True


def run(features: np.ndarray, features_length: int) -> Tuple[Optional[np.ndarray], Optional[np.ndarray]]:
    """
    前向。波形模型：features (1, num_samples) float32。fbank 模型：(1, T, 80) + length。
    返回 (log_probs, log_probs_length)，log_probs (1, T', vocab_size)。
    """
    global _session, _input_names, _output_names, _input_is_waveform
    if _session is None:
        return None, None
    feed = {}
    for inp_i in _session.get_inputs():
        if not _input_is_waveform and ("len" in inp_i.name.lower() or inp_i.name.endswith("_lens")):
            feed[inp_i.name] = np.array([features_length], dtype=np.int64)
        else:
            x = np.asarray(features, dtype=np.float32)
            if _input_is_waveform and x.ndim == 1:
                x = x.reshape(1, -1)
            feed[inp_i.name] = x
    out = _session.run(_output_names, feed)
    out0 = out[0]
    log_probs_length = out[1] if len(out) > 1 else np.array([out0.shape[1]], dtype=np.int64)
    # 若 ONNX 输出为 logits（数值范围大），转为 log_softmax；已是 log_softmax 则不变
    if np.max(out0) > 10 or np.min(out0) < -50:
        x = out0.astype(np.float64)
        x_max = np.max(x, axis=-1, keepdims=True)
        x = x - x_max
        exp_x = np.exp(x)
        log_probs = (x - np.log(np.sum(exp_x, axis=-1, keepdims=True) + 1e-12)).astype(np.float32)
    else:
        log_probs = out0.astype(np.float32)
    return log_probs, log_probs_length


def get_session():
    return _session


def get_output_vocab_size() -> Optional[int]:
    """ONNX 第一个输出的最后一维（词表大小），若动态则为 None。"""
    return _output_vocab_size


def input_is_waveform() -> bool:
    """是否以原始波形为输入（否则为 fbank）。"""
    return _input_is_waveform
