#!/usr/bin/env python3
"""
Phase 2 correction loop smoke:
  Browser-shaped POST → Gateway /v1/corrections → Scheduler → SQLite

Requires running Gateway + Scheduler with matching LINGUA_CORRECTION_API_TOKEN.
Does not exercise Node ASR.
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
import uuid

GATEWAY = os.environ.get("LINGUA_GATEWAY_HTTP", "http://127.0.0.1:8081").rstrip("/")
API_KEY = os.environ.get("LINGUA_API_KEY") or os.environ.get("VITE_API_KEY") or "test-api-key"
SESSION_ID = os.environ.get("LINGUA_TEST_SESSION_ID", "s-PHASE2E2E")
UTTERANCE = int(os.environ.get("LINGUA_TEST_UTTERANCE", "7"))


def req(method: str, url: str, body: dict | None = None, headers: dict | None = None):
    data = None if body is None else json.dumps(body).encode("utf-8")
    h = {"Content-Type": "application/json", **(headers or {})}
    r = urllib.request.Request(url, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(r, timeout=10) as resp:
            raw = resp.read().decode("utf-8")
            return resp.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(raw) if raw else {}
        except Exception:
            parsed = {"error": raw}
        return e.code, parsed


def main() -> int:
    print("== unauthorized ==")
    code, body = req(
        "POST",
        f"{GATEWAY}/v1/corrections",
        {
            "session_id": SESSION_ID,
            "utterance_index": UTTERANCE,
            "system_text": "系统",
            "corrected_text": "纠正",
            "client_correction_id": str(uuid.uuid4()),
        },
    )
    print(code, body)
    if code != 401:
        print("FAIL: expected 401 without auth")
        return 1

    print("== me ==")
    code, me = req("GET", f"{GATEWAY}/v1/me", headers={"Authorization": f"Bearer {API_KEY}"})
    print(code, me)
    if code != 200 or "user_id" not in me:
        print("FAIL: /v1/me")
        return 1
    auth_user = me["user_id"]

    client_id = str(uuid.uuid4())
    payload = {
        "session_id": SESSION_ID,
        "utterance_index": UTTERANCE,
        "system_text": "系统原文A",
        "corrected_text": "用户纠正B",
        "client_correction_id": client_id,
        "user_id": "forged-should-be-ignored",
    }

    print("== submit ==")
    code, resp = req(
        "POST",
        f"{GATEWAY}/v1/corrections",
        payload,
        headers={"Authorization": f"Bearer {API_KEY}"},
    )
    print(code, resp)
    if code != 200 or not resp.get("accepted"):
        print("FAIL: correction submit", code, resp)
        return 1
    if "token" in json.dumps(resp).lower():
        print("FAIL: token leaked in response")
        return 1
    cid = resp["correction_id"]

    print("== duplicate ==")
    code2, resp2 = req(
        "POST",
        f"{GATEWAY}/v1/corrections",
        payload,
        headers={"Authorization": f"Bearer {API_KEY}"},
    )
    print(code2, resp2)
    if code2 != 200 or not resp2.get("duplicate") or resp2.get("correction_id") != cid:
        print("FAIL: idempotency")
        return 1

    print("== noop ==")
    code3, resp3 = req(
        "POST",
        f"{GATEWAY}/v1/corrections",
        {
            **payload,
            "corrected_text": "系统原文A",
            "client_correction_id": str(uuid.uuid4()),
            "user_id": None,
        },
        headers={"Authorization": f"Bearer {API_KEY}"},
    )
    print(code3, resp3)
    if code3 != 400:
        print("FAIL: expected 400 for noop")
        return 1

    print("PASS auth_user=", auth_user, "correction_id=", cid)
    print("NOTE: Scheduler soft session ownership may allow submit when session not live.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
