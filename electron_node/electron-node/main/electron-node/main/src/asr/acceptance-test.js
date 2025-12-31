"use strict";
/* S1/S2 验收测试脚本
   用于验证功能是否正常工作
*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.runAcceptanceTests = runAcceptanceTests;
exports.printAcceptanceResults = printAcceptanceResults;
const prompt_builder_1 = require("./prompt-builder");
const need_rescore_1 = require("./need-rescore");
const rescorer_1 = require("./rescorer");
const aggregator_state_1 = require("../aggregator/aggregator-state");
/**
 * 验收测试：验证S1/S2功能
 */
function runAcceptanceTests() {
    const results = [];
    let passed = 0;
    let failed = 0;
    // 测试1: PromptBuilder基本功能
    try {
        const builder = new prompt_builder_1.PromptBuilder('offline');
        const prompt = builder.build({
            userKeywords: ['测试关键词'],
            recentCommittedText: ['最近文本'],
            qualityScore: 0.8,
        });
        if (prompt && prompt.includes('Keywords') && prompt.includes('测试关键词')) {
            results.push({ name: 'PromptBuilder基本功能', passed: true });
            passed++;
        }
        else {
            results.push({ name: 'PromptBuilder基本功能', passed: false, error: 'Prompt格式不正确' });
            failed++;
        }
    }
    catch (error) {
        results.push({ name: 'PromptBuilder基本功能', passed: false, error: error.message });
        failed++;
    }
    // 测试2: NeedRescoreDetector短句检测
    try {
        const detector = new need_rescore_1.NeedRescoreDetector();
        const result = detector.detect({
            commitText: '短句',
            mode: 'offline',
        });
        if (result.needRescore && result.reasons.includes('short_utterance')) {
            results.push({ name: 'NeedRescoreDetector短句检测', passed: true });
            passed++;
        }
        else {
            results.push({ name: 'NeedRescoreDetector短句检测', passed: false, error: '未正确检测短句' });
            failed++;
        }
    }
    catch (error) {
        results.push({ name: 'NeedRescoreDetector短句检测', passed: false, error: error.message });
        failed++;
    }
    // 测试3: Rescorer基本功能
    try {
        const rescorer = new rescorer_1.Rescorer();
        const result = rescorer.rescore({
            primaryText: '原始文本',
            candidates: [
                { text: '原始文本', source: 'primary' },
                { text: '更好的文本', source: 'nbest' },
            ],
            recentCommittedText: [],
            userKeywords: [],
        });
        if (result && result.bestText && result.candidateScores.length === 2) {
            results.push({ name: 'Rescorer基本功能', passed: true });
            passed++;
        }
        else {
            results.push({ name: 'Rescorer基本功能', passed: false, error: 'Rescoring结果不正确' });
            failed++;
        }
    }
    catch (error) {
        results.push({ name: 'Rescorer基本功能', passed: false, error: error.message });
        failed++;
    }
    // 测试4: AggregatorState新增字段
    try {
        const state = new aggregator_state_1.AggregatorState('test-session', 'offline');
        state.processUtterance('测试文本', undefined, { top1: 'zh', p1: 0.9 }, 0.8, true, false);
        const recentText = state.getRecentCommittedText();
        if (Array.isArray(recentText)) {
            results.push({ name: 'AggregatorState新增字段', passed: true });
            passed++;
        }
        else {
            results.push({ name: 'AggregatorState新增字段', passed: false, error: '无法获取recentCommittedText' });
            failed++;
        }
    }
    catch (error) {
        results.push({ name: 'AggregatorState新增字段', passed: false, error: error.message });
        failed++;
    }
    return { passed, failed, results };
}
/**
 * 打印验收测试结果
 */
function printAcceptanceResults() {
    const { passed, failed, results } = runAcceptanceTests();
    console.log('\n=== S1/S2 验收测试结果 ===\n');
    for (const result of results) {
        const status = result.passed ? '✓' : '✗';
        console.log(`${status} ${result.name}`);
        if (!result.passed && result.error) {
            console.log(`  错误: ${result.error}`);
        }
    }
    console.log(`\n总计: ${passed} 通过, ${failed} 失败\n`);
    if (failed === 0) {
        console.log('✓ 所有测试通过！');
    }
    else {
        console.log('✗ 部分测试失败，请检查实现');
    }
}
// 如果直接运行此文件，执行测试
if (require.main === module) {
    printAcceptanceResults();
}
