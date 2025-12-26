"""
HTTP 测试脚本：测试 ASR 服务的语言概率信息返回
通过 HTTP 请求直接测试 /utterance 接口
"""
import requests
import base64
import numpy as np
import json
import sys

def create_test_audio(duration_sec=1.0, sample_rate=16000):
    """创建测试音频（静音）"""
    audio = np.zeros(int(sample_rate * duration_sec), dtype=np.float32)
    # 转换为 PCM16
    audio_int16 = (audio * 32767).astype(np.int16)
    # 转换为 bytes
    audio_bytes = audio_int16.tobytes()
    # Base64 编码
    audio_base64 = base64.b64encode(audio_bytes).decode('utf-8')
    return audio_base64

def test_utterance_endpoint():
    """测试 /utterance 接口"""
    base_url = "http://localhost:5008"
    endpoint = f"{base_url}/utterance"
    
    print("=" * 80)
    print("🧪 测试 ASR 服务语言概率信息返回")
    print("=" * 80)
    print(f"测试端点: {endpoint}")
    print()
    
    # 创建测试音频
    print("📤 创建测试音频...")
    audio_base64 = create_test_audio(duration_sec=1.0)
    print(f"✅ 测试音频创建成功（Base64 长度: {len(audio_base64)}）")
    print()
    
    # 构建请求
    request_body = {
        "job_id": "test-language-probabilities",
        "src_lang": "auto",  # 自动语言检测
        "audio": audio_base64,
        "audio_format": "pcm16",
        "sample_rate": 16000,
        "task": "transcribe",
        "beam_size": 5,
        "condition_on_previous_text": False,
        "use_context_buffer": False,
        "use_text_context": False,
    }
    
    print("📤 发送请求...")
    print(f"请求参数: job_id={request_body['job_id']}, src_lang={request_body['src_lang']}")
    print()
    
    try:
        response = requests.post(endpoint, json=request_body, timeout=30)
        response.raise_for_status()
        
        result = response.json()
        
        print("=" * 80)
        print("📊 ASR 服务返回结果")
        print("=" * 80)
        print(f"状态码: {response.status_code}")
        print(f"文本: {result.get('text', '(empty)')}")
        print(f"检测到的语言: {result.get('language', '(None)')}")
        print(f"语言概率: {result.get('language_probability', '(None)')}")
        print(f"所有语言概率: {result.get('language_probabilities', '(None)')}")
        print()
        
        # 验证字段存在
        print("=" * 80)
        print("✅ 字段验证")
        print("=" * 80)
        
        has_language = 'language' in result
        has_language_probability = 'language_probability' in result
        has_language_probabilities = 'language_probabilities' in result
        
        print(f"language 字段: {'✅' if has_language else '❌'}")
        print(f"language_probability 字段: {'✅' if has_language_probability else '❌'}")
        print(f"language_probabilities 字段: {'✅' if has_language_probabilities else '❌'}")
        print()
        
        # 验证 language_probabilities 格式
        if has_language_probabilities and result.get('language_probabilities'):
            lang_probs = result['language_probabilities']
            if isinstance(lang_probs, dict):
                print(f"✅ language_probabilities 格式正确（字典，包含 {len(lang_probs)} 个语言）")
                print()
                print("📋 所有语言的概率:")
                for lang, prob in sorted(lang_probs.items(), key=lambda x: x[1], reverse=True):
                    print(f"  {lang}: {prob:.4f} ({prob*100:.2f}%)")
            else:
                print(f"❌ language_probabilities 格式错误（期望字典，实际: {type(lang_probs)}）")
        else:
            print("⚠️  language_probabilities 为空（Faster Whisper 可能未提供此信息）")
        print()
        
        # 验证一致性
        if has_language and has_language_probabilities and result.get('language') and result.get('language_probabilities'):
            detected_lang = result['language']
            lang_probs = result['language_probabilities']
            if detected_lang in lang_probs:
                expected_prob = lang_probs[detected_lang]
                actual_prob = result.get('language_probability')
                if actual_prob is not None:
                    if abs(actual_prob - expected_prob) < 0.0001:
                        print(f"✅ language_probability 与 language_probabilities 一致")
                    else:
                        print(f"❌ language_probability ({actual_prob}) 与 language_probabilities[{detected_lang}] ({expected_prob}) 不一致")
                else:
                    print(f"⚠️  language_probability 为 None，但 language_probabilities 存在")
            else:
                print(f"⚠️  检测到的语言 '{detected_lang}' 不在 language_probabilities 中")
        print()
        
        # 完整 JSON 输出（用于调试）
        print("=" * 80)
        print("📄 完整响应 JSON")
        print("=" * 80)
        print(json.dumps(result, indent=2, ensure_ascii=False))
        print()
        
        print("=" * 80)
        print("✅ 测试完成！")
        print("=" * 80)
        
        return True
        
    except requests.exceptions.RequestException as e:
        print(f"❌ 请求失败: {e}")
        if hasattr(e, 'response') and e.response is not None:
            print(f"响应状态码: {e.response.status_code}")
            print(f"响应内容: {e.response.text}")
        return False
    except Exception as e:
        print(f"❌ 测试失败: {e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    success = test_utterance_endpoint()
    sys.exit(0 if success else 1)

