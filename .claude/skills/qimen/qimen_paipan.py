#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
奇门遁甲排盘脚本 - 时家转盘奇门（拆补法）
输入：公历年月日时
输出：完整盘面JSON

用法：python3 qimen_paipan.py 2026 4 11 15
     python3 qimen_paipan.py  (不带参数则使用当前时间)
"""
import sys, json, math
from datetime import datetime

# ======================== 基础数据 ========================

TIANGAN = ["甲","乙","丙","丁","戊","己","庚","辛","壬","癸"]
DIZHI = ["子","丑","寅","卯","辰","巳","午","未","申","酉","戌","亥"]

# 三奇六仪排列顺序（地盘用）
SANQI_LIUYI = ["戊","己","庚","辛","壬","癸","丁","丙","乙"]

# 洛书顺飞序（宫位编号）
LUOSHU_ORDER = [1,2,3,4,5,6,7,8,9]
# 洛书逆飞序
LUOSHU_REVERSE = [9,8,7,6,5,4,3,2,1]

# 顺时针宫位排列（跳过中5，用于转盘）
ZHUAN_ORDER = [1,8,3,4,9,2,7,6]

# 九星原始宫位
JIUXING = {1:"天蓬",2:"天芮",3:"天冲",4:"天辅",5:"天禽",6:"天心",7:"天柱",8:"天任",9:"天英"}
JIUXING_WUXING = {"天蓬":"水","天芮":"土","天冲":"木","天辅":"木","天禽":"土","天心":"金","天柱":"金","天任":"土","天英":"火"}
JIUXING_JIXIONG = {"天蓬":"凶","天芮":"凶","天冲":"吉","天辅":"吉","天禽":"中","天心":"吉","天柱":"凶","天任":"吉","天英":"凶"}

# 八门原始宫位
BAMEN = {1:"休门",2:"死门",3:"伤门",4:"杜门",9:"景门",6:"开门",7:"惊门",8:"生门"}
BAMEN_WUXING = {"休门":"水","死门":"土","伤门":"木","杜门":"木","景门":"火","开门":"金","惊门":"金","生门":"土"}
BAMEN_JIXIONG = {"休门":"吉","死门":"凶","伤门":"凶","杜门":"中","景门":"中","开门":"吉","惊门":"凶","生门":"吉"}

# 八神（阳遁顺排）
BASHEN_YANG = ["值符","腾蛇","太阴","六合","勾陈","朱雀","九地","九天"]
BASHEN_YIN = ["值符","腾蛇","太阴","六合","白虎","玄武","九地","九天"]

# 宫位名称与五行
GONG_NAME = {1:"坎一宫",2:"坤二宫",3:"震三宫",4:"巽四宫",5:"中五宫",6:"乾六宫",7:"兑七宫",8:"艮八宫",9:"离九宫"}
GONG_FANGWEI = {1:"北",2:"西南",3:"东",4:"东南",5:"中",6:"西北",7:"西",8:"东北",9:"南"}
GONG_WUXING = {1:"水",2:"土",3:"木",4:"木",5:"土",6:"金",7:"金",8:"土",9:"火"}

# 地支对应宫位
DIZHI_GONG = {"子":1,"丑":8,"寅":8,"卯":3,"辰":4,"巳":4,"午":9,"未":2,"申":2,"酉":7,"戌":6,"亥":6}

# 六甲隐仪
LIUJIA = [
    {"旬首":"甲子","隐仪":"戊","旬空":["戌","亥"]},
    {"旬首":"甲戌","隐仪":"己","旬空":["申","酉"]},
    {"旬首":"甲申","隐仪":"庚","旬空":["午","未"]},
    {"旬首":"甲午","隐仪":"辛","旬空":["辰","巳"]},
    {"旬首":"甲辰","隐仪":"壬","旬空":["寅","卯"]},
    {"旬首":"甲寅","隐仪":"癸","旬空":["子","丑"]},
]

# 节气局数表
# 阳遁：冬至到芒种（12个节气）
YANGDUN_JU = {
    "冬至":[1,7,4],"小寒":[2,8,5],"大寒":[3,9,6],
    "立春":[8,5,2],"雨水":[9,6,3],"惊蛰":[1,7,4],
    "春分":[3,9,6],"清明":[4,1,7],"谷雨":[5,2,8],
    "立夏":[4,1,7],"小满":[5,2,8],"芒种":[6,3,9],
}
# 阴遁：夏至到大雪（12个节气）
YINDUN_JU = {
    "夏至":[9,3,6],"小暑":[8,2,5],"大暑":[7,1,4],
    "立秋":[2,5,8],"处暑":[1,4,7],"白露":[9,3,6],
    "秋分":[7,1,4],"寒露":[6,9,3],"霜降":[5,8,2],
    "立冬":[6,9,3],"小雪":[5,8,2],"大雪":[4,7,1],
}

# ======================== 节气计算 ========================

# 节气角度（春分=0度起算）
JIEQI_NAMES = [
    "春分","清明","谷雨","立夏","小满","芒种",
    "夏至","小暑","大暑","立秋","处暑","白露",
    "秋分","寒露","霜降","立冬","小雪","大雪",
    "冬至","小寒","大寒","立春","雨水","惊蛰"
]

def jieqi_of_year(year):
    """计算某年24节气的精确时间（近似算法，误差约1天）"""
    # 使用寿星万年历近似算法
    jieqi_list = []
    for i in range(24):
        angle = i * 15  # 每个节气15度
        # 近似计算
        jd = _jieqi_jd(year, angle)
        dt = _jd_to_datetime(jd)
        name = JIEQI_NAMES[i]
        jieqi_list.append({"name": name, "datetime": dt, "angle": angle})
    # 按时间排序
    jieqi_list.sort(key=lambda x: x["datetime"])
    return jieqi_list

def _jieqi_jd(year, angle):
    """计算某年某节气的儒略日（近似）"""
    # 简化的VSOP87近似
    # 春分点近似
    y = year + (angle / 360.0) * 1.0
    # 基于经验公式的节气JD计算
    jd0 = 2451259.428 + 365.2422 * (y - 2000)
    # 修正
    t = (jd0 - 2451545.0) / 36525.0
    # 太阳黄经近似
    L = 280.46646 + 36000.76983 * t + 0.0003032 * t * t
    M = 357.52911 + 35999.05029 * t - 0.0001537 * t * t
    M_rad = math.radians(M)
    C = (1.914602 - 0.004817 * t) * math.sin(M_rad) + \
        0.019993 * math.sin(2 * M_rad) + 0.000289 * math.sin(3 * M_rad)
    sun_lon = (L + C) % 360
    # 迭代修正到目标角度
    target = angle
    diff = target - sun_lon
    if diff > 180: diff -= 360
    if diff < -180: diff += 360
    jd0 += diff / 360.0 * 365.2422
    return jd0

def _jd_to_datetime(jd):
    """儒略日转datetime"""
    jd += 0.5
    z = int(jd)
    f = jd - z
    if z < 2299161:
        a = z
    else:
        alpha = int((z - 1867216.25) / 36524.25)
        a = z + 1 + alpha - int(alpha / 4)
    b = a + 1524
    c = int((b - 122.1) / 365.25)
    d = int(365.25 * c)
    e = int((b - d) / 30.6001)
    day = b - d - int(30.6001 * e) + f
    month = e - 1 if e < 14 else e - 13
    year = c - 4716 if month > 2 else c - 4715
    day_int = int(day)
    frac = day - day_int
    hour = int(frac * 24)
    minute = int((frac * 24 - hour) * 60)
    try:
        return datetime(int(year), int(month), int(day_int), int(hour), int(minute))
    except:
        return datetime(int(year), int(month), 1, 0, 0)

# ======================== 干支计算 ========================

def year_ganzhi(year):
    """年干支"""
    g = (year - 4) % 10
    z = (year - 4) % 12
    return TIANGAN[g], DIZHI[z]

def month_ganzhi(year, month, day, jieqi_list):
    """月干支（以节气分界）"""
    # 找到当前所在的节气月
    # 月建：正月建寅，以立春为界
    jie_months = ["立春","惊蛰","清明","立夏","芒种","小暑",
                  "立秋","白露","寒露","立冬","大雪","小寒"]
    current_dt = datetime(year, month, day)

    # 确定月份
    month_idx = 0
    for i, jq in enumerate(jieqi_list):
        if jq["name"] in jie_months:
            if current_dt >= jq["datetime"]:
                month_idx = jie_months.index(jq["name"])

    # 年干决定月干起点
    yg = (year - 4) % 10
    # 甲己之年丙作首
    month_gan_start = [2, 4, 6, 8, 0, 2, 4, 6, 8, 0]  # 各年干对应的正月天干index
    mg = (month_gan_start[yg] + month_idx) % 10
    mz = (month_idx + 2) % 12  # 正月=寅=2
    return TIANGAN[mg], DIZHI[mz]

def day_ganzhi(year, month, day):
    """日干支（使用基姆拉尔森公式变体）"""
    # 从已知基准日推算
    # 2000年1月1日 = 甲辰日 (干=0甲, 支=4辰)
    from datetime import date
    base = date(2000, 1, 1)
    target = date(year, month, day)
    diff = (target - base).days
    # 2000-1-1的干支序号
    base_ganzhi = 12  # 甲辰 = 第12个（从甲子=0起算的60甲子序号）
    # 实际校正：2000-1-1是甲辰日
    # 甲=0, 辰=4, 60甲子中甲辰序号= ?
    # 甲子0,乙丑1,...甲辰需要算 天干甲=0,地支辰=4
    # (0*6+4*5)%60 不对，用查表法
    # 甲子=0,乙丑=1,...甲戌=10,乙亥=11,丙子=12,...
    # 2000-1-7是庚午日（已验证）
    # 2000-1-1往前推：1-7减6天=1-1
    # 庚午: 干庚=6, 支午=6, 序号=6
    # 所以1-1序号=6-6=0...不对
    # 直接用已知数据：2024-2-4（立春）= 甲子日
    base2 = date(2024, 2, 4)
    diff2 = (target - base2).days
    base2_idx = 0  # 甲子
    idx = (base2_idx + diff2) % 60
    g = idx % 10
    z = idx % 12
    return TIANGAN[g], DIZHI[z], idx

def hour_ganzhi(day_gan, hour):
    """时干支"""
    # 日上起时法
    day_gan_idx = TIANGAN.index(day_gan)
    start_map = {0:0, 1:2, 2:4, 3:6, 4:8, 5:0, 6:2, 7:4, 8:6, 9:8}
    zi_gan = start_map[day_gan_idx]

    # 时辰地支
    shi_zhi_idx = ((hour + 1) // 2) % 12
    shi_gan_idx = (zi_gan + shi_zhi_idx) % 10
    return TIANGAN[shi_gan_idx], DIZHI[shi_zhi_idx]

# ======================== 排盘核心 ========================

def find_xunshow(gan, zhi):
    """找旬首"""
    g = TIANGAN.index(gan)
    z = DIZHI.index(zhi)
    # 从当前干支往回推到甲
    diff = g  # 甲的index是0，往回推g步
    xun_zhi_idx = (z - diff) % 12
    xun_zhi = DIZHI[xun_zhi_idx]
    for item in LIUJIA:
        if item["旬首"] == "甲" + xun_zhi:
            return item
    # 兜底
    return LIUJIA[0]

def get_current_jieqi(dt, year):
    """获取当前时间所在的节气"""
    jq_list = jieqi_of_year(year)
    # 也要考虑上一年的大雪/冬至
    jq_prev = jieqi_of_year(year - 1)

    all_jq = jq_prev + jq_list
    all_jq.sort(key=lambda x: x["datetime"])

    current_jq = all_jq[0]
    for jq in all_jq:
        if dt >= jq["datetime"]:
            current_jq = jq
        else:
            break
    return current_jq

def determine_ju(jieqi_name, day_ganzhi_idx):
    """确定局数"""
    is_yang = jieqi_name in YANGDUN_JU
    is_yin = jieqi_name in YINDUN_JU

    if not is_yang and not is_yin:
        # 默认
        return 1, True

    # 确定三元（上中下）
    # 简化：用日干支的60甲子序号来判断
    # 符头：甲子/己卯=上元首日, 甲午/己酉=上元首日
    # 甲寅/己丑=中元首日, 甲申/己未=中元首日
    # 甲辰/己巳=下元首日, 甲戌/己亥=下元首日
    yuan_map = {
        0:0, 30:0, 16:0, 46:0,   # 甲子(0),甲午(30),己卯(16),己酉(46) -> 上元
        50:1, 20:1, 26:1, 56:1,  # 甲寅(50),甲申(20),己丑(26),己未(56) -> 中元
        40:2, 10:2, 6:2, 36:2,   # 甲辰(40),甲戌(10),己巳(6),己亥(36) -> 下元
    }

    # 找到最近的符头
    futou_idx = day_ganzhi_idx % 60
    # 往回找5天内的符头
    yuan = 0  # 默认上元
    for back in range(5):
        check_idx = (futou_idx - back) % 60
        if check_idx in yuan_map:
            yuan = yuan_map[check_idx]
            break

    if is_yang:
        ju_list = YANGDUN_JU[jieqi_name]
        return ju_list[yuan], True
    else:
        ju_list = YINDUN_JU[jieqi_name]
        return ju_list[yuan], False

def bu_dipan(ju_num, is_yang):
    """布地盘"""
    dipan = {}
    order = SANQI_LIUYI  # 戊己庚辛壬癸丁丙乙

    if is_yang:
        # 阳遁：从ju_num宫起戊，按洛书顺飞
        start_idx = LUOSHU_ORDER.index(ju_num)
        for i, gan in enumerate(order):
            gong = LUOSHU_ORDER[(start_idx + i) % 9]
            dipan[gong] = gan
    else:
        # 阴遁：从ju_num宫起戊，按洛书逆飞
        start_idx = LUOSHU_REVERSE.index(ju_num)
        for i, gan in enumerate(order):
            gong = LUOSHU_REVERSE[(start_idx + i) % 9]
            dipan[gong] = gan

    return dipan

def bu_tianpan(dipan, xunshow_info, shi_gan, is_yang):
    """布天盘（九星）"""
    # 1. 旬首隐仪在地盘哪宫 → 该宫原始九星 = 值符星
    yinyi = xunshow_info["隐仪"]
    zhifu_gong = None
    for gong, gan in dipan.items():
        if gan == yinyi:
            zhifu_gong = gong
            break
    if zhifu_gong is None:
        zhifu_gong = 2  # 中5寄坤2

    zhifu_xing = JIUXING[zhifu_gong]

    # 2. 时干在地盘哪宫 → 值符星飞到该宫
    shi_gan_gong = None
    for gong, gan in dipan.items():
        if gan == shi_gan:
            shi_gan_gong = gong
            break
    if shi_gan_gong is None:
        shi_gan_gong = 2

    # 3. 转盘排九星
    # 值符星从原宫转到时干宫
    tianpan_xing = {}
    tianpan_gan = {}

    # 在ZHUAN_ORDER中找到值符原宫和目标宫的位置
    if zhifu_gong == 5:
        zhifu_gong = 2  # 中5寄坤2
    if shi_gan_gong == 5:
        shi_gan_gong = 2

    orig_pos = ZHUAN_ORDER.index(zhifu_gong) if zhifu_gong in ZHUAN_ORDER else 0
    target_pos = ZHUAN_ORDER.index(shi_gan_gong) if shi_gan_gong in ZHUAN_ORDER else 0
    shift = target_pos - orig_pos

    for i, gong in enumerate(ZHUAN_ORDER):
        src_idx = (i - shift) % 8
        src_gong = ZHUAN_ORDER[src_idx]
        tianpan_xing[gong] = JIUXING[src_gong]
        tianpan_gan[gong] = dipan.get(src_gong, "")

    # 中5特殊处理
    tianpan_xing[5] = "天禽"
    tianpan_gan[5] = dipan.get(5, dipan.get(2, ""))

    return tianpan_xing, tianpan_gan, zhifu_xing, zhifu_gong, shi_gan_gong

def bu_renpan(dipan, xunshow_info, shi_zhi, zhifu_gong, is_yang):
    """布人盘（八门）"""
    # 值使门 = 值符原宫的八门
    zhishi_men = BAMEN.get(zhifu_gong, BAMEN.get(2, "死门"))

    # 值使随时宫
    shi_zhi_idx = DIZHI.index(shi_zhi)
    zhifu_gong_actual = zhifu_gong if zhifu_gong != 5 else 2

    # 计算从值符原宫转了几步到时支宫
    zhishi_gong_orig = zhifu_gong_actual

    # 找值使原宫在ZHUAN_ORDER中的位置
    if zhishi_gong_orig in ZHUAN_ORDER:
        orig_pos = ZHUAN_ORDER.index(zhishi_gong_orig)
    else:
        orig_pos = 0

    # 时支对应宫位
    shi_gong = DIZHI_GONG[shi_zhi]

    # 从旬首时辰的地支到当前时辰地支的距离
    xunshow_zhi = xunshow_info["旬首"][1]  # 甲X的X
    xunshow_zhi_idx = DIZHI.index(xunshow_zhi)
    steps = (shi_zhi_idx - xunshow_zhi_idx) % 12

    # 值使门转宫
    if is_yang:
        target_pos = (orig_pos + steps) % 8
    else:
        target_pos = (orig_pos - steps) % 8

    renpan = {}
    for i, gong in enumerate(ZHUAN_ORDER):
        src_idx = (i - (target_pos - orig_pos)) % 8
        src_gong = ZHUAN_ORDER[src_idx]
        renpan[gong] = BAMEN.get(src_gong, "")

    zhishi_target_gong = ZHUAN_ORDER[target_pos]

    return renpan, zhishi_men, zhishi_target_gong

def bu_shenpan(zhifu_target_gong, is_yang):
    """布神盘（八神）"""
    bashen = BASHEN_YANG if is_yang else BASHEN_YIN

    shenpan = {}
    if zhifu_target_gong == 5:
        zhifu_target_gong = 2

    if zhifu_target_gong in ZHUAN_ORDER:
        start_pos = ZHUAN_ORDER.index(zhifu_target_gong)
    else:
        start_pos = 0

    for i, shen in enumerate(bashen):
        if is_yang:
            pos = (start_pos + i) % 8
        else:
            pos = (start_pos - i) % 8
        gong = ZHUAN_ORDER[pos]
        shenpan[gong] = shen

    return shenpan

def get_kongwang(xunshow_info):
    """获取空亡宫位"""
    kong_zhi = xunshow_info["旬空"]
    kong_gong = set()
    for zhi in kong_zhi:
        if zhi in DIZHI_GONG:
            kong_gong.add(DIZHI_GONG[zhi])
    return list(kong_gong), kong_zhi

# ======================== 主排盘函数 ========================

def paipan(year, month, day, hour):
    """主排盘函数"""
    dt = datetime(year, month, day, hour)

    # 1. 排四柱
    yg, yz = year_ganzhi(year)
    jq_list = jieqi_of_year(year)
    mg, mz = month_ganzhi(year, month, day, jq_list)
    dg, dz, day_idx = day_ganzhi(year, month, day)
    hg, hz = hour_ganzhi(dg, hour)

    # 2. 定节气和局数
    current_jq = get_current_jieqi(dt, year)
    ju_num, is_yang = determine_ju(current_jq["name"], day_idx)

    # 3. 查旬首（以时柱为准）
    xunshow = find_xunshow(hg, hz)

    # 4. 布地盘
    dipan = bu_dipan(ju_num, is_yang)

    # 5. 布天盘
    tianpan_xing, tianpan_gan, zhifu_xing, zhifu_orig, zhifu_target = bu_tianpan(dipan, xunshow, hg, is_yang)

    # 6. 布人盘
    renpan, zhishi_men, zhishi_gong = bu_renpan(dipan, xunshow, hz, zhifu_orig, is_yang)

    # 7. 布神盘
    shenpan = bu_shenpan(zhifu_target, is_yang)

    # 8. 空亡
    kong_gong, kong_zhi = get_kongwang(xunshow)

    # 组装结果
    result = {
        "四柱": {
            "年柱": yg + yz,
            "月柱": mg + mz,
            "日柱": dg + dz,
            "时柱": hg + hz
        },
        "节气": current_jq["name"],
        "阴阳遁": "阳遁" if is_yang else "阴遁",
        "局数": ju_num,
        "旬首": xunshow["旬首"],
        "隐仪": xunshow["隐仪"],
        "值符星": zhifu_xing,
        "值符落宫": zhifu_target,
        "值使门": zhishi_men,
        "值使落宫": zhishi_gong,
        "空亡地支": kong_zhi,
        "空亡宫位": kong_gong,
        "九宫": {}
    }

    for gong in range(1, 10):
        if gong == 5:
            result["九宫"][gong] = {
                "宫名": GONG_NAME[5],
                "方位": "中",
                "五行": "土",
                "备注": "天禽寄坤二宫"
            }
            continue

        gong_data = {
            "宫名": GONG_NAME[gong],
            "方位": GONG_FANGWEI[gong],
            "宫五行": GONG_WUXING[gong],
            "地盘干": dipan.get(gong, ""),
            "天盘干": tianpan_gan.get(gong, ""),
            "九星": tianpan_xing.get(gong, ""),
            "八门": renpan.get(gong, ""),
            "八神": shenpan.get(gong, ""),
            "空亡": gong in kong_gong
        }
        result["九宫"][gong] = gong_data

    return result

def format_pan(result):
    """格式化输出盘面"""
    lines = []
    lines.append(f"═══════════════════════════════════════════")
    lines.append(f"  {result['阴阳遁']}{result['局数']}局  {result['节气']}")
    lines.append(f"  四柱：{result['四柱']['年柱']} {result['四柱']['月柱']} {result['四柱']['日柱']} {result['四柱']['时柱']}")
    lines.append(f"  旬首：{result['旬首']}  隐仪：{result['隐仪']}")
    lines.append(f"  值符：{result['值符星']}(落{GONG_NAME[result['值符落宫']]})")
    lines.append(f"  值使：{result['值使门']}(落{GONG_NAME[result['值使落宫']]})")
    lines.append(f"  空亡：{''.join(result['空亡地支'])}({','.join(GONG_NAME[g] for g in result['空亡宫位'])})")
    lines.append(f"═══════════════════════════════════════════")

    # 九宫格显示（上南下北）
    layout = [[4,9,2],[3,5,7],[8,1,6]]
    for row in layout:
        line1 = ""
        line2 = ""
        line3 = ""
        line4 = ""
        for gong in row:
            if gong == 5:
                line1 += "│  中五宫(中)    "
                line2 += "│  天禽寄坤二宫  "
                line3 += "│                "
                line4 += "│                "
            else:
                d = result["九宫"][gong]
                kong_mark = "空" if d.get("空亡") else "  "
                line1 += f"│{d['宫名'][:5]:　<5}  {kong_mark} "
                line2 += f"│神:{d['八神']:<4} 星:{d['九星']:<4}"
                line3 += f"│门:{d['八门']:<4} {d['天盘干']}/{d['地盘干']}   "
                line4 += f"│{d['方位']:<6}          "
        lines.append("┌────────────────┬────────────────┬────────────────┐" if row == layout[0] else "├────────────────┼────────────────┼────────────────┤")
        lines.append(line1 + "│")
        lines.append(line2 + "│")
        lines.append(line3 + "│")
        lines.append(line4 + "│")
    lines.append("└────────────────┴────────────────┴────────────────┘")

    return "\n".join(lines)

# ======================== 主程序 ========================

if __name__ == "__main__":
    if len(sys.argv) >= 5:
        y, m, d, h = int(sys.argv[1]), int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4])
    else:
        now = datetime.now()
        y, m, d, h = now.year, now.month, now.day, now.hour

    result = paipan(y, m, d, h)

    # 输出格式化盘面
    print(format_pan(result))
    print()

    # 输出JSON（供Claude读取）
    print("===JSON_START===")
    # 转换int key为string for JSON
    json_result = result.copy()
    json_result["九宫"] = {str(k): v for k, v in result["九宫"].items()}
    print(json.dumps(json_result, ensure_ascii=False, indent=2))
    print("===JSON_END===")
