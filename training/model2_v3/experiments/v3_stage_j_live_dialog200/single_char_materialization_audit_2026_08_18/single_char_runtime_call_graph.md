# Single-char runtime call graph

Production entry (FW Repair V4 Lattice, not LTR):

```
runSpanAssemblyV4Orchestrator
  → runLatticeFineSpanGeneration
      → buildLexicalWindowQueries          // [i, i+len), len=1..5
      → latticeHardBlockFilter             // block if window CONTAINS sentence punct; adjacency allowed (CR 1.0.2)
      → recallTopKForWindows               // ★ lexicon entry
           if syllables.length === 1:
             topK=1, domainIds=[], fuzzy=false
           → recallSpanTopKV2
                if syllables.length === 1:
                  collectBaseOnlySingleCharCandidate
                    resolveToneRecallReadiness     // 1.1C fail-closed
                    lookupBaseByPinyinAndToneKey(termLength=1, LIMIT=8)
                    filterEligibleBaseSingleChar   // len==1, not alias, prior>0
                    resolveLength1BaseCandidate    // unique or surface-exact; trunc reject
                    else tryExactSurfaceBaseIdentity  // word === windowText, tone exact
                    scoreLength1BaseHit            // may null if score < minCandidateScore
           → bindLexiconHitsToWindow       // WindowCandidate on THE WINDOW
      → buildLexicalEdges                  // only candidates.length>0
      → injectFallbackEdges                // i→i+1, candidates=[] if graph incomplete
      → enumerateCompleteSegmentationPaths
      → materializePathFineSpans

  expandActiveCandidatesWithModel2(pathFineSpans)
      Stage P: executeProfileLexiconQueries → recallSpanTopKV2
               this NO_PROFILE AFTER run: p_retrieval NOT_EXECUTED reason=NO_P_ACTION
      Stage D: materializeDomainHits (syllable-length exact bind)
               domain min length 2; not a 1-char source
```

**Raw-hit SSOT (production):** `collectBaseOnlySingleCharCandidate` via `recallTopKForWindows`.

**Not production raw-hit:** `pta.existence(expected).in_base` sqlite probe used in Recall Foundation after-effects (`recall_foundation_after_effects.py` R4).
