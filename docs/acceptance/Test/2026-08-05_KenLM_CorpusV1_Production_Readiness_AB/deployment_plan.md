# Deployment Plan — KenLM Corpus V1 (NOT executed this round)

1. Backup/retain old: `zh_char_3gram.trie.bin` (sha 532a335a09a006d1ba674f808814ee1d40c5b1d8f3527ca980e96723e7a62a4c)
2. Copy new to versioned name e.g. `zh_char_3gram.corpus_v1.trie.bin` under production kenLM dir
3. Point single config `CHAR_LM_PATH` / model path to versioned file
4. Log model SHA at startup
5. Smoke: scoreBatch + one dialog case
6. On failure: restore config to old path

**This round does NOT overwrite production.**
