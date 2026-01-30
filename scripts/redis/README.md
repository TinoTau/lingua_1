# Redis相关脚本

本目录包含Redis管理和维护相关的脚本工具。

## 脚本列表

### 升级脚本
- `upgrade-redis.ps1` - Redis升级脚本
- `升级Redis_Docker方案.ps1` - 使用Docker升级Redis的方案脚本

### 管理脚本
- `disable-old-redis.ps1` - 禁用旧版Redis实例脚本

## 使用说明

### 升级Redis

```powershell
# 标准升级
.\upgrade-redis.ps1

# 使用Docker方案升级
.\升级Redis_Docker方案.ps1
```

### 禁用旧Redis

```powershell
.\disable-old-redis.ps1
```

## 注意事项

1. 执行升级脚本前请先备份数据
2. 确保有足够的磁盘空间
3. 建议在维护窗口执行升级操作
4. 升级后请验证数据完整性

## 相关文档

- [Redis版本升级指南](../../central_server/docs/scheduler/redis_architecture/Redis版本升级指南_2026_01_22.md)
- [Redis启动说明](../../central_server/docs/scheduler/redis_architecture/Redis启动说明_2026_01_22.md)
- [Redis端口变更说明](../../central_server/docs/scheduler/redis_architecture/Redis端口变更说明.md)

---

**最后更新**: 2026-01-22  
**维护团队**: 基础设施组
