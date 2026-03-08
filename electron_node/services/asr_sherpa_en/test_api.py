"""ASR Sherpa English CTC API 契约单元测试（FastAPI TestClient，无需启动服务）"""
import base64
import pytest
from fastapi.testclient import TestClient

from service_main import app
from test_helpers import generate_pcm16_base64, SAMPLE_RATE

client = TestClient(app)


def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "ok"
    assert "model_loaded" in data


def test_utterance_contract():
    audio_b64 = generate_pcm16_base64(duration_sec=0.3)
    r = client.post(
        "/utterance",
        json={
            "job_id": "test-1",
            "src_lang": "en",
            "audio": audio_b64,
            "audio_format": "pcm16",
            "sample_rate": SAMPLE_RATE,
        },
    )
    assert r.status_code == 200
    result = r.json()
    assert "text" in result
    assert "segments" in result
    assert "duration" in result
    assert "vad_segments" in result
    assert "meta" in result
    assert "decode_ms" in result["meta"]
    assert "nbest" in result
    assert isinstance(result["nbest"], list)
    assert result["duration"] == pytest.approx(0.3, rel=1e-4)


def test_utterance_segment_shape():
    audio_b64 = generate_pcm16_base64(duration_sec=0.2)
    r = client.post(
        "/utterance",
        json={
            "job_id": "test-2",
            "src_lang": "en",
            "audio": audio_b64,
            "sample_rate": SAMPLE_RATE,
        },
    )
    assert r.status_code == 200
    result = r.json()
    assert result["duration"] > 0
    assert len(result["segments"]) >= 1
    seg = result["segments"][0]
    assert "text" in seg
    assert "start" in seg
    assert "end" in seg
    assert seg["start"] == 0.0
    assert seg["end"] == pytest.approx(result["duration"], rel=1e-4)


def test_utterance_reject_non_pcm16():
    r = client.post(
        "/utterance",
        json={
            "job_id": "test-3",
            "src_lang": "en",
            "audio": "dGVzdA==",
            "audio_format": "opus",
            "sample_rate": SAMPLE_RATE,
        },
    )
    assert r.status_code == 400
    assert "pcm16" in (r.json().get("detail") or "").lower()


def test_utterance_invalid_audio_400():
    raw = b"\x00\x00\x00"
    b64 = base64.b64encode(raw).decode("utf-8")
    r = client.post(
        "/utterance",
        json={
            "job_id": "test-4",
            "src_lang": "en",
            "audio": b64,
            "audio_format": "pcm16",
            "sample_rate": SAMPLE_RATE,
        },
    )
    assert r.status_code == 400
