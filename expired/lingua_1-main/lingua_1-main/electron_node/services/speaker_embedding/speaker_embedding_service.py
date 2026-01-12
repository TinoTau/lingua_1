#!/usr/bin/env python3
"""
Speaker Embedding HTTP 服务

用于从 Rust 代码调用 SpeechBrain ECAPA-TDNN 模型提取说话者特征向量。

使用方法：
    python speaker_embedding_service.py [--gpu] [--port PORT] [--host HOST]

参数：
    --gpu: 使用 GPU（如果可用）
    --port: 服务端口（默认：5003）
    --host: 服务地址（默认：127.0.0.1）

服务将在 http://127.0.0.1:5003 启动

API 端点：
    GET  /health - 健康检查
    POST /extract - 提取 speaker embedding
    Body: {"audio": [0.1, 0.2, ...]}  # 16kHz 单声道音频数据（f32）
    Response: {"embedding": [0.1, 0.2, ...], "dimension": 192, ...}
"""

import sys
import os
import argparse
from pathlib import Path

# 添加项目路径
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

# 修复 torchaudio 兼容性问题（必须在导入 SpeechBrain 之前）
def fix_torchaudio_compatibility():
    """修复 torchaudio 2.9+ 兼容性问题"""
    try:
        import torchaudio
        # torchaudio 2.9+ 移除了 list_audio_backends 方法
        if not hasattr(torchaudio, 'list_audio_backends'):
            # 创建模拟函数
            def mock_list_audio_backends():
                return ['soundfile']  # 默认后端
            torchaudio.list_audio_backends = mock_list_audio_backends
    except ImportError:
        pass  # torchaudio 未安装，稍后会报错

# 在导入其他模块之前应用修复
fix_torchaudio_compatibility()

# 进一步修复：在 SpeechBrain 导入前修补其 backend 检查模块
def patch_speechbrain_backend_check():
    """在 SpeechBrain 导入前修补 backend 检查"""
    import types
    
    # 创建模拟的 backend 检查模块
    backend_module_name = 'speechbrain.utils.torch_audio_backend'
    
    # 如果模块还未导入，创建并注册
    if backend_module_name not in sys.modules:
        backend_module = types.ModuleType(backend_module_name)
        
        def patched_check_torchaudio_backend():
            """修补的检查函数，跳过 list_audio_backends 调用"""
            try:
                import torchaudio
                if not hasattr(torchaudio, '__version__'):
                    raise RuntimeError("torchaudio not properly installed")
            except ImportError:
                raise RuntimeError("torchaudio is not installed. Install it with: pip install torchaudio")

        def patched_validate_backend():
            return patched_check_torchaudio_backend()

        def get_audio_backend():
            return "soundfile"

        def set_audio_backend(_backend: str):
            return None

        backend_module.check_torchaudio_backend = patched_check_torchaudio_backend
        backend_module.validate_backend = patched_validate_backend
        backend_module.get_audio_backend = get_audio_backend
        backend_module.set_audio_backend = set_audio_backend
        sys.modules[backend_module_name] = backend_module

# 应用修补（必须在导入 SpeechBrain 之前）
patch_speechbrain_backend_check()

# 修复 huggingface_hub 兼容性问题
def patch_huggingface_hub():
    """修复 huggingface_hub 的 use_auth_token 参数兼容性问题"""
    try:
        import huggingface_hub
        import functools
        
        original_hf_hub_download = huggingface_hub.hf_hub_download
        
        @functools.wraps(original_hf_hub_download)
        def patched_hf_hub_download(*args, **kwargs):
            """修补的 hf_hub_download，将 use_auth_token 转换为 token"""
            if 'use_auth_token' in kwargs:
                token = kwargs.pop('use_auth_token')
                if token is not None and 'token' not in kwargs:
                    kwargs['token'] = token
            return original_hf_hub_download(*args, **kwargs)
        
        huggingface_hub.hf_hub_download = patched_hf_hub_download
    except ImportError:
        pass
    except Exception as e:
        print(f"⚠️  Failed to patch huggingface_hub: {e}")

# 应用 huggingface_hub 修补
patch_huggingface_hub()

# 现在可以安全导入其他模块
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List
import numpy as np
import torch

app = FastAPI(title="Speaker Embedding Service", version="1.0.0")

# 添加 CORS 支持
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

classifier = None
device = None

def get_device(use_gpu=False):
    """获取计算设备"""
    if use_gpu and torch.cuda.is_available():
        device = "cuda"
        print(f"✅ Using GPU: {torch.cuda.get_device_name(0)}")
    else:
        device = "cpu"
        if use_gpu:
            print("⚠️  GPU requested but not available, using CPU")
        else:
            print("ℹ️  Using CPU")
    return device

def load_model(model_path, device="cpu"):
    """加载 SpeechBrain ECAPA-TDNN 模型"""
    global classifier
    
    # 确保兼容性修复已应用
    fix_torchaudio_compatibility()
    patch_speechbrain_backend_check()
    patch_huggingface_hub()
    
    try:
        from speechbrain.inference.speaker import EncoderClassifier
        
        if not model_path.exists():
            raise FileNotFoundError(f"Model not found at {model_path}")
        
        print(f"📁 Loading model from: {model_path}")
        print(f"🔧 Device: {device}")
        
        classifier = EncoderClassifier.from_hparams(
            source=str(model_path),
            run_opts={"device": device}
        )
        
        print("✅ Speaker Embedding model loaded successfully")
        print(f"   Model output dimension: 192")
        print(f"   Device: {device}")
        
        return classifier
    except Exception as e:
        print(f"❌ Failed to load model: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

class ExtractRequest(BaseModel):
    audio: List[float]

class ExtractResponse(BaseModel):
    embedding: Optional[List[float]] = None
    dimension: Optional[int] = None
    input_samples: Optional[int] = None
    sample_rate: Optional[int] = None
    too_short: Optional[bool] = None
    use_default: Optional[bool] = None
    estimated_gender: Optional[str] = None
    message: Optional[str] = None

@app.get("/health")
async def health():
    """健康检查端点"""
    return {
        "status": "ok",
        "model_loaded": classifier is not None
    }

@app.post("/extract", response_model=ExtractResponse)
async def extract_embedding(request: ExtractRequest):
    """提取说话者特征向量"""
    try:
        # 获取音频数据
        try:
            audio_data = np.array(request.audio, dtype=np.float32)
        except (ValueError, TypeError) as e:
            raise HTTPException(status_code=400, detail=f"Invalid audio data: {str(e)}")
        
        # 验证音频数据
        if len(audio_data) == 0:
            raise HTTPException(status_code=400, detail="Empty audio data")
        
        # 检查模型是否加载
        if classifier is None:
            raise HTTPException(status_code=500, detail="Model not loaded")
        
        # 检查音频长度，ECAPA-TDNN 需要至少 1 秒的音频（16000 样本）
        min_samples = 16000  # 1 秒 @ 16kHz
        if len(audio_data) < min_samples:
            # 音频太短，无法提取 embedding，返回标记使用默认声音
            # 尝试简单判断性别（基于音频能量和频率特征）
            audio_array = np.array(audio_data, dtype=np.float32)
            rms = np.sqrt(np.mean(audio_array ** 2))
            estimated_gender = "male" if rms > 0.01 else "female"
            
            return ExtractResponse(
                embedding=None,
                too_short=True,
                use_default=True,
                estimated_gender=estimated_gender,
                input_samples=len(audio_data),
                sample_rate=16000,
                message=f"Audio too short ({len(audio_data)} samples < {min_samples} required), using default voice"
            )
        
        # 转换为 tensor [batch, samples]
        audio_tensor = torch.from_numpy(audio_data).unsqueeze(0)
        
        # 移动到正确的设备
        current_device = device if device else "cpu"
        if current_device != "cpu":
            audio_tensor = audio_tensor.to(current_device)
        
        # 提取 embedding
        # 输出形状：[batch, 1, 192]
        embeddings = classifier.encode_batch(audio_tensor)
        
        # 转换为列表 [192]（确保移回 CPU）
        embedding = embeddings.squeeze().cpu().numpy()
        
        # 确保是 1D 数组
        if embedding.ndim > 1:
            embedding = embedding.flatten()
        
        embedding_list = embedding.tolist()
        
        return ExtractResponse(
            embedding=embedding_list,
            dimension=len(embedding_list),
            input_samples=len(audio_data),
            sample_rate=16000,
            too_short=False,
            use_default=False,
            estimated_gender=None,
            message=None
        )
        
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        error_msg = str(e)
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=error_msg)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="Speaker Embedding HTTP Service")
    parser.add_argument('--gpu', action='store_true', help='Use GPU if available')
    parser.add_argument('--port', type=int, default=5003, help='Server port (default: 5003)')
    parser.add_argument('--host', type=str, default='127.0.0.1', help='Server host (default: 127.0.0.1)')
    args = parser.parse_args()
    
    print("=" * 60)
    print("  Speaker Embedding HTTP Service")
    print("=" * 60)
    
    # 确定模型路径 - 只在自己的服务目录下查找，找不到直接报错
    service_dir = Path(__file__).parent
    model_path = service_dir / "models" / "speaker_embedding" / "cache"
    if not model_path.exists():
        print(f"❌ Model not found at {model_path}")
        print(f"   Please ensure the Speaker Embedding model is placed in the service directory.")
        print(f"   Expected path: {model_path.resolve()}")
        sys.exit(1)
    
    # 获取设备
    device = get_device(args.gpu)
    
    # 加载模型
    try:
        print("\n🔧 Applying compatibility fixes...")
        fix_torchaudio_compatibility()
        patch_speechbrain_backend_check()
        print("✅ Compatibility fixes applied")
        
        load_model(model_path, device)
    except Exception as e:
        print(f"\n❌ Failed to start service: {e}")
        print("\n💡 Troubleshooting:")
        print("   1. Install dependencies: pip install speechbrain torch 'torchaudio<2.9' soundfile fastapi uvicorn")
        print("   2. Download model using: python download_speaker_embedding_model.py")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    
    print(f"\n🚀 Starting server on http://{args.host}:{args.port}")
    print("   Endpoints:")
    print("     GET  /health  - Health check")
    print("     POST /extract - Extract speaker embedding")
    print(f"   Device: {device}")
    print("\n   Press Ctrl+C to stop")
    print("=" * 60)
    
    import uvicorn
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")

