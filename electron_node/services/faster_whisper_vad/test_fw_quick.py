"""快速功能测试：FW /health 与 /utterance，打印模型、耗时、识别结果。"""
import base64
import json
import time
import urllib.request

BASE = "http://127.0.0.1:6007"

def main():
    # 1. Health
    print("=== GET /health ===")
    try:
        r = urllib.request.urlopen(f"{BASE}/health", timeout=10)
        health = json.loads(r.read().decode())
        print(json.dumps(health, indent=2, ensure_ascii=False))
        model = health.get("asr_model_path", "(未返回，需重启 FW 后可见)")
        print(f"\n模型: {model}")
        print(f"设备: {health.get('device')}, compute_type: {health.get('compute_type')}")
    except Exception as e:
        print("Health 失败:", e)
        return

    # 2. Utterance: 1 秒 16kHz 单声道 PCM16 静音 → base64
    pcm_len = 16000 * 2  # 1s
    pcm = b"\x00\x00" * (pcm_len // 2)
    audio_b64 = base64.b64encode(pcm).decode("utf-8")

    payload = {
        "job_id": "test_fw_quick_1",
        "src_lang": "zh",
        "audio": audio_b64,
        "audio_format": "pcm16",
        "sample_rate": 16000,
        "task": "transcribe",
        "beam_size": 5,
        "condition_on_previous_text": False,
        "use_context_buffer": False,
        "use_text_context": False,
        "trace_id": "test_fw_quick_1",
    }
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"{BASE}/utterance",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    print("\n=== POST /utterance (1s 静音 PCM16 16kHz) ===")
    t0 = time.perf_counter()
    try:
        r = urllib.request.urlopen(req, timeout=60)
        elapsed = time.perf_counter() - t0
        data = json.loads(r.read().decode())
        print(f"耗时: {elapsed:.2f}s")
        print(f"识别文本: {data.get('text', '')!r}")
        print(f"检测语言: {data.get('language', 'N/A')}")
        print(f"音频时长: {data.get('duration', 0):.2f}s")
        print(f"分段数: {len(data.get('segments', []))}")
        if data.get("segments"):
            for i, seg in enumerate(data["segments"][:5]):
                print(f"  段{i}: {seg.get('text', '')!r} (start={seg.get('start', 0):.2f})")
    except Exception as e:
        elapsed = time.perf_counter() - t0
        print(f"请求失败 (已耗时 {elapsed:.2f}s):", e)


if __name__ == "__main__":
    main()
