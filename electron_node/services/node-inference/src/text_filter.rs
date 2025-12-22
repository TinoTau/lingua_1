//! ASR 文本过滤工具
//! 
//! 用于过滤 Whisper 模型产生的无意义识别结果，如：
//! - 包含括号的文本（如 "(笑)"、"(字幕:J Chong)" 等）
//! - 视频结尾字幕（如 "謝謝大家收看" 等）
//! - 其他常见的误识别模式
//! 
//! 过滤规则从配置文件 `config/asr_filters.json` 加载，在服务启动时初始化。

pub mod config;

use config::get_config;
use std::sync::OnceLock;

/// 全局配置初始化标志
static CONFIG_INIT: OnceLock<()> = OnceLock::new();

/// 初始化配置（在服务启动时调用）
pub fn init_config() {
    CONFIG_INIT.get_or_init(|| {
        tracing::info!("[ASR Filter] Initializing config...");
        let result = config::init_config_from_file();
        if let Err(e) = result {
            tracing::error!("[ASR Filter] Failed to initialize config: {}", e);
        }
    });
}

/// 检查文本是否包含标点符号
/// 
/// 语音输入的文本不应该包含任何标点符号，所以所有带标点符号的文本都应该被过滤。
/// 包括中文和英文标点符号。
fn contains_punctuation(text: &str) -> bool {
    // 定义所有需要过滤的标点符号
    // 中文标点：，。！？；：、""''（）【】《》…—·等
    // 英文标点：,.!?;:'"()[]{}等
    let punctuation_chars: &[char] = &[
        // 中文标点
        '，', '。', '！', '？', '；', '：', '、', 
        '"', '"', '\u{2018}', '\u{2019}', '（', '）', '【', '】', 
        '《', '》', '…', '—', '·',
        // 英文标点
        ',', '.', '!', '?', ';', ':', '\'', '"', 
        '(', ')', '[', ']', '{', '}',
        // 其他常见标点
        '-', '_', '/', '\\', '|', '@', '#', '$', '%', 
        '^', '&', '*', '+', '=', '<', '>', '~', '`',
    ];
    
    text.chars().any(|c| punctuation_chars.contains(&c))
}

/// 检查文本是否为无意义的识别结果（带上下文判断）
/// 
/// 这个函数用于过滤 Whisper 模型在静音时产生的误识别文本。
/// 这些文本通常来自模型的训练数据（视频字幕），不应该被当作真实的语音输入。
/// 
/// # Arguments
/// 
/// * `text` - 要检查的文本
/// * `context` - 上下文提示（之前的识别结果），用于判断感谢语是否合理
/// 
/// # Returns
/// 
/// 返回 `true` 表示应该过滤掉（无意义），`false` 表示应该保留（有意义）
pub fn is_meaningless_transcript_with_context(text: &str, context: &str) -> bool {
    // 确保配置已初始化
    init_config();
    
    let config = get_config();
    let rules = &config.rules;
    
    // 调试：如果文本包含括号，记录配置状态
    if text.contains('(') || text.contains('（') || text.contains('[') || text.contains('【') {
        tracing::warn!(
            "[ASR Filter Debug] 🔍 Checking text with brackets: \"{}\", filter_brackets={}, bracket_chars={:?}",
            text,
            rules.filter_brackets,
            rules.bracket_chars
        );
    }
    
    let text_trimmed = text.trim();
    
    // 1. 检查空文本
    if rules.filter_empty && text_trimmed.is_empty() {
        return true;
    }
    
    // 2. 检查单个字的无意义语气词
    if rules.single_char_fillers.contains(&text_trimmed.to_string()) {
        return true;
    }
    
    // 3. 检查标点符号（语音输入的文本不应该包含任何标点符号）
    // 包括中文和英文标点符号：，。！？；：、""''（）【】《》…—·,.!?;:'"()[]{}等
    if rules.filter_punctuation {
        if contains_punctuation(text_trimmed) {
            tracing::warn!("[ASR Filter] ✅ Filtering text with punctuation: \"{}\" (filter_punctuation={})", text_trimmed, rules.filter_punctuation);
            return true;
        }
    }
    
    // 4. 检查括号（使用配置文件中的括号字符列表）
    // 人类说话不可能出现括号，所以所有带括号的文本都应该被过滤
    if rules.filter_brackets {
        for bracket_char in &rules.bracket_chars {
            if text_trimmed.contains(bracket_char) {
                tracing::warn!("[ASR Filter] ✅ Filtering text with bracket '{}': \"{}\" (filter_brackets={})", bracket_char, text_trimmed, rules.filter_brackets);
                return true;
            }
        }
    } else {
        // 如果括号过滤被禁用，记录警告
        if text_trimmed.contains('(') || text_trimmed.contains('（') || text_trimmed.contains('[') || text_trimmed.contains('【') {
            tracing::warn!("[ASR Filter] ⚠️ Text contains brackets but filter_brackets is disabled: \"{}\"", text_trimmed);
        }
    }
    
    let text_lower = text_trimmed.to_lowercase();
    let context_lower = context.trim().to_lowercase();
    
    // 5. 检查上下文相关的感谢语
    if rules.context_aware_thanks.enabled {
        let is_thanks_text = rules.context_aware_thanks.thanks_patterns.iter()
            .any(|pattern| text_lower == pattern.to_lowercase() || text_lower.starts_with(&pattern.to_lowercase()));
        
        if is_thanks_text {
            if context_lower.is_empty() || context_lower.chars().count() < rules.context_aware_thanks.min_context_length {
                tracing::debug!("[ASR Filter] Filtering thanks text without context: \"{}\"", text_trimmed);
                return true;
            }
            
            let has_context_indicator = rules.context_aware_thanks.context_indicators.iter()
                .any(|indicator| context_lower.contains(&indicator.to_lowercase()));
            
            if !has_context_indicator {
                tracing::debug!("[ASR Filter] Filtering thanks text without context indicator: \"{}\" (context: \"{}\")", 
                         text_trimmed, context.chars().take(50).collect::<String>());
                return true;
            }
            
            tracing::debug!("[ASR Filter] Keeping thanks text with valid context: \"{}\"", text_trimmed);
        }
    }
    
    // 6. 检查精确匹配
    for pattern in &rules.exact_matches {
        if text_trimmed.eq_ignore_ascii_case(pattern) {
            tracing::info!("[ASR Filter] ✅ Filtering exact match: \"{}\" (pattern: \"{}\")", text_trimmed, pattern);
            return true;
        }
    }
    
    // 7. 检查部分匹配模式
    for pattern in &rules.contains_patterns {
        if text_lower.contains(&pattern.to_lowercase()) {
            return true;
        }
    }
    
    // 8. 检查需要同时包含多个模式的组合
    for all_contains in &rules.all_contains_patterns {
        if all_contains.patterns.iter().all(|p| text_lower.contains(&p.to_lowercase())) {
            return true;
        }
    }
    
    // 9. 检查字幕相关模式
    // 检查是否包含字幕关键词（从配置中读取）
    let has_subtitle_keyword = rules.subtitle_keywords.iter()
        .any(|keyword| text_lower.contains(&keyword.to_lowercase()));
    
    if has_subtitle_keyword {
        for pattern in &rules.subtitle_patterns {
            if text_lower.contains(&pattern.to_lowercase()) {
                return true;
            }
        }
        
        // 检查字幕志愿者信息（从配置中读取）
        for volunteer_pattern in &rules.subtitle_volunteer_patterns {
            if text_lower.contains(&volunteer_pattern.to_lowercase()) {
                if text_lower.chars().count() > rules.subtitle_volunteer_min_length {
                    return true;
                }
            }
        }
    }
    
    // 10. 检查无意义模式（需要进一步检查是否在括号内）
    for pattern in &rules.meaningless_patterns {
        if text_lower.contains(&pattern.to_lowercase()) {
            let pattern_pos = text_lower.find(&pattern.to_lowercase());
            if let Some(pos) = pattern_pos {
                let before = if pos > 0 { &text_lower[..pos] } else { "" };
                let after = if pos + pattern.len() < text_lower.len() { &text_lower[pos + pattern.len()..] } else { "" };
                
                // 检查前后是否有配置的括号字符
                // 检查 before 的最后部分（最多10个字符）是否包含任何括号字符
                let before_check = if before.len() > 10 { &before[before.len().saturating_sub(10)..] } else { before };
                let has_open_bracket = rules.bracket_chars.iter()
                    .any(|bc| before_check.contains(bc));
                // 检查 after 的前面部分（最多50个字符）是否包含任何括号字符
                let after_check = if after.len() > 50 { &after[..50] } else { after };
                let has_close_bracket = rules.bracket_chars.iter()
                    .any(|bc| after_check.contains(bc));
                
                if has_open_bracket || has_close_bracket {
                    return true;
                }
            }
        }
    }
    
    false
}

/// 检查文本是否为无意义的识别结果（不带上下文，向后兼容）
/// 
/// 这个函数调用 `is_meaningless_transcript_with_context`，传入空上下文。
/// 
/// # Arguments
/// 
/// * `text` - 要检查的文本
/// 
/// # Returns
/// 
/// 返回 `true` 表示应该过滤掉（无意义），`false` 表示应该保留（有意义）
pub fn is_meaningless_transcript(text: &str) -> bool {
    is_meaningless_transcript_with_context(text, "")
}

/// 过滤 ASR 文本中的无意义内容
/// 
/// 这个函数会检查文本是否为无意义内容，如果是则返回空字符串，否则返回原文本。
/// 同时会检查文本中是否包含多个无意义片段（用引号或其他分隔符分隔）。
/// 
/// # Arguments
/// * `text` - 原始 ASR 识别文本
/// 
/// # Returns
/// 返回过滤后的文本（如果被过滤则返回空字符串）
pub fn filter_asr_text(text: &str) -> String {
    let text_trimmed = text.trim();
    
    // 记录每次调用（用于调试）
    if text_trimmed.contains('(') || text_trimmed.contains('（') || text_trimmed.contains('[') || text_trimmed.contains('【') {
        tracing::warn!("[ASR Filter] 🔍 filter_asr_text called with bracketed text: \"{}\"", text_trimmed);
    }
    
    // 1. 检查整个文本是否为无意义内容
    if is_meaningless_transcript(text_trimmed) {
        tracing::warn!("[ASR Filter] ✅ Filtering entire text as meaningless: \"{}\"", text_trimmed);
        return String::new();
    }
    
    // 2. 如果文本包含括号，尝试提取括号内的内容和括号外的内容
    // 例如："(字幕:J Chong) 謝謝大家收看" 应该被过滤，因为包含括号
    // 或者："謝謝大家收看 (字幕:J Chong)" 应该过滤掉括号部分
    let config = get_config();
    let rules = &config.rules;
    
    // 检查文本是否包含任何括号字符
    let has_brackets = rules.bracket_chars.iter().any(|bc| text_trimmed.contains(bc));
    
    if has_brackets {
        // 如果文本包含括号，尝试智能分割
        // 使用正则表达式或简单的括号匹配来提取括号内的内容
        let mut segments: Vec<String> = Vec::new();
        let mut current_segment = String::new();
        let mut in_brackets = false;
        let mut bracket_depth = 0;
        let mut bracket_start_char: Option<char> = None;
        
        // 定义括号对
        let bracket_pairs: Vec<(char, char)> = vec![
            ('(', ')'),
            ('（', '）'),
            ('[', ']'),
            ('【', '】'),
        ];
        
        for ch in text_trimmed.chars() {
            // 检查是否是开括号
            let is_open_bracket = bracket_pairs.iter().any(|(open, _)| *open == ch);
            
            if is_open_bracket && !in_brackets {
                // 开始一个新的括号块
                if !current_segment.trim().is_empty() {
                    segments.push(current_segment.trim().to_string());
                    current_segment.clear();
                }
                in_brackets = true;
                bracket_depth = 1;
                bracket_start_char = Some(ch);
                current_segment.push(ch);
            } else if in_brackets {
                current_segment.push(ch);
                // 检查是否是匹配的闭括号
                let is_matching_close = if let Some(start_char) = bracket_start_char {
                    bracket_pairs.iter().any(|(open, close)| *open == start_char && *close == ch)
                } else {
                    false
                };
                
                if is_open_bracket && bracket_start_char == Some(ch) {
                    bracket_depth += 1;
                } else if is_matching_close {
                    bracket_depth -= 1;
                    if bracket_depth == 0 {
                        // 括号块结束
                        let bracket_content = current_segment.trim().to_string();
                        // 检查括号内容是否为无意义
                        // 注意：bracket_content 包含括号本身，如 "(空)"，需要检查括号内的内容
                        let content_without_brackets = bracket_content
                            .trim_start_matches(|c: char| c == '(' || c == '（' || c == '[' || c == '【')
                            .trim_end_matches(|c: char| c == ')' || c == '）' || c == ']' || c == '】')
                            .trim();
                        
                        if is_meaningless_transcript(&bracket_content) || is_meaningless_transcript(content_without_brackets) {
                            tracing::info!("[ASR Filter] Filtering bracketed content: \"{}\" (content: \"{}\")", bracket_content, content_without_brackets);
                        } else {
                            // 如果括号内容有意义，保留它（虽然通常不应该发生）
                            tracing::debug!("[ASR Filter] Keeping bracketed content (unexpected): \"{}\"", bracket_content);
                            segments.push(bracket_content);
                        }
                        current_segment.clear();
                        in_brackets = false;
                        bracket_start_char = None;
                    }
                }
            } else {
                // 不在括号内，正常字符
                current_segment.push(ch);
            }
        }
        
        // 添加最后一个片段（如果有）
        if !current_segment.trim().is_empty() {
            segments.push(current_segment.trim().to_string());
        }
        
        // 过滤掉所有无意义的片段
        let filtered_segments: Vec<String> = segments
            .into_iter()
            .filter(|seg| {
                let seg_trimmed = seg.trim();
                if seg_trimmed.is_empty() {
                    false
                } else {
                    let is_meaningless = is_meaningless_transcript(seg_trimmed);
                    if is_meaningless {
                        tracing::info!("[ASR Filter] Filtering segment: \"{}\"", seg_trimmed);
                    }
                    !is_meaningless
                }
            })
            .collect();
        
        // 如果所有片段都被过滤掉了，返回空字符串
        if filtered_segments.is_empty() {
            tracing::info!("[ASR Filter] All segments filtered, returning empty string for text: \"{}\"", text_trimmed);
            return String::new();
        }
        
        // 重新组合过滤后的文本
        let filtered_text = filtered_segments.join(" ").trim().to_string();
        
        // 对最终结果再次检查
        if is_meaningless_transcript(&filtered_text) {
            return String::new();
        }
        
        return filtered_text;
    }
    
    // 3. 如果没有括号，检查文本中是否包含多个用引号分隔的无意义片段
    // 例如："謝謝大家收看""(字幕:J Chong)""(空)"
    let quote_segments: Vec<&str> = text_trimmed
        .split('"')
        .filter(|s| !s.trim().is_empty())
        .collect();
    
    // 如果所有片段都是无意义的，则过滤整个文本
    if !quote_segments.is_empty() && quote_segments.iter().all(|seg| is_meaningless_transcript(seg.trim())) {
        tracing::debug!("[ASR Filter] Filtering text with all meaningless quote segments: \"{}\"", text_trimmed);
        return String::new();
    }
    
    // 4. 过滤掉文本中的无意义片段，保留有意义的片段
    let mut filtered_segments = Vec::new();
    for segment in quote_segments {
        let segment_trimmed = segment.trim();
        if !segment_trimmed.is_empty() && !is_meaningless_transcript(segment_trimmed) {
            filtered_segments.push(segment_trimmed);
        }
    }
    
    // 如果过滤后没有有意义的片段，返回空字符串
    if filtered_segments.is_empty() {
        return String::new();
    }
    
    // 5. 重新组合过滤后的文本
    let filtered_text = filtered_segments.join(" ");
    
    // 6. 对最终结果再次检查
    if is_meaningless_transcript(&filtered_text) {
        return String::new();
    }
    
    filtered_text.trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_brackets_filtering() {
        init_config();
        assert!(is_meaningless_transcript("(笑)"));
        assert!(is_meaningless_transcript("(字幕:J Chong)"));
        assert!(is_meaningless_transcript("（笑）"));
        assert!(is_meaningless_transcript("[字幕]"));
        assert!(is_meaningless_transcript("【字幕】"));
        assert!(!is_meaningless_transcript("你好"));
    }

    #[test]
    fn test_video_end_subtitles() {
        init_config();
        assert!(is_meaningless_transcript("謝謝大家收看"));
        assert!(is_meaningless_transcript("谢谢大家收看"));
        assert!(is_meaningless_transcript("thank you for watching"));
        assert!(is_meaningless_transcript("Thanks for watching"));
        assert!(!is_meaningless_transcript("谢谢你的帮助"));
    }

    #[test]
    fn test_filter_asr_text_with_brackets() {
        init_config();
        // 测试包含括号的文本应该被过滤
        assert_eq!(filter_asr_text("(字幕:J Chong) 謝謝大家收看"), "");
        assert_eq!(filter_asr_text("謝謝大家收看 (字幕:J Chong)"), "");
        assert_eq!(filter_asr_text("(字幕:J Chong)"), "");
        assert_eq!(filter_asr_text("謝謝大家收看"), "");
        // 测试正常文本应该保留
        assert_eq!(filter_asr_text("你好世界"), "你好世界");
        assert_eq!(filter_asr_text("这是正常的文本"), "这是正常的文本");
    }

    #[test]
    fn test_subtitle_markers() {
        init_config();
        assert!(is_meaningless_transcript("(字幕:J Chong)"));
        assert!(is_meaningless_transcript("字幕:J Chong"));
        assert!(is_meaningless_transcript("字幕 j chong"));
        assert!(is_meaningless_transcript("詞曲:rol"));
        assert!(is_meaningless_transcript("词曲:rol"));
        assert!(!is_meaningless_transcript("这是字幕"));
    }

    #[test]
    fn test_empty_text() {
        init_config();
        assert!(is_meaningless_transcript(""));
        assert!(is_meaningless_transcript("   "));
        assert!(!is_meaningless_transcript("你好世界"));
    }

    #[test]
    fn test_filler_words() {
        init_config();
        // 单个字的语气词应该被过滤
        assert!(is_meaningless_transcript("嗯"));
        assert!(is_meaningless_transcript("啊"));
        assert!(is_meaningless_transcript("呃"));
        assert!(is_meaningless_transcript("额"));
        assert!(is_meaningless_transcript("哦"));
        assert!(is_meaningless_transcript("噢"));
        assert!(is_meaningless_transcript("诶"));
        assert!(is_meaningless_transcript("欸"));
        
        // 包含语气词但不是单独一个字的应该保留
        assert!(!is_meaningless_transcript("嗯嗯"));
        assert!(!is_meaningless_transcript("啊呀"));
        assert!(!is_meaningless_transcript("呃呃"));
        assert!(!is_meaningless_transcript("嗯，好的"));
        assert!(!is_meaningless_transcript("啊，我明白了"));
    }
}
