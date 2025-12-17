#!/usr/bin/env python3
"""
测试调度服务器分配任务给electron node，执行任务链并返回翻译后的音频

使用方法:
    python test_translation_pipeline.py --audio chinese.wav --src-lang zh --tgt-lang en
    python test_translation_pipeline.py --audio english.wav --src-lang en --tgt-lang zh
"""

import asyncio
import base64
import json
import argparse
import sys
from pathlib import Path
from typing import Optional, Tuple
import wave

try:
    import websockets
except ImportError:
    print("错误: 请先安装 websockets 库")
    print("pip install websockets")
    sys.exit(1)


class TranslationTestClient:
    def __init__(self, scheduler_url: str = "ws://localhost:5010/ws/session"):
        self.scheduler_url = scheduler_url
        self.session_id: Optional[str] = None

    async def create_session(
        self,
        src_lang: str,
        tgt_lang: str,
        dialect: Optional[str] = None,
        features: Optional[dict] = None,
    ) -> str:
        """创建会话"""
        async with websockets.connect(self.scheduler_url) as ws:
            # 发送 session_init 消息
            init_msg = {
                "type": "session_init",
                "client_version": "1.0.0",
                "platform": "test-client",
                "src_lang": src_lang,
                "tgt_lang": tgt_lang,
            }
            if dialect:
                init_msg["dialect"] = dialect
            if features:
                init_msg["features"] = features

            await ws.send(json.dumps(init_msg))
            print(f"✓ 已发送 session_init: {src_lang} -> {tgt_lang}")

            # 等待 session_init_ack
            response = await ws.recv()
            ack = json.loads(response)
            if ack.get("type") == "session_init_ack":
                self.session_id = ack["session_id"]
                print(f"✓ 会话已创建: session_id={self.session_id}")
                print(f"  分配的节点: {ack.get('assigned_node_id', '未分配')}")
                print(f"  追踪ID: {ack.get('trace_id', '无')}")
                return self.session_id
            else:
                raise Exception(f"意外的响应: {ack}")

    def load_audio_file(self, audio_path: Path) -> Tuple[bytes, int, str]:
        """加载音频文件并返回 (音频数据, 采样率, 格式)"""
        if not audio_path.exists():
            raise FileNotFoundError(f"音频文件不存在: {audio_path}")

        # 尝试读取WAV文件
        try:
            with wave.open(str(audio_path), "rb") as wav_file:
                sample_rate = wav_file.getframerate()
                n_channels = wav_file.getnchannels()
                sampwidth = wav_file.getsampwidth()
                audio_data = wav_file.readframes(wav_file.getnframes())

                print(f"✓ 音频文件已加载: {audio_path.name}")
                print(f"  采样率: {sample_rate} Hz")
                print(f"  声道数: {n_channels}")
                print(f"  采样宽度: {sampwidth} bytes")
                print(f"  音频数据大小: {len(audio_data)} bytes")

                # 如果格式不是PCM16，需要转换（这里简化处理，假设是PCM16）
                if sampwidth == 2:
                    format_str = "pcm16"
                else:
                    format_str = "wav"  # 如果不是PCM16，保留原始格式

                return audio_data, sample_rate, format_str
        except Exception as e:
            # 如果不是WAV格式，尝试直接读取二进制
            print(f"警告: 无法作为WAV文件读取，尝试直接读取: {e}")
            with open(audio_path, "rb") as f:
                audio_data = f.read()
            # 假设16kHz PCM16（默认值）
            return audio_data, 16000, "pcm16"

    async def send_utterance(
        self,
        audio_data: bytes,
        sample_rate: int,
        audio_format: str,
        src_lang: str,
        tgt_lang: str,
        utterance_index: int = 0,
        dialect: Optional[str] = None,
        features: Optional[dict] = None,
    ) -> dict:
        """发送音频数据并等待翻译结果"""
        if not self.session_id:
            raise Exception("会话未创建，请先调用 create_session")

        async with websockets.connect(self.scheduler_url) as ws:
            # 将音频数据编码为base64
            audio_base64 = base64.b64encode(audio_data).decode("utf-8")

            # 发送 utterance 消息
            utterance_msg = {
                "type": "utterance",
                "session_id": self.session_id,
                "utterance_index": utterance_index,
                "manual_cut": False,
                "src_lang": src_lang,
                "tgt_lang": tgt_lang,
                "audio": audio_base64,
                "audio_format": audio_format,
                "sample_rate": sample_rate,
            }
            if dialect:
                utterance_msg["dialect"] = dialect
            if features:
                utterance_msg["features"] = features

            await ws.send(json.dumps(utterance_msg))
            print(f"✓ 已发送 utterance (索引: {utterance_index})")
            print(f"  音频大小: {len(audio_data)} bytes ({len(audio_base64)} base64字符)")

            # 等待翻译结果
            print("\n等待翻译结果...")
            result_count = 0
            while True:
                try:
                    # 设置超时（30秒）
                    response = await asyncio.wait_for(ws.recv(), timeout=30.0)
                    msg = json.loads(response)

                    msg_type = msg.get("type")

                    if msg_type == "asr_partial":
                        # ASR部分结果
                        print(f"  [ASR部分] {msg.get('text', '')} (is_final: {msg.get('is_final', False)})")
                        continue

                    elif msg_type == "translation_result":
                        # 翻译结果
                        result_count += 1
                        print(f"\n✓ 收到翻译结果 #{result_count}")
                        print(f"  任务ID: {msg.get('job_id', 'N/A')}")
                        print(f"  源文本 (ASR): {msg.get('text_asr', 'N/A')}")
                        print(f"  翻译文本: {msg.get('text_translated', 'N/A')}")
                        print(f"  TTS音频格式: {msg.get('tts_format', 'N/A')}")
                        tts_audio_b64 = msg.get("tts_audio", "")
                        if tts_audio_b64:
                            tts_audio_bytes = base64.b64decode(tts_audio_b64)
                            print(f"  TTS音频大小: {len(tts_audio_bytes)} bytes")
                        if msg.get("processing_time_ms"):
                            print(f"  处理时间: {msg.get('processing_time_ms')} ms")
                        if msg.get("trace_id"):
                            print(f"  追踪ID: {msg.get('trace_id')}")

                        # 保存TTS音频
                        if tts_audio_b64:
                            output_path = Path("output_translated_audio.pcm")
                            with open(output_path, "wb") as f:
                                f.write(tts_audio_bytes)
                            print(f"  ✓ TTS音频已保存到: {output_path}")

                        return msg

                    elif msg_type == "error":
                        print(f"\n✗ 收到错误: {msg}")
                        raise Exception(f"服务器返回错误: {msg}")

                    else:
                        print(f"  收到其他消息: {msg_type}")

                except asyncio.TimeoutError:
                    print("\n✗ 超时: 30秒内未收到翻译结果")
                    raise Exception("等待翻译结果超时")


async def main():
    parser = argparse.ArgumentParser(
        description="测试调度服务器分配任务给electron node，执行任务链并返回翻译后的音频"
    )
    parser.add_argument(
        "--audio",
        type=str,
        required=True,
        help="音频文件路径（相对于脚本目录）",
    )
    parser.add_argument(
        "--src-lang",
        type=str,
        required=True,
        help="源语言代码（如: zh, en, ja, ko）",
    )
    parser.add_argument(
        "--tgt-lang",
        type=str,
        required=True,
        help="目标语言代码（如: zh, en, ja, ko）",
    )
    parser.add_argument(
        "--scheduler-url",
        type=str,
        default="ws://localhost:5010/ws/session",
        help="调度服务器WebSocket地址（默认: ws://localhost:5010/ws/session）",
    )
    parser.add_argument(
        "--dialect",
        type=str,
        default=None,
        help="方言（可选）",
    )
    parser.add_argument(
        "--features",
        type=str,
        default=None,
        help="功能标志（JSON格式，可选）",
    )

    args = parser.parse_args()

    # 获取脚本目录
    script_dir = Path(__file__).parent
    audio_path = script_dir / args.audio

    # 解析features（如果是JSON字符串）
    features = None
    if args.features:
        try:
            features = json.loads(args.features)
        except json.JSONDecodeError:
            print(f"警告: 无法解析features JSON: {args.features}")
            features = None

    print("=" * 60)
    print("翻译流程测试")
    print("=" * 60)
    print(f"调度服务器: {args.scheduler_url}")
    print(f"音频文件: {audio_path}")
    print(f"翻译方向: {args.src_lang} -> {args.tgt_lang}")
    print("=" * 60)
    print()

    try:
        # 创建测试客户端
        client = TranslationTestClient(args.scheduler_url)

        # 加载音频文件
        audio_data, sample_rate, audio_format = client.load_audio_file(audio_path)
        print()

        # 创建会话
        await client.create_session(
            src_lang=args.src_lang,
            tgt_lang=args.tgt_lang,
            dialect=args.dialect,
            features=features,
        )
        print()

        # 发送音频并等待结果
        result = await client.send_utterance(
            audio_data=audio_data,
            sample_rate=sample_rate,
            audio_format=audio_format,
            src_lang=args.src_lang,
            tgt_lang=args.tgt_lang,
            utterance_index=0,
            dialect=args.dialect,
            features=features,
        )

        print()
        print("=" * 60)
        print("✓ 测试完成!")
        print("=" * 60)

    except Exception as e:
        print()
        print("=" * 60)
        print(f"✗ 测试失败: {e}")
        print("=" * 60)
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())

