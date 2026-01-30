# NODE_SERVICE_STARTUP_FAILURE_DIAGNOSIS_GUIDE

节点端服务启动时主进程异常退出排查说明
版本：2026-01-20

## 1. 背景与问题描述

当前节点端主进程在以下情况下出现“静默退出”（exit code 1）：

* Electron 主进程启动正常。
* UI 正常加载（或已确认非 UI 引起的问题）。
* **当用户点击“启动服务”按钮（触发 ServiceProcessRunner.startService）时，主进程立即退出。**
* 无明确错误提示，日志不完整。

本指南的目的：
提供**一次性排查手册**，明确所有可能导致“启动服务时退出”的原因，并提供可操作的验证步骤。

---

## 2. 关键判断：退出发生在“启动服务”之后

定位点：
服务启动流程触发链为：

```
Renderer → IPC（services:start） → ServiceProcessRunner.startService
    → spawn(command, args, cwd)
        → child.on("error")
        → child.on("exit")
```

由于点击服务启动时立即退出，根因必然落在：

* spawn 调用失败
* 子进程启动异常导致 Electron 主进程崩溃
* 某处调用了 process.exit/app.quit
* 主进程抛出了未捕获异常（没有被日志捕获）
* cwd/command 路径无效导致 Node 执行时崩溃

本指南将逐项排查。

---

## 3. 必须首先加入的诊断钩子（开发态必加）

为了让所有异常能显示出来，请在 `index.ts` 顶部加入：

```ts
process.on("uncaughtException", (err) => {
  console.error("[FATAL] uncaughtException:", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("[FATAL] unhandledRejection:", reason);
});

process.on("exit", (code) => {
  console.error("[TRACE] process.exit called, code =", code);
});

// optional: 捕获谁在主动 exit
const realExit = process.exit;
(process as any).exit = function (code?: number) {
  console.error("[TRACE] process.exit invoked with code =", code);
  console.trace();
  return realExit.apply(process, [code]);
};
```

这样可以确认：

* 是否 spawn 阶段抛出异常
* 是否是主动退出
* 是否来自未捕获异常

---

## 4. 排查重点 #1：spawn(command, args, cwd) 是否有效

### 4.1 常见导致主进程崩溃的情况

* `command` 不存在（例如 python 未安装、路径不对）
* `cwd` 不存在或无权限
* Windows 上 spawn 非 `.exe` 或 `.cmd` 文件时崩溃
* exec 权限错误
* args 为空数组但服务实际需要参数
* cwd 是相对路径但主进程工作路径不一致

### 4.2 验证方式（必须执行）

请在 `ServiceProcessRunner.startService` 中加入临时日志：

```ts
console.log("[spawn-test] command =", command);
console.log("[spawn-test] args    =", args);
console.log("[spawn-test] cwd     =", cwd);
console.log("[spawn-test] exists? =", fs.existsSync(cwd));
```

同时在启动服务前执行一条测试：

```ts
try {
  fs.accessSync(cwd, fs.constants.R_OK | fs.constants.X_OK);
} catch (e) {
  console.error("[spawn-test] cwd permission error:", e);
}
```

### 4.3 单独在终端验证

进入项目根目录：

```bash
cd services/your_service
python main.py
```

如果在终端无法启动，服务本身问题需要先解决。

---

## 5. 排查重点 #2：子进程立即 crash 导致主进程退出

Electron 在某些情况下会因为子进程错误关闭整个主进程，特别是：

* Python 服务启动瞬间抛出异常但 stdout/stderr 被忽略
* spawn 使用 `stdio: "ignore"` 导致异常被吞掉
* Node 子进程报错但 Electron 主进程未捕获

### 5.1 临时开启输出

请把：

```ts
stdio: "ignore"
```

改成：

```ts
stdio: "pipe"
```

并加：

```ts
child.stdout?.on("data", d => console.log("[child-stdout]", String(d)));
child.stderr?.on("data", d => console.error("[child-stderr]", String(d)));
```

如果子进程在启动的瞬间报错，stderr 会直接暴露问题。

---

## 6. 排查重点 #3：是否有主动退出

必须全局搜索以下关键词（特别是旧迁移代码）：

```
process.exit
app.quit
quit()
close()
```

以及任何形式的 30 秒、超时、启动失败退出逻辑：

```
30000
30 * 1000
setTimeout
```

这些逻辑可能在服务启动失败时被触发。

---

## 7. 排查重点 #4：cwd/路径问题（非常高概率）

从你的重构总结来看，**路径不一致**是高危点：

典型问题包含：

* Electron 打包后 cwd 变为 `resources/app`
* TS outDir 变更后相对路径失效
* 服务 JSON 中的 cwd 与真实目录不一致
* Windows 路径反斜杠问题

### 验证方法（必须执行）

打印主进程当前工作路径：

```ts
console.log("[DEBUG] process.cwd() =", process.cwd());
console.log("[DEBUG] __dirname =", __dirname);
```

检查：

```
service.def.exec.cwd
```

是否是：

* 绝对路径（推荐）
* 或相对路径必须从 `process.cwd()` 出发能找到

建议改成：

```
"cwd": path.resolve(app.getAppPath(), "services/xxx")
```

---

## 8. 排查重点 #5：IPC 阶段是否传入了错误的参数

入口链路如下：

```
Renderer → ipcRenderer.invoke("services:start", serviceId)
     ↓
ipcMain.handle("services:start", async (_, id) => startService(id))
```

重点检查：

* 传入 id 是否为 kebab-case（新规范）
* id 是否与 service.json 中一致
* 是否存在 undefined/null 情况最终传入 spawn()

临时日志：

```ts
console.log("[IPC] startService id=", id);
```

---

## 9. 最终定位方法：二分法验证

以下为建议的二分诊断顺序：

### Step A

在 `startService` 中暂时注释掉真正 spawn：

```ts
console.log("[TEST] startService called:", id);
return;
```

如果点击启动服务 **不会退出** → spawn 链路有问题。

### Step B

恢复 spawn，但改成启动一个完全无害的假命令：

```ts
spawn("node", ["-e", "console.log('ok')"]);
```

如果不会退出 → 说明你的目标服务的 command/cwd/启动脚本有问题。

### Step C

逐步恢复真实 command → 找到具体导致 crash 的参数组合。

---

## 10. 总结 — 交付给开发部门的结论

本问题**不是 Electron 本身问题**，而是：

> “服务启动链路触发 spawn / 子进程回调时主进程被动退出”。

必须沿着以下五项检查：

1. spawn 参数是否有效
2. stderr 是否有隐藏错误
3. 是否有主动 exit
4. cwd 是否有效
5. IPC 参数是否正确

按本指南操作，能在 30 分钟内定位问题点。

---

# END

```
```
