"""
本地调试：用模型目录下 test_wavs 跑一遍 pipeline，打印 log_probs 与解码结果。
用法: python debug_decode.py [wav_path]
"""
import sys
from pathlib import Path

import numpy as np

# 使用服务内模块
from config import get_model_config, BEAM_WIDTH, NBEST, KENLM_PATH, NUM_THREADS, PROVIDER
from features import waveform_to_fbank
from onnx_runner import load_session, run as onnx_run
from ctc_decode import build_decoder, decode as ctc_decode, _load_labels

def main():
    cfg = get_model_config()
    if not cfg:
        print("No model config")
        return
    tokens_path, model_path = cfg
    print("Model:", model_path)
    print("Tokens:", tokens_path)

    if not load_session(model_path, provider=PROVIDER, num_threads=NUM_THREADS):
        print("ONNX load failed")
        return
    if not build_decoder(tokens_path, kenlm_path=KENLM_PATH, beam_width=BEAM_WIDTH, alpha=0.5, beta=1.0):
        print("Decoder build failed")
        return

    # 用 test_wavs 或指定路径
    model_dir = Path(model_path).parent
    test_wavs = list((model_dir / "test_wavs").glob("*.wav")) if (model_dir / "test_wavs").exists() else []
    if sys.argv[1:]:
        wav_path = Path(sys.argv[1])
    elif test_wavs:
        wav_path = test_wavs[0]
    else:
        print("No WAV (give path or put test_wavs in model dir)")
        return

    import wave
    import librosa
    with wave.open(str(wav_path), "rb") as w:
        sr = w.getframerate()
        n = w.getnframes()
        raw = w.readframes(n)
    audio = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    if sr != 16000:
        audio = librosa.resample(audio, orig_sr=sr, target_sr=16000)

    features, num_frames = waveform_to_fbank(audio, 16000)
    print("Frames:", num_frames, "features shape:", features.shape)

    log_probs, log_probs_length = onnx_run(features, num_frames)
    if log_probs is None:
        print("ONNX run failed")
        return
    lp = log_probs[0] if log_probs.ndim == 3 else log_probs
    L = int(log_probs_length.flat[0]) if log_probs_length is not None else lp.shape[0]
    lp = lp[:L]
    print("log_probs shape:", lp.shape, "used length:", L)
    print("log_probs min/max/mean:", np.min(lp), np.max(lp), np.mean(lp))
    argmax_per_frame = np.argmax(lp, axis=1)
    print("argmax per frame (first 30):", argmax_per_frame[:30].tolist())
    print("blank(0) ratio:", np.mean(argmax_per_frame == 0))
    # 非 0 的 token 有哪些
    uniq = np.unique(argmax_per_frame)
    print("unique argmax indices:", uniq[:20].tolist(), "..." if len(uniq) > 20 else "")

    text, nbest_list = ctc_decode(log_probs, log_probs_length, num_results=NBEST)
    print("Decoded text:", repr(text))
    print("N-best count:", len(nbest_list))
    for i, b in enumerate(nbest_list):
        print("  ", i, b)

if __name__ == "__main__":
    main()
