#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""ASR兼容性测试 - 验证ASR模块能否正常调用新服务"""

import requests
import json
import sys
import time

def print_section(title: str):
    """打印分节标题"""
    print("\n" + "=" * 70)
    print(f"  {title}")
    print("=" * 70)

def print_result(success: bool, message: str):
    """打印测试结果"""
    status = "✓" if success else "✗"
    print(f"{status} {message}")

def test_asr_style_call(base_url: str, lang: str, text_in: str, test_name: str):
    """
    测试ASR风格的调用（使用 /repair 端点 + lang 参数）
    """
    try:
        # 模拟ASR模块的调用方式
        payload = {
            "job_id": f"asr_test_{test_name}",
            "session_id": "asr_session_001",
            "utterance_index": 1,
            "lang": lang,              # ⭐ ASR模块通过参数指定语言
            "text_in": text_in,
            "quality_score": 0.75,
            "micro_context": None,
            "meta": {}
        }
        
        start = time.time()
        response = requests.post(
            f"{base_url}/repair",  # ⭐ ASR模块使用 /repair 端点
            json=payload,
            timeout=30
        )
        elapsed_ms = int((time.time() - start) * 1000)
        
        response.raise_for_status()
        result = response.json()
        
        # 验证响应格式（ASR模块期望的字段）
        required_fields = ['decision', 'text_out', 'confidence']
        missing_fields = [f for f in required_fields if f not in result]
        
        if missing_fields:
            print_result(False, f"❌ {test_name} - 响应缺少字段: {missing_fields}")
            return False
        
        print_result(True, f"{test_name}")
        print(f"    语言: {lang}")
        print(f"    输入: {text_in}")
        print(f"    输出: {result.get('text_out')}")
        print(f"    决策: {result.get('decision')}")
        print(f"    置信度: {result.get('confidence'):.2f}")
        print(f"    处理器: {result.get('processor_name', 'N/A')}")
        print(f"    耗时: {elapsed_ms} ms")
        
        return True
    except Exception as e:
        print_result(False, f"❌ {test_name} - 错误: {e}")
        return False

def test_endpoint_comparison(base_url: str):
    """
    对比测试：/repair vs /zh/repair 和 /en/repair
    验证两种调用方式的结果一致性
    """
    print_section("4. 端点对比测试")
    
    test_cases = [
        {
            "lang": "zh",
            "text": "你号，世界",
            "old_endpoint": "/repair",
            "new_endpoint": "/zh/repair"
        },
        {
            "lang": "en",
            "text": "Helo, world",
            "old_endpoint": "/repair",
            "new_endpoint": "/en/repair"
        }
    ]
    
    for case in test_cases:
        print(f"\n测试语言: {case['lang'].upper()}")
        
        # 测试 /repair 端点（ASR方式）
        try:
            payload_old = {
                "job_id": f"compare_old_{case['lang']}",
                "session_id": "compare_session",
                "text_in": case['text'],
                "lang": case['lang']  # ⭐ 旧方式需要 lang 参数
            }
            response_old = requests.post(
                f"{base_url}{case['old_endpoint']}",
                json=payload_old,
                timeout=30
            )
            response_old.raise_for_status()
            result_old = response_old.json()
            
            print(f"  ✓ {case['old_endpoint']} 返回: {result_old.get('text_out')}")
        except Exception as e:
            print(f"  ✗ {case['old_endpoint']} 失败: {e}")
            continue
        
        # 测试路径隔离端点（新方式）
        try:
            payload_new = {
                "job_id": f"compare_new_{case['lang']}",
                "session_id": "compare_session",
                "text_in": case['text']
                # 注意：不需要 lang 参数
            }
            response_new = requests.post(
                f"{base_url}{case['new_endpoint']}",
                json=payload_new,
                timeout=30
            )
            response_new.raise_for_status()
            result_new = response_new.json()
            
            print(f"  ✓ {case['new_endpoint']} 返回: {result_new.get('text_out')}")
        except Exception as e:
            print(f"  ✗ {case['new_endpoint']} 失败: {e}")
            continue
        
        # 对比结果
        if result_old.get('text_out') == result_new.get('text_out'):
            print(f"  ✅ 两种调用方式结果一致")
        else:
            print(f"  ⚠️  两种调用方式结果不一致")
            print(f"     /repair: {result_old.get('text_out')}")
            print(f"     {case['new_endpoint']}: {result_new.get('text_out')}")

def main():
    base_url = "http://127.0.0.1:5015"
    
    print("\n" + "=" * 70)
    print("  ASR兼容性测试 - semantic-repair-en-zh")
    print("=" * 70)
    
    # 1. 检查服务健康
    print_section("1. 服务健康检查")
    try:
        response = requests.get(f"{base_url}/health", timeout=5)
        response.raise_for_status()
        health = response.json()
        
        print_result(
            health.get('status') == 'healthy',
            f"服务状态: {health.get('status')}"
        )
        
        if health.get('status') != 'healthy':
            print("\n❌ 服务不健康，终止测试")
            sys.exit(1)
    except Exception as e:
        print_result(False, f"健康检查失败: {e}")
        print("\n❌ 服务不可用，终止测试")
        sys.exit(1)
    
    # 2. 测试中文修复（ASR风格调用）
    print_section("2. ASR风格调用 - 中文修复")
    
    zh_tests = [
        ("同音字修复", "zh", "你号，世界"),
        ("正常文本", "zh", "今天天气很好"),
        ("包含标点", "zh", "你好，世界！"),
    ]
    
    zh_success = 0
    for test_name, lang, text in zh_tests:
        if test_asr_style_call(base_url, lang, text, test_name):
            zh_success += 1
    
    print(f"\n中文测试: {zh_success}/{len(zh_tests)} 通过")
    
    # 3. 测试英文修复（ASR风格调用）
    print_section("3. ASR风格调用 - 英文修复")
    
    en_tests = [
        ("拼写错误", "en", "Helo, world"),
        ("正常文本", "en", "Hello, this is a test"),
        ("多个错误", "en", "I wnat to go thier"),
    ]
    
    en_success = 0
    for test_name, lang, text in en_tests:
        if test_asr_style_call(base_url, lang, text, test_name):
            en_success += 1
    
    print(f"\n英文测试: {en_success}/{len(en_tests)} 通过")
    
    # 4. 端点对比测试
    test_endpoint_comparison(base_url)
    
    # 5. 测试不支持的语言
    print_section("5. 不支持的语言测试")
    
    try:
        payload = {
            "job_id": "test_unsupported",
            "session_id": "session_001",
            "lang": "fr",  # 不支持的语言
            "text_in": "Bonjour le monde"
        }
        response = requests.post(
            f"{base_url}/repair",
            json=payload,
            timeout=30
        )
        response.raise_for_status()
        result = response.json()
        
        is_pass = result.get('decision') == 'PASS'
        has_unsupported = 'UNSUPPORTED_LANGUAGE' in result.get('reason_codes', [])
        
        if is_pass and has_unsupported:
            print_result(True, "不支持的语言正确返回PASS")
            print(f"    决策: {result.get('decision')}")
            print(f"    原因: {result.get('reason_codes')}")
        else:
            print_result(False, "不支持的语言处理不正确")
    except Exception as e:
        print_result(False, f"不支持的语言测试失败: {e}")
    
    # 总结
    print_section("测试总结")
    total_tests = len(zh_tests) + len(en_tests)
    total_success = zh_success + en_success
    
    print(f"总测试数: {total_tests + 1}")  # +1 for unsupported language test
    print(f"通过数: {total_success}")
    print(f"成功率: {(total_success/total_tests*100):.1f}%")
    
    if total_success == total_tests:
        print("\n✅ 所有ASR兼容性测试通过！")
        print("✅ 新服务完全兼容ASR模块调用方式！")
    else:
        print(f"\n⚠️  部分测试失败 ({total_tests - total_success} 个)")

if __name__ == "__main__":
    main()
