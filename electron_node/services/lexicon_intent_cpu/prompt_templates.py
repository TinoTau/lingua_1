# -*- coding: utf-8 -*-
"""Prompt templates for Lexicon V2 CPU intent inference."""

import json
from typing import Any


class IntentPromptTemplate:
    PROMPT_PACK_VERSION = "v1"

    @staticmethod
    def build_system_message(allowed_domains: list[dict[str, Any]]) -> str:
        domain_lines = "\n".join(
            f'- "{d["id"]}": {d.get("displayName", d["id"])}'
            for d in allowed_domains
            if d.get("allowLLMSelect")
        )
        return (
            "You are a session domain classifier for a speech translation system.\n"
            "Analyze recent finalized conversation turns and infer the active lexicon domain.\n"
            "Rules:\n"
            "1. Output ONLY valid JSON matching the required schema.\n"
            "2. primaryDomain MUST be one of the allowed domains below.\n"
            "3. secondaryDomains MUST be a subset of allowed domains (max 2).\n"
            "4. Do NOT rewrite, fix, or generate replacement text.\n"
            "5. summary must be <= 300 chars describing the session topic.\n"
            "6. shouldSwitch=true only if primaryDomain differs from currentPrimary.\n"
            "Allowed domains:\n"
            f"{domain_lines}\n"
            "Required JSON schema:\n"
            '{"summary":"...","primaryDomain":"travel","secondaryDomains":[],"confidence":0.86,'
            '"shouldSwitch":true,"reason":["..."],"effectiveFromTurn":0}'
        )

    @staticmethod
    def build_user_message(payload: dict[str, Any]) -> str:
        return json.dumps(payload, ensure_ascii=False, indent=2)
