"""
Lingua Model Hub Service (v3)
模型库服务，提供模型元数据管理和下载服务
符合 v3 技术方案规范
"""

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import List, Optional, Dict
import os
import json
import hashlib
from pathlib import Path
from datetime import datetime

app = FastAPI(title="Lingua Model Hub", version="3.0.0")

# CORS 配置
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 模型存储路径
MODELS_DIR = Path(os.getenv("MODELS_DIR", "./models"))
STORAGE_DIR = MODELS_DIR / "storage"
METADATA_FILE = MODELS_DIR / "metadata.json"

# 确保目录存在
STORAGE_DIR.mkdir(parents=True, exist_ok=True)


# ===== v3 API 数据模型 =====

class ModelFileInfo(BaseModel):
    path: str
    size_bytes: int


class ModelVersion(BaseModel):
    version: str
    size_bytes: int
    files: List[ModelFileInfo]
    checksum_sha256: str
    updated_at: str


class ModelInfo(BaseModel):
    id: str
    name: str
    task: str  # asr, nmt, tts, vad
    languages: List[str]
    default_version: str
    versions: List[ModelVersion]


class ModelRankingItem(BaseModel):
    model_id: str
    request_count: int
    rank: int


# ===== 元数据加载和转换 =====

def load_metadata() -> Dict:
    """加载模型元数据"""
    if not METADATA_FILE.exists():
        return {}
    
    with open(METADATA_FILE, 'r', encoding='utf-8') as f:
        return json.load(f)


def convert_to_v3_format(metadata: Dict) -> List[ModelInfo]:
    """将旧格式元数据转换为 v3 格式"""
    models_dict: Dict[str, ModelInfo] = {}
    
    # 如果 metadata 是列表（旧格式），转换为新格式
    if isinstance(metadata, list):
        for item in metadata:
            model_id = item.get('model_id', '')
            version = item.get('version', '1.0.0')
            
            if model_id not in models_dict:
                models_dict[model_id] = ModelInfo(
                    id=model_id,
                    name=item.get('name', model_id),
                    task=item.get('model_type', 'asr').lower(),
                    languages=[item.get('src_lang', ''), item.get('tgt_lang', '')] if item.get('tgt_lang') else [item.get('src_lang', '')],
                    default_version=version,
                    versions=[]
                )
            
            # 添加版本信息
            model_version = ModelVersion(
                version=version,
                size_bytes=item.get('size_bytes', 0),
                files=[
                    ModelFileInfo(
                        path=item.get('download_url', '').split('/')[-1] if item.get('download_url') else 'model.bin',
                        size_bytes=item.get('size_bytes', 0)
                    )
                ],
                checksum_sha256=item.get('sha256', ''),
                updated_at=item.get('updated_at', datetime.now().isoformat())
            )
            models_dict[model_id].versions.append(model_version)
    
    return list(models_dict.values())


def calculate_checksum_sha256(model_id: str, version: str, model_dir: Path = None) -> str:
    """计算模型版本的 checksum.sha256"""
    # 如果提供了model_dir，使用它；否则使用标准storage目录结构
    if model_dir:
        version_dir = model_dir
    else:
        version_dir = STORAGE_DIR / model_id / version
    
    checksum_file = version_dir / "checksum.sha256"
    
    if checksum_file.exists():
        return checksum_file.read_text(encoding='utf-8').strip()
    
    # 确保目录存在
    if not version_dir.exists():
        return "{}"  # 返回空的JSON对象
    
    # 如果没有 checksum 文件，计算所有文件的 SHA256
    checksums = {}
    for file_path in version_dir.glob("*"):
        if file_path.is_file() and file_path.name != "checksum.sha256":
            try:
                with open(file_path, 'rb') as f:
                    file_hash = hashlib.sha256(f.read()).hexdigest()
                    checksums[file_path.name] = file_hash
            except Exception as e:
                # 如果读取文件失败，跳过
                print(f"Warning: Failed to calculate checksum for {file_path}: {e}")
                continue
    
    # 生成 checksum 文件内容（JSON 格式）
    checksum_content = json.dumps(checksums, indent=2)
    
    # 确保目录存在后再写入
    try:
        checksum_file.parent.mkdir(parents=True, exist_ok=True)
        checksum_file.write_text(checksum_content, encoding='utf-8')
    except Exception as e:
        print(f"Warning: Failed to write checksum file {checksum_file}: {e}")
        # 返回计算的内容，即使无法写入文件
    
    return checksum_content


# ===== API 端点 =====

@app.get("/")
async def root():
    return {"message": "Lingua Model Hub Service v3", "version": "3.0.0"}


@app.get("/api/models", response_model=List[ModelInfo])
async def list_models():
    """获取模型列表（v3 格式）"""
    metadata = load_metadata()
    
    # 如果元数据是旧格式，转换
    if isinstance(metadata, list):
        return convert_to_v3_format(metadata)
    
    # 如果元数据是新格式，直接返回
    if isinstance(metadata, dict) and 'models' in metadata:
        return [ModelInfo(**m) for m in metadata['models']]
    
    # 从文件系统扫描模型
    models_dict: Dict[str, ModelInfo] = {}
    
    # 首先尝试从storage目录扫描（标准v3格式）
    # 注意：即使storage目录有模型，我们也会继续扫描旧格式目录，以合并所有模型
    if STORAGE_DIR.exists():
        for model_dir in STORAGE_DIR.iterdir():
            if not model_dir.is_dir():
                continue
            
            model_id = model_dir.name
            versions = []
            
            for version_dir in model_dir.iterdir():
                if not version_dir.is_dir():
                    continue
                
                version = version_dir.name
                files = []
                total_size = 0
                
                for file_path in version_dir.iterdir():
                    if file_path.is_file() and file_path.name != "checksum.sha256":
                        file_size = file_path.stat().st_size
                        files.append(ModelFileInfo(
                            path=file_path.name,
                            size_bytes=file_size
                        ))
                        total_size += file_size
                
            if files:
                checksum = calculate_checksum_sha256(model_id, version, version_dir)
                versions.append(ModelVersion(
                        version=version,
                        size_bytes=total_size,
                        files=files,
                        checksum_sha256=checksum,
                        updated_at=datetime.fromtimestamp(version_dir.stat().st_mtime).isoformat()
                    ))
            
            if versions:
                # 确定默认版本（最新的版本）
                default_version = max(versions, key=lambda v: v.version).version
                
                models_dict[model_id] = ModelInfo(
                    id=model_id,
                    name=model_id.replace('-', ' ').title(),
                    task="asr",  # 默认，可以从 manifest.json 读取
                    languages=["zh", "en"],  # 默认，可以从 manifest.json 读取
                    default_version=default_version,
                    versions=versions
                )
    
    # 尝试从旧格式目录扫描（asr, nmt, tts等）
    if MODELS_DIR.exists():
        # 任务类型到目录名的映射
        task_dirs = {
            "asr": ["asr"],
            "nmt": ["nmt"],
            "tts": ["tts"],
            "vad": ["vad"],
            "emotion": ["emotion"],
            "persona": ["persona"],
            "speaker_embedding": ["speaker_embedding"]
        }
        
        for task, dir_names in task_dirs.items():
            for dir_name in dir_names:
                task_dir = MODELS_DIR / dir_name
                if not task_dir.exists():
                    continue
                
                # 扫描该任务类型下的所有模型目录
                for model_dir in task_dir.iterdir():
                    if not model_dir.is_dir():
                        continue
                    
                    model_id = f"{model_dir.name}"
                    # 如果已经存在同名模型，跳过（优先使用storage目录的）
                    if model_id in models_dict:
                        continue
                    
                    # 检查是否有版本目录，如果没有，将整个目录作为一个版本
                    version_dirs = [d for d in model_dir.iterdir() if d.is_dir()]
                    
                    # 检查根目录是否有文件（可能既有版本目录又有根目录文件）
                    root_files = [f for f in model_dir.iterdir() if f.is_file() and f.name != "checksum.sha256"]
                    
                    versions = []
                    
                    if version_dirs:
                        # 有版本目录结构，扫描版本目录
                        for version_dir in version_dirs:
                            version = version_dir.name
                            files = []
                            total_size = 0
                            
                            for file_path in version_dir.iterdir():
                                if file_path.is_file() and file_path.name != "checksum.sha256":
                                    file_size = file_path.stat().st_size
                                    files.append(ModelFileInfo(
                                        path=file_path.name,
                                        size_bytes=file_size
                                    ))
                                    total_size += file_size
                            
                            if files:
                                checksum = calculate_checksum_sha256(model_id, version, version_dir)
                                versions.append(ModelVersion(
                                    version=version,
                                    size_bytes=total_size,
                                    files=files,
                                    checksum_sha256=checksum,
                                    updated_at=datetime.fromtimestamp(version_dir.stat().st_mtime).isoformat()
                                ))
                    
                    # 如果根目录有文件，也作为一个版本（1.0.0）
                    if root_files:
                        files = []
                        total_size = 0
                        
                        for file_path in root_files:
                            file_size = file_path.stat().st_size
                            files.append(ModelFileInfo(
                                path=file_path.name,
                                size_bytes=file_size
                            ))
                            total_size += file_size
                        
                        if files:
                            versions.append(ModelVersion(
                                version="1.0.0",
                                size_bytes=total_size,
                                files=files,
                                checksum_sha256=calculate_checksum_sha256(model_id, "1.0.0", model_dir),
                                updated_at=datetime.fromtimestamp(model_dir.stat().st_mtime).isoformat()
                            ))
                    
                    if versions:
                        default_version = max(versions, key=lambda v: v.version).version
                        
                        # 从模型ID推断语言（简单规则）
                        languages = ["zh", "en"]  # 默认
                        if "zh" in model_id.lower() or "chinese" in model_id.lower():
                            languages = ["zh"]
                        if "en" in model_id.lower() or "english" in model_id.lower():
                            if "zh" not in languages:
                                languages = ["en"]
                        
                        models_dict[model_id] = ModelInfo(
                            id=model_id,
                            name=model_id.replace('-', ' ').replace('_', ' ').title(),
                            task=task,
                            languages=languages,
                            default_version=default_version,
                            versions=versions
                        )
    
    return list(models_dict.values())


@app.get("/api/models/{model_id}", response_model=ModelInfo)
async def get_model(model_id: str):
    """获取单个模型信息"""
    models = await list_models()
    model = next((m for m in models if m.id == model_id), None)
    
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    
    return model


@app.get("/storage/models/{model_id}/{version}/{file_path:path}")
async def download_model_file(
    model_id: str,
    version: str,
    file_path: str,
    request: Request
):
    """下载模型文件（支持 Range 请求）"""
    # 路径规范化，防止路径遍历攻击
    normalized_path = os.path.normpath(file_path)
    if normalized_path.startswith('..') or os.path.isabs(normalized_path):
        raise HTTPException(status_code=400, detail="Invalid file path")
    
    # 构建完整路径
    full_path = STORAGE_DIR / model_id / version / normalized_path
    
    # 验证路径在允许的目录内
    try:
        full_path.resolve().relative_to(STORAGE_DIR.resolve())
    except ValueError:
        raise HTTPException(status_code=403, detail="Access denied")
    
    # 检查文件是否存在
    if not full_path.exists() or not full_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    
    # 支持 Range 请求
    range_header = request.headers.get('range')
    
    if range_header:
        # 解析 Range 头
        # 格式: bytes=start-end 或 bytes=start-
        range_match = range_header.replace('bytes=', '')
        if '-' in range_match:
            start_str, end_str = range_match.split('-', 1)
            start = int(start_str) if start_str else 0
            end = int(end_str) if end_str else None
        else:
            start = int(range_match)
            end = None
        
        file_size = full_path.stat().st_size
        if end is None:
            end = file_size - 1
        
        # 验证范围
        if start < 0 or end >= file_size or start > end:
            raise HTTPException(status_code=416, detail="Range Not Satisfiable")
        
        # 读取文件片段
        with open(full_path, 'rb') as f:
            f.seek(start)
            content = f.read(end - start + 1)
        
        headers = {
            'Content-Range': f'bytes {start}-{end}/{file_size}',
            'Accept-Ranges': 'bytes',
            'Content-Length': str(len(content)),
            'Content-Type': 'application/octet-stream'
        }
        
        return Response(
            content=content,
            status_code=206,
            headers=headers
        )
    else:
        # 完整文件下载
        return FileResponse(
            path=str(full_path),
            headers={
                'Accept-Ranges': 'bytes',
                'Content-Type': 'application/octet-stream'
            }
        )


@app.get("/api/model-usage/ranking", response_model=List[ModelRankingItem])
async def get_model_ranking():
    """获取热门模型排行榜"""
    # TODO: 从数据库或统计服务获取实际数据
    # 这里返回模拟数据
    return [
        ModelRankingItem(model_id="marian-zh-en", request_count=18234, rank=1),
        ModelRankingItem(model_id="whisper-large-v3-zh", request_count=15321, rank=2),
        ModelRankingItem(model_id="marian-en-ja", request_count=9876, rank=3),
    ]


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=5000)
