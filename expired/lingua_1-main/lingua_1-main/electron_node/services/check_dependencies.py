# -*- coding: utf-8 -*-
"""
检查所有服务的依赖安装情况
"""

import sys
import importlib

def check_package(package_name, import_name=None):
    """检查包是否已安装"""
    if import_name is None:
        import_name = package_name.replace('-', '_')
    try:
        mod = importlib.import_module(import_name)
        version = getattr(mod, '__version__', 'unknown')
        return True, version
    except ImportError:
        return False, None
    except Exception as e:
        return False, str(e)

def check_torch_cuda():
    """检查PyTorch CUDA支持"""
    try:
        import torch
        version = torch.__version__
        cuda_available = torch.cuda.is_available()
        cuda_version = torch.version.cuda if hasattr(torch.version, 'cuda') else None
        return {
            'installed': True,
            'version': version,
            'cuda_available': cuda_available,
            'cuda_compiled': cuda_version,
            'is_cpu_version': '+cpu' in version or (cuda_version is None and not cuda_available)
        }
    except ImportError:
        return {'installed': False}

def check_onnxruntime_gpu():
    """检查ONNX Runtime GPU支持"""
    try:
        import onnxruntime
        version = onnxruntime.__version__
        providers = onnxruntime.get_available_providers()
        cuda_available = 'CUDAExecutionProvider' in providers
        return {
            'installed': True,
            'version': version,
            'cuda_available': cuda_available,
            'providers': providers
        }
    except ImportError:
        return {'installed': False}

def main():
    print("=" * 80)
    print("服务依赖检查报告")
    print("=" * 80)
    
    # 检查PyTorch
    print("\n[PyTorch]")
    torch_info = check_torch_cuda()
    if torch_info.get('installed'):
        print(f"  版本: {torch_info['version']}")
        print(f"  CUDA 可用: {torch_info['cuda_available']}")
        print(f"  CUDA 编译版本: {torch_info.get('cuda_compiled', 'None')}")
        if torch_info.get('is_cpu_version'):
            print("  ⚠️  警告: 这是 CPU 版本，需要安装 CUDA 版本")
            print("  安装命令: pip install torch>=2.0.0 --index-url https://download.pytorch.org/whl/cu121")
        else:
            print("  ✅ CUDA 版本已安装")
    else:
        print("  ❌ 未安装")
    
    # 检查语义修复服务依赖
    print("\n[语义修复服务依赖]")
    semantic_deps = {
        'transformers': 'transformers',
        'fastapi': 'fastapi',
        'uvicorn': 'uvicorn',
        'pydantic': 'pydantic',
        'bitsandbytes': 'bitsandbytes',
        'accelerate': 'accelerate',
        'optimum': 'optimum',
        'auto-gptq': 'auto_gptq',
        'psutil': 'psutil',
    }
    
    for pkg_name, import_name in semantic_deps.items():
        installed, version = check_package(pkg_name, import_name)
        if installed:
            print(f"  ✅ {pkg_name}: {version}")
        else:
            print(f"  ❌ {pkg_name}: 未安装")
    
    # 检查ONNX Runtime
    print("\n[ONNX Runtime]")
    onnx_info = check_onnxruntime_gpu()
    if onnx_info.get('installed'):
        print(f"  版本: {onnx_info['version']}")
        print(f"  CUDA 可用: {onnx_info['cuda_available']}")
        print(f"  可用提供程序: {', '.join(onnx_info['providers'])}")
        if not onnx_info['cuda_available']:
            print("  ⚠️  警告: 未安装 GPU 版本，需要安装 onnxruntime-gpu")
    else:
        print("  ❌ 未安装")
    
    # 检查其他服务依赖
    print("\n[其他服务依赖]")
    other_deps = {
        'faster-whisper': ('faster_whisper', None),
        'piper-tts': ('piper_tts', None),
        'TTS': ('TTS', '__version__'),
        'speechbrain': ('speechbrain', '__version__'),
    }
    
    for pkg_name, (import_name, version_attr) in other_deps.items():
        installed, version = check_package(pkg_name, import_name)
        if installed:
            if version_attr and version == 'unknown':
                try:
                    mod = importlib.import_module(import_name)
                    version = getattr(mod, version_attr, 'unknown')
                except:
                    pass
            print(f"  ✅ {pkg_name}: {version}")
        else:
            print(f"  ❌ {pkg_name}: 未安装")
    
    print("\n" + "=" * 80)
    print("检查完成")
    print("=" * 80)

if __name__ == '__main__':
    main()
