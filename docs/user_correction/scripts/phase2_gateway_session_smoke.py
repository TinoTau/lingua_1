#!/usr/bin/env python3
"""Minimal Gateway session transport smoke (no Node ASR required).

Browser-shaped WS → Gateway /v1/session → Scheduler:
  session_init → session_init_ack → session_end

Verifies user_id/profile injection path does not break transport semantics.
Full audio/ASR/translation requires a live Node (documented separately).
"""
from __future__ import annotations

import asyncio
import json
import os
import sys

try:
    import websockets
except ImportError:
    print("FAIL: pip install websockets")
    sys.exit(2)

GATEWAY_WS = os.environ.get(
    "LINGUA_GATEWAY_WS", "ws://127.0.0.1:18081/v1/session"
)
API_KEY = os.environ.get("LINGUA_API_KEY") or os.environ.get("VITE_API_KEY") or "phase2-dev-key"


async def main() -> int:
    url = GATEWAY_WS
    if "access_token=" not in url:
        sep = "&" if "?" in url else "?"
        url = f"{url}{sep}access_token={API_KEY}"

    async with websockets.connect(url, open_timeout=10) as ws:
        init = {
            "type": "session_init",
            "client_version": "phase2-e2e",
            "src_lang": "zh",
            "tgt_lang": "en",
            # Forged identity must be stripped/overwritten by Gateway
            "user_id": "forged-browser-user",
            "user_profile": {"schema_version": 1, "profile_version": 999},
        }
        await ws.send(json.dumps(init))
        ack_raw = await asyncio.wait_for(ws.recv(), timeout=10)
        ack = json.loads(ack_raw)
        print("ack=", ack)
        if ack.get("type") != "session_init_ack":
            print("FAIL: expected session_init_ack")
            return 1
        session_id = ack.get("session_id")
        if not session_id or not str(session_id).startswith("s-"):
            print("FAIL: missing session_id")
            return 1

        await ws.send(json.dumps({"type": "session_end", "session_id": session_id}))
        # Some stacks ack close implicitly; tolerate no further message.
        print("PASS gateway session transport session_id=", session_id)
        return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
