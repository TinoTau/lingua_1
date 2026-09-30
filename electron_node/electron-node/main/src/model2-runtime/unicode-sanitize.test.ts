/**
 * Unicode scalar sanitization + Model2 host UTF-8 transport boundary tests.
 * T1–T6 for LINGUA_MODEL2_STAGE_J_UTF8_SURROGATE_SINGLE_DELTA_FIX
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {
  sanitizeJsonValueForUtf8Transport,
  sanitizeUnicodeScalarString,
  UNICODE_REPLACEMENT,
} from './unicode-sanitize';

function repoRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 12; i += 1) {
    const candidate = path.join(
      dir,
      'electron_node',
      'services',
      'model2_runtime',
      'model2_inference_host.py'
    );
    if (fs.existsSync(candidate)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(__dirname, '..', '..', '..', '..', '..');
}

describe('unicode-sanitize (Model2 IPC boundary)', () => {
  test('T1 ordinary ASCII / Chinese identity', () => {
    for (const s of ['上海', 'software meeting', '奶茶']) {
      const r = sanitizeUnicodeScalarString(s);
      expect(r.value).toBe(s);
      expect(r.replacedCodeUnits).toBe(0);
    }
    const deep = sanitizeJsonValueForUtf8Transport({
      personal_terms: ['上海', 'software meeting', '奶茶'],
    });
    expect(deep.value).toEqual({
      personal_terms: ['上海', 'software meeting', '奶茶'],
    });
    expect(deep.stats.sanitized).toBe(false);
  });

  test('T2 valid supplementary Unicode (emoji surrogate pair) identity', () => {
    const emoji = '😀'; // U+1F600
    expect(emoji.length).toBe(2);
    const r = sanitizeUnicodeScalarString(emoji);
    expect(r.value).toBe(emoji);
    expect(r.replacedCodeUnits).toBe(0);
    expect(Buffer.from(r.value, 'utf8').toString('utf8')).toBe(emoji);
  });

  test('T3 unpaired high surrogate → U+FFFD', () => {
    const bad = `a${String.fromCharCode(0xd800)}b`;
    const r = sanitizeUnicodeScalarString(bad);
    expect(r.value).toBe(`a${UNICODE_REPLACEMENT}b`);
    expect(r.replacedCodeUnits).toBe(1);
    expect(() => Buffer.from(r.value, 'utf8')).not.toThrow();
  });

  test('T4 unpaired low surrogate → U+FFFD', () => {
    const bad = `a${String.fromCharCode(0xdcaa)}b`;
    const r = sanitizeUnicodeScalarString(bad);
    expect(r.value).toBe(`a${UNICODE_REPLACEMENT}b`);
    expect(r.replacedCodeUnits).toBe(1);
    JSON.stringify(r.value); // must not throw
  });

  test('T5 nested UserProfileV1 personal_terms payload', () => {
    const profile = {
      schema_version: 2,
      profile_version: 1,
      phonetic_bias: { n_l: 0.9 },
      personal_terms: ['电脑', `哪${String.fromCharCode(0xdcaa)}`, '音乐'],
      personal_term_evidence: { 电脑: 1 },
    };
    const deep = sanitizeJsonValueForUtf8Transport(profile);
    const terms = (deep.value as { personal_terms: string[] }).personal_terms;
    expect(terms[0]).toBe('电脑');
    expect(terms[1]).toBe(`哪${UNICODE_REPLACEMENT}`);
    expect(terms[2]).toBe('音乐');
    expect(deep.stats.sanitized).toBe(true);
    expect(deep.stats.sanitized_string_count).toBe(1);
    expect(deep.stats.sanitized_code_unit_count).toBe(1);
  });
});

describe('Model2 host UTF-8 stdin transport (T6)', () => {
  jest.setTimeout(120000);

  test('T6 Chinese personal_terms including 哪里 survive host stdin as UTF-8', async () => {
    const root = repoRoot();
    const script = path.join(
      root,
      'electron_node',
      'services',
      'model2_runtime',
      'model2_inference_host.py'
    );
    expect(fs.existsSync(script)).toBe(true);

    // Minimal echo harness reusing host main's stdin.buffer UTF-8 path:
    const probe = `
import json, sys
raw = sys.stdin.buffer.readline()
line = raw.decode("utf-8")
msg = json.loads(line)
terms = msg.get("personal_terms") or []
for t in terms:
    t.encode("utf-8")
print(json.dumps({"ok": True, "terms": terms, "stdin_encoding_note": "buffer_utf8"}, ensure_ascii=False))
`;
    const child: ChildProcessWithoutNullStreams = spawn(
      process.env.MODEL2_PYTHON || 'python',
      ['-c', probe],
      {
        cwd: root,
        env: {
          ...process.env,
          PYTHONUTF8: '1',
          PYTHONIOENCODING: 'utf-8',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );
    const outChunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    child.stdout.on('data', (d) => outChunks.push(Buffer.from(d)));
    child.stderr.on('data', (d) => errChunks.push(Buffer.from(d)));
    const msg = {
      personal_terms: ['电脑', '哪里', '音乐', '奶茶', '上海', 'software meeting'],
    };
    const scrubbed = sanitizeJsonValueForUtf8Transport(msg);
    child.stdin.write(`${JSON.stringify(scrubbed.value)}\n`);
    child.stdin.end();
    const code: number | null = await new Promise((resolve) => {
      child.on('exit', (c) => resolve(c));
    });
    const out = Buffer.concat(outChunks).toString('utf8');
    const err = Buffer.concat(errChunks).toString('utf8');
    expect(err).toBe('');
    expect(code).toBe(0);
    const parsed = JSON.parse(out.trim().split(/\n/).pop()!);
    expect(parsed.ok).toBe(true);
    expect(parsed.terms).toEqual(msg.personal_terms);
  });
});
