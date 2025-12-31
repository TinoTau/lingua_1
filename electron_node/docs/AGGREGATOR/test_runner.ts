/**
 * Run aggregator decision tests using aggregator_decision.ts
 *
 * Usage:
 *   npx ts-node test_runner.ts test_vectors.json
 */
import * as fs from "fs";
import { decideStreamAction, UtteranceInfo } from "./aggregator_decision";

function loadU(d: any): UtteranceInfo {
  return {
    text: d.text,
    startMs: Number(d.start_ms),
    endMs: Number(d.end_ms),
    lang: d.lang,
    qualityScore: d.quality_score,
    isFinal: Boolean(d.is_final),
    isManualCut: Boolean(d.is_manual_cut),
  };
}

const path = process.argv[2] || "test_vectors.json";
const data = JSON.parse(fs.readFileSync(path, "utf-8"));

let ok = 0;
for (const c of data) {
  const prev = c.prev ? loadU(c.prev) : null;
  const curr = loadU(c.curr);
  const got = decideStreamAction(prev, curr, c.mode);
  const exp = c.expected_action ?? null;
  const pass = exp === null || got === exp;
  console.log(`${c.id}: got=${got} expected=${exp} -> ${pass ? "PASS" : "FAIL"}`);
  if (pass) ok++;
}
console.log(`\nSummary: ${ok}/${data.length} passed`);
if (ok !== data.length) process.exit(1);
