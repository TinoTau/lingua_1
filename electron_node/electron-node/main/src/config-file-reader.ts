/**
 * Config file read + UTF-8 BOM strip before JSON.parse.
 */

export function stripUtf8Bom(raw: string): { content: string; hadBom: boolean } {
  if (raw.charCodeAt(0) === 0xfeff) {
    return { content: raw.slice(1), hadBom: true };
  }
  return { content: raw, hadBom: false };
}

export function parseConfigJson(raw: string): { parsed: unknown; hadBom: boolean } {
  const { content, hadBom } = stripUtf8Bom(raw);
  return { parsed: JSON.parse(content), hadBom };
}
