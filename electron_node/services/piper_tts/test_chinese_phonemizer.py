#!/usr/bin/env python3
"""测试中文音素化器"""

import sys
import traceback
from chinese_phonemizer import ChinesePhonemizer

lexicon_path = "models/vits-zh-aishell3/lexicon.txt"
print(f"Loading lexicon from: {lexicon_path}")

try:
    phonemizer = ChinesePhonemizer(lexicon_path)
    print("✓ Phonemizer initialized successfully")
    
    test_text = "你好"
    print(f"Testing phonemization with text: {test_text}")
    
    phonemes = phonemizer.phonemize(test_text)
    print(f"✓ Phonemization successful: {len(phonemes)} sentences")
    
    if phonemes:
        print(f"  First sentence phonemes: {phonemes[0][:20]}... (showing first 20)")
        print(f"  Total phonemes in first sentence: {len(phonemes[0])}")
    
except Exception as e:
    print(f"✗ Error: {e}")
    traceback.print_exc()
    sys.exit(1)

