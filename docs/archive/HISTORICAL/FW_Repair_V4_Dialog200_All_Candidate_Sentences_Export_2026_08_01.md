<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: docs/current/INDEX.md
Archive Path: docs/archive/HISTORICAL/FW_Repair_V4_Dialog200_All_Candidate_Sentences_Export_2026_08_01.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: docs/current/INDEX.md

# FW Repair V4 — dialog_200 All Candidate Sentences Export

**Date:** 2026-08-01
**Nature:** READ / EXPORT FIRST · PRODUCTION OUTPUT ONLY · NO RERUN

## 1. Export Source

```text
EXPORT_SOURCE = EXISTING_TRACE
EXPORT_COMPLETE_FROM_EXISTING_TRACE
```

未重新运行生产代码。现有 `sentence_assembly_trace/001.json`…`200.json` 已含完整候选句文本。

## 2. Existing Artifact Inventory

| Artifact | Status |
|----------|--------|
| `sentence_assembly_trace/001.json`…`200.json` | PRESENT · used |
| `sentence_assembly_trace/*.md` | PRESENT · not required for export |
| `_aggregate.json` | PRESENT · stats only |
| KenLM scores in trace | NULL / NOT AVAILABLE |
| Final selected text in trace | NOT AVAILABLE |

## 3. Production Fields Used

- `paths[].buckets[].sentences[].finalText`
- `paths[].buckets[].sentences[].sentenceId`
- `paths[].buckets[].sentences[].assemblyRank/assemblyScore/replacements`
- `paths[].buckets[].bucketDedupe`
- `paths[].buckets[].generatedSentenceCount/limitedSentenceCount`
- `crossPath.input[].text`
- `crossPath.output[].text`
- `crossPath.drops`
- `crossPath.productionTrace`
- `crossPath.uniqueBeforeCapCount`
- `kenlmInputs[].text (kenlmScore=null)`
- `stats`

Machine-readable outputs:

- `docs/tone-v2/_audit_scratch/dialog200_candidate_sentence_export/dialog200_all_candidate_sentences.json`
- `docs/tone-v2/_audit_scratch/dialog200_candidate_sentence_export/dialog200_all_candidate_sentences.csv`
- `docs/tone-v2/_audit_scratch/dialog200_candidate_sentence_export/dialog200_multi_candidate_cases.md`
- `docs/tone-v2/_audit_scratch/dialog200_candidate_sentence_export/dialog200_candidate_cap_cases.md`

## 4. Global Case Index

| Case ID | Raw Text 摘要 | Assembly 句数 | CrossPath 输出 | KenLM 输入 |
| ------- | ----------- | ----------: | -----------: | --------: |
| [d001](#case-d001) | 你好，我想点一杯热拿铁，中杯，少糖。顺便问一下今天有蓝莓马芬吗？ | 4 | 1 | 1 |
| [d002](#case-d002) | 麻烦帮我做一杯美式带走，大杯就行，谢谢。 | 1 | 1 | 1 |
| [d003](#case-d003) | 请问这款燕麦拿铁可以少冰吗？我赶时间，小杯。 | 1 | 1 | 1 |
| [d004](#case-d004) | 小陈，客户反馈翻译引擎接口报错，我们能不能加缓存，下午三点前把结论发群里？ | 1 | 1 | 1 |
| [d005](#case-d005) | 今天的站会先过一下订单中台进度，内存占用高这块需要限流保护，大家看一下风险。 | 1 | 1 | 1 |
| [d006](#case-d006) | 跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。 | 3 | 1 | 1 |
| [d007](#case-d007) | 师傅，去中关村软件园，走机场高速。我赶九点半的会，要是堵车您提前跟我说。 | 3 | 2 | 2 |
| [d008](#case-d008) | 麻烦送我到国贸三期南门，大概多久能到？我十点十分有个电话会。 | 1 | 1 | 1 |
| [d009](#case-d009) | 去望京SOHO，不走四环可以吗？那边现在堵不堵？ | 2 | 2 | 2 |
| [d010](#case-d010) | 医生您好，我这两天头痛，想开点药并做个血常规。 | 1 | 1 | 1 |
| [d011](#case-d011) | 挂号处请问内科还有号吗？我胃不舒服，昨晚开始的。 | 1 | 1 | 1 |
| [d012](#case-d012) | 这个检查报告什么时候能出？我过敏发痒，需要请假休息吗？ | 3 | 1 | 1 |
| [d013](#case-d013) | 这件外套能试穿吗？我穿中码。买两件有没有折扣？ | 2 | 2 | 2 |
| [d014](#case-d014) | 请问这双鞋有四十码吗？不合适三天内可以退换吧？ | 2 | 2 | 2 |
| [d015](#case-d015) | 我想对比一下这两款订单中台的价格，会员日能再减一点吗？ | 1 | 1 | 1 |
| [d016](#case-d016) | 周末要不要去江边骑行？天气预报说周日多云，记得带水。 | 1 | 1 | 1 |
| [d017](#case-d017) | 晚上一起吃饭吗？我知道一家川菜不错，大概七点到。 | 1 | 1 | 1 |
| [d018](#case-d018) | 你最近忙不忙？想找你看下手机备份怎么设置。 | 1 | 1 | 1 |
| [d019](#case-d019) | 今天我们团队要讨论后选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。 | 16 | 8 | 8 |
| [d020](#case-d020) | 这次发布我们先对齐上线计划窗口，后选生城模块需要联调，别漏掉回归。 | 4 | 2 | 2 |
| [d021](#case-d021) | 会上提到候选生成链路要加监控，上线计划文档我下午更新一版。 | 2 | 1 | 1 |
| [d022](#case-d022) | 您好，我订单显示已发货但物流三天没更新，能帮我查一下吗？ | 1 | 1 | 1 |
| [d023](#case-d023) | 想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。 | 6 | 3 | 3 |
| [d024](#case-d024) | 发票抬头开错了，能重新开具电子发票吗？ | 2 | 1 | 1 |
| [d025](#case-d025) | 请简单介绍一下你上一段项目里负责的核心模块和难点。 | 2 | 2 | 2 |
| [d026](#case-d026) | 你如何看待跨团队协作？遇到需求变更一般怎么处理？ | 2 | 1 | 1 |
| [d027](#case-d027) | 期望薪资这块我们可以再沟通，你最快什么时候能入职？ | 2 | 2 | 2 |
| [d028](#case-d028) | 老师，这道题的解题步骤能不能再讲一遍？我没听懂第二点。 | 1 | 1 | 1 |
| [d029](#case-d029) | 作业是下周一下午交吗？可以电子版提交吗？ | 4 | 4 | 4 |
| [d030](#case-d030) | 请问这门课期末是开卷还是闭卷？重点会划吗？ | 2 | 2 | 2 |
| [d031](#case-d031) | 我预订的是大床房，能安排安静一点的楼层吗？ | 1 | 1 | 1 |
| [d032](#case-d032) | 早餐几点开始？退房可以延迟到下午两点吗？ | 1 | 1 | 1 |
| [d033](#case-d033) | 房间空调不太制冷，能派人上来看一下吗？ | 2 | 2 | 2 |
| [d034](#case-d034) | 我想开通短信提醒，需要带什么证件？ | 1 | 1 | 1 |
| [d035](#case-d035) | 这笔转账显示处理中，大概多久能到账？ | 2 | 1 | 1 |
| [d036](#case-d036) | 请问理财产品的风险等级在哪里查看？ | 3 | 2 | 2 |
| [d037](#case-d037) | 两位，靠窗有位置吗？不要香菜，微辣就行。 | 1 | 1 | 1 |
| [d038](#case-d038) | 这道菜大概要等多久？我们先点一份凉菜和一壶茶。 | 1 | 1 | 1 |
| [d039](#case-d039) | 可以打包吗？顺便结一下账，能扫码支付吗？ | 1 | 1 | 1 |
| [d040](#case-d040) | 私教课还剩几次？能帮我约明天晚上七点吗？ | 1 | 1 | 1 |
| [d041](#case-d041) | 更衣室柜子钥匙找不到了，前台能帮忙开一下吗？ | 5 | 3 | 3 |
| [d042](#case-d042) | 游泳次卡本月月底到期，续费有优惠吗？ | 1 | 1 | 1 |
| [d043](#case-d043) | 我们下午讨论后选声城方案，先把候选生成的接口文档补齐。 | 4 | 2 | 2 |
| [d044](#case-d044) | 这周的上线计花已经确认，上线计划评审安排在周四上午。 | 10 | 3 | 3 |
| [d045](#case-d045) | 关于后选生城和上线计化，请按上线计划执行，有问题群里说。 | 16 | 4 | 4 |
| [d046](#case-d046) | 你好，我想点一杯卡布奇诺，中杯，正常糖。顺便问一下今天有芝士蛋糕吗？ | 6 | 1 | 1 |
| [d047](#case-d047) | 麻烦帮我做一杯红茶带走，大杯就行，谢谢。 | 1 | 1 | 1 |
| [d048](#case-d048) | 请问这款热巧克力可以少冰吗？我赶时间，小杯。 | 1 | 1 | 1 |
| [d049](#case-d049) | 李工，客户反馈翻译引擎接口报错，我们能不能加缓存，下午三点前把结论发群里？ | 1 | 1 | 1 |
| [d050](#case-d050) | 今天的站会先过一下订单中台进度，内存占用高这块需要限流保护，大家看一下风险。 | 1 | 1 | 1 |
| [d051](#case-d051) | 跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。 | 3 | 1 | 1 |
| [d052](#case-d052) | 师傅，去浦东张江，走延安路高架。我赶九点半的会，要是堵车您提前跟我说。 | 2 | 2 | 2 |
| [d053](#case-d053) | 麻烦送我到深圳南山科技园南门，大概多久能到？我十点十分有个电话会。 | 4 | 3 | 3 |
| [d054](#case-d054) | 去杭州西溪，不走三环可以吗？那边现在堵不堵？ | 4 | 3 | 3 |
| [d055](#case-d055) | 医生您好，我这两天嗓子疼，想开点药并做个血常规。 | 1 | 1 | 1 |
| [d056](#case-d056) | 挂号处请问内科还有号吗？我低烧，昨晚开始的。 | 1 | 1 | 1 |
| [d057](#case-d057) | 这个检查报告什么时候能出？我咳嗽，需要请假休息吗？ | 2 | 1 | 1 |
| [d058](#case-d058) | 这件外套能试穿吗？我穿中码。买两件有没有折扣？ | 2 | 2 | 2 |
| [d059](#case-d059) | 请问这双鞋有四十码吗？不合适三天内可以退换吧？ | 2 | 2 | 2 |
| [d060](#case-d060) | 我想对比一下这两款订单中台的价格，会员日能再减一点吗？ | 1 | 1 | 1 |
| [d061](#case-d061) | 周末要不要去江边骑行？天气预报说周日多云，记得带水。 | 1 | 1 | 1 |
| [d062](#case-d062) | 晚上一起吃饭吗？我知道一家川菜不错，大概七点到。 | 1 | 1 | 1 |
| [d063](#case-d063) | 你最近忙不忙？想找你看下手机备份怎么设置。 | 1 | 1 | 1 |
| [d064](#case-d064) | 今天我们团队要讨论后选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。 | 16 | 8 | 8 |
| [d065](#case-d065) | 这次发布我们先对齐上线计划窗口，后选生城模块需要联调，别漏掉回归。 | 4 | 2 | 2 |
| [d066](#case-d066) | 会上提到候选生成链路要加监控，上线计划文档我下午更新一版。 | 2 | 1 | 1 |
| [d067](#case-d067) | 您好，我订单显示已发货但物流三天没更新，能帮我查一下吗？ | 1 | 1 | 1 |
| [d068](#case-d068) | 想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。 | 6 | 3 | 3 |
| [d069](#case-d069) | 发票抬头开错了，能重新开具电子发票吗？ | 2 | 1 | 1 |
| [d070](#case-d070) | 请简单介绍一下你上一段项目里负责的核心模块和难点。 | 2 | 2 | 2 |
| [d071](#case-d071) | 你如何看待跨团队协作？遇到需求变更一般怎么处理？ | 2 | 1 | 1 |
| [d072](#case-d072) | 期望薪资这块我们可以再沟通，你最快什么时候能入职？ | 2 | 2 | 2 |
| [d073](#case-d073) | 老师，这道题的解题步骤能不能再讲一遍？我没听懂第二点。 | 1 | 1 | 1 |
| [d074](#case-d074) | 作业是下周一下午交吗？可以电子版提交吗？ | 4 | 4 | 4 |
| [d075](#case-d075) | 请问这门课期末是开卷还是闭卷？重点会划吗？ | 2 | 2 | 2 |
| [d076](#case-d076) | 我预订的是大床房，能安排安静一点的楼层吗？ | 1 | 1 | 1 |
| [d077](#case-d077) | 早餐几点开始？退房可以延迟到下午两点吗？ | 1 | 1 | 1 |
| [d078](#case-d078) | 房间空调不太制冷，能派人上来看一下吗？ | 2 | 2 | 2 |
| [d079](#case-d079) | 我想开通短信提醒，需要带什么证件？ | 1 | 1 | 1 |
| [d080](#case-d080) | 这笔转账显示处理中，大概多久能到账？ | 2 | 1 | 1 |
| [d081](#case-d081) | 请问理财产品的风险等级在哪里查看？ | 3 | 2 | 2 |
| [d082](#case-d082) | 两位，靠窗有位置吗？不要香菜，微辣就行。 | 1 | 1 | 1 |
| [d083](#case-d083) | 这道菜大概要等多久？我们先点一份凉菜和一壶茶。 | 1 | 1 | 1 |
| [d084](#case-d084) | 可以打包吗？顺便结一下账，能扫码支付吗？ | 1 | 1 | 1 |
| [d085](#case-d085) | 私教课还剩几次？能帮我约明天晚上七点吗？ | 1 | 1 | 1 |
| [d086](#case-d086) | 更衣室柜子钥匙找不到了，前台能帮忙开一下吗？ | 5 | 3 | 3 |
| [d087](#case-d087) | 游泳次卡本月月底到期，续费有优惠吗？ | 1 | 1 | 1 |
| [d088](#case-d088) | 我们下午讨论后选声城方案，先把候选生成的接口文档补齐。 | 4 | 2 | 2 |
| [d089](#case-d089) | 这周的上线计花已经确认，上线计划评审安排在周四上午。 | 10 | 3 | 3 |
| [d090](#case-d090) | 关于后选生城和上线计化，请按上线计划执行，有问题群里说。 | 16 | 4 | 4 |
| [d091](#case-d091) | 你好，我想点一杯燕麦拿铁，中杯，无糖。顺便问一下今天有贝果吗？ | 1 | 1 | 1 |
| [d092](#case-d092) | 麻烦帮我做一杯抹茶拿铁带走，大杯就行，谢谢。 | 1 | 1 | 1 |
| [d093](#case-d093) | 请问这款冰美式可以少冰吗？我赶时间，小杯。 | 1 | 1 | 1 |
| [d094](#case-d094) | 小陈，客户反馈翻译引擎接口报错，我们能不能加缓存，下午三点前把结论发群里？ | 1 | 1 | 1 |
| [d095](#case-d095) | 今天的站会先过一下订单中台进度，内存占用高这块需要限流保护，大家看一下风险。 | 1 | 1 | 1 |
| [d096](#case-d096) | 跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。 | 3 | 1 | 1 |
| [d097](#case-d097) | 师傅，去中关村软件园，走四环。我赶九点半的会，要是堵车您提前跟我说。 | 2 | 2 | 2 |
| [d098](#case-d098) | 麻烦送我到国贸三期南门，大概多久能到？我十点十分有个电话会。 | 1 | 1 | 1 |
| [d099](#case-d099) | 去望京SOHO，不走机场高速可以吗？那边现在堵不堵？ | 1 | 1 | 1 |
| [d100](#case-d100) | 医生您好，我这两天头痛，想开点药并做个血常规。 | 1 | 1 | 1 |
| [d101](#case-d101) | 挂号处请问内科还有号吗？我胃不舒服，昨晚开始的。 | 1 | 1 | 1 |
| [d102](#case-d102) | 这个检查报告什么时候能出？我过敏发痒，需要请假休息吗？ | 3 | 1 | 1 |
| [d103](#case-d103) | 这件外套能试穿吗？我穿中码。买两件有没有折扣？ | 2 | 2 | 2 |
| [d104](#case-d104) | 请问这双鞋有四十码吗？不合适三天内可以退换吧？ | 2 | 2 | 2 |
| [d105](#case-d105) | 我想对比一下这两款订单中台的价格，会员日能再减一点吗？ | 1 | 1 | 1 |
| [d106](#case-d106) | 周末要不要去江边骑行？天气预报说周日多云，记得带水。 | 1 | 1 | 1 |
| [d107](#case-d107) | 晚上一起吃饭吗？我知道一家川菜不错，大概七点到。 | 1 | 1 | 1 |
| [d108](#case-d108) | 你最近忙不忙？想找你看下手机备份怎么设置。 | 1 | 1 | 1 |
| [d109](#case-d109) | 今天我们团队要讨论后选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。 | 16 | 8 | 8 |
| [d110](#case-d110) | 这次发布我们先对齐上线计划窗口，后选生城模块需要联调，别漏掉回归。 | 4 | 2 | 2 |
| [d111](#case-d111) | 会上提到候选生成链路要加监控，上线计划文档我下午更新一版。 | 2 | 1 | 1 |
| [d112](#case-d112) | 您好，我订单显示已发货但物流三天没更新，能帮我查一下吗？ | 1 | 1 | 1 |
| [d113](#case-d113) | 想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。 | 6 | 3 | 3 |
| [d114](#case-d114) | 发票抬头开错了，能重新开具电子发票吗？ | 2 | 1 | 1 |
| [d115](#case-d115) | 请简单介绍一下你上一段项目里负责的核心模块和难点。 | 2 | 2 | 2 |
| [d116](#case-d116) | 你如何看待跨团队协作？遇到需求变更一般怎么处理？ | 2 | 1 | 1 |
| [d117](#case-d117) | 期望薪资这块我们可以再沟通，你最快什么时候能入职？ | 2 | 2 | 2 |
| [d118](#case-d118) | 老师，这道题的解题步骤能不能再讲一遍？我没听懂第二点。 | 1 | 1 | 1 |
| [d119](#case-d119) | 作业是下周一下午交吗？可以电子版提交吗？ | 4 | 4 | 4 |
| [d120](#case-d120) | 请问这门课期末是开卷还是闭卷？重点会划吗？ | 2 | 2 | 2 |
| [d121](#case-d121) | 我预订的是大床房，能安排安静一点的楼层吗？ | 1 | 1 | 1 |
| [d122](#case-d122) | 早餐几点开始？退房可以延迟到下午两点吗？ | 1 | 1 | 1 |
| [d123](#case-d123) | 房间空调不太制冷，能派人上来看一下吗？ | 2 | 2 | 2 |
| [d124](#case-d124) | 我想开通短信提醒，需要带什么证件？ | 1 | 1 | 1 |
| [d125](#case-d125) | 这笔转账显示处理中，大概多久能到账？ | 2 | 1 | 1 |
| [d126](#case-d126) | 请问理财产品的风险等级在哪里查看？ | 3 | 2 | 2 |
| [d127](#case-d127) | 两位，靠窗有位置吗？不要香菜，微辣就行。 | 1 | 1 | 1 |
| [d128](#case-d128) | 这道菜大概要等多久？我们先点一份凉菜和一壶茶。 | 1 | 1 | 1 |
| [d129](#case-d129) | 可以打包吗？顺便结一下账，能扫码支付吗？ | 1 | 1 | 1 |
| [d130](#case-d130) | 私教课还剩几次？能帮我约明天晚上七点吗？ | 1 | 1 | 1 |
| [d131](#case-d131) | 更衣室柜子钥匙找不到了，前台能帮忙开一下吗？ | 5 | 3 | 3 |
| [d132](#case-d132) | 游泳次卡本月月底到期，续费有优惠吗？ | 1 | 1 | 1 |
| [d133](#case-d133) | 我们下午讨论后选声城方案，先把候选生成的接口文档补齐。 | 4 | 2 | 2 |
| [d134](#case-d134) | 这周的上线计花已经确认，上线计划评审安排在周四上午。 | 10 | 3 | 3 |
| [d135](#case-d135) | 关于后选生城和上线计化，请按上线计划执行，有问题群里说。 | 16 | 4 | 4 |
| [d136](#case-d136) | 你好，我想点一杯热巧克力，中杯，半糖。顺便问一下今天有曲奇吗？ | 3 | 1 | 1 |
| [d137](#case-d137) | 麻烦帮我做一杯热拿铁带走，大杯就行，谢谢。 | 1 | 1 | 1 |
| [d138](#case-d138) | 请问这款美式可以少冰吗？我赶时间，小杯。 | 1 | 1 | 1 |
| [d139](#case-d139) | 李工，客户反馈翻译引擎接口报错，我们能不能加缓存，下午三点前把结论发群里？ | 1 | 1 | 1 |
| [d140](#case-d140) | 今天的站会先过一下订单中台进度，内存占用高这块需要限流保护，大家看一下风险。 | 1 | 1 | 1 |
| [d141](#case-d141) | 跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。 | 3 | 1 | 1 |
| [d142](#case-d142) | 师傅，去浦东张江，走三环。我赶九点半的会，要是堵车您提前跟我说。 | 2 | 2 | 2 |
| [d143](#case-d143) | 麻烦送我到深圳南山科技园南门，大概多久能到？我十点十分有个电话会。 | 4 | 3 | 3 |
| [d144](#case-d144) | 去杭州西溪，不走延安路高架可以吗？那边现在堵不堵？ | 4 | 3 | 3 |
| [d145](#case-d145) | 医生您好，我这两天嗓子疼，想开点药并做个血常规。 | 1 | 1 | 1 |
| [d146](#case-d146) | 挂号处请问内科还有号吗？我低烧，昨晚开始的。 | 1 | 1 | 1 |
| [d147](#case-d147) | 这个检查报告什么时候能出？我咳嗽，需要请假休息吗？ | 2 | 1 | 1 |
| [d148](#case-d148) | 这件外套能试穿吗？我穿中码。买两件有没有折扣？ | 2 | 2 | 2 |
| [d149](#case-d149) | 请问这双鞋有四十码吗？不合适三天内可以退换吧？ | 2 | 2 | 2 |
| [d150](#case-d150) | 我想对比一下这两款订单中台的价格，会员日能再减一点吗？ | 1 | 1 | 1 |
| [d151](#case-d151) | 周末要不要去江边骑行？天气预报说周日多云，记得带水。 | 1 | 1 | 1 |
| [d152](#case-d152) | 晚上一起吃饭吗？我知道一家川菜不错，大概七点到。 | 1 | 1 | 1 |
| [d153](#case-d153) | 你最近忙不忙？想找你看下手机备份怎么设置。 | 1 | 1 | 1 |
| [d154](#case-d154) | 今天我们团队要讨论后选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。 | 16 | 8 | 8 |
| [d155](#case-d155) | 这次发布我们先对齐上线计划窗口，后选生城模块需要联调，别漏掉回归。 | 4 | 2 | 2 |
| [d156](#case-d156) | 会上提到候选生成链路要加监控，上线计划文档我下午更新一版。 | 2 | 1 | 1 |
| [d157](#case-d157) | 您好，我订单显示已发货但物流三天没更新，能帮我查一下吗？ | 1 | 1 | 1 |
| [d158](#case-d158) | 想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。 | 6 | 3 | 3 |
| [d159](#case-d159) | 发票抬头开错了，能重新开具电子发票吗？ | 2 | 1 | 1 |
| [d160](#case-d160) | 请简单介绍一下你上一段项目里负责的核心模块和难点。 | 2 | 2 | 2 |
| [d161](#case-d161) | 你如何看待跨团队协作？遇到需求变更一般怎么处理？ | 2 | 1 | 1 |
| [d162](#case-d162) | 期望薪资这块我们可以再沟通，你最快什么时候能入职？ | 2 | 2 | 2 |
| [d163](#case-d163) | 老师，这道题的解题步骤能不能再讲一遍？我没听懂第二点。 | 1 | 1 | 1 |
| [d164](#case-d164) | 作业是下周一下午交吗？可以电子版提交吗？ | 4 | 4 | 4 |
| [d165](#case-d165) | 请问这门课期末是开卷还是闭卷？重点会划吗？ | 2 | 2 | 2 |
| [d166](#case-d166) | 我预订的是大床房，能安排安静一点的楼层吗？ | 1 | 1 | 1 |
| [d167](#case-d167) | 早餐几点开始？退房可以延迟到下午两点吗？ | 1 | 1 | 1 |
| [d168](#case-d168) | 房间空调不太制冷，能派人上来看一下吗？ | 2 | 2 | 2 |
| [d169](#case-d169) | 我想开通短信提醒，需要带什么证件？ | 1 | 1 | 1 |
| [d170](#case-d170) | 这笔转账显示处理中，大概多久能到账？ | 2 | 1 | 1 |
| [d171](#case-d171) | 请问理财产品的风险等级在哪里查看？ | 3 | 2 | 2 |
| [d172](#case-d172) | 两位，靠窗有位置吗？不要香菜，微辣就行。 | 1 | 1 | 1 |
| [d173](#case-d173) | 这道菜大概要等多久？我们先点一份凉菜和一壶茶。 | 1 | 1 | 1 |
| [d174](#case-d174) | 可以打包吗？顺便结一下账，能扫码支付吗？ | 1 | 1 | 1 |
| [d175](#case-d175) | 私教课还剩几次？能帮我约明天晚上七点吗？ | 1 | 1 | 1 |
| [d176](#case-d176) | 更衣室柜子钥匙找不到了，前台能帮忙开一下吗？ | 5 | 3 | 3 |
| [d177](#case-d177) | 游泳次卡本月月底到期，续费有优惠吗？ | 1 | 1 | 1 |
| [d178](#case-d178) | 我们下午讨论后选声城方案，先把候选生成的接口文档补齐。 | 4 | 2 | 2 |
| [d179](#case-d179) | 这周的上线计花已经确认，上线计划评审安排在周四上午。 | 10 | 3 | 3 |
| [d180](#case-d180) | 关于后选生城和上线计化，请按上线计划执行，有问题群里说。 | 16 | 4 | 4 |
| [d181](#case-d181) | 你好，我想点一杯冰美式，中杯，少糖。顺便问一下今天有蓝莓马芬吗？ | 4 | 1 | 1 |
| [d182](#case-d182) | 麻烦帮我做一杯卡布奇诺带走，大杯就行，谢谢。 | 2 | 1 | 1 |
| [d183](#case-d183) | 请问这款红茶可以少冰吗？我赶时间，小杯。 | 2 | 1 | 1 |
| [d184](#case-d184) | 小陈，客户反馈翻译引擎接口报错，我们能不能加缓存，下午三点前把结论发群里？ | 1 | 1 | 1 |
| [d185](#case-d185) | 今天的站会先过一下订单中台进度，内存占用高这块需要限流保护，大家看一下风险。 | 1 | 1 | 1 |
| [d186](#case-d186) | 跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。 | 3 | 1 | 1 |
| [d187](#case-d187) | 师傅，去中关村软件园，走机场高速。我赶九点半的会，要是堵车您提前跟我说。 | 3 | 2 | 2 |
| [d188](#case-d188) | 麻烦送我到国贸三期南门，大概多久能到？我十点十分有个电话会。 | 1 | 1 | 1 |
| [d189](#case-d189) | 去望京SOHO，不走四环可以吗？那边现在堵不堵？ | 2 | 2 | 2 |
| [d190](#case-d190) | 医生您好，我这两天头痛，想开点药并做个血常规。 | 1 | 1 | 1 |
| [d191](#case-d191) | 挂号处请问内科还有号吗？我胃不舒服，昨晚开始的。 | 1 | 1 | 1 |
| [d192](#case-d192) | 这个检查报告什么时候能出？我过敏发痒，需要请假休息吗？ | 3 | 1 | 1 |
| [d193](#case-d193) | 这件外套能试穿吗？我穿中码。买两件有没有折扣？ | 2 | 2 | 2 |
| [d194](#case-d194) | 请问这双鞋有四十码吗？不合适三天内可以退换吧？ | 2 | 2 | 2 |
| [d195](#case-d195) | 我想对比一下这两款订单中台的价格，会员日能再减一点吗？ | 1 | 1 | 1 |
| [d196](#case-d196) | 周末要不要去江边骑行？天气预报说周日多云，记得带水。 | 1 | 1 | 1 |
| [d197](#case-d197) | 晚上一起吃饭吗？我知道一家川菜不错，大概七点到。 | 1 | 1 | 1 |
| [d198](#case-d198) | 你最近忙不忙？想找你看下手机备份怎么设置。 | 1 | 1 | 1 |
| [d199](#case-d199) | 今天我们团队要讨论后选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。 | 16 | 8 | 8 |
| [d200](#case-d200) | 这次发布我们先对齐上线计划窗口，后选生城模块需要联调，别漏掉回归。 | 4 | 2 | 2 |

## Totals

```text
导出 Case 数: 200
单候选 Case 数 (KenLM≤1): 125
多候选 Case 数 (KenLM>1): 75
KenLM Input 总句数: 337
最大单 Case KenLM 候选数: 8 (d019)
Assembly 总句数: 550
CrossPath Input 总句数: 550
CrossPath Output 总句数: 337
```

## Case d001

<a id="case-d001"></a>

### Case 基础信息

```text
Case ID: d001
Raw Text: 你好，我想点一杯热拿铁，中杯，少糖。顺便问一下今天有蓝莓马芬吗？
Path Count: 2
Bucket Count: 4
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `dfdf9f0cedb03c87e0d1f43c670ec66222f45ae24de8fb942124a8ed4d139e36`

Bucket: `food_order` (`p0_b0`)

Assembly Sentences:

1.

```text
你好，我想点一杯热拿铁，中杯，少糖。顺便问一下今天有蓝莓马芬吗？
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 9.19

#### Path: `dfdf9f0cedb03c87e0d1f43c670ec66222f45ae24de8fb942124a8ed4d139e36`

Bucket: `coffee` (`p0_b1`)

Assembly Sentences:

1.

```text
你好，我想点一杯热拿铁，中杯，少糖。顺便问一下今天有蓝莓马芬吗？
```

- sentenceId: `p0_b1_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 6.7475000000000005

#### Path: `34555bf4cfbd5917bf1089256ee6a3ad60e9757d24216598cdf06ef883136d03`

Bucket: `coffee` (`p1_b0`)

Assembly Sentences:

1.

```text
你好，我想点一杯热拿铁，中杯，少糖。顺便问一下今天有蓝莓马芬吗？
```

- sentenceId: `p1_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 6.7475000000000005

#### Path: `34555bf4cfbd5917bf1089256ee6a3ad60e9757d24216598cdf06ef883136d03`

Bucket: `food_order` (`p1_b1`)

Assembly Sentences:

1.

```text
你好，我想点一杯热拿铁，中杯，少糖。顺便问一下今天有蓝莓马芬吗？
```

- sentenceId: `p1_b1_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 6.79

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 4

1.

```text
text: 你好，我想点一杯热拿铁，中杯，少糖。顺便问一下今天有蓝莓马芬吗？
pathId: dfdf9f0cedb03c87e0d1f43c670ec66222f45ae24de8fb942124a8ed4d139e36
bucketDomain: food_order
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 你好，我想点一杯热拿铁，中杯，少糖。顺便问一下今天有蓝莓马芬吗？
pathId: dfdf9f0cedb03c87e0d1f43c670ec66222f45ae24de8fb942124a8ed4d139e36
bucketDomain: coffee
sourceSentenceId: p0_b1_s0
```

3.

```text
text: 你好，我想点一杯热拿铁，中杯，少糖。顺便问一下今天有蓝莓马芬吗？
pathId: 34555bf4cfbd5917bf1089256ee6a3ad60e9757d24216598cdf06ef883136d03
bucketDomain: coffee
sourceSentenceId: p1_b0_s0
```

4.

```text
text: 你好，我想点一杯热拿铁，中杯，少糖。顺便问一下今天有蓝莓马芬吗？
pathId: 34555bf4cfbd5917bf1089256ee6a3ad60e9757d24216598cdf06ef883136d03
bucketDomain: food_order
sourceSentenceId: p1_b1_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 你好，我想点一杯热拿铁，中杯，少糖。顺便问一下今天有蓝莓马芬吗？
keptFromPath: dfdf9f0cedb03c87e0d1f43c670ec66222f45ae24de8fb942124a8ed4d139e36
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

```text
Dropped Text: 你好，我想点一杯热拿铁，中杯，少糖。顺便问一下今天有蓝莓马芬吗？
Source Sentence: p0_b1_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 你好，我想点一杯热拿铁，中杯，少糖。顺便问一下今天有蓝莓马芬吗？
```

```text
Dropped Text: 你好，我想点一杯热拿铁，中杯，少糖。顺便问一下今天有蓝莓马芬吗？
Source Sentence: p1_b0_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 你好，我想点一杯热拿铁，中杯，少糖。顺便问一下今天有蓝莓马芬吗？
```

```text
Dropped Text: 你好，我想点一杯热拿铁，中杯，少糖。顺便问一下今天有蓝莓马芬吗？
Source Sentence: p1_b1_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 你好，我想点一杯热拿铁，中杯，少糖。顺便问一下今天有蓝莓马芬吗？
```

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
你好，我想点一杯热拿铁，中杯，少糖。顺便问一下今天有蓝莓马芬吗？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"dfdf9f0cedb03c87e0d1f43c670ec66222f45ae24de8fb942124a8ed4d139e36","bucketDomain":"food_order","count":1},{"pathId":"dfdf9f0cedb03c87e0d1f43c670ec66222f45ae24de8fb942124a8ed4d139e36","bucketDomain":"coffee","count":1},{"pathId":"34555bf4cfbd5917bf1089256ee6a3ad60e9757d24216598cdf06ef883136d03","bucketDomain":"coffee","count":1},{"pathId":"34555bf4cfbd5917bf1089256ee6a3ad60e9757d24216598cdf06ef883136d03","bucketDomain":"food_order","count":1}]
crossPathInputCount: 4
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (4 vs 4)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d002

<a id="case-d002"></a>

### Case 基础信息

```text
Case ID: d002
Raw Text: 麻烦帮我做一杯美式带走，大杯就行，谢谢。
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `867a50d5d8c7de1e31ac489575a564e7821f7fb90f30c806fe07ede6f7d3e562`

Bucket: `coffee` (`p0_b0`)

Assembly Sentences:

1.

```text
麻烦帮我做一杯美式带走，大杯就行，谢谢。
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 7.09

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 麻烦帮我做一杯美式带走，大杯就行，谢谢。
pathId: 867a50d5d8c7de1e31ac489575a564e7821f7fb90f30c806fe07ede6f7d3e562
bucketDomain: coffee
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 麻烦帮我做一杯美式带走，大杯就行，谢谢。
keptFromPath: 867a50d5d8c7de1e31ac489575a564e7821f7fb90f30c806fe07ede6f7d3e562
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
麻烦帮我做一杯美式带走，大杯就行，谢谢。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"867a50d5d8c7de1e31ac489575a564e7821f7fb90f30c806fe07ede6f7d3e562","bucketDomain":"coffee","count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d003

<a id="case-d003"></a>

### Case 基础信息

```text
Case ID: d003
Raw Text: 请问这款燕麦拿铁可以少冰吗？我赶时间，小杯。
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `d3b0c80be0f5aa88906967ab1e839c46c7e72e06bd780e4feff1fa08a9f6b0a9`

Bucket: `coffee` (`p0_b0`)

Assembly Sentences:

1.

```text
请问这款燕麦拿铁可以少冰吗？我赶时间，小杯。
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 11.475999999999999

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 请问这款燕麦拿铁可以少冰吗？我赶时间，小杯。
pathId: d3b0c80be0f5aa88906967ab1e839c46c7e72e06bd780e4feff1fa08a9f6b0a9
bucketDomain: coffee
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 请问这款燕麦拿铁可以少冰吗？我赶时间，小杯。
keptFromPath: d3b0c80be0f5aa88906967ab1e839c46c7e72e06bd780e4feff1fa08a9f6b0a9
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
请问这款燕麦拿铁可以少冰吗？我赶时间，小杯。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"d3b0c80be0f5aa88906967ab1e839c46c7e72e06bd780e4feff1fa08a9f6b0a9","bucketDomain":"coffee","count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d004

<a id="case-d004"></a>

### Case 基础信息

```text
Case ID: d004
Raw Text: 小陈，客户反馈翻译引擎接口报错，我们能不能加缓存，下午三点前把结论发群里？
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `192b84f072ea72e5bfc1e646510978c24cb4fc1275c9fb642895892d1fab1c0a`

Bucket: `tech_ai` (`p0_b0`)

Assembly Sentences:

1.

```text
小陈，客户反馈翻译引擎接口报错，我们能不能加缓存，下午三点前把结论发群里？
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 9.54

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 小陈，客户反馈翻译引擎接口报错，我们能不能加缓存，下午三点前把结论发群里？
pathId: 192b84f072ea72e5bfc1e646510978c24cb4fc1275c9fb642895892d1fab1c0a
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 小陈，客户反馈翻译引擎接口报错，我们能不能加缓存，下午三点前把结论发群里？
keptFromPath: 192b84f072ea72e5bfc1e646510978c24cb4fc1275c9fb642895892d1fab1c0a
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
小陈，客户反馈翻译引擎接口报错，我们能不能加缓存，下午三点前把结论发群里？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"192b84f072ea72e5bfc1e646510978c24cb4fc1275c9fb642895892d1fab1c0a","bucketDomain":"tech_ai","count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d005

<a id="case-d005"></a>

### Case 基础信息

```text
Case ID: d005
Raw Text: 今天的站会先过一下订单中台进度，内存占用高这块需要限流保护，大家看一下风险。
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `1818371cb2a90c789c7b281c3cc36a23715bfc08e3164930fe2034ce6bc0785f`

Bucket: `food_order` (`p0_b0`)

Assembly Sentences:

1.

```text
今天的站会先过一下订单中台进度，内存占用高这块需要限流保护，大家看一下风险。
```

- sentenceId: `p0_b0_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.4

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 今天的站会先过一下订单中台进度，内存占用高这块需要限流保护，大家看一下风险。
pathId: 1818371cb2a90c789c7b281c3cc36a23715bfc08e3164930fe2034ce6bc0785f
bucketDomain: food_order
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 今天的站会先过一下订单中台进度，内存占用高这块需要限流保护，大家看一下风险。
keptFromPath: 1818371cb2a90c789c7b281c3cc36a23715bfc08e3164930fe2034ce6bc0785f
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
今天的站会先过一下订单中台进度，内存占用高这块需要限流保护，大家看一下风险。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"1818371cb2a90c789c7b281c3cc36a23715bfc08e3164930fe2034ce6bc0785f","bucketDomain":"food_order","count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d006

<a id="case-d006"></a>

### Case 基础信息

```text
Case ID: d006
Raw Text: 跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。
Path Count: 1
Bucket Count: 3
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `54a9f07e03af142eb5a06f0dd3e6a30fb09f82b47cd652dc08d575fdfc606551`

Bucket: `food_order` (`p0_b0`)

Assembly Sentences:

1.

```text
跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。
```

- sentenceId: `p0_b0_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

#### Path: `54a9f07e03af142eb5a06f0dd3e6a30fb09f82b47cd652dc08d575fdfc606551`

Bucket: `meeting` (`p0_b1`)

Assembly Sentences:

1.

```text
跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。
```

- sentenceId: `p0_b1_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

#### Path: `54a9f07e03af142eb5a06f0dd3e6a30fb09f82b47cd652dc08d575fdfc606551`

Bucket: `tech_ai` (`p0_b2`)

Assembly Sentences:

1.

```text
跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。
```

- sentenceId: `p0_b2_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 3

1.

```text
text: 跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。
pathId: 54a9f07e03af142eb5a06f0dd3e6a30fb09f82b47cd652dc08d575fdfc606551
bucketDomain: food_order
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。
pathId: 54a9f07e03af142eb5a06f0dd3e6a30fb09f82b47cd652dc08d575fdfc606551
bucketDomain: meeting
sourceSentenceId: p0_b1_s0
```

3.

```text
text: 跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。
pathId: 54a9f07e03af142eb5a06f0dd3e6a30fb09f82b47cd652dc08d575fdfc606551
bucketDomain: tech_ai
sourceSentenceId: p0_b2_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。
keptFromPath: 54a9f07e03af142eb5a06f0dd3e6a30fb09f82b47cd652dc08d575fdfc606551
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

```text
Dropped Text: 跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。
Source Sentence: p0_b1_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。
```

```text
Dropped Text: 跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。
Source Sentence: p0_b2_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。
```

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"54a9f07e03af142eb5a06f0dd3e6a30fb09f82b47cd652dc08d575fdfc606551","bucketDomain":"food_order","count":1},{"pathId":"54a9f07e03af142eb5a06f0dd3e6a30fb09f82b47cd652dc08d575fdfc606551","bucketDomain":"meeting","count":1},{"pathId":"54a9f07e03af142eb5a06f0dd3e6a30fb09f82b47cd652dc08d575fdfc606551","bucketDomain":"tech_ai","count":1}]
crossPathInputCount: 3
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (3 vs 3)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d007

<a id="case-d007"></a>

### Case 基础信息

```text
Case ID: d007
Raw Text: 师傅，去中关村软件园，走机场高速。我赶九点半的会，要是堵车您提前跟我说。
Path Count: 1
Bucket Count: 2
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `ce61e4f57b177b95d39665e0aa77ec09fca042ee22c72a2f8e6f99c0e9df5c87`

Bucket: `tourism_hotel` (`p0_b0`)

Assembly Sentences:

1.

```text
师傅，去中关村软件园，走机场高速。我赶酒店半的会，要是堵车您提前跟我说。
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 4.72

2.

```text
师傅，去中关村软件园，走机场高速。我赶九点半的会，要是堵车您提前跟我说。
```

- sentenceId: `p0_b0_s1`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 2
- assemblyScore: 2.36

#### Path: `ce61e4f57b177b95d39665e0aa77ec09fca042ee22c72a2f8e6f99c0e9df5c87`

Bucket: `tourism_transport` (`p0_b1`)

Assembly Sentences:

1.

```text
师傅，去中关村软件园，走机场高速。我赶九点半的会，要是堵车您提前跟我说。
```

- sentenceId: `p0_b1_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 4.8

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 3

1.

```text
text: 师傅，去中关村软件园，走机场高速。我赶酒店半的会，要是堵车您提前跟我说。
pathId: ce61e4f57b177b95d39665e0aa77ec09fca042ee22c72a2f8e6f99c0e9df5c87
bucketDomain: tourism_hotel
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 师傅，去中关村软件园，走机场高速。我赶九点半的会，要是堵车您提前跟我说。
pathId: ce61e4f57b177b95d39665e0aa77ec09fca042ee22c72a2f8e6f99c0e9df5c87
bucketDomain: tourism_hotel
sourceSentenceId: p0_b0_s1
```

3.

```text
text: 师傅，去中关村软件园，走机场高速。我赶九点半的会，要是堵车您提前跟我说。
pathId: ce61e4f57b177b95d39665e0aa77ec09fca042ee22c72a2f8e6f99c0e9df5c87
bucketDomain: tourism_transport
sourceSentenceId: p0_b1_s0
```

### D. CrossPath Output

Count: 2

1.

```text
text: 师傅，去中关村软件园，走机场高速。我赶酒店半的会，要是堵车您提前跟我说。
keptFromPath: ce61e4f57b177b95d39665e0aa77ec09fca042ee22c72a2f8e6f99c0e9df5c87
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 师傅，去中关村软件园，走机场高速。我赶九点半的会，要是堵车您提前跟我说。
keptFromPath: ce61e4f57b177b95d39665e0aa77ec09fca042ee22c72a2f8e6f99c0e9df5c87
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s1
```

### E. CrossPath 删除项

```text
Dropped Text: 师傅，去中关村软件园，走机场高速。我赶九点半的会，要是堵车您提前跟我说。
Source Sentence: p0_b1_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 师傅，去中关村软件园，走机场高速。我赶九点半的会，要是堵车您提前跟我说。
```

### F. KenLM Input

KenLM Input Count: 2

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
师傅，去中关村软件园，走机场高速。我赶酒店半的会，要是堵车您提前跟我说。
```

2.

```text
师傅，去中关村软件园，走机场高速。我赶九点半的会，要是堵车您提前跟我说。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"ce61e4f57b177b95d39665e0aa77ec09fca042ee22c72a2f8e6f99c0e9df5c87","bucketDomain":"tourism_hotel","count":2},{"pathId":"ce61e4f57b177b95d39665e0aa77ec09fca042ee22c72a2f8e6f99c0e9df5c87","bucketDomain":"tourism_transport","count":1}]
crossPathInputCount: 3
crossPathOutputCount: 2
kenlmInputCount: 2
CrossPath Input == Assembly total: YES (3 vs 3)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d008

<a id="case-d008"></a>

### Case 基础信息

```text
Case ID: d008
Raw Text: 麻烦送我到国贸三期南门，大概多久能到？我十点十分有个电话会。
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `5e9009eef0d21f74596c5a09a2e424e9bd26bcd10a32e19a58a4e393c518fd80`

Bucket: `null` (`p0_b0`)

Assembly Sentences:

1.

```text
麻烦送我到国贸三期南门，大概多久能到？我十点十分有个电话会。
```

- sentenceId: `p0_b0_s0`
- category: `RAW_ORIGINAL`
- assemblyRank: 1
- assemblyScore: 0

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 麻烦送我到国贸三期南门，大概多久能到？我十点十分有个电话会。
pathId: 5e9009eef0d21f74596c5a09a2e424e9bd26bcd10a32e19a58a4e393c518fd80
bucketDomain: null
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 麻烦送我到国贸三期南门，大概多久能到？我十点十分有个电话会。
keptFromPath: 5e9009eef0d21f74596c5a09a2e424e9bd26bcd10a32e19a58a4e393c518fd80
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
麻烦送我到国贸三期南门，大概多久能到？我十点十分有个电话会。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"5e9009eef0d21f74596c5a09a2e424e9bd26bcd10a32e19a58a4e393c518fd80","bucketDomain":null,"count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d009

<a id="case-d009"></a>

### Case 基础信息

```text
Case ID: d009
Raw Text: 去望京SOHO，不走四环可以吗？那边现在堵不堵？
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `1ff853294abaa92522bd1f74e24e1523522571dd575d20d3cc71abe29649a5ef`

Bucket: `medical` (`p0_b0`)

Assembly Sentences:

1.

```text
去望京SOHO，不走四环科医吗？那边现在堵不堵？
```

- sentenceId: `p0_b0_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

2.

```text
去望京SOHO，不走四环可以吗？那边现在堵不堵？
```

- sentenceId: `p0_b0_s1`
- category: `RAW_ORIGINAL`
- assemblyRank: 2
- assemblyScore: 0

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 2

1.

```text
text: 去望京SOHO，不走四环科医吗？那边现在堵不堵？
pathId: 1ff853294abaa92522bd1f74e24e1523522571dd575d20d3cc71abe29649a5ef
bucketDomain: medical
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 去望京SOHO，不走四环可以吗？那边现在堵不堵？
pathId: 1ff853294abaa92522bd1f74e24e1523522571dd575d20d3cc71abe29649a5ef
bucketDomain: medical
sourceSentenceId: p0_b0_s1
```

### D. CrossPath Output

Count: 2

1.

```text
text: 去望京SOHO，不走四环科医吗？那边现在堵不堵？
keptFromPath: 1ff853294abaa92522bd1f74e24e1523522571dd575d20d3cc71abe29649a5ef
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 去望京SOHO，不走四环可以吗？那边现在堵不堵？
keptFromPath: 1ff853294abaa92522bd1f74e24e1523522571dd575d20d3cc71abe29649a5ef
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s1
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 2

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
去望京SOHO，不走四环科医吗？那边现在堵不堵？
```

2.

```text
去望京SOHO，不走四环可以吗？那边现在堵不堵？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"1ff853294abaa92522bd1f74e24e1523522571dd575d20d3cc71abe29649a5ef","bucketDomain":"medical","count":2}]
crossPathInputCount: 2
crossPathOutputCount: 2
kenlmInputCount: 2
CrossPath Input == Assembly total: YES (2 vs 2)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d010

<a id="case-d010"></a>

### Case 基础信息

```text
Case ID: d010
Raw Text: 医生您好，我这两天头痛，想开点药并做个血常规。
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `ee5e0704d1330d3bb9f608b6494272a9fc1dc65bbb9bac1f982062dbf1d15534`

Bucket: `medical` (`p0_b0`)

Assembly Sentences:

1.

```text
医生您好，我这两天头痛，想开点药并做个血常规。
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 4.71

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 医生您好，我这两天头痛，想开点药并做个血常规。
pathId: ee5e0704d1330d3bb9f608b6494272a9fc1dc65bbb9bac1f982062dbf1d15534
bucketDomain: medical
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 医生您好，我这两天头痛，想开点药并做个血常规。
keptFromPath: ee5e0704d1330d3bb9f608b6494272a9fc1dc65bbb9bac1f982062dbf1d15534
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
医生您好，我这两天头痛，想开点药并做个血常规。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"ee5e0704d1330d3bb9f608b6494272a9fc1dc65bbb9bac1f982062dbf1d15534","bucketDomain":"medical","count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d011

<a id="case-d011"></a>

### Case 基础信息

```text
Case ID: d011
Raw Text: 挂号处请问内科还有号吗？我胃不舒服，昨晚开始的。
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `149552ff4805e58b3b09f4417f9d2d26276516ca341bc6c2b9ceba03938dda37`

Bucket: `medical` (`p0_b0`)

Assembly Sentences:

1.

```text
挂号处请问内科还有号吗？我胃不舒服，昨晚开始的。
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 4.71

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 挂号处请问内科还有号吗？我胃不舒服，昨晚开始的。
pathId: 149552ff4805e58b3b09f4417f9d2d26276516ca341bc6c2b9ceba03938dda37
bucketDomain: medical
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 挂号处请问内科还有号吗？我胃不舒服，昨晚开始的。
keptFromPath: 149552ff4805e58b3b09f4417f9d2d26276516ca341bc6c2b9ceba03938dda37
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
挂号处请问内科还有号吗？我胃不舒服，昨晚开始的。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"149552ff4805e58b3b09f4417f9d2d26276516ca341bc6c2b9ceba03938dda37","bucketDomain":"medical","count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d012

<a id="case-d012"></a>

### Case 基础信息

```text
Case ID: d012
Raw Text: 这个检查报告什么时候能出？我过敏发痒，需要请假休息吗？
Path Count: 1
Bucket Count: 3
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `fa8f5c186469a544f504e2b1180e1f88870a9ded26eff5007a876fd7ef34e55d`

Bucket: `coffee` (`p0_b0`)

Assembly Sentences:

1.

```text
这个检查报告什么时候能出？我过敏发痒，需要请假休息吗？
```

- sentenceId: `p0_b0_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

#### Path: `fa8f5c186469a544f504e2b1180e1f88870a9ded26eff5007a876fd7ef34e55d`

Bucket: `food_order` (`p0_b1`)

Assembly Sentences:

1.

```text
这个检查报告什么时候能出？我过敏发痒，需要请假休息吗？
```

- sentenceId: `p0_b1_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.4

#### Path: `fa8f5c186469a544f504e2b1180e1f88870a9ded26eff5007a876fd7ef34e55d`

Bucket: `tech_ai` (`p0_b2`)

Assembly Sentences:

1.

```text
这个检查报告什么时候能出？我过敏发痒，需要请假休息吗？
```

- sentenceId: `p0_b2_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 3

1.

```text
text: 这个检查报告什么时候能出？我过敏发痒，需要请假休息吗？
pathId: fa8f5c186469a544f504e2b1180e1f88870a9ded26eff5007a876fd7ef34e55d
bucketDomain: coffee
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 这个检查报告什么时候能出？我过敏发痒，需要请假休息吗？
pathId: fa8f5c186469a544f504e2b1180e1f88870a9ded26eff5007a876fd7ef34e55d
bucketDomain: food_order
sourceSentenceId: p0_b1_s0
```

3.

```text
text: 这个检查报告什么时候能出？我过敏发痒，需要请假休息吗？
pathId: fa8f5c186469a544f504e2b1180e1f88870a9ded26eff5007a876fd7ef34e55d
bucketDomain: tech_ai
sourceSentenceId: p0_b2_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 这个检查报告什么时候能出？我过敏发痒，需要请假休息吗？
keptFromPath: fa8f5c186469a544f504e2b1180e1f88870a9ded26eff5007a876fd7ef34e55d
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

```text
Dropped Text: 这个检查报告什么时候能出？我过敏发痒，需要请假休息吗？
Source Sentence: p0_b1_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 这个检查报告什么时候能出？我过敏发痒，需要请假休息吗？
```

```text
Dropped Text: 这个检查报告什么时候能出？我过敏发痒，需要请假休息吗？
Source Sentence: p0_b2_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 这个检查报告什么时候能出？我过敏发痒，需要请假休息吗？
```

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
这个检查报告什么时候能出？我过敏发痒，需要请假休息吗？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"fa8f5c186469a544f504e2b1180e1f88870a9ded26eff5007a876fd7ef34e55d","bucketDomain":"coffee","count":1},{"pathId":"fa8f5c186469a544f504e2b1180e1f88870a9ded26eff5007a876fd7ef34e55d","bucketDomain":"food_order","count":1},{"pathId":"fa8f5c186469a544f504e2b1180e1f88870a9ded26eff5007a876fd7ef34e55d","bucketDomain":"tech_ai","count":1}]
crossPathInputCount: 3
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (3 vs 3)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d013

<a id="case-d013"></a>

### Case 基础信息

```text
Case ID: d013
Raw Text: 这件外套能试穿吗？我穿中码。买两件有没有折扣？
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `bf0502a46c3d5c83e4576c1730ccf54b973d21032960d5f734d5d84962bf783f`

Bucket: `tech_ai` (`p0_b0`)

Assembly Sentences:

1.

```text
这件外套能试穿吗？我穿中码。买量检有没有折扣？
```

- sentenceId: `p0_b0_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

2.

```text
这件外套能试穿吗？我穿中码。买两件有没有折扣？
```

- sentenceId: `p0_b0_s1`
- category: `RAW_ORIGINAL`
- assemblyRank: 2
- assemblyScore: 0

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 2

1.

```text
text: 这件外套能试穿吗？我穿中码。买量检有没有折扣？
pathId: bf0502a46c3d5c83e4576c1730ccf54b973d21032960d5f734d5d84962bf783f
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 这件外套能试穿吗？我穿中码。买两件有没有折扣？
pathId: bf0502a46c3d5c83e4576c1730ccf54b973d21032960d5f734d5d84962bf783f
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s1
```

### D. CrossPath Output

Count: 2

1.

```text
text: 这件外套能试穿吗？我穿中码。买量检有没有折扣？
keptFromPath: bf0502a46c3d5c83e4576c1730ccf54b973d21032960d5f734d5d84962bf783f
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 这件外套能试穿吗？我穿中码。买两件有没有折扣？
keptFromPath: bf0502a46c3d5c83e4576c1730ccf54b973d21032960d5f734d5d84962bf783f
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s1
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 2

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
这件外套能试穿吗？我穿中码。买量检有没有折扣？
```

2.

```text
这件外套能试穿吗？我穿中码。买两件有没有折扣？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"bf0502a46c3d5c83e4576c1730ccf54b973d21032960d5f734d5d84962bf783f","bucketDomain":"tech_ai","count":2}]
crossPathInputCount: 2
crossPathOutputCount: 2
kenlmInputCount: 2
CrossPath Input == Assembly total: YES (2 vs 2)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d014

<a id="case-d014"></a>

### Case 基础信息

```text
Case ID: d014
Raw Text: 请问这双鞋有四十码吗？不合适三天内可以退换吧？
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `273cfbaf61f2e19636f9a795cf32d7cfe4b6575d1affcccfa8a8ee4e6eb56721`

Bucket: `medical` (`p0_b0`)

Assembly Sentences:

1.

```text
请问这双鞋有四十码吗？不合适三天内科医退换吧？
```

- sentenceId: `p0_b0_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

2.

```text
请问这双鞋有四十码吗？不合适三天内可以退换吧？
```

- sentenceId: `p0_b0_s1`
- category: `RAW_ORIGINAL`
- assemblyRank: 2
- assemblyScore: 0

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 2

1.

```text
text: 请问这双鞋有四十码吗？不合适三天内科医退换吧？
pathId: 273cfbaf61f2e19636f9a795cf32d7cfe4b6575d1affcccfa8a8ee4e6eb56721
bucketDomain: medical
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 请问这双鞋有四十码吗？不合适三天内可以退换吧？
pathId: 273cfbaf61f2e19636f9a795cf32d7cfe4b6575d1affcccfa8a8ee4e6eb56721
bucketDomain: medical
sourceSentenceId: p0_b0_s1
```

### D. CrossPath Output

Count: 2

1.

```text
text: 请问这双鞋有四十码吗？不合适三天内科医退换吧？
keptFromPath: 273cfbaf61f2e19636f9a795cf32d7cfe4b6575d1affcccfa8a8ee4e6eb56721
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 请问这双鞋有四十码吗？不合适三天内可以退换吧？
keptFromPath: 273cfbaf61f2e19636f9a795cf32d7cfe4b6575d1affcccfa8a8ee4e6eb56721
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s1
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 2

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
请问这双鞋有四十码吗？不合适三天内科医退换吧？
```

2.

```text
请问这双鞋有四十码吗？不合适三天内可以退换吧？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"273cfbaf61f2e19636f9a795cf32d7cfe4b6575d1affcccfa8a8ee4e6eb56721","bucketDomain":"medical","count":2}]
crossPathInputCount: 2
crossPathOutputCount: 2
kenlmInputCount: 2
CrossPath Input == Assembly total: YES (2 vs 2)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d015

<a id="case-d015"></a>

### Case 基础信息

```text
Case ID: d015
Raw Text: 我想对比一下这两款订单中台的价格，会员日能再减一点吗？
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `72d46d6d27ed168a2b446ccc0ef5ca29e9e538e6e0e94d9ab712448785bc00fc`

Bucket: `food_order` (`p0_b0`)

Assembly Sentences:

1.

```text
我想对比一下这两款订单中台的价格，会员日能再减一点吗？
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 4.76

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 我想对比一下这两款订单中台的价格，会员日能再减一点吗？
pathId: 72d46d6d27ed168a2b446ccc0ef5ca29e9e538e6e0e94d9ab712448785bc00fc
bucketDomain: food_order
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 我想对比一下这两款订单中台的价格，会员日能再减一点吗？
keptFromPath: 72d46d6d27ed168a2b446ccc0ef5ca29e9e538e6e0e94d9ab712448785bc00fc
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
我想对比一下这两款订单中台的价格，会员日能再减一点吗？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"72d46d6d27ed168a2b446ccc0ef5ca29e9e538e6e0e94d9ab712448785bc00fc","bucketDomain":"food_order","count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d016

<a id="case-d016"></a>

### Case 基础信息

```text
Case ID: d016
Raw Text: 周末要不要去江边骑行？天气预报说周日多云，记得带水。
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `ef362a7409d257efe1af2da13a738a0d169e7c13cebf78fc693f2e600087c365`

Bucket: `null` (`p0_b0`)

Assembly Sentences:

1.

```text
周末要不要去江边骑行？天气预报说周日多云，记得带水。
```

- sentenceId: `p0_b0_s0`
- category: `RAW_ORIGINAL`
- assemblyRank: 1
- assemblyScore: 0

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 周末要不要去江边骑行？天气预报说周日多云，记得带水。
pathId: ef362a7409d257efe1af2da13a738a0d169e7c13cebf78fc693f2e600087c365
bucketDomain: null
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 周末要不要去江边骑行？天气预报说周日多云，记得带水。
keptFromPath: ef362a7409d257efe1af2da13a738a0d169e7c13cebf78fc693f2e600087c365
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
周末要不要去江边骑行？天气预报说周日多云，记得带水。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"ef362a7409d257efe1af2da13a738a0d169e7c13cebf78fc693f2e600087c365","bucketDomain":null,"count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d017

<a id="case-d017"></a>

### Case 基础信息

```text
Case ID: d017
Raw Text: 晚上一起吃饭吗？我知道一家川菜不错，大概七点到。
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `37367286bf78ef457c58421ac1cc51772b81498372ff6046875c912bacb0a3ca`

Bucket: `null` (`p0_b0`)

Assembly Sentences:

1.

```text
晚上一起吃饭吗？我知道一家川菜不错，大概七点到。
```

- sentenceId: `p0_b0_s0`
- category: `RAW_ORIGINAL`
- assemblyRank: 1
- assemblyScore: 0

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 晚上一起吃饭吗？我知道一家川菜不错，大概七点到。
pathId: 37367286bf78ef457c58421ac1cc51772b81498372ff6046875c912bacb0a3ca
bucketDomain: null
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 晚上一起吃饭吗？我知道一家川菜不错，大概七点到。
keptFromPath: 37367286bf78ef457c58421ac1cc51772b81498372ff6046875c912bacb0a3ca
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
晚上一起吃饭吗？我知道一家川菜不错，大概七点到。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"37367286bf78ef457c58421ac1cc51772b81498372ff6046875c912bacb0a3ca","bucketDomain":null,"count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d018

<a id="case-d018"></a>

### Case 基础信息

```text
Case ID: d018
Raw Text: 你最近忙不忙？想找你看下手机备份怎么设置。
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `8abbc76111de7c632d7d17362fe9a7cda58f3c9572ab70bc308648553237b238`

Bucket: `null` (`p0_b0`)

Assembly Sentences:

1.

```text
你最近忙不忙？想找你看下手机备份怎么设置。
```

- sentenceId: `p0_b0_s0`
- category: `RAW_ORIGINAL`
- assemblyRank: 1
- assemblyScore: 0

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 你最近忙不忙？想找你看下手机备份怎么设置。
pathId: 8abbc76111de7c632d7d17362fe9a7cda58f3c9572ab70bc308648553237b238
bucketDomain: null
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 你最近忙不忙？想找你看下手机备份怎么设置。
keptFromPath: 8abbc76111de7c632d7d17362fe9a7cda58f3c9572ab70bc308648553237b238
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
你最近忙不忙？想找你看下手机备份怎么设置。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"8abbc76111de7c632d7d17362fe9a7cda58f3c9572ab70bc308648553237b238","bucketDomain":null,"count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d019

<a id="case-d019"></a>

### Case 基础信息

```text
Case ID: d019
Raw Text: 今天我们团队要讨论后选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
Path Count: 2
Bucket Count: 2
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8`

Bucket: `tech_ai` (`p0_b0`)

Assembly Sentences:

1.

```text
今天我们团队要讨论候选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 12.02

2.

```text
今天我们团队要讨论候选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
```

- sentenceId: `p0_b0_s1`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 2
- assemblyScore: 9.62

3.

```text
今天我们团队要讨论后选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
```

- sentenceId: `p0_b0_s2`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 3
- assemblyScore: 9.6

4.

```text
今天我们团队要讨论候选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
```

- sentenceId: `p0_b0_s3`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 4
- assemblyScore: 9.6

5.

```text
今天我们团队要讨论后选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
```

- sentenceId: `p0_b0_s4`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 5
- assemblyScore: 7.199999999999999

6.

```text
今天我们团队要讨论候选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
```

- sentenceId: `p0_b0_s5`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 6
- assemblyScore: 7.199999999999999

7.

```text
今天我们团队要讨论后选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
```

- sentenceId: `p0_b0_s6`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 7
- assemblyScore: 7.18

8.

```text
今天我们团队要讨论后选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
```

- sentenceId: `p0_b0_s7`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 8
- assemblyScore: 4.779999999999999

#### Path: `982f3f240464b76e9444a459acaf33ee860bc86f3827f03a9ecc863f3bb62ddb`

Bucket: `tech_ai` (`p1_b0`)

Assembly Sentences:

1.

```text
今天我们团队要讨论候选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
```

- sentenceId: `p1_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 9.239999999999998

2.

```text
今天我们团队要讨论候选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
```

- sentenceId: `p1_b0_s1`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 2
- assemblyScore: 7.199999999999999

3.

```text
今天我们团队要讨论后选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
```

- sentenceId: `p1_b0_s2`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 3
- assemblyScore: 6.819999999999999

4.

```text
今天我们团队要讨论候选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
```

- sentenceId: `p1_b0_s3`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 4
- assemblyScore: 6.819999999999999

5.

```text
今天我们团队要讨论后选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
```

- sentenceId: `p1_b0_s4`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 5
- assemblyScore: 4.779999999999999

6.

```text
今天我们团队要讨论候选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
```

- sentenceId: `p1_b0_s5`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 6
- assemblyScore: 4.779999999999999

7.

```text
今天我们团队要讨论后选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
```

- sentenceId: `p1_b0_s6`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 7
- assemblyScore: 4.4

8.

```text
今天我们团队要讨论后选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
```

- sentenceId: `p1_b0_s7`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 8
- assemblyScore: 2.36

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 16

1.

```text
text: 今天我们团队要讨论候选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
pathId: e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 今天我们团队要讨论候选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
pathId: e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s1
```

3.

```text
text: 今天我们团队要讨论后选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
pathId: e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s2
```

4.

```text
text: 今天我们团队要讨论候选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
pathId: e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s3
```

5.

```text
text: 今天我们团队要讨论后选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
pathId: e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s4
```

6.

```text
text: 今天我们团队要讨论候选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
pathId: e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s5
```

7.

```text
text: 今天我们团队要讨论后选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
pathId: e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s6
```

8.

```text
text: 今天我们团队要讨论后选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
pathId: e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s7
```

9.

```text
text: 今天我们团队要讨论候选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
pathId: 982f3f240464b76e9444a459acaf33ee860bc86f3827f03a9ecc863f3bb62ddb
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s0
```

10.

```text
text: 今天我们团队要讨论候选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
pathId: 982f3f240464b76e9444a459acaf33ee860bc86f3827f03a9ecc863f3bb62ddb
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s1
```

11.

```text
text: 今天我们团队要讨论后选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
pathId: 982f3f240464b76e9444a459acaf33ee860bc86f3827f03a9ecc863f3bb62ddb
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s2
```

12.

```text
text: 今天我们团队要讨论候选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
pathId: 982f3f240464b76e9444a459acaf33ee860bc86f3827f03a9ecc863f3bb62ddb
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s3
```

13.

```text
text: 今天我们团队要讨论后选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
pathId: 982f3f240464b76e9444a459acaf33ee860bc86f3827f03a9ecc863f3bb62ddb
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s4
```

14.

```text
text: 今天我们团队要讨论候选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
pathId: 982f3f240464b76e9444a459acaf33ee860bc86f3827f03a9ecc863f3bb62ddb
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s5
```

15.

```text
text: 今天我们团队要讨论后选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
pathId: 982f3f240464b76e9444a459acaf33ee860bc86f3827f03a9ecc863f3bb62ddb
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s6
```

16.

```text
text: 今天我们团队要讨论后选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
pathId: 982f3f240464b76e9444a459acaf33ee860bc86f3827f03a9ecc863f3bb62ddb
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s7
```

### D. CrossPath Output

Count: 8

1.

```text
text: 今天我们团队要讨论候选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
keptFromPath: e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 今天我们团队要讨论候选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
keptFromPath: e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s1
```

3.

```text
text: 今天我们团队要讨论后选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
keptFromPath: e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s2
```

4.

```text
text: 今天我们团队要讨论候选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
keptFromPath: e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s3
```

5.

```text
text: 今天我们团队要讨论后选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
keptFromPath: e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s4
```

6.

```text
text: 今天我们团队要讨论候选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
keptFromPath: e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s5
```

7.

```text
text: 今天我们团队要讨论后选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
keptFromPath: e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s6
```

8.

```text
text: 今天我们团队要讨论后选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
keptFromPath: e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s7
```

### E. CrossPath 删除项

```text
Dropped Text: 今天我们团队要讨论候选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
Source Sentence: p1_b0_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 今天我们团队要讨论候选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
```

```text
Dropped Text: 今天我们团队要讨论候选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
Source Sentence: p1_b0_s1
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 今天我们团队要讨论候选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
```

```text
Dropped Text: 今天我们团队要讨论后选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
Source Sentence: p1_b0_s2
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 今天我们团队要讨论后选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
```

```text
Dropped Text: 今天我们团队要讨论候选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
Source Sentence: p1_b0_s3
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 今天我们团队要讨论候选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
```

```text
Dropped Text: 今天我们团队要讨论后选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
Source Sentence: p1_b0_s4
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 今天我们团队要讨论后选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
```

```text
Dropped Text: 今天我们团队要讨论候选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
Source Sentence: p1_b0_s5
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 今天我们团队要讨论候选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
```

```text
Dropped Text: 今天我们团队要讨论后选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
Source Sentence: p1_b0_s6
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 今天我们团队要讨论后选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
```

```text
Dropped Text: 今天我们团队要讨论后选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
Source Sentence: p1_b0_s7
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 今天我们团队要讨论后选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
```

### F. KenLM Input

KenLM Input Count: 8

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
今天我们团队要讨论候选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
```

2.

```text
今天我们团队要讨论候选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
```

3.

```text
今天我们团队要讨论后选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
```

4.

```text
今天我们团队要讨论候选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
```

5.

```text
今天我们团队要讨论后选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
```

6.

```text
今天我们团队要讨论候选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
```

7.

```text
今天我们团队要讨论后选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
```

8.

```text
今天我们团队要讨论后选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8","bucketDomain":"tech_ai","count":8},{"pathId":"982f3f240464b76e9444a459acaf33ee860bc86f3827f03a9ecc863f3bb62ddb","bucketDomain":"tech_ai","count":8}]
crossPathInputCount: 16
crossPathOutputCount: 8
kenlmInputCount: 8
CrossPath Input == Assembly total: YES (16 vs 16)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d020

<a id="case-d020"></a>

### Case 基础信息

```text
Case ID: d020
Raw Text: 这次发布我们先对齐上线计划窗口，后选生城模块需要联调，别漏掉回归。
Path Count: 2
Bucket Count: 2
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `d18e38f8936e3dae9107ea8e2acaf78da3b2472127b9644ea2be67380e9844d7`

Bucket: `tech_ai` (`p0_b0`)

Assembly Sentences:

1.

```text
这次发布我们先对齐上线计划窗口，候选生城模块需要联调，别漏掉回归。
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 14.4

2.

```text
这次发布我们先对齐上线计划窗口，后选生城模块需要联调，别漏掉回归。
```

- sentenceId: `p0_b0_s1`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 2
- assemblyScore: 11.98

#### Path: `d0727a8e1c03785b04ed2877ce853d0488af5bbfebedbe740226ff2cb15c2120`

Bucket: `tech_ai` (`p1_b0`)

Assembly Sentences:

1.

```text
这次发布我们先对齐上线计划窗口，候选生城模块需要联调，别漏掉回归。
```

- sentenceId: `p1_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 11.620000000000001

2.

```text
这次发布我们先对齐上线计划窗口，后选生城模块需要联调，别漏掉回归。
```

- sentenceId: `p1_b0_s1`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 2
- assemblyScore: 9.200000000000001

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 4

1.

```text
text: 这次发布我们先对齐上线计划窗口，候选生城模块需要联调，别漏掉回归。
pathId: d18e38f8936e3dae9107ea8e2acaf78da3b2472127b9644ea2be67380e9844d7
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 这次发布我们先对齐上线计划窗口，后选生城模块需要联调，别漏掉回归。
pathId: d18e38f8936e3dae9107ea8e2acaf78da3b2472127b9644ea2be67380e9844d7
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s1
```

3.

```text
text: 这次发布我们先对齐上线计划窗口，候选生城模块需要联调，别漏掉回归。
pathId: d0727a8e1c03785b04ed2877ce853d0488af5bbfebedbe740226ff2cb15c2120
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s0
```

4.

```text
text: 这次发布我们先对齐上线计划窗口，后选生城模块需要联调，别漏掉回归。
pathId: d0727a8e1c03785b04ed2877ce853d0488af5bbfebedbe740226ff2cb15c2120
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s1
```

### D. CrossPath Output

Count: 2

1.

```text
text: 这次发布我们先对齐上线计划窗口，候选生城模块需要联调，别漏掉回归。
keptFromPath: d18e38f8936e3dae9107ea8e2acaf78da3b2472127b9644ea2be67380e9844d7
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 这次发布我们先对齐上线计划窗口，后选生城模块需要联调，别漏掉回归。
keptFromPath: d18e38f8936e3dae9107ea8e2acaf78da3b2472127b9644ea2be67380e9844d7
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s1
```

### E. CrossPath 删除项

```text
Dropped Text: 这次发布我们先对齐上线计划窗口，候选生城模块需要联调，别漏掉回归。
Source Sentence: p1_b0_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 这次发布我们先对齐上线计划窗口，候选生城模块需要联调，别漏掉回归。
```

```text
Dropped Text: 这次发布我们先对齐上线计划窗口，后选生城模块需要联调，别漏掉回归。
Source Sentence: p1_b0_s1
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 这次发布我们先对齐上线计划窗口，后选生城模块需要联调，别漏掉回归。
```

### F. KenLM Input

KenLM Input Count: 2

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
这次发布我们先对齐上线计划窗口，候选生城模块需要联调，别漏掉回归。
```

2.

```text
这次发布我们先对齐上线计划窗口，后选生城模块需要联调，别漏掉回归。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"d18e38f8936e3dae9107ea8e2acaf78da3b2472127b9644ea2be67380e9844d7","bucketDomain":"tech_ai","count":2},{"pathId":"d0727a8e1c03785b04ed2877ce853d0488af5bbfebedbe740226ff2cb15c2120","bucketDomain":"tech_ai","count":2}]
crossPathInputCount: 4
crossPathOutputCount: 2
kenlmInputCount: 2
CrossPath Input == Assembly total: YES (4 vs 4)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d021

<a id="case-d021"></a>

### Case 基础信息

```text
Case ID: d021
Raw Text: 会上提到候选生成链路要加监控，上线计划文档我下午更新一版。
Path Count: 2
Bucket Count: 2
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `a4c0876153861a0089493877032bd3ee43b5520178506c0cdfc830637f46a8ea`

Bucket: `tech_ai` (`p0_b0`)

Assembly Sentences:

1.

```text
会上提到候选生成链路要加监控，上线计划文档我下午更新一版。
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 12

#### Path: `53fa80de77688323aeb8193f42739986f77dbdf76c39a3718b63b712cb31c9ed`

Bucket: `tech_ai` (`p1_b0`)

Assembly Sentences:

1.

```text
会上提到候选生成链路要加监控，上线计划文档我下午更新一版。
```

- sentenceId: `p1_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 9.219999999999999

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 2

1.

```text
text: 会上提到候选生成链路要加监控，上线计划文档我下午更新一版。
pathId: a4c0876153861a0089493877032bd3ee43b5520178506c0cdfc830637f46a8ea
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 会上提到候选生成链路要加监控，上线计划文档我下午更新一版。
pathId: 53fa80de77688323aeb8193f42739986f77dbdf76c39a3718b63b712cb31c9ed
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 会上提到候选生成链路要加监控，上线计划文档我下午更新一版。
keptFromPath: a4c0876153861a0089493877032bd3ee43b5520178506c0cdfc830637f46a8ea
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

```text
Dropped Text: 会上提到候选生成链路要加监控，上线计划文档我下午更新一版。
Source Sentence: p1_b0_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 会上提到候选生成链路要加监控，上线计划文档我下午更新一版。
```

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
会上提到候选生成链路要加监控，上线计划文档我下午更新一版。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"a4c0876153861a0089493877032bd3ee43b5520178506c0cdfc830637f46a8ea","bucketDomain":"tech_ai","count":1},{"pathId":"53fa80de77688323aeb8193f42739986f77dbdf76c39a3718b63b712cb31c9ed","bucketDomain":"tech_ai","count":1}]
crossPathInputCount: 2
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (2 vs 2)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d022

<a id="case-d022"></a>

### Case 基础信息

```text
Case ID: d022
Raw Text: 您好，我订单显示已发货但物流三天没更新，能帮我查一下吗？
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `a0969349bce8ca48e5d13d7fac132d601e3919ee4e38c73a4763efa2a626b088`

Bucket: `food_order` (`p0_b0`)

Assembly Sentences:

1.

```text
您好，我订单显示已发货但物流三天没更新，能帮我查一下吗？
```

- sentenceId: `p0_b0_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.4

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 您好，我订单显示已发货但物流三天没更新，能帮我查一下吗？
pathId: a0969349bce8ca48e5d13d7fac132d601e3919ee4e38c73a4763efa2a626b088
bucketDomain: food_order
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 您好，我订单显示已发货但物流三天没更新，能帮我查一下吗？
keptFromPath: a0969349bce8ca48e5d13d7fac132d601e3919ee4e38c73a4763efa2a626b088
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
您好，我订单显示已发货但物流三天没更新，能帮我查一下吗？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"a0969349bce8ca48e5d13d7fac132d601e3919ee4e38c73a4763efa2a626b088","bucketDomain":"food_order","count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d023

<a id="case-d023"></a>

### Case 基础信息

```text
Case ID: d023
Raw Text: 想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。
Path Count: 1
Bucket Count: 4
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `3827924af8b5fc1e5dcc9c033f608a7c7a11790e401302ab152418017fcb5359`

Bucket: `coffee` (`p0_b0`)

Assembly Sentences:

1.

```text
想改一下收货低脂，还来得及吗？麻烦尽快处理，谢谢。
```

- sentenceId: `p0_b0_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

2.

```text
想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。
```

- sentenceId: `p0_b0_s1`
- category: `RAW_ORIGINAL`
- assemblyRank: 2
- assemblyScore: 0

#### Path: `3827924af8b5fc1e5dcc9c033f608a7c7a11790e401302ab152418017fcb5359`

Bucket: `food_order` (`p0_b1`)

Assembly Sentences:

1.

```text
想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。
```

- sentenceId: `p0_b1_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

#### Path: `3827924af8b5fc1e5dcc9c033f608a7c7a11790e401302ab152418017fcb5359`

Bucket: `milk_tea` (`p0_b2`)

Assembly Sentences:

1.

```text
想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。
```

- sentenceId: `p0_b2_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

#### Path: `3827924af8b5fc1e5dcc9c033f608a7c7a11790e401302ab152418017fcb5359`

Bucket: `tourism_route` (`p0_b3`)

Assembly Sentences:

1.

```text
想改一下收货地质，还来得及吗？麻烦尽快处理，谢谢。
```

- sentenceId: `p0_b3_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

2.

```text
想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。
```

- sentenceId: `p0_b3_s1`
- category: `RAW_ORIGINAL`
- assemblyRank: 2
- assemblyScore: 0

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 6

1.

```text
text: 想改一下收货低脂，还来得及吗？麻烦尽快处理，谢谢。
pathId: 3827924af8b5fc1e5dcc9c033f608a7c7a11790e401302ab152418017fcb5359
bucketDomain: coffee
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。
pathId: 3827924af8b5fc1e5dcc9c033f608a7c7a11790e401302ab152418017fcb5359
bucketDomain: coffee
sourceSentenceId: p0_b0_s1
```

3.

```text
text: 想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。
pathId: 3827924af8b5fc1e5dcc9c033f608a7c7a11790e401302ab152418017fcb5359
bucketDomain: food_order
sourceSentenceId: p0_b1_s0
```

4.

```text
text: 想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。
pathId: 3827924af8b5fc1e5dcc9c033f608a7c7a11790e401302ab152418017fcb5359
bucketDomain: milk_tea
sourceSentenceId: p0_b2_s0
```

5.

```text
text: 想改一下收货地质，还来得及吗？麻烦尽快处理，谢谢。
pathId: 3827924af8b5fc1e5dcc9c033f608a7c7a11790e401302ab152418017fcb5359
bucketDomain: tourism_route
sourceSentenceId: p0_b3_s0
```

6.

```text
text: 想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。
pathId: 3827924af8b5fc1e5dcc9c033f608a7c7a11790e401302ab152418017fcb5359
bucketDomain: tourism_route
sourceSentenceId: p0_b3_s1
```

### D. CrossPath Output

Count: 3

1.

```text
text: 想改一下收货低脂，还来得及吗？麻烦尽快处理，谢谢。
keptFromPath: 3827924af8b5fc1e5dcc9c033f608a7c7a11790e401302ab152418017fcb5359
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。
keptFromPath: 3827924af8b5fc1e5dcc9c033f608a7c7a11790e401302ab152418017fcb5359
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s1
```

3.

```text
text: 想改一下收货地质，还来得及吗？麻烦尽快处理，谢谢。
keptFromPath: 3827924af8b5fc1e5dcc9c033f608a7c7a11790e401302ab152418017fcb5359
keptFromBucket: p0_b3
sourceSentenceId: p0_b3_s0
```

### E. CrossPath 删除项

```text
Dropped Text: 想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。
Source Sentence: p0_b1_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。
```

```text
Dropped Text: 想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。
Source Sentence: p0_b2_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。
```

```text
Dropped Text: 想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。
Source Sentence: p0_b3_s1
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。
```

### F. KenLM Input

KenLM Input Count: 3

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
想改一下收货低脂，还来得及吗？麻烦尽快处理，谢谢。
```

2.

```text
想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。
```

3.

```text
想改一下收货地质，还来得及吗？麻烦尽快处理，谢谢。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"3827924af8b5fc1e5dcc9c033f608a7c7a11790e401302ab152418017fcb5359","bucketDomain":"coffee","count":2},{"pathId":"3827924af8b5fc1e5dcc9c033f608a7c7a11790e401302ab152418017fcb5359","bucketDomain":"food_order","count":1},{"pathId":"3827924af8b5fc1e5dcc9c033f608a7c7a11790e401302ab152418017fcb5359","bucketDomain":"milk_tea","count":1},{"pathId":"3827924af8b5fc1e5dcc9c033f608a7c7a11790e401302ab152418017fcb5359","bucketDomain":"tourism_route","count":2}]
crossPathInputCount: 6
crossPathOutputCount: 3
kenlmInputCount: 3
CrossPath Input == Assembly total: YES (6 vs 6)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d024

<a id="case-d024"></a>

### Case 基础信息

```text
Case ID: d024
Raw Text: 发票抬头开错了，能重新开具电子发票吗？
Path Count: 1
Bucket Count: 2
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `b40add9c18b994f3214720b91c9e39c1ec9a08acd66742f9b51723c5d1d357f6`

Bucket: `food_order` (`p0_b0`)

Assembly Sentences:

1.

```text
发票抬头开错了，能重新开具电子发票吗？
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 4.7

#### Path: `b40add9c18b994f3214720b91c9e39c1ec9a08acd66742f9b51723c5d1d357f6`

Bucket: `tourism_hotel` (`p0_b1`)

Assembly Sentences:

1.

```text
发票抬头开错了，能重新开具电子发票吗？
```

- sentenceId: `p0_b1_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 4.7

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 2

1.

```text
text: 发票抬头开错了，能重新开具电子发票吗？
pathId: b40add9c18b994f3214720b91c9e39c1ec9a08acd66742f9b51723c5d1d357f6
bucketDomain: food_order
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 发票抬头开错了，能重新开具电子发票吗？
pathId: b40add9c18b994f3214720b91c9e39c1ec9a08acd66742f9b51723c5d1d357f6
bucketDomain: tourism_hotel
sourceSentenceId: p0_b1_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 发票抬头开错了，能重新开具电子发票吗？
keptFromPath: b40add9c18b994f3214720b91c9e39c1ec9a08acd66742f9b51723c5d1d357f6
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

```text
Dropped Text: 发票抬头开错了，能重新开具电子发票吗？
Source Sentence: p0_b1_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 发票抬头开错了，能重新开具电子发票吗？
```

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
发票抬头开错了，能重新开具电子发票吗？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"b40add9c18b994f3214720b91c9e39c1ec9a08acd66742f9b51723c5d1d357f6","bucketDomain":"food_order","count":1},{"pathId":"b40add9c18b994f3214720b91c9e39c1ec9a08acd66742f9b51723c5d1d357f6","bucketDomain":"tourism_hotel","count":1}]
crossPathInputCount: 2
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (2 vs 2)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d025

<a id="case-d025"></a>

### Case 基础信息

```text
Case ID: d025
Raw Text: 请简单介绍一下你上一段项目里负责的核心模块和难点。
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `c33b910447acae81d7f3fcaec0bc8df744a479211aa365008054f6f07e77e730`

Bucket: `tech_ai` (`p0_b0`)

Assembly Sentences:

1.

```text
请简单介绍一下你上一段项目理服责的核心模块和难点。
```

- sentenceId: `p0_b0_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.04

2.

```text
请简单介绍一下你上一段项目里负责的核心模块和难点。
```

- sentenceId: `p0_b0_s1`
- category: `RAW_ORIGINAL`
- assemblyRank: 2
- assemblyScore: 0

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 2

1.

```text
text: 请简单介绍一下你上一段项目理服责的核心模块和难点。
pathId: c33b910447acae81d7f3fcaec0bc8df744a479211aa365008054f6f07e77e730
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 请简单介绍一下你上一段项目里负责的核心模块和难点。
pathId: c33b910447acae81d7f3fcaec0bc8df744a479211aa365008054f6f07e77e730
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s1
```

### D. CrossPath Output

Count: 2

1.

```text
text: 请简单介绍一下你上一段项目理服责的核心模块和难点。
keptFromPath: c33b910447acae81d7f3fcaec0bc8df744a479211aa365008054f6f07e77e730
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 请简单介绍一下你上一段项目里负责的核心模块和难点。
keptFromPath: c33b910447acae81d7f3fcaec0bc8df744a479211aa365008054f6f07e77e730
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s1
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 2

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
请简单介绍一下你上一段项目理服责的核心模块和难点。
```

2.

```text
请简单介绍一下你上一段项目里负责的核心模块和难点。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"c33b910447acae81d7f3fcaec0bc8df744a479211aa365008054f6f07e77e730","bucketDomain":"tech_ai","count":2}]
crossPathInputCount: 2
crossPathOutputCount: 2
kenlmInputCount: 2
CrossPath Input == Assembly total: YES (2 vs 2)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d026

<a id="case-d026"></a>

### Case 基础信息

```text
Case ID: d026
Raw Text: 你如何看待跨团队协作？遇到需求变更一般怎么处理？
Path Count: 1
Bucket Count: 2
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `b12f3cf0aef86ec71cf7ca92007b4ed2b271c07b66773e2211895464537dd8e6`

Bucket: `food_order` (`p0_b0`)

Assembly Sentences:

1.

```text
你如何看待跨团队协作？遇到需求变更一般怎么处理？
```

- sentenceId: `p0_b0_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

#### Path: `b12f3cf0aef86ec71cf7ca92007b4ed2b271c07b66773e2211895464537dd8e6`

Bucket: `milk_tea` (`p0_b1`)

Assembly Sentences:

1.

```text
你如何看待跨团队协作？遇到需求变更一般怎么处理？
```

- sentenceId: `p0_b1_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 2

1.

```text
text: 你如何看待跨团队协作？遇到需求变更一般怎么处理？
pathId: b12f3cf0aef86ec71cf7ca92007b4ed2b271c07b66773e2211895464537dd8e6
bucketDomain: food_order
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 你如何看待跨团队协作？遇到需求变更一般怎么处理？
pathId: b12f3cf0aef86ec71cf7ca92007b4ed2b271c07b66773e2211895464537dd8e6
bucketDomain: milk_tea
sourceSentenceId: p0_b1_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 你如何看待跨团队协作？遇到需求变更一般怎么处理？
keptFromPath: b12f3cf0aef86ec71cf7ca92007b4ed2b271c07b66773e2211895464537dd8e6
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

```text
Dropped Text: 你如何看待跨团队协作？遇到需求变更一般怎么处理？
Source Sentence: p0_b1_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 你如何看待跨团队协作？遇到需求变更一般怎么处理？
```

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
你如何看待跨团队协作？遇到需求变更一般怎么处理？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"b12f3cf0aef86ec71cf7ca92007b4ed2b271c07b66773e2211895464537dd8e6","bucketDomain":"food_order","count":1},{"pathId":"b12f3cf0aef86ec71cf7ca92007b4ed2b271c07b66773e2211895464537dd8e6","bucketDomain":"milk_tea","count":1}]
crossPathInputCount: 2
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (2 vs 2)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d027

<a id="case-d027"></a>

### Case 基础信息

```text
Case ID: d027
Raw Text: 期望薪资这块我们可以再沟通，你最快什么时候能入职？
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `84f36989f411316b0fbb31d26ab28fc8fd7f7901712c880018c446be02dc23a0`

Bucket: `medical` (`p0_b0`)

Assembly Sentences:

1.

```text
期望薪资这块我们科医再沟通，你最快什么时候能入职？
```

- sentenceId: `p0_b0_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

2.

```text
期望薪资这块我们可以再沟通，你最快什么时候能入职？
```

- sentenceId: `p0_b0_s1`
- category: `RAW_ORIGINAL`
- assemblyRank: 2
- assemblyScore: 0

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 2

1.

```text
text: 期望薪资这块我们科医再沟通，你最快什么时候能入职？
pathId: 84f36989f411316b0fbb31d26ab28fc8fd7f7901712c880018c446be02dc23a0
bucketDomain: medical
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 期望薪资这块我们可以再沟通，你最快什么时候能入职？
pathId: 84f36989f411316b0fbb31d26ab28fc8fd7f7901712c880018c446be02dc23a0
bucketDomain: medical
sourceSentenceId: p0_b0_s1
```

### D. CrossPath Output

Count: 2

1.

```text
text: 期望薪资这块我们科医再沟通，你最快什么时候能入职？
keptFromPath: 84f36989f411316b0fbb31d26ab28fc8fd7f7901712c880018c446be02dc23a0
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 期望薪资这块我们可以再沟通，你最快什么时候能入职？
keptFromPath: 84f36989f411316b0fbb31d26ab28fc8fd7f7901712c880018c446be02dc23a0
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s1
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 2

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
期望薪资这块我们科医再沟通，你最快什么时候能入职？
```

2.

```text
期望薪资这块我们可以再沟通，你最快什么时候能入职？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"84f36989f411316b0fbb31d26ab28fc8fd7f7901712c880018c446be02dc23a0","bucketDomain":"medical","count":2}]
crossPathInputCount: 2
crossPathOutputCount: 2
kenlmInputCount: 2
CrossPath Input == Assembly total: YES (2 vs 2)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d028

<a id="case-d028"></a>

### Case 基础信息

```text
Case ID: d028
Raw Text: 老师，这道题的解题步骤能不能再讲一遍？我没听懂第二点。
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `1c409d8f6131faa9fc20d6ca3c8911bc863ca7db5fb5df65e6fd14d73cb58462`

Bucket: `null` (`p0_b0`)

Assembly Sentences:

1.

```text
老师，这道题的解题步骤能不能再讲一遍？我没听懂第二点。
```

- sentenceId: `p0_b0_s0`
- category: `RAW_ORIGINAL`
- assemblyRank: 1
- assemblyScore: 0

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 老师，这道题的解题步骤能不能再讲一遍？我没听懂第二点。
pathId: 1c409d8f6131faa9fc20d6ca3c8911bc863ca7db5fb5df65e6fd14d73cb58462
bucketDomain: null
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 老师，这道题的解题步骤能不能再讲一遍？我没听懂第二点。
keptFromPath: 1c409d8f6131faa9fc20d6ca3c8911bc863ca7db5fb5df65e6fd14d73cb58462
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
老师，这道题的解题步骤能不能再讲一遍？我没听懂第二点。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"1c409d8f6131faa9fc20d6ca3c8911bc863ca7db5fb5df65e6fd14d73cb58462","bucketDomain":null,"count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d029

<a id="case-d029"></a>

### Case 基础信息

```text
Case ID: d029
Raw Text: 作业是下周一下午交吗？可以电子版提交吗？
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `cfa8bb1a264544e0081de7f7df6ddab5a810d642a10eb16e14969796fff1dc05`

Bucket: `medical` (`p0_b0`)

Assembly Sentences:

1.

```text
作液室下周一下午交吗？科医电子版提交吗？
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 4.366

2.

```text
作业是下周一下午交吗？科医电子版提交吗？
```

- sentenceId: `p0_b0_s1`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 2
- assemblyScore: 2.36

3.

```text
作液室下周一下午交吗？可以电子版提交吗？
```

- sentenceId: `p0_b0_s2`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 3
- assemblyScore: 2.006

4.

```text
作业是下周一下午交吗？可以电子版提交吗？
```

- sentenceId: `p0_b0_s3`
- category: `RAW_ORIGINAL`
- assemblyRank: 4
- assemblyScore: 0

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 4

1.

```text
text: 作液室下周一下午交吗？科医电子版提交吗？
pathId: cfa8bb1a264544e0081de7f7df6ddab5a810d642a10eb16e14969796fff1dc05
bucketDomain: medical
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 作业是下周一下午交吗？科医电子版提交吗？
pathId: cfa8bb1a264544e0081de7f7df6ddab5a810d642a10eb16e14969796fff1dc05
bucketDomain: medical
sourceSentenceId: p0_b0_s1
```

3.

```text
text: 作液室下周一下午交吗？可以电子版提交吗？
pathId: cfa8bb1a264544e0081de7f7df6ddab5a810d642a10eb16e14969796fff1dc05
bucketDomain: medical
sourceSentenceId: p0_b0_s2
```

4.

```text
text: 作业是下周一下午交吗？可以电子版提交吗？
pathId: cfa8bb1a264544e0081de7f7df6ddab5a810d642a10eb16e14969796fff1dc05
bucketDomain: medical
sourceSentenceId: p0_b0_s3
```

### D. CrossPath Output

Count: 4

1.

```text
text: 作液室下周一下午交吗？科医电子版提交吗？
keptFromPath: cfa8bb1a264544e0081de7f7df6ddab5a810d642a10eb16e14969796fff1dc05
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 作业是下周一下午交吗？科医电子版提交吗？
keptFromPath: cfa8bb1a264544e0081de7f7df6ddab5a810d642a10eb16e14969796fff1dc05
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s1
```

3.

```text
text: 作液室下周一下午交吗？可以电子版提交吗？
keptFromPath: cfa8bb1a264544e0081de7f7df6ddab5a810d642a10eb16e14969796fff1dc05
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s2
```

4.

```text
text: 作业是下周一下午交吗？可以电子版提交吗？
keptFromPath: cfa8bb1a264544e0081de7f7df6ddab5a810d642a10eb16e14969796fff1dc05
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s3
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 4

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
作液室下周一下午交吗？科医电子版提交吗？
```

2.

```text
作业是下周一下午交吗？科医电子版提交吗？
```

3.

```text
作液室下周一下午交吗？可以电子版提交吗？
```

4.

```text
作业是下周一下午交吗？可以电子版提交吗？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"cfa8bb1a264544e0081de7f7df6ddab5a810d642a10eb16e14969796fff1dc05","bucketDomain":"medical","count":4}]
crossPathInputCount: 4
crossPathOutputCount: 4
kenlmInputCount: 4
CrossPath Input == Assembly total: YES (4 vs 4)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d030

<a id="case-d030"></a>

### Case 基础信息

```text
Case ID: d030
Raw Text: 请问这门课期末是开卷还是闭卷？重点会划吗？
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `406369b69d20013642b051317595e528c850c41df8ca93640fce6b7e57486447`

Bucket: `tourism_hotel` (`p0_b0`)

Assembly Sentences:

1.

```text
请问这门课期末是开卷还是闭卷？钟点会划吗？
```

- sentenceId: `p0_b0_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

2.

```text
请问这门课期末是开卷还是闭卷？重点会划吗？
```

- sentenceId: `p0_b0_s1`
- category: `RAW_ORIGINAL`
- assemblyRank: 2
- assemblyScore: 0

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 2

1.

```text
text: 请问这门课期末是开卷还是闭卷？钟点会划吗？
pathId: 406369b69d20013642b051317595e528c850c41df8ca93640fce6b7e57486447
bucketDomain: tourism_hotel
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 请问这门课期末是开卷还是闭卷？重点会划吗？
pathId: 406369b69d20013642b051317595e528c850c41df8ca93640fce6b7e57486447
bucketDomain: tourism_hotel
sourceSentenceId: p0_b0_s1
```

### D. CrossPath Output

Count: 2

1.

```text
text: 请问这门课期末是开卷还是闭卷？钟点会划吗？
keptFromPath: 406369b69d20013642b051317595e528c850c41df8ca93640fce6b7e57486447
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 请问这门课期末是开卷还是闭卷？重点会划吗？
keptFromPath: 406369b69d20013642b051317595e528c850c41df8ca93640fce6b7e57486447
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s1
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 2

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
请问这门课期末是开卷还是闭卷？钟点会划吗？
```

2.

```text
请问这门课期末是开卷还是闭卷？重点会划吗？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"406369b69d20013642b051317595e528c850c41df8ca93640fce6b7e57486447","bucketDomain":"tourism_hotel","count":2}]
crossPathInputCount: 2
crossPathOutputCount: 2
kenlmInputCount: 2
CrossPath Input == Assembly total: YES (2 vs 2)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d031

<a id="case-d031"></a>

### Case 基础信息

```text
Case ID: d031
Raw Text: 我预订的是大床房，能安排安静一点的楼层吗？
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `0f1b0bab3dbe84cb6e062d9358983f0b8121ebf7757d2db143133f0308c372c0`

Bucket: `tourism_hotel` (`p0_b0`)

Assembly Sentences:

1.

```text
我预订的是大床房，能安排安静一点的楼层吗？
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 7.1

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 我预订的是大床房，能安排安静一点的楼层吗？
pathId: 0f1b0bab3dbe84cb6e062d9358983f0b8121ebf7757d2db143133f0308c372c0
bucketDomain: tourism_hotel
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 我预订的是大床房，能安排安静一点的楼层吗？
keptFromPath: 0f1b0bab3dbe84cb6e062d9358983f0b8121ebf7757d2db143133f0308c372c0
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
我预订的是大床房，能安排安静一点的楼层吗？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"0f1b0bab3dbe84cb6e062d9358983f0b8121ebf7757d2db143133f0308c372c0","bucketDomain":"tourism_hotel","count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d032

<a id="case-d032"></a>

### Case 基础信息

```text
Case ID: d032
Raw Text: 早餐几点开始？退房可以延迟到下午两点吗？
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `03e1aa8d5789d78feb7b3931f6588e562f01a298a0136c39d7b213cfeacb5a13`

Bucket: `tourism_hotel` (`p0_b0`)

Assembly Sentences:

1.

```text
早餐几点开始？退房可以延迟到下午两点吗？
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 4.4

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 早餐几点开始？退房可以延迟到下午两点吗？
pathId: 03e1aa8d5789d78feb7b3931f6588e562f01a298a0136c39d7b213cfeacb5a13
bucketDomain: tourism_hotel
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 早餐几点开始？退房可以延迟到下午两点吗？
keptFromPath: 03e1aa8d5789d78feb7b3931f6588e562f01a298a0136c39d7b213cfeacb5a13
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
早餐几点开始？退房可以延迟到下午两点吗？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"03e1aa8d5789d78feb7b3931f6588e562f01a298a0136c39d7b213cfeacb5a13","bucketDomain":"tourism_hotel","count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d033

<a id="case-d033"></a>

### Case 基础信息

```text
Case ID: d033
Raw Text: 房间空调不太制冷，能派人上来看一下吗？
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `6cadd25d36a390cae4a08810f3d8c2773753c3c6d3c1f3c07298a83ac138f50a`

Bucket: `tech_ai` (`p0_b0`)

Assembly Sentences:

1.

```text
房监控调不太制冷，能派人上来看一下吗？
```

- sentenceId: `p0_b0_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

2.

```text
房间空调不太制冷，能派人上来看一下吗？
```

- sentenceId: `p0_b0_s1`
- category: `RAW_ORIGINAL`
- assemblyRank: 2
- assemblyScore: 0

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 2

1.

```text
text: 房监控调不太制冷，能派人上来看一下吗？
pathId: 6cadd25d36a390cae4a08810f3d8c2773753c3c6d3c1f3c07298a83ac138f50a
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 房间空调不太制冷，能派人上来看一下吗？
pathId: 6cadd25d36a390cae4a08810f3d8c2773753c3c6d3c1f3c07298a83ac138f50a
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s1
```

### D. CrossPath Output

Count: 2

1.

```text
text: 房监控调不太制冷，能派人上来看一下吗？
keptFromPath: 6cadd25d36a390cae4a08810f3d8c2773753c3c6d3c1f3c07298a83ac138f50a
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 房间空调不太制冷，能派人上来看一下吗？
keptFromPath: 6cadd25d36a390cae4a08810f3d8c2773753c3c6d3c1f3c07298a83ac138f50a
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s1
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 2

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
房监控调不太制冷，能派人上来看一下吗？
```

2.

```text
房间空调不太制冷，能派人上来看一下吗？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"6cadd25d36a390cae4a08810f3d8c2773753c3c6d3c1f3c07298a83ac138f50a","bucketDomain":"tech_ai","count":2}]
crossPathInputCount: 2
crossPathOutputCount: 2
kenlmInputCount: 2
CrossPath Input == Assembly total: YES (2 vs 2)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d034

<a id="case-d034"></a>

### Case 基础信息

```text
Case ID: d034
Raw Text: 我想开通短信提醒，需要带什么证件？
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `c14d5f5751216d8790ba33830572c5c91e9e6e8c1beabcfbb3e78f12a3374199`

Bucket: `tourism_route` (`p0_b0`)

Assembly Sentences:

1.

```text
我想开通短信提醒，需要带什么证件？
```

- sentenceId: `p0_b0_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 我想开通短信提醒，需要带什么证件？
pathId: c14d5f5751216d8790ba33830572c5c91e9e6e8c1beabcfbb3e78f12a3374199
bucketDomain: tourism_route
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 我想开通短信提醒，需要带什么证件？
keptFromPath: c14d5f5751216d8790ba33830572c5c91e9e6e8c1beabcfbb3e78f12a3374199
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
我想开通短信提醒，需要带什么证件？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"c14d5f5751216d8790ba33830572c5c91e9e6e8c1beabcfbb3e78f12a3374199","bucketDomain":"tourism_route","count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d035

<a id="case-d035"></a>

### Case 基础信息

```text
Case ID: d035
Raw Text: 这笔转账显示处理中，大概多久能到账？
Path Count: 1
Bucket Count: 2
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `2913b934f41b6799cf1415142f4c210ceef85a8cc8572ca4ea9a0734a8e0e55b`

Bucket: `food_order` (`p0_b0`)

Assembly Sentences:

1.

```text
这笔转账显示处理中，大概多久能到账？
```

- sentenceId: `p0_b0_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

#### Path: `2913b934f41b6799cf1415142f4c210ceef85a8cc8572ca4ea9a0734a8e0e55b`

Bucket: `milk_tea` (`p0_b1`)

Assembly Sentences:

1.

```text
这笔转账显示处理中，大概多久能到账？
```

- sentenceId: `p0_b1_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 2

1.

```text
text: 这笔转账显示处理中，大概多久能到账？
pathId: 2913b934f41b6799cf1415142f4c210ceef85a8cc8572ca4ea9a0734a8e0e55b
bucketDomain: food_order
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 这笔转账显示处理中，大概多久能到账？
pathId: 2913b934f41b6799cf1415142f4c210ceef85a8cc8572ca4ea9a0734a8e0e55b
bucketDomain: milk_tea
sourceSentenceId: p0_b1_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 这笔转账显示处理中，大概多久能到账？
keptFromPath: 2913b934f41b6799cf1415142f4c210ceef85a8cc8572ca4ea9a0734a8e0e55b
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

```text
Dropped Text: 这笔转账显示处理中，大概多久能到账？
Source Sentence: p0_b1_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 这笔转账显示处理中，大概多久能到账？
```

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
这笔转账显示处理中，大概多久能到账？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"2913b934f41b6799cf1415142f4c210ceef85a8cc8572ca4ea9a0734a8e0e55b","bucketDomain":"food_order","count":1},{"pathId":"2913b934f41b6799cf1415142f4c210ceef85a8cc8572ca4ea9a0734a8e0e55b","bucketDomain":"milk_tea","count":1}]
crossPathInputCount: 2
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (2 vs 2)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d036

<a id="case-d036"></a>

### Case 基础信息

```text
Case ID: d036
Raw Text: 请问理财产品的风险等级在哪里查看？
Path Count: 1
Bucket Count: 2
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `6bcff49b0914307d218e0a1eff428d5f84a8e0578634047e841739527dddedbb`

Bucket: `tech_ai` (`p0_b0`)

Assembly Sentences:

1.

```text
请问理财产品的风险等级在哪里查看？
```

- sentenceId: `p0_b0_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

#### Path: `6bcff49b0914307d218e0a1eff428d5f84a8e0578634047e841739527dddedbb`

Bucket: `tourism_pickup` (`p0_b1`)

Assembly Sentences:

1.

```text
请问理财产品的风险登机在哪里查看？
```

- sentenceId: `p0_b1_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

2.

```text
请问理财产品的风险等级在哪里查看？
```

- sentenceId: `p0_b1_s1`
- category: `RAW_ORIGINAL`
- assemblyRank: 2
- assemblyScore: 0

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 3

1.

```text
text: 请问理财产品的风险等级在哪里查看？
pathId: 6bcff49b0914307d218e0a1eff428d5f84a8e0578634047e841739527dddedbb
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 请问理财产品的风险登机在哪里查看？
pathId: 6bcff49b0914307d218e0a1eff428d5f84a8e0578634047e841739527dddedbb
bucketDomain: tourism_pickup
sourceSentenceId: p0_b1_s0
```

3.

```text
text: 请问理财产品的风险等级在哪里查看？
pathId: 6bcff49b0914307d218e0a1eff428d5f84a8e0578634047e841739527dddedbb
bucketDomain: tourism_pickup
sourceSentenceId: p0_b1_s1
```

### D. CrossPath Output

Count: 2

1.

```text
text: 请问理财产品的风险等级在哪里查看？
keptFromPath: 6bcff49b0914307d218e0a1eff428d5f84a8e0578634047e841739527dddedbb
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 请问理财产品的风险登机在哪里查看？
keptFromPath: 6bcff49b0914307d218e0a1eff428d5f84a8e0578634047e841739527dddedbb
keptFromBucket: p0_b1
sourceSentenceId: p0_b1_s0
```

### E. CrossPath 删除项

```text
Dropped Text: 请问理财产品的风险等级在哪里查看？
Source Sentence: p0_b1_s1
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 请问理财产品的风险等级在哪里查看？
```

### F. KenLM Input

KenLM Input Count: 2

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
请问理财产品的风险等级在哪里查看？
```

2.

```text
请问理财产品的风险登机在哪里查看？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"6bcff49b0914307d218e0a1eff428d5f84a8e0578634047e841739527dddedbb","bucketDomain":"tech_ai","count":1},{"pathId":"6bcff49b0914307d218e0a1eff428d5f84a8e0578634047e841739527dddedbb","bucketDomain":"tourism_pickup","count":2}]
crossPathInputCount: 3
crossPathOutputCount: 2
kenlmInputCount: 2
CrossPath Input == Assembly total: YES (3 vs 3)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d037

<a id="case-d037"></a>

### Case 基础信息

```text
Case ID: d037
Raw Text: 两位，靠窗有位置吗？不要香菜，微辣就行。
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `8b2d9e6e9ba6152b4bfe03dd11061b9ad65e8ae7988e4c6ba683146fc5832aad`

Bucket: `food_order` (`p0_b0`)

Assembly Sentences:

1.

```text
两位，靠窗有位置吗？不要香菜，微辣就行。
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 4.390000000000001

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 两位，靠窗有位置吗？不要香菜，微辣就行。
pathId: 8b2d9e6e9ba6152b4bfe03dd11061b9ad65e8ae7988e4c6ba683146fc5832aad
bucketDomain: food_order
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 两位，靠窗有位置吗？不要香菜，微辣就行。
keptFromPath: 8b2d9e6e9ba6152b4bfe03dd11061b9ad65e8ae7988e4c6ba683146fc5832aad
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
两位，靠窗有位置吗？不要香菜，微辣就行。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"8b2d9e6e9ba6152b4bfe03dd11061b9ad65e8ae7988e4c6ba683146fc5832aad","bucketDomain":"food_order","count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d038

<a id="case-d038"></a>

### Case 基础信息

```text
Case ID: d038
Raw Text: 这道菜大概要等多久？我们先点一份凉菜和一壶茶。
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `37367286bf78ef457c58421ac1cc51772b81498372ff6046875c912bacb0a3ca`

Bucket: `null` (`p0_b0`)

Assembly Sentences:

1.

```text
这道菜大概要等多久？我们先点一份凉菜和一壶茶。
```

- sentenceId: `p0_b0_s0`
- category: `RAW_ORIGINAL`
- assemblyRank: 1
- assemblyScore: 0

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 这道菜大概要等多久？我们先点一份凉菜和一壶茶。
pathId: 37367286bf78ef457c58421ac1cc51772b81498372ff6046875c912bacb0a3ca
bucketDomain: null
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 这道菜大概要等多久？我们先点一份凉菜和一壶茶。
keptFromPath: 37367286bf78ef457c58421ac1cc51772b81498372ff6046875c912bacb0a3ca
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
这道菜大概要等多久？我们先点一份凉菜和一壶茶。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"37367286bf78ef457c58421ac1cc51772b81498372ff6046875c912bacb0a3ca","bucketDomain":null,"count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d039

<a id="case-d039"></a>

### Case 基础信息

```text
Case ID: d039
Raw Text: 可以打包吗？顺便结一下账，能扫码支付吗？
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `91229dfa9d5be6b38b9f08e170cff33f5d2bdef0d0cb6c73fdb7cf999d70ca76`

Bucket: `coffee` (`p0_b0`)

Assembly Sentences:

1.

```text
可以打包吗？顺便结一下账，能扫码支付吗？
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 4.356

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 可以打包吗？顺便结一下账，能扫码支付吗？
pathId: 91229dfa9d5be6b38b9f08e170cff33f5d2bdef0d0cb6c73fdb7cf999d70ca76
bucketDomain: coffee
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 可以打包吗？顺便结一下账，能扫码支付吗？
keptFromPath: 91229dfa9d5be6b38b9f08e170cff33f5d2bdef0d0cb6c73fdb7cf999d70ca76
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
可以打包吗？顺便结一下账，能扫码支付吗？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"91229dfa9d5be6b38b9f08e170cff33f5d2bdef0d0cb6c73fdb7cf999d70ca76","bucketDomain":"coffee","count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d040

<a id="case-d040"></a>

### Case 基础信息

```text
Case ID: d040
Raw Text: 私教课还剩几次？能帮我约明天晚上七点吗？
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `973b1af9a783aa7707c48f38b9fa56cd157195dbfa41409fe89c426ae484696e`

Bucket: `null` (`p0_b0`)

Assembly Sentences:

1.

```text
私教课还剩几次？能帮我约明天晚上七点吗？
```

- sentenceId: `p0_b0_s0`
- category: `RAW_ORIGINAL`
- assemblyRank: 1
- assemblyScore: 0

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 私教课还剩几次？能帮我约明天晚上七点吗？
pathId: 973b1af9a783aa7707c48f38b9fa56cd157195dbfa41409fe89c426ae484696e
bucketDomain: null
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 私教课还剩几次？能帮我约明天晚上七点吗？
keptFromPath: 973b1af9a783aa7707c48f38b9fa56cd157195dbfa41409fe89c426ae484696e
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
私教课还剩几次？能帮我约明天晚上七点吗？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"973b1af9a783aa7707c48f38b9fa56cd157195dbfa41409fe89c426ae484696e","bucketDomain":null,"count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d041

<a id="case-d041"></a>

### Case 基础信息

```text
Case ID: d041
Raw Text: 更衣室柜子钥匙找不到了，前台能帮忙开一下吗？
Path Count: 1
Bucket Count: 3
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `3b518d0b2df5f529d68743f21657b328629df6e85a64c6f34b152211b6dc2f06`

Bucket: `medical` (`p0_b0`)

Assembly Sentences:

1.

```text
更医师柜子钥匙找不到了，前台能帮忙开一下吗？
```

- sentenceId: `p0_b0_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.006

2.

```text
更衣室柜子钥匙找不到了，前台能帮忙开一下吗？
```

- sentenceId: `p0_b0_s1`
- category: `RAW_ORIGINAL`
- assemblyRank: 2
- assemblyScore: 0

#### Path: `3b518d0b2df5f529d68743f21657b328629df6e85a64c6f34b152211b6dc2f06`

Bucket: `meeting` (`p0_b1`)

Assembly Sentences:

1.

```text
更议室柜子钥匙找不到了，前台能帮忙开一下吗？
```

- sentenceId: `p0_b1_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.006

2.

```text
更衣室柜子钥匙找不到了，前台能帮忙开一下吗？
```

- sentenceId: `p0_b1_s1`
- category: `RAW_ORIGINAL`
- assemblyRank: 2
- assemblyScore: 0

#### Path: `3b518d0b2df5f529d68743f21657b328629df6e85a64c6f34b152211b6dc2f06`

Bucket: `tourism_hotel` (`p0_b2`)

Assembly Sentences:

1.

```text
更衣室柜子钥匙找不到了，前台能帮忙开一下吗？
```

- sentenceId: `p0_b2_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 5

1.

```text
text: 更医师柜子钥匙找不到了，前台能帮忙开一下吗？
pathId: 3b518d0b2df5f529d68743f21657b328629df6e85a64c6f34b152211b6dc2f06
bucketDomain: medical
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 更衣室柜子钥匙找不到了，前台能帮忙开一下吗？
pathId: 3b518d0b2df5f529d68743f21657b328629df6e85a64c6f34b152211b6dc2f06
bucketDomain: medical
sourceSentenceId: p0_b0_s1
```

3.

```text
text: 更议室柜子钥匙找不到了，前台能帮忙开一下吗？
pathId: 3b518d0b2df5f529d68743f21657b328629df6e85a64c6f34b152211b6dc2f06
bucketDomain: meeting
sourceSentenceId: p0_b1_s0
```

4.

```text
text: 更衣室柜子钥匙找不到了，前台能帮忙开一下吗？
pathId: 3b518d0b2df5f529d68743f21657b328629df6e85a64c6f34b152211b6dc2f06
bucketDomain: meeting
sourceSentenceId: p0_b1_s1
```

5.

```text
text: 更衣室柜子钥匙找不到了，前台能帮忙开一下吗？
pathId: 3b518d0b2df5f529d68743f21657b328629df6e85a64c6f34b152211b6dc2f06
bucketDomain: tourism_hotel
sourceSentenceId: p0_b2_s0
```

### D. CrossPath Output

Count: 3

1.

```text
text: 更医师柜子钥匙找不到了，前台能帮忙开一下吗？
keptFromPath: 3b518d0b2df5f529d68743f21657b328629df6e85a64c6f34b152211b6dc2f06
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 更衣室柜子钥匙找不到了，前台能帮忙开一下吗？
keptFromPath: 3b518d0b2df5f529d68743f21657b328629df6e85a64c6f34b152211b6dc2f06
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s1
```

3.

```text
text: 更议室柜子钥匙找不到了，前台能帮忙开一下吗？
keptFromPath: 3b518d0b2df5f529d68743f21657b328629df6e85a64c6f34b152211b6dc2f06
keptFromBucket: p0_b1
sourceSentenceId: p0_b1_s0
```

### E. CrossPath 删除项

```text
Dropped Text: 更衣室柜子钥匙找不到了，前台能帮忙开一下吗？
Source Sentence: p0_b1_s1
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 更衣室柜子钥匙找不到了，前台能帮忙开一下吗？
```

```text
Dropped Text: 更衣室柜子钥匙找不到了，前台能帮忙开一下吗？
Source Sentence: p0_b2_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 更衣室柜子钥匙找不到了，前台能帮忙开一下吗？
```

### F. KenLM Input

KenLM Input Count: 3

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
更医师柜子钥匙找不到了，前台能帮忙开一下吗？
```

2.

```text
更衣室柜子钥匙找不到了，前台能帮忙开一下吗？
```

3.

```text
更议室柜子钥匙找不到了，前台能帮忙开一下吗？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"3b518d0b2df5f529d68743f21657b328629df6e85a64c6f34b152211b6dc2f06","bucketDomain":"medical","count":2},{"pathId":"3b518d0b2df5f529d68743f21657b328629df6e85a64c6f34b152211b6dc2f06","bucketDomain":"meeting","count":2},{"pathId":"3b518d0b2df5f529d68743f21657b328629df6e85a64c6f34b152211b6dc2f06","bucketDomain":"tourism_hotel","count":1}]
crossPathInputCount: 5
crossPathOutputCount: 3
kenlmInputCount: 3
CrossPath Input == Assembly total: YES (5 vs 5)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d042

<a id="case-d042"></a>

### Case 基础信息

```text
Case ID: d042
Raw Text: 游泳次卡本月月底到期，续费有优惠吗？
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `a11519a0a6b805c16c3242918d0e30f13d8a99cebe7578a68fe2fabb883c6c96`

Bucket: `null` (`p0_b0`)

Assembly Sentences:

1.

```text
游泳次卡本月月底到期，续费有优惠吗？
```

- sentenceId: `p0_b0_s0`
- category: `RAW_ORIGINAL`
- assemblyRank: 1
- assemblyScore: 0

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 游泳次卡本月月底到期，续费有优惠吗？
pathId: a11519a0a6b805c16c3242918d0e30f13d8a99cebe7578a68fe2fabb883c6c96
bucketDomain: null
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 游泳次卡本月月底到期，续费有优惠吗？
keptFromPath: a11519a0a6b805c16c3242918d0e30f13d8a99cebe7578a68fe2fabb883c6c96
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
游泳次卡本月月底到期，续费有优惠吗？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"a11519a0a6b805c16c3242918d0e30f13d8a99cebe7578a68fe2fabb883c6c96","bucketDomain":null,"count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d043

<a id="case-d043"></a>

### Case 基础信息

```text
Case ID: d043
Raw Text: 我们下午讨论后选声城方案，先把候选生成的接口文档补齐。
Path Count: 2
Bucket Count: 2
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `86bbdea09331c4feb5a8c0ad9881f21444a7ba7ae866222c8b4c24b3fba4ce42`

Bucket: `tech_ai` (`p0_b0`)

Assembly Sentences:

1.

```text
我们下午讨论候选声城方案，先把候选生成的接口文档补齐。
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 9.66

2.

```text
我们下午讨论后选声城方案，先把候选生成的接口文档补齐。
```

- sentenceId: `p0_b0_s1`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 2
- assemblyScore: 7.24

#### Path: `eefbde0a8d0d9a4bd706030008aee9a3ba8aef276637bb189b65c4365acf56c9`

Bucket: `tech_ai` (`p1_b0`)

Assembly Sentences:

1.

```text
我们下午讨论候选声城方案，先把候选生成的接口文档补齐。
```

- sentenceId: `p1_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 6.88

2.

```text
我们下午讨论后选声城方案，先把候选生成的接口文档补齐。
```

- sentenceId: `p1_b0_s1`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 2
- assemblyScore: 4.46

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 4

1.

```text
text: 我们下午讨论候选声城方案，先把候选生成的接口文档补齐。
pathId: 86bbdea09331c4feb5a8c0ad9881f21444a7ba7ae866222c8b4c24b3fba4ce42
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 我们下午讨论后选声城方案，先把候选生成的接口文档补齐。
pathId: 86bbdea09331c4feb5a8c0ad9881f21444a7ba7ae866222c8b4c24b3fba4ce42
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s1
```

3.

```text
text: 我们下午讨论候选声城方案，先把候选生成的接口文档补齐。
pathId: eefbde0a8d0d9a4bd706030008aee9a3ba8aef276637bb189b65c4365acf56c9
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s0
```

4.

```text
text: 我们下午讨论后选声城方案，先把候选生成的接口文档补齐。
pathId: eefbde0a8d0d9a4bd706030008aee9a3ba8aef276637bb189b65c4365acf56c9
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s1
```

### D. CrossPath Output

Count: 2

1.

```text
text: 我们下午讨论候选声城方案，先把候选生成的接口文档补齐。
keptFromPath: 86bbdea09331c4feb5a8c0ad9881f21444a7ba7ae866222c8b4c24b3fba4ce42
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 我们下午讨论后选声城方案，先把候选生成的接口文档补齐。
keptFromPath: 86bbdea09331c4feb5a8c0ad9881f21444a7ba7ae866222c8b4c24b3fba4ce42
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s1
```

### E. CrossPath 删除项

```text
Dropped Text: 我们下午讨论候选声城方案，先把候选生成的接口文档补齐。
Source Sentence: p1_b0_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 我们下午讨论候选声城方案，先把候选生成的接口文档补齐。
```

```text
Dropped Text: 我们下午讨论后选声城方案，先把候选生成的接口文档补齐。
Source Sentence: p1_b0_s1
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 我们下午讨论后选声城方案，先把候选生成的接口文档补齐。
```

### F. KenLM Input

KenLM Input Count: 2

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
我们下午讨论候选声城方案，先把候选生成的接口文档补齐。
```

2.

```text
我们下午讨论后选声城方案，先把候选生成的接口文档补齐。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"86bbdea09331c4feb5a8c0ad9881f21444a7ba7ae866222c8b4c24b3fba4ce42","bucketDomain":"tech_ai","count":2},{"pathId":"eefbde0a8d0d9a4bd706030008aee9a3ba8aef276637bb189b65c4365acf56c9","bucketDomain":"tech_ai","count":2}]
crossPathInputCount: 4
crossPathOutputCount: 2
kenlmInputCount: 2
CrossPath Input == Assembly total: YES (4 vs 4)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d044

<a id="case-d044"></a>

### Case 基础信息

```text
Case ID: d044
Raw Text: 这周的上线计花已经确认，上线计划评审安排在周四上午。
Path Count: 4
Bucket Count: 5
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `3a7c0ec19c68211cdf24335825c8d37e4aa2134e2fc89f2e63c8e4317cc94389`

Bucket: `tech_ai` (`p0_b0`)

Assembly Sentences:

1.

```text
这周的上线计划已经确认，上线计划评审安排在周四上午。
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 9.64

2.

```text
这周的上线计花已经确认，上线计划评审安排在周四上午。
```

- sentenceId: `p0_b0_s1`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 2
- assemblyScore: 7.24

#### Path: `066ebc94f339a351afffd32d14f7e56193e4b7aea663b15d787ffdc5993bda0f`

Bucket: `tech_ai` (`p1_b0`)

Assembly Sentences:

1.

```text
这周的上线计划已经确认，上线计划评审安排在周四上午。
```

- sentenceId: `p1_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 6.86

2.

```text
这周的上线计花已经确认，上线计划评审安排在周四上午。
```

- sentenceId: `p1_b0_s1`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 2
- assemblyScore: 4.46

#### Path: `57ea9b89e4fc35be95b82fbc831b7f5c4c7f6f5fe37c7010697f3f088ac465f6`

Bucket: `tech_ai` (`p2_b0`)

Assembly Sentences:

1.

```text
这周的上线计划已经确认，上线计划评审安排在周四上午。
```

- sentenceId: `p2_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 6.859999999999999

2.

```text
这周的上线计花已经确认，上线计划评审安排在周四上午。
```

- sentenceId: `p2_b0_s1`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 2
- assemblyScore: 4.82

#### Path: `1e01ba7584d9e3d132a29bce455c9f9262f69591509b4623fd5d51aae06b8008`

Bucket: `tech_ai` (`p3_b0`)

Assembly Sentences:

1.

```text
这周的上线计划已经确认，上线计划评审安排在周四上午。
```

- sentenceId: `p3_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 4.08

2.

```text
这周的上线计花已经确认，上线计划评审安排在周四上午。
```

- sentenceId: `p3_b0_s1`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 2
- assemblyScore: 2.04

#### Path: `1e01ba7584d9e3d132a29bce455c9f9262f69591509b4623fd5d51aae06b8008`

Bucket: `tourism_hotel` (`p3_b1`)

Assembly Sentences:

1.

```text
这周的上线计花已经确认，上线计划评审安排在周四商务。
```

- sentenceId: `p3_b1_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 4.72

2.

```text
这周的上线计花已经确认，上线计划评审安排在周四上午。
```

- sentenceId: `p3_b1_s1`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 2
- assemblyScore: 2.36

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 10

1.

```text
text: 这周的上线计划已经确认，上线计划评审安排在周四上午。
pathId: 3a7c0ec19c68211cdf24335825c8d37e4aa2134e2fc89f2e63c8e4317cc94389
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 这周的上线计花已经确认，上线计划评审安排在周四上午。
pathId: 3a7c0ec19c68211cdf24335825c8d37e4aa2134e2fc89f2e63c8e4317cc94389
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s1
```

3.

```text
text: 这周的上线计划已经确认，上线计划评审安排在周四上午。
pathId: 066ebc94f339a351afffd32d14f7e56193e4b7aea663b15d787ffdc5993bda0f
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s0
```

4.

```text
text: 这周的上线计花已经确认，上线计划评审安排在周四上午。
pathId: 066ebc94f339a351afffd32d14f7e56193e4b7aea663b15d787ffdc5993bda0f
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s1
```

5.

```text
text: 这周的上线计划已经确认，上线计划评审安排在周四上午。
pathId: 57ea9b89e4fc35be95b82fbc831b7f5c4c7f6f5fe37c7010697f3f088ac465f6
bucketDomain: tech_ai
sourceSentenceId: p2_b0_s0
```

6.

```text
text: 这周的上线计花已经确认，上线计划评审安排在周四上午。
pathId: 57ea9b89e4fc35be95b82fbc831b7f5c4c7f6f5fe37c7010697f3f088ac465f6
bucketDomain: tech_ai
sourceSentenceId: p2_b0_s1
```

7.

```text
text: 这周的上线计划已经确认，上线计划评审安排在周四上午。
pathId: 1e01ba7584d9e3d132a29bce455c9f9262f69591509b4623fd5d51aae06b8008
bucketDomain: tech_ai
sourceSentenceId: p3_b0_s0
```

8.

```text
text: 这周的上线计花已经确认，上线计划评审安排在周四上午。
pathId: 1e01ba7584d9e3d132a29bce455c9f9262f69591509b4623fd5d51aae06b8008
bucketDomain: tech_ai
sourceSentenceId: p3_b0_s1
```

9.

```text
text: 这周的上线计花已经确认，上线计划评审安排在周四商务。
pathId: 1e01ba7584d9e3d132a29bce455c9f9262f69591509b4623fd5d51aae06b8008
bucketDomain: tourism_hotel
sourceSentenceId: p3_b1_s0
```

10.

```text
text: 这周的上线计花已经确认，上线计划评审安排在周四上午。
pathId: 1e01ba7584d9e3d132a29bce455c9f9262f69591509b4623fd5d51aae06b8008
bucketDomain: tourism_hotel
sourceSentenceId: p3_b1_s1
```

### D. CrossPath Output

Count: 3

1.

```text
text: 这周的上线计划已经确认，上线计划评审安排在周四上午。
keptFromPath: 3a7c0ec19c68211cdf24335825c8d37e4aa2134e2fc89f2e63c8e4317cc94389
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 这周的上线计花已经确认，上线计划评审安排在周四上午。
keptFromPath: 3a7c0ec19c68211cdf24335825c8d37e4aa2134e2fc89f2e63c8e4317cc94389
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s1
```

3.

```text
text: 这周的上线计花已经确认，上线计划评审安排在周四商务。
keptFromPath: 1e01ba7584d9e3d132a29bce455c9f9262f69591509b4623fd5d51aae06b8008
keptFromBucket: p3_b1
sourceSentenceId: p3_b1_s0
```

### E. CrossPath 删除项

```text
Dropped Text: 这周的上线计划已经确认，上线计划评审安排在周四上午。
Source Sentence: p1_b0_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 这周的上线计划已经确认，上线计划评审安排在周四上午。
```

```text
Dropped Text: 这周的上线计花已经确认，上线计划评审安排在周四上午。
Source Sentence: p1_b0_s1
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 这周的上线计花已经确认，上线计划评审安排在周四上午。
```

```text
Dropped Text: 这周的上线计划已经确认，上线计划评审安排在周四上午。
Source Sentence: p2_b0_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 这周的上线计划已经确认，上线计划评审安排在周四上午。
```

```text
Dropped Text: 这周的上线计花已经确认，上线计划评审安排在周四上午。
Source Sentence: p2_b0_s1
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 这周的上线计花已经确认，上线计划评审安排在周四上午。
```

```text
Dropped Text: 这周的上线计划已经确认，上线计划评审安排在周四上午。
Source Sentence: p3_b0_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 这周的上线计划已经确认，上线计划评审安排在周四上午。
```

```text
Dropped Text: 这周的上线计花已经确认，上线计划评审安排在周四上午。
Source Sentence: p3_b0_s1
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 这周的上线计花已经确认，上线计划评审安排在周四上午。
```

```text
Dropped Text: 这周的上线计花已经确认，上线计划评审安排在周四上午。
Source Sentence: p3_b1_s1
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 这周的上线计花已经确认，上线计划评审安排在周四上午。
```

### F. KenLM Input

KenLM Input Count: 3

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
这周的上线计划已经确认，上线计划评审安排在周四上午。
```

2.

```text
这周的上线计花已经确认，上线计划评审安排在周四上午。
```

3.

```text
这周的上线计花已经确认，上线计划评审安排在周四商务。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"3a7c0ec19c68211cdf24335825c8d37e4aa2134e2fc89f2e63c8e4317cc94389","bucketDomain":"tech_ai","count":2},{"pathId":"066ebc94f339a351afffd32d14f7e56193e4b7aea663b15d787ffdc5993bda0f","bucketDomain":"tech_ai","count":2},{"pathId":"57ea9b89e4fc35be95b82fbc831b7f5c4c7f6f5fe37c7010697f3f088ac465f6","bucketDomain":"tech_ai","count":2},{"pathId":"1e01ba7584d9e3d132a29bce455c9f9262f69591509b4623fd5d51aae06b8008","bucketDomain":"tech_ai","count":2},{"pathId":"1e01ba7584d9e3d132a29bce455c9f9262f69591509b4623fd5d51aae06b8008","bucketDomain":"tourism_hotel","count":2}]
crossPathInputCount: 10
crossPathOutputCount: 3
kenlmInputCount: 3
CrossPath Input == Assembly total: YES (10 vs 10)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d045

<a id="case-d045"></a>

### Case 基础信息

```text
Case ID: d045
Raw Text: 关于后选生城和上线计化，请按上线计划执行，有问题群里说。
Path Count: 4
Bucket Count: 4
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `80d8d072c93bd03cae9cbb84c08e94e3da22d362211a19bb4e9529d389cfcbd9`

Bucket: `tech_ai` (`p0_b0`)

Assembly Sentences:

1.

```text
关于候选生城和上线计划，请按上线计划执行，有问题群里说。
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 9.64

2.

```text
关于候选生城和上线计化，请按上线计划执行，有问题群里说。
```

- sentenceId: `p0_b0_s1`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 2
- assemblyScore: 7.24

3.

```text
关于后选生城和上线计划，请按上线计划执行，有问题群里说。
```

- sentenceId: `p0_b0_s2`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 3
- assemblyScore: 7.220000000000001

4.

```text
关于后选生城和上线计化，请按上线计划执行，有问题群里说。
```

- sentenceId: `p0_b0_s3`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 4
- assemblyScore: 4.82

#### Path: `93e4109d85b5380fab48f556415ccbc466756d447402b61852516ce4b9af9d96`

Bucket: `tech_ai` (`p1_b0`)

Assembly Sentences:

1.

```text
关于候选生城和上线计划，请按上线计划执行，有问题群里说。
```

- sentenceId: `p1_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 7.220000000000001

2.

```text
关于候选生城和上线计化，请按上线计划执行，有问题群里说。
```

- sentenceId: `p1_b0_s1`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 2
- assemblyScore: 4.82

3.

```text
关于后选生城和上线计划，请按上线计划执行，有问题群里说。
```

- sentenceId: `p1_b0_s2`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 3
- assemblyScore: 4.8

4.

```text
关于后选生城和上线计化，请按上线计划执行，有问题群里说。
```

- sentenceId: `p1_b0_s3`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 4
- assemblyScore: 2.4

#### Path: `2ad765c2b868ddad2f2aacc904cdbbff13b3bd2676190675e265773ee4a9a6ab`

Bucket: `tech_ai` (`p2_b0`)

Assembly Sentences:

1.

```text
关于候选生城和上线计划，请按上线计划执行，有问题群里说。
```

- sentenceId: `p2_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 12.06

2.

```text
关于候选生城和上线计化，请按上线计划执行，有问题群里说。
```

- sentenceId: `p2_b0_s1`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 2
- assemblyScore: 9.66

3.

```text
关于后选生城和上线计划，请按上线计划执行，有问题群里说。
```

- sentenceId: `p2_b0_s2`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 3
- assemblyScore: 9.64

4.

```text
关于后选生城和上线计化，请按上线计划执行，有问题群里说。
```

- sentenceId: `p2_b0_s3`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 4
- assemblyScore: 7.24

#### Path: `65aa4e3a49b767d4a16d0bb386a6f55fc3d2885c77f30fc1f8e5824bd3aebf0a`

Bucket: `tech_ai` (`p3_b0`)

Assembly Sentences:

1.

```text
关于候选生城和上线计划，请按上线计划执行，有问题群里说。
```

- sentenceId: `p3_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 9.64

2.

```text
关于候选生城和上线计化，请按上线计划执行，有问题群里说。
```

- sentenceId: `p3_b0_s1`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 2
- assemblyScore: 7.24

3.

```text
关于后选生城和上线计划，请按上线计划执行，有问题群里说。
```

- sentenceId: `p3_b0_s2`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 3
- assemblyScore: 7.220000000000001

4.

```text
关于后选生城和上线计化，请按上线计划执行，有问题群里说。
```

- sentenceId: `p3_b0_s3`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 4
- assemblyScore: 4.82

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 16

1.

```text
text: 关于候选生城和上线计划，请按上线计划执行，有问题群里说。
pathId: 80d8d072c93bd03cae9cbb84c08e94e3da22d362211a19bb4e9529d389cfcbd9
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 关于候选生城和上线计化，请按上线计划执行，有问题群里说。
pathId: 80d8d072c93bd03cae9cbb84c08e94e3da22d362211a19bb4e9529d389cfcbd9
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s1
```

3.

```text
text: 关于后选生城和上线计划，请按上线计划执行，有问题群里说。
pathId: 80d8d072c93bd03cae9cbb84c08e94e3da22d362211a19bb4e9529d389cfcbd9
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s2
```

4.

```text
text: 关于后选生城和上线计化，请按上线计划执行，有问题群里说。
pathId: 80d8d072c93bd03cae9cbb84c08e94e3da22d362211a19bb4e9529d389cfcbd9
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s3
```

5.

```text
text: 关于候选生城和上线计划，请按上线计划执行，有问题群里说。
pathId: 93e4109d85b5380fab48f556415ccbc466756d447402b61852516ce4b9af9d96
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s0
```

6.

```text
text: 关于候选生城和上线计化，请按上线计划执行，有问题群里说。
pathId: 93e4109d85b5380fab48f556415ccbc466756d447402b61852516ce4b9af9d96
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s1
```

7.

```text
text: 关于后选生城和上线计划，请按上线计划执行，有问题群里说。
pathId: 93e4109d85b5380fab48f556415ccbc466756d447402b61852516ce4b9af9d96
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s2
```

8.

```text
text: 关于后选生城和上线计化，请按上线计划执行，有问题群里说。
pathId: 93e4109d85b5380fab48f556415ccbc466756d447402b61852516ce4b9af9d96
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s3
```

9.

```text
text: 关于候选生城和上线计划，请按上线计划执行，有问题群里说。
pathId: 2ad765c2b868ddad2f2aacc904cdbbff13b3bd2676190675e265773ee4a9a6ab
bucketDomain: tech_ai
sourceSentenceId: p2_b0_s0
```

10.

```text
text: 关于候选生城和上线计化，请按上线计划执行，有问题群里说。
pathId: 2ad765c2b868ddad2f2aacc904cdbbff13b3bd2676190675e265773ee4a9a6ab
bucketDomain: tech_ai
sourceSentenceId: p2_b0_s1
```

11.

```text
text: 关于后选生城和上线计划，请按上线计划执行，有问题群里说。
pathId: 2ad765c2b868ddad2f2aacc904cdbbff13b3bd2676190675e265773ee4a9a6ab
bucketDomain: tech_ai
sourceSentenceId: p2_b0_s2
```

12.

```text
text: 关于后选生城和上线计化，请按上线计划执行，有问题群里说。
pathId: 2ad765c2b868ddad2f2aacc904cdbbff13b3bd2676190675e265773ee4a9a6ab
bucketDomain: tech_ai
sourceSentenceId: p2_b0_s3
```

13.

```text
text: 关于候选生城和上线计划，请按上线计划执行，有问题群里说。
pathId: 65aa4e3a49b767d4a16d0bb386a6f55fc3d2885c77f30fc1f8e5824bd3aebf0a
bucketDomain: tech_ai
sourceSentenceId: p3_b0_s0
```

14.

```text
text: 关于候选生城和上线计化，请按上线计划执行，有问题群里说。
pathId: 65aa4e3a49b767d4a16d0bb386a6f55fc3d2885c77f30fc1f8e5824bd3aebf0a
bucketDomain: tech_ai
sourceSentenceId: p3_b0_s1
```

15.

```text
text: 关于后选生城和上线计划，请按上线计划执行，有问题群里说。
pathId: 65aa4e3a49b767d4a16d0bb386a6f55fc3d2885c77f30fc1f8e5824bd3aebf0a
bucketDomain: tech_ai
sourceSentenceId: p3_b0_s2
```

16.

```text
text: 关于后选生城和上线计化，请按上线计划执行，有问题群里说。
pathId: 65aa4e3a49b767d4a16d0bb386a6f55fc3d2885c77f30fc1f8e5824bd3aebf0a
bucketDomain: tech_ai
sourceSentenceId: p3_b0_s3
```

### D. CrossPath Output

Count: 4

1.

```text
text: 关于候选生城和上线计划，请按上线计划执行，有问题群里说。
keptFromPath: 80d8d072c93bd03cae9cbb84c08e94e3da22d362211a19bb4e9529d389cfcbd9
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 关于候选生城和上线计化，请按上线计划执行，有问题群里说。
keptFromPath: 80d8d072c93bd03cae9cbb84c08e94e3da22d362211a19bb4e9529d389cfcbd9
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s1
```

3.

```text
text: 关于后选生城和上线计划，请按上线计划执行，有问题群里说。
keptFromPath: 80d8d072c93bd03cae9cbb84c08e94e3da22d362211a19bb4e9529d389cfcbd9
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s2
```

4.

```text
text: 关于后选生城和上线计化，请按上线计划执行，有问题群里说。
keptFromPath: 80d8d072c93bd03cae9cbb84c08e94e3da22d362211a19bb4e9529d389cfcbd9
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s3
```

### E. CrossPath 删除项

```text
Dropped Text: 关于候选生城和上线计划，请按上线计划执行，有问题群里说。
Source Sentence: p1_b0_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 关于候选生城和上线计划，请按上线计划执行，有问题群里说。
```

```text
Dropped Text: 关于候选生城和上线计化，请按上线计划执行，有问题群里说。
Source Sentence: p1_b0_s1
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 关于候选生城和上线计化，请按上线计划执行，有问题群里说。
```

```text
Dropped Text: 关于后选生城和上线计划，请按上线计划执行，有问题群里说。
Source Sentence: p1_b0_s2
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 关于后选生城和上线计划，请按上线计划执行，有问题群里说。
```

```text
Dropped Text: 关于后选生城和上线计化，请按上线计划执行，有问题群里说。
Source Sentence: p1_b0_s3
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 关于后选生城和上线计化，请按上线计划执行，有问题群里说。
```

```text
Dropped Text: 关于候选生城和上线计划，请按上线计划执行，有问题群里说。
Source Sentence: p2_b0_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 关于候选生城和上线计划，请按上线计划执行，有问题群里说。
```

```text
Dropped Text: 关于候选生城和上线计化，请按上线计划执行，有问题群里说。
Source Sentence: p2_b0_s1
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 关于候选生城和上线计化，请按上线计划执行，有问题群里说。
```

```text
Dropped Text: 关于后选生城和上线计划，请按上线计划执行，有问题群里说。
Source Sentence: p2_b0_s2
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 关于后选生城和上线计划，请按上线计划执行，有问题群里说。
```

```text
Dropped Text: 关于后选生城和上线计化，请按上线计划执行，有问题群里说。
Source Sentence: p2_b0_s3
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 关于后选生城和上线计化，请按上线计划执行，有问题群里说。
```

```text
Dropped Text: 关于候选生城和上线计划，请按上线计划执行，有问题群里说。
Source Sentence: p3_b0_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 关于候选生城和上线计划，请按上线计划执行，有问题群里说。
```

```text
Dropped Text: 关于候选生城和上线计化，请按上线计划执行，有问题群里说。
Source Sentence: p3_b0_s1
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 关于候选生城和上线计化，请按上线计划执行，有问题群里说。
```

```text
Dropped Text: 关于后选生城和上线计划，请按上线计划执行，有问题群里说。
Source Sentence: p3_b0_s2
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 关于后选生城和上线计划，请按上线计划执行，有问题群里说。
```

```text
Dropped Text: 关于后选生城和上线计化，请按上线计划执行，有问题群里说。
Source Sentence: p3_b0_s3
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 关于后选生城和上线计化，请按上线计划执行，有问题群里说。
```

### F. KenLM Input

KenLM Input Count: 4

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
关于候选生城和上线计划，请按上线计划执行，有问题群里说。
```

2.

```text
关于候选生城和上线计化，请按上线计划执行，有问题群里说。
```

3.

```text
关于后选生城和上线计划，请按上线计划执行，有问题群里说。
```

4.

```text
关于后选生城和上线计化，请按上线计划执行，有问题群里说。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"80d8d072c93bd03cae9cbb84c08e94e3da22d362211a19bb4e9529d389cfcbd9","bucketDomain":"tech_ai","count":4},{"pathId":"93e4109d85b5380fab48f556415ccbc466756d447402b61852516ce4b9af9d96","bucketDomain":"tech_ai","count":4},{"pathId":"2ad765c2b868ddad2f2aacc904cdbbff13b3bd2676190675e265773ee4a9a6ab","bucketDomain":"tech_ai","count":4},{"pathId":"65aa4e3a49b767d4a16d0bb386a6f55fc3d2885c77f30fc1f8e5824bd3aebf0a","bucketDomain":"tech_ai","count":4}]
crossPathInputCount: 16
crossPathOutputCount: 4
kenlmInputCount: 4
CrossPath Input == Assembly total: YES (16 vs 16)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d046

<a id="case-d046"></a>

### Case 基础信息

```text
Case ID: d046
Raw Text: 你好，我想点一杯卡布奇诺，中杯，正常糖。顺便问一下今天有芝士蛋糕吗？
Path Count: 4
Bucket Count: 6
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `dd88f4c1999c8c4a6dc2a146d96c228be385aecd3ea8f0fe1fd2abf72a4966b1`

Bucket: `coffee` (`p0_b0`)

Assembly Sentences:

1.

```text
你好，我想点一杯卡布奇诺，中杯，正常糖。顺便问一下今天有芝士蛋糕吗？
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 6.7475000000000005

#### Path: `dd88f4c1999c8c4a6dc2a146d96c228be385aecd3ea8f0fe1fd2abf72a4966b1`

Bucket: `milk_tea` (`p0_b1`)

Assembly Sentences:

1.

```text
你好，我想点一杯卡布奇诺，中杯，正常糖。顺便问一下今天有芝士蛋糕吗？
```

- sentenceId: `p0_b1_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 6.7475000000000005

#### Path: `704f98b82a57f8aa19f954c6a5b2d95560dbc90e65e43a6e72fc56256c16c5ab`

Bucket: `coffee` (`p1_b0`)

Assembly Sentences:

1.

```text
你好，我想点一杯卡布奇诺，中杯，正常糖。顺便问一下今天有芝士蛋糕吗？
```

- sentenceId: `p1_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 6.7475000000000005

#### Path: `f25c790ab3feecb08234a9eb9296f94b017f8b895a73a294adf352766678e47d`

Bucket: `coffee` (`p2_b0`)

Assembly Sentences:

1.

```text
你好，我想点一杯卡布奇诺，中杯，正常糖。顺便问一下今天有芝士蛋糕吗？
```

- sentenceId: `p2_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 8.753499999999999

#### Path: `f25c790ab3feecb08234a9eb9296f94b017f8b895a73a294adf352766678e47d`

Bucket: `milk_tea` (`p2_b1`)

Assembly Sentences:

1.

```text
你好，我想点一杯卡布奇诺，中杯，正常糖。顺便问一下今天有芝士蛋糕吗？
```

- sentenceId: `p2_b1_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 6.7475000000000005

#### Path: `b381ed15660cc47935a5acdc3d6802646a22eae9a515096a636b6002db634b39`

Bucket: `coffee` (`p3_b0`)

Assembly Sentences:

1.

```text
你好，我想点一杯卡布奇诺，中杯，正常糖。顺便问一下今天有芝士蛋糕吗？
```

- sentenceId: `p3_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 8.753499999999999

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 6

1.

```text
text: 你好，我想点一杯卡布奇诺，中杯，正常糖。顺便问一下今天有芝士蛋糕吗？
pathId: dd88f4c1999c8c4a6dc2a146d96c228be385aecd3ea8f0fe1fd2abf72a4966b1
bucketDomain: coffee
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 你好，我想点一杯卡布奇诺，中杯，正常糖。顺便问一下今天有芝士蛋糕吗？
pathId: dd88f4c1999c8c4a6dc2a146d96c228be385aecd3ea8f0fe1fd2abf72a4966b1
bucketDomain: milk_tea
sourceSentenceId: p0_b1_s0
```

3.

```text
text: 你好，我想点一杯卡布奇诺，中杯，正常糖。顺便问一下今天有芝士蛋糕吗？
pathId: 704f98b82a57f8aa19f954c6a5b2d95560dbc90e65e43a6e72fc56256c16c5ab
bucketDomain: coffee
sourceSentenceId: p1_b0_s0
```

4.

```text
text: 你好，我想点一杯卡布奇诺，中杯，正常糖。顺便问一下今天有芝士蛋糕吗？
pathId: f25c790ab3feecb08234a9eb9296f94b017f8b895a73a294adf352766678e47d
bucketDomain: coffee
sourceSentenceId: p2_b0_s0
```

5.

```text
text: 你好，我想点一杯卡布奇诺，中杯，正常糖。顺便问一下今天有芝士蛋糕吗？
pathId: f25c790ab3feecb08234a9eb9296f94b017f8b895a73a294adf352766678e47d
bucketDomain: milk_tea
sourceSentenceId: p2_b1_s0
```

6.

```text
text: 你好，我想点一杯卡布奇诺，中杯，正常糖。顺便问一下今天有芝士蛋糕吗？
pathId: b381ed15660cc47935a5acdc3d6802646a22eae9a515096a636b6002db634b39
bucketDomain: coffee
sourceSentenceId: p3_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 你好，我想点一杯卡布奇诺，中杯，正常糖。顺便问一下今天有芝士蛋糕吗？
keptFromPath: dd88f4c1999c8c4a6dc2a146d96c228be385aecd3ea8f0fe1fd2abf72a4966b1
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

```text
Dropped Text: 你好，我想点一杯卡布奇诺，中杯，正常糖。顺便问一下今天有芝士蛋糕吗？
Source Sentence: p0_b1_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 你好，我想点一杯卡布奇诺，中杯，正常糖。顺便问一下今天有芝士蛋糕吗？
```

```text
Dropped Text: 你好，我想点一杯卡布奇诺，中杯，正常糖。顺便问一下今天有芝士蛋糕吗？
Source Sentence: p1_b0_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 你好，我想点一杯卡布奇诺，中杯，正常糖。顺便问一下今天有芝士蛋糕吗？
```

```text
Dropped Text: 你好，我想点一杯卡布奇诺，中杯，正常糖。顺便问一下今天有芝士蛋糕吗？
Source Sentence: p2_b0_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 你好，我想点一杯卡布奇诺，中杯，正常糖。顺便问一下今天有芝士蛋糕吗？
```

```text
Dropped Text: 你好，我想点一杯卡布奇诺，中杯，正常糖。顺便问一下今天有芝士蛋糕吗？
Source Sentence: p2_b1_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 你好，我想点一杯卡布奇诺，中杯，正常糖。顺便问一下今天有芝士蛋糕吗？
```

```text
Dropped Text: 你好，我想点一杯卡布奇诺，中杯，正常糖。顺便问一下今天有芝士蛋糕吗？
Source Sentence: p3_b0_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 你好，我想点一杯卡布奇诺，中杯，正常糖。顺便问一下今天有芝士蛋糕吗？
```

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
你好，我想点一杯卡布奇诺，中杯，正常糖。顺便问一下今天有芝士蛋糕吗？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"dd88f4c1999c8c4a6dc2a146d96c228be385aecd3ea8f0fe1fd2abf72a4966b1","bucketDomain":"coffee","count":1},{"pathId":"dd88f4c1999c8c4a6dc2a146d96c228be385aecd3ea8f0fe1fd2abf72a4966b1","bucketDomain":"milk_tea","count":1},{"pathId":"704f98b82a57f8aa19f954c6a5b2d95560dbc90e65e43a6e72fc56256c16c5ab","bucketDomain":"coffee","count":1},{"pathId":"f25c790ab3feecb08234a9eb9296f94b017f8b895a73a294adf352766678e47d","bucketDomain":"coffee","count":1},{"pathId":"f25c790ab3feecb08234a9eb9296f94b017f8b895a73a294adf352766678e47d","bucketDomain":"milk_tea","count":1},{"pathId":"b381ed15660cc47935a5acdc3d6802646a22eae9a515096a636b6002db634b39","bucketDomain":"coffee","count":1}]
crossPathInputCount: 6
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (6 vs 6)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d047

<a id="case-d047"></a>

### Case 基础信息

```text
Case ID: d047
Raw Text: 麻烦帮我做一杯红茶带走，大杯就行，谢谢。
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `867a50d5d8c7de1e31ac489575a564e7821f7fb90f30c806fe07ede6f7d3e562`

Bucket: `milk_tea` (`p0_b0`)

Assembly Sentences:

1.

```text
麻烦帮我做一杯红茶带走，大杯就行，谢谢。
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 7.09

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 麻烦帮我做一杯红茶带走，大杯就行，谢谢。
pathId: 867a50d5d8c7de1e31ac489575a564e7821f7fb90f30c806fe07ede6f7d3e562
bucketDomain: milk_tea
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 麻烦帮我做一杯红茶带走，大杯就行，谢谢。
keptFromPath: 867a50d5d8c7de1e31ac489575a564e7821f7fb90f30c806fe07ede6f7d3e562
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
麻烦帮我做一杯红茶带走，大杯就行，谢谢。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"867a50d5d8c7de1e31ac489575a564e7821f7fb90f30c806fe07ede6f7d3e562","bucketDomain":"milk_tea","count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d048

<a id="case-d048"></a>

### Case 基础信息

```text
Case ID: d048
Raw Text: 请问这款热巧克力可以少冰吗？我赶时间，小杯。
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `c0c12254e0997270a617b73b67642b820f52208b1f604c672cf01739be7a81dc`

Bucket: `coffee` (`p0_b0`)

Assembly Sentences:

1.

```text
请问这款热巧克力可以少冰吗？我赶时间，小杯。
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 6.765999999999999

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 请问这款热巧克力可以少冰吗？我赶时间，小杯。
pathId: c0c12254e0997270a617b73b67642b820f52208b1f604c672cf01739be7a81dc
bucketDomain: coffee
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 请问这款热巧克力可以少冰吗？我赶时间，小杯。
keptFromPath: c0c12254e0997270a617b73b67642b820f52208b1f604c672cf01739be7a81dc
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
请问这款热巧克力可以少冰吗？我赶时间，小杯。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"c0c12254e0997270a617b73b67642b820f52208b1f604c672cf01739be7a81dc","bucketDomain":"coffee","count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d049

<a id="case-d049"></a>

### Case 基础信息

```text
Case ID: d049
Raw Text: 李工，客户反馈翻译引擎接口报错，我们能不能加缓存，下午三点前把结论发群里？
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `192b84f072ea72e5bfc1e646510978c24cb4fc1275c9fb642895892d1fab1c0a`

Bucket: `tech_ai` (`p0_b0`)

Assembly Sentences:

1.

```text
李工，客户反馈翻译引擎接口报错，我们能不能加缓存，下午三点前把结论发群里？
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 9.54

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 李工，客户反馈翻译引擎接口报错，我们能不能加缓存，下午三点前把结论发群里？
pathId: 192b84f072ea72e5bfc1e646510978c24cb4fc1275c9fb642895892d1fab1c0a
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 李工，客户反馈翻译引擎接口报错，我们能不能加缓存，下午三点前把结论发群里？
keptFromPath: 192b84f072ea72e5bfc1e646510978c24cb4fc1275c9fb642895892d1fab1c0a
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
李工，客户反馈翻译引擎接口报错，我们能不能加缓存，下午三点前把结论发群里？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"192b84f072ea72e5bfc1e646510978c24cb4fc1275c9fb642895892d1fab1c0a","bucketDomain":"tech_ai","count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d050

<a id="case-d050"></a>

### Case 基础信息

```text
Case ID: d050
Raw Text: 今天的站会先过一下订单中台进度，内存占用高这块需要限流保护，大家看一下风险。
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `1818371cb2a90c789c7b281c3cc36a23715bfc08e3164930fe2034ce6bc0785f`

Bucket: `food_order` (`p0_b0`)

Assembly Sentences:

1.

```text
今天的站会先过一下订单中台进度，内存占用高这块需要限流保护，大家看一下风险。
```

- sentenceId: `p0_b0_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.4

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 今天的站会先过一下订单中台进度，内存占用高这块需要限流保护，大家看一下风险。
pathId: 1818371cb2a90c789c7b281c3cc36a23715bfc08e3164930fe2034ce6bc0785f
bucketDomain: food_order
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 今天的站会先过一下订单中台进度，内存占用高这块需要限流保护，大家看一下风险。
keptFromPath: 1818371cb2a90c789c7b281c3cc36a23715bfc08e3164930fe2034ce6bc0785f
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
今天的站会先过一下订单中台进度，内存占用高这块需要限流保护，大家看一下风险。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"1818371cb2a90c789c7b281c3cc36a23715bfc08e3164930fe2034ce6bc0785f","bucketDomain":"food_order","count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d051

<a id="case-d051"></a>

### Case 基础信息

```text
Case ID: d051
Raw Text: 跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。
Path Count: 1
Bucket Count: 3
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `54a9f07e03af142eb5a06f0dd3e6a30fb09f82b47cd652dc08d575fdfc606551`

Bucket: `food_order` (`p0_b0`)

Assembly Sentences:

1.

```text
跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。
```

- sentenceId: `p0_b0_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

#### Path: `54a9f07e03af142eb5a06f0dd3e6a30fb09f82b47cd652dc08d575fdfc606551`

Bucket: `meeting` (`p0_b1`)

Assembly Sentences:

1.

```text
跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。
```

- sentenceId: `p0_b1_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

#### Path: `54a9f07e03af142eb5a06f0dd3e6a30fb09f82b47cd652dc08d575fdfc606551`

Bucket: `tech_ai` (`p0_b2`)

Assembly Sentences:

1.

```text
跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。
```

- sentenceId: `p0_b2_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 3

1.

```text
text: 跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。
pathId: 54a9f07e03af142eb5a06f0dd3e6a30fb09f82b47cd652dc08d575fdfc606551
bucketDomain: food_order
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。
pathId: 54a9f07e03af142eb5a06f0dd3e6a30fb09f82b47cd652dc08d575fdfc606551
bucketDomain: meeting
sourceSentenceId: p0_b1_s0
```

3.

```text
text: 跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。
pathId: 54a9f07e03af142eb5a06f0dd3e6a30fb09f82b47cd652dc08d575fdfc606551
bucketDomain: tech_ai
sourceSentenceId: p0_b2_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。
keptFromPath: 54a9f07e03af142eb5a06f0dd3e6a30fb09f82b47cd652dc08d575fdfc606551
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

```text
Dropped Text: 跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。
Source Sentence: p0_b1_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。
```

```text
Dropped Text: 跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。
Source Sentence: p0_b2_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。
```

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"54a9f07e03af142eb5a06f0dd3e6a30fb09f82b47cd652dc08d575fdfc606551","bucketDomain":"food_order","count":1},{"pathId":"54a9f07e03af142eb5a06f0dd3e6a30fb09f82b47cd652dc08d575fdfc606551","bucketDomain":"meeting","count":1},{"pathId":"54a9f07e03af142eb5a06f0dd3e6a30fb09f82b47cd652dc08d575fdfc606551","bucketDomain":"tech_ai","count":1}]
crossPathInputCount: 3
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (3 vs 3)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d052

<a id="case-d052"></a>

### Case 基础信息

```text
Case ID: d052
Raw Text: 师傅，去浦东张江，走延安路高架。我赶九点半的会，要是堵车您提前跟我说。
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `1fa6f44c10ea630f22077eff5e99ef223b66230c700d442b225df5881d5fc281`

Bucket: `tourism_hotel` (`p0_b0`)

Assembly Sentences:

1.

```text
师傅，去浦东张江，走延安路高架。我赶酒店半的会，要是堵车您提前跟我说。
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 4.72

2.

```text
师傅，去浦东张江，走延安路高架。我赶九点半的会，要是堵车您提前跟我说。
```

- sentenceId: `p0_b0_s1`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 2
- assemblyScore: 2.36

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 2

1.

```text
text: 师傅，去浦东张江，走延安路高架。我赶酒店半的会，要是堵车您提前跟我说。
pathId: 1fa6f44c10ea630f22077eff5e99ef223b66230c700d442b225df5881d5fc281
bucketDomain: tourism_hotel
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 师傅，去浦东张江，走延安路高架。我赶九点半的会，要是堵车您提前跟我说。
pathId: 1fa6f44c10ea630f22077eff5e99ef223b66230c700d442b225df5881d5fc281
bucketDomain: tourism_hotel
sourceSentenceId: p0_b0_s1
```

### D. CrossPath Output

Count: 2

1.

```text
text: 师傅，去浦东张江，走延安路高架。我赶酒店半的会，要是堵车您提前跟我说。
keptFromPath: 1fa6f44c10ea630f22077eff5e99ef223b66230c700d442b225df5881d5fc281
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 师傅，去浦东张江，走延安路高架。我赶九点半的会，要是堵车您提前跟我说。
keptFromPath: 1fa6f44c10ea630f22077eff5e99ef223b66230c700d442b225df5881d5fc281
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s1
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 2

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
师傅，去浦东张江，走延安路高架。我赶酒店半的会，要是堵车您提前跟我说。
```

2.

```text
师傅，去浦东张江，走延安路高架。我赶九点半的会，要是堵车您提前跟我说。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"1fa6f44c10ea630f22077eff5e99ef223b66230c700d442b225df5881d5fc281","bucketDomain":"tourism_hotel","count":2}]
crossPathInputCount: 2
crossPathOutputCount: 2
kenlmInputCount: 2
CrossPath Input == Assembly total: YES (2 vs 2)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d053

<a id="case-d053"></a>

### Case 基础信息

```text
Case ID: d053
Raw Text: 麻烦送我到深圳南山科技园南门，大概多久能到？我十点十分有个电话会。
Path Count: 1
Bucket Count: 2
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `d9e028c3cf0bd38c6f8f20b22181fa312da5899e1b990b73516f687aa58fee57`

Bucket: `meeting` (`p0_b0`)

Assembly Sentences:

1.

```text
麻烦送我到深圳南山科记员南门，大概多久能到？我十点十分有个电话会。
```

- sentenceId: `p0_b0_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

2.

```text
麻烦送我到深圳南山科技园南门，大概多久能到？我十点十分有个电话会。
```

- sentenceId: `p0_b0_s1`
- category: `RAW_ORIGINAL`
- assemblyRank: 2
- assemblyScore: 0

#### Path: `d9e028c3cf0bd38c6f8f20b22181fa312da5899e1b990b73516f687aa58fee57`

Bucket: `tourism_pickup` (`p0_b1`)

Assembly Sentences:

1.

```text
麻烦送我到深圳南山科机员南门，大概多久能到？我十点十分有个电话会。
```

- sentenceId: `p0_b1_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

2.

```text
麻烦送我到深圳南山科技园南门，大概多久能到？我十点十分有个电话会。
```

- sentenceId: `p0_b1_s1`
- category: `RAW_ORIGINAL`
- assemblyRank: 2
- assemblyScore: 0

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 4

1.

```text
text: 麻烦送我到深圳南山科记员南门，大概多久能到？我十点十分有个电话会。
pathId: d9e028c3cf0bd38c6f8f20b22181fa312da5899e1b990b73516f687aa58fee57
bucketDomain: meeting
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 麻烦送我到深圳南山科技园南门，大概多久能到？我十点十分有个电话会。
pathId: d9e028c3cf0bd38c6f8f20b22181fa312da5899e1b990b73516f687aa58fee57
bucketDomain: meeting
sourceSentenceId: p0_b0_s1
```

3.

```text
text: 麻烦送我到深圳南山科机员南门，大概多久能到？我十点十分有个电话会。
pathId: d9e028c3cf0bd38c6f8f20b22181fa312da5899e1b990b73516f687aa58fee57
bucketDomain: tourism_pickup
sourceSentenceId: p0_b1_s0
```

4.

```text
text: 麻烦送我到深圳南山科技园南门，大概多久能到？我十点十分有个电话会。
pathId: d9e028c3cf0bd38c6f8f20b22181fa312da5899e1b990b73516f687aa58fee57
bucketDomain: tourism_pickup
sourceSentenceId: p0_b1_s1
```

### D. CrossPath Output

Count: 3

1.

```text
text: 麻烦送我到深圳南山科记员南门，大概多久能到？我十点十分有个电话会。
keptFromPath: d9e028c3cf0bd38c6f8f20b22181fa312da5899e1b990b73516f687aa58fee57
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 麻烦送我到深圳南山科技园南门，大概多久能到？我十点十分有个电话会。
keptFromPath: d9e028c3cf0bd38c6f8f20b22181fa312da5899e1b990b73516f687aa58fee57
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s1
```

3.

```text
text: 麻烦送我到深圳南山科机员南门，大概多久能到？我十点十分有个电话会。
keptFromPath: d9e028c3cf0bd38c6f8f20b22181fa312da5899e1b990b73516f687aa58fee57
keptFromBucket: p0_b1
sourceSentenceId: p0_b1_s0
```

### E. CrossPath 删除项

```text
Dropped Text: 麻烦送我到深圳南山科技园南门，大概多久能到？我十点十分有个电话会。
Source Sentence: p0_b1_s1
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 麻烦送我到深圳南山科技园南门，大概多久能到？我十点十分有个电话会。
```

### F. KenLM Input

KenLM Input Count: 3

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
麻烦送我到深圳南山科记员南门，大概多久能到？我十点十分有个电话会。
```

2.

```text
麻烦送我到深圳南山科技园南门，大概多久能到？我十点十分有个电话会。
```

3.

```text
麻烦送我到深圳南山科机员南门，大概多久能到？我十点十分有个电话会。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"d9e028c3cf0bd38c6f8f20b22181fa312da5899e1b990b73516f687aa58fee57","bucketDomain":"meeting","count":2},{"pathId":"d9e028c3cf0bd38c6f8f20b22181fa312da5899e1b990b73516f687aa58fee57","bucketDomain":"tourism_pickup","count":2}]
crossPathInputCount: 4
crossPathOutputCount: 3
kenlmInputCount: 3
CrossPath Input == Assembly total: YES (4 vs 4)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d054

<a id="case-d054"></a>

### Case 基础信息

```text
Case ID: d054
Raw Text: 去杭州西溪，不走三环可以吗？那边现在堵不堵？
Path Count: 1
Bucket Count: 2
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `ab4e09381d1743d1b906dc96cb06dfa63703940f9d50a6e270ce20b4e312fe26`

Bucket: `medical` (`p0_b0`)

Assembly Sentences:

1.

```text
去杭州西溪，不走三环科医吗？那边现在堵不堵？
```

- sentenceId: `p0_b0_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

2.

```text
去杭州西溪，不走三环可以吗？那边现在堵不堵？
```

- sentenceId: `p0_b0_s1`
- category: `RAW_ORIGINAL`
- assemblyRank: 2
- assemblyScore: 0

#### Path: `ab4e09381d1743d1b906dc96cb06dfa63703940f9d50a6e270ce20b4e312fe26`

Bucket: `milk_tea` (`p0_b1`)

Assembly Sentences:

1.

```text
去杭州细吸，不走三环可以吗？那边现在堵不堵？
```

- sentenceId: `p0_b1_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

2.

```text
去杭州西溪，不走三环可以吗？那边现在堵不堵？
```

- sentenceId: `p0_b1_s1`
- category: `RAW_ORIGINAL`
- assemblyRank: 2
- assemblyScore: 0

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 4

1.

```text
text: 去杭州西溪，不走三环科医吗？那边现在堵不堵？
pathId: ab4e09381d1743d1b906dc96cb06dfa63703940f9d50a6e270ce20b4e312fe26
bucketDomain: medical
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 去杭州西溪，不走三环可以吗？那边现在堵不堵？
pathId: ab4e09381d1743d1b906dc96cb06dfa63703940f9d50a6e270ce20b4e312fe26
bucketDomain: medical
sourceSentenceId: p0_b0_s1
```

3.

```text
text: 去杭州细吸，不走三环可以吗？那边现在堵不堵？
pathId: ab4e09381d1743d1b906dc96cb06dfa63703940f9d50a6e270ce20b4e312fe26
bucketDomain: milk_tea
sourceSentenceId: p0_b1_s0
```

4.

```text
text: 去杭州西溪，不走三环可以吗？那边现在堵不堵？
pathId: ab4e09381d1743d1b906dc96cb06dfa63703940f9d50a6e270ce20b4e312fe26
bucketDomain: milk_tea
sourceSentenceId: p0_b1_s1
```

### D. CrossPath Output

Count: 3

1.

```text
text: 去杭州西溪，不走三环科医吗？那边现在堵不堵？
keptFromPath: ab4e09381d1743d1b906dc96cb06dfa63703940f9d50a6e270ce20b4e312fe26
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 去杭州西溪，不走三环可以吗？那边现在堵不堵？
keptFromPath: ab4e09381d1743d1b906dc96cb06dfa63703940f9d50a6e270ce20b4e312fe26
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s1
```

3.

```text
text: 去杭州细吸，不走三环可以吗？那边现在堵不堵？
keptFromPath: ab4e09381d1743d1b906dc96cb06dfa63703940f9d50a6e270ce20b4e312fe26
keptFromBucket: p0_b1
sourceSentenceId: p0_b1_s0
```

### E. CrossPath 删除项

```text
Dropped Text: 去杭州西溪，不走三环可以吗？那边现在堵不堵？
Source Sentence: p0_b1_s1
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 去杭州西溪，不走三环可以吗？那边现在堵不堵？
```

### F. KenLM Input

KenLM Input Count: 3

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
去杭州西溪，不走三环科医吗？那边现在堵不堵？
```

2.

```text
去杭州西溪，不走三环可以吗？那边现在堵不堵？
```

3.

```text
去杭州细吸，不走三环可以吗？那边现在堵不堵？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"ab4e09381d1743d1b906dc96cb06dfa63703940f9d50a6e270ce20b4e312fe26","bucketDomain":"medical","count":2},{"pathId":"ab4e09381d1743d1b906dc96cb06dfa63703940f9d50a6e270ce20b4e312fe26","bucketDomain":"milk_tea","count":2}]
crossPathInputCount: 4
crossPathOutputCount: 3
kenlmInputCount: 3
CrossPath Input == Assembly total: YES (4 vs 4)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d055

<a id="case-d055"></a>

### Case 基础信息

```text
Case ID: d055
Raw Text: 医生您好，我这两天嗓子疼，想开点药并做个血常规。
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `923d94355096126318cedf6dfb5d3a1ef742de3f254782f57c69e51220363c96`

Bucket: `medical` (`p0_b0`)

Assembly Sentences:

1.

```text
医生您好，我这两天嗓子疼，想开点药并做个血常规。
```

- sentenceId: `p0_b0_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 医生您好，我这两天嗓子疼，想开点药并做个血常规。
pathId: 923d94355096126318cedf6dfb5d3a1ef742de3f254782f57c69e51220363c96
bucketDomain: medical
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 医生您好，我这两天嗓子疼，想开点药并做个血常规。
keptFromPath: 923d94355096126318cedf6dfb5d3a1ef742de3f254782f57c69e51220363c96
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
医生您好，我这两天嗓子疼，想开点药并做个血常规。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"923d94355096126318cedf6dfb5d3a1ef742de3f254782f57c69e51220363c96","bucketDomain":"medical","count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d056

<a id="case-d056"></a>

### Case 基础信息

```text
Case ID: d056
Raw Text: 挂号处请问内科还有号吗？我低烧，昨晚开始的。
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `64083fb1626180a51550a2e8a10bae9e4241146dd0293d64ec0354cb5447e5d1`

Bucket: `medical` (`p0_b0`)

Assembly Sentences:

1.

```text
挂号处请问内科还有号吗？我低烧，昨晚开始的。
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 4.71

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 挂号处请问内科还有号吗？我低烧，昨晚开始的。
pathId: 64083fb1626180a51550a2e8a10bae9e4241146dd0293d64ec0354cb5447e5d1
bucketDomain: medical
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 挂号处请问内科还有号吗？我低烧，昨晚开始的。
keptFromPath: 64083fb1626180a51550a2e8a10bae9e4241146dd0293d64ec0354cb5447e5d1
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
挂号处请问内科还有号吗？我低烧，昨晚开始的。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"64083fb1626180a51550a2e8a10bae9e4241146dd0293d64ec0354cb5447e5d1","bucketDomain":"medical","count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d057

<a id="case-d057"></a>

### Case 基础信息

```text
Case ID: d057
Raw Text: 这个检查报告什么时候能出？我咳嗽，需要请假休息吗？
Path Count: 1
Bucket Count: 2
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `b6dd9bf159bd6f37accf48512c1d3b164dd9bdb60d1a18d5053e700f027ebaea`

Bucket: `medical` (`p0_b0`)

Assembly Sentences:

1.

```text
这个检查报告什么时候能出？我咳嗽，需要请假休息吗？
```

- sentenceId: `p0_b0_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.35

#### Path: `b6dd9bf159bd6f37accf48512c1d3b164dd9bdb60d1a18d5053e700f027ebaea`

Bucket: `tech_ai` (`p0_b1`)

Assembly Sentences:

1.

```text
这个检查报告什么时候能出？我咳嗽，需要请假休息吗？
```

- sentenceId: `p0_b1_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 2

1.

```text
text: 这个检查报告什么时候能出？我咳嗽，需要请假休息吗？
pathId: b6dd9bf159bd6f37accf48512c1d3b164dd9bdb60d1a18d5053e700f027ebaea
bucketDomain: medical
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 这个检查报告什么时候能出？我咳嗽，需要请假休息吗？
pathId: b6dd9bf159bd6f37accf48512c1d3b164dd9bdb60d1a18d5053e700f027ebaea
bucketDomain: tech_ai
sourceSentenceId: p0_b1_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 这个检查报告什么时候能出？我咳嗽，需要请假休息吗？
keptFromPath: b6dd9bf159bd6f37accf48512c1d3b164dd9bdb60d1a18d5053e700f027ebaea
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

```text
Dropped Text: 这个检查报告什么时候能出？我咳嗽，需要请假休息吗？
Source Sentence: p0_b1_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 这个检查报告什么时候能出？我咳嗽，需要请假休息吗？
```

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
这个检查报告什么时候能出？我咳嗽，需要请假休息吗？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"b6dd9bf159bd6f37accf48512c1d3b164dd9bdb60d1a18d5053e700f027ebaea","bucketDomain":"medical","count":1},{"pathId":"b6dd9bf159bd6f37accf48512c1d3b164dd9bdb60d1a18d5053e700f027ebaea","bucketDomain":"tech_ai","count":1}]
crossPathInputCount: 2
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (2 vs 2)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d058

<a id="case-d058"></a>

### Case 基础信息

```text
Case ID: d058
Raw Text: 这件外套能试穿吗？我穿中码。买两件有没有折扣？
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `bf0502a46c3d5c83e4576c1730ccf54b973d21032960d5f734d5d84962bf783f`

Bucket: `tech_ai` (`p0_b0`)

Assembly Sentences:

1.

```text
这件外套能试穿吗？我穿中码。买量检有没有折扣？
```

- sentenceId: `p0_b0_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

2.

```text
这件外套能试穿吗？我穿中码。买两件有没有折扣？
```

- sentenceId: `p0_b0_s1`
- category: `RAW_ORIGINAL`
- assemblyRank: 2
- assemblyScore: 0

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 2

1.

```text
text: 这件外套能试穿吗？我穿中码。买量检有没有折扣？
pathId: bf0502a46c3d5c83e4576c1730ccf54b973d21032960d5f734d5d84962bf783f
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 这件外套能试穿吗？我穿中码。买两件有没有折扣？
pathId: bf0502a46c3d5c83e4576c1730ccf54b973d21032960d5f734d5d84962bf783f
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s1
```

### D. CrossPath Output

Count: 2

1.

```text
text: 这件外套能试穿吗？我穿中码。买量检有没有折扣？
keptFromPath: bf0502a46c3d5c83e4576c1730ccf54b973d21032960d5f734d5d84962bf783f
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 这件外套能试穿吗？我穿中码。买两件有没有折扣？
keptFromPath: bf0502a46c3d5c83e4576c1730ccf54b973d21032960d5f734d5d84962bf783f
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s1
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 2

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
这件外套能试穿吗？我穿中码。买量检有没有折扣？
```

2.

```text
这件外套能试穿吗？我穿中码。买两件有没有折扣？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"bf0502a46c3d5c83e4576c1730ccf54b973d21032960d5f734d5d84962bf783f","bucketDomain":"tech_ai","count":2}]
crossPathInputCount: 2
crossPathOutputCount: 2
kenlmInputCount: 2
CrossPath Input == Assembly total: YES (2 vs 2)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d059

<a id="case-d059"></a>

### Case 基础信息

```text
Case ID: d059
Raw Text: 请问这双鞋有四十码吗？不合适三天内可以退换吧？
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `273cfbaf61f2e19636f9a795cf32d7cfe4b6575d1affcccfa8a8ee4e6eb56721`

Bucket: `medical` (`p0_b0`)

Assembly Sentences:

1.

```text
请问这双鞋有四十码吗？不合适三天内科医退换吧？
```

- sentenceId: `p0_b0_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

2.

```text
请问这双鞋有四十码吗？不合适三天内可以退换吧？
```

- sentenceId: `p0_b0_s1`
- category: `RAW_ORIGINAL`
- assemblyRank: 2
- assemblyScore: 0

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 2

1.

```text
text: 请问这双鞋有四十码吗？不合适三天内科医退换吧？
pathId: 273cfbaf61f2e19636f9a795cf32d7cfe4b6575d1affcccfa8a8ee4e6eb56721
bucketDomain: medical
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 请问这双鞋有四十码吗？不合适三天内可以退换吧？
pathId: 273cfbaf61f2e19636f9a795cf32d7cfe4b6575d1affcccfa8a8ee4e6eb56721
bucketDomain: medical
sourceSentenceId: p0_b0_s1
```

### D. CrossPath Output

Count: 2

1.

```text
text: 请问这双鞋有四十码吗？不合适三天内科医退换吧？
keptFromPath: 273cfbaf61f2e19636f9a795cf32d7cfe4b6575d1affcccfa8a8ee4e6eb56721
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 请问这双鞋有四十码吗？不合适三天内可以退换吧？
keptFromPath: 273cfbaf61f2e19636f9a795cf32d7cfe4b6575d1affcccfa8a8ee4e6eb56721
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s1
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 2

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
请问这双鞋有四十码吗？不合适三天内科医退换吧？
```

2.

```text
请问这双鞋有四十码吗？不合适三天内可以退换吧？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"273cfbaf61f2e19636f9a795cf32d7cfe4b6575d1affcccfa8a8ee4e6eb56721","bucketDomain":"medical","count":2}]
crossPathInputCount: 2
crossPathOutputCount: 2
kenlmInputCount: 2
CrossPath Input == Assembly total: YES (2 vs 2)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d060

<a id="case-d060"></a>

### Case 基础信息

```text
Case ID: d060
Raw Text: 我想对比一下这两款订单中台的价格，会员日能再减一点吗？
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `72d46d6d27ed168a2b446ccc0ef5ca29e9e538e6e0e94d9ab712448785bc00fc`

Bucket: `food_order` (`p0_b0`)

Assembly Sentences:

1.

```text
我想对比一下这两款订单中台的价格，会员日能再减一点吗？
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 4.76

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 我想对比一下这两款订单中台的价格，会员日能再减一点吗？
pathId: 72d46d6d27ed168a2b446ccc0ef5ca29e9e538e6e0e94d9ab712448785bc00fc
bucketDomain: food_order
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 我想对比一下这两款订单中台的价格，会员日能再减一点吗？
keptFromPath: 72d46d6d27ed168a2b446ccc0ef5ca29e9e538e6e0e94d9ab712448785bc00fc
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
我想对比一下这两款订单中台的价格，会员日能再减一点吗？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"72d46d6d27ed168a2b446ccc0ef5ca29e9e538e6e0e94d9ab712448785bc00fc","bucketDomain":"food_order","count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d061

<a id="case-d061"></a>

### Case 基础信息

```text
Case ID: d061
Raw Text: 周末要不要去江边骑行？天气预报说周日多云，记得带水。
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `ef362a7409d257efe1af2da13a738a0d169e7c13cebf78fc693f2e600087c365`

Bucket: `null` (`p0_b0`)

Assembly Sentences:

1.

```text
周末要不要去江边骑行？天气预报说周日多云，记得带水。
```

- sentenceId: `p0_b0_s0`
- category: `RAW_ORIGINAL`
- assemblyRank: 1
- assemblyScore: 0

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 周末要不要去江边骑行？天气预报说周日多云，记得带水。
pathId: ef362a7409d257efe1af2da13a738a0d169e7c13cebf78fc693f2e600087c365
bucketDomain: null
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 周末要不要去江边骑行？天气预报说周日多云，记得带水。
keptFromPath: ef362a7409d257efe1af2da13a738a0d169e7c13cebf78fc693f2e600087c365
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
周末要不要去江边骑行？天气预报说周日多云，记得带水。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"ef362a7409d257efe1af2da13a738a0d169e7c13cebf78fc693f2e600087c365","bucketDomain":null,"count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d062

<a id="case-d062"></a>

### Case 基础信息

```text
Case ID: d062
Raw Text: 晚上一起吃饭吗？我知道一家川菜不错，大概七点到。
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `37367286bf78ef457c58421ac1cc51772b81498372ff6046875c912bacb0a3ca`

Bucket: `null` (`p0_b0`)

Assembly Sentences:

1.

```text
晚上一起吃饭吗？我知道一家川菜不错，大概七点到。
```

- sentenceId: `p0_b0_s0`
- category: `RAW_ORIGINAL`
- assemblyRank: 1
- assemblyScore: 0

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 晚上一起吃饭吗？我知道一家川菜不错，大概七点到。
pathId: 37367286bf78ef457c58421ac1cc51772b81498372ff6046875c912bacb0a3ca
bucketDomain: null
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 晚上一起吃饭吗？我知道一家川菜不错，大概七点到。
keptFromPath: 37367286bf78ef457c58421ac1cc51772b81498372ff6046875c912bacb0a3ca
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
晚上一起吃饭吗？我知道一家川菜不错，大概七点到。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"37367286bf78ef457c58421ac1cc51772b81498372ff6046875c912bacb0a3ca","bucketDomain":null,"count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d063

<a id="case-d063"></a>

### Case 基础信息

```text
Case ID: d063
Raw Text: 你最近忙不忙？想找你看下手机备份怎么设置。
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `8abbc76111de7c632d7d17362fe9a7cda58f3c9572ab70bc308648553237b238`

Bucket: `null` (`p0_b0`)

Assembly Sentences:

1.

```text
你最近忙不忙？想找你看下手机备份怎么设置。
```

- sentenceId: `p0_b0_s0`
- category: `RAW_ORIGINAL`
- assemblyRank: 1
- assemblyScore: 0

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 你最近忙不忙？想找你看下手机备份怎么设置。
pathId: 8abbc76111de7c632d7d17362fe9a7cda58f3c9572ab70bc308648553237b238
bucketDomain: null
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 你最近忙不忙？想找你看下手机备份怎么设置。
keptFromPath: 8abbc76111de7c632d7d17362fe9a7cda58f3c9572ab70bc308648553237b238
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
你最近忙不忙？想找你看下手机备份怎么设置。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"8abbc76111de7c632d7d17362fe9a7cda58f3c9572ab70bc308648553237b238","bucketDomain":null,"count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d064

<a id="case-d064"></a>

### Case 基础信息

```text
Case ID: d064
Raw Text: 今天我们团队要讨论后选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
Path Count: 2
Bucket Count: 2
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8`

Bucket: `tech_ai` (`p0_b0`)

Assembly Sentences:

1.

```text
今天我们团队要讨论候选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 12.02

2.

```text
今天我们团队要讨论候选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
```

- sentenceId: `p0_b0_s1`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 2
- assemblyScore: 9.62

3.

```text
今天我们团队要讨论后选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
```

- sentenceId: `p0_b0_s2`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 3
- assemblyScore: 9.6

4.

```text
今天我们团队要讨论候选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
```

- sentenceId: `p0_b0_s3`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 4
- assemblyScore: 9.6

5.

```text
今天我们团队要讨论后选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
```

- sentenceId: `p0_b0_s4`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 5
- assemblyScore: 7.199999999999999

6.

```text
今天我们团队要讨论候选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
```

- sentenceId: `p0_b0_s5`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 6
- assemblyScore: 7.199999999999999

7.

```text
今天我们团队要讨论后选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
```

- sentenceId: `p0_b0_s6`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 7
- assemblyScore: 7.18

8.

```text
今天我们团队要讨论后选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
```

- sentenceId: `p0_b0_s7`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 8
- assemblyScore: 4.779999999999999

#### Path: `982f3f240464b76e9444a459acaf33ee860bc86f3827f03a9ecc863f3bb62ddb`

Bucket: `tech_ai` (`p1_b0`)

Assembly Sentences:

1.

```text
今天我们团队要讨论候选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
```

- sentenceId: `p1_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 9.239999999999998

2.

```text
今天我们团队要讨论候选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
```

- sentenceId: `p1_b0_s1`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 2
- assemblyScore: 7.199999999999999

3.

```text
今天我们团队要讨论后选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
```

- sentenceId: `p1_b0_s2`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 3
- assemblyScore: 6.819999999999999

4.

```text
今天我们团队要讨论候选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
```

- sentenceId: `p1_b0_s3`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 4
- assemblyScore: 6.819999999999999

5.

```text
今天我们团队要讨论后选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
```

- sentenceId: `p1_b0_s4`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 5
- assemblyScore: 4.779999999999999

6.

```text
今天我们团队要讨论候选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
```

- sentenceId: `p1_b0_s5`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 6
- assemblyScore: 4.779999999999999

7.

```text
今天我们团队要讨论后选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
```

- sentenceId: `p1_b0_s6`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 7
- assemblyScore: 4.4

8.

```text
今天我们团队要讨论后选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
```

- sentenceId: `p1_b0_s7`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 8
- assemblyScore: 2.36

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 16

1.

```text
text: 今天我们团队要讨论候选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
pathId: e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 今天我们团队要讨论候选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
pathId: e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s1
```

3.

```text
text: 今天我们团队要讨论后选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
pathId: e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s2
```

4.

```text
text: 今天我们团队要讨论候选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
pathId: e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s3
```

5.

```text
text: 今天我们团队要讨论后选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
pathId: e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s4
```

6.

```text
text: 今天我们团队要讨论候选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
pathId: e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s5
```

7.

```text
text: 今天我们团队要讨论后选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
pathId: e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s6
```

8.

```text
text: 今天我们团队要讨论后选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
pathId: e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s7
```

9.

```text
text: 今天我们团队要讨论候选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
pathId: 982f3f240464b76e9444a459acaf33ee860bc86f3827f03a9ecc863f3bb62ddb
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s0
```

10.

```text
text: 今天我们团队要讨论候选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
pathId: 982f3f240464b76e9444a459acaf33ee860bc86f3827f03a9ecc863f3bb62ddb
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s1
```

11.

```text
text: 今天我们团队要讨论后选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
pathId: 982f3f240464b76e9444a459acaf33ee860bc86f3827f03a9ecc863f3bb62ddb
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s2
```

12.

```text
text: 今天我们团队要讨论候选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
pathId: 982f3f240464b76e9444a459acaf33ee860bc86f3827f03a9ecc863f3bb62ddb
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s3
```

13.

```text
text: 今天我们团队要讨论后选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
pathId: 982f3f240464b76e9444a459acaf33ee860bc86f3827f03a9ecc863f3bb62ddb
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s4
```

14.

```text
text: 今天我们团队要讨论候选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
pathId: 982f3f240464b76e9444a459acaf33ee860bc86f3827f03a9ecc863f3bb62ddb
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s5
```

15.

```text
text: 今天我们团队要讨论后选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
pathId: 982f3f240464b76e9444a459acaf33ee860bc86f3827f03a9ecc863f3bb62ddb
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s6
```

16.

```text
text: 今天我们团队要讨论后选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
pathId: 982f3f240464b76e9444a459acaf33ee860bc86f3827f03a9ecc863f3bb62ddb
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s7
```

### D. CrossPath Output

Count: 8

1.

```text
text: 今天我们团队要讨论候选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
keptFromPath: e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 今天我们团队要讨论候选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
keptFromPath: e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s1
```

3.

```text
text: 今天我们团队要讨论后选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
keptFromPath: e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s2
```

4.

```text
text: 今天我们团队要讨论候选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
keptFromPath: e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s3
```

5.

```text
text: 今天我们团队要讨论后选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
keptFromPath: e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s4
```

6.

```text
text: 今天我们团队要讨论候选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
keptFromPath: e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s5
```

7.

```text
text: 今天我们团队要讨论后选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
keptFromPath: e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s6
```

8.

```text
text: 今天我们团队要讨论后选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
keptFromPath: e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s7
```

### E. CrossPath 删除项

```text
Dropped Text: 今天我们团队要讨论候选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
Source Sentence: p1_b0_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 今天我们团队要讨论候选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
```

```text
Dropped Text: 今天我们团队要讨论候选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
Source Sentence: p1_b0_s1
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 今天我们团队要讨论候选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
```

```text
Dropped Text: 今天我们团队要讨论后选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
Source Sentence: p1_b0_s2
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 今天我们团队要讨论后选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
```

```text
Dropped Text: 今天我们团队要讨论候选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
Source Sentence: p1_b0_s3
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 今天我们团队要讨论候选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
```

```text
Dropped Text: 今天我们团队要讨论后选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
Source Sentence: p1_b0_s4
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 今天我们团队要讨论后选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
```

```text
Dropped Text: 今天我们团队要讨论候选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
Source Sentence: p1_b0_s5
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 今天我们团队要讨论候选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
```

```text
Dropped Text: 今天我们团队要讨论后选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
Source Sentence: p1_b0_s6
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 今天我们团队要讨论后选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
```

```text
Dropped Text: 今天我们团队要讨论后选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
Source Sentence: p1_b0_s7
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 今天我们团队要讨论后选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
```

### F. KenLM Input

KenLM Input Count: 8

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
今天我们团队要讨论候选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
```

2.

```text
今天我们团队要讨论候选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
```

3.

```text
今天我们团队要讨论后选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
```

4.

```text
今天我们团队要讨论候选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
```

5.

```text
今天我们团队要讨论后选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
```

6.

```text
今天我们团队要讨论候选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
```

7.

```text
今天我们团队要讨论后选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
```

8.

```text
今天我们团队要讨论后选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8","bucketDomain":"tech_ai","count":8},{"pathId":"982f3f240464b76e9444a459acaf33ee860bc86f3827f03a9ecc863f3bb62ddb","bucketDomain":"tech_ai","count":8}]
crossPathInputCount: 16
crossPathOutputCount: 8
kenlmInputCount: 8
CrossPath Input == Assembly total: YES (16 vs 16)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d065

<a id="case-d065"></a>

### Case 基础信息

```text
Case ID: d065
Raw Text: 这次发布我们先对齐上线计划窗口，后选生城模块需要联调，别漏掉回归。
Path Count: 2
Bucket Count: 2
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `d18e38f8936e3dae9107ea8e2acaf78da3b2472127b9644ea2be67380e9844d7`

Bucket: `tech_ai` (`p0_b0`)

Assembly Sentences:

1.

```text
这次发布我们先对齐上线计划窗口，候选生城模块需要联调，别漏掉回归。
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 14.4

2.

```text
这次发布我们先对齐上线计划窗口，后选生城模块需要联调，别漏掉回归。
```

- sentenceId: `p0_b0_s1`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 2
- assemblyScore: 11.98

#### Path: `d0727a8e1c03785b04ed2877ce853d0488af5bbfebedbe740226ff2cb15c2120`

Bucket: `tech_ai` (`p1_b0`)

Assembly Sentences:

1.

```text
这次发布我们先对齐上线计划窗口，候选生城模块需要联调，别漏掉回归。
```

- sentenceId: `p1_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 11.620000000000001

2.

```text
这次发布我们先对齐上线计划窗口，后选生城模块需要联调，别漏掉回归。
```

- sentenceId: `p1_b0_s1`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 2
- assemblyScore: 9.200000000000001

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 4

1.

```text
text: 这次发布我们先对齐上线计划窗口，候选生城模块需要联调，别漏掉回归。
pathId: d18e38f8936e3dae9107ea8e2acaf78da3b2472127b9644ea2be67380e9844d7
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 这次发布我们先对齐上线计划窗口，后选生城模块需要联调，别漏掉回归。
pathId: d18e38f8936e3dae9107ea8e2acaf78da3b2472127b9644ea2be67380e9844d7
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s1
```

3.

```text
text: 这次发布我们先对齐上线计划窗口，候选生城模块需要联调，别漏掉回归。
pathId: d0727a8e1c03785b04ed2877ce853d0488af5bbfebedbe740226ff2cb15c2120
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s0
```

4.

```text
text: 这次发布我们先对齐上线计划窗口，后选生城模块需要联调，别漏掉回归。
pathId: d0727a8e1c03785b04ed2877ce853d0488af5bbfebedbe740226ff2cb15c2120
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s1
```

### D. CrossPath Output

Count: 2

1.

```text
text: 这次发布我们先对齐上线计划窗口，候选生城模块需要联调，别漏掉回归。
keptFromPath: d18e38f8936e3dae9107ea8e2acaf78da3b2472127b9644ea2be67380e9844d7
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 这次发布我们先对齐上线计划窗口，后选生城模块需要联调，别漏掉回归。
keptFromPath: d18e38f8936e3dae9107ea8e2acaf78da3b2472127b9644ea2be67380e9844d7
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s1
```

### E. CrossPath 删除项

```text
Dropped Text: 这次发布我们先对齐上线计划窗口，候选生城模块需要联调，别漏掉回归。
Source Sentence: p1_b0_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 这次发布我们先对齐上线计划窗口，候选生城模块需要联调，别漏掉回归。
```

```text
Dropped Text: 这次发布我们先对齐上线计划窗口，后选生城模块需要联调，别漏掉回归。
Source Sentence: p1_b0_s1
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 这次发布我们先对齐上线计划窗口，后选生城模块需要联调，别漏掉回归。
```

### F. KenLM Input

KenLM Input Count: 2

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
这次发布我们先对齐上线计划窗口，候选生城模块需要联调，别漏掉回归。
```

2.

```text
这次发布我们先对齐上线计划窗口，后选生城模块需要联调，别漏掉回归。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"d18e38f8936e3dae9107ea8e2acaf78da3b2472127b9644ea2be67380e9844d7","bucketDomain":"tech_ai","count":2},{"pathId":"d0727a8e1c03785b04ed2877ce853d0488af5bbfebedbe740226ff2cb15c2120","bucketDomain":"tech_ai","count":2}]
crossPathInputCount: 4
crossPathOutputCount: 2
kenlmInputCount: 2
CrossPath Input == Assembly total: YES (4 vs 4)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d066

<a id="case-d066"></a>

### Case 基础信息

```text
Case ID: d066
Raw Text: 会上提到候选生成链路要加监控，上线计划文档我下午更新一版。
Path Count: 2
Bucket Count: 2
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `a4c0876153861a0089493877032bd3ee43b5520178506c0cdfc830637f46a8ea`

Bucket: `tech_ai` (`p0_b0`)

Assembly Sentences:

1.

```text
会上提到候选生成链路要加监控，上线计划文档我下午更新一版。
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 12

#### Path: `53fa80de77688323aeb8193f42739986f77dbdf76c39a3718b63b712cb31c9ed`

Bucket: `tech_ai` (`p1_b0`)

Assembly Sentences:

1.

```text
会上提到候选生成链路要加监控，上线计划文档我下午更新一版。
```

- sentenceId: `p1_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 9.219999999999999

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 2

1.

```text
text: 会上提到候选生成链路要加监控，上线计划文档我下午更新一版。
pathId: a4c0876153861a0089493877032bd3ee43b5520178506c0cdfc830637f46a8ea
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 会上提到候选生成链路要加监控，上线计划文档我下午更新一版。
pathId: 53fa80de77688323aeb8193f42739986f77dbdf76c39a3718b63b712cb31c9ed
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 会上提到候选生成链路要加监控，上线计划文档我下午更新一版。
keptFromPath: a4c0876153861a0089493877032bd3ee43b5520178506c0cdfc830637f46a8ea
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

```text
Dropped Text: 会上提到候选生成链路要加监控，上线计划文档我下午更新一版。
Source Sentence: p1_b0_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 会上提到候选生成链路要加监控，上线计划文档我下午更新一版。
```

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
会上提到候选生成链路要加监控，上线计划文档我下午更新一版。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"a4c0876153861a0089493877032bd3ee43b5520178506c0cdfc830637f46a8ea","bucketDomain":"tech_ai","count":1},{"pathId":"53fa80de77688323aeb8193f42739986f77dbdf76c39a3718b63b712cb31c9ed","bucketDomain":"tech_ai","count":1}]
crossPathInputCount: 2
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (2 vs 2)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d067

<a id="case-d067"></a>

### Case 基础信息

```text
Case ID: d067
Raw Text: 您好，我订单显示已发货但物流三天没更新，能帮我查一下吗？
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `a0969349bce8ca48e5d13d7fac132d601e3919ee4e38c73a4763efa2a626b088`

Bucket: `food_order` (`p0_b0`)

Assembly Sentences:

1.

```text
您好，我订单显示已发货但物流三天没更新，能帮我查一下吗？
```

- sentenceId: `p0_b0_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.4

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 您好，我订单显示已发货但物流三天没更新，能帮我查一下吗？
pathId: a0969349bce8ca48e5d13d7fac132d601e3919ee4e38c73a4763efa2a626b088
bucketDomain: food_order
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 您好，我订单显示已发货但物流三天没更新，能帮我查一下吗？
keptFromPath: a0969349bce8ca48e5d13d7fac132d601e3919ee4e38c73a4763efa2a626b088
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
您好，我订单显示已发货但物流三天没更新，能帮我查一下吗？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"a0969349bce8ca48e5d13d7fac132d601e3919ee4e38c73a4763efa2a626b088","bucketDomain":"food_order","count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d068

<a id="case-d068"></a>

### Case 基础信息

```text
Case ID: d068
Raw Text: 想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。
Path Count: 1
Bucket Count: 4
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `3827924af8b5fc1e5dcc9c033f608a7c7a11790e401302ab152418017fcb5359`

Bucket: `coffee` (`p0_b0`)

Assembly Sentences:

1.

```text
想改一下收货低脂，还来得及吗？麻烦尽快处理，谢谢。
```

- sentenceId: `p0_b0_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

2.

```text
想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。
```

- sentenceId: `p0_b0_s1`
- category: `RAW_ORIGINAL`
- assemblyRank: 2
- assemblyScore: 0

#### Path: `3827924af8b5fc1e5dcc9c033f608a7c7a11790e401302ab152418017fcb5359`

Bucket: `food_order` (`p0_b1`)

Assembly Sentences:

1.

```text
想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。
```

- sentenceId: `p0_b1_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

#### Path: `3827924af8b5fc1e5dcc9c033f608a7c7a11790e401302ab152418017fcb5359`

Bucket: `milk_tea` (`p0_b2`)

Assembly Sentences:

1.

```text
想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。
```

- sentenceId: `p0_b2_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

#### Path: `3827924af8b5fc1e5dcc9c033f608a7c7a11790e401302ab152418017fcb5359`

Bucket: `tourism_route` (`p0_b3`)

Assembly Sentences:

1.

```text
想改一下收货地质，还来得及吗？麻烦尽快处理，谢谢。
```

- sentenceId: `p0_b3_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

2.

```text
想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。
```

- sentenceId: `p0_b3_s1`
- category: `RAW_ORIGINAL`
- assemblyRank: 2
- assemblyScore: 0

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 6

1.

```text
text: 想改一下收货低脂，还来得及吗？麻烦尽快处理，谢谢。
pathId: 3827924af8b5fc1e5dcc9c033f608a7c7a11790e401302ab152418017fcb5359
bucketDomain: coffee
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。
pathId: 3827924af8b5fc1e5dcc9c033f608a7c7a11790e401302ab152418017fcb5359
bucketDomain: coffee
sourceSentenceId: p0_b0_s1
```

3.

```text
text: 想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。
pathId: 3827924af8b5fc1e5dcc9c033f608a7c7a11790e401302ab152418017fcb5359
bucketDomain: food_order
sourceSentenceId: p0_b1_s0
```

4.

```text
text: 想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。
pathId: 3827924af8b5fc1e5dcc9c033f608a7c7a11790e401302ab152418017fcb5359
bucketDomain: milk_tea
sourceSentenceId: p0_b2_s0
```

5.

```text
text: 想改一下收货地质，还来得及吗？麻烦尽快处理，谢谢。
pathId: 3827924af8b5fc1e5dcc9c033f608a7c7a11790e401302ab152418017fcb5359
bucketDomain: tourism_route
sourceSentenceId: p0_b3_s0
```

6.

```text
text: 想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。
pathId: 3827924af8b5fc1e5dcc9c033f608a7c7a11790e401302ab152418017fcb5359
bucketDomain: tourism_route
sourceSentenceId: p0_b3_s1
```

### D. CrossPath Output

Count: 3

1.

```text
text: 想改一下收货低脂，还来得及吗？麻烦尽快处理，谢谢。
keptFromPath: 3827924af8b5fc1e5dcc9c033f608a7c7a11790e401302ab152418017fcb5359
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。
keptFromPath: 3827924af8b5fc1e5dcc9c033f608a7c7a11790e401302ab152418017fcb5359
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s1
```

3.

```text
text: 想改一下收货地质，还来得及吗？麻烦尽快处理，谢谢。
keptFromPath: 3827924af8b5fc1e5dcc9c033f608a7c7a11790e401302ab152418017fcb5359
keptFromBucket: p0_b3
sourceSentenceId: p0_b3_s0
```

### E. CrossPath 删除项

```text
Dropped Text: 想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。
Source Sentence: p0_b1_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。
```

```text
Dropped Text: 想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。
Source Sentence: p0_b2_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。
```

```text
Dropped Text: 想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。
Source Sentence: p0_b3_s1
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。
```

### F. KenLM Input

KenLM Input Count: 3

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
想改一下收货低脂，还来得及吗？麻烦尽快处理，谢谢。
```

2.

```text
想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。
```

3.

```text
想改一下收货地质，还来得及吗？麻烦尽快处理，谢谢。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"3827924af8b5fc1e5dcc9c033f608a7c7a11790e401302ab152418017fcb5359","bucketDomain":"coffee","count":2},{"pathId":"3827924af8b5fc1e5dcc9c033f608a7c7a11790e401302ab152418017fcb5359","bucketDomain":"food_order","count":1},{"pathId":"3827924af8b5fc1e5dcc9c033f608a7c7a11790e401302ab152418017fcb5359","bucketDomain":"milk_tea","count":1},{"pathId":"3827924af8b5fc1e5dcc9c033f608a7c7a11790e401302ab152418017fcb5359","bucketDomain":"tourism_route","count":2}]
crossPathInputCount: 6
crossPathOutputCount: 3
kenlmInputCount: 3
CrossPath Input == Assembly total: YES (6 vs 6)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d069

<a id="case-d069"></a>

### Case 基础信息

```text
Case ID: d069
Raw Text: 发票抬头开错了，能重新开具电子发票吗？
Path Count: 1
Bucket Count: 2
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `b40add9c18b994f3214720b91c9e39c1ec9a08acd66742f9b51723c5d1d357f6`

Bucket: `food_order` (`p0_b0`)

Assembly Sentences:

1.

```text
发票抬头开错了，能重新开具电子发票吗？
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 4.7

#### Path: `b40add9c18b994f3214720b91c9e39c1ec9a08acd66742f9b51723c5d1d357f6`

Bucket: `tourism_hotel` (`p0_b1`)

Assembly Sentences:

1.

```text
发票抬头开错了，能重新开具电子发票吗？
```

- sentenceId: `p0_b1_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 4.7

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 2

1.

```text
text: 发票抬头开错了，能重新开具电子发票吗？
pathId: b40add9c18b994f3214720b91c9e39c1ec9a08acd66742f9b51723c5d1d357f6
bucketDomain: food_order
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 发票抬头开错了，能重新开具电子发票吗？
pathId: b40add9c18b994f3214720b91c9e39c1ec9a08acd66742f9b51723c5d1d357f6
bucketDomain: tourism_hotel
sourceSentenceId: p0_b1_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 发票抬头开错了，能重新开具电子发票吗？
keptFromPath: b40add9c18b994f3214720b91c9e39c1ec9a08acd66742f9b51723c5d1d357f6
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

```text
Dropped Text: 发票抬头开错了，能重新开具电子发票吗？
Source Sentence: p0_b1_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 发票抬头开错了，能重新开具电子发票吗？
```

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
发票抬头开错了，能重新开具电子发票吗？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"b40add9c18b994f3214720b91c9e39c1ec9a08acd66742f9b51723c5d1d357f6","bucketDomain":"food_order","count":1},{"pathId":"b40add9c18b994f3214720b91c9e39c1ec9a08acd66742f9b51723c5d1d357f6","bucketDomain":"tourism_hotel","count":1}]
crossPathInputCount: 2
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (2 vs 2)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d070

<a id="case-d070"></a>

### Case 基础信息

```text
Case ID: d070
Raw Text: 请简单介绍一下你上一段项目里负责的核心模块和难点。
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `c33b910447acae81d7f3fcaec0bc8df744a479211aa365008054f6f07e77e730`

Bucket: `tech_ai` (`p0_b0`)

Assembly Sentences:

1.

```text
请简单介绍一下你上一段项目理服责的核心模块和难点。
```

- sentenceId: `p0_b0_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.04

2.

```text
请简单介绍一下你上一段项目里负责的核心模块和难点。
```

- sentenceId: `p0_b0_s1`
- category: `RAW_ORIGINAL`
- assemblyRank: 2
- assemblyScore: 0

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 2

1.

```text
text: 请简单介绍一下你上一段项目理服责的核心模块和难点。
pathId: c33b910447acae81d7f3fcaec0bc8df744a479211aa365008054f6f07e77e730
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 请简单介绍一下你上一段项目里负责的核心模块和难点。
pathId: c33b910447acae81d7f3fcaec0bc8df744a479211aa365008054f6f07e77e730
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s1
```

### D. CrossPath Output

Count: 2

1.

```text
text: 请简单介绍一下你上一段项目理服责的核心模块和难点。
keptFromPath: c33b910447acae81d7f3fcaec0bc8df744a479211aa365008054f6f07e77e730
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 请简单介绍一下你上一段项目里负责的核心模块和难点。
keptFromPath: c33b910447acae81d7f3fcaec0bc8df744a479211aa365008054f6f07e77e730
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s1
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 2

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
请简单介绍一下你上一段项目理服责的核心模块和难点。
```

2.

```text
请简单介绍一下你上一段项目里负责的核心模块和难点。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"c33b910447acae81d7f3fcaec0bc8df744a479211aa365008054f6f07e77e730","bucketDomain":"tech_ai","count":2}]
crossPathInputCount: 2
crossPathOutputCount: 2
kenlmInputCount: 2
CrossPath Input == Assembly total: YES (2 vs 2)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d071

<a id="case-d071"></a>

### Case 基础信息

```text
Case ID: d071
Raw Text: 你如何看待跨团队协作？遇到需求变更一般怎么处理？
Path Count: 1
Bucket Count: 2
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `b12f3cf0aef86ec71cf7ca92007b4ed2b271c07b66773e2211895464537dd8e6`

Bucket: `food_order` (`p0_b0`)

Assembly Sentences:

1.

```text
你如何看待跨团队协作？遇到需求变更一般怎么处理？
```

- sentenceId: `p0_b0_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

#### Path: `b12f3cf0aef86ec71cf7ca92007b4ed2b271c07b66773e2211895464537dd8e6`

Bucket: `milk_tea` (`p0_b1`)

Assembly Sentences:

1.

```text
你如何看待跨团队协作？遇到需求变更一般怎么处理？
```

- sentenceId: `p0_b1_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 2

1.

```text
text: 你如何看待跨团队协作？遇到需求变更一般怎么处理？
pathId: b12f3cf0aef86ec71cf7ca92007b4ed2b271c07b66773e2211895464537dd8e6
bucketDomain: food_order
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 你如何看待跨团队协作？遇到需求变更一般怎么处理？
pathId: b12f3cf0aef86ec71cf7ca92007b4ed2b271c07b66773e2211895464537dd8e6
bucketDomain: milk_tea
sourceSentenceId: p0_b1_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 你如何看待跨团队协作？遇到需求变更一般怎么处理？
keptFromPath: b12f3cf0aef86ec71cf7ca92007b4ed2b271c07b66773e2211895464537dd8e6
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

```text
Dropped Text: 你如何看待跨团队协作？遇到需求变更一般怎么处理？
Source Sentence: p0_b1_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 你如何看待跨团队协作？遇到需求变更一般怎么处理？
```

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
你如何看待跨团队协作？遇到需求变更一般怎么处理？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"b12f3cf0aef86ec71cf7ca92007b4ed2b271c07b66773e2211895464537dd8e6","bucketDomain":"food_order","count":1},{"pathId":"b12f3cf0aef86ec71cf7ca92007b4ed2b271c07b66773e2211895464537dd8e6","bucketDomain":"milk_tea","count":1}]
crossPathInputCount: 2
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (2 vs 2)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d072

<a id="case-d072"></a>

### Case 基础信息

```text
Case ID: d072
Raw Text: 期望薪资这块我们可以再沟通，你最快什么时候能入职？
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `84f36989f411316b0fbb31d26ab28fc8fd7f7901712c880018c446be02dc23a0`

Bucket: `medical` (`p0_b0`)

Assembly Sentences:

1.

```text
期望薪资这块我们科医再沟通，你最快什么时候能入职？
```

- sentenceId: `p0_b0_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

2.

```text
期望薪资这块我们可以再沟通，你最快什么时候能入职？
```

- sentenceId: `p0_b0_s1`
- category: `RAW_ORIGINAL`
- assemblyRank: 2
- assemblyScore: 0

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 2

1.

```text
text: 期望薪资这块我们科医再沟通，你最快什么时候能入职？
pathId: 84f36989f411316b0fbb31d26ab28fc8fd7f7901712c880018c446be02dc23a0
bucketDomain: medical
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 期望薪资这块我们可以再沟通，你最快什么时候能入职？
pathId: 84f36989f411316b0fbb31d26ab28fc8fd7f7901712c880018c446be02dc23a0
bucketDomain: medical
sourceSentenceId: p0_b0_s1
```

### D. CrossPath Output

Count: 2

1.

```text
text: 期望薪资这块我们科医再沟通，你最快什么时候能入职？
keptFromPath: 84f36989f411316b0fbb31d26ab28fc8fd7f7901712c880018c446be02dc23a0
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 期望薪资这块我们可以再沟通，你最快什么时候能入职？
keptFromPath: 84f36989f411316b0fbb31d26ab28fc8fd7f7901712c880018c446be02dc23a0
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s1
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 2

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
期望薪资这块我们科医再沟通，你最快什么时候能入职？
```

2.

```text
期望薪资这块我们可以再沟通，你最快什么时候能入职？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"84f36989f411316b0fbb31d26ab28fc8fd7f7901712c880018c446be02dc23a0","bucketDomain":"medical","count":2}]
crossPathInputCount: 2
crossPathOutputCount: 2
kenlmInputCount: 2
CrossPath Input == Assembly total: YES (2 vs 2)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d073

<a id="case-d073"></a>

### Case 基础信息

```text
Case ID: d073
Raw Text: 老师，这道题的解题步骤能不能再讲一遍？我没听懂第二点。
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `1c409d8f6131faa9fc20d6ca3c8911bc863ca7db5fb5df65e6fd14d73cb58462`

Bucket: `null` (`p0_b0`)

Assembly Sentences:

1.

```text
老师，这道题的解题步骤能不能再讲一遍？我没听懂第二点。
```

- sentenceId: `p0_b0_s0`
- category: `RAW_ORIGINAL`
- assemblyRank: 1
- assemblyScore: 0

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 老师，这道题的解题步骤能不能再讲一遍？我没听懂第二点。
pathId: 1c409d8f6131faa9fc20d6ca3c8911bc863ca7db5fb5df65e6fd14d73cb58462
bucketDomain: null
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 老师，这道题的解题步骤能不能再讲一遍？我没听懂第二点。
keptFromPath: 1c409d8f6131faa9fc20d6ca3c8911bc863ca7db5fb5df65e6fd14d73cb58462
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
老师，这道题的解题步骤能不能再讲一遍？我没听懂第二点。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"1c409d8f6131faa9fc20d6ca3c8911bc863ca7db5fb5df65e6fd14d73cb58462","bucketDomain":null,"count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d074

<a id="case-d074"></a>

### Case 基础信息

```text
Case ID: d074
Raw Text: 作业是下周一下午交吗？可以电子版提交吗？
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `cfa8bb1a264544e0081de7f7df6ddab5a810d642a10eb16e14969796fff1dc05`

Bucket: `medical` (`p0_b0`)

Assembly Sentences:

1.

```text
作液室下周一下午交吗？科医电子版提交吗？
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 4.366

2.

```text
作业是下周一下午交吗？科医电子版提交吗？
```

- sentenceId: `p0_b0_s1`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 2
- assemblyScore: 2.36

3.

```text
作液室下周一下午交吗？可以电子版提交吗？
```

- sentenceId: `p0_b0_s2`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 3
- assemblyScore: 2.006

4.

```text
作业是下周一下午交吗？可以电子版提交吗？
```

- sentenceId: `p0_b0_s3`
- category: `RAW_ORIGINAL`
- assemblyRank: 4
- assemblyScore: 0

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 4

1.

```text
text: 作液室下周一下午交吗？科医电子版提交吗？
pathId: cfa8bb1a264544e0081de7f7df6ddab5a810d642a10eb16e14969796fff1dc05
bucketDomain: medical
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 作业是下周一下午交吗？科医电子版提交吗？
pathId: cfa8bb1a264544e0081de7f7df6ddab5a810d642a10eb16e14969796fff1dc05
bucketDomain: medical
sourceSentenceId: p0_b0_s1
```

3.

```text
text: 作液室下周一下午交吗？可以电子版提交吗？
pathId: cfa8bb1a264544e0081de7f7df6ddab5a810d642a10eb16e14969796fff1dc05
bucketDomain: medical
sourceSentenceId: p0_b0_s2
```

4.

```text
text: 作业是下周一下午交吗？可以电子版提交吗？
pathId: cfa8bb1a264544e0081de7f7df6ddab5a810d642a10eb16e14969796fff1dc05
bucketDomain: medical
sourceSentenceId: p0_b0_s3
```

### D. CrossPath Output

Count: 4

1.

```text
text: 作液室下周一下午交吗？科医电子版提交吗？
keptFromPath: cfa8bb1a264544e0081de7f7df6ddab5a810d642a10eb16e14969796fff1dc05
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 作业是下周一下午交吗？科医电子版提交吗？
keptFromPath: cfa8bb1a264544e0081de7f7df6ddab5a810d642a10eb16e14969796fff1dc05
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s1
```

3.

```text
text: 作液室下周一下午交吗？可以电子版提交吗？
keptFromPath: cfa8bb1a264544e0081de7f7df6ddab5a810d642a10eb16e14969796fff1dc05
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s2
```

4.

```text
text: 作业是下周一下午交吗？可以电子版提交吗？
keptFromPath: cfa8bb1a264544e0081de7f7df6ddab5a810d642a10eb16e14969796fff1dc05
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s3
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 4

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
作液室下周一下午交吗？科医电子版提交吗？
```

2.

```text
作业是下周一下午交吗？科医电子版提交吗？
```

3.

```text
作液室下周一下午交吗？可以电子版提交吗？
```

4.

```text
作业是下周一下午交吗？可以电子版提交吗？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"cfa8bb1a264544e0081de7f7df6ddab5a810d642a10eb16e14969796fff1dc05","bucketDomain":"medical","count":4}]
crossPathInputCount: 4
crossPathOutputCount: 4
kenlmInputCount: 4
CrossPath Input == Assembly total: YES (4 vs 4)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d075

<a id="case-d075"></a>

### Case 基础信息

```text
Case ID: d075
Raw Text: 请问这门课期末是开卷还是闭卷？重点会划吗？
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `406369b69d20013642b051317595e528c850c41df8ca93640fce6b7e57486447`

Bucket: `tourism_hotel` (`p0_b0`)

Assembly Sentences:

1.

```text
请问这门课期末是开卷还是闭卷？钟点会划吗？
```

- sentenceId: `p0_b0_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

2.

```text
请问这门课期末是开卷还是闭卷？重点会划吗？
```

- sentenceId: `p0_b0_s1`
- category: `RAW_ORIGINAL`
- assemblyRank: 2
- assemblyScore: 0

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 2

1.

```text
text: 请问这门课期末是开卷还是闭卷？钟点会划吗？
pathId: 406369b69d20013642b051317595e528c850c41df8ca93640fce6b7e57486447
bucketDomain: tourism_hotel
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 请问这门课期末是开卷还是闭卷？重点会划吗？
pathId: 406369b69d20013642b051317595e528c850c41df8ca93640fce6b7e57486447
bucketDomain: tourism_hotel
sourceSentenceId: p0_b0_s1
```

### D. CrossPath Output

Count: 2

1.

```text
text: 请问这门课期末是开卷还是闭卷？钟点会划吗？
keptFromPath: 406369b69d20013642b051317595e528c850c41df8ca93640fce6b7e57486447
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 请问这门课期末是开卷还是闭卷？重点会划吗？
keptFromPath: 406369b69d20013642b051317595e528c850c41df8ca93640fce6b7e57486447
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s1
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 2

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
请问这门课期末是开卷还是闭卷？钟点会划吗？
```

2.

```text
请问这门课期末是开卷还是闭卷？重点会划吗？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"406369b69d20013642b051317595e528c850c41df8ca93640fce6b7e57486447","bucketDomain":"tourism_hotel","count":2}]
crossPathInputCount: 2
crossPathOutputCount: 2
kenlmInputCount: 2
CrossPath Input == Assembly total: YES (2 vs 2)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d076

<a id="case-d076"></a>

### Case 基础信息

```text
Case ID: d076
Raw Text: 我预订的是大床房，能安排安静一点的楼层吗？
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `0f1b0bab3dbe84cb6e062d9358983f0b8121ebf7757d2db143133f0308c372c0`

Bucket: `tourism_hotel` (`p0_b0`)

Assembly Sentences:

1.

```text
我预订的是大床房，能安排安静一点的楼层吗？
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 7.1

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 我预订的是大床房，能安排安静一点的楼层吗？
pathId: 0f1b0bab3dbe84cb6e062d9358983f0b8121ebf7757d2db143133f0308c372c0
bucketDomain: tourism_hotel
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 我预订的是大床房，能安排安静一点的楼层吗？
keptFromPath: 0f1b0bab3dbe84cb6e062d9358983f0b8121ebf7757d2db143133f0308c372c0
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
我预订的是大床房，能安排安静一点的楼层吗？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"0f1b0bab3dbe84cb6e062d9358983f0b8121ebf7757d2db143133f0308c372c0","bucketDomain":"tourism_hotel","count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d077

<a id="case-d077"></a>

### Case 基础信息

```text
Case ID: d077
Raw Text: 早餐几点开始？退房可以延迟到下午两点吗？
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `03e1aa8d5789d78feb7b3931f6588e562f01a298a0136c39d7b213cfeacb5a13`

Bucket: `tourism_hotel` (`p0_b0`)

Assembly Sentences:

1.

```text
早餐几点开始？退房可以延迟到下午两点吗？
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 4.4

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 早餐几点开始？退房可以延迟到下午两点吗？
pathId: 03e1aa8d5789d78feb7b3931f6588e562f01a298a0136c39d7b213cfeacb5a13
bucketDomain: tourism_hotel
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 早餐几点开始？退房可以延迟到下午两点吗？
keptFromPath: 03e1aa8d5789d78feb7b3931f6588e562f01a298a0136c39d7b213cfeacb5a13
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
早餐几点开始？退房可以延迟到下午两点吗？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"03e1aa8d5789d78feb7b3931f6588e562f01a298a0136c39d7b213cfeacb5a13","bucketDomain":"tourism_hotel","count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d078

<a id="case-d078"></a>

### Case 基础信息

```text
Case ID: d078
Raw Text: 房间空调不太制冷，能派人上来看一下吗？
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `6cadd25d36a390cae4a08810f3d8c2773753c3c6d3c1f3c07298a83ac138f50a`

Bucket: `tech_ai` (`p0_b0`)

Assembly Sentences:

1.

```text
房监控调不太制冷，能派人上来看一下吗？
```

- sentenceId: `p0_b0_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

2.

```text
房间空调不太制冷，能派人上来看一下吗？
```

- sentenceId: `p0_b0_s1`
- category: `RAW_ORIGINAL`
- assemblyRank: 2
- assemblyScore: 0

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 2

1.

```text
text: 房监控调不太制冷，能派人上来看一下吗？
pathId: 6cadd25d36a390cae4a08810f3d8c2773753c3c6d3c1f3c07298a83ac138f50a
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 房间空调不太制冷，能派人上来看一下吗？
pathId: 6cadd25d36a390cae4a08810f3d8c2773753c3c6d3c1f3c07298a83ac138f50a
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s1
```

### D. CrossPath Output

Count: 2

1.

```text
text: 房监控调不太制冷，能派人上来看一下吗？
keptFromPath: 6cadd25d36a390cae4a08810f3d8c2773753c3c6d3c1f3c07298a83ac138f50a
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 房间空调不太制冷，能派人上来看一下吗？
keptFromPath: 6cadd25d36a390cae4a08810f3d8c2773753c3c6d3c1f3c07298a83ac138f50a
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s1
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 2

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
房监控调不太制冷，能派人上来看一下吗？
```

2.

```text
房间空调不太制冷，能派人上来看一下吗？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"6cadd25d36a390cae4a08810f3d8c2773753c3c6d3c1f3c07298a83ac138f50a","bucketDomain":"tech_ai","count":2}]
crossPathInputCount: 2
crossPathOutputCount: 2
kenlmInputCount: 2
CrossPath Input == Assembly total: YES (2 vs 2)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d079

<a id="case-d079"></a>

### Case 基础信息

```text
Case ID: d079
Raw Text: 我想开通短信提醒，需要带什么证件？
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `c14d5f5751216d8790ba33830572c5c91e9e6e8c1beabcfbb3e78f12a3374199`

Bucket: `tourism_route` (`p0_b0`)

Assembly Sentences:

1.

```text
我想开通短信提醒，需要带什么证件？
```

- sentenceId: `p0_b0_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 我想开通短信提醒，需要带什么证件？
pathId: c14d5f5751216d8790ba33830572c5c91e9e6e8c1beabcfbb3e78f12a3374199
bucketDomain: tourism_route
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 我想开通短信提醒，需要带什么证件？
keptFromPath: c14d5f5751216d8790ba33830572c5c91e9e6e8c1beabcfbb3e78f12a3374199
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
我想开通短信提醒，需要带什么证件？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"c14d5f5751216d8790ba33830572c5c91e9e6e8c1beabcfbb3e78f12a3374199","bucketDomain":"tourism_route","count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d080

<a id="case-d080"></a>

### Case 基础信息

```text
Case ID: d080
Raw Text: 这笔转账显示处理中，大概多久能到账？
Path Count: 1
Bucket Count: 2
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `2913b934f41b6799cf1415142f4c210ceef85a8cc8572ca4ea9a0734a8e0e55b`

Bucket: `food_order` (`p0_b0`)

Assembly Sentences:

1.

```text
这笔转账显示处理中，大概多久能到账？
```

- sentenceId: `p0_b0_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

#### Path: `2913b934f41b6799cf1415142f4c210ceef85a8cc8572ca4ea9a0734a8e0e55b`

Bucket: `milk_tea` (`p0_b1`)

Assembly Sentences:

1.

```text
这笔转账显示处理中，大概多久能到账？
```

- sentenceId: `p0_b1_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 2

1.

```text
text: 这笔转账显示处理中，大概多久能到账？
pathId: 2913b934f41b6799cf1415142f4c210ceef85a8cc8572ca4ea9a0734a8e0e55b
bucketDomain: food_order
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 这笔转账显示处理中，大概多久能到账？
pathId: 2913b934f41b6799cf1415142f4c210ceef85a8cc8572ca4ea9a0734a8e0e55b
bucketDomain: milk_tea
sourceSentenceId: p0_b1_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 这笔转账显示处理中，大概多久能到账？
keptFromPath: 2913b934f41b6799cf1415142f4c210ceef85a8cc8572ca4ea9a0734a8e0e55b
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

```text
Dropped Text: 这笔转账显示处理中，大概多久能到账？
Source Sentence: p0_b1_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 这笔转账显示处理中，大概多久能到账？
```

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
这笔转账显示处理中，大概多久能到账？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"2913b934f41b6799cf1415142f4c210ceef85a8cc8572ca4ea9a0734a8e0e55b","bucketDomain":"food_order","count":1},{"pathId":"2913b934f41b6799cf1415142f4c210ceef85a8cc8572ca4ea9a0734a8e0e55b","bucketDomain":"milk_tea","count":1}]
crossPathInputCount: 2
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (2 vs 2)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d081

<a id="case-d081"></a>

### Case 基础信息

```text
Case ID: d081
Raw Text: 请问理财产品的风险等级在哪里查看？
Path Count: 1
Bucket Count: 2
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `6bcff49b0914307d218e0a1eff428d5f84a8e0578634047e841739527dddedbb`

Bucket: `tech_ai` (`p0_b0`)

Assembly Sentences:

1.

```text
请问理财产品的风险等级在哪里查看？
```

- sentenceId: `p0_b0_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

#### Path: `6bcff49b0914307d218e0a1eff428d5f84a8e0578634047e841739527dddedbb`

Bucket: `tourism_pickup` (`p0_b1`)

Assembly Sentences:

1.

```text
请问理财产品的风险登机在哪里查看？
```

- sentenceId: `p0_b1_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

2.

```text
请问理财产品的风险等级在哪里查看？
```

- sentenceId: `p0_b1_s1`
- category: `RAW_ORIGINAL`
- assemblyRank: 2
- assemblyScore: 0

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 3

1.

```text
text: 请问理财产品的风险等级在哪里查看？
pathId: 6bcff49b0914307d218e0a1eff428d5f84a8e0578634047e841739527dddedbb
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 请问理财产品的风险登机在哪里查看？
pathId: 6bcff49b0914307d218e0a1eff428d5f84a8e0578634047e841739527dddedbb
bucketDomain: tourism_pickup
sourceSentenceId: p0_b1_s0
```

3.

```text
text: 请问理财产品的风险等级在哪里查看？
pathId: 6bcff49b0914307d218e0a1eff428d5f84a8e0578634047e841739527dddedbb
bucketDomain: tourism_pickup
sourceSentenceId: p0_b1_s1
```

### D. CrossPath Output

Count: 2

1.

```text
text: 请问理财产品的风险等级在哪里查看？
keptFromPath: 6bcff49b0914307d218e0a1eff428d5f84a8e0578634047e841739527dddedbb
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 请问理财产品的风险登机在哪里查看？
keptFromPath: 6bcff49b0914307d218e0a1eff428d5f84a8e0578634047e841739527dddedbb
keptFromBucket: p0_b1
sourceSentenceId: p0_b1_s0
```

### E. CrossPath 删除项

```text
Dropped Text: 请问理财产品的风险等级在哪里查看？
Source Sentence: p0_b1_s1
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 请问理财产品的风险等级在哪里查看？
```

### F. KenLM Input

KenLM Input Count: 2

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
请问理财产品的风险等级在哪里查看？
```

2.

```text
请问理财产品的风险登机在哪里查看？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"6bcff49b0914307d218e0a1eff428d5f84a8e0578634047e841739527dddedbb","bucketDomain":"tech_ai","count":1},{"pathId":"6bcff49b0914307d218e0a1eff428d5f84a8e0578634047e841739527dddedbb","bucketDomain":"tourism_pickup","count":2}]
crossPathInputCount: 3
crossPathOutputCount: 2
kenlmInputCount: 2
CrossPath Input == Assembly total: YES (3 vs 3)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d082

<a id="case-d082"></a>

### Case 基础信息

```text
Case ID: d082
Raw Text: 两位，靠窗有位置吗？不要香菜，微辣就行。
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `8b2d9e6e9ba6152b4bfe03dd11061b9ad65e8ae7988e4c6ba683146fc5832aad`

Bucket: `food_order` (`p0_b0`)

Assembly Sentences:

1.

```text
两位，靠窗有位置吗？不要香菜，微辣就行。
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 4.390000000000001

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 两位，靠窗有位置吗？不要香菜，微辣就行。
pathId: 8b2d9e6e9ba6152b4bfe03dd11061b9ad65e8ae7988e4c6ba683146fc5832aad
bucketDomain: food_order
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 两位，靠窗有位置吗？不要香菜，微辣就行。
keptFromPath: 8b2d9e6e9ba6152b4bfe03dd11061b9ad65e8ae7988e4c6ba683146fc5832aad
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
两位，靠窗有位置吗？不要香菜，微辣就行。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"8b2d9e6e9ba6152b4bfe03dd11061b9ad65e8ae7988e4c6ba683146fc5832aad","bucketDomain":"food_order","count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d083

<a id="case-d083"></a>

### Case 基础信息

```text
Case ID: d083
Raw Text: 这道菜大概要等多久？我们先点一份凉菜和一壶茶。
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `37367286bf78ef457c58421ac1cc51772b81498372ff6046875c912bacb0a3ca`

Bucket: `null` (`p0_b0`)

Assembly Sentences:

1.

```text
这道菜大概要等多久？我们先点一份凉菜和一壶茶。
```

- sentenceId: `p0_b0_s0`
- category: `RAW_ORIGINAL`
- assemblyRank: 1
- assemblyScore: 0

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 这道菜大概要等多久？我们先点一份凉菜和一壶茶。
pathId: 37367286bf78ef457c58421ac1cc51772b81498372ff6046875c912bacb0a3ca
bucketDomain: null
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 这道菜大概要等多久？我们先点一份凉菜和一壶茶。
keptFromPath: 37367286bf78ef457c58421ac1cc51772b81498372ff6046875c912bacb0a3ca
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
这道菜大概要等多久？我们先点一份凉菜和一壶茶。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"37367286bf78ef457c58421ac1cc51772b81498372ff6046875c912bacb0a3ca","bucketDomain":null,"count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d084

<a id="case-d084"></a>

### Case 基础信息

```text
Case ID: d084
Raw Text: 可以打包吗？顺便结一下账，能扫码支付吗？
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `91229dfa9d5be6b38b9f08e170cff33f5d2bdef0d0cb6c73fdb7cf999d70ca76`

Bucket: `coffee` (`p0_b0`)

Assembly Sentences:

1.

```text
可以打包吗？顺便结一下账，能扫码支付吗？
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 4.356

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 可以打包吗？顺便结一下账，能扫码支付吗？
pathId: 91229dfa9d5be6b38b9f08e170cff33f5d2bdef0d0cb6c73fdb7cf999d70ca76
bucketDomain: coffee
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 可以打包吗？顺便结一下账，能扫码支付吗？
keptFromPath: 91229dfa9d5be6b38b9f08e170cff33f5d2bdef0d0cb6c73fdb7cf999d70ca76
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
可以打包吗？顺便结一下账，能扫码支付吗？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"91229dfa9d5be6b38b9f08e170cff33f5d2bdef0d0cb6c73fdb7cf999d70ca76","bucketDomain":"coffee","count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d085

<a id="case-d085"></a>

### Case 基础信息

```text
Case ID: d085
Raw Text: 私教课还剩几次？能帮我约明天晚上七点吗？
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `973b1af9a783aa7707c48f38b9fa56cd157195dbfa41409fe89c426ae484696e`

Bucket: `null` (`p0_b0`)

Assembly Sentences:

1.

```text
私教课还剩几次？能帮我约明天晚上七点吗？
```

- sentenceId: `p0_b0_s0`
- category: `RAW_ORIGINAL`
- assemblyRank: 1
- assemblyScore: 0

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 私教课还剩几次？能帮我约明天晚上七点吗？
pathId: 973b1af9a783aa7707c48f38b9fa56cd157195dbfa41409fe89c426ae484696e
bucketDomain: null
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 私教课还剩几次？能帮我约明天晚上七点吗？
keptFromPath: 973b1af9a783aa7707c48f38b9fa56cd157195dbfa41409fe89c426ae484696e
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
私教课还剩几次？能帮我约明天晚上七点吗？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"973b1af9a783aa7707c48f38b9fa56cd157195dbfa41409fe89c426ae484696e","bucketDomain":null,"count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d086

<a id="case-d086"></a>

### Case 基础信息

```text
Case ID: d086
Raw Text: 更衣室柜子钥匙找不到了，前台能帮忙开一下吗？
Path Count: 1
Bucket Count: 3
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `3b518d0b2df5f529d68743f21657b328629df6e85a64c6f34b152211b6dc2f06`

Bucket: `medical` (`p0_b0`)

Assembly Sentences:

1.

```text
更医师柜子钥匙找不到了，前台能帮忙开一下吗？
```

- sentenceId: `p0_b0_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.006

2.

```text
更衣室柜子钥匙找不到了，前台能帮忙开一下吗？
```

- sentenceId: `p0_b0_s1`
- category: `RAW_ORIGINAL`
- assemblyRank: 2
- assemblyScore: 0

#### Path: `3b518d0b2df5f529d68743f21657b328629df6e85a64c6f34b152211b6dc2f06`

Bucket: `meeting` (`p0_b1`)

Assembly Sentences:

1.

```text
更议室柜子钥匙找不到了，前台能帮忙开一下吗？
```

- sentenceId: `p0_b1_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.006

2.

```text
更衣室柜子钥匙找不到了，前台能帮忙开一下吗？
```

- sentenceId: `p0_b1_s1`
- category: `RAW_ORIGINAL`
- assemblyRank: 2
- assemblyScore: 0

#### Path: `3b518d0b2df5f529d68743f21657b328629df6e85a64c6f34b152211b6dc2f06`

Bucket: `tourism_hotel` (`p0_b2`)

Assembly Sentences:

1.

```text
更衣室柜子钥匙找不到了，前台能帮忙开一下吗？
```

- sentenceId: `p0_b2_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 5

1.

```text
text: 更医师柜子钥匙找不到了，前台能帮忙开一下吗？
pathId: 3b518d0b2df5f529d68743f21657b328629df6e85a64c6f34b152211b6dc2f06
bucketDomain: medical
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 更衣室柜子钥匙找不到了，前台能帮忙开一下吗？
pathId: 3b518d0b2df5f529d68743f21657b328629df6e85a64c6f34b152211b6dc2f06
bucketDomain: medical
sourceSentenceId: p0_b0_s1
```

3.

```text
text: 更议室柜子钥匙找不到了，前台能帮忙开一下吗？
pathId: 3b518d0b2df5f529d68743f21657b328629df6e85a64c6f34b152211b6dc2f06
bucketDomain: meeting
sourceSentenceId: p0_b1_s0
```

4.

```text
text: 更衣室柜子钥匙找不到了，前台能帮忙开一下吗？
pathId: 3b518d0b2df5f529d68743f21657b328629df6e85a64c6f34b152211b6dc2f06
bucketDomain: meeting
sourceSentenceId: p0_b1_s1
```

5.

```text
text: 更衣室柜子钥匙找不到了，前台能帮忙开一下吗？
pathId: 3b518d0b2df5f529d68743f21657b328629df6e85a64c6f34b152211b6dc2f06
bucketDomain: tourism_hotel
sourceSentenceId: p0_b2_s0
```

### D. CrossPath Output

Count: 3

1.

```text
text: 更医师柜子钥匙找不到了，前台能帮忙开一下吗？
keptFromPath: 3b518d0b2df5f529d68743f21657b328629df6e85a64c6f34b152211b6dc2f06
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 更衣室柜子钥匙找不到了，前台能帮忙开一下吗？
keptFromPath: 3b518d0b2df5f529d68743f21657b328629df6e85a64c6f34b152211b6dc2f06
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s1
```

3.

```text
text: 更议室柜子钥匙找不到了，前台能帮忙开一下吗？
keptFromPath: 3b518d0b2df5f529d68743f21657b328629df6e85a64c6f34b152211b6dc2f06
keptFromBucket: p0_b1
sourceSentenceId: p0_b1_s0
```

### E. CrossPath 删除项

```text
Dropped Text: 更衣室柜子钥匙找不到了，前台能帮忙开一下吗？
Source Sentence: p0_b1_s1
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 更衣室柜子钥匙找不到了，前台能帮忙开一下吗？
```

```text
Dropped Text: 更衣室柜子钥匙找不到了，前台能帮忙开一下吗？
Source Sentence: p0_b2_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 更衣室柜子钥匙找不到了，前台能帮忙开一下吗？
```

### F. KenLM Input

KenLM Input Count: 3

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
更医师柜子钥匙找不到了，前台能帮忙开一下吗？
```

2.

```text
更衣室柜子钥匙找不到了，前台能帮忙开一下吗？
```

3.

```text
更议室柜子钥匙找不到了，前台能帮忙开一下吗？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"3b518d0b2df5f529d68743f21657b328629df6e85a64c6f34b152211b6dc2f06","bucketDomain":"medical","count":2},{"pathId":"3b518d0b2df5f529d68743f21657b328629df6e85a64c6f34b152211b6dc2f06","bucketDomain":"meeting","count":2},{"pathId":"3b518d0b2df5f529d68743f21657b328629df6e85a64c6f34b152211b6dc2f06","bucketDomain":"tourism_hotel","count":1}]
crossPathInputCount: 5
crossPathOutputCount: 3
kenlmInputCount: 3
CrossPath Input == Assembly total: YES (5 vs 5)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d087

<a id="case-d087"></a>

### Case 基础信息

```text
Case ID: d087
Raw Text: 游泳次卡本月月底到期，续费有优惠吗？
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `a11519a0a6b805c16c3242918d0e30f13d8a99cebe7578a68fe2fabb883c6c96`

Bucket: `null` (`p0_b0`)

Assembly Sentences:

1.

```text
游泳次卡本月月底到期，续费有优惠吗？
```

- sentenceId: `p0_b0_s0`
- category: `RAW_ORIGINAL`
- assemblyRank: 1
- assemblyScore: 0

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 游泳次卡本月月底到期，续费有优惠吗？
pathId: a11519a0a6b805c16c3242918d0e30f13d8a99cebe7578a68fe2fabb883c6c96
bucketDomain: null
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 游泳次卡本月月底到期，续费有优惠吗？
keptFromPath: a11519a0a6b805c16c3242918d0e30f13d8a99cebe7578a68fe2fabb883c6c96
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
游泳次卡本月月底到期，续费有优惠吗？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"a11519a0a6b805c16c3242918d0e30f13d8a99cebe7578a68fe2fabb883c6c96","bucketDomain":null,"count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d088

<a id="case-d088"></a>

### Case 基础信息

```text
Case ID: d088
Raw Text: 我们下午讨论后选声城方案，先把候选生成的接口文档补齐。
Path Count: 2
Bucket Count: 2
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `86bbdea09331c4feb5a8c0ad9881f21444a7ba7ae866222c8b4c24b3fba4ce42`

Bucket: `tech_ai` (`p0_b0`)

Assembly Sentences:

1.

```text
我们下午讨论候选声城方案，先把候选生成的接口文档补齐。
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 9.66

2.

```text
我们下午讨论后选声城方案，先把候选生成的接口文档补齐。
```

- sentenceId: `p0_b0_s1`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 2
- assemblyScore: 7.24

#### Path: `eefbde0a8d0d9a4bd706030008aee9a3ba8aef276637bb189b65c4365acf56c9`

Bucket: `tech_ai` (`p1_b0`)

Assembly Sentences:

1.

```text
我们下午讨论候选声城方案，先把候选生成的接口文档补齐。
```

- sentenceId: `p1_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 6.88

2.

```text
我们下午讨论后选声城方案，先把候选生成的接口文档补齐。
```

- sentenceId: `p1_b0_s1`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 2
- assemblyScore: 4.46

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 4

1.

```text
text: 我们下午讨论候选声城方案，先把候选生成的接口文档补齐。
pathId: 86bbdea09331c4feb5a8c0ad9881f21444a7ba7ae866222c8b4c24b3fba4ce42
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 我们下午讨论后选声城方案，先把候选生成的接口文档补齐。
pathId: 86bbdea09331c4feb5a8c0ad9881f21444a7ba7ae866222c8b4c24b3fba4ce42
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s1
```

3.

```text
text: 我们下午讨论候选声城方案，先把候选生成的接口文档补齐。
pathId: eefbde0a8d0d9a4bd706030008aee9a3ba8aef276637bb189b65c4365acf56c9
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s0
```

4.

```text
text: 我们下午讨论后选声城方案，先把候选生成的接口文档补齐。
pathId: eefbde0a8d0d9a4bd706030008aee9a3ba8aef276637bb189b65c4365acf56c9
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s1
```

### D. CrossPath Output

Count: 2

1.

```text
text: 我们下午讨论候选声城方案，先把候选生成的接口文档补齐。
keptFromPath: 86bbdea09331c4feb5a8c0ad9881f21444a7ba7ae866222c8b4c24b3fba4ce42
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 我们下午讨论后选声城方案，先把候选生成的接口文档补齐。
keptFromPath: 86bbdea09331c4feb5a8c0ad9881f21444a7ba7ae866222c8b4c24b3fba4ce42
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s1
```

### E. CrossPath 删除项

```text
Dropped Text: 我们下午讨论候选声城方案，先把候选生成的接口文档补齐。
Source Sentence: p1_b0_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 我们下午讨论候选声城方案，先把候选生成的接口文档补齐。
```

```text
Dropped Text: 我们下午讨论后选声城方案，先把候选生成的接口文档补齐。
Source Sentence: p1_b0_s1
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 我们下午讨论后选声城方案，先把候选生成的接口文档补齐。
```

### F. KenLM Input

KenLM Input Count: 2

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
我们下午讨论候选声城方案，先把候选生成的接口文档补齐。
```

2.

```text
我们下午讨论后选声城方案，先把候选生成的接口文档补齐。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"86bbdea09331c4feb5a8c0ad9881f21444a7ba7ae866222c8b4c24b3fba4ce42","bucketDomain":"tech_ai","count":2},{"pathId":"eefbde0a8d0d9a4bd706030008aee9a3ba8aef276637bb189b65c4365acf56c9","bucketDomain":"tech_ai","count":2}]
crossPathInputCount: 4
crossPathOutputCount: 2
kenlmInputCount: 2
CrossPath Input == Assembly total: YES (4 vs 4)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d089

<a id="case-d089"></a>

### Case 基础信息

```text
Case ID: d089
Raw Text: 这周的上线计花已经确认，上线计划评审安排在周四上午。
Path Count: 4
Bucket Count: 5
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `3a7c0ec19c68211cdf24335825c8d37e4aa2134e2fc89f2e63c8e4317cc94389`

Bucket: `tech_ai` (`p0_b0`)

Assembly Sentences:

1.

```text
这周的上线计划已经确认，上线计划评审安排在周四上午。
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 9.64

2.

```text
这周的上线计花已经确认，上线计划评审安排在周四上午。
```

- sentenceId: `p0_b0_s1`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 2
- assemblyScore: 7.24

#### Path: `066ebc94f339a351afffd32d14f7e56193e4b7aea663b15d787ffdc5993bda0f`

Bucket: `tech_ai` (`p1_b0`)

Assembly Sentences:

1.

```text
这周的上线计划已经确认，上线计划评审安排在周四上午。
```

- sentenceId: `p1_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 6.86

2.

```text
这周的上线计花已经确认，上线计划评审安排在周四上午。
```

- sentenceId: `p1_b0_s1`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 2
- assemblyScore: 4.46

#### Path: `57ea9b89e4fc35be95b82fbc831b7f5c4c7f6f5fe37c7010697f3f088ac465f6`

Bucket: `tech_ai` (`p2_b0`)

Assembly Sentences:

1.

```text
这周的上线计划已经确认，上线计划评审安排在周四上午。
```

- sentenceId: `p2_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 6.859999999999999

2.

```text
这周的上线计花已经确认，上线计划评审安排在周四上午。
```

- sentenceId: `p2_b0_s1`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 2
- assemblyScore: 4.82

#### Path: `1e01ba7584d9e3d132a29bce455c9f9262f69591509b4623fd5d51aae06b8008`

Bucket: `tech_ai` (`p3_b0`)

Assembly Sentences:

1.

```text
这周的上线计划已经确认，上线计划评审安排在周四上午。
```

- sentenceId: `p3_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 4.08

2.

```text
这周的上线计花已经确认，上线计划评审安排在周四上午。
```

- sentenceId: `p3_b0_s1`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 2
- assemblyScore: 2.04

#### Path: `1e01ba7584d9e3d132a29bce455c9f9262f69591509b4623fd5d51aae06b8008`

Bucket: `tourism_hotel` (`p3_b1`)

Assembly Sentences:

1.

```text
这周的上线计花已经确认，上线计划评审安排在周四商务。
```

- sentenceId: `p3_b1_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 4.72

2.

```text
这周的上线计花已经确认，上线计划评审安排在周四上午。
```

- sentenceId: `p3_b1_s1`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 2
- assemblyScore: 2.36

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 10

1.

```text
text: 这周的上线计划已经确认，上线计划评审安排在周四上午。
pathId: 3a7c0ec19c68211cdf24335825c8d37e4aa2134e2fc89f2e63c8e4317cc94389
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 这周的上线计花已经确认，上线计划评审安排在周四上午。
pathId: 3a7c0ec19c68211cdf24335825c8d37e4aa2134e2fc89f2e63c8e4317cc94389
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s1
```

3.

```text
text: 这周的上线计划已经确认，上线计划评审安排在周四上午。
pathId: 066ebc94f339a351afffd32d14f7e56193e4b7aea663b15d787ffdc5993bda0f
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s0
```

4.

```text
text: 这周的上线计花已经确认，上线计划评审安排在周四上午。
pathId: 066ebc94f339a351afffd32d14f7e56193e4b7aea663b15d787ffdc5993bda0f
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s1
```

5.

```text
text: 这周的上线计划已经确认，上线计划评审安排在周四上午。
pathId: 57ea9b89e4fc35be95b82fbc831b7f5c4c7f6f5fe37c7010697f3f088ac465f6
bucketDomain: tech_ai
sourceSentenceId: p2_b0_s0
```

6.

```text
text: 这周的上线计花已经确认，上线计划评审安排在周四上午。
pathId: 57ea9b89e4fc35be95b82fbc831b7f5c4c7f6f5fe37c7010697f3f088ac465f6
bucketDomain: tech_ai
sourceSentenceId: p2_b0_s1
```

7.

```text
text: 这周的上线计划已经确认，上线计划评审安排在周四上午。
pathId: 1e01ba7584d9e3d132a29bce455c9f9262f69591509b4623fd5d51aae06b8008
bucketDomain: tech_ai
sourceSentenceId: p3_b0_s0
```

8.

```text
text: 这周的上线计花已经确认，上线计划评审安排在周四上午。
pathId: 1e01ba7584d9e3d132a29bce455c9f9262f69591509b4623fd5d51aae06b8008
bucketDomain: tech_ai
sourceSentenceId: p3_b0_s1
```

9.

```text
text: 这周的上线计花已经确认，上线计划评审安排在周四商务。
pathId: 1e01ba7584d9e3d132a29bce455c9f9262f69591509b4623fd5d51aae06b8008
bucketDomain: tourism_hotel
sourceSentenceId: p3_b1_s0
```

10.

```text
text: 这周的上线计花已经确认，上线计划评审安排在周四上午。
pathId: 1e01ba7584d9e3d132a29bce455c9f9262f69591509b4623fd5d51aae06b8008
bucketDomain: tourism_hotel
sourceSentenceId: p3_b1_s1
```

### D. CrossPath Output

Count: 3

1.

```text
text: 这周的上线计划已经确认，上线计划评审安排在周四上午。
keptFromPath: 3a7c0ec19c68211cdf24335825c8d37e4aa2134e2fc89f2e63c8e4317cc94389
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 这周的上线计花已经确认，上线计划评审安排在周四上午。
keptFromPath: 3a7c0ec19c68211cdf24335825c8d37e4aa2134e2fc89f2e63c8e4317cc94389
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s1
```

3.

```text
text: 这周的上线计花已经确认，上线计划评审安排在周四商务。
keptFromPath: 1e01ba7584d9e3d132a29bce455c9f9262f69591509b4623fd5d51aae06b8008
keptFromBucket: p3_b1
sourceSentenceId: p3_b1_s0
```

### E. CrossPath 删除项

```text
Dropped Text: 这周的上线计划已经确认，上线计划评审安排在周四上午。
Source Sentence: p1_b0_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 这周的上线计划已经确认，上线计划评审安排在周四上午。
```

```text
Dropped Text: 这周的上线计花已经确认，上线计划评审安排在周四上午。
Source Sentence: p1_b0_s1
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 这周的上线计花已经确认，上线计划评审安排在周四上午。
```

```text
Dropped Text: 这周的上线计划已经确认，上线计划评审安排在周四上午。
Source Sentence: p2_b0_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 这周的上线计划已经确认，上线计划评审安排在周四上午。
```

```text
Dropped Text: 这周的上线计花已经确认，上线计划评审安排在周四上午。
Source Sentence: p2_b0_s1
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 这周的上线计花已经确认，上线计划评审安排在周四上午。
```

```text
Dropped Text: 这周的上线计划已经确认，上线计划评审安排在周四上午。
Source Sentence: p3_b0_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 这周的上线计划已经确认，上线计划评审安排在周四上午。
```

```text
Dropped Text: 这周的上线计花已经确认，上线计划评审安排在周四上午。
Source Sentence: p3_b0_s1
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 这周的上线计花已经确认，上线计划评审安排在周四上午。
```

```text
Dropped Text: 这周的上线计花已经确认，上线计划评审安排在周四上午。
Source Sentence: p3_b1_s1
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 这周的上线计花已经确认，上线计划评审安排在周四上午。
```

### F. KenLM Input

KenLM Input Count: 3

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
这周的上线计划已经确认，上线计划评审安排在周四上午。
```

2.

```text
这周的上线计花已经确认，上线计划评审安排在周四上午。
```

3.

```text
这周的上线计花已经确认，上线计划评审安排在周四商务。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"3a7c0ec19c68211cdf24335825c8d37e4aa2134e2fc89f2e63c8e4317cc94389","bucketDomain":"tech_ai","count":2},{"pathId":"066ebc94f339a351afffd32d14f7e56193e4b7aea663b15d787ffdc5993bda0f","bucketDomain":"tech_ai","count":2},{"pathId":"57ea9b89e4fc35be95b82fbc831b7f5c4c7f6f5fe37c7010697f3f088ac465f6","bucketDomain":"tech_ai","count":2},{"pathId":"1e01ba7584d9e3d132a29bce455c9f9262f69591509b4623fd5d51aae06b8008","bucketDomain":"tech_ai","count":2},{"pathId":"1e01ba7584d9e3d132a29bce455c9f9262f69591509b4623fd5d51aae06b8008","bucketDomain":"tourism_hotel","count":2}]
crossPathInputCount: 10
crossPathOutputCount: 3
kenlmInputCount: 3
CrossPath Input == Assembly total: YES (10 vs 10)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d090

<a id="case-d090"></a>

### Case 基础信息

```text
Case ID: d090
Raw Text: 关于后选生城和上线计化，请按上线计划执行，有问题群里说。
Path Count: 4
Bucket Count: 4
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `80d8d072c93bd03cae9cbb84c08e94e3da22d362211a19bb4e9529d389cfcbd9`

Bucket: `tech_ai` (`p0_b0`)

Assembly Sentences:

1.

```text
关于候选生城和上线计划，请按上线计划执行，有问题群里说。
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 9.64

2.

```text
关于候选生城和上线计化，请按上线计划执行，有问题群里说。
```

- sentenceId: `p0_b0_s1`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 2
- assemblyScore: 7.24

3.

```text
关于后选生城和上线计划，请按上线计划执行，有问题群里说。
```

- sentenceId: `p0_b0_s2`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 3
- assemblyScore: 7.220000000000001

4.

```text
关于后选生城和上线计化，请按上线计划执行，有问题群里说。
```

- sentenceId: `p0_b0_s3`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 4
- assemblyScore: 4.82

#### Path: `93e4109d85b5380fab48f556415ccbc466756d447402b61852516ce4b9af9d96`

Bucket: `tech_ai` (`p1_b0`)

Assembly Sentences:

1.

```text
关于候选生城和上线计划，请按上线计划执行，有问题群里说。
```

- sentenceId: `p1_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 7.220000000000001

2.

```text
关于候选生城和上线计化，请按上线计划执行，有问题群里说。
```

- sentenceId: `p1_b0_s1`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 2
- assemblyScore: 4.82

3.

```text
关于后选生城和上线计划，请按上线计划执行，有问题群里说。
```

- sentenceId: `p1_b0_s2`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 3
- assemblyScore: 4.8

4.

```text
关于后选生城和上线计化，请按上线计划执行，有问题群里说。
```

- sentenceId: `p1_b0_s3`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 4
- assemblyScore: 2.4

#### Path: `2ad765c2b868ddad2f2aacc904cdbbff13b3bd2676190675e265773ee4a9a6ab`

Bucket: `tech_ai` (`p2_b0`)

Assembly Sentences:

1.

```text
关于候选生城和上线计划，请按上线计划执行，有问题群里说。
```

- sentenceId: `p2_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 12.06

2.

```text
关于候选生城和上线计化，请按上线计划执行，有问题群里说。
```

- sentenceId: `p2_b0_s1`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 2
- assemblyScore: 9.66

3.

```text
关于后选生城和上线计划，请按上线计划执行，有问题群里说。
```

- sentenceId: `p2_b0_s2`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 3
- assemblyScore: 9.64

4.

```text
关于后选生城和上线计化，请按上线计划执行，有问题群里说。
```

- sentenceId: `p2_b0_s3`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 4
- assemblyScore: 7.24

#### Path: `65aa4e3a49b767d4a16d0bb386a6f55fc3d2885c77f30fc1f8e5824bd3aebf0a`

Bucket: `tech_ai` (`p3_b0`)

Assembly Sentences:

1.

```text
关于候选生城和上线计划，请按上线计划执行，有问题群里说。
```

- sentenceId: `p3_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 9.64

2.

```text
关于候选生城和上线计化，请按上线计划执行，有问题群里说。
```

- sentenceId: `p3_b0_s1`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 2
- assemblyScore: 7.24

3.

```text
关于后选生城和上线计划，请按上线计划执行，有问题群里说。
```

- sentenceId: `p3_b0_s2`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 3
- assemblyScore: 7.220000000000001

4.

```text
关于后选生城和上线计化，请按上线计划执行，有问题群里说。
```

- sentenceId: `p3_b0_s3`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 4
- assemblyScore: 4.82

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 16

1.

```text
text: 关于候选生城和上线计划，请按上线计划执行，有问题群里说。
pathId: 80d8d072c93bd03cae9cbb84c08e94e3da22d362211a19bb4e9529d389cfcbd9
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 关于候选生城和上线计化，请按上线计划执行，有问题群里说。
pathId: 80d8d072c93bd03cae9cbb84c08e94e3da22d362211a19bb4e9529d389cfcbd9
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s1
```

3.

```text
text: 关于后选生城和上线计划，请按上线计划执行，有问题群里说。
pathId: 80d8d072c93bd03cae9cbb84c08e94e3da22d362211a19bb4e9529d389cfcbd9
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s2
```

4.

```text
text: 关于后选生城和上线计化，请按上线计划执行，有问题群里说。
pathId: 80d8d072c93bd03cae9cbb84c08e94e3da22d362211a19bb4e9529d389cfcbd9
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s3
```

5.

```text
text: 关于候选生城和上线计划，请按上线计划执行，有问题群里说。
pathId: 93e4109d85b5380fab48f556415ccbc466756d447402b61852516ce4b9af9d96
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s0
```

6.

```text
text: 关于候选生城和上线计化，请按上线计划执行，有问题群里说。
pathId: 93e4109d85b5380fab48f556415ccbc466756d447402b61852516ce4b9af9d96
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s1
```

7.

```text
text: 关于后选生城和上线计划，请按上线计划执行，有问题群里说。
pathId: 93e4109d85b5380fab48f556415ccbc466756d447402b61852516ce4b9af9d96
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s2
```

8.

```text
text: 关于后选生城和上线计化，请按上线计划执行，有问题群里说。
pathId: 93e4109d85b5380fab48f556415ccbc466756d447402b61852516ce4b9af9d96
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s3
```

9.

```text
text: 关于候选生城和上线计划，请按上线计划执行，有问题群里说。
pathId: 2ad765c2b868ddad2f2aacc904cdbbff13b3bd2676190675e265773ee4a9a6ab
bucketDomain: tech_ai
sourceSentenceId: p2_b0_s0
```

10.

```text
text: 关于候选生城和上线计化，请按上线计划执行，有问题群里说。
pathId: 2ad765c2b868ddad2f2aacc904cdbbff13b3bd2676190675e265773ee4a9a6ab
bucketDomain: tech_ai
sourceSentenceId: p2_b0_s1
```

11.

```text
text: 关于后选生城和上线计划，请按上线计划执行，有问题群里说。
pathId: 2ad765c2b868ddad2f2aacc904cdbbff13b3bd2676190675e265773ee4a9a6ab
bucketDomain: tech_ai
sourceSentenceId: p2_b0_s2
```

12.

```text
text: 关于后选生城和上线计化，请按上线计划执行，有问题群里说。
pathId: 2ad765c2b868ddad2f2aacc904cdbbff13b3bd2676190675e265773ee4a9a6ab
bucketDomain: tech_ai
sourceSentenceId: p2_b0_s3
```

13.

```text
text: 关于候选生城和上线计划，请按上线计划执行，有问题群里说。
pathId: 65aa4e3a49b767d4a16d0bb386a6f55fc3d2885c77f30fc1f8e5824bd3aebf0a
bucketDomain: tech_ai
sourceSentenceId: p3_b0_s0
```

14.

```text
text: 关于候选生城和上线计化，请按上线计划执行，有问题群里说。
pathId: 65aa4e3a49b767d4a16d0bb386a6f55fc3d2885c77f30fc1f8e5824bd3aebf0a
bucketDomain: tech_ai
sourceSentenceId: p3_b0_s1
```

15.

```text
text: 关于后选生城和上线计划，请按上线计划执行，有问题群里说。
pathId: 65aa4e3a49b767d4a16d0bb386a6f55fc3d2885c77f30fc1f8e5824bd3aebf0a
bucketDomain: tech_ai
sourceSentenceId: p3_b0_s2
```

16.

```text
text: 关于后选生城和上线计化，请按上线计划执行，有问题群里说。
pathId: 65aa4e3a49b767d4a16d0bb386a6f55fc3d2885c77f30fc1f8e5824bd3aebf0a
bucketDomain: tech_ai
sourceSentenceId: p3_b0_s3
```

### D. CrossPath Output

Count: 4

1.

```text
text: 关于候选生城和上线计划，请按上线计划执行，有问题群里说。
keptFromPath: 80d8d072c93bd03cae9cbb84c08e94e3da22d362211a19bb4e9529d389cfcbd9
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 关于候选生城和上线计化，请按上线计划执行，有问题群里说。
keptFromPath: 80d8d072c93bd03cae9cbb84c08e94e3da22d362211a19bb4e9529d389cfcbd9
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s1
```

3.

```text
text: 关于后选生城和上线计划，请按上线计划执行，有问题群里说。
keptFromPath: 80d8d072c93bd03cae9cbb84c08e94e3da22d362211a19bb4e9529d389cfcbd9
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s2
```

4.

```text
text: 关于后选生城和上线计化，请按上线计划执行，有问题群里说。
keptFromPath: 80d8d072c93bd03cae9cbb84c08e94e3da22d362211a19bb4e9529d389cfcbd9
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s3
```

### E. CrossPath 删除项

```text
Dropped Text: 关于候选生城和上线计划，请按上线计划执行，有问题群里说。
Source Sentence: p1_b0_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 关于候选生城和上线计划，请按上线计划执行，有问题群里说。
```

```text
Dropped Text: 关于候选生城和上线计化，请按上线计划执行，有问题群里说。
Source Sentence: p1_b0_s1
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 关于候选生城和上线计化，请按上线计划执行，有问题群里说。
```

```text
Dropped Text: 关于后选生城和上线计划，请按上线计划执行，有问题群里说。
Source Sentence: p1_b0_s2
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 关于后选生城和上线计划，请按上线计划执行，有问题群里说。
```

```text
Dropped Text: 关于后选生城和上线计化，请按上线计划执行，有问题群里说。
Source Sentence: p1_b0_s3
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 关于后选生城和上线计化，请按上线计划执行，有问题群里说。
```

```text
Dropped Text: 关于候选生城和上线计划，请按上线计划执行，有问题群里说。
Source Sentence: p2_b0_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 关于候选生城和上线计划，请按上线计划执行，有问题群里说。
```

```text
Dropped Text: 关于候选生城和上线计化，请按上线计划执行，有问题群里说。
Source Sentence: p2_b0_s1
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 关于候选生城和上线计化，请按上线计划执行，有问题群里说。
```

```text
Dropped Text: 关于后选生城和上线计划，请按上线计划执行，有问题群里说。
Source Sentence: p2_b0_s2
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 关于后选生城和上线计划，请按上线计划执行，有问题群里说。
```

```text
Dropped Text: 关于后选生城和上线计化，请按上线计划执行，有问题群里说。
Source Sentence: p2_b0_s3
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 关于后选生城和上线计化，请按上线计划执行，有问题群里说。
```

```text
Dropped Text: 关于候选生城和上线计划，请按上线计划执行，有问题群里说。
Source Sentence: p3_b0_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 关于候选生城和上线计划，请按上线计划执行，有问题群里说。
```

```text
Dropped Text: 关于候选生城和上线计化，请按上线计划执行，有问题群里说。
Source Sentence: p3_b0_s1
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 关于候选生城和上线计化，请按上线计划执行，有问题群里说。
```

```text
Dropped Text: 关于后选生城和上线计划，请按上线计划执行，有问题群里说。
Source Sentence: p3_b0_s2
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 关于后选生城和上线计划，请按上线计划执行，有问题群里说。
```

```text
Dropped Text: 关于后选生城和上线计化，请按上线计划执行，有问题群里说。
Source Sentence: p3_b0_s3
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 关于后选生城和上线计化，请按上线计划执行，有问题群里说。
```

### F. KenLM Input

KenLM Input Count: 4

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
关于候选生城和上线计划，请按上线计划执行，有问题群里说。
```

2.

```text
关于候选生城和上线计化，请按上线计划执行，有问题群里说。
```

3.

```text
关于后选生城和上线计划，请按上线计划执行，有问题群里说。
```

4.

```text
关于后选生城和上线计化，请按上线计划执行，有问题群里说。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"80d8d072c93bd03cae9cbb84c08e94e3da22d362211a19bb4e9529d389cfcbd9","bucketDomain":"tech_ai","count":4},{"pathId":"93e4109d85b5380fab48f556415ccbc466756d447402b61852516ce4b9af9d96","bucketDomain":"tech_ai","count":4},{"pathId":"2ad765c2b868ddad2f2aacc904cdbbff13b3bd2676190675e265773ee4a9a6ab","bucketDomain":"tech_ai","count":4},{"pathId":"65aa4e3a49b767d4a16d0bb386a6f55fc3d2885c77f30fc1f8e5824bd3aebf0a","bucketDomain":"tech_ai","count":4}]
crossPathInputCount: 16
crossPathOutputCount: 4
kenlmInputCount: 4
CrossPath Input == Assembly total: YES (16 vs 16)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d091

<a id="case-d091"></a>

### Case 基础信息

```text
Case ID: d091
Raw Text: 你好，我想点一杯燕麦拿铁，中杯，无糖。顺便问一下今天有贝果吗？
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `4669c9d2c2d898bd20ef91a3f6d00db29f118dc25b2df01550d959e1e091614d`

Bucket: `coffee` (`p0_b0`)

Assembly Sentences:

1.

```text
你好，我想点一杯燕麦拿铁，中杯，无糖。顺便问一下今天有贝果吗？
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 9.459999999999999

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 你好，我想点一杯燕麦拿铁，中杯，无糖。顺便问一下今天有贝果吗？
pathId: 4669c9d2c2d898bd20ef91a3f6d00db29f118dc25b2df01550d959e1e091614d
bucketDomain: coffee
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 你好，我想点一杯燕麦拿铁，中杯，无糖。顺便问一下今天有贝果吗？
keptFromPath: 4669c9d2c2d898bd20ef91a3f6d00db29f118dc25b2df01550d959e1e091614d
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
你好，我想点一杯燕麦拿铁，中杯，无糖。顺便问一下今天有贝果吗？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"4669c9d2c2d898bd20ef91a3f6d00db29f118dc25b2df01550d959e1e091614d","bucketDomain":"coffee","count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d092

<a id="case-d092"></a>

### Case 基础信息

```text
Case ID: d092
Raw Text: 麻烦帮我做一杯抹茶拿铁带走，大杯就行，谢谢。
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `3710d2726d9b83a417e0491e8b96ed9f4eff0bc90b7e7a7b91f4e68d31556789`

Bucket: `coffee` (`p0_b0`)

Assembly Sentences:

1.

```text
麻烦帮我做一杯抹茶拿铁带走，大杯就行，谢谢。
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 7.09

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 麻烦帮我做一杯抹茶拿铁带走，大杯就行，谢谢。
pathId: 3710d2726d9b83a417e0491e8b96ed9f4eff0bc90b7e7a7b91f4e68d31556789
bucketDomain: coffee
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 麻烦帮我做一杯抹茶拿铁带走，大杯就行，谢谢。
keptFromPath: 3710d2726d9b83a417e0491e8b96ed9f4eff0bc90b7e7a7b91f4e68d31556789
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
麻烦帮我做一杯抹茶拿铁带走，大杯就行，谢谢。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"3710d2726d9b83a417e0491e8b96ed9f4eff0bc90b7e7a7b91f4e68d31556789","bucketDomain":"coffee","count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d093

<a id="case-d093"></a>

### Case 基础信息

```text
Case ID: d093
Raw Text: 请问这款冰美式可以少冰吗？我赶时间，小杯。
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `b5fb4e06c6d554f84aad68793f1d47bfbcfc1534650747732e1622e2b49069b5`

Bucket: `coffee` (`p0_b0`)

Assembly Sentences:

1.

```text
请问这款冰美式可以少冰吗？我赶时间，小杯。
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 9.116

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 请问这款冰美式可以少冰吗？我赶时间，小杯。
pathId: b5fb4e06c6d554f84aad68793f1d47bfbcfc1534650747732e1622e2b49069b5
bucketDomain: coffee
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 请问这款冰美式可以少冰吗？我赶时间，小杯。
keptFromPath: b5fb4e06c6d554f84aad68793f1d47bfbcfc1534650747732e1622e2b49069b5
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
请问这款冰美式可以少冰吗？我赶时间，小杯。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"b5fb4e06c6d554f84aad68793f1d47bfbcfc1534650747732e1622e2b49069b5","bucketDomain":"coffee","count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d094

<a id="case-d094"></a>

### Case 基础信息

```text
Case ID: d094
Raw Text: 小陈，客户反馈翻译引擎接口报错，我们能不能加缓存，下午三点前把结论发群里？
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `192b84f072ea72e5bfc1e646510978c24cb4fc1275c9fb642895892d1fab1c0a`

Bucket: `tech_ai` (`p0_b0`)

Assembly Sentences:

1.

```text
小陈，客户反馈翻译引擎接口报错，我们能不能加缓存，下午三点前把结论发群里？
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 9.54

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 小陈，客户反馈翻译引擎接口报错，我们能不能加缓存，下午三点前把结论发群里？
pathId: 192b84f072ea72e5bfc1e646510978c24cb4fc1275c9fb642895892d1fab1c0a
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 小陈，客户反馈翻译引擎接口报错，我们能不能加缓存，下午三点前把结论发群里？
keptFromPath: 192b84f072ea72e5bfc1e646510978c24cb4fc1275c9fb642895892d1fab1c0a
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
小陈，客户反馈翻译引擎接口报错，我们能不能加缓存，下午三点前把结论发群里？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"192b84f072ea72e5bfc1e646510978c24cb4fc1275c9fb642895892d1fab1c0a","bucketDomain":"tech_ai","count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d095

<a id="case-d095"></a>

### Case 基础信息

```text
Case ID: d095
Raw Text: 今天的站会先过一下订单中台进度，内存占用高这块需要限流保护，大家看一下风险。
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `1818371cb2a90c789c7b281c3cc36a23715bfc08e3164930fe2034ce6bc0785f`

Bucket: `food_order` (`p0_b0`)

Assembly Sentences:

1.

```text
今天的站会先过一下订单中台进度，内存占用高这块需要限流保护，大家看一下风险。
```

- sentenceId: `p0_b0_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.4

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 今天的站会先过一下订单中台进度，内存占用高这块需要限流保护，大家看一下风险。
pathId: 1818371cb2a90c789c7b281c3cc36a23715bfc08e3164930fe2034ce6bc0785f
bucketDomain: food_order
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 今天的站会先过一下订单中台进度，内存占用高这块需要限流保护，大家看一下风险。
keptFromPath: 1818371cb2a90c789c7b281c3cc36a23715bfc08e3164930fe2034ce6bc0785f
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
今天的站会先过一下订单中台进度，内存占用高这块需要限流保护，大家看一下风险。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"1818371cb2a90c789c7b281c3cc36a23715bfc08e3164930fe2034ce6bc0785f","bucketDomain":"food_order","count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d096

<a id="case-d096"></a>

### Case 基础信息

```text
Case ID: d096
Raw Text: 跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。
Path Count: 1
Bucket Count: 3
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `54a9f07e03af142eb5a06f0dd3e6a30fb09f82b47cd652dc08d575fdfc606551`

Bucket: `food_order` (`p0_b0`)

Assembly Sentences:

1.

```text
跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。
```

- sentenceId: `p0_b0_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

#### Path: `54a9f07e03af142eb5a06f0dd3e6a30fb09f82b47cd652dc08d575fdfc606551`

Bucket: `meeting` (`p0_b1`)

Assembly Sentences:

1.

```text
跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。
```

- sentenceId: `p0_b1_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

#### Path: `54a9f07e03af142eb5a06f0dd3e6a30fb09f82b47cd652dc08d575fdfc606551`

Bucket: `tech_ai` (`p0_b2`)

Assembly Sentences:

1.

```text
跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。
```

- sentenceId: `p0_b2_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 3

1.

```text
text: 跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。
pathId: 54a9f07e03af142eb5a06f0dd3e6a30fb09f82b47cd652dc08d575fdfc606551
bucketDomain: food_order
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。
pathId: 54a9f07e03af142eb5a06f0dd3e6a30fb09f82b47cd652dc08d575fdfc606551
bucketDomain: meeting
sourceSentenceId: p0_b1_s0
```

3.

```text
text: 跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。
pathId: 54a9f07e03af142eb5a06f0dd3e6a30fb09f82b47cd652dc08d575fdfc606551
bucketDomain: tech_ai
sourceSentenceId: p0_b2_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。
keptFromPath: 54a9f07e03af142eb5a06f0dd3e6a30fb09f82b47cd652dc08d575fdfc606551
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

```text
Dropped Text: 跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。
Source Sentence: p0_b1_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。
```

```text
Dropped Text: 跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。
Source Sentence: p0_b2_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。
```

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"54a9f07e03af142eb5a06f0dd3e6a30fb09f82b47cd652dc08d575fdfc606551","bucketDomain":"food_order","count":1},{"pathId":"54a9f07e03af142eb5a06f0dd3e6a30fb09f82b47cd652dc08d575fdfc606551","bucketDomain":"meeting","count":1},{"pathId":"54a9f07e03af142eb5a06f0dd3e6a30fb09f82b47cd652dc08d575fdfc606551","bucketDomain":"tech_ai","count":1}]
crossPathInputCount: 3
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (3 vs 3)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d097

<a id="case-d097"></a>

### Case 基础信息

```text
Case ID: d097
Raw Text: 师傅，去中关村软件园，走四环。我赶九点半的会，要是堵车您提前跟我说。
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `174f7f6d9ead999fba8f66af1fe534b6649948328258b218c68265dbd8ef2d16`

Bucket: `tourism_hotel` (`p0_b0`)

Assembly Sentences:

1.

```text
师傅，去中关村软件园，走四环。我赶酒店半的会，要是堵车您提前跟我说。
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 4.72

2.

```text
师傅，去中关村软件园，走四环。我赶九点半的会，要是堵车您提前跟我说。
```

- sentenceId: `p0_b0_s1`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 2
- assemblyScore: 2.36

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 2

1.

```text
text: 师傅，去中关村软件园，走四环。我赶酒店半的会，要是堵车您提前跟我说。
pathId: 174f7f6d9ead999fba8f66af1fe534b6649948328258b218c68265dbd8ef2d16
bucketDomain: tourism_hotel
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 师傅，去中关村软件园，走四环。我赶九点半的会，要是堵车您提前跟我说。
pathId: 174f7f6d9ead999fba8f66af1fe534b6649948328258b218c68265dbd8ef2d16
bucketDomain: tourism_hotel
sourceSentenceId: p0_b0_s1
```

### D. CrossPath Output

Count: 2

1.

```text
text: 师傅，去中关村软件园，走四环。我赶酒店半的会，要是堵车您提前跟我说。
keptFromPath: 174f7f6d9ead999fba8f66af1fe534b6649948328258b218c68265dbd8ef2d16
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 师傅，去中关村软件园，走四环。我赶九点半的会，要是堵车您提前跟我说。
keptFromPath: 174f7f6d9ead999fba8f66af1fe534b6649948328258b218c68265dbd8ef2d16
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s1
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 2

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
师傅，去中关村软件园，走四环。我赶酒店半的会，要是堵车您提前跟我说。
```

2.

```text
师傅，去中关村软件园，走四环。我赶九点半的会，要是堵车您提前跟我说。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"174f7f6d9ead999fba8f66af1fe534b6649948328258b218c68265dbd8ef2d16","bucketDomain":"tourism_hotel","count":2}]
crossPathInputCount: 2
crossPathOutputCount: 2
kenlmInputCount: 2
CrossPath Input == Assembly total: YES (2 vs 2)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d098

<a id="case-d098"></a>

### Case 基础信息

```text
Case ID: d098
Raw Text: 麻烦送我到国贸三期南门，大概多久能到？我十点十分有个电话会。
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `5e9009eef0d21f74596c5a09a2e424e9bd26bcd10a32e19a58a4e393c518fd80`

Bucket: `null` (`p0_b0`)

Assembly Sentences:

1.

```text
麻烦送我到国贸三期南门，大概多久能到？我十点十分有个电话会。
```

- sentenceId: `p0_b0_s0`
- category: `RAW_ORIGINAL`
- assemblyRank: 1
- assemblyScore: 0

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 麻烦送我到国贸三期南门，大概多久能到？我十点十分有个电话会。
pathId: 5e9009eef0d21f74596c5a09a2e424e9bd26bcd10a32e19a58a4e393c518fd80
bucketDomain: null
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 麻烦送我到国贸三期南门，大概多久能到？我十点十分有个电话会。
keptFromPath: 5e9009eef0d21f74596c5a09a2e424e9bd26bcd10a32e19a58a4e393c518fd80
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
麻烦送我到国贸三期南门，大概多久能到？我十点十分有个电话会。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"5e9009eef0d21f74596c5a09a2e424e9bd26bcd10a32e19a58a4e393c518fd80","bucketDomain":null,"count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d099

<a id="case-d099"></a>

### Case 基础信息

```text
Case ID: d099
Raw Text: 去望京SOHO，不走机场高速可以吗？那边现在堵不堵？
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `ddfbac6f9296824f691d630acfe7f183ecc93ff378f768bc7526ebaf4a41fc0c`

Bucket: `tourism_transport` (`p0_b0`)

Assembly Sentences:

1.

```text
去望京SOHO，不走机场高速可以吗？那边现在堵不堵？
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 4.8

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 去望京SOHO，不走机场高速可以吗？那边现在堵不堵？
pathId: ddfbac6f9296824f691d630acfe7f183ecc93ff378f768bc7526ebaf4a41fc0c
bucketDomain: tourism_transport
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 去望京SOHO，不走机场高速可以吗？那边现在堵不堵？
keptFromPath: ddfbac6f9296824f691d630acfe7f183ecc93ff378f768bc7526ebaf4a41fc0c
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
去望京SOHO，不走机场高速可以吗？那边现在堵不堵？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"ddfbac6f9296824f691d630acfe7f183ecc93ff378f768bc7526ebaf4a41fc0c","bucketDomain":"tourism_transport","count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d100

<a id="case-d100"></a>

### Case 基础信息

```text
Case ID: d100
Raw Text: 医生您好，我这两天头痛，想开点药并做个血常规。
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `ee5e0704d1330d3bb9f608b6494272a9fc1dc65bbb9bac1f982062dbf1d15534`

Bucket: `medical` (`p0_b0`)

Assembly Sentences:

1.

```text
医生您好，我这两天头痛，想开点药并做个血常规。
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 4.71

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 医生您好，我这两天头痛，想开点药并做个血常规。
pathId: ee5e0704d1330d3bb9f608b6494272a9fc1dc65bbb9bac1f982062dbf1d15534
bucketDomain: medical
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 医生您好，我这两天头痛，想开点药并做个血常规。
keptFromPath: ee5e0704d1330d3bb9f608b6494272a9fc1dc65bbb9bac1f982062dbf1d15534
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
医生您好，我这两天头痛，想开点药并做个血常规。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"ee5e0704d1330d3bb9f608b6494272a9fc1dc65bbb9bac1f982062dbf1d15534","bucketDomain":"medical","count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d101

<a id="case-d101"></a>

### Case 基础信息

```text
Case ID: d101
Raw Text: 挂号处请问内科还有号吗？我胃不舒服，昨晚开始的。
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `149552ff4805e58b3b09f4417f9d2d26276516ca341bc6c2b9ceba03938dda37`

Bucket: `medical` (`p0_b0`)

Assembly Sentences:

1.

```text
挂号处请问内科还有号吗？我胃不舒服，昨晚开始的。
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 4.71

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 挂号处请问内科还有号吗？我胃不舒服，昨晚开始的。
pathId: 149552ff4805e58b3b09f4417f9d2d26276516ca341bc6c2b9ceba03938dda37
bucketDomain: medical
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 挂号处请问内科还有号吗？我胃不舒服，昨晚开始的。
keptFromPath: 149552ff4805e58b3b09f4417f9d2d26276516ca341bc6c2b9ceba03938dda37
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
挂号处请问内科还有号吗？我胃不舒服，昨晚开始的。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"149552ff4805e58b3b09f4417f9d2d26276516ca341bc6c2b9ceba03938dda37","bucketDomain":"medical","count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d102

<a id="case-d102"></a>

### Case 基础信息

```text
Case ID: d102
Raw Text: 这个检查报告什么时候能出？我过敏发痒，需要请假休息吗？
Path Count: 1
Bucket Count: 3
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `fa8f5c186469a544f504e2b1180e1f88870a9ded26eff5007a876fd7ef34e55d`

Bucket: `coffee` (`p0_b0`)

Assembly Sentences:

1.

```text
这个检查报告什么时候能出？我过敏发痒，需要请假休息吗？
```

- sentenceId: `p0_b0_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

#### Path: `fa8f5c186469a544f504e2b1180e1f88870a9ded26eff5007a876fd7ef34e55d`

Bucket: `food_order` (`p0_b1`)

Assembly Sentences:

1.

```text
这个检查报告什么时候能出？我过敏发痒，需要请假休息吗？
```

- sentenceId: `p0_b1_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.4

#### Path: `fa8f5c186469a544f504e2b1180e1f88870a9ded26eff5007a876fd7ef34e55d`

Bucket: `tech_ai` (`p0_b2`)

Assembly Sentences:

1.

```text
这个检查报告什么时候能出？我过敏发痒，需要请假休息吗？
```

- sentenceId: `p0_b2_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 3

1.

```text
text: 这个检查报告什么时候能出？我过敏发痒，需要请假休息吗？
pathId: fa8f5c186469a544f504e2b1180e1f88870a9ded26eff5007a876fd7ef34e55d
bucketDomain: coffee
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 这个检查报告什么时候能出？我过敏发痒，需要请假休息吗？
pathId: fa8f5c186469a544f504e2b1180e1f88870a9ded26eff5007a876fd7ef34e55d
bucketDomain: food_order
sourceSentenceId: p0_b1_s0
```

3.

```text
text: 这个检查报告什么时候能出？我过敏发痒，需要请假休息吗？
pathId: fa8f5c186469a544f504e2b1180e1f88870a9ded26eff5007a876fd7ef34e55d
bucketDomain: tech_ai
sourceSentenceId: p0_b2_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 这个检查报告什么时候能出？我过敏发痒，需要请假休息吗？
keptFromPath: fa8f5c186469a544f504e2b1180e1f88870a9ded26eff5007a876fd7ef34e55d
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

```text
Dropped Text: 这个检查报告什么时候能出？我过敏发痒，需要请假休息吗？
Source Sentence: p0_b1_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 这个检查报告什么时候能出？我过敏发痒，需要请假休息吗？
```

```text
Dropped Text: 这个检查报告什么时候能出？我过敏发痒，需要请假休息吗？
Source Sentence: p0_b2_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 这个检查报告什么时候能出？我过敏发痒，需要请假休息吗？
```

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
这个检查报告什么时候能出？我过敏发痒，需要请假休息吗？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"fa8f5c186469a544f504e2b1180e1f88870a9ded26eff5007a876fd7ef34e55d","bucketDomain":"coffee","count":1},{"pathId":"fa8f5c186469a544f504e2b1180e1f88870a9ded26eff5007a876fd7ef34e55d","bucketDomain":"food_order","count":1},{"pathId":"fa8f5c186469a544f504e2b1180e1f88870a9ded26eff5007a876fd7ef34e55d","bucketDomain":"tech_ai","count":1}]
crossPathInputCount: 3
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (3 vs 3)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d103

<a id="case-d103"></a>

### Case 基础信息

```text
Case ID: d103
Raw Text: 这件外套能试穿吗？我穿中码。买两件有没有折扣？
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `bf0502a46c3d5c83e4576c1730ccf54b973d21032960d5f734d5d84962bf783f`

Bucket: `tech_ai` (`p0_b0`)

Assembly Sentences:

1.

```text
这件外套能试穿吗？我穿中码。买量检有没有折扣？
```

- sentenceId: `p0_b0_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

2.

```text
这件外套能试穿吗？我穿中码。买两件有没有折扣？
```

- sentenceId: `p0_b0_s1`
- category: `RAW_ORIGINAL`
- assemblyRank: 2
- assemblyScore: 0

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 2

1.

```text
text: 这件外套能试穿吗？我穿中码。买量检有没有折扣？
pathId: bf0502a46c3d5c83e4576c1730ccf54b973d21032960d5f734d5d84962bf783f
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 这件外套能试穿吗？我穿中码。买两件有没有折扣？
pathId: bf0502a46c3d5c83e4576c1730ccf54b973d21032960d5f734d5d84962bf783f
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s1
```

### D. CrossPath Output

Count: 2

1.

```text
text: 这件外套能试穿吗？我穿中码。买量检有没有折扣？
keptFromPath: bf0502a46c3d5c83e4576c1730ccf54b973d21032960d5f734d5d84962bf783f
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 这件外套能试穿吗？我穿中码。买两件有没有折扣？
keptFromPath: bf0502a46c3d5c83e4576c1730ccf54b973d21032960d5f734d5d84962bf783f
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s1
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 2

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
这件外套能试穿吗？我穿中码。买量检有没有折扣？
```

2.

```text
这件外套能试穿吗？我穿中码。买两件有没有折扣？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"bf0502a46c3d5c83e4576c1730ccf54b973d21032960d5f734d5d84962bf783f","bucketDomain":"tech_ai","count":2}]
crossPathInputCount: 2
crossPathOutputCount: 2
kenlmInputCount: 2
CrossPath Input == Assembly total: YES (2 vs 2)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d104

<a id="case-d104"></a>

### Case 基础信息

```text
Case ID: d104
Raw Text: 请问这双鞋有四十码吗？不合适三天内可以退换吧？
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `273cfbaf61f2e19636f9a795cf32d7cfe4b6575d1affcccfa8a8ee4e6eb56721`

Bucket: `medical` (`p0_b0`)

Assembly Sentences:

1.

```text
请问这双鞋有四十码吗？不合适三天内科医退换吧？
```

- sentenceId: `p0_b0_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

2.

```text
请问这双鞋有四十码吗？不合适三天内可以退换吧？
```

- sentenceId: `p0_b0_s1`
- category: `RAW_ORIGINAL`
- assemblyRank: 2
- assemblyScore: 0

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 2

1.

```text
text: 请问这双鞋有四十码吗？不合适三天内科医退换吧？
pathId: 273cfbaf61f2e19636f9a795cf32d7cfe4b6575d1affcccfa8a8ee4e6eb56721
bucketDomain: medical
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 请问这双鞋有四十码吗？不合适三天内可以退换吧？
pathId: 273cfbaf61f2e19636f9a795cf32d7cfe4b6575d1affcccfa8a8ee4e6eb56721
bucketDomain: medical
sourceSentenceId: p0_b0_s1
```

### D. CrossPath Output

Count: 2

1.

```text
text: 请问这双鞋有四十码吗？不合适三天内科医退换吧？
keptFromPath: 273cfbaf61f2e19636f9a795cf32d7cfe4b6575d1affcccfa8a8ee4e6eb56721
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 请问这双鞋有四十码吗？不合适三天内可以退换吧？
keptFromPath: 273cfbaf61f2e19636f9a795cf32d7cfe4b6575d1affcccfa8a8ee4e6eb56721
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s1
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 2

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
请问这双鞋有四十码吗？不合适三天内科医退换吧？
```

2.

```text
请问这双鞋有四十码吗？不合适三天内可以退换吧？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"273cfbaf61f2e19636f9a795cf32d7cfe4b6575d1affcccfa8a8ee4e6eb56721","bucketDomain":"medical","count":2}]
crossPathInputCount: 2
crossPathOutputCount: 2
kenlmInputCount: 2
CrossPath Input == Assembly total: YES (2 vs 2)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d105

<a id="case-d105"></a>

### Case 基础信息

```text
Case ID: d105
Raw Text: 我想对比一下这两款订单中台的价格，会员日能再减一点吗？
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `72d46d6d27ed168a2b446ccc0ef5ca29e9e538e6e0e94d9ab712448785bc00fc`

Bucket: `food_order` (`p0_b0`)

Assembly Sentences:

1.

```text
我想对比一下这两款订单中台的价格，会员日能再减一点吗？
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 4.76

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 我想对比一下这两款订单中台的价格，会员日能再减一点吗？
pathId: 72d46d6d27ed168a2b446ccc0ef5ca29e9e538e6e0e94d9ab712448785bc00fc
bucketDomain: food_order
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 我想对比一下这两款订单中台的价格，会员日能再减一点吗？
keptFromPath: 72d46d6d27ed168a2b446ccc0ef5ca29e9e538e6e0e94d9ab712448785bc00fc
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
我想对比一下这两款订单中台的价格，会员日能再减一点吗？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"72d46d6d27ed168a2b446ccc0ef5ca29e9e538e6e0e94d9ab712448785bc00fc","bucketDomain":"food_order","count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d106

<a id="case-d106"></a>

### Case 基础信息

```text
Case ID: d106
Raw Text: 周末要不要去江边骑行？天气预报说周日多云，记得带水。
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `ef362a7409d257efe1af2da13a738a0d169e7c13cebf78fc693f2e600087c365`

Bucket: `null` (`p0_b0`)

Assembly Sentences:

1.

```text
周末要不要去江边骑行？天气预报说周日多云，记得带水。
```

- sentenceId: `p0_b0_s0`
- category: `RAW_ORIGINAL`
- assemblyRank: 1
- assemblyScore: 0

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 周末要不要去江边骑行？天气预报说周日多云，记得带水。
pathId: ef362a7409d257efe1af2da13a738a0d169e7c13cebf78fc693f2e600087c365
bucketDomain: null
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 周末要不要去江边骑行？天气预报说周日多云，记得带水。
keptFromPath: ef362a7409d257efe1af2da13a738a0d169e7c13cebf78fc693f2e600087c365
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
周末要不要去江边骑行？天气预报说周日多云，记得带水。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"ef362a7409d257efe1af2da13a738a0d169e7c13cebf78fc693f2e600087c365","bucketDomain":null,"count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d107

<a id="case-d107"></a>

### Case 基础信息

```text
Case ID: d107
Raw Text: 晚上一起吃饭吗？我知道一家川菜不错，大概七点到。
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `37367286bf78ef457c58421ac1cc51772b81498372ff6046875c912bacb0a3ca`

Bucket: `null` (`p0_b0`)

Assembly Sentences:

1.

```text
晚上一起吃饭吗？我知道一家川菜不错，大概七点到。
```

- sentenceId: `p0_b0_s0`
- category: `RAW_ORIGINAL`
- assemblyRank: 1
- assemblyScore: 0

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 晚上一起吃饭吗？我知道一家川菜不错，大概七点到。
pathId: 37367286bf78ef457c58421ac1cc51772b81498372ff6046875c912bacb0a3ca
bucketDomain: null
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 晚上一起吃饭吗？我知道一家川菜不错，大概七点到。
keptFromPath: 37367286bf78ef457c58421ac1cc51772b81498372ff6046875c912bacb0a3ca
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
晚上一起吃饭吗？我知道一家川菜不错，大概七点到。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"37367286bf78ef457c58421ac1cc51772b81498372ff6046875c912bacb0a3ca","bucketDomain":null,"count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d108

<a id="case-d108"></a>

### Case 基础信息

```text
Case ID: d108
Raw Text: 你最近忙不忙？想找你看下手机备份怎么设置。
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `8abbc76111de7c632d7d17362fe9a7cda58f3c9572ab70bc308648553237b238`

Bucket: `null` (`p0_b0`)

Assembly Sentences:

1.

```text
你最近忙不忙？想找你看下手机备份怎么设置。
```

- sentenceId: `p0_b0_s0`
- category: `RAW_ORIGINAL`
- assemblyRank: 1
- assemblyScore: 0

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 你最近忙不忙？想找你看下手机备份怎么设置。
pathId: 8abbc76111de7c632d7d17362fe9a7cda58f3c9572ab70bc308648553237b238
bucketDomain: null
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 你最近忙不忙？想找你看下手机备份怎么设置。
keptFromPath: 8abbc76111de7c632d7d17362fe9a7cda58f3c9572ab70bc308648553237b238
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
你最近忙不忙？想找你看下手机备份怎么设置。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"8abbc76111de7c632d7d17362fe9a7cda58f3c9572ab70bc308648553237b238","bucketDomain":null,"count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d109

<a id="case-d109"></a>

### Case 基础信息

```text
Case ID: d109
Raw Text: 今天我们团队要讨论后选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
Path Count: 2
Bucket Count: 2
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8`

Bucket: `tech_ai` (`p0_b0`)

Assembly Sentences:

1.

```text
今天我们团队要讨论候选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 12.02

2.

```text
今天我们团队要讨论候选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
```

- sentenceId: `p0_b0_s1`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 2
- assemblyScore: 9.62

3.

```text
今天我们团队要讨论后选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
```

- sentenceId: `p0_b0_s2`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 3
- assemblyScore: 9.6

4.

```text
今天我们团队要讨论候选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
```

- sentenceId: `p0_b0_s3`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 4
- assemblyScore: 9.6

5.

```text
今天我们团队要讨论后选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
```

- sentenceId: `p0_b0_s4`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 5
- assemblyScore: 7.199999999999999

6.

```text
今天我们团队要讨论候选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
```

- sentenceId: `p0_b0_s5`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 6
- assemblyScore: 7.199999999999999

7.

```text
今天我们团队要讨论后选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
```

- sentenceId: `p0_b0_s6`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 7
- assemblyScore: 7.18

8.

```text
今天我们团队要讨论后选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
```

- sentenceId: `p0_b0_s7`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 8
- assemblyScore: 4.779999999999999

#### Path: `982f3f240464b76e9444a459acaf33ee860bc86f3827f03a9ecc863f3bb62ddb`

Bucket: `tech_ai` (`p1_b0`)

Assembly Sentences:

1.

```text
今天我们团队要讨论候选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
```

- sentenceId: `p1_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 9.239999999999998

2.

```text
今天我们团队要讨论候选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
```

- sentenceId: `p1_b0_s1`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 2
- assemblyScore: 7.199999999999999

3.

```text
今天我们团队要讨论后选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
```

- sentenceId: `p1_b0_s2`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 3
- assemblyScore: 6.819999999999999

4.

```text
今天我们团队要讨论候选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
```

- sentenceId: `p1_b0_s3`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 4
- assemblyScore: 6.819999999999999

5.

```text
今天我们团队要讨论后选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
```

- sentenceId: `p1_b0_s4`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 5
- assemblyScore: 4.779999999999999

6.

```text
今天我们团队要讨论候选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
```

- sentenceId: `p1_b0_s5`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 6
- assemblyScore: 4.779999999999999

7.

```text
今天我们团队要讨论后选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
```

- sentenceId: `p1_b0_s6`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 7
- assemblyScore: 4.4

8.

```text
今天我们团队要讨论后选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
```

- sentenceId: `p1_b0_s7`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 8
- assemblyScore: 2.36

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 16

1.

```text
text: 今天我们团队要讨论候选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
pathId: e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 今天我们团队要讨论候选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
pathId: e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s1
```

3.

```text
text: 今天我们团队要讨论后选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
pathId: e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s2
```

4.

```text
text: 今天我们团队要讨论候选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
pathId: e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s3
```

5.

```text
text: 今天我们团队要讨论后选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
pathId: e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s4
```

6.

```text
text: 今天我们团队要讨论候选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
pathId: e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s5
```

7.

```text
text: 今天我们团队要讨论后选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
pathId: e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s6
```

8.

```text
text: 今天我们团队要讨论后选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
pathId: e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s7
```

9.

```text
text: 今天我们团队要讨论候选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
pathId: 982f3f240464b76e9444a459acaf33ee860bc86f3827f03a9ecc863f3bb62ddb
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s0
```

10.

```text
text: 今天我们团队要讨论候选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
pathId: 982f3f240464b76e9444a459acaf33ee860bc86f3827f03a9ecc863f3bb62ddb
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s1
```

11.

```text
text: 今天我们团队要讨论后选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
pathId: 982f3f240464b76e9444a459acaf33ee860bc86f3827f03a9ecc863f3bb62ddb
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s2
```

12.

```text
text: 今天我们团队要讨论候选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
pathId: 982f3f240464b76e9444a459acaf33ee860bc86f3827f03a9ecc863f3bb62ddb
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s3
```

13.

```text
text: 今天我们团队要讨论后选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
pathId: 982f3f240464b76e9444a459acaf33ee860bc86f3827f03a9ecc863f3bb62ddb
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s4
```

14.

```text
text: 今天我们团队要讨论候选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
pathId: 982f3f240464b76e9444a459acaf33ee860bc86f3827f03a9ecc863f3bb62ddb
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s5
```

15.

```text
text: 今天我们团队要讨论后选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
pathId: 982f3f240464b76e9444a459acaf33ee860bc86f3827f03a9ecc863f3bb62ddb
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s6
```

16.

```text
text: 今天我们团队要讨论后选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
pathId: 982f3f240464b76e9444a459acaf33ee860bc86f3827f03a9ecc863f3bb62ddb
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s7
```

### D. CrossPath Output

Count: 8

1.

```text
text: 今天我们团队要讨论候选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
keptFromPath: e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 今天我们团队要讨论候选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
keptFromPath: e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s1
```

3.

```text
text: 今天我们团队要讨论后选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
keptFromPath: e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s2
```

4.

```text
text: 今天我们团队要讨论候选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
keptFromPath: e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s3
```

5.

```text
text: 今天我们团队要讨论后选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
keptFromPath: e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s4
```

6.

```text
text: 今天我们团队要讨论候选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
keptFromPath: e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s5
```

7.

```text
text: 今天我们团队要讨论后选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
keptFromPath: e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s6
```

8.

```text
text: 今天我们团队要讨论后选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
keptFromPath: e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s7
```

### E. CrossPath 删除项

```text
Dropped Text: 今天我们团队要讨论候选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
Source Sentence: p1_b0_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 今天我们团队要讨论候选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
```

```text
Dropped Text: 今天我们团队要讨论候选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
Source Sentence: p1_b0_s1
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 今天我们团队要讨论候选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
```

```text
Dropped Text: 今天我们团队要讨论后选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
Source Sentence: p1_b0_s2
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 今天我们团队要讨论后选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
```

```text
Dropped Text: 今天我们团队要讨论候选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
Source Sentence: p1_b0_s3
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 今天我们团队要讨论候选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
```

```text
Dropped Text: 今天我们团队要讨论后选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
Source Sentence: p1_b0_s4
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 今天我们团队要讨论后选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
```

```text
Dropped Text: 今天我们团队要讨论候选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
Source Sentence: p1_b0_s5
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 今天我们团队要讨论候选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
```

```text
Dropped Text: 今天我们团队要讨论后选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
Source Sentence: p1_b0_s6
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 今天我们团队要讨论后选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
```

```text
Dropped Text: 今天我们团队要讨论后选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
Source Sentence: p1_b0_s7
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 今天我们团队要讨论后选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
```

### F. KenLM Input

KenLM Input Count: 8

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
今天我们团队要讨论候选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
```

2.

```text
今天我们团队要讨论候选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
```

3.

```text
今天我们团队要讨论后选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
```

4.

```text
今天我们团队要讨论候选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
```

5.

```text
今天我们团队要讨论后选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
```

6.

```text
今天我们团队要讨论候选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
```

7.

```text
今天我们团队要讨论后选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
```

8.

```text
今天我们团队要讨论后选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8","bucketDomain":"tech_ai","count":8},{"pathId":"982f3f240464b76e9444a459acaf33ee860bc86f3827f03a9ecc863f3bb62ddb","bucketDomain":"tech_ai","count":8}]
crossPathInputCount: 16
crossPathOutputCount: 8
kenlmInputCount: 8
CrossPath Input == Assembly total: YES (16 vs 16)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d110

<a id="case-d110"></a>

### Case 基础信息

```text
Case ID: d110
Raw Text: 这次发布我们先对齐上线计划窗口，后选生城模块需要联调，别漏掉回归。
Path Count: 2
Bucket Count: 2
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `d18e38f8936e3dae9107ea8e2acaf78da3b2472127b9644ea2be67380e9844d7`

Bucket: `tech_ai` (`p0_b0`)

Assembly Sentences:

1.

```text
这次发布我们先对齐上线计划窗口，候选生城模块需要联调，别漏掉回归。
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 14.4

2.

```text
这次发布我们先对齐上线计划窗口，后选生城模块需要联调，别漏掉回归。
```

- sentenceId: `p0_b0_s1`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 2
- assemblyScore: 11.98

#### Path: `d0727a8e1c03785b04ed2877ce853d0488af5bbfebedbe740226ff2cb15c2120`

Bucket: `tech_ai` (`p1_b0`)

Assembly Sentences:

1.

```text
这次发布我们先对齐上线计划窗口，候选生城模块需要联调，别漏掉回归。
```

- sentenceId: `p1_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 11.620000000000001

2.

```text
这次发布我们先对齐上线计划窗口，后选生城模块需要联调，别漏掉回归。
```

- sentenceId: `p1_b0_s1`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 2
- assemblyScore: 9.200000000000001

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 4

1.

```text
text: 这次发布我们先对齐上线计划窗口，候选生城模块需要联调，别漏掉回归。
pathId: d18e38f8936e3dae9107ea8e2acaf78da3b2472127b9644ea2be67380e9844d7
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 这次发布我们先对齐上线计划窗口，后选生城模块需要联调，别漏掉回归。
pathId: d18e38f8936e3dae9107ea8e2acaf78da3b2472127b9644ea2be67380e9844d7
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s1
```

3.

```text
text: 这次发布我们先对齐上线计划窗口，候选生城模块需要联调，别漏掉回归。
pathId: d0727a8e1c03785b04ed2877ce853d0488af5bbfebedbe740226ff2cb15c2120
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s0
```

4.

```text
text: 这次发布我们先对齐上线计划窗口，后选生城模块需要联调，别漏掉回归。
pathId: d0727a8e1c03785b04ed2877ce853d0488af5bbfebedbe740226ff2cb15c2120
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s1
```

### D. CrossPath Output

Count: 2

1.

```text
text: 这次发布我们先对齐上线计划窗口，候选生城模块需要联调，别漏掉回归。
keptFromPath: d18e38f8936e3dae9107ea8e2acaf78da3b2472127b9644ea2be67380e9844d7
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 这次发布我们先对齐上线计划窗口，后选生城模块需要联调，别漏掉回归。
keptFromPath: d18e38f8936e3dae9107ea8e2acaf78da3b2472127b9644ea2be67380e9844d7
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s1
```

### E. CrossPath 删除项

```text
Dropped Text: 这次发布我们先对齐上线计划窗口，候选生城模块需要联调，别漏掉回归。
Source Sentence: p1_b0_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 这次发布我们先对齐上线计划窗口，候选生城模块需要联调，别漏掉回归。
```

```text
Dropped Text: 这次发布我们先对齐上线计划窗口，后选生城模块需要联调，别漏掉回归。
Source Sentence: p1_b0_s1
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 这次发布我们先对齐上线计划窗口，后选生城模块需要联调，别漏掉回归。
```

### F. KenLM Input

KenLM Input Count: 2

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
这次发布我们先对齐上线计划窗口，候选生城模块需要联调，别漏掉回归。
```

2.

```text
这次发布我们先对齐上线计划窗口，后选生城模块需要联调，别漏掉回归。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"d18e38f8936e3dae9107ea8e2acaf78da3b2472127b9644ea2be67380e9844d7","bucketDomain":"tech_ai","count":2},{"pathId":"d0727a8e1c03785b04ed2877ce853d0488af5bbfebedbe740226ff2cb15c2120","bucketDomain":"tech_ai","count":2}]
crossPathInputCount: 4
crossPathOutputCount: 2
kenlmInputCount: 2
CrossPath Input == Assembly total: YES (4 vs 4)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d111

<a id="case-d111"></a>

### Case 基础信息

```text
Case ID: d111
Raw Text: 会上提到候选生成链路要加监控，上线计划文档我下午更新一版。
Path Count: 2
Bucket Count: 2
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `a4c0876153861a0089493877032bd3ee43b5520178506c0cdfc830637f46a8ea`

Bucket: `tech_ai` (`p0_b0`)

Assembly Sentences:

1.

```text
会上提到候选生成链路要加监控，上线计划文档我下午更新一版。
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 12

#### Path: `53fa80de77688323aeb8193f42739986f77dbdf76c39a3718b63b712cb31c9ed`

Bucket: `tech_ai` (`p1_b0`)

Assembly Sentences:

1.

```text
会上提到候选生成链路要加监控，上线计划文档我下午更新一版。
```

- sentenceId: `p1_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 9.219999999999999

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 2

1.

```text
text: 会上提到候选生成链路要加监控，上线计划文档我下午更新一版。
pathId: a4c0876153861a0089493877032bd3ee43b5520178506c0cdfc830637f46a8ea
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 会上提到候选生成链路要加监控，上线计划文档我下午更新一版。
pathId: 53fa80de77688323aeb8193f42739986f77dbdf76c39a3718b63b712cb31c9ed
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 会上提到候选生成链路要加监控，上线计划文档我下午更新一版。
keptFromPath: a4c0876153861a0089493877032bd3ee43b5520178506c0cdfc830637f46a8ea
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

```text
Dropped Text: 会上提到候选生成链路要加监控，上线计划文档我下午更新一版。
Source Sentence: p1_b0_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 会上提到候选生成链路要加监控，上线计划文档我下午更新一版。
```

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
会上提到候选生成链路要加监控，上线计划文档我下午更新一版。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"a4c0876153861a0089493877032bd3ee43b5520178506c0cdfc830637f46a8ea","bucketDomain":"tech_ai","count":1},{"pathId":"53fa80de77688323aeb8193f42739986f77dbdf76c39a3718b63b712cb31c9ed","bucketDomain":"tech_ai","count":1}]
crossPathInputCount: 2
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (2 vs 2)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d112

<a id="case-d112"></a>

### Case 基础信息

```text
Case ID: d112
Raw Text: 您好，我订单显示已发货但物流三天没更新，能帮我查一下吗？
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `a0969349bce8ca48e5d13d7fac132d601e3919ee4e38c73a4763efa2a626b088`

Bucket: `food_order` (`p0_b0`)

Assembly Sentences:

1.

```text
您好，我订单显示已发货但物流三天没更新，能帮我查一下吗？
```

- sentenceId: `p0_b0_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.4

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 您好，我订单显示已发货但物流三天没更新，能帮我查一下吗？
pathId: a0969349bce8ca48e5d13d7fac132d601e3919ee4e38c73a4763efa2a626b088
bucketDomain: food_order
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 您好，我订单显示已发货但物流三天没更新，能帮我查一下吗？
keptFromPath: a0969349bce8ca48e5d13d7fac132d601e3919ee4e38c73a4763efa2a626b088
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
您好，我订单显示已发货但物流三天没更新，能帮我查一下吗？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"a0969349bce8ca48e5d13d7fac132d601e3919ee4e38c73a4763efa2a626b088","bucketDomain":"food_order","count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d113

<a id="case-d113"></a>

### Case 基础信息

```text
Case ID: d113
Raw Text: 想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。
Path Count: 1
Bucket Count: 4
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `3827924af8b5fc1e5dcc9c033f608a7c7a11790e401302ab152418017fcb5359`

Bucket: `coffee` (`p0_b0`)

Assembly Sentences:

1.

```text
想改一下收货低脂，还来得及吗？麻烦尽快处理，谢谢。
```

- sentenceId: `p0_b0_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

2.

```text
想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。
```

- sentenceId: `p0_b0_s1`
- category: `RAW_ORIGINAL`
- assemblyRank: 2
- assemblyScore: 0

#### Path: `3827924af8b5fc1e5dcc9c033f608a7c7a11790e401302ab152418017fcb5359`

Bucket: `food_order` (`p0_b1`)

Assembly Sentences:

1.

```text
想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。
```

- sentenceId: `p0_b1_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

#### Path: `3827924af8b5fc1e5dcc9c033f608a7c7a11790e401302ab152418017fcb5359`

Bucket: `milk_tea` (`p0_b2`)

Assembly Sentences:

1.

```text
想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。
```

- sentenceId: `p0_b2_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

#### Path: `3827924af8b5fc1e5dcc9c033f608a7c7a11790e401302ab152418017fcb5359`

Bucket: `tourism_route` (`p0_b3`)

Assembly Sentences:

1.

```text
想改一下收货地质，还来得及吗？麻烦尽快处理，谢谢。
```

- sentenceId: `p0_b3_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

2.

```text
想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。
```

- sentenceId: `p0_b3_s1`
- category: `RAW_ORIGINAL`
- assemblyRank: 2
- assemblyScore: 0

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 6

1.

```text
text: 想改一下收货低脂，还来得及吗？麻烦尽快处理，谢谢。
pathId: 3827924af8b5fc1e5dcc9c033f608a7c7a11790e401302ab152418017fcb5359
bucketDomain: coffee
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。
pathId: 3827924af8b5fc1e5dcc9c033f608a7c7a11790e401302ab152418017fcb5359
bucketDomain: coffee
sourceSentenceId: p0_b0_s1
```

3.

```text
text: 想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。
pathId: 3827924af8b5fc1e5dcc9c033f608a7c7a11790e401302ab152418017fcb5359
bucketDomain: food_order
sourceSentenceId: p0_b1_s0
```

4.

```text
text: 想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。
pathId: 3827924af8b5fc1e5dcc9c033f608a7c7a11790e401302ab152418017fcb5359
bucketDomain: milk_tea
sourceSentenceId: p0_b2_s0
```

5.

```text
text: 想改一下收货地质，还来得及吗？麻烦尽快处理，谢谢。
pathId: 3827924af8b5fc1e5dcc9c033f608a7c7a11790e401302ab152418017fcb5359
bucketDomain: tourism_route
sourceSentenceId: p0_b3_s0
```

6.

```text
text: 想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。
pathId: 3827924af8b5fc1e5dcc9c033f608a7c7a11790e401302ab152418017fcb5359
bucketDomain: tourism_route
sourceSentenceId: p0_b3_s1
```

### D. CrossPath Output

Count: 3

1.

```text
text: 想改一下收货低脂，还来得及吗？麻烦尽快处理，谢谢。
keptFromPath: 3827924af8b5fc1e5dcc9c033f608a7c7a11790e401302ab152418017fcb5359
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。
keptFromPath: 3827924af8b5fc1e5dcc9c033f608a7c7a11790e401302ab152418017fcb5359
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s1
```

3.

```text
text: 想改一下收货地质，还来得及吗？麻烦尽快处理，谢谢。
keptFromPath: 3827924af8b5fc1e5dcc9c033f608a7c7a11790e401302ab152418017fcb5359
keptFromBucket: p0_b3
sourceSentenceId: p0_b3_s0
```

### E. CrossPath 删除项

```text
Dropped Text: 想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。
Source Sentence: p0_b1_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。
```

```text
Dropped Text: 想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。
Source Sentence: p0_b2_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。
```

```text
Dropped Text: 想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。
Source Sentence: p0_b3_s1
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。
```

### F. KenLM Input

KenLM Input Count: 3

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
想改一下收货低脂，还来得及吗？麻烦尽快处理，谢谢。
```

2.

```text
想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。
```

3.

```text
想改一下收货地质，还来得及吗？麻烦尽快处理，谢谢。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"3827924af8b5fc1e5dcc9c033f608a7c7a11790e401302ab152418017fcb5359","bucketDomain":"coffee","count":2},{"pathId":"3827924af8b5fc1e5dcc9c033f608a7c7a11790e401302ab152418017fcb5359","bucketDomain":"food_order","count":1},{"pathId":"3827924af8b5fc1e5dcc9c033f608a7c7a11790e401302ab152418017fcb5359","bucketDomain":"milk_tea","count":1},{"pathId":"3827924af8b5fc1e5dcc9c033f608a7c7a11790e401302ab152418017fcb5359","bucketDomain":"tourism_route","count":2}]
crossPathInputCount: 6
crossPathOutputCount: 3
kenlmInputCount: 3
CrossPath Input == Assembly total: YES (6 vs 6)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d114

<a id="case-d114"></a>

### Case 基础信息

```text
Case ID: d114
Raw Text: 发票抬头开错了，能重新开具电子发票吗？
Path Count: 1
Bucket Count: 2
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `b40add9c18b994f3214720b91c9e39c1ec9a08acd66742f9b51723c5d1d357f6`

Bucket: `food_order` (`p0_b0`)

Assembly Sentences:

1.

```text
发票抬头开错了，能重新开具电子发票吗？
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 4.7

#### Path: `b40add9c18b994f3214720b91c9e39c1ec9a08acd66742f9b51723c5d1d357f6`

Bucket: `tourism_hotel` (`p0_b1`)

Assembly Sentences:

1.

```text
发票抬头开错了，能重新开具电子发票吗？
```

- sentenceId: `p0_b1_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 4.7

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 2

1.

```text
text: 发票抬头开错了，能重新开具电子发票吗？
pathId: b40add9c18b994f3214720b91c9e39c1ec9a08acd66742f9b51723c5d1d357f6
bucketDomain: food_order
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 发票抬头开错了，能重新开具电子发票吗？
pathId: b40add9c18b994f3214720b91c9e39c1ec9a08acd66742f9b51723c5d1d357f6
bucketDomain: tourism_hotel
sourceSentenceId: p0_b1_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 发票抬头开错了，能重新开具电子发票吗？
keptFromPath: b40add9c18b994f3214720b91c9e39c1ec9a08acd66742f9b51723c5d1d357f6
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

```text
Dropped Text: 发票抬头开错了，能重新开具电子发票吗？
Source Sentence: p0_b1_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 发票抬头开错了，能重新开具电子发票吗？
```

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
发票抬头开错了，能重新开具电子发票吗？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"b40add9c18b994f3214720b91c9e39c1ec9a08acd66742f9b51723c5d1d357f6","bucketDomain":"food_order","count":1},{"pathId":"b40add9c18b994f3214720b91c9e39c1ec9a08acd66742f9b51723c5d1d357f6","bucketDomain":"tourism_hotel","count":1}]
crossPathInputCount: 2
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (2 vs 2)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d115

<a id="case-d115"></a>

### Case 基础信息

```text
Case ID: d115
Raw Text: 请简单介绍一下你上一段项目里负责的核心模块和难点。
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `c33b910447acae81d7f3fcaec0bc8df744a479211aa365008054f6f07e77e730`

Bucket: `tech_ai` (`p0_b0`)

Assembly Sentences:

1.

```text
请简单介绍一下你上一段项目理服责的核心模块和难点。
```

- sentenceId: `p0_b0_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.04

2.

```text
请简单介绍一下你上一段项目里负责的核心模块和难点。
```

- sentenceId: `p0_b0_s1`
- category: `RAW_ORIGINAL`
- assemblyRank: 2
- assemblyScore: 0

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 2

1.

```text
text: 请简单介绍一下你上一段项目理服责的核心模块和难点。
pathId: c33b910447acae81d7f3fcaec0bc8df744a479211aa365008054f6f07e77e730
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 请简单介绍一下你上一段项目里负责的核心模块和难点。
pathId: c33b910447acae81d7f3fcaec0bc8df744a479211aa365008054f6f07e77e730
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s1
```

### D. CrossPath Output

Count: 2

1.

```text
text: 请简单介绍一下你上一段项目理服责的核心模块和难点。
keptFromPath: c33b910447acae81d7f3fcaec0bc8df744a479211aa365008054f6f07e77e730
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 请简单介绍一下你上一段项目里负责的核心模块和难点。
keptFromPath: c33b910447acae81d7f3fcaec0bc8df744a479211aa365008054f6f07e77e730
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s1
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 2

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
请简单介绍一下你上一段项目理服责的核心模块和难点。
```

2.

```text
请简单介绍一下你上一段项目里负责的核心模块和难点。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"c33b910447acae81d7f3fcaec0bc8df744a479211aa365008054f6f07e77e730","bucketDomain":"tech_ai","count":2}]
crossPathInputCount: 2
crossPathOutputCount: 2
kenlmInputCount: 2
CrossPath Input == Assembly total: YES (2 vs 2)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d116

<a id="case-d116"></a>

### Case 基础信息

```text
Case ID: d116
Raw Text: 你如何看待跨团队协作？遇到需求变更一般怎么处理？
Path Count: 1
Bucket Count: 2
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `b12f3cf0aef86ec71cf7ca92007b4ed2b271c07b66773e2211895464537dd8e6`

Bucket: `food_order` (`p0_b0`)

Assembly Sentences:

1.

```text
你如何看待跨团队协作？遇到需求变更一般怎么处理？
```

- sentenceId: `p0_b0_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

#### Path: `b12f3cf0aef86ec71cf7ca92007b4ed2b271c07b66773e2211895464537dd8e6`

Bucket: `milk_tea` (`p0_b1`)

Assembly Sentences:

1.

```text
你如何看待跨团队协作？遇到需求变更一般怎么处理？
```

- sentenceId: `p0_b1_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 2

1.

```text
text: 你如何看待跨团队协作？遇到需求变更一般怎么处理？
pathId: b12f3cf0aef86ec71cf7ca92007b4ed2b271c07b66773e2211895464537dd8e6
bucketDomain: food_order
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 你如何看待跨团队协作？遇到需求变更一般怎么处理？
pathId: b12f3cf0aef86ec71cf7ca92007b4ed2b271c07b66773e2211895464537dd8e6
bucketDomain: milk_tea
sourceSentenceId: p0_b1_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 你如何看待跨团队协作？遇到需求变更一般怎么处理？
keptFromPath: b12f3cf0aef86ec71cf7ca92007b4ed2b271c07b66773e2211895464537dd8e6
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

```text
Dropped Text: 你如何看待跨团队协作？遇到需求变更一般怎么处理？
Source Sentence: p0_b1_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 你如何看待跨团队协作？遇到需求变更一般怎么处理？
```

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
你如何看待跨团队协作？遇到需求变更一般怎么处理？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"b12f3cf0aef86ec71cf7ca92007b4ed2b271c07b66773e2211895464537dd8e6","bucketDomain":"food_order","count":1},{"pathId":"b12f3cf0aef86ec71cf7ca92007b4ed2b271c07b66773e2211895464537dd8e6","bucketDomain":"milk_tea","count":1}]
crossPathInputCount: 2
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (2 vs 2)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d117

<a id="case-d117"></a>

### Case 基础信息

```text
Case ID: d117
Raw Text: 期望薪资这块我们可以再沟通，你最快什么时候能入职？
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `84f36989f411316b0fbb31d26ab28fc8fd7f7901712c880018c446be02dc23a0`

Bucket: `medical` (`p0_b0`)

Assembly Sentences:

1.

```text
期望薪资这块我们科医再沟通，你最快什么时候能入职？
```

- sentenceId: `p0_b0_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

2.

```text
期望薪资这块我们可以再沟通，你最快什么时候能入职？
```

- sentenceId: `p0_b0_s1`
- category: `RAW_ORIGINAL`
- assemblyRank: 2
- assemblyScore: 0

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 2

1.

```text
text: 期望薪资这块我们科医再沟通，你最快什么时候能入职？
pathId: 84f36989f411316b0fbb31d26ab28fc8fd7f7901712c880018c446be02dc23a0
bucketDomain: medical
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 期望薪资这块我们可以再沟通，你最快什么时候能入职？
pathId: 84f36989f411316b0fbb31d26ab28fc8fd7f7901712c880018c446be02dc23a0
bucketDomain: medical
sourceSentenceId: p0_b0_s1
```

### D. CrossPath Output

Count: 2

1.

```text
text: 期望薪资这块我们科医再沟通，你最快什么时候能入职？
keptFromPath: 84f36989f411316b0fbb31d26ab28fc8fd7f7901712c880018c446be02dc23a0
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 期望薪资这块我们可以再沟通，你最快什么时候能入职？
keptFromPath: 84f36989f411316b0fbb31d26ab28fc8fd7f7901712c880018c446be02dc23a0
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s1
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 2

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
期望薪资这块我们科医再沟通，你最快什么时候能入职？
```

2.

```text
期望薪资这块我们可以再沟通，你最快什么时候能入职？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"84f36989f411316b0fbb31d26ab28fc8fd7f7901712c880018c446be02dc23a0","bucketDomain":"medical","count":2}]
crossPathInputCount: 2
crossPathOutputCount: 2
kenlmInputCount: 2
CrossPath Input == Assembly total: YES (2 vs 2)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d118

<a id="case-d118"></a>

### Case 基础信息

```text
Case ID: d118
Raw Text: 老师，这道题的解题步骤能不能再讲一遍？我没听懂第二点。
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `1c409d8f6131faa9fc20d6ca3c8911bc863ca7db5fb5df65e6fd14d73cb58462`

Bucket: `null` (`p0_b0`)

Assembly Sentences:

1.

```text
老师，这道题的解题步骤能不能再讲一遍？我没听懂第二点。
```

- sentenceId: `p0_b0_s0`
- category: `RAW_ORIGINAL`
- assemblyRank: 1
- assemblyScore: 0

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 老师，这道题的解题步骤能不能再讲一遍？我没听懂第二点。
pathId: 1c409d8f6131faa9fc20d6ca3c8911bc863ca7db5fb5df65e6fd14d73cb58462
bucketDomain: null
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 老师，这道题的解题步骤能不能再讲一遍？我没听懂第二点。
keptFromPath: 1c409d8f6131faa9fc20d6ca3c8911bc863ca7db5fb5df65e6fd14d73cb58462
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
老师，这道题的解题步骤能不能再讲一遍？我没听懂第二点。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"1c409d8f6131faa9fc20d6ca3c8911bc863ca7db5fb5df65e6fd14d73cb58462","bucketDomain":null,"count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d119

<a id="case-d119"></a>

### Case 基础信息

```text
Case ID: d119
Raw Text: 作业是下周一下午交吗？可以电子版提交吗？
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `cfa8bb1a264544e0081de7f7df6ddab5a810d642a10eb16e14969796fff1dc05`

Bucket: `medical` (`p0_b0`)

Assembly Sentences:

1.

```text
作液室下周一下午交吗？科医电子版提交吗？
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 4.366

2.

```text
作业是下周一下午交吗？科医电子版提交吗？
```

- sentenceId: `p0_b0_s1`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 2
- assemblyScore: 2.36

3.

```text
作液室下周一下午交吗？可以电子版提交吗？
```

- sentenceId: `p0_b0_s2`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 3
- assemblyScore: 2.006

4.

```text
作业是下周一下午交吗？可以电子版提交吗？
```

- sentenceId: `p0_b0_s3`
- category: `RAW_ORIGINAL`
- assemblyRank: 4
- assemblyScore: 0

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 4

1.

```text
text: 作液室下周一下午交吗？科医电子版提交吗？
pathId: cfa8bb1a264544e0081de7f7df6ddab5a810d642a10eb16e14969796fff1dc05
bucketDomain: medical
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 作业是下周一下午交吗？科医电子版提交吗？
pathId: cfa8bb1a264544e0081de7f7df6ddab5a810d642a10eb16e14969796fff1dc05
bucketDomain: medical
sourceSentenceId: p0_b0_s1
```

3.

```text
text: 作液室下周一下午交吗？可以电子版提交吗？
pathId: cfa8bb1a264544e0081de7f7df6ddab5a810d642a10eb16e14969796fff1dc05
bucketDomain: medical
sourceSentenceId: p0_b0_s2
```

4.

```text
text: 作业是下周一下午交吗？可以电子版提交吗？
pathId: cfa8bb1a264544e0081de7f7df6ddab5a810d642a10eb16e14969796fff1dc05
bucketDomain: medical
sourceSentenceId: p0_b0_s3
```

### D. CrossPath Output

Count: 4

1.

```text
text: 作液室下周一下午交吗？科医电子版提交吗？
keptFromPath: cfa8bb1a264544e0081de7f7df6ddab5a810d642a10eb16e14969796fff1dc05
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 作业是下周一下午交吗？科医电子版提交吗？
keptFromPath: cfa8bb1a264544e0081de7f7df6ddab5a810d642a10eb16e14969796fff1dc05
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s1
```

3.

```text
text: 作液室下周一下午交吗？可以电子版提交吗？
keptFromPath: cfa8bb1a264544e0081de7f7df6ddab5a810d642a10eb16e14969796fff1dc05
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s2
```

4.

```text
text: 作业是下周一下午交吗？可以电子版提交吗？
keptFromPath: cfa8bb1a264544e0081de7f7df6ddab5a810d642a10eb16e14969796fff1dc05
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s3
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 4

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
作液室下周一下午交吗？科医电子版提交吗？
```

2.

```text
作业是下周一下午交吗？科医电子版提交吗？
```

3.

```text
作液室下周一下午交吗？可以电子版提交吗？
```

4.

```text
作业是下周一下午交吗？可以电子版提交吗？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"cfa8bb1a264544e0081de7f7df6ddab5a810d642a10eb16e14969796fff1dc05","bucketDomain":"medical","count":4}]
crossPathInputCount: 4
crossPathOutputCount: 4
kenlmInputCount: 4
CrossPath Input == Assembly total: YES (4 vs 4)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d120

<a id="case-d120"></a>

### Case 基础信息

```text
Case ID: d120
Raw Text: 请问这门课期末是开卷还是闭卷？重点会划吗？
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `406369b69d20013642b051317595e528c850c41df8ca93640fce6b7e57486447`

Bucket: `tourism_hotel` (`p0_b0`)

Assembly Sentences:

1.

```text
请问这门课期末是开卷还是闭卷？钟点会划吗？
```

- sentenceId: `p0_b0_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

2.

```text
请问这门课期末是开卷还是闭卷？重点会划吗？
```

- sentenceId: `p0_b0_s1`
- category: `RAW_ORIGINAL`
- assemblyRank: 2
- assemblyScore: 0

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 2

1.

```text
text: 请问这门课期末是开卷还是闭卷？钟点会划吗？
pathId: 406369b69d20013642b051317595e528c850c41df8ca93640fce6b7e57486447
bucketDomain: tourism_hotel
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 请问这门课期末是开卷还是闭卷？重点会划吗？
pathId: 406369b69d20013642b051317595e528c850c41df8ca93640fce6b7e57486447
bucketDomain: tourism_hotel
sourceSentenceId: p0_b0_s1
```

### D. CrossPath Output

Count: 2

1.

```text
text: 请问这门课期末是开卷还是闭卷？钟点会划吗？
keptFromPath: 406369b69d20013642b051317595e528c850c41df8ca93640fce6b7e57486447
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 请问这门课期末是开卷还是闭卷？重点会划吗？
keptFromPath: 406369b69d20013642b051317595e528c850c41df8ca93640fce6b7e57486447
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s1
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 2

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
请问这门课期末是开卷还是闭卷？钟点会划吗？
```

2.

```text
请问这门课期末是开卷还是闭卷？重点会划吗？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"406369b69d20013642b051317595e528c850c41df8ca93640fce6b7e57486447","bucketDomain":"tourism_hotel","count":2}]
crossPathInputCount: 2
crossPathOutputCount: 2
kenlmInputCount: 2
CrossPath Input == Assembly total: YES (2 vs 2)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d121

<a id="case-d121"></a>

### Case 基础信息

```text
Case ID: d121
Raw Text: 我预订的是大床房，能安排安静一点的楼层吗？
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `0f1b0bab3dbe84cb6e062d9358983f0b8121ebf7757d2db143133f0308c372c0`

Bucket: `tourism_hotel` (`p0_b0`)

Assembly Sentences:

1.

```text
我预订的是大床房，能安排安静一点的楼层吗？
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 7.1

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 我预订的是大床房，能安排安静一点的楼层吗？
pathId: 0f1b0bab3dbe84cb6e062d9358983f0b8121ebf7757d2db143133f0308c372c0
bucketDomain: tourism_hotel
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 我预订的是大床房，能安排安静一点的楼层吗？
keptFromPath: 0f1b0bab3dbe84cb6e062d9358983f0b8121ebf7757d2db143133f0308c372c0
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
我预订的是大床房，能安排安静一点的楼层吗？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"0f1b0bab3dbe84cb6e062d9358983f0b8121ebf7757d2db143133f0308c372c0","bucketDomain":"tourism_hotel","count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d122

<a id="case-d122"></a>

### Case 基础信息

```text
Case ID: d122
Raw Text: 早餐几点开始？退房可以延迟到下午两点吗？
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `03e1aa8d5789d78feb7b3931f6588e562f01a298a0136c39d7b213cfeacb5a13`

Bucket: `tourism_hotel` (`p0_b0`)

Assembly Sentences:

1.

```text
早餐几点开始？退房可以延迟到下午两点吗？
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 4.4

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 早餐几点开始？退房可以延迟到下午两点吗？
pathId: 03e1aa8d5789d78feb7b3931f6588e562f01a298a0136c39d7b213cfeacb5a13
bucketDomain: tourism_hotel
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 早餐几点开始？退房可以延迟到下午两点吗？
keptFromPath: 03e1aa8d5789d78feb7b3931f6588e562f01a298a0136c39d7b213cfeacb5a13
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
早餐几点开始？退房可以延迟到下午两点吗？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"03e1aa8d5789d78feb7b3931f6588e562f01a298a0136c39d7b213cfeacb5a13","bucketDomain":"tourism_hotel","count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d123

<a id="case-d123"></a>

### Case 基础信息

```text
Case ID: d123
Raw Text: 房间空调不太制冷，能派人上来看一下吗？
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `6cadd25d36a390cae4a08810f3d8c2773753c3c6d3c1f3c07298a83ac138f50a`

Bucket: `tech_ai` (`p0_b0`)

Assembly Sentences:

1.

```text
房监控调不太制冷，能派人上来看一下吗？
```

- sentenceId: `p0_b0_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

2.

```text
房间空调不太制冷，能派人上来看一下吗？
```

- sentenceId: `p0_b0_s1`
- category: `RAW_ORIGINAL`
- assemblyRank: 2
- assemblyScore: 0

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 2

1.

```text
text: 房监控调不太制冷，能派人上来看一下吗？
pathId: 6cadd25d36a390cae4a08810f3d8c2773753c3c6d3c1f3c07298a83ac138f50a
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 房间空调不太制冷，能派人上来看一下吗？
pathId: 6cadd25d36a390cae4a08810f3d8c2773753c3c6d3c1f3c07298a83ac138f50a
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s1
```

### D. CrossPath Output

Count: 2

1.

```text
text: 房监控调不太制冷，能派人上来看一下吗？
keptFromPath: 6cadd25d36a390cae4a08810f3d8c2773753c3c6d3c1f3c07298a83ac138f50a
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 房间空调不太制冷，能派人上来看一下吗？
keptFromPath: 6cadd25d36a390cae4a08810f3d8c2773753c3c6d3c1f3c07298a83ac138f50a
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s1
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 2

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
房监控调不太制冷，能派人上来看一下吗？
```

2.

```text
房间空调不太制冷，能派人上来看一下吗？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"6cadd25d36a390cae4a08810f3d8c2773753c3c6d3c1f3c07298a83ac138f50a","bucketDomain":"tech_ai","count":2}]
crossPathInputCount: 2
crossPathOutputCount: 2
kenlmInputCount: 2
CrossPath Input == Assembly total: YES (2 vs 2)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d124

<a id="case-d124"></a>

### Case 基础信息

```text
Case ID: d124
Raw Text: 我想开通短信提醒，需要带什么证件？
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `c14d5f5751216d8790ba33830572c5c91e9e6e8c1beabcfbb3e78f12a3374199`

Bucket: `tourism_route` (`p0_b0`)

Assembly Sentences:

1.

```text
我想开通短信提醒，需要带什么证件？
```

- sentenceId: `p0_b0_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 我想开通短信提醒，需要带什么证件？
pathId: c14d5f5751216d8790ba33830572c5c91e9e6e8c1beabcfbb3e78f12a3374199
bucketDomain: tourism_route
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 我想开通短信提醒，需要带什么证件？
keptFromPath: c14d5f5751216d8790ba33830572c5c91e9e6e8c1beabcfbb3e78f12a3374199
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
我想开通短信提醒，需要带什么证件？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"c14d5f5751216d8790ba33830572c5c91e9e6e8c1beabcfbb3e78f12a3374199","bucketDomain":"tourism_route","count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d125

<a id="case-d125"></a>

### Case 基础信息

```text
Case ID: d125
Raw Text: 这笔转账显示处理中，大概多久能到账？
Path Count: 1
Bucket Count: 2
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `2913b934f41b6799cf1415142f4c210ceef85a8cc8572ca4ea9a0734a8e0e55b`

Bucket: `food_order` (`p0_b0`)

Assembly Sentences:

1.

```text
这笔转账显示处理中，大概多久能到账？
```

- sentenceId: `p0_b0_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

#### Path: `2913b934f41b6799cf1415142f4c210ceef85a8cc8572ca4ea9a0734a8e0e55b`

Bucket: `milk_tea` (`p0_b1`)

Assembly Sentences:

1.

```text
这笔转账显示处理中，大概多久能到账？
```

- sentenceId: `p0_b1_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 2

1.

```text
text: 这笔转账显示处理中，大概多久能到账？
pathId: 2913b934f41b6799cf1415142f4c210ceef85a8cc8572ca4ea9a0734a8e0e55b
bucketDomain: food_order
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 这笔转账显示处理中，大概多久能到账？
pathId: 2913b934f41b6799cf1415142f4c210ceef85a8cc8572ca4ea9a0734a8e0e55b
bucketDomain: milk_tea
sourceSentenceId: p0_b1_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 这笔转账显示处理中，大概多久能到账？
keptFromPath: 2913b934f41b6799cf1415142f4c210ceef85a8cc8572ca4ea9a0734a8e0e55b
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

```text
Dropped Text: 这笔转账显示处理中，大概多久能到账？
Source Sentence: p0_b1_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 这笔转账显示处理中，大概多久能到账？
```

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
这笔转账显示处理中，大概多久能到账？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"2913b934f41b6799cf1415142f4c210ceef85a8cc8572ca4ea9a0734a8e0e55b","bucketDomain":"food_order","count":1},{"pathId":"2913b934f41b6799cf1415142f4c210ceef85a8cc8572ca4ea9a0734a8e0e55b","bucketDomain":"milk_tea","count":1}]
crossPathInputCount: 2
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (2 vs 2)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d126

<a id="case-d126"></a>

### Case 基础信息

```text
Case ID: d126
Raw Text: 请问理财产品的风险等级在哪里查看？
Path Count: 1
Bucket Count: 2
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `6bcff49b0914307d218e0a1eff428d5f84a8e0578634047e841739527dddedbb`

Bucket: `tech_ai` (`p0_b0`)

Assembly Sentences:

1.

```text
请问理财产品的风险等级在哪里查看？
```

- sentenceId: `p0_b0_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

#### Path: `6bcff49b0914307d218e0a1eff428d5f84a8e0578634047e841739527dddedbb`

Bucket: `tourism_pickup` (`p0_b1`)

Assembly Sentences:

1.

```text
请问理财产品的风险登机在哪里查看？
```

- sentenceId: `p0_b1_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

2.

```text
请问理财产品的风险等级在哪里查看？
```

- sentenceId: `p0_b1_s1`
- category: `RAW_ORIGINAL`
- assemblyRank: 2
- assemblyScore: 0

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 3

1.

```text
text: 请问理财产品的风险等级在哪里查看？
pathId: 6bcff49b0914307d218e0a1eff428d5f84a8e0578634047e841739527dddedbb
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 请问理财产品的风险登机在哪里查看？
pathId: 6bcff49b0914307d218e0a1eff428d5f84a8e0578634047e841739527dddedbb
bucketDomain: tourism_pickup
sourceSentenceId: p0_b1_s0
```

3.

```text
text: 请问理财产品的风险等级在哪里查看？
pathId: 6bcff49b0914307d218e0a1eff428d5f84a8e0578634047e841739527dddedbb
bucketDomain: tourism_pickup
sourceSentenceId: p0_b1_s1
```

### D. CrossPath Output

Count: 2

1.

```text
text: 请问理财产品的风险等级在哪里查看？
keptFromPath: 6bcff49b0914307d218e0a1eff428d5f84a8e0578634047e841739527dddedbb
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 请问理财产品的风险登机在哪里查看？
keptFromPath: 6bcff49b0914307d218e0a1eff428d5f84a8e0578634047e841739527dddedbb
keptFromBucket: p0_b1
sourceSentenceId: p0_b1_s0
```

### E. CrossPath 删除项

```text
Dropped Text: 请问理财产品的风险等级在哪里查看？
Source Sentence: p0_b1_s1
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 请问理财产品的风险等级在哪里查看？
```

### F. KenLM Input

KenLM Input Count: 2

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
请问理财产品的风险等级在哪里查看？
```

2.

```text
请问理财产品的风险登机在哪里查看？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"6bcff49b0914307d218e0a1eff428d5f84a8e0578634047e841739527dddedbb","bucketDomain":"tech_ai","count":1},{"pathId":"6bcff49b0914307d218e0a1eff428d5f84a8e0578634047e841739527dddedbb","bucketDomain":"tourism_pickup","count":2}]
crossPathInputCount: 3
crossPathOutputCount: 2
kenlmInputCount: 2
CrossPath Input == Assembly total: YES (3 vs 3)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d127

<a id="case-d127"></a>

### Case 基础信息

```text
Case ID: d127
Raw Text: 两位，靠窗有位置吗？不要香菜，微辣就行。
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `8b2d9e6e9ba6152b4bfe03dd11061b9ad65e8ae7988e4c6ba683146fc5832aad`

Bucket: `food_order` (`p0_b0`)

Assembly Sentences:

1.

```text
两位，靠窗有位置吗？不要香菜，微辣就行。
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 4.390000000000001

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 两位，靠窗有位置吗？不要香菜，微辣就行。
pathId: 8b2d9e6e9ba6152b4bfe03dd11061b9ad65e8ae7988e4c6ba683146fc5832aad
bucketDomain: food_order
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 两位，靠窗有位置吗？不要香菜，微辣就行。
keptFromPath: 8b2d9e6e9ba6152b4bfe03dd11061b9ad65e8ae7988e4c6ba683146fc5832aad
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
两位，靠窗有位置吗？不要香菜，微辣就行。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"8b2d9e6e9ba6152b4bfe03dd11061b9ad65e8ae7988e4c6ba683146fc5832aad","bucketDomain":"food_order","count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d128

<a id="case-d128"></a>

### Case 基础信息

```text
Case ID: d128
Raw Text: 这道菜大概要等多久？我们先点一份凉菜和一壶茶。
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `37367286bf78ef457c58421ac1cc51772b81498372ff6046875c912bacb0a3ca`

Bucket: `null` (`p0_b0`)

Assembly Sentences:

1.

```text
这道菜大概要等多久？我们先点一份凉菜和一壶茶。
```

- sentenceId: `p0_b0_s0`
- category: `RAW_ORIGINAL`
- assemblyRank: 1
- assemblyScore: 0

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 这道菜大概要等多久？我们先点一份凉菜和一壶茶。
pathId: 37367286bf78ef457c58421ac1cc51772b81498372ff6046875c912bacb0a3ca
bucketDomain: null
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 这道菜大概要等多久？我们先点一份凉菜和一壶茶。
keptFromPath: 37367286bf78ef457c58421ac1cc51772b81498372ff6046875c912bacb0a3ca
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
这道菜大概要等多久？我们先点一份凉菜和一壶茶。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"37367286bf78ef457c58421ac1cc51772b81498372ff6046875c912bacb0a3ca","bucketDomain":null,"count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d129

<a id="case-d129"></a>

### Case 基础信息

```text
Case ID: d129
Raw Text: 可以打包吗？顺便结一下账，能扫码支付吗？
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `91229dfa9d5be6b38b9f08e170cff33f5d2bdef0d0cb6c73fdb7cf999d70ca76`

Bucket: `coffee` (`p0_b0`)

Assembly Sentences:

1.

```text
可以打包吗？顺便结一下账，能扫码支付吗？
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 4.356

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 可以打包吗？顺便结一下账，能扫码支付吗？
pathId: 91229dfa9d5be6b38b9f08e170cff33f5d2bdef0d0cb6c73fdb7cf999d70ca76
bucketDomain: coffee
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 可以打包吗？顺便结一下账，能扫码支付吗？
keptFromPath: 91229dfa9d5be6b38b9f08e170cff33f5d2bdef0d0cb6c73fdb7cf999d70ca76
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
可以打包吗？顺便结一下账，能扫码支付吗？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"91229dfa9d5be6b38b9f08e170cff33f5d2bdef0d0cb6c73fdb7cf999d70ca76","bucketDomain":"coffee","count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d130

<a id="case-d130"></a>

### Case 基础信息

```text
Case ID: d130
Raw Text: 私教课还剩几次？能帮我约明天晚上七点吗？
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `973b1af9a783aa7707c48f38b9fa56cd157195dbfa41409fe89c426ae484696e`

Bucket: `null` (`p0_b0`)

Assembly Sentences:

1.

```text
私教课还剩几次？能帮我约明天晚上七点吗？
```

- sentenceId: `p0_b0_s0`
- category: `RAW_ORIGINAL`
- assemblyRank: 1
- assemblyScore: 0

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 私教课还剩几次？能帮我约明天晚上七点吗？
pathId: 973b1af9a783aa7707c48f38b9fa56cd157195dbfa41409fe89c426ae484696e
bucketDomain: null
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 私教课还剩几次？能帮我约明天晚上七点吗？
keptFromPath: 973b1af9a783aa7707c48f38b9fa56cd157195dbfa41409fe89c426ae484696e
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
私教课还剩几次？能帮我约明天晚上七点吗？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"973b1af9a783aa7707c48f38b9fa56cd157195dbfa41409fe89c426ae484696e","bucketDomain":null,"count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d131

<a id="case-d131"></a>

### Case 基础信息

```text
Case ID: d131
Raw Text: 更衣室柜子钥匙找不到了，前台能帮忙开一下吗？
Path Count: 1
Bucket Count: 3
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `3b518d0b2df5f529d68743f21657b328629df6e85a64c6f34b152211b6dc2f06`

Bucket: `medical` (`p0_b0`)

Assembly Sentences:

1.

```text
更医师柜子钥匙找不到了，前台能帮忙开一下吗？
```

- sentenceId: `p0_b0_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.006

2.

```text
更衣室柜子钥匙找不到了，前台能帮忙开一下吗？
```

- sentenceId: `p0_b0_s1`
- category: `RAW_ORIGINAL`
- assemblyRank: 2
- assemblyScore: 0

#### Path: `3b518d0b2df5f529d68743f21657b328629df6e85a64c6f34b152211b6dc2f06`

Bucket: `meeting` (`p0_b1`)

Assembly Sentences:

1.

```text
更议室柜子钥匙找不到了，前台能帮忙开一下吗？
```

- sentenceId: `p0_b1_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.006

2.

```text
更衣室柜子钥匙找不到了，前台能帮忙开一下吗？
```

- sentenceId: `p0_b1_s1`
- category: `RAW_ORIGINAL`
- assemblyRank: 2
- assemblyScore: 0

#### Path: `3b518d0b2df5f529d68743f21657b328629df6e85a64c6f34b152211b6dc2f06`

Bucket: `tourism_hotel` (`p0_b2`)

Assembly Sentences:

1.

```text
更衣室柜子钥匙找不到了，前台能帮忙开一下吗？
```

- sentenceId: `p0_b2_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 5

1.

```text
text: 更医师柜子钥匙找不到了，前台能帮忙开一下吗？
pathId: 3b518d0b2df5f529d68743f21657b328629df6e85a64c6f34b152211b6dc2f06
bucketDomain: medical
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 更衣室柜子钥匙找不到了，前台能帮忙开一下吗？
pathId: 3b518d0b2df5f529d68743f21657b328629df6e85a64c6f34b152211b6dc2f06
bucketDomain: medical
sourceSentenceId: p0_b0_s1
```

3.

```text
text: 更议室柜子钥匙找不到了，前台能帮忙开一下吗？
pathId: 3b518d0b2df5f529d68743f21657b328629df6e85a64c6f34b152211b6dc2f06
bucketDomain: meeting
sourceSentenceId: p0_b1_s0
```

4.

```text
text: 更衣室柜子钥匙找不到了，前台能帮忙开一下吗？
pathId: 3b518d0b2df5f529d68743f21657b328629df6e85a64c6f34b152211b6dc2f06
bucketDomain: meeting
sourceSentenceId: p0_b1_s1
```

5.

```text
text: 更衣室柜子钥匙找不到了，前台能帮忙开一下吗？
pathId: 3b518d0b2df5f529d68743f21657b328629df6e85a64c6f34b152211b6dc2f06
bucketDomain: tourism_hotel
sourceSentenceId: p0_b2_s0
```

### D. CrossPath Output

Count: 3

1.

```text
text: 更医师柜子钥匙找不到了，前台能帮忙开一下吗？
keptFromPath: 3b518d0b2df5f529d68743f21657b328629df6e85a64c6f34b152211b6dc2f06
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 更衣室柜子钥匙找不到了，前台能帮忙开一下吗？
keptFromPath: 3b518d0b2df5f529d68743f21657b328629df6e85a64c6f34b152211b6dc2f06
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s1
```

3.

```text
text: 更议室柜子钥匙找不到了，前台能帮忙开一下吗？
keptFromPath: 3b518d0b2df5f529d68743f21657b328629df6e85a64c6f34b152211b6dc2f06
keptFromBucket: p0_b1
sourceSentenceId: p0_b1_s0
```

### E. CrossPath 删除项

```text
Dropped Text: 更衣室柜子钥匙找不到了，前台能帮忙开一下吗？
Source Sentence: p0_b1_s1
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 更衣室柜子钥匙找不到了，前台能帮忙开一下吗？
```

```text
Dropped Text: 更衣室柜子钥匙找不到了，前台能帮忙开一下吗？
Source Sentence: p0_b2_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 更衣室柜子钥匙找不到了，前台能帮忙开一下吗？
```

### F. KenLM Input

KenLM Input Count: 3

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
更医师柜子钥匙找不到了，前台能帮忙开一下吗？
```

2.

```text
更衣室柜子钥匙找不到了，前台能帮忙开一下吗？
```

3.

```text
更议室柜子钥匙找不到了，前台能帮忙开一下吗？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"3b518d0b2df5f529d68743f21657b328629df6e85a64c6f34b152211b6dc2f06","bucketDomain":"medical","count":2},{"pathId":"3b518d0b2df5f529d68743f21657b328629df6e85a64c6f34b152211b6dc2f06","bucketDomain":"meeting","count":2},{"pathId":"3b518d0b2df5f529d68743f21657b328629df6e85a64c6f34b152211b6dc2f06","bucketDomain":"tourism_hotel","count":1}]
crossPathInputCount: 5
crossPathOutputCount: 3
kenlmInputCount: 3
CrossPath Input == Assembly total: YES (5 vs 5)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d132

<a id="case-d132"></a>

### Case 基础信息

```text
Case ID: d132
Raw Text: 游泳次卡本月月底到期，续费有优惠吗？
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `a11519a0a6b805c16c3242918d0e30f13d8a99cebe7578a68fe2fabb883c6c96`

Bucket: `null` (`p0_b0`)

Assembly Sentences:

1.

```text
游泳次卡本月月底到期，续费有优惠吗？
```

- sentenceId: `p0_b0_s0`
- category: `RAW_ORIGINAL`
- assemblyRank: 1
- assemblyScore: 0

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 游泳次卡本月月底到期，续费有优惠吗？
pathId: a11519a0a6b805c16c3242918d0e30f13d8a99cebe7578a68fe2fabb883c6c96
bucketDomain: null
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 游泳次卡本月月底到期，续费有优惠吗？
keptFromPath: a11519a0a6b805c16c3242918d0e30f13d8a99cebe7578a68fe2fabb883c6c96
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
游泳次卡本月月底到期，续费有优惠吗？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"a11519a0a6b805c16c3242918d0e30f13d8a99cebe7578a68fe2fabb883c6c96","bucketDomain":null,"count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d133

<a id="case-d133"></a>

### Case 基础信息

```text
Case ID: d133
Raw Text: 我们下午讨论后选声城方案，先把候选生成的接口文档补齐。
Path Count: 2
Bucket Count: 2
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `86bbdea09331c4feb5a8c0ad9881f21444a7ba7ae866222c8b4c24b3fba4ce42`

Bucket: `tech_ai` (`p0_b0`)

Assembly Sentences:

1.

```text
我们下午讨论候选声城方案，先把候选生成的接口文档补齐。
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 9.66

2.

```text
我们下午讨论后选声城方案，先把候选生成的接口文档补齐。
```

- sentenceId: `p0_b0_s1`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 2
- assemblyScore: 7.24

#### Path: `eefbde0a8d0d9a4bd706030008aee9a3ba8aef276637bb189b65c4365acf56c9`

Bucket: `tech_ai` (`p1_b0`)

Assembly Sentences:

1.

```text
我们下午讨论候选声城方案，先把候选生成的接口文档补齐。
```

- sentenceId: `p1_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 6.88

2.

```text
我们下午讨论后选声城方案，先把候选生成的接口文档补齐。
```

- sentenceId: `p1_b0_s1`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 2
- assemblyScore: 4.46

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 4

1.

```text
text: 我们下午讨论候选声城方案，先把候选生成的接口文档补齐。
pathId: 86bbdea09331c4feb5a8c0ad9881f21444a7ba7ae866222c8b4c24b3fba4ce42
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 我们下午讨论后选声城方案，先把候选生成的接口文档补齐。
pathId: 86bbdea09331c4feb5a8c0ad9881f21444a7ba7ae866222c8b4c24b3fba4ce42
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s1
```

3.

```text
text: 我们下午讨论候选声城方案，先把候选生成的接口文档补齐。
pathId: eefbde0a8d0d9a4bd706030008aee9a3ba8aef276637bb189b65c4365acf56c9
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s0
```

4.

```text
text: 我们下午讨论后选声城方案，先把候选生成的接口文档补齐。
pathId: eefbde0a8d0d9a4bd706030008aee9a3ba8aef276637bb189b65c4365acf56c9
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s1
```

### D. CrossPath Output

Count: 2

1.

```text
text: 我们下午讨论候选声城方案，先把候选生成的接口文档补齐。
keptFromPath: 86bbdea09331c4feb5a8c0ad9881f21444a7ba7ae866222c8b4c24b3fba4ce42
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 我们下午讨论后选声城方案，先把候选生成的接口文档补齐。
keptFromPath: 86bbdea09331c4feb5a8c0ad9881f21444a7ba7ae866222c8b4c24b3fba4ce42
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s1
```

### E. CrossPath 删除项

```text
Dropped Text: 我们下午讨论候选声城方案，先把候选生成的接口文档补齐。
Source Sentence: p1_b0_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 我们下午讨论候选声城方案，先把候选生成的接口文档补齐。
```

```text
Dropped Text: 我们下午讨论后选声城方案，先把候选生成的接口文档补齐。
Source Sentence: p1_b0_s1
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 我们下午讨论后选声城方案，先把候选生成的接口文档补齐。
```

### F. KenLM Input

KenLM Input Count: 2

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
我们下午讨论候选声城方案，先把候选生成的接口文档补齐。
```

2.

```text
我们下午讨论后选声城方案，先把候选生成的接口文档补齐。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"86bbdea09331c4feb5a8c0ad9881f21444a7ba7ae866222c8b4c24b3fba4ce42","bucketDomain":"tech_ai","count":2},{"pathId":"eefbde0a8d0d9a4bd706030008aee9a3ba8aef276637bb189b65c4365acf56c9","bucketDomain":"tech_ai","count":2}]
crossPathInputCount: 4
crossPathOutputCount: 2
kenlmInputCount: 2
CrossPath Input == Assembly total: YES (4 vs 4)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d134

<a id="case-d134"></a>

### Case 基础信息

```text
Case ID: d134
Raw Text: 这周的上线计花已经确认，上线计划评审安排在周四上午。
Path Count: 4
Bucket Count: 5
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `3a7c0ec19c68211cdf24335825c8d37e4aa2134e2fc89f2e63c8e4317cc94389`

Bucket: `tech_ai` (`p0_b0`)

Assembly Sentences:

1.

```text
这周的上线计划已经确认，上线计划评审安排在周四上午。
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 9.64

2.

```text
这周的上线计花已经确认，上线计划评审安排在周四上午。
```

- sentenceId: `p0_b0_s1`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 2
- assemblyScore: 7.24

#### Path: `066ebc94f339a351afffd32d14f7e56193e4b7aea663b15d787ffdc5993bda0f`

Bucket: `tech_ai` (`p1_b0`)

Assembly Sentences:

1.

```text
这周的上线计划已经确认，上线计划评审安排在周四上午。
```

- sentenceId: `p1_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 6.86

2.

```text
这周的上线计花已经确认，上线计划评审安排在周四上午。
```

- sentenceId: `p1_b0_s1`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 2
- assemblyScore: 4.46

#### Path: `57ea9b89e4fc35be95b82fbc831b7f5c4c7f6f5fe37c7010697f3f088ac465f6`

Bucket: `tech_ai` (`p2_b0`)

Assembly Sentences:

1.

```text
这周的上线计划已经确认，上线计划评审安排在周四上午。
```

- sentenceId: `p2_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 6.859999999999999

2.

```text
这周的上线计花已经确认，上线计划评审安排在周四上午。
```

- sentenceId: `p2_b0_s1`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 2
- assemblyScore: 4.82

#### Path: `1e01ba7584d9e3d132a29bce455c9f9262f69591509b4623fd5d51aae06b8008`

Bucket: `tech_ai` (`p3_b0`)

Assembly Sentences:

1.

```text
这周的上线计划已经确认，上线计划评审安排在周四上午。
```

- sentenceId: `p3_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 4.08

2.

```text
这周的上线计花已经确认，上线计划评审安排在周四上午。
```

- sentenceId: `p3_b0_s1`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 2
- assemblyScore: 2.04

#### Path: `1e01ba7584d9e3d132a29bce455c9f9262f69591509b4623fd5d51aae06b8008`

Bucket: `tourism_hotel` (`p3_b1`)

Assembly Sentences:

1.

```text
这周的上线计花已经确认，上线计划评审安排在周四商务。
```

- sentenceId: `p3_b1_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 4.72

2.

```text
这周的上线计花已经确认，上线计划评审安排在周四上午。
```

- sentenceId: `p3_b1_s1`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 2
- assemblyScore: 2.36

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 10

1.

```text
text: 这周的上线计划已经确认，上线计划评审安排在周四上午。
pathId: 3a7c0ec19c68211cdf24335825c8d37e4aa2134e2fc89f2e63c8e4317cc94389
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 这周的上线计花已经确认，上线计划评审安排在周四上午。
pathId: 3a7c0ec19c68211cdf24335825c8d37e4aa2134e2fc89f2e63c8e4317cc94389
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s1
```

3.

```text
text: 这周的上线计划已经确认，上线计划评审安排在周四上午。
pathId: 066ebc94f339a351afffd32d14f7e56193e4b7aea663b15d787ffdc5993bda0f
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s0
```

4.

```text
text: 这周的上线计花已经确认，上线计划评审安排在周四上午。
pathId: 066ebc94f339a351afffd32d14f7e56193e4b7aea663b15d787ffdc5993bda0f
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s1
```

5.

```text
text: 这周的上线计划已经确认，上线计划评审安排在周四上午。
pathId: 57ea9b89e4fc35be95b82fbc831b7f5c4c7f6f5fe37c7010697f3f088ac465f6
bucketDomain: tech_ai
sourceSentenceId: p2_b0_s0
```

6.

```text
text: 这周的上线计花已经确认，上线计划评审安排在周四上午。
pathId: 57ea9b89e4fc35be95b82fbc831b7f5c4c7f6f5fe37c7010697f3f088ac465f6
bucketDomain: tech_ai
sourceSentenceId: p2_b0_s1
```

7.

```text
text: 这周的上线计划已经确认，上线计划评审安排在周四上午。
pathId: 1e01ba7584d9e3d132a29bce455c9f9262f69591509b4623fd5d51aae06b8008
bucketDomain: tech_ai
sourceSentenceId: p3_b0_s0
```

8.

```text
text: 这周的上线计花已经确认，上线计划评审安排在周四上午。
pathId: 1e01ba7584d9e3d132a29bce455c9f9262f69591509b4623fd5d51aae06b8008
bucketDomain: tech_ai
sourceSentenceId: p3_b0_s1
```

9.

```text
text: 这周的上线计花已经确认，上线计划评审安排在周四商务。
pathId: 1e01ba7584d9e3d132a29bce455c9f9262f69591509b4623fd5d51aae06b8008
bucketDomain: tourism_hotel
sourceSentenceId: p3_b1_s0
```

10.

```text
text: 这周的上线计花已经确认，上线计划评审安排在周四上午。
pathId: 1e01ba7584d9e3d132a29bce455c9f9262f69591509b4623fd5d51aae06b8008
bucketDomain: tourism_hotel
sourceSentenceId: p3_b1_s1
```

### D. CrossPath Output

Count: 3

1.

```text
text: 这周的上线计划已经确认，上线计划评审安排在周四上午。
keptFromPath: 3a7c0ec19c68211cdf24335825c8d37e4aa2134e2fc89f2e63c8e4317cc94389
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 这周的上线计花已经确认，上线计划评审安排在周四上午。
keptFromPath: 3a7c0ec19c68211cdf24335825c8d37e4aa2134e2fc89f2e63c8e4317cc94389
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s1
```

3.

```text
text: 这周的上线计花已经确认，上线计划评审安排在周四商务。
keptFromPath: 1e01ba7584d9e3d132a29bce455c9f9262f69591509b4623fd5d51aae06b8008
keptFromBucket: p3_b1
sourceSentenceId: p3_b1_s0
```

### E. CrossPath 删除项

```text
Dropped Text: 这周的上线计划已经确认，上线计划评审安排在周四上午。
Source Sentence: p1_b0_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 这周的上线计划已经确认，上线计划评审安排在周四上午。
```

```text
Dropped Text: 这周的上线计花已经确认，上线计划评审安排在周四上午。
Source Sentence: p1_b0_s1
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 这周的上线计花已经确认，上线计划评审安排在周四上午。
```

```text
Dropped Text: 这周的上线计划已经确认，上线计划评审安排在周四上午。
Source Sentence: p2_b0_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 这周的上线计划已经确认，上线计划评审安排在周四上午。
```

```text
Dropped Text: 这周的上线计花已经确认，上线计划评审安排在周四上午。
Source Sentence: p2_b0_s1
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 这周的上线计花已经确认，上线计划评审安排在周四上午。
```

```text
Dropped Text: 这周的上线计划已经确认，上线计划评审安排在周四上午。
Source Sentence: p3_b0_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 这周的上线计划已经确认，上线计划评审安排在周四上午。
```

```text
Dropped Text: 这周的上线计花已经确认，上线计划评审安排在周四上午。
Source Sentence: p3_b0_s1
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 这周的上线计花已经确认，上线计划评审安排在周四上午。
```

```text
Dropped Text: 这周的上线计花已经确认，上线计划评审安排在周四上午。
Source Sentence: p3_b1_s1
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 这周的上线计花已经确认，上线计划评审安排在周四上午。
```

### F. KenLM Input

KenLM Input Count: 3

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
这周的上线计划已经确认，上线计划评审安排在周四上午。
```

2.

```text
这周的上线计花已经确认，上线计划评审安排在周四上午。
```

3.

```text
这周的上线计花已经确认，上线计划评审安排在周四商务。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"3a7c0ec19c68211cdf24335825c8d37e4aa2134e2fc89f2e63c8e4317cc94389","bucketDomain":"tech_ai","count":2},{"pathId":"066ebc94f339a351afffd32d14f7e56193e4b7aea663b15d787ffdc5993bda0f","bucketDomain":"tech_ai","count":2},{"pathId":"57ea9b89e4fc35be95b82fbc831b7f5c4c7f6f5fe37c7010697f3f088ac465f6","bucketDomain":"tech_ai","count":2},{"pathId":"1e01ba7584d9e3d132a29bce455c9f9262f69591509b4623fd5d51aae06b8008","bucketDomain":"tech_ai","count":2},{"pathId":"1e01ba7584d9e3d132a29bce455c9f9262f69591509b4623fd5d51aae06b8008","bucketDomain":"tourism_hotel","count":2}]
crossPathInputCount: 10
crossPathOutputCount: 3
kenlmInputCount: 3
CrossPath Input == Assembly total: YES (10 vs 10)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d135

<a id="case-d135"></a>

### Case 基础信息

```text
Case ID: d135
Raw Text: 关于后选生城和上线计化，请按上线计划执行，有问题群里说。
Path Count: 4
Bucket Count: 4
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `80d8d072c93bd03cae9cbb84c08e94e3da22d362211a19bb4e9529d389cfcbd9`

Bucket: `tech_ai` (`p0_b0`)

Assembly Sentences:

1.

```text
关于候选生城和上线计划，请按上线计划执行，有问题群里说。
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 9.64

2.

```text
关于候选生城和上线计化，请按上线计划执行，有问题群里说。
```

- sentenceId: `p0_b0_s1`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 2
- assemblyScore: 7.24

3.

```text
关于后选生城和上线计划，请按上线计划执行，有问题群里说。
```

- sentenceId: `p0_b0_s2`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 3
- assemblyScore: 7.220000000000001

4.

```text
关于后选生城和上线计化，请按上线计划执行，有问题群里说。
```

- sentenceId: `p0_b0_s3`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 4
- assemblyScore: 4.82

#### Path: `93e4109d85b5380fab48f556415ccbc466756d447402b61852516ce4b9af9d96`

Bucket: `tech_ai` (`p1_b0`)

Assembly Sentences:

1.

```text
关于候选生城和上线计划，请按上线计划执行，有问题群里说。
```

- sentenceId: `p1_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 7.220000000000001

2.

```text
关于候选生城和上线计化，请按上线计划执行，有问题群里说。
```

- sentenceId: `p1_b0_s1`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 2
- assemblyScore: 4.82

3.

```text
关于后选生城和上线计划，请按上线计划执行，有问题群里说。
```

- sentenceId: `p1_b0_s2`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 3
- assemblyScore: 4.8

4.

```text
关于后选生城和上线计化，请按上线计划执行，有问题群里说。
```

- sentenceId: `p1_b0_s3`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 4
- assemblyScore: 2.4

#### Path: `2ad765c2b868ddad2f2aacc904cdbbff13b3bd2676190675e265773ee4a9a6ab`

Bucket: `tech_ai` (`p2_b0`)

Assembly Sentences:

1.

```text
关于候选生城和上线计划，请按上线计划执行，有问题群里说。
```

- sentenceId: `p2_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 12.06

2.

```text
关于候选生城和上线计化，请按上线计划执行，有问题群里说。
```

- sentenceId: `p2_b0_s1`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 2
- assemblyScore: 9.66

3.

```text
关于后选生城和上线计划，请按上线计划执行，有问题群里说。
```

- sentenceId: `p2_b0_s2`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 3
- assemblyScore: 9.64

4.

```text
关于后选生城和上线计化，请按上线计划执行，有问题群里说。
```

- sentenceId: `p2_b0_s3`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 4
- assemblyScore: 7.24

#### Path: `65aa4e3a49b767d4a16d0bb386a6f55fc3d2885c77f30fc1f8e5824bd3aebf0a`

Bucket: `tech_ai` (`p3_b0`)

Assembly Sentences:

1.

```text
关于候选生城和上线计划，请按上线计划执行，有问题群里说。
```

- sentenceId: `p3_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 9.64

2.

```text
关于候选生城和上线计化，请按上线计划执行，有问题群里说。
```

- sentenceId: `p3_b0_s1`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 2
- assemblyScore: 7.24

3.

```text
关于后选生城和上线计划，请按上线计划执行，有问题群里说。
```

- sentenceId: `p3_b0_s2`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 3
- assemblyScore: 7.220000000000001

4.

```text
关于后选生城和上线计化，请按上线计划执行，有问题群里说。
```

- sentenceId: `p3_b0_s3`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 4
- assemblyScore: 4.82

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 16

1.

```text
text: 关于候选生城和上线计划，请按上线计划执行，有问题群里说。
pathId: 80d8d072c93bd03cae9cbb84c08e94e3da22d362211a19bb4e9529d389cfcbd9
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 关于候选生城和上线计化，请按上线计划执行，有问题群里说。
pathId: 80d8d072c93bd03cae9cbb84c08e94e3da22d362211a19bb4e9529d389cfcbd9
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s1
```

3.

```text
text: 关于后选生城和上线计划，请按上线计划执行，有问题群里说。
pathId: 80d8d072c93bd03cae9cbb84c08e94e3da22d362211a19bb4e9529d389cfcbd9
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s2
```

4.

```text
text: 关于后选生城和上线计化，请按上线计划执行，有问题群里说。
pathId: 80d8d072c93bd03cae9cbb84c08e94e3da22d362211a19bb4e9529d389cfcbd9
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s3
```

5.

```text
text: 关于候选生城和上线计划，请按上线计划执行，有问题群里说。
pathId: 93e4109d85b5380fab48f556415ccbc466756d447402b61852516ce4b9af9d96
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s0
```

6.

```text
text: 关于候选生城和上线计化，请按上线计划执行，有问题群里说。
pathId: 93e4109d85b5380fab48f556415ccbc466756d447402b61852516ce4b9af9d96
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s1
```

7.

```text
text: 关于后选生城和上线计划，请按上线计划执行，有问题群里说。
pathId: 93e4109d85b5380fab48f556415ccbc466756d447402b61852516ce4b9af9d96
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s2
```

8.

```text
text: 关于后选生城和上线计化，请按上线计划执行，有问题群里说。
pathId: 93e4109d85b5380fab48f556415ccbc466756d447402b61852516ce4b9af9d96
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s3
```

9.

```text
text: 关于候选生城和上线计划，请按上线计划执行，有问题群里说。
pathId: 2ad765c2b868ddad2f2aacc904cdbbff13b3bd2676190675e265773ee4a9a6ab
bucketDomain: tech_ai
sourceSentenceId: p2_b0_s0
```

10.

```text
text: 关于候选生城和上线计化，请按上线计划执行，有问题群里说。
pathId: 2ad765c2b868ddad2f2aacc904cdbbff13b3bd2676190675e265773ee4a9a6ab
bucketDomain: tech_ai
sourceSentenceId: p2_b0_s1
```

11.

```text
text: 关于后选生城和上线计划，请按上线计划执行，有问题群里说。
pathId: 2ad765c2b868ddad2f2aacc904cdbbff13b3bd2676190675e265773ee4a9a6ab
bucketDomain: tech_ai
sourceSentenceId: p2_b0_s2
```

12.

```text
text: 关于后选生城和上线计化，请按上线计划执行，有问题群里说。
pathId: 2ad765c2b868ddad2f2aacc904cdbbff13b3bd2676190675e265773ee4a9a6ab
bucketDomain: tech_ai
sourceSentenceId: p2_b0_s3
```

13.

```text
text: 关于候选生城和上线计划，请按上线计划执行，有问题群里说。
pathId: 65aa4e3a49b767d4a16d0bb386a6f55fc3d2885c77f30fc1f8e5824bd3aebf0a
bucketDomain: tech_ai
sourceSentenceId: p3_b0_s0
```

14.

```text
text: 关于候选生城和上线计化，请按上线计划执行，有问题群里说。
pathId: 65aa4e3a49b767d4a16d0bb386a6f55fc3d2885c77f30fc1f8e5824bd3aebf0a
bucketDomain: tech_ai
sourceSentenceId: p3_b0_s1
```

15.

```text
text: 关于后选生城和上线计划，请按上线计划执行，有问题群里说。
pathId: 65aa4e3a49b767d4a16d0bb386a6f55fc3d2885c77f30fc1f8e5824bd3aebf0a
bucketDomain: tech_ai
sourceSentenceId: p3_b0_s2
```

16.

```text
text: 关于后选生城和上线计化，请按上线计划执行，有问题群里说。
pathId: 65aa4e3a49b767d4a16d0bb386a6f55fc3d2885c77f30fc1f8e5824bd3aebf0a
bucketDomain: tech_ai
sourceSentenceId: p3_b0_s3
```

### D. CrossPath Output

Count: 4

1.

```text
text: 关于候选生城和上线计划，请按上线计划执行，有问题群里说。
keptFromPath: 80d8d072c93bd03cae9cbb84c08e94e3da22d362211a19bb4e9529d389cfcbd9
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 关于候选生城和上线计化，请按上线计划执行，有问题群里说。
keptFromPath: 80d8d072c93bd03cae9cbb84c08e94e3da22d362211a19bb4e9529d389cfcbd9
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s1
```

3.

```text
text: 关于后选生城和上线计划，请按上线计划执行，有问题群里说。
keptFromPath: 80d8d072c93bd03cae9cbb84c08e94e3da22d362211a19bb4e9529d389cfcbd9
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s2
```

4.

```text
text: 关于后选生城和上线计化，请按上线计划执行，有问题群里说。
keptFromPath: 80d8d072c93bd03cae9cbb84c08e94e3da22d362211a19bb4e9529d389cfcbd9
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s3
```

### E. CrossPath 删除项

```text
Dropped Text: 关于候选生城和上线计划，请按上线计划执行，有问题群里说。
Source Sentence: p1_b0_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 关于候选生城和上线计划，请按上线计划执行，有问题群里说。
```

```text
Dropped Text: 关于候选生城和上线计化，请按上线计划执行，有问题群里说。
Source Sentence: p1_b0_s1
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 关于候选生城和上线计化，请按上线计划执行，有问题群里说。
```

```text
Dropped Text: 关于后选生城和上线计划，请按上线计划执行，有问题群里说。
Source Sentence: p1_b0_s2
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 关于后选生城和上线计划，请按上线计划执行，有问题群里说。
```

```text
Dropped Text: 关于后选生城和上线计化，请按上线计划执行，有问题群里说。
Source Sentence: p1_b0_s3
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 关于后选生城和上线计化，请按上线计划执行，有问题群里说。
```

```text
Dropped Text: 关于候选生城和上线计划，请按上线计划执行，有问题群里说。
Source Sentence: p2_b0_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 关于候选生城和上线计划，请按上线计划执行，有问题群里说。
```

```text
Dropped Text: 关于候选生城和上线计化，请按上线计划执行，有问题群里说。
Source Sentence: p2_b0_s1
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 关于候选生城和上线计化，请按上线计划执行，有问题群里说。
```

```text
Dropped Text: 关于后选生城和上线计划，请按上线计划执行，有问题群里说。
Source Sentence: p2_b0_s2
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 关于后选生城和上线计划，请按上线计划执行，有问题群里说。
```

```text
Dropped Text: 关于后选生城和上线计化，请按上线计划执行，有问题群里说。
Source Sentence: p2_b0_s3
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 关于后选生城和上线计化，请按上线计划执行，有问题群里说。
```

```text
Dropped Text: 关于候选生城和上线计划，请按上线计划执行，有问题群里说。
Source Sentence: p3_b0_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 关于候选生城和上线计划，请按上线计划执行，有问题群里说。
```

```text
Dropped Text: 关于候选生城和上线计化，请按上线计划执行，有问题群里说。
Source Sentence: p3_b0_s1
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 关于候选生城和上线计化，请按上线计划执行，有问题群里说。
```

```text
Dropped Text: 关于后选生城和上线计划，请按上线计划执行，有问题群里说。
Source Sentence: p3_b0_s2
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 关于后选生城和上线计划，请按上线计划执行，有问题群里说。
```

```text
Dropped Text: 关于后选生城和上线计化，请按上线计划执行，有问题群里说。
Source Sentence: p3_b0_s3
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 关于后选生城和上线计化，请按上线计划执行，有问题群里说。
```

### F. KenLM Input

KenLM Input Count: 4

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
关于候选生城和上线计划，请按上线计划执行，有问题群里说。
```

2.

```text
关于候选生城和上线计化，请按上线计划执行，有问题群里说。
```

3.

```text
关于后选生城和上线计划，请按上线计划执行，有问题群里说。
```

4.

```text
关于后选生城和上线计化，请按上线计划执行，有问题群里说。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"80d8d072c93bd03cae9cbb84c08e94e3da22d362211a19bb4e9529d389cfcbd9","bucketDomain":"tech_ai","count":4},{"pathId":"93e4109d85b5380fab48f556415ccbc466756d447402b61852516ce4b9af9d96","bucketDomain":"tech_ai","count":4},{"pathId":"2ad765c2b868ddad2f2aacc904cdbbff13b3bd2676190675e265773ee4a9a6ab","bucketDomain":"tech_ai","count":4},{"pathId":"65aa4e3a49b767d4a16d0bb386a6f55fc3d2885c77f30fc1f8e5824bd3aebf0a","bucketDomain":"tech_ai","count":4}]
crossPathInputCount: 16
crossPathOutputCount: 4
kenlmInputCount: 4
CrossPath Input == Assembly total: YES (16 vs 16)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d136

<a id="case-d136"></a>

### Case 基础信息

```text
Case ID: d136
Raw Text: 你好，我想点一杯热巧克力，中杯，半糖。顺便问一下今天有曲奇吗？
Path Count: 1
Bucket Count: 3
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `a06b4c93a167bb6f741e0d2b7f2fa3cf1de1c31c7397ed5152e88b59922cac69`

Bucket: `coffee` (`p0_b0`)

Assembly Sentences:

1.

```text
你好，我想点一杯热巧克力，中杯，半糖。顺便问一下今天有曲奇吗？
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 4.75

#### Path: `a06b4c93a167bb6f741e0d2b7f2fa3cf1de1c31c7397ed5152e88b59922cac69`

Bucket: `food_order` (`p0_b1`)

Assembly Sentences:

1.

```text
你好，我想点一杯热巧克力，中杯，半糖。顺便问一下今天有曲奇吗？
```

- sentenceId: `p0_b1_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 4.75

#### Path: `a06b4c93a167bb6f741e0d2b7f2fa3cf1de1c31c7397ed5152e88b59922cac69`

Bucket: `milk_tea` (`p0_b2`)

Assembly Sentences:

1.

```text
你好，我想点一杯热巧克力，中杯，半糖。顺便问一下今天有曲奇吗？
```

- sentenceId: `p0_b2_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 4.75

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 3

1.

```text
text: 你好，我想点一杯热巧克力，中杯，半糖。顺便问一下今天有曲奇吗？
pathId: a06b4c93a167bb6f741e0d2b7f2fa3cf1de1c31c7397ed5152e88b59922cac69
bucketDomain: coffee
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 你好，我想点一杯热巧克力，中杯，半糖。顺便问一下今天有曲奇吗？
pathId: a06b4c93a167bb6f741e0d2b7f2fa3cf1de1c31c7397ed5152e88b59922cac69
bucketDomain: food_order
sourceSentenceId: p0_b1_s0
```

3.

```text
text: 你好，我想点一杯热巧克力，中杯，半糖。顺便问一下今天有曲奇吗？
pathId: a06b4c93a167bb6f741e0d2b7f2fa3cf1de1c31c7397ed5152e88b59922cac69
bucketDomain: milk_tea
sourceSentenceId: p0_b2_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 你好，我想点一杯热巧克力，中杯，半糖。顺便问一下今天有曲奇吗？
keptFromPath: a06b4c93a167bb6f741e0d2b7f2fa3cf1de1c31c7397ed5152e88b59922cac69
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

```text
Dropped Text: 你好，我想点一杯热巧克力，中杯，半糖。顺便问一下今天有曲奇吗？
Source Sentence: p0_b1_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 你好，我想点一杯热巧克力，中杯，半糖。顺便问一下今天有曲奇吗？
```

```text
Dropped Text: 你好，我想点一杯热巧克力，中杯，半糖。顺便问一下今天有曲奇吗？
Source Sentence: p0_b2_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 你好，我想点一杯热巧克力，中杯，半糖。顺便问一下今天有曲奇吗？
```

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
你好，我想点一杯热巧克力，中杯，半糖。顺便问一下今天有曲奇吗？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"a06b4c93a167bb6f741e0d2b7f2fa3cf1de1c31c7397ed5152e88b59922cac69","bucketDomain":"coffee","count":1},{"pathId":"a06b4c93a167bb6f741e0d2b7f2fa3cf1de1c31c7397ed5152e88b59922cac69","bucketDomain":"food_order","count":1},{"pathId":"a06b4c93a167bb6f741e0d2b7f2fa3cf1de1c31c7397ed5152e88b59922cac69","bucketDomain":"milk_tea","count":1}]
crossPathInputCount: 3
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (3 vs 3)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d137

<a id="case-d137"></a>

### Case 基础信息

```text
Case ID: d137
Raw Text: 麻烦帮我做一杯热拿铁带走，大杯就行，谢谢。
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `c997d4717cc122902c16f0968e80bb659cf5054e671498183d28129659cdd995`

Bucket: `coffee` (`p0_b0`)

Assembly Sentences:

1.

```text
麻烦帮我做一杯热拿铁带走，大杯就行，谢谢。
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 6.7275

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 麻烦帮我做一杯热拿铁带走，大杯就行，谢谢。
pathId: c997d4717cc122902c16f0968e80bb659cf5054e671498183d28129659cdd995
bucketDomain: coffee
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 麻烦帮我做一杯热拿铁带走，大杯就行，谢谢。
keptFromPath: c997d4717cc122902c16f0968e80bb659cf5054e671498183d28129659cdd995
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
麻烦帮我做一杯热拿铁带走，大杯就行，谢谢。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"c997d4717cc122902c16f0968e80bb659cf5054e671498183d28129659cdd995","bucketDomain":"coffee","count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d138

<a id="case-d138"></a>

### Case 基础信息

```text
Case ID: d138
Raw Text: 请问这款美式可以少冰吗？我赶时间，小杯。
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `819a6a7ddd4888a146f863e457a08cf1078f08698b4916903b0ec22023229386`

Bucket: `coffee` (`p0_b0`)

Assembly Sentences:

1.

```text
请问这款美式可以少冰吗？我赶时间，小杯。
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 9.126000000000001

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 请问这款美式可以少冰吗？我赶时间，小杯。
pathId: 819a6a7ddd4888a146f863e457a08cf1078f08698b4916903b0ec22023229386
bucketDomain: coffee
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 请问这款美式可以少冰吗？我赶时间，小杯。
keptFromPath: 819a6a7ddd4888a146f863e457a08cf1078f08698b4916903b0ec22023229386
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
请问这款美式可以少冰吗？我赶时间，小杯。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"819a6a7ddd4888a146f863e457a08cf1078f08698b4916903b0ec22023229386","bucketDomain":"coffee","count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d139

<a id="case-d139"></a>

### Case 基础信息

```text
Case ID: d139
Raw Text: 李工，客户反馈翻译引擎接口报错，我们能不能加缓存，下午三点前把结论发群里？
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `192b84f072ea72e5bfc1e646510978c24cb4fc1275c9fb642895892d1fab1c0a`

Bucket: `tech_ai` (`p0_b0`)

Assembly Sentences:

1.

```text
李工，客户反馈翻译引擎接口报错，我们能不能加缓存，下午三点前把结论发群里？
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 9.54

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 李工，客户反馈翻译引擎接口报错，我们能不能加缓存，下午三点前把结论发群里？
pathId: 192b84f072ea72e5bfc1e646510978c24cb4fc1275c9fb642895892d1fab1c0a
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 李工，客户反馈翻译引擎接口报错，我们能不能加缓存，下午三点前把结论发群里？
keptFromPath: 192b84f072ea72e5bfc1e646510978c24cb4fc1275c9fb642895892d1fab1c0a
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
李工，客户反馈翻译引擎接口报错，我们能不能加缓存，下午三点前把结论发群里？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"192b84f072ea72e5bfc1e646510978c24cb4fc1275c9fb642895892d1fab1c0a","bucketDomain":"tech_ai","count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d140

<a id="case-d140"></a>

### Case 基础信息

```text
Case ID: d140
Raw Text: 今天的站会先过一下订单中台进度，内存占用高这块需要限流保护，大家看一下风险。
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `1818371cb2a90c789c7b281c3cc36a23715bfc08e3164930fe2034ce6bc0785f`

Bucket: `food_order` (`p0_b0`)

Assembly Sentences:

1.

```text
今天的站会先过一下订单中台进度，内存占用高这块需要限流保护，大家看一下风险。
```

- sentenceId: `p0_b0_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.4

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 今天的站会先过一下订单中台进度，内存占用高这块需要限流保护，大家看一下风险。
pathId: 1818371cb2a90c789c7b281c3cc36a23715bfc08e3164930fe2034ce6bc0785f
bucketDomain: food_order
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 今天的站会先过一下订单中台进度，内存占用高这块需要限流保护，大家看一下风险。
keptFromPath: 1818371cb2a90c789c7b281c3cc36a23715bfc08e3164930fe2034ce6bc0785f
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
今天的站会先过一下订单中台进度，内存占用高这块需要限流保护，大家看一下风险。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"1818371cb2a90c789c7b281c3cc36a23715bfc08e3164930fe2034ce6bc0785f","bucketDomain":"food_order","count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d141

<a id="case-d141"></a>

### Case 基础信息

```text
Case ID: d141
Raw Text: 跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。
Path Count: 1
Bucket Count: 3
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `54a9f07e03af142eb5a06f0dd3e6a30fb09f82b47cd652dc08d575fdfc606551`

Bucket: `food_order` (`p0_b0`)

Assembly Sentences:

1.

```text
跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。
```

- sentenceId: `p0_b0_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

#### Path: `54a9f07e03af142eb5a06f0dd3e6a30fb09f82b47cd652dc08d575fdfc606551`

Bucket: `meeting` (`p0_b1`)

Assembly Sentences:

1.

```text
跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。
```

- sentenceId: `p0_b1_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

#### Path: `54a9f07e03af142eb5a06f0dd3e6a30fb09f82b47cd652dc08d575fdfc606551`

Bucket: `tech_ai` (`p0_b2`)

Assembly Sentences:

1.

```text
跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。
```

- sentenceId: `p0_b2_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 3

1.

```text
text: 跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。
pathId: 54a9f07e03af142eb5a06f0dd3e6a30fb09f82b47cd652dc08d575fdfc606551
bucketDomain: food_order
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。
pathId: 54a9f07e03af142eb5a06f0dd3e6a30fb09f82b47cd652dc08d575fdfc606551
bucketDomain: meeting
sourceSentenceId: p0_b1_s0
```

3.

```text
text: 跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。
pathId: 54a9f07e03af142eb5a06f0dd3e6a30fb09f82b47cd652dc08d575fdfc606551
bucketDomain: tech_ai
sourceSentenceId: p0_b2_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。
keptFromPath: 54a9f07e03af142eb5a06f0dd3e6a30fb09f82b47cd652dc08d575fdfc606551
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

```text
Dropped Text: 跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。
Source Sentence: p0_b1_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。
```

```text
Dropped Text: 跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。
Source Sentence: p0_b2_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。
```

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"54a9f07e03af142eb5a06f0dd3e6a30fb09f82b47cd652dc08d575fdfc606551","bucketDomain":"food_order","count":1},{"pathId":"54a9f07e03af142eb5a06f0dd3e6a30fb09f82b47cd652dc08d575fdfc606551","bucketDomain":"meeting","count":1},{"pathId":"54a9f07e03af142eb5a06f0dd3e6a30fb09f82b47cd652dc08d575fdfc606551","bucketDomain":"tech_ai","count":1}]
crossPathInputCount: 3
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (3 vs 3)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d142

<a id="case-d142"></a>

### Case 基础信息

```text
Case ID: d142
Raw Text: 师傅，去浦东张江，走三环。我赶九点半的会，要是堵车您提前跟我说。
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `d990235effc61e47f6a7203d3b4cf7cec955260008a5a44878f6daaa46f7915f`

Bucket: `tourism_hotel` (`p0_b0`)

Assembly Sentences:

1.

```text
师傅，去浦东张江，走三环。我赶酒店半的会，要是堵车您提前跟我说。
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 4.72

2.

```text
师傅，去浦东张江，走三环。我赶九点半的会，要是堵车您提前跟我说。
```

- sentenceId: `p0_b0_s1`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 2
- assemblyScore: 2.36

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 2

1.

```text
text: 师傅，去浦东张江，走三环。我赶酒店半的会，要是堵车您提前跟我说。
pathId: d990235effc61e47f6a7203d3b4cf7cec955260008a5a44878f6daaa46f7915f
bucketDomain: tourism_hotel
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 师傅，去浦东张江，走三环。我赶九点半的会，要是堵车您提前跟我说。
pathId: d990235effc61e47f6a7203d3b4cf7cec955260008a5a44878f6daaa46f7915f
bucketDomain: tourism_hotel
sourceSentenceId: p0_b0_s1
```

### D. CrossPath Output

Count: 2

1.

```text
text: 师傅，去浦东张江，走三环。我赶酒店半的会，要是堵车您提前跟我说。
keptFromPath: d990235effc61e47f6a7203d3b4cf7cec955260008a5a44878f6daaa46f7915f
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 师傅，去浦东张江，走三环。我赶九点半的会，要是堵车您提前跟我说。
keptFromPath: d990235effc61e47f6a7203d3b4cf7cec955260008a5a44878f6daaa46f7915f
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s1
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 2

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
师傅，去浦东张江，走三环。我赶酒店半的会，要是堵车您提前跟我说。
```

2.

```text
师傅，去浦东张江，走三环。我赶九点半的会，要是堵车您提前跟我说。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"d990235effc61e47f6a7203d3b4cf7cec955260008a5a44878f6daaa46f7915f","bucketDomain":"tourism_hotel","count":2}]
crossPathInputCount: 2
crossPathOutputCount: 2
kenlmInputCount: 2
CrossPath Input == Assembly total: YES (2 vs 2)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d143

<a id="case-d143"></a>

### Case 基础信息

```text
Case ID: d143
Raw Text: 麻烦送我到深圳南山科技园南门，大概多久能到？我十点十分有个电话会。
Path Count: 1
Bucket Count: 2
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `d9e028c3cf0bd38c6f8f20b22181fa312da5899e1b990b73516f687aa58fee57`

Bucket: `meeting` (`p0_b0`)

Assembly Sentences:

1.

```text
麻烦送我到深圳南山科记员南门，大概多久能到？我十点十分有个电话会。
```

- sentenceId: `p0_b0_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

2.

```text
麻烦送我到深圳南山科技园南门，大概多久能到？我十点十分有个电话会。
```

- sentenceId: `p0_b0_s1`
- category: `RAW_ORIGINAL`
- assemblyRank: 2
- assemblyScore: 0

#### Path: `d9e028c3cf0bd38c6f8f20b22181fa312da5899e1b990b73516f687aa58fee57`

Bucket: `tourism_pickup` (`p0_b1`)

Assembly Sentences:

1.

```text
麻烦送我到深圳南山科机员南门，大概多久能到？我十点十分有个电话会。
```

- sentenceId: `p0_b1_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

2.

```text
麻烦送我到深圳南山科技园南门，大概多久能到？我十点十分有个电话会。
```

- sentenceId: `p0_b1_s1`
- category: `RAW_ORIGINAL`
- assemblyRank: 2
- assemblyScore: 0

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 4

1.

```text
text: 麻烦送我到深圳南山科记员南门，大概多久能到？我十点十分有个电话会。
pathId: d9e028c3cf0bd38c6f8f20b22181fa312da5899e1b990b73516f687aa58fee57
bucketDomain: meeting
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 麻烦送我到深圳南山科技园南门，大概多久能到？我十点十分有个电话会。
pathId: d9e028c3cf0bd38c6f8f20b22181fa312da5899e1b990b73516f687aa58fee57
bucketDomain: meeting
sourceSentenceId: p0_b0_s1
```

3.

```text
text: 麻烦送我到深圳南山科机员南门，大概多久能到？我十点十分有个电话会。
pathId: d9e028c3cf0bd38c6f8f20b22181fa312da5899e1b990b73516f687aa58fee57
bucketDomain: tourism_pickup
sourceSentenceId: p0_b1_s0
```

4.

```text
text: 麻烦送我到深圳南山科技园南门，大概多久能到？我十点十分有个电话会。
pathId: d9e028c3cf0bd38c6f8f20b22181fa312da5899e1b990b73516f687aa58fee57
bucketDomain: tourism_pickup
sourceSentenceId: p0_b1_s1
```

### D. CrossPath Output

Count: 3

1.

```text
text: 麻烦送我到深圳南山科记员南门，大概多久能到？我十点十分有个电话会。
keptFromPath: d9e028c3cf0bd38c6f8f20b22181fa312da5899e1b990b73516f687aa58fee57
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 麻烦送我到深圳南山科技园南门，大概多久能到？我十点十分有个电话会。
keptFromPath: d9e028c3cf0bd38c6f8f20b22181fa312da5899e1b990b73516f687aa58fee57
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s1
```

3.

```text
text: 麻烦送我到深圳南山科机员南门，大概多久能到？我十点十分有个电话会。
keptFromPath: d9e028c3cf0bd38c6f8f20b22181fa312da5899e1b990b73516f687aa58fee57
keptFromBucket: p0_b1
sourceSentenceId: p0_b1_s0
```

### E. CrossPath 删除项

```text
Dropped Text: 麻烦送我到深圳南山科技园南门，大概多久能到？我十点十分有个电话会。
Source Sentence: p0_b1_s1
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 麻烦送我到深圳南山科技园南门，大概多久能到？我十点十分有个电话会。
```

### F. KenLM Input

KenLM Input Count: 3

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
麻烦送我到深圳南山科记员南门，大概多久能到？我十点十分有个电话会。
```

2.

```text
麻烦送我到深圳南山科技园南门，大概多久能到？我十点十分有个电话会。
```

3.

```text
麻烦送我到深圳南山科机员南门，大概多久能到？我十点十分有个电话会。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"d9e028c3cf0bd38c6f8f20b22181fa312da5899e1b990b73516f687aa58fee57","bucketDomain":"meeting","count":2},{"pathId":"d9e028c3cf0bd38c6f8f20b22181fa312da5899e1b990b73516f687aa58fee57","bucketDomain":"tourism_pickup","count":2}]
crossPathInputCount: 4
crossPathOutputCount: 3
kenlmInputCount: 3
CrossPath Input == Assembly total: YES (4 vs 4)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d144

<a id="case-d144"></a>

### Case 基础信息

```text
Case ID: d144
Raw Text: 去杭州西溪，不走延安路高架可以吗？那边现在堵不堵？
Path Count: 1
Bucket Count: 2
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `517d47c6bc06be41b48765ec4ea593f519ea0fbd8378a2d99469ff2a464751e6`

Bucket: `medical` (`p0_b0`)

Assembly Sentences:

1.

```text
去杭州西溪，不走延安路高架科医吗？那边现在堵不堵？
```

- sentenceId: `p0_b0_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

2.

```text
去杭州西溪，不走延安路高架可以吗？那边现在堵不堵？
```

- sentenceId: `p0_b0_s1`
- category: `RAW_ORIGINAL`
- assemblyRank: 2
- assemblyScore: 0

#### Path: `517d47c6bc06be41b48765ec4ea593f519ea0fbd8378a2d99469ff2a464751e6`

Bucket: `milk_tea` (`p0_b1`)

Assembly Sentences:

1.

```text
去杭州细吸，不走延安路高架可以吗？那边现在堵不堵？
```

- sentenceId: `p0_b1_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

2.

```text
去杭州西溪，不走延安路高架可以吗？那边现在堵不堵？
```

- sentenceId: `p0_b1_s1`
- category: `RAW_ORIGINAL`
- assemblyRank: 2
- assemblyScore: 0

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 4

1.

```text
text: 去杭州西溪，不走延安路高架科医吗？那边现在堵不堵？
pathId: 517d47c6bc06be41b48765ec4ea593f519ea0fbd8378a2d99469ff2a464751e6
bucketDomain: medical
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 去杭州西溪，不走延安路高架可以吗？那边现在堵不堵？
pathId: 517d47c6bc06be41b48765ec4ea593f519ea0fbd8378a2d99469ff2a464751e6
bucketDomain: medical
sourceSentenceId: p0_b0_s1
```

3.

```text
text: 去杭州细吸，不走延安路高架可以吗？那边现在堵不堵？
pathId: 517d47c6bc06be41b48765ec4ea593f519ea0fbd8378a2d99469ff2a464751e6
bucketDomain: milk_tea
sourceSentenceId: p0_b1_s0
```

4.

```text
text: 去杭州西溪，不走延安路高架可以吗？那边现在堵不堵？
pathId: 517d47c6bc06be41b48765ec4ea593f519ea0fbd8378a2d99469ff2a464751e6
bucketDomain: milk_tea
sourceSentenceId: p0_b1_s1
```

### D. CrossPath Output

Count: 3

1.

```text
text: 去杭州西溪，不走延安路高架科医吗？那边现在堵不堵？
keptFromPath: 517d47c6bc06be41b48765ec4ea593f519ea0fbd8378a2d99469ff2a464751e6
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 去杭州西溪，不走延安路高架可以吗？那边现在堵不堵？
keptFromPath: 517d47c6bc06be41b48765ec4ea593f519ea0fbd8378a2d99469ff2a464751e6
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s1
```

3.

```text
text: 去杭州细吸，不走延安路高架可以吗？那边现在堵不堵？
keptFromPath: 517d47c6bc06be41b48765ec4ea593f519ea0fbd8378a2d99469ff2a464751e6
keptFromBucket: p0_b1
sourceSentenceId: p0_b1_s0
```

### E. CrossPath 删除项

```text
Dropped Text: 去杭州西溪，不走延安路高架可以吗？那边现在堵不堵？
Source Sentence: p0_b1_s1
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 去杭州西溪，不走延安路高架可以吗？那边现在堵不堵？
```

### F. KenLM Input

KenLM Input Count: 3

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
去杭州西溪，不走延安路高架科医吗？那边现在堵不堵？
```

2.

```text
去杭州西溪，不走延安路高架可以吗？那边现在堵不堵？
```

3.

```text
去杭州细吸，不走延安路高架可以吗？那边现在堵不堵？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"517d47c6bc06be41b48765ec4ea593f519ea0fbd8378a2d99469ff2a464751e6","bucketDomain":"medical","count":2},{"pathId":"517d47c6bc06be41b48765ec4ea593f519ea0fbd8378a2d99469ff2a464751e6","bucketDomain":"milk_tea","count":2}]
crossPathInputCount: 4
crossPathOutputCount: 3
kenlmInputCount: 3
CrossPath Input == Assembly total: YES (4 vs 4)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d145

<a id="case-d145"></a>

### Case 基础信息

```text
Case ID: d145
Raw Text: 医生您好，我这两天嗓子疼，想开点药并做个血常规。
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `923d94355096126318cedf6dfb5d3a1ef742de3f254782f57c69e51220363c96`

Bucket: `medical` (`p0_b0`)

Assembly Sentences:

1.

```text
医生您好，我这两天嗓子疼，想开点药并做个血常规。
```

- sentenceId: `p0_b0_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 医生您好，我这两天嗓子疼，想开点药并做个血常规。
pathId: 923d94355096126318cedf6dfb5d3a1ef742de3f254782f57c69e51220363c96
bucketDomain: medical
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 医生您好，我这两天嗓子疼，想开点药并做个血常规。
keptFromPath: 923d94355096126318cedf6dfb5d3a1ef742de3f254782f57c69e51220363c96
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
医生您好，我这两天嗓子疼，想开点药并做个血常规。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"923d94355096126318cedf6dfb5d3a1ef742de3f254782f57c69e51220363c96","bucketDomain":"medical","count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d146

<a id="case-d146"></a>

### Case 基础信息

```text
Case ID: d146
Raw Text: 挂号处请问内科还有号吗？我低烧，昨晚开始的。
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `64083fb1626180a51550a2e8a10bae9e4241146dd0293d64ec0354cb5447e5d1`

Bucket: `medical` (`p0_b0`)

Assembly Sentences:

1.

```text
挂号处请问内科还有号吗？我低烧，昨晚开始的。
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 4.71

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 挂号处请问内科还有号吗？我低烧，昨晚开始的。
pathId: 64083fb1626180a51550a2e8a10bae9e4241146dd0293d64ec0354cb5447e5d1
bucketDomain: medical
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 挂号处请问内科还有号吗？我低烧，昨晚开始的。
keptFromPath: 64083fb1626180a51550a2e8a10bae9e4241146dd0293d64ec0354cb5447e5d1
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
挂号处请问内科还有号吗？我低烧，昨晚开始的。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"64083fb1626180a51550a2e8a10bae9e4241146dd0293d64ec0354cb5447e5d1","bucketDomain":"medical","count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d147

<a id="case-d147"></a>

### Case 基础信息

```text
Case ID: d147
Raw Text: 这个检查报告什么时候能出？我咳嗽，需要请假休息吗？
Path Count: 1
Bucket Count: 2
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `b6dd9bf159bd6f37accf48512c1d3b164dd9bdb60d1a18d5053e700f027ebaea`

Bucket: `medical` (`p0_b0`)

Assembly Sentences:

1.

```text
这个检查报告什么时候能出？我咳嗽，需要请假休息吗？
```

- sentenceId: `p0_b0_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.35

#### Path: `b6dd9bf159bd6f37accf48512c1d3b164dd9bdb60d1a18d5053e700f027ebaea`

Bucket: `tech_ai` (`p0_b1`)

Assembly Sentences:

1.

```text
这个检查报告什么时候能出？我咳嗽，需要请假休息吗？
```

- sentenceId: `p0_b1_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 2

1.

```text
text: 这个检查报告什么时候能出？我咳嗽，需要请假休息吗？
pathId: b6dd9bf159bd6f37accf48512c1d3b164dd9bdb60d1a18d5053e700f027ebaea
bucketDomain: medical
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 这个检查报告什么时候能出？我咳嗽，需要请假休息吗？
pathId: b6dd9bf159bd6f37accf48512c1d3b164dd9bdb60d1a18d5053e700f027ebaea
bucketDomain: tech_ai
sourceSentenceId: p0_b1_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 这个检查报告什么时候能出？我咳嗽，需要请假休息吗？
keptFromPath: b6dd9bf159bd6f37accf48512c1d3b164dd9bdb60d1a18d5053e700f027ebaea
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

```text
Dropped Text: 这个检查报告什么时候能出？我咳嗽，需要请假休息吗？
Source Sentence: p0_b1_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 这个检查报告什么时候能出？我咳嗽，需要请假休息吗？
```

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
这个检查报告什么时候能出？我咳嗽，需要请假休息吗？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"b6dd9bf159bd6f37accf48512c1d3b164dd9bdb60d1a18d5053e700f027ebaea","bucketDomain":"medical","count":1},{"pathId":"b6dd9bf159bd6f37accf48512c1d3b164dd9bdb60d1a18d5053e700f027ebaea","bucketDomain":"tech_ai","count":1}]
crossPathInputCount: 2
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (2 vs 2)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d148

<a id="case-d148"></a>

### Case 基础信息

```text
Case ID: d148
Raw Text: 这件外套能试穿吗？我穿中码。买两件有没有折扣？
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `bf0502a46c3d5c83e4576c1730ccf54b973d21032960d5f734d5d84962bf783f`

Bucket: `tech_ai` (`p0_b0`)

Assembly Sentences:

1.

```text
这件外套能试穿吗？我穿中码。买量检有没有折扣？
```

- sentenceId: `p0_b0_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

2.

```text
这件外套能试穿吗？我穿中码。买两件有没有折扣？
```

- sentenceId: `p0_b0_s1`
- category: `RAW_ORIGINAL`
- assemblyRank: 2
- assemblyScore: 0

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 2

1.

```text
text: 这件外套能试穿吗？我穿中码。买量检有没有折扣？
pathId: bf0502a46c3d5c83e4576c1730ccf54b973d21032960d5f734d5d84962bf783f
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 这件外套能试穿吗？我穿中码。买两件有没有折扣？
pathId: bf0502a46c3d5c83e4576c1730ccf54b973d21032960d5f734d5d84962bf783f
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s1
```

### D. CrossPath Output

Count: 2

1.

```text
text: 这件外套能试穿吗？我穿中码。买量检有没有折扣？
keptFromPath: bf0502a46c3d5c83e4576c1730ccf54b973d21032960d5f734d5d84962bf783f
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 这件外套能试穿吗？我穿中码。买两件有没有折扣？
keptFromPath: bf0502a46c3d5c83e4576c1730ccf54b973d21032960d5f734d5d84962bf783f
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s1
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 2

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
这件外套能试穿吗？我穿中码。买量检有没有折扣？
```

2.

```text
这件外套能试穿吗？我穿中码。买两件有没有折扣？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"bf0502a46c3d5c83e4576c1730ccf54b973d21032960d5f734d5d84962bf783f","bucketDomain":"tech_ai","count":2}]
crossPathInputCount: 2
crossPathOutputCount: 2
kenlmInputCount: 2
CrossPath Input == Assembly total: YES (2 vs 2)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d149

<a id="case-d149"></a>

### Case 基础信息

```text
Case ID: d149
Raw Text: 请问这双鞋有四十码吗？不合适三天内可以退换吧？
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `273cfbaf61f2e19636f9a795cf32d7cfe4b6575d1affcccfa8a8ee4e6eb56721`

Bucket: `medical` (`p0_b0`)

Assembly Sentences:

1.

```text
请问这双鞋有四十码吗？不合适三天内科医退换吧？
```

- sentenceId: `p0_b0_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

2.

```text
请问这双鞋有四十码吗？不合适三天内可以退换吧？
```

- sentenceId: `p0_b0_s1`
- category: `RAW_ORIGINAL`
- assemblyRank: 2
- assemblyScore: 0

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 2

1.

```text
text: 请问这双鞋有四十码吗？不合适三天内科医退换吧？
pathId: 273cfbaf61f2e19636f9a795cf32d7cfe4b6575d1affcccfa8a8ee4e6eb56721
bucketDomain: medical
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 请问这双鞋有四十码吗？不合适三天内可以退换吧？
pathId: 273cfbaf61f2e19636f9a795cf32d7cfe4b6575d1affcccfa8a8ee4e6eb56721
bucketDomain: medical
sourceSentenceId: p0_b0_s1
```

### D. CrossPath Output

Count: 2

1.

```text
text: 请问这双鞋有四十码吗？不合适三天内科医退换吧？
keptFromPath: 273cfbaf61f2e19636f9a795cf32d7cfe4b6575d1affcccfa8a8ee4e6eb56721
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 请问这双鞋有四十码吗？不合适三天内可以退换吧？
keptFromPath: 273cfbaf61f2e19636f9a795cf32d7cfe4b6575d1affcccfa8a8ee4e6eb56721
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s1
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 2

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
请问这双鞋有四十码吗？不合适三天内科医退换吧？
```

2.

```text
请问这双鞋有四十码吗？不合适三天内可以退换吧？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"273cfbaf61f2e19636f9a795cf32d7cfe4b6575d1affcccfa8a8ee4e6eb56721","bucketDomain":"medical","count":2}]
crossPathInputCount: 2
crossPathOutputCount: 2
kenlmInputCount: 2
CrossPath Input == Assembly total: YES (2 vs 2)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d150

<a id="case-d150"></a>

### Case 基础信息

```text
Case ID: d150
Raw Text: 我想对比一下这两款订单中台的价格，会员日能再减一点吗？
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `72d46d6d27ed168a2b446ccc0ef5ca29e9e538e6e0e94d9ab712448785bc00fc`

Bucket: `food_order` (`p0_b0`)

Assembly Sentences:

1.

```text
我想对比一下这两款订单中台的价格，会员日能再减一点吗？
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 4.76

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 我想对比一下这两款订单中台的价格，会员日能再减一点吗？
pathId: 72d46d6d27ed168a2b446ccc0ef5ca29e9e538e6e0e94d9ab712448785bc00fc
bucketDomain: food_order
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 我想对比一下这两款订单中台的价格，会员日能再减一点吗？
keptFromPath: 72d46d6d27ed168a2b446ccc0ef5ca29e9e538e6e0e94d9ab712448785bc00fc
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
我想对比一下这两款订单中台的价格，会员日能再减一点吗？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"72d46d6d27ed168a2b446ccc0ef5ca29e9e538e6e0e94d9ab712448785bc00fc","bucketDomain":"food_order","count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d151

<a id="case-d151"></a>

### Case 基础信息

```text
Case ID: d151
Raw Text: 周末要不要去江边骑行？天气预报说周日多云，记得带水。
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `ef362a7409d257efe1af2da13a738a0d169e7c13cebf78fc693f2e600087c365`

Bucket: `null` (`p0_b0`)

Assembly Sentences:

1.

```text
周末要不要去江边骑行？天气预报说周日多云，记得带水。
```

- sentenceId: `p0_b0_s0`
- category: `RAW_ORIGINAL`
- assemblyRank: 1
- assemblyScore: 0

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 周末要不要去江边骑行？天气预报说周日多云，记得带水。
pathId: ef362a7409d257efe1af2da13a738a0d169e7c13cebf78fc693f2e600087c365
bucketDomain: null
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 周末要不要去江边骑行？天气预报说周日多云，记得带水。
keptFromPath: ef362a7409d257efe1af2da13a738a0d169e7c13cebf78fc693f2e600087c365
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
周末要不要去江边骑行？天气预报说周日多云，记得带水。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"ef362a7409d257efe1af2da13a738a0d169e7c13cebf78fc693f2e600087c365","bucketDomain":null,"count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d152

<a id="case-d152"></a>

### Case 基础信息

```text
Case ID: d152
Raw Text: 晚上一起吃饭吗？我知道一家川菜不错，大概七点到。
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `37367286bf78ef457c58421ac1cc51772b81498372ff6046875c912bacb0a3ca`

Bucket: `null` (`p0_b0`)

Assembly Sentences:

1.

```text
晚上一起吃饭吗？我知道一家川菜不错，大概七点到。
```

- sentenceId: `p0_b0_s0`
- category: `RAW_ORIGINAL`
- assemblyRank: 1
- assemblyScore: 0

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 晚上一起吃饭吗？我知道一家川菜不错，大概七点到。
pathId: 37367286bf78ef457c58421ac1cc51772b81498372ff6046875c912bacb0a3ca
bucketDomain: null
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 晚上一起吃饭吗？我知道一家川菜不错，大概七点到。
keptFromPath: 37367286bf78ef457c58421ac1cc51772b81498372ff6046875c912bacb0a3ca
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
晚上一起吃饭吗？我知道一家川菜不错，大概七点到。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"37367286bf78ef457c58421ac1cc51772b81498372ff6046875c912bacb0a3ca","bucketDomain":null,"count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d153

<a id="case-d153"></a>

### Case 基础信息

```text
Case ID: d153
Raw Text: 你最近忙不忙？想找你看下手机备份怎么设置。
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `8abbc76111de7c632d7d17362fe9a7cda58f3c9572ab70bc308648553237b238`

Bucket: `null` (`p0_b0`)

Assembly Sentences:

1.

```text
你最近忙不忙？想找你看下手机备份怎么设置。
```

- sentenceId: `p0_b0_s0`
- category: `RAW_ORIGINAL`
- assemblyRank: 1
- assemblyScore: 0

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 你最近忙不忙？想找你看下手机备份怎么设置。
pathId: 8abbc76111de7c632d7d17362fe9a7cda58f3c9572ab70bc308648553237b238
bucketDomain: null
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 你最近忙不忙？想找你看下手机备份怎么设置。
keptFromPath: 8abbc76111de7c632d7d17362fe9a7cda58f3c9572ab70bc308648553237b238
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
你最近忙不忙？想找你看下手机备份怎么设置。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"8abbc76111de7c632d7d17362fe9a7cda58f3c9572ab70bc308648553237b238","bucketDomain":null,"count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d154

<a id="case-d154"></a>

### Case 基础信息

```text
Case ID: d154
Raw Text: 今天我们团队要讨论后选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
Path Count: 2
Bucket Count: 2
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8`

Bucket: `tech_ai` (`p0_b0`)

Assembly Sentences:

1.

```text
今天我们团队要讨论候选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 12.02

2.

```text
今天我们团队要讨论候选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
```

- sentenceId: `p0_b0_s1`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 2
- assemblyScore: 9.62

3.

```text
今天我们团队要讨论后选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
```

- sentenceId: `p0_b0_s2`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 3
- assemblyScore: 9.6

4.

```text
今天我们团队要讨论候选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
```

- sentenceId: `p0_b0_s3`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 4
- assemblyScore: 9.6

5.

```text
今天我们团队要讨论后选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
```

- sentenceId: `p0_b0_s4`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 5
- assemblyScore: 7.199999999999999

6.

```text
今天我们团队要讨论候选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
```

- sentenceId: `p0_b0_s5`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 6
- assemblyScore: 7.199999999999999

7.

```text
今天我们团队要讨论后选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
```

- sentenceId: `p0_b0_s6`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 7
- assemblyScore: 7.18

8.

```text
今天我们团队要讨论后选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
```

- sentenceId: `p0_b0_s7`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 8
- assemblyScore: 4.779999999999999

#### Path: `982f3f240464b76e9444a459acaf33ee860bc86f3827f03a9ecc863f3bb62ddb`

Bucket: `tech_ai` (`p1_b0`)

Assembly Sentences:

1.

```text
今天我们团队要讨论候选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
```

- sentenceId: `p1_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 9.239999999999998

2.

```text
今天我们团队要讨论候选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
```

- sentenceId: `p1_b0_s1`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 2
- assemblyScore: 7.199999999999999

3.

```text
今天我们团队要讨论后选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
```

- sentenceId: `p1_b0_s2`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 3
- assemblyScore: 6.819999999999999

4.

```text
今天我们团队要讨论候选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
```

- sentenceId: `p1_b0_s3`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 4
- assemblyScore: 6.819999999999999

5.

```text
今天我们团队要讨论后选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
```

- sentenceId: `p1_b0_s4`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 5
- assemblyScore: 4.779999999999999

6.

```text
今天我们团队要讨论候选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
```

- sentenceId: `p1_b0_s5`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 6
- assemblyScore: 4.779999999999999

7.

```text
今天我们团队要讨论后选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
```

- sentenceId: `p1_b0_s6`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 7
- assemblyScore: 4.4

8.

```text
今天我们团队要讨论后选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
```

- sentenceId: `p1_b0_s7`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 8
- assemblyScore: 2.36

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 16

1.

```text
text: 今天我们团队要讨论候选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
pathId: e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 今天我们团队要讨论候选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
pathId: e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s1
```

3.

```text
text: 今天我们团队要讨论后选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
pathId: e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s2
```

4.

```text
text: 今天我们团队要讨论候选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
pathId: e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s3
```

5.

```text
text: 今天我们团队要讨论后选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
pathId: e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s4
```

6.

```text
text: 今天我们团队要讨论候选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
pathId: e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s5
```

7.

```text
text: 今天我们团队要讨论后选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
pathId: e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s6
```

8.

```text
text: 今天我们团队要讨论后选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
pathId: e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s7
```

9.

```text
text: 今天我们团队要讨论候选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
pathId: 982f3f240464b76e9444a459acaf33ee860bc86f3827f03a9ecc863f3bb62ddb
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s0
```

10.

```text
text: 今天我们团队要讨论候选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
pathId: 982f3f240464b76e9444a459acaf33ee860bc86f3827f03a9ecc863f3bb62ddb
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s1
```

11.

```text
text: 今天我们团队要讨论后选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
pathId: 982f3f240464b76e9444a459acaf33ee860bc86f3827f03a9ecc863f3bb62ddb
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s2
```

12.

```text
text: 今天我们团队要讨论候选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
pathId: 982f3f240464b76e9444a459acaf33ee860bc86f3827f03a9ecc863f3bb62ddb
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s3
```

13.

```text
text: 今天我们团队要讨论后选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
pathId: 982f3f240464b76e9444a459acaf33ee860bc86f3827f03a9ecc863f3bb62ddb
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s4
```

14.

```text
text: 今天我们团队要讨论候选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
pathId: 982f3f240464b76e9444a459acaf33ee860bc86f3827f03a9ecc863f3bb62ddb
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s5
```

15.

```text
text: 今天我们团队要讨论后选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
pathId: 982f3f240464b76e9444a459acaf33ee860bc86f3827f03a9ecc863f3bb62ddb
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s6
```

16.

```text
text: 今天我们团队要讨论后选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
pathId: 982f3f240464b76e9444a459acaf33ee860bc86f3827f03a9ecc863f3bb62ddb
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s7
```

### D. CrossPath Output

Count: 8

1.

```text
text: 今天我们团队要讨论候选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
keptFromPath: e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 今天我们团队要讨论候选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
keptFromPath: e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s1
```

3.

```text
text: 今天我们团队要讨论后选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
keptFromPath: e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s2
```

4.

```text
text: 今天我们团队要讨论候选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
keptFromPath: e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s3
```

5.

```text
text: 今天我们团队要讨论后选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
keptFromPath: e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s4
```

6.

```text
text: 今天我们团队要讨论候选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
keptFromPath: e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s5
```

7.

```text
text: 今天我们团队要讨论后选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
keptFromPath: e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s6
```

8.

```text
text: 今天我们团队要讨论后选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
keptFromPath: e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s7
```

### E. CrossPath 删除项

```text
Dropped Text: 今天我们团队要讨论候选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
Source Sentence: p1_b0_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 今天我们团队要讨论候选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
```

```text
Dropped Text: 今天我们团队要讨论候选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
Source Sentence: p1_b0_s1
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 今天我们团队要讨论候选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
```

```text
Dropped Text: 今天我们团队要讨论后选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
Source Sentence: p1_b0_s2
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 今天我们团队要讨论后选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
```

```text
Dropped Text: 今天我们团队要讨论候选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
Source Sentence: p1_b0_s3
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 今天我们团队要讨论候选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
```

```text
Dropped Text: 今天我们团队要讨论后选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
Source Sentence: p1_b0_s4
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 今天我们团队要讨论后选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
```

```text
Dropped Text: 今天我们团队要讨论候选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
Source Sentence: p1_b0_s5
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 今天我们团队要讨论候选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
```

```text
Dropped Text: 今天我们团队要讨论后选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
Source Sentence: p1_b0_s6
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 今天我们团队要讨论后选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
```

```text
Dropped Text: 今天我们团队要讨论后选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
Source Sentence: p1_b0_s7
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 今天我们团队要讨论后选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
```

### F. KenLM Input

KenLM Input Count: 8

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
今天我们团队要讨论候选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
```

2.

```text
今天我们团队要讨论候选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
```

3.

```text
今天我们团队要讨论后选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
```

4.

```text
今天我们团队要讨论候选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
```

5.

```text
今天我们团队要讨论后选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
```

6.

```text
今天我们团队要讨论候选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
```

7.

```text
今天我们团队要讨论后选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
```

8.

```text
今天我们团队要讨论后选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8","bucketDomain":"tech_ai","count":8},{"pathId":"982f3f240464b76e9444a459acaf33ee860bc86f3827f03a9ecc863f3bb62ddb","bucketDomain":"tech_ai","count":8}]
crossPathInputCount: 16
crossPathOutputCount: 8
kenlmInputCount: 8
CrossPath Input == Assembly total: YES (16 vs 16)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d155

<a id="case-d155"></a>

### Case 基础信息

```text
Case ID: d155
Raw Text: 这次发布我们先对齐上线计划窗口，后选生城模块需要联调，别漏掉回归。
Path Count: 2
Bucket Count: 2
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `d18e38f8936e3dae9107ea8e2acaf78da3b2472127b9644ea2be67380e9844d7`

Bucket: `tech_ai` (`p0_b0`)

Assembly Sentences:

1.

```text
这次发布我们先对齐上线计划窗口，候选生城模块需要联调，别漏掉回归。
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 14.4

2.

```text
这次发布我们先对齐上线计划窗口，后选生城模块需要联调，别漏掉回归。
```

- sentenceId: `p0_b0_s1`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 2
- assemblyScore: 11.98

#### Path: `d0727a8e1c03785b04ed2877ce853d0488af5bbfebedbe740226ff2cb15c2120`

Bucket: `tech_ai` (`p1_b0`)

Assembly Sentences:

1.

```text
这次发布我们先对齐上线计划窗口，候选生城模块需要联调，别漏掉回归。
```

- sentenceId: `p1_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 11.620000000000001

2.

```text
这次发布我们先对齐上线计划窗口，后选生城模块需要联调，别漏掉回归。
```

- sentenceId: `p1_b0_s1`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 2
- assemblyScore: 9.200000000000001

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 4

1.

```text
text: 这次发布我们先对齐上线计划窗口，候选生城模块需要联调，别漏掉回归。
pathId: d18e38f8936e3dae9107ea8e2acaf78da3b2472127b9644ea2be67380e9844d7
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 这次发布我们先对齐上线计划窗口，后选生城模块需要联调，别漏掉回归。
pathId: d18e38f8936e3dae9107ea8e2acaf78da3b2472127b9644ea2be67380e9844d7
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s1
```

3.

```text
text: 这次发布我们先对齐上线计划窗口，候选生城模块需要联调，别漏掉回归。
pathId: d0727a8e1c03785b04ed2877ce853d0488af5bbfebedbe740226ff2cb15c2120
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s0
```

4.

```text
text: 这次发布我们先对齐上线计划窗口，后选生城模块需要联调，别漏掉回归。
pathId: d0727a8e1c03785b04ed2877ce853d0488af5bbfebedbe740226ff2cb15c2120
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s1
```

### D. CrossPath Output

Count: 2

1.

```text
text: 这次发布我们先对齐上线计划窗口，候选生城模块需要联调，别漏掉回归。
keptFromPath: d18e38f8936e3dae9107ea8e2acaf78da3b2472127b9644ea2be67380e9844d7
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 这次发布我们先对齐上线计划窗口，后选生城模块需要联调，别漏掉回归。
keptFromPath: d18e38f8936e3dae9107ea8e2acaf78da3b2472127b9644ea2be67380e9844d7
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s1
```

### E. CrossPath 删除项

```text
Dropped Text: 这次发布我们先对齐上线计划窗口，候选生城模块需要联调，别漏掉回归。
Source Sentence: p1_b0_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 这次发布我们先对齐上线计划窗口，候选生城模块需要联调，别漏掉回归。
```

```text
Dropped Text: 这次发布我们先对齐上线计划窗口，后选生城模块需要联调，别漏掉回归。
Source Sentence: p1_b0_s1
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 这次发布我们先对齐上线计划窗口，后选生城模块需要联调，别漏掉回归。
```

### F. KenLM Input

KenLM Input Count: 2

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
这次发布我们先对齐上线计划窗口，候选生城模块需要联调，别漏掉回归。
```

2.

```text
这次发布我们先对齐上线计划窗口，后选生城模块需要联调，别漏掉回归。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"d18e38f8936e3dae9107ea8e2acaf78da3b2472127b9644ea2be67380e9844d7","bucketDomain":"tech_ai","count":2},{"pathId":"d0727a8e1c03785b04ed2877ce853d0488af5bbfebedbe740226ff2cb15c2120","bucketDomain":"tech_ai","count":2}]
crossPathInputCount: 4
crossPathOutputCount: 2
kenlmInputCount: 2
CrossPath Input == Assembly total: YES (4 vs 4)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d156

<a id="case-d156"></a>

### Case 基础信息

```text
Case ID: d156
Raw Text: 会上提到候选生成链路要加监控，上线计划文档我下午更新一版。
Path Count: 2
Bucket Count: 2
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `a4c0876153861a0089493877032bd3ee43b5520178506c0cdfc830637f46a8ea`

Bucket: `tech_ai` (`p0_b0`)

Assembly Sentences:

1.

```text
会上提到候选生成链路要加监控，上线计划文档我下午更新一版。
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 12

#### Path: `53fa80de77688323aeb8193f42739986f77dbdf76c39a3718b63b712cb31c9ed`

Bucket: `tech_ai` (`p1_b0`)

Assembly Sentences:

1.

```text
会上提到候选生成链路要加监控，上线计划文档我下午更新一版。
```

- sentenceId: `p1_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 9.219999999999999

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 2

1.

```text
text: 会上提到候选生成链路要加监控，上线计划文档我下午更新一版。
pathId: a4c0876153861a0089493877032bd3ee43b5520178506c0cdfc830637f46a8ea
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 会上提到候选生成链路要加监控，上线计划文档我下午更新一版。
pathId: 53fa80de77688323aeb8193f42739986f77dbdf76c39a3718b63b712cb31c9ed
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 会上提到候选生成链路要加监控，上线计划文档我下午更新一版。
keptFromPath: a4c0876153861a0089493877032bd3ee43b5520178506c0cdfc830637f46a8ea
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

```text
Dropped Text: 会上提到候选生成链路要加监控，上线计划文档我下午更新一版。
Source Sentence: p1_b0_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 会上提到候选生成链路要加监控，上线计划文档我下午更新一版。
```

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
会上提到候选生成链路要加监控，上线计划文档我下午更新一版。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"a4c0876153861a0089493877032bd3ee43b5520178506c0cdfc830637f46a8ea","bucketDomain":"tech_ai","count":1},{"pathId":"53fa80de77688323aeb8193f42739986f77dbdf76c39a3718b63b712cb31c9ed","bucketDomain":"tech_ai","count":1}]
crossPathInputCount: 2
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (2 vs 2)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d157

<a id="case-d157"></a>

### Case 基础信息

```text
Case ID: d157
Raw Text: 您好，我订单显示已发货但物流三天没更新，能帮我查一下吗？
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `a0969349bce8ca48e5d13d7fac132d601e3919ee4e38c73a4763efa2a626b088`

Bucket: `food_order` (`p0_b0`)

Assembly Sentences:

1.

```text
您好，我订单显示已发货但物流三天没更新，能帮我查一下吗？
```

- sentenceId: `p0_b0_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.4

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 您好，我订单显示已发货但物流三天没更新，能帮我查一下吗？
pathId: a0969349bce8ca48e5d13d7fac132d601e3919ee4e38c73a4763efa2a626b088
bucketDomain: food_order
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 您好，我订单显示已发货但物流三天没更新，能帮我查一下吗？
keptFromPath: a0969349bce8ca48e5d13d7fac132d601e3919ee4e38c73a4763efa2a626b088
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
您好，我订单显示已发货但物流三天没更新，能帮我查一下吗？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"a0969349bce8ca48e5d13d7fac132d601e3919ee4e38c73a4763efa2a626b088","bucketDomain":"food_order","count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d158

<a id="case-d158"></a>

### Case 基础信息

```text
Case ID: d158
Raw Text: 想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。
Path Count: 1
Bucket Count: 4
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `3827924af8b5fc1e5dcc9c033f608a7c7a11790e401302ab152418017fcb5359`

Bucket: `coffee` (`p0_b0`)

Assembly Sentences:

1.

```text
想改一下收货低脂，还来得及吗？麻烦尽快处理，谢谢。
```

- sentenceId: `p0_b0_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

2.

```text
想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。
```

- sentenceId: `p0_b0_s1`
- category: `RAW_ORIGINAL`
- assemblyRank: 2
- assemblyScore: 0

#### Path: `3827924af8b5fc1e5dcc9c033f608a7c7a11790e401302ab152418017fcb5359`

Bucket: `food_order` (`p0_b1`)

Assembly Sentences:

1.

```text
想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。
```

- sentenceId: `p0_b1_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

#### Path: `3827924af8b5fc1e5dcc9c033f608a7c7a11790e401302ab152418017fcb5359`

Bucket: `milk_tea` (`p0_b2`)

Assembly Sentences:

1.

```text
想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。
```

- sentenceId: `p0_b2_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

#### Path: `3827924af8b5fc1e5dcc9c033f608a7c7a11790e401302ab152418017fcb5359`

Bucket: `tourism_route` (`p0_b3`)

Assembly Sentences:

1.

```text
想改一下收货地质，还来得及吗？麻烦尽快处理，谢谢。
```

- sentenceId: `p0_b3_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

2.

```text
想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。
```

- sentenceId: `p0_b3_s1`
- category: `RAW_ORIGINAL`
- assemblyRank: 2
- assemblyScore: 0

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 6

1.

```text
text: 想改一下收货低脂，还来得及吗？麻烦尽快处理，谢谢。
pathId: 3827924af8b5fc1e5dcc9c033f608a7c7a11790e401302ab152418017fcb5359
bucketDomain: coffee
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。
pathId: 3827924af8b5fc1e5dcc9c033f608a7c7a11790e401302ab152418017fcb5359
bucketDomain: coffee
sourceSentenceId: p0_b0_s1
```

3.

```text
text: 想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。
pathId: 3827924af8b5fc1e5dcc9c033f608a7c7a11790e401302ab152418017fcb5359
bucketDomain: food_order
sourceSentenceId: p0_b1_s0
```

4.

```text
text: 想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。
pathId: 3827924af8b5fc1e5dcc9c033f608a7c7a11790e401302ab152418017fcb5359
bucketDomain: milk_tea
sourceSentenceId: p0_b2_s0
```

5.

```text
text: 想改一下收货地质，还来得及吗？麻烦尽快处理，谢谢。
pathId: 3827924af8b5fc1e5dcc9c033f608a7c7a11790e401302ab152418017fcb5359
bucketDomain: tourism_route
sourceSentenceId: p0_b3_s0
```

6.

```text
text: 想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。
pathId: 3827924af8b5fc1e5dcc9c033f608a7c7a11790e401302ab152418017fcb5359
bucketDomain: tourism_route
sourceSentenceId: p0_b3_s1
```

### D. CrossPath Output

Count: 3

1.

```text
text: 想改一下收货低脂，还来得及吗？麻烦尽快处理，谢谢。
keptFromPath: 3827924af8b5fc1e5dcc9c033f608a7c7a11790e401302ab152418017fcb5359
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。
keptFromPath: 3827924af8b5fc1e5dcc9c033f608a7c7a11790e401302ab152418017fcb5359
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s1
```

3.

```text
text: 想改一下收货地质，还来得及吗？麻烦尽快处理，谢谢。
keptFromPath: 3827924af8b5fc1e5dcc9c033f608a7c7a11790e401302ab152418017fcb5359
keptFromBucket: p0_b3
sourceSentenceId: p0_b3_s0
```

### E. CrossPath 删除项

```text
Dropped Text: 想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。
Source Sentence: p0_b1_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。
```

```text
Dropped Text: 想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。
Source Sentence: p0_b2_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。
```

```text
Dropped Text: 想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。
Source Sentence: p0_b3_s1
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。
```

### F. KenLM Input

KenLM Input Count: 3

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
想改一下收货低脂，还来得及吗？麻烦尽快处理，谢谢。
```

2.

```text
想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。
```

3.

```text
想改一下收货地质，还来得及吗？麻烦尽快处理，谢谢。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"3827924af8b5fc1e5dcc9c033f608a7c7a11790e401302ab152418017fcb5359","bucketDomain":"coffee","count":2},{"pathId":"3827924af8b5fc1e5dcc9c033f608a7c7a11790e401302ab152418017fcb5359","bucketDomain":"food_order","count":1},{"pathId":"3827924af8b5fc1e5dcc9c033f608a7c7a11790e401302ab152418017fcb5359","bucketDomain":"milk_tea","count":1},{"pathId":"3827924af8b5fc1e5dcc9c033f608a7c7a11790e401302ab152418017fcb5359","bucketDomain":"tourism_route","count":2}]
crossPathInputCount: 6
crossPathOutputCount: 3
kenlmInputCount: 3
CrossPath Input == Assembly total: YES (6 vs 6)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d159

<a id="case-d159"></a>

### Case 基础信息

```text
Case ID: d159
Raw Text: 发票抬头开错了，能重新开具电子发票吗？
Path Count: 1
Bucket Count: 2
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `b40add9c18b994f3214720b91c9e39c1ec9a08acd66742f9b51723c5d1d357f6`

Bucket: `food_order` (`p0_b0`)

Assembly Sentences:

1.

```text
发票抬头开错了，能重新开具电子发票吗？
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 4.7

#### Path: `b40add9c18b994f3214720b91c9e39c1ec9a08acd66742f9b51723c5d1d357f6`

Bucket: `tourism_hotel` (`p0_b1`)

Assembly Sentences:

1.

```text
发票抬头开错了，能重新开具电子发票吗？
```

- sentenceId: `p0_b1_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 4.7

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 2

1.

```text
text: 发票抬头开错了，能重新开具电子发票吗？
pathId: b40add9c18b994f3214720b91c9e39c1ec9a08acd66742f9b51723c5d1d357f6
bucketDomain: food_order
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 发票抬头开错了，能重新开具电子发票吗？
pathId: b40add9c18b994f3214720b91c9e39c1ec9a08acd66742f9b51723c5d1d357f6
bucketDomain: tourism_hotel
sourceSentenceId: p0_b1_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 发票抬头开错了，能重新开具电子发票吗？
keptFromPath: b40add9c18b994f3214720b91c9e39c1ec9a08acd66742f9b51723c5d1d357f6
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

```text
Dropped Text: 发票抬头开错了，能重新开具电子发票吗？
Source Sentence: p0_b1_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 发票抬头开错了，能重新开具电子发票吗？
```

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
发票抬头开错了，能重新开具电子发票吗？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"b40add9c18b994f3214720b91c9e39c1ec9a08acd66742f9b51723c5d1d357f6","bucketDomain":"food_order","count":1},{"pathId":"b40add9c18b994f3214720b91c9e39c1ec9a08acd66742f9b51723c5d1d357f6","bucketDomain":"tourism_hotel","count":1}]
crossPathInputCount: 2
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (2 vs 2)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d160

<a id="case-d160"></a>

### Case 基础信息

```text
Case ID: d160
Raw Text: 请简单介绍一下你上一段项目里负责的核心模块和难点。
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `c33b910447acae81d7f3fcaec0bc8df744a479211aa365008054f6f07e77e730`

Bucket: `tech_ai` (`p0_b0`)

Assembly Sentences:

1.

```text
请简单介绍一下你上一段项目理服责的核心模块和难点。
```

- sentenceId: `p0_b0_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.04

2.

```text
请简单介绍一下你上一段项目里负责的核心模块和难点。
```

- sentenceId: `p0_b0_s1`
- category: `RAW_ORIGINAL`
- assemblyRank: 2
- assemblyScore: 0

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 2

1.

```text
text: 请简单介绍一下你上一段项目理服责的核心模块和难点。
pathId: c33b910447acae81d7f3fcaec0bc8df744a479211aa365008054f6f07e77e730
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 请简单介绍一下你上一段项目里负责的核心模块和难点。
pathId: c33b910447acae81d7f3fcaec0bc8df744a479211aa365008054f6f07e77e730
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s1
```

### D. CrossPath Output

Count: 2

1.

```text
text: 请简单介绍一下你上一段项目理服责的核心模块和难点。
keptFromPath: c33b910447acae81d7f3fcaec0bc8df744a479211aa365008054f6f07e77e730
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 请简单介绍一下你上一段项目里负责的核心模块和难点。
keptFromPath: c33b910447acae81d7f3fcaec0bc8df744a479211aa365008054f6f07e77e730
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s1
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 2

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
请简单介绍一下你上一段项目理服责的核心模块和难点。
```

2.

```text
请简单介绍一下你上一段项目里负责的核心模块和难点。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"c33b910447acae81d7f3fcaec0bc8df744a479211aa365008054f6f07e77e730","bucketDomain":"tech_ai","count":2}]
crossPathInputCount: 2
crossPathOutputCount: 2
kenlmInputCount: 2
CrossPath Input == Assembly total: YES (2 vs 2)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d161

<a id="case-d161"></a>

### Case 基础信息

```text
Case ID: d161
Raw Text: 你如何看待跨团队协作？遇到需求变更一般怎么处理？
Path Count: 1
Bucket Count: 2
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `b12f3cf0aef86ec71cf7ca92007b4ed2b271c07b66773e2211895464537dd8e6`

Bucket: `food_order` (`p0_b0`)

Assembly Sentences:

1.

```text
你如何看待跨团队协作？遇到需求变更一般怎么处理？
```

- sentenceId: `p0_b0_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

#### Path: `b12f3cf0aef86ec71cf7ca92007b4ed2b271c07b66773e2211895464537dd8e6`

Bucket: `milk_tea` (`p0_b1`)

Assembly Sentences:

1.

```text
你如何看待跨团队协作？遇到需求变更一般怎么处理？
```

- sentenceId: `p0_b1_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 2

1.

```text
text: 你如何看待跨团队协作？遇到需求变更一般怎么处理？
pathId: b12f3cf0aef86ec71cf7ca92007b4ed2b271c07b66773e2211895464537dd8e6
bucketDomain: food_order
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 你如何看待跨团队协作？遇到需求变更一般怎么处理？
pathId: b12f3cf0aef86ec71cf7ca92007b4ed2b271c07b66773e2211895464537dd8e6
bucketDomain: milk_tea
sourceSentenceId: p0_b1_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 你如何看待跨团队协作？遇到需求变更一般怎么处理？
keptFromPath: b12f3cf0aef86ec71cf7ca92007b4ed2b271c07b66773e2211895464537dd8e6
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

```text
Dropped Text: 你如何看待跨团队协作？遇到需求变更一般怎么处理？
Source Sentence: p0_b1_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 你如何看待跨团队协作？遇到需求变更一般怎么处理？
```

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
你如何看待跨团队协作？遇到需求变更一般怎么处理？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"b12f3cf0aef86ec71cf7ca92007b4ed2b271c07b66773e2211895464537dd8e6","bucketDomain":"food_order","count":1},{"pathId":"b12f3cf0aef86ec71cf7ca92007b4ed2b271c07b66773e2211895464537dd8e6","bucketDomain":"milk_tea","count":1}]
crossPathInputCount: 2
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (2 vs 2)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d162

<a id="case-d162"></a>

### Case 基础信息

```text
Case ID: d162
Raw Text: 期望薪资这块我们可以再沟通，你最快什么时候能入职？
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `84f36989f411316b0fbb31d26ab28fc8fd7f7901712c880018c446be02dc23a0`

Bucket: `medical` (`p0_b0`)

Assembly Sentences:

1.

```text
期望薪资这块我们科医再沟通，你最快什么时候能入职？
```

- sentenceId: `p0_b0_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

2.

```text
期望薪资这块我们可以再沟通，你最快什么时候能入职？
```

- sentenceId: `p0_b0_s1`
- category: `RAW_ORIGINAL`
- assemblyRank: 2
- assemblyScore: 0

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 2

1.

```text
text: 期望薪资这块我们科医再沟通，你最快什么时候能入职？
pathId: 84f36989f411316b0fbb31d26ab28fc8fd7f7901712c880018c446be02dc23a0
bucketDomain: medical
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 期望薪资这块我们可以再沟通，你最快什么时候能入职？
pathId: 84f36989f411316b0fbb31d26ab28fc8fd7f7901712c880018c446be02dc23a0
bucketDomain: medical
sourceSentenceId: p0_b0_s1
```

### D. CrossPath Output

Count: 2

1.

```text
text: 期望薪资这块我们科医再沟通，你最快什么时候能入职？
keptFromPath: 84f36989f411316b0fbb31d26ab28fc8fd7f7901712c880018c446be02dc23a0
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 期望薪资这块我们可以再沟通，你最快什么时候能入职？
keptFromPath: 84f36989f411316b0fbb31d26ab28fc8fd7f7901712c880018c446be02dc23a0
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s1
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 2

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
期望薪资这块我们科医再沟通，你最快什么时候能入职？
```

2.

```text
期望薪资这块我们可以再沟通，你最快什么时候能入职？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"84f36989f411316b0fbb31d26ab28fc8fd7f7901712c880018c446be02dc23a0","bucketDomain":"medical","count":2}]
crossPathInputCount: 2
crossPathOutputCount: 2
kenlmInputCount: 2
CrossPath Input == Assembly total: YES (2 vs 2)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d163

<a id="case-d163"></a>

### Case 基础信息

```text
Case ID: d163
Raw Text: 老师，这道题的解题步骤能不能再讲一遍？我没听懂第二点。
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `1c409d8f6131faa9fc20d6ca3c8911bc863ca7db5fb5df65e6fd14d73cb58462`

Bucket: `null` (`p0_b0`)

Assembly Sentences:

1.

```text
老师，这道题的解题步骤能不能再讲一遍？我没听懂第二点。
```

- sentenceId: `p0_b0_s0`
- category: `RAW_ORIGINAL`
- assemblyRank: 1
- assemblyScore: 0

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 老师，这道题的解题步骤能不能再讲一遍？我没听懂第二点。
pathId: 1c409d8f6131faa9fc20d6ca3c8911bc863ca7db5fb5df65e6fd14d73cb58462
bucketDomain: null
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 老师，这道题的解题步骤能不能再讲一遍？我没听懂第二点。
keptFromPath: 1c409d8f6131faa9fc20d6ca3c8911bc863ca7db5fb5df65e6fd14d73cb58462
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
老师，这道题的解题步骤能不能再讲一遍？我没听懂第二点。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"1c409d8f6131faa9fc20d6ca3c8911bc863ca7db5fb5df65e6fd14d73cb58462","bucketDomain":null,"count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d164

<a id="case-d164"></a>

### Case 基础信息

```text
Case ID: d164
Raw Text: 作业是下周一下午交吗？可以电子版提交吗？
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `cfa8bb1a264544e0081de7f7df6ddab5a810d642a10eb16e14969796fff1dc05`

Bucket: `medical` (`p0_b0`)

Assembly Sentences:

1.

```text
作液室下周一下午交吗？科医电子版提交吗？
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 4.366

2.

```text
作业是下周一下午交吗？科医电子版提交吗？
```

- sentenceId: `p0_b0_s1`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 2
- assemblyScore: 2.36

3.

```text
作液室下周一下午交吗？可以电子版提交吗？
```

- sentenceId: `p0_b0_s2`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 3
- assemblyScore: 2.006

4.

```text
作业是下周一下午交吗？可以电子版提交吗？
```

- sentenceId: `p0_b0_s3`
- category: `RAW_ORIGINAL`
- assemblyRank: 4
- assemblyScore: 0

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 4

1.

```text
text: 作液室下周一下午交吗？科医电子版提交吗？
pathId: cfa8bb1a264544e0081de7f7df6ddab5a810d642a10eb16e14969796fff1dc05
bucketDomain: medical
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 作业是下周一下午交吗？科医电子版提交吗？
pathId: cfa8bb1a264544e0081de7f7df6ddab5a810d642a10eb16e14969796fff1dc05
bucketDomain: medical
sourceSentenceId: p0_b0_s1
```

3.

```text
text: 作液室下周一下午交吗？可以电子版提交吗？
pathId: cfa8bb1a264544e0081de7f7df6ddab5a810d642a10eb16e14969796fff1dc05
bucketDomain: medical
sourceSentenceId: p0_b0_s2
```

4.

```text
text: 作业是下周一下午交吗？可以电子版提交吗？
pathId: cfa8bb1a264544e0081de7f7df6ddab5a810d642a10eb16e14969796fff1dc05
bucketDomain: medical
sourceSentenceId: p0_b0_s3
```

### D. CrossPath Output

Count: 4

1.

```text
text: 作液室下周一下午交吗？科医电子版提交吗？
keptFromPath: cfa8bb1a264544e0081de7f7df6ddab5a810d642a10eb16e14969796fff1dc05
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 作业是下周一下午交吗？科医电子版提交吗？
keptFromPath: cfa8bb1a264544e0081de7f7df6ddab5a810d642a10eb16e14969796fff1dc05
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s1
```

3.

```text
text: 作液室下周一下午交吗？可以电子版提交吗？
keptFromPath: cfa8bb1a264544e0081de7f7df6ddab5a810d642a10eb16e14969796fff1dc05
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s2
```

4.

```text
text: 作业是下周一下午交吗？可以电子版提交吗？
keptFromPath: cfa8bb1a264544e0081de7f7df6ddab5a810d642a10eb16e14969796fff1dc05
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s3
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 4

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
作液室下周一下午交吗？科医电子版提交吗？
```

2.

```text
作业是下周一下午交吗？科医电子版提交吗？
```

3.

```text
作液室下周一下午交吗？可以电子版提交吗？
```

4.

```text
作业是下周一下午交吗？可以电子版提交吗？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"cfa8bb1a264544e0081de7f7df6ddab5a810d642a10eb16e14969796fff1dc05","bucketDomain":"medical","count":4}]
crossPathInputCount: 4
crossPathOutputCount: 4
kenlmInputCount: 4
CrossPath Input == Assembly total: YES (4 vs 4)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d165

<a id="case-d165"></a>

### Case 基础信息

```text
Case ID: d165
Raw Text: 请问这门课期末是开卷还是闭卷？重点会划吗？
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `406369b69d20013642b051317595e528c850c41df8ca93640fce6b7e57486447`

Bucket: `tourism_hotel` (`p0_b0`)

Assembly Sentences:

1.

```text
请问这门课期末是开卷还是闭卷？钟点会划吗？
```

- sentenceId: `p0_b0_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

2.

```text
请问这门课期末是开卷还是闭卷？重点会划吗？
```

- sentenceId: `p0_b0_s1`
- category: `RAW_ORIGINAL`
- assemblyRank: 2
- assemblyScore: 0

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 2

1.

```text
text: 请问这门课期末是开卷还是闭卷？钟点会划吗？
pathId: 406369b69d20013642b051317595e528c850c41df8ca93640fce6b7e57486447
bucketDomain: tourism_hotel
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 请问这门课期末是开卷还是闭卷？重点会划吗？
pathId: 406369b69d20013642b051317595e528c850c41df8ca93640fce6b7e57486447
bucketDomain: tourism_hotel
sourceSentenceId: p0_b0_s1
```

### D. CrossPath Output

Count: 2

1.

```text
text: 请问这门课期末是开卷还是闭卷？钟点会划吗？
keptFromPath: 406369b69d20013642b051317595e528c850c41df8ca93640fce6b7e57486447
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 请问这门课期末是开卷还是闭卷？重点会划吗？
keptFromPath: 406369b69d20013642b051317595e528c850c41df8ca93640fce6b7e57486447
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s1
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 2

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
请问这门课期末是开卷还是闭卷？钟点会划吗？
```

2.

```text
请问这门课期末是开卷还是闭卷？重点会划吗？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"406369b69d20013642b051317595e528c850c41df8ca93640fce6b7e57486447","bucketDomain":"tourism_hotel","count":2}]
crossPathInputCount: 2
crossPathOutputCount: 2
kenlmInputCount: 2
CrossPath Input == Assembly total: YES (2 vs 2)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d166

<a id="case-d166"></a>

### Case 基础信息

```text
Case ID: d166
Raw Text: 我预订的是大床房，能安排安静一点的楼层吗？
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `0f1b0bab3dbe84cb6e062d9358983f0b8121ebf7757d2db143133f0308c372c0`

Bucket: `tourism_hotel` (`p0_b0`)

Assembly Sentences:

1.

```text
我预订的是大床房，能安排安静一点的楼层吗？
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 7.1

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 我预订的是大床房，能安排安静一点的楼层吗？
pathId: 0f1b0bab3dbe84cb6e062d9358983f0b8121ebf7757d2db143133f0308c372c0
bucketDomain: tourism_hotel
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 我预订的是大床房，能安排安静一点的楼层吗？
keptFromPath: 0f1b0bab3dbe84cb6e062d9358983f0b8121ebf7757d2db143133f0308c372c0
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
我预订的是大床房，能安排安静一点的楼层吗？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"0f1b0bab3dbe84cb6e062d9358983f0b8121ebf7757d2db143133f0308c372c0","bucketDomain":"tourism_hotel","count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d167

<a id="case-d167"></a>

### Case 基础信息

```text
Case ID: d167
Raw Text: 早餐几点开始？退房可以延迟到下午两点吗？
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `03e1aa8d5789d78feb7b3931f6588e562f01a298a0136c39d7b213cfeacb5a13`

Bucket: `tourism_hotel` (`p0_b0`)

Assembly Sentences:

1.

```text
早餐几点开始？退房可以延迟到下午两点吗？
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 4.4

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 早餐几点开始？退房可以延迟到下午两点吗？
pathId: 03e1aa8d5789d78feb7b3931f6588e562f01a298a0136c39d7b213cfeacb5a13
bucketDomain: tourism_hotel
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 早餐几点开始？退房可以延迟到下午两点吗？
keptFromPath: 03e1aa8d5789d78feb7b3931f6588e562f01a298a0136c39d7b213cfeacb5a13
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
早餐几点开始？退房可以延迟到下午两点吗？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"03e1aa8d5789d78feb7b3931f6588e562f01a298a0136c39d7b213cfeacb5a13","bucketDomain":"tourism_hotel","count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d168

<a id="case-d168"></a>

### Case 基础信息

```text
Case ID: d168
Raw Text: 房间空调不太制冷，能派人上来看一下吗？
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `6cadd25d36a390cae4a08810f3d8c2773753c3c6d3c1f3c07298a83ac138f50a`

Bucket: `tech_ai` (`p0_b0`)

Assembly Sentences:

1.

```text
房监控调不太制冷，能派人上来看一下吗？
```

- sentenceId: `p0_b0_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

2.

```text
房间空调不太制冷，能派人上来看一下吗？
```

- sentenceId: `p0_b0_s1`
- category: `RAW_ORIGINAL`
- assemblyRank: 2
- assemblyScore: 0

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 2

1.

```text
text: 房监控调不太制冷，能派人上来看一下吗？
pathId: 6cadd25d36a390cae4a08810f3d8c2773753c3c6d3c1f3c07298a83ac138f50a
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 房间空调不太制冷，能派人上来看一下吗？
pathId: 6cadd25d36a390cae4a08810f3d8c2773753c3c6d3c1f3c07298a83ac138f50a
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s1
```

### D. CrossPath Output

Count: 2

1.

```text
text: 房监控调不太制冷，能派人上来看一下吗？
keptFromPath: 6cadd25d36a390cae4a08810f3d8c2773753c3c6d3c1f3c07298a83ac138f50a
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 房间空调不太制冷，能派人上来看一下吗？
keptFromPath: 6cadd25d36a390cae4a08810f3d8c2773753c3c6d3c1f3c07298a83ac138f50a
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s1
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 2

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
房监控调不太制冷，能派人上来看一下吗？
```

2.

```text
房间空调不太制冷，能派人上来看一下吗？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"6cadd25d36a390cae4a08810f3d8c2773753c3c6d3c1f3c07298a83ac138f50a","bucketDomain":"tech_ai","count":2}]
crossPathInputCount: 2
crossPathOutputCount: 2
kenlmInputCount: 2
CrossPath Input == Assembly total: YES (2 vs 2)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d169

<a id="case-d169"></a>

### Case 基础信息

```text
Case ID: d169
Raw Text: 我想开通短信提醒，需要带什么证件？
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `c14d5f5751216d8790ba33830572c5c91e9e6e8c1beabcfbb3e78f12a3374199`

Bucket: `tourism_route` (`p0_b0`)

Assembly Sentences:

1.

```text
我想开通短信提醒，需要带什么证件？
```

- sentenceId: `p0_b0_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 我想开通短信提醒，需要带什么证件？
pathId: c14d5f5751216d8790ba33830572c5c91e9e6e8c1beabcfbb3e78f12a3374199
bucketDomain: tourism_route
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 我想开通短信提醒，需要带什么证件？
keptFromPath: c14d5f5751216d8790ba33830572c5c91e9e6e8c1beabcfbb3e78f12a3374199
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
我想开通短信提醒，需要带什么证件？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"c14d5f5751216d8790ba33830572c5c91e9e6e8c1beabcfbb3e78f12a3374199","bucketDomain":"tourism_route","count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d170

<a id="case-d170"></a>

### Case 基础信息

```text
Case ID: d170
Raw Text: 这笔转账显示处理中，大概多久能到账？
Path Count: 1
Bucket Count: 2
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `2913b934f41b6799cf1415142f4c210ceef85a8cc8572ca4ea9a0734a8e0e55b`

Bucket: `food_order` (`p0_b0`)

Assembly Sentences:

1.

```text
这笔转账显示处理中，大概多久能到账？
```

- sentenceId: `p0_b0_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

#### Path: `2913b934f41b6799cf1415142f4c210ceef85a8cc8572ca4ea9a0734a8e0e55b`

Bucket: `milk_tea` (`p0_b1`)

Assembly Sentences:

1.

```text
这笔转账显示处理中，大概多久能到账？
```

- sentenceId: `p0_b1_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 2

1.

```text
text: 这笔转账显示处理中，大概多久能到账？
pathId: 2913b934f41b6799cf1415142f4c210ceef85a8cc8572ca4ea9a0734a8e0e55b
bucketDomain: food_order
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 这笔转账显示处理中，大概多久能到账？
pathId: 2913b934f41b6799cf1415142f4c210ceef85a8cc8572ca4ea9a0734a8e0e55b
bucketDomain: milk_tea
sourceSentenceId: p0_b1_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 这笔转账显示处理中，大概多久能到账？
keptFromPath: 2913b934f41b6799cf1415142f4c210ceef85a8cc8572ca4ea9a0734a8e0e55b
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

```text
Dropped Text: 这笔转账显示处理中，大概多久能到账？
Source Sentence: p0_b1_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 这笔转账显示处理中，大概多久能到账？
```

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
这笔转账显示处理中，大概多久能到账？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"2913b934f41b6799cf1415142f4c210ceef85a8cc8572ca4ea9a0734a8e0e55b","bucketDomain":"food_order","count":1},{"pathId":"2913b934f41b6799cf1415142f4c210ceef85a8cc8572ca4ea9a0734a8e0e55b","bucketDomain":"milk_tea","count":1}]
crossPathInputCount: 2
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (2 vs 2)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d171

<a id="case-d171"></a>

### Case 基础信息

```text
Case ID: d171
Raw Text: 请问理财产品的风险等级在哪里查看？
Path Count: 1
Bucket Count: 2
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `6bcff49b0914307d218e0a1eff428d5f84a8e0578634047e841739527dddedbb`

Bucket: `tech_ai` (`p0_b0`)

Assembly Sentences:

1.

```text
请问理财产品的风险等级在哪里查看？
```

- sentenceId: `p0_b0_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

#### Path: `6bcff49b0914307d218e0a1eff428d5f84a8e0578634047e841739527dddedbb`

Bucket: `tourism_pickup` (`p0_b1`)

Assembly Sentences:

1.

```text
请问理财产品的风险登机在哪里查看？
```

- sentenceId: `p0_b1_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

2.

```text
请问理财产品的风险等级在哪里查看？
```

- sentenceId: `p0_b1_s1`
- category: `RAW_ORIGINAL`
- assemblyRank: 2
- assemblyScore: 0

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 3

1.

```text
text: 请问理财产品的风险等级在哪里查看？
pathId: 6bcff49b0914307d218e0a1eff428d5f84a8e0578634047e841739527dddedbb
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 请问理财产品的风险登机在哪里查看？
pathId: 6bcff49b0914307d218e0a1eff428d5f84a8e0578634047e841739527dddedbb
bucketDomain: tourism_pickup
sourceSentenceId: p0_b1_s0
```

3.

```text
text: 请问理财产品的风险等级在哪里查看？
pathId: 6bcff49b0914307d218e0a1eff428d5f84a8e0578634047e841739527dddedbb
bucketDomain: tourism_pickup
sourceSentenceId: p0_b1_s1
```

### D. CrossPath Output

Count: 2

1.

```text
text: 请问理财产品的风险等级在哪里查看？
keptFromPath: 6bcff49b0914307d218e0a1eff428d5f84a8e0578634047e841739527dddedbb
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 请问理财产品的风险登机在哪里查看？
keptFromPath: 6bcff49b0914307d218e0a1eff428d5f84a8e0578634047e841739527dddedbb
keptFromBucket: p0_b1
sourceSentenceId: p0_b1_s0
```

### E. CrossPath 删除项

```text
Dropped Text: 请问理财产品的风险等级在哪里查看？
Source Sentence: p0_b1_s1
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 请问理财产品的风险等级在哪里查看？
```

### F. KenLM Input

KenLM Input Count: 2

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
请问理财产品的风险等级在哪里查看？
```

2.

```text
请问理财产品的风险登机在哪里查看？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"6bcff49b0914307d218e0a1eff428d5f84a8e0578634047e841739527dddedbb","bucketDomain":"tech_ai","count":1},{"pathId":"6bcff49b0914307d218e0a1eff428d5f84a8e0578634047e841739527dddedbb","bucketDomain":"tourism_pickup","count":2}]
crossPathInputCount: 3
crossPathOutputCount: 2
kenlmInputCount: 2
CrossPath Input == Assembly total: YES (3 vs 3)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d172

<a id="case-d172"></a>

### Case 基础信息

```text
Case ID: d172
Raw Text: 两位，靠窗有位置吗？不要香菜，微辣就行。
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `8b2d9e6e9ba6152b4bfe03dd11061b9ad65e8ae7988e4c6ba683146fc5832aad`

Bucket: `food_order` (`p0_b0`)

Assembly Sentences:

1.

```text
两位，靠窗有位置吗？不要香菜，微辣就行。
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 4.390000000000001

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 两位，靠窗有位置吗？不要香菜，微辣就行。
pathId: 8b2d9e6e9ba6152b4bfe03dd11061b9ad65e8ae7988e4c6ba683146fc5832aad
bucketDomain: food_order
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 两位，靠窗有位置吗？不要香菜，微辣就行。
keptFromPath: 8b2d9e6e9ba6152b4bfe03dd11061b9ad65e8ae7988e4c6ba683146fc5832aad
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
两位，靠窗有位置吗？不要香菜，微辣就行。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"8b2d9e6e9ba6152b4bfe03dd11061b9ad65e8ae7988e4c6ba683146fc5832aad","bucketDomain":"food_order","count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d173

<a id="case-d173"></a>

### Case 基础信息

```text
Case ID: d173
Raw Text: 这道菜大概要等多久？我们先点一份凉菜和一壶茶。
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `37367286bf78ef457c58421ac1cc51772b81498372ff6046875c912bacb0a3ca`

Bucket: `null` (`p0_b0`)

Assembly Sentences:

1.

```text
这道菜大概要等多久？我们先点一份凉菜和一壶茶。
```

- sentenceId: `p0_b0_s0`
- category: `RAW_ORIGINAL`
- assemblyRank: 1
- assemblyScore: 0

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 这道菜大概要等多久？我们先点一份凉菜和一壶茶。
pathId: 37367286bf78ef457c58421ac1cc51772b81498372ff6046875c912bacb0a3ca
bucketDomain: null
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 这道菜大概要等多久？我们先点一份凉菜和一壶茶。
keptFromPath: 37367286bf78ef457c58421ac1cc51772b81498372ff6046875c912bacb0a3ca
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
这道菜大概要等多久？我们先点一份凉菜和一壶茶。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"37367286bf78ef457c58421ac1cc51772b81498372ff6046875c912bacb0a3ca","bucketDomain":null,"count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d174

<a id="case-d174"></a>

### Case 基础信息

```text
Case ID: d174
Raw Text: 可以打包吗？顺便结一下账，能扫码支付吗？
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `91229dfa9d5be6b38b9f08e170cff33f5d2bdef0d0cb6c73fdb7cf999d70ca76`

Bucket: `coffee` (`p0_b0`)

Assembly Sentences:

1.

```text
可以打包吗？顺便结一下账，能扫码支付吗？
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 4.356

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 可以打包吗？顺便结一下账，能扫码支付吗？
pathId: 91229dfa9d5be6b38b9f08e170cff33f5d2bdef0d0cb6c73fdb7cf999d70ca76
bucketDomain: coffee
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 可以打包吗？顺便结一下账，能扫码支付吗？
keptFromPath: 91229dfa9d5be6b38b9f08e170cff33f5d2bdef0d0cb6c73fdb7cf999d70ca76
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
可以打包吗？顺便结一下账，能扫码支付吗？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"91229dfa9d5be6b38b9f08e170cff33f5d2bdef0d0cb6c73fdb7cf999d70ca76","bucketDomain":"coffee","count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d175

<a id="case-d175"></a>

### Case 基础信息

```text
Case ID: d175
Raw Text: 私教课还剩几次？能帮我约明天晚上七点吗？
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `973b1af9a783aa7707c48f38b9fa56cd157195dbfa41409fe89c426ae484696e`

Bucket: `null` (`p0_b0`)

Assembly Sentences:

1.

```text
私教课还剩几次？能帮我约明天晚上七点吗？
```

- sentenceId: `p0_b0_s0`
- category: `RAW_ORIGINAL`
- assemblyRank: 1
- assemblyScore: 0

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 私教课还剩几次？能帮我约明天晚上七点吗？
pathId: 973b1af9a783aa7707c48f38b9fa56cd157195dbfa41409fe89c426ae484696e
bucketDomain: null
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 私教课还剩几次？能帮我约明天晚上七点吗？
keptFromPath: 973b1af9a783aa7707c48f38b9fa56cd157195dbfa41409fe89c426ae484696e
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
私教课还剩几次？能帮我约明天晚上七点吗？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"973b1af9a783aa7707c48f38b9fa56cd157195dbfa41409fe89c426ae484696e","bucketDomain":null,"count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d176

<a id="case-d176"></a>

### Case 基础信息

```text
Case ID: d176
Raw Text: 更衣室柜子钥匙找不到了，前台能帮忙开一下吗？
Path Count: 1
Bucket Count: 3
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `3b518d0b2df5f529d68743f21657b328629df6e85a64c6f34b152211b6dc2f06`

Bucket: `medical` (`p0_b0`)

Assembly Sentences:

1.

```text
更医师柜子钥匙找不到了，前台能帮忙开一下吗？
```

- sentenceId: `p0_b0_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.006

2.

```text
更衣室柜子钥匙找不到了，前台能帮忙开一下吗？
```

- sentenceId: `p0_b0_s1`
- category: `RAW_ORIGINAL`
- assemblyRank: 2
- assemblyScore: 0

#### Path: `3b518d0b2df5f529d68743f21657b328629df6e85a64c6f34b152211b6dc2f06`

Bucket: `meeting` (`p0_b1`)

Assembly Sentences:

1.

```text
更议室柜子钥匙找不到了，前台能帮忙开一下吗？
```

- sentenceId: `p0_b1_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.006

2.

```text
更衣室柜子钥匙找不到了，前台能帮忙开一下吗？
```

- sentenceId: `p0_b1_s1`
- category: `RAW_ORIGINAL`
- assemblyRank: 2
- assemblyScore: 0

#### Path: `3b518d0b2df5f529d68743f21657b328629df6e85a64c6f34b152211b6dc2f06`

Bucket: `tourism_hotel` (`p0_b2`)

Assembly Sentences:

1.

```text
更衣室柜子钥匙找不到了，前台能帮忙开一下吗？
```

- sentenceId: `p0_b2_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 5

1.

```text
text: 更医师柜子钥匙找不到了，前台能帮忙开一下吗？
pathId: 3b518d0b2df5f529d68743f21657b328629df6e85a64c6f34b152211b6dc2f06
bucketDomain: medical
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 更衣室柜子钥匙找不到了，前台能帮忙开一下吗？
pathId: 3b518d0b2df5f529d68743f21657b328629df6e85a64c6f34b152211b6dc2f06
bucketDomain: medical
sourceSentenceId: p0_b0_s1
```

3.

```text
text: 更议室柜子钥匙找不到了，前台能帮忙开一下吗？
pathId: 3b518d0b2df5f529d68743f21657b328629df6e85a64c6f34b152211b6dc2f06
bucketDomain: meeting
sourceSentenceId: p0_b1_s0
```

4.

```text
text: 更衣室柜子钥匙找不到了，前台能帮忙开一下吗？
pathId: 3b518d0b2df5f529d68743f21657b328629df6e85a64c6f34b152211b6dc2f06
bucketDomain: meeting
sourceSentenceId: p0_b1_s1
```

5.

```text
text: 更衣室柜子钥匙找不到了，前台能帮忙开一下吗？
pathId: 3b518d0b2df5f529d68743f21657b328629df6e85a64c6f34b152211b6dc2f06
bucketDomain: tourism_hotel
sourceSentenceId: p0_b2_s0
```

### D. CrossPath Output

Count: 3

1.

```text
text: 更医师柜子钥匙找不到了，前台能帮忙开一下吗？
keptFromPath: 3b518d0b2df5f529d68743f21657b328629df6e85a64c6f34b152211b6dc2f06
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 更衣室柜子钥匙找不到了，前台能帮忙开一下吗？
keptFromPath: 3b518d0b2df5f529d68743f21657b328629df6e85a64c6f34b152211b6dc2f06
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s1
```

3.

```text
text: 更议室柜子钥匙找不到了，前台能帮忙开一下吗？
keptFromPath: 3b518d0b2df5f529d68743f21657b328629df6e85a64c6f34b152211b6dc2f06
keptFromBucket: p0_b1
sourceSentenceId: p0_b1_s0
```

### E. CrossPath 删除项

```text
Dropped Text: 更衣室柜子钥匙找不到了，前台能帮忙开一下吗？
Source Sentence: p0_b1_s1
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 更衣室柜子钥匙找不到了，前台能帮忙开一下吗？
```

```text
Dropped Text: 更衣室柜子钥匙找不到了，前台能帮忙开一下吗？
Source Sentence: p0_b2_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 更衣室柜子钥匙找不到了，前台能帮忙开一下吗？
```

### F. KenLM Input

KenLM Input Count: 3

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
更医师柜子钥匙找不到了，前台能帮忙开一下吗？
```

2.

```text
更衣室柜子钥匙找不到了，前台能帮忙开一下吗？
```

3.

```text
更议室柜子钥匙找不到了，前台能帮忙开一下吗？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"3b518d0b2df5f529d68743f21657b328629df6e85a64c6f34b152211b6dc2f06","bucketDomain":"medical","count":2},{"pathId":"3b518d0b2df5f529d68743f21657b328629df6e85a64c6f34b152211b6dc2f06","bucketDomain":"meeting","count":2},{"pathId":"3b518d0b2df5f529d68743f21657b328629df6e85a64c6f34b152211b6dc2f06","bucketDomain":"tourism_hotel","count":1}]
crossPathInputCount: 5
crossPathOutputCount: 3
kenlmInputCount: 3
CrossPath Input == Assembly total: YES (5 vs 5)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d177

<a id="case-d177"></a>

### Case 基础信息

```text
Case ID: d177
Raw Text: 游泳次卡本月月底到期，续费有优惠吗？
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `a11519a0a6b805c16c3242918d0e30f13d8a99cebe7578a68fe2fabb883c6c96`

Bucket: `null` (`p0_b0`)

Assembly Sentences:

1.

```text
游泳次卡本月月底到期，续费有优惠吗？
```

- sentenceId: `p0_b0_s0`
- category: `RAW_ORIGINAL`
- assemblyRank: 1
- assemblyScore: 0

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 游泳次卡本月月底到期，续费有优惠吗？
pathId: a11519a0a6b805c16c3242918d0e30f13d8a99cebe7578a68fe2fabb883c6c96
bucketDomain: null
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 游泳次卡本月月底到期，续费有优惠吗？
keptFromPath: a11519a0a6b805c16c3242918d0e30f13d8a99cebe7578a68fe2fabb883c6c96
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
游泳次卡本月月底到期，续费有优惠吗？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"a11519a0a6b805c16c3242918d0e30f13d8a99cebe7578a68fe2fabb883c6c96","bucketDomain":null,"count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d178

<a id="case-d178"></a>

### Case 基础信息

```text
Case ID: d178
Raw Text: 我们下午讨论后选声城方案，先把候选生成的接口文档补齐。
Path Count: 2
Bucket Count: 2
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `86bbdea09331c4feb5a8c0ad9881f21444a7ba7ae866222c8b4c24b3fba4ce42`

Bucket: `tech_ai` (`p0_b0`)

Assembly Sentences:

1.

```text
我们下午讨论候选声城方案，先把候选生成的接口文档补齐。
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 9.66

2.

```text
我们下午讨论后选声城方案，先把候选生成的接口文档补齐。
```

- sentenceId: `p0_b0_s1`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 2
- assemblyScore: 7.24

#### Path: `eefbde0a8d0d9a4bd706030008aee9a3ba8aef276637bb189b65c4365acf56c9`

Bucket: `tech_ai` (`p1_b0`)

Assembly Sentences:

1.

```text
我们下午讨论候选声城方案，先把候选生成的接口文档补齐。
```

- sentenceId: `p1_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 6.88

2.

```text
我们下午讨论后选声城方案，先把候选生成的接口文档补齐。
```

- sentenceId: `p1_b0_s1`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 2
- assemblyScore: 4.46

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 4

1.

```text
text: 我们下午讨论候选声城方案，先把候选生成的接口文档补齐。
pathId: 86bbdea09331c4feb5a8c0ad9881f21444a7ba7ae866222c8b4c24b3fba4ce42
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 我们下午讨论后选声城方案，先把候选生成的接口文档补齐。
pathId: 86bbdea09331c4feb5a8c0ad9881f21444a7ba7ae866222c8b4c24b3fba4ce42
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s1
```

3.

```text
text: 我们下午讨论候选声城方案，先把候选生成的接口文档补齐。
pathId: eefbde0a8d0d9a4bd706030008aee9a3ba8aef276637bb189b65c4365acf56c9
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s0
```

4.

```text
text: 我们下午讨论后选声城方案，先把候选生成的接口文档补齐。
pathId: eefbde0a8d0d9a4bd706030008aee9a3ba8aef276637bb189b65c4365acf56c9
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s1
```

### D. CrossPath Output

Count: 2

1.

```text
text: 我们下午讨论候选声城方案，先把候选生成的接口文档补齐。
keptFromPath: 86bbdea09331c4feb5a8c0ad9881f21444a7ba7ae866222c8b4c24b3fba4ce42
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 我们下午讨论后选声城方案，先把候选生成的接口文档补齐。
keptFromPath: 86bbdea09331c4feb5a8c0ad9881f21444a7ba7ae866222c8b4c24b3fba4ce42
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s1
```

### E. CrossPath 删除项

```text
Dropped Text: 我们下午讨论候选声城方案，先把候选生成的接口文档补齐。
Source Sentence: p1_b0_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 我们下午讨论候选声城方案，先把候选生成的接口文档补齐。
```

```text
Dropped Text: 我们下午讨论后选声城方案，先把候选生成的接口文档补齐。
Source Sentence: p1_b0_s1
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 我们下午讨论后选声城方案，先把候选生成的接口文档补齐。
```

### F. KenLM Input

KenLM Input Count: 2

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
我们下午讨论候选声城方案，先把候选生成的接口文档补齐。
```

2.

```text
我们下午讨论后选声城方案，先把候选生成的接口文档补齐。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"86bbdea09331c4feb5a8c0ad9881f21444a7ba7ae866222c8b4c24b3fba4ce42","bucketDomain":"tech_ai","count":2},{"pathId":"eefbde0a8d0d9a4bd706030008aee9a3ba8aef276637bb189b65c4365acf56c9","bucketDomain":"tech_ai","count":2}]
crossPathInputCount: 4
crossPathOutputCount: 2
kenlmInputCount: 2
CrossPath Input == Assembly total: YES (4 vs 4)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d179

<a id="case-d179"></a>

### Case 基础信息

```text
Case ID: d179
Raw Text: 这周的上线计花已经确认，上线计划评审安排在周四上午。
Path Count: 4
Bucket Count: 5
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `3a7c0ec19c68211cdf24335825c8d37e4aa2134e2fc89f2e63c8e4317cc94389`

Bucket: `tech_ai` (`p0_b0`)

Assembly Sentences:

1.

```text
这周的上线计划已经确认，上线计划评审安排在周四上午。
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 9.64

2.

```text
这周的上线计花已经确认，上线计划评审安排在周四上午。
```

- sentenceId: `p0_b0_s1`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 2
- assemblyScore: 7.24

#### Path: `066ebc94f339a351afffd32d14f7e56193e4b7aea663b15d787ffdc5993bda0f`

Bucket: `tech_ai` (`p1_b0`)

Assembly Sentences:

1.

```text
这周的上线计划已经确认，上线计划评审安排在周四上午。
```

- sentenceId: `p1_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 6.86

2.

```text
这周的上线计花已经确认，上线计划评审安排在周四上午。
```

- sentenceId: `p1_b0_s1`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 2
- assemblyScore: 4.46

#### Path: `57ea9b89e4fc35be95b82fbc831b7f5c4c7f6f5fe37c7010697f3f088ac465f6`

Bucket: `tech_ai` (`p2_b0`)

Assembly Sentences:

1.

```text
这周的上线计划已经确认，上线计划评审安排在周四上午。
```

- sentenceId: `p2_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 6.859999999999999

2.

```text
这周的上线计花已经确认，上线计划评审安排在周四上午。
```

- sentenceId: `p2_b0_s1`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 2
- assemblyScore: 4.82

#### Path: `1e01ba7584d9e3d132a29bce455c9f9262f69591509b4623fd5d51aae06b8008`

Bucket: `tech_ai` (`p3_b0`)

Assembly Sentences:

1.

```text
这周的上线计划已经确认，上线计划评审安排在周四上午。
```

- sentenceId: `p3_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 4.08

2.

```text
这周的上线计花已经确认，上线计划评审安排在周四上午。
```

- sentenceId: `p3_b0_s1`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 2
- assemblyScore: 2.04

#### Path: `1e01ba7584d9e3d132a29bce455c9f9262f69591509b4623fd5d51aae06b8008`

Bucket: `tourism_hotel` (`p3_b1`)

Assembly Sentences:

1.

```text
这周的上线计花已经确认，上线计划评审安排在周四商务。
```

- sentenceId: `p3_b1_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 4.72

2.

```text
这周的上线计花已经确认，上线计划评审安排在周四上午。
```

- sentenceId: `p3_b1_s1`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 2
- assemblyScore: 2.36

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 10

1.

```text
text: 这周的上线计划已经确认，上线计划评审安排在周四上午。
pathId: 3a7c0ec19c68211cdf24335825c8d37e4aa2134e2fc89f2e63c8e4317cc94389
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 这周的上线计花已经确认，上线计划评审安排在周四上午。
pathId: 3a7c0ec19c68211cdf24335825c8d37e4aa2134e2fc89f2e63c8e4317cc94389
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s1
```

3.

```text
text: 这周的上线计划已经确认，上线计划评审安排在周四上午。
pathId: 066ebc94f339a351afffd32d14f7e56193e4b7aea663b15d787ffdc5993bda0f
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s0
```

4.

```text
text: 这周的上线计花已经确认，上线计划评审安排在周四上午。
pathId: 066ebc94f339a351afffd32d14f7e56193e4b7aea663b15d787ffdc5993bda0f
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s1
```

5.

```text
text: 这周的上线计划已经确认，上线计划评审安排在周四上午。
pathId: 57ea9b89e4fc35be95b82fbc831b7f5c4c7f6f5fe37c7010697f3f088ac465f6
bucketDomain: tech_ai
sourceSentenceId: p2_b0_s0
```

6.

```text
text: 这周的上线计花已经确认，上线计划评审安排在周四上午。
pathId: 57ea9b89e4fc35be95b82fbc831b7f5c4c7f6f5fe37c7010697f3f088ac465f6
bucketDomain: tech_ai
sourceSentenceId: p2_b0_s1
```

7.

```text
text: 这周的上线计划已经确认，上线计划评审安排在周四上午。
pathId: 1e01ba7584d9e3d132a29bce455c9f9262f69591509b4623fd5d51aae06b8008
bucketDomain: tech_ai
sourceSentenceId: p3_b0_s0
```

8.

```text
text: 这周的上线计花已经确认，上线计划评审安排在周四上午。
pathId: 1e01ba7584d9e3d132a29bce455c9f9262f69591509b4623fd5d51aae06b8008
bucketDomain: tech_ai
sourceSentenceId: p3_b0_s1
```

9.

```text
text: 这周的上线计花已经确认，上线计划评审安排在周四商务。
pathId: 1e01ba7584d9e3d132a29bce455c9f9262f69591509b4623fd5d51aae06b8008
bucketDomain: tourism_hotel
sourceSentenceId: p3_b1_s0
```

10.

```text
text: 这周的上线计花已经确认，上线计划评审安排在周四上午。
pathId: 1e01ba7584d9e3d132a29bce455c9f9262f69591509b4623fd5d51aae06b8008
bucketDomain: tourism_hotel
sourceSentenceId: p3_b1_s1
```

### D. CrossPath Output

Count: 3

1.

```text
text: 这周的上线计划已经确认，上线计划评审安排在周四上午。
keptFromPath: 3a7c0ec19c68211cdf24335825c8d37e4aa2134e2fc89f2e63c8e4317cc94389
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 这周的上线计花已经确认，上线计划评审安排在周四上午。
keptFromPath: 3a7c0ec19c68211cdf24335825c8d37e4aa2134e2fc89f2e63c8e4317cc94389
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s1
```

3.

```text
text: 这周的上线计花已经确认，上线计划评审安排在周四商务。
keptFromPath: 1e01ba7584d9e3d132a29bce455c9f9262f69591509b4623fd5d51aae06b8008
keptFromBucket: p3_b1
sourceSentenceId: p3_b1_s0
```

### E. CrossPath 删除项

```text
Dropped Text: 这周的上线计划已经确认，上线计划评审安排在周四上午。
Source Sentence: p1_b0_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 这周的上线计划已经确认，上线计划评审安排在周四上午。
```

```text
Dropped Text: 这周的上线计花已经确认，上线计划评审安排在周四上午。
Source Sentence: p1_b0_s1
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 这周的上线计花已经确认，上线计划评审安排在周四上午。
```

```text
Dropped Text: 这周的上线计划已经确认，上线计划评审安排在周四上午。
Source Sentence: p2_b0_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 这周的上线计划已经确认，上线计划评审安排在周四上午。
```

```text
Dropped Text: 这周的上线计花已经确认，上线计划评审安排在周四上午。
Source Sentence: p2_b0_s1
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 这周的上线计花已经确认，上线计划评审安排在周四上午。
```

```text
Dropped Text: 这周的上线计划已经确认，上线计划评审安排在周四上午。
Source Sentence: p3_b0_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 这周的上线计划已经确认，上线计划评审安排在周四上午。
```

```text
Dropped Text: 这周的上线计花已经确认，上线计划评审安排在周四上午。
Source Sentence: p3_b0_s1
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 这周的上线计花已经确认，上线计划评审安排在周四上午。
```

```text
Dropped Text: 这周的上线计花已经确认，上线计划评审安排在周四上午。
Source Sentence: p3_b1_s1
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 这周的上线计花已经确认，上线计划评审安排在周四上午。
```

### F. KenLM Input

KenLM Input Count: 3

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
这周的上线计划已经确认，上线计划评审安排在周四上午。
```

2.

```text
这周的上线计花已经确认，上线计划评审安排在周四上午。
```

3.

```text
这周的上线计花已经确认，上线计划评审安排在周四商务。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"3a7c0ec19c68211cdf24335825c8d37e4aa2134e2fc89f2e63c8e4317cc94389","bucketDomain":"tech_ai","count":2},{"pathId":"066ebc94f339a351afffd32d14f7e56193e4b7aea663b15d787ffdc5993bda0f","bucketDomain":"tech_ai","count":2},{"pathId":"57ea9b89e4fc35be95b82fbc831b7f5c4c7f6f5fe37c7010697f3f088ac465f6","bucketDomain":"tech_ai","count":2},{"pathId":"1e01ba7584d9e3d132a29bce455c9f9262f69591509b4623fd5d51aae06b8008","bucketDomain":"tech_ai","count":2},{"pathId":"1e01ba7584d9e3d132a29bce455c9f9262f69591509b4623fd5d51aae06b8008","bucketDomain":"tourism_hotel","count":2}]
crossPathInputCount: 10
crossPathOutputCount: 3
kenlmInputCount: 3
CrossPath Input == Assembly total: YES (10 vs 10)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d180

<a id="case-d180"></a>

### Case 基础信息

```text
Case ID: d180
Raw Text: 关于后选生城和上线计化，请按上线计划执行，有问题群里说。
Path Count: 4
Bucket Count: 4
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `80d8d072c93bd03cae9cbb84c08e94e3da22d362211a19bb4e9529d389cfcbd9`

Bucket: `tech_ai` (`p0_b0`)

Assembly Sentences:

1.

```text
关于候选生城和上线计划，请按上线计划执行，有问题群里说。
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 9.64

2.

```text
关于候选生城和上线计化，请按上线计划执行，有问题群里说。
```

- sentenceId: `p0_b0_s1`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 2
- assemblyScore: 7.24

3.

```text
关于后选生城和上线计划，请按上线计划执行，有问题群里说。
```

- sentenceId: `p0_b0_s2`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 3
- assemblyScore: 7.220000000000001

4.

```text
关于后选生城和上线计化，请按上线计划执行，有问题群里说。
```

- sentenceId: `p0_b0_s3`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 4
- assemblyScore: 4.82

#### Path: `93e4109d85b5380fab48f556415ccbc466756d447402b61852516ce4b9af9d96`

Bucket: `tech_ai` (`p1_b0`)

Assembly Sentences:

1.

```text
关于候选生城和上线计划，请按上线计划执行，有问题群里说。
```

- sentenceId: `p1_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 7.220000000000001

2.

```text
关于候选生城和上线计化，请按上线计划执行，有问题群里说。
```

- sentenceId: `p1_b0_s1`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 2
- assemblyScore: 4.82

3.

```text
关于后选生城和上线计划，请按上线计划执行，有问题群里说。
```

- sentenceId: `p1_b0_s2`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 3
- assemblyScore: 4.8

4.

```text
关于后选生城和上线计化，请按上线计划执行，有问题群里说。
```

- sentenceId: `p1_b0_s3`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 4
- assemblyScore: 2.4

#### Path: `2ad765c2b868ddad2f2aacc904cdbbff13b3bd2676190675e265773ee4a9a6ab`

Bucket: `tech_ai` (`p2_b0`)

Assembly Sentences:

1.

```text
关于候选生城和上线计划，请按上线计划执行，有问题群里说。
```

- sentenceId: `p2_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 12.06

2.

```text
关于候选生城和上线计化，请按上线计划执行，有问题群里说。
```

- sentenceId: `p2_b0_s1`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 2
- assemblyScore: 9.66

3.

```text
关于后选生城和上线计划，请按上线计划执行，有问题群里说。
```

- sentenceId: `p2_b0_s2`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 3
- assemblyScore: 9.64

4.

```text
关于后选生城和上线计化，请按上线计划执行，有问题群里说。
```

- sentenceId: `p2_b0_s3`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 4
- assemblyScore: 7.24

#### Path: `65aa4e3a49b767d4a16d0bb386a6f55fc3d2885c77f30fc1f8e5824bd3aebf0a`

Bucket: `tech_ai` (`p3_b0`)

Assembly Sentences:

1.

```text
关于候选生城和上线计划，请按上线计划执行，有问题群里说。
```

- sentenceId: `p3_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 9.64

2.

```text
关于候选生城和上线计化，请按上线计划执行，有问题群里说。
```

- sentenceId: `p3_b0_s1`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 2
- assemblyScore: 7.24

3.

```text
关于后选生城和上线计划，请按上线计划执行，有问题群里说。
```

- sentenceId: `p3_b0_s2`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 3
- assemblyScore: 7.220000000000001

4.

```text
关于后选生城和上线计化，请按上线计划执行，有问题群里说。
```

- sentenceId: `p3_b0_s3`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 4
- assemblyScore: 4.82

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 16

1.

```text
text: 关于候选生城和上线计划，请按上线计划执行，有问题群里说。
pathId: 80d8d072c93bd03cae9cbb84c08e94e3da22d362211a19bb4e9529d389cfcbd9
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 关于候选生城和上线计化，请按上线计划执行，有问题群里说。
pathId: 80d8d072c93bd03cae9cbb84c08e94e3da22d362211a19bb4e9529d389cfcbd9
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s1
```

3.

```text
text: 关于后选生城和上线计划，请按上线计划执行，有问题群里说。
pathId: 80d8d072c93bd03cae9cbb84c08e94e3da22d362211a19bb4e9529d389cfcbd9
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s2
```

4.

```text
text: 关于后选生城和上线计化，请按上线计划执行，有问题群里说。
pathId: 80d8d072c93bd03cae9cbb84c08e94e3da22d362211a19bb4e9529d389cfcbd9
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s3
```

5.

```text
text: 关于候选生城和上线计划，请按上线计划执行，有问题群里说。
pathId: 93e4109d85b5380fab48f556415ccbc466756d447402b61852516ce4b9af9d96
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s0
```

6.

```text
text: 关于候选生城和上线计化，请按上线计划执行，有问题群里说。
pathId: 93e4109d85b5380fab48f556415ccbc466756d447402b61852516ce4b9af9d96
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s1
```

7.

```text
text: 关于后选生城和上线计划，请按上线计划执行，有问题群里说。
pathId: 93e4109d85b5380fab48f556415ccbc466756d447402b61852516ce4b9af9d96
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s2
```

8.

```text
text: 关于后选生城和上线计化，请按上线计划执行，有问题群里说。
pathId: 93e4109d85b5380fab48f556415ccbc466756d447402b61852516ce4b9af9d96
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s3
```

9.

```text
text: 关于候选生城和上线计划，请按上线计划执行，有问题群里说。
pathId: 2ad765c2b868ddad2f2aacc904cdbbff13b3bd2676190675e265773ee4a9a6ab
bucketDomain: tech_ai
sourceSentenceId: p2_b0_s0
```

10.

```text
text: 关于候选生城和上线计化，请按上线计划执行，有问题群里说。
pathId: 2ad765c2b868ddad2f2aacc904cdbbff13b3bd2676190675e265773ee4a9a6ab
bucketDomain: tech_ai
sourceSentenceId: p2_b0_s1
```

11.

```text
text: 关于后选生城和上线计划，请按上线计划执行，有问题群里说。
pathId: 2ad765c2b868ddad2f2aacc904cdbbff13b3bd2676190675e265773ee4a9a6ab
bucketDomain: tech_ai
sourceSentenceId: p2_b0_s2
```

12.

```text
text: 关于后选生城和上线计化，请按上线计划执行，有问题群里说。
pathId: 2ad765c2b868ddad2f2aacc904cdbbff13b3bd2676190675e265773ee4a9a6ab
bucketDomain: tech_ai
sourceSentenceId: p2_b0_s3
```

13.

```text
text: 关于候选生城和上线计划，请按上线计划执行，有问题群里说。
pathId: 65aa4e3a49b767d4a16d0bb386a6f55fc3d2885c77f30fc1f8e5824bd3aebf0a
bucketDomain: tech_ai
sourceSentenceId: p3_b0_s0
```

14.

```text
text: 关于候选生城和上线计化，请按上线计划执行，有问题群里说。
pathId: 65aa4e3a49b767d4a16d0bb386a6f55fc3d2885c77f30fc1f8e5824bd3aebf0a
bucketDomain: tech_ai
sourceSentenceId: p3_b0_s1
```

15.

```text
text: 关于后选生城和上线计划，请按上线计划执行，有问题群里说。
pathId: 65aa4e3a49b767d4a16d0bb386a6f55fc3d2885c77f30fc1f8e5824bd3aebf0a
bucketDomain: tech_ai
sourceSentenceId: p3_b0_s2
```

16.

```text
text: 关于后选生城和上线计化，请按上线计划执行，有问题群里说。
pathId: 65aa4e3a49b767d4a16d0bb386a6f55fc3d2885c77f30fc1f8e5824bd3aebf0a
bucketDomain: tech_ai
sourceSentenceId: p3_b0_s3
```

### D. CrossPath Output

Count: 4

1.

```text
text: 关于候选生城和上线计划，请按上线计划执行，有问题群里说。
keptFromPath: 80d8d072c93bd03cae9cbb84c08e94e3da22d362211a19bb4e9529d389cfcbd9
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 关于候选生城和上线计化，请按上线计划执行，有问题群里说。
keptFromPath: 80d8d072c93bd03cae9cbb84c08e94e3da22d362211a19bb4e9529d389cfcbd9
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s1
```

3.

```text
text: 关于后选生城和上线计划，请按上线计划执行，有问题群里说。
keptFromPath: 80d8d072c93bd03cae9cbb84c08e94e3da22d362211a19bb4e9529d389cfcbd9
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s2
```

4.

```text
text: 关于后选生城和上线计化，请按上线计划执行，有问题群里说。
keptFromPath: 80d8d072c93bd03cae9cbb84c08e94e3da22d362211a19bb4e9529d389cfcbd9
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s3
```

### E. CrossPath 删除项

```text
Dropped Text: 关于候选生城和上线计划，请按上线计划执行，有问题群里说。
Source Sentence: p1_b0_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 关于候选生城和上线计划，请按上线计划执行，有问题群里说。
```

```text
Dropped Text: 关于候选生城和上线计化，请按上线计划执行，有问题群里说。
Source Sentence: p1_b0_s1
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 关于候选生城和上线计化，请按上线计划执行，有问题群里说。
```

```text
Dropped Text: 关于后选生城和上线计划，请按上线计划执行，有问题群里说。
Source Sentence: p1_b0_s2
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 关于后选生城和上线计划，请按上线计划执行，有问题群里说。
```

```text
Dropped Text: 关于后选生城和上线计化，请按上线计划执行，有问题群里说。
Source Sentence: p1_b0_s3
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 关于后选生城和上线计化，请按上线计划执行，有问题群里说。
```

```text
Dropped Text: 关于候选生城和上线计划，请按上线计划执行，有问题群里说。
Source Sentence: p2_b0_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 关于候选生城和上线计划，请按上线计划执行，有问题群里说。
```

```text
Dropped Text: 关于候选生城和上线计化，请按上线计划执行，有问题群里说。
Source Sentence: p2_b0_s1
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 关于候选生城和上线计化，请按上线计划执行，有问题群里说。
```

```text
Dropped Text: 关于后选生城和上线计划，请按上线计划执行，有问题群里说。
Source Sentence: p2_b0_s2
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 关于后选生城和上线计划，请按上线计划执行，有问题群里说。
```

```text
Dropped Text: 关于后选生城和上线计化，请按上线计划执行，有问题群里说。
Source Sentence: p2_b0_s3
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 关于后选生城和上线计化，请按上线计划执行，有问题群里说。
```

```text
Dropped Text: 关于候选生城和上线计划，请按上线计划执行，有问题群里说。
Source Sentence: p3_b0_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 关于候选生城和上线计划，请按上线计划执行，有问题群里说。
```

```text
Dropped Text: 关于候选生城和上线计化，请按上线计划执行，有问题群里说。
Source Sentence: p3_b0_s1
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 关于候选生城和上线计化，请按上线计划执行，有问题群里说。
```

```text
Dropped Text: 关于后选生城和上线计划，请按上线计划执行，有问题群里说。
Source Sentence: p3_b0_s2
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 关于后选生城和上线计划，请按上线计划执行，有问题群里说。
```

```text
Dropped Text: 关于后选生城和上线计化，请按上线计划执行，有问题群里说。
Source Sentence: p3_b0_s3
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 关于后选生城和上线计化，请按上线计划执行，有问题群里说。
```

### F. KenLM Input

KenLM Input Count: 4

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
关于候选生城和上线计划，请按上线计划执行，有问题群里说。
```

2.

```text
关于候选生城和上线计化，请按上线计划执行，有问题群里说。
```

3.

```text
关于后选生城和上线计划，请按上线计划执行，有问题群里说。
```

4.

```text
关于后选生城和上线计化，请按上线计划执行，有问题群里说。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"80d8d072c93bd03cae9cbb84c08e94e3da22d362211a19bb4e9529d389cfcbd9","bucketDomain":"tech_ai","count":4},{"pathId":"93e4109d85b5380fab48f556415ccbc466756d447402b61852516ce4b9af9d96","bucketDomain":"tech_ai","count":4},{"pathId":"2ad765c2b868ddad2f2aacc904cdbbff13b3bd2676190675e265773ee4a9a6ab","bucketDomain":"tech_ai","count":4},{"pathId":"65aa4e3a49b767d4a16d0bb386a6f55fc3d2885c77f30fc1f8e5824bd3aebf0a","bucketDomain":"tech_ai","count":4}]
crossPathInputCount: 16
crossPathOutputCount: 4
kenlmInputCount: 4
CrossPath Input == Assembly total: YES (16 vs 16)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d181

<a id="case-d181"></a>

### Case 基础信息

```text
Case ID: d181
Raw Text: 你好，我想点一杯冰美式，中杯，少糖。顺便问一下今天有蓝莓马芬吗？
Path Count: 2
Bucket Count: 4
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `dfdf9f0cedb03c87e0d1f43c670ec66222f45ae24de8fb942124a8ed4d139e36`

Bucket: `food_order` (`p0_b0`)

Assembly Sentences:

1.

```text
你好，我想点一杯冰美式，中杯，少糖。顺便问一下今天有蓝莓马芬吗？
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 9.19

#### Path: `dfdf9f0cedb03c87e0d1f43c670ec66222f45ae24de8fb942124a8ed4d139e36`

Bucket: `coffee` (`p0_b1`)

Assembly Sentences:

1.

```text
你好，我想点一杯冰美式，中杯，少糖。顺便问一下今天有蓝莓马芬吗？
```

- sentenceId: `p0_b1_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 6.7475000000000005

#### Path: `34555bf4cfbd5917bf1089256ee6a3ad60e9757d24216598cdf06ef883136d03`

Bucket: `coffee` (`p1_b0`)

Assembly Sentences:

1.

```text
你好，我想点一杯冰美式，中杯，少糖。顺便问一下今天有蓝莓马芬吗？
```

- sentenceId: `p1_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 6.7475000000000005

#### Path: `34555bf4cfbd5917bf1089256ee6a3ad60e9757d24216598cdf06ef883136d03`

Bucket: `food_order` (`p1_b1`)

Assembly Sentences:

1.

```text
你好，我想点一杯冰美式，中杯，少糖。顺便问一下今天有蓝莓马芬吗？
```

- sentenceId: `p1_b1_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 6.79

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 4

1.

```text
text: 你好，我想点一杯冰美式，中杯，少糖。顺便问一下今天有蓝莓马芬吗？
pathId: dfdf9f0cedb03c87e0d1f43c670ec66222f45ae24de8fb942124a8ed4d139e36
bucketDomain: food_order
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 你好，我想点一杯冰美式，中杯，少糖。顺便问一下今天有蓝莓马芬吗？
pathId: dfdf9f0cedb03c87e0d1f43c670ec66222f45ae24de8fb942124a8ed4d139e36
bucketDomain: coffee
sourceSentenceId: p0_b1_s0
```

3.

```text
text: 你好，我想点一杯冰美式，中杯，少糖。顺便问一下今天有蓝莓马芬吗？
pathId: 34555bf4cfbd5917bf1089256ee6a3ad60e9757d24216598cdf06ef883136d03
bucketDomain: coffee
sourceSentenceId: p1_b0_s0
```

4.

```text
text: 你好，我想点一杯冰美式，中杯，少糖。顺便问一下今天有蓝莓马芬吗？
pathId: 34555bf4cfbd5917bf1089256ee6a3ad60e9757d24216598cdf06ef883136d03
bucketDomain: food_order
sourceSentenceId: p1_b1_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 你好，我想点一杯冰美式，中杯，少糖。顺便问一下今天有蓝莓马芬吗？
keptFromPath: dfdf9f0cedb03c87e0d1f43c670ec66222f45ae24de8fb942124a8ed4d139e36
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

```text
Dropped Text: 你好，我想点一杯冰美式，中杯，少糖。顺便问一下今天有蓝莓马芬吗？
Source Sentence: p0_b1_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 你好，我想点一杯冰美式，中杯，少糖。顺便问一下今天有蓝莓马芬吗？
```

```text
Dropped Text: 你好，我想点一杯冰美式，中杯，少糖。顺便问一下今天有蓝莓马芬吗？
Source Sentence: p1_b0_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 你好，我想点一杯冰美式，中杯，少糖。顺便问一下今天有蓝莓马芬吗？
```

```text
Dropped Text: 你好，我想点一杯冰美式，中杯，少糖。顺便问一下今天有蓝莓马芬吗？
Source Sentence: p1_b1_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 你好，我想点一杯冰美式，中杯，少糖。顺便问一下今天有蓝莓马芬吗？
```

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
你好，我想点一杯冰美式，中杯，少糖。顺便问一下今天有蓝莓马芬吗？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"dfdf9f0cedb03c87e0d1f43c670ec66222f45ae24de8fb942124a8ed4d139e36","bucketDomain":"food_order","count":1},{"pathId":"dfdf9f0cedb03c87e0d1f43c670ec66222f45ae24de8fb942124a8ed4d139e36","bucketDomain":"coffee","count":1},{"pathId":"34555bf4cfbd5917bf1089256ee6a3ad60e9757d24216598cdf06ef883136d03","bucketDomain":"coffee","count":1},{"pathId":"34555bf4cfbd5917bf1089256ee6a3ad60e9757d24216598cdf06ef883136d03","bucketDomain":"food_order","count":1}]
crossPathInputCount: 4
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (4 vs 4)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d182

<a id="case-d182"></a>

### Case 基础信息

```text
Case ID: d182
Raw Text: 麻烦帮我做一杯卡布奇诺带走，大杯就行，谢谢。
Path Count: 2
Bucket Count: 2
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `c46ccc49340f7cb86275e5e6630d22b5e936024be72283698eb14d6f44e7284c`

Bucket: `coffee` (`p0_b0`)

Assembly Sentences:

1.

```text
麻烦帮我做一杯卡布奇诺带走，大杯就行，谢谢。
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 6.7275

#### Path: `3710d2726d9b83a417e0491e8b96ed9f4eff0bc90b7e7a7b91f4e68d31556789`

Bucket: `coffee` (`p1_b0`)

Assembly Sentences:

1.

```text
麻烦帮我做一杯卡布奇诺带走，大杯就行，谢谢。
```

- sentenceId: `p1_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 9.085999999999999

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 2

1.

```text
text: 麻烦帮我做一杯卡布奇诺带走，大杯就行，谢谢。
pathId: c46ccc49340f7cb86275e5e6630d22b5e936024be72283698eb14d6f44e7284c
bucketDomain: coffee
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 麻烦帮我做一杯卡布奇诺带走，大杯就行，谢谢。
pathId: 3710d2726d9b83a417e0491e8b96ed9f4eff0bc90b7e7a7b91f4e68d31556789
bucketDomain: coffee
sourceSentenceId: p1_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 麻烦帮我做一杯卡布奇诺带走，大杯就行，谢谢。
keptFromPath: c46ccc49340f7cb86275e5e6630d22b5e936024be72283698eb14d6f44e7284c
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

```text
Dropped Text: 麻烦帮我做一杯卡布奇诺带走，大杯就行，谢谢。
Source Sentence: p1_b0_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 麻烦帮我做一杯卡布奇诺带走，大杯就行，谢谢。
```

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
麻烦帮我做一杯卡布奇诺带走，大杯就行，谢谢。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"c46ccc49340f7cb86275e5e6630d22b5e936024be72283698eb14d6f44e7284c","bucketDomain":"coffee","count":1},{"pathId":"3710d2726d9b83a417e0491e8b96ed9f4eff0bc90b7e7a7b91f4e68d31556789","bucketDomain":"coffee","count":1}]
crossPathInputCount: 2
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (2 vs 2)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d183

<a id="case-d183"></a>

### Case 基础信息

```text
Case ID: d183
Raw Text: 请问这款红茶可以少冰吗？我赶时间，小杯。
Path Count: 1
Bucket Count: 2
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `819a6a7ddd4888a146f863e457a08cf1078f08698b4916903b0ec22023229386`

Bucket: `coffee` (`p0_b0`)

Assembly Sentences:

1.

```text
请问这款红茶可以少冰吗？我赶时间，小杯。
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 6.765999999999999

#### Path: `819a6a7ddd4888a146f863e457a08cf1078f08698b4916903b0ec22023229386`

Bucket: `milk_tea` (`p0_b1`)

Assembly Sentences:

1.

```text
请问这款红茶可以少冰吗？我赶时间，小杯。
```

- sentenceId: `p0_b1_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 6.765999999999999

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 2

1.

```text
text: 请问这款红茶可以少冰吗？我赶时间，小杯。
pathId: 819a6a7ddd4888a146f863e457a08cf1078f08698b4916903b0ec22023229386
bucketDomain: coffee
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 请问这款红茶可以少冰吗？我赶时间，小杯。
pathId: 819a6a7ddd4888a146f863e457a08cf1078f08698b4916903b0ec22023229386
bucketDomain: milk_tea
sourceSentenceId: p0_b1_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 请问这款红茶可以少冰吗？我赶时间，小杯。
keptFromPath: 819a6a7ddd4888a146f863e457a08cf1078f08698b4916903b0ec22023229386
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

```text
Dropped Text: 请问这款红茶可以少冰吗？我赶时间，小杯。
Source Sentence: p0_b1_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 请问这款红茶可以少冰吗？我赶时间，小杯。
```

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
请问这款红茶可以少冰吗？我赶时间，小杯。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"819a6a7ddd4888a146f863e457a08cf1078f08698b4916903b0ec22023229386","bucketDomain":"coffee","count":1},{"pathId":"819a6a7ddd4888a146f863e457a08cf1078f08698b4916903b0ec22023229386","bucketDomain":"milk_tea","count":1}]
crossPathInputCount: 2
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (2 vs 2)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d184

<a id="case-d184"></a>

### Case 基础信息

```text
Case ID: d184
Raw Text: 小陈，客户反馈翻译引擎接口报错，我们能不能加缓存，下午三点前把结论发群里？
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `192b84f072ea72e5bfc1e646510978c24cb4fc1275c9fb642895892d1fab1c0a`

Bucket: `tech_ai` (`p0_b0`)

Assembly Sentences:

1.

```text
小陈，客户反馈翻译引擎接口报错，我们能不能加缓存，下午三点前把结论发群里？
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 9.54

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 小陈，客户反馈翻译引擎接口报错，我们能不能加缓存，下午三点前把结论发群里？
pathId: 192b84f072ea72e5bfc1e646510978c24cb4fc1275c9fb642895892d1fab1c0a
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 小陈，客户反馈翻译引擎接口报错，我们能不能加缓存，下午三点前把结论发群里？
keptFromPath: 192b84f072ea72e5bfc1e646510978c24cb4fc1275c9fb642895892d1fab1c0a
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
小陈，客户反馈翻译引擎接口报错，我们能不能加缓存，下午三点前把结论发群里？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"192b84f072ea72e5bfc1e646510978c24cb4fc1275c9fb642895892d1fab1c0a","bucketDomain":"tech_ai","count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d185

<a id="case-d185"></a>

### Case 基础信息

```text
Case ID: d185
Raw Text: 今天的站会先过一下订单中台进度，内存占用高这块需要限流保护，大家看一下风险。
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `1818371cb2a90c789c7b281c3cc36a23715bfc08e3164930fe2034ce6bc0785f`

Bucket: `food_order` (`p0_b0`)

Assembly Sentences:

1.

```text
今天的站会先过一下订单中台进度，内存占用高这块需要限流保护，大家看一下风险。
```

- sentenceId: `p0_b0_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.4

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 今天的站会先过一下订单中台进度，内存占用高这块需要限流保护，大家看一下风险。
pathId: 1818371cb2a90c789c7b281c3cc36a23715bfc08e3164930fe2034ce6bc0785f
bucketDomain: food_order
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 今天的站会先过一下订单中台进度，内存占用高这块需要限流保护，大家看一下风险。
keptFromPath: 1818371cb2a90c789c7b281c3cc36a23715bfc08e3164930fe2034ce6bc0785f
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
今天的站会先过一下订单中台进度，内存占用高这块需要限流保护，大家看一下风险。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"1818371cb2a90c789c7b281c3cc36a23715bfc08e3164930fe2034ce6bc0785f","bucketDomain":"food_order","count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d186

<a id="case-d186"></a>

### Case 基础信息

```text
Case ID: d186
Raw Text: 跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。
Path Count: 1
Bucket Count: 3
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `54a9f07e03af142eb5a06f0dd3e6a30fb09f82b47cd652dc08d575fdfc606551`

Bucket: `food_order` (`p0_b0`)

Assembly Sentences:

1.

```text
跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。
```

- sentenceId: `p0_b0_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

#### Path: `54a9f07e03af142eb5a06f0dd3e6a30fb09f82b47cd652dc08d575fdfc606551`

Bucket: `meeting` (`p0_b1`)

Assembly Sentences:

1.

```text
跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。
```

- sentenceId: `p0_b1_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

#### Path: `54a9f07e03af142eb5a06f0dd3e6a30fb09f82b47cd652dc08d575fdfc606551`

Bucket: `tech_ai` (`p0_b2`)

Assembly Sentences:

1.

```text
跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。
```

- sentenceId: `p0_b2_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 3

1.

```text
text: 跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。
pathId: 54a9f07e03af142eb5a06f0dd3e6a30fb09f82b47cd652dc08d575fdfc606551
bucketDomain: food_order
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。
pathId: 54a9f07e03af142eb5a06f0dd3e6a30fb09f82b47cd652dc08d575fdfc606551
bucketDomain: meeting
sourceSentenceId: p0_b1_s0
```

3.

```text
text: 跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。
pathId: 54a9f07e03af142eb5a06f0dd3e6a30fb09f82b47cd652dc08d575fdfc606551
bucketDomain: tech_ai
sourceSentenceId: p0_b2_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。
keptFromPath: 54a9f07e03af142eb5a06f0dd3e6a30fb09f82b47cd652dc08d575fdfc606551
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

```text
Dropped Text: 跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。
Source Sentence: p0_b1_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。
```

```text
Dropped Text: 跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。
Source Sentence: p0_b2_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。
```

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"54a9f07e03af142eb5a06f0dd3e6a30fb09f82b47cd652dc08d575fdfc606551","bucketDomain":"food_order","count":1},{"pathId":"54a9f07e03af142eb5a06f0dd3e6a30fb09f82b47cd652dc08d575fdfc606551","bucketDomain":"meeting","count":1},{"pathId":"54a9f07e03af142eb5a06f0dd3e6a30fb09f82b47cd652dc08d575fdfc606551","bucketDomain":"tech_ai","count":1}]
crossPathInputCount: 3
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (3 vs 3)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d187

<a id="case-d187"></a>

### Case 基础信息

```text
Case ID: d187
Raw Text: 师傅，去中关村软件园，走机场高速。我赶九点半的会，要是堵车您提前跟我说。
Path Count: 1
Bucket Count: 2
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `ce61e4f57b177b95d39665e0aa77ec09fca042ee22c72a2f8e6f99c0e9df5c87`

Bucket: `tourism_hotel` (`p0_b0`)

Assembly Sentences:

1.

```text
师傅，去中关村软件园，走机场高速。我赶酒店半的会，要是堵车您提前跟我说。
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 4.72

2.

```text
师傅，去中关村软件园，走机场高速。我赶九点半的会，要是堵车您提前跟我说。
```

- sentenceId: `p0_b0_s1`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 2
- assemblyScore: 2.36

#### Path: `ce61e4f57b177b95d39665e0aa77ec09fca042ee22c72a2f8e6f99c0e9df5c87`

Bucket: `tourism_transport` (`p0_b1`)

Assembly Sentences:

1.

```text
师傅，去中关村软件园，走机场高速。我赶九点半的会，要是堵车您提前跟我说。
```

- sentenceId: `p0_b1_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 4.8

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 3

1.

```text
text: 师傅，去中关村软件园，走机场高速。我赶酒店半的会，要是堵车您提前跟我说。
pathId: ce61e4f57b177b95d39665e0aa77ec09fca042ee22c72a2f8e6f99c0e9df5c87
bucketDomain: tourism_hotel
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 师傅，去中关村软件园，走机场高速。我赶九点半的会，要是堵车您提前跟我说。
pathId: ce61e4f57b177b95d39665e0aa77ec09fca042ee22c72a2f8e6f99c0e9df5c87
bucketDomain: tourism_hotel
sourceSentenceId: p0_b0_s1
```

3.

```text
text: 师傅，去中关村软件园，走机场高速。我赶九点半的会，要是堵车您提前跟我说。
pathId: ce61e4f57b177b95d39665e0aa77ec09fca042ee22c72a2f8e6f99c0e9df5c87
bucketDomain: tourism_transport
sourceSentenceId: p0_b1_s0
```

### D. CrossPath Output

Count: 2

1.

```text
text: 师傅，去中关村软件园，走机场高速。我赶酒店半的会，要是堵车您提前跟我说。
keptFromPath: ce61e4f57b177b95d39665e0aa77ec09fca042ee22c72a2f8e6f99c0e9df5c87
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 师傅，去中关村软件园，走机场高速。我赶九点半的会，要是堵车您提前跟我说。
keptFromPath: ce61e4f57b177b95d39665e0aa77ec09fca042ee22c72a2f8e6f99c0e9df5c87
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s1
```

### E. CrossPath 删除项

```text
Dropped Text: 师傅，去中关村软件园，走机场高速。我赶九点半的会，要是堵车您提前跟我说。
Source Sentence: p0_b1_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 师傅，去中关村软件园，走机场高速。我赶九点半的会，要是堵车您提前跟我说。
```

### F. KenLM Input

KenLM Input Count: 2

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
师傅，去中关村软件园，走机场高速。我赶酒店半的会，要是堵车您提前跟我说。
```

2.

```text
师傅，去中关村软件园，走机场高速。我赶九点半的会，要是堵车您提前跟我说。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"ce61e4f57b177b95d39665e0aa77ec09fca042ee22c72a2f8e6f99c0e9df5c87","bucketDomain":"tourism_hotel","count":2},{"pathId":"ce61e4f57b177b95d39665e0aa77ec09fca042ee22c72a2f8e6f99c0e9df5c87","bucketDomain":"tourism_transport","count":1}]
crossPathInputCount: 3
crossPathOutputCount: 2
kenlmInputCount: 2
CrossPath Input == Assembly total: YES (3 vs 3)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d188

<a id="case-d188"></a>

### Case 基础信息

```text
Case ID: d188
Raw Text: 麻烦送我到国贸三期南门，大概多久能到？我十点十分有个电话会。
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `5e9009eef0d21f74596c5a09a2e424e9bd26bcd10a32e19a58a4e393c518fd80`

Bucket: `null` (`p0_b0`)

Assembly Sentences:

1.

```text
麻烦送我到国贸三期南门，大概多久能到？我十点十分有个电话会。
```

- sentenceId: `p0_b0_s0`
- category: `RAW_ORIGINAL`
- assemblyRank: 1
- assemblyScore: 0

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 麻烦送我到国贸三期南门，大概多久能到？我十点十分有个电话会。
pathId: 5e9009eef0d21f74596c5a09a2e424e9bd26bcd10a32e19a58a4e393c518fd80
bucketDomain: null
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 麻烦送我到国贸三期南门，大概多久能到？我十点十分有个电话会。
keptFromPath: 5e9009eef0d21f74596c5a09a2e424e9bd26bcd10a32e19a58a4e393c518fd80
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
麻烦送我到国贸三期南门，大概多久能到？我十点十分有个电话会。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"5e9009eef0d21f74596c5a09a2e424e9bd26bcd10a32e19a58a4e393c518fd80","bucketDomain":null,"count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d189

<a id="case-d189"></a>

### Case 基础信息

```text
Case ID: d189
Raw Text: 去望京SOHO，不走四环可以吗？那边现在堵不堵？
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `1ff853294abaa92522bd1f74e24e1523522571dd575d20d3cc71abe29649a5ef`

Bucket: `medical` (`p0_b0`)

Assembly Sentences:

1.

```text
去望京SOHO，不走四环科医吗？那边现在堵不堵？
```

- sentenceId: `p0_b0_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

2.

```text
去望京SOHO，不走四环可以吗？那边现在堵不堵？
```

- sentenceId: `p0_b0_s1`
- category: `RAW_ORIGINAL`
- assemblyRank: 2
- assemblyScore: 0

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 2

1.

```text
text: 去望京SOHO，不走四环科医吗？那边现在堵不堵？
pathId: 1ff853294abaa92522bd1f74e24e1523522571dd575d20d3cc71abe29649a5ef
bucketDomain: medical
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 去望京SOHO，不走四环可以吗？那边现在堵不堵？
pathId: 1ff853294abaa92522bd1f74e24e1523522571dd575d20d3cc71abe29649a5ef
bucketDomain: medical
sourceSentenceId: p0_b0_s1
```

### D. CrossPath Output

Count: 2

1.

```text
text: 去望京SOHO，不走四环科医吗？那边现在堵不堵？
keptFromPath: 1ff853294abaa92522bd1f74e24e1523522571dd575d20d3cc71abe29649a5ef
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 去望京SOHO，不走四环可以吗？那边现在堵不堵？
keptFromPath: 1ff853294abaa92522bd1f74e24e1523522571dd575d20d3cc71abe29649a5ef
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s1
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 2

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
去望京SOHO，不走四环科医吗？那边现在堵不堵？
```

2.

```text
去望京SOHO，不走四环可以吗？那边现在堵不堵？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"1ff853294abaa92522bd1f74e24e1523522571dd575d20d3cc71abe29649a5ef","bucketDomain":"medical","count":2}]
crossPathInputCount: 2
crossPathOutputCount: 2
kenlmInputCount: 2
CrossPath Input == Assembly total: YES (2 vs 2)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d190

<a id="case-d190"></a>

### Case 基础信息

```text
Case ID: d190
Raw Text: 医生您好，我这两天头痛，想开点药并做个血常规。
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `ee5e0704d1330d3bb9f608b6494272a9fc1dc65bbb9bac1f982062dbf1d15534`

Bucket: `medical` (`p0_b0`)

Assembly Sentences:

1.

```text
医生您好，我这两天头痛，想开点药并做个血常规。
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 4.71

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 医生您好，我这两天头痛，想开点药并做个血常规。
pathId: ee5e0704d1330d3bb9f608b6494272a9fc1dc65bbb9bac1f982062dbf1d15534
bucketDomain: medical
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 医生您好，我这两天头痛，想开点药并做个血常规。
keptFromPath: ee5e0704d1330d3bb9f608b6494272a9fc1dc65bbb9bac1f982062dbf1d15534
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
医生您好，我这两天头痛，想开点药并做个血常规。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"ee5e0704d1330d3bb9f608b6494272a9fc1dc65bbb9bac1f982062dbf1d15534","bucketDomain":"medical","count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d191

<a id="case-d191"></a>

### Case 基础信息

```text
Case ID: d191
Raw Text: 挂号处请问内科还有号吗？我胃不舒服，昨晚开始的。
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `149552ff4805e58b3b09f4417f9d2d26276516ca341bc6c2b9ceba03938dda37`

Bucket: `medical` (`p0_b0`)

Assembly Sentences:

1.

```text
挂号处请问内科还有号吗？我胃不舒服，昨晚开始的。
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 4.71

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 挂号处请问内科还有号吗？我胃不舒服，昨晚开始的。
pathId: 149552ff4805e58b3b09f4417f9d2d26276516ca341bc6c2b9ceba03938dda37
bucketDomain: medical
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 挂号处请问内科还有号吗？我胃不舒服，昨晚开始的。
keptFromPath: 149552ff4805e58b3b09f4417f9d2d26276516ca341bc6c2b9ceba03938dda37
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
挂号处请问内科还有号吗？我胃不舒服，昨晚开始的。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"149552ff4805e58b3b09f4417f9d2d26276516ca341bc6c2b9ceba03938dda37","bucketDomain":"medical","count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d192

<a id="case-d192"></a>

### Case 基础信息

```text
Case ID: d192
Raw Text: 这个检查报告什么时候能出？我过敏发痒，需要请假休息吗？
Path Count: 1
Bucket Count: 3
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `fa8f5c186469a544f504e2b1180e1f88870a9ded26eff5007a876fd7ef34e55d`

Bucket: `coffee` (`p0_b0`)

Assembly Sentences:

1.

```text
这个检查报告什么时候能出？我过敏发痒，需要请假休息吗？
```

- sentenceId: `p0_b0_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

#### Path: `fa8f5c186469a544f504e2b1180e1f88870a9ded26eff5007a876fd7ef34e55d`

Bucket: `food_order` (`p0_b1`)

Assembly Sentences:

1.

```text
这个检查报告什么时候能出？我过敏发痒，需要请假休息吗？
```

- sentenceId: `p0_b1_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.4

#### Path: `fa8f5c186469a544f504e2b1180e1f88870a9ded26eff5007a876fd7ef34e55d`

Bucket: `tech_ai` (`p0_b2`)

Assembly Sentences:

1.

```text
这个检查报告什么时候能出？我过敏发痒，需要请假休息吗？
```

- sentenceId: `p0_b2_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 3

1.

```text
text: 这个检查报告什么时候能出？我过敏发痒，需要请假休息吗？
pathId: fa8f5c186469a544f504e2b1180e1f88870a9ded26eff5007a876fd7ef34e55d
bucketDomain: coffee
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 这个检查报告什么时候能出？我过敏发痒，需要请假休息吗？
pathId: fa8f5c186469a544f504e2b1180e1f88870a9ded26eff5007a876fd7ef34e55d
bucketDomain: food_order
sourceSentenceId: p0_b1_s0
```

3.

```text
text: 这个检查报告什么时候能出？我过敏发痒，需要请假休息吗？
pathId: fa8f5c186469a544f504e2b1180e1f88870a9ded26eff5007a876fd7ef34e55d
bucketDomain: tech_ai
sourceSentenceId: p0_b2_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 这个检查报告什么时候能出？我过敏发痒，需要请假休息吗？
keptFromPath: fa8f5c186469a544f504e2b1180e1f88870a9ded26eff5007a876fd7ef34e55d
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

```text
Dropped Text: 这个检查报告什么时候能出？我过敏发痒，需要请假休息吗？
Source Sentence: p0_b1_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 这个检查报告什么时候能出？我过敏发痒，需要请假休息吗？
```

```text
Dropped Text: 这个检查报告什么时候能出？我过敏发痒，需要请假休息吗？
Source Sentence: p0_b2_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 这个检查报告什么时候能出？我过敏发痒，需要请假休息吗？
```

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
这个检查报告什么时候能出？我过敏发痒，需要请假休息吗？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"fa8f5c186469a544f504e2b1180e1f88870a9ded26eff5007a876fd7ef34e55d","bucketDomain":"coffee","count":1},{"pathId":"fa8f5c186469a544f504e2b1180e1f88870a9ded26eff5007a876fd7ef34e55d","bucketDomain":"food_order","count":1},{"pathId":"fa8f5c186469a544f504e2b1180e1f88870a9ded26eff5007a876fd7ef34e55d","bucketDomain":"tech_ai","count":1}]
crossPathInputCount: 3
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (3 vs 3)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d193

<a id="case-d193"></a>

### Case 基础信息

```text
Case ID: d193
Raw Text: 这件外套能试穿吗？我穿中码。买两件有没有折扣？
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `bf0502a46c3d5c83e4576c1730ccf54b973d21032960d5f734d5d84962bf783f`

Bucket: `tech_ai` (`p0_b0`)

Assembly Sentences:

1.

```text
这件外套能试穿吗？我穿中码。买量检有没有折扣？
```

- sentenceId: `p0_b0_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

2.

```text
这件外套能试穿吗？我穿中码。买两件有没有折扣？
```

- sentenceId: `p0_b0_s1`
- category: `RAW_ORIGINAL`
- assemblyRank: 2
- assemblyScore: 0

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 2

1.

```text
text: 这件外套能试穿吗？我穿中码。买量检有没有折扣？
pathId: bf0502a46c3d5c83e4576c1730ccf54b973d21032960d5f734d5d84962bf783f
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 这件外套能试穿吗？我穿中码。买两件有没有折扣？
pathId: bf0502a46c3d5c83e4576c1730ccf54b973d21032960d5f734d5d84962bf783f
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s1
```

### D. CrossPath Output

Count: 2

1.

```text
text: 这件外套能试穿吗？我穿中码。买量检有没有折扣？
keptFromPath: bf0502a46c3d5c83e4576c1730ccf54b973d21032960d5f734d5d84962bf783f
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 这件外套能试穿吗？我穿中码。买两件有没有折扣？
keptFromPath: bf0502a46c3d5c83e4576c1730ccf54b973d21032960d5f734d5d84962bf783f
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s1
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 2

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
这件外套能试穿吗？我穿中码。买量检有没有折扣？
```

2.

```text
这件外套能试穿吗？我穿中码。买两件有没有折扣？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"bf0502a46c3d5c83e4576c1730ccf54b973d21032960d5f734d5d84962bf783f","bucketDomain":"tech_ai","count":2}]
crossPathInputCount: 2
crossPathOutputCount: 2
kenlmInputCount: 2
CrossPath Input == Assembly total: YES (2 vs 2)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d194

<a id="case-d194"></a>

### Case 基础信息

```text
Case ID: d194
Raw Text: 请问这双鞋有四十码吗？不合适三天内可以退换吧？
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `273cfbaf61f2e19636f9a795cf32d7cfe4b6575d1affcccfa8a8ee4e6eb56721`

Bucket: `medical` (`p0_b0`)

Assembly Sentences:

1.

```text
请问这双鞋有四十码吗？不合适三天内科医退换吧？
```

- sentenceId: `p0_b0_s0`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 2.36

2.

```text
请问这双鞋有四十码吗？不合适三天内可以退换吧？
```

- sentenceId: `p0_b0_s1`
- category: `RAW_ORIGINAL`
- assemblyRank: 2
- assemblyScore: 0

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 2

1.

```text
text: 请问这双鞋有四十码吗？不合适三天内科医退换吧？
pathId: 273cfbaf61f2e19636f9a795cf32d7cfe4b6575d1affcccfa8a8ee4e6eb56721
bucketDomain: medical
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 请问这双鞋有四十码吗？不合适三天内可以退换吧？
pathId: 273cfbaf61f2e19636f9a795cf32d7cfe4b6575d1affcccfa8a8ee4e6eb56721
bucketDomain: medical
sourceSentenceId: p0_b0_s1
```

### D. CrossPath Output

Count: 2

1.

```text
text: 请问这双鞋有四十码吗？不合适三天内科医退换吧？
keptFromPath: 273cfbaf61f2e19636f9a795cf32d7cfe4b6575d1affcccfa8a8ee4e6eb56721
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 请问这双鞋有四十码吗？不合适三天内可以退换吧？
keptFromPath: 273cfbaf61f2e19636f9a795cf32d7cfe4b6575d1affcccfa8a8ee4e6eb56721
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s1
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 2

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
请问这双鞋有四十码吗？不合适三天内科医退换吧？
```

2.

```text
请问这双鞋有四十码吗？不合适三天内可以退换吧？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"273cfbaf61f2e19636f9a795cf32d7cfe4b6575d1affcccfa8a8ee4e6eb56721","bucketDomain":"medical","count":2}]
crossPathInputCount: 2
crossPathOutputCount: 2
kenlmInputCount: 2
CrossPath Input == Assembly total: YES (2 vs 2)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d195

<a id="case-d195"></a>

### Case 基础信息

```text
Case ID: d195
Raw Text: 我想对比一下这两款订单中台的价格，会员日能再减一点吗？
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `72d46d6d27ed168a2b446ccc0ef5ca29e9e538e6e0e94d9ab712448785bc00fc`

Bucket: `food_order` (`p0_b0`)

Assembly Sentences:

1.

```text
我想对比一下这两款订单中台的价格，会员日能再减一点吗？
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 4.76

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 我想对比一下这两款订单中台的价格，会员日能再减一点吗？
pathId: 72d46d6d27ed168a2b446ccc0ef5ca29e9e538e6e0e94d9ab712448785bc00fc
bucketDomain: food_order
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 我想对比一下这两款订单中台的价格，会员日能再减一点吗？
keptFromPath: 72d46d6d27ed168a2b446ccc0ef5ca29e9e538e6e0e94d9ab712448785bc00fc
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
我想对比一下这两款订单中台的价格，会员日能再减一点吗？
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"72d46d6d27ed168a2b446ccc0ef5ca29e9e538e6e0e94d9ab712448785bc00fc","bucketDomain":"food_order","count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d196

<a id="case-d196"></a>

### Case 基础信息

```text
Case ID: d196
Raw Text: 周末要不要去江边骑行？天气预报说周日多云，记得带水。
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `ef362a7409d257efe1af2da13a738a0d169e7c13cebf78fc693f2e600087c365`

Bucket: `null` (`p0_b0`)

Assembly Sentences:

1.

```text
周末要不要去江边骑行？天气预报说周日多云，记得带水。
```

- sentenceId: `p0_b0_s0`
- category: `RAW_ORIGINAL`
- assemblyRank: 1
- assemblyScore: 0

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 周末要不要去江边骑行？天气预报说周日多云，记得带水。
pathId: ef362a7409d257efe1af2da13a738a0d169e7c13cebf78fc693f2e600087c365
bucketDomain: null
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 周末要不要去江边骑行？天气预报说周日多云，记得带水。
keptFromPath: ef362a7409d257efe1af2da13a738a0d169e7c13cebf78fc693f2e600087c365
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
周末要不要去江边骑行？天气预报说周日多云，记得带水。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"ef362a7409d257efe1af2da13a738a0d169e7c13cebf78fc693f2e600087c365","bucketDomain":null,"count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d197

<a id="case-d197"></a>

### Case 基础信息

```text
Case ID: d197
Raw Text: 晚上一起吃饭吗？我知道一家川菜不错，大概七点到。
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `37367286bf78ef457c58421ac1cc51772b81498372ff6046875c912bacb0a3ca`

Bucket: `null` (`p0_b0`)

Assembly Sentences:

1.

```text
晚上一起吃饭吗？我知道一家川菜不错，大概七点到。
```

- sentenceId: `p0_b0_s0`
- category: `RAW_ORIGINAL`
- assemblyRank: 1
- assemblyScore: 0

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 晚上一起吃饭吗？我知道一家川菜不错，大概七点到。
pathId: 37367286bf78ef457c58421ac1cc51772b81498372ff6046875c912bacb0a3ca
bucketDomain: null
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 晚上一起吃饭吗？我知道一家川菜不错，大概七点到。
keptFromPath: 37367286bf78ef457c58421ac1cc51772b81498372ff6046875c912bacb0a3ca
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
晚上一起吃饭吗？我知道一家川菜不错，大概七点到。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"37367286bf78ef457c58421ac1cc51772b81498372ff6046875c912bacb0a3ca","bucketDomain":null,"count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d198

<a id="case-d198"></a>

### Case 基础信息

```text
Case ID: d198
Raw Text: 你最近忙不忙？想找你看下手机备份怎么设置。
Path Count: 1
Bucket Count: 1
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `8abbc76111de7c632d7d17362fe9a7cda58f3c9572ab70bc308648553237b238`

Bucket: `null` (`p0_b0`)

Assembly Sentences:

1.

```text
你最近忙不忙？想找你看下手机备份怎么设置。
```

- sentenceId: `p0_b0_s0`
- category: `RAW_ORIGINAL`
- assemblyRank: 1
- assemblyScore: 0

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 1

1.

```text
text: 你最近忙不忙？想找你看下手机备份怎么设置。
pathId: 8abbc76111de7c632d7d17362fe9a7cda58f3c9572ab70bc308648553237b238
bucketDomain: null
sourceSentenceId: p0_b0_s0
```

### D. CrossPath Output

Count: 1

1.

```text
text: 你最近忙不忙？想找你看下手机备份怎么设置。
keptFromPath: 8abbc76111de7c632d7d17362fe9a7cda58f3c9572ab70bc308648553237b238
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

### E. CrossPath 删除项

_无删除_

### F. KenLM Input

KenLM Input Count: 1

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
你最近忙不忙？想找你看下手机备份怎么设置。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"8abbc76111de7c632d7d17362fe9a7cda58f3c9572ab70bc308648553237b238","bucketDomain":null,"count":1}]
crossPathInputCount: 1
crossPathOutputCount: 1
kenlmInputCount: 1
CrossPath Input == Assembly total: YES (1 vs 1)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d199

<a id="case-d199"></a>

### Case 基础信息

```text
Case ID: d199
Raw Text: 今天我们团队要讨论后选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
Path Count: 2
Bucket Count: 2
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8`

Bucket: `tech_ai` (`p0_b0`)

Assembly Sentences:

1.

```text
今天我们团队要讨论候选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 12.02

2.

```text
今天我们团队要讨论候选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
```

- sentenceId: `p0_b0_s1`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 2
- assemblyScore: 9.62

3.

```text
今天我们团队要讨论后选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
```

- sentenceId: `p0_b0_s2`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 3
- assemblyScore: 9.6

4.

```text
今天我们团队要讨论候选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
```

- sentenceId: `p0_b0_s3`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 4
- assemblyScore: 9.6

5.

```text
今天我们团队要讨论后选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
```

- sentenceId: `p0_b0_s4`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 5
- assemblyScore: 7.199999999999999

6.

```text
今天我们团队要讨论候选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
```

- sentenceId: `p0_b0_s5`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 6
- assemblyScore: 7.199999999999999

7.

```text
今天我们团队要讨论后选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
```

- sentenceId: `p0_b0_s6`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 7
- assemblyScore: 7.18

8.

```text
今天我们团队要讨论后选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
```

- sentenceId: `p0_b0_s7`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 8
- assemblyScore: 4.779999999999999

#### Path: `982f3f240464b76e9444a459acaf33ee860bc86f3827f03a9ecc863f3bb62ddb`

Bucket: `tech_ai` (`p1_b0`)

Assembly Sentences:

1.

```text
今天我们团队要讨论候选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
```

- sentenceId: `p1_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 9.239999999999998

2.

```text
今天我们团队要讨论候选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
```

- sentenceId: `p1_b0_s1`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 2
- assemblyScore: 7.199999999999999

3.

```text
今天我们团队要讨论后选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
```

- sentenceId: `p1_b0_s2`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 3
- assemblyScore: 6.819999999999999

4.

```text
今天我们团队要讨论候选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
```

- sentenceId: `p1_b0_s3`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 4
- assemblyScore: 6.819999999999999

5.

```text
今天我们团队要讨论后选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
```

- sentenceId: `p1_b0_s4`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 5
- assemblyScore: 4.779999999999999

6.

```text
今天我们团队要讨论候选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
```

- sentenceId: `p1_b0_s5`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 6
- assemblyScore: 4.779999999999999

7.

```text
今天我们团队要讨论后选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
```

- sentenceId: `p1_b0_s6`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 7
- assemblyScore: 4.4

8.

```text
今天我们团队要讨论后选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
```

- sentenceId: `p1_b0_s7`
- category: `SINGLE_SPAN_REPLACEMENT`
- assemblyRank: 8
- assemblyScore: 2.36

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 16

1.

```text
text: 今天我们团队要讨论候选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
pathId: e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 今天我们团队要讨论候选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
pathId: e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s1
```

3.

```text
text: 今天我们团队要讨论后选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
pathId: e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s2
```

4.

```text
text: 今天我们团队要讨论候选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
pathId: e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s3
```

5.

```text
text: 今天我们团队要讨论后选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
pathId: e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s4
```

6.

```text
text: 今天我们团队要讨论候选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
pathId: e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s5
```

7.

```text
text: 今天我们团队要讨论后选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
pathId: e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s6
```

8.

```text
text: 今天我们团队要讨论后选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
pathId: e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s7
```

9.

```text
text: 今天我们团队要讨论候选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
pathId: 982f3f240464b76e9444a459acaf33ee860bc86f3827f03a9ecc863f3bb62ddb
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s0
```

10.

```text
text: 今天我们团队要讨论候选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
pathId: 982f3f240464b76e9444a459acaf33ee860bc86f3827f03a9ecc863f3bb62ddb
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s1
```

11.

```text
text: 今天我们团队要讨论后选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
pathId: 982f3f240464b76e9444a459acaf33ee860bc86f3827f03a9ecc863f3bb62ddb
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s2
```

12.

```text
text: 今天我们团队要讨论候选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
pathId: 982f3f240464b76e9444a459acaf33ee860bc86f3827f03a9ecc863f3bb62ddb
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s3
```

13.

```text
text: 今天我们团队要讨论后选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
pathId: 982f3f240464b76e9444a459acaf33ee860bc86f3827f03a9ecc863f3bb62ddb
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s4
```

14.

```text
text: 今天我们团队要讨论候选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
pathId: 982f3f240464b76e9444a459acaf33ee860bc86f3827f03a9ecc863f3bb62ddb
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s5
```

15.

```text
text: 今天我们团队要讨论后选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
pathId: 982f3f240464b76e9444a459acaf33ee860bc86f3827f03a9ecc863f3bb62ddb
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s6
```

16.

```text
text: 今天我们团队要讨论后选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
pathId: 982f3f240464b76e9444a459acaf33ee860bc86f3827f03a9ecc863f3bb62ddb
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s7
```

### D. CrossPath Output

Count: 8

1.

```text
text: 今天我们团队要讨论候选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
keptFromPath: e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 今天我们团队要讨论候选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
keptFromPath: e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s1
```

3.

```text
text: 今天我们团队要讨论后选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
keptFromPath: e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s2
```

4.

```text
text: 今天我们团队要讨论候选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
keptFromPath: e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s3
```

5.

```text
text: 今天我们团队要讨论后选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
keptFromPath: e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s4
```

6.

```text
text: 今天我们团队要讨论候选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
keptFromPath: e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s5
```

7.

```text
text: 今天我们团队要讨论后选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
keptFromPath: e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s6
```

8.

```text
text: 今天我们团队要讨论后选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
keptFromPath: e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s7
```

### E. CrossPath 删除项

```text
Dropped Text: 今天我们团队要讨论候选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
Source Sentence: p1_b0_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 今天我们团队要讨论候选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
```

```text
Dropped Text: 今天我们团队要讨论候选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
Source Sentence: p1_b0_s1
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 今天我们团队要讨论候选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
```

```text
Dropped Text: 今天我们团队要讨论后选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
Source Sentence: p1_b0_s2
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 今天我们团队要讨论后选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
```

```text
Dropped Text: 今天我们团队要讨论候选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
Source Sentence: p1_b0_s3
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 今天我们团队要讨论候选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
```

```text
Dropped Text: 今天我们团队要讨论后选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
Source Sentence: p1_b0_s4
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 今天我们团队要讨论后选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
```

```text
Dropped Text: 今天我们团队要讨论候选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
Source Sentence: p1_b0_s5
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 今天我们团队要讨论候选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
```

```text
Dropped Text: 今天我们团队要讨论后选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
Source Sentence: p1_b0_s6
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 今天我们团队要讨论后选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
```

```text
Dropped Text: 今天我们团队要讨论后选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
Source Sentence: p1_b0_s7
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 今天我们团队要讨论后选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
```

### F. KenLM Input

KenLM Input Count: 8

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
今天我们团队要讨论候选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
```

2.

```text
今天我们团队要讨论候选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
```

3.

```text
今天我们团队要讨论后选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
```

4.

```text
今天我们团队要讨论候选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
```

5.

```text
今天我们团队要讨论后选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
```

6.

```text
今天我们团队要讨论候选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
```

7.

```text
今天我们团队要讨论后选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
```

8.

```text
今天我们团队要讨论后选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8","bucketDomain":"tech_ai","count":8},{"pathId":"982f3f240464b76e9444a459acaf33ee860bc86f3827f03a9ecc863f3bb62ddb","bucketDomain":"tech_ai","count":8}]
crossPathInputCount: 16
crossPathOutputCount: 8
kenlmInputCount: 8
CrossPath Input == Assembly total: YES (16 vs 16)
KenLM Input == CrossPath Output texts: YES
```

---

## Case d200

<a id="case-d200"></a>

### Case 基础信息

```text
Case ID: d200
Raw Text: 这次发布我们先对齐上线计划窗口，后选生城模块需要联调，别漏掉回归。
Path Count: 2
Bucket Count: 2
```

### A. 每个 Path 的 Bucket 候选句

#### Path: `d18e38f8936e3dae9107ea8e2acaf78da3b2472127b9644ea2be67380e9844d7`

Bucket: `tech_ai` (`p0_b0`)

Assembly Sentences:

1.

```text
这次发布我们先对齐上线计划窗口，候选生城模块需要联调，别漏掉回归。
```

- sentenceId: `p0_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 14.4

2.

```text
这次发布我们先对齐上线计划窗口，后选生城模块需要联调，别漏掉回归。
```

- sentenceId: `p0_b0_s1`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 2
- assemblyScore: 11.98

#### Path: `d0727a8e1c03785b04ed2877ce853d0488af5bbfebedbe740226ff2cb15c2120`

Bucket: `tech_ai` (`p1_b0`)

Assembly Sentences:

1.

```text
这次发布我们先对齐上线计划窗口，候选生城模块需要联调，别漏掉回归。
```

- sentenceId: `p1_b0_s0`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 1
- assemblyScore: 11.620000000000001

2.

```text
这次发布我们先对齐上线计划窗口，后选生城模块需要联调，别漏掉回归。
```

- sentenceId: `p1_b0_s1`
- category: `MULTI_SPAN_REPLACEMENT`
- assemblyRank: 2
- assemblyScore: 9.200000000000001

### B. Bucket 内去重 / 截断

```text
No bucket-level exact-text drop list with dropped full sentences in this trace.
If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).
```

### C. CrossPath Input

Count: 4

1.

```text
text: 这次发布我们先对齐上线计划窗口，候选生城模块需要联调，别漏掉回归。
pathId: d18e38f8936e3dae9107ea8e2acaf78da3b2472127b9644ea2be67380e9844d7
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 这次发布我们先对齐上线计划窗口，后选生城模块需要联调，别漏掉回归。
pathId: d18e38f8936e3dae9107ea8e2acaf78da3b2472127b9644ea2be67380e9844d7
bucketDomain: tech_ai
sourceSentenceId: p0_b0_s1
```

3.

```text
text: 这次发布我们先对齐上线计划窗口，候选生城模块需要联调，别漏掉回归。
pathId: d0727a8e1c03785b04ed2877ce853d0488af5bbfebedbe740226ff2cb15c2120
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s0
```

4.

```text
text: 这次发布我们先对齐上线计划窗口，后选生城模块需要联调，别漏掉回归。
pathId: d0727a8e1c03785b04ed2877ce853d0488af5bbfebedbe740226ff2cb15c2120
bucketDomain: tech_ai
sourceSentenceId: p1_b0_s1
```

### D. CrossPath Output

Count: 2

1.

```text
text: 这次发布我们先对齐上线计划窗口，候选生城模块需要联调，别漏掉回归。
keptFromPath: d18e38f8936e3dae9107ea8e2acaf78da3b2472127b9644ea2be67380e9844d7
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s0
```

2.

```text
text: 这次发布我们先对齐上线计划窗口，后选生城模块需要联调，别漏掉回归。
keptFromPath: d18e38f8936e3dae9107ea8e2acaf78da3b2472127b9644ea2be67380e9844d7
keptFromBucket: p0_b0
sourceSentenceId: p0_b0_s1
```

### E. CrossPath 删除项

```text
Dropped Text: 这次发布我们先对齐上线计划窗口，候选生城模块需要联调，别漏掉回归。
Source Sentence: p1_b0_s0
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 这次发布我们先对齐上线计划窗口，候选生城模块需要联调，别漏掉回归。
```

```text
Dropped Text: 这次发布我们先对齐上线计划窗口，后选生城模块需要联调，别漏掉回归。
Source Sentence: p1_b0_s1
Reason: EXACT_TEXT_DUPLICATE
Kept Equivalent Sentence: 这次发布我们先对齐上线计划窗口，后选生城模块需要联调，别漏掉回归。
```

### F. KenLM Input

KenLM Input Count: 2

KenLM Input 是否与 CrossPath Output 完全一致: **YES**

1.

```text
这次发布我们先对齐上线计划窗口，候选生城模块需要联调，别漏掉回归。
```

2.

```text
这次发布我们先对齐上线计划窗口，后选生城模块需要联调，别漏掉回归。
```

### G. KenLM 分数

```text
NOT AVAILABLE
```

（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）

### H. 最终输出

```text
Final Selected Text: NOT AVAILABLE
Selection Reason: NOT AVAILABLE
```

### 完整性对账

```text
assemblySentenceCountByBucket: [{"pathId":"d18e38f8936e3dae9107ea8e2acaf78da3b2472127b9644ea2be67380e9844d7","bucketDomain":"tech_ai","count":2},{"pathId":"d0727a8e1c03785b04ed2877ce853d0488af5bbfebedbe740226ff2cb15c2120","bucketDomain":"tech_ai","count":2}]
crossPathInputCount: 4
crossPathOutputCount: 2
kenlmInputCount: 2
CrossPath Input == Assembly total: YES (4 vs 4)
KenLM Input == CrossPath Output texts: YES
```

---

## 9. Multi-Candidate Case Index

见: `docs/tone-v2/_audit_scratch/dialog200_candidate_sentence_export/dialog200_multi_candidate_cases.md`（75 cases）

- d007 (KenLM=2)
- d009 (KenLM=2)
- d013 (KenLM=2)
- d014 (KenLM=2)
- d019 (KenLM=8)
- d020 (KenLM=2)
- d023 (KenLM=3)
- d025 (KenLM=2)
- d027 (KenLM=2)
- d029 (KenLM=4)
- d030 (KenLM=2)
- d033 (KenLM=2)
- d036 (KenLM=2)
- d041 (KenLM=3)
- d043 (KenLM=2)
- d044 (KenLM=3)
- d045 (KenLM=4)
- d052 (KenLM=2)
- d053 (KenLM=3)
- d054 (KenLM=3)
- d058 (KenLM=2)
- d059 (KenLM=2)
- d064 (KenLM=8)
- d065 (KenLM=2)
- d068 (KenLM=3)
- d070 (KenLM=2)
- d072 (KenLM=2)
- d074 (KenLM=4)
- d075 (KenLM=2)
- d078 (KenLM=2)
- d081 (KenLM=2)
- d086 (KenLM=3)
- d088 (KenLM=2)
- d089 (KenLM=3)
- d090 (KenLM=4)
- d097 (KenLM=2)
- d103 (KenLM=2)
- d104 (KenLM=2)
- d109 (KenLM=8)
- d110 (KenLM=2)
- d113 (KenLM=3)
- d115 (KenLM=2)
- d117 (KenLM=2)
- d119 (KenLM=4)
- d120 (KenLM=2)
- d123 (KenLM=2)
- d126 (KenLM=2)
- d131 (KenLM=3)
- d133 (KenLM=2)
- d134 (KenLM=3)
- d135 (KenLM=4)
- d142 (KenLM=2)
- d143 (KenLM=3)
- d144 (KenLM=3)
- d148 (KenLM=2)
- d149 (KenLM=2)
- d154 (KenLM=8)
- d155 (KenLM=2)
- d158 (KenLM=3)
- d160 (KenLM=2)
- d162 (KenLM=2)
- d164 (KenLM=4)
- d165 (KenLM=2)
- d168 (KenLM=2)
- d171 (KenLM=2)
- d176 (KenLM=3)
- d178 (KenLM=2)
- d179 (KenLM=3)
- d180 (KenLM=4)
- d187 (KenLM=2)
- d189 (KenLM=2)
- d193 (KenLM=2)
- d194 (KenLM=2)
- d199 (KenLM=8)
- d200 (KenLM=2)

## 10. 16-Candidate Case Index

见: `docs/tone-v2/_audit_scratch/dialog200_candidate_sentence_export/dialog200_candidate_cap_cases.md`（0 cases）

Max KenLM Input observed: **8** (d019). No case reached cap=16 in this trace.

## 11. Missing Trace Inventory

E1 missing files: none

## 12. Count Reconciliation

```text
Assembly total sentences: 550
CrossPath input total: 550
CrossPath output total: 337
KenLM input total: 337
Cases with Assembly≠CrossPathInput: none
```

## 13. CrossPath vs KenLM Input Reconciliation

Cases with text mismatch (E6): none

## 14. Exception Inventory

- **E1**: 0
- **E2**: 0
- **E3**: 0
- **E4**: 0
- **E5**: 0
- **E6**: 0
- **E7**: 0
- **E8**: 0
- **E9**: 0
- **E10**: 0

## 15. Final Export Conclusion

```text
EXPORT_COMPLETE_FROM_EXISTING_TRACE

导出 Case 数: 200
单候选 Case 数: 125
多候选 Case 数: 75
KenLM Input 总句数: 337
最大单 Case 候选数: 8 (d019)
缺失或异常 Case ID: none
```
