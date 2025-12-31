# Opus 压缩替代方案

**日期**: 2025-12-25  
**问题**: `opusscript` 原生模块可能影响其他服务（如 NMT）的正常运行

---

## 问题分析

### 当前实现的问题

1. **节点端 TTS 使用 `opusscript`**（原生 Node.js 模块）
   - ❌ 需要编译原生绑定
   - ❌ 加载时可能修改环境变量（`PATH`、`CUDA_PATH` 等）
   - ❌ 可能影响其他服务（如 NMT）的启动
   - ❌ 需要复杂的环境变量保护机制

2. **Web 端使用 `@minceraftmc/opus-encoder`**（纯 JavaScript/WASM）
   - ✅ 纯 JavaScript 实现，基于 WebAssembly
   - ✅ 不会修改环境变量
   - ✅ 不会影响其他服务
   - ✅ 跨平台兼容性好

---

## 解决方案

### 方案 1：使用纯 JavaScript/WASM Opus 编码器（推荐）⭐

**优点**:
- ✅ 与 Web 端使用相同的库，保持一致性
- ✅ 不会修改环境变量，不需要保护机制
- ✅ 不会影响其他服务
- ✅ 跨平台兼容性好
- ✅ 性能良好（WASM 接近原生性能）

**实现步骤**:

1. **安装依赖**:
```bash
cd electron_node/electron-node
npm install @minceraftmc/opus-encoder
```

2. **修改 `opus-encoder.ts`**:
```typescript
import { OpusEncoder, OpusApplication } from '@minceraftmc/opus-encoder';

// 替换 opusscript 的实现
// 注意：@minceraftmc/opus-encoder 需要 Float32Array 输入
// 需要将 PCM16 (Int16Array) 转换为 Float32Array
```

3. **API 差异**:
- `opusscript`: 接受 `Buffer` (PCM16)，返回 `Buffer` (Opus)
- `@minceraftmc/opus-encoder`: 接受 `Float32Array`，返回 `Uint8Array` (Opus)

**注意事项**:
- 需要将 PCM16 (Int16Array) 转换为 Float32Array
- 需要处理异步初始化（WASM 加载）
- 帧大小需要匹配（通常 20ms）

---

### 方案 2：直接使用 PCM16（最简单）

**优点**:
- ✅ 最简单，无需额外依赖
- ✅ 不会影响其他服务
- ✅ 兼容性最好
- ✅ 延迟最低（无需编码/解码）

**缺点**:
- ❌ 文件大小较大（约 32 KB/s @ 16kHz）
- ❌ 网络传输带宽占用高

**实现**:
- 设置环境变量 `OPUS_ENCODING_ENABLED=false`
- 或直接移除 Opus 编码相关代码

**适用场景**:
- 本地网络（带宽充足）
- 对延迟要求极高的场景
- 不需要压缩的场景

---

### 方案 3：使用其他音频压缩格式

#### 3.1 MP3

**优点**:
- ✅ 广泛支持
- ✅ 有纯 JavaScript 实现（如 `lamejs`）

**缺点**:
- ❌ 压缩率不如 Opus
- ❌ 延迟较高
- ❌ 需要额外的库

#### 3.2 AAC

**优点**:
- ✅ 音质好
- ✅ 压缩率高

**缺点**:
- ❌ 需要原生库（如 `ffmpeg`）
- ❌ 实现复杂

#### 3.3 FLAC（无损）

**优点**:
- ✅ 无损压缩
- ✅ 有纯 JavaScript 实现

**缺点**:
- ❌ 压缩率较低（通常 50-60%）
- ❌ 不适合实时场景

---

## 推荐方案对比

| 方案 | 实现难度 | 性能影响 | 环境变量影响 | 压缩率 | 推荐度 |
|------|---------|---------|------------|--------|--------|
| **方案 1: WASM Opus** | 中等 | 低 | ✅ 无 | 高 (50-90%) | ⭐⭐⭐⭐⭐ |
| **方案 2: PCM16** | 简单 | 无 | ✅ 无 | 无 | ⭐⭐⭐ |
| **方案 3: MP3** | 中等 | 中 | ✅ 无 | 中 (30-50%) | ⭐⭐ |

---

## 实施建议

### 短期方案（立即实施）

1. **禁用 Opus 编码**（如果问题紧急）:
```bash
# 设置环境变量
set OPUS_ENCODING_ENABLED=false
```

2. **使用 PCM16 格式**:
- 功能正常，只是文件较大
- 适合本地网络或带宽充足的环境

### 长期方案（推荐）

**迁移到 `@minceraftmc/opus-encoder`**:

1. **优势**:
   - 与 Web 端保持一致
   - 不会影响其他服务
   - 性能良好（WASM）

2. **实施步骤**:
   - 安装 `@minceraftmc/opus-encoder`
   - 修改 `opus-encoder.ts` 实现
   - 移除 `opusscript` 依赖
   - 移除环境变量保护代码
   - 测试验证

3. **代码示例**:
```typescript
import { OpusEncoder, OpusApplication } from '@minceraftmc/opus-encoder';

// 初始化编码器
const encoder = new OpusEncoder({
  sampleRate: 16000,
  application: OpusApplication.VOIP,
});

await encoder.ready;

// 将 PCM16 转换为 Float32Array
function pcm16ToFloat32(pcm16: Buffer): Float32Array {
  const int16Array = new Int16Array(pcm16.buffer, pcm16.byteOffset, pcm16.length / 2);
  const float32Array = new Float32Array(int16Array.length);
  for (let i = 0; i < int16Array.length; i++) {
    float32Array[i] = int16Array[i] / 32768.0;
  }
  return float32Array;
}

// 编码
const float32Data = pcm16ToFloat32(pcm16Data);
const opusData = encoder.encodeFrame(float32Data);
```

---

## 总结

**推荐方案**: 使用 `@minceraftmc/opus-encoder`（方案 1）

**理由**:
1. ✅ 解决了环境变量问题（不再需要保护机制）
2. ✅ 与 Web 端保持一致
3. ✅ 性能良好（WASM）
4. ✅ 不会影响其他服务

**如果暂时无法迁移**:
- 可以禁用 Opus 编码，使用 PCM16
- 通过环境变量 `OPUS_ENCODING_ENABLED=false` 控制

---

## 相关文件

- `electron_node/electron-node/main/src/utils/opus-encoder.ts` - 当前实现（使用 opusscript）
- `webapp/web-client/src/audio_codec.ts` - Web 端实现（使用 @minceraftmc/opus-encoder）
- `electron_node/electron-node/main/src/utils/OPUS_NMT_CRASH_FIX.md` - 环境变量保护文档









