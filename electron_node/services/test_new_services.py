#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
测试新增的语义修复服务
Test new semantic repair services
"""

import requests
import json
import time
import sys

# 服务配置
SERVICES = {
    'en-normalize': {
        'port': 5012,
        'name': 'EN Normalize Service',
        'endpoints': {
            'health': '/health',
            'normalize': '/normalize',
        }
    },
    'semantic-repair-zh': {
        'port': 5010,
        'name': 'Semantic Repair Service - Chinese',
        'endpoints': {
            'health': '/health',
            'repair': '/repair',
        }
    },
    'semantic-repair-en': {
        'port': 5011,
        'name': 'Semantic Repair Service - English',
        'endpoints': {
            'health': '/health',
            'repair': '/repair',
        }
    }
}

def test_health_check(service_id: str, port: int) -> bool:
    """测试健康检查端点"""
    print(f"\n{'='*60}")
    print(f"测试 {service_id} - 健康检查")
    print(f"{'='*60}")
    
    try:
        url = f"http://localhost:{port}/health"
        response = requests.get(url, timeout=5)
        
        if response.status_code == 200:
            data = response.json()
            print(f"✅ 健康检查成功")
            print(f"   响应: {json.dumps(data, indent=2, ensure_ascii=False)}")
            return True
        else:
            print(f"❌ 健康检查失败: HTTP {response.status_code}")
            print(f"   响应: {response.text}")
            return False
    except requests.exceptions.ConnectionError:
        print(f"❌ 连接失败: 服务可能未启动在端口 {port}")
        return False
    except Exception as e:
        print(f"❌ 异常: {e}")
        return False

def test_en_normalize(port: int) -> bool:
    """测试en_normalize服务"""
    print(f"\n{'='*60}")
    print(f"测试 en-normalize - 标准化功能")
    print(f"{'='*60}")
    
    test_cases = [
        {
            'name': '基础文本标准化',
            'data': {
                'job_id': 'test_001',
                'session_id': 'session_001',
                'utterance_index': 0,
                'lang': 'en',
                'text_in': 'hello    world',
                'quality_score': 0.8
            }
        },
        {
            'name': '缩写保护',
            'data': {
                'job_id': 'test_002',
                'session_id': 'session_001',
                'utterance_index': 1,
                'lang': 'en',
                'text_in': 'I use api and url',
                'quality_score': 0.8
            }
        },
        {
            'name': '包含URL',
            'data': {
                'job_id': 'test_003',
                'session_id': 'session_001',
                'utterance_index': 2,
                'lang': 'en',
                'text_in': 'Visit https://example.com',
                'quality_score': 0.8
            }
        },
        {
            'name': '非英文文本（应返回PASS）',
            'data': {
                'job_id': 'test_004',
                'session_id': 'session_001',
                'utterance_index': 3,
                'lang': 'zh',
                'text_in': '你好世界',
                'quality_score': 0.8
            }
        }
    ]
    
    success_count = 0
    for test_case in test_cases:
        print(f"\n测试: {test_case['name']}")
        try:
            url = f"http://localhost:{port}/normalize"
            response = requests.post(url, json=test_case['data'], timeout=10)
            
            if response.status_code == 200:
                result = response.json()
                print(f"  ✅ 成功")
                print(f"     输入: {test_case['data']['text_in']}")
                print(f"     输出: {result.get('text_out', 'N/A')}")
                print(f"     决策: {result.get('decision', 'N/A')}")
                print(f"     原因码: {result.get('reason_codes', [])}")
                success_count += 1
            else:
                print(f"  ❌ 失败: HTTP {response.status_code}")
                print(f"     响应: {response.text}")
        except Exception as e:
            print(f"  ❌ 异常: {e}")
    
    print(f"\n结果: {success_count}/{len(test_cases)} 通过")
    return success_count == len(test_cases)

def test_semantic_repair_zh(port: int) -> bool:
    """测试semantic_repair_zh服务"""
    print(f"\n{'='*60}")
    print(f"测试 semantic-repair-zh - 中文修复功能")
    print(f"{'='*60}")
    
    # 注意：这个测试需要模型已加载，可能需要较长时间
    test_cases = [
        {
            'name': '基础修复测试',
            'data': {
                'job_id': 'test_zh_001',
                'session_id': 'session_zh_001',
                'utterance_index': 0,
                'lang': 'zh',
                'text_in': '今天天气很好',
                'quality_score': 0.8
            }
        },
        {
            'name': '低质量文本（应触发修复）',
            'data': {
                'job_id': 'test_zh_002',
                'session_id': 'session_zh_001',
                'utterance_index': 1,
                'lang': 'zh',
                'text_in': '今天天气很好',
                'quality_score': 0.6
            }
        },
        {
            'name': '非中文文本（应返回PASS）',
            'data': {
                'job_id': 'test_zh_003',
                'session_id': 'session_zh_001',
                'utterance_index': 2,
                'lang': 'en',
                'text_in': 'Hello world',
                'quality_score': 0.8
            }
        }
    ]
    
    success_count = 0
    for test_case in test_cases:
        print(f"\n测试: {test_case['name']}")
        try:
            url = f"http://localhost:{port}/repair"
            response = requests.post(url, json=test_case['data'], timeout=30)
            
            if response.status_code == 200:
                result = response.json()
                print(f"  ✅ 成功")
                print(f"     输入: {test_case['data']['text_in']}")
                print(f"     输出: {result.get('text_out', 'N/A')}")
                print(f"     决策: {result.get('decision', 'N/A')}")
                print(f"     置信度: {result.get('confidence', 'N/A')}")
                print(f"     原因码: {result.get('reason_codes', [])}")
                if result.get('repair_time_ms'):
                    print(f"     耗时: {result.get('repair_time_ms')}ms")
                success_count += 1
            else:
                print(f"  ❌ 失败: HTTP {response.status_code}")
                print(f"     响应: {response.text}")
        except requests.exceptions.Timeout:
            print(f"  ⚠️  超时（模型可能正在加载或处理中）")
        except Exception as e:
            print(f"  ❌ 异常: {e}")
    
    print(f"\n结果: {success_count}/{len(test_cases)} 通过")
    return success_count == len(test_cases)

def test_semantic_repair_en(port: int) -> bool:
    """测试semantic_repair_en服务"""
    print(f"\n{'='*60}")
    print(f"测试 semantic-repair-en - 英文修复功能")
    print(f"{'='*60}")
    
    # 注意：这个测试需要模型已加载，可能需要较长时间
    test_cases = [
        {
            'name': '基础修复测试',
            'data': {
                'job_id': 'test_en_001',
                'session_id': 'session_en_001',
                'utterance_index': 0,
                'lang': 'en',
                'text_in': 'The weather is nice today',
                'quality_score': 0.8
            }
        },
        {
            'name': '低质量文本（应触发修复）',
            'data': {
                'job_id': 'test_en_002',
                'session_id': 'session_en_001',
                'utterance_index': 1,
                'lang': 'en',
                'text_in': 'The weather is nice today',
                'quality_score': 0.6
            }
        },
        {
            'name': '非英文文本（应返回PASS）',
            'data': {
                'job_id': 'test_en_003',
                'session_id': 'session_en_001',
                'utterance_index': 2,
                'lang': 'zh',
                'text_in': '你好世界',
                'quality_score': 0.8
            }
        }
    ]
    
    success_count = 0
    for test_case in test_cases:
        print(f"\n测试: {test_case['name']}")
        try:
            url = f"http://localhost:{port}/repair"
            response = requests.post(url, json=test_case['data'], timeout=30)
            
            if response.status_code == 200:
                result = response.json()
                print(f"  ✅ 成功")
                print(f"     输入: {test_case['data']['text_in']}")
                print(f"     输出: {result.get('text_out', 'N/A')}")
                print(f"     决策: {result.get('decision', 'N/A')}")
                print(f"     置信度: {result.get('confidence', 'N/A')}")
                print(f"     原因码: {result.get('reason_codes', [])}")
                if result.get('repair_time_ms'):
                    print(f"     耗时: {result.get('repair_time_ms')}ms")
                success_count += 1
            else:
                print(f"  ❌ 失败: HTTP {response.status_code}")
                print(f"     响应: {response.text}")
        except requests.exceptions.Timeout:
            print(f"  ⚠️  超时（模型可能正在加载或处理中）")
        except Exception as e:
            print(f"  ❌ 异常: {e}")
    
    print(f"\n结果: {success_count}/{len(test_cases)} 通过")
    return success_count == len(test_cases)

def main():
    """主测试函数"""
    print("="*60)
    print("新增语义修复服务测试")
    print("="*60)
    print(f"开始时间: {time.strftime('%Y-%m-%d %H:%M:%S')}")
    
    results = {}
    
    # 测试所有服务的健康检查
    print("\n" + "="*60)
    print("阶段1: 健康检查测试")
    print("="*60)
    
    for service_id, config in SERVICES.items():
        results[f"{service_id}_health"] = test_health_check(service_id, config['port'])
        time.sleep(0.5)
    
    # 测试功能端点
    print("\n" + "="*60)
    print("阶段2: 功能测试")
    print("="*60)
    
    # 测试en_normalize
    if results.get('en-normalize_health', False):
        results['en-normalize_function'] = test_en_normalize(SERVICES['en-normalize']['port'])
    else:
        print("\n⚠️  en-normalize服务健康检查失败，跳过功能测试")
        results['en-normalize_function'] = False
    
    # 测试semantic_repair_zh
    if results.get('semantic-repair-zh_health', False):
        results['semantic-repair-zh_function'] = test_semantic_repair_zh(SERVICES['semantic-repair-zh']['port'])
    else:
        print("\n⚠️  semantic-repair-zh服务健康检查失败，跳过功能测试")
        results['semantic-repair-zh_function'] = False
    
    # 测试semantic_repair_en
    if results.get('semantic-repair-en_health', False):
        results['semantic-repair-en_function'] = test_semantic_repair_en(SERVICES['semantic-repair-en']['port'])
    else:
        print("\n⚠️  semantic-repair-en服务健康检查失败，跳过功能测试")
        results['semantic-repair-en_function'] = False
    
    # 汇总结果
    print("\n" + "="*60)
    print("测试结果汇总")
    print("="*60)
    
    passed = sum(1 for v in results.values() if v)
    total = len(results)
    
    for test_name, result in results.items():
        status = "✅ 通过" if result else "❌ 失败"
        print(f"{test_name}: {status}")
    
    print(f"\n总计: {passed}/{total} 通过")
    print(f"结束时间: {time.strftime('%Y-%m-%d %H:%M:%S')}")
    
    if passed == total:
        print("\n🎉 所有测试通过！")
        return 0
    else:
        print(f"\n⚠️  {total - passed} 个测试失败，请检查日志")
        return 1

if __name__ == "__main__":
    exit_code = main()
    sys.exit(exit_code)
