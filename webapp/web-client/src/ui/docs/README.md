# UI 模块文档

主菜单、会话模式、房间模式与通用 UI 行为。对应目录 `src/ui/`。

## 模块与职责

| 文件 | 职责 |
|------|------|
| `main_menu.ts` | 主菜单渲染、单会话/房间模式入口、UIMode 状态 |
| `session_mode.ts` | 会话模式界面渲染、连接/开始/结束/发送/播放/倍速按钮、服务模式选择、事件绑定 |
| `session_mode_template.ts` | 会话模式 HTML 模板（两行按钮、翻译显示区等） |
| `room_mode.ts` | 房间模式界面与逻辑（创建/加入房间、成员列表等） |
| `renderers.ts` | 对外入口，按 UIMode 调用 main_menu / session_mode / room_mode 渲染 |

## 主菜单

- 渲染两个入口：**单会话模式**、**房间模式**。
- 点击后设置 UIMode 并渲染对应子界面（session 或 room）。
- 通过 `renderSessionMode(container, app)` / `renderRoomMode(...)` 传入 container 与 App 实例。

## 会话模式

- **布局**：第一行连接/开始/结束；第二行发送、播放（大按钮）、倍速；翻译结果显示区域。
- **服务模式**：个人语音、语音翻译、原文字幕、双语字幕、纯文本翻译等，选后自动连接并设置 pipeline（use_asr/use_nmt/use_tts/use_tone）。
- **连接**：连接服务器后进入会话就绪；点击「开始」调用 `app.startSession()`，状态变为 INPUT_RECORDING，启动录音。
- **发送**：手动截断当前话语，`app.sessionManager.sendCurrentUtterance()`。
- **播放**：有 TTS 缓冲时启用，点击调用 `app.startTtsPlayback()`；暂停、倍速委托给 App/TtsPlayer。
- **结束**：`app.endSession()`，清空缓冲与显示。
- **状态与按钮**：根据 StateMachine 状态与 `hasPendingTtsAudio()` 等启用/禁用按钮；内存 warning 时播放按钮可闪烁（具体见实现）。

## 房间模式

- 创建/加入房间、房间内成员列表、WebRTC 与混音相关 UI。
- 与 `RoomManager`、`WebRTCManager` 及 App 的 room 相关 API 配合。

## 与 App 的绑定

- 所有需要调用的能力均通过传入的 `app: App` 完成（如 `app.startSession()`、`app.startTtsPlayback()`、`app.getState()`、`app.hasPendingTtsAudio()`）。
- 状态变化与 TTS 可用通过 App 注册的回调驱动 UI 更新（状态机回调、onTtsAudioAvailable 等），在 init_callbacks 中挂到 App。
