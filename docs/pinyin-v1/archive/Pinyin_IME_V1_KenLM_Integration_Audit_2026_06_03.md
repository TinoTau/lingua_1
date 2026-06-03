# Pinyin IME V1 × KenLM First Integration Audit

**Date:** 2026-06-03
**Generated:** 2026-06-02T22:29:43.472Z
**Source:** D:\Programs\github\lingua_1\electron_node\electron-node\tests\spike\pinyin-ime-v1-dialog200-results.json

## 1. Executive Summary

在 117 条 Dialog200 样本上验证 IME TopK → KenLM rerank 链路。 KenLM 环境：可用（wsl）. Decoder Coverage（ref∈TopK）：1.2%；refInTop10：1.2%。 KenLM Selection Accuracy：0.0%。 Pipeline Success：0.0%。 路线判断：reference 基本不在 Top10 → 优先修 Decoder

## 2. KenLM Environment Report

```json
{
  "timestamp": "2026-06-02T22:20:25.319Z",
  "platform": "win32",
  "projectRoot": "D:\\Programs\\github\\lingua_1",
  "modelPath": "D:\\Programs\\github\\lingua_1\\electron_node\\services\\asr_sherpa_lm\\models\\kenLM\\zh_char_3gram.trie.bin",
  "modelExists": true,
  "queryPath": "D:\\Programs\\github\\lingua_1\\kenLM\\kenlm\\build\\bin\\query",
  "queryExists": true,
  "wslQueryPath": "D:\\Programs\\github\\lingua_1\\kenLM\\kenlm\\build\\bin\\query",
  "wslQueryExists": true,
  "transport": "wsl",
  "available": true,
  "smokeTest": {
    "text": "你好世界",
    "score": -13.089462,
    "normalizedScore": 0.21266323642175602,
    "oovCount": 0,
    "latencyMs": 695
  },
  "reason": null
}
```

## 3. Decoder Coverage Report

| 指标 | 全量 (n=117) | CJK 有候选 (n=84) |
|------|------|------|
| Decoder Coverage (refInCandidatePool) | 0.9% | 1.2% |
| refInTop1 | 0.0% | 0.0% |
| refInTop3 | 0.0% | 0.0% |
| refInTop5 | 0.0% | 0.0% |
| refInTop10 | 0.9% | 1.2% |
| refInAnyDiff | 9.4% | 13.1% |
| avg candidateCount | 7.16 | 9.98 |

## 4. KenLM Selection Report

| 指标 | 值 |
|------|-----|
| KenLM 可用率 | 100.0% |
| KenLM Selection Accuracy (ref∈TopK 时选中 ref) | 0.0% (n=1) |
| KenLM wouldApply 率 | 0.0% |
| KenLM rerank P50 / P95 | 4977ms / 5111ms |

## 5. Pipeline Success Report

| 指标 | 值 |
|------|-----|
| Pipeline Success Rate (KenLM 输出=ref 且 wouldApply) | 0.0% |
| IME decode P50 / P95 | 6ms / 13ms |

## 6. Sample Analysis (≥20)

### d036 — B_kenlm_fail

- **raw:** 请问立财产品的风险等急在哪里查看
- **ref:** 请问理财产品的风险等级在哪里查看？
- **refInCandidatePool:** true
- **IME TopK:** 1. 请问理财产品的风险等级再那里查看 | 2. 请问理财产品的风险等级在那里查看 | 3. 请问理财产品的风险登记再那里查看 | 4. 请问理财产品的风险登记在那里查看 | 5. 请问理睬产品的风险等级再那里查看
- **KenLM Winner:** 请问立财产品的风险等急在哪里查看
- **kenlmWouldApply:** false (delta=0.0222)

### d001 — A_decoder_fail

- **raw:** 你好,我想点一杯热拿铁钟贝少糖 深便温 以下今天有蓝美马分吗?
- **ref:** 你好，我想点一杯热拿铁，中杯，少糖。顺便问一下今天有蓝莓马芬吗？
- **refInCandidatePool:** false
- **IME TopK:** 1. 你好我向点以被热拿铁中杯勺趟身边文艺下今天游览每马芬吗 | 2. 你好我向点以被热拿铁中杯少趟身边文艺下今天游览每马芬吗 | 3. 你好我想点以被热拿铁中杯勺趟身边文艺下今天游览每马芬吗 | 4. 你好我想点以被热拿铁中杯少趟身边文艺下今天游览每马芬吗 | 5. 你好我向点以被热拿铁中杯绍趟身边文艺下今天游览每马芬吗
- **KenLM Winner:** 你好,我想点一杯热拿铁钟贝少糖 深便温 以下今天有蓝美马分吗?
- **kenlmWouldApply:** false (delta=-0.0001)

### d003 — A_decoder_fail

- **raw:** 请问,这款燕麦拿铁可以少病吗?我赶时间小背
- **ref:** 请问这款燕麦拿铁可以少冰吗？我赶时间，小杯。
- **refInCandidatePool:** false
- **IME TopK:** 1. 请问这宽掩埋拿铁可以烧饼吗我干事减小被 | 2. 请问这宽掩埋拿铁可以烧饼吗我干尸减小被 | 3. 请问这宽掩埋拿铁可以烧饼吗我干事减小北 | 4. 请问这宽掩埋拿铁可以哨兵吗我干事减小被 | 5. 请问这宽掩埋拿铁可以烧饼吗我干事减小杯
- **KenLM Winner:** 请问,这款燕麦拿铁可以少病吗?我赶时间小背
- **kenlmWouldApply:** false (delta=0.0002)

### d009 — A_decoder_fail

- **raw:** 去望金斯赫布走四环,可以吗?那边现在赌不赌?
- **ref:** 去望京SOHO，不走四环可以吗？那边现在堵不堵？
- **refInCandidatePool:** false
- **IME TopK:** 1. 去往近似何部走私幻可以吗那边现在独步杜 | 2. 去往近似何部走私欢可以吗那边现在独步杜 | 3. 去往近似和部走私幻可以吗那边现在独步杜 | 4. 去往近似和部走私欢可以吗那边现在独步杜 | 5. 去往近似何部走私环可以吗那边现在独步杜
- **KenLM Winner:** 去望金斯赫布走四环,可以吗?那边现在赌不赌?
- **kenlmWouldApply:** false (delta=0.0011)

### d013 — A_decoder_fail

- **raw:** 这件外套能试穿吗?我串中码,买两件有没有折扣?
- **ref:** 这件外套能试穿吗？我穿中码。买两件有没有折扣？
- **refInCandidatePool:** false
- **IME TopK:** 1. 这间外套能失传吗我传中吗买两间优美有着口 | 2. 这间外套能失传吗我传中吗卖两间优美有着口 | 3. 这件外套能失传吗我传中吗买两间优美有着口 | 4. 这件外套能失传吗我传中吗卖两间优美有着口 | 5. 这间外逃能失传吗我传中吗买两间优美有着口
- **KenLM Winner:** 这件外套能试穿吗?我串中码,买两件有没有折扣?
- **kenlmWouldApply:** false (delta=-0.0005)

### d014 — A_decoder_fail

- **raw:** 请问,这双鞋是否有相似的? 不合是三天内可以推换吧
- **ref:** 请问这双鞋有四十码吗？不合适三天内可以退换吧？
- **refInCandidatePool:** false
- **IME TopK:** 1. 请问这双写实否油箱似的不合失散天内科以退还把 | 2. 请问这双写实否油箱似的不合失散天内科以退还吧 | 3. 请问这双写诗否油箱似的不合失散天内科以退还把 | 4. 请问这双写诗否油箱似的不合失散天内科以退还吧 | 5. 请问这双写实否油箱使得不合失散天内科以退还把
- **KenLM Winner:** 请问,这双鞋是否有相似的? 不合是三天内可以推换吧
- **kenlmWouldApply:** false (delta=-0.0012)

### d015 — A_decoder_fail

- **raw:** 我想对比一下,这两款定制器 在商丹中台的加个会员日能再减一点吗?
- **ref:** 我想对比一下这两款订单中台的价格，会员日能再减一点吗？
- **refInCandidatePool:** false
- **IME TopK:** 1. 我向对比以下这辆宽定制七再上但中台的价格会员日能在建疑点吗 | 2. 我向对比以下这辆宽定制七在上但中台的价格会员日能在建疑点吗 | 3. 我向对比以下这辆宽定制乞再上但中台的价格会员日能在建疑点吗 | 4. 我向对比以下这辆宽定制乞在上但中台的价格会员日能在建疑点吗 | 5. 我向对比以下这辆宽定制气再上但中台的价格会员日能在建疑点吗
- **KenLM Winner:** 我想对比一下,这两款定制器 在商丹中台的加个会员日能再减一点吗?
- **kenlmWouldApply:** false (delta=-0.0005)

### d022 — A_decoder_fail

- **raw:** 您好,我定,但顯示 但物流三天每更新能幫我查一下嗎?
- **ref:** 您好，我订单显示已发货但物流三天没更新，能帮我查一下吗？
- **refInCandidatePool:** false
- **IME TopK:** 1. 您好我订单显示耽误流散甜美更新能帮我差异下马 | 2. 您好我订单现实耽误流散甜美更新能帮我差异下马 | 3. 您好我订单显示耽误流散甜美更新能帮我诧异下马 | 4. 您好我订单县市耽误流散甜美更新能帮我差异下马 | 5. 您好我订单现实耽误流散甜美更新能帮我诧异下马
- **KenLM Winner:** 您好,我定,但顯示 但物流三天每更新能幫我查一下嗎?
- **kenlmWouldApply:** false (delta=0.0006)

### d023 — A_decoder_fail

- **raw:** 想改一下收货地址还来得及吗? 麻烦尽快处理谢
- **ref:** 想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。
- **refInCandidatePool:** false
- **IME TopK:** 1. 向丐以下收获地址还来得及妈妈犯禁块处理写 | 2. 向丐以下收获地址还来得及妈妈犯禁块处理协 | 3. 向丐以下收获地址还来得及妈妈犯禁块处理邪 | 4. 想丐以下收获地址还来得及妈妈犯禁块处理写 | 5. 想丐以下收获地址还来得及妈妈犯禁块处理协
- **KenLM Winner:** 想改一下收货地址还来得及吗? 麻烦尽快处理谢
- **kenlmWouldApply:** false (delta=-0.0046)

### d002 — D_near_miss

- **raw:** 麻烦帮我做一杯美食带走大悲就行谢
- **ref:** 麻烦帮我做一杯美式带走，大杯就行，谢谢。
- **refInCandidatePool:** false
- **IME TopK:** 1. 麻烦帮我做以北美式带走大杯救星写 | 2. 麻烦帮我做以北美式带走大杯救星协 | 3. 麻烦帮我做以北美式带走大杯救星邪 | 4. 麻烦帮我做以北美式带走大杯救星些 | 5. 麻烦帮我做以北美式带走大杯救星胁
- **KenLM Winner:** 麻烦帮我做一杯美食带走大悲就行谢
- **kenlmWouldApply:** false (delta=0.0000)

### d005 — D_near_miss

- **raw:** 今天,德湛会献过一下订单,中台,进都内存 我们占用高者快需要先留保护大家看一下风险
- **ref:** 今天的站会先过一下订单中台进度，内存占用高这块需要限流保护，大家看一下风险。
- **refInCandidatePool:** false
- **IME TopK:** 1. 今天的展会鲜果以下订单中台筋斗内存我们占用高者块需要腺瘤保护大家看以下风险 | 2. 今天的展会鲜果以下定单中台筋斗内存我们占用高者块需要腺瘤保护大家看以下风险 | 3. 今天的展会鲜果以下订单中台筋斗内存我们占用高者块需要腺瘤保护大家看以下奉献 | 4. 今天的展会鲜果以下订单中台斤斗内存我们占用高者块需要腺瘤保护大家看以下风险 | 5. 今天的展会鲜果以下定单中台筋斗内存我们占用高者块需要腺瘤保护大家看以下奉献
- **KenLM Winner:** 今天,德湛会献过一下订单,中台,进都内存 我们占用高者快需要先留保护大家看一下风险
- **kenlmWouldApply:** false (delta=0.0000)

### d006 — D_near_miss

- **raw:** 跟會員系統相關的訊息 我整理了一版八点前请大家帮忙评审一下
- **ref:** 跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。
- **refInCandidatePool:** false
- **IME TopK:** 1. 跟会员系统相关的讯息我整理了一般把点前清大家帮忙评审以下 | 2. 跟会员系统相关的讯息我整理了一般吧点前清大家帮忙评审以下 | 3. 跟会员系统相关的讯息我整理了一般把店前清大家帮忙评审以下 | 4. 跟会员系统相关的讯息我整理了一般吧店前清大家帮忙评审以下 | 5. 跟会员系统相关的讯息我整理了一般把点前清大家帮忙平身以下
- **KenLM Winner:** 跟會員系統相關的訊息 我整理了一版八点前请大家帮忙评审一下
- **kenlmWouldApply:** false (delta=0.0003)

### d007 — D_near_miss

- **raw:** 市富曲仲觀村軟件遠走機場告訴我幹 9点半的回药师赌车 您提前跟我说
- **ref:** 师傅，去中关村软件园，走机场高速。我赶九点半的会，要是堵车您提前跟我说。
- **refInCandidatePool:** false
- **IME TopK:** 1. 师父去中观寸软件远走机场告诉我干点般的会要是堵车您提前跟我说 | 2. 师父去中观寸软件远走机场告诉我甘点般的会要是堵车您提前跟我说 | 3. 师父去中观寸软件远走机场告诉我杆点般的会要是堵车您提前跟我说 | 4. 师父去中观存软件远走机场告诉我干点般的会要是堵车您提前跟我说 | 5. 师父去中观存软件远走机场告诉我甘点般的会要是堵车您提前跟我说
- **KenLM Winner:** 市富曲仲觀村軟件遠走機場告訴我幹 9点半的回药师赌车 您提前跟我说
- **kenlmWouldApply:** false (delta=0.0002)

### d008 — D_near_miss

- **raw:** 麻烦送我到国贸三七南门大盖多久能到 我十点 10分有隔電話會
- **ref:** 麻烦送我到国贸三期南门，大概多久能到？我十点十分有个电话会。
- **refInCandidatePool:** false
- **IME TopK:** 1. 麻烦讼我到国贸三期南门大概夺就能到卧室淀粉由个电话会 | 2. 麻烦讼我到国贸三期南门大概夺就能到卧室淀粉有个电话会 | 3. 麻烦讼我到国贸三期南门大概朵就能到卧室淀粉由个电话会 | 4. 麻烦讼我到国贸三期南门大概朵就能到卧室淀粉有个电话会 | 5. 麻烦讼我到国贸三期南门大概多就能到卧室淀粉由个电话会
- **KenLM Winner:** 麻烦送我到国贸三七南门大盖多久能到 我十点 10分有隔電話會
- **kenlmWouldApply:** false (delta=0.0004)

### d010 — D_near_miss

- **raw:** 醫生您好,我這兩天頭痛想開點,要並做個歇常規
- **ref:** 医生您好，我这两天头痛，想开点药并做个血常规。
- **refInCandidatePool:** false
- **IME TopK:** 1. 医生您好我这良田头痛向开店要并做个写常规 | 2. 医生您好我这良田头痛向开店要并做个协常规 | 3. 医生您好我这良田头痛向开店要并做个邪常规 | 4. 医生您好我这良田头痛想开店要并做个写常规 | 5. 医生您好我这良田头痛想开店要并做个协常规
- **KenLM Winner:** 醫生您好,我這兩天頭痛想開點,要並做個歇常規
- **kenlmWouldApply:** false (delta=0.0017)

### d011 — D_near_miss

- **raw:** 刮号出请问 内刻还有号码 我微不 我感觉不舒服昨晚开始的
- **ref:** 挂号处请问内科还有号吗？我胃不舒服，昨晚开始的。
- **refInCandidatePool:** false
- **IME TopK:** 1. 挂号处请问内科还有号码我尾部我感觉部署辅佐晚开始的 | 2. 挂号处请问内科还有号码我尾部我感觉部署辅佐碗开始的 | 3. 挂号处请问内科还有号码我尾部我感觉部舒服昨晚开始的 | 4. 挂号处请问内科还有号码我尾部我感觉部束缚昨晚开始的 | 5. 挂号处请问内科还有号码我尾部我感觉部属辅佐晚开始的
- **KenLM Winner:** 刮号出请问 内刻还有号码 我微不 我感觉不舒服昨晚开始的
- **kenlmWouldApply:** false (delta=0.0000)

### d012 — D_near_miss

- **raw:** 這個檢查報告什麼時候能出 我過敏 需要请家休息吗?
- **ref:** 这个检查报告什么时候能出？我过敏发痒，需要请假休息吗？
- **refInCandidatePool:** false
- **IME TopK:** 1. 这个检查报告什模式后能处我国皿需要请假休息吗 | 2. 这个检查报告什模式后能处我国民需要请假休息吗 | 3. 这个检查报告申模式后能处我国皿需要请假休息吗 | 4. 这个检查报告申模式后能处我国民需要请假休息吗 | 5. 这个检查报告伸模式后能处我国皿需要请假休息吗
- **KenLM Winner:** 這個檢查報告什麼時候能出 我過敏 需要请家休息吗?
- **kenlmWouldApply:** false (delta=0.0030)

### d016 — D_near_miss

- **raw:** 周末要上班了 不要去江边骑行 天气预报说 周日多云记得带水
- **ref:** 周末要不要去江边骑行？天气预报说周日多云，记得带水。
- **refInCandidatePool:** false
- **IME TopK:** 1. 周末要上班了不要去江边气性天气预报说周日夺云记得带谁 | 2. 周末要上班了不要去江边气性天气预报说周日夺匀记得带谁 | 3. 周末要上班了不要去江边气性天气预报说周日夺允记得带谁 | 4. 周末要上班了不要去江边气性天气预报说周日夺孕记得带谁 | 5. 周末要上班了不要去江边气性天气预报说周日夺运记得带谁
- **KenLM Winner:** 周末要上班了 不要去江边骑行 天气预报说 周日多云记得带水
- **kenlmWouldApply:** false (delta=-0.0009)

### d017 — D_near_miss

- **raw:** 晚上一起吃饭嘛 我知道一家川菜 不错大概起点到
- **ref:** 晚上一起吃饭吗？我知道一家川菜不错，大概七点到。
- **refInCandidatePool:** false
- **IME TopK:** 1. 晚上一齐吃饭吗我知道意甲川菜不错大概起点到 | 2. 晚上一齐吃饭吗我知道溢价川菜不错大概起点到 | 3. 晚上仪器吃饭吗我知道意甲川菜不错大概起点到 | 4. 晚上一齐吃饭吗我知道医家川菜不错大概起点到 | 5. 晚上一齐吃饭吗我知道衣架川菜不错大概起点到
- **KenLM Winner:** 晚上一起吃饭嘛 我知道一家川菜 不错大概起点到
- **kenlmWouldApply:** false (delta=-0.0016)

### d018 — D_near_miss

- **raw:** 你最近忙不忙,想找你看下手机备份怎么设置
- **ref:** 你最近忙不忙？想找你看下手机备份怎么设置。
- **refInCandidatePool:** false
- **IME TopK:** 1. 你最近芒部芒向找你看下手脊背分怎么设置 | 2. 你最近芒部芒想找你看下手脊背分怎么设置 | 3. 你最近芒部忙向找你看下手脊背分怎么设置 | 4. 你最近芒部忙想找你看下手脊背分怎么设置 | 5. 你最近忙部芒向找你看下手脊背分怎么设置
- **KenLM Winner:** 你最近忙不忙,想找你看下手机备份怎么设置
- **kenlmWouldApply:** false (delta=-0.0039)

## 7. Failure Classification

```json
{
  "A_decoder_fail": 29,
  "B_kenlm_fail": 1,
  "C_pipeline_success": 0,
  "D_near_miss": 54,
  "other": 0
}
```

| 类别 | 含义 | count |
|------|------|-------|
| A_decoder_fail | reference 不在 TopK | 29 |
| B_kenlm_fail | reference 在 TopK，KenLM 选错 | 1 |
| C_pipeline_success | reference 在 TopK，KenLM 选对 | 0 |
| D_near_miss | reference 不在 TopK 但接近 | 54 |

## 8. Root Cause Analysis — TopK 为何低

### TopK 质量分解

| 类别 | 样本数 | 说明 |
|------|--------|------|
| 词库/拼音映射错误（有候选但 ref∉TopK） | 29 | 有候选但 ref 不在 TopK，多为 ASR 拼音→错误词元 |
| partial decode 缺失（Near Miss） | 54 | 有候选、CER≤0.35 或 refInAnyDiff，但 ref 不在 TopK |
| unknown/gap 缺失（candidate=0） | 3 | candidateCount=0 的全链断裂 |
| 功能单字不足 | 0 | 单字层已接入；非主因 |
| KenLM 选错/阈值阻断 | 1 | ref∈TopK 但 KenLM 未输出 ref（含 minDelta=0.03 阻断） |

**结论：** TopK 低的主因是 **Decoder 输出与 reference 不对齐**（拼音流错误 + 词库路径错误），不是 KenLM。54 条 Near Miss 说明 IME 已产出可读句但 ref 不在 TopK；仅 1 条 ref∈TopK（d036）且 KenLM 因 `minDeltaToReplace=0.03` 未 wouldApply（delta=0.022）。

- **decoder_coverage_low** (primary): reference 很少出现在 IME TopK
- **unknown/gap/partial decode 缺失** (primary): 
- **词库缺失（多字词/领域词）** (secondary): 
- **仍有全链 decode 失败** (secondary): 

## 9. Route Judgment

**情况 B:** reference 基本不在 Top10 → 优先修 Decoder

## 10. Next Development Direction

**优先级排序:** Decoder > KenLM > 词库

### 必须回答

1. **IME TopK 中是否已经包含正确答案？** 基本不成立 — Decoder Coverage 仅 1.2%
2. **KenLM 是否能识别正确答案？** 识别能力弱 — Selection Accuracy 0.0%
3. **当前瓶颈是 Decoder 还是 KenLM？** Decoder 为主
4. **unknown/gap/partial decode 是否仍需要？** 是 — Top10 覆盖不足，仍需 unknown/gap/partial decode
5. **是否可以进入主链？** 否 — 本轮为 spike 联调审计，Freeze Gate 未过，禁止入主链
6. **下一步优先级：** Decoder > KenLM > 词库

---

*Audit only — 未改 main/src，未接入生产链路。*