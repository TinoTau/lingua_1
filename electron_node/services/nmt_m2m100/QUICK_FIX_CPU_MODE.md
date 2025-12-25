# NMT 服务快速修复：强制使用 CPU 模式

如果 NMT 服务因为 CUDA 相关问题崩溃，可以临时强制使用 CPU 模式。

## 修改方法

编辑文件: `electron_node/services/nmt_m2m100/nmt_service.py`

**第 20 行**，将：
```python
DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
```

改为：
```python
# 临时强制使用 CPU（用于诊断 CUDA 问题）
DEVICE = torch.device("cpu")
```

## 说明

- **CPU 模式**: 速度较慢，但更稳定
- **GPU 模式**: 速度快，但可能有兼容性问题

如果 CPU 模式可以正常工作，说明问题出在 CUDA 相关配置上。

## 恢复 GPU 模式

确认 CUDA 问题解决后，可以恢复自动检测：
```python
DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
```

