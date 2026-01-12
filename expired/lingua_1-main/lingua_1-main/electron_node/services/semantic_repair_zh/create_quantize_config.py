#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
从 config.json 中的 quantization_config 创建 quantize_config.json
"""

import json
import os
import sys

def create_quantize_config_from_config_json(model_path: str):
    """
    从 config.json 中的 quantization_config 创建 quantize_config.json
    """
    config_path = os.path.join(model_path, "config.json")
    quantize_config_path = os.path.join(model_path, "quantize_config.json")
    
    if not os.path.exists(config_path):
        print(f"❌ config.json not found at: {config_path}")
        return False
    
    # 读取 config.json
    with open(config_path, 'r', encoding='utf-8') as f:
        config = json.load(f)
    
    # 检查是否有 quantization_config
    if "quantization_config" not in config:
        print(f"❌ quantization_config not found in config.json")
        return False
    
    quant_config = config["quantization_config"]
    
    # 检查量化方法
    quant_method = quant_config.get("quant_method", "").lower()
    if "gptq" not in quant_method and "awq" not in quant_method:
        print(f"⚠️  Warning: quant_method is '{quant_method}', expected 'gptq' or 'awq'")
    
    # 创建 quantize_config.json（auto-gptq 格式）
    # auto-gptq 需要的格式可能略有不同，但我们可以尝试
    quantize_config = {
        "bits": quant_config.get("bits", 4),
        "group_size": quant_config.get("group_size", 128),
        "damp_percent": quant_config.get("damp_percent", 0.01),
        "desc_act": quant_config.get("desc_act", True),
        "sym": quant_config.get("sym", False),
        "true_sequential": quant_config.get("true_sequential", True),
        "model_file_base_name": "model",  # 默认值
    }
    
    # 保存 quantize_config.json
    with open(quantize_config_path, 'w', encoding='utf-8') as f:
        json.dump(quantize_config, f, indent=2, ensure_ascii=False)
    
    print(f"✅ Created quantize_config.json at: {quantize_config_path}")
    print(f"   Configuration:")
    for key, value in quantize_config.items():
        print(f"     {key}: {value}")
    
    return True

if __name__ == "__main__":
    if len(sys.argv) > 1:
        model_path = sys.argv[1]
    else:
        # 默认模型路径
        script_dir = os.path.dirname(os.path.abspath(__file__))
        model_path = os.path.join(script_dir, "models", "qwen2.5-3b-instruct-zh")
    
    if not os.path.exists(model_path):
        print(f"❌ Model path does not exist: {model_path}")
        sys.exit(1)
    
    print(f"Model path: {model_path}")
    print("")
    
    if create_quantize_config_from_config_json(model_path):
        print("")
        print("✅ Success! quantize_config.json has been created.")
        print("   You can now try starting the service.")
        sys.exit(0)
    else:
        print("")
        print("❌ Failed to create quantize_config.json")
        sys.exit(1)
