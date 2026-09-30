//! Unicode codepoint (Rust `char`) alignment — deterministic, no ML.

use serde::{Deserialize, Serialize};

pub const NORMALIZER_VERSION: &str = "corr-normalizer-v1";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SpanOperation {
    Replace,
    Insert,
    Delete,
}

/// Aligned correction span. Offsets are Unicode scalar (Rust `char`) indices.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AlignedCorrectionSpan {
    pub source_start: usize,
    pub source_end: usize,
    pub target_start: usize,
    pub target_end: usize,
    pub source_text: String,
    pub target_text: String,
    pub operation: SpanOperation,
}

/// Minimal canonicalization for alignment only (does not mutate stored CorrectionEvent).
pub fn canonicalize_for_alignment(s: &str) -> String {
    s.replace("\r\n", "\n").replace('\r', "\n")
}

fn chars_of(s: &str) -> Vec<char> {
    s.chars().collect()
}

/// Myers/DP Levenshtein alignment over Unicode scalars → coalesced spans.
pub fn align_codepoints(system: &str, corrected: &str) -> Vec<AlignedCorrectionSpan> {
    let a = chars_of(&canonicalize_for_alignment(system));
    let b = chars_of(&canonicalize_for_alignment(corrected));
    if a == b {
        return Vec::new();
    }

    let n = a.len();
    let m = b.len();
    // dp[i][j] = edit distance of a[0..i], b[0..j]
    let mut dp = vec![vec![0u32; m + 1]; n + 1];
    for i in 0..=n {
        dp[i][0] = i as u32;
    }
    for j in 0..=m {
        dp[0][j] = j as u32;
    }
    for i in 1..=n {
        for j in 1..=m {
            let cost = if a[i - 1] == b[j - 1] { 0 } else { 1 };
            dp[i][j] = (dp[i - 1][j] + 1)
                .min(dp[i][j - 1] + 1)
                .min(dp[i - 1][j - 1] + cost);
        }
    }

    // Backtrack: prefer diagonal (match/replace), then delete, then insert for determinism.
    let mut ops: Vec<(SpanOperation, usize, usize, Option<char>, Option<char>)> = Vec::new();
    let mut i = n;
    let mut j = m;
    while i > 0 || j > 0 {
        if i > 0 && j > 0 && a[i - 1] == b[j - 1] && dp[i][j] == dp[i - 1][j - 1] {
            i -= 1;
            j -= 1;
            continue;
        }
        if i > 0 && j > 0 && dp[i][j] == dp[i - 1][j - 1] + 1 {
            ops.push((
                SpanOperation::Replace,
                i - 1,
                j - 1,
                Some(a[i - 1]),
                Some(b[j - 1]),
            ));
            i -= 1;
            j -= 1;
            continue;
        }
        if i > 0 && dp[i][j] == dp[i - 1][j] + 1 {
            ops.push((
                SpanOperation::Delete,
                i - 1,
                j,
                Some(a[i - 1]),
                None,
            ));
            i -= 1;
            continue;
        }
        // insert
        ops.push((
            SpanOperation::Insert,
            i,
            j - 1,
            None,
            Some(b[j - 1]),
        ));
        j -= 1;
    }
    ops.reverse();
    coalesce_ops(&ops)
}

fn coalesce_ops(
    ops: &[(SpanOperation, usize, usize, Option<char>, Option<char>)],
) -> Vec<AlignedCorrectionSpan> {
    let mut out = Vec::new();
    let mut idx = 0;
    while idx < ops.len() {
        let (op0, _, _, _, _) = ops[idx];
        let mut k = idx + 1;
        while k < ops.len() && ops[k].0 == op0 && is_adjacent(&ops[k - 1], &ops[k], op0) {
            k += 1;
        }
        let slice = &ops[idx..k];
        let span = match op0 {
            SpanOperation::Replace => {
                let source_start = slice.first().unwrap().1;
                let source_end = slice.last().unwrap().1 + 1;
                let target_start = slice.first().unwrap().2;
                let target_end = slice.last().unwrap().2 + 1;
                let source_text: String = slice.iter().filter_map(|o| o.3).collect();
                let target_text: String = slice.iter().filter_map(|o| o.4).collect();
                AlignedCorrectionSpan {
                    source_start,
                    source_end,
                    target_start,
                    target_end,
                    source_text,
                    target_text,
                    operation: SpanOperation::Replace,
                }
            }
            SpanOperation::Delete => {
                let source_start = slice.first().unwrap().1;
                let source_end = slice.last().unwrap().1 + 1;
                let target_pos = slice.first().unwrap().2;
                let source_text: String = slice.iter().filter_map(|o| o.3).collect();
                AlignedCorrectionSpan {
                    source_start,
                    source_end,
                    target_start: target_pos,
                    target_end: target_pos,
                    source_text,
                    target_text: String::new(),
                    operation: SpanOperation::Delete,
                }
            }
            SpanOperation::Insert => {
                let source_pos = slice.first().unwrap().1;
                let target_start = slice.first().unwrap().2;
                let target_end = slice.last().unwrap().2 + 1;
                let target_text: String = slice.iter().filter_map(|o| o.4).collect();
                AlignedCorrectionSpan {
                    source_start: source_pos,
                    source_end: source_pos,
                    target_start,
                    target_end,
                    source_text: String::new(),
                    target_text,
                    operation: SpanOperation::Insert,
                }
            }
        };
        out.push(span);
        idx = k;
    }
    out
}

fn is_adjacent(
    prev: &(SpanOperation, usize, usize, Option<char>, Option<char>),
    next: &(SpanOperation, usize, usize, Option<char>, Option<char>),
    op: SpanOperation,
) -> bool {
    match op {
        SpanOperation::Replace => prev.1 + 1 == next.1 && prev.2 + 1 == next.2,
        SpanOperation::Delete => prev.1 + 1 == next.1 && prev.2 == next.2,
        SpanOperation::Insert => prev.1 == next.1 && prev.2 + 1 == next.2,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_text_no_spans() {
        assert!(align_codepoints("你好", "你好").is_empty());
    }

    #[test]
    fn single_replace_chinese() {
        let spans = align_codepoints("预定", "预订");
        assert_eq!(spans.len(), 1);
        assert_eq!(spans[0].operation, SpanOperation::Replace);
        assert_eq!(spans[0].source_text, "定");
        assert_eq!(spans[0].target_text, "订");
        assert_eq!(spans[0].source_start, 1);
        assert_eq!(spans[0].source_end, 2);
    }

    #[test]
    fn insert_delete_english() {
        let ins = align_codepoints("cat", "cart");
        assert!(ins.iter().any(|s| s.operation == SpanOperation::Insert));
        let del = align_codepoints("cart", "cat");
        assert!(del.iter().any(|s| s.operation == SpanOperation::Delete));
    }

    #[test]
    fn mixed_and_deterministic() {
        let a = align_codepoints("米福游船", "米尔福德游船");
        let b = align_codepoints("米福游船", "米尔福德游船");
        assert_eq!(a, b);
        assert!(!a.is_empty());
    }

    #[test]
    fn punctuation_and_whitespace() {
        let spans = align_codepoints("hello, world", "hello world");
        assert!(!spans.is_empty());
    }

    #[test]
    fn unicode_emoji_safe() {
        // offsets are char indices, not bytes
        let spans = align_codepoints("a😀b", "a😁b");
        assert_eq!(spans.len(), 1);
        assert_eq!(spans[0].source_start, 1);
        assert_eq!(spans[0].source_end, 2);
    }
}
