/**
 * 语言能力检测 - 语言代码规范化
 */

/**
 * 规范化语言代码（P1-1: 统一大小写、处理别名、排除 auto）
 */
export function normalizeLanguageCode(lang: string): string {
  if (!lang) return '';
  
  const lower = lang.toLowerCase();
  
  // 处理语言代码变体
  const normalizationMap: Record<string, string> = {
    'zh-cn': 'zh',
    'zh-tw': 'zh',
    'zh-hans': 'zh',
    'zh-hant': 'zh',
    'pt-br': 'pt',
    'pt-pt': 'pt',
    'en-us': 'en',
    'en-gb': 'en',
    'in': 'id',  // 印尼语旧代码
    'iw': 'he',  // 希伯来语旧代码
  };
  
  return normalizationMap[lower] || lower;
}

/**
 * 规范化语言列表
 */
export function normalizeLanguages(languages: string[]): string[] {
  return languages
    .map(lang => normalizeLanguageCode(lang))
    .filter(lang => lang && lang !== 'auto')  // P1-1: auto 不进入索引
    .filter((lang, index, self) => self.indexOf(lang) === index); // 去重
}
