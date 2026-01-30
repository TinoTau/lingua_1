"""
ASR 直连测试 vs Node连接测试
对比性能，排除Node层和服务发现的影响

用途：
1. 直接调用 ASR 服务（localhost:6007）
2. 通过 Node Client 调用 ASR 服务
3. 对比两者的 t_segments_list，确定问题是否在ASR内部

运行方式：
    python test_direct_vs_node.py

输出：
    - 直连ASR的性能数据
    - 通过Node的性能数据
    - 对比分析结论
"""

import requests
import time
import json
import base64
import numpy as np
from datetime import datetime
from typing import Dict, Any, Tuple
import os
import sys

# ===== 配置 =====
ASR_SERVICE_URL = "http://localhost:6007/utterance"
NODE_SERVICE_URL = "http://localhost:8001/asr"  # 假设Node服务在8001端口
TEST_AUDIO_DURATION_SEC = 10.0
SAMPLE_RATE = 16000
NUM_TESTS = 5  # 每种方式测试5次


def generate_test_audio(duration_sec: float, sample_rate: int = 16000) -> bytes:
    """生成测试音频（PCM16格式）"""
    num_samples = int(duration_sec * sample_rate)
    t = np.linspace(0, duration_sec, num_samples)
    
    # 生成复合信号
    signal = (
        0.3 * np.sin(2 * np.pi * 200 * t) +
        0.2 * np.sin(2 * np.pi * 400 * t) +
        0.1 * np.sin(2 * np.pi * 800 * t) +
        0.05 * np.random.randn(num_samples)
    )
    
    signal = signal / np.max(np.abs(signal))
    pcm_data = (signal * 32767).astype(np.int16)
    
    return pcm_data.tobytes()


def test_direct_asr(audio_bytes: bytes, test_id: str) -> Dict[str, Any]:
    """
    直连ASR测试
    
    Args:
        audio_bytes: 音频数据
        test_id: 测试ID
    
    Returns:
        测试结果
    """
    audio_b64 = base64.b64encode(audio_bytes).decode('utf-8')
    
    payload = {
        "job_id": f"direct-{test_id}",
        "trace_id": f"direct-{test_id}",
        "audio": audio_b64,
        "audio_format": "pcm16",
        "sample_rate": SAMPLE_RATE,
        "src_lang": "zh",
        "task": "transcribe",
        "beam_size": 10,
        "use_context_buffer": False,
        "use_text_context": False,
        "padding_ms": 280,
    }
    
    request_start = time.time()
    
    try:
        response = requests.post(ASR_SERVICE_URL, json=payload, timeout=60.0)
        request_duration = time.time() - request_start
        
        if response.status_code == 200:
            result = response.json()
            return {
                "success": True,
                "method": "direct",
                "test_id": test_id,
                "request_duration": request_duration,
                "text": result.get("text", ""),
                "text_length": len(result.get("text", "")),
                "error": None,
            }
        else:
            return {
                "success": False,
                "method": "direct",
                "test_id": test_id,
                "request_duration": request_duration,
                "error": f"HTTP {response.status_code}",
            }
    
    except Exception as e:
        return {
            "success": False,
            "method": "direct",
            "test_id": test_id,
            "request_duration": time.time() - request_start,
            "error": str(e),
        }


def test_via_node(audio_bytes: bytes, test_id: str) -> Dict[str, Any]:
    """
    通过Node测试（如果Node服务可用）
    
    Args:
        audio_bytes: 音频数据
        test_id: 测试ID
    
    Returns:
        测试结果
    """
    # 注意：这里需要根据实际的Node API格式调整
    # 这只是一个示例，实际格式可能不同
    
    audio_b64 = base64.b64encode(audio_bytes).decode('utf-8')
    
    payload = {
        "job_id": f"node-{test_id}",
        "audio": audio_b64,
        "audio_format": "pcm16",
        "sample_rate": SAMPLE_RATE,
        "language": "zh",
    }
    
    request_start = time.time()
    
    try:
        response = requests.post(NODE_SERVICE_URL, json=payload, timeout=60.0)
        request_duration = time.time() - request_start
        
        if response.status_code == 200:
            result = response.json()
            return {
                "success": True,
                "method": "via_node",
                "test_id": test_id,
                "request_duration": request_duration,
                "text": result.get("text", ""),
                "text_length": len(result.get("text", "")),
                "error": None,
            }
        else:
            return {
                "success": False,
                "method": "via_node",
                "test_id": test_id,
                "request_duration": request_duration,
                "error": f"HTTP {response.status_code}",
            }
    
    except Exception as e:
        return {
            "success": False,
            "method": "via_node",
            "test_id": test_id,
            "request_duration": time.time() - request_start,
            "error": str(e),
        }


def run_comparison_test(num_tests: int = NUM_TESTS) -> Tuple[list, list]:
    """
    运行对比测试
    
    Args:
        num_tests: 测试次数
    
    Returns:
        (direct_results, node_results)
    """
    print(f"===== ASR 直连 vs Node 对比测试 =====")
    print(f"测试次数: {num_tests}")
    print(f"音频时长: {TEST_AUDIO_DURATION_SEC}秒")
    print(f"")
    
    # 生成测试音频
    print("生成测试音频...")
    test_audio = generate_test_audio(TEST_AUDIO_DURATION_SEC, SAMPLE_RATE)
    print(f"[OK] 测试音频生成完成: {len(test_audio)} bytes")
    print("")
    
    # 测试直连ASR
    print("===== 测试1: 直连ASR服务 =====")
    direct_results = []
    for i in range(1, num_tests + 1):
        test_id = f"{datetime.now().strftime('%Y%m%d-%H%M%S')}-{i:02d}"
        print(f"[{i}/{num_tests}] 直连测试...", end=" ", flush=True)
        
        result = test_direct_asr(test_audio, test_id)
        direct_results.append(result)
        
        if result["success"]:
            print(f"[OK] {result['request_duration']:.2f}s")
        else:
            print(f"[FAIL] {result['error']}")
        
        time.sleep(0.5)
    
    print("")
    
    # 测试通过Node
    print("===== 测试2: 通过Node服务 =====")
    node_results = []
    
    # 先检查Node服务是否可用
    try:
        response = requests.get(NODE_SERVICE_URL.replace('/asr', '/health'), timeout=5.0)
        node_available = response.status_code == 200
    except:
        node_available = False
    
    if not node_available:
        print(f"[WARN] Node服务不可用 ({NODE_SERVICE_URL})")
        print(f"跳过Node测试，只分析直连ASR的性能")
        print("")
    else:
        for i in range(1, num_tests + 1):
            test_id = f"{datetime.now().strftime('%Y%m%d-%H%M%S')}-{i:02d}"
            print(f"[{i}/{num_tests}] 通过Node测试...", end=" ", flush=True)
            
            result = test_via_node(test_audio, test_id)
            node_results.append(result)
            
            if result["success"]:
                print(f"[OK] {result['request_duration']:.2f}s")
            else:
                print(f"[FAIL] {result['error']}")
            
            time.sleep(0.5)
        
        print("")
    
    return direct_results, node_results


def analyze_comparison(direct_results: list, node_results: list):
    """
    分析对比结果
    
    Args:
        direct_results: 直连测试结果
        node_results: Node测试结果
    """
    print("===== 分析结果 =====")
    print("")
    
    # 直连ASR分析
    direct_success = [r for r in direct_results if r["success"]]
    if direct_success:
        direct_avg = sum(r["request_duration"] for r in direct_success) / len(direct_success)
        direct_min = min(r["request_duration"] for r in direct_success)
        direct_max = max(r["request_duration"] for r in direct_success)
        
        print(f"直连ASR:")
        print(f"  成功: {len(direct_success)}/{len(direct_results)}")
        print(f"  平均耗时: {direct_avg:.3f}s")
        print(f"  最快: {direct_min:.3f}s")
        print(f"  最慢: {direct_max:.3f}s")
        print("")
    else:
        print(f"直连ASR: 所有测试均失败")
        print("")
        return
    
    # Node测试分析
    if node_results:
        node_success = [r for r in node_results if r["success"]]
        if node_success:
            node_avg = sum(r["request_duration"] for r in node_success) / len(node_success)
            node_min = min(r["request_duration"] for r in node_success)
            node_max = max(r["request_duration"] for r in node_success)
            
            print(f"通过Node:")
            print(f"  成功: {len(node_success)}/{len(node_results)}")
            print(f"  平均耗时: {node_avg:.3f}s")
            print(f"  最快: {node_min:.3f}s")
            print(f"  最慢: {node_max:.3f}s")
            print("")
            
            # 对比分析
            diff = node_avg - direct_avg
            diff_percent = (diff / direct_avg) * 100 if direct_avg > 0 else 0
            
            print(f"对比分析:")
            print(f"  Node耗时 - 直连耗时: {diff:+.3f}s ({diff_percent:+.1f}%)")
            print("")
            
            if abs(diff_percent) < 10:
                print("[OK] 结论: 两者性能接近，Node层开销可忽略")
                print("   -> 问题在ASR服务内部，与服务发现无关")
            elif diff_percent > 10:
                print("[WARN] 结论: Node层增加了明显开销")
                print(f"   -> Node层可能存在性能瓶颈（+{diff_percent:.1f}%）")
            else:
                print("[OK] 结论: Node层实际上更快（可能是缓存等原因）")
        else:
            print(f"通过Node: 所有测试均失败")
    else:
        print("[WARN] Node服务不可用，无法进行对比")
        print("[OK] 结论: 只能分析直连ASR的性能")
        print("   -> 建议查看 ASR 服务日志中的详细指标")
    
    print("")
    print("===== 下一步建议 =====")
    print("1. 查看 ASR 服务日志，搜索以下关键字:")
    print("   - phase=segments_list_done")
    print("   - t_segments_list=")
    print("   - worker_uptime=")
    print("   - job_index=")
    print("")
    print("2. 如果发现 t_segments_list 随 worker_uptime 增长，")
    print("   说明问题确实在 Worker 长生命周期")
    print("")
    print("3. 继续执行步骤2: 运行基准测试脚本")
    print("   python benchmark_segments_degradation.py")
    print("")


def main():
    """主函数"""
    # 运行对比测试
    direct_results, node_results = run_comparison_test(NUM_TESTS)
    
    # 分析结果
    analyze_comparison(direct_results, node_results)
    
    # 保存结果
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    output_file = f"comparison_test_{timestamp}.json"
    
    output_data = {
        "timestamp": timestamp,
        "config": {
            "num_tests": NUM_TESTS,
            "test_audio_duration_sec": TEST_AUDIO_DURATION_SEC,
            "sample_rate": SAMPLE_RATE,
            "asr_service_url": ASR_SERVICE_URL,
            "node_service_url": NODE_SERVICE_URL,
        },
        "direct_results": direct_results,
        "node_results": node_results,
    }
    
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(output_data, f, indent=2, ensure_ascii=False)
    
    print(f"[OK] 详细结果已保存: {output_file}")
    print("")


if __name__ == "__main__":
    main()
