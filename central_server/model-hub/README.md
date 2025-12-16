# Model Hub 服务

模型库服务，提供模型元数据管理和下载服务。

## 功能概述

Model Hub 是 Lingua 系统的模型管理服务，提供以下功能：

### 1. 模型元数据管理
- **模型列表查询**: 获取所有可用模型的列表
- **模型详情查询**: 获取单个模型的详细信息
- **版本管理**: 支持多版本模型管理
- **元数据格式**: 支持 v3 格式，兼容旧格式

### 2. 模型文件下载
- **文件下载**: 提供模型文件的 HTTP 下载服务
- **断点续传**: 支持 HTTP Range 请求，实现断点续传
- **路径安全**: 防止路径遍历攻击
- **文件校验**: 提供 SHA256 校验和

### 3. 模型统计
- **热门模型排行**: 提供模型使用排行榜
- **使用统计**: 记录模型请求次数（待实现）

## API 端点

### 基础信息

- `GET /` - 服务信息
  - 返回: `{"message": "Lingua Model Hub Service v3", "version": "3.0.0"}`

### 模型查询

- `GET /api/models` - 获取模型列表
  - 返回: `List[ModelInfo]`
  - 说明: 返回所有可用模型的列表，包括版本信息

- `GET /api/models/{model_id}` - 获取单个模型信息
  - 参数: `model_id` - 模型 ID
  - 返回: `ModelInfo`
  - 说明: 返回指定模型的详细信息

### 文件下载

- `GET /storage/models/{model_id}/{version}/{file_path}` - 下载模型文件
  - 参数:
    - `model_id` - 模型 ID
    - `version` - 版本号
    - `file_path` - 文件路径（支持子目录）
  - 支持: HTTP Range 请求（断点续传）
  - 说明: 下载指定版本的模型文件

### 统计信息

- `GET /api/model-usage/ranking` - 获取热门模型排行榜
  - 返回: `List[ModelRankingItem]`
  - 说明: 返回模型使用排行榜

## 数据模型

### ModelInfo
```json
{
  "id": "whisper-large-v3-zh",
  "name": "Whisper Large V3 ZH",
  "task": "asr",
  "languages": ["zh", "en"],
  "default_version": "1.0.0",
  "versions": [
    {
      "version": "1.0.0",
      "size_bytes": 1234567890,
      "files": [
        {
          "path": "model.bin",
          "size_bytes": 1234567890
        }
      ],
      "checksum_sha256": "...",
      "updated_at": "2025-01-01T00:00:00"
    }
  ]
}
```

### ModelVersion
```json
{
  "version": "1.0.0",
  "size_bytes": 1234567890,
  "files": [
    {
      "path": "model.bin",
      "size_bytes": 1234567890
    }
  ],
  "checksum_sha256": "...",
  "updated_at": "2025-01-01T00:00:00"
}
```

## 配置

### 环境变量

- `MODELS_DIR` - 模型存储目录（默认: `./models`）
  - 模型文件存储在: `{MODELS_DIR}/storage/{model_id}/{version}/`
  - 元数据文件: `{MODELS_DIR}/metadata.json`

### 目录结构

```
models/
├── storage/              # 模型文件存储目录
│   ├── {model_id}/      # 模型 ID 目录
│   │   ├── {version}/   # 版本目录
│   │   │   ├── model.bin
│   │   │   ├── config.json
│   │   │   └── checksum.sha256
│   │   └── ...
│   └── ...
└── metadata.json         # 模型元数据文件（可选）
```

## 启动

### 使用启动脚本（推荐）

```powershell
.\scripts\start_model_hub.ps1
```

### 手动启动

```bash
# 1. 进入项目目录
cd central_server/model-hub

# 2. 创建虚拟环境（如果不存在）
python -m venv venv

# 3. 激活虚拟环境
# Windows:
.\venv\Scripts\activate
# Linux/macOS:
source venv/bin/activate

# 4. 安装依赖
pip install -r requirements.txt

# 5. 设置环境变量（可选）
$env:MODELS_DIR = "D:\path\to\models"

# 6. 启动服务
python src/main.py
```

### 使用 uvicorn 启动

```bash
uvicorn src.main:app --host 0.0.0.0 --port 5000 --reload
```

## 服务地址

- **默认端口**: 5000
- **服务地址**: `http://localhost:5000`
- **API 文档**: `http://localhost:5000/docs` (FastAPI 自动生成)

## 依赖

- Python 3.10+
- FastAPI
- uvicorn
- pydantic

详细依赖列表请参考 `requirements.txt`。

## 功能特性

### 1. 元数据格式支持

- **v3 格式**: 新的统一格式
- **旧格式兼容**: 自动转换旧格式元数据
- **文件系统扫描**: 如果没有元数据文件，自动从文件系统扫描模型

### 2. 文件下载特性

- **Range 请求支持**: 支持 HTTP Range 请求，实现断点续传
- **路径安全**: 防止路径遍历攻击（`../` 等）
- **文件校验**: 自动生成和提供 SHA256 校验和

### 3. CORS 支持

- 允许所有来源（开发环境）
- 生产环境建议配置具体的允许来源

## 使用示例

### 获取模型列表

```bash
curl http://localhost:5000/api/models
```

### 获取单个模型信息

```bash
curl http://localhost:5000/api/models/whisper-large-v3-zh
```

### 下载模型文件

```bash
# 完整下载
curl http://localhost:5000/storage/models/whisper-large-v3-zh/1.0.0/model.bin -o model.bin

# 断点续传（Range 请求）
curl -H "Range: bytes=0-1023" http://localhost:5000/storage/models/whisper-large-v3-zh/1.0.0/model.bin -o model.bin.part1
```

### 获取热门模型排行

```bash
curl http://localhost:5000/api/model-usage/ranking
```

## 注意事项

1. **模型文件存储**: 确保 `MODELS_DIR` 目录有足够的存储空间
2. **权限设置**: 确保服务有读取模型文件的权限
3. **网络配置**: 生产环境建议配置防火墙和访问控制
4. **性能优化**: 大文件下载建议使用 CDN 或对象存储服务

## 故障排除

### 问题：服务无法启动

- 检查 Python 版本（需要 3.10+）
- 检查依赖是否已安装
- 检查端口 5000 是否被占用

### 问题：无法访问模型文件

- 检查 `MODELS_DIR` 环境变量是否正确
- 检查模型文件是否存在
- 检查文件权限

### 问题：元数据格式错误

- 检查 `metadata.json` 格式是否正确
- 如果格式错误，可以删除文件，服务会从文件系统扫描

## 相关文档

- **中央服务器文档**: `../docs/README.md`
- **模型管理文档**: `../docs/modelManager/README.md`
