#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
检查 Semantic Repair ZH 服务状态和日志
"""

import requests
import json
import psutil
import sys
import time

def check_service_health():
    """检查服务健康状态"""
    try:
        response = requests.get('http://127.0.0.1:5013/health', timeout=5)
        if response.status_code == 200:
            return response.json()
        else:
            return {"error": f"HTTP {response.status_code}"}
    except Exception as e:
        return {"error": str(e)}

def check_process_info():
    """检查进程信息"""
    try:
        # 使用 netstat 或直接查找 Python 进程运行 semantic_repair_zh_service.py
        for proc in psutil.process_iter(['pid', 'name', 'cmdline', 'memory_info', 'cpu_percent', 'create_time']):
            try:
                pinfo = proc.info
                if pinfo['cmdline']:
                    cmdline_str = ' '.join(pinfo['cmdline'])
                    if 'semantic_repair_zh_service.py' in cmdline_str or 'semantic_repair_zh' in cmdline_str.lower():
                        pinfo['memory_mb'] = pinfo['memory_info'].rss / 1024 / 1024
                        pinfo['cpu_percent'] = proc.cpu_percent(interval=0.1)
                        pinfo['uptime_seconds'] = time.time() - pinfo['create_time']
                        pinfo['cmdline_short'] = ' '.join(pinfo['cmdline'][:3])
                        return pinfo
            except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
                pass
        return None
    except Exception as e:
        return {"error": str(e)}

def main():
    print("=" * 80)
    print("Semantic Repair ZH Service Status Check")
    print("=" * 80)
    print()
    
    # 检查健康状态
    print("[1] Health Check:")
    print("-" * 80)
    health = check_service_health()
    print(json.dumps(health, indent=2, ensure_ascii=False))
    print()
    
    # 检查进程信息
    print("[2] Process Information:")
    print("-" * 80)
    proc_info = check_process_info()
    if proc_info:
        if 'error' in proc_info:
            print(f"Error: {proc_info['error']}")
        else:
            print(f"PID: {proc_info['pid']}")
            print(f"Name: {proc_info['name']}")
            print(f"Memory: {proc_info['memory_mb']:.2f} MB")
            print(f"CPU: {proc_info['cpu_percent']:.1f}%")
            print(f"Uptime: {proc_info['uptime_seconds']:.1f} seconds ({proc_info['uptime_seconds']/60:.1f} minutes)")
            if 'cmdline' in proc_info and proc_info['cmdline']:
                print(f"Command: {' '.join(proc_info['cmdline'][:3])}...")
    else:
        print("Process not found")
    print()
    
    # 检查 GPU 使用情况（如果可用）
    print("[3] GPU Information:")
    print("-" * 80)
    try:
        import torch
        if torch.cuda.is_available():
            print(f"CUDA Available: True")
            print(f"CUDA Version: {torch.version.cuda}")
            print(f"GPU Count: {torch.cuda.device_count()}")
            for i in range(torch.cuda.device_count()):
                print(f"GPU {i}: {torch.cuda.get_device_name(i)}")
                print(f"  Memory Allocated: {torch.cuda.memory_allocated(i) / 1024**3:.2f} GB")
                print(f"  Memory Reserved: {torch.cuda.memory_reserved(i) / 1024**3:.2f} GB")
                print(f"  Memory Total: {torch.cuda.get_device_properties(i).total_memory / 1024**3:.2f} GB")
        else:
            print("CUDA Not Available")
    except ImportError:
        print("PyTorch not available")
    except Exception as e:
        print(f"Error checking GPU: {e}")
    print()
    
    # 测试修复功能
    print("[4] Test Repair Endpoint:")
    print("-" * 80)
    try:
        test_request = {
            "job_id": "test-001",
            "session_id": "test-session",
            "utterance_index": 0,
            "lang": "zh",
            "text_in": "你好，这是一个测试。"
        }
        response = requests.post('http://127.0.0.1:5013/repair', json=test_request, timeout=30)
        if response.status_code == 200:
            result = response.json()
            print("✓ Repair endpoint is working")
            print(f"  Decision: {result.get('decision')}")
            print(f"  Text Out: {result.get('text_out')}")
            print(f"  Confidence: {result.get('confidence')}")
            print(f"  Repair Time: {result.get('repair_time_ms')} ms")
        else:
            print(f"✗ Repair endpoint returned HTTP {response.status_code}")
            print(f"  Response: {response.text[:200]}")
    except requests.exceptions.Timeout:
        print("✗ Repair endpoint timeout (>30s)")
    except Exception as e:
        print(f"✗ Error testing repair endpoint: {e}")
    print()
    
    print("=" * 80)

if __name__ == "__main__":
    main()
