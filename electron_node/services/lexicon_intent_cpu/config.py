# -*- coding: utf-8 -*-
"""Lexicon Intent CPU service configuration."""

import os


# Canonical model location: electron-node/models/lexicon-intent/
DEFAULT_MODEL_FILE = "qwen2.5-3b-instruct-q4_k_m.gguf"


class Config:
    def __init__(self) -> None:
        self.host = os.environ.get("HOST", "127.0.0.1")
        self.port = int(os.environ.get("PORT", "5018"))
        self.service_dir = os.path.dirname(os.path.abspath(__file__))
        self.n_ctx = int(os.environ.get("N_CTX", "2048"))
        self.n_gpu_layers = int(os.environ.get("N_GPU_LAYERS", "0"))
        self.n_threads = int(os.environ.get("N_THREADS", str(max(1, (os.cpu_count() or 4) // 2))))
        self.max_new_tokens = int(os.environ.get("MAX_NEW_TOKENS", "256"))
        self.model_path = self._resolve_model_path()

    def _electron_node_models_dir(self) -> str:
        env_dir = os.environ.get("LEXICON_INTENT_MODEL_DIR", "").strip()
        if env_dir:
            return os.path.abspath(env_dir)
        return os.path.abspath(
            os.path.join(self.service_dir, "..", "..", "electron-node", "models", "lexicon-intent")
        )

    @staticmethod
    def _first_gguf_in_dir(directory: str) -> str | None:
        if not os.path.isdir(directory):
            return None
        files = sorted(name for name in os.listdir(directory) if name.endswith(".gguf"))
        if not files:
            return None
        return os.path.join(directory, files[0])

    def _resolve_model_path(self) -> str | None:
        explicit = os.environ.get("LEXICON_INTENT_MODEL_PATH", "").strip()
        if explicit and os.path.isfile(explicit):
            return explicit

        models_dir = self._electron_node_models_dir()
        canonical = os.path.join(models_dir, DEFAULT_MODEL_FILE)
        if os.path.isfile(canonical):
            return canonical

        scanned = self._first_gguf_in_dir(models_dir)
        if scanned:
            return scanned

        return None
