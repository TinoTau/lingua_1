import crypto from 'crypto';
import fs from 'fs';

export function sha256Hex(filePath) {
  const data = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(data).digest('hex');
}

export function formatChecksum(hex) {
  return `sha256:${hex}`;
}

export function parseChecksum(raw) {
  if (!raw) {
    return '';
  }
  const trimmed = String(raw).trim();
  if (trimmed.startsWith('sha256:')) {
    return trimmed.slice('sha256:'.length);
  }
  return trimmed;
}

export function verifyChecksumFile(sqlitePath, manifestChecksum, checksumPath) {
  const actualHex = sha256Hex(sqlitePath);
  const expectedHex = parseChecksum(manifestChecksum);
  if (actualHex !== expectedHex) {
    throw new Error(`Checksum mismatch: expected=${expectedHex} actual=${actualHex}`);
  }
  if (checksumPath && fs.existsSync(checksumPath)) {
    const fromFile = parseChecksum(fs.readFileSync(checksumPath, 'utf-8'));
    if (fromFile && fromFile !== expectedHex) {
      throw new Error('checksum.txt does not match manifest');
    }
  }
}
