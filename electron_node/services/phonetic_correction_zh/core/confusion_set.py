# -*- coding: utf-8 -*-
"""同音字混淆集，用于候选生成。不维护词表，不依赖外部文件。"""

# 同音字组：每组内字符同音（仅简体）
SAME_PINYIN_GROUPS = [
    ["余", "语", "鱼", "于", "与", "雨", "宇", "羽", "玉", "遇"],
    ["英", "音", "应", "鹰", "婴", "樱", "迎", "营", "影", "映"],
    ["识", "试", "式", "事", "世", "势", "市", "示", "视", "适"],
    ["别", "憋", "瘪", "蹩"],
    ["语", "与", "雨", "余", "鱼", "于", "宇", "羽", "玉"],
    ["音", "因", "阴", "英", "应", "鹰", "婴", "樱", "迎", "营"],
    ["系", "细", "戏", "习", "息", "希", "西", "洗", "喜"],
    ["统", "同", "通", "痛", "童", "铜", "桶"],
    ["测", "侧", "册", "策", "厕"],
    ["试", "事", "世", "势", "市", "识", "式", "示", "视", "适"],
    ["现", "线", "县", "先", "显", "险", "鲜", "限", "宪"],
    ["在", "再", "载", "灾", "仔"],
    ["开", "凯", "慨", "刊", "看", "康", "抗"],
    ["始", "使", "史", "士", "世", "市", "示", "事", "式", "视"],
    ["结", "节", "接", "街", "解", "界", "姐", "杰", "洁"],
    ["束", "数", "树", "书", "属", "术", "述", "熟"],
    ["稳", "温", "文", "闻", "问", "纹", "吻"],
    ["定", "顶", "订", "丁", "钉", "叮"],
    ["性", "兴", "星", "行", "形", "型", "姓", "幸"],
    ["能", "弄", "农", "浓", "诺"],
    ["被", "备", "北", "背", "倍", "贝", "杯"],
    ["强", "墙", "抢", "腔", "枪", "羌"],
    ["制", "之", "知", "直", "只", "指", "至", "志", "治", "质"],
    ["截", "节", "接", "街", "解", "界", "姐", "杰", "洁"],
    ["断", "段", "短", "端", "锻"],
    ["导", "到", "道", "倒", "岛", "刀", "盗"],
    ["致", "制", "之", "知", "直", "只", "指", "至", "志", "治"],
    ["前", "钱", "千", "迁", "签", "浅", "欠", "牵"],
    ["半", "办", "伴", "板", "版", "班", "般", "搬"],
    ["句", "具", "据", "举", "聚", "巨", "剧", "距"],
    ["话", "化", "画", "华", "划", "花", "滑", "话"],
    ["提", "题", "体", "替", "踢", "梯", "啼"],
    ["前", "钱", "千", "迁", "签", "浅", "欠", "牵"],
    ["发", "法", "罚", "发", "乏", "阀"],
    ["送", "松", "宋", "诵", "颂"],
    ["或", "和", "活", "火", "货", "获", "祸"],
    ["直", "之", "知", "制", "只", "指", "至", "志", "治", "质"],
    ["接", "街", "节", "解", "界", "姐", "杰", "洁", "结"],
    ["丢", "丢", "丢"],
    ["失", "师", "诗", "施", "十", "石", "时", "实", "食", "史"],
    ["清", "轻", "青", "情", "请", "晴", "庆", "倾"],
    ["分", "份", "粉", "奋", "纷", "芬", "坟"],
    ["策", "测", "侧", "册", "厕"],
    ["略", "论", "轮", "伦", "沦"],
    ["超", "朝", "抄", "吵", "钞", "潮"],
    ["时", "十", "石", "实", "食", "史", "师", "诗", "施", "失"],
    ["规", "归", "贵", "鬼", "轨", "柜", "跪"],
    ["则", "责", "择", "泽", "仄"],
    ["基", "机", "级", "极", "及", "即", "己", "计", "记", "技"],
    ["本", "奔", "笨", "本"],
    ["可", "克", "刻", "客", "课", "科", "颗", "壳"],
    ["用", "永", "勇", "拥", "涌", "泳", "庸"],
]

_confusion_map: dict = None


def _build_confusion_map() -> dict:
    global _confusion_map
    if _confusion_map is not None:
        return _confusion_map
    m = {}
    for group in SAME_PINYIN_GROUPS:
        for c in group:
            m[c] = group
    _confusion_map = m
    return m


def get_replaceable_positions(text: str, max_positions: int) -> list:
    """可替换位点：存在同音候选且候选数>=2 的字符位置。"""
    m = _build_confusion_map()
    chars = list(text)
    indices = [i for i in range(len(chars)) if chars[i] in m and len(m[chars[i]]) >= 2]
    if len(indices) <= max_positions:
        return indices
    return indices[-max_positions:]


def generate_candidates(text: str, positions: list, max_candidates: int) -> list:
    """候选句：原句 + 在指定位置用同音字替换的变体。"""
    m = _build_confusion_map()
    chars = list(text)
    out = [text]
    if not positions:
        return out

    def add_at(pos: int):
        group = m.get(chars[pos])
        if not group:
            return
        for c in group:
            if c == chars[pos]:
                continue
            t = chars[:]
            t[pos] = c
            s = "".join(t)
            if s not in out:
                out.append(s)
            if len(out) >= max_candidates:
                return

    for pos in positions:
        add_at(pos)
        if len(out) >= max_candidates:
            break
    if len(positions) >= 2:
        for i in range(len(positions)):
            if len(out) >= max_candidates:
                break
            for j in range(i + 1, len(positions)):
                if len(out) >= max_candidates:
                    break
                g1 = m.get(chars[positions[i]])
                g2 = m.get(chars[positions[j]])
                if not g1 or not g2:
                    continue
                for c1 in g1:
                    for c2 in g2:
                        t = chars[:]
                        t[positions[i]] = c1
                        t[positions[j]] = c2
                        s = "".join(t)
                        if s not in out:
                            out.append(s)
                        if len(out) >= max_candidates:
                            break
                    if len(out) >= max_candidates:
                        break
    return out[:max_candidates]
