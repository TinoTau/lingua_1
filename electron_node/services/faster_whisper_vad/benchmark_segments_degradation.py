"""
ASR Performance Degradation Benchmark
性能退化基准测试脚本

用途：
1. 连续50次调用ASR，观察 t_segments_list 是否随时间增长
2. 记录详细的性能指标，生成退化曲线
3. 验证"长命进程退化"假设

运行方式：
    python benchmark_segments_degradation.py

输出：
    - benchmark_results_YYYYMMDD_HHMMSS.json
    - benchmark_plot_YYYYMMDD_HHMMSS.png
"""

import requests
import time
import json
import base64
import numpy as np
from datetime import datetime
from typing import List, Dict, Any
import matplotlib.pyplot as plt
import os

# ===== 配置 =====
ASR_SERVICE_URL = "http://localhost:6007/utterance"
NUM_ITERATIONS = 50
TEST_AUDIO_DURATION_SEC = 24.0  # 使用24秒测试音频（与问题场景一致）
SAMPLE_RATE = 16000

# ===== 生成测试音频 =====
def generate_test_audio(duration_sec: float, sample_rate: int = 16000) -> bytes:
    """
    生成测试音频（模拟真实语音的正弦波+噪声）
    
    Args:
        duration_sec: 音频时长（秒）
        sample_rate: 采样率
    
    Returns:
        PCM16格式的音频bytes
    """
    num_samples = int(duration_sec * sample_rate)
    
    # 生成复合信号：多个频率的正弦波 + 白噪声
    t = np.linspace(0, duration_sec, num_samples)
    
    # 模拟语音的基频和谐波
    signal = (
        0.3 * np.sin(2 * np.pi * 200 * t) +   # 基频 200Hz
        0.2 * np.sin(2 * np.pi * 400 * t) +   # 谐波 400Hz
        0.1 * np.sin(2 * np.pi * 800 * t) +   # 谐波 800Hz
        0.05 * np.random.randn(num_samples)   # 白噪声
    )
    
    # 归一化到 [-1, 1]
    signal = signal / np.max(np.abs(signal))
    
    # 转换为 int16 PCM
    pcm_data = (signal * 32767).astype(np.int16)
    
    return pcm_data.tobytes()


def call_asr_service(audio_bytes: bytes, job_id: str) -> Dict[str, Any]:
    """
    调用ASR服务并记录响应时间
    
    Args:
        audio_bytes: 音频数据
        job_id: 任务ID
    
    Returns:
        包含性能指标的字典
    """
    # 编码为base64
    audio_b64 = base64.b64encode(audio_bytes).decode('utf-8')
    
    # 构造请求
    payload = {
        "job_id": job_id,
        "trace_id": job_id,
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
    
    # 记录请求时间
    request_start = time.time()
    
    try:
        response = requests.post(
            ASR_SERVICE_URL,
            json=payload,
            timeout=120.0  # 2分钟超时（足够长以观察退化）
        )
        
        request_duration = time.time() - request_start
        
        if response.status_code == 200:
            result = response.json()
            return {
                "success": True,
                "status_code": 200,
                "request_duration": request_duration,
                "text": result.get("text", ""),
                "text_length": len(result.get("text", "")),
                "segments_count": len(result.get("segments", [])),
                "language": result.get("language", ""),
                "error": None,
            }
        else:
            return {
                "success": False,
                "status_code": response.status_code,
                "request_duration": request_duration,
                "error": f"HTTP {response.status_code}: {response.text[:200]}",
            }
    
    except requests.exceptions.Timeout:
        return {
            "success": False,
            "status_code": 0,
            "request_duration": time.time() - request_start,
            "error": "Request timeout (>120s)",
        }
    
    except Exception as e:
        return {
            "success": False,
            "status_code": 0,
            "request_duration": time.time() - request_start,
            "error": str(e),
        }


def run_benchmark(num_iterations: int = NUM_ITERATIONS) -> List[Dict[str, Any]]:
    """
    运行基准测试
    
    Args:
        num_iterations: 测试次数
    
    Returns:
        测试结果列表
    """
    print(f"===== ASR Performance Degradation Benchmark =====")
    print(f"测试参数:")
    print(f"  - 测试次数: {num_iterations}")
    print(f"  - 音频时长: {TEST_AUDIO_DURATION_SEC}秒")
    print(f"  - 采样率: {SAMPLE_RATE}Hz")
    print(f"  - 服务地址: {ASR_SERVICE_URL}")
    print(f"")
    
    # 生成测试音频（只生成一次，所有测试使用相同音频）
    print("生成测试音频...")
    test_audio = generate_test_audio(TEST_AUDIO_DURATION_SEC, SAMPLE_RATE)
    print(f"[OK] 测试音频生成完成: {len(test_audio)} bytes")
    print("")
    
    # 运行测试
    results = []
    benchmark_start_time = time.time()
    
    for i in range(1, num_iterations + 1):
        job_id = f"bench-{datetime.now().strftime('%Y%m%d-%H%M%S')}-{i:03d}"
        
        print(f"[{i:2d}/{num_iterations}] 测试任务: {job_id}...", end=" ", flush=True)
        
        result = call_asr_service(test_audio, job_id)
        result["iteration"] = i
        result["elapsed_since_start"] = time.time() - benchmark_start_time
        results.append(result)
        
        if result["success"]:
            print(f"[OK] {result['request_duration']:.2f}s (text_len={result['text_length']})")
        else:
            print(f"[FAIL] {result['request_duration']:.2f}s (error={result['error'][:50]})")
        
        # 短暂延迟，避免过快请求
        time.sleep(0.5)
    
    print("")
    print(f"===== 基准测试完成 =====")
    print(f"总耗时: {time.time() - benchmark_start_time:.1f}秒")
    
    return results


def analyze_results(results: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    分析测试结果，检测性能退化
    
    Args:
        results: 测试结果列表
    
    Returns:
        分析报告
    """
    successful_results = [r for r in results if r["success"]]
    failed_results = [r for r in results if not r["success"]]
    
    if not successful_results:
        return {
            "total_tests": len(results),
            "successful_tests": 0,
            "failed_tests": len(failed_results),
            "degradation_detected": False,
            "analysis": "所有测试均失败，无法分析性能退化",
        }
    
    # 计算性能指标
    durations = [r["request_duration"] for r in successful_results]
    
    # 前10次的平均值（基线）
    baseline_count = min(10, len(durations))
    baseline_avg = sum(durations[:baseline_count]) / baseline_count
    
    # 后10次的平均值（当前）
    current_count = min(10, len(durations))
    current_avg = sum(durations[-current_count:]) / current_count
    
    # 检测退化（如果当前平均值 > 基线平均值 * 1.5）
    degradation_ratio = current_avg / baseline_avg if baseline_avg > 0 else 1.0
    degradation_detected = degradation_ratio > 1.5
    
    # 找出最慢的请求
    max_duration = max(durations)
    max_duration_index = durations.index(max_duration) + 1
    
    # 找出最快的请求
    min_duration = min(durations)
    min_duration_index = durations.index(min_duration) + 1
    
    analysis = {
        "total_tests": len(results),
        "successful_tests": len(successful_results),
        "failed_tests": len(failed_results),
        "degradation_detected": degradation_detected,
        "baseline_avg_duration": baseline_avg,
        "current_avg_duration": current_avg,
        "degradation_ratio": degradation_ratio,
        "max_duration": max_duration,
        "max_duration_index": max_duration_index,
        "min_duration": min_duration,
        "min_duration_index": min_duration_index,
        "avg_duration": sum(durations) / len(durations),
        "median_duration": sorted(durations)[len(durations) // 2],
    }
    
    if degradation_detected:
        analysis["analysis"] = (
            f"[WARN] 检测到性能退化！ "
            f"后期平均耗时 ({current_avg:.2f}s) 是初期 ({baseline_avg:.2f}s) 的 {degradation_ratio:.2f}倍"
        )
    else:
        analysis["analysis"] = (
            f"[OK] 未检测到明显性能退化。 "
            f"后期平均耗时 ({current_avg:.2f}s) 与初期 ({baseline_avg:.2f}s) 接近"
        )
    
    return analysis


def plot_results(results: List[Dict[str, Any]], output_path: str):
    """
    绘制性能退化曲线图
    
    Args:
        results: 测试结果列表
        output_path: 输出图片路径
    """
    successful_results = [r for r in results if r["success"]]
    
    if not successful_results:
        print("没有成功的测试结果，无法绘图")
        return
    
    iterations = [r["iteration"] for r in successful_results]
    durations = [r["request_duration"] for r in successful_results]
    
    # 创建图表
    plt.figure(figsize=(12, 6))
    
    # 绘制散点和折线
    plt.plot(iterations, durations, 'b-o', linewidth=2, markersize=4, label='请求耗时')
    
    # 绘制基线（前10次平均）
    baseline_count = min(10, len(durations))
    baseline_avg = sum(durations[:baseline_count]) / baseline_count
    plt.axhline(y=baseline_avg, color='g', linestyle='--', linewidth=1.5, label=f'基线 ({baseline_avg:.2f}s)')
    
    # 绘制1.5倍基线（退化阈值）
    plt.axhline(y=baseline_avg * 1.5, color='r', linestyle='--', linewidth=1.5, label=f'退化阈值 ({baseline_avg * 1.5:.2f}s)')
    
    # 标注
    plt.xlabel('测试序号', fontsize=12)
    plt.ylabel('请求耗时 (秒)', fontsize=12)
    plt.title('ASR 性能退化测试曲线', fontsize=14, fontweight='bold')
    plt.grid(True, alpha=0.3)
    plt.legend(loc='best')
    
    # 保存图表
    plt.tight_layout()
    plt.savefig(output_path, dpi=150)
    print(f"[OK] 性能曲线图已保存: {output_path}")
    
    # 尝试显示图表（如果在交互环境中）
    try:
        plt.show()
    except:
        pass


def main():
    """
    主函数
    """
    # 生成输出文件名
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    results_file = f"benchmark_results_{timestamp}.json"
    plot_file = f"benchmark_plot_{timestamp}.png"
    
    # 运行基准测试
    results = run_benchmark(NUM_ITERATIONS)
    
    # 分析结果
    print("")
    print("===== 分析结果 =====")
    analysis = analyze_results(results)
    
    for key, value in analysis.items():
        if key != "analysis":
            print(f"  {key}: {value}")
    print("")
    print(analysis["analysis"])
    print("")
    
    # 保存结果
    output_data = {
        "timestamp": timestamp,
        "config": {
            "num_iterations": NUM_ITERATIONS,
            "test_audio_duration_sec": TEST_AUDIO_DURATION_SEC,
            "sample_rate": SAMPLE_RATE,
            "service_url": ASR_SERVICE_URL,
        },
        "results": results,
        "analysis": analysis,
    }
    
    with open(results_file, 'w', encoding='utf-8') as f:
        json.dump(output_data, f, indent=2, ensure_ascii=False)
    
    print(f"[OK] 详细结果已保存: {results_file}")
    print("")
    
    # 绘制图表
    plot_results(results, plot_file)
    print("")
    
    # 最终建议
    print("===== 建议 =====")
    if analysis["degradation_detected"]:
        print("[WARN] 检测到性能退化！建议：")
        print("  1. 查看 ASR 服务日志中的 worker_uptime 和 job_index")
        print("  2. 检查日志中的 t_segments_list 是否随时间增长")
        print("  3. 考虑实施 Worker 生命周期管理（定期重启）")
        print("  4. 进行步骤3：多Worker对照实验")
    else:
        print("[OK] 未检测到明显退化，系统运行稳定")
        print("  - 如果生产环境出现问题，可能需要更长时间的测试")
        print("  - 建议增加测试次数（NUM_ITERATIONS）或使用更长的音频")
    print("")


if __name__ == "__main__":
    main()
