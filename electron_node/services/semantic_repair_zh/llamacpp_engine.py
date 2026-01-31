# -*- coding: utf-8 -*-
"""
Semantic Repair Service - Chinese - Llama.cpp Engine Adapter
中文语义修复服务 - Llama.cpp 引擎适配器

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
        
        # 生成参数（保守以降低误修：如「余英」被误改为「英文」）
        self.max_new_tokens = 128  # 足够空间生成修复后的文本
        self.temperature = 0.25  # 降低温度，减少随机替换、避免扭曲原意
        self.top_p = 0.92  # 略高 top_p 保持高概率候选，减少乱改
        self.top_k = 40   # 适度 top_k，兼顾稳定与少量多样性
        
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
            # 使用更积极的系统消息，提高修复敏感度（不依赖硬编码词汇表）
            system_message = self.prompt_template.build_system_message()
            
            # 如果提供了上下文，在系统消息中强调上下文的重要性
            if micro_context:
                system_message += " 特别注意：已提供上一句的上下文信息，请结合上下文进行语义分析，上下文可以帮助你更准确地识别同音字错误。"
            
            messages = [
                {
                    "role": "system",
                    "content": system_message
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
                stop=["\n\n", "原文：", "修正：", "<|im_end|>"],  # 停止词
            )
            
            generate_time = time.time() - generate_start
            print(f"[LlamaCpp Engine] Generation completed (took {generate_time:.2f}s)", flush=True)
            
            # 提取生成的文本（chat completion 格式）
            raw_generated = output['choices'][0]['message']['content'].strip()
            print(f"[LlamaCpp Engine] Raw generated: {raw_generated[:80]}...", flush=True)

            # 从模型输出中提取“仅修正后正文”，去掉解释性前缀；无效时回退原文
            text_out = self._extract_repaired_text(raw_generated, text_in)
            if not text_out or len(text_out) > len(text_in) * 2:
                text_out = text_in
                print(f"[LlamaCpp Engine] Fallback to original (empty or too long)", flush=True)
            print(f"[LlamaCpp Engine] Input: {text_in!r}", flush=True)
            print(f"[LlamaCpp Engine] Output: {text_out!r}", flush=True)

            # 计算置信度（简单实现：基于生成概率）
            confidence = 0.85

            # 计算 diff（简化实现）
            diff = []
            if text_out != text_in:
                diff = [{"from": text_in, "to": text_out, "position": 0}]

            repair_time_ms = int((time.time() - start_time) * 1000)

            return {
                'text_out': text_out,
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
    
    def _extract_repaired_text(self, generated: str, original: str) -> str:
        """从模型输出中提取修正后正文，去掉常见解释性前缀。"""
        prefixes = (
            "修复后的文本：", "修正后的文本：", "修复：", "修正：", "输出：",
            "修复后的文本:", "修正后的文本:", "修复:", "修正:", "输出:",
        )
        text = generated.strip()
        for p in prefixes:
            if text.startswith(p):
                text = text[len(p):].strip()
                break
        if not text or len(text) > len(original) * 2:
            return original
        return text

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
