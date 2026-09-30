/**
 * CLI: print JSON syllables for one text (toneType none), matching lexicon/phonetic.
 * Usage: node node_syllables_cli.mjs "候选"
 */
import { createRequire } from "module";
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

const text = process.argv[2] || "";
const toneType = process.argv[3] || "none";
let arr = [];
if (text.trim()) {
  arr = pinyin(text, { toneType, type: "array" }).map(normalizeSyllable).filter(Boolean);
}
process.stdout.write(JSON.stringify(arr));
