# Model3 Error-Text Split Strategy

## Forbidden

- Shuffle rows → 80/10/10

## Group key (minimum)

`splitGroupKey` must bind:

- `sourceSentenceId` (all variants of one reference stay together)
- `contrastGroupId` (entire contrast group stays together)
- Prefer also: corruption family bucket, domain, pronunciation pattern

## Axes for future held-out reporting

- held-out utterance / sentence family  
- held-out surface pair  
- held-out corruption family  
- held-out domain  
- held-out anchor-candidate combination  
- held-out pronunciation pattern  

## dialog_200

**Default: not in train.** Eval / integration only. Any exception needs written justification.
