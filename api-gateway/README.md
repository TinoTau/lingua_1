# Lingua API Gateway

对外 API 网关服务，提供 REST 和 WebSocket API 供第三方应用接入。

## 功能

- REST API: `POST /v1/speech/translate` - 非实时翻译
- WebSocket API: `/v1/stream` - 实时流式翻译
- API Key 鉴权
- 租户管理
- 请求限流

## 快速开始

### 配置

编辑 `config.toml`:

```toml
[server]
port = 8081
host = "0.0.0.0"

[scheduler]
url = "ws://localhost:8080/ws/session"
```

### 运行

```bash
cargo run
```

### 创建租户

目前租户管理使用内存存储，生产环境建议使用数据库。

## API 使用示例

### REST API

```bash
curl -X POST http://localhost:8081/v1/speech/translate \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -F "audio=@audio.wav" \
  -F "src_lang=zh" \
  -F "tgt_lang=en"
```

### WebSocket API

```javascript
const ws = new WebSocket('wss://api.example.com/v1/stream', {
  headers: {
    'Authorization': 'Bearer YOUR_API_KEY'
  }
});

ws.onopen = () => {
  ws.send(JSON.stringify({
    type: 'start',
    src_lang: 'zh',
    tgt_lang: 'en'
  }));
};

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.type === 'final') {
    console.log('翻译结果:', message.text);
  }
};
```

## 详细文档

请参考 [PUBLIC_API.md](../docs/PUBLIC_API.md)

