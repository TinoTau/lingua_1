<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: CURRENT SSOT + Acceptance Records
Archive Path: docs/archive/HISTORICAL/Lexicon_Domain_Evidence_Full_Audit.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: CURRENT SSOT + Acceptance Records

# Lexicon Domain Evidence Full Audit

**Date:** 2026-07-18  
**Type:** Phase 1 · Read-only Audit  
**Status:** COMPLETE · **STOP** — 禁止自动进入 Phase 2  
**Criterion:** 该 tag 是否能为 Domain Vote / sameDomain / Assembly 提供有效领域证据  
**DB:** `d:\Programs\github\lingua_1\node_runtime\lexicon\v3\lexicon.sqlite`  
**Patch Plan (full):** [`lexicon_domain_evidence_patch_plan.json`](./lexicon_domain_evidence_patch_plan.json)（同目录；镜像于 `tmp/budget_expansion_20260715/`）  
**审计脚本（只读）：** `electron_node/electron-node/tests/experiments/analyze-lexicon-domain-evidence-full-audit.py`  

---

## Executive Verdict

| 项 | 结论 |
|----|------|
| 有 tag 的 term | 9984 / 10000 |
| 当前 Base（空 tags） | 16 |
| tag 行 | 10092 |
| Meeting tag 行 | 4809 → 投影保留 **64** |
| Tech_AI tag 行 | 2537 → 投影保留 **145** |
| general tag 行 | **0**（须保持 0） |
| 建议变更 term 数 | **9159**（unchanged 825） |
| 投影后 Domain / Base term | **859** / **9141** |
| domain_lexicon 与 tags 不一致 | tags∉dl=47 · dl∉tags=55 |
| Phase 2 | **未执行**（本阶段停止） |

### 污染来源（摘要）

1. **Industry Pack 字袋灌入**（`industry_pack_v1/v2` 占 term 绝大多数）→ meeting/tech_ai 与 F&B 域大量无证据词。  
2. **Meeting / Tech_AI Inflation** — 无会务/技术证据仍挂域。  
3. **Capacity Validation 污染** — 机场/预订等挂 meeting/medical/tech。  
4. **串域** — 医疗/餐饮/旅游/会务/科技互相误挂（CORRECT/REMOVE）。  
5. **Phase1 后 domain_lexicon 未完全物化对齐** — tags 与 domain_lexicon 仍有差集。  

---

## 1. 当前统计

| 指标 | 值 |
|------|---:|
| term 总数 | 10000 |
| 有 tag 的 term | 9984 |
| 无 tag 的 term（Base） | 16 |
| tag 总行数 | 10092 |
| domain_lexicon 行 | 10100 |
| base_lexicon 行 | 50000 |
| 多 tag term（当前） | 68 |

### 1.1 每域当前 tag 数 / 建议 KEEP / REMOVE / CORRECT / 投影后

| Domain | Before | KEEP | REMOVE | CORRECT | Projected After |
|--------|-------:|-----:|-------:|--------:|----------------:|
| bakery | 227 | 102 | 125 | 0 | 102 |
| coffee | 407 | 111 | 296 | 0 | 111 |
| food_order | 265 | 53 | 212 | 0 | 53 |
| medical | 444 | 154 | 286 | 4 | 158 |
| meeting | 4809 | 64 | 4741 | 4 | 64 |
| milk_tea | 194 | 63 | 131 | 0 | 63 |
| tech_ai | 2537 | 140 | 2395 | 2 | 145 |
| tourism_hotel | 307 | 82 | 225 | 0 | 84 |
| tourism_pickup | 258 | 45 | 213 | 0 | 45 |
| tourism_route | 282 | 70 | 212 | 0 | 70 |
| tourism_transport | 247 | 35 | 211 | 1 | 35 |
| transport | 115 | 5 | 110 | 0 | 5 |

---

## 2. Runtime 证据链（只读确认）

```text
ASR / Raw Text
  → Span Detection / Fine Span
  → Pinyin Recall
       Domain SQL: domain_lexicon ⋈ term_domain_tags（scope）
       Base SQL:   base_lexicon
  → Candidate.domainId = hotword.domain ?? hotword.domains[0]  ← 多域压缩点
  → Domain Vote（utterance-domain-vote.ts，单 domainId 累加）
  → Winner
  → sameDomain（domainId === winner）+ Base
  → Sentence Assembly → KenLM
```

| 环节 | 文件/位置 | 与 tags 关系 |
|------|-----------|--------------|
| SSOT | `term_domain_tags` | 唯一词条领域归属 |
| 物化 | `domain_lexicon` | 派生；本轮发现与 tags 不完全一致 |
| Recall | `recall-topk-for-windows.ts` | `domains?.[0]` 压缩 |
| Vote | `utterance-domain-vote.ts` | 消费单 `domainId`；跳过 `general` |
| sameDomain | span-assembly-v4 | winner 精确匹配 |

**含义：** 词库 tags 质量直接决定 Vote 证据；多域词在 Runtime 仍可能只投 `domains[0]`（Phase 4/5 议题，本阶段不改代码）。

---

## 3. Meeting 有效证据词（KEEP meeting）

**数量：** 64

万隆会议、三亚会议、专题会议、业主论坛、东风论坛、中文论坛、主会场、主办、主办单位、主办方、主办者、主持、主持人、主持会议、主持者、会务、会务包、会务组、会场、会堂、会议、会议厅、会议室、会议桌、分会场、参会证、参展、参展商、参展国、参展证、发布会、同传机、同传间、圆桌、展位、峰会、平行投影、座谈会、开幕式、投影、投影仪、投影变换、投影幕、投影机、正交投影、瓦窑堡会议、研讨会、等积投影、等角投影、签到、签到台、签到处、纪要、茶歇、茶歇台、董事会、视频会议、议程、论坛、话筒、谷歌会议、路演、速记员、闭幕式

## 4. Tech_AI 有效证据词（KEEP tech_ai）

**数量：** 145

上线、专题评测、二级缓存、令牌、价值模型、优化器、优化日志、优化算法、倒排索引、候选、偏好对齐、全文检索、分词、剪枝、动量算法、卷积网络、向量、向量嵌入、向量数据库、向量检索、向量状态、向量索引、回滚、基准、基线模型、大模型、奖励模型、学习率、定量化、审计日志、容器、对模型、对齐、嵌入、嵌入式软件、嵌入模型、嵌入索引、开发、开发区、开发热、归纳推理、当前版本、微调、批量梯度、指令微调、接口、推理、推理加速、推理延迟、推理引擎、推理框架、推理模型、推理诊断、数据库、数量化、文档版本、日志、日志恢复、日志文件、日志格式、日志系统、日志索引、日志记录、旧版本、智能体、服务器、服务日志、服务编排、查看日志、标注、标注员、梯度、梯度累积、梯度裁剪、检查日志、检查点、检查编译后、检查节点端、模型仓库、模型卡片、模型审计、模型治理、模型注册、模型漂移、模型版本、正则、正则概形、正则策略、正则表达式、测试、消息队列、灰度、灰度发布、版本、版本号、特征、特征仓库、特征值、特征向量、特征工程、特征性、特征模型、电容器、直接推理、相似检索、神经网络、稀疏向量、稠密向量、策略模型、算力、索引日志、结构化日志、缓存、编译优化、翻译日志、联调、自动评测、自注意力、节点推理服、节点端、蒸馏、蒸馏水、见日志、训练、训练流程、训练班、训练监控、训练语料、评测、词库日志、语义检索、语料、语言模型、过去分词、过拟合、部署、配置推理、重排、重排序模型、重试推理、量化、量化感知、随机梯度、集群、领域日志

## 5. 其他各域有效证据词

### bakery（102）

中杯、丹麦酥、乡村面包、佛卡夏、全麦吐司、兰梅马芬、千层酥、南瓜吐司、可可吐司、可颂、司康、吐司、吐司面包、土司面包、坚果欧包、堂食、奶油泡芙、奶油餐包、奶酥包、奶酪丹麦、奶香吐司、奶黄酥、小麦胚芽、少冰、布朗尼、布里欧修、带走、恰巴塔、慕斯蛋糕、戚风蛋糕、打包、抹茶吐司、拿破仑酥、提拉米苏、无花果欧包、曲奇、曲奇饼、杂粮面包、杏仁丹麦、枫糖丹麦、核桃吐司、橄榄欧包、欧包、歌剧蛋糕、水果蛋糕、法棍、泡芙、洋葱贝果、海绵蛋糕、火腿吐司、燕麦曲奇、燕麦面包、牛奶面包、牛角、牛角之歌、牛角包、牛角挂书、生日蛋糕、番茄面包、白吐司、磅蛋糕、红豆吐司、结账、美小面包、肉松吐司、芋泥吐司、芝士吐司、芝士蛋糕、芝麻贝果、芝麻酥饼、苹果丹麦、菜单、菠菜面包、葡式蛋挞、葡萄干吐司、蒜蓉面包、蒜香法棍、蒜香面包、蓝莓丹麦、蓝莓贝果、蓝莓马芬、蔓越莓曲奇、蛋挞、蛋糕、蛋黄酥、蝴蝶酥、西点面包、贝果、费南雪、酸种面包、闪电泡芙、面包、面包师傅、面包房、面包车、面包酵母、餐前面包、马卡龙、马芬、鲜花蛋糕、黄油曲奇、黑麦面包

### coffee（111）

三段萃取、中杯、中烘焙、二段萃取、低因豆、冰拿铁、冰滴、冰滴液、冰美式、冷萃、冷萃液、出杯口、分流网、加冰、半糖、单品豆、卡布、卡布奇诺、压粉器、压粉垫、压粉锤、去冰、双份浓缩、含少冰、咖啡、咖啡价格、咖啡包、咖啡厅、咖啡取消、咖啡因、咖啡套餐、咖啡店、咖啡推荐、咖啡支付、咖啡时间、咖啡机、咖啡杯、咖啡渣、咖啡碱、咖啡等待、咖啡粉、咖啡色、咖啡评价、咖啡豆、咖啡辣度、咖啡过敏原、咖啡馆、堂食、大悲、大杯、小悲、小杯、小碑、少冰、少糖、带走、心形拉花、忠贝、恒压萃取、意式、意式机、手冲、手冲壶、打包、拉花、拉花缸、拉花针、拼配、拼配豆、拿铁、拿铁推荐、拿铁等待、拿铁辣度、摩卡、无糖、正常糖、氮气咖啡、浓缩、浓缩液、浓缩铀、滤杯、澳白、热拿铁、热美式、焦糖玛奇朵、熱拿铁中杯、燕麦奶、玛奇朵、研磨、研磨度、终杯、结账、罗布斯塔、美式、美式咖啡、美是、菜单、萃取、萃取头、萃取率、豆仓、豆单、豆奶、达杯、那铁、金杯液、钟贝、闷蒸、阿拉比卡、预浸泡、馥芮白

### food_order（53）

三文鱼寿司、中杯、乌冬面、企业会员、会员、会员中心、会员价、加冰、加料、加料处理、半糖、去冰、发票、堂食、大悲、大杯、套餐、寿司卷、小悲、小杯、小碑、少冰、少冰无写回、少糖、带走、忠贝、打包、拿铁、无糖、早餐、早餐券、早餐座位、早餐推荐、早餐时间、正常糖、百慕大杯、终杯、结账、美式、美式英语、美式足球、美是、菜单、蓝莓马芬、蛋糕、西式早餐、达杯、金枪鱼寿司、钟贝、预定、预订、香菜、鳗鱼寿司

### medical（158）

专家门诊、专科门诊、中国护士、主题医院、乙肝疫苗、住院、住院医师、住院手续、住院治疗、住院病人、住院费、住院部、体检、体检科、儿科、儿科医生、儿科学、内科、内科主任、内科医生、内科手术、内科病人、减毒疫苗、出院、出院单、创伤外科、动手术、化验、化验单、医保、医保卡、医生、医院、双挂号、变性手术、口腔、口腔前庭、口腔医学、口腔卫生、口腔康复、口腔溃疡、口腔疾病、口腔病灶、口腔科、口腔粘膜、口腔红斑、口腔褥疮、口腔诊所、咳嗽、嗓子、处方、处方笺、处方药、复诊、外科、外科主任、外科医生、外科学、外科手术、外科病人、大处方、头痛、妇科、妇科医生、妇科炎症、妇科疾病、妇科病、导诊台、小儿科、康复、康复中心、康复会、康复床、康复科、康复网、康复者、康复训练、开刀手术、心内科、心外科、心电图、心脏外科、急诊、急诊室、急诊病人、急诊科、急诊部、患者、感冒、手术、手术刀、手术台、手术室、手术费、护士、护士长、护理、护理单、护理液、护理费、挂号、挂号处、挂号费、放射、放射性核素、放射源、放射状、放射科、放射线、新生儿科、早日康复、普外科、注射液、活疫苗、理疗、理疗床、疫苗、病人、病历、病历夹 …（共 158，全量见 JSON）

### milk_tea（63）

中杯、乌龙茶、加冰、加大杯、加料、加料区、半糖、去冰、去冰量、咸奶盖、堂食、大悲、大杯、奶盖、奶茶、宝珍珠、小悲、小杯、小碑、少冰、少冰量、少糖、带走、忠贝、打包、无糖、椰果、椰果粒、正常糖、波霸、浦珍珠、海盐奶盖、满珍珠、焙火乌龙、珍珠、珍珠云母、珍珠奶茶、珍珠岩、珍珠梅、珍珠泉、珍珠港、珍珠白、珍珠粉圆、珍珠草、珍珠贝、珍珠项链、珍珠首饰、琥珀珍珠、白玉珍珠、白珍珠、石珍珠、终杯、结账、芋圆、芝士奶盖、菜单、赛珍珠、超大杯、达杯、钟贝、阿萨姆红茶、黑珍珠、黑糖珍珠

### tourism_hotel（84）

中国大酒店、中央酒店、产权酒店、假日酒店、入住、入住单、入住率、冰淇淋预约、前台、前台信息、前台分区、前台地点、前台安排、办理入住、办理退房、加床、加床费、千里无烟、双床、双床房、发票、叫醒、叫醒钟、商务酒店、国宾酒店、大堂、大床、大床房、大连酒店、大酒店、套房、客房、客房服、客房部、宾馆、宾馆酒店、希尔顿酒店、延迟退房咨、快捷酒店、总统套房、总统客房、成都酒店、房卡、房卡入口、托运行李、提前入住、无烟、无烟工业、无烟火药、无烟煤、早餐、有气无烟、礼宾、礼宾台、礼宾部、续住、续住单、续住费、花园酒店、苏州酒店、行李、行李卷儿、行李寄存、行李托运确、行李架、行李标签、行李物品、行李箱、行李订单、超速预约、退房、退房单、酒店、酒店业、酒店入住地、酒店安排、酒店退房窗、钟点房、随身行李、预定、预约、预订、饮料预约、高铁预约

### tourism_pickup（45）

举牌、举牌区、值机、值机区、值机台、值机员、值机柜台保、公交接送、公路接送、出发层、到达口、地铁接送、场接送、安检、安检单、安检口、安检员、安检通道、接机、接机员、接机牌、接站、接站员、接站牌、接送、接送保险、接送凭证、接送单、接送岗、接送时间、接送点、接送费用、末班车、火车接送、班车、登机口、登机牌、航站楼、输送机、送机、送机员、送站、送站员、集合点、首班车

### tourism_route（70）

上海博物馆、两条路线、交通路线、公交路线、公路路线、军事博物馆、包车、包车地点、包车证明、博物馆、历史博物馆、国家博物馆、地质博物馆、地铁路线、大英博物馆、导游、导航路线、导览、导览图、徒步路线、总路线、打卡、打卡点、接驳车路线、攻略、散团、新景点、旺季、旺季票、景点、景点取消、淡旺季、火车路线、私人包车、租车路线、签证路线、索道、索道线、缆车、缆车提醒、若采用路线、行程、行程保险、行程单、行程取消、行程图、行程订单、行程证明、观景点、路线、路线图、路线规划、车票路线、还车路线、道路路线、铁路线、长城博物馆、门票、闭园、集合、集合点、预定、预约、预约票、预订、风景点、首都博物馆、高速路线、鲁迅博物馆、黄包车

### tourism_transport（35）

专车、交通拥堵、候车、候车厅、养路费、出租车、匝道、匝道口、司机、夜班车、导航、导航台、导航图、快车、快车道、拥堵、拼车、接机、接送、旅游巴士、早班车、机场、检票、班次、班车、网约车、航站楼、路线、路费、车牌、辅路线、送机、限行、顺风车、高速

### transport（5）

接机牌、旅游巴士、机场、网约车、预订

---

## 6. 明确 Base 词

### 6.1 当前已是 Base（空 tags）

今天、你好、可以吗、四十码、大家、安排、客户、开始、系统、经理、结束、赶时间、进行、问一下、问题、顺便

### 6.2 本审计建议清空全部 tags → Base（9125）

全量见 JSON `projected` / 各 term `after_tags:[]`。抽样（按字顺前 150）：

一世、一中、一举、一事、一体、一体化、一侧、一共、一再、一切、一剑、一口同声、一口气、一同、一向、一块儿、一大、一定、一家人、一小、一带、一幅、一并处理、一律、一心、一战、一新、一旁、一日线、一旦、一早、一时、一时期、一期、一来、一样、一流、一灯、一爆、一直、一经、一致、一般、一路上、一边、一连、一院制、一隅、一齐、七分糖、七月、万向、万物、万用手册、丈夫、三代、三军、三分糖、三合、三拼料、三日、三日线、三环、三级、上下、上下同欲、上下客区、上下文、上下游、上下班、上下级、上下颠倒、上书、上任、上前、上升、上午、上半年、上去、上司、上周、上学、上客层、上将、上层、上帝、上年、上报、上方、上来、上次、上涨、上游、上演、上班、上空、上级、上网、上课、上车区、上车点、上边、上述、上面、下令、下列、下午、下半场、下半年、下去、下属、下岗、下手、下旬、下来、下次、下游、下滑、下班、下级、下落、下设、下跌、下车区、下车点、下载、下辖、下达、下部、下锅、下降、下面、下马、不一、不下、不中、不久、不久前、不仅、不仅仅、不会、不但、不住、不便、不停、不免、不再、不准、不利、不利于 …（共 9125，全量见 JSON）

---

## 7. 多领域词

### 7.1 当前多 tag（68）→ 投影后（44）

投影后多域词全量：

- **中杯**: ['bakery', 'coffee', 'food_order', 'milk_tea'] → ['bakery', 'coffee', 'food_order', 'milk_tea']
- **加冰**: ['coffee', 'food_order', 'milk_tea'] → ['coffee', 'food_order', 'milk_tea']
- **加料**: ['food_order', 'milk_tea'] → ['food_order', 'milk_tea']
- **半糖**: ['coffee', 'food_order', 'milk_tea'] → ['coffee', 'food_order', 'milk_tea']
- **去冰**: ['coffee', 'food_order', 'milk_tea'] → ['coffee', 'food_order', 'milk_tea']
- **发票**: ['food_order', 'tourism_hotel'] → ['food_order', 'tourism_hotel']
- **堂食**: ['bakery', 'coffee', 'food_order', 'milk_tea'] → ['bakery', 'coffee', 'food_order', 'milk_tea']
- **大悲**: ['coffee', 'food_order', 'milk_tea'] → ['coffee', 'food_order', 'milk_tea']
- **大杯**: ['coffee', 'food_order', 'milk_tea'] → ['coffee', 'food_order', 'milk_tea']
- **小悲**: ['coffee', 'food_order', 'milk_tea'] → ['coffee', 'food_order', 'milk_tea']
- **小杯**: ['coffee', 'food_order', 'milk_tea'] → ['coffee', 'food_order', 'milk_tea']
- **小碑**: ['coffee', 'food_order', 'milk_tea'] → ['coffee', 'food_order', 'milk_tea']
- **少冰**: ['bakery', 'coffee', 'food_order', 'milk_tea'] → ['bakery', 'coffee', 'food_order', 'milk_tea']
- **少糖**: ['coffee', 'food_order', 'milk_tea'] → ['coffee', 'food_order', 'milk_tea']
- **带走**: ['bakery', 'coffee', 'food_order', 'milk_tea'] → ['bakery', 'coffee', 'food_order', 'milk_tea']
- **忠贝**: ['coffee', 'food_order', 'milk_tea'] → ['coffee', 'food_order', 'milk_tea']
- **打包**: ['bakery', 'coffee', 'food_order', 'milk_tea'] → ['bakery', 'coffee', 'food_order', 'milk_tea']
- **拿铁**: ['coffee', 'food_order'] → ['coffee', 'food_order']
- **接机**: ['tourism_pickup', 'tourism_transport', 'transport'] → ['tourism_pickup', 'tourism_transport']
- **接机牌**: ['tourism_pickup', 'transport'] → ['tourism_pickup', 'transport']
- **接送**: ['tourism_pickup', 'tourism_transport'] → ['tourism_pickup', 'tourism_transport']
- **旅游巴士**: ['tourism_transport', 'transport'] → ['tourism_transport', 'transport']
- **无糖**: ['coffee', 'food_order', 'milk_tea'] → ['coffee', 'food_order', 'milk_tea']
- **早餐**: ['food_order', 'tourism_hotel'] → ['food_order', 'tourism_hotel']
- **机场**: ['meeting', 'tech_ai', 'tourism_transport', 'transport'] → ['tourism_transport', 'transport']
- **正常糖**: ['coffee', 'food_order', 'milk_tea'] → ['coffee', 'food_order', 'milk_tea']
- **班车**: ['tourism_pickup', 'tourism_transport'] → ['tourism_pickup', 'tourism_transport']
- **终杯**: ['coffee', 'food_order', 'milk_tea'] → ['coffee', 'food_order', 'milk_tea']
- **结账**: ['bakery', 'coffee', 'food_order', 'milk_tea'] → ['bakery', 'coffee', 'food_order', 'milk_tea']
- **网约车**: ['tourism_transport', 'transport'] → ['tourism_transport', 'transport']
- **美式**: ['coffee', 'food_order'] → ['coffee', 'food_order']
- **美是**: ['coffee', 'food_order'] → ['coffee', 'food_order']
- **航站楼**: ['tourism_pickup', 'tourism_transport'] → ['tourism_pickup', 'tourism_transport']
- **菜单**: ['bakery', 'coffee', 'food_order', 'milk_tea'] → ['bakery', 'coffee', 'food_order', 'milk_tea']
- **蓝莓马芬**: ['bakery', 'food_order'] → ['bakery', 'food_order']
- **蛋糕**: ['bakery', 'food_order'] → ['bakery', 'food_order']
- **路线**: ['tourism_route', 'tourism_transport'] → ['tourism_route', 'tourism_transport']
- **达杯**: ['coffee', 'food_order', 'milk_tea'] → ['coffee', 'food_order', 'milk_tea']
- **送机**: ['tourism_pickup', 'tourism_transport'] → ['tourism_pickup', 'tourism_transport']
- **钟贝**: ['coffee', 'food_order', 'milk_tea'] → ['coffee', 'food_order', 'milk_tea']
- **集合点**: ['tourism_pickup', 'tourism_route'] → ['tourism_pickup', 'tourism_route']
- **预定**: ['food_order', 'tourism_hotel', 'tourism_route'] → ['food_order', 'tourism_hotel', 'tourism_route']
- **预约**: ['tourism_hotel', 'tourism_route'] → ['tourism_hotel', 'tourism_route']
- **预订**: ['food_order', 'medical', 'meeting', 'tourism_hotel', 'tourism_route', 'transport'] → ['food_order', 'tourism_hotel', 'tourism_route', 'transport']

### 7.2 重点抽查

- **订单**: ABSENT — 词条结构问题或未入库；不得为 Vote 保留不合规长词
- **预订**: ['food_order', 'medical', 'meeting', 'tourism_hotel', 'tourism_route', 'transport'] → ['food_order', 'tourism_hotel', 'tourism_route', 'transport'] (KEEP:food_order; REMOVE:medical; REMOVE:meeting; KEEP:tourism_hotel; KEEP:tourism_route; KEEP:transport)
- **前台**: ['tourism_hotel'] → ['tourism_hotel'] (KEEP:tourism_hotel)
- **联调**: ['tech_ai'] → ['tech_ai'] (KEEP:tech_ai)
- **上线计划**: ABSENT — 词条结构问题或未入库；不得为 Vote 保留不合规长词
- **接口文档**: ABSENT — 词条结构问题或未入库；不得为 Vote 保留不合规长词
- **少糖**: ['coffee', 'food_order', 'milk_tea'] → ['coffee', 'food_order', 'milk_tea'] (KEEP:coffee; KEEP:food_order; KEEP:milk_tea)
- **少冰**: ['bakery', 'coffee', 'food_order', 'milk_tea'] → ['bakery', 'coffee', 'food_order', 'milk_tea'] (KEEP:bakery; KEEP:coffee; KEEP:food_order; KEEP:milk_tea)
- **中杯**: ['bakery', 'coffee', 'food_order', 'milk_tea'] → ['bakery', 'coffee', 'food_order', 'milk_tea'] (KEEP:bakery; KEEP:coffee; KEEP:food_order; KEEP:milk_tea)
- **大杯**: ['coffee', 'food_order', 'milk_tea'] → ['coffee', 'food_order', 'milk_tea'] (KEEP:coffee; KEEP:food_order; KEEP:milk_tea)
- **机场**: ['meeting', 'tech_ai', 'tourism_transport', 'transport'] → ['tourism_transport', 'transport'] (REMOVE:meeting; REMOVE:tech_ai; KEEP:tourism_transport; KEEP:transport)
- **路线**: ['tourism_route', 'tourism_transport'] → ['tourism_route', 'tourism_transport'] (KEEP:tourism_route; KEEP:tourism_transport)

### 7.3 词条结构问题

`上线计划` / `接口文档`：**不在 term 表**。若冻结规则仅允许 2～3 字（4～5 字仅成语/专名），不得为 Vote 强行保留长词；应靠组成词 `上线`/`接口`/`计划`/`文档` 的证据设计（`计划`/`文档` 属 Base 零证据）。

`订单`：**不在 term 表**（Phase1 亦跳过）。

---

## 8. 错域清单（CORRECT）

**数量：** 11

- 体检: meeting → medical (wrong_domain_should_be_medical)
- 宾馆: meeting → tourism_hotel (wrong_domain_should_be_tourism_hotel)
- 延迟退房咨: tech_ai → tourism_hotel (wrong_domain_should_be_tourism_hotel)
- 开发热: medical → tech_ai (wrong_domain_should_be_tech_ai)
- 患者: meeting → medical (wrong_domain_should_be_medical)
- 服务日志: tourism_transport → tech_ai (wrong_domain_should_be_tech_ai)
- 检查日志: medical → tech_ai (wrong_domain_should_be_tech_ai)
- 检查编译后: medical → tech_ai (wrong_domain_should_be_tech_ai)
- 检查节点端: medical → tech_ai (wrong_domain_should_be_tech_ai)
- 血压: tech_ai → medical (wrong_domain_should_be_medical)
- 高血压: meeting → medical (wrong_domain_should_be_medical)

---

## 9. 修改后预计统计

| 指标 | Before | After（投影） | Δ |
|------|-------:|-------------:|--:|
| tag 行 | 10092 | 935 | -9157 |
| Domain term | 9984 | 859 | -9125 |
| Base term | 16 | 9141 | 9125 |
| meeting | 4809 | 64 | -4745 |
| tech_ai | 2537 | 145 | -2392 |

---

## 10. 对 Recall / Vote / sameDomain / Assembly 的预期影响

| 层 | 预期 |
|----|------|
| Domain Recall | meeting/tech 噪声命中大幅下降；细域 F&B/医疗/旅游更干净 |
| Domain Vote | Meeting/Tech_AI Winner 霸榜应明显缓解；insufficientEvidence/general 可能上升（健康信号） |
| sameDomain | winner 为细域时纯度上升；不再被无证据 meeting 词灌入 |
| Assembly | 同域可组装候选减少噪声；Base 词增多进入 Base Bucket |
| 风险 | 模式未覆盖的真证据词可能被 REMOVE（见不确定清单）；Phase2 须分批+抽检 |
| Runtime 多域压缩 | `domains[0]` 问题仍在；词库清洗不能单独解决多域展开 |

---

## 11. 无法自动确认、必须保守处理的词

**数量：** 1848（多为 `no_evidence_for_domain_pack_or_noise` 自动 REMOVE，需运营抽检防误删）

原则：Phase2 **不得**在执行时重新发明规则；对 JSON 中 `uncertain=true` 的词，建议 Batch 前人工抽检 ≥5%。

抽样 80：

- 一日线: ['tourism_route'] → []
- 一爆: ['coffee'] → []
- 七分糖: ['milk_tea'] → []
- 三分糖: ['milk_tea'] → []
- 三拼料: ['milk_tea'] → []
- 三日线: ['tourism_route'] → []
- 三环: ['tourism_transport'] → []
- 上下客区: ['tourism_transport'] → []
- 上客层: ['tourism_pickup'] → []
- 上车区: ['tourism_pickup'] → []
- 上车点: ['tourism_transport'] → []
- 下去: ['coffee'] → []
- 下落: ['tourism_pickup'] → []
- 下车区: ['tourism_pickup'] → []
- 下车点: ['tourism_transport'] → []
- 专家学者: ['medical'] → []
- 专家建议: ['medical'] → []
- 专家教授: ['medical'] → []
- 专家系统: ['medical'] → []
- 专家组: ['medical'] → []
- 专家论证: ['medical'] → []
- 两日线: ['tourism_route'] → []
- 中关村: ['tourism_transport'] → []
- 中央空调: ['tourism_hotel'] → []
- 中巴车: ['tourism_transport'] → []
- 中心注水: ['coffee'] → []
- 中转点: ['tourism_pickup'] → []
- 中转车: ['tourism_transport'] → []
- 中途点: ['tourism_route'] → []
- 中途站: ['tourism_transport'] → []
- 临停区: ['tourism_pickup'] → []
- 临床: ['medical'] → []
- 主任医师: ['medical'] → []
- 主任委员: ['medical'] → []
- 主任科员: ['medical'] → []
- 主干线: ['tourism_transport'] → []
- 主路: ['tourism_transport'] → []
- 主路径: ['tourism_transport'] → []
- 主题房: ['tourism_hotel'] → []
- 之前: ['tourism_hotel'] → []
- 乐园: ['tourism_route'] → []
- 乘坐: ['transport'] → []
- 乘客电梯: ['tourism_hotel'] → []
- 乘车码: ['tourism_transport'] → []
- 乡道线: ['tourism_transport'] → []
- 乡镇: ['tourism_route'] → []
- 书院: ['tourism_route'] → []
- 乳酪包: ['bakery'] → []
- 二手空调: ['tourism_hotel'] → []
- 二爆: ['coffee'] → []
- 五分糖: ['milk_tea'] → []
- 交接单: ['tourism_pickup'] → []
- 交通图: ['tourism_route'] → []
- 交通违章: ['tourism_transport'] → []
- 产地卡: ['coffee'] → []
- 亲子房: ['tourism_hotel'] → []
- 亲子线: ['tourism_route'] → []
- 亲眼: ['medical'] → []
- 人大主任: ['medical'] → []
- 今天有蓝莓: ['bakery'] → []
- 从业证: ['tourism_transport'] → []
- 仙桃: ['milk_tea'] → []
- 仙草: ['milk_tea'] → []
- 仙草冻: ['milk_tea'] → []
- 代主任: ['medical'] → []
- 代糖: ['milk_tea'] → []
- 以前: ['tourism_hotel'] → []
- 以西: ['milk_tea'] → []
- 休息: ['tourism_pickup'] → []
- 休息区: ['tourism_pickup'] → []
- 休息室: ['tourism_pickup'] → []
- 休息时间: ['tourism_pickup'] → []
- 休整点: ['tourism_route'] → []
- 会合点: ['tourism_pickup'] → []
- 会员制: ['coffee'] → []
- 会员单位: ['food_order'] → []
- 会员名单: ['food_order'] → []
- 会员国: ['coffee'] → []
- 会员大会: ['food_order'] → []
- 会员帐号: ['food_order'] → []

全量：`lexicon_domain_evidence_patch_plan.json` → `uncertain_terms`。

---

## 12. 冻结合同核对

| 原则 | 本审计 |
|------|--------|
| tags 唯一 SSOT | 是；domain_lexicon 仅对照差集 |
| Base = 空 tags | 是；未建议新字段 |
| 判据 = Vote 证据 | 是；禁用术语/词长/pack/tag 数 |
| 多域逐条确认 | 是；term×domain |
| 未改 Runtime/Vote | 是 |

---

## 13. Phase 1 完成门禁

- [x] 全量 term×domain 审计（非仅抽样）
- [x] `Lexicon_Domain_Evidence_Full_Audit.md`
- [x] `lexicon_domain_evidence_patch_plan.json`（可执行 · 本轮禁止落库）
- [ ] **人工确认清单格式与抽检** → 才允许 Phase 2

```text
Phase 1 COMPLETE — STOP
Do NOT enter Phase 2 automatically.
```
