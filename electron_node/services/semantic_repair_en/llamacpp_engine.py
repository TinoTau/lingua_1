# -*- coding: utf-8 -*-
"""
Semantic Repair Service - English - Llama.cpp Engine Adapter
英文语义修复服务 - Llama.cpp 引擎适配器

实现统一的引擎接口，使用 llama.cpp 进行推理
"""

import time
import os
from typing import Dict, Optional
from llama_cpp import Llama

from prompt_templates import PromptTemplate


class LlamaCppEngine:
    """Llama.cpp 引擎适配器"""
    
    def __init__(
        self,
        model_path: str,
        n_ctx: int = 2048,
        n_gpu_layers: int = -1,  # -1 表示使用所有 GPU 层
        n_threads: Optional[int] = None,  # None 表示自动
        verbose: bool = False
    ):
        """
        初始化 Llama.cpp 引擎
        
        Args:
            model_path: GGUF 模型文件路径
            n_ctx: 上下文窗口大小
            n_gpu_layers: GPU 层数（-1 表示全部使用 GPU）
            n_threads: CPU 线程数（None 表示自动）
            verbose: 是否输出详细日志
        """
        self.model_path = model_path
        self.prompt_template = PromptTemplate()
        
        print(f"[LlamaCpp Engine] Loading model from {model_path}...", flush=True)
        load_start = time.time()
        
        # 加载模型
        self.llm = Llama(
            model_path=model_path,
            n_ctx=n_ctx,
            n_gpu_layers=n_gpu_layers,  # 使用 GPU
            n_threads=n_threads,
            verbose=verbose,
            # 其他优化参数
            use_mmap=True,  # 使用内存映射
            use_mlock=False,  # Windows 上可能不支持
        )
        
        load_time = time.time() - load_start
        print(f"[LlamaCpp Engine] Model loaded in {load_time:.2f}s", flush=True)
        
        # 生成参数（优化以提高修复敏感度）
        self.max_new_tokens = 128  # 增加最大token数，确保有足够空间生成修复后的文本
        self.temperature = 0.6  # 提高温度，让模型更主动修复（从0.1提高到0.6）
        self.top_p = 0.85  # 降低top_p，增加生成多样性
        self.top_k = 30  # 降低top_k，增加生成多样性
        
        # 记录模型信息
        self.model_loaded = True
        print(f"[LlamaCpp Engine] Engine initialized successfully", flush=True)
    
    def repair(
        self,
        text_in: str,
        micro_context: Optional[str] = None,
        quality_score: Optional[float] = None
    ) -> Dict:
        """
        执行修复
        
        Args:
            text_in: 输入文本
            micro_context: 微上下文（可选）
            quality_score: 质量分数（可选）
        
        Returns:
            {
                'text_out': str,
                'confidence': float,
                'diff': List[Dict],
                'repair_time_ms': int
            }
        """
        start_time = time.time()
        
        try:
            print(f"[LlamaCpp Engine] Starting repair at {time.strftime('%H:%M:%S')} for text: {text_in[:50]}...", flush=True)
            
            # 构建Prompt（使用chat格式）
            prompt_start = time.time()
            user_prompt = self.prompt_template.build_repair_prompt(
                text_in=text_in,
                micro_context=micro_context,
                quality_score=quality_score
            )
            print(f"[LlamaCpp Engine] Prompt built (took {(time.time() - prompt_start)*1000:.1f}ms)", flush=True)
            
            # 使用 chat completion 格式（Qwen2.5-Instruct 是 chat 模型）
            generate_start = time.time()
            print(f"[LlamaCpp Engine] Starting generation at {time.strftime('%H:%M:%S')}...", flush=True)
            
            # 构建消息列表（Qwen2.5 格式）
            messages = [
                {
                    "role": "system",
                    "content": "You are a professional speech recognition post-processor specialized in fixing homophone errors, typos, and other issues in ASR (Automatic Speech Recognition) output English text. Your task is to identify and fix obvious homophone errors, typos, and near-sound word errors while keeping the original semantics and tone unchanged. Do not add new information, do not expand, and do not change the original meaning. Always follow the \"minimal edit\" principle: only modify obvious errors, keep other content unchanged."
                },
                {
                    "role": "user",
                    "content": user_prompt
                }
            ]
            
            output = self.llm.create_chat_completion(
                messages=messages,
                max_tokens=self.max_new_tokens,
                temperature=self.temperature,
                top_p=self.top_p,
                top_k=self.top_k,
                stop=["\n\n", "Original:", "Corrected:", "<|im_end|>"],  # 停止词
            )
            
            generate_time = time.time() - generate_start
            print(f"[LlamaCpp Engine] Generation completed (took {generate_time:.2f}s)", flush=True)
            
            # 提取生成的文本（chat completion 格式）
            generated_text = output['choices'][0]['message']['content'].strip()
            print(f"[LlamaCpp Engine] Generated: {generated_text[:50]}...", flush=True)
            print(f"[LlamaCpp Engine] Full generated text: {generated_text!r}", flush=True)
            print(f"[LlamaCpp Engine] Input text: {text_in!r}", flush=True)
            print(f"[LlamaCpp Engine] Text changed: {generated_text != text_in}", flush=True)
            
            # 计算置信度（简单实现：基于生成概率）
            # llama.cpp 不直接提供概率，使用简单的启发式方法
            confidence = 0.85  # 默认置信度
            
            # 计算 diff（简化实现）
            diff = []
            if generated_text != text_in:
                # 简单的 diff 计算
                # 这里可以后续优化
                diff = [{"from": text_in, "to": generated_text, "position": 0}]
            
            repair_time_ms = int((time.time() - start_time) * 1000)
            
            return {
                'text_out': generated_text,
                'confidence': confidence,
                'diff': diff,
                'repair_time_ms': repair_time_ms
            }
            
        except Exception as e:
            print(f"[LlamaCpp Engine] Error during repair: {e}", flush=True)
            import traceback
            traceback.print_exc()
            # 返回原文本，避免服务崩溃
            return {
                'text_out': text_in,
                'confidence': 0.0,
                'diff': [],
                'repair_time_ms': int((time.time() - start_time) * 1000)
            }
    
    def health(self) -> Dict:
        """健康检查"""
        return {
            'status': 'healthy' if self.model_loaded else 'unhealthy',
            'engine': 'llamacpp',
            'model_path': self.model_path
        }
    
    def shutdown(self):
        """关闭引擎"""
        if hasattr(self, 'llm') and self.llm is not None:
            print("[LlamaCpp Engine] Shutting down...", flush=True)
            # llama.cpp 会自动清理资源
            self.model_loaded = False
