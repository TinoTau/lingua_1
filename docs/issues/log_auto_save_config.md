# 日志自动保存配置说明

## 功能说明

已添加日志自动保存到文件的配置功能，支持通过配置文件、URL参数或localStorage设置。

## 配置方式

### 方式1：URL参数（推荐，用于测试）

在URL中添加参数：

```
http://localhost:9001/?logAutoSave=true&logAutoSaveInterval=30000&logPrefix=web-client
```

参数说明：
- `logAutoSave=true` 或 `logAutoSave=1`：启用自动保存
- `logAutoSaveInterval=30000`：自动保存间隔（毫秒），默认30000（30秒）
  - `0`：每次flush时都保存（每5秒）
  - `>0`：按指定间隔保存
- `logPrefix=web-client`：日志文件前缀，默认'web-client'

示例：
- 启用自动保存，每30秒保存一次：`?logAutoSave=true&logAutoSaveInterval=30000`
- 启用自动保存，每次flush都保存：`?logAutoSave=true&logAutoSaveInterval=0`
- 启用自动保存，每60秒保存一次：`?logAutoSave=true&logAutoSaveInterval=60000`

### 方式2：localStorage（持久化配置）

在浏览器控制台执行：

```javascript
// 启用自动保存，每30秒保存一次
localStorage.setItem('logConfig', JSON.stringify({
  autoSaveToFile: true,
  autoSaveIntervalMs: 30000,
  logFilePrefix: 'web-client'
}));

// 然后刷新页面
location.reload();
```

禁用自动保存：
```javascript
localStorage.removeItem('logConfig');
location.reload();
```

### 方式3：代码配置（开发时）

在 `main.ts` 中修改：

```typescript
const app = new App({
  logConfig: {
    autoSaveToFile: true,
    autoSaveIntervalMs: 30000, // 30秒
    logFilePrefix: 'web-client',
  },
});
```

## 配置优先级

1. **URL参数**（最高优先级）
2. **localStorage**
3. **代码配置**
4. **默认值**（不自动保存）

## 配置选项说明

### `autoSaveToFile`
- 类型：`boolean`
- 默认值：`false`
- 说明：是否启用自动保存日志到文件

### `autoSaveIntervalMs`
- 类型：`number`
- 默认值：`30000`（30秒）
- 说明：自动保存间隔（毫秒）
  - `0`：每次flush时都保存（每5秒，与IndexedDB刷新同步）
  - `>0`：按指定间隔保存

### `logFilePrefix`
- 类型：`string`
- 默认值：`'web-client'`
- 说明：日志文件前缀，最终文件名格式：`{prefix}-{timestamp}.log`

## 自动保存行为

1. **定期保存**：如果 `autoSaveIntervalMs > 0`，按指定间隔自动保存
2. **Flush时保存**：如果 `autoSaveIntervalMs === 0`，每次flush时都保存（每5秒）
3. **页面卸载时保存**：页面关闭时自动保存一次

## 日志文件位置

日志文件会下载到浏览器的默认下载目录，文件名格式：
```
web-client-2026-01-14T21-43-36-3528143Z.log
```

## 使用示例

### 测试时启用自动保存

1. **使用URL参数**（最简单）：
   ```
   http://localhost:9001/?logAutoSave=true&logAutoSaveInterval=30000
   ```

2. **运行测试**，等待至少30秒（或设置的间隔时间）

3. **检查下载目录**，应该会有日志文件自动下载

### 开发时启用自动保存

在浏览器控制台执行：
```javascript
localStorage.setItem('logConfig', JSON.stringify({
  autoSaveToFile: true,
  autoSaveIntervalMs: 30000,
}));
location.reload();
```

## 注意事项

1. **频繁保存**：如果设置 `autoSaveIntervalMs=0`，会每5秒保存一次，可能产生大量文件
2. **浏览器限制**：某些浏览器可能会阻止自动下载，需要用户允许
3. **文件大小**：日志文件会随着时间增长，建议定期清理
4. **性能影响**：自动保存会定期执行文件下载操作，可能影响性能

## 推荐配置

- **测试时**：`autoSaveIntervalMs=30000`（30秒），避免频繁下载
- **调试时**：`autoSaveIntervalMs=0`（每次flush都保存），确保不丢失日志
- **生产环境**：`autoSaveToFile=false`（不自动保存），避免影响用户体验
