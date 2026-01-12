# -*- coding: utf-8 -*-
"""
Semantic Repair Service - English - Model Loader
英文语义修复服务 - 模型加载器

注意：现在只使用 llama.cpp（GGUF），不再使用 transformers
"""

import os
import torch
from typing import Optional


def setup_device() -> torch.device:
    """设置设备（强制使用GPU，不允许回退到CPU）"""
    # 检查CUDA是否可用
    if not torch.cuda.is_available():
        error_msg = (
            f"[Semantic Repair EN] ❌ CUDA not available! GPU is required.\n"
            f"  PyTorch version: {torch.__version__}\n"
            f"  CUDA compiled: {torch.version.cuda}\n"
            f"  To use GPU, please install CUDA-enabled PyTorch:\n"
            f"    pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121"
        )
        print(error_msg, flush=True)
        raise RuntimeError("CUDA is not available. GPU is required for semantic repair service.")
    
    # 测试CUDA是否真正可用（创建一个小的tensor）
    try:
        test_tensor = torch.zeros(1).cuda()
        device_name = torch.cuda.get_device_name(0)
        cuda_version = torch.version.cuda
        total_memory = torch.cuda.get_device_properties(0).total_memory / 1024**3
        
        print(f"[Semantic Repair EN] ✅ CUDA test passed, using GPU", flush=True)
        print(f"[Semantic Repair EN] GPU: {device_name}", flush=True)
        print(f"[Semantic Repair EN] CUDA Version: {cuda_version}", flush=True)
        print(f"[Semantic Repair EN] GPU Memory: {total_memory:.2f} GB", flush=True)
        
        # 清理测试tensor
        del test_tensor
        torch.cuda.empty_cache()
        
        return torch.device("cuda")
    except Exception as cuda_test_err:
        error_msg = (
            f"[Semantic Repair EN] ❌ CUDA test failed: {cuda_test_err}\n"
            f"  CUDA is reported as available but test failed.\n"
            f"  Please check your CUDA installation and GPU drivers."
        )
        print(error_msg, flush=True)
        raise RuntimeError(f"CUDA test failed: {cuda_test_err}. GPU is required for semantic repair service.")


def log_gpu_info():
    """记录GPU信息"""
    if torch.cuda.is_available():
        print(f"[Semantic Repair EN] GPU: {torch.cuda.get_device_name(0)}", flush=True)
        print(f"[Semantic Repair EN] CUDA Version: {torch.version.cuda}", flush=True)
        print(f"[Semantic Repair EN] GPU Memory: {torch.cuda.get_device_properties(0).total_memory / 1024**3:.2f} GB", flush=True)
    else:
        print("[Semantic Repair EN] No GPU available", flush=True)


def find_gguf_model_path(service_dir: str) -> Optional[str]:
    """
    查找 GGUF 模型文件路径（英文模型）
    
    Returns:
        GGUF 模型文件路径，如果未找到则返回 None
    """
    models_dir = os.path.join(service_dir, "models")
    
    # 优先查找 q4_k_m（更好的质量），其次 q4_0
    gguf_model_names = [
        "qwen2.5-3b-instruct-q4_k_m.gguf",
        "qwen2.5-3b-instruct-q4_0.gguf",
        "qwen2.5-3b-instruct-q4_k_s.gguf",
    ]
    
    # 优先检查 qwen2.5-3b-instruct-en-gguf 目录（已复制中文模型到此目录）
    gguf_dir = os.path.join(models_dir, "qwen2.5-3b-instruct-en-gguf")
    if os.path.exists(gguf_dir):
        for model_name in gguf_model_names:
            model_path = os.path.join(gguf_dir, model_name)
            if os.path.exists(model_path):
                print(f"[Semantic Repair EN] Found GGUF model: {model_path}", flush=True)
                return model_path
    
    # 如果没有找到，返回 None（不再回退到中文模型目录）
    return None
