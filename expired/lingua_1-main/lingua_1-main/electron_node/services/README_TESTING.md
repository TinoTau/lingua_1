# 新增服务测试指南

## 测试前准备

### 1. 启动服务

这些服务需要通过节点端的服务管理器启动，或者手动启动：

#### 方式1: 通过节点端服务管理器启动（推荐）

节点端会自动发现并启动已安装的服务。确保：
1. 服务已正确安装到 `electron_node/services/` 目录
2. 节点端服务已启动
3. 服务已注册到服务注册表

#### 方式2: 手动启动服务（用于测试）

**启动 en_normalize 服务：**
```bash
cd electron_node/services/en_normalize
python -m en_normalize_service
# 或
python en_normalize_service.py
```

**启动 semantic_repair_zh 服务：**
```bash
cd electron_node/services/semantic_repair_zh
python -m semantic_repair_zh_service
# 或
python semantic_repair_zh_service.py
```

**启动 semantic_repair_en 服务：**
```bash
cd electron_node/services/semantic_repair_en
python -m semantic_repair_en_service
# 或
python semantic_repair_en_service.py
```

### 2. 检查服务状态

服务启动后，应该监听以下端口：
- `en-normalize`: 5012
- `semantic-repair-zh`: 5010
- `semantic-repair-en`: 5011

可以使用以下命令检查：
```bash
# Windows PowerShell
Test-NetConnection -ComputerName localhost -Port 5012
Test-NetConnection -ComputerName localhost -Port 5010
Test-NetConnection -ComputerName localhost -Port 5011
```

### 3. 运行测试

```bash
cd electron_node/services
python test_new_services.py
```

## 测试内容

### 健康检查测试
- 测试所有服务的 `/health` 端点
- 验证服务状态和模型加载情况

### 功能测试

#### en_normalize 服务
- 基础文本标准化（大小写、空格、标点）
- 缩写保护
- URL/邮箱检测
- 非英文文本处理（应返回PASS）

#### semantic_repair_zh 服务
- 基础修复功能
- 低质量文本触发修复
- 非中文文本处理（应返回PASS）

#### semantic_repair_en 服务
- 基础修复功能
- 低质量文本触发修复
- 非英文文本处理（应返回PASS）

## 注意事项

1. **模型加载时间**：`semantic_repair_zh` 和 `semantic_repair_en` 服务需要加载LLM模型，首次启动可能需要较长时间（几分钟）
2. **GPU要求**：语义修复服务需要GPU支持（或使用CPU模式，但会很慢）
3. **依赖安装**：确保已安装所有依赖：
   ```bash
   pip install -r requirements.txt
   ```

## 故障排查

### 服务无法启动
1. 检查Python版本（需要Python 3.8+）
2. 检查依赖是否安装完整
3. 检查端口是否被占用
4. 查看服务日志

### 模型加载失败
1. 检查模型文件是否存在
2. 检查模型路径配置
3. 检查GPU/CUDA是否可用
4. 查看详细错误日志

### 测试超时
1. 模型可能正在加载，等待更长时间
2. 检查服务是否正常运行
3. 检查网络连接
