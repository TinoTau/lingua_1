# Web 端日志导出指南

## 方法1：使用浏览器控制台导出（推荐）

### 步骤：

1. **打开浏览器控制台**
   - 按 `F12` 键
   - 或右键点击页面 → 选择"检查" → 切换到"Console"标签

2. **执行导出命令**
   在控制台中输入以下命令并回车：
   ```javascript
   window.logHelper.exportLogs()
   ```

3. **下载日志文件**
   - 日志文件会自动下载到浏览器的默认下载目录
   - 文件名格式：`web-client-YYYY-MM-DDTHH-MM-SS-sssZ.log`
   - 例如：`web-client-2026-01-14T22-53-35-787Z.log`

### 如果 `window.logHelper` 不存在

如果控制台提示 `window.logHelper` 未定义，可以尝试：

```javascript
// 方法1：直接使用 logger
logger.exportLogs()

// 方法2：动态导入
import('./logger').then(module => {
  module.logger.exportLogs();
});
```

## 方法2：通过 URL 参数启用自动保存

在浏览器地址栏添加参数启用自动保存：

```
http://localhost:9001/?logAutoSave=true&logAutoSaveInterval=30000
```

这样日志会每30秒自动保存一次到下载目录。

## 方法3：使用脚本查找已下载的日志

如果已经导出过日志，可以使用项目中的脚本查找：

```powershell
powershell -ExecutionPolicy Bypass -File webapp\web-client\find_logs.ps1
```

或者手动检查下载目录：
- Windows: `C:\Users\<用户名>\Downloads`
- 查找文件名包含 `web-client` 和 `.log` 的文件

## 日志文件位置

- **默认下载目录**：
  - Windows: `C:\Users\<用户名>\Downloads`
  - Mac: `~/Downloads`
  - Linux: `~/Downloads`

- **文件名格式**：`web-client-YYYY-MM-DDTHH-MM-SS-sssZ.log`

## 常见问题

### Q: 控制台显示 `window.logHelper is undefined`

**A:** 可能的原因：
1. 页面还未完全加载，等待几秒后重试
2. `logHelper` 初始化失败，检查控制台是否有错误信息
3. 尝试刷新页面后重试

### Q: 导出后没有文件下载

**A:** 可能的原因：
1. 浏览器阻止了下载，检查浏览器的下载设置
2. 下载目录的权限问题
3. 日志为空，IndexedDB 中没有日志数据

### Q: 如何查看 IndexedDB 中的日志

**A:** 在浏览器控制台执行：

```javascript
// 打开 IndexedDB
const request = indexedDB.open('lingua-logs', 1);
request.onsuccess = () => {
  const db = request.result;
  const transaction = db.transaction(['logs'], 'readonly');
  const store = transaction.objectStore('logs');
  const getAllRequest = store.getAll();
  getAllRequest.onsuccess = () => {
    console.log('日志条目数:', getAllRequest.result.length);
    console.log('日志内容:', getAllRequest.result);
  };
};
```

## 日志内容说明

导出的日志文件包含：
- 时间戳（ISO 格式）
- 日志级别（DEBUG, INFO, WARN, ERROR）
- 模块名称（如 SessionManager, App, TtsPlayer 等）
- 日志消息
- 附加数据（JSON 格式）

## 分析日志的关键点

查找以下关键日志来分析 job4 提前 finalize 的问题：

1. **播放完成时间**：搜索 `🎵 播放完成`
2. **首次音频帧接收**：搜索 `🎙️ 播放完成后首次接收到音频帧`
3. **首次音频 chunk 发送**：搜索 `🎤 首次发送音频chunk（播放结束后）`
4. **异常延迟警告**：搜索 `⚠️ 延迟异常`
5. **录音器恢复**：搜索 `✅ 已恢复录音`
