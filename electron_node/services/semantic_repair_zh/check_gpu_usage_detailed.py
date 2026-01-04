#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""详细检查 llama.cpp 的 GPU 使用情况"""

import sys
import os

# 添加当前目录到路径
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

def check_llama_cpp_gpu():
    """检查 llama-cpp-python 的 GPU 支持"""
    print("=" * 60)
    print("检查 llama-cpp-python GPU 支持")
    print("=" * 60)
    print()
    
    # 1. 检查 llama-cpp-python 是否安装
    try:
        import llama_cpp
        print(f"✓ llama-cpp-python 已安装")
        print(f"  版本: {llama_cpp.__version__ if hasattr(llama_cpp, '__version__') else '未知'}")
    except ImportError as e:
        print(f"✗ llama-cpp-python 未安装: {e}")
        return False
    print()
    
    # 2. 检查 CUDA 支持
    try:
        from llama_cpp import Llama
        print("✓ Llama 类可以导入")
    except ImportError as e:
        print(f"✗ 无法导入 Llama 类: {e}")
        return False
    print()
    
    # 3. 检查是否有 GGUF 模型
    from model_loader import find_gguf_model_path
    service_dir = os.path.dirname(os.path.abspath(__file__))
    gguf_model_path = find_gguf_model_path(service_dir)
    
    if not gguf_model_path:
        print("✗ 未找到 GGUF 模型文件")
        return False
    
    print(f"✓ 找到模型: {gguf_model_path}")
    print()
    
    # 4. 尝试加载模型并检查 GPU 使用
    print("尝试加载模型（使用 n_gpu_layers=-1）...")
    try:
        from llama_cpp import Llama
        
        # 先尝试用 GPU
        print("\n[测试1] 使用 n_gpu_layers=-1 (所有GPU层)...")
        try:
            llm_gpu = Llama(
                model_path=gguf_model_path,
                n_ctx=512,  # 小上下文用于测试
                n_gpu_layers=-1,  # 使用所有 GPU 层
                verbose=True,  # 启用详细输出
                use_mmap=True,
                use_mlock=False,
            )
            print("✓ 模型加载成功（GPU模式）")
            
            # 检查模型信息
            if hasattr(llm_gpu, 'ctx'):
                print(f"  模型上下文已创建")
            
            # 尝试一个简单的推理来检查GPU使用
            print("\n执行测试推理...")
            import time
            start = time.time()
            result = llm_gpu("你好", max_tokens=5, temperature=0.1)
            elapsed = time.time() - start
            print(f"✓ 推理完成，耗时: {elapsed:.2f}s")
            print(f"  输出: {result['choices'][0]['text']}")
            
            # 清理
            del llm_gpu
            
        except Exception as e:
            print(f"✗ GPU模式加载失败: {e}")
            import traceback
            traceback.print_exc()
            
            # 尝试CPU模式作为对比
            print("\n[测试2] 尝试 CPU 模式 (n_gpu_layers=0)...")
            try:
                llm_cpu = Llama(
                    model_path=gguf_model_path,
                    n_ctx=512,
                    n_gpu_layers=0,  # 不使用GPU
                    verbose=True,
                    use_mmap=True,
                    use_mlock=False,
                )
                print("✓ 模型加载成功（CPU模式）")
                print("⚠️  警告: 模型在CPU模式下运行，性能会很慢！")
                
                # 测试推理
                print("\n执行测试推理（CPU模式）...")
                start = time.time()
                result = llm_cpu("你好", max_tokens=5, temperature=0.1)
                elapsed = time.time() - start
                print(f"✓ 推理完成，耗时: {elapsed:.2f}s")
                print(f"  输出: {result['choices'][0]['text']}")
                
                del llm_cpu
                
            except Exception as e2:
                print(f"✗ CPU模式也失败: {e2}")
                return False
        
    except Exception as e:
        print(f"✗ 模型加载失败: {e}")
        import traceback
        traceback.print_exc()
        return False
    
    print()
    print("=" * 60)
    print("检查完成")
    print("=" * 60)
    
    return True

def check_cuda_environment():
    """检查 CUDA 环境"""
    print("=" * 60)
    print("检查 CUDA 环境")
    print("=" * 60)
    print()
    
    # 检查 PyTorch CUDA
    try:
        import torch
        print(f"✓ PyTorch 版本: {torch.__version__}")
        print(f"  CUDA 可用: {torch.cuda.is_available()}")
        if torch.cuda.is_available():
            print(f"  CUDA 版本: {torch.version.cuda}")
            print(f"  GPU 数量: {torch.cuda.device_count()}")
            for i in range(torch.cuda.device_count()):
                print(f"  GPU {i}: {torch.cuda.get_device_name(i)}")
                props = torch.cuda.get_device_properties(i)
                print(f"    总内存: {props.total_memory / 1024**3:.2f} GB")
    except ImportError:
        print("⚠️  PyTorch 未安装（不影响 llama.cpp）")
    print()
    
    # 检查环境变量
    print("CUDA 相关环境变量:")
    cuda_vars = ['CUDA_HOME', 'CUDA_PATH', 'CUDA_VISIBLE_DEVICES', 'PATH']
    for var in cuda_vars:
        value = os.environ.get(var, '未设置')
        if var == 'PATH':
            # PATH 可能很长，只显示是否包含 CUDA
            path_val = os.environ.get(var, '')
            has_cuda = 'cuda' in path_val.lower() or 'CUDA' in path_val
            print(f"  {var}: {'包含CUDA' if has_cuda else '未包含CUDA'}")
        else:
            print(f"  {var}: {value}")
    print()

if __name__ == "__main__":
    check_cuda_environment()
    print()
    check_llama_cpp_gpu()
