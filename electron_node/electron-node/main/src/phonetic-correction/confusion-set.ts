/**
 * 同音字混淆集：由同音字组在模块加载时构建 字→[同音字]，用于同音/近音后处理纠错。
 * 不维护词表，不依赖外部文件；扩展时在同音字组中追加即可。
 */

/** 同音字组：每组内字符同音，用于生成混淆集 */
const SAME_PINYIN_GROUPS: string[][] = [
  ['余', '语', '鱼', '于', '与', '雨', '宇', '羽', '玉', '遇'],
  ['英', '音', '应', '鹰', '婴', '樱', '迎', '营', '影', '映'],
  ['识', '试', '式', '事', '世', '势', '市', '示', '视', '适'],
  ['别', '憋', '瘪', '蹩'],
  ['语', '与', '雨', '余', '鱼', '于', '宇', '羽', '玉'],
  ['音', '因', '阴', '英', '应', '鹰', '婴', '樱', '迎', '营'],
  ['系', '细', '戏', '习', '息', '希', '西', '洗', '喜'],
  ['统', '同', '通', '痛', '童', '铜', '桶'],
  ['测', '侧', '册', '策', '厕'],
  ['试', '事', '世', '势', '市', '识', '式', '示', '视', '适'],
  ['现', '线', '县', '先', '显', '险', '鲜', '限', '宪'],
  ['在', '再', '载', '灾', '仔'],
  ['开', '凯', '慨', '刊', '看', '康', '抗'],
  ['始', '使', '史', '士', '世', '市', '示', '事', '式', '视'],
  ['结', '节', '接', '街', '解', '界', '姐', '杰', '洁'],
  ['束', '数', '树', '书', '属', '术', '述', '熟'],
  ['稳', '温', '文', '闻', '问', '纹', '吻'],
  ['定', '顶', '订', '丁', '钉', '叮'],
  ['性', '兴', '星', '行', '形', '型', '姓', '幸'],
  ['能', '弄', '农', '浓', '诺'],
  ['被', '备', '北', '背', '倍', '贝', '杯'],
  ['强', '墙', '抢', '腔', '枪', '羌'],
  ['制', '之', '知', '直', '只', '指', '至', '志', '治', '质'],
  ['截', '节', '接', '街', '解', '界', '姐', '杰', '洁'],
  ['断', '段', '短', '端', '锻'],
  ['导', '到', '道', '倒', '岛', '刀', '盗'],
  ['致', '制', '之', '知', '直', '只', '指', '至', '志', '治'],
  ['前', '钱', '千', '迁', '签', '浅', '欠', '牵'],
  ['半', '办', '伴', '板', '版', '班', '般', '搬'],
  ['句', '具', '据', '举', '聚', '巨', '剧', '距'],
  ['话', '化', '画', '华', '划', '花', '滑', '话'],
  ['提', '题', '体', '替', '踢', '梯', '啼'],
  ['前', '钱', '千', '迁', '签', '浅', '欠', '牵'],
  ['发', '法', '罚', '发', '乏', '阀'],
  ['送', '松', '宋', '诵', '颂'],
  ['或', '和', '活', '火', '货', '获', '祸'],
  ['直', '之', '知', '制', '只', '指', '至', '志', '治', '质'],
  ['接', '街', '节', '解', '界', '姐', '杰', '洁', '结'],
  ['丢', '丢', '丢'],
  ['失', '师', '诗', '施', '十', '石', '时', '实', '食', '史'],
  ['清', '轻', '青', '情', '请', '晴', '庆', '倾'],
  ['分', '份', '粉', '奋', '纷', '芬', '坟'],
  ['策', '测', '侧', '册', '厕'],
  ['略', '论', '轮', '伦', '沦'],
  ['超', '朝', '抄', '吵', '钞', '潮'],
  ['时', '十', '石', '实', '食', '史', '师', '诗', '施', '失'],
  ['规', '归', '贵', '鬼', '轨', '柜', '跪'],
  ['则', '责', '择', '泽', '仄'],
  ['基', '机', '级', '极', '及', '即', '己', '计', '记', '技'],
  ['本', '奔', '笨', '本'],
  ['可', '克', '刻', '客', '课', '科', '颗', '壳'],
  ['用', '永', '勇', '拥', '涌', '泳', '庸'],
];

/**
 * 约束：节点由用户自行部署，调度随机分配任务，节点上的词表无法覆盖所有任务，词表积累无意义，
 * 故不采用任何词表（含常用词表、错误→正确映射表等）。
 * 多候选时无法在 余/语/鱼 等中做选择，故保留原字，不替换。本步骤当前不产生实际纠错效果，
 * 仅保留同音字组与流水线占位，供日后引入非词表打分（如 LM）时使用。
 */

let confusionMap: Map<string, string[]> | null = null;

function buildConfusionMap(): Map<string, string[]> {
  if (confusionMap) return confusionMap;
  const map = new Map<string, string[]>();
  for (const group of SAME_PINYIN_GROUPS) {
    for (const c of group) {
      map.set(c, group);
    }
  }
  confusionMap = map;
  return map;
}

/**
 * 可替换位点：存在同音候选且候选数≥2 的字符位置，最多取 maxPositions 个（从句尾往前取）。
 */
export function getReplaceablePositions(text: string, maxPositions: number): number[] {
  const map = buildConfusionMap();
  const chars = [...text];
  const indices: number[] = [];
  for (let i = 0; i < chars.length; i++) {
    const group = map.get(chars[i]);
    if (group && group.length >= 2) indices.push(i);
  }
  if (indices.length <= maxPositions) return indices;
  return indices.slice(-maxPositions);
}

/**
 * 候选句：原句 + 在指定位置用同音字替换的变体，总数不超过 maxCandidates。
 */
export function generateCandidates(text: string, positions: number[], maxCandidates: number): string[] {
  const map = buildConfusionMap();
  const chars = [...text];
  const out = [text];
  if (positions.length === 0) return out;

  const addAt = (pos: number) => {
    const group = map.get(chars[pos]);
    if (!group) return;
    for (const c of group) {
      if (c === chars[pos]) continue;
      const t = [...chars];
      t[pos] = c;
      const s = t.join('');
      if (!out.includes(s)) out.push(s);
      if (out.length >= maxCandidates) return;
    }
  };

  for (const pos of positions) {
    addAt(pos);
    if (out.length >= maxCandidates) break;
  }
  if (positions.length >= 2) {
    for (let i = 0; i < positions.length && out.length < maxCandidates; i++) {
      for (let j = i + 1; j < positions.length && out.length < maxCandidates; j++) {
        const g1 = map.get(chars[positions[i]]);
        const g2 = map.get(chars[positions[j]]);
        if (!g1 || !g2) continue;
        for (const c1 of g1) {
          for (const c2 of g2) {
            const t = [...chars];
            t[positions[i]] = c1;
            t[positions[j]] = c2;
            const s = t.join('');
            if (!out.includes(s)) out.push(s);
            if (out.length >= maxCandidates) break;
          }
          if (out.length >= maxCandidates) break;
        }
      }
    }
  }
  return out.slice(0, maxCandidates);
}

/**
 * 无 LM 时恒返回原文；有 LM 时由 rescore 模块接管。
 */
export function correct(text: string): string {
  if (!text || text.trim().length === 0) return text;
  return text;
}

export function getConfusionSet(): Map<string, string[]> {
  return buildConfusionMap();
}
