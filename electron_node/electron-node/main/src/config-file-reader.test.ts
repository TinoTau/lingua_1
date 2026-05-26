import { describe, expect, it } from '@jest/globals';
import { parseConfigJson, stripUtf8Bom } from './config-file-reader';

describe('config-file-reader', () => {
  it('stripUtf8Bom removes leading BOM', () => {
    const { content, hadBom } = stripUtf8Bom('\uFEFF{"a":1}');
    expect(hadBom).toBe(true);
    expect(content).toBe('{"a":1}');
  });

  it('stripUtf8Bom leaves normal UTF-8 unchanged', () => {
    const { content, hadBom } = stripUtf8Bom('{"enabled":true}');
    expect(hadBom).toBe(false);
    expect(content).toBe('{"enabled":true}');
  });

  it('parseConfigJson parses BOM-prefixed JSON', () => {
    const { parsed, hadBom } = parseConfigJson('\uFEFF{"features":{"lexiconRecall":{"enabled":true}}}');
    expect(hadBom).toBe(true);
    expect((parsed as { features: { lexiconRecall: { enabled: boolean } } }).features.lexiconRecall.enabled).toBe(
      true
    );
  });

  it('parseConfigJson throws on invalid JSON', () => {
    expect(() => parseConfigJson('{invalid')).toThrow();
  });
});
