#!/usr/bin/env python3
"""
测试 utteranceIndex 修复
模拟长语音被拆分成多个job，然后合并处理的场景

测试场景：
- Job 623 (utteranceIndex: 0) - 短音频，被缓存
- Job 624 (utteranceIndex: 1) - 短音频，被缓存  
- Job 625 (utteranceIndex: 2) - 合并前两个job的音频

预期结果：
- Job 623 的结果使用 utterance_index: 0
- Job 624 的结果使用 utterance_index: 1
- 所有结果按顺序返回
"""

import asyncio
import base64
import json
import argparse
import sys
from pathlib import Path
from typing import Optional, List, Dict
import wave
import urllib.request

try:
    import websockets
except ImportError:
    print("错误: 请先安装 websockets 库")
    print("pip install websockets")
    sys.exit(1)

DEFAULT_SCHEDULER_URL = "ws://localhost:5010/ws/session"
DEFAULT_SCHEDULER_HTTP = "http://localhost:5010"


class UtteranceIndexTestClient:
    def __init__(self, scheduler_url: str = DEFAULT_SCHEDULER_URL, scheduler_http: str = DEFAULT_SCHEDULER_HTTP):
        self.scheduler_url = scheduler_url
        self.scheduler_http = scheduler_http
        self.session_id: Optional[str] = None
        self.results: List[Dict] = []

    def check_services(self) -> bool:
        """检查服务是否运行"""
        try:
            url = f"{self.scheduler_http}/health"
            with urllib.request.urlopen(url, timeout=5) as response:
                if response.status == 200:
                    print("✓ 调度服务器正在运行")
                    return True
        except Exception as e:
            print(f"✗ 调度服务器未运行: {e}")
            return False

    def load_audio_file(self, audio_path: Path) -> tuple[bytes, int, str]:
        """加载音频文件"""
        if not audio_path.exists():
            raise FileNotFoundError(f"音频文件不存在: {audio_path}")

        try:
            with wave.open(str(audio_path), "rb") as wav_file:
                sample_rate = wav_file.getframerate()
                n_channels = wav_file.getnchannels()
                sampwidth = wav_file.getsampwidth()
                audio_data = wav_file.readframes(wav_file.getnframes())

                format_str = "pcm16" if sampwidth == 2 else "wav"
                return audio_data, sample_rate, format_str
        except Exception as e:
            print(f"警告: 无法作为WAV文件读取: {e}")
            with open(audio_path, "rb") as f:
                audio_data = f.read()
            return audio_data, 16000, "pcm16"

    def split_audio(self, audio_data: bytes, sample_rate: int, num_chunks: int = 3) -> List[bytes]:
        """将音频分割成多个短chunk（模拟多个job）"""
        total_samples = len(audio_data) // 2  # PCM16: 2 bytes per sample
        chunk_samples = total_samples // num_chunks
        
        chunks = []
        for i in range(num_chunks):
            start = i * chunk_samples * 2
            if i == num_chunks - 1:
                # 最后一个chunk包含剩余所有数据
                end = len(audio_data)
            else:
                end = (i + 1) * chunk_samples * 2
            chunks.append(audio_data[start:end])
        
        return chunks

    async def run_test(
        self,
        audio_path: Path,
        src_lang: str = "zh",
        tgt_lang: str = "en",
        num_chunks: int = 3,
    ) -> None:
        """运行测试"""
        print("=" * 60)
        print("UtteranceIndex 修复测试")
        print("=" * 60)
        print(f"音频文件: {audio_path}")
        print(f"源语言: {src_lang} -> 目标语言: {tgt_lang}")
        print(f"分割成 {num_chunks} 个chunk")
        print()

        # 加载音频
        audio_data, sample_rate, audio_format = self.load_audio_file(audio_path)
        print(f"✓ 音频已加载: {len(audio_data)} bytes, {sample_rate} Hz")
        
        # 分割音频
        audio_chunks = self.split_audio(audio_data, sample_rate, num_chunks)
        print(f"✓ 音频已分割成 {len(audio_chunks)} 个chunk:")
        for i, chunk in enumerate(audio_chunks):
            duration_ms = (len(chunk) / 2 / sample_rate) * 1000
            print(f"  Chunk {i}: {len(chunk)} bytes ({duration_ms:.1f} ms)")

        print()
        print("=" * 60)
        print("开始测试...")
        print("=" * 60)
        print()

        async with websockets.connect(self.scheduler_url) as ws:
            # 1. 创建会话
            init_msg = {
                "type": "session_init",
                "client_version": "1.0.0",
                "platform": "test-client",
                "src_lang": src_lang,
                "tgt_lang": tgt_lang,
            }
            await ws.send(json.dumps(init_msg))
            print("✓ 已发送 session_init")

            response = await ws.recv()
            ack = json.loads(response)
            if ack.get("type") == "session_init_ack":
                self.session_id = ack["session_id"]
                print(f"✓ 会话已创建: {self.session_id}")
                print(f"  分配的节点: {ack.get('assigned_node_id', '未分配')}")
            else:
                raise Exception(f"意外的响应: {ack}")

            print()

            # 2. 发送多个短音频chunk（模拟多个job）
            print(f"发送 {len(audio_chunks)} 个音频chunk...")
            print()
            
            for i, chunk in enumerate(audio_chunks):
                audio_base64 = base64.b64encode(chunk).decode("utf-8")
                
                # 前两个chunk使用 manual_cut: False（短音频，会被缓存）
                # 最后一个chunk使用 manual_cut: True（触发合并处理）
                is_manual_cut = (i == len(audio_chunks) - 1)
                
                utterance_msg = {
                    "type": "utterance",
                    "session_id": self.session_id,
                    "utterance_index": i,
                    "manual_cut": is_manual_cut,
                    "src_lang": src_lang,
                    "tgt_lang": tgt_lang,
                    "audio": audio_base64,
                    "audio_format": audio_format,
                    "sample_rate": sample_rate,
                }
                
                await ws.send(json.dumps(utterance_msg))
                print(f"✓ 已发送 utterance {i} (manual_cut={is_manual_cut})")
                
                # 如果不是最后一个，等待一小段时间再发送下一个
                if i < len(audio_chunks) - 1:
                    await asyncio.sleep(0.5)

            print()
            print("=" * 60)
            print("等待结果...")
            print("=" * 60)
            print()

            # 3. 接收结果
            result_count = 0
            expected_results = num_chunks  # 期望收到相同数量的结果
            
            while result_count < expected_results:
                try:
                    response = await asyncio.wait_for(ws.recv(), timeout=60.0)
                    message = json.loads(response)
                    
                    msg_type = message.get("type")
                    
                    if msg_type == "job_result":
                        result_count += 1
                        utterance_index = message.get("utterance_index", -1)
                        text_asr = message.get("text_asr", "")
                        text_translated = message.get("text_translated", "")
                        job_id = message.get("job_id", "unknown")
                        is_final = message.get("is_final", False)
                        
                        self.results.append({
                            "utterance_index": utterance_index,
                            "job_id": job_id,
                            "text_asr": text_asr,
                            "text_translated": text_translated,
                            "is_final": is_final,
                        })
                        
                        print(f"✓ 收到结果 #{result_count}:")
                        print(f"  Job ID: {job_id}")
                        print(f"  Utterance Index: {utterance_index}")
                        print(f"  Is Final: {is_final}")
                        print(f"  ASR: {text_asr[:50]}..." if len(text_asr) > 50 else f"  ASR: {text_asr}")
                        print(f"  Translated: {text_translated[:50]}..." if len(text_translated) > 50 else f"  Translated: {text_translated}")
                        print()
                    
                    elif msg_type == "error":
                        error_code = message.get("error_code", "unknown")
                        error_message = message.get("error_message", "unknown")
                        print(f"✗ 收到错误: {error_code}: {error_message}")
                        break
                    
                    elif msg_type == "session_error":
                        error_message = message.get("error_message", "unknown")
                        print(f"✗ 会话错误: {error_message}")
                        break
                    
                except asyncio.TimeoutError:
                    print(f"⚠️  超时: 已等待60秒，只收到 {result_count} 个结果")
                    break
                except Exception as e:
                    print(f"✗ 接收消息时出错: {e}")
                    break

            print()
            print("=" * 60)
            print("测试结果分析")
            print("=" * 60)
            print()

            # 4. 分析结果
            self.analyze_results(num_chunks)

    def analyze_results(self, expected_count: int) -> None:
        """分析测试结果"""
        print(f"总共收到 {len(self.results)} 个结果（期望: {expected_count}）")
        print()

        if len(self.results) == 0:
            print("✗ 未收到任何结果")
            return

        # 检查utteranceIndex
        print("UtteranceIndex 检查:")
        print("-" * 60)
        
        utterance_indices = sorted([r["utterance_index"] for r in self.results])
        expected_indices = list(range(expected_count))
        
        all_correct = True
        for i, result in enumerate(self.results):
            utterance_index = result["utterance_index"]
            expected_index = i
            
            # 检查是否按顺序
            if utterance_index == expected_index:
                status = "✓"
            else:
                status = "✗"
                all_correct = False
            
            print(f"{status} 结果 #{i+1}: utterance_index={utterance_index} (期望: {expected_index})")
            print(f"    Job ID: {result['job_id']}")
            print(f"    ASR长度: {len(result['text_asr'])} 字符")
            print(f"    翻译长度: {len(result['text_translated'])} 字符")
            print()

        print("-" * 60)
        if all_correct:
            print("✓ 所有结果的 utteranceIndex 都正确！")
        else:
            print("✗ 部分结果的 utteranceIndex 不正确")
            print()
            print("修复验证:")
            print("  1. 检查日志文件: electron_node/electron-node/main/logs/electron-main.log")
            print("  2. 查找 'Created original job with original utterance_index' 日志")
            print("  3. 确认 SequentialExecutor 使用正确的 utteranceIndex")
        
        print()
        print("详细结果:")
        for i, result in enumerate(self.results):
            print(f"  结果 {i+1}:")
            print(f"    utterance_index: {result['utterance_index']}")
            print(f"    job_id: {result['job_id']}")
            print(f"    ASR: {result['text_asr']}")
            print(f"    Translated: {result['text_translated']}")
            print()


async def main():
    parser = argparse.ArgumentParser(description="测试 utteranceIndex 修复")
    parser.add_argument(
        "--audio",
        type=Path,
        required=True,
        help="音频文件路径"
    )
    parser.add_argument(
        "--src-lang",
        type=str,
        default="zh",
        help="源语言 (默认: zh)"
    )
    parser.add_argument(
        "--tgt-lang",
        type=str,
        default="en",
        help="目标语言 (默认: en)"
    )
    parser.add_argument(
        "--chunks",
        type=int,
        default=3,
        help="分割的chunk数量 (默认: 3)"
    )
    parser.add_argument(
        "--scheduler-url",
        type=str,
        default=DEFAULT_SCHEDULER_URL,
        help=f"调度服务器WebSocket URL (默认: {DEFAULT_SCHEDULER_URL})"
    )
    parser.add_argument(
        "--scheduler-http",
        type=str,
        default=DEFAULT_SCHEDULER_HTTP,
        help=f"调度服务器HTTP URL (默认: {DEFAULT_SCHEDULER_HTTP})"
    )

    args = parser.parse_args()

    client = UtteranceIndexTestClient(args.scheduler_url, args.scheduler_http)
    
    # 检查服务
    if not client.check_services():
        print("\n请先启动调度服务器和节点服务")
        print("  1. 启动调度服务器: .\\scripts\\start_central_server.ps1 --scheduler")
        print("  2. 启动节点服务: .\\scripts\\start_electron_node.ps1")
        sys.exit(1)

    try:
        await client.run_test(
            args.audio,
            args.src_lang,
            args.tgt_lang,
            args.chunks,
        )
    except KeyboardInterrupt:
        print("\n\n测试被用户中断")
        sys.exit(1)
    except Exception as e:
        print(f"\n\n✗ 测试失败: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
