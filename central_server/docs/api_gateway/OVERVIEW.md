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
url = "ws://localhost:5010/ws/session"
```

### 运行

```bash
cargo run
```

### 租户与 API Key（开发/测试）

目前租户管理使用内存存储，且**没有对外的租户管理 API**（创建/禁用/配额管理等仍待补齐）。

为保证本地可快速跑通，API Gateway 启动时会自动创建一个默认租户：

- 如果你设置了环境变量 `LINGUA_API_KEY`，则使用该值作为 API Key
- 否则会自动生成一个随机 API Key，并在启动日志中打印出来（仅用于开发/测试）

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

请参考 `PUBLIC_API.md`

