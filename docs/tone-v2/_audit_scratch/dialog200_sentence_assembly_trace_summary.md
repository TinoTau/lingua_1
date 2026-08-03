# dialog_200 Sentence Assembly Full Trace — 人工审阅清单

本文件只列出值得人工看的 Case。逐 Case 全文见 `dialog200_sentence_assembly_trace/NNN.md`。

本轮只观察，不修复。

---

## A. 只有一条 Assembly

### d001 → [001.md](./dialog200_sentence_assembly_trace/001.md)

Raw:

```text
你好，我想点一杯热拿铁，中杯，少糖。顺便问一下今天有蓝莓马芬吗？
```

为什么只有一句:

- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 你好，我想点一杯热拿铁，中杯，少糖。顺便问一下今天有蓝莓马芬吗？

### d002 → [002.md](./dialog200_sentence_assembly_trace/002.md)

Raw:

```text
麻烦帮我做一杯美式带走，大杯就行，谢谢。
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 麻烦帮我做一杯美式带走，大杯就行，谢谢。

### d003 → [003.md](./dialog200_sentence_assembly_trace/003.md)

Raw:

```text
请问这款燕麦拿铁可以少冰吗？我赶时间，小杯。
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 请问这款燕麦拿铁可以少冰吗？我赶时间，小杯。

### d004 → [004.md](./dialog200_sentence_assembly_trace/004.md)

Raw:

```text
小陈，客户反馈翻译引擎接口报错，我们能不能加缓存，下午三点前把结论发群里？
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 小陈，客户反馈翻译引擎接口报错，我们能不能加缓存，下午三点前把结论发群里？

### d005 → [005.md](./dialog200_sentence_assembly_trace/005.md)

Raw:

```text
今天的站会先过一下订单中台进度，内存占用高这块需要限流保护，大家看一下风险。
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 今天的站会先过一下订单中台进度，内存占用高这块需要限流保护，大家看一下风险。

### d006 → [006.md](./dialog200_sentence_assembly_trace/006.md)

Raw:

```text
跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。
```

为什么只有一句:

- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。

### d008 → [008.md](./dialog200_sentence_assembly_trace/008.md)

Raw:

```text
麻烦送我到国贸三期南门，大概多久能到？我十点十分有个电话会。
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 麻烦送我到国贸三期南门，大概多久能到？我十点十分有个电话会。

### d010 → [010.md](./dialog200_sentence_assembly_trace/010.md)

Raw:

```text
医生您好，我这两天头痛，想开点药并做个血常规。
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 医生您好，我这两天头痛，想开点药并做个血常规。

### d011 → [011.md](./dialog200_sentence_assembly_trace/011.md)

Raw:

```text
挂号处请问内科还有号吗？我胃不舒服，昨晚开始的。
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 挂号处请问内科还有号吗？我胃不舒服，昨晚开始的。

### d012 → [012.md](./dialog200_sentence_assembly_trace/012.md)

Raw:

```text
这个检查报告什么时候能出？我过敏发痒，需要请假休息吗？
```

为什么只有一句:

- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 这个检查报告什么时候能出？我过敏发痒，需要请假休息吗？

### d015 → [015.md](./dialog200_sentence_assembly_trace/015.md)

Raw:

```text
我想对比一下这两款订单中台的价格，会员日能再减一点吗？
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 我想对比一下这两款订单中台的价格，会员日能再减一点吗？

### d016 → [016.md](./dialog200_sentence_assembly_trace/016.md)

Raw:

```text
周末要不要去江边骑行？天气预报说周日多云，记得带水。
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 周末要不要去江边骑行？天气预报说周日多云，记得带水。

### d017 → [017.md](./dialog200_sentence_assembly_trace/017.md)

Raw:

```text
晚上一起吃饭吗？我知道一家川菜不错，大概七点到。
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 晚上一起吃饭吗？我知道一家川菜不错，大概七点到。

### d018 → [018.md](./dialog200_sentence_assembly_trace/018.md)

Raw:

```text
你最近忙不忙？想找你看下手机备份怎么设置。
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 你最近忙不忙？想找你看下手机备份怎么设置。

### d021 → [021.md](./dialog200_sentence_assembly_trace/021.md)

Raw:

```text
会上提到候选生成链路要加监控，上线计划文档我下午更新一版。
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 会上提到候选生成链路要加监控，上线计划文档我下午更新一版。

### d022 → [022.md](./dialog200_sentence_assembly_trace/022.md)

Raw:

```text
您好，我订单显示已发货但物流三天没更新，能帮我查一下吗？
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 您好，我订单显示已发货但物流三天没更新，能帮我查一下吗？

### d024 → [024.md](./dialog200_sentence_assembly_trace/024.md)

Raw:

```text
发票抬头开错了，能重新开具电子发票吗？
```

为什么只有一句:

- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 发票抬头开错了，能重新开具电子发票吗？

### d026 → [026.md](./dialog200_sentence_assembly_trace/026.md)

Raw:

```text
你如何看待跨团队协作？遇到需求变更一般怎么处理？
```

为什么只有一句:

- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 你如何看待跨团队协作？遇到需求变更一般怎么处理？

### d028 → [028.md](./dialog200_sentence_assembly_trace/028.md)

Raw:

```text
老师，这道题的解题步骤能不能再讲一遍？我没听懂第二点。
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 老师，这道题的解题步骤能不能再讲一遍？我没听懂第二点。

### d031 → [031.md](./dialog200_sentence_assembly_trace/031.md)

Raw:

```text
我预订的是大床房，能安排安静一点的楼层吗？
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 我预订的是大床房，能安排安静一点的楼层吗？

### d032 → [032.md](./dialog200_sentence_assembly_trace/032.md)

Raw:

```text
早餐几点开始？退房可以延迟到下午两点吗？
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 早餐几点开始？退房可以延迟到下午两点吗？

### d034 → [034.md](./dialog200_sentence_assembly_trace/034.md)

Raw:

```text
我想开通短信提醒，需要带什么证件？
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 我想开通短信提醒，需要带什么证件？

### d035 → [035.md](./dialog200_sentence_assembly_trace/035.md)

Raw:

```text
这笔转账显示处理中，大概多久能到账？
```

为什么只有一句:

- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 这笔转账显示处理中，大概多久能到账？

### d037 → [037.md](./dialog200_sentence_assembly_trace/037.md)

Raw:

```text
两位，靠窗有位置吗？不要香菜，微辣就行。
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 两位，靠窗有位置吗？不要香菜，微辣就行。

### d038 → [038.md](./dialog200_sentence_assembly_trace/038.md)

Raw:

```text
这道菜大概要等多久？我们先点一份凉菜和一壶茶。
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 这道菜大概要等多久？我们先点一份凉菜和一壶茶。

### d039 → [039.md](./dialog200_sentence_assembly_trace/039.md)

Raw:

```text
可以打包吗？顺便结一下账，能扫码支付吗？
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 可以打包吗？顺便结一下账，能扫码支付吗？

### d040 → [040.md](./dialog200_sentence_assembly_trace/040.md)

Raw:

```text
私教课还剩几次？能帮我约明天晚上七点吗？
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 私教课还剩几次？能帮我约明天晚上七点吗？

### d042 → [042.md](./dialog200_sentence_assembly_trace/042.md)

Raw:

```text
游泳次卡本月月底到期，续费有优惠吗？
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 游泳次卡本月月底到期，续费有优惠吗？

### d046 → [046.md](./dialog200_sentence_assembly_trace/046.md)

Raw:

```text
你好，我想点一杯卡布奇诺，中杯，正常糖。顺便问一下今天有芝士蛋糕吗？
```

为什么只有一句:

- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 你好，我想点一杯卡布奇诺，中杯，正常糖。顺便问一下今天有芝士蛋糕吗？

### d047 → [047.md](./dialog200_sentence_assembly_trace/047.md)

Raw:

```text
麻烦帮我做一杯红茶带走，大杯就行，谢谢。
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 麻烦帮我做一杯红茶带走，大杯就行，谢谢。

### d048 → [048.md](./dialog200_sentence_assembly_trace/048.md)

Raw:

```text
请问这款热巧克力可以少冰吗？我赶时间，小杯。
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 请问这款热巧克力可以少冰吗？我赶时间，小杯。

### d049 → [049.md](./dialog200_sentence_assembly_trace/049.md)

Raw:

```text
李工，客户反馈翻译引擎接口报错，我们能不能加缓存，下午三点前把结论发群里？
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 李工，客户反馈翻译引擎接口报错，我们能不能加缓存，下午三点前把结论发群里？

### d050 → [050.md](./dialog200_sentence_assembly_trace/050.md)

Raw:

```text
今天的站会先过一下订单中台进度，内存占用高这块需要限流保护，大家看一下风险。
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 今天的站会先过一下订单中台进度，内存占用高这块需要限流保护，大家看一下风险。

### d051 → [051.md](./dialog200_sentence_assembly_trace/051.md)

Raw:

```text
跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。
```

为什么只有一句:

- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。

### d055 → [055.md](./dialog200_sentence_assembly_trace/055.md)

Raw:

```text
医生您好，我这两天嗓子疼，想开点药并做个血常规。
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 医生您好，我这两天嗓子疼，想开点药并做个血常规。

### d056 → [056.md](./dialog200_sentence_assembly_trace/056.md)

Raw:

```text
挂号处请问内科还有号吗？我低烧，昨晚开始的。
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 挂号处请问内科还有号吗？我低烧，昨晚开始的。

### d057 → [057.md](./dialog200_sentence_assembly_trace/057.md)

Raw:

```text
这个检查报告什么时候能出？我咳嗽，需要请假休息吗？
```

为什么只有一句:

- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 这个检查报告什么时候能出？我咳嗽，需要请假休息吗？

### d060 → [060.md](./dialog200_sentence_assembly_trace/060.md)

Raw:

```text
我想对比一下这两款订单中台的价格，会员日能再减一点吗？
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 我想对比一下这两款订单中台的价格，会员日能再减一点吗？

### d061 → [061.md](./dialog200_sentence_assembly_trace/061.md)

Raw:

```text
周末要不要去江边骑行？天气预报说周日多云，记得带水。
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 周末要不要去江边骑行？天气预报说周日多云，记得带水。

### d062 → [062.md](./dialog200_sentence_assembly_trace/062.md)

Raw:

```text
晚上一起吃饭吗？我知道一家川菜不错，大概七点到。
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 晚上一起吃饭吗？我知道一家川菜不错，大概七点到。

### d063 → [063.md](./dialog200_sentence_assembly_trace/063.md)

Raw:

```text
你最近忙不忙？想找你看下手机备份怎么设置。
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 你最近忙不忙？想找你看下手机备份怎么设置。

### d066 → [066.md](./dialog200_sentence_assembly_trace/066.md)

Raw:

```text
会上提到候选生成链路要加监控，上线计划文档我下午更新一版。
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 会上提到候选生成链路要加监控，上线计划文档我下午更新一版。

### d067 → [067.md](./dialog200_sentence_assembly_trace/067.md)

Raw:

```text
您好，我订单显示已发货但物流三天没更新，能帮我查一下吗？
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 您好，我订单显示已发货但物流三天没更新，能帮我查一下吗？

### d069 → [069.md](./dialog200_sentence_assembly_trace/069.md)

Raw:

```text
发票抬头开错了，能重新开具电子发票吗？
```

为什么只有一句:

- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 发票抬头开错了，能重新开具电子发票吗？

### d071 → [071.md](./dialog200_sentence_assembly_trace/071.md)

Raw:

```text
你如何看待跨团队协作？遇到需求变更一般怎么处理？
```

为什么只有一句:

- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 你如何看待跨团队协作？遇到需求变更一般怎么处理？

### d073 → [073.md](./dialog200_sentence_assembly_trace/073.md)

Raw:

```text
老师，这道题的解题步骤能不能再讲一遍？我没听懂第二点。
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 老师，这道题的解题步骤能不能再讲一遍？我没听懂第二点。

### d076 → [076.md](./dialog200_sentence_assembly_trace/076.md)

Raw:

```text
我预订的是大床房，能安排安静一点的楼层吗？
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 我预订的是大床房，能安排安静一点的楼层吗？

### d077 → [077.md](./dialog200_sentence_assembly_trace/077.md)

Raw:

```text
早餐几点开始？退房可以延迟到下午两点吗？
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 早餐几点开始？退房可以延迟到下午两点吗？

### d079 → [079.md](./dialog200_sentence_assembly_trace/079.md)

Raw:

```text
我想开通短信提醒，需要带什么证件？
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 我想开通短信提醒，需要带什么证件？

### d080 → [080.md](./dialog200_sentence_assembly_trace/080.md)

Raw:

```text
这笔转账显示处理中，大概多久能到账？
```

为什么只有一句:

- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 这笔转账显示处理中，大概多久能到账？

### d082 → [082.md](./dialog200_sentence_assembly_trace/082.md)

Raw:

```text
两位，靠窗有位置吗？不要香菜，微辣就行。
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 两位，靠窗有位置吗？不要香菜，微辣就行。

### d083 → [083.md](./dialog200_sentence_assembly_trace/083.md)

Raw:

```text
这道菜大概要等多久？我们先点一份凉菜和一壶茶。
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 这道菜大概要等多久？我们先点一份凉菜和一壶茶。

### d084 → [084.md](./dialog200_sentence_assembly_trace/084.md)

Raw:

```text
可以打包吗？顺便结一下账，能扫码支付吗？
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 可以打包吗？顺便结一下账，能扫码支付吗？

### d085 → [085.md](./dialog200_sentence_assembly_trace/085.md)

Raw:

```text
私教课还剩几次？能帮我约明天晚上七点吗？
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 私教课还剩几次？能帮我约明天晚上七点吗？

### d087 → [087.md](./dialog200_sentence_assembly_trace/087.md)

Raw:

```text
游泳次卡本月月底到期，续费有优惠吗？
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 游泳次卡本月月底到期，续费有优惠吗？

### d091 → [091.md](./dialog200_sentence_assembly_trace/091.md)

Raw:

```text
你好，我想点一杯燕麦拿铁，中杯，无糖。顺便问一下今天有贝果吗？
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 你好，我想点一杯燕麦拿铁，中杯，无糖。顺便问一下今天有贝果吗？

### d092 → [092.md](./dialog200_sentence_assembly_trace/092.md)

Raw:

```text
麻烦帮我做一杯抹茶拿铁带走，大杯就行，谢谢。
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 麻烦帮我做一杯抹茶拿铁带走，大杯就行，谢谢。

### d093 → [093.md](./dialog200_sentence_assembly_trace/093.md)

Raw:

```text
请问这款冰美式可以少冰吗？我赶时间，小杯。
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 请问这款冰美式可以少冰吗？我赶时间，小杯。

### d094 → [094.md](./dialog200_sentence_assembly_trace/094.md)

Raw:

```text
小陈，客户反馈翻译引擎接口报错，我们能不能加缓存，下午三点前把结论发群里？
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 小陈，客户反馈翻译引擎接口报错，我们能不能加缓存，下午三点前把结论发群里？

### d095 → [095.md](./dialog200_sentence_assembly_trace/095.md)

Raw:

```text
今天的站会先过一下订单中台进度，内存占用高这块需要限流保护，大家看一下风险。
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 今天的站会先过一下订单中台进度，内存占用高这块需要限流保护，大家看一下风险。

### d096 → [096.md](./dialog200_sentence_assembly_trace/096.md)

Raw:

```text
跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。
```

为什么只有一句:

- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。

### d098 → [098.md](./dialog200_sentence_assembly_trace/098.md)

Raw:

```text
麻烦送我到国贸三期南门，大概多久能到？我十点十分有个电话会。
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 麻烦送我到国贸三期南门，大概多久能到？我十点十分有个电话会。

### d099 → [099.md](./dialog200_sentence_assembly_trace/099.md)

Raw:

```text
去望京SOHO，不走机场高速可以吗？那边现在堵不堵？
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 去望京SOHO，不走机场高速可以吗？那边现在堵不堵？

### d100 → [100.md](./dialog200_sentence_assembly_trace/100.md)

Raw:

```text
医生您好，我这两天头痛，想开点药并做个血常规。
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 医生您好，我这两天头痛，想开点药并做个血常规。

### d101 → [101.md](./dialog200_sentence_assembly_trace/101.md)

Raw:

```text
挂号处请问内科还有号吗？我胃不舒服，昨晚开始的。
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 挂号处请问内科还有号吗？我胃不舒服，昨晚开始的。

### d102 → [102.md](./dialog200_sentence_assembly_trace/102.md)

Raw:

```text
这个检查报告什么时候能出？我过敏发痒，需要请假休息吗？
```

为什么只有一句:

- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 这个检查报告什么时候能出？我过敏发痒，需要请假休息吗？

### d105 → [105.md](./dialog200_sentence_assembly_trace/105.md)

Raw:

```text
我想对比一下这两款订单中台的价格，会员日能再减一点吗？
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 我想对比一下这两款订单中台的价格，会员日能再减一点吗？

### d106 → [106.md](./dialog200_sentence_assembly_trace/106.md)

Raw:

```text
周末要不要去江边骑行？天气预报说周日多云，记得带水。
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 周末要不要去江边骑行？天气预报说周日多云，记得带水。

### d107 → [107.md](./dialog200_sentence_assembly_trace/107.md)

Raw:

```text
晚上一起吃饭吗？我知道一家川菜不错，大概七点到。
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 晚上一起吃饭吗？我知道一家川菜不错，大概七点到。

### d108 → [108.md](./dialog200_sentence_assembly_trace/108.md)

Raw:

```text
你最近忙不忙？想找你看下手机备份怎么设置。
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 你最近忙不忙？想找你看下手机备份怎么设置。

### d111 → [111.md](./dialog200_sentence_assembly_trace/111.md)

Raw:

```text
会上提到候选生成链路要加监控，上线计划文档我下午更新一版。
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 会上提到候选生成链路要加监控，上线计划文档我下午更新一版。

### d112 → [112.md](./dialog200_sentence_assembly_trace/112.md)

Raw:

```text
您好，我订单显示已发货但物流三天没更新，能帮我查一下吗？
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 您好，我订单显示已发货但物流三天没更新，能帮我查一下吗？

### d114 → [114.md](./dialog200_sentence_assembly_trace/114.md)

Raw:

```text
发票抬头开错了，能重新开具电子发票吗？
```

为什么只有一句:

- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 发票抬头开错了，能重新开具电子发票吗？

### d116 → [116.md](./dialog200_sentence_assembly_trace/116.md)

Raw:

```text
你如何看待跨团队协作？遇到需求变更一般怎么处理？
```

为什么只有一句:

- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 你如何看待跨团队协作？遇到需求变更一般怎么处理？

### d118 → [118.md](./dialog200_sentence_assembly_trace/118.md)

Raw:

```text
老师，这道题的解题步骤能不能再讲一遍？我没听懂第二点。
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 老师，这道题的解题步骤能不能再讲一遍？我没听懂第二点。

### d121 → [121.md](./dialog200_sentence_assembly_trace/121.md)

Raw:

```text
我预订的是大床房，能安排安静一点的楼层吗？
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 我预订的是大床房，能安排安静一点的楼层吗？

### d122 → [122.md](./dialog200_sentence_assembly_trace/122.md)

Raw:

```text
早餐几点开始？退房可以延迟到下午两点吗？
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 早餐几点开始？退房可以延迟到下午两点吗？

### d124 → [124.md](./dialog200_sentence_assembly_trace/124.md)

Raw:

```text
我想开通短信提醒，需要带什么证件？
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 我想开通短信提醒，需要带什么证件？

### d125 → [125.md](./dialog200_sentence_assembly_trace/125.md)

Raw:

```text
这笔转账显示处理中，大概多久能到账？
```

为什么只有一句:

- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 这笔转账显示处理中，大概多久能到账？

### d127 → [127.md](./dialog200_sentence_assembly_trace/127.md)

Raw:

```text
两位，靠窗有位置吗？不要香菜，微辣就行。
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 两位，靠窗有位置吗？不要香菜，微辣就行。

### d128 → [128.md](./dialog200_sentence_assembly_trace/128.md)

Raw:

```text
这道菜大概要等多久？我们先点一份凉菜和一壶茶。
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 这道菜大概要等多久？我们先点一份凉菜和一壶茶。

### d129 → [129.md](./dialog200_sentence_assembly_trace/129.md)

Raw:

```text
可以打包吗？顺便结一下账，能扫码支付吗？
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 可以打包吗？顺便结一下账，能扫码支付吗？

### d130 → [130.md](./dialog200_sentence_assembly_trace/130.md)

Raw:

```text
私教课还剩几次？能帮我约明天晚上七点吗？
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 私教课还剩几次？能帮我约明天晚上七点吗？

### d132 → [132.md](./dialog200_sentence_assembly_trace/132.md)

Raw:

```text
游泳次卡本月月底到期，续费有优惠吗？
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 游泳次卡本月月底到期，续费有优惠吗？

### d136 → [136.md](./dialog200_sentence_assembly_trace/136.md)

Raw:

```text
你好，我想点一杯热巧克力，中杯，半糖。顺便问一下今天有曲奇吗？
```

为什么只有一句:

- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 你好，我想点一杯热巧克力，中杯，半糖。顺便问一下今天有曲奇吗？

### d137 → [137.md](./dialog200_sentence_assembly_trace/137.md)

Raw:

```text
麻烦帮我做一杯热拿铁带走，大杯就行，谢谢。
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 麻烦帮我做一杯热拿铁带走，大杯就行，谢谢。

### d138 → [138.md](./dialog200_sentence_assembly_trace/138.md)

Raw:

```text
请问这款美式可以少冰吗？我赶时间，小杯。
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 请问这款美式可以少冰吗？我赶时间，小杯。

### d139 → [139.md](./dialog200_sentence_assembly_trace/139.md)

Raw:

```text
李工，客户反馈翻译引擎接口报错，我们能不能加缓存，下午三点前把结论发群里？
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 李工，客户反馈翻译引擎接口报错，我们能不能加缓存，下午三点前把结论发群里？

### d140 → [140.md](./dialog200_sentence_assembly_trace/140.md)

Raw:

```text
今天的站会先过一下订单中台进度，内存占用高这块需要限流保护，大家看一下风险。
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 今天的站会先过一下订单中台进度，内存占用高这块需要限流保护，大家看一下风险。

### d141 → [141.md](./dialog200_sentence_assembly_trace/141.md)

Raw:

```text
跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。
```

为什么只有一句:

- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。

### d145 → [145.md](./dialog200_sentence_assembly_trace/145.md)

Raw:

```text
医生您好，我这两天嗓子疼，想开点药并做个血常规。
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 医生您好，我这两天嗓子疼，想开点药并做个血常规。

### d146 → [146.md](./dialog200_sentence_assembly_trace/146.md)

Raw:

```text
挂号处请问内科还有号吗？我低烧，昨晚开始的。
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 挂号处请问内科还有号吗？我低烧，昨晚开始的。

### d147 → [147.md](./dialog200_sentence_assembly_trace/147.md)

Raw:

```text
这个检查报告什么时候能出？我咳嗽，需要请假休息吗？
```

为什么只有一句:

- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 这个检查报告什么时候能出？我咳嗽，需要请假休息吗？

### d150 → [150.md](./dialog200_sentence_assembly_trace/150.md)

Raw:

```text
我想对比一下这两款订单中台的价格，会员日能再减一点吗？
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 我想对比一下这两款订单中台的价格，会员日能再减一点吗？

### d151 → [151.md](./dialog200_sentence_assembly_trace/151.md)

Raw:

```text
周末要不要去江边骑行？天气预报说周日多云，记得带水。
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 周末要不要去江边骑行？天气预报说周日多云，记得带水。

### d152 → [152.md](./dialog200_sentence_assembly_trace/152.md)

Raw:

```text
晚上一起吃饭吗？我知道一家川菜不错，大概七点到。
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 晚上一起吃饭吗？我知道一家川菜不错，大概七点到。

### d153 → [153.md](./dialog200_sentence_assembly_trace/153.md)

Raw:

```text
你最近忙不忙？想找你看下手机备份怎么设置。
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 你最近忙不忙？想找你看下手机备份怎么设置。

### d156 → [156.md](./dialog200_sentence_assembly_trace/156.md)

Raw:

```text
会上提到候选生成链路要加监控，上线计划文档我下午更新一版。
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 会上提到候选生成链路要加监控，上线计划文档我下午更新一版。

### d157 → [157.md](./dialog200_sentence_assembly_trace/157.md)

Raw:

```text
您好，我订单显示已发货但物流三天没更新，能帮我查一下吗？
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 您好，我订单显示已发货但物流三天没更新，能帮我查一下吗？

### d159 → [159.md](./dialog200_sentence_assembly_trace/159.md)

Raw:

```text
发票抬头开错了，能重新开具电子发票吗？
```

为什么只有一句:

- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 发票抬头开错了，能重新开具电子发票吗？

### d161 → [161.md](./dialog200_sentence_assembly_trace/161.md)

Raw:

```text
你如何看待跨团队协作？遇到需求变更一般怎么处理？
```

为什么只有一句:

- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 你如何看待跨团队协作？遇到需求变更一般怎么处理？

### d163 → [163.md](./dialog200_sentence_assembly_trace/163.md)

Raw:

```text
老师，这道题的解题步骤能不能再讲一遍？我没听懂第二点。
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 老师，这道题的解题步骤能不能再讲一遍？我没听懂第二点。

### d166 → [166.md](./dialog200_sentence_assembly_trace/166.md)

Raw:

```text
我预订的是大床房，能安排安静一点的楼层吗？
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 我预订的是大床房，能安排安静一点的楼层吗？

### d167 → [167.md](./dialog200_sentence_assembly_trace/167.md)

Raw:

```text
早餐几点开始？退房可以延迟到下午两点吗？
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 早餐几点开始？退房可以延迟到下午两点吗？

### d169 → [169.md](./dialog200_sentence_assembly_trace/169.md)

Raw:

```text
我想开通短信提醒，需要带什么证件？
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 我想开通短信提醒，需要带什么证件？

### d170 → [170.md](./dialog200_sentence_assembly_trace/170.md)

Raw:

```text
这笔转账显示处理中，大概多久能到账？
```

为什么只有一句:

- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 这笔转账显示处理中，大概多久能到账？

### d172 → [172.md](./dialog200_sentence_assembly_trace/172.md)

Raw:

```text
两位，靠窗有位置吗？不要香菜，微辣就行。
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 两位，靠窗有位置吗？不要香菜，微辣就行。

### d173 → [173.md](./dialog200_sentence_assembly_trace/173.md)

Raw:

```text
这道菜大概要等多久？我们先点一份凉菜和一壶茶。
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 这道菜大概要等多久？我们先点一份凉菜和一壶茶。

### d174 → [174.md](./dialog200_sentence_assembly_trace/174.md)

Raw:

```text
可以打包吗？顺便结一下账，能扫码支付吗？
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 可以打包吗？顺便结一下账，能扫码支付吗？

### d175 → [175.md](./dialog200_sentence_assembly_trace/175.md)

Raw:

```text
私教课还剩几次？能帮我约明天晚上七点吗？
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 私教课还剩几次？能帮我约明天晚上七点吗？

### d177 → [177.md](./dialog200_sentence_assembly_trace/177.md)

Raw:

```text
游泳次卡本月月底到期，续费有优惠吗？
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 游泳次卡本月月底到期，续费有优惠吗？

### d181 → [181.md](./dialog200_sentence_assembly_trace/181.md)

Raw:

```text
你好，我想点一杯冰美式，中杯，少糖。顺便问一下今天有蓝莓马芬吗？
```

为什么只有一句:

- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 你好，我想点一杯冰美式，中杯，少糖。顺便问一下今天有蓝莓马芬吗？

### d182 → [182.md](./dialog200_sentence_assembly_trace/182.md)

Raw:

```text
麻烦帮我做一杯卡布奇诺带走，大杯就行，谢谢。
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 麻烦帮我做一杯卡布奇诺带走，大杯就行，谢谢。

### d183 → [183.md](./dialog200_sentence_assembly_trace/183.md)

Raw:

```text
请问这款红茶可以少冰吗？我赶时间，小杯。
```

为什么只有一句:

- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 请问这款红茶可以少冰吗？我赶时间，小杯。

### d184 → [184.md](./dialog200_sentence_assembly_trace/184.md)

Raw:

```text
小陈，客户反馈翻译引擎接口报错，我们能不能加缓存，下午三点前把结论发群里？
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 小陈，客户反馈翻译引擎接口报错，我们能不能加缓存，下午三点前把结论发群里？

### d185 → [185.md](./dialog200_sentence_assembly_trace/185.md)

Raw:

```text
今天的站会先过一下订单中台进度，内存占用高这块需要限流保护，大家看一下风险。
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 今天的站会先过一下订单中台进度，内存占用高这块需要限流保护，大家看一下风险。

### d186 → [186.md](./dialog200_sentence_assembly_trace/186.md)

Raw:

```text
跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。
```

为什么只有一句:

- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。

### d188 → [188.md](./dialog200_sentence_assembly_trace/188.md)

Raw:

```text
麻烦送我到国贸三期南门，大概多久能到？我十点十分有个电话会。
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 麻烦送我到国贸三期南门，大概多久能到？我十点十分有个电话会。

### d190 → [190.md](./dialog200_sentence_assembly_trace/190.md)

Raw:

```text
医生您好，我这两天头痛，想开点药并做个血常规。
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 医生您好，我这两天头痛，想开点药并做个血常规。

### d191 → [191.md](./dialog200_sentence_assembly_trace/191.md)

Raw:

```text
挂号处请问内科还有号吗？我胃不舒服，昨晚开始的。
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 挂号处请问内科还有号吗？我胃不舒服，昨晚开始的。

### d192 → [192.md](./dialog200_sentence_assembly_trace/192.md)

Raw:

```text
这个检查报告什么时候能出？我过敏发痒，需要请假休息吗？
```

为什么只有一句:

- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 这个检查报告什么时候能出？我过敏发痒，需要请假休息吗？

### d195 → [195.md](./dialog200_sentence_assembly_trace/195.md)

Raw:

```text
我想对比一下这两款订单中台的价格，会员日能再减一点吗？
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 我想对比一下这两款订单中台的价格，会员日能再减一点吗？

### d196 → [196.md](./dialog200_sentence_assembly_trace/196.md)

Raw:

```text
周末要不要去江边骑行？天气预报说周日多云，记得带水。
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 周末要不要去江边骑行？天气预报说周日多云，记得带水。

### d197 → [197.md](./dialog200_sentence_assembly_trace/197.md)

Raw:

```text
晚上一起吃饭吗？我知道一家川菜不错，大概七点到。
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 晚上一起吃饭吗？我知道一家川菜不错，大概七点到。

### d198 → [198.md](./dialog200_sentence_assembly_trace/198.md)

Raw:

```text
你最近忙不忙？想找你看下手机备份怎么设置。
```

为什么只有一句:

- 只有一个 retainedDomain / base-only 桶
- 每个 Span 槽位仅 1 个 surface（含 canonical）
- 无多表面 Recall 进入 Assembly Grid
- Assembly 结果仅 ASR Raw

KenLM Input:

- 你最近忙不忙？想找你看下手机备份怎么设置。

## B. Assembly>1 但 KenLM=1

（无）

## C. Assembly 很多，CrossPath 去掉很多

### d001 → [001.md](./dialog200_sentence_assembly_trace/001.md)

Raw:

```text
你好，我想点一杯热拿铁，中杯，少糖。顺便问一下今天有蓝莓马芬吗？
```

去掉哪些:

- 你好，我想点一杯热拿铁，中杯，少糖。顺便问一下今天有蓝莓马芬吗？

为什么：exact-text first-wins dedup 和/或 global cap≤16 截断。

KenLM 剩余:

- 你好，我想点一杯热拿铁，中杯，少糖。顺便问一下今天有蓝莓马芬吗？

### d006 → [006.md](./dialog200_sentence_assembly_trace/006.md)

Raw:

```text
跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。
```

去掉哪些:

- 跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。

为什么：exact-text first-wins dedup 和/或 global cap≤16 截断。

KenLM 剩余:

- 跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。

### d012 → [012.md](./dialog200_sentence_assembly_trace/012.md)

Raw:

```text
这个检查报告什么时候能出？我过敏发痒，需要请假休息吗？
```

去掉哪些:

- 这个检查报告什么时候能出？我过敏发痒，需要请假休息吗？

为什么：exact-text first-wins dedup 和/或 global cap≤16 截断。

KenLM 剩余:

- 这个检查报告什么时候能出？我过敏发痒，需要请假休息吗？

### d019 → [019.md](./dialog200_sentence_assembly_trace/019.md)

Raw:

```text
今天我们团队要讨论后选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
```

去掉哪些:

- 今天我们团队要讨论候选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
- 今天我们团队要讨论候选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
- 今天我们团队要讨论后选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
- 今天我们团队要讨论候选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
- 今天我们团队要讨论后选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
- 今天我们团队要讨论候选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
- 今天我们团队要讨论后选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
- 今天我们团队要讨论后选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。

为什么：exact-text first-wins dedup 和/或 global cap≤16 截断。

KenLM 剩余:

- 今天我们团队要讨论候选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
- 今天我们团队要讨论候选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
- 今天我们团队要讨论后选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
- 今天我们团队要讨论候选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
- 今天我们团队要讨论后选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
- 今天我们团队要讨论候选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
- 今天我们团队要讨论后选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
- 今天我们团队要讨论后选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。

### d020 → [020.md](./dialog200_sentence_assembly_trace/020.md)

Raw:

```text
这次发布我们先对齐上线计划窗口，后选生城模块需要联调，别漏掉回归。
```

去掉哪些:

- 这次发布我们先对齐上线计划窗口，候选生城模块需要联调，别漏掉回归。
- 这次发布我们先对齐上线计划窗口，后选生城模块需要联调，别漏掉回归。

为什么：exact-text first-wins dedup 和/或 global cap≤16 截断。

KenLM 剩余:

- 这次发布我们先对齐上线计划窗口，候选生城模块需要联调，别漏掉回归。
- 这次发布我们先对齐上线计划窗口，后选生城模块需要联调，别漏掉回归。

### d023 → [023.md](./dialog200_sentence_assembly_trace/023.md)

Raw:

```text
想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。
```

去掉哪些:

- 想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。

为什么：exact-text first-wins dedup 和/或 global cap≤16 截断。

KenLM 剩余:

- 想改一下收货低脂，还来得及吗？麻烦尽快处理，谢谢。
- 想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。
- 想改一下收货地质，还来得及吗？麻烦尽快处理，谢谢。

### d041 → [041.md](./dialog200_sentence_assembly_trace/041.md)

Raw:

```text
更衣室柜子钥匙找不到了，前台能帮忙开一下吗？
```

去掉哪些:

- 更衣室柜子钥匙找不到了，前台能帮忙开一下吗？

为什么：exact-text first-wins dedup 和/或 global cap≤16 截断。

KenLM 剩余:

- 更医师柜子钥匙找不到了，前台能帮忙开一下吗？
- 更衣室柜子钥匙找不到了，前台能帮忙开一下吗？
- 更议室柜子钥匙找不到了，前台能帮忙开一下吗？

### d043 → [043.md](./dialog200_sentence_assembly_trace/043.md)

Raw:

```text
我们下午讨论后选声城方案，先把候选生成的接口文档补齐。
```

去掉哪些:

- 我们下午讨论候选声城方案，先把候选生成的接口文档补齐。
- 我们下午讨论后选声城方案，先把候选生成的接口文档补齐。

为什么：exact-text first-wins dedup 和/或 global cap≤16 截断。

KenLM 剩余:

- 我们下午讨论候选声城方案，先把候选生成的接口文档补齐。
- 我们下午讨论后选声城方案，先把候选生成的接口文档补齐。

### d044 → [044.md](./dialog200_sentence_assembly_trace/044.md)

Raw:

```text
这周的上线计花已经确认，上线计划评审安排在周四上午。
```

去掉哪些:

- 这周的上线计划已经确认，上线计划评审安排在周四上午。
- 这周的上线计花已经确认，上线计划评审安排在周四上午。

为什么：exact-text first-wins dedup 和/或 global cap≤16 截断。

KenLM 剩余:

- 这周的上线计划已经确认，上线计划评审安排在周四上午。
- 这周的上线计花已经确认，上线计划评审安排在周四上午。
- 这周的上线计花已经确认，上线计划评审安排在周四商务。

### d045 → [045.md](./dialog200_sentence_assembly_trace/045.md)

Raw:

```text
关于后选生城和上线计化，请按上线计划执行，有问题群里说。
```

去掉哪些:

- 关于候选生城和上线计划，请按上线计划执行，有问题群里说。
- 关于候选生城和上线计化，请按上线计划执行，有问题群里说。
- 关于后选生城和上线计划，请按上线计划执行，有问题群里说。
- 关于后选生城和上线计化，请按上线计划执行，有问题群里说。

为什么：exact-text first-wins dedup 和/或 global cap≤16 截断。

KenLM 剩余:

- 关于候选生城和上线计划，请按上线计划执行，有问题群里说。
- 关于候选生城和上线计化，请按上线计划执行，有问题群里说。
- 关于后选生城和上线计划，请按上线计划执行，有问题群里说。
- 关于后选生城和上线计化，请按上线计划执行，有问题群里说。

### d046 → [046.md](./dialog200_sentence_assembly_trace/046.md)

Raw:

```text
你好，我想点一杯卡布奇诺，中杯，正常糖。顺便问一下今天有芝士蛋糕吗？
```

去掉哪些:

- 你好，我想点一杯卡布奇诺，中杯，正常糖。顺便问一下今天有芝士蛋糕吗？

为什么：exact-text first-wins dedup 和/或 global cap≤16 截断。

KenLM 剩余:

- 你好，我想点一杯卡布奇诺，中杯，正常糖。顺便问一下今天有芝士蛋糕吗？

### d051 → [051.md](./dialog200_sentence_assembly_trace/051.md)

Raw:

```text
跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。
```

去掉哪些:

- 跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。

为什么：exact-text first-wins dedup 和/或 global cap≤16 截断。

KenLM 剩余:

- 跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。

### d064 → [064.md](./dialog200_sentence_assembly_trace/064.md)

Raw:

```text
今天我们团队要讨论后选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
```

去掉哪些:

- 今天我们团队要讨论候选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
- 今天我们团队要讨论候选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
- 今天我们团队要讨论后选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
- 今天我们团队要讨论候选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
- 今天我们团队要讨论后选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
- 今天我们团队要讨论候选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
- 今天我们团队要讨论后选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
- 今天我们团队要讨论后选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。

为什么：exact-text first-wins dedup 和/或 global cap≤16 截断。

KenLM 剩余:

- 今天我们团队要讨论候选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
- 今天我们团队要讨论候选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
- 今天我们团队要讨论后选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
- 今天我们团队要讨论候选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
- 今天我们团队要讨论后选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
- 今天我们团队要讨论候选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
- 今天我们团队要讨论后选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
- 今天我们团队要讨论后选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。

### d065 → [065.md](./dialog200_sentence_assembly_trace/065.md)

Raw:

```text
这次发布我们先对齐上线计划窗口，后选生城模块需要联调，别漏掉回归。
```

去掉哪些:

- 这次发布我们先对齐上线计划窗口，候选生城模块需要联调，别漏掉回归。
- 这次发布我们先对齐上线计划窗口，后选生城模块需要联调，别漏掉回归。

为什么：exact-text first-wins dedup 和/或 global cap≤16 截断。

KenLM 剩余:

- 这次发布我们先对齐上线计划窗口，候选生城模块需要联调，别漏掉回归。
- 这次发布我们先对齐上线计划窗口，后选生城模块需要联调，别漏掉回归。

### d068 → [068.md](./dialog200_sentence_assembly_trace/068.md)

Raw:

```text
想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。
```

去掉哪些:

- 想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。

为什么：exact-text first-wins dedup 和/或 global cap≤16 截断。

KenLM 剩余:

- 想改一下收货低脂，还来得及吗？麻烦尽快处理，谢谢。
- 想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。
- 想改一下收货地质，还来得及吗？麻烦尽快处理，谢谢。

### d086 → [086.md](./dialog200_sentence_assembly_trace/086.md)

Raw:

```text
更衣室柜子钥匙找不到了，前台能帮忙开一下吗？
```

去掉哪些:

- 更衣室柜子钥匙找不到了，前台能帮忙开一下吗？

为什么：exact-text first-wins dedup 和/或 global cap≤16 截断。

KenLM 剩余:

- 更医师柜子钥匙找不到了，前台能帮忙开一下吗？
- 更衣室柜子钥匙找不到了，前台能帮忙开一下吗？
- 更议室柜子钥匙找不到了，前台能帮忙开一下吗？

### d088 → [088.md](./dialog200_sentence_assembly_trace/088.md)

Raw:

```text
我们下午讨论后选声城方案，先把候选生成的接口文档补齐。
```

去掉哪些:

- 我们下午讨论候选声城方案，先把候选生成的接口文档补齐。
- 我们下午讨论后选声城方案，先把候选生成的接口文档补齐。

为什么：exact-text first-wins dedup 和/或 global cap≤16 截断。

KenLM 剩余:

- 我们下午讨论候选声城方案，先把候选生成的接口文档补齐。
- 我们下午讨论后选声城方案，先把候选生成的接口文档补齐。

### d089 → [089.md](./dialog200_sentence_assembly_trace/089.md)

Raw:

```text
这周的上线计花已经确认，上线计划评审安排在周四上午。
```

去掉哪些:

- 这周的上线计划已经确认，上线计划评审安排在周四上午。
- 这周的上线计花已经确认，上线计划评审安排在周四上午。

为什么：exact-text first-wins dedup 和/或 global cap≤16 截断。

KenLM 剩余:

- 这周的上线计划已经确认，上线计划评审安排在周四上午。
- 这周的上线计花已经确认，上线计划评审安排在周四上午。
- 这周的上线计花已经确认，上线计划评审安排在周四商务。

### d090 → [090.md](./dialog200_sentence_assembly_trace/090.md)

Raw:

```text
关于后选生城和上线计化，请按上线计划执行，有问题群里说。
```

去掉哪些:

- 关于候选生城和上线计划，请按上线计划执行，有问题群里说。
- 关于候选生城和上线计化，请按上线计划执行，有问题群里说。
- 关于后选生城和上线计划，请按上线计划执行，有问题群里说。
- 关于后选生城和上线计化，请按上线计划执行，有问题群里说。

为什么：exact-text first-wins dedup 和/或 global cap≤16 截断。

KenLM 剩余:

- 关于候选生城和上线计划，请按上线计划执行，有问题群里说。
- 关于候选生城和上线计化，请按上线计划执行，有问题群里说。
- 关于后选生城和上线计划，请按上线计划执行，有问题群里说。
- 关于后选生城和上线计化，请按上线计划执行，有问题群里说。

### d096 → [096.md](./dialog200_sentence_assembly_trace/096.md)

Raw:

```text
跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。
```

去掉哪些:

- 跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。

为什么：exact-text first-wins dedup 和/或 global cap≤16 截断。

KenLM 剩余:

- 跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。

### d102 → [102.md](./dialog200_sentence_assembly_trace/102.md)

Raw:

```text
这个检查报告什么时候能出？我过敏发痒，需要请假休息吗？
```

去掉哪些:

- 这个检查报告什么时候能出？我过敏发痒，需要请假休息吗？

为什么：exact-text first-wins dedup 和/或 global cap≤16 截断。

KenLM 剩余:

- 这个检查报告什么时候能出？我过敏发痒，需要请假休息吗？

### d109 → [109.md](./dialog200_sentence_assembly_trace/109.md)

Raw:

```text
今天我们团队要讨论后选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
```

去掉哪些:

- 今天我们团队要讨论候选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
- 今天我们团队要讨论候选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
- 今天我们团队要讨论后选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
- 今天我们团队要讨论候选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
- 今天我们团队要讨论后选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
- 今天我们团队要讨论候选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
- 今天我们团队要讨论后选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
- 今天我们团队要讨论后选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。

为什么：exact-text first-wins dedup 和/或 global cap≤16 截断。

KenLM 剩余:

- 今天我们团队要讨论候选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
- 今天我们团队要讨论候选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
- 今天我们团队要讨论后选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
- 今天我们团队要讨论候选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
- 今天我们团队要讨论后选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
- 今天我们团队要讨论候选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
- 今天我们团队要讨论后选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
- 今天我们团队要讨论后选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。

### d110 → [110.md](./dialog200_sentence_assembly_trace/110.md)

Raw:

```text
这次发布我们先对齐上线计划窗口，后选生城模块需要联调，别漏掉回归。
```

去掉哪些:

- 这次发布我们先对齐上线计划窗口，候选生城模块需要联调，别漏掉回归。
- 这次发布我们先对齐上线计划窗口，后选生城模块需要联调，别漏掉回归。

为什么：exact-text first-wins dedup 和/或 global cap≤16 截断。

KenLM 剩余:

- 这次发布我们先对齐上线计划窗口，候选生城模块需要联调，别漏掉回归。
- 这次发布我们先对齐上线计划窗口，后选生城模块需要联调，别漏掉回归。

### d113 → [113.md](./dialog200_sentence_assembly_trace/113.md)

Raw:

```text
想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。
```

去掉哪些:

- 想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。

为什么：exact-text first-wins dedup 和/或 global cap≤16 截断。

KenLM 剩余:

- 想改一下收货低脂，还来得及吗？麻烦尽快处理，谢谢。
- 想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。
- 想改一下收货地质，还来得及吗？麻烦尽快处理，谢谢。

### d131 → [131.md](./dialog200_sentence_assembly_trace/131.md)

Raw:

```text
更衣室柜子钥匙找不到了，前台能帮忙开一下吗？
```

去掉哪些:

- 更衣室柜子钥匙找不到了，前台能帮忙开一下吗？

为什么：exact-text first-wins dedup 和/或 global cap≤16 截断。

KenLM 剩余:

- 更医师柜子钥匙找不到了，前台能帮忙开一下吗？
- 更衣室柜子钥匙找不到了，前台能帮忙开一下吗？
- 更议室柜子钥匙找不到了，前台能帮忙开一下吗？

### d133 → [133.md](./dialog200_sentence_assembly_trace/133.md)

Raw:

```text
我们下午讨论后选声城方案，先把候选生成的接口文档补齐。
```

去掉哪些:

- 我们下午讨论候选声城方案，先把候选生成的接口文档补齐。
- 我们下午讨论后选声城方案，先把候选生成的接口文档补齐。

为什么：exact-text first-wins dedup 和/或 global cap≤16 截断。

KenLM 剩余:

- 我们下午讨论候选声城方案，先把候选生成的接口文档补齐。
- 我们下午讨论后选声城方案，先把候选生成的接口文档补齐。

### d134 → [134.md](./dialog200_sentence_assembly_trace/134.md)

Raw:

```text
这周的上线计花已经确认，上线计划评审安排在周四上午。
```

去掉哪些:

- 这周的上线计划已经确认，上线计划评审安排在周四上午。
- 这周的上线计花已经确认，上线计划评审安排在周四上午。

为什么：exact-text first-wins dedup 和/或 global cap≤16 截断。

KenLM 剩余:

- 这周的上线计划已经确认，上线计划评审安排在周四上午。
- 这周的上线计花已经确认，上线计划评审安排在周四上午。
- 这周的上线计花已经确认，上线计划评审安排在周四商务。

### d135 → [135.md](./dialog200_sentence_assembly_trace/135.md)

Raw:

```text
关于后选生城和上线计化，请按上线计划执行，有问题群里说。
```

去掉哪些:

- 关于候选生城和上线计划，请按上线计划执行，有问题群里说。
- 关于候选生城和上线计化，请按上线计划执行，有问题群里说。
- 关于后选生城和上线计划，请按上线计划执行，有问题群里说。
- 关于后选生城和上线计化，请按上线计划执行，有问题群里说。

为什么：exact-text first-wins dedup 和/或 global cap≤16 截断。

KenLM 剩余:

- 关于候选生城和上线计划，请按上线计划执行，有问题群里说。
- 关于候选生城和上线计化，请按上线计划执行，有问题群里说。
- 关于后选生城和上线计划，请按上线计划执行，有问题群里说。
- 关于后选生城和上线计化，请按上线计划执行，有问题群里说。

### d136 → [136.md](./dialog200_sentence_assembly_trace/136.md)

Raw:

```text
你好，我想点一杯热巧克力，中杯，半糖。顺便问一下今天有曲奇吗？
```

去掉哪些:

- 你好，我想点一杯热巧克力，中杯，半糖。顺便问一下今天有曲奇吗？

为什么：exact-text first-wins dedup 和/或 global cap≤16 截断。

KenLM 剩余:

- 你好，我想点一杯热巧克力，中杯，半糖。顺便问一下今天有曲奇吗？

### d141 → [141.md](./dialog200_sentence_assembly_trace/141.md)

Raw:

```text
跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。
```

去掉哪些:

- 跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。

为什么：exact-text first-wins dedup 和/或 global cap≤16 截断。

KenLM 剩余:

- 跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。

### d154 → [154.md](./dialog200_sentence_assembly_trace/154.md)

Raw:

```text
今天我们团队要讨论后选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
```

去掉哪些:

- 今天我们团队要讨论候选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
- 今天我们团队要讨论候选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
- 今天我们团队要讨论后选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
- 今天我们团队要讨论候选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
- 今天我们团队要讨论后选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
- 今天我们团队要讨论候选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
- 今天我们团队要讨论后选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
- 今天我们团队要讨论后选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。

为什么：exact-text first-wins dedup 和/或 global cap≤16 截断。

KenLM 剩余:

- 今天我们团队要讨论候选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
- 今天我们团队要讨论候选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
- 今天我们团队要讨论后选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
- 今天我们团队要讨论候选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
- 今天我们团队要讨论后选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
- 今天我们团队要讨论候选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
- 今天我们团队要讨论后选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
- 今天我们团队要讨论后选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。

### d155 → [155.md](./dialog200_sentence_assembly_trace/155.md)

Raw:

```text
这次发布我们先对齐上线计划窗口，后选生城模块需要联调，别漏掉回归。
```

去掉哪些:

- 这次发布我们先对齐上线计划窗口，候选生城模块需要联调，别漏掉回归。
- 这次发布我们先对齐上线计划窗口，后选生城模块需要联调，别漏掉回归。

为什么：exact-text first-wins dedup 和/或 global cap≤16 截断。

KenLM 剩余:

- 这次发布我们先对齐上线计划窗口，候选生城模块需要联调，别漏掉回归。
- 这次发布我们先对齐上线计划窗口，后选生城模块需要联调，别漏掉回归。

### d158 → [158.md](./dialog200_sentence_assembly_trace/158.md)

Raw:

```text
想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。
```

去掉哪些:

- 想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。

为什么：exact-text first-wins dedup 和/或 global cap≤16 截断。

KenLM 剩余:

- 想改一下收货低脂，还来得及吗？麻烦尽快处理，谢谢。
- 想改一下收货地址，还来得及吗？麻烦尽快处理，谢谢。
- 想改一下收货地质，还来得及吗？麻烦尽快处理，谢谢。

### d176 → [176.md](./dialog200_sentence_assembly_trace/176.md)

Raw:

```text
更衣室柜子钥匙找不到了，前台能帮忙开一下吗？
```

去掉哪些:

- 更衣室柜子钥匙找不到了，前台能帮忙开一下吗？

为什么：exact-text first-wins dedup 和/或 global cap≤16 截断。

KenLM 剩余:

- 更医师柜子钥匙找不到了，前台能帮忙开一下吗？
- 更衣室柜子钥匙找不到了，前台能帮忙开一下吗？
- 更议室柜子钥匙找不到了，前台能帮忙开一下吗？

### d178 → [178.md](./dialog200_sentence_assembly_trace/178.md)

Raw:

```text
我们下午讨论后选声城方案，先把候选生成的接口文档补齐。
```

去掉哪些:

- 我们下午讨论候选声城方案，先把候选生成的接口文档补齐。
- 我们下午讨论后选声城方案，先把候选生成的接口文档补齐。

为什么：exact-text first-wins dedup 和/或 global cap≤16 截断。

KenLM 剩余:

- 我们下午讨论候选声城方案，先把候选生成的接口文档补齐。
- 我们下午讨论后选声城方案，先把候选生成的接口文档补齐。

### d179 → [179.md](./dialog200_sentence_assembly_trace/179.md)

Raw:

```text
这周的上线计花已经确认，上线计划评审安排在周四上午。
```

去掉哪些:

- 这周的上线计划已经确认，上线计划评审安排在周四上午。
- 这周的上线计花已经确认，上线计划评审安排在周四上午。

为什么：exact-text first-wins dedup 和/或 global cap≤16 截断。

KenLM 剩余:

- 这周的上线计划已经确认，上线计划评审安排在周四上午。
- 这周的上线计花已经确认，上线计划评审安排在周四上午。
- 这周的上线计花已经确认，上线计划评审安排在周四商务。

### d180 → [180.md](./dialog200_sentence_assembly_trace/180.md)

Raw:

```text
关于后选生城和上线计化，请按上线计划执行，有问题群里说。
```

去掉哪些:

- 关于候选生城和上线计划，请按上线计划执行，有问题群里说。
- 关于候选生城和上线计化，请按上线计划执行，有问题群里说。
- 关于后选生城和上线计划，请按上线计划执行，有问题群里说。
- 关于后选生城和上线计化，请按上线计划执行，有问题群里说。

为什么：exact-text first-wins dedup 和/或 global cap≤16 截断。

KenLM 剩余:

- 关于候选生城和上线计划，请按上线计划执行，有问题群里说。
- 关于候选生城和上线计化，请按上线计划执行，有问题群里说。
- 关于后选生城和上线计划，请按上线计划执行，有问题群里说。
- 关于后选生城和上线计化，请按上线计划执行，有问题群里说。

### d181 → [181.md](./dialog200_sentence_assembly_trace/181.md)

Raw:

```text
你好，我想点一杯冰美式，中杯，少糖。顺便问一下今天有蓝莓马芬吗？
```

去掉哪些:

- 你好，我想点一杯冰美式，中杯，少糖。顺便问一下今天有蓝莓马芬吗？

为什么：exact-text first-wins dedup 和/或 global cap≤16 截断。

KenLM 剩余:

- 你好，我想点一杯冰美式，中杯，少糖。顺便问一下今天有蓝莓马芬吗？

### d186 → [186.md](./dialog200_sentence_assembly_trace/186.md)

Raw:

```text
跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。
```

去掉哪些:

- 跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。

为什么：exact-text first-wins dedup 和/或 global cap≤16 截断。

KenLM 剩余:

- 跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。

### d192 → [192.md](./dialog200_sentence_assembly_trace/192.md)

Raw:

```text
这个检查报告什么时候能出？我过敏发痒，需要请假休息吗？
```

去掉哪些:

- 这个检查报告什么时候能出？我过敏发痒，需要请假休息吗？

为什么：exact-text first-wins dedup 和/或 global cap≤16 截断。

KenLM 剩余:

- 这个检查报告什么时候能出？我过敏发痒，需要请假休息吗？

### d199 → [199.md](./dialog200_sentence_assembly_trace/199.md)

Raw:

```text
今天我们团队要讨论后选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
```

去掉哪些:

- 今天我们团队要讨论候选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
- 今天我们团队要讨论候选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
- 今天我们团队要讨论后选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
- 今天我们团队要讨论候选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
- 今天我们团队要讨论后选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
- 今天我们团队要讨论候选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
- 今天我们团队要讨论后选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
- 今天我们团队要讨论后选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。

为什么：exact-text first-wins dedup 和/或 global cap≤16 截断。

KenLM 剩余:

- 今天我们团队要讨论候选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
- 今天我们团队要讨论候选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
- 今天我们团队要讨论后选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
- 今天我们团队要讨论候选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
- 今天我们团队要讨论后选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
- 今天我们团队要讨论候选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
- 今天我们团队要讨论后选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
- 今天我们团队要讨论后选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。

### d200 → [200.md](./dialog200_sentence_assembly_trace/200.md)

Raw:

```text
这次发布我们先对齐上线计划窗口，后选生城模块需要联调，别漏掉回归。
```

去掉哪些:

- 这次发布我们先对齐上线计划窗口，候选生城模块需要联调，别漏掉回归。
- 这次发布我们先对齐上线计划窗口，后选生城模块需要联调，别漏掉回归。

为什么：exact-text first-wins dedup 和/或 global cap≤16 截断。

KenLM 剩余:

- 这次发布我们先对齐上线计划窗口，候选生城模块需要联调，别漏掉回归。
- 这次发布我们先对齐上线计划窗口，后选生城模块需要联调，别漏掉回归。

## D. Assembly 看起来离谱

### d019 → [019.md](./dialog200_sentence_assembly_trace/019.md)

Raw:

```text
今天我们团队要讨论后选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
```

离谱句:

- 今天我们团队要讨论候选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
- 今天我们团队要讨论候选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
- 今天我们团队要讨论后选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
- 今天我们团队要讨论候选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
- 今天我们团队要讨论后选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
- 今天我们团队要讨论候选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
- 今天我们团队要讨论后选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。

### d020 → [020.md](./dialog200_sentence_assembly_trace/020.md)

Raw:

```text
这次发布我们先对齐上线计划窗口，后选生城模块需要联调，别漏掉回归。
```

离谱句:

- 这次发布我们先对齐上线计划窗口，候选生城模块需要联调，别漏掉回归。

### d036 → [036.md](./dialog200_sentence_assembly_trace/036.md)

Raw:

```text
请问理财产品的风险等级在哪里查看？
```

离谱句:

- 请问理财产品的风险登机在哪里查看？

### d041 → [041.md](./dialog200_sentence_assembly_trace/041.md)

Raw:

```text
更衣室柜子钥匙找不到了，前台能帮忙开一下吗？
```

离谱句:

- 更医师柜子钥匙找不到了，前台能帮忙开一下吗？
- 更议室柜子钥匙找不到了，前台能帮忙开一下吗？

### d044 → [044.md](./dialog200_sentence_assembly_trace/044.md)

Raw:

```text
这周的上线计花已经确认，上线计划评审安排在周四上午。
```

离谱句:

- 这周的上线计花已经确认，上线计划评审安排在周四商务。

### d045 → [045.md](./dialog200_sentence_assembly_trace/045.md)

Raw:

```text
关于后选生城和上线计化，请按上线计划执行，有问题群里说。
```

离谱句:

- 关于候选生城和上线计划，请按上线计划执行，有问题群里说。
- 关于候选生城和上线计化，请按上线计划执行，有问题群里说。
- 关于后选生城和上线计划，请按上线计划执行，有问题群里说。

### d064 → [064.md](./dialog200_sentence_assembly_trace/064.md)

Raw:

```text
今天我们团队要讨论后选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
```

离谱句:

- 今天我们团队要讨论候选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
- 今天我们团队要讨论候选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
- 今天我们团队要讨论后选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
- 今天我们团队要讨论候选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
- 今天我们团队要讨论后选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
- 今天我们团队要讨论候选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
- 今天我们团队要讨论后选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。

### d065 → [065.md](./dialog200_sentence_assembly_trace/065.md)

Raw:

```text
这次发布我们先对齐上线计划窗口，后选生城模块需要联调，别漏掉回归。
```

离谱句:

- 这次发布我们先对齐上线计划窗口，候选生城模块需要联调，别漏掉回归。

### d081 → [081.md](./dialog200_sentence_assembly_trace/081.md)

Raw:

```text
请问理财产品的风险等级在哪里查看？
```

离谱句:

- 请问理财产品的风险登机在哪里查看？

### d086 → [086.md](./dialog200_sentence_assembly_trace/086.md)

Raw:

```text
更衣室柜子钥匙找不到了，前台能帮忙开一下吗？
```

离谱句:

- 更医师柜子钥匙找不到了，前台能帮忙开一下吗？
- 更议室柜子钥匙找不到了，前台能帮忙开一下吗？

### d089 → [089.md](./dialog200_sentence_assembly_trace/089.md)

Raw:

```text
这周的上线计花已经确认，上线计划评审安排在周四上午。
```

离谱句:

- 这周的上线计花已经确认，上线计划评审安排在周四商务。

### d090 → [090.md](./dialog200_sentence_assembly_trace/090.md)

Raw:

```text
关于后选生城和上线计化，请按上线计划执行，有问题群里说。
```

离谱句:

- 关于候选生城和上线计划，请按上线计划执行，有问题群里说。
- 关于候选生城和上线计化，请按上线计划执行，有问题群里说。
- 关于后选生城和上线计划，请按上线计划执行，有问题群里说。

### d109 → [109.md](./dialog200_sentence_assembly_trace/109.md)

Raw:

```text
今天我们团队要讨论后选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
```

离谱句:

- 今天我们团队要讨论候选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
- 今天我们团队要讨论候选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
- 今天我们团队要讨论后选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
- 今天我们团队要讨论候选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
- 今天我们团队要讨论后选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
- 今天我们团队要讨论候选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
- 今天我们团队要讨论后选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。

### d110 → [110.md](./dialog200_sentence_assembly_trace/110.md)

Raw:

```text
这次发布我们先对齐上线计划窗口，后选生城模块需要联调，别漏掉回归。
```

离谱句:

- 这次发布我们先对齐上线计划窗口，候选生城模块需要联调，别漏掉回归。

### d126 → [126.md](./dialog200_sentence_assembly_trace/126.md)

Raw:

```text
请问理财产品的风险等级在哪里查看？
```

离谱句:

- 请问理财产品的风险登机在哪里查看？

### d131 → [131.md](./dialog200_sentence_assembly_trace/131.md)

Raw:

```text
更衣室柜子钥匙找不到了，前台能帮忙开一下吗？
```

离谱句:

- 更医师柜子钥匙找不到了，前台能帮忙开一下吗？
- 更议室柜子钥匙找不到了，前台能帮忙开一下吗？

### d134 → [134.md](./dialog200_sentence_assembly_trace/134.md)

Raw:

```text
这周的上线计花已经确认，上线计划评审安排在周四上午。
```

离谱句:

- 这周的上线计花已经确认，上线计划评审安排在周四商务。

### d135 → [135.md](./dialog200_sentence_assembly_trace/135.md)

Raw:

```text
关于后选生城和上线计化，请按上线计划执行，有问题群里说。
```

离谱句:

- 关于候选生城和上线计划，请按上线计划执行，有问题群里说。
- 关于候选生城和上线计化，请按上线计划执行，有问题群里说。
- 关于后选生城和上线计划，请按上线计划执行，有问题群里说。

### d154 → [154.md](./dialog200_sentence_assembly_trace/154.md)

Raw:

```text
今天我们团队要讨论后选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
```

离谱句:

- 今天我们团队要讨论候选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
- 今天我们团队要讨论候选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
- 今天我们团队要讨论后选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
- 今天我们团队要讨论候选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
- 今天我们团队要讨论后选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
- 今天我们团队要讨论候选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
- 今天我们团队要讨论后选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。

### d155 → [155.md](./dialog200_sentence_assembly_trace/155.md)

Raw:

```text
这次发布我们先对齐上线计划窗口，后选生城模块需要联调，别漏掉回归。
```

离谱句:

- 这次发布我们先对齐上线计划窗口，候选生城模块需要联调，别漏掉回归。

### d171 → [171.md](./dialog200_sentence_assembly_trace/171.md)

Raw:

```text
请问理财产品的风险等级在哪里查看？
```

离谱句:

- 请问理财产品的风险登机在哪里查看？

### d176 → [176.md](./dialog200_sentence_assembly_trace/176.md)

Raw:

```text
更衣室柜子钥匙找不到了，前台能帮忙开一下吗？
```

离谱句:

- 更医师柜子钥匙找不到了，前台能帮忙开一下吗？
- 更议室柜子钥匙找不到了，前台能帮忙开一下吗？

### d179 → [179.md](./dialog200_sentence_assembly_trace/179.md)

Raw:

```text
这周的上线计花已经确认，上线计划评审安排在周四上午。
```

离谱句:

- 这周的上线计花已经确认，上线计划评审安排在周四商务。

### d180 → [180.md](./dialog200_sentence_assembly_trace/180.md)

Raw:

```text
关于后选生城和上线计化，请按上线计划执行，有问题群里说。
```

离谱句:

- 关于候选生城和上线计划，请按上线计划执行，有问题群里说。
- 关于候选生城和上线计化，请按上线计划执行，有问题群里说。
- 关于后选生城和上线计划，请按上线计划执行，有问题群里说。

### d199 → [199.md](./dialog200_sentence_assembly_trace/199.md)

Raw:

```text
今天我们团队要讨论后选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
```

离谱句:

- 今天我们团队要讨论候选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
- 今天我们团队要讨论候选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
- 今天我们团队要讨论后选生城相关的候选生城流程和上线计划安排，请研发一起评估风险。
- 今天我们团队要讨论候选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。
- 今天我们团队要讨论后选生城相关的候选生城流程和上线计化安排，请研发一起评估风险。
- 今天我们团队要讨论候选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
- 今天我们团队要讨论后选生城相关的后选生城流程和上线计划安排，请研发一起评估风险。

### d200 → [200.md](./dialog200_sentence_assembly_trace/200.md)

Raw:

```text
这次发布我们先对齐上线计划窗口，后选生城模块需要联调，别漏掉回归。
```

离谱句:

- 这次发布我们先对齐上线计划窗口，候选生城模块需要联调，别漏掉回归。

## E. KenLM Top1 明显可疑

（无 — 本轮默认未跑 KenLM 排序；见各 Case 第 7 节 KenLM Input）

## 人工判断 = NO

（无）
