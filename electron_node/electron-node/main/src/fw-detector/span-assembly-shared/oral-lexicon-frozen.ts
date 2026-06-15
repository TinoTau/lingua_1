/** Frozen oral lexicon — no SQLite schema change (V3 supplement O02). */

export type OralLexiconEntry = {
  word: string;
  syllables: string[];
};

export const ORAL_FUNCTION_ENTRIES: OralLexiconEntry[] = [
  { word: '顺便', syllables: ['shun', 'bian'] },
  { word: '请问', syllables: ['qing', 'wen'] },
  { word: '帮我', syllables: ['bang', 'wo'] },
  { word: '对了', syllables: ['dui', 'le'] },
  { word: '那个', syllables: ['na', 'ge'] },
  { word: '就是', syllables: ['jiu', 'shi'] },
  { word: '稍等', syllables: ['shao', 'deng'] },
  { word: '等一下', syllables: ['deng', 'yi', 'xia'] },
  { word: '一下', syllables: ['yi', 'xia'] },
  { word: '有', syllables: ['you'] },
];

export const ORAL_PARTICLE_ENTRIES: OralLexiconEntry[] = [
  { word: '嗯', syllables: ['en'] },
  { word: '啊', syllables: ['a'] },
  { word: '呃', syllables: ['e'] },
  { word: '额', syllables: ['e'] },
  { word: '哦', syllables: ['o'] },
  { word: '诶', syllables: ['ei'] },
  { word: '哎', syllables: ['ai'] },
];

export const ORAL_SOURCE_WEIGHT = {
  oral_function: 0.15,
  oral_particle: 0.1,
} as const;

export function matchOralFunction(syllables: string[]): OralLexiconEntry | undefined {
  const key = syllables.join('|');
  return ORAL_FUNCTION_ENTRIES.find((e) => e.syllables.join('|') === key);
}

export function matchOralParticle(syllable: string): OralLexiconEntry | undefined {
  return ORAL_PARTICLE_ENTRIES.find((e) => e.syllables.length === 1 && e.syllables[0] === syllable);
}
