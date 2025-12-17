# 调度服务器数据统计仪表盘

## 功能概述

调度服务器提供了一个Web仪表盘页面，用于实时查看系统统计数据，包括：

### Web端统计

1. **当前活跃用户数** - 显示当前建立了WebSocket连接的Web端用户数量
2. **最热门的十种语言** - 显示使用频率最高的前10种语言
3. **每种语言的使用统计** - 显示每种语言作为源语言和目标语言的使用次数

### 节点端统计

1. **当前连接的节点数** - 显示当前在线的节点数量
2. **可用模型列表** - 显示Model Hub中所有可用的模型
3. **模型算力提供统计** - 显示每种模型有多少节点正在提供算力

## 访问方式

启动调度服务器后，访问以下地址：

```
http://localhost:5010/dashboard
```

## API端点

### 获取统计数据

```
GET /api/v1/stats
```

返回JSON格式的统计数据：

```json
{
  "web_clients": {
    "active_users": 10,
    "top_languages": [
      {"language": "zh", "count": 25},
      {"language": "en", "count": 20}
    ],
    "language_usage": {
      "zh": {
        "as_source": 15,
        "as_target": 10,
        "total": 25
      },
      "en": {
        "as_source": 10,
        "as_target": 10,
        "total": 20
      }
    }
  },
  "nodes": {
    "connected_nodes": 5,
    "available_models": [
      {
        "model_id": "whisper-base@1.0.0",
        "kind": "asr",
        "src_lang": "zh",
        "tgt_lang": null
      }
    ],
    "model_node_counts": {
      "whisper-base@1.0.0": 3,
      "m2m100-zh-en@1.0.0": 2
    }
  }
}
```

## 功能特性

1. **实时更新** - 页面每5秒自动刷新统计数据
2. **响应式设计** - 适配不同屏幕尺寸
3. **数据可视化** - 使用表格和卡片展示统计数据
4. **错误处理** - 显示加载状态和错误信息

## 数据来源

### Web端数据

- **活跃用户数**: 从 `SessionConnectionManager` 获取当前WebSocket连接数
- **语言统计**: 从 `SessionManager` 中的会话信息统计
  - 统计会话的 `src_lang` 和 `tgt_lang`
  - 支持双向模式（`mode == "two_way_auto"`）下的 `lang_a` 和 `lang_b`

### 节点端数据

- **连接节点数**: 从 `NodeRegistry` 中统计 `online == true` 的节点数
- **可用模型列表**: 通过HTTP API从Model Hub服务获取（`http://localhost:5000/api/models`）
- **模型节点统计**: 从节点的 `capability_state` 或 `installed_models` 统计每种模型的可用节点数

## 配置

### Model Hub地址

如果Model Hub运行在不同的地址，可以通过环境变量配置：

```bash
export MODEL_HUB_URL=http://localhost:5000
```

## 技术实现

### 后端

- **统计模块**: `src/stats.rs` - 负责收集和聚合统计数据
- **API端点**: `src/main.rs` - 提供 `/api/v1/stats` 和 `/dashboard` 路由
- **HTML页面**: `dashboard.html` - 嵌入到二进制文件中的前端页面

### 前端

- **纯HTML/JavaScript** - 无需额外依赖
- **Fetch API** - 用于请求统计数据
- **自动刷新** - 使用 `setInterval` 每5秒更新一次

## 依赖

新增依赖：
- `reqwest` - 用于调用Model Hub HTTP API

## 注意事项

1. **Model Hub服务** - 需要确保Model Hub服务正在运行（默认端口5000），否则模型列表将为空
2. **性能考虑** - 统计数据是实时计算的，大量会话和节点可能会影响性能
3. **数据准确性** - 统计数据基于当前内存中的状态，服务器重启后会重置

## 未来改进

- [ ] 添加历史数据记录和图表
- [ ] 支持数据导出（CSV/JSON）
- [ ] 添加更多统计维度（如请求处理时间、错误率等）
- [ ] 支持自定义刷新间隔
- [ ] 添加数据过滤和搜索功能

