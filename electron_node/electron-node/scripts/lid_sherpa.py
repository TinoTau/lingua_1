#!/usr/bin/env python3
"""
Sherpa-ONNX 语种识别：供节点端子进程调用。
用法: python lid_sherpa.py --model-dir <dir> --wav <path>
stdout 一行 JSON: {"lang": "zh", "ms": 12}
"""
import argparse
import json
import sys
import time


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--model-dir", required=True, help="目录，含 tiny-encoder.int8.onnx / tiny-decoder.int8.onnx")
    p.add_argument("--wav", required=True, help="WAV 文件路径，单声道 16bit")
    args = p.parse_args()

    import sherpa_onnx

    encoder = f"{args.model_dir.rstrip('/')}/tiny-encoder.int8.onnx"
    decoder = f"{args.model_dir.rstrip('/')}/tiny-decoder.int8.onnx"
    cfg = sherpa_onnx.SpokenLanguageIdentificationConfig(
        whisper=sherpa_onnx.SpokenLanguageIdentificationWhisperConfig(
            encoder=encoder,
            decoder=decoder,
        ),
        num_threads=1,
        provider="cpu",
    )
    slid = sherpa_onnx.SpokenLanguageIdentification(cfg)

    import wave
    with wave.open(args.wav, "rb") as f:
        assert f.getnchannels() == 1 and f.getsampwidth() == 2
        sr = f.getframerate()
        n = f.getnframes()
        samples = f.readframes(n)
    samples_int16 = __import__("numpy").frombuffer(samples, dtype="int16")
    samples_float32 = samples_int16.astype("float32") / 32768.0

    t0 = time.perf_counter()
    stream = slid.create_stream()
    stream.accept_waveform(sample_rate=sr, waveform=samples_float32)
    lang = slid.compute(stream)
    ms = int((time.perf_counter() - t0) * 1000)
    out = {"lang": lang, "ms": ms}
    print(json.dumps(out), flush=True)


if __name__ == "__main__":
    main()
    sys.exit(0)
