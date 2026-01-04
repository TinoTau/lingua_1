#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""测试模型加载"""

import sys
import os

# 添加当前目录到路径
sys.path.insert(0, os.path.dirname(__file__))

from model_loader import load_model_with_retry, find_local_model_path, setup_device
import torch

try:
    print("=" * 60)
    print("Testing Model Loading")
    print("=" * 60)
    
    # 设置设备
    print("\n[1] Setting up device...")
    device = setup_device()
    print(f"Device: {device}")
    
    # 查找模型路径
    print("\n[2] Finding model path...")
    service_dir = os.path.dirname(__file__)
    model_path = find_local_model_path(service_dir)
    print(f"Model path: {model_path}")
    
    # 加载模型
    print("\n[3] Loading model...")
    print("This may take a few minutes...")
    model = load_model_with_retry(
        model_path=model_path,
        device=device,
        use_quantization=True
    )
    
    print("\n[4] Model loaded successfully!")
    print(f"Model type: {type(model)}")
    print(f"Model device: {next(model.parameters()).device}")
    print(f"Model dtype: {next(model.parameters()).dtype}")
    
    # 检查GPU内存
    if device.type == "cuda":
        allocated = torch.cuda.memory_allocated() / 1024**3
        reserved = torch.cuda.memory_reserved() / 1024**3
        print(f"\nGPU Memory:")
        print(f"  Allocated: {allocated:.3f} GB")
        print(f"  Reserved: {reserved:.3f} GB")
    
    print("\n" + "=" * 60)
    print("✅ Model loading test PASSED")
    print("=" * 60)
    
except Exception as e:
    print("\n" + "=" * 60)
    print("❌ Model loading test FAILED")
    print("=" * 60)
    print(f"Error: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)
