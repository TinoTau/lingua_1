// Aggregator core decision logic: Text Incompleteness Score + Language Stability Gate
// Copy-paste friendly. No external deps.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    Offline,
    Room,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StreamAction {
    Merge,
    NewStream,
}

#[derive(Debug, Clone)]
pub struct LangProbs {
    pub top1: String,
    pub p1: f32,
    pub top2: Option<String>,
    pub p2: Option<f32>,
}

#[derive(Debug, Clone)]
pub struct UtteranceInfo {
    pub text: String,
    pub start_ms: i64,
    pub end_ms: i64,
    pub lang: LangProbs,
    pub quality_score: Option<f32>,
    pub is_final: bool,
    pub is_manual_cut: bool,
}

#[derive(Debug, Clone)]
pub struct AggregatorTuning {
    pub strong_merge_ms: i64,
    pub soft_gap_ms: i64,
    pub hard_gap_ms: i64,

    pub lang_stable_p: f32,
    pub lang_switch_margin: f32,
    pub lang_switch_requires_gap_ms: i64,

    pub score_threshold: i32,
    pub w_short: i32,
    pub w_very_short: i32,
    pub w_gap_short: i32,
    pub w_no_strong_punct: i32,
    pub w_ends_with_connective: i32,
    pub w_low_quality: i32,
    pub low_quality_threshold: f32,

    pub short_cjk_chars: usize,
    pub very_short_cjk_chars: usize,
    pub short_en_words: usize,
    pub very_short_en_words: usize,

    pub commit_interval_ms: i64,
    pub commit_len_cjk: usize,
    pub commit_len_en_words: usize,
}

pub fn default_tuning(mode: Mode) -> AggregatorTuning {
    let is_room = matches!(mode, Mode::Room);
    AggregatorTuning {
        strong_merge_ms: if is_room { 600 } else { 700 },
        soft_gap_ms: if is_room { 1000 } else { 1500 },
        hard_gap_ms: if is_room { 1500 } else { 2000 },

        lang_stable_p: 0.80,
        lang_switch_margin: if is_room { 0.18 } else { 0.15 },
        lang_switch_requires_gap_ms: if is_room { 500 } else { 600 },

        score_threshold: 3,
        w_short: 2,
        w_very_short: 3,
        w_gap_short: 2,
        w_no_strong_punct: 1,
        w_ends_with_connective: 1,
        w_low_quality: 1,
        low_quality_threshold: if is_room { 0.50 } else { 0.45 },

        short_cjk_chars: if is_room { 9 } else { 10 },
        very_short_cjk_chars: 4,
        short_en_words: if is_room { 5 } else { 6 },
        very_short_en_words: 3,

        commit_interval_ms: if is_room { 900 } else { 1400 },
        commit_len_cjk: if is_room { 22 } else { 30 },
        commit_len_en_words: if is_room { 10 } else { 12 },
    }
}

pub fn decide_stream_action(
    prev: Option<&UtteranceInfo>,
    curr: &UtteranceInfo,
    _mode: Mode,
    tuning: &AggregatorTuning,
) -> StreamAction {
    let Some(prev) = prev else { return StreamAction::NewStream; };

    let gap_ms = (curr.start_ms - prev.end_ms).max(0);

    if curr.is_final || curr.is_manual_cut { return StreamAction::NewStream; }
    if gap_ms >= tuning.hard_gap_ms { return StreamAction::NewStream; }

    if is_lang_switch_confident(&prev.lang, &curr.lang, gap_ms, tuning) {
        return StreamAction::NewStream;
    }

    if gap_ms <= tuning.strong_merge_ms { return StreamAction::Merge; }

    let score = text_incompleteness_score(prev, curr, gap_ms, tuning);

    if score >= tuning.score_threshold && gap_ms <= tuning.soft_gap_ms {
        StreamAction::Merge
    } else {
        StreamAction::NewStream
    }
}

pub fn is_lang_switch_confident(
    prev: &LangProbs,
    curr: &LangProbs,
    gap_ms: i64,
    tuning: &AggregatorTuning,
) -> bool {
    if gap_ms <= tuning.lang_switch_requires_gap_ms { return false; }
    if prev.p1 < tuning.lang_stable_p || curr.p1 < tuning.lang_stable_p { return false; }
    if prev.top1 == curr.top1 { return false; }
    let p2 = curr.p2.unwrap_or(0.0);
    (curr.p1 - p2) >= tuning.lang_switch_margin
}

pub fn text_incompleteness_score(
    prev: &UtteranceInfo,
    curr: &UtteranceInfo,
    gap_ms: i64,
    tuning: &AggregatorTuning,
) -> i32 {
    let mut score: i32 = 0;

    let is_cjk = looks_like_cjk(&curr.text);
    let cjk_chars = if is_cjk { count_cjk_chars(&curr.text) } else { 0 };
    let en_words = if !is_cjk { count_words(&curr.text) } else { 0 };

    let short = if is_cjk { cjk_chars < tuning.short_cjk_chars } else { en_words < tuning.short_en_words };
    let very_short = if is_cjk { cjk_chars < tuning.very_short_cjk_chars } else { en_words < tuning.very_short_en_words };

    if very_short { score += tuning.w_very_short; }
    else if short { score += tuning.w_short; }

    if gap_ms < (tuning.strong_merge_ms + 200) { score += tuning.w_gap_short; }

    if !ends_with_strong_sentence_punct(&curr.text) { score += tuning.w_no_strong_punct; }

    if ends_with_connective_or_filler(&curr.text) { score += tuning.w_ends_with_connective; }

    let q = curr.quality_score.unwrap_or(1.0);
    if q < tuning.low_quality_threshold { score += tuning.w_low_quality; }

    if !ends_with_strong_sentence_punct(&prev.text) && gap_ms <= tuning.soft_gap_ms { score += 1; }

    score
}

pub fn should_commit(
    pending_text: &str,
    last_commit_ts_ms: i64,
    now_ms: i64,
    tuning: &AggregatorTuning,
) -> bool {
    let elapsed = now_ms - last_commit_ts_ms;
    if elapsed >= tuning.commit_interval_ms { return true; }

    let is_cjk = looks_like_cjk(pending_text);
    if is_cjk {
        count_cjk_chars(pending_text) >= tuning.commit_len_cjk
    } else {
        count_words(pending_text) >= tuning.commit_len_en_words
    }
}

/* Helpers */

pub fn ends_with_strong_sentence_punct(s: &str) -> bool {
    let t = s.trim_end();
    if t.is_empty() { return false; }
    matches!(t.chars().last().unwrap(), '。' | '！' | '？' | '.' | '!' | '?' | '；' | ';')
}

pub fn looks_like_cjk(s: &str) -> bool {
    s.chars().any(|c| {
        let u = c as u32;
        (0x3040..=0x30FF).contains(&u)
            || (0x3400..=0x4DBF).contains(&u)
            || (0x4E00..=0x9FFF).contains(&u)
            || (0xAC00..=0xD7AF).contains(&u)
    })
}

pub fn count_cjk_chars(s: &str) -> usize {
    s.chars().filter(|c| {
        let u = *c as u32;
        (0x3040..=0x30FF).contains(&u)
            || (0x3400..=0x4DBF).contains(&u)
            || (0x4E00..=0x9FFF).contains(&u)
            || (0xAC00..=0xD7AF).contains(&u)
    }).count()
}

pub fn count_words(s: &str) -> usize {
    s.split_whitespace().filter(|w| !w.is_empty()).count()
}

pub fn ends_with_connective_or_filler(s: &str) -> bool {
    let t = s.trim().to_lowercase();
    if t.is_empty() { return false; }

    let en = ["and", "but", "so", "because", "then"];
    for w in en {
        if t == w || t.ends_with(&format!(" {}", w)) { return true; }
    }

    let zh = ["然后", "所以", "但是", "就是", "那个", "嗯", "呃"];
    let ja = ["で", "から", "けど", "えっと"];
    let ko = ["그리고", "근데", "그래서", "어", "음"];

    for w in zh.iter().chain(ja.iter()).chain(ko.iter()) {
        if t.ends_with(w) { return true; }
    }
    false
}
