# 配置文件加载机制

## 概述

配置文件使用固定的相对路径，简单直接。

## 配置文件类型

### 1. ASR 文本过滤配置 (`asr_filters.json`)

**路径**：`config/asr_filters.json`（相对于服务运行目录）

**加载位置**：`src/text_filter/config.rs`

### 2. 日志观察性配置 (`observability.json`)

**路径**：`config/observability.json`（相对于服务运行目录）

**加载位置**：`src/logging_config.rs`

## 配置加载时机

### 启动顺序

1. **日志配置加载**（`main.rs` 第29行）
   - 在日志系统初始化**之前**加载
   - 使用 `println!` 和 `eprintln!` 输出（因为日志系统尚未初始化）

2. **日志系统初始化**（`main.rs` 第73-76行）
   - 使用加载的日志配置构建日志过滤器

3. **ASR 过滤配置加载**（`main.rs` 第83行）
   - 在日志系统初始化**之后**加载
   - 使用 `tracing::info!` 等日志宏记录加载状态

## 默认配置

如果找不到配置文件，系统会使用默认配置：

- **ASR 过滤配置**：`FilterRules::default()` - 启用括号过滤和空文本过滤
- **日志配置**：`LoggingConfig::default()` - 默认日志级别为 `info`

## 文件结构

确保服务运行目录下有以下结构：

```
服务运行目录/
├── config/
│   ├── asr_filters.json
│   └── observability.json (可选)
├── models/
└── logs/
```

## 注意事项

- 配置文件路径是固定的，不会自动查找
- 如果配置文件不存在，会使用默认配置并记录警告
- 确保从正确的目录运行服务，或配置文件在运行目录的 `config/` 子目录中

