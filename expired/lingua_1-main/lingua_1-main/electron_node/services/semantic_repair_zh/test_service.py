#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""快速测试服务状态和功能"""

import requests
import json
import sys

def test_service():
    base_url = "http://127.0.0.1:5013"
    
    print("=" * 50)
    print("Semantic Repair ZH Service - Quick Test")
    print("=" * 50)
    print()
    
    # 1. 检查健康状态
    print("[1/4] Checking health endpoint...")
    try:
        response = requests.get(f"{base_url}/health", timeout=5)
        response.raise_for_status()
        health = response.json()
        print(f"  ✓ Health check passed")
        print(f"    Status: {health.get('status')}")
        print(f"    Warmed: {health.get('warmed')}")
        if health.get('status') == 'healthy' and health.get('warmed'):
            print("  ✓ Service is ready!")
        else:
            print("  ⚠️  Service is not fully ready")
    except Exception as e:
        print(f"  ✗ Health check failed: {e}")
        sys.exit(1)
    print()
    
    # 2. 检查诊断信息
    print("[2/4] Getting diagnostics...")
    try:
        response = requests.get(f"{base_url}/diagnostics", timeout=5)
        response.raise_for_status()
        diag = response.json()
        print(f"  ✓ Diagnostics retrieved")
        print(f"    Device: {diag.get('device')}")
        if diag.get('llamacpp_engine'):
            engine_info = diag['llamacpp_engine']
            print(f"    LlamaCpp Engine: {engine_info.get('status')}")
            if engine_info.get('model_path'):
                print(f"    Model Path: {engine_info.get('model_path')}")
        if diag.get('gpu_memory_allocated_gb'):
            print(f"    GPU Memory: {diag['gpu_memory_allocated_gb']:.2f} GB")
    except Exception as e:
        print(f"  ⚠️  Diagnostics failed: {e}")
    print()
    
    # 3. 测试修复功能
    print("[3/4] Testing repair endpoint...")
    try:
        test_text = "这是一个测试文本，包含一些错误。"
        payload = {
            "job_id": "test_job_001",
            "session_id": "test_session_001",
            "text_in": test_text,
            "lang": "zh"
        }
        response = requests.post(
            f"{base_url}/repair",
            json=payload,
            timeout=30
        )
        response.raise_for_status()
        repair = response.json()
        print(f"  ✓ Repair test passed")
        print(f"    Input:  {test_text}")
        print(f"    Output: {repair.get('text_out')}")
        print(f"    Decision: {repair.get('decision')}")
        print(f"    Confidence: {repair.get('confidence')}")
        print(f"    Repair Time: {repair.get('repair_time_ms')} ms")
        if repair.get('reason_codes'):
            print(f"    Reason Codes: {', '.join(repair.get('reason_codes', []))}")
    except Exception as e:
        print(f"  ✗ Repair test failed: {e}")
        if hasattr(e, 'response') and e.response is not None:
            try:
                error_detail = e.response.json()
                print(f"    Error detail: {json.dumps(error_detail, indent=2, ensure_ascii=False)}")
            except:
                print(f"    Response: {e.response.text}")
    print()
    
    # 4. 测试多个修复请求
    print("[4/4] Testing multiple repair requests...")
    try:
        test_cases = [
            "你好，这是一个测试。",
            "今天天气很好。",
            "我想了解一下这个产品。"
        ]
        success_count = 0
        for i, test_text in enumerate(test_cases, 1):
            try:
                payload = {
                    "job_id": f"test_job_{i:03d}",
                    "session_id": f"test_session_{i:03d}",
                    "text_in": test_text,
                    "lang": "zh"
                }
                response = requests.post(
                    f"{base_url}/repair",
                    json=payload,
                    timeout=30
                )
                response.raise_for_status()
                repair = response.json()
                print(f"  ✓ Request {i}: {test_text[:20]}... -> {repair.get('text_out')[:20]}...")
                success_count += 1
            except Exception as e:
                print(f"  ✗ Request {i} failed: {e}")
        print(f"  ✓ Processed {success_count}/{len(test_cases)} requests successfully")
    except Exception as e:
        print(f"  ⚠️  Multiple requests test failed: {e}")
    print()
    
    print("=" * 50)
    print("✅ Test completed!")
    print("=" * 50)

if __name__ == "__main__":
    test_service()
