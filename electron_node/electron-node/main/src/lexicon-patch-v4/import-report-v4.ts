import type { ApplyStatsV4 } from './sqlite-applier-v4';

export type GateStepResult = {
  step: string;
  status: 'pass' | 'fail';
  message?: string;
  duration_ms: number;
};

export type LexiconImportReportV4 = {
  status: 'success' | 'fail';
  error_code: string;
  patch_id: string;
  patch_schema_version: string;
  patch_path: string;
  bundle_dir: string;
  base_version: number;
  next_version: number;
  new_terms: number;
  appended_domains: number;
  new_aliases: number;
  removed_aliases: number;
  collisions: number;
  dangerous_ops: number;
  checksum_before: string;
  checksum_after: string;
  runtime_reload: string;
  source_sync: 'pass' | 'fail' | 'skipped';
  source_sync_diff: Array<{ word: string; jsonl_domains: string[]; sqlite_domains: string[] }>;
  pre_gate_results: GateStepResult[];
  runtime_gate_results: GateStepResult[];
  collision_terms: Array<{ word: string; code: string }>;
  rematerialized_term_ids: string[];
  append_domain_tags: ApplyStatsV4['append_domain_tags'];
  table_counts_delta: Record<string, number>;
  trace_lines: string[];
  duration_ms: number;
};

export function createEmptyImportReportV4(patchPath: string, bundleDir: string): LexiconImportReportV4 {
  return {
    status: 'fail',
    error_code: '',
    patch_id: '',
    patch_schema_version: 'lexicon-patch-v4',
    patch_path: patchPath,
    bundle_dir: bundleDir,
    base_version: 0,
    next_version: 0,
    new_terms: 0,
    appended_domains: 0,
    new_aliases: 0,
    removed_aliases: 0,
    collisions: 0,
    dangerous_ops: 0,
    checksum_before: '',
    checksum_after: '',
    runtime_reload: 'skipped',
    source_sync: 'skipped',
    source_sync_diff: [],
    pre_gate_results: [],
    runtime_gate_results: [],
    collision_terms: [],
    rematerialized_term_ids: [],
    append_domain_tags: [],
    table_counts_delta: {},
    trace_lines: [],
    duration_ms: 0,
  };
}

export function appendTrace(report: LexiconImportReportV4, line: string): void {
  report.trace_lines.push(line);
}
