#!/usr/bin/env node
/**
 * Industry Expansion Pack V2 — candidate pool → JSONL Source Package.
 *
 * Simulates real patch ops: new terms, duplicates, skipped existing, phrase filter, append.
 * Reuses V1 validate/reject rules; output JSONL is builder-clean.
 *
 * Env:
 *   INDUSTRY_PACK_V2_TARGET_ADD      default 7483 (~10k runtime from v6 base 2517)
 *   INDUSTRY_PACK_V2_TARGET_CANDIDATES default 13500
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pinyin } from 'pinyin-pro';
import { createRequire } from 'module';
import { repoRoot } from '../lib/paths.mjs';
import { loadTermIndex } from '../industry_pack_v1/lib/term-index.mjs';
import { EXPANSION_DENY_LIST } from '../industry_pack_v1/lib/constants.mjs';
import { rejectPhraseLike } from '../industry_pack_v1/lib/reject-phrase-like.mjs';

const require = createRequire(import.meta.url);
const { EXISTING_TERM_ID_BY_WORD } = require('../expansion-v1_1/terms-manifest.cjs');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSET_ROOT = path.join(repoRoot(), 'electron_node', 'docs', 'lexicon-assets', 'industry_pack_v2');
const V1_ROOT = path.join(repoRoot(), 'electron_node', 'docs', 'lexicon-assets', 'industry_pack_v1');
const OUT = path.join(ASSET_ROOT, 'entries.industry-pack-v2-full.jsonl');
const RAW_LOG = path.join(ASSET_ROOT, 'entries.candidates.raw.log.jsonl');
const STATS_OUT = path.join(ASSET_ROOT, 'entries.industry-pack-v2-full.generation-report.json');

const TARGET_ADD = Number(process.env.INDUSTRY_PACK_V2_TARGET_ADD ?? 7483);
const TARGET_CANDIDATES = Number(process.env.INDUSTRY_PACK_V2_TARGET_CANDIDATES ?? 13500);

const DOMAIN_QUOTAS = JSON.parse(
  fs.readFileSync(path.join(ASSET_ROOT, 'domain-theme-map.json'), 'utf8')
).domainQuotas;

const DOMAINS = Object.keys(DOMAIN_QUOTAS);

/** Char hints for domain affinity when mining base lexicon. */
const DOMAIN_HINTS = {
  tech_ai: '云计算网数码算软硬程序库索引询析觉学练型智能算法训练推理识别检测分类聚类匹配检索翻译问答摘要生成合成编码解码嵌入向量搜索分析挖掘统计报表指标维度标签特征样本标注清洗脱敏加密备份恢复迁移同步复制分片分区副本主从读写事务一致可用可靠弹性伸缩负载均衡容灾回滚认证授权鉴权签名哈希证书密钥令牌会话身份权限角色策略规则配置参数变量常量环境镜像容器编排调度构建编译制品依赖仓库版本分支合并提交标签测试预发生产开发调试性能压测基准重构设计架构模式原则规范标准文档注释机器深度神经卷积循环生成强化监督迁移联邦数据业务信息智能计算存储逻辑物理虚拟混合私有公有边缘分布并行串行实时离线在线云端本地远程移动桌面客户网关接口协议模块组件单元框架引擎平台集群节点资源任务作业流程管道通道队列缓存',
  meeting: '股票债券基金期货期权外汇汇率利率利差信用评级违约对冲套利做市承销保荐上市退市增发配股分红回购质押融券融资杠杆保证清算结算托管登记过户交易撮合行情盘口涨跌涨停跌停成交换手市盈市净净资收益毛利净利现金资产负债利润损益财报审计内控合规风控反洗尽职可疑大额洗钱恐怖制裁名单银行证券保险信托租赁保理小贷网贷支付投行资管私募公募财税税收增值所得消费关税印花契税土地房产车船环保资源自贸保税综保金融创业科创注册核准询价配售申购中签破发解禁限售流通股权员工持股回购注销可转可交永续次级优先普通存托红筹蓝筹白马黑马题材概念龙头权重周期成长价值防御进攻低估高估破净破发壳资借壳重组并购分拆私有要约收购协议竞价大宗盘后定价集合连续做市经纪投资财富私人家族办公信托离岸在岸跨境理财结构存款保本非保净值预期业绩比较管理托管申购赎回认购转换销售尾随业绩报酬持仓仓位建仓加仓减仓清仓止损止盈抄底逃顶追涨杀跌波段长线短线中线超短日内隔夜两融转融股权债券回购同业拆借同业存单大额结构通知定期活期零存整取整存零取存本取息教育储蓄住房公积住房补贴住房租赁住房贷款消费经营抵押信用质押保证组合联合银团项目并购过桥委托信托保理租赁票据贴现保函银行承兑商业承兑银行汇票商业汇票支票本票汇票托收汇款结汇售汇套汇套利投机保值避险套期保值基差升水贴水远期掉期互换期权现货仓单交割平仓开仓多头空头套保主力连续指数商品金融国债股指外汇利率能源金属农产品化工黑色有色贵金属基本小金属稀土煤炭钢铁铁矿螺纹热卷焦炭焦煤动力原油燃油沥青橡胶塑料甲醇乙二醇聚丙烯聚乙烯聚氯乙烯纸浆棉花白糖苹果红枣生猪鸡蛋玉米大豆豆粕菜粕菜油棕榈豆油花生尿素纯碱玻璃硅铁锰硅不锈钢镍铜铝锌铅锡黄金白银铂金钯金天然汽油柴油燃料寿险财险健康意外养老年金万能分红投连重疾医疗门诊住院免赔保额保费费率核保理赔保全退保犹豫等待观察受益投保被保保险标的除外如实告知不可抗复效减额保单现金价值红利满期给付伤残身故全残豁免附加主险团险个险银保电销网销经代再保共保分保偿付能力准备金精算核赔查勘定损理算核损追偿代位求偿残值施救防灾保费预定利率实际利率利差死差费差退保继续赔付综合成本手续费佣金管理费销售运营投资收益浮盈浮亏可供出售持有到期交易贷款应收衍生套期嵌入分离混合长期股权长期债权固定资产无形资产商誉递延所得应交税费应付债券应付股利其他应付资本公积盈余公积未分配利润少数股东权益库存实收资本股本面值溢价折价配股增发回购注销转股拆股合股送股转增股利股息红利除权除息填权贴权抢权股权登记红股红息现金红利股票红利财产红利特别红利中期分红末期分红招聘猎头内推校招社招实习试用转正离职辞退补偿竞业保密入职社保公积五险一金薪酬绩效奖金股权期权激励晋升调岗轮岗培训发展继任盘点编制预算人力成本外包派遣劳务合同工时加班休假年假病假事假产假陪产婚假丧假考勤打卡弹性远程混合办公文化价值雇主品牌敬业满意流失入职离职试用转正晋升调薪培训人均产值人效编制满编空编超编缺编招聘周期到岗周期录用面试通过拒绝放弃背调体检录用报到劝退协商解除经济补偿违法解除双倍赔偿代通知金未休年假加班绩效年终项目销售提成股权激励期权激励限制性股票虚拟员工持股合伙人事业合伙利润分享分红跟投行权归属解锁等待禁售减持套现个税专项附加扣除子女教育继续教育大病医疗住房贷款住房租金赡养老人婴幼儿照护个人养老金企业年金职业年金补充医疗补充公积团体意外团体医疗团体寿险雇主责任工伤失业生育医疗养老住房缴费基数比例封顶保底补缴欠缴断缴续缴转移合并提取贷款还款利率期限额度审批放款抵押担保保证质押信用合同协议条款违约赔偿仲裁诉讼原告被告举证质证辩护代理律师律所公证见证送达执行查封冻结扣押拍卖破产重整清算债权债务担保抵押质押保证连带追偿撤销无效可撤效力解释适用管辖冲突选择国际国内商事民事刑事行政劳动知识产权专利商标版权侵权许可转让独占排他普通政务行政许可审批备案登记证照一网通办最多跑一次放管服营商环境采购招标投标中标废标质疑投诉履约验收审计监察巡视督查问责公示听证复议信访网格社区基层治理数字化智慧城市电子政务互联网大数据区块链人工智能物联网云计算边缘计算数字孪生数字政府数字社会数字经济数字文化数字生态跨省通办同城通办免证办免申即享即申即办一次办集成办承诺制备案制审批制核准制注册制负面清单正面清单权力清单责任清单流程优化材料减少时限压缩环节减少跑动减少收费减少中介减少证明减少表单减少时间压缩成本降低效率提升满意获得幸福安全营商环境市场主体公平竞争产权保护契约精神诚信建设信用体系失信惩戒守信激励红黑榜信用修复信用报告信用评级信用等级信用记录信用档案信用码课程教学教研备课授课作业考试测验阅卷成绩学分学位学历招生录取报到注册学籍毕业论文答辩导师教授讲师助教实验室实训实习就业升学留学培训认证证书资格考级竞赛素质教育品牌定位细分目标市场调研问卷焦点小组用户洞察策略创意文案平面视频投放渠道媒介公关活动赞助代言联名促销折扣满减赠品会员私域公域流量获客转化留存复购裂变口碑传播新闻采访编辑排版出版发行订阅广告栏目节目直播录播点播转播版权转载原创深度调查评论专栏博客播客短视频长视频音频图文弹幕互动粉丝订阅打赏流量推荐算法热搜话题舆情辟谣核查进出口报关报检关税配额许可证原产地自贸保税综保跨境电商海外仓直邮保税备货集货拼箱整箱提单运单托收汇款结汇售汇核销退税补贴反倾销反补贴保障措施技术壁垒标准认证楼盘户型面积公摊得房容积率绿化物业开发商中介带看认购签约首付按揭贷款利率公积商业月供交房验房装修软装硬装建材家电家具入住出租租金押金租期续租退租转让过户产权会议论坛峰会研讨会座谈会圆桌主旨演讲嘉宾主持议程纪要同声传译展位展台展览开幕式闭幕式签约仪式路演发布会媒体接待证件胸牌手册资料展区赞助参展观众会务主办承办协办冠名晚宴茶歇签到投影话筒贵宾嘉宾观众媒体联席轮值主席副主席秘书长理事监事股东董事独立董事外部董事职工董事战略委员会审计委员会提名委员会薪酬委员会风险委员会合规委员会关联交易信息披露内幕交易短线交易敏感期窗口期静默期路演反路演分析师投资者机构散户游资北向资金南向资金沪港通深港通债券通理财通基金通互换通利率互换货币互换股票互换债券互换商品互换信用互换波动率互换业务管理分析顾问专员经理总监主管主任部长局长处长科长组长班长队长代表委员理事监事股东董事秘书助理文员会计出纳审计税务法务合规风控内控质检品控采购销售市场运营产品技术研发设计工程施工监理造价预算结算核算报表分析策划文案编辑记者摄影摄像主持演员歌手舞者模特导演制片编剧美术灯光音响舞台道具服装化妆造型特效后期剪辑调色混音字幕配音翻译传译同传交传笔译口译商务贸易',
  medical: '医病药诊疗血心肺肝肾脾胃肠骨眼耳鼻喉皮肤口腔急诊发热核酸抗原疫苗康复理疗针灸拔罐挂号诊室门诊住院出院病历处方药房取药输液注射化验影像超声心电图麻醉手术复查复诊转诊医保自费陪护病床护士主任专家',
  transport: '车路运港仓物流物配载卸搬运叉车托盘货架堆垛分拣打包贴标称重扫码出库入库盘点补货进出货承运托运派送签收拒收退货换货补发预售现货秒杀团购佣金分润结算对账单清分支付通道货车厢式冷藏危化品普货零担整车铁路水路航空海运内河联运多式枢纽场站月台泊位装卸工搬运工叉车工仓管员拣货员分拣员配送员快递员骑手网约车顺风车出租车专车快车拼车里程路费高速匝道限行拥堵绕行导航定位轨迹站点枢纽换乘候车站台班次发车到站离站检票出站进站候车厅售票加油充电停车违章罚单驾照行驶证年检保险辅路主路环岛掉头左转右转直行收费站服务区加油站充电桩停车位仓储费拣货费配送费履约时效妥投',
  tourism_hotel: '客房前台入住退房续住押金房卡早餐加床无烟海景城景套房标间大床双床钟点房行李寄存叫醒打扫备品拖鞋浴巾枕头空调暖气迷你吧礼宾',
  tourism_pickup: '接机送机接站送站举牌等候行李转盘航站楼到达口出发层停车楼落客区摆渡车贵宾厅休息室登机口安检口值机台',
  tourism_route: '行程景点门票导览讲解集合散团包车徒步索道缆车栈道观景台纪念馆博物馆古镇街区步行街夜市特产纪念品拍照打卡路线攻略预约限流闭园开放旺季',
  tourism_transport: '网约车顺风车出租车专车快车拼车里程路费高速匝道限行拥堵绕行导航定位轨迹站点枢纽换乘候车站台班次发车到站离站检票出站进站候车厅售票',
  coffee: '意式美式拿铁卡布摩卡澳白浓缩冷萃冰滴手冲虹吸法压单品拼配浅烘中烘深烘日晒水洗蜜处理酒香果香花香坚果焦糖香草榛果肉桂薄荷橙皮巧克力抹茶红茶乌龙茉莉桂花玫瑰薰衣草海盐黑糖红糖枫糖蜂蜜燕麦椰奶豆奶杏仁脱脂全脂半脂厚乳轻乳奶油顶奶盖黑咖白咖奶咖果咖茶咖酒咖特调创意季节限定招牌经典传统网红爆款人气热销畅销推荐试饮小杯中杯大杯超大迷你热饮冷饮常温去冰少冰多冰无糖少糖半糖全糖多糖微糖代糖现磨预磨挂耳胶囊粉包液包即溶冻干速溶三合一二合一精品商业庄园微批次吧台咖啡机磨豆机压粉器布粉器敲粉桶蒸汽棒奶缸拉花缸温度计电子秤计时器手冲壶滤杯架分享壶',
  milk_tea: '奶茶果茶奶盖芝士乌龙红茶绿茶茉莉花茶普洱茶大麦茶玄米茶红豆芋泥紫薯榴莲芒果草莓蓝莓柠檬百香果西柚柚子橙酱柠檬酱草莓酱芒果酱珍珠椰果布丁仙草烧仙草芋圆西米红豆绿豆莲子花生芝麻核桃杏仁腰果花生椰蓉燕麦全麦黑糖红糖枫糖蜂蜜糖浆风味少冰去冰常温温热热饮冷饮大杯中杯小杯加料减糖半糖全糖微糖无糖',
  bakery: '牛角丹麦可颂吐司法棍贝果司康玛芬泡芙蛋挞曲奇饼干华夫松饼戚风海绵芝士奶油黄油起酥酥皮面团发酵醒发揉面擀皮裱花夹馅淋面糖霜焦糖巧克力抹茶红豆芋泥紫薯榴莲芒果草莓蓝莓柠檬肉桂香草榛子核桃杏仁腰果花生芝麻椰蓉燕麦全麦黑麦粗粮杂粮低糖无糖微糖半糖全糖多糖加料减糖现烤现做预烤冷藏冷冻保鲜保质出炉烤盘烤架烤箱风炉平炉醒发箱搅拌机打蛋器刮刀裱花袋裱花嘴模具纸托油纸锡纸',
  food_order: '凉菜热菜主菜副菜汤品粥品面食米饭炒饭炒面盖饭套餐单人双人家庭聚餐宴请酒席婚宴寿宴满月周岁升学乔迁开业团餐盒饭便当沙拉轻食减脂健身代餐饱腹口感鲜香麻辣酸甜咸鲜清淡重口微辣中辣特辣变态辣不辣蒜蓉孜然椒盐五香红烧清蒸油炸煎煮炖焖煨焗烤烙涮烫煮拌腌卤熏腊腊味香肠火腿培根腊肉咸肉腌肉泡菜酸菜榨菜萝卜干豆角干茄子干蘑菇木耳银耳红枣枸杞桂圆荔枝芒果草莓蓝莓柠檬橙皮肉桂香草榛子核桃杏仁腰果花生芝麻椰蓉燕麦全麦黑麦粗粮杂粮',
};

const JUNK_INJECT = [
  '请确认订单',
  '怎么办理',
  '优质服务',
  '全文如下',
  '营销文案',
  'ASR错词',
  '本行政区域',
  '自然保护区',
  '马克思主义',
  '播放器',
  '珍珠港事件',
  '媒体播放器',
  '工作量',
  '异口同声',
];

const SKIP_WORDS = new Set([...EXPANSION_DENY_LIST, ...Object.keys(EXISTING_TERM_ID_BY_WORD)]);

function cjkCount(text) {
  return [...String(text)].filter((c) => /[\u4e00-\u9fff]/.test(c)).length;
}

function pinyinSpaced(word) {
  return pinyin(word, { toneType: 'none', type: 'string' }).replace(/\s+/g, ' ').trim();
}

function tonePinyinSpaced(word) {
  return pinyin(word, { toneType: 'num', type: 'string' }).replace(/\s+/g, ' ').trim();
}

function termIdForWord(word) {
  const pk = pinyinSpaced(word).split(' ').join('|');
  return `term-${Buffer.from(`${word}|${pk}`, 'utf8').toString('hex').slice(0, 16)}`;
}

function scoreDomain(word, domain) {
  const hints = DOMAIN_HINTS[domain] ?? '';
  let score = 0;
  for (const ch of word) {
    if (hints.includes(ch)) score += 1;
  }
  return score;
}

function pickDomain(word, quotas, filled) {
  let best = null;
  let bestScore = -1;
  for (const d of DOMAINS) {
    if ((filled[d] ?? 0) >= quotas[d]) continue;
    const s = scoreDomain(word, d);
    if (s > bestScore) {
      bestScore = s;
      best = d;
    }
  }
  if (best) return best;
  for (const d of DOMAINS) {
    if ((filled[d] ?? 0) < quotas[d]) return d;
  }
  return null;
}

function loadV1BankWords() {
  const words = [];
  for (const sub of ['word_banks_curated', 'word_banks', 'word_banks_supplement']) {
    const dir = path.join(V1_ROOT, sub);
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.txt'))) {
      const domain = file.replace(/\.txt$/, '');
      for (const line of fs.readFileSync(path.join(dir, file), 'utf8').split('\n')) {
        const w = line.trim();
        if (w) words.push({ word: w, domain, source: `v1_${sub}` });
      }
    }
  }
  return words;
}

function* mineBaseLexicon(existingWords) {
  const asset = path.join(
    repoRoot(),
    'electron_node/docs/lexicon-assets/p1_3_generic_zh_lexicon_v2_fw_domains/p1_3_lexicon_zh_v2'
  );
  const files = [
    path.join(asset, 'base_zh_v2/entries.jsonl'),
    path.join(asset, 'common5_zh_v2/entries.jsonl'),
    path.join(asset, 'idiom_zh_v2/entries.jsonl'),
  ];
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let o;
      try {
        o = JSON.parse(trimmed);
      } catch {
        continue;
      }
      const w = o.word?.trim();
      if (!w || existingWords.has(w)) continue;
      if (cjkCount(w) !== w.length || cjkCount(w) < 2 || cjkCount(w) > 5) continue;
      yield { word: w, source: path.basename(file) };
    }
  }
}

function loadExisting() {
  const sqlite = path.join(repoRoot(), 'node_runtime', 'lexicon', 'v3', 'lexicon.sqlite');
  const idx = loadTermIndex(sqlite);
  const existingWords = new Set(SKIP_WORDS);
  const existingTermIds = new Set();
  const wordToTermId = new Map();
  if (idx) {
    for (const word of idx.byWord.keys()) existingWords.add(word);
    for (const [word, list] of idx.byWord.entries()) {
      if (list.length === 1) wordToTermId.set(word, list[0].termId);
      for (const rec of list) existingTermIds.add(rec.termId);
    }
  }
  return { existingWords, existingTermIds, wordToTermId, idx };
}

function makeAddRow(word, domain) {
  return {
    word,
    pinyin: pinyinSpaced(word),
    tone_pinyin: tonePinyinSpaced(word),
    domain_tags: [domain],
    domain_weights: { [domain]: 1.0 },
    repair_target: true,
    enabled: true,
    prior_score: 0.85,
    lexiconLayer: 'domain_patch',
    source: 'industry_pack_v2',
    wave: 'full_v2',
    mutation: 'add',
  };
}

function makeAppendRow(word, termId, domain, weight = 0.7) {
  return {
    word,
    pinyin: pinyinSpaced(word),
    tone_pinyin: tonePinyinSpaced(word),
    mutation: 'append',
    term_id: termId,
    domain_tags: [domain],
    domain_weights: { [domain]: weight },
    repair_target: true,
    enabled: true,
    prior_score: 0.84,
    lexiconLayer: 'domain_patch',
    source: 'industry_pack_v2',
    wave: 'full_v2',
  };
}

function buildAppendOps(wordToTermId, existingWords) {
  const crossDomain = [
    { word: '智能体', domain: 'meeting', weight: 0.68 },
    { word: '大模型', domain: 'meeting', weight: 0.72 },
    { word: '挂号', domain: 'meeting', weight: 0.55 },
    { word: '网约车', domain: 'transport', weight: 0.75 },
    { word: '接机', domain: 'transport', weight: 0.7 },
    { word: '拿铁', domain: 'food_order', weight: 0.65 },
    { word: '浓缩', domain: 'milk_tea', weight: 0.6 },
    { word: '客房', domain: 'meeting', weight: 0.58 },
    { word: '行程', domain: 'meeting', weight: 0.6 },
    { word: '议程', domain: 'tech_ai', weight: 0.62 },
    { word: '展厅', domain: 'tourism_route', weight: 0.65 },
    { word: '导览', domain: 'tourism_hotel', weight: 0.63 },
    { word: '丹麦酥', domain: 'coffee', weight: 0.55 },
    { word: '导诊台', domain: 'tourism_pickup', weight: 0.5 },
    { word: '节点端', domain: 'transport', weight: 0.58 },
    { word: '旅游巴士', domain: 'transport', weight: 0.72 },
    { word: '凉拌黄瓜', domain: 'food_order', weight: 0.6 },
    { word: '阿萨姆红茶', domain: 'coffee', weight: 0.58 },
    { word: '平行投影', domain: 'tech_ai', weight: 0.45 },
    { word: '大堂', domain: 'meeting', weight: 0.55 },
    { word: '历史博物馆', domain: 'tourism_hotel', weight: 0.52 },
    { word: '接机牌', domain: 'transport', weight: 0.68 },
    { word: '阿拉比卡', domain: 'bakery', weight: 0.5 },
    { word: '中杯', domain: 'medical', weight: 0.45 },
    { word: '少冰', domain: 'medical', weight: 0.42 },
    { word: '机场', domain: 'transport', weight: 0.7 },
    { word: '预订', domain: 'transport', weight: 0.65 },
    { word: '蓝莓马芬', domain: 'bakery', weight: 0.55 },
    { word: '大杯', domain: 'medical', weight: 0.48 },
    { word: '小杯', domain: 'medical', weight: 0.48 },
  ];
  const ops = [];
  for (const spec of crossDomain) {
    const tid =
      wordToTermId.get(spec.word) ?? EXISTING_TERM_ID_BY_WORD[spec.word];
    if (!tid || !existingWords.has(spec.word)) continue;
    ops.push(makeAppendRow(spec.word, tid, spec.domain, spec.weight));
  }
  return ops;
}

function main() {
  const { existingWords, existingTermIds, wordToTermId } = loadExisting();
  const stats = {
    targetAdd: TARGET_ADD,
    targetCandidates: TARGET_CANDIDATES,
    candidateRecords: 0,
    skippedExisting: 0,
    duplicateInBatch: 0,
    filteredTerms: 0,
    rejectedTerms: 0,
    newTerms: 0,
    appendedDomains: 0,
    filteredByReason: {},
    domainAdds: Object.fromEntries(DOMAINS.map((d) => [d, 0])),
    sources: {},
  };

  const rawLog = [];
  const candidates = [];

  // Phase 1: build candidate pool (simulate ops intake)
  for (const { word, domain, source } of loadV1BankWords()) {
    candidates.push({ word, domain, source, kind: 'v1_bank' });
  }
  for (const w of JUNK_INJECT) {
    candidates.push({ word: w, domain: 'tech_ai', source: 'junk_inject', kind: 'junk' });
  }

  const filled = Object.fromEntries(DOMAINS.map((d) => [d, 0]));
  for (const item of mineBaseLexicon(existingWords)) {
  const domain = pickDomain(item.word, DOMAIN_QUOTAS, filled);
    if (!domain) break;
    candidates.push({ word: item.word, domain, source: item.source, kind: 'mined' });
    if (candidates.length >= TARGET_CANDIDATES * 2) break;
  }

  // Inject intentional duplicates (~15% of pool)
  const dupSource = candidates.slice(0, Math.min(2000, candidates.length));
  for (let i = 0; i < dupSource.length && candidates.length < TARGET_CANDIDATES + 2000; i++) {
    const src = dupSource[i % dupSource.length];
    candidates.push({ ...src, kind: 'duplicate_inject', source: `${src.source}+dup` });
  }

  // Trim / pad to target candidate window
  while (candidates.length < TARGET_CANDIDATES) {
    const src = candidates[candidates.length % Math.max(1, candidates.length - 1)] ?? candidates[0];
    if (!src) break;
    candidates.push({ ...src, kind: 'pad_dup', source: `${src.source}+pad` });
  }
  const pool = candidates.slice(0, TARGET_CANDIDATES + 500);

  const globalSeen = new Set();
  const usedTermIds = new Set();
  const outputRows = [];

  for (const cand of pool) {
    stats.candidateRecords++;
    const { word, domain } = cand;
    const rec = { word, domain, source: cand.source, kind: cand.kind, outcome: null };

    if (existingWords.has(word)) {
      stats.skippedExisting++;
      rec.outcome = 'skippedExisting';
      rawLog.push(rec);
      if (stats.candidateRecords >= TARGET_CANDIDATES && stats.newTerms >= TARGET_ADD) continue;
      continue;
    }
    if (globalSeen.has(word)) {
      stats.duplicateInBatch++;
      rec.outcome = 'duplicateInBatch';
      rawLog.push(rec);
      continue;
    }
    if (EXPANSION_DENY_LIST.includes(word)) {
      stats.rejectedTerms++;
      rec.outcome = 'denylist';
      rawLog.push(rec);
      continue;
    }
    if (rejectPhraseLike(word)) {
      stats.filteredTerms++;
      stats.filteredByReason.phrase_like = (stats.filteredByReason.phrase_like ?? 0) + 1;
      rec.outcome = 'filteredPhraseLike';
      rawLog.push(rec);
      continue;
    }
    const cjk = cjkCount(word);
    if (cjk < 2 || cjk > 5 || cjk !== word.length) {
      stats.filteredTerms++;
      stats.filteredByReason.bad_length = (stats.filteredByReason.bad_length ?? 0) + 1;
      rec.outcome = 'filteredLength';
      rawLog.push(rec);
      continue;
    }
    const termId = termIdForWord(word);
    if (usedTermIds.has(termId) || existingTermIds.has(termId)) {
      stats.duplicateInBatch++;
      rec.outcome = 'duplicateTermId';
      rawLog.push(rec);
      continue;
    }
    if ((filled[domain] ?? 0) >= DOMAIN_QUOTAS[domain] && stats.newTerms >= TARGET_ADD - 100) {
      rec.outcome = 'domainQuotaFull';
      rawLog.push(rec);
      continue;
    }

    globalSeen.add(word);
    usedTermIds.add(termId);
    filled[domain] = (filled[domain] ?? 0) + 1;
    stats.newTerms++;
    stats.domainAdds[domain]++;
    stats.sources[cand.source] = (stats.sources[cand.source] ?? 0) + 1;
    rec.outcome = 'add';
    rawLog.push(rec);
    outputRows.push(makeAddRow(word, domain));

    if (stats.newTerms >= TARGET_ADD) break;
  }

  const appendRows = buildAppendOps(wordToTermId, existingWords);
  stats.appendedDomains = appendRows.length;
  outputRows.push(...appendRows);

  if (stats.newTerms < TARGET_ADD - 100) {
    throw new Error(
      `[generate-industry-pack-v2] need ~${TARGET_ADD} addTerm, got ${stats.newTerms} — expand candidate pool`
    );
  }

  fs.mkdirSync(ASSET_ROOT, { recursive: true });
  fs.writeFileSync(OUT, `${outputRows.map((r) => JSON.stringify(r)).join('\n')}\n`, 'utf8');
  fs.writeFileSync(RAW_LOG, `${rawLog.map((r) => JSON.stringify(r)).join('\n')}\n`, 'utf8');

  const report = {
    out: OUT,
    rawLog: RAW_LOG,
    addTerm: stats.newTerms,
    append: stats.appendedDomains,
    total: outputRows.length,
    ...stats,
    effectiveAddRate: Number((stats.newTerms / stats.candidateRecords).toFixed(4)),
    duplicateRate: Number((stats.duplicateInBatch / stats.candidateRecords).toFixed(4)),
    skipRate: Number((stats.skippedExisting / stats.candidateRecords).toFixed(4)),
    filterRate: Number((stats.filteredTerms / stats.candidateRecords).toFixed(4)),
    domains: DOMAINS,
  };
  fs.writeFileSync(STATS_OUT, `${JSON.stringify(report, null, 2)}\n`);
  console.log('[generate-industry-pack-v2]', JSON.stringify(report, null, 2));
}

main();
