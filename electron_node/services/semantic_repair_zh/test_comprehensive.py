#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""全面测试语义修复服务 - 包含典型ASR错误场景"""

import requests
import json
import sys
from typing import Dict, Any

def print_section(title: str):
    """打印分节标题"""
    print("\n" + "=" * 60)
    print(f"  {title}")
    print("=" * 60)

def print_result(success: bool, message: str, details: Dict[str, Any] = None):
    """打印测试结果"""
    status = "✓" if success else "✗"
    color_code = "\033[92m" if success else "\033[91m"
    reset_code = "\033[0m"
    print(f"{color_code}{status}{reset_code} {message}")
    if details:
        for key, value in details.items():
            print(f"    {key}: {value}")

def test_health_and_diagnostics(base_url: str):
    """测试健康检查和诊断信息"""
    print_section("1. 健康检查和诊断信息")
    
    # 健康检查
    try:
        response = requests.get(f"{base_url}/health", timeout=5)
        response.raise_for_status()
        health = response.json()
        print_result(
            health.get('status') == 'healthy' and health.get('warmed'),
            "健康检查",
            {
                "状态": health.get('status'),
                "模型已加载": health.get('model_loaded'),
                "已预热": health.get('warmed'),
                "模型版本": health.get('model_version', 'N/A')
            }
        )
    except Exception as e:
        print_result(False, f"健康检查失败: {e}")
        return False
    
    # 诊断信息
    try:
        response = requests.get(f"{base_url}/diagnostics", timeout=5)
        response.raise_for_status()
        diag = response.json()
        print_result(
            True,
            "诊断信息",
            {
                "设备": diag.get('device'),
                "引擎状态": diag.get('llamacpp_engine', {}).get('status', 'N/A'),
                "模型路径": diag.get('llamacpp_engine', {}).get('model_path', 'N/A')[:60] + "..." if diag.get('llamacpp_engine', {}).get('model_path') else 'N/A',
                "GPU内存": f"{diag.get('gpu_memory_allocated_gb', 0):.2f} GB" if diag.get('gpu_memory_allocated_gb') else "N/A"
            }
        )
    except Exception as e:
        print_result(False, f"诊断信息获取失败: {e}")
    
    return True

def test_repair_case(base_url: str, case_name: str, text_in: str, expected_keywords: list = None, lang: str = "zh"):
    """测试单个修复案例"""
    try:
        payload = {
            "job_id": f"test_{case_name}",
            "session_id": "test_session",
            "text_in": text_in,
            "lang": lang
        }
        response = requests.post(
            f"{base_url}/repair",
            json=payload,
            timeout=30
        )
        response.raise_for_status()
        result = response.json()
        
        # 检查结果
        success = result.get('decision') in ['PASS', 'REPAIR']
        details = {
            "输入": text_in,
            "输出": result.get('text_out', ''),
            "决策": result.get('decision'),
            "置信度": f"{result.get('confidence', 0):.2f}",
            "耗时": f"{result.get('repair_time_ms', 0)} ms"
        }
        
        if expected_keywords:
            # 检查是否包含期望的关键词
            output = result.get('text_out', '')
            found_keywords = [kw for kw in expected_keywords if kw in output]
            if found_keywords:
                details["匹配关键词"] = ", ".join(found_keywords)
        
        print_result(success, f"测试案例: {case_name}", details)
        return result
    except Exception as e:
        print_result(False, f"测试案例 {case_name} 失败: {e}")
        return None

def test_typical_asr_errors(base_url: str):
    """测试典型的ASR错误场景"""
    print_section("2. 典型ASR错误场景测试")
    
    test_cases = [
        {
            "name": "同音字错误-短句",
            "text_in": "这是一个短句测试",
            "expected": ["短句"]  # 如果原文正确，应该保持
        },
        {
            "name": "同音字错误-音频",
            "text_in": "音频处理",
            "expected": ["音频"]
        },
        {
            "name": "简单正确文本",
            "text_in": "今天天气很好",
            "expected": ["今天天气很好"]  # 应该保持原样
        },
        {
            "name": "常见同音字-在",
            "text_in": "我在家里",
            "expected": ["在"]
        },
        {
            "name": "常见同音字-再",
            "text_in": "再见",
            "expected": ["再"]
        },
    ]
    
    results = []
    for case in test_cases:
        result = test_repair_case(
            base_url,
            case["name"],
            case["text_in"],
            case.get("expected")
        )
        results.append(result)
    
    return results

def test_edge_cases(base_url: str):
    """测试边界情况"""
    print_section("3. 边界情况测试")
    
    edge_cases = [
        {
            "name": "空文本",
            "text_in": "",
        },
        {
            "name": "单个字符",
            "text_in": "好",
        },
        {
            "name": "长文本",
            "text_in": "这是一个比较长的测试文本，用来测试服务是否能正确处理较长的输入内容，看看修复效果如何。",
        },
        {
            "name": "包含标点",
            "text_in": "你好，世界！",
        },
        {
            "name": "非中文语言",
            "text_in": "Hello, world!",
            "lang": "en"
        },
    ]
    
    results = []
    for case in edge_cases:
        result = test_repair_case(
            base_url,
            case["name"],
            case["text_in"],
            lang=case.get("lang", "zh")
        )
        results.append(result)
    
    return results

def test_performance(base_url: str):
    """测试性能"""
    print_section("4. 性能测试")
    
    test_text = "这是一个性能测试文本。"
    times = []
    success_count = 0
    
    for i in range(5):
        try:
            import time as time_module
            start = time_module.time()
            payload = {
                "job_id": f"perf_test_{i}",
                "session_id": "perf_session",
                "text_in": test_text,
                "lang": "zh"
            }
            response = requests.post(
                f"{base_url}/repair",
                json=payload,
                timeout=30
            )
            response.raise_for_status()
            elapsed = (time_module.time() - start) * 1000
            times.append(elapsed)
            success_count += 1
            print(f"  请求 {i+1}: {elapsed:.0f} ms")
        except Exception as e:
            print(f"  请求 {i+1} 失败: {e}")
    
    if times:
        avg_time = sum(times) / len(times)
        min_time = min(times)
        max_time = max(times)
        print_result(
            True,
            "性能统计",
            {
                "成功请求": f"{success_count}/5",
                "平均耗时": f"{avg_time:.0f} ms",
                "最小耗时": f"{min_time:.0f} ms",
                "最大耗时": f"{max_time:.0f} ms"
            }
        )

def main():
    base_url = "http://127.0.0.1:5013"
    
    print("\n" + "=" * 60)
    print("  Semantic Repair ZH Service - 全面测试")
    print("=" * 60)
    
    # 1. 健康检查和诊断
    if not test_health_and_diagnostics(base_url):
        print("\n❌ 服务不可用，终止测试")
        sys.exit(1)
    
    # 2. 典型ASR错误测试
    test_typical_asr_errors(base_url)
    
    # 3. 边界情况测试
    test_edge_cases(base_url)
    
    # 4. 性能测试
    test_performance(base_url)
    
    print_section("测试完成")
    print("✅ 所有测试已完成！")

if __name__ == "__main__":
    main()
