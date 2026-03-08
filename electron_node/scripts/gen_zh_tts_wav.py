#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
将「语音识别稳定性测试」中文原文合成为 16kHz 单声道 WAV，用于中文 CTC/ASR 测试。
默认按约 10 秒/段切分，生成 zh_tts_1.wav、zh_tts_2.wav …，模拟生产环境多段数据。
支持本机 TTS（pyttsx3）或 Piper TTS 服务（--tts-url）。
用法：
  python gen_zh_tts_wav.py --out-dir D:/Programs/github/lingua_1/expired --local-tts
  python gen_zh_tts_wav.py --local-tts --chars-per-segment 48
  python gen_zh_tts_wav.py --single --out-name zh_stability.wav --local-tts   # 只生成一整段
"""
import argparse
import struct
import sys
from pathlib import Path

try:
    import numpy as np
except ImportError:
    print("请安装 numpy: pip install numpy", file=sys.stderr)
    sys.exit(1)

# 语音识别稳定性测试 中文原文
ZH_TEXT = """
现在我们开始进行一次语音识别稳定性测试。
我会先读一两句比较短的话，用来确认系统不会在句子之间随意地把语音切断，或者在没有必要的时候提前结束本次识别。

接下来这一句我会尽量连续地说得长一些，中间只保留自然的呼吸节奏，不做刻意的停顿，看看在超过十秒钟之后，系统会不会因为超时或者静音判定而强行把这句话截断，从而导致前半句和后半句在节点端被拆成两个不同的 job，甚至出现语义上不完整、读起来前后不连贯的情况。

如果这次的长句能够被完整地识别出来，而且不会出现半句话被提前发送或者直接丢失的现象，那就说明我们当前的切分策略和超时规则是基本可用的。
否则，我们还需要继续分析日志，找出到底是在哪一个环节把我的语音吃掉了。
"""

TTS_URL_DEFAULT = "http://127.0.0.1:5009"
OUT_DIR_DEFAULT = "D:/Programs/github/lingua_1/expired"
TARGET_SR = 16000
# 约 10 秒/段：中文约 4.5～5 字/秒，取每段约 48 字
CHARS_PER_SEGMENT_DEFAULT = 48
# 断句优先在这些字符后切分（句号、逗号、顿号、换行）
BREAK_CHARS = "。！？\n，、；"


def split_zh_into_segments(text: str, chars_per_segment: int = CHARS_PER_SEGMENT_DEFAULT) -> list[str]:
    """按约 N 字/段切分，尽量在 BREAK_CHARS 处断句。"""
    text = text.strip().replace("\n", "")
    if not text:
        return []
    segments = []
    start = 0
    while start < len(text):
        end = min(start + chars_per_segment, len(text))
        if end < len(text):
            # 在 [start, end] 内从后往前找断句符
            chunk = text[start:end]
            break_at = -1
            for i in range(len(chunk) - 1, -1, -1):
                if chunk[i] in BREAK_CHARS:
                    break_at = i + 1
                    break
            if break_at > 0:
                end = start + break_at
            # 若没有断句符，再尝试往后延到下一个断句符（避免把一句话拆碎）
            if break_at <= 0 and end < len(text):
                for i in range(end, min(end + 30, len(text))):
                    if text[i] in BREAK_CHARS:
                        end = i + 1
                        break
        seg = text[start:end].strip()
        if seg:
            segments.append(seg)
        start = end
    return segments


def parse_wav(wav_bytes: bytes) -> tuple:
    if len(wav_bytes) < 44:
        raise ValueError("WAV too short")
    if wav_bytes[:4] != b"RIFF" or wav_bytes[8:12] != b"WAVE":
        raise ValueError("Invalid WAV header")
    sr, ch, data_offset, data_size = 16000, 1, None, 0
    offset = 12
    while offset + 8 <= len(wav_bytes):
        chunk_id = wav_bytes[offset : offset + 4].decode("ascii", errors="ignore")
        chunk_size = struct.unpack_from("<I", wav_bytes, offset + 4)[0]
        if chunk_id == "fmt " and chunk_size >= 16:
            ch = struct.unpack_from("<H", wav_bytes, offset + 10)[0]
            sr = struct.unpack_from("<I", wav_bytes, offset + 12)[0]
        elif chunk_id == "data":
            data_offset = offset + 8
            data_size = chunk_size
            break
        offset += 8 + chunk_size
    if data_offset is None:
        raise ValueError("WAV: no data chunk")
    pcm = wav_bytes[data_offset : data_offset + data_size]
    return sr, ch, pcm


def resample_pcm16(pcm16: bytes, orig_sr: int, target_sr: int) -> bytes:
    if orig_sr == target_sr:
        return pcm16
    n = len(pcm16) // 2
    samples = np.frombuffer(pcm16, dtype=np.int16)
    if n != len(samples):
        samples = samples[:n]
    new_len = int(round(len(samples) * target_sr / orig_sr))
    indices = np.linspace(0, len(samples) - 1, new_len, dtype=np.float64)
    resampled = np.interp(indices, np.arange(len(samples)), samples.astype(np.float64))
    return resampled.astype(np.int16).tobytes()


def write_wav(path: Path, pcm16: bytes, sample_rate: int, channels: int = 1):
    size = len(pcm16)
    header = bytearray(44)
    header[0:4] = b"RIFF"
    struct.pack_into("<I", header, 4, 36 + size)
    header[8:12] = b"WAVE"
    header[12:16] = b"fmt "
    struct.pack_into("<I", header, 16, 16)
    struct.pack_into("<H", header, 20, 1)
    struct.pack_into("<H", header, 22, channels)
    struct.pack_into("<I", header, 24, sample_rate)
    struct.pack_into("<I", header, 28, sample_rate * channels * 2)
    struct.pack_into("<H", header, 32, channels * 2)
    struct.pack_into("<H", header, 34, 16)
    header[36:40] = b"data"
    struct.pack_into("<I", header, 40, size)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(bytes(header) + pcm16)


def tts_local(text: str) -> bytes:
    try:
        import pyttsx3
    except ImportError:
        raise RuntimeError("请安装 pyttsx3: pip install pyttsx3")
    import tempfile
    engine = pyttsx3.init()
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        tmp = f.name
    try:
        engine.save_to_file(text, tmp)
        engine.runAndWait()
        with open(tmp, "rb") as f:
            return f.read()
    finally:
        try:
            Path(tmp).unlink(missing_ok=True)
        except Exception:
            pass


def tts_piper(text: str, voice: str, tts_url: str) -> bytes:
    try:
        import requests
    except ImportError:
        raise RuntimeError("请安装 requests: pip install requests")
    r = requests.post(
        f"{tts_url.rstrip('/')}/tts",
        json={"text": text, "voice": voice},
        timeout=120,
    )
    r.raise_for_status()
    return r.content


def main():
    ap = argparse.ArgumentParser(description="中文 TTS -> 16kHz WAV（语音识别稳定性测试原文），默认多段约10秒/段")
    ap.add_argument("--out-dir", default=OUT_DIR_DEFAULT, help="输出目录")
    ap.add_argument("--out-name", default="zh_stability.wav", help="单段模式下的输出文件名")
    ap.add_argument("--single", action="store_true", help="只生成一整段 WAV（不按段切分）")
    ap.add_argument("--chars-per-segment", type=int, default=CHARS_PER_SEGMENT_DEFAULT, help="多段模式下每段约多少字（约10秒）")
    ap.add_argument("--local-tts", action="store_true", help="使用本机 TTS（pyttsx3），不连接 Piper")
    ap.add_argument("--tts-url", default=TTS_URL_DEFAULT, help="Piper TTS URL（非 --local-tts 时使用）")
    ap.add_argument("--voice", default="zh_CN-huayan-medium", help="Piper 中文音色（非 --local-tts 时使用）")
    args = ap.parse_args()
    out_dir = Path(args.out_dir)
    text = ZH_TEXT.strip()

    if args.single:
        print("中文 TTS 生成（单段，语音识别稳定性测试原文）")
        print(f"  原文长度: {len(text)} 字")
        if args.local_tts:
            print("  使用本机 TTS (pyttsx3)...")
            wav_bytes = tts_local(text)
        else:
            print(f"  使用 Piper TTS: {args.tts_url} voice={args.voice}")
            wav_bytes = tts_piper(text, args.voice, args.tts_url)
        sr, ch, pcm = parse_wav(wav_bytes)
        if sr != TARGET_SR:
            pcm = resample_pcm16(pcm, sr, TARGET_SR)
            sr = TARGET_SR
        out_path = out_dir / args.out_name
        write_wav(out_path, pcm, sr, ch)
        print(f"  已保存: {out_path}")
        print("\n中文 ASR 测试示例:")
        print(f'  node tests/run-mock-asr-pipeline.js --wav "{out_path}"')
        return 0

    # 多段模式：约 10 秒/段，模拟生产环境
    segments = split_zh_into_segments(text, args.chars_per_segment)
    print("中文 TTS 生成（多段，约 10 秒/段，模拟生产环境）")
    print(f"  原文长度: {len(text)} 字")
    print(f"  每段约 {args.chars_per_segment} 字，共 {len(segments)} 段")
    if args.local_tts:
        print("  使用本机 TTS (pyttsx3)...")
    else:
        print(f"  使用 Piper TTS: {args.tts_url} voice={args.voice}")

    paths = []
    for i, seg in enumerate(segments, start=1):
        print(f"  合成第 {i}/{len(segments)} 段 ({len(seg)} 字)...")
        if args.local_tts:
            wav_bytes = tts_local(seg)
        else:
            wav_bytes = tts_piper(seg, args.voice, args.tts_url)
        sr, ch, pcm = parse_wav(wav_bytes)
        if sr != TARGET_SR:
            pcm = resample_pcm16(pcm, sr, TARGET_SR)
            sr = TARGET_SR
        name = f"zh_tts_{i}.wav"
        out_path = out_dir / name
        write_wav(out_path, pcm, sr, ch)
        paths.append(str(out_path))
        print(f"    已保存: {out_path}")

    print("\n生成的文件:")
    for p in paths:
        print(f"  {p}")
    print("\n中文 ASR 测试示例（逐段）:")
    print(f'  node tests/run-mock-asr-pipeline.js --wav "{paths[0]}"')
    print("  或对 zh_tts_2.wav … 依次执行上述命令。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
