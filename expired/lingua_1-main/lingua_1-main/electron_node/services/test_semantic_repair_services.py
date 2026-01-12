# -*- coding: utf-8 -*-
"""
测试三个新的语义修复服务
"""

import requests
import json
import time
from typing import Dict, Any

# 服务配置
SERVICES = {
    'en-normalize': {
        'port': 5012,
        'health_endpoint': '/health',
        'api_endpoint': '/normalize',
    },
    'semantic-repair-zh': {
        'port': 5013,
        'health_endpoint': '/health',
        'api_endpoint': '/repair',
    },
    'semantic-repair-en': {
        'port': 5011,
        'health_endpoint': '/health',
        'api_endpoint': '/repair',
    },
}

def test_health_check(service_name: str, port: int, endpoint: str) -> bool:
    """测试健康检查"""
    try:
        url = f'http://localhost:{port}{endpoint}'
        print(f"\n[{service_name}] 健康检查: {url}")
        response = requests.get(url, timeout=5)
        if response.status_code == 200:
            # 尝试解析JSON，如果失败则显示原始文本
            try:
                data = response.json()
                print(f"  ✅ 状态码: {response.status_code}")
                print(f"  📋 响应: {json.dumps(data, indent=4, ensure_ascii=False)}")
            except:
                # 如果不是JSON，显示原始文本
                print(f"  ✅ 状态码: {response.status_code}")
                print(f"  📋 响应 (文本): {response.text[:200]}")
                print(f"  ⚠️  警告: 响应不是JSON格式")
            return True
        else:
            print(f"  ❌ 状态码: {response.status_code}")
            print(f"  📋 响应: {response.text[:200]}")
            return False
    except requests.exceptions.ConnectionError:
        print(f"  ❌ 连接失败: 服务可能未启动")
        return False
    except Exception as e:
        print(f"  ❌ 错误: {str(e)[:100]}")
        return False

def test_en_normalize(port: int) -> bool:
    """测试英文标准化服务"""
    print(f"\n{'='*60}")
    print("[EN Normalize] 功能测试")
    print(f"{'='*60}")
    
    test_cases = [
        {
            'text_in': 'hello world',
            'lang': 'en',
            'expected_decision': 'PASS',  # 可能PASS或REPAIR
        },
        {
            'text_in': 'hello world how are you',
            'lang': 'en',
            'expected_decision': 'PASS',
        },
        {
            'text_in': 'this is a test sentence with some errors',
            'lang': 'en',
            'expected_decision': 'PASS',
        },
    ]
    
    success_count = 0
    for i, test_case in enumerate(test_cases, 1):
        print(f"\n测试用例 {i}: {test_case['text_in']}")
        try:
            url = f'http://localhost:{port}/normalize'
            payload = {
                'job_id': f'test_{int(time.time())}',
                'session_id': 'test_session',
                'utterance_index': i,
                'lang': test_case['lang'],
                'text_in': test_case['text_in'],
                'quality_score': 0.8,
            }
            
            response = requests.post(url, json=payload, timeout=10)
            if response.status_code == 200:
                data = response.json()
                print(f"  ✅ 状态码: {response.status_code}")
                print(f"  📝 输入: {test_case['text_in']}")
                print(f"  📝 输出: {data.get('text_out', 'N/A')}")
                print(f"  🎯 决策: {data.get('decision', 'N/A')}")
                print(f"  📊 置信度: {data.get('confidence', 'N/A')}")
                print(f"  ⏱️  耗时: {data.get('normalize_time_ms', 'N/A')} ms")
                print(f"  📋 原因代码: {data.get('reason_codes', [])}")
                success_count += 1
            else:
                print(f"  ❌ 状态码: {response.status_code}")
                print(f"  📋 响应: {response.text[:200]}")
        except Exception as e:
            print(f"  ❌ 错误: {str(e)[:100]}")
    
    print(f"\n✅ 成功: {success_count}/{len(test_cases)}")
    return success_count == len(test_cases)

def test_semantic_repair_zh(port: int) -> bool:
    """测试中文语义修复服务"""
    print(f"\n{'='*60}")
    print("[Semantic Repair ZH] 功能测试")
    print(f"{'='*60}")
    
    test_cases = [
        {
            'text_in': '你好世界',
            'lang': 'zh',
            'expected_decision': 'PASS',  # 可能PASS或REPAIR
        },
        {
            'text_in': '这是一个测试句子',
            'lang': 'zh',
            'expected_decision': 'PASS',
        },
        {
            'text_in': '今天天气很好',
            'lang': 'zh',
            'expected_decision': 'PASS',
        },
    ]
    
    success_count = 0
    for i, test_case in enumerate(test_cases, 1):
        print(f"\n测试用例 {i}: {test_case['text_in']}")
        try:
            url = f'http://localhost:{port}/repair'
            payload = {
                'job_id': f'test_{int(time.time())}',
                'session_id': 'test_session',
                'utterance_index': i,
                'lang': test_case['lang'],
                'text_in': test_case['text_in'],
                'micro_context': None,
                'quality_score': 0.8,
            }
            
            response = requests.post(url, json=payload, timeout=30)  # 修复可能需要更长时间
            if response.status_code == 200:
                data = response.json()
                print(f"  ✅ 状态码: {response.status_code}")
                print(f"  📝 输入: {test_case['text_in']}")
                print(f"  📝 输出: {data.get('text_out', 'N/A')}")
                print(f"  🎯 决策: {data.get('decision', 'N/A')}")
                print(f"  📊 置信度: {data.get('confidence', 'N/A')}")
                print(f"  ⏱️  耗时: {data.get('repair_time_ms', 'N/A')} ms")
                print(f"  📋 差异: {len(data.get('diff', []))} 项")
                success_count += 1
            else:
                print(f"  ❌ 状态码: {response.status_code}")
                print(f"  📋 响应: {response.text[:200]}")
        except Exception as e:
            print(f"  ❌ 错误: {str(e)[:100]}")
    
    print(f"\n✅ 成功: {success_count}/{len(test_cases)}")
    return success_count == len(test_cases)

def test_semantic_repair_en(port: int) -> bool:
    """测试英文语义修复服务"""
    print(f"\n{'='*60}")
    print("[Semantic Repair EN] 功能测试")
    print(f"{'='*60}")
    
    test_cases = [
        {
            'text_in': 'Hello world',
            'lang': 'en',
            'expected_decision': 'PASS',
        },
        {
            'text_in': 'This is a test sentence',
            'lang': 'en',
            'expected_decision': 'PASS',
        },
        {
            'text_in': 'The weather is nice today',
            'lang': 'en',
            'expected_decision': 'PASS',
        },
    ]
    
    success_count = 0
    for i, test_case in enumerate(test_cases, 1):
        print(f"\n测试用例 {i}: {test_case['text_in']}")
        try:
            url = f'http://localhost:{port}/repair'
            payload = {
                'job_id': f'test_{int(time.time())}',
                'session_id': 'test_session',
                'utterance_index': i,
                'lang': test_case['lang'],
                'text_in': test_case['text_in'],
                'micro_context': None,
                'quality_score': 0.8,
            }
            
            response = requests.post(url, json=payload, timeout=30)  # 修复可能需要更长时间
            if response.status_code == 200:
                data = response.json()
                print(f"  ✅ 状态码: {response.status_code}")
                print(f"  📝 输入: {test_case['text_in']}")
                print(f"  📝 输出: {data.get('text_out', 'N/A')}")
                print(f"  🎯 决策: {data.get('decision', 'N/A')}")
                print(f"  📊 置信度: {data.get('confidence', 'N/A')}")
                print(f"  ⏱️  耗时: {data.get('repair_time_ms', 'N/A')} ms")
                print(f"  📋 差异: {len(data.get('diff', []))} 项")
                success_count += 1
            else:
                print(f"  ❌ 状态码: {response.status_code}")
                print(f"  📋 响应: {response.text[:200]}")
        except Exception as e:
            print(f"  ❌ 错误: {str(e)[:100]}")
    
    print(f"\n✅ 成功: {success_count}/{len(test_cases)}")
    return success_count == len(test_cases)

def main():
    print("="*60)
    print("语义修复服务测试套件")
    print("="*60)
    
    # 1. 健康检查
    print(f"\n{'='*60}")
    print("步骤 1: 健康检查")
    print(f"{'='*60}")
    
    health_results = {}
    for service_name, config in SERVICES.items():
        health_results[service_name] = test_health_check(
            service_name,
            config['port'],
            config['health_endpoint']
        )
    
    # 2. 功能测试
    print(f"\n{'='*60}")
    print("步骤 2: 功能测试")
    print(f"{'='*60}")
    
    function_results = {}
    
    # EN Normalize
    if health_results.get('en-normalize'):
        function_results['en-normalize'] = test_en_normalize(SERVICES['en-normalize']['port'])
    else:
        print("\n⚠️  跳过 EN Normalize 功能测试（健康检查失败）")
        function_results['en-normalize'] = False
    
    # Semantic Repair ZH
    if health_results.get('semantic-repair-zh'):
        function_results['semantic-repair-zh'] = test_semantic_repair_zh(SERVICES['semantic-repair-zh']['port'])
    else:
        print("\n⚠️  跳过 Semantic Repair ZH 功能测试（健康检查失败）")
        function_results['semantic-repair-zh'] = False
    
    # Semantic Repair EN
    if health_results.get('semantic-repair-en'):
        function_results['semantic-repair-en'] = test_semantic_repair_en(SERVICES['semantic-repair-en']['port'])
    else:
        print("\n⚠️  跳过 Semantic Repair EN 功能测试（健康检查失败）")
        function_results['semantic-repair-en'] = False
    
    # 3. 总结
    print(f"\n{'='*60}")
    print("测试总结")
    print(f"{'='*60}")
    
    print("\n健康检查结果:")
    for service_name, result in health_results.items():
        status = "✅ 通过" if result else "❌ 失败"
        print(f"  {service_name}: {status}")
    
    print("\n功能测试结果:")
    for service_name, result in function_results.items():
        status = "✅ 通过" if result else "❌ 失败"
        print(f"  {service_name}: {status}")
    
    all_passed = all(health_results.values()) and all(function_results.values())
    
    print(f"\n{'='*60}")
    if all_passed:
        print("🎉 所有测试通过！")
    else:
        print("⚠️  部分测试失败，请检查上述结果")
    print(f"{'='*60}")
    
    return all_passed

if __name__ == '__main__':
    try:
        success = main()
        exit(0 if success else 1)
    except KeyboardInterrupt:
        print("\n\n测试被用户中断")
        exit(1)
    except Exception as e:
        print(f"\n\n测试过程中发生错误: {e}")
        import traceback
        traceback.print_exc()
        exit(1)
