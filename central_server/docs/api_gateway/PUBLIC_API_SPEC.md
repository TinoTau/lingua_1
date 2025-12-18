# API Gateway API 规范与使用

本文档是 [对外开放 API 设计与实现](./PUBLIC_API.md) 的子文档，包含外部 API 规范、使用示例和快速开始。

**返回**: [对外开放 API 主文档](./PUBLIC_API.md)

---

## 5. 外部 API 规范

### 5.1 REST API

#### 5.1.1 上传音频文件

**端点**: `POST /v1/speech/translate`

**请求**:
```http
POST /v1/speech/translate HTTP/1.1
Host: api.lingua.example.com
Authorization: Bearer YOUR_API_KEY
Content-Type: multipart/form-data

audio=@audio.wav
src_lang=zh
tgt_lang=en
```

**表单字段**（multipart）：

- `audio`（必填）：音频文件（二进制）
- `src_lang`（可选，默认 `zh`）
- `tgt_lang`（可选，默认 `en`）
- `audio_format`（可选，默认 `pcm16`）
- `sample_rate`（可选，默认 `16000`）

**响应**:
```json
{
  "text": "The weather is nice today.",
  "audio_tts": "base64-encoded-audio",
  "duration_ms": 1234
}
```

---

### 5.2 WebSocket API

#### 5.2.1 连接

**端点**: `/v1/stream`

**认证**: 通过 HTTP Header 传递 API Key

示例（本地开发）：

- URL: `ws://localhost:8081/v1/stream`
- Header: `Authorization: Bearer YOUR_API_KEY`

#### 5.2.2 客户端 → 服务端

**开始会话**:
```json
{
  "type": "start",
  "src_lang": "zh",
  "tgt_lang": "en"
}
```

**发送音频**:
```json
{
  "type": "audio",
  "chunk": "base64-encoded-audio-chunk"
}
```

#### 5.2.3 服务端 → 客户端

**翻译结果**:
```json
{
  "type": "final",
  "text": "The weather is nice today.",
  "audio": "base64-encoded-audio"
}
```

---

## 快速开始

### 1. 获取 API Key

开发/测试环境下：

- 推荐：启动前设置环境变量 `LINGUA_API_KEY`
- 如果不设置：API Gateway 启动时会自动生成一个随机 key 并打印到日志中（仅用于开发/测试）

### 2. 测试 REST API

```bash
curl -X POST http://localhost:8081/v1/speech/translate \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -F "audio=@audio.wav" \
  -F "src_lang=zh" \
  -F "tgt_lang=en"
```

### 3. 测试 WebSocket API

```javascript
// 注意：浏览器原生 WebSocket 不支持自定义 Header；
// 若需要在浏览器中使用，请在网关侧增加 query param 认证或走反向代理注入 Header。
// Node.js 客户端可用 ws / websocket 库注入 Authorization Header。
const ws = new WebSocket('ws://localhost:8081/v1/stream');

ws.onopen = () => {
  ws.send(JSON.stringify({
    type: 'start',
    src_lang: 'zh',
    tgt_lang: 'en'
  }));
};

ws.onmessage = (event) => {
  const result = JSON.parse(event.data);
  console.log('Translation:', result.text_translated);
};
```

---

**返回**: [对外开放 API 主文档](./PUBLIC_API.md) | [API 设计与架构](./PUBLIC_API_DESIGN.md) | [实现状态与部署](./PUBLIC_API_STATUS.md)

