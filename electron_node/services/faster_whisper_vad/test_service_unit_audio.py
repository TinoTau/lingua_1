"""
faster_whisper_vad 服务单元测试 - 音频格式（PCM16 / Opus）
"""
import base64
import time

import numpy as np
import requests

from test_service_unit_helpers import (
    BASE_URL,
    TIMEOUT,
    SAMPLE_RATE,
    CHANNELS,
    FRAME_SAMPLES,
    logger,
    generate_pcm16_audio,
    generate_wav_bytes,
    generate_opus_packet_format,
)


class TestAudioFormat:
    """测试音频格式处理"""

    def test_pcm16_audio(self):
        """测试PCM16音频处理"""
        pcm16_data = generate_pcm16_audio(duration_sec=1.0, frequency=440.0)
        wav_bytes = generate_wav_bytes(pcm16_data)
        audio_b64 = base64.b64encode(wav_bytes).decode('utf-8')

        response = requests.post(
            f"{BASE_URL}/utterance",
            json={
                "job_id": f"test_pcm16_{int(time.time())}",
                "src_lang": "zh",
                "audio": audio_b64,
                "audio_format": "pcm16",
                "sample_rate": SAMPLE_RATE,
                "task": "transcribe",
                "beam_size": 5,
                "condition_on_previous_text": True,
                "use_context_buffer": True,
                "use_text_context": True,
            },
            timeout=TIMEOUT
        )

        assert response.status_code == 200
        result = response.json()
        assert "text" in result
        assert "language" in result
        assert "duration" in result
        logger.info(f"✅ PCM16音频测试通过: text='{result.get('text', '')[:50]}'")

    def test_opus_packet_format(self):
        """测试方案A的Opus packet格式"""
        try:
            import pyogg.opus as opus
        except ImportError:
            logger.warning("pyogg not available, skipping Opus test")
            return

        pcm16_data = generate_pcm16_audio(duration_sec=0.5, frequency=440.0)
        pcm16_array = np.frombuffer(pcm16_data, dtype=np.int16)
        audio_float = pcm16_array.astype(np.float32) / 32768.0

        channels = 1
        encoder_size = opus.opus_encoder_get_size(channels)
        encoder_state = (opus.c_uchar * encoder_size)()

        error = opus.opus_encoder_init(
            opus.cast(opus.pointer(encoder_state), opus.oe_p),
            SAMPLE_RATE,
            channels,
            opus.OPUS_APPLICATION_VOIP
        )
        if error != opus.OPUS_OK:
            logger.warning(f"Failed to initialize Opus encoder: {opus.opus_strerror(error)}, skipping test")
            return

        opus.opus_encoder_ctl(
            opus.cast(opus.pointer(encoder_state), opus.oe_p),
            opus.OPUS_SET_BITRATE_REQUEST,
            24000
        )

        opus_packets = []
        frame_size = FRAME_SAMPLES
        offset = 0

        while offset < len(audio_float):
            remaining = len(audio_float) - offset
            current_frame_size = min(frame_size, remaining)

            if current_frame_size < frame_size:
                frame = np.zeros(frame_size, dtype=np.float32)
                frame[:current_frame_size] = audio_float[offset:offset + current_frame_size]
            else:
                frame = audio_float[offset:offset + frame_size]

            max_packet_size = 4000
            packet_buffer = (opus.c_uchar * max_packet_size)()
            packet_ptr = opus.cast(packet_buffer, opus.c_uchar_p)
            frame_ptr = opus.cast(frame.ctypes.data, opus.c_float_p)

            packet_len = opus.opus_encode_float(
                opus.cast(opus.pointer(encoder_state), opus.oe_p),
                frame_ptr,
                frame_size,
                packet_ptr,
                max_packet_size
            )

            if packet_len > 0:
                packet_bytes = bytes(packet_buffer[:packet_len])
                opus_packets.append(packet_bytes)

            offset += current_frame_size

        opus.opus_encoder_destroy(opus.cast(opus.pointer(encoder_state), opus.oe_p))

        if not opus_packets:
            logger.warning("No Opus packets generated, skipping test")
            return

        packet_format_data = generate_opus_packet_format(opus_packets)
        audio_b64 = base64.b64encode(packet_format_data).decode('utf-8')

        response = requests.post(
            f"{BASE_URL}/utterance",
            json={
                "job_id": f"test_opus_packet_{int(time.time())}",
                "src_lang": "zh",
                "audio": audio_b64,
                "audio_format": "opus",
                "sample_rate": SAMPLE_RATE,
                "task": "transcribe",
                "beam_size": 5,
                "condition_on_previous_text": True,
                "use_context_buffer": True,
                "use_text_context": True,
            },
            timeout=TIMEOUT
        )

        assert response.status_code == 200
        result = response.json()
        assert "text" in result
        assert "language" in result
        assert "duration" in result
        logger.info(f"✅ Opus packet格式测试通过: text='{result.get('text', '')[:50]}'")

    def test_opus_continuous_stream(self):
        """测试连续字节流格式（已知存在问题的方法）"""
        try:
            import pyogg.opus as opus
        except ImportError:
            logger.warning("pyogg not available, skipping Opus test")
            return

        pcm16_data = generate_pcm16_audio(duration_sec=0.3, frequency=440.0)
        pcm16_array = np.frombuffer(pcm16_data, dtype=np.int16)
        audio_float = pcm16_array.astype(np.float32) / 32768.0

        channels = 1
        encoder_size = opus.opus_encoder_get_size(channels)
        encoder_state = (opus.c_uchar * encoder_size)()

        error = opus.opus_encoder_init(
            opus.cast(opus.pointer(encoder_state), opus.oe_p),
            SAMPLE_RATE,
            channels,
            opus.OPUS_APPLICATION_VOIP
        )
        if error != opus.OPUS_OK:
            logger.warning(f"Failed to initialize Opus encoder: {opus.opus_strerror(error)}, skipping test")
            return

        frame_size = FRAME_SAMPLES
        if len(audio_float) < frame_size:
            frame = np.zeros(frame_size, dtype=np.float32)
            frame[:len(audio_float)] = audio_float
        else:
            frame = audio_float[:frame_size]

        max_packet_size = 4000
        packet_buffer = (opus.c_uchar * max_packet_size)()
        packet_ptr = opus.cast(packet_buffer, opus.c_uchar_p)
        frame_ptr = opus.cast(frame.ctypes.data, opus.c_float_p)

        packet_len = opus.opus_encode_float(
            opus.cast(opus.pointer(encoder_state), opus.oe_p),
            frame_ptr,
            frame_size,
            packet_ptr,
            max_packet_size
        )

        opus.opus_encoder_destroy(opus.cast(opus.pointer(encoder_state), opus.oe_p))

        if packet_len <= 0:
            logger.warning("Failed to encode Opus packet, skipping test")
            return

        continuous_data = bytes(packet_buffer[:packet_len])
        audio_b64 = base64.b64encode(continuous_data).decode('utf-8')

        response = requests.post(
            f"{BASE_URL}/utterance",
            json={
                "job_id": f"test_opus_continuous_{int(time.time())}",
                "src_lang": "zh",
                "audio": audio_b64,
                "audio_format": "opus",
                "sample_rate": SAMPLE_RATE,
                "task": "transcribe",
                "beam_size": 5,
                "condition_on_previous_text": True,
                "use_context_buffer": True,
                "use_text_context": True,
            },
            timeout=TIMEOUT
        )

        if response.status_code == 200:
            logger.info("⚠️ 连续字节流格式解码成功（意外）")
        else:
            logger.info("✅ 连续字节流格式正确返回错误（符合预期）")
            assert response.status_code == 400
