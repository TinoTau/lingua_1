#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
使用 NMT（中→英）与 Piper TTS 将给定中文文本生成多段约 10 秒的英语 WAV，
保存到指定目录，格式与 english.wav 一致（16kHz, 单声道, 16-bit PCM）。
用于英语 CTC ASR 稳定性测试。

依赖：requests, numpy。若 TTS 输出非 16kHz 则用 numpy 重采样。
使用 --local-tts 时需 pyttsx3（pip install pyttsx3），不依赖 Piper 服务。
前置条件：不用 --local-tts 时，NMT（5008）与 Piper TTS（5009）需已启动（节点「服务管理」中启动 Piper TTS）。
用法：
  python gen_en_tts_wavs.py --out-dir D:/Programs/github/lingua_1/expired
  python gen_en_tts_wavs.py --no-nmt --out-dir D:/path/expired   # 跳过 NMT，用脚本内预译英文
  python gen_en_tts_wavs.py --no-nmt --local-tts --out-dir D:/path/expired   # 不用 Piper，用本机 TTS 生成（如 Windows SAPI）
  python gen_en_tts_wavs.py --nmt-url http://127.0.0.1:5008 --tts-url http://127.0.0.1:5009 --out-dir D:/path/expired
"""
import argparse
import struct
import sys
from pathlib import Path

try:
    import requests
except ImportError:
    print("请安装 requests: pip install requests", file=sys.stderr)
    sys.exit(1)
try:
    import numpy as np
except ImportError:
    print("请安装 numpy: pip install numpy", file=sys.stderr)
    sys.exit(1)

# 默认中文原文（语音识别稳定性测试说明）
ZH_TEXT = """
现在我们开始进行一次语音识别稳定性测试。
我会先读一两句比较短的话，用来确认系统不会在句子之间随意地把语音切断，或者在没有必要的时候提前结束本次识别。

接下来这一句我会尽量连续地说得长一些，中间只保留自然的呼吸节奏，不做刻意的停顿，看看在超过十秒钟之后，系统会不会因为超时或者静音判定而强行把这句话截断，从而导致前半句和后半句在节点端被拆成两个不同的 job，甚至出现语义上不完整、读起来前后不连贯的情况。

如果这次的长句能够被完整地识别出来，而且不会出现半句话被提前发送或者直接丢失的现象，那就说明我们当前的切分策略和超时规则是基本可用的。
否则，我们还需要继续分析日志，找出到底是在哪一个环节把我的语音吃掉了。
"""

# 预译英文（当 NMT 不可用或超时时使用 --no-nmt）
EN_TEXT_FALLBACK = """
Now we are going to do a speech recognition stability test.
I will first read one or two short sentences to confirm that the system does not cut off the speech arbitrarily between sentences, or end this recognition prematurely when it is not necessary.

Next I will try to speak this sentence as continuously as possible, with only natural breathing rhythm in between and no deliberate pauses, to see whether after more than ten seconds the system will force this sentence to be cut off due to timeout or silence detection, so that the first half and the second half are split into two different jobs on the node side, or even result in semantically incomplete or incoherent output.

If this long sentence can be fully recognized and there is no phenomenon of half a sentence being sent in advance or lost, then our current segmentation strategy and timeout rules are basically usable.
Otherwise we still need to analyze the logs and find out exactly at which step my speech was dropped.
"""

NMT_URL_DEFAULT = "http://127.0.0.1:5008"
TTS_URL_DEFAULT = "http://127.0.0.1:5009"
OUT_DIR_DEFAULT = "D:/Programs/github/lingua_1/expired"
TARGET_SR = 16000
# 约 10 秒/段：英文约 2.2 词/秒，取 ~22–28 词/段
TARGET_WORDS_PER_SEGMENT = 26


def translate_zh_to_en(text: str, nmt_url: str) -> str:
    r = requests.post(
        f"{nmt_url.rstrip('/')}/v1/translate",
        json={
            "src_lang": "zh",
            "tgt_lang": "en",
            "text": text.strip(),
            "context_text": text.strip(),
        },
        timeout=60,
    )
    r.raise_for_status()
    data = r.json()
    out = (data.get("text") or data.get("translated") or "").strip()
    if not out:
        raise RuntimeError("NMT returned empty translation")
    return out


def get_tts_voice(tts_url: str) -> str:
    r = requests.get(f"{tts_url.rstrip('/')}/voices", timeout=10)
    r.raise_for_status()
    voices = r.json().get("voices") or []
    for v in voices:
        name = (v.get("name") or v.get("path") or "").strip()
        if name.startswith("en_") or "en-" in name.lower():
            return name
    if voices:
        return (voices[0].get("name") or voices[0].get("path") or "default").strip()
    raise RuntimeError("No TTS voice found; ensure Piper has at least one model (e.g. en_US)")


def split_into_segments(en_text: str, words_per_segment: int = TARGET_WORDS_PER_SEGMENT) -> list[str]:
    words = en_text.split()
    segments = []
    current = []
    count = 0
    for w in words:
        current.append(w)
        count += 1
        if count >= words_per_segment:
            segments.append(" ".join(current))
            current = []
            count = 0
    if current:
        segments.append(" ".join(current))
    return segments


def parse_wav(wav_bytes: bytes) -> tuple[int, int, bytes]:
    """Returns (sample_rate, channels, pcm16_bytes)."""
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
    # RIFF header: 44 bytes for standard PCM
    header = bytearray(44)
    header[0:4] = b"RIFF"
    struct.pack_into("<I", header, 4, 36 + size)
    header[8:12] = b"WAVE"
    header[12:16] = b"fmt "
    struct.pack_into("<I", header, 16, 16)
    struct.pack_into("<H", header, 20, 1)  # PCM
    struct.pack_into("<H", header, 22, channels)
    struct.pack_into("<I", header, 24, sample_rate)
    struct.pack_into("<I", header, 28, sample_rate * channels * 2)
    struct.pack_into("<H", header, 32, channels * 2)
    struct.pack_into("<H", header, 34, 16)
    header[36:40] = b"data"
    struct.pack_into("<I", header, 40, size)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(bytes(header) + pcm16)


def tts_synthesize(text: str, voice: str, tts_url: str) -> bytes:
    r = requests.post(
        f"{tts_url.rstrip('/')}/tts",
        json={"text": text, "voice": voice},
        timeout=120,
    )
    r.raise_for_status()
    return r.content


def tts_synthesize_local(text: str) -> bytes:
    """使用本机 TTS（pyttsx3，Windows 上为 SAPI）合成，返回 WAV 字节。内部采样率可能为 22050 等，调用方需重采样到 16kHz。"""
    try:
        import pyttsx3
    except ImportError:
        raise RuntimeError("请安装 pyttsx3: pip install pyttsx3")
    import tempfile
    import io
    engine = pyttsx3.init()
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        tmp = f.name
    try:
        engine.save_to_file(text, tmp)
        engine.runAndWait()
        with open(tmp, "rb") as f:
            out = f.read()
        return out
    finally:
        try:
            Path(tmp).unlink(missing_ok=True)
        except Exception:
            pass


def main():
    ap = argparse.ArgumentParser(description="NMT(zh->en) + TTS -> 多段英文 WAV (16kHz)")
    ap.add_argument("--nmt-url", default=NMT_URL_DEFAULT, help="NMT 服务 URL")
    ap.add_argument("--tts-url", default=TTS_URL_DEFAULT, help="Piper TTS 服务 URL")
    ap.add_argument("--out-dir", default=OUT_DIR_DEFAULT, help="输出目录")
    ap.add_argument("--words-per-segment", type=int, default=TARGET_WORDS_PER_SEGMENT)
    ap.add_argument("--no-nmt", action="store_true", help="跳过 NMT，使用脚本内预译英文（NMT 未启动或超时时用）")
    ap.add_argument("--local-tts", action="store_true", help="使用本机 TTS（pyttsx3），不连接 Piper；适合节点未启动 Piper 时生成测试 WAV")
    ap.add_argument("--voice", type=str, default=None, help="指定 TTS 音色名，跳过 /voices 查询（如 en_US-lessac-medium）；--local-tts 时忽略")
    args = ap.parse_args()
    out_dir = Path(args.out_dir)

    if args.no_nmt:
        print("Step 1: 使用预译英文（--no-nmt）...")
        en_text = EN_TEXT_FALLBACK.strip()
        print(f"  长度: {len(en_text)} 字符")
    else:
        print("Step 1: 调用 NMT 将中文译为英文...")
        try:
            en_text = translate_zh_to_en(ZH_TEXT.strip(), args.nmt_url)
        except Exception as e:
            print(f"  NMT 失败: {e}")
            print("  使用 --no-nmt 可跳过 NMT，用脚本内预译英文继续。")
            return 1
        print(f"  译文长度: {len(en_text)} 字符")
    print(f"  前 200 字: {en_text[:200]}...")

    print("\nStep 2: 按约 10 秒/段切分英文...")
    segments = split_into_segments(en_text, args.words_per_segment)
    print(f"  共 {len(segments)} 段")

    use_local_tts = args.local_tts
    if use_local_tts:
        print("\nStep 3: 使用本机 TTS（pyttsx3）...")
        voice = None
    else:
        print("\nStep 3: 获取 TTS 英文音色...")
        if args.voice:
            voice = args.voice
            print(f"  使用指定音色: {voice}")
        else:
            try:
                voice = get_tts_voice(args.tts_url)
                print(f"  使用音色: {voice}")
            except requests.exceptions.ConnectionError as e:
                print(f"  连接 TTS 失败: {e}")
                print("  请确认：1) 节点已启动；2) 在节点「服务管理」中已启动「Piper TTS」；3) 或使用 --tts-url 指定正确地址；4) 或使用 --local-tts 用本机 TTS 生成。")
                return 1

    print("\nStep 4: 逐段 TTS 并保存为 16kHz WAV...")
    paths = []
    for i, seg in enumerate(segments, start=1):
        print(f"  合成第 {i}/{len(segments)} 段 ({len(seg.split())} 词)...")
        if use_local_tts:
            wav_bytes = tts_synthesize_local(seg)
        else:
            wav_bytes = tts_synthesize(seg, voice, args.tts_url)
        sr, ch, pcm = parse_wav(wav_bytes)
        if sr != TARGET_SR:
            pcm = resample_pcm16(pcm, sr, TARGET_SR)
            sr = TARGET_SR
        name = f"en_tts_{i}.wav"
        path = out_dir / name
        write_wav(path, pcm, sr, ch)
        paths.append(str(path))
        print(f"    已保存: {path}")

    print("\n完成。生成的文件：")
    for p in paths:
        print(f"  {p}")
    print("\n测试英语 CTC 示例：")
    print(f'  node tests/run-mock-asr-pipeline.js --wav "{paths[0]}" --en')
    print(f"  或对每个文件依次执行上述命令（将 paths[0] 换为 paths[1], paths[2], ...）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
