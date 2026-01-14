"use strict";
/* Aggregator core decision logic: Text Incompleteness Score + Language Stability Gate
   Copy-paste friendly. No external deps.
*/
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultTuning = defaultTuning;
exports.decideStreamAction = decideStreamAction;
exports.isLangSwitchConfident = isLangSwitchConfident;
exports.textIncompletenessScore = textIncompletenessScore;
exports.shouldCommit = shouldCommit;
exports.endsWithStrongSentencePunct = endsWithStrongSentencePunct;
exports.looksLikeCjk = looksLikeCjk;
exports.countCjkChars = countCjkChars;
exports.countWords = countWords;
exports.endsWithConnectiveOrFiller = endsWithConnectiveOrFiller;
function defaultTuning(mode) {
    const isRoom = mode === "room";
    const isTwoWay = mode === "two_way";
    // 双向互译模式使用与 room 模式相同的参数
    const useRoomParams = isRoom || isTwoWay;
    return {
        // 质量优化：提高 strongMergeMs，降低 softGapMs，降低 scoreThreshold
        // 让更多片段被 MERGE，减少独立翻译，提升翻译质量
        strongMergeMs: useRoomParams ? 800 : 1000, // 提高：让更多短片段被 MERGE
        softGapMs: useRoomParams ? 1000 : 1200, // 降低：让更多片段被 MERGE
        hardGapMs: useRoomParams ? 1500 : 2000,
        langStableP: 0.8,
        langSwitchMargin: useRoomParams ? 0.18 : 0.15,
        langSwitchRequiresGapMs: useRoomParams ? 500 : 600,
        scoreThreshold: 2.5, // 降低：让更多片段被 MERGE
        wShort: 2,
        wVeryShort: 3,
        wGapShort: 2,
        wNoStrongPunct: 1,
        wEndsWithConnective: 1,
        wLowQuality: 1,
        lowQualityThreshold: useRoomParams ? 0.5 : 0.45,
        shortCjkChars: useRoomParams ? 9 : 10,
        veryShortCjkChars: 4,
        shortEnWords: useRoomParams ? 5 : 6,
        veryShortEnWords: 3,
        // 优化：平衡延迟和质量
        // 问题：当前参数导致句子中间截断
        // 调整：提高 commit_interval_ms 和 commit_len，减少句子中间截断
        // 原值：offline 800ms/25字/10词，room 600ms/20字/8词
        // 新值：offline 1200ms/30字/12词，room/two_way 900ms/25字/10词
        commitIntervalMs: useRoomParams ? 900 : 1200, // 提高：减少句子中间截断
        commitLenCjk: useRoomParams ? 25 : 30, // 提高：减少短句被提前提交
        commitLenEnWords: useRoomParams ? 10 : 12, // 提高：减少短句被提前提交
    };
}
// 添加 logger 导入（如果还没有）
const logger_1 = __importDefault(require("../logger"));
function decideStreamAction(prev, curr, mode, tuning = defaultTuning(mode)) {
    if (!prev) {
        logger_1.default.info({
            currText: curr.text.substring(0, 50),
            currStartMs: curr.startMs,
            reason: 'No previous utterance, starting new stream',
        }, 'AggregatorDecision: NEW_STREAM (no previous utterance)');
        return "NEW_STREAM";
    }
    const gapMs = Math.max(0, curr.startMs - prev.endMs);
    // Hard rules
    // P0 修复：只对 manualCut 强制 NEW_STREAM，isFinal 允许 MERGE
    // 因为 P0 只处理 final 结果，如果 isFinal 也强制 NEW_STREAM，会导致无法 MERGE
    if (curr.isManualCut) {
        logger_1.default.info({
            prevText: prev.text.substring(0, 50),
            currText: curr.text.substring(0, 50),
            gapMs,
            gapSeconds: gapMs / 1000,
            reason: 'Manual cut detected',
        }, 'AggregatorDecision: NEW_STREAM (manual cut)');
        return "NEW_STREAM";
    }
    if (gapMs >= tuning.hardGapMs) {
        logger_1.default.info({
            prevText: prev.text.substring(0, 50),
            currText: curr.text.substring(0, 50),
            gapMs,
            gapSeconds: gapMs / 1000,
            hardGapMs: tuning.hardGapMs,
            reason: `Gap too large (${gapMs}ms >= ${tuning.hardGapMs}ms)`,
        }, 'AggregatorDecision: NEW_STREAM (gap too large)');
        return "NEW_STREAM";
    }
    // Language stability gate
    if (isLangSwitchConfident(prev.lang, curr.lang, gapMs, tuning)) {
        logger_1.default.info({
            prevText: prev.text.substring(0, 50),
            currText: curr.text.substring(0, 50),
            prevLang: prev.lang.top1,
            currLang: curr.lang.top1,
            gapMs,
            gapSeconds: gapMs / 1000,
            reason: 'Language switch detected',
        }, 'AggregatorDecision: NEW_STREAM (language switch)');
        return "NEW_STREAM";
    }
    // Strong merge
    if (gapMs <= tuning.strongMergeMs) {
        logger_1.default.info({
            prevText: prev.text.substring(0, 50),
            currText: curr.text.substring(0, 50),
            gapMs,
            gapSeconds: gapMs / 1000,
            strongMergeMs: tuning.strongMergeMs,
            reason: `Gap small enough for strong merge (${gapMs}ms <= ${tuning.strongMergeMs}ms)`,
        }, 'AggregatorDecision: MERGE (strong merge)');
        return "MERGE";
    }
    const score = textIncompletenessScore(prev, curr, gapMs, tuning);
    if (score >= tuning.scoreThreshold && gapMs <= tuning.softGapMs) {
        logger_1.default.info({
            prevText: prev.text.substring(0, 50),
            currText: curr.text.substring(0, 50),
            gapMs,
            gapSeconds: gapMs / 1000,
            score,
            scoreThreshold: tuning.scoreThreshold,
            softGapMs: tuning.softGapMs,
            reason: `Text incompleteness score high enough (${score} >= ${tuning.scoreThreshold}) and gap within soft limit`,
        }, 'AggregatorDecision: MERGE (text incompleteness)');
        return "MERGE";
    }
    logger_1.default.info({
        prevText: prev.text.substring(0, 50),
        currText: curr.text.substring(0, 50),
        gapMs,
        gapSeconds: gapMs / 1000,
        score,
        scoreThreshold: tuning.scoreThreshold,
        softGapMs: tuning.softGapMs,
        strongMergeMs: tuning.strongMergeMs,
        reason: `Score too low (${score} < ${tuning.scoreThreshold}) or gap too large (${gapMs}ms > ${tuning.softGapMs}ms)`,
    }, 'AggregatorDecision: NEW_STREAM (default)');
    return "NEW_STREAM";
}
function isLangSwitchConfident(prevLang, currLang, gapMs, tuning) {
    if (gapMs <= tuning.langSwitchRequiresGapMs)
        return false;
    if (prevLang.p1 < tuning.langStableP || currLang.p1 < tuning.langStableP)
        return false;
    if (prevLang.top1 === currLang.top1)
        return false;
    const p2 = currLang.p2 ?? 0;
    return (currLang.p1 - p2) >= tuning.langSwitchMargin;
}
function textIncompletenessScore(prev, curr, gapMs, tuning) {
    let score = 0;
    const isCjk = looksLikeCjk(curr.text);
    const cjkChars = isCjk ? countCjkChars(curr.text) : 0;
    const enWords = !isCjk ? countWords(curr.text) : 0;
    const short = isCjk ? cjkChars < tuning.shortCjkChars : enWords < tuning.shortEnWords;
    const veryShort = isCjk ? cjkChars < tuning.veryShortCjkChars : enWords < tuning.veryShortEnWords;
    if (veryShort)
        score += tuning.wVeryShort;
    else if (short)
        score += tuning.wShort;
    if (gapMs < (tuning.strongMergeMs + 200))
        score += tuning.wGapShort;
    if (!endsWithStrongSentencePunct(curr.text))
        score += tuning.wNoStrongPunct;
    if (endsWithConnectiveOrFiller(curr.text))
        score += tuning.wEndsWithConnective;
    const q = curr.qualityScore ?? 1.0;
    if (q < tuning.lowQualityThreshold)
        score += tuning.wLowQuality;
    if (!endsWithStrongSentencePunct(prev.text) && gapMs <= tuning.softGapMs)
        score += 1;
    return score;
}
function shouldCommit(pendingText, lastCommitTsMs, nowMs, mode, tuning = defaultTuning(mode)) {
    const elapsed = nowMs - lastCommitTsMs;
    if (elapsed >= tuning.commitIntervalMs)
        return true;
    const isCjk = looksLikeCjk(pendingText);
    if (isCjk)
        return countCjkChars(pendingText) >= tuning.commitLenCjk;
    return countWords(pendingText) >= tuning.commitLenEnWords;
}
/* Helpers */
function endsWithStrongSentencePunct(s) {
    const t = s.trim();
    if (!t)
        return false;
    return /[。！？.!?；;]$/.test(t);
}
function looksLikeCjk(s) {
    return /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/.test(s);
}
function countCjkChars(s) {
    const m = s.match(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/g);
    return m ? m.length : 0;
}
function countWords(s) {
    const t = s.trim();
    if (!t)
        return 0;
    return t.split(/\s+/).filter(Boolean).length;
}
function endsWithConnectiveOrFiller(s) {
    const t = s.trim().toLowerCase();
    if (!t)
        return false;
    const en = ["and", "but", "so", "because", "then"];
    const zh = ["然后", "所以", "但是", "就是", "那个", "嗯", "呃"];
    const ja = ["で", "から", "けど", "えっと"];
    const ko = ["그리고", "근데", "그래서", "어", "음"];
    for (const w of en)
        if (t.endsWith(" " + w) || t === w)
            return true;
    for (const w of zh)
        if (t.endsWith(w))
            return true;
    for (const w of ja)
        if (t.endsWith(w))
            return true;
    for (const w of ko)
        if (t.endsWith(w))
            return true;
    return false;
}
