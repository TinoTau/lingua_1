"""
ONNX/CUDA 配置对比实验
测试不同配置下的性能表现，排除配置问题

测试配置：
1. CUDA + float16 （当前配置）
2. CUDA + float32
3. CUDA + int8
4. CPU + float32 （对照组）

用途：
- 确定是否是 CUDA/ONNX 配置导致的性能问题
- 如果 CPU 模式更稳定，说明是 GPU provider 问题

运行方式：
    # 需要修改 config.py 中的配置后重启服务
    # 本脚本提供测试指引和结果收集框架
    
    python test_onnx_cuda_config.py

输出：
    - 不同配置下的性能对比
    - 建议的最佳配置
"""

import requests
import time
import json
import base64
import numpy as np
from datetime import datetime
from typing import Dict, Any, List
import os

# ===== 配置 =====
ASR_SERVICE_URL = "http://localhost:6007/utterance"
CONFIG_FILE_PATH = "../config.py"  # config.py 的相对路径
TEST_AUDIO_DURATION_SEC = 10.0
SAMPLE_RATE = 16000
NUM_TESTS_PER_CONFIG = 10  # 每个配置测试10次


# 测试配置列表
TEST_CONFIGS = [
    {
        "name": "CUDA_float16",
        "device": "cuda",
        "compute_type": "float16",
        "description": "当前生产配置（GPU + float16）",
    },
    {
        "name": "CUDA_float32",
        "device": "cuda",
        "compute_type": "float32",
        "description": "GPU + float32（更保守）",
    },
    {
        "name": "CUDA_int8",
        "device": "cuda",
        "compute_type": "int8",
        "description": "GPU + int8（量化加速）",
    },
    {
        "name": "CPU_float32",
        "device": "cpu",
        "compute_type": "float32",
        "description": "CPU对照组（排除GPU问题）",
    },
]


def generate_test_audio(duration_sec: float, sample_rate: int = 16000) -> bytes:
    """生成测试音频"""
    num_samples = int(duration_sec * sample_rate)
    t = np.linspace(0, duration_sec, num_samples)
    
    signal = (
        0.3 * np.sin(2 * np.pi * 200 * t) +
        0.2 * np.sin(2 * np.pi * 400 * t) +
        0.1 * np.sin(2 * np.pi * 800 * t) +
        0.05 * np.random.randn(num_samples)
    )
    
    signal = signal / np.max(np.abs(signal))
    pcm_data = (signal * 32767).astype(np.int16)
    
    return pcm_data.tobytes()


def test_asr_with_config(audio_bytes: bytes, config_name: str, test_id: str) -> Dict[str, Any]:
    """使用当前配置测试ASR"""
    audio_b64 = base64.b64encode(audio_bytes).decode('utf-8')
    
    payload = {
        "job_id": f"{config_name}-{test_id}",
        "trace_id": f"{config_name}-{test_id}",
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
                "config": config_name,
                "test_id": test_id,
                "request_duration": request_duration,
                "text": result.get("text", ""),
                "text_length": len(result.get("text", "")),
                "error": None,
            }
        else:
            return {
                "success": False,
                "config": config_name,
                "test_id": test_id,
                "request_duration": request_duration,
                "error": f"HTTP {response.status_code}",
            }
    
    except Exception as e:
        return {
            "success": False,
            "config": config_name,
            "test_id": test_id,
            "request_duration": time.time() - request_start,
            "error": str(e),
        }


def check_current_config() -> Dict[str, str]:
    """检查当前ASR服务配置"""
    try:
        response = requests.get(f"{ASR_SERVICE_URL.replace('/utterance', '/health')}", timeout=5.0)
        if response.status_code == 200:
            health_data = response.json()
            return {
                "status": "healthy",
                "model_loaded": health_data.get("asr_model_loaded", False),
            }
        else:
            return {"status": "unhealthy"}
    except Exception as e:
        return {"status": "error", "error": str(e)}


def print_config_instructions(config: Dict[str, Any]):
    """打印配置修改指引"""
    print(f"\n{'='*60}")
    print(f"测试配置: {config['name']}")
    print(f"描述: {config['description']}")
    print(f"{'='*60}")
    print(f"\n⚙️  请按以下步骤修改配置:\n")
    print(f"1. 打开文件: {CONFIG_FILE_PATH}")
    print(f"\n2. 修改以下配置项:")
    print(f"   ASR_DEVICE = \"{config['device']}\"")
    print(f"   ASR_COMPUTE_TYPE = \"{config['compute_type']}\"")
    print(f"\n3. 重启 ASR 服务")
    print(f"   - 如果通过 systemd: sudo systemctl restart faster-whisper-vad")
    print(f"   - 如果手动运行: 停止并重新运行 python faster_whisper_vad_service.py")
    print(f"\n4. 等待服务启动完成（约10-15秒）")
    print(f"\n5. 按 Enter 继续测试...")
    input()


def run_config_test(config: Dict[str, Any], audio_bytes: bytes) -> List[Dict[str, Any]]:
    """运行单个配置的测试"""
    print(f"\n开始测试: {config['name']}")
    print(f"测试次数: {NUM_TESTS_PER_CONFIG}")
    print("")
    
    results = []
    
    for i in range(1, NUM_TESTS_PER_CONFIG + 1):
        test_id = f"{datetime.now().strftime('%Y%m%d-%H%M%S')}-{i:02d}"
        print(f"[{i:2d}/{NUM_TESTS_PER_CONFIG}] 测试...", end=" ", flush=True)
        
        result = test_asr_with_config(audio_bytes, config['name'], test_id)
        results.append(result)
        
        if result["success"]:
            print(f"[OK] {result['request_duration']:.2f}s")
        else:
            print(f"[FAIL] {result['error']}")
        
        time.sleep(0.5)
    
    return results


def analyze_config_results(all_results: Dict[str, List[Dict[str, Any]]]):
    """分析所有配置的结果"""
    print(f"\n{'='*60}")
    print(f"配置对比分析")
    print(f"{'='*60}\n")
    
    summary = []
    
    for config_name, results in all_results.items():
        successful = [r for r in results if r["success"]]
        
        if not successful:
            summary.append({
                "config": config_name,
                "success_rate": 0,
                "avg_duration": None,
                "status": "[FAIL] 所有测试失败",
            })
            continue
        
        durations = [r["request_duration"] for r in successful]
        avg_duration = sum(durations) / len(durations)
        min_duration = min(durations)
        max_duration = max(durations)
        
        summary.append({
            "config": config_name,
            "success_rate": len(successful) / len(results) * 100,
            "avg_duration": avg_duration,
            "min_duration": min_duration,
            "max_duration": max_duration,
            "status": "[OK] 正常",
        })
    
    # 打印摘要
    print(f"{'配置':<20} {'成功率':<10} {'平均耗时':<12} {'最快':<10} {'最慢':<10} {'状态'}")
    print(f"{'-'*80}")
    
    for s in summary:
        if s["avg_duration"] is not None:
            print(
                f"{s['config']:<20} "
                f"{s['success_rate']:>6.1f}%   "
                f"{s['avg_duration']:>8.2f}s     "
                f"{s['min_duration']:>6.2f}s   "
                f"{s['max_duration']:>6.2f}s   "
                f"{s['status']}"
            )
        else:
            print(
                f"{s['config']:<20} "
                f"{s['success_rate']:>6.1f}%   "
                f"{'N/A':<12} "
                f"{'N/A':<10} "
                f"{'N/A':<10} "
                f"{s['status']}"
            )
    
    print("")
    
    # 推荐配置
    successful_configs = [s for s in summary if s["avg_duration"] is not None]
    if successful_configs:
        best_config = min(successful_configs, key=lambda x: x["avg_duration"])
        print(f"[BEST] 推荐配置: {best_config['config']}")
        print(f"   平均耗时: {best_config['avg_duration']:.2f}s")
        print(f"   成功率: {best_config['success_rate']:.1f}%")
    
    print("")
    
    # 性能分析
    cuda_configs = [s for s in successful_configs if "CUDA" in s["config"]]
    cpu_configs = [s for s in successful_configs if "CPU" in s["config"]]
    
    if cuda_configs and cpu_configs:
        cuda_avg = sum(c["avg_duration"] for c in cuda_configs) / len(cuda_configs)
        cpu_avg = sum(c["avg_duration"] for c in cpu_configs) / len(cpu_configs)
        
        print(f"[STATS] 性能对比:")
        print(f"   GPU平均: {cuda_avg:.2f}s")
        print(f"   CPU平均: {cpu_avg:.2f}s")
        
        if cpu_avg < cuda_avg:
            print(f"   [WARN] CPU模式更快！这不正常，可能GPU配置有问题")
        else:
            speedup = cpu_avg / cuda_avg
            print(f"   [OK] GPU加速: {speedup:.2f}x")
    
    print("")


def main():
    """主函数"""
    print(f"===== ONNX/CUDA 配置对比实验 =====")
    print(f"测试音频: {TEST_AUDIO_DURATION_SEC}秒")
    print(f"每配置测试: {NUM_TESTS_PER_CONFIG}次")
    print(f"总配置数: {len(TEST_CONFIGS)}")
    print("")
    
    # 生成测试音频
    print("生成测试音频...")
    test_audio = generate_test_audio(TEST_AUDIO_DURATION_SEC, SAMPLE_RATE)
    print(f"[OK] 测试音频生成完成: {len(test_audio)} bytes")
    print("")
    
    # 检查服务状态
    print("检查 ASR 服务状态...")
    health = check_current_config()
    if health["status"] == "healthy":
        print(f"[OK] ASR 服务正常运行")
    else:
        print(f"[WARN] ASR 服务状态: {health['status']}")
        print(f"请确保服务正常运行后再继续")
        return
    
    print("")
    
    # 说明
    print("[WARN]  本测试需要手动修改配置并重启服务")
    print("   测试过程中，脚本会暂停并提示您修改配置")
    print("   请按照提示操作")
    print("")
    input("按 Enter 开始测试...")
    
    # 运行所有配置的测试
    all_results = {}
    
    for config in TEST_CONFIGS:
        # 打印配置修改指引
        print_config_instructions(config)
        
        # 运行测试
        results = run_config_test(config, test_audio)
        all_results[config['name']] = results
    
    # 分析结果
    analyze_config_results(all_results)
    
    # 保存结果
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    output_file = f"config_test_{timestamp}.json"
    
    output_data = {
        "timestamp": timestamp,
        "test_configs": TEST_CONFIGS,
        "config": {
            "num_tests_per_config": NUM_TESTS_PER_CONFIG,
            "test_audio_duration_sec": TEST_AUDIO_DURATION_SEC,
            "sample_rate": SAMPLE_RATE,
        },
        "results": all_results,
    }
    
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(output_data, f, indent=2, ensure_ascii=False)
    
    print(f"[OK] 详细结果已保存: {output_file}")
    print("")
    
    print("===== 结论建议 =====")
    print("1. 如果 CPU 模式比 CUDA 更稳定，说明问题在 GPU provider")
    print("2. 如果 float32 比 float16 更稳定，考虑切换配置")
    print("3. 如果所有 CUDA 配置都有问题，检查 CUDA/ONNX Runtime 安装")
    print("")


if __name__ == "__main__":
    main()
