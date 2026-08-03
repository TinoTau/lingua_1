/** Minimal acoustic tone fixtures for Mandatory Tone Recall integration tests. */
import type { AcousticToneSlice, WordTimeSpan } from '../tone-time-align';
import type { TonePosterior } from '../../task-router/types';

function posterior(toneNum: 1 | 2 | 3 | 4 | 5): TonePosterior {
  const p: TonePosterior = { t1: 0.02, t2: 0.02, t3: 0.02, t4: 0.02, t5: 0.02 };
  if (toneNum === 1) p.t1 = 0.9;
  else if (toneNum === 2) p.t2 = 0.9;
  else if (toneNum === 3) p.t3 = 0.9;
  else if (toneNum === 4) p.t4 = 0.9;
  else p.t5 = 0.9;
  return p;
}

/** One slice + one word span per character; tones[i] for raw char i. */
export function makeCharToneFixtures(
  rawText: string,
  tones: ReadonlyArray<1 | 2 | 3 | 4 | 5>
): { acousticSlices: AcousticToneSlice[]; wordTimeSpans: WordTimeSpan[] } {
  const chars = [...rawText];
  if (chars.length !== tones.length) {
    throw new Error(`tone length ${tones.length} != char length ${chars.length}`);
  }
  const acousticSlices: AcousticToneSlice[] = tones.map((tone, i) => ({
    start: i * 0.1,
    end: i * 0.1 + 0.09,
    tonePosterior: posterior(tone),
    confidence: 0.9,
  }));
  const wordTimeSpans: WordTimeSpan[] = chars.map((ch, i) => ({
    word: ch,
    rawStart: i,
    rawEnd: i + 1,
    start: i * 0.1,
    end: i * 0.1 + 0.09,
  }));
  return { acousticSlices, wordTimeSpans };
}
