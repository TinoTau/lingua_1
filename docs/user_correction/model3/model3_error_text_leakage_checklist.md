# Model3 Error-Text Leakage Checklist

- [ ] No `sourceSentenceId` appears in both train and test
- [ ] No `contrastGroupId` split across sets
- [ ] dialog_200 acceptance cases not in train
- [ ] Near-duplicate carrier fills of same template+term not casually split (group by template+term when practical)
- [ ] Surface-pair memorization controls documented for contrast tests
- [ ] Balanced research subset not used as sole production distribution claim
