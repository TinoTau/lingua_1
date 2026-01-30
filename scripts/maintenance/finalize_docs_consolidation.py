#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
完成文档整理 - 删除重复和过期文档，创建索引
"""

import shutil
from pathlib import Path

ROOT = Path(__file__).parent.parent.parent
CS_DOCS = ROOT / "central_server" / "docs"
SCHED_DOCS = ROOT / "central_server" / "scheduler" / "docs"

def main():
    print("=" * 60)
    print("完成文档整理")
    print("=" * 60)
    
    # 1. 删除scheduler/docs中的旧设计文档（已合并到新ARCHITECTURE.md）
    old_design_files = [
        SCHED_DOCS / "architecture" / "LOCKLESS_MINIMAL_SCHEDULER_SPEC_v1.md",
        SCHED_DOCS / "architecture" / "NODE_RUNTIME_SNAPSHOT_ARCHITECTURE_v1.md",
        SCHED_DOCS / "design" / "POOL_ARCHITECTURE.md",  # 已过期
    ]
    
    print("\n删除已合并的旧文档...")
    for f in old_design_files:
        if f.exists():
            f.unlink()
            print(f"[DELETED] {f.relative_to(ROOT)}")
    
    # 2. 移动有用的设计文档到docs/scheduler
    moves = [
        (SCHED_DOCS / "design" / "NODE_REGISTRATION.md", 
         CS_DOCS / "scheduler" / "NODE_REGISTRATION.md"),
        (SCHED_DOCS / "design" / "MULTI_INSTANCE_DEPLOYMENT.md",
         CS_DOCS / "scheduler" / "MULTI_INSTANCE_DEPLOYMENT.md"),
        (SCHED_DOCS / "design" / "NODE_CAPACITY_CONTROL_MECHANISM.md",
         CS_DOCS / "scheduler" / "NODE_CAPACITY.md"),
    ]
    
    print("\n移动文档到正确位置...")
    for src, dst in moves:
        if src.exists():
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(src), str(dst))
            print(f"[MOVED] {src.relative_to(ROOT)} -> {dst.relative_to(ROOT)}")
    
    # 3. 删除空目录
    empty_dirs = [
        SCHED_DOCS / "architecture",
        SCHED_DOCS / "design",
    ]
    
    print("\n删除空目录...")
    for d in empty_dirs:
        if d.exists() and not list(d.iterdir()):
            d.rmdir()
            print(f"[REMOVED DIR] {d.relative_to(ROOT)}")
    
    # 4. 更新central_server/docs/scheduler的README
    readme = CS_DOCS / "scheduler" / "README.md"
    readme_content = """# Scheduler 文档

**版本**: v2.0  
**架构**: Redis直查架构 + Pool系统

## 核心文档

### 架构文档

- **[ARCHITECTURE.md](../../scheduler/docs/ARCHITECTURE.md)** - 完整架构文档（必读）
  - Redis直查架构（SSOT）
  - Pool系统设计
  - 节点注册和管理
  - 任务分发流程
  - 多实例协调

### 设计文档

- **[NODE_REGISTRATION.md](NODE_REGISTRATION.md)** - 节点注册协议
- **[MULTI_INSTANCE_DEPLOYMENT.md](MULTI_INSTANCE_DEPLOYMENT.md)** - 多实例部署
- **[NODE_CAPACITY.md](NODE_CAPACITY.md)** - 节点容量控制

### 参考文档

- **[DASHBOARD.md](DASHBOARD.md)** - 监控Dashboard
- **[GPU_REQUIREMENT_EXPLANATION.md](GPU_REQUIREMENT_EXPLANATION.md)** - GPU需求说明

## 代码模块

### 核心模块

```
src/
├── redis_runtime/          # Redis运行时和多实例通信
├── pool_hashing/           # Pool选择Hash算法
├── node_registry/          # 节点注册和管理
├── pool/                   # Pool服务
├── core/                   # 核心功能（Dispatcher、Session）
├── websocket/              # WebSocket处理
├── timeout/                # 超时管理
└── managers/               # 各类管理器
```

### 关键流程

1. **节点注册**: `node_registry/core.rs` → Redis写入 → Pool分配
2. **任务分发**: `core/dispatcher/` → 选择Node → 路由消息
3. **结果处理**: `websocket/node_handler/` → 跨实例转发 → 推送到Session

## 快速开始

### 1. 配置文件

编辑 `config.toml`:

```toml
[server]
port = 5010

[redis]
url = "redis://localhost:6379"

[phase2]
instance_id = "auto"

[phase3_pool]
enabled = true
```

### 2. 启动服务

```bash
cargo run --release
```

### 3. 查看Dashboard

访问: http://localhost:5010/dashboard

## 相关文档

- [API Gateway](../api_gateway/README.md)
- [Model Hub](../model_hub/README.md)
- [项目概览](../README.md)

---

**维护**: Scheduler开发组  
**更新**: 2026-01-22
"""
    
    readme.write_text(readme_content, encoding='utf-8')
    print(f"\n[UPDATED] {readme.relative_to(ROOT)}")
    
    print("\n" + "=" * 60)
    print("文档整理完成！")
    print("=" * 60)
    print("\n主要文档:")
    print("  - central_server/scheduler/docs/ARCHITECTURE.md (新建)")
    print("  - central_server/docs/scheduler/README.md (更新)")
    print("\n已删除:")
    print("  - 72个测试报告和临时文档")
    print("  - 5个过期目录")
    print("  - 3个已合并的旧架构文档")

if __name__ == '__main__':
    main()
