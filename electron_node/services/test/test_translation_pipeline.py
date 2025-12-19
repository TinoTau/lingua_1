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
import urllib.request

try:
    import websockets
except ImportError:
    print("错误: 请先安装 websockets 库")
    print("pip install websockets")
    sys.exit(1)

# 默认配置（可以直接修改这里）
DEFAULT_SCHEDULER_URL = "ws://localhost:5010/ws/session"
DEFAULT_SCHEDULER_HTTP = "http://localhost:5010"


class TranslationTestClient:
    def __init__(self, scheduler_url: str = DEFAULT_SCHEDULER_URL, scheduler_http: str = DEFAULT_SCHEDULER_HTTP):
        self.scheduler_url = scheduler_url
        self.scheduler_http = scheduler_http
        self.session_id: Optional[str] = None
    
    def check_node_status(self) -> dict:
        """检查节点状态"""
        try:
            url = f"{self.scheduler_http}/api/v1/stats"
            with urllib.request.urlopen(url, timeout=5) as response:
                data = json.loads(response.read().decode())
                return data
        except Exception as e:
            print(f"警告: 无法获取节点状态: {e}")
            return {}
    
    def check_node_details(self, src_lang: str, tgt_lang: str) -> None:
        """检查节点详细状态，诊断为什么节点不可用"""
        try:
            url = f"{self.scheduler_http}/api/v1/stats"
            with urllib.request.urlopen(url, timeout=5) as response:
                data = json.loads(response.read().decode())
                nodes_info = data.get("nodes", {})
                connected_nodes = nodes_info.get("connected_nodes", 0)
                
                if connected_nodes == 0:
                    print("  ❌ 没有已连接的节点")
                    return
                
                # 检查可用模型
                available_models = nodes_info.get("available_models", [])
                print(f"  ✓ 已连接节点数: {connected_nodes}")
                print(f"  ✓ 可用模型数: {len(available_models)}")
                
                # 检查是否有所需的模型
                required_models = {
                    "asr": f"whisper-* (支持 {src_lang})",
                    "nmt": f"m2m100-{src_lang}-{tgt_lang}@*",
                    "tts": f"vits-* (支持 {tgt_lang})"
                }
                
                print(f"\n  检查所需模型 ({src_lang} -> {tgt_lang}):")
                has_asr = any("asr" in m.get("kind", "").lower() for m in available_models)
                has_nmt = any("nmt" in m.get("kind", "").lower() and 
                             (src_lang in m.get("model_id", "") and tgt_lang in m.get("model_id", "")) 
                             for m in available_models)
                has_tts = any("tts" in m.get("kind", "").lower() and 
                             tgt_lang in m.get("model_id", "").lower() 
                             for m in available_models)
                
                print(f"    ASR: {'✓' if has_asr else '✗'} {required_models['asr']}")
                print(f"    NMT: {'✓' if has_nmt else '✗'} {required_models['nmt']}")
                print(f"    TTS: {'✓' if has_tts else '✗'} {required_models['tts']}")
                
                if not (has_asr and has_nmt and has_tts):
                    print(f"\n  ⚠️  警告: 缺少必需的模型，节点可能无法处理此翻译任务")
                    print(f"  可用模型列表:")
                    for model in available_models:
                        model_id = model.get("model_id", "N/A")
                        kind = model.get("kind", "N/A")
                        src = model.get("src_lang", "")
                        tgt = model.get("tgt_lang", "")
                        print(f"    - {model_id} ({kind}) {src}->{tgt}")
                
                # 提示查看dashboard获取更详细信息
                print(f"\n  💡 提示: 如果节点不可用，请访问调度服务器dashboard查看详细节点状态:")
                print(f"     http://localhost:5010/dashboard")
                print(f"     或查看节点端日志，确认节点是否已进入 Ready 状态")
        except Exception as e:
            print(f"  警告: 无法获取详细节点信息: {e}")

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

    async def run_test(
        self,
        audio_data: bytes,
        sample_rate: int,
        audio_format: str,
        src_lang: str,
        tgt_lang: str,
        dialect: Optional[str] = None,
        features: Optional[dict] = None,
    ) -> dict:
        """在同一个WebSocket连接上创建会话并发送音频"""
        async with websockets.connect(self.scheduler_url) as ws:
            # 1. 创建会话
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
            else:
                raise Exception(f"意外的响应: {ack}")

            print()

            # 2. 发送 utterance
            audio_base64 = base64.b64encode(audio_data).decode("utf-8")
            utterance_msg = {
                "type": "utterance",
                "session_id": self.session_id,
                "utterance_index": 0,
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
            print(f"✓ 已发送 utterance (索引: 0)")
            print(f"  音频大小: {len(audio_data)} bytes ({len(audio_base64)} base64字符)")

            # 3. 等待翻译结果
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

                        # 保存TTS音频（使用任务ID避免覆盖）
                        if tts_audio_b64:
                            job_id = msg.get('job_id', 'unknown')
                            output_path = Path(f"output_translated_audio_{job_id}.pcm")
                            with open(output_path, "wb") as f:
                                f.write(tts_audio_bytes)
                            print(f"  ✓ TTS音频已保存到: {output_path}")

                        return msg

                    elif msg_type == "error":
                        error_code = msg.get("code", "UNKNOWN")
                        error_message = msg.get("message", "未知错误")
                        error_details = msg.get("details")
                        
                        print(f"\n✗ 收到错误:")
                        print(f"  错误代码: {error_code}")
                        print(f"  错误消息: {error_message}")
                        if error_details:
                            print(f"  详细信息: {json.dumps(error_details, indent=2, ensure_ascii=False)}")
                        
                        # 提供诊断建议
                        if error_code == "NODE_UNAVAILABLE":
                            print(f"\n  诊断建议:")
                            print(f"    1. 检查节点端是否已完全启动并进入 Ready 状态")
                            print(f"       - 节点状态必须是 'Ready'，不能是 'Registering'")
                            print(f"       - 查看节点端界面或日志确认状态")
                            print(f"    2. 检查节点是否有所需的模型（ASR、NMT、TTS）")
                            print(f"       - 模型状态必须是 'Ready'")
                            print(f"    3. 检查节点资源使用情况（CPU、GPU、内存）")
                            print(f"       - CPU使用率 < 25%")
                            print(f"       - GPU使用率 < 25%")
                            print(f"       - 内存使用率 < 75%")
                            print(f"    4. 检查节点是否接受公共任务（accept_public_jobs）")
                            print(f"    5. 查看调度服务器dashboard获取详细信息:")
                            print(f"       http://localhost:5010/dashboard")
                            print(f"    6. 查看调度服务器和节点端日志获取更多信息")
                        
                        raise Exception(f"服务器返回错误: {error_code} - {error_message}")

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
        default=DEFAULT_SCHEDULER_URL,
        help=f"调度服务器WebSocket地址（默认: {DEFAULT_SCHEDULER_URL}）",
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
        scheduler_http = args.scheduler_url.replace("ws://", "http://").replace("/ws/session", "")
        client = TranslationTestClient(args.scheduler_url, scheduler_http)
        
        # 检查节点状态
        print("检查节点状态...")
        client.check_node_details(args.src_lang, args.tgt_lang)
        print()

        # 加载音频文件
        audio_data, sample_rate, audio_format = client.load_audio_file(audio_path)
        print()

        # 在同一个连接上创建会话并发送音频
        result = await client.run_test(
            audio_data=audio_data,
            sample_rate=sample_rate,
            audio_format=audio_format,
            src_lang=args.src_lang,
            tgt_lang=args.tgt_lang,
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

