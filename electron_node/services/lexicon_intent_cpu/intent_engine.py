# -*- coding: utf-8 -*-
"""CPU-only llama.cpp engine for Lexicon V2 intent inference."""

import json
import re
import time
from typing import Any, Optional

from llama_cpp import Llama

from config import Config, DEFAULT_MODEL_FILE
from prompt_templates import IntentPromptTemplate


class LexiconIntentEngine:
    def __init__(self, config: Config):
        self.config = config
        self.prompt_template = IntentPromptTemplate()
        if not config.model_path:
            raise RuntimeError(
                "Lexicon intent model not found. Place a .gguf under "
                "electron_node/electron-node/models/lexicon-intent/ "
                f"(default: {DEFAULT_MODEL_FILE}) or set LEXICON_INTENT_MODEL_PATH."
            )
        print(f"[LexiconIntent] Loading CPU model: {config.model_path}", flush=True)
        load_start = time.time()
        self.llm = Llama(
            model_path=config.model_path,
            n_ctx=config.n_ctx,
            n_gpu_layers=config.n_gpu_layers,
            n_threads=config.n_threads,
            verbose=False,
            use_mmap=True,
            use_mlock=False,
        )
        print(f"[LexiconIntent] Model loaded in {time.time() - load_start:.2f}s", flush=True)
        self.model_loaded = True

    def infer(self, payload: dict[str, Any], allowed_domains: list[dict[str, Any]]) -> dict[str, Any]:
        system_message = self.prompt_template.build_system_message(allowed_domains)
        user_message = self.prompt_template.build_user_message(payload)
        messages = [
            {"role": "system", "content": system_message},
            {"role": "user", "content": user_message},
        ]
        output = self.llm.create_chat_completion(
            messages=messages,
            max_tokens=self.config.max_new_tokens,
            temperature=0.1,
            top_p=0.9,
            stop=["```", "\n\n\n"],
        )
        raw = output["choices"][0]["message"]["content"].strip()
        return self._parse_json(raw)

    @staticmethod
    def _parse_json(raw: str) -> dict[str, Any]:
        text = raw.strip()
        fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
        if fence:
            text = fence.group(1).strip()
        start = text.find("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            text = text[start : end + 1]
        return json.loads(text)
