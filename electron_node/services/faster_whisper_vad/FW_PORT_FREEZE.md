# FW Port Freeze — faster-whisper-vad

**Frozen:** 2026-07-12  
**SSOT file:** `electron_node/services/faster_whisper_vad/service.json` → `port`

## Contract

| Field | Value |
|-------|------:|
| **Service ID** | `faster-whisper-vad` |
| **Frozen port** | **6007** |
| **Server bind** | `0.0.0.0:6007` |
| **Node endpoint** | `http://127.0.0.1:6007` |
| **Environment variable** | `FASTER_WHISPER_VAD_PORT` |
| **Python read** | `int(os.environ["FASTER_WHISPER_VAD_PORT"])` with default `6007` in `config.py` |

## Forbidden

- Generic shell `PORT=…` to control FW
- Automatic alternate port (`6008` fallback)
- Dual binding (`127.0.0.1` Intent + `0.0.0.0` FW on same port)
- Test scripts hardcoding different default ports
- `TONE_P10_FW_PORT` (removed — use `FW_PORT` client override or SSOT)
- Manual `python faster_whisper_vad_service.py` while Electron manages FW (except dev-only scripts)

## Orchestration

```text
Electron ServiceProcessRunner
  → reads service.json.port (6007)
  → sets child env FASTER_WHISPER_VAD_PORT=6007
  → strips inherited PORT
  → Node Service Registry endpoint = http://127.0.0.1:6007
```

Phase 1.5 / batch scripts **wait and validate** — they do **not** start FW.

## Other frozen ports (reference)

| Service | Port |
|---------|-----:|
| Node test server | 5020 |
| Lexicon Intent CPU | 5018 (`LEXICON_INTENT_PORT`) |
| NMT m2m100 | 5008 |
| Piper TTS | 5009 |
| Scheduler | 5010 |
| **Faster Whisper VAD** | **6007** |

## P10 temporary 6008 workaround

`service.json` was temporarily set to `6008` during P10 on one machine (Chrome outbound occupied 6007). **Reverted to 6007** as the only production port. If bind fails, fix the OS port conflict — do not change the frozen port in code.
