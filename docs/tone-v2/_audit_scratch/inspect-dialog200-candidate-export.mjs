#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const csvPath = path.join(
  REPO,
  "docs/tone-v2/_audit_scratch/dialog200_candidate_sentence_export/dialog200_all_candidate_sentences.csv"
);

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, "").trim().split(/\r?\n/);
  const headers = split(lines[0]);
  return {
    headers,
    rows: lines.slice(1).filter(Boolean).map((line) => {
      const cols = split(line);
      const o = {};
      headers.forEach((h, i) => (o[h] = cols[i] ?? ""));
      return o;
    }),
  };
}
function split(line) {
  const cols = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (q && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else q = !q;
    } else if (ch === "," && !q) {
      cols.push(cur);
      cur = "";
    } else cur += ch;
  }
  cols.push(cur);
  return cols;
}

const { headers, rows } = parseCsv(fs.readFileSync(csvPath, "utf8"));
console.log("headers", headers);
console.log("nRows", rows.length);
console.log("sample", rows[0]);

const by = new Map();
for (const r of rows) {
  const id = r.caseId || r.dialogId || r.id || r.utteranceId;
  if (!by.has(id)) by.set(id, []);
  by.get(id).push(r);
}
let comp = 0;
let rawPlusAlt = 0;
const hist = {};
const samples = [];
for (const [id, rs] of by) {
  const textKey = ["candidateText", "sentence", "text", "assembledText", "candidate_sentence"].find(
    (k) => rs[0][k] != null && rs[0][k] !== ""
  );
  if (!textKey) continue;
  const texts = [...new Set(rs.map((x) => x[textKey]))];
  hist[texts.length] = (hist[texts.length] || 0) + 1;
  if (texts.length >= 2) {
    comp++;
    const hasRaw = rs.some((x) => String(x.isRaw).toLowerCase() === "true" || x.source === "raw");
    if (hasRaw) rawPlusAlt++;
    if (samples.length < 5) {
      samples.push({ id, n: rs.length, distinct: texts.length, texts: texts.slice(0, 3), cols: Object.keys(rs[0]) });
    }
  }
}
console.log({ cases: by.size, competition: comp, rawPlusAlt, hist, samples });
