"""
Lingua Model Hub Service
模型库服务，提供模型元数据管理和下载服务
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
import os
import json
from pathlib import Path

app = FastAPI(title="Lingua Model Hub", version="0.1.0")

# CORS 配置
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 模型元数据存储路径
MODELS_DIR = Path(os.getenv("MODELS_DIR", "./models"))
METADATA_DIR = MODELS_DIR
METADATA_FILE = METADATA_DIR / "metadata.json"


class ModelMetadata(BaseModel):
    model_id: str
    model_type: str  # ASR, NMT, TTS, VAD
    name: str
    version: str
    src_lang: Optional[str] = None
    tgt_lang: Optional[str] = None
    dialect: Optional[str] = None
    size_bytes: int
    download_url: str
    sha256: str
    status: str  # Stable, Beta, Deprecated


def load_metadata() -> List[ModelMetadata]:
    """加载模型元数据"""
    if not METADATA_FILE.exists():
        return []
    
    with open(METADATA_FILE, 'r', encoding='utf-8') as f:
        data = json.load(f)
        return [ModelMetadata(**item) for item in data]


def save_metadata(models: List[ModelMetadata]):
    """保存模型元数据"""
    METADATA_DIR.mkdir(parents=True, exist_ok=True)
    with open(METADATA_FILE, 'w', encoding='utf-8') as f:
        json.dump([model.dict() for model in models], f, indent=2, ensure_ascii=False)


@app.get("/")
async def root():
    return {"message": "Lingua Model Hub Service"}


@app.get("/api/v1/models", response_model=List[ModelMetadata])
async def list_models(
    model_type: Optional[str] = None,
    src_lang: Optional[str] = None,
    tgt_lang: Optional[str] = None,
):
    """获取模型列表"""
    models = load_metadata()
    
    # 过滤
    if model_type:
        models = [m for m in models if m.model_type == model_type]
    if src_lang:
        models = [m for m in models if m.src_lang == src_lang]
    if tgt_lang:
        models = [m for m in models if m.tgt_lang == tgt_lang]
    
    return models


@app.get("/api/v1/models/{model_id}", response_model=ModelMetadata)
async def get_model(model_id: str):
    """获取单个模型信息"""
    models = load_metadata()
    model = next((m for m in models if m.model_id == model_id), None)
    
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    
    return model


@app.post("/api/v1/models", response_model=ModelMetadata)
async def register_model(model: ModelMetadata):
    """注册新模型"""
    models = load_metadata()
    
    # 检查是否已存在
    if any(m.model_id == model.model_id for m in models):
        raise HTTPException(status_code=400, detail="Model already exists")
    
    models.append(model)
    save_metadata(models)
    
    return model


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=5000)

