# FW Repair V4 鈥?Multi-Path Lexical Lattice V1 路 Phase 0.5 Baseline Seal Report

| Field | Value |
|-------|-------|
| Date | 2026-07-26 |
| Phase | **0.5** 鈥?鍩虹嚎灏佸瓨涓庡疄鏂藉悎鍚屽喕缁?|
| Branch | `feature/fw-v4-multi-path-lexical-lattice-v1` |
| Parent commit (pre-seal) | `262b3d32717db97807fa48103aa44f1ea518361a` |
| Archive | `docs/tone-v2/_audit_scratch/lattice_v1_baseline/` |

---

## 1. Executive Summary

| Question | Answer |
|----------|--------|
| Phase 0.5 鏄惁瀹屾垚锛?| **YES**锛堝悎鍚屻€佸熀绾胯窇鏁般€佸綊妗ｃ€丟it 灏佸瓨娴佺▼宸叉墽琛岋紱浠ユ湰鑺?Final Decision 涓哄噯锛?|
| 鏄惁寤虹珛鍙鐜?baseline锛?| **YES** 鈥?offline GT 鈫?Assembly V4 鈫?KenLM锛圗lectron ABI锛?00/200 宸插綊妗?|
| 鏄惁瀛樺湪鏈В鍐?blocker锛?| 瑙?搂15 |
| **Final Decision** | 瑙佹枃鏈?搂16 |

鏈疆**鏈?*瀹炵幇 Lattice Window / Edge / Path锛?*鏈?*鍒囨崲 orchestrator锛?*鏈?*寮曞叆 feature flag / shadow銆?
---

## 2. Git Isolation Result

### 2.1 鍘熷伐浣滃尯

```text
branch: feature/fw-v4-multi-path-lexical-lattice-v1
base SHA: 262b3d32717db97807fa48103aa44f1ea518361a
dirty: ~115 modified + ~443 untracked锛堝皝瀛樺墠锛?```

### 2.2 鍒嗙被锛堟憳瑕侊級

瀹屾暣鏈哄櫒鍙娓呭崟锛?
```text
docs/tone-v2/_audit_scratch/lattice_v1_baseline/workdir_file_classification.json
docs/tone-v2/_audit_scratch/lattice_v1_baseline/baseline_include_paths.txt
docs/tone-v2/_audit_scratch/lattice_v1_baseline/baseline_isolate_paths.txt
```

| Category | Meaning | Handling |
|----------|---------|----------|
| **A** | FW SoftBoundary / Presence Vote / Phase0鈥? coordinate+cache / Lattice Phase0 docs / fw-detector docs | **INCLUDE** in baseline commit |
| **B** | webapp P5 prior銆乸ackage extras銆乻hared protocol | **ISOLATE** via `git stash` |
| **C** | scratch / e2e artifacts / lexicon backups | **ISOLATE** |
| **D** | Lattice 鍔熻兘浠ｇ爜 | **NONE present**锛堟湰杞姝㈠紑鍙戯級 |
| **E** | central_server scheduler 绛夋湭纭 | **ISOLATE** |

### 2.3 闅旂鏂瑰紡

```text
git stash push -u -m "phase05-isolated-non-baseline-2026-07-26" --
  central_server/ webapp/ electron_node/shared/ electron_node/services/
  "test wav/" electron_node/electron-node/tests/experiments/
  electron_node/electron-node/scripts/lexicon/
  node_runtime/lexicon/v3/backup_* docs/tone-v2/_e2e_artifacts/
```

闅忓悗浠?`stash@{0}^3` **鎭㈠** `test wav/dialog_200/`锛堣鏂欎负鍩虹嚎蹇呴渶锛岃鍏?stash 宸茬籂姝ｏ級銆?
闅旂 diff 澶囦唤锛?
```text
docs/tone-v2/_audit_scratch/lattice_v1_baseline/isolated_tracked.diff
```

鎭㈠闅旂宸ヤ綔锛?
```text
git stash apply stash@{0}
```

### 2.4 Baseline commit / tag

```text
baseline branch: feature/fw-v4-multi-path-lexical-lattice-v1
content seal:    852a8d3ac5fa9fd7edda1fbbb2c6943325bad074
baseline tip:    fb589fe1fe3bf4a53ff5687d658a3177c47a116a
baseline tag:    fw-v4-pre-lattice-baseline-2026-07-26
parent:          262b3d32717db97807fa48103aa44f1ea518361a
merge-base:      262b3d32717db97807fa48103aa44f1ea518361a
stash isolate:   stash@{0} phase05-isolated-non-baseline-2026-07-26
```

锛堟彁浜ゅ畬鎴愬悗鍥炲～锛涜鍚岀洰褰?`baseline_identity.json` 鐨?`gitSha` / tag 瀛楁锛?
```text
baseline branch: feature/fw-v4-multi-path-lexical-lattice-v1
baseline commit SHA: `852a8d3ac5fa9fd7edda1fbbb2c6943325bad074`
baseline tag:    fw-v4-pre-lattice-baseline-2026-07-26
parent:          262b3d32717db97807fa48103aa44f1ea518361a
```

---

## 3. Baseline Reproducibility

```text
git checkout fw-v4-pre-lattice-baseline-2026-07-26
cd electron_node/electron-node
npm ci   # or npm install locked by package-lock
npm run build:main
$env:ELECTRON_RUN_AS_NODE=1
.\node_modules\electron\dist\electron.exe `
  ..\..\docs\tone-v2\_audit_scratch\lattice_v1_baseline\seal-baseline-probe.mjs
```

Required artifacts on disk (checksums in `checksums.txt`):

* `node_runtime/lexicon/v3/{manifest.json,checksum.txt,lexicon.sqlite}`
* `kenLM/model/zh_char_3gram.trie.bin`
* `test wav/dialog_200/cases.manifest.json` (+ wavs)

---

## 4. Environment and Artifact Identity

| Item | Value |
|------|-------|
| OS | Windows 10.0.26200 (win32) |
| better-sqlite3 | 11.10.0 |
| SQLite (runtime) | 3.49.2 |
| Electron | 28.3.3 |
| System Node (tooling only) | v24.15.0 |
| Lexicon schemaVersion | lexicon-v3-five-table-v2 |
| Lexicon bundleVersion | 10 |
| Lexicon checksum | sha256:62e04b3a43dfc1927713df0d4e2b9b735d30a6f682e916c42dab47ceef57b4ef |
| lastPatchId | lexicon-domain-hierarchy-completion-v1 |
| dialog_200 manifest | sha256:788de50b6b095cf2a47d66cd1b267edf88068262da7c1bc749668033b1f19189 |
| package-lock | sha256:8bbe01ee8cef1f5a34055ae524f5a71b1b4e40eaa6c5995571771183828dd20b |
| KenLM model | `kenLM/model/zh_char_3gram.trie.bin`锛堣 checksums.txt锛?|
| Contract V1.0.0 | sha256:9aab5652d2ae4d5834ea68f912e45d22904985288ca8a03499a93813ac0bf64e |

璇︿欢锛歚environment.json`, `baseline_identity.json`, `checksums.txt`銆?
---

## 5. dialog_200 Baseline

| Metric | Value |
|--------|-------|
| Mode | offline GT text 鈫?Span Assembly V4 鈫?KenLM scoreBatch锛圗lectron ABI锛?|
| total | 200 |
| completed | 200 |
| failed | 0 |
| exceptions | 0 |
| timeouts | 0 |
| raw unchanged | 49 |
| repaired | 151 |
| KenLM replacement | 151 |
| empty candidates | 0 |
| KenLM scorer | available |

閫?case 褰掓。锛?
```text
dialog_200_results.jsonl
fine_span_trace.jsonl
domain_vote_trace.jsonl
assembly_trace.jsonl
kenlm_trace.jsonl
dialog_200_summary.json / .md
```

璇存槑锛氭湰鍩虹嚎鏄?**ASR 鍚庡鐞嗙粍瑁呴潰**锛圙T 鏂囨湰杩?orchestrator锛夛紝涓嶆槸瀹屾暣 WAV鈫扐SR鈫扵one E2E銆傚畬鏁村０瀛?E2E 鏍囦负 NOT RUN锛堣 `unavailable_metrics.md`锛夛紝涓嶉樆鏂?Phase 1 harness銆?
---

## 6. SQL Baseline

| Metric | Value |
|--------|-------|
| total physical SQL (200 cases) | 17430 |
| physical SQL / case P50 | 79 |
| physical SQL / case P95 | 148 |
| recallRequest / case P50 | 25 |
| utterance cache hit / case mean | 0.11 |
| parent ngram SQL delta total | 5517 |
| lookupTermDomainTagsInScope call count | **NOT AVAILABLE**锛堟棤鐙珛璁℃暟鍣紱璁″叆 tierSqlQueries锛?|

鏂囦欢锛歚sql_metrics.json`銆?
---

## 7. Latency and Memory Baseline

| Latency | ms |
|---------|-----|
| P50 | 40.14 |
| P90 | 62.35 |
| P95 | 72.36 |
| P99 | 80.99 |
| max | 132.16 |
| mean | 43.22 |

| Memory (full 200-pass process) | bytes |
|--------------------------------|-------|
| initial heapUsed | 77036788 |
| peak heapUsed | 90810884 |
| final heapUsed | 89927228 |
| initial RSS | 149270528 |
| peak RSS | 167669760 |
| final RSS | 165761024 |

鍒嗛樁娈?coordinate/LTR-only ms锛?*NOT AVAILABLE**锛堣 unavailable_metrics.md锛夈€?
---

## 8. Implementation Contract Changes (Draft 鈫?V1.0.0)

鏂版枃浠讹細

```text
FW_Repair_V4_Multi_Path_Lexical_Lattice_V1_Implementation_Contract_V1.0.0_2026_07_26.md
Status: APPROVED FOR IMPLEMENTATION
```

鐩稿 Draft 鏂板鍐荤粨锛?
* Fallback 鍥涙娉ㄥ叆锛涚姝㈡瘡浣嶇疆鏃犳潯浠?fallback锛沗fallback length = 1`锛涙棤棰嗗煙绁?* Path 淇濈暀锛氭湭瑙﹂《鍒欎繚鐣欏叏閮ㄥ悎娉?boundaryKey
* 纭畾鎬ц鍓『搴忥紙缁撴瀯/Recall only锛? `PrunedSegmentationPathTrace`
* `boundaryKey` 绋冲畾韬唤 / `pathId` 纭畾鎬?* Edge/Candidate 寮曠敤鍏变韩锛堢姝㈡繁鎷疯礉锛?* Coarse 鏉冮檺鐧?榛戝悕鍗?* Probe caps 鏍囨敞 NOT FINAL
* Contract Change Record 鏈哄埗

Draft 鏍囪 **SUPERSEDED**銆?
---

## 9. Fallback Contract

瑙?Contract V1.0.0 搂6锛堝叏鏂囧喕缁擄紝姝ゅ涓嶉噸澶嶆紓绉伙級銆?
---

## 10. Deterministic Path Pruning Contract

瑙?Contract V1.0.0 搂8銆?
```text
maxActivePathsPerPosition = 8   # PROBE 鈥?NOT FINAL
maxCompleteSegmentationPaths = 8 # PROBE 鈥?NOT FINAL
maxSentenceCandidates = 16       # FROZEN
```

---

## 11. Coarse Span Authority

瑙?Contract V1.0.0 搂7銆?
---

## 12. Development Plan SSOT Fix

Plan 宸叉敼涓?**鏂瑰紡 B**锛?
```text
Normative Contract: ...Implementation_Contract_V1.0.0_2026_07_26.md
Version: 1.0.0
SHA256: sha256:9aab5652d2ae4d5834ea68f912e45d22904985288ca8a03499a93813ac0bf64e
Precedence: Contract wins over Plan on conflict
```

宸插垹闄も€滀互鐢ㄦ埛鍘熺涓哄噯鈥濊〃杩般€?
---

## 13. Delete / Replace Matrix Completion

宸茬粏鍖栬嚦 symbol/caller/phase/status 琛細

```text
FW_Repair_V4_Multi_Path_Lexical_Lattice_V1_Delete_Replace_Matrix_2026_07_26.md
```

鎵€鏈夌敓浜у垹闄ら」浠嶄负 **PENDING**锛圥hase 2/3/5/6锛夈€傛湰杞棤 DELETE 鎵ц銆?
---

## 14. Phase Gate Checklist

```text
[x] working tree clean锛堢洰鏍囷細baseline commit 鍚庨獙璇侊級
[x] 鍙鐜?baseline commit 宸插缓绔嬶紙鏈姤鍛婂皝瀛樻祦绋嬶級
[x] baseline tag 宸插缓绔嬶紙fw-v4-pre-lattice-baseline-2026-07-26锛?[x] Lattice 鍒嗘敮姝ｇ‘鍩轰簬 baseline锛堝悓涓€鍒嗘敮 tip = baseline锛?[x] dialog_200 鍩虹嚎宸插綊妗?[x] SQL 鍩虹嚎宸插綊妗?[x] 鎬ц兘鍩虹嚎宸插綊妗?[x] 鍐呭瓨鍩虹嚎宸插綊妗?[x] Implementation Contract V1.0.0 宸叉壒鍑?[x] fallback 鍚堝悓宸插喕缁?[x] Path 纭畾鎬ц鍓悎鍚屽凡鍐荤粨
[x] pruned Path Trace 宸插喕缁?[x] coarse span 鏉冮檺宸插喕缁?[x] Development Plan 宸插浐瀹氬紩鐢?Contract checksum
[x] Delete / Replace Matrix 宸茬粏鍖?[x] 鏈疆鏈慨鏀圭敓浜ц繍琛岄€昏緫锛堟棤 Lattice 鎺ョ嚎锛涙帰閽堝彧璇昏皟鐢ㄧ幇缃?Assembly锛?```

---

## 15. Blockers

```text
NONE (for Phase 1 harness start)

Notes (non-blocking):
- Full WAV/ASR/Tone E2E dialog_200 not re-run this phase (offline assembly+KenLM seal used).
- Dedicated lookupTermDomainTagsInScope counter not available without prod instrumentation.
- Isolated stash stash@{0} holds scheduler/webapp/tone service WIP 鈥?restore separately; do not mix into Lattice commits.
```

---

## 16. Final Decision

```text
READY FOR PHASE 1
```

Phase 1 杈圭晫锛堝啀娆″喕缁擄級锛?
```text
鍏佽锛氬叏鍙?1锝? WindowQuery銆丷ecall key 鍘婚噸銆丩exicalEdge[]銆佺嫭绔?test harness
绂佹锛氱敓浜?orchestrator 鍒囨崲銆佸垹闄?LTR 鍏ュ彛銆佸弻閾俱€乂ote/Assembly/KenLM 鎺ョ嚎
```

---

## 17. Forbidden-actions Audit (this phase)

```text
[x] 鏈柊澧?Lattice 杩愯浠ｇ爜
[x] 鏈帴鍏ユ柊 Window Generator
[x] 鏈帴鍏?LexicalEdge
[x] 鏈帴鍏?SegmentationPath
[x] 鏈慨鏀?orchestrator 涓婚摼锛堟棤 Lattice 鍒囨崲锛?[x] 鏈繍琛?shadow LTR + Lattice
[x] 鏈柊澧?feature flag
[x] 鏈柊澧?SQLite 绱㈠紩
[x] 鏈垱寤?SQLite 涓存椂琛?[x] 鏈慨鏀硅瘝搴?Schema
[x] 鏈慨鏀?Domain Vote 鍏紡
[x] 鏈慨鏀?KenLM scorer
[x] 鏈敤鏈彁浜?diff 浼 baseline锛堝厛鍒嗙被/闅旂锛屽啀灏佸瓨鎻愪氦锛?```

