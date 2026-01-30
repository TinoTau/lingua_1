# 开发环境启动指南 - 简单明了

## 🚀 **启动流程（2步）**

### Step 1: 启动Vite开发服务器

```powershell
cd d:\Programs\github\lingua_1\electron_node\electron-node
npm run dev
```

**等待输出**:
```
[1]   VITE v5.4.21  ready in 2153 ms
[1]   ➜  Local:   http://localhost:5173/
```

**保持这个终端运行！**

---

### Step 2: 启动Electron（新终端）

```powershell
cd d:\Programs\github\lingua_1\electron_node\electron-node
npm start
```

**成功标志**: Electron窗口显示UI

---

## ⚠️ **如果忘记Step 1**

Electron会弹出错误对话框：

```
❌ 开发环境未就绪

请先在另一个终端运行:
npm run dev

等待Vite启动后，再运行 npm start
```

**不会看到白屏，直接看到清晰的错误提示**

---

## 🎯 **为什么需要两步？**

Electron应用 = **前端UI** + **后端逻辑**

- **前端UI**: React + Vite (http://localhost:5173)
- **后端逻辑**: Electron主进程 (npm start)

**必须先启动前端，后端才能加载UI**

---

## 💡 **记住**

```
Terminal 1: npm run dev  (Vite) - 必须先启动
Terminal 2: npm start    (Electron) - 然后启动
```

**就这么简单！**
