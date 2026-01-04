#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
检查服务内部的 GPU 使用情况
"""

import requests
import json
import torch

def check_gpu_from_service():
    """通过服务检查 GPU 使用情况"""
    # 创建一个测试请求，触发一次推理，然后检查 GPU
    test_request = {
        "job_id": "gpu-check-001",
        "session_id": "gpu-check-session",
        "utterance_index": 0,
        "lang": "zh",
        "text_in": "测试GPU使用情况。"
    }
    
    print("=" * 80)
    print("GPU Usage Check (Before and After Inference)")
    print("=" * 80)
    print()
    
    # 检查推理前的 GPU 状态
    print("[Before Inference]")
    print("-" * 80)
    if torch.cuda.is_available():
        for i in range(torch.cuda.device_count()):
            allocated = torch.cuda.memory_allocated(i) / 1024**3
            reserved = torch.cuda.memory_reserved(i) / 1024**3
            total = torch.cuda.get_device_properties(i).total_memory / 1024**3
            print(f"GPU {i}: {torch.cuda.get_device_name(i)}")
            print(f"  Allocated: {allocated:.3f} GB ({allocated/total*100:.1f}%)")
            print(f"  Reserved: {reserved:.3f} GB ({reserved/total*100:.1f}%)")
            print(f"  Total: {total:.2f} GB")
            print(f"  Free: {total - reserved:.2f} GB")
    print()
    
    # 执行推理
    print("[Executing Inference...]")
    print("-" * 80)
    try:
        import time
        start_time = time.time()
        response = requests.post('http://127.0.0.1:5013/repair', json=test_request, timeout=60)
        elapsed = time.time() - start_time
        
        if response.status_code == 200:
            result = response.json()
            print(f"✓ Inference completed in {elapsed:.2f}s")
            print(f"  Service reported time: {result.get('repair_time_ms')} ms")
        else:
            print(f"✗ Inference failed: HTTP {response.status_code}")
    except Exception as e:
        print(f"✗ Inference error: {e}")
    print()
    
    # 检查推理后的 GPU 状态
    print("[After Inference]")
    print("-" * 80)
    if torch.cuda.is_available():
        for i in range(torch.cuda.device_count()):
            allocated = torch.cuda.memory_allocated(i) / 1024**3
            reserved = torch.cuda.memory_reserved(i) / 1024**3
            total = torch.cuda.get_device_properties(i).total_memory / 1024**3
            print(f"GPU {i}: {torch.cuda.get_device_name(i)}")
            print(f"  Allocated: {allocated:.3f} GB ({allocated/total*100:.1f}%)")
            print(f"  Reserved: {reserved:.3f} GB ({reserved/total*100:.1f}%)")
            print(f"  Total: {total:.2f} GB")
            print(f"  Free: {total - reserved:.2f} GB")
    print()
    
    print("=" * 80)
    print("Note: If GPU memory shows 0.00 GB, the model might be:")
    print("  1. Running on CPU (not GPU)")
    print("  2. Using quantization that's not properly tracked")
    print("  3. Model not loaded correctly")
    print("=" * 80)

if __name__ == "__main__":
    check_gpu_from_service()
