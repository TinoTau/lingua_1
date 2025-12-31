# -*- coding: utf-8 -*-
"""
M2M100 NMT 服务 - 截断模式生成器
"""
import re


def generate_truncated_patterns(separator_variants):
    """
    从分隔符变体中动态生成所有可能的截断模式
    
    策略：
    1. 提取分隔符中的核心标记（如 "SEP_MARKER"）
    2. 提取分隔符中的特殊字符（如 Unicode 括号）
    3. 为核心标记生成所有可能的截断模式（从完整标记到单个字符）
    4. 为特殊字符生成所有可能的截断模式
    
    Args:
        separator_variants: 分隔符变体列表（如 [" ⟪⟪SEP_MARKER⟫⟫ ", "⟪⟪SEP_MARKER⟫⟫"]）
    
    Returns:
        截断模式列表，按长度降序排序
    """
    truncated_patterns = []
    core_markers = set()  # 核心标记（如 "SEP_MARKER"）
    special_chars = set()  # 特殊字符序列（如 "⟫⟫", "⟪⟪"）
    
    # 第一步：从所有分隔符变体中提取核心标记和特殊字符
    for sep_variant in separator_variants:
        # 提取核心标记：查找连续的字母数字字符序列（可能包含下划线）
        # 查找所有连续的字母数字字符序列（可能包含下划线），这些可能是核心标记
        marker_matches = re.findall(r'[A-Za-z0-9_]+', sep_variant)
        for marker in marker_matches:
            if len(marker) > 1:  # 至少2个字符才认为是核心标记
                core_markers.add(marker)
        
        # 提取特殊字符序列：查找连续的 Unicode 字符（非字母数字）
        # 例如 "⟫⟫", "⟪⟪" 等
        special_char_matches = re.findall(r'[^\w\s]+', sep_variant)
        for special_char in special_char_matches:
            if len(special_char) > 0:
                special_chars.add(special_char)
    
    # 第二步：为核心标记生成所有可能的截断模式
    for core_marker in core_markers:
        # 生成从完整标记到单个字符的所有可能截断
        # 例如 "SEP_MARKER" -> ["SEP_MARKER", "EP_MARKER", "P_MARKER", "_MARKER", "MARKER", "ARKER", "RKER", "KER", "ER", "R"]
        for start_pos in range(len(core_marker)):
            truncated = core_marker[start_pos:]
            if truncated and truncated not in truncated_patterns:
                truncated_patterns.append(truncated)
        
        # 也生成带下划线和空格的变体（如果原标记包含下划线）
        if '_' in core_marker:
            # 例如 "_MARKER", " MARKER" 等
            marker_without_prefix = core_marker.split('_', 1)[-1] if '_' in core_marker else core_marker
            if marker_without_prefix and marker_without_prefix not in truncated_patterns:
                truncated_patterns.append(marker_without_prefix)
            # 带空格前缀的变体
            space_marker = ' ' + marker_without_prefix
            if space_marker not in truncated_patterns:
                truncated_patterns.append(space_marker)
            # 带下划线前缀的变体
            underscore_marker = '_' + marker_without_prefix
            if underscore_marker not in truncated_patterns:
                truncated_patterns.append(underscore_marker)
    
    # 第三步：为特殊字符序列生成所有可能的截断模式
    for special_char in special_chars:
        # 生成从完整序列到单个字符的所有可能截断
        # 例如 "⟫⟫" -> ["⟫⟫", "⟫"]
        for start_pos in range(len(special_char)):
            truncated = special_char[start_pos:]
            if truncated and truncated not in truncated_patterns:
                truncated_patterns.append(truncated)
    
    # 按长度降序排序，优先匹配更长的模式
    truncated_patterns = sorted(list(set(truncated_patterns)), key=len, reverse=True)
    
    return truncated_patterns
