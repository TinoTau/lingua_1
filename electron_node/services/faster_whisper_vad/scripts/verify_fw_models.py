#!/usr/bin/env python3
"""启动 FW 服务并校验 ASR_MODEL 配置（large-v3 / medium）。"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parents[1]
PORT = int(os.getenv("FASTER_WHISPER_VAD_PORT", "6007"))
PYTHON = SERVICE_ROOT / ".venv" / "Scripts" / "python.exe"
SERVICE_SCRIPT = SERVICE_ROOT / "faster_whisper_vad_service.py"
DEFAULT_CUDA_PATH = r"C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v11.8"
HEALTH_TIMEOUT_SEC = int(os.getenv("FW_HEALTH_TIMEOUT_SEC", "300"))

PRESETS = {
    "large-v3": SERVICE_ROOT / "models" / "faster-whisper-large-v3",
    "medium": SERVICE_ROOT / "models" / "faster-whisper-medium",
}


def wait_health(timeout_sec: int = HEALTH_TIMEOUT_SEC) -> dict:
    url = f"http://127.0.0.1:{PORT}/health"
    deadline = time.time() + timeout_sec
    last_err = ""
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=5) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as exc:  # noqa: BLE001
            last_err = str(exc)
            time.sleep(2)
    raise RuntimeError(f"health timeout: {last_err}")


def verify_preset(name: str) -> dict:
    model_dir = PRESETS[name]
    if not (model_dir / "model.bin").is_file():
        raise FileNotFoundError(f"missing model.bin: {model_dir}")

    env = os.environ.copy()
    env["ASR_MODEL"] = name
    env.pop("ASR_MODEL_PATH", None)
    env["FASTER_WHISPER_VAD_PORT"] = str(PORT)
    env.setdefault("CUDA_PATH", DEFAULT_CUDA_PATH)
    env.setdefault("PYTHONIOENCODING", "utf-8")

    proc = subprocess.Popen(
        [str(PYTHON), str(SERVICE_SCRIPT)],
        cwd=str(SERVICE_ROOT),
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        health = wait_health()
        expected = str(model_dir.resolve())
        actual = health.get("asr_model_path", "")
        ok = os.path.normcase(actual) == os.path.normcase(expected)
        return {
            "preset": name,
            "ok": ok,
            "expected": expected,
            "actual": actual,
            "health": health,
        }
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=15)
        except subprocess.TimeoutExpired:
            proc.kill()


def main() -> int:
    if not PYTHON.is_file():
        print("缺少 .venv，请先 pip install -r requirements.txt", file=sys.stderr)
        return 1

    results = []
    for preset in ("large-v3", "medium"):
        print(f"=== 验证 ASR_MODEL={preset} ===")
        row = verify_preset(preset)
        results.append(row)
        print(json.dumps(row, ensure_ascii=False, indent=2))
        if not row["ok"]:
            return 1
        print(f"PASS: {preset}\n")

    print("全部模型配置校验通过")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
