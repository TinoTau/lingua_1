#!/usr/bin/env python3
"""
服务稳定性测试脚本
测试服务在多次请求后的状态
"""

import requests
import time
import sys

BASE_URL = "http://127.0.0.1:6007"

def test_service_stability():
    """测试服务稳定性"""
    print("=" * 60)
    print("faster_whisper_vad 服务稳定性测试")
    print("=" * 60)
    print()
    
    # 测试1: 健康检查
    print("测试1: 健康检查...")
    try:
        r = requests.get(f"{BASE_URL}/health", timeout=5)
        if r.status_code == 200:
            print(f"✅ 健康检查通过: {r.json()}")
        else:
            print(f"❌ 健康检查失败: {r.status_code}")
            return False
    except Exception as e:
        print(f"❌ 健康检查异常: {e}")
        return False
    
    # 测试2: 多次健康检查
    print("\n测试2: 连续10次健康检查...")
    success_count = 0
    for i in range(10):
        try:
            r = requests.get(f"{BASE_URL}/health", timeout=2)
            if r.status_code == 200:
                success_count += 1
                print(f"  请求 {i+1}: ✅")
            else:
                print(f"  请求 {i+1}: ❌ ({r.status_code})")
        except Exception as e:
            print(f"  请求 {i+1}: ❌ ({e})")
        time.sleep(0.3)
    
    print(f"\n成功: {success_count}/10")
    if success_count < 10:
        print("⚠️ 服务不稳定")
        return False
    
    # 测试3: 重置端点
    print("\n测试3: 重置端点...")
    try:
        r = requests.post(f"{BASE_URL}/reset", json={}, timeout=5)
        if r.status_code == 200:
            print("✅ 重置端点通过")
        else:
            print(f"❌ 重置端点失败: {r.status_code}")
            return False
    except Exception as e:
        print(f"❌ 重置端点异常: {e}")
        return False
    
    # 测试4: 最终健康检查
    print("\n测试4: 最终健康检查...")
    try:
        r = requests.get(f"{BASE_URL}/health", timeout=5)
        if r.status_code == 200:
            print(f"✅ 最终健康检查通过: {r.json()}")
            return True
        else:
            print(f"❌ 最终健康检查失败: {r.status_code}")
            return False
    except Exception as e:
        print(f"❌ 最终健康检查异常: {e}")
        return False

if __name__ == "__main__":
    success = test_service_stability()
    print()
    print("=" * 60)
    if success:
        print("✅ 所有测试通过，服务稳定")
    else:
        print("❌ 测试失败，服务可能不稳定")
    print("=" * 60)
    sys.exit(0 if success else 1)

