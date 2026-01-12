#!/usr/bin/env python3
"""
死锁修复验证测试
测试服务在多次并发请求后是否仍能正常响应
"""

import requests
import time
import concurrent.futures
import sys

BASE_URL = "http://127.0.0.1:6007"

def test_health():
    """健康检查测试"""
    try:
        r = requests.get(f"{BASE_URL}/health", timeout=5)
        return r.status_code == 200
    except Exception as e:
        print(f"Health check failed: {e}")
        return False

def test_reset():
    """重置端点测试"""
    try:
        r = requests.post(f"{BASE_URL}/reset", json={}, timeout=5)
        return r.status_code == 200
    except Exception as e:
        print(f"Reset failed: {e}")
        return False

def test_utterance_pcm16():
    """PCM16音频测试"""
    import base64
    import numpy as np
    
    # 生成1秒的测试音频（16kHz, 16-bit PCM）
    sample_rate = 16000
    duration = 1.0
    samples = int(sample_rate * duration)
    audio_data = np.random.randint(-32768, 32767, samples, dtype=np.int16)
    
    # 转换为PCM16 bytes
    pcm16_bytes = audio_data.tobytes()
    
    # Base64编码
    audio_base64 = base64.b64encode(pcm16_bytes).decode('utf-8')
    
    try:
        payload = {
            "job_id": f"test_deadlock_{int(time.time())}",
            "src_lang": "auto",
            "audio": audio_base64,
            "audio_format": "pcm16",
            "sample_rate": sample_rate,
            "trace_id": f"test_deadlock_{int(time.time())}"
        }
        r = requests.post(f"{BASE_URL}/utterance", json=payload, timeout=30)
        return r.status_code == 200
    except Exception as e:
        print(f"Utterance test failed: {e}")
        return False

def test_concurrent_requests(num_requests=20, num_workers=5):
    """并发请求测试"""
    print(f"\n测试并发请求: {num_requests}个请求, {num_workers}个并发...")
    
    def worker():
        # 每个worker执行多个操作
        results = []
        results.append(("health", test_health()))
        time.sleep(0.1)
        results.append(("reset", test_reset()))
        time.sleep(0.1)
        results.append(("health_after_reset", test_health()))
        return results
    
    with concurrent.futures.ThreadPoolExecutor(max_workers=num_workers) as executor:
        futures = [executor.submit(worker) for _ in range(num_requests)]
        all_results = []
        for future in concurrent.futures.as_completed(futures):
            try:
                results = future.result()
                all_results.extend(results)
            except Exception as e:
                print(f"Worker failed: {e}")
                all_results.append(("error", False))
    
    # 统计结果
    passed = sum(1 for _, result in all_results if result)
    total = len(all_results)
    
    print(f"并发测试结果: {passed}/{total} 通过")
    
    # 按类型统计
    health_passed = sum(1 for name, result in all_results if name.startswith("health") and result)
    health_total = sum(1 for name, _ in all_results if name.startswith("health"))
    reset_passed = sum(1 for name, result in all_results if name == "reset" and result)
    reset_total = sum(1 for name, _ in all_results if name == "reset")
    
    print(f"  健康检查: {health_passed}/{health_total}")
    print(f"  重置端点: {reset_passed}/{reset_total}")
    
    return passed == total

def test_after_stress():
    """压力测试后的响应测试"""
    print("\n执行压力测试（多次音频处理）...")
    
    # 执行多次音频处理请求
    for i in range(5):
        if not test_utterance_pcm16():
            print(f"压力测试失败: 第{i+1}次请求失败")
            return False
        time.sleep(0.5)
    
    print("压力测试完成，验证服务响应...")
    
    # 验证服务仍能响应
    time.sleep(1)
    if not test_health():
        print("❌ 压力测试后服务无法响应")
        return False
    
    print("✅ 压力测试后服务仍能正常响应")
    return True

def main():
    print("=" * 60)
    print("死锁修复验证测试")
    print("=" * 60)
    print()
    
    # 测试1: 基础健康检查
    print("测试1: 基础健康检查...")
    if not test_health():
        print("❌ 基础健康检查失败")
        return False
    print("✅ 基础健康检查通过")
    
    # 测试2: 并发请求测试
    print("\n测试2: 并发请求测试...")
    if not test_concurrent_requests(num_requests=20, num_workers=5):
        print("❌ 并发请求测试失败")
        return False
    print("✅ 并发请求测试通过")
    
    # 测试3: 压力测试后的响应
    if not test_after_stress():
        print("❌ 压力测试失败")
        return False
    
    # 测试4: 最终验证
    print("\n测试4: 最终验证...")
    time.sleep(1)
    if not test_health():
        print("❌ 最终验证失败")
        return False
    print("✅ 最终验证通过")
    
    print()
    print("=" * 60)
    print("✅ 所有测试通过，死锁问题已解决！")
    print("=" * 60)
    return True

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)

