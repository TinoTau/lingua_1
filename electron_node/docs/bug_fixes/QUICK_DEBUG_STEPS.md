# 🔍 快速调试步骤 - 白屏问题

## 当前状态

```
✅ Vite服务器: 运行在 http://localhost:5176/
✅ dist目录: 已删除
✅ window-manager.ts: 已更新支持多端口 + 自动打开DevTools
✅ 主进程: 重新编译完成
✅ Electron: 正在重新启动
```

---

## 🎯 现在请做

### 1. 查看Electron窗口

应该会看到两个窗口：
- **主窗口**: 显示应用界面（如果正常）或白屏（如果有问题）
- **DevTools**: 自动打开的开发者工具

### 2. 在DevTools Console中检查

**执行这个命令查看当前加载的URL**:
```javascript
window.location.href
```

**预期结果**:
- ✅ 正确: `http://localhost:5176/` 或其他517X端口
- ❌ 错误: `file:///...` 或 `about:blank`

### 3. 查看Console中的错误

请告诉我：
- [ ] 是否有红色错误信息？
- [ ] 错误内容是什么？
- [ ] Network标签页显示什么？（是否有404错误？）

---

## 🔍 可能的情况

### 情况A: window.location.href 是 http://localhost:5176/

**说明**: Electron正确连接到Vite服务器

**白屏原因**: 前端代码有问题或API调用失败

**解决**: 
1. 查看Console中的具体错误
2. 查看Network标签页，检查哪些请求失败了
3. 执行 `window.electronAPI` 检查API是否存在

### 情况B: window.location.href 是 file:///...

**说明**: Electron加载了文件系统中的文件（不应该）

**原因**: 
- `isDev` 判断错误
- 或`distExists` 检查返回true（但我们已经删除了）

**解决**: 检查编译后的window-manager.js的实际逻辑

### 情况C: window.location.href 是 about:blank

**说明**: 窗口没有加载任何内容

**原因**: 
- `tryPorts` 函数失败
- 所有端口都无法连接

**解决**: 
1. 在浏览器中访问 http://localhost:5176/ 验证Vite是否工作
2. 检查防火墙是否阻止了localhost连接

---

## 💡 快速测试Vite

**在浏览器中打开**: http://localhost:5176/

**应该看到**: Lingua Node 客户端界面

**如果浏览器中正常显示**:
- 说明Vite服务器正常
- 问题在于Electron无法连接或加载

**如果浏览器中也白屏/404**:
- 说明Vite服务器有问题
- 需要重启Vite服务器

---

## 📋 需要的信息

请告诉我：

1. **DevTools Console中的window.location.href**:
   ```
   结果: _________
   ```

2. **Console中是否有错误**:
   ```
   错误信息: _________
   ```

3. **浏览器中访问 http://localhost:5176/ 的结果**:
   ```
   显示内容: _________
   ```

4. **DevTools Network标签页的情况**:
   ```
   - 是否有红色的404错误？
   - 哪些资源加载失败了？
   ```

---

## 🚨 如果DevTools没有自动打开

在Electron窗口中：
1. 按 `F12`
2. 或按 `Ctrl+Shift+I`
3. 或按 `Alt` 显示菜单，选择 View → Toggle Developer Tools

---

**准备好了吗？请查看Electron窗口和DevTools，告诉我上面的信息！** 🔍
