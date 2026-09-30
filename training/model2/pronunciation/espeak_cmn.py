"""Espeak phoneme helpers for zh_CN-huayan-medium (phoneme_type=espeak, voice=cmn)."""

from __future__ import annotations

from typing import Optional

from training.model2.pronunciation.pronunciation_syllable import PronunciationSyllable

# Empirically observed on huayan/espeak cmn:
# pinyin tone 1 → '5' often appears mid-syllable for high tone
# pinyin tone 2 → 'ɜ'
# pinyin tone 3 → '2'
# pinyin tone 4 → '5' (falling) — overlaps with tone1 marker positions; prefer templates.

PINYIN_TONE_TO_ESPEAK = {
    1: "5",
    2: "ɜ",
    3: "2",
    4: "5",
    0: "",
    5: "",
}

# Initial token sequences in espeak cmn (from PiperVoice.phonemize probes)
INITIAL_TO_ESPEAK: dict[str, list[str]] = {
    "": [],
    "b": ["b"],
    "p": ["p"],
    "m": ["m"],
    "f": ["f"],
    "d": ["t"],
    "t": ["t", "h"],
    "n": ["n"],
    "l": ["l"],
    "g": ["k"],
    "k": ["k", "h"],
    "h": ["χ"],
    "j": ["t", "ɕ"],
    "q": ["t", "ɕ", "h"],
    "x": ["ɕ"],
    "zh": ["t", "s", "."],
    "ch": ["t", "s", ".", "h"],
    "sh": ["s", "."],
    "r": ["ʐ"],
    "z": ["t", "s"],
    "c": ["t", "s", "h"],
    "s": ["s"],
    "y": ["j"],
    "w": ["w"],
}


def swap_initial_in_espeak(phonemes: list[str], new_initial: str) -> list[str]:
    """Replace leading consonant group before stress mark ˈ with new initial tokens."""
    if "ˈ" not in phonemes:
        # fallback: replace first token if single consonant
        out = list(phonemes)
        ini = INITIAL_TO_ESPEAK.get(new_initial, [new_initial] if new_initial else [])
        # drop leading consonants until vowel-ish
        i = 0
        while i < len(out) and out[i] not in ("ˈ", "a", "e", "i", "o", "u", "y", "ə", "ɑ", "æ"):
            if out[i] in (" ",):
                break
            i += 1
        return ini + out[i:]
    idx = phonemes.index("ˈ")
    ini = INITIAL_TO_ESPEAK.get(new_initial)
    if ini is None:
        ini = [new_initial] if new_initial else []
    return list(ini) + phonemes[idx:]


def apply_family_to_espeak(phonemes: list[str], family: str, canonical: PronunciationSyllable) -> list[str]:
    """Transform a single-syllable espeak sequence using family direction."""
    src, dst = family.split("_", 1)
    out = list(phonemes)
    if family.endswith(("_l", "_n", "_z", "_zh", "_c", "_ch", "_s", "_sh", "_f", "_h")) or family in {
        "n_l",
        "l_n",
        "zh_z",
        "z_zh",
        "ch_c",
        "c_ch",
        "sh_s",
        "s_sh",
        "f_h",
        "h_f",
    }:
        if canonical.initial != src:
            return out
        return swap_initial_in_espeak(out, dst)
    # finals: replace nasal coda patterns
    if family in ("an_ang", "ang_an", "en_eng", "eng_en", "in_ing", "ing_in"):
        if canonical.final != src:
            return out
        joined = out
        # common patterns from probes
        if family == "an_ang":
            # ... a ɜ n / a 5 n → add ɡ/ŋ
            if joined[-1:] == ["n"] and "ŋ" not in joined:
                return joined[:-1] + ["ŋ"]
            if "n" in joined and "ŋ" not in joined:
                # replace last n with ŋ
                for i in range(len(joined) - 1, -1, -1):
                    if joined[i] == "n":
                        joined[i] = "ŋ"
                        break
                return joined
        if family == "ang_an":
            for i in range(len(joined) - 1, -1, -1):
                if joined[i] in ("ŋ", "ɡ"):
                    joined[i] = "n"
                    break
            return joined
        if family == "en_eng":
            for i in range(len(joined) - 1, -1, -1):
                if joined[i] == "n":
                    joined[i] = "ŋ"
                    break
            return joined
        if family == "eng_en":
            for i in range(len(joined) - 1, -1, -1):
                if joined[i] in ("ŋ", "ɡ"):
                    joined[i] = "n"
                    break
            return joined
        if family == "in_ing":
            for i in range(len(joined) - 1, -1, -1):
                if joined[i] == "n":
                    joined[i] = "ŋ"
                    break
            return joined
        if family == "ing_in":
            for i in range(len(joined) - 1, -1, -1):
                if joined[i] in ("ŋ", "ɡ"):
                    joined[i] = "n"
                    break
            return joined
    return out
