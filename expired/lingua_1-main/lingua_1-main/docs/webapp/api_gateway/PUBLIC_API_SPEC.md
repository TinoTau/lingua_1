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

**响应**:
```json
{
  "session_id": "sess-123456",
  "text_asr": "今天天气不错。",
  "text_translated": "The weather is nice today.",
  "tts_audio": "base64-encoded-audio",
  "tts_format": "pcm16"
}
```

---

### 5.2 WebSocket API

#### 5.2.1 连接

**端点**: `wss://api.lingua.example.com/v1/stream`

**认证**: 通过 URL 参数或首条消息传递 API Key

#### 5.2.2 客户端 → 服务端

**初始化**:
```json
{
  "type": "init",
  "api_key": "YOUR_API_KEY",
  "src_lang": "zh",
  "tgt_lang": "en"
}
```

**发送音频**:
```json
{
  "type": "audio",
  "data": "base64-encoded-audio-chunk"
}
```

#### 5.2.3 服务端 → 客户端

**翻译结果**:
```json
{
  "type": "result",
  "text_asr": "今天天气不错。",
  "text_translated": "The weather is nice today.",
  "tts_audio": "base64-encoded-audio",
  "tts_format": "pcm16"
}
```

---

## 快速开始

### 1. 获取 API Key

联系管理员获取 API Key。

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
const ws = new WebSocket('wss://api.lingua.example.com/v1/stream?api_key=YOUR_API_KEY');

ws.onopen = () => {
  ws.send(JSON.stringify({
    type: 'init',
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

