/**
 * Export Node pinyin-pro golden fixtures for Dataset phonetic agreement tests.
 * Run from repo root:
 *   node training/model2/phonetic/export_node_golden.mjs
 */
import { createRequire } from "module";
import { writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(
  join(__dirname, "../../../electron_node/electron-node/package.json")
);
const { pinyin } = require("pinyin-pro");

function normalizeSyllable(s) {
  return String(s).trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function textToSyllablesNone(text) {
  const arr = pinyin(text, { toneType: "none", type: "array" });
  return arr.map(normalizeSyllable).filter(Boolean);
}

function textToSyllablesNum(text) {
  const arr = pinyin(text, { toneType: "num", type: "array" });
  return arr.map(normalizeSyllable).filter(Boolean);
}

const cases = [
  "南宁",
  "候选",
  "一日游",
  "中杯拿铁",
  "米尔福德",
  "AI接口",
  "hello世界",
  "银行",
  "行长",
  "重来",
];

const fixtures = cases.map((text) => ({
  text,
  syllables_none: textToSyllablesNone(text),
  syllables_num: textToSyllablesNum(text),
}));

const out = join(__dirname, "golden_fixtures.json");
writeFileSync(out, JSON.stringify({ source: "pinyin-pro", fixtures }, null, 2), "utf8");
console.log("wrote", out, "n=", fixtures.length);
