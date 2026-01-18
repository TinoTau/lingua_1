# Utterance [8] NMT日志查找结果

## 分析日期
2026-01-17

## 查找总结

### ✅ 找到的信息源

1. **节点端日志** (`electron_node/electron-node/logs/electron-main.log`)
   - ✅ 包含[8]的NMT输出记录
   - ✅ 包含完整的`translatedText`字段（408字符）
   - ✅ 包含`translatedTextLength: 408`
   - **位置**: 查找`utteranceIndex: 8`和`jobId: s-B9BEC010:657`的记录

2. **节点端日志格式**:
   ```json
   {
     "level": 30,
     "time": 1768633570257,
     "serviceId": "nmt-m2m100",
     "jobId": "s-B9BEC010:657",
     "sessionId": "s-B9BEC010",
     "utteranceIndex": 8,
     "status": 200,
     "requestDurationMs": XXXX,
     "translatedText": "This series can be fully identified... this series can also be fully recognized...",
     "translatedTextLength": 408,
     "translatedTextPreview": "...",
     "msg": "NMT OUTPUT: NMT request succeeded (END)"
   }
   ```

### ❌ 未找到的信息源

1. **NMT服务日志** (`electron_node/services/nmt_m2m100/logs/nmt-service.log`)
   - ❌ 缺少[8]的翻译记录
   - ⚠️ 日志文件只有15KB，可能不完整
   - ✅ 有其他utterance的记录（[0], [1], [4], [7]）
   - **缺失**: [8]应该在`20:06:07`左右的记录

2. **其他日志文件**:
   - ❌ 没有找到其他NMT相关的日志文件
   - ❌ `test_stdout.txt`和`test_stderr.txt`为空

---

## 日志输出机制

### NMT服务的stdout/stderr

根据代码分析：

1. **输出重定向**:
   - NMT服务的stdout和stderr通过`python-service-manager.ts`处理
   - 使用`service-logging.ts`的`createLogStream()`创建日志流
   - **理论上所有输出都应该写入`nmt-service.log`**

2. **日志写入机制**:
   - 使用`flushLogBuffer()`按行写入日志
   - 添加时间戳和日志级别
   - 使用追加模式（`flags: 'a'`）

3. **可能的问题**:
   - Python stdout/stderr可能使用了缓冲区
   - 缓冲区未刷新导致输出丢失
   - 日志文件可能在某个时刻被截断

### 节点端的NMT日志

根据`task-router-nmt.ts`代码：

1. **日志记录位置**:
   - `NMT INPUT`: 发送请求时记录（包含text、contextText）
   - `NMT OUTPUT`: 收到响应时记录（包含translatedText）

2. **日志级别**:
   - 使用`logger.info()`，应该被记录到`electron-main.log`

3. **完整信息**:
   - ✅ 包含完整的`translatedText`字段
   - ✅ 包含`translatedTextLength`
   - ✅ 包含`translatedTextPreview`（前100字符）

---

## 建议的提取方法

### 方法1: 从节点端日志提取[8]的完整NMT输出

**PowerShell命令**:
```powershell
cd d:\Programs\github\lingua_1
$logPath = "electron_node\electron-node\logs\electron-main.log"
$content = Get-Content $logPath -Encoding UTF8
# 查找[8]的NMT OUTPUT记录
$matches = $content | Select-String -Pattern '"utteranceIndex":8' -Context 10
$nmtOutput = $matches | Select-String -Pattern 'NMT OUTPUT'
$nmtOutput | ForEach-Object {
    # 提取JSON并解析translatedText
    if ($_ -match '"translatedText":"([^"]+)"') {
        Write-Host $matches[1]
    }
}
```

**或者使用JSON解析**:
```powershell
$content = Get-Content $logPath -Encoding UTF8
$jsonLines = $content | Where-Object { $_ -match '"utteranceIndex":8' -and $_ -match 'NMT OUTPUT' }
$jsonLines | ForEach-Object {
    $json = $_ | ConvertFrom-Json
    if ($json.translatedText) {
        Write-Host "Full translation: $($json.translatedText)"
        Write-Host "Length: $($json.translatedTextLength)"
    }
}
```

### 方法2: 检查NMT服务日志写入问题

**可能的原因**:
1. 日志文件缓冲区未刷新
2. 日志文件在某时刻被截断
3. 服务异常导致日志丢失

**检查方法**:
1. 检查NMT服务进程是否正常退出
2. 检查日志文件写入权限
3. 检查是否有日志轮转配置
4. 检查Python stdout/stderr的缓冲设置

---

## 结论

**当前状态**:
- ✅ **节点端日志中有[8]的完整NMT输出**（推荐从此处提取）
- ❌ NMT服务日志中缺少[8]的记录（需要调查原因）

**下一步行动**:
1. **优先**: 从节点端日志中提取[8]的完整NMT输出，分析重复文本的原因
2. **次要**: 调查为什么NMT服务日志中缺少[8]的记录（可能是缓冲区或日志截断问题）

---

## 附加信息

### 节点端日志位置
- 文件: `electron_node/electron-node/logs/electron-main.log`
- 大小: 709KB
- 格式: JSON日志（每行一个JSON对象）

### NMT服务日志位置
- 文件: `electron_node/services/nmt_m2m100/logs/nmt-service.log`
- 大小: 15KB（相对较小）
- 格式: 时间戳 + 日志级别 + 日志内容

### 日志时间范围
- 测试开始: 2026-01-17 07:05:00
- [8]应该在: 2026-01-17 07:06:07左右
- NMT服务日志最后记录: 2026-01-17 07:05:49（只有[7]的记录）
