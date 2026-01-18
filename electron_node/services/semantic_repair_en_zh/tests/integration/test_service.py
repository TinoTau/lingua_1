#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""统一语义修复服务 - 快速测试"""

import requests
import json
import sys

def test_service():
    base_url = "http://127.0.0.1:5015"
    
    print("=" * 60)
    print("Unified Semantic Repair Service - Quick Test")
    print("=" * 60)
    print()
    
    # 1. 检查健康状态
    print("[1/5] Checking health endpoint...")
    try:
        response = requests.get(f"{base_url}/health", timeout=5)
        response.raise_for_status()
        health = response.json()
        print(f"  ✓ Health check passed")
        print(f"    Status: {health.get('status')}")
        print(f"    Processors: {len(health.get('processors', {}))}")
        for proc_name, proc_info in health.get('processors', {}).items():
            print(f"      - {proc_name}: {proc_info.get('status')}")
        if health.get('status') == 'healthy':
            print("  ✓ Service is ready!")
        else:
            print("  ⚠️  Service is not fully ready")
    except Exception as e:
        print(f"  ✗ Health check failed: {e}")
        sys.exit(1)
    print()
    
    # 2. 测试中文修复
    print("[2/5] Testing Chinese repair...")
    try:
        test_text = "你号，这是一个测试。"
        payload = {
            "job_id": "test_zh_001",
            "session_id": "test_session_001",
            "text_in": test_text
        }
        response = requests.post(
            f"{base_url}/zh/repair",
            json=payload,
            timeout=30
        )
        response.raise_for_status()
        result = response.json()
        print(f"  ✓ Chinese repair test passed")
        print(f"    Input:  {test_text}")
        print(f"    Output: {result.get('text_out')}")
        print(f"    Decision: {result.get('decision')}")
        print(f"    Time: {result.get('process_time_ms')} ms")
    except Exception as e:
        print(f"  ✗ Chinese repair test failed: {e}")
    print()
    
    # 3. 测试英文修复
    print("[3/5] Testing English repair...")
    try:
        test_text = "Helo, this is a test."
        payload = {
            "job_id": "test_en_001",
            "session_id": "test_session_001",
            "text_in": test_text
        }
        response = requests.post(
            f"{base_url}/en/repair",
            json=payload,
            timeout=30
        )
        response.raise_for_status()
        result = response.json()
        print(f"  ✓ English repair test passed")
        print(f"    Input:  {test_text}")
        print(f"    Output: {result.get('text_out')}")
        print(f"    Decision: {result.get('decision')}")
        print(f"    Time: {result.get('process_time_ms')} ms")
    except Exception as e:
        print(f"  ✗ English repair test failed: {e}")
    print()
    
    # 4. 测试英文标准化
    print("[4/5] Testing English normalization...")
    try:
        test_text = "HELLO  WORLD !!!"
        payload = {
            "job_id": "test_norm_001",
            "session_id": "test_session_001",
            "text_in": test_text
        }
        response = requests.post(
            f"{base_url}/en/normalize",
            json=payload,
            timeout=30
        )
        response.raise_for_status()
        result = response.json()
        print(f"  ✓ English normalization test passed")
        print(f"    Input:  {test_text}")
        print(f"    Output: {result.get('text_out')}")
        print(f"    Decision: {result.get('decision')}")
        print(f"    Time: {result.get('process_time_ms')} ms")
    except Exception as e:
        print(f"  ✗ English normalization test failed: {e}")
    print()
    
    # 5. 测试多个请求
    print("[5/5] Testing multiple requests...")
    try:
        test_cases = [
            {"url": "/zh/repair", "text": "测试一"},
            {"url": "/zh/repair", "text": "测试二"},
            {"url": "/en/repair", "text": "test one"},
            {"url": "/en/normalize", "text": "TEST TWO"}
        ]
        success_count = 0
        for i, case in enumerate(test_cases, 1):
            try:
                payload = {
                    "job_id": f"test_multi_{i:03d}",
                    "session_id": "test_session",
                    "text_in": case["text"]
                }
                response = requests.post(
                    f"{base_url}{case['url']}",
                    json=payload,
                    timeout=30
                )
                response.raise_for_status()
                result = response.json()
                print(f"  ✓ Request {i}: {case['text'][:15]}... -> {result.get('text_out')[:15]}...")
                success_count += 1
            except Exception as e:
                print(f"  ✗ Request {i} failed: {e}")
        print(f"  ✓ Processed {success_count}/{len(test_cases)} requests successfully")
    except Exception as e:
        print(f"  ⚠️  Multiple requests test failed: {e}")
    print()
    
    print("=" * 60)
    print("✅ Test completed!")
    print("=" * 60)

if __name__ == "__main__":
    test_service()
