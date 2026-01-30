# -*- coding: utf-8 -*-
"""
Semantic Repair Service - Chinese - Repair Engine
中文语义修复服务 - 修复引擎
"""

import time
import gc
from typing import Dict, List, Optional, Tuple
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

from .prompt_templates import PromptTemplate


class RepairEngine:
    """修复引擎"""
    
    def __init__(
        self,
        model: AutoModelForCausalLM,
        tokenizer: AutoTokenizer,
        device: torch.device
    ):
        """
        初始化修复引擎
        
        Args:
            model: 语言模型
            tokenizer: Tokenizer
            device: 设备
        """
        self.model = model
        self.tokenizer = tokenizer
        self.device = device
        self.prompt_template = PromptTemplate()
        
        # 生成参数（优化内存使用）
        self.max_new_tokens = 64  # 进一步减少最大生成token数（从128降到64）
        self.temperature = 0.1  # 低温度，更确定
        self.top_p = 0.9  # nucleus sampling
        self.do_sample = False  # 使用greedy decoding
    
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
        
        # 记录推理前的GPU状态（用于诊断）
        gpu_before = None
        if self.device.type == "cuda":
            try:
                gpu_before = {
                    'allocated': torch.cuda.memory_allocated() / 1024**3,
                    'reserved': torch.cuda.memory_reserved() / 1024**3,
                }
            except:
                pass
        
        try:
            print(f"[Repair Engine] Starting repair at {time.strftime('%H:%M:%S')} for text: {text_in[:50]}...", flush=True)
            # 构建Prompt
            prompt_start = time.time()
            prompt = self.prompt_template.build_repair_prompt(
                text_in=text_in,
                micro_context=micro_context,
                quality_score=quality_score
            )
            print(f"[Repair Engine] Prompt built (took {(time.time() - prompt_start)*1000:.1f}ms)", flush=True)
            
            # 编码输入（优化内存使用）
            tokenize_start = time.time()
            inputs = self.tokenizer(
                prompt,
                return_tensors="pt",
                padding=True,
                truncation=True,
                max_length=128  # 进一步减少输入长度（从256降到128）
            ).to(self.device)
            print(f"[Repair Engine] Tokenization completed (took {(time.time() - tokenize_start)*1000:.1f}ms, input_ids shape: {inputs['input_ids'].shape})", flush=True)
            
            # 记录生成前资源使用
            before_memory = None
            before_gpu = None
            try:
                import psutil
                process = psutil.Process()
                before_memory = process.memory_info().rss / 1024 / 1024
                if self.device.type == "cuda":
                    before_gpu = torch.cuda.memory_allocated() / 1024**3
                    print(f"[Repair Engine] Before generation - Memory: {before_memory:.2f} MB | GPU: {before_gpu:.2f} GB", flush=True)
            except:
                pass
            
            # 生成修复文本
            # 使用torch.inference_mode()代替torch.no_grad()以进一步减少内存占用
            generate_start = time.time()
            print(f"[Repair Engine] Starting model.generate() at {time.strftime('%H:%M:%S')}...", flush=True)
            with torch.inference_mode():
                outputs = self.model.generate(
                    **inputs,
                    max_new_tokens=self.max_new_tokens,
                    temperature=self.temperature,
                    top_p=self.top_p,
                    do_sample=self.do_sample,
                    pad_token_id=self.tokenizer.eos_token_id,
                    # CPU模式下减少内存占用
                    use_cache=True,  # 使用KV缓存可以减少重复计算
                )
            generate_time = time.time() - generate_start
            print(f"[Repair Engine] Model.generate() completed (took {generate_time:.2f}s, output shape: {outputs.shape})", flush=True)
            
            # 解码输出
            decode_start = time.time()
            generated_text = self.tokenizer.decode(
                outputs[0][inputs['input_ids'].shape[1]:],
                skip_special_tokens=True
            ).strip()
            print(f"[Repair Engine] Decoding completed (took {(time.time() - decode_start)*1000:.1f}ms, generated: {generated_text[:50]}...)", flush=True)
            
            # 立即清理GPU缓存（在解码后）
            if self.device.type == "cuda":
                del outputs
                torch.cuda.empty_cache()
            
            # 记录生成后资源使用
            try:
                import psutil
                process = psutil.Process()
                after_memory = process.memory_info().rss / 1024 / 1024
                if self.device.type == "cuda" and before_gpu is not None:
                    after_gpu = torch.cuda.memory_allocated() / 1024**3
                    print(f"[Repair Engine] After generation - Memory: {after_memory:.2f} MB (+{after_memory - before_memory:.2f} MB if before available) | GPU: {after_gpu:.2f} GB (+{after_gpu - before_gpu:.2f} GB)", flush=True)
                elif before_memory is not None:
                    print(f"[Repair Engine] After generation - Memory: {after_memory:.2f} MB (+{after_memory - before_memory:.2f} MB)", flush=True)
                else:
                    print(f"[Repair Engine] After generation - Memory: {after_memory:.2f} MB", flush=True)
            except:
                pass
            
            # 提取修复后的文本（去除可能的解释性文字）
            text_out = self._extract_repaired_text(generated_text, text_in)
            
            # 计算diff
            diff = self._calculate_diff(text_in, text_out)
            
            # 计算置信度（简化：基于修改程度）
            confidence = self._calculate_confidence(text_in, text_out, diff)
            
            elapsed_ms = int((time.time() - start_time) * 1000)
            
            # 记录推理后的GPU状态
            gpu_after = None
            if self.device.type == "cuda":
                try:
                    gpu_after = {
                        'allocated': torch.cuda.memory_allocated() / 1024**3,
                        'reserved': torch.cuda.memory_reserved() / 1024**3,
                    }
                    if gpu_before:
                        allocated_diff = gpu_after['allocated'] - gpu_before['allocated']
                        reserved_diff = gpu_after['reserved'] - gpu_before['reserved']
                        print(f"[Repair Engine] GPU memory - Allocated: {gpu_after['allocated']:.3f} GB ({allocated_diff:+.3f} GB), Reserved: {gpu_after['reserved']:.3f} GB ({reserved_diff:+.3f} GB)", flush=True)
                except:
                    pass
            
            print(f"[Repair Engine] Repair completed (total time: {elapsed_ms}ms)", flush=True)
            
            # 清理输入tensors
            del inputs
            
            # 强制垃圾回收（在每次推理后）
            gc.collect()
            if self.device.type == "cuda":
                torch.cuda.empty_cache()
            
            return {
                'text_out': text_out,
                'confidence': confidence,
                'diff': diff,
                'repair_time_ms': elapsed_ms,
            }
        except Exception as e:
            elapsed_ms = int((time.time() - start_time) * 1000)
            print(f"[Repair Engine] ❌ Error during repair after {elapsed_ms}ms: {e}", flush=True)
            import traceback
            traceback.print_exc()
            
            # 清理资源（即使出错也要清理）
            gc.collect()
            if self.device.type == "cuda":
                torch.cuda.empty_cache()
            
            # 发生错误时返回原文
            return {
                'text_out': text_in,
                'confidence': 0.5,
                'diff': [],
                'repair_time_ms': elapsed_ms,
            }
    
    def _extract_repaired_text(self, generated_text: str, original_text: str) -> str:
        """
        从生成文本中提取修复后的文本
        
        注意：模型可能输出解释性文字，需要提取实际的修复文本
        """
        # 去除常见的解释性前缀
        prefixes_to_remove = [
            "修复后的文本：",
            "修正后的文本：",
            "修复：",
            "修正：",
            "输出：",
        ]
        
        text = generated_text
        for prefix in prefixes_to_remove:
            if text.startswith(prefix):
                text = text[len(prefix):].strip()
        
        # 如果生成文本为空或过长，返回原文
        if not text or len(text) > len(original_text) * 2:
            return original_text
        
        return text
    
    def _calculate_diff(self, text_in: str, text_out: str) -> List[Dict]:
        """
        计算文本差异（简化实现）
        
        Returns:
            [{'from': str, 'to': str, 'position': int}, ...]
        """
        if text_in == text_out:
            return []
        
        # 简化实现：使用简单的字符级diff
        # 实际可以使用更复杂的算法（如Myers算法）
        diff = []
        
        # 简单的逐字符比较
        min_len = min(len(text_in), len(text_out))
        i = 0
        
        while i < min_len:
            if text_in[i] != text_out[i]:
                # 找到不同的起始位置
                start = i
                # 找到不同的结束位置
                while i < min_len and text_in[i] != text_out[i]:
                    i += 1
                end = i
                
                diff.append({
                    'from': text_in[start:end],
                    'to': text_out[start:end] if end <= len(text_out) else text_out[start:],
                    'position': start,
                })
            else:
                i += 1
        
        # 处理长度不同的情况
        if len(text_in) != len(text_out):
            if len(text_in) > len(text_out):
                diff.append({
                    'from': text_in[len(text_out):],
                    'to': '',
                    'position': len(text_out),
                })
            else:
                diff.append({
                    'from': '',
                    'to': text_out[len(text_in):],
                    'position': len(text_in),
                })
        
        return diff
    
    def _calculate_confidence(
        self,
        text_in: str,
        text_out: str,
        diff: List[Dict]
    ) -> float:
        """
        计算修复置信度
        
        基于修改程度和diff数量
        """
        if text_in == text_out:
            return 1.0
        
        if not diff:
            return 0.9
        
        # 计算修改比例
        total_changes = sum(len(d['from']) + len(d['to']) for d in diff)
        total_length = max(len(text_in), len(text_out))
        
        if total_length == 0:
            return 0.5
        
        change_ratio = total_changes / total_length
        
        # 修改比例越小，置信度越高
        if change_ratio < 0.1:
            confidence = 0.9
        elif change_ratio < 0.2:
            confidence = 0.8
        elif change_ratio < 0.3:
            confidence = 0.7
        else:
            confidence = 0.6
        
        # 如果diff数量过多，降低置信度
        if len(diff) > 3:
            confidence *= 0.9
        
        return max(0.5, min(1.0, confidence))
    
    def warm_up(self):
        """模型预热（warm-up）"""
        print("[Repair Engine] Starting model warm-up...", flush=True)
        try:
            # 使用一个简单的测试文本进行预热
            test_text = "今天天气很好"
            self.repair(test_text)
            print("[Repair Engine] Model warm-up completed", flush=True)
        except Exception as e:
            print(f"[Repair Engine] Warm-up failed: {e}", flush=True)
