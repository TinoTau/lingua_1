# -*- coding: utf-8 -*-
"""
语义修复 Llama.cpp 引擎（中/英共用）
与 semantic_repair_zh 一致：保守参数、提取修正正文、失败回退原文
"""

import time
from typing import Dict, Optional
from llama_cpp import Llama

from .prompt_templates import PromptTemplate


class LlamaCppEngine:
    """Llama.cpp 引擎（zh/en 通过 lang 区分 prompt）"""

    def __init__(
        self,
        model_path: str,
        n_ctx: int = 2048,
        n_gpu_layers: int = -1,
        n_threads: Optional[int] = None,
        verbose: bool = False,
    ):
        self.model_path = model_path
        self.prompt_template = PromptTemplate()
        print(f"[LlamaCpp Engine] Loading model from {model_path}...", flush=True)
        load_start = time.time()
        self.llm = Llama(
            model_path=model_path,
            n_ctx=n_ctx,
            n_gpu_layers=n_gpu_layers,
            n_threads=n_threads,
            verbose=verbose,
            use_mmap=True,
            use_mlock=False,
        )
        print(f"[LlamaCpp Engine] Model loaded in {time.time() - load_start:.2f}s", flush=True)
        # 保守参数，降低误改（与 semantic_repair_zh 一致）
        self.max_new_tokens = 128
        self.temperature = 0.25
        self.top_p = 0.92
        self.top_k = 40
        self.model_loaded = True
        print("[LlamaCpp Engine] Engine initialized successfully", flush=True)

    def repair(
        self,
        text_in: str,
        micro_context: Optional[str] = None,
        quality_score: Optional[float] = None,
        lang: str = "zh",
    ) -> Dict:
        """执行修复。lang 用于选择中/英 prompt。"""
        start_time = time.time()
        try:
            user_prompt = self.prompt_template.build_repair_prompt(
                text_in=text_in,
                micro_context=micro_context,
                quality_score=quality_score,
                lang=lang,
            )
            system_message = self.prompt_template.build_system_message(lang=lang)
            if micro_context and lang == "zh":
                system_message += " 特别注意：已提供上一句的上下文信息，请结合上下文进行语义分析，上下文可以帮助你更准确地识别同音字错误。"
            messages = [
                {"role": "system", "content": system_message},
                {"role": "user", "content": user_prompt},
            ]
            stop = ["\n\n", "原文：", "修正：", "<|im_end|>"] if lang == "zh" else ["\n\n", "Original:", "Corrected:", "<|im_end|>"]
            output = self.llm.create_chat_completion(
                messages=messages,
                max_tokens=self.max_new_tokens,
                temperature=self.temperature,
                top_p=self.top_p,
                top_k=self.top_k,
                stop=stop,
            )
            raw = output["choices"][0]["message"]["content"].strip()
            text_out = self._extract_repaired_text(raw, text_in, lang)
            if not text_out or len(text_out) > len(text_in) * 2:
                text_out = text_in
            confidence = 0.85
            diff = [{"from": text_in, "to": text_out, "position": 0}] if text_out != text_in else []
            return {
                "text_out": text_out,
                "confidence": confidence,
                "diff": diff,
                "process_time_ms": int((time.time() - start_time) * 1000),
            }
        except Exception as e:
            print(f"[LlamaCpp Engine] Error during repair: {e}", flush=True)
            import traceback
            traceback.print_exc()
            return {
                "text_out": text_in,
                "confidence": 0.0,
                "diff": [],
                "process_time_ms": int((time.time() - start_time) * 1000),
            }

    def _extract_repaired_text(self, generated: str, original: str, lang: str) -> str:
        """从模型输出中提取修正后正文（与 semantic_repair_zh 一致）"""
        if lang == "en":
            prefixes = ("Corrected:", "Output:", "Fixed:", "Repaired:")
        else:
            prefixes = (
                "修复后的文本：", "修正后的文本：", "修复：", "修正：", "输出：",
                "修复后的文本:", "修正后的文本:", "修复:", "修正:", "输出:",
            )
        text = generated.strip()
        for p in prefixes:
            if text.startswith(p):
                text = text[len(p) :].strip()
                break
        if not text or len(text) > len(original) * 2:
            return original
        return text

    def health(self) -> Dict:
        return {
            "status": "healthy" if self.model_loaded else "unhealthy",
            "engine": "llamacpp",
            "model_path": self.model_path,
        }

    def shutdown(self):
        if hasattr(self, "llm") and self.llm is not None:
            print("[LlamaCpp Engine] Shutting down...", flush=True)
        self.model_loaded = False
