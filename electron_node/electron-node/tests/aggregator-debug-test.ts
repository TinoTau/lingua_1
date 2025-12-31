/**
 * Aggregator 调试测试
 * 用于调试失败的测试用例
 */

import { AggregatorManager } from '../main/src/aggregator';
import { SegmentInfo } from '../main/src/task-router/types';
import { decideStreamAction, defaultTuning, isLangSwitchConfident, textIncompletenessScore } from '../main/src/aggregator/aggregator-decision';
import { UtteranceInfo } from '../main/src/aggregator/aggregator-decision';

function debugTest04() {
  console.log('\n=== 调试 t04_lang_switch_not_confident_merge ===\n');
  
  const mode = 'offline';
  const tuning = defaultTuning(mode);
  
  const prev: UtteranceInfo = {
    text: '我们用 OpenAI',
    startMs: 0,
    endMs: 1000,
    lang: { top1: 'zh', p1: 0.78, top2: 'en', p2: 0.18 },
    qualityScore: 0.6,
    isFinal: false,
    isManualCut: false,
  };
  
  const curr: UtteranceInfo = {
    text: 'API 来做',
    startMs: 1400,
    endMs: 1900,
    lang: { top1: 'en', p1: 0.74, top2: 'zh', p2: 0.22 },
    qualityScore: 0.6,
    isFinal: false,
    isManualCut: false,
  };
  
  const gapMs = curr.startMs - prev.endMs;
  console.log('参数:');
  console.log('  gapMs:', gapMs);
  console.log('  prevLang:', prev.lang);
  console.log('  currLang:', curr.lang);
  console.log('  tuning:', {
    langStableP: tuning.langStableP,
    langSwitchMargin: tuning.langSwitchMargin,
    langSwitchRequiresGapMs: tuning.langSwitchRequiresGapMs,
    strongMergeMs: tuning.strongMergeMs,
    softGapMs: tuning.softGapMs,
    scoreThreshold: tuning.scoreThreshold,
  });
  
  console.log('\n决策过程:');
  
  // Hard rules
  console.log('1. Hard rules:');
  console.log('   isManualCut:', curr.isManualCut, '→', curr.isManualCut ? 'NEW_STREAM' : '继续');
  console.log('   gapMs >= hardGapMs:', gapMs, '>=', tuning.hardGapMs, '→', gapMs >= tuning.hardGapMs ? 'NEW_STREAM' : '继续');
  
  // Language stability gate
  const langSwitchConfident = isLangSwitchConfident(prev.lang, curr.lang, gapMs, tuning);
  console.log('2. Language stability gate:');
  console.log('   isLangSwitchConfident:', langSwitchConfident, '→', langSwitchConfident ? 'NEW_STREAM' : '继续');
  console.log('   检查:');
  console.log('     gapMs <= langSwitchRequiresGapMs:', gapMs, '<=', tuning.langSwitchRequiresGapMs, '→', gapMs <= tuning.langSwitchRequiresGapMs);
  console.log('     prevLang.p1 < langStableP:', prev.lang.p1, '<', tuning.langStableP, '→', prev.lang.p1 < tuning.langStableP);
  console.log('     currLang.p1 < langStableP:', curr.lang.p1, '<', tuning.langStableP, '→', curr.lang.p1 < tuning.langStableP);
  console.log('     prevLang.top1 === currLang.top1:', prev.lang.top1, '===', curr.lang.top1, '→', prev.lang.top1 === curr.lang.top1);
  if (!langSwitchConfident && prev.lang.top1 !== curr.lang.top1) {
    const p2 = curr.lang.p2 ?? 0;
    console.log('     (currLang.p1 - p2) >= langSwitchMargin:', curr.lang.p1, '-', p2, '>=', tuning.langSwitchMargin, '→', (curr.lang.p1 - p2) >= tuning.langSwitchMargin);
  }
  
  // Strong merge
  const strongMerge = gapMs <= tuning.strongMergeMs;
  console.log('3. Strong merge:');
  console.log('   gapMs <= strongMergeMs:', gapMs, '<=', tuning.strongMergeMs, '→', strongMerge ? 'MERGE' : '继续');
  
  // Score merge
  const score = textIncompletenessScore(prev, curr, gapMs, tuning);
  const scoreMerge = score >= tuning.scoreThreshold && gapMs <= tuning.softGapMs;
  console.log('4. Score merge:');
  console.log('   score:', score);
  console.log('   score >= scoreThreshold:', score, '>=', tuning.scoreThreshold, '→', score >= tuning.scoreThreshold);
  console.log('   gapMs <= softGapMs:', gapMs, '<=', tuning.softGapMs, '→', gapMs <= tuning.softGapMs);
  console.log('   →', scoreMerge ? 'MERGE' : '继续');
  
  const action = decideStreamAction(prev, curr, mode, tuning);
  console.log('\n最终决策:', action);
  console.log('预期: MERGE');
  console.log('结果:', action === 'MERGE' ? '✅ 通过' : '❌ 失败');
}

function debugTest06() {
  console.log('\n=== 调试 t06_very_short_merge_by_score ===\n');
  
  const mode = 'offline';
  const tuning = defaultTuning(mode);
  
  const prev: UtteranceInfo = {
    text: '我想说的是',
    startMs: 0,
    endMs: 900,
    lang: { top1: 'zh', p1: 0.93, top2: 'en', p2: 0.03 },
    qualityScore: 0.8,
    isFinal: false,
    isManualCut: false,
  };
  
  const curr: UtteranceInfo = {
    text: '嗯',
    startMs: 1400,
    endMs: 1500,
    lang: { top1: 'zh', p1: 0.9, top2: 'en', p2: 0.05 },
    qualityScore: 0.4,
    isFinal: false,
    isManualCut: false,
  };
  
  const gapMs = curr.startMs - prev.endMs;
  const score = textIncompletenessScore(prev, curr, gapMs, tuning);
  
  console.log('参数:');
  console.log('  gapMs:', gapMs);
  console.log('  curr.text:', curr.text);
  console.log('  curr.qualityScore:', curr.qualityScore);
  console.log('  score:', score);
  console.log('  scoreThreshold:', tuning.scoreThreshold);
  console.log('  softGapMs:', tuning.softGapMs);
  
  const action = decideStreamAction(prev, curr, mode, tuning);
  console.log('\n最终决策:', action);
  console.log('预期: MERGE');
  console.log('结果:', action === 'MERGE' ? '✅ 通过' : '❌ 失败');
}

function debugTest07() {
  console.log('\n=== 调试 t07_gap_middle_score_low_new_stream ===\n');
  
  const mode = 'offline';
  const tuning = defaultTuning(mode);
  
  const prev: UtteranceInfo = {
    text: '我们已经完成了。',
    startMs: 0,
    endMs: 1000,
    lang: { top1: 'zh', p1: 0.95, top2: 'en', p2: 0.02 },
    qualityScore: 0.9,
    isFinal: false,
    isManualCut: false,
  };
  
  const curr: UtteranceInfo = {
    text: '嗯 然后',
    startMs: 2400,
    endMs: 2800,
    lang: { top1: 'zh', p1: 0.88, top2: 'en', p2: 0.06 },
    qualityScore: 0.8,
    isFinal: false,
    isManualCut: false,
  };
  
  const gapMs = curr.startMs - prev.endMs;
  const score = textIncompletenessScore(prev, curr, gapMs, tuning);
  
  console.log('参数:');
  console.log('  gapMs:', gapMs);
  console.log('  prev.text:', prev.text, '(有句号)');
  console.log('  curr.text:', curr.text);
  console.log('  score:', score);
  console.log('  scoreThreshold:', tuning.scoreThreshold);
  console.log('  softGapMs:', tuning.softGapMs);
  
  const action = decideStreamAction(prev, curr, mode, tuning);
  console.log('\n最终决策:', action);
  console.log('预期: MERGE');
  console.log('结果:', action === 'MERGE' ? '✅ 通过' : '❌ 失败');
}

if (require.main === module) {
  debugTest04();
  debugTest06();
  debugTest07();
}

export { debugTest04, debugTest06, debugTest07 };

