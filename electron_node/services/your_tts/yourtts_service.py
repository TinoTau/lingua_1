#!/usr/bin/env python3
"""
YourTTS HTTP 服务（Zero-shot TTS）

用于从 Rust 代码调用 YourTTS 模型进行语音合成，支持音色克隆。

使用方法：
    python yourtts_service.py [--gpu] [--port PORT] [--host HOST]

API 端点：
    POST /synthesize
    POST /register_speaker
    GET  /health
"""

import sys
import os
import argparse
import tempfile
import threading
from pathlib import Path

if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

script_dir = Path(__file__).parent
project_root = script_dir.parent.parent
sys.path.insert(0, str(project_root))

import numpy as np
from scipy import signal
import soundfile as sf
from flask import Flask, request, jsonify

from yourtts_model import get_device, load_model
from yourtts_synthesis import do_synthesize

app = Flask(__name__)
tts_model = None
device = None

speaker_cache = {}
speaker_cache_lock = threading.Lock()


@app.errorhandler(Exception)
def handle_exception(e):
    """Handle all unhandled exceptions"""
    print(f"[ERROR] Unhandled exception in Flask app: {e}")
    import traceback
    traceback.print_exc()
    return jsonify({"error": str(e)}), 500


@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    with speaker_cache_lock:
        cache_size = len(speaker_cache)
    return jsonify({
        "status": "ok",
        "model_loaded": tts_model is not None,
        "device": device,
        "cached_speakers": cache_size
    }), 200


@app.route('/register_speaker', methods=['POST'])
def register_speaker():
    """注册说话者（异步接收 reference_audio）"""
    try:
        data = request.json
        if data is None:
            return jsonify({"error": "Invalid JSON"}), 400

        speaker_id = data.get('speaker_id')
        if not speaker_id:
            return jsonify({"error": "Missing 'speaker_id' field"}), 400

        reference_audio = data.get('reference_audio')
        if not reference_audio:
            return jsonify({"error": "Missing 'reference_audio' field"}), 400

        reference_sample_rate = data.get('reference_sample_rate', 16000)
        voice_embedding = data.get('voice_embedding')

        ref_audio_array = np.array(reference_audio, dtype=np.float32)

        target_sample_rate = 22050
        if reference_sample_rate != target_sample_rate:
            num_samples = int(len(ref_audio_array) * target_sample_rate / reference_sample_rate)
            ref_audio_array = signal.resample(ref_audio_array, num_samples)
            print(f"[YourTTS Service] Resampled reference audio from {reference_sample_rate} Hz to {target_sample_rate} Hz for speaker {speaker_id}")

        embedding_array = None
        if voice_embedding:
            embedding_array = np.array(voice_embedding, dtype=np.float32)

        with speaker_cache_lock:
            speaker_cache[speaker_id] = {
                "reference_audio": ref_audio_array,
                "sample_rate": target_sample_rate,
                "voice_embedding": embedding_array
            }
            cache_size = len(speaker_cache)

        print(f"[YourTTS Service] [INFO] Registered speaker '{speaker_id}' (reference_audio: {len(ref_audio_array)} samples @ {target_sample_rate} Hz, cache size: {cache_size})")

        return jsonify({
            "status": "ok",
            "speaker_id": speaker_id,
            "message": "Speaker registered successfully",
            "cache_size": cache_size
        })

    except Exception as e:
        print(f"[YourTTS Service] [ERROR] Failed to register speaker: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@app.route('/synthesize', methods=['POST'])
def synthesize():
    """语音合成（支持 zero-shot）"""
    try:
        data = request.json
        if data is None:
            return jsonify({"error": "Invalid JSON"}), 400

        if 'text' not in data:
            return jsonify({"error": "Missing 'text' field"}), 400

        text = data['text']
        speaker_id = data.get('speaker_id')
        reference_audio = data.get('reference_audio')
        reference_sample_rate = data.get('reference_sample_rate', 16000)
        speaker = data.get('speaker')
        language = data.get('language', 'en')

        if not text or len(text.strip()) == 0:
            return jsonify({"error": "Empty text"}), 400

        if tts_model is None:
            return jsonify({"error": "Model not loaded"}), 500

        cached_ref_audio = None
        cached_sample_rate = None
        if speaker_id:
            with speaker_cache_lock:
                cached_entry = speaker_cache.get(speaker_id)
                if cached_entry:
                    cached_ref_audio = cached_entry["reference_audio"]
                    cached_sample_rate = cached_entry["sample_rate"]
                    print(f"[YourTTS Service] [INFO] Using cached reference_audio for speaker_id '{speaker_id}'")

        use_cached = cached_ref_audio is not None
        ref_audio_to_use = cached_ref_audio if use_cached else reference_audio
        ref_sample_rate_to_use = cached_sample_rate if use_cached else reference_sample_rate

        speaker_wav = None
        try:
            if ref_audio_to_use is not None:
                if use_cached:
                    ref_audio_array = ref_audio_to_use
                else:
                    ref_audio_array = np.array(ref_audio_to_use, dtype=np.float32)

                target_sample_rate = 22050
                if not use_cached and ref_sample_rate_to_use != target_sample_rate:
                    num_samples = int(len(ref_audio_array) * target_sample_rate / ref_sample_rate_to_use)
                    ref_audio_array = signal.resample(ref_audio_array, num_samples)

                tmp_file = tempfile.NamedTemporaryFile(suffix='.wav', delete=False)
                tmp_file.close()
                try:
                    sf.write(tmp_file.name, ref_audio_array, target_sample_rate)
                    speaker_wav = tmp_file.name
                except Exception as e:
                    if os.path.exists(tmp_file.name):
                        os.unlink(tmp_file.name)
                    raise

                audio_list, used_reference = do_synthesize(
                    tts_model, text, speaker_wav, speaker, language
                )
            else:
                audio_list, used_reference = do_synthesize(
                    tts_model, text, None, speaker, language
                )

            return jsonify({
                "audio": audio_list,
                "sample_rate": 22050,
                "text": text,
                "used_reference": used_reference,
                "speaker_applied": used_reference
            })
        finally:
            if speaker_wav and os.path.exists(speaker_wav):
                try:
                    os.unlink(speaker_wav)
                except Exception as e:
                    print(f"Warning: Failed to delete temp file {speaker_wav}: {e}")

    except Exception as e:
        import traceback
        error_msg = str(e)
        traceback.print_exc()
        return jsonify({
            "error": error_msg,
            "type": type(e).__name__
        }), 500


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="YourTTS HTTP Service")
    parser.add_argument('--gpu', action='store_true', help='Use GPU if available')
    parser.add_argument('--port', type=int, default=5004, help='Server port (default: 5004)')
    parser.add_argument('--host', type=str, default='127.0.0.1', help='Server host (default: 127.0.0.1)')
    parser.add_argument('--model-dir', type=str, help='Model directory path')
    args = parser.parse_args()

    print("=" * 60)
    print("  YourTTS HTTP Service (Zero-shot TTS)")
    print("=" * 60)

    if args.model_dir:
        model_path = Path(args.model_dir)
    else:
        model_path = script_dir / "models" / "your_tts"
        if not model_path.exists():
            model_path = project_root / "node-inference" / "models" / "tts" / "your_tts"
        if not model_path.exists():
            model_path = project_root / "model-hub" / "models" / "tts" / "your_tts"

    if not model_path.exists():
        print(f"[ERROR] Model path not found: {model_path}")
        print("")
        print("Please download models from the model hub first:")
        print("  1. Start the model hub service: .\\scripts\\start_model_hub.ps1")
        print("  2. Download YourTTS models through the model hub")
        print("  3. Ensure models are in: model-hub/models/tts/your_tts")
        print("")
        sys.exit(1)

    device = get_device(args.gpu)

    try:
        tts_model = load_model(model_path, device)
    except Exception as e:
        print(f"\n[ERROR] Failed to start service: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

    print(f"\n[INFO] Starting server on http://{args.host}:{args.port}")
    print("   Endpoints:")
    print("     GET  /health          - Health check")
    print("     POST /synthesize      - Synthesize speech (zero-shot supported)")
    print("     POST /register_speaker - Register speaker")
    print(f"   Device: {device}")
    print("\n   Press Ctrl+C to stop")
    print("=" * 60)

    import socket
    try:
        test_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        test_socket.settimeout(1)
        result = test_socket.connect_ex((args.host, args.port))
        test_socket.close()
        if result == 0:
            print(f"[ERROR] Port {args.port} is already in use. Please stop the process using this port.")
            sys.exit(1)
    except Exception as e:
        print(f"[WARN] Could not check port availability: {e}")

    try:
        print(f"[INFO] Flask server starting...")
        app.run(host=args.host, port=args.port, debug=False, use_reloader=False, threaded=True)
    except OSError as e:
        error_msg = str(e)
        if "Address already in use" in error_msg or "address already in use" in error_msg.lower() or "EADDRINUSE" in error_msg:
            print(f"[ERROR] Port {args.port} is already in use. Please stop the process using this port or use a different port.")
            print(f"[ERROR] Error details: {e}")
            sys.exit(1)
        else:
            print(f"[ERROR] Failed to start Flask server: {e}")
            import traceback
            traceback.print_exc()
            sys.exit(1)
    except KeyboardInterrupt:
        print("\n[INFO] Server stopped by user")
        sys.exit(0)
    except Exception as e:
        print(f"[ERROR] Unexpected error starting server: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
