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
        let _ = config::init_config_from_file();
    });
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
    
    let text_trimmed = text.trim();
    
    // 1. 检查空文本
    if rules.filter_empty && text_trimmed.is_empty() {
        return true;
    }
    
    // 2. 检查单个字的无意义语气词
    if rules.single_char_fillers.contains(&text_trimmed.to_string()) {
        return true;
    }
    
    // 3. 检查括号（使用配置文件中的括号字符列表）
    if rules.filter_brackets {
        for bracket_char in &rules.bracket_chars {
            if text_trimmed.contains(bracket_char) {
                return true;
            }
        }
    }
    
    let text_lower = text_trimmed.to_lowercase();
    let context_lower = context.trim().to_lowercase();
    
    // 4. 检查上下文相关的感谢语
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
    
    // 5. 检查精确匹配
    for pattern in &rules.exact_matches {
        if text_trimmed.eq_ignore_ascii_case(pattern) {
            return true;
        }
    }
    
    // 6. 检查部分匹配模式
    for pattern in &rules.contains_patterns {
        if text_lower.contains(&pattern.to_lowercase()) {
            return true;
        }
    }
    
    // 7. 检查需要同时包含多个模式的组合
    for all_contains in &rules.all_contains_patterns {
        if all_contains.patterns.iter().all(|p| text_lower.contains(&p.to_lowercase())) {
            return true;
        }
    }
    
    // 8. 检查字幕相关模式
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
    
    // 9. 检查无意义模式（需要进一步检查是否在括号内）
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
/// 
/// # Arguments
/// * `text` - 原始 ASR 识别文本
/// 
/// # Returns
/// 返回过滤后的文本（如果被过滤则返回空字符串）
pub fn filter_asr_text(text: &str) -> String {
    if is_meaningless_transcript(text) {
        return String::new();
    }
    text.trim().to_string()
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
