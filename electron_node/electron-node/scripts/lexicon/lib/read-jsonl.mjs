import fs from 'fs';

const BOM = '\uFEFF';

export function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function readJsonlFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const hadBom = raw.charCodeAt(0) === 0xfeff;
  const text = stripBom(raw);
  const lines = text.split(/\r?\n/);
  const rows = [];

  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i];
    const trimmed = lineText.trim();
    if (!trimmed) {
      continue;
    }
    let row;
    try {
      row = JSON.parse(trimmed);
    } catch (err) {
      rows.push({
        file: filePath,
        line: i + 1,
        raw: trimmed,
        parseError: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    rows.push({ file: filePath, line: i + 1, row, hadBom: i === 0 && hadBom });
  }

  return { rows, hadBom };
}

export function loadJsonlInputs(inputFiles) {
  const all = [];
  let anyBom = false;
  for (const file of inputFiles) {
    const { rows, hadBom } = readJsonlFile(file);
    anyBom = anyBom || hadBom;
    all.push(...rows);
  }
  return { rows: all, anyBom };
}
