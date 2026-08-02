import fs from 'fs';

export function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

export function loadJsonl(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  return fs
    .readFileSync(filePath, 'utf-8')
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

export function aggregateV5FromBatch(batch) {
  const v5 = batch?.summary?.v5_summary ?? {};
  const canonical = {
    confusion_evidence_total: batch?.summary?.confusion_evidence_total ?? 0,
  };
  return {
    topk_hit_rate: v5.topk_hit_rate ?? 0,
    top1_hit_rate: v5.top1_hit_rate ?? 0,
    alias_hit_rate: v5.alias_hit_rate ?? 0,
    alias_hit_count: v5.alias_hit_count_total ?? 0,
    exact_lookup_hit_count: v5.exact_lookup_hit_count_total ?? 0,
    pinyin_hit_rate: v5.pinyin_hit_rate ?? 0,
    pinyin_attempt_count: v5.pinyin_attempt_count_total ?? 0,
    pinyin_hit_count: v5.pinyin_hit_count_total ?? 0,
    no_op_repair_rate: v5.no_op_repair_rate ?? 0,
    no_op_repair_count: v5.no_op_repair_count_total ?? 0,
    lexicon_pinyin_topk_candidate_total: v5.lexicon_pinyin_topk_candidate_total ?? 0,
    ...canonical,
  };
}

export function compareToBaseline(metrics, baseline, thresholds = {}) {
  const violations = [];
  const topkMin = thresholds.topk_hit_rate_min_delta ?? -0.1;
  if (
    baseline.topk_hit_rate != null &&
    metrics.topk_hit_rate < baseline.topk_hit_rate + topkMin
  ) {
    violations.push({
      metric: 'topk_hit_rate',
      actual: metrics.topk_hit_rate,
      baseline: baseline.topk_hit_rate,
    });
  }
  if ((metrics.confusion_evidence_total ?? 0) !== 0) {
    violations.push({
      metric: 'confusion_evidence_total',
      actual: metrics.confusion_evidence_total,
      expected: 0,
    });
  }
  return {
    regression_pass: violations.length === 0,
    violations,
  };
}

export function buildCanonicalTopkReport(metrics, manifest) {
  return {
    schemaVersion: 'phase5-canonical-topk-v1',
    lexiconCount: manifest?.lexiconCount ?? manifest?.enabledCount ?? 0,
    topk_hit_rate: metrics.topk_hit_rate ?? 0,
    top1_hit_rate: metrics.top1_hit_rate ?? 0,
    alias_hit_rate: metrics.alias_hit_rate ?? 0,
    alias_hit_count: metrics.alias_hit_count ?? 0,
    pinyin_hit_rate: metrics.pinyin_hit_rate ?? 0,
    exact_lookup_hit_count: metrics.exact_lookup_hit_count ?? 0,
    mixed_language_exact_lookup_hit: metrics.exact_lookup_hit_count ?? 0,
  };
}

export function buildAliasBenchmarkReport(scanResult, caseResults) {
  const hits = caseResults.filter((c) => c.pass).length;
  const falsePositives = caseResults.filter((c) => c.falsePositive).length;
  return {
    schemaVersion: 'phase5-alias-benchmark-v1',
    casesLoaded: caseResults.length,
    alias_hit_count: hits,
    alias_hit_rate: caseResults.length > 0 ? hits / caseResults.length : 0,
    alias_false_positive_count: falsePositives,
    alias_false_positive_rate: caseResults.length > 0 ? falsePositives / caseResults.length : 0,
    alias_collision_count: scanResult?.collisionCount ?? 0,
    collisions: scanResult?.collisions ?? [],
  };
}
