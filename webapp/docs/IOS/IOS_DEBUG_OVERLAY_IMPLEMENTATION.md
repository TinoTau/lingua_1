# DebugOverlay（iOS 调试悬浮面板）完整实现草稿

本文件提供一个可直接用于 iOS 开发的调试面板 Swift 实现。

---

# 1. 效果预览（ASCII 草图）

```
+----------------------------+
|   DEBUG PANEL              |
+----------------------------+
| WS: connected              |
| Upload: 32 KB/s            |
| Download: 24 KB/s          |
| RTT: 152 ms                |
| Session: sess-321          |
| Seq: 421                   |
| Last error: none           |
+----------------------------+
```

---

# 2. DebugData 模型

```swift
struct DebugData {
    var wsState: String = "unknown"
    var uploadRate: String = "0 KB/s"
    var downloadRate: String = "0 KB/s"
    var rtt: String = "-"
    var session: String = "-"
    var sequence: Int = 0
    var lastError: String = "none"
}
```

---

# 3. DebugOverlay SwiftUI 组件

```swift
import SwiftUI

struct DebugOverlay: View {
    @Binding var data: DebugData
    var onClose: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("DEBUG PANEL")
                    .font(.headline)
                    .foregroundColor(.white)
                Spacer()
                Button("X", action: onClose)
                    .foregroundColor(.white)
            }

            Group {
                Text("WS: \(data.wsState)")
                Text("Upload: \(data.uploadRate)")
                Text("Download: \(data.downloadRate)")
                Text("RTT: \(data.rtt)")
                Text("Session: \(data.session)")
                Text("Seq: \(data.sequence)")
                Text("Last error: \(data.lastError)")
            }
            .foregroundColor(.white)
            .font(.caption)

        }
        .padding()
        .background(Color.black.opacity(0.8))
        .cornerRadius(12)
        .padding()
    }
}
```

---

# 4. 挂载调试面板（App 层）

```swift
@main
struct LinguaApp: App {
    @State var showDebug = false
    @State var debugData = DebugData()

    var body: some Scene {
        WindowGroup {
            ZStack {
                SessionsView()

                if showDebug {
                    DebugOverlay(data: $debugData) {
                        showDebug = false
                    }
                    .transition(.move(edge: .bottom))
                }
            }
            .onShake {
                showDebug.toggle()
            }
        }
    }
}
```

摇一摇触发可用 extension：

```swift
extension UIWindow {
    open override func motionEnded(_ motion: UIEvent.EventSubtype, with event: UIEvent?) {
        if motion == .motionShake {
            NotificationCenter.default.post(name: .deviceDidShake, object: nil)
        }
    }
}

extension View {
    func onShake(perform action: @escaping () -> Void) -> some View {
        self.onReceive(NotificationCenter.default.publisher(for: .deviceDidShake)) { _ in
            action()
        }
    }
}
```

---

# 5. 实时更新 Debug 数据（在 RealtimeClient 中）

```swift
func updateStats(upload: Int, download: Int, rtt: Int) {
    DispatchQueue.main.async {
        debugData.uploadRate = "\(upload / 1024) KB/s"
        debugData.downloadRate = "\(download / 1024) KB/s"
        debugData.rtt = "\(rtt) ms"
        debugData.wsState = self.state.rawValue
        debugData.sequence = self.lastSequence
    }
}
```

---

# 6. 使用建议

- 开发阶段强烈建议开启 DebugOverlay  
- 正式版本可通过后端配置/远程开关隐藏  
- 可以扩展手动发送测试包、显示服务器延迟曲线等功能

