/**
 * Tiny OpenCC t→cn helper for the lexical-recall responsibility audit.
 * Observation only. Does not change production normalization.
 *
 * Usage: node _t2s_chars.js <utf8-text-file>
 * stdout: JSON map { char: simplified }
 */
const fs = require('fs');
const OpenCC = require('opencc-js/t2cn');
const converter = OpenCC.Converter({ from: 't', to: 'cn' });
const file = process.argv[2];
if (!file) {
  process.stderr.write('usage: node _t2s_chars.js <file>\n');
  process.exit(2);
}
const text = fs.readFileSync(file, 'utf8');
const out = {};
for (const ch of new Set([...text])) {
  if (!ch.trim()) continue;
  out[ch] = converter(ch);
}
process.stdout.write(JSON.stringify(out));
