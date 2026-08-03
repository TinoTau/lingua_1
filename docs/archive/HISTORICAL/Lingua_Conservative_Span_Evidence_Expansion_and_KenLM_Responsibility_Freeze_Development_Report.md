<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: docs/current/INDEX.md
Archive Path: docs/archive/HISTORICAL/Lingua_Conservative_Span_Evidence_Expansion_and_KenLM_Responsibility_Freeze_Development_Report.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: docs/current/INDEX.md

# Lingua Conservative Span Evidence Expansion & KenLM Responsibility Freeze Development Report

**Date:** 2026-07-16  
**Scope:** Conservative Span Evidence Expansion + KenLM Responsibility Freeze  
**Result:** **Verdict B �� Responsibility Coupling Found**

## Summary

������������๤����

1. ����ǰ **post-vote per-span assembly retention** �� `8/4/2` ����Ϊ `8/6/4`��
2. �� KenLM ���������ʽ����Ϊ **���16���ܿغ�ѡ�Ĵ��/������**�������� **Top3** ��������� diagnostics ʹ�á�

�������������ζ�λ��ȷ�ϣ�

- ��ǰ `8/4/2` / `8/6/4` **����λ�� Domain Vote ֮ǰ**��
- ����ǰֻ���� **Domain Vote ��ɺ�� per-span assembly candidate selection**��
- ��˱��ָĳ� `8/6/4` ��**����������ֱ�������� Domain Vote evidence pool**��
- �ڲ����������µ� pre-vote evidence budget ��ǰ���£��޷��ѱ��ֶ���Ϊ��Span Evidence Expansion PASS����

��˱�����׼ȷ�����ǣ�

> KenLM Responsibility Freeze �Ѿ���أ�
> �� `8/6/4` Ŀǰֻ������ post-vote retention / assembly selection��
> ������Ϊ��Domain Vote evidence expansion����������ְ��ھ���Ҫ��һ������Լ����

## Frozen Main Chain Check

����ʵ�ֺ�������Ȼ����Ϊ��

```text
Fine Span
    ��
Base + Domain Candidate Recall
    ��
Expanded Span Evidence Pool
    ��
һ�� Utterance Global Domain Vote
    ��
Winner Domain + Base Candidate Filtering
    ��
Per-span Assembly Candidate Selection
    ��
�ܿ� Cross-span Sentence Assembly
    ��
Generated Sentences�����16��
    ��
KenLM Score
    ��
Ranked Top3
    ��
Current Gate / Apply
```

������Ҫ�ر�˵�����ǣ�

- ��ǰ������� **Span Recall Evidence Pool** ʵ�������� `activeCandidates`��
- ��ǰ�¸ĵ� `8/6/4` �����ü��� pre-vote pool��
- ��ֻ�ü� **Winner Domain + Base filtering** ֮��� `selectedCandidates`��

��ˣ���Expanded Span Evidence Pool����һ�����ڵ�ǰʵ������Ҫ��**�ܹ�����Ŀ��**���������� `8/6/4` �����������ֱ��ʵ�֡�

## Code Findings

### 1. `8/4/2` ��ǰ����λ��

��ǰ����·����

- `runDomainAwareAssembly()`
- `voteUtteranceDomainFromPool(pool)`
- `filterDomainCandidatesPerSpan(...)`
- `selectPerSpanCandidates(...)`
- `getPerSpanCandidateLimit(coarseSpanCount)`

���ۣ�

- `voteUtteranceDomainFromPool(pool)` ������ `selectPerSpanCandidates()` ֮ǰ��
- `getPerSpanCandidateLimit()` ֻ�� `selectPerSpanCandidates()` �ڱ����ã�
- ����ԭʼ `8/4/2` �� **post-vote assembly selection limit**��
- **����** Domain Vote ǰ֤�ݱ���Ԥ�㡣

### 2. ��ǰ vote evidence pool ����ʵ��Դ

��ǰ vote pool �ǣ�

```text
compatibility.activeCandidates
  �� buildFineSpanCandidatePool(...)
  �� voteUtteranceDomainFromPool(pool)
```

��û�и��� `getPerSpanCandidateLimit()`��

��ˣ�

- ���� `8/6/4` ����ֱ�Ӹı� Domain Vote �������ѡ����
- ���� `8/6/4` ��Ҫ�ı���� **Winner Domain + Base** ���˺�ÿ�� coarse span ��ౣ�����ٺ�ѡ������䡣

### 3. Sentence Assembly �����ܿ� Assembly�������������

������֤�����

- `buildSentenceCandidates()` ���� coarse span interval-path ö�٣�
- ʹ��ԭ��λ�á�gap ������overlap �ų⡢���Ӹ���Լ����
- `maxIntervalEnumNodes = 1024` ���ֲ��䣻
- `maxSentenceCandidates` ����ʱ�ѻָ�����ֵ `16`��
- �����ڡ������дʺ�ѡ���ѿ�������ضϡ���ʵ�֡�

### 4. KenLM Responsibility Freeze

������ʵ�֣�

- KenLM ֻ���� **�ܿ� Assembly** ���ɵľ��Ӻ�ѡ��
- live smoke ��֤ `combinationCount = 16`��
- ������ `topCandidatesLen = 3`��
- Top3 �ṹ������
  - `rank`
  - `candidateId`
  - `text`
  - `kenlmScore`
  - `deltaVsRaw`
  - `isRaw`
- `pickedIsRaw`��`maxDelta`��`minDeltaToReplace` �Ա�����
- Gate / Apply �߼�δ�ġ�

## Implemented Changes

### Source changes

- `main/src/fw-detector/per-span-candidate-limit.ts`
  - `8/4/2 �� 8/6/4`
- `main/src/fw-detector/rerank-fw-sentences.ts`
  - KenLM diagnostics �� Top5 �ս��� Top3
  - Top3 ��ͬ����Ϊ `rank/candidateId/text/kenlmScore/deltaVsRaw/isRaw`
- `main/src/fw-detector/types.ts`
  - ��չ `FwSentenceRerankDiagnostics.topCandidates`
  - ���� vote margin �������ֶ�
- `main/src/fw-detector/span-assembly-shared/utterance-domain-vote.ts`
  - ���� `winnerScore` / `runnerUpDomain` / `runnerUpScore` / `voteMargin`
- `main/src/fw-detector/span-assembly-v4/span-assembly-v4-orchestrator.ts`
  - ��� vote diagnostics / fallbackCandidateCount / kenlmPoolCandidateCount / preFilterCombinationCount
- `main/src/fw-detector/span-assembly-v4/v4-types.ts`
  - �������� metrics ����

### Runtime validation

live smoke��`d001`�������±��벢�ָ����� config ������

```text
combinationCount = 16
Top3 length = 3
pickedIsRaw = true
maxDelta = 1.46146
minDeltaToReplace = 3
```

��˵����

- KenLM ��������� <= 16��
- Top3 �ѱ�����
- Gate / Apply �԰�ԭ������ִֵ�У�
- Top3 û�н���ڶ�ҵ������

## Regression / Comparison Baseline

���ֶ��ղ��ã�

```text
Baseline: 8/4/2 + 16
New:      8/6/4 + 16
```

���ڵ�ǰ `8/6/4` λ�� post-vote selection�������� pre-vote evidence����ˣ�

- **Domain Vote ׼ȷ���������ܹ��򵽱��ֲ������**��
- �ɹ������Ҫ�������� **post-vote candidate retention / assembly opportunity**��

�ɸ��õ���ʷʵ�飨A vs C1����ʾ��

- `business-usable candidate rate`: `5.7% �� 20.0%`
- `candidate better than Raw`: `5.7% �� 20.0%`
- `target in Generated`: `57.1% �� 62.9%`
- `all targets in one sentence`: `37.1% �� 48.6%`
- `KenLM selected usable rate`: `0.0% �� 42.9%`

����Щ����Ӧ������Ϊ��

> ��ȷ Winner Domain + Base ��ѡ��ͶƱ������׽����ܿ����أ�
> ������ Domain Vote evidence ������ `8/6/4` ����

## Must-answer Questions

### 1. `8/4/2` ��ǰλ�� Domain Vote ǰ���Ǻ�

**��** λ�� `selectPerSpanCandidates()`���� `voteUtteranceDomainFromPool()` ֮��

### 2. �����Ƶ�������֤������Assembly ��ѡ�����������߶����ƣ�

**��ǰֻ���� Assembly ��ѡ����** ������ Domain Vote pre-pool evidence��

### 3. ���� `8/6/4` ��Domain Vote ׼ȷ����߶��٣�

**��ǰ�޷��Ӹò��������õ�����������** ����������������ͶƱǰ�����Բ��ܽ� Domain Vote �仯����� `8/6/4`��

### 4. `general` winner �Ƿ���٣�

**���ֲ��ܽ���仯����� `8/6/4`��** ����֤�����������Ӷ��� pre-vote evidence �۲��ר����ơ�

### 5. ��ȷ fine-domain evidence �Ƿ����ӣ�

**�� Domain Vote ������棬δ�� `8/6/4` ֱ�����ӡ�**

### 6. ��ʤ�� domain ��ѡ�Ƿ��Ա���ȷ���ˣ�

**�ǡ�** �������ǣ�

```text
Winner Domain Candidates
+ Base Candidates
+ General fallback (only when insufficientEvidence/general)
```

### 7. �� KenLM �ĺ�ѡ���Ƿ������16��

**�ǡ�** live smoke ��֤ `combinationCount = 16`��

### 8. ��16���Ƿ����ܿ� Assembly ����������������ϣ�

**�ǡ�** ���� `buildSentenceCandidates()` �� interval-path assembly ���ɡ�

### 9. KenLM ������ֿ����Ƿ񱣳ֲ��䣿

**�ǡ�** ����������Ϊ 16��KenLM ���� ABI δ�䡣

### 10. KenLM �Ƿ񶳽�Ϊ Ranker��

**�ǡ�** ��ֻ���ܿؾ��Ӻ�ѡ���/���򣬲����� Domain Vote���ʼ�������������ɡ�

### 11. Top3 �Ƿ񱻱�����������ҵ��������

**�ǡ�** Top3 �������� diagnostics �У������� NMT/TTS/Apply �ڶ�����

### 12. Gate �� Apply �Ƿ���ȫδ�䣿

**�ǡ�** `minDeltaToReplace`��Gate��Apply ��δ�ġ�

### 13. �Ƿ����ְ����ϻ��ĵ����壿

**�����ĵ����塣** ��ǰ `8/6/4` ���ױ���д�ɡ�Span Evidence Expansion�������Ӵ��뿴��ֻ������ **post-vote retention / assembly selection**��

### 14. �Ƿ���Խ��� KenLM Code & Function Audit��

**���ԡ�** ��Ϊ�����Ѿ���ȷ��

- KenLM ������Ϊ�ܿ� <=16 �䣻
- Top3 diagnostics �ѱ�����
- Gate / Apply δ�ģ�
- KenLM ְ���Ѷ���Ϊ Ranker��

## Validation

### Passed

- `main/src/fw-detector/rerank-fw-sentences.test.ts`
- `main/src/fw-detector/span-assembly-v4/assemble-domain-aware-span-sets.test.ts`
- live pipeline smoke after rebuild

### Notes

- `freeze-contract.test.ts` ��ǰ��֧����ԭ����Լ����ʧ�ܣ�δ�ڱ���һ��������
- ������ȷ�� runtime config �ָ�������ֵ `maxSentenceCandidates = 16`��
- Electron main `dist` �����±��룬runtime �������Ч��

## Final Verdict

## B �� Responsibility Coupling Found

��׼ȷ��˵�����ַ��ֵ��� **responsibility location mismatch / �ĵ�����Ư�Ʒ���**��

- ��ǰ `8/6/4` �ѳɹ����� **post-vote per-span assembly selection**��
- KenLM Ranker / Top3 diagnostics ��������ɣ�
- ����������� `8/6/4` �����ɡ�Domain Vote evidence expansion�������뵱ǰ������ʵ��һ�¡�

����Ψһ��Ҫ����Ŀ���Լ����

> �Ժ������� `8/6/4`��������ȷ�䵱ǰְ���� **post-vote retention / assembly selection**��
> ������������ Domain Vote evidence�����뵥����Ʋ���� **pre-vote evidence budget**�������� post-vote assembly limit ��д��

## Next Step

�ڵ�ǰʵ��״̬�£�**���Խ��룺**

```text
KenLM Code & Function Audit
```

ǰ��ھ���

- KenLM = Ranker
- Top3 = Diagnostics Only
- Gate / Apply = Unchanged
- Sentence cap = 16
- ���ܰ� `8/6/4` ��������Ϊ vote-evidence budget
