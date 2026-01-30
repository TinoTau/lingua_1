# 快速修复 - Redis 版本问题

**问题**: Redis 3.0.504 不支持 Streams  
**修复时间**: 5 分钟  
**难度**: ⭐ 简单

---

## 🚨 问题

```
ERROR Phase2 consumer group 创建失败
error: unknown command 'XGROUP'

原因: Redis 3.0.504 太旧，需要 Redis 5.0+
```

---

## ⚡ 5分钟快速解决

### 选项1: 使用 Docker（最简单）

```powershell
# 1. 停止旧 Redis
Stop-Service Redis

# 2. 启动 Docker Redis 7
docker run -d --name lingua-redis -p 6379:6379 redis:7-alpine

# 3. 验证
redis-cli ping
# 预期: PONG

# 4. 测试 Streams
redis-cli XADD test * field value
# 预期: 返回消息 ID

# 5. 重启调度服务器
cd D:\Programs\github\lingua_1
.\scripts\start_scheduler.ps1
```

✅ **完成！**

---

### 选项2: 使用 Chocolatey

```powershell
# 1. 停止旧 Redis
Stop-Service Redis

# 2. 备份数据（可选）
Copy-Item "C:\Program Files\Redis\dump.rdb" "C:\Backup\dump.rdb"

# 3. 升级 Redis
choco install redis-64 --version=7.2.4 --force

# 4. 启动新 Redis
Start-Service Redis

# 5. 验证版本
redis-cli INFO server | Select-String "redis_version"
# 预期: redis_version:7.2.4

# 6. 重启调度服务器
cd D:\Programs\github\lingua_1
.\scripts\start_scheduler.ps1
```

✅ **完成！**

---

### 选项3: 临时禁用 Phase2（不推荐）

**如果无法升级 Redis，临时禁用多实例功能**：

```toml
# config.toml
[scheduler.phase2]
enabled = false
```

然后重启：
```powershell
.\scripts\start_scheduler.ps1
```

⚠️ **影响**: 单实例模式，无多实例协同

---

## ✅ 验证成功

启动调度服务器后，应该看到：

```
✅ INFO Phase2 已启用
✅ INFO Phase2 consumer group 已创建
```

不应该看到：

```
❌ ERROR unknown command 'XGROUP'
❌ ERROR Phase2 consumer group 创建失败
```

---

## 📊 版本要求

| 组件 | 最低版本 | 推荐版本 |
|------|---------|---------|
| Redis | 5.0 | 7.x |
| 原因 | Streams 支持 | 最新稳定 |

---

**选择推荐**: 🥇 Docker（最简单）

现在就开始升级吧！🚀
