#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""统一语义修复服务 - 全面测试"""

import requests
import json
import sys
import time
from typing import Dict, Any

def print_section(title: str):
    """打印分节标题"""
    print("\n" + "=" * 70)
    print(f"  {title}")
    print("=" * 70)

def print_result(success: bool, message: str, details: Dict[str, Any] = None):
    """打印测试结果"""
    status = "✓" if success else "✗"
    print(f"{status} {message}")
    if details:
        for key, value in details.items():
            print(f"    {key}: {value}")

def test_health(base_url: str):
    """测试健康检查"""
    print_section("1. 健康检查")
    
    try:
        response = requests.get(f"{base_url}/health", timeout=5)
        response.raise_for_status()
        health = response.json()
        
        details = {
            "全局状态": health.get('status'),
            "处理器数量": len(health.get('processors', {}))
        }
        
        for proc_name, proc_info in health.get('processors', {}).items():
            details[f"处理器 {proc_name}"] = proc_info.get('status')
        
        print_result(
            health.get('status') == 'healthy',
            "健康检查",
            details
        )
        return True
    except Exception as e:
        print_result(False, f"健康检查失败: {e}")
        return False

def test_repair_case(base_url: str, endpoint: str, case_name: str, text_in: str):
    """测试单个修复案例"""
    try:
        payload = {
            "job_id": f"test_{case_name}",
            "session_id": "test_session",
            "text_in": text_in
        }
        response = requests.post(
            f"{base_url}{endpoint}",
            json=payload,
            timeout=30
        )
        response.raise_for_status()
        result = response.json()
        
        success = result.get('decision') in ['PASS', 'REPAIR']
        details = {
            "输入": text_in,
            "输出": result.get('text_out', ''),
            "决策": result.get('decision'),
            "置信度": f"{result.get('confidence', 0):.2f}",
            "耗时": f"{result.get('process_time_ms', 0)} ms",
            "处理器": result.get('processor_name', 'N/A')
        }
        
        print_result(success, f"案例: {case_name}", details)
        return result
    except Exception as e:
        print_result(False, f"案例 {case_name} 失败: {e}")
        return None

def test_chinese_repair(base_url: str):
    """测试中文修复"""
    print_section("2. 中文语义修复测试")
    
    test_cases = [
        {"name": "同音字-你好", "text": "你号"},
        {"name": "正确文本", "text": "今天天气很好"},
        {"name": "常见同音字", "text": "我在家里"},
        {"name": "包含标点", "text": "你好，世界！"},
        {"name": "长文本", "text": "这是一个比较长的测试文本，用来测试服务是否能正确处理较长的输入内容。"}
    ]
    
    results = []
    for case in test_cases:
        result = test_repair_case(
            base_url,
            "/zh/repair",
            case["name"],
            case["text"]
        )
        results.append(result)
    
    return results

def test_english_repair(base_url: str):
    """测试英文修复"""
    print_section("3. 英文语义修复测试")
    
    test_cases = [
        {"name": "拼写错误-helo", "text": "Helo, world!"},
        {"name": "正确文本", "text": "Hello, this is a test."},
        {"name": "多个错误", "text": "I wnat to go thier."},
        {"name": "长文本", "text": "This is a longer test sentence to verify the service can handle longer input content correctly."}
    ]
    
    results = []
    for case in test_cases:
        result = test_repair_case(
            base_url,
            "/en/repair",
            case["name"],
            case["text"]
        )
        results.append(result)
    
    return results

def test_english_normalize(base_url: str):
    """测试英文标准化"""
    print_section("4. 英文标准化测试")
    
    test_cases = [
        {"name": "大写转小写", "text": "HELLO WORLD"},
        {"name": "多余空格", "text": "hello   world"},
        {"name": "多余标点", "text": "hello!!!"},
        {"name": "组合测试", "text": "HELLO  WORLD !!!"},
        {"name": "正常文本", "text": "hello world"}
    ]
    
    results = []
    for case in test_cases:
        result = test_repair_case(
            base_url,
            "/en/normalize",
            case["name"],
            case["text"]
        )
        results.append(result)
    
    return results

def test_performance(base_url: str):
    """测试性能"""
    print_section("5. 性能测试")
    
    endpoints = [
        {"path": "/zh/repair", "text": "测试文本", "name": "中文修复"},
        {"path": "/en/repair", "text": "test text", "name": "英文修复"},
        {"path": "/en/normalize", "text": "TEST TEXT", "name": "英文标准化"}
    ]
    
    for endpoint in endpoints:
        times = []
        success_count = 0
        
        print(f"\n测试 {endpoint['name']}:")
        for i in range(5):
            try:
                start = time.time()
                payload = {
                    "job_id": f"perf_{endpoint['name']}_{i}",
                    "session_id": "perf_session",
                    "text_in": endpoint['text']
                }
                response = requests.post(
                    f"{base_url}{endpoint['path']}",
                    json=payload,
                    timeout=30
                )
                response.raise_for_status()
                elapsed = (time.time() - start) * 1000
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
                f"{endpoint['name']} 性能统计",
                {
                    "成功请求": f"{success_count}/5",
                    "平均耗时": f"{avg_time:.0f} ms",
                    "最小耗时": f"{min_time:.0f} ms",
                    "最大耗时": f"{max_time:.0f} ms"
                }
            )

def test_edge_cases(base_url: str):
    """测试边界情况"""
    print_section("6. 边界情况测试")
    
    test_cases = [
        {"endpoint": "/zh/repair", "name": "空文本", "text": ""},
        {"endpoint": "/zh/repair", "name": "单个字符", "text": "好"},
        {"endpoint": "/en/normalize", "name": "纯空格", "text": "   "},
        {"endpoint": "/en/normalize", "name": "纯标点", "text": "!!!"},
    ]
    
    for case in test_cases:
        test_repair_case(
            base_url,
            case["endpoint"],
            case["name"],
            case["text"]
        )

def main():
    base_url = "http://127.0.0.1:5015"
    
    print("\n" + "=" * 70)
    print("  统一语义修复服务 - 全面测试")
    print("=" * 70)
    
    # 1. 健康检查
    if not test_health(base_url):
        print("\n❌ 服务不可用，终止测试")
        sys.exit(1)
    
    # 2. 中文修复测试
    test_chinese_repair(base_url)
    
    # 3. 英文修复测试
    test_english_repair(base_url)
    
    # 4. 英文标准化测试
    test_english_normalize(base_url)
    
    # 5. 性能测试
    test_performance(base_url)
    
    # 6. 边界情况测试
    test_edge_cases(base_url)
    
    print_section("测试完成")
    print("✅ 所有测试已完成！")

if __name__ == "__main__":
    main()
