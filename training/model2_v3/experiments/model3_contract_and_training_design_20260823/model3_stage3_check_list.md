# Model3 Stage3 Check List — Offline Baseline Training

## Must

- [ ] Train Small BiGRU offline only
- [ ] Loss masked on Anchors
- [ ] Acoustic/pronunciation channels present (anti local-LM)
- [ ] Report val metrics; no production wire-up
- [ ] Optional tiny Transformer comparison only after BiGRU baseline exists

## Must not

- [ ] Large LM / generation decoder
- [ ] Runtime shadow without Stage4 generalization gates
- [ ] Enable retry
