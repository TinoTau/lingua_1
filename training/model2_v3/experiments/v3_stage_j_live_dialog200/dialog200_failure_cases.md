# dialog_200 failure / regression / improvement cases

Generated: 2026-08-17T18:22:34.986Z

## REGRESSION d024
- expected: 发票抬头开错了，能重新开具电子发票吗？
- raw ASR (J): 发票抬头开错了能重新开具电子发票码
- baseline final: 发票抬头开错了能重新开具电子发票吗?
- stagej final: 发票抬头开错了能重新开具电子发票码
- first divergence: ASSEMBLY_DROP
- funnel: {"run_id":"stagej-1786989668781","dialog_id":"d024","target_in_base_candidates":true,"target_after_P":true,"target_after_D":true,"target_after_union":true,"target_after_budget":true,"target_in_assembly":false,"target_in_kenlm_inputs":false,"target_selected_final":false}
- note: target in candidates but not assembled

## REGRESSION d079
- expected: 我想开通短信提醒，需要带什么证件？
- raw ASR (J): 我想開通短信提醒需要帶什麼證件
- baseline final: 我想开通短信提醒需要带什么证件
- stagej final: 我想開通短信提醒需要帶什麼證件
- first divergence: ASSEMBLY_DROP
- funnel: {"run_id":"stagej-1786989668781","dialog_id":"d079","target_in_base_candidates":true,"target_after_P":true,"target_after_D":true,"target_after_union":true,"target_after_budget":true,"target_in_assembly":false,"target_in_kenlm_inputs":false,"target_selected_final":false}
- note: target in candidates but not assembled

## REGRESSION d151
- expected: 周末要不要去江边骑行？天气预报说周日多云，记得带水。
- raw ASR (J): 周末 要不要去江邊騎行 天氣預報說 周日多雲記得帶水
- baseline final: 周末 要不要去江边骑行 天气预报说 周日多云记得带水
- stagej final: 周末 要不要去江邊騎行 天氣預報說 周日多雲記得帶水
- first divergence: ASSEMBLY_DROP
- funnel: {"run_id":"stagej-1786989668781","dialog_id":"d151","target_in_base_candidates":true,"target_after_P":true,"target_after_D":true,"target_after_union":true,"target_after_budget":true,"target_in_assembly":false,"target_in_kenlm_inputs":false,"target_selected_final":false}
- note: target in candidates but not assembled

## IMPROVEMENT d016
- expected: 周末要不要去江边骑行？天气预报说周日多云，记得带水。
- raw ASR (J): 周末要不要去江边骑行? 天气预报说,周日多云 记得带水
- baseline final: 周末要不要去江边骑行? 天气预报说,周日多云 用鸡的带水
- stagej final: 周末要不要去江边骑行? 天气预报说,周日多云 记得带水
- first divergence: 
- funnel: 
- note: 

## IMPROVEMENT d034
- expected: 我想开通短信提醒，需要带什么证件？
- raw ASR (J): 我想,开通短信提醒需要带什么证件
- baseline final: 我想,開通短信提醒需要帶什麼證件
- stagej final: 我想,开通短信提醒需要带什么证件
- first divergence: 
- funnel: 
- note: 

## IMPROVEMENT d038
- expected: 这道菜大概要等多久？我们先点一份凉菜和一壶茶。
- raw ASR (J): 这道菜大概要等多久,我们先点一份凉菜和一壶茶
- baseline final: 這道菜大概要等多久 我們先點一份涼菜和一壺茶
- stagej final: 这道菜大概要等多久,我们先点一份凉菜和一壶茶
- first divergence: 
- funnel: 
- note: 

## FAILURE d001
- expected: 你好，我想点一杯热拿铁，中杯，少糖。顺便问一下今天有蓝莓马芬吗？
- raw ASR (J): 你好,我想點一杯熱拿鐵中貝少糖 今天有蓝没马分吗?
- baseline final: 
- stagej final: 你好,我想點一杯熱拿鐵中貝少糖 今天有蓝没马分吗?
- first divergence: ASSEMBLY_DROP
- funnel: {"run_id":"stagej-1786989668781","dialog_id":"d001","target_in_base_candidates":true,"target_after_P":true,"target_after_D":true,"target_after_union":true,"target_after_budget":true,"target_in_assembly":false,"target_in_kenlm_inputs":false,"target_selected_final":false}
- note: target in candidates but not assembled

## FAILURE d002
- expected: 麻烦帮我做一杯美式带走，大杯就行，谢谢。
- raw ASR (J): 麻烦帮我做一杯美式带走大背就行谢谢
- baseline final: 
- stagej final: 麻烦帮我做一杯美式带走大背就行谢谢
- first divergence: ASSEMBLY_DROP
- funnel: {"run_id":"stagej-1786989668781","dialog_id":"d002","target_in_base_candidates":true,"target_after_P":true,"target_after_D":true,"target_after_union":true,"target_after_budget":true,"target_in_assembly":false,"target_in_kenlm_inputs":false,"target_selected_final":false}
- note: target in candidates but not assembled

## FAILURE d003
- expected: 请问这款燕麦拿铁可以少冰吗？我赶时间，小杯。
- raw ASR (J): 请问,这款烟麦拿铁可以烧病吗?我赶时间小背
- baseline final: 
- stagej final: 请问,这款烟麦拿铁可以烧病吗?我赶时间小背
- first divergence: ASSEMBLY_DROP
- funnel: {"run_id":"stagej-1786989668781","dialog_id":"d003","target_in_base_candidates":true,"target_after_P":true,"target_after_D":true,"target_after_union":true,"target_after_budget":true,"target_in_assembly":false,"target_in_kenlm_inputs":false,"target_selected_final":false}
- note: target in candidates but not assembled

## FAILURE d004
- expected: 小陈，客户反馈翻译引擎接口报错，我们能不能加缓存，下午三点前把结论发群里？
- raw ASR (J): 小城客户反馈翻译引擎接口报错 我们能不能加缓存下午三点前 把結論發群裡
- baseline final: 
- stagej final: 小城客户反馈翻译引擎接口报错 我们能不能加缓存下午三点前 把結論發群裡
- first divergence: ASSEMBLY_DROP
- funnel: {"run_id":"stagej-1786989668781","dialog_id":"d004","target_in_base_candidates":true,"target_after_P":true,"target_after_D":true,"target_after_union":true,"target_after_budget":true,"target_in_assembly":false,"target_in_kenlm_inputs":false,"target_selected_final":false}
- note: target in candidates but not assembled

## FAILURE d005
- expected: 今天的站会先过一下订单中台进度，内存占用高这块需要限流保护，大家看一下风险。
- raw ASR (J): 今天德湛会现贵一下定,但中台 近都内存站用高折块需要先留保护 大家看一下风险
- baseline final: 
- stagej final: 今天德湛会现贵一下定,但中台 近都内存站用高折块需要先留保护 大家看一下风险
- first divergence: ASSEMBLY_DROP
- funnel: {"run_id":"stagej-1786989668781","dialog_id":"d005","target_in_base_candidates":true,"target_after_P":true,"target_after_D":true,"target_after_union":true,"target_after_budget":true,"target_in_assembly":false,"target_in_kenlm_inputs":false,"target_selected_final":false}
- note: target in candidates but not assembled

## FAILURE d006
- expected: 跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。
- raw ASR (J): 跟会员系统相关的需求我整理了一板八点钱请大家帮忙评审一下
- baseline final: 
- stagej final: 跟会员系统相关的需求我整理了一板八点钱请大家帮忙评审一下
- first divergence: ASSEMBLY_DROP
- funnel: {"run_id":"stagej-1786989668781","dialog_id":"d006","target_in_base_candidates":true,"target_after_P":true,"target_after_D":true,"target_after_union":true,"target_after_budget":true,"target_in_assembly":false,"target_in_kenlm_inputs":false,"target_selected_final":false}
- note: target in candidates but not assembled

## FAILURE d007
- expected: 师傅，去中关村软件园，走机场高速。我赶九点半的会，要是堵车您提前跟我说。
- raw ASR (J): 市副局仲觀村軟件遠走機場告訴 我幹 9点半的回药师赌车您提前跟我说
- baseline final: 
- stagej final: 市副局仲觀村軟件遠走機場告訴 我幹 9点半的回药师赌车您提前跟我说
- first divergence: ASSEMBLY_DROP
- funnel: {"run_id":"stagej-1786989668781","dialog_id":"d007","target_in_base_candidates":true,"target_after_P":true,"target_after_D":true,"target_after_union":true,"target_after_budget":true,"target_in_assembly":false,"target_in_kenlm_inputs":false,"target_selected_final":false}
- note: target in candidates but not assembled

## FAILURE d008
- expected: 麻烦送我到国贸三期南门，大概多久能到？我十点十分有个电话会。
- raw ASR (J): 麻烦送我到国贸散清南门大该多久能到 我十点 十分有隔电话会
- baseline final: 
- stagej final: 麻烦送我到国贸散清南门大该多久能到 我十点 十分有隔电话会
- first divergence: ASR_SOURCE_ERROR
- funnel: {"run_id":"stagej-1786989668781","dialog_id":"d008","target_in_base_candidates":false,"target_after_P":false,"target_after_D":false,"target_after_union":false,"target_after_budget":false,"target_in_assembly":false,"target_in_kenlm_inputs":false,"target_selected_final":false}
- note: raw ASR diverged and base/P/D did not recover target

## FAILURE d009
- expected: 去望京SOHO，不走四环可以吗？那边现在堵不堵？
- raw ASR (J): 去望金色和不走私环可以吗?那贬现在赌不赌?
- baseline final: 
- stagej final: 去望金色和不走私环可以吗?那贬现在赌不赌?
- first divergence: ASSEMBLY_DROP
- funnel: {"run_id":"stagej-1786989668781","dialog_id":"d009","target_in_base_candidates":true,"target_after_P":true,"target_after_D":true,"target_after_union":true,"target_after_budget":true,"target_in_assembly":false,"target_in_kenlm_inputs":false,"target_selected_final":false}
- note: target in candidates but not assembled

## FAILURE d010
- expected: 医生您好，我这两天头痛，想开点药并做个血常规。
- raw ASR (J): 醫生您好,我這兩天頭痛想開點,要並做個些常規
- baseline final: 
- stagej final: 醫生您好,我這兩天頭痛想開點,要並做個些常規
- first divergence: FINESPAN_MISS
- funnel: {"run_id":"stagej-1786989668781","dialog_id":"d010","target_in_base_candidates":false,"target_after_P":false,"target_after_D":false,"target_after_union":false,"target_after_budget":false,"target_in_assembly":false,"target_in_kenlm_inputs":false,"target_selected_final":false}
- note: FineSpan windows do not cover expected ngrams

## FAILURE d011
- expected: 挂号处请问内科还有号吗？我胃不舒服，昨晚开始的。
- raw ASR (J): 括號出請問內客還有號碼 我微不舒服昨晚開始的
- baseline final: 
- stagej final: 括號出請問內客還有號碼 我微不舒服昨晚開始的
- first divergence: ASSEMBLY_DROP
- funnel: {"run_id":"stagej-1786989668781","dialog_id":"d011","target_in_base_candidates":true,"target_after_P":true,"target_after_D":true,"target_after_union":true,"target_after_budget":true,"target_in_assembly":false,"target_in_kenlm_inputs":false,"target_selected_final":false}
- note: target in candidates but not assembled

## FAILURE d014
- expected: 请问这双鞋有四十码吗？不合适三天内可以退换吧？
- raw ASR (J): 请问这双鞋有司时码吗? 不合适司时码 三天内可以推换吧
- baseline final: 
- stagej final: 请问这双鞋有司时码吗? 不合适司时码 三天内可以推换吧
- first divergence: ASSEMBLY_DROP
- funnel: {"run_id":"stagej-1786989668781","dialog_id":"d014","target_in_base_candidates":true,"target_after_P":true,"target_after_D":true,"target_after_union":true,"target_after_budget":true,"target_in_assembly":false,"target_in_kenlm_inputs":false,"target_selected_final":false}
- note: target in candidates but not assembled

## FAILURE d015
- expected: 我想对比一下这两款订单中台的价格，会员日能再减一点吗？
- raw ASR (J): 我想对比 这两款订单中台的价格会员日,能再减一点吗?
- baseline final: 
- stagej final: 我想对比 这两款订单中台的价格会员日,能再减一点吗?
- first divergence: ASSEMBLY_DROP
- funnel: {"run_id":"stagej-1786989668781","dialog_id":"d015","target_in_base_candidates":true,"target_after_P":true,"target_after_D":true,"target_after_union":true,"target_after_budget":true,"target_in_assembly":false,"target_in_kenlm_inputs":false,"target_selected_final":false}
- note: target in candidates but not assembled

## FAILURE d017
- expected: 晚上一起吃饭吗？我知道一家川菜不错，大概七点到。
- raw ASR (J): 晚上一起吃饭嘛 我知道一家川菜 不错大概起点到
- baseline final: 
- stagej final: 晚上一起吃饭嘛 我知道一家川菜 不错大概起点到
- first divergence: ASSEMBLY_DROP
- funnel: {"run_id":"stagej-1786989668781","dialog_id":"d017","target_in_base_candidates":true,"target_after_P":true,"target_after_D":true,"target_after_union":true,"target_after_budget":true,"target_in_assembly":false,"target_in_kenlm_inputs":false,"target_selected_final":false}
- note: target in candidates but not assembled

## FAILURE d018
- expected: 你最近忙不忙？想找你看下手机备份怎么设置。
- raw ASR (J): 你最近忙不忙,想找你看下手机备分怎么设置?
- baseline final: 
- stagej final: 你最近忙不忙,想找你看下手机备分怎么设置?
- first divergence: ASSEMBLY_DROP
- funnel: {"run_id":"stagej-1786989668781","dialog_id":"d018","target_in_base_candidates":true,"target_after_P":true,"target_after_D":true,"target_after_union":true,"target_after_budget":true,"target_in_assembly":false,"target_in_kenlm_inputs":false,"target_selected_final":false}
- note: target in candidates but not assembled

## FAILURE d019
- expected: 今天我们团队要讨论后选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
- raw ASR (J): 今天,我們團隊 对要讨论后选生成相关的后选生成流程和上限计划安排请研发一起评估风险
- baseline final: 
- stagej final: 今天,我們團隊 对要讨论后选生成相关的后选生成流程和上限计划安排请研发一起评估风险
- first divergence: ASSEMBLY_DROP
- funnel: {"run_id":"stagej-1786989668781","dialog_id":"d019","target_in_base_candidates":true,"target_after_P":true,"target_after_D":true,"target_after_union":true,"target_after_budget":true,"target_in_assembly":false,"target_in_kenlm_inputs":false,"target_selected_final":false}
- note: target in candidates but not assembled

## FAILURE d020
- expected: 这次发布我们先对齐上线计划窗口，后选生城模块需要联调，别漏掉回归。
- raw ASR (J): 这次发布我们线,对其商线计划窗口后选生成模块需要连掉别漏掉回归
- baseline final: 
- stagej final: 这次发布我们线,对其商线计划窗口后选生成模块需要连掉别漏掉回归
- first divergence: ASSEMBLY_DROP
- funnel: {"run_id":"stagej-1786989668781","dialog_id":"d020","target_in_base_candidates":true,"target_after_P":true,"target_after_D":true,"target_after_union":true,"target_after_budget":true,"target_in_assembly":false,"target_in_kenlm_inputs":false,"target_selected_final":false}
- note: target in candidates but not assembled

## FAILURE d021
- expected: 会上提到候选生成链路要加监控，上线计划文档我下午更新一版。
- raw ASR (J): 會上提到候選生成連路 要加監控 通上限期画文当我下午更新一版
- baseline final: 
- stagej final: 会上提到候选生成链路 要加監控 通上线期画文当我下午更新一版
- first divergence: ASSEMBLY_DROP
- funnel: {"run_id":"stagej-1786989668781","dialog_id":"d021","target_in_base_candidates":true,"target_after_P":true,"target_after_D":true,"target_after_union":true,"target_after_budget":true,"target_in_assembly":false,"target_in_kenlm_inputs":false,"target_selected_final":false}
- note: target in candidates but not assembled

## FAILURE d022
- expected: 您好，我订单显示已发货但物流三天没更新，能帮我查一下吗？
- raw ASR (J): 您好我定,但顯示已發貨,但務留三天。 今天美更新能幫我查一下嗎
- baseline final: 
- stagej final: 您好我定,但顯示已發貨,但物流三天。 今天美更新能幫我查一下嗎
- first divergence: ASSEMBLY_DROP
- funnel: {"run_id":"stagej-1786989668781","dialog_id":"d022","target_in_base_candidates":true,"target_after_P":true,"target_after_D":true,"target_after_union":true,"target_after_budget":true,"target_in_assembly":false,"target_in_kenlm_inputs":false,"target_selected_final":false}
- note: target in candidates but not assembled

## FAILURE d025
- expected: 请简单介绍一下你上一段项目里负责的核心模块和难点。
- raw ASR (J): 请简单介绍一下 你上一段视频 一段项目里负责的核心模块和难点
- baseline final: 
- stagej final: 请简单介绍一下 你上一段视频 一段项目里负责的核心模块和难点
- first divergence: ASSEMBLY_DROP
- funnel: {"run_id":"stagej-1786989668781","dialog_id":"d025","target_in_base_candidates":true,"target_after_P":true,"target_after_D":true,"target_after_union":true,"target_after_budget":true,"target_in_assembly":false,"target_in_kenlm_inputs":false,"target_selected_final":false}
- note: target in candidates but not assembled

## FAILURE d026
- expected: 你如何看待跨团队协作？遇到需求变更一般怎么处理？
- raw ASR (J): 你如何看待夸团队协作,遇到需求边更一般怎么处理?
- baseline final: 
- stagej final: 你如何看待夸团队协作,遇到需求边更一般怎么处理?
- first divergence: ASSEMBLY_DROP
- funnel: {"run_id":"stagej-1786989668781","dialog_id":"d026","target_in_base_candidates":true,"target_after_P":true,"target_after_D":true,"target_after_union":true,"target_after_budget":true,"target_in_assembly":false,"target_in_kenlm_inputs":false,"target_selected_final":false}
- note: target in candidates but not assembled

## FAILURE d027
- expected: 期望薪资这块我们可以再沟通，你最快什么时候能入职？
- raw ASR (J): 期望性自这块我们可以再沟通你最快什么时候能入职
- baseline final: 
- stagej final: 期望性自这块我们可以再沟通你最快什么时候能入职
- first divergence: ASSEMBLY_DROP
- funnel: {"run_id":"stagej-1786989668781","dialog_id":"d027","target_in_base_candidates":true,"target_after_P":true,"target_after_D":true,"target_after_union":true,"target_after_budget":true,"target_in_assembly":false,"target_in_kenlm_inputs":false,"target_selected_final":false}
- note: target in candidates but not assembled

## FAILURE d028
- expected: 老师，这道题的解题步骤能不能再讲一遍？我没听懂第二点。
- raw ASR (J): 老師這道題的解題步,中能不能解解? 我没听懂第二点
- baseline final: 
- stagej final: 老師這道題的解題步,中能不能解解? 我没听懂第二点
- first divergence: FINESPAN_MISS
- funnel: {"run_id":"stagej-1786989668781","dialog_id":"d028","target_in_base_candidates":false,"target_after_P":false,"target_after_D":false,"target_after_union":false,"target_after_budget":false,"target_in_assembly":false,"target_in_kenlm_inputs":false,"target_selected_final":false}
- note: FineSpan windows do not cover expected ngrams

## FAILURE d029
- expected: 作业是下周一下午交吗？可以电子版提交吗？
- raw ASR (J): 作业是狭州以下五叫码,可以电子板提叫码。
- baseline final: 
- stagej final: 作业是狭州以下五叫码,可以电子板提叫码。
- first divergence: FINESPAN_MISS
- funnel: {"run_id":"stagej-1786989668781","dialog_id":"d029","target_in_base_candidates":false,"target_after_P":false,"target_after_D":false,"target_after_union":false,"target_after_budget":false,"target_in_assembly":false,"target_in_kenlm_inputs":false,"target_selected_final":false}
- note: FineSpan windows do not cover expected ngrams

## FAILURE d030
- expected: 请问这门课期末是开卷还是闭卷？重点会划吗？
- raw ASR (J): 请问这门客期末是开卷还是闭卷? 终点汇化吗?
- baseline final: 
- stagej final: 请问这门客期末是开卷还是闭卷? 终点汇化吗?
- first divergence: ASSEMBLY_DROP
- funnel: {"run_id":"stagej-1786989668781","dialog_id":"d030","target_in_base_candidates":true,"target_after_P":true,"target_after_D":true,"target_after_union":true,"target_after_budget":true,"target_in_assembly":false,"target_in_kenlm_inputs":false,"target_selected_final":false}
- note: target in candidates but not assembled

## FAILURE d031
- expected: 我预订的是大床房，能安排安静一点的楼层吗？
- raw ASR (J): 我预定的十大床房能安排安静一点的楼层吗?
- baseline final: 
- stagej final: 我预定的十大床房能安排安静一点的楼层吗?
- first divergence: ASSEMBLY_DROP
- funnel: {"run_id":"stagej-1786989668781","dialog_id":"d031","target_in_base_candidates":true,"target_after_P":true,"target_after_D":true,"target_after_union":true,"target_after_budget":true,"target_in_assembly":false,"target_in_kenlm_inputs":false,"target_selected_final":false}
- note: target in candidates but not assembled

## FAILURE d032
- expected: 早餐几点开始？退房可以延迟到下午两点吗？
- raw ASR (J): 早餐祭典开始 退房可以延迟到下午两点吗?
- baseline final: 
- stagej final: 早餐祭典开始 退房可以延迟到下午两点吗?
- first divergence: ASSEMBLY_DROP
- funnel: {"run_id":"stagej-1786989668781","dialog_id":"d032","target_in_base_candidates":true,"target_after_P":true,"target_after_D":true,"target_after_union":true,"target_after_budget":true,"target_in_assembly":false,"target_in_kenlm_inputs":false,"target_selected_final":false}
- note: target in candidates but not assembled

## FAILURE d033
- expected: 房间空调不太制冷，能派人上来看一下吗？
- raw ASR (J): 房间空调不太知冷能派人上来看一下吗?
- baseline final: 
- stagej final: 房间空调不太知冷能派人上来看一下吗?
- first divergence: ASSEMBLY_DROP
- funnel: {"run_id":"stagej-1786989668781","dialog_id":"d033","target_in_base_candidates":true,"target_after_P":true,"target_after_D":true,"target_after_union":true,"target_after_budget":true,"target_in_assembly":false,"target_in_kenlm_inputs":false,"target_selected_final":false}
- note: target in candidates but not assembled

## FAILURE d036
- expected: 请问理财产品的风险等级在哪里查看？
- raw ASR (J): 请问理财产品的风险等急在哪里查看
- baseline final: 
- stagej final: 请问理财产品的风险等急在哪里查看
- first divergence: ASSEMBLY_DROP
- funnel: {"run_id":"stagej-1786989668781","dialog_id":"d036","target_in_base_candidates":true,"target_after_P":true,"target_after_D":true,"target_after_union":true,"target_after_budget":true,"target_in_assembly":false,"target_in_kenlm_inputs":false,"target_selected_final":false}
- note: target in candidates but not assembled

## FAILURE d037
- expected: 两位，靠窗有位置吗？不要香菜，微辣就行。
- raw ASR (J): 两位靠窗有微植麻 不要像蔡薇拉就行
- baseline final: 
- stagej final: 两位靠窗有微植麻 不要像蔡薇拉就行
- first divergence: FINESPAN_MISS
- funnel: {"run_id":"stagej-1786989668781","dialog_id":"d037","target_in_base_candidates":false,"target_after_P":false,"target_after_D":false,"target_after_union":false,"target_after_budget":false,"target_in_assembly":false,"target_in_kenlm_inputs":false,"target_selected_final":false}
- note: FineSpan windows do not cover expected ngrams

## FAILURE d039
- expected: 可以打包吗？顺便结一下账，能扫码支付吗？
- raw ASR (J): 可以打爆嗎? 順便解一下張能掃馬支付嗎?
- baseline final: 
- stagej final: 可以打爆嗎? 順便解一下張能掃馬支付嗎?
- first divergence: FINESPAN_MISS
- funnel: {"run_id":"stagej-1786989668781","dialog_id":"d039","target_in_base_candidates":false,"target_after_P":false,"target_after_D":false,"target_after_union":false,"target_after_budget":false,"target_in_assembly":false,"target_in_kenlm_inputs":false,"target_selected_final":false}
- note: FineSpan windows do not cover expected ngrams

## FAILURE d040
- expected: 私教课还剩几次？能帮我约明天晚上七点吗？
- raw ASR (J): 自教课还剩几次 能帮我约明天晚上7点吗
- baseline final: 
- stagej final: 自教课还剩几次 能帮我约明天晚上7点吗
- first divergence: FINESPAN_MISS
- funnel: {"run_id":"stagej-1786989668781","dialog_id":"d040","target_in_base_candidates":false,"target_after_P":false,"target_after_D":false,"target_after_union":false,"target_after_budget":false,"target_in_assembly":false,"target_in_kenlm_inputs":false,"target_selected_final":false}
- note: FineSpan windows do not cover expected ngrams

## FAILURE d041
- expected: 更衣室柜子钥匙找不到了，前台能帮忙开一下吗？
- raw ASR (J): 更易是龟仔钥匙找不到了前台 能帮忙开一下吗
- baseline final: 
- stagej final: 更易是龟仔钥匙找不到了前台 能帮忙开一下吗
- first divergence: ASSEMBLY_DROP
- funnel: {"run_id":"stagej-1786989668781","dialog_id":"d041","target_in_base_candidates":true,"target_after_P":true,"target_after_D":true,"target_after_union":true,"target_after_budget":true,"target_in_assembly":false,"target_in_kenlm_inputs":false,"target_selected_final":false}
- note: target in candidates but not assembled

## FAILURE d042
- expected: 游泳次卡本月月底到期，续费有优惠吗？
- raw ASR (J): 游泳自卡本月月底到期是非有優惠嗎?
- baseline final: 
- stagej final: 游泳自卡本月月底到期是非有優惠嗎?
- first divergence: ASSEMBLY_DROP
- funnel: {"run_id":"stagej-1786989668781","dialog_id":"d042","target_in_base_candidates":true,"target_after_P":true,"target_after_D":true,"target_after_union":true,"target_after_budget":true,"target_in_assembly":false,"target_in_kenlm_inputs":false,"target_selected_final":false}
- note: target in candidates but not assembled

## FAILURE d043
- expected: 我们下午讨论后选声城方案，先把候选生成的接口文档补齐。
- raw ASR (J): 我们下午讨论后,选生呈方安线吧。 成的借口文章補齊
- baseline final: 
- stagej final: 我们下午讨论后,选生呈方安线吧。 成的借口文章補齊
- first divergence: FINESPAN_MISS
- funnel: {"run_id":"stagej-1786989668781","dialog_id":"d043","target_in_base_candidates":false,"target_after_P":false,"target_after_D":false,"target_after_union":false,"target_after_budget":false,"target_in_assembly":false,"target_in_kenlm_inputs":false,"target_selected_final":false}
- note: FineSpan windows do not cover expected ngrams

## FAILURE d044
- expected: 这周的上线计花已经确认，上线计划评审安排在周四上午。
- raw ASR (J): 这周的上限计划已经全任上限计划评审安排在周四上午
- baseline final: 
- stagej final: 这周的上限计划已经全任上限计划评审安排在周四上午
- first divergence: FINESPAN_MISS
- funnel: {"run_id":"stagej-1786989668781","dialog_id":"d044","target_in_base_candidates":false,"target_after_P":false,"target_after_D":false,"target_after_union":false,"target_after_budget":false,"target_in_assembly":false,"target_in_kenlm_inputs":false,"target_selected_final":false}
- note: FineSpan windows do not cover expected ngrams

## FAILURE d045
- expected: 关于后选生城和上线计化，请按上线计划执行，有问题群里说。
- raw ASR (J): 關於後,選生成為 和上限计划请安上限计划执行有问题群里说
- baseline final: 
- stagej final: 關於後,選生成為 和上限计划请安上限计划执行有问题群里说
- first divergence: ASSEMBLY_DROP
- funnel: {"run_id":"stagej-1786989668781","dialog_id":"d045","target_in_base_candidates":true,"target_after_P":true,"target_after_D":true,"target_after_union":true,"target_after_budget":true,"target_in_assembly":false,"target_in_kenlm_inputs":false,"target_selected_final":false}
- note: target in candidates but not assembled

## FAILURE d046
- expected: 你好，我想点一杯卡布奇诺，中杯，正常糖。顺便问一下今天有芝士蛋糕吗？
- raw ASR (J): 你好 我想点一杯卡布奇诺中倍珍长糖 顺便问一下 今天有知识蛋糕吗?
- baseline final: 
- stagej final: 你好 我想点一杯卡布奇诺中倍珍长糖 顺便问一下 今天有知识蛋糕吗?
- first divergence: ASSEMBLY_DROP
- funnel: {"run_id":"stagej-1786989668781","dialog_id":"d046","target_in_base_candidates":true,"target_after_P":true,"target_after_D":true,"target_after_union":true,"target_after_budget":true,"target_in_assembly":false,"target_in_kenlm_inputs":false,"target_selected_final":false}
- note: target in candidates but not assembled

## FAILURE d047
- expected: 麻烦帮我做一杯红茶带走，大杯就行，谢谢。
- raw ASR (J): 麻烦帮我做一杯红茶带走大背就行谢谢
- baseline final: 
- stagej final: 麻烦帮我做一杯红茶带走大背就行谢谢
- first divergence: ASSEMBLY_DROP
- funnel: {"run_id":"stagej-1786989668781","dialog_id":"d047","target_in_base_candidates":true,"target_after_P":true,"target_after_D":true,"target_after_union":true,"target_after_budget":true,"target_in_assembly":false,"target_in_kenlm_inputs":false,"target_selected_final":false}
- note: target in candidates but not assembled

## FAILURE d048
- expected: 请问这款热巧克力可以少冰吗？我赶时间，小杯。
- raw ASR (J): 请问,这款热巧克力可以少病吗? 我赶时间小呗
- baseline final: 
- stagej final: 请问,这款热巧克力可以少病吗? 我赶时间小呗
- first divergence: ASSEMBLY_DROP
- funnel: {"run_id":"stagej-1786989668781","dialog_id":"d048","target_in_base_candidates":true,"target_after_P":true,"target_after_D":true,"target_after_union":true,"target_after_budget":true,"target_in_assembly":false,"target_in_kenlm_inputs":false,"target_selected_final":false}
- note: target in candidates but not assembled

## FAILURE d049
- expected: 李工，客户反馈翻译引擎接口报错，我们能不能加缓存，下午三点前把结论发群里？
- raw ASR (J): 理工科互反馈翻译引擎接口包错 我们能够 不能加缓存下午3点前把结论发群里
- baseline final: 
- stagej final: 理工科互反馈翻译引擎接口包错 我们能够 不能加缓存下午3点前把结论发群里
- first divergence: ASSEMBLY_DROP
- funnel: {"run_id":"stagej-1786989668781","dialog_id":"d049","target_in_base_candidates":true,"target_after_P":true,"target_after_D":true,"target_after_union":true,"target_after_budget":true,"target_in_assembly":false,"target_in_kenlm_inputs":false,"target_selected_final":false}
- note: target in candidates but not assembled

## FAILURE d050
- expected: 今天的站会先过一下订单中台进度，内存占用高这块需要限流保护，大家看一下风险。
- raw ASR (J): 今天的站会现购以下订单 中台 进度内存占用高着快 需要先留保护大家看一下风险
- baseline final: 
- stagej final: 今天的站会现购以下订单 中台 进度内存占用高着快 需要先留保护大家看一下风险
- first divergence: ASSEMBLY_DROP
- funnel: {"run_id":"stagej-1786989668781","dialog_id":"d050","target_in_base_candidates":true,"target_after_P":true,"target_after_D":true,"target_after_union":true,"target_after_budget":true,"target_in_assembly":false,"target_in_kenlm_inputs":false,"target_selected_final":false}
- note: target in candidates but not assembled

## FAILURE d051
- expected: 跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。
- raw ASR (J): 跟會員系統相關的訊息 我整理了一版8点前请大家帮忙评审一下
- baseline final: 
- stagej final: 跟會員系統相關的訊息 我整理了一版8点前请大家帮忙评审一下
- first divergence: ASSEMBLY_DROP
- funnel: {"run_id":"stagej-1786989668781","dialog_id":"d051","target_in_base_candidates":true,"target_after_P":true,"target_after_D":true,"target_after_union":true,"target_after_budget":true,"target_in_assembly":false,"target_in_kenlm_inputs":false,"target_selected_final":false}
- note: target in candidates but not assembled

## FAILURE d052
- expected: 师傅，去浦东张江，走延安路高架。我赶九点半的会，要是堵车您提前跟我说。
- raw ASR (J): 市府区浦东张江走沿岸路高架 涡干 9点半的回药师赌车宁提前跟我说
- baseline final: 
- stagej final: 市府区浦东张江走沿岸路高架 涡干 9点半的回药师赌车宁提前跟我说
- first divergence: ASSEMBLY_DROP
- funnel: {"run_id":"stagej-1786989668781","dialog_id":"d052","target_in_base_candidates":true,"target_after_P":true,"target_after_D":true,"target_after_union":true,"target_after_budget":true,"target_in_assembly":false,"target_in_kenlm_inputs":false,"target_selected_final":false}
- note: target in candidates but not assembled

## FAILURE d053
- expected: 麻烦送我到深圳南山科技园南门，大概多久能到？我十点十分有个电话会。
- raw ASR (J): 麻烦送我到深圳南山科技园南门大概多久能到 我十点十分有隔电话会
- baseline final: 
- stagej final: 麻烦送我到深圳南山科技园南门大概多久能到 我十点十分有隔电话会
- first divergence: FINESPAN_MISS
- funnel: {"run_id":"stagej-1786989668781","dialog_id":"d053","target_in_base_candidates":false,"target_after_P":false,"target_after_D":false,"target_after_union":false,"target_after_budget":false,"target_in_assembly":false,"target_in_kenlm_inputs":false,"target_selected_final":false}
- note: FineSpan windows do not cover expected ngrams

## FAILURE d054
- expected: 去杭州西溪，不走三环可以吗？那边现在堵不堵？
- raw ASR (J): 去杭州戲戲不走三環 可以嗎?那扁現在賭不賭?
- baseline final: 
- stagej final: 去杭州戲西部走三环 可以嗎?那扁现在賭不賭?
- first divergence: ASSEMBLY_DROP
- funnel: {"run_id":"stagej-1786989668781","dialog_id":"d054","target_in_base_candidates":true,"target_after_P":true,"target_after_D":true,"target_after_union":true,"target_after_budget":true,"target_in_assembly":false,"target_in_kenlm_inputs":false,"target_selected_final":false}
- note: target in candidates but not assembled

## FAILURE d055
- expected: 医生您好，我这两天嗓子疼，想开点药并做个血常规。
- raw ASR (J): 一聲您好我這兩天嗓子疼想開店要並做各些常規
- baseline final: 
- stagej final: 一聲您好我這兩天嗓子疼想開店要並做各些常規
- first divergence: FINESPAN_MISS
- funnel: {"run_id":"stagej-1786989668781","dialog_id":"d055","target_in_base_candidates":false,"target_after_P":false,"target_after_D":false,"target_after_union":false,"target_after_budget":false,"target_in_assembly":false,"target_in_kenlm_inputs":false,"target_selected_final":false}
- note: FineSpan windows do not cover expected ngrams

## FAILURE d056
- expected: 挂号处请问内科还有号吗？我低烧，昨晚开始的。
- raw ASR (J): 挂号出请问 内刻还有号码 我低哨昨晚开始的
- baseline final: 
- stagej final: 挂号出请问 内刻还有号码 我低哨昨晚开始的
- first divergence: FINESPAN_MISS
- funnel: {"run_id":"stagej-1786989668781","dialog_id":"d056","target_in_base_candidates":false,"target_after_P":false,"target_after_D":false,"target_after_union":false,"target_after_budget":false,"target_in_assembly":false,"target_in_kenlm_inputs":false,"target_selected_final":false}
- note: FineSpan windows do not cover expected ngrams

## FAILURE d059
- expected: 请问这双鞋有四十码吗？不合适三天内可以退换吧？
- raw ASR (J): 请问,这双鞋有40码吗? 不合适的 三天内可以推换吧
- baseline final: 
- stagej final: 请问,这双鞋有40码吗? 不合适的 三天内可以推换吧
- first divergence: ASSEMBLY_DROP
- funnel: {"run_id":"stagej-1786989668781","dialog_id":"d059","target_in_base_candidates":true,"target_after_P":true,"target_after_D":true,"target_after_union":true,"target_after_budget":true,"target_in_assembly":false,"target_in_kenlm_inputs":false,"target_selected_final":false}
- note: target in candidates but not assembled

## FAILURE d060
- expected: 我想对比一下这两款订单中台的价格，会员日能再减一点吗？
- raw ASR (J): 我想对比一下这两款电脑 定单中台的加格会员日能再减一点吗?
- baseline final: 
- stagej final: 我想对比一下这两款电脑 定单中台的加格会员日能再减一点吗?
- first divergence: FINESPAN_MISS
- funnel: {"run_id":"stagej-1786989668781","dialog_id":"d060","target_in_base_candidates":false,"target_after_P":false,"target_after_D":false,"target_after_union":false,"target_after_budget":false,"target_in_assembly":false,"target_in_kenlm_inputs":false,"target_selected_final":false}
- note: FineSpan windows do not cover expected ngrams

## FAILURE d061
- expected: 周末要不要去江边骑行？天气预报说周日多云，记得带水。
- raw ASR (J): 众莫要不要去降边骑行 天气预报 周日多云积的带水
- baseline final: 
- stagej final: 众莫要不要去降边骑行 天气预报 周日多云积的带水
- first divergence: ASSEMBLY_DROP
- funnel: {"run_id":"stagej-1786989668781","dialog_id":"d061","target_in_base_candidates":true,"target_after_P":true,"target_after_D":true,"target_after_union":true,"target_after_budget":true,"target_in_assembly":false,"target_in_kenlm_inputs":false,"target_selected_final":false}
- note: target in candidates but not assembled

## FAILURE d062
- expected: 晚上一起吃饭吗？我知道一家川菜不错，大概七点到。
- raw ASR (J): 晚上 一起吃饭嘛,我知道一家川菜,不错大概起点到
- baseline final: 
- stagej final: 晚上 一起吃饭嘛,我知道一家川菜,不错大概起点到
- first divergence: FINESPAN_MISS
- funnel: {"run_id":"stagej-1786989668781","dialog_id":"d062","target_in_base_candidates":false,"target_after_P":false,"target_after_D":false,"target_after_union":false,"target_after_budget":false,"target_in_assembly":false,"target_in_kenlm_inputs":false,"target_selected_final":false}
- note: FineSpan windows do not cover expected ngrams

## FAILURE d063
- expected: 你最近忙不忙？想找你看下手机备份怎么设置。
- raw ASR (J): 你最近忙不忙,想找你看下手机备分怎么设置
- baseline final: 
- stagej final: 你最近忙不忙,想找你看下手机备分怎么设置
- first divergence: ASSEMBLY_DROP
- funnel: {"run_id":"stagej-1786989668781","dialog_id":"d063","target_in_base_candidates":true,"target_after_P":true,"target_after_D":true,"target_after_union":true,"target_after_budget":true,"target_in_assembly":false,"target_in_kenlm_inputs":false,"target_selected_final":false}
- note: target in candidates but not assembled

## FAILURE d064
- expected: 今天我们团队要讨论后选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
- raw ASR (J): 今天,我们团队要讨论候选生成相关的候选生成流程和商线计划安排请研发一起评估风险
- baseline final: 
- stagej final: 今天,我们团队要讨论候选生成相关的候选生成流程和商线计划安排请研发一起评估风险
- first divergence: ASSEMBLY_DROP
- funnel: {"run_id":"stagej-1786989668781","dialog_id":"d064","target_in_base_candidates":true,"target_after_P":true,"target_after_D":true,"target_after_union":true,"target_after_budget":true,"target_in_assembly":false,"target_in_kenlm_inputs":false,"target_selected_final":false}
- note: target in candidates but not assembled

## FAILURE d065
- expected: 这次发布我们先对齐上线计划窗口，后选生城模块需要联调，别漏掉回归。
- raw ASR (J): 這次發布我們線對其上述 当线即化窗口后学生,成模块需要连掉别漏掉回归
- baseline final: 
- stagej final: 这次發布我們線对齐上述 当县级化窗口后学生,成模块需要连掉别漏掉回归
- first divergence: ASSEMBLY_DROP
- funnel: {"run_id":"stagej-1786989668781","dialog_id":"d065","target_in_base_candidates":true,"target_after_P":true,"target_after_D":true,"target_after_union":true,"target_after_budget":true,"target_in_assembly":false,"target_in_kenlm_inputs":false,"target_selected_final":false}
- note: target in candidates but not assembled

## FAILURE d066
- expected: 会上提到候选生成链路要加监控，上线计划文档我下午更新一版。
- raw ASR (J): 会上提到 候选生陈列露,要加件空上线即画文当我下午更新一版
- baseline final: 
- stagej final: 会上提到 候选生陈列露,要加件空上线即画文当我下午更新一版
- first divergence: ASSEMBLY_DROP
- funnel: {"run_id":"stagej-1786989668781","dialog_id":"d066","target_in_base_candidates":true,"target_after_P":true,"target_after_D":true,"target_after_union":true,"target_after_budget":true,"target_in_assembly":false,"target_in_kenlm_inputs":false,"target_selected_final":false}
- note: target in candidates but not assembled

## FAILURE d067
- expected: 您好，我订单显示已发货但物流三天没更新，能帮我查一下吗？
- raw ASR (J): 您好我弟 但顯示已發貨,但物流三天沒更新能幫我查一下嗎?
- baseline final: 
- stagej final: 您好我弟 但顯示已發貨,但物流三天沒更新能幫我查一下嗎?
- first divergence: ASSEMBLY_DROP
- funnel: {"run_id":"stagej-1786989668781","dialog_id":"d067","target_in_base_candidates":true,"target_after_P":true,"target_after_D":true,"target_after_union":true,"target_after_budget":true,"target_in_assembly":false,"target_in_kenlm_inputs":false,"target_selected_final":false}
- note: target in candidates but not assembled

## FAILURE d071
- expected: 你如何看待跨团队协作？遇到需求变更一般怎么处理？
- raw ASR (J): 你如何看待夸团队写作,遇到需求边更一般怎么处理?
- baseline final: 
- stagej final: 你如何看待夸团队写作,遇到需求边更一般怎么处理?
- first divergence: ASSEMBLY_DROP
- funnel: {"run_id":"stagej-1786989668781","dialog_id":"d071","target_in_base_candidates":true,"target_after_P":true,"target_after_D":true,"target_after_union":true,"target_after_budget":true,"target_in_assembly":false,"target_in_kenlm_inputs":false,"target_selected_final":false}
- note: target in candidates but not assembled

## FAILURE d072
- expected: 期望薪资这块我们可以再沟通，你最快什么时候能入职？
- raw ASR (J): 期望星,自这块我们可以再沟通你最快什么时候能入职
- baseline final: 
- stagej final: 期望星,自这块我们可以再沟通你最快什么时候能入职
- first divergence: ASSEMBLY_DROP
- funnel: {"run_id":"stagej-1786989668781","dialog_id":"d072","target_in_base_candidates":true,"target_after_P":true,"target_after_D":true,"target_after_union":true,"target_after_budget":true,"target_in_assembly":false,"target_in_kenlm_inputs":false,"target_selected_final":false}
- note: target in candidates but not assembled

## FAILURE d073
- expected: 老师，这道题的解题步骤能不能再讲一遍？我没听懂第二点。
- raw ASR (J): 老是這道題的解題步,周能不能解? 我没听懂第二点
- baseline final: 
- stagej final: 老是這道題的解題步,周能不能解? 我没听懂第二点
- first divergence: FINESPAN_MISS
- funnel: {"run_id":"stagej-1786989668781","dialog_id":"d073","target_in_base_candidates":false,"target_after_P":false,"target_after_D":false,"target_after_union":false,"target_after_budget":false,"target_in_assembly":false,"target_in_kenlm_inputs":false,"target_selected_final":false}
- note: FineSpan windows do not cover expected ngrams

## FAILURE d074
- expected: 作业是下周一下午交吗？可以电子版提交吗？
- raw ASR (J): 作业是下周一下午叫吗?可以电子版提叫吗?
- baseline final: 
- stagej final: 作业是下周一下午叫吗?可以电子版提叫吗?
- first divergence: ASR_SOURCE_ERROR
- funnel: {"run_id":"stagej-1786989668781","dialog_id":"d074","target_in_base_candidates":false,"target_after_P":false,"target_after_D":false,"target_after_union":false,"target_after_budget":false,"target_in_assembly":false,"target_in_kenlm_inputs":false,"target_selected_final":false}
- note: raw ASR diverged and base/P/D did not recover target

## FAILURE d075
- expected: 请问这门课期末是开卷还是闭卷？重点会划吗？
- raw ASR (J): 请问这门客期末是开卷还是闭卷? 终点汇化吗?
- baseline final: 
- stagej final: 请问这门客期末是开卷还是闭卷? 终点汇化吗?
- first divergence: ASSEMBLY_DROP
- funnel: {"run_id":"stagej-1786989668781","dialog_id":"d075","target_in_base_candidates":true,"target_after_P":true,"target_after_D":true,"target_after_union":true,"target_after_budget":true,"target_in_assembly":false,"target_in_kenlm_inputs":false,"target_selected_final":false}
- note: target in candidates but not assembled

## FAILURE d076
- expected: 我预订的是大床房，能安排安静一点的楼层吗？
- raw ASR (J): 我预定的是搭床房能安排安静一点的楼层吗
- baseline final: 
- stagej final: 我预定的是搭床房能安排安静一点的楼层吗
- first divergence: ASSEMBLY_DROP
- funnel: {"run_id":"stagej-1786989668781","dialog_id":"d076","target_in_base_candidates":true,"target_after_P":true,"target_after_D":true,"target_after_union":true,"target_after_budget":true,"target_in_assembly":false,"target_in_kenlm_inputs":false,"target_selected_final":false}
- note: target in candidates but not assembled

## FAILURE d077
- expected: 早餐几点开始？退房可以延迟到下午两点吗？
- raw ASR (J): 早餐几点开始?退房可以延迟到下午2点吗?
- baseline final: 
- stagej final: 早餐几点开始?退房可以延迟到下午2点吗?
- first divergence: ASSEMBLY_DROP
- funnel: {"run_id":"stagej-1786989668781","dialog_id":"d077","target_in_base_candidates":true,"target_after_P":true,"target_after_D":true,"target_after_union":true,"target_after_budget":true,"target_in_assembly":false,"target_in_kenlm_inputs":false,"target_selected_final":false}
- note: target in candidates but not assembled

## FAILURE d078
- expected: 房间空调不太制冷，能派人上来看一下吗？
- raw ASR (J): 房间空调不太知冷能派人上来看一下嘛
- baseline final: 
- stagej final: 房间空调不太知冷能派人上来看一下嘛
- first divergence: ASSEMBLY_DROP
- funnel: {"run_id":"stagej-1786989668781","dialog_id":"d078","target_in_base_candidates":true,"target_after_P":true,"target_after_D":true,"target_after_union":true,"target_after_budget":true,"target_in_assembly":false,"target_in_kenlm_inputs":false,"target_selected_final":false}
- note: target in candidates but not assembled

## FAILURE d081
- expected: 请问理财产品的风险等级在哪里查看？
- raw ASR (J): 請問理財產品的風險等急在哪裡查看
- baseline final: 
- stagej final: 請問理財產品的風險等急在哪裡查看
- first divergence: FINESPAN_MISS
- funnel: {"run_id":"stagej-1786989668781","dialog_id":"d081","target_in_base_candidates":false,"target_after_P":false,"target_after_D":false,"target_after_union":false,"target_after_budget":false,"target_in_assembly":false,"target_in_kenlm_inputs":false,"target_selected_final":false}
- note: FineSpan windows do not cover expected ngrams

## FAILURE d082
- expected: 两位，靠窗有位置吗？不要香菜，微辣就行。
- raw ASR (J): 两位靠窗有位置吗? 不要像蔡薇娜就行
- baseline final: 
- stagej final: 两位靠窗有位置吗? 不要像蔡薇娜就行
- first divergence: FINESPAN_MISS
- funnel: {"run_id":"stagej-1786989668781","dialog_id":"d082","target_in_base_candidates":false,"target_after_P":false,"target_after_D":false,"target_after_union":false,"target_after_budget":false,"target_in_assembly":false,"target_in_kenlm_inputs":false,"target_selected_final":false}
- note: FineSpan windows do not cover expected ngrams

## FAILURE d083
- expected: 这道菜大概要等多久？我们先点一份凉菜和一壶茶。
- raw ASR (J): 這道菜大概要等多久? 我們先點一份涼菜和一壺茶
- baseline final: 
- stagej final: 這道菜大概要等多久? 我們先點一份涼菜和一壺茶
- first divergence: FINESPAN_MISS
- funnel: {"run_id":"stagej-1786989668781","dialog_id":"d083","target_in_base_candidates":false,"target_after_P":false,"target_after_D":false,"target_after_union":false,"target_after_budget":false,"target_in_assembly":false,"target_in_kenlm_inputs":false,"target_selected_final":false}
- note: FineSpan windows do not cover expected ngrams

## FAILURE d084
- expected: 可以打包吗？顺便结一下账，能扫码支付吗？
- raw ASR (J): 可以打爆麻 顺便结一下张能扫马支付吗?
- baseline final: 
- stagej final: 可以打爆麻 顺便结一下张能扫码支付吗?
- first divergence: ASSEMBLY_DROP
- funnel: {"run_id":"stagej-1786989668781","dialog_id":"d084","target_in_base_candidates":true,"target_after_P":true,"target_after_D":true,"target_after_union":true,"target_after_budget":true,"target_in_assembly":false,"target_in_kenlm_inputs":false,"target_selected_final":false}
- note: target in candidates but not assembled

## FAILURE d085
- expected: 私教课还剩几次？能帮我约明天晚上七点吗？
- raw ASR (J): 自教课还剩几次 能帮我约明天晚上7点吗?
- baseline final: 
- stagej final: 自教课还剩几次 能帮我约明天晚上7点吗?
- first divergence: FINESPAN_MISS
- funnel: {"run_id":"stagej-1786989668781","dialog_id":"d085","target_in_base_candidates":false,"target_after_P":false,"target_after_D":false,"target_after_union":false,"target_after_budget":false,"target_in_assembly":false,"target_in_kenlm_inputs":false,"target_selected_final":false}
- note: FineSpan windows do not cover expected ngrams

## FAILURE d086
- expected: 更衣室柜子钥匙找不到了，前台能帮忙开一下吗？
- raw ASR (J): 更易是龟仔钥匙找不到了前台 能帮忙开一下吗?
- baseline final: 
- stagej final: 更易是龟仔钥匙找不到了前台 能帮忙开一下吗?
- first divergence: ASSEMBLY_DROP
- funnel: {"run_id":"stagej-1786989668781","dialog_id":"d086","target_in_base_candidates":true,"target_after_P":true,"target_after_D":true,"target_after_union":true,"target_after_budget":true,"target_in_assembly":false,"target_in_kenlm_inputs":false,"target_selected_final":false}
- note: target in candidates but not assembled

## FAILURE d087
- expected: 游泳次卡本月月底到期，续费有优惠吗？
- raw ASR (J): 游泳自卡本月月底到期續飛遊 又會嗎?
- baseline final: 
- stagej final: 游泳自卡本月月底到期續飛遊 又會嗎?
- first divergence: FINESPAN_MISS
- funnel: {"run_id":"stagej-1786989668781","dialog_id":"d087","target_in_base_candidates":false,"target_after_P":false,"target_after_D":false,"target_after_union":false,"target_after_budget":false,"target_in_assembly":false,"target_in_kenlm_inputs":false,"target_selected_final":false}
- note: FineSpan windows do not cover expected ngrams

## FAILURE d088
- expected: 我们下午讨论后选声城方案，先把候选生成的接口文档补齐。
- raw ASR (J): 我们下午讨论后,选生成父。 方安线把候选生成的借口文当补齐
- baseline final: 
- stagej final: 我们下午讨论后,选生成父。 方安线把候选生成的借口文当补齐
- first divergence: ASSEMBLY_DROP
- funnel: {"run_id":"stagej-1786989668781","dialog_id":"d088","target_in_base_candidates":true,"target_after_P":true,"target_after_D":true,"target_after_union":true,"target_after_budget":true,"target_in_assembly":false,"target_in_kenlm_inputs":false,"target_selected_final":false}
- note: target in candidates but not assembled

## FAILURE d089
- expected: 这周的上线计花已经确认，上线计划评审安排在周四上午。
- raw ASR (J): 这周的上限计划已经确认上限计划评审安排在周四上午
- baseline final: 
- stagej final: 这周的上限计划已经确认上限计划评审安排在周四上午
- first divergence: ASSEMBLY_DROP
- funnel: {"run_id":"stagej-1786989668781","dialog_id":"d089","target_in_base_candidates":true,"target_after_P":true,"target_after_D":true,"target_after_union":true,"target_after_budget":true,"target_in_assembly":false,"target_in_kenlm_inputs":false,"target_selected_final":false}
- note: target in candidates but not assembled

## FAILURE d090
- expected: 关于后选生城和上线计化，请按上线计划执行，有问题群里说。
- raw ASR (J): 關於後,選生成為 和上限计划请按上限计划执行有问题 群里说
- baseline final: 
- stagej final: 關於後,選生成為 和上限计划请按上限计划执行有问题 群里说
- first divergence: ASSEMBLY_DROP
- funnel: {"run_id":"stagej-1786989668781","dialog_id":"d090","target_in_base_candidates":true,"target_after_P":true,"target_after_D":true,"target_after_union":true,"target_after_budget":true,"target_in_assembly":false,"target_in_kenlm_inputs":false,"target_selected_final":false}
- note: target in candidates but not assembled

## FAILURE d091
- expected: 你好，我想点一杯燕麦拿铁，中杯，无糖。顺便问一下今天有贝果吗？
- raw ASR (J): 你好,我想点一杯烟麦拿铁中备无糖 今天有被裹嗎?
- baseline final: 
- stagej final: 你好,我想点一杯烟麦拿铁中备无糖 今天有被裹嗎?
- first divergence: FINESPAN_MISS
- funnel: {"run_id":"stagej-1786989668781","dialog_id":"d091","target_in_base_candidates":false,"target_after_P":false,"target_after_D":false,"target_after_union":false,"target_after_budget":false,"target_in_assembly":false,"target_in_kenlm_inputs":false,"target_selected_final":false}
- note: FineSpan windows do not cover expected ngrams

## FAILURE d092
- expected: 麻烦帮我做一杯抹茶拿铁带走，大杯就行，谢谢。
- raw ASR (J): 麻煩幫我做一杯抹茶拿鐵帶走大 北周行謝謝
- baseline final: 
- stagej final: 麻煩幫我做一杯抹茶拿鐵带走大 北周行謝謝
- first divergence: ASSEMBLY_DROP
- funnel: {"run_id":"stagej-1786989668781","dialog_id":"d092","target_in_base_candidates":true,"target_after_P":true,"target_after_D":true,"target_after_union":true,"target_after_budget":true,"target_in_assembly":false,"target_in_kenlm_inputs":false,"target_selected_final":false}
- note: target in candidates but not assembled

## FAILURE d093
- expected: 请问这款冰美式可以少冰吗？我赶时间，小杯。
- raw ASR (J): 请问,这款病美是可以少病吗?我赶时间小呗!
- baseline final: 
- stagej final: 请问,这款病美是可以少病吗?我赶时间小呗!
- first divergence: FINESPAN_MISS
- funnel: {"run_id":"stagej-1786989668781","dialog_id":"d093","target_in_base_candidates":false,"target_after_P":false,"target_after_D":false,"target_after_union":false,"target_after_budget":false,"target_in_assembly":false,"target_in_kenlm_inputs":false,"target_selected_final":false}
- note: FineSpan windows do not cover expected ngrams

## FAILURE d094
- expected: 小陈，客户反馈翻译引擎接口报错，我们能不能加缓存，下午三点前把结论发群里？
- raw ASR (J): 小成科互反馈翻译引擎接口报错 我们能 不能加緩存下午,3點前把結論發群裡
- baseline final: 
- stagej final: 小成科互反馈翻译引擎接口报错 我们能 不能加缓存下午,3點前把结论發群裡
- first divergence: ASSEMBLY_DROP
- funnel: {"run_id":"stagej-1786989668781","dialog_id":"d094","target_in_base_candidates":true,"target_after_P":true,"target_after_D":true,"target_after_union":true,"target_after_budget":true,"target_in_assembly":false,"target_in_kenlm_inputs":false,"target_selected_final":false}
- note: target in candidates but not assembled

## FAILURE d095
- expected: 今天的站会先过一下订单中台进度，内存占用高这块需要限流保护，大家看一下风险。
- raw ASR (J): 今天,德湛会献过一下订单 中台,进都内 存占用高折块需要先留保护 大家看一下风险
- baseline final: 
- stagej final: 今天,德湛会献过一下订单 中台,进都内 存占用高折块需要先留保护 大家看一下风险
- first divergence: ASSEMBLY_DROP
- funnel: {"run_id":"stagej-1786989668781","dialog_id":"d095","target_in_base_candidates":true,"target_after_P":true,"target_after_D":true,"target_after_union":true,"target_after_budget":true,"target_in_assembly":false,"target_in_kenlm_inputs":false,"target_selected_final":false}
- note: target in candidates but not assembled
