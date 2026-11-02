# Mesin ikon untuk paket Adobe Stock (gaya solid/glyph, satu bentuk gabungan per ikon, tanpa goresan).
# Dipanggil oleh stok-adobe.js:  python3 ikon-mesin.py daftar
#                                echo '{"ikon":[{"nama":"hilal"},{"nama":"baru","spek":{...}}]}' | python3 ikon-mesin.py render --keluar DIR
# Butuh:  pip install skia-pathops
import math, os, sys, json
from pathops import Path, PathOp, op, LineCap, LineJoin, decompose_quadratic_segment

K = 0.5522847498
# ---------- primitif ----------
def P(): return Path()
def poly(pts):
    p = Path(); p.moveTo(*pts[0])
    for q in pts[1:]: p.lineTo(*q)
    p.close(); return p
def ellipse(cx, cy, rx, ry, rot=0):
    c, s = math.cos(math.radians(rot)), math.sin(math.radians(rot))
    def T(x, y): return (cx + x * c - y * s, cy + x * s + y * c)
    pts = [((rx, 0), (rx, K * ry), (K * rx, ry), (0, ry)), ((0, ry), (-K * rx, ry), (-rx, K * ry), (-rx, 0)),
           ((-rx, 0), (-rx, -K * ry), (-K * rx, -ry), (0, -ry)), ((0, -ry), (K * rx, -ry), (rx, -K * ry), (rx, 0))]
    p = Path(); p.moveTo(*T(rx, 0))
    for _, c1, c2, e in pts: p.cubicTo(*T(*c1), *T(*c2), *T(*e))
    p.close(); return p
def circle(cx, cy, r): return ellipse(cx, cy, r, r)
def rect(x, y, w, h, r=0):
    if r <= 0: return poly([(x, y), (x + w, y), (x + w, y + h), (x, y + h)])
    r = min(r, w / 2, h / 2); k = r * (1 - K); p = Path(); p.moveTo(x + r, y); p.lineTo(x + w - r, y)
    p.cubicTo(x + w - k, y, x + w, y + k, x + w, y + r); p.lineTo(x + w, y + h - r)
    p.cubicTo(x + w, y + h - k, x + w - k, y + h, x + w - r, y + h); p.lineTo(x + r, y + h)
    p.cubicTo(x + k, y + h, x, y + h - k, x, y + h - r); p.lineTo(x, y + r)
    p.cubicTo(x, y + k, x + k, y, x + r, y); p.close(); return p
def star(cx, cy, R, n=5, inner=0.4, rot=-90):
    pts = []
    for i in range(n * 2):
        a = math.radians(rot + i * 180 / n); r = R if i % 2 == 0 else R * inner; pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return poly(pts)
def garis(x1, y1, x2, y2, w, bulat=True):
    p = Path(); p.moveTo(x1, y1); p.lineTo(x2, y2)
    p.stroke(w, LineCap.ROUND_CAP if bulat else LineCap.BUTT_CAP, LineJoin.ROUND_JOIN, 4); p.convertConicsToQuads(); return p
def busur_garis(pts, w):
    p = Path(); p.moveTo(*pts[0])
    for q in pts[1:]: p.lineTo(*q)
    p.stroke(w, LineCap.ROUND_CAP, LineJoin.ROUND_JOIN, 4); p.convertConicsToQuads(); return p
def sabit(cx, cy, r, geser, rr=None, ang=0):
    """Bulan sabit: lingkaran r dikurangi lingkaran bergeser."""
    rr = rr or r * 0.82; a = math.radians(ang)
    return diff(circle(cx, cy, r), circle(cx + geser * math.cos(a), cy + geser * math.sin(a), rr))
def arch(x, y, w, h):
    return uni(rect(x, y + w / 2, w, h - w / 2), ellipse(x + w / 2, y + w / 2, w / 2, w / 2))
def _op(a, b, o):
    return op(a, b, o, fix_winding=True)
def uni(*ps):
    r = ps[0]
    for q in ps[1:]: r = _op(r, q, PathOp.UNION)
    return r
def diff(a, *bs):
    for b in bs: a = _op(a, b, PathOp.DIFFERENCE)
    return a
def inter(a, b): return _op(a, b, PathOp.INTERSECTION)
def lingkar(cx, cy, r1, r2): return diff(circle(cx, cy, r1), circle(cx, cy, r2))

# ---------- ikon (kotak 64 x 64) ----------
def hilal(): return sabit(30, 32, 25, 11, 20, -20)
def hilal_bintang():
    return uni(sabit(26, 34, 21, 10, 17, -10), star(46, 22, 9.5, 5, 0.42))
def masjid():
    kubah = inter(circle(32, 38, 15), rect(17, 15, 30, 23))
    badan = rect(11, 38, 42, 18)
    menara = [rect(5, 26, 6, 30), poly([(4, 26), (12, 26), (8, 14)]), rect(53, 26, 6, 30), poly([(52, 26), (60, 26), (56, 14)])]
    pucuk = uni(rect(31.2, 7, 1.6, 18), circle(32, 7.5, 2.1))
    pintu = arch(28, 44, 8, 12); jendela = [arch(15.5, 43, 5, 13), arch(43.5, 43, 5, 13)]
    return diff(uni(kubah, badan, *menara, pucuk, rect(3, 56, 58, 3.4, 1.2)), pintu, *jendela)
def menara_ikon():
    badan = uni(rect(26, 31, 12, 27), rect(22, 28, 20, 4), rect(28, 18, 8, 11), poly([(26, 18), (38, 18), (32, 4)]), rect(21, 56, 22, 4, 1.5))
    return diff(badan, arch(29.5, 37, 5, 11), arch(30, 21, 4, 6))
def lentera():
    cincin = diff(circle(32, 7, 4), circle(32, 7, 2))
    tutup = poly([(24, 17), (40, 17), (36, 11), (28, 11)])
    badan = poly([(22, 19), (42, 19), (46, 34), (42, 50), (22, 50), (18, 34)])
    dasar = uni(poly([(24, 52), (40, 52), (36, 58), (28, 58)]), circle(32, 60.6, 2.4))
    sayat = uni(rect(31.2, 19, 1.6, 31), rect(24.6, 19, 1.6, 31), rect(37.8, 19, 1.6, 31), rect(17, 32.4, 30, 1.6), rect(17, 41, 30, 1.6), rect(17, 25, 30, 1.6))
    return uni(cincin, tutup, diff(badan, sayat), dasar)
def ketupat():
    def PT(a, b): return (32 + 16 * (a - b), 24 + 19 * (a + b))
    belah = poly([PT(-.5, -.5), PT(.5, -.5), PT(.5, .5), PT(-.5, .5)])
    dalam = poly([PT(-.43, -.43), PT(.43, -.43), PT(.43, .43), PT(-.43, .43)])
    cut = None
    for t in (-.25, 0, .25):
        for (p1, p2) in (((t, -.5), (t, .5)), ((-.5, t), (.5, t))):
            l = busur_garis([PT(*p1), PT(*p2)], 1.8); cut = l if cut is None else uni(cut, l)
    anyam = diff(belah, inter(cut, dalam))
    rumbai = uni(*[rect(x, 42, 2, h, 1) for x, h in ((26.5, 14), (30, 17), (34, 17), (37.5, 14))])
    return uni(anyam, rumbai, rect(31.1, 0, 1.8, 6), circle(32, 5.5, 2.4))
def kurma():
    mangkuk = inter(circle(32, 38, 22), rect(8, 38, 48, 22))
    bibir = rect(6, 35, 52, 4.5, 2)
    k = [ellipse(22, 26, 6, 10, 25), ellipse(34, 22, 6, 10, -8), ellipse(45, 27, 6, 10, -28)]
    kurma_ = uni(*k)
    garis_ = uni(garis(20.5, 22, 23.5, 30, 1.5), garis(34, 17, 34, 27, 1.5), garis(46.5, 22.5, 43.5, 30.5, 1.5))
    return uni(diff(kurma_, garis_), mangkuk, bibir)
def tasbih():
    manik = [circle(32 + 17 * math.cos(math.radians(90 + 30 * i)), 26 + 17 * math.sin(math.radians(90 + 30 * i)), 4.2) for i in range(12)]
    rumbai = diff(poly([(29.4, 55.5), (34.6, 55.5), (36.4, 63), (27.6, 63)]), garis(32, 57, 32, 63.5, 1.3, False), garis(30.3, 58, 29.6, 63.5, 1.1, False), garis(33.7, 58, 34.4, 63.5, 1.1, False))
    return uni(*manik, circle(32, 52, 4.2), rumbai)
def sajadah():
    alas = rect(12, 7, 40, 50, 3)
    bingkai = diff(rect(16, 11, 32, 42), rect(18.2, 13.2, 27.6, 37.6))
    lengkung = diff(arch(23, 26, 18, 24), arch(25.4, 28.4, 13.2, 19.6))
    rumbai = uni(*[rect(14 + i * 5.5, 2, 2.2, 6, 1) for i in range(7)], *[rect(14 + i * 5.5, 56, 2.2, 6, 1) for i in range(7)])
    return uni(diff(alas, bingkai, lengkung), rumbai)
def bedug():
    badan = uni(rect(12, 22, 40, 24, 3), ellipse(12, 34, 5.5, 12), ellipse(52, 34, 5.5, 12))
    sayat = [rect(24.5, 21, 1.8, 26), rect(37.7, 21, 1.8, 26), diff(ellipse(52, 34, 3.4, 9.2), ellipse(52, 34, 1.6, 7.4))]
    kaki = [poly([(16, 46), (21, 46), (13, 61), (7, 61)]), poly([(48, 46), (43, 46), (51, 61), (57, 61)]), rect(15, 54, 34, 2.6)]
    tongkat = [garis(22, 7, 30, 20, 2.8), garis(42, 7, 34, 20, 2.8)]
    return uni(diff(badan, *sayat), *kaki, *tongkat)
def alquran():
    kiri = poly([(5, 12), (30, 16), (30, 41), (5, 36)]); kanan = poly([(59, 12), (34, 16), (34, 41), (59, 36)])
    sayat = [garis(10, 19, 25, 22, 1.7), garis(10, 24.5, 25, 27.5, 1.7), garis(10, 30, 25, 33, 1.7), garis(54, 19, 39, 22, 1.7), garis(54, 24.5, 39, 27.5, 1.7), garis(54, 30, 39, 33, 1.7)]
    kaki = uni(garis(18, 45, 46, 60, 3.6), garis(46, 45, 18, 60, 3.6))
    return uni(diff(kiri, *sayat[:3]), diff(kanan, *sayat[3:]), kaki)
def peci():
    atas = poly([(12, 46), (52, 46), (48, 25), (43, 20), (21, 20), (16, 25)])
    pita = rect(8, 40, 48, 8, 2)
    return diff(uni(atas, pita), star(32, 31, 5.2, 5, 0.42), rect(8, 38.2, 48, 1.6))
def hadiah():
    tutup = rect(7, 22, 50, 10, 2); kotak = rect(10, 34, 44, 24, 2)
    pita = diff(uni(tutup, kotak), rect(27.3, 20, 1.6, 40), rect(35.1, 20, 1.6, 40))
    simpul = uni(diff(ellipse(23, 15, 9.5, 6, -22), ellipse(23, 15, 5.6, 2.8, -22)), diff(ellipse(41, 15, 9.5, 6, 22), ellipse(41, 15, 5.6, 2.8, 22)), circle(32, 18, 3.6))
    return uni(pita, simpul)
def bintang8():
    s = uni(poly([(32 + 28 * math.cos(math.radians(a)), 32 + 28 * math.sin(math.radians(a))) for a in (0, 90, 180, 270)]), poly([(32 + 28 * math.cos(math.radians(a)), 32 + 28 * math.sin(math.radians(a))) for a in (45, 135, 225, 315)]))
    return diff(s, lingkar(32, 32, 12, 9.6)),
def gelas():
    kaca = poly([(14, 18), (50, 18), (44.5, 59), (19.5, 59)])
    es = [poly([(28 + 6 * math.cos(math.radians(a)), 37 + 6 * math.sin(math.radians(a))) for a in (45, 135, 225, 315)]), poly([(36 + 5.2 * math.cos(math.radians(a)), 47 + 5.2 * math.sin(math.radians(a))) for a in (30, 120, 210, 300)]), rect(13, 25.5, 38, 1.7)]
    sedotan = garis(41, 3, 36, 30, 3.4)
    return uni(diff(kaca, *es), sedotan)
def piring():
    p = diff(circle(32, 34, 17.5), lingkar(32, 34, 12.4, 10.4))
    garpu = uni(*[rect(2.8 + i * 4.4, 6, 2, 15, 1) for i in range(3)], rect(2.8, 19, 8.6, 5, 2), rect(5.6, 22, 3, 36, 1.5))
    sendok = uni(ellipse(57, 15, 5.2, 8.6), rect(55.5, 21, 3, 37, 1.5))
    return uni(p, garpu, sendok)
def jam():
    cincin = lingkar(32, 32, 26, 22)
    jarum = uni(rect(30.2, 13, 3.6, 20, 1.8), rect(31, 30.2, 12, 3.6, 1.8), circle(32, 32, 3.4))
    return uni(cincin, jarum)
def kalender():
    badan = rect(8, 12, 48, 47, 5)
    cat = uni(rect(8, 12, 48, 11, 5))
    sayat = [rect(8, 25, 48, 1.8), sabit(32, 43, 10, 5, 8.4, -20), star(42, 39.5, 3.8, 5, 0.42)]
    return uni(diff(badan, *sayat), rect(17.5, 5, 4.4, 12, 2.2), rect(42.1, 5, 4.4, 12, 2.2))
def amplop():
    body = rect(5, 14, 54, 38, 4)
    lipat = busur_garis([(7, 17), (32, 36), (57, 17)], 2.2)
    return diff(body, lipat, sabit(32, 46, 5, 2.4, 4.1, -20))
def kotak_donasi():
    kotak = rect(11, 28, 42, 31, 3)
    hati = Path(); hati.moveTo(32, 26); hati.cubicTo(20, 17.5, 17.5, 8.5, 24.5, 6.4); hati.cubicTo(28.6, 5.3, 32, 8.4, 32, 11); hati.cubicTo(32, 8.4, 35.4, 5.3, 39.5, 6.4); hati.cubicTo(46.5, 8.5, 44, 17.5, 32, 26); hati.close()
    sayat = [rect(20, 33, 24, 3.4, 1.7), sabit(32, 47.5, 7.5, 3.4, 6.2, -20)]
    return uni(diff(kotak, *sayat), hati)
def koin():
    return diff(circle(32, 32, 26), lingkar(32, 32, 21.6, 19.6), sabit(28, 33, 11.5, 5.4, 9.8, -20), star(42, 27, 4.4, 5, 0.42))
def siang_malam():
    surya = circle(21, 21, 8.5)
    sinar = uni(*[garis(21 + 12.5 * math.cos(math.radians(a)), 21 + 12.5 * math.sin(math.radians(a)), 21 + 17 * math.cos(math.radians(a)), 21 + 17 * math.sin(math.radians(a)), 2.6) for a in range(0, 360, 45)])
    bulan = sabit(43, 43, 15, 7, 12.6, -40)
    return uni(surya, sinar, bulan)
def weker():
    badan = lingkar(32, 36, 20.5, 15.6)
    jarum = uni(rect(30.4, 25, 3.2, 12, 1.6), rect(31, 34.4, 9, 3.2, 1.6), circle(32, 36, 2.6))
    lonceng = [inter(circle(14.5, 18, 8.5), poly([(2, 18), (30, 18), (30, 4), (2, 4)])), inter(circle(49.5, 18, 8.5), poly([(34, 18), (62, 18), (62, 4), (34, 4)]))]
    kaki = [garis(17, 54, 11, 60.5, 3.2), garis(47, 54, 53, 60.5, 3.2), garis(32, 11, 32, 15, 3)]
    return uni(badan, jarum, *lonceng, *kaki)
def kembang_api():
    def ledakan(cx, cy, r1, r2, n, w, titik=True):
        out = []
        for i in range(n):
            a = math.radians(i * 360 / n + 7); r2_ = r2 if i % 2 == 0 else r2 * 0.74
            out.append(garis(cx + r1 * math.cos(a), cy + r1 * math.sin(a), cx + r2_ * math.cos(a), cy + r2_ * math.sin(a), w))
            if titik and i % 2 == 0: out.append(circle(cx + (r2_ + 4.4) * math.cos(a), cy + (r2_ + 4.4) * math.sin(a), 1.9))
        return out
    return uni(*ledakan(30, 28, 7, 17, 12, 2.8), *ledakan(11, 52, 3, 7, 8, 1.8, False), *ledakan(54, 50, 3, 8, 8, 1.9, False), star(30, 28, 3.4, 4, 0.4))

IKON = [  # (berkas, judul, fungsi, kata kunci khas)
 ("hilal", "Crescent moon icon", hilal, "crescent moon,moon,hilal,ramadan,islamic symbol,night,lunar,islam,muslim,eid"),
 ("hilal-bintang", "Crescent moon and star icon", hilal_bintang, "crescent and star,star and crescent,islamic symbol,ramadan,moon,star,islam,muslim,eid,faith"),
 ("masjid", "Mosque icon", masjid, "mosque,masjid,dome,minaret,islamic architecture,prayer,islam,muslim,ramadan,worship"),
 ("menara", "Mosque minaret tower icon", menara_ikon, "minaret,tower,mosque,adhan,call to prayer,islamic architecture,islam,muslim,ramadan,landmark"),
 ("lentera", "Ramadan lantern icon", lentera, "lantern,fanous,ramadan lantern,lamp,ramadan decoration,hanging lantern,light,islam,muslim,festive"),
 ("ketupat", "Ketupat rice cake icon", ketupat, "ketupat,rice cake,eid food,lebaran,hari raya,indonesian food,woven,traditional food,hanging ketupat,eid al fitr"),
 ("kurma", "Bowl of dates icon", kurma, "dates,date fruit,kurma,bowl of dates,iftar,ramadan food,breaking fast,snack,fruit,sweet"),
 ("tasbih", "Prayer beads tasbih icon", tasbih, "prayer beads,tasbih,misbaha,rosary,dhikr,prayer,islam,muslim,worship,spiritual"),
 ("sajadah", "Prayer rug sajadah icon", sajadah, "prayer rug,prayer mat,sajadah,salah,prayer,islam,muslim,worship,carpet,ramadan"),
 ("bedug", "Bedug drum icon", bedug, "bedug,drum,mosque drum,sahur,indonesian tradition,ramadan,call to prayer,percussion,drumsticks,tradition"),
 ("alquran", "Quran stand open book icon", alquran, "quran,holy book,open book,quran stand,rehal,reading,islam,muslim,ramadan,religion"),
 ("peci", "Peci songkok cap icon", peci, "peci,songkok,kopiah,cap,hat,muslim cap,indonesian tradition,islamic clothing,headwear,eid"),
 ("hadiah", "Gift box icon", hadiah, "gift,gift box,present,ribbon,eid gift,surprise,celebration,holiday,give,box"),
 ("bintang-8", "Eight pointed Islamic star icon", bintang8, "eight pointed star,khatam,islamic star,rub el hizb,geometric star,islamic pattern,ornament,ramadan,islam,decoration"),
 ("minuman", "Iced drink glass icon", gelas, "iced drink,glass,drink,beverage,es buah,straw,refreshment,iftar,ramadan drink,cold drink"),
 ("buka-puasa", "Iftar plate fork and spoon icon", piring, "iftar,plate,fork,spoon,dinner,breaking fast,ramadan meal,food,dining,restaurant"),
 ("jam", "Clock time icon", jam, "clock,time,schedule,iftar time,prayer time,watch,hour,minutes,deadline,timer"),
 ("kalender", "Ramadan calendar crescent icon", kalender, "calendar,ramadan calendar,date,schedule,crescent,planner,month,event,islamic calendar,fasting"),
 ("amplop-thr", "Eid money envelope icon", amplop, "envelope,money envelope,thr,angpao,eid money,gift money,holiday bonus,mail,message,eid"),
 ("kotak-donasi", "Donation box with heart icon", kotak_donasi, "donation box,charity,zakat,sedekah,heart,giving,donate,fundraising,help,kindness"),
 ("koin-hilal", "Coin with crescent and star icon", koin, "coin,zakat,money,charity,crescent,donation,currency,finance,alms,islamic finance"),
 ("sahur", "Sun and moon day and night icon", siang_malam, "sun and moon,day and night,sahur,suhoor,dawn,fasting,time of day,sunrise,sunset,ramadan"),
 ("weker-sahur", "Alarm clock icon", weker, "alarm clock,sahur alarm,wake up,morning,time,suhoor,reminder,bell,schedule,early morning"),
 ("kembang-api", "Fireworks celebration icon", kembang_api, "fireworks,celebration,eid celebration,festival,sparkle,party,new year,festive,burst,holiday"),
]
UMUM = "icon,icons,vector icon,glyph,silhouette,solid icon,symbol,sign,pictogram,flat design,minimal,simple,web icon,app icon,ui,design element,black and white,isolated,transparent,eid mubarak,islamic,ramadan kareem"


# ---------- DSL: ikon baru dari spesifikasi JSON (mis. disusun AI), selalu divalidasi ----------
MAKS_NODE, MAKS_DALAM = 80, 6
class SpekError(Exception): pass
def _n(v, lo, hi, nama):
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not (lo <= v <= hi): raise SpekError(f"{nama} harus angka {lo}..{hi}")
    return float(v)
def _pts(v, lo, hi, nama):
    if not isinstance(v, list) or not (lo <= len(v) <= hi): raise SpekError(f"{nama} harus daftar {lo}..{hi} titik")
    return [(_n(p[0], -4, 68, nama), _n(p[1], -4, 68, nama)) for p in v]
def bangun(n, ctx, dalam=0):
    ctx["node"] += 1
    if ctx["node"] > MAKS_NODE or dalam > MAKS_DALAM: raise SpekError("spesifikasi terlalu rumit")
    if not isinstance(n, dict) or "t" not in n: raise SpekError("node tanpa 't'")
    t = n["t"]; g = lambda k, lo, hi, d=None: _n(n.get(k, d) if k in n or d is not None else None, lo, hi, f"{t}.{k}")
    if t == "circle": return circle(g("cx", -4, 68), g("cy", -4, 68), g("r", 0.3, 40))
    if t == "ellipse": return ellipse(g("cx", -4, 68), g("cy", -4, 68), g("rx", 0.3, 40), g("ry", 0.3, 40), g("rot", -360, 360, 0))
    if t == "rect": return rect(g("x", -4, 68), g("y", -4, 68), g("w", 0.3, 72), g("h", 0.3, 72), g("r", 0, 36, 0))
    if t == "poly": return poly(_pts(n.get("pts"), 3, 24, "poly.pts"))
    if t == "star": return star(g("cx", -4, 68), g("cy", -4, 68), g("R", 0.5, 40), int(g("n", 3, 16)), g("inner", 0.15, 0.95, 0.4), g("rot", -360, 360, -90))
    if t == "line":
        pts = _pts(n.get("pts"), 2, 12, "line.pts"); w = g("w", 0.8, 8)
        p = Path(); p.moveTo(*pts[0]); [p.lineTo(*q) for q in pts[1:]]; p.stroke(w, LineCap.ROUND_CAP, LineJoin.ROUND_JOIN, 4); p.convertConicsToQuads(); return p
    if t == "arch": return arch(g("x", -4, 68), g("y", -4, 68), g("w", 0.6, 60), g("h", 0.6, 64))
    if t == "ring": return lingkar(g("cx", -4, 68), g("cy", -4, 68), g("r1", 0.6, 40), g("r2", 0.2, 39))
    if t == "crescent": return sabit(g("cx", -4, 68), g("cy", -4, 68), g("r", 1, 40), g("geser", -40, 40), g("rr", 0.5, 40, None) if "rr" in n else None, g("ang", -360, 360, 0))
    if t == "union":
        a = n.get("a"); 
        if not isinstance(a, list) or not (1 <= len(a) <= 40): raise SpekError("union.a harus daftar 1..40")
        return uni(*[bangun(x, ctx, dalam + 1) for x in a])
    if t == "diff":
        b = n.get("b")
        if not isinstance(b, list) or not (1 <= len(b) <= 40): raise SpekError("diff.b harus daftar 1..40")
        return diff(bangun(n.get("a"), ctx, dalam + 1), *[bangun(x, ctx, dalam + 1) for x in b])
    if t == "inter": return inter(bangun(n.get("a"), ctx, dalam + 1), bangun(n.get("b"), ctx, dalam + 1))
    raise SpekError(f"jenis node tidak dikenal: {t}")
def dari_spek(spek):
    p = bangun(spek, {"node": 0}); b = p.bounds
    if abs(p.area) < 25: raise SpekError("bentuk hampir kosong")
    if b[0] < 0.5 or b[1] < 0.5 or b[2] > 63.5 or b[3] > 63.5: raise SpekError(f"melewati kotak 64x64: {tuple(round(x, 1) for x in b)}")
    if len(list(p.contours)) > 80: raise SpekError("terlalu banyak potongan")
    return p
def periksa_path(p):
    d = to_d(p); m, z = d.count("M"), d.count("Z")
    return m == z and m > 0

# ---------- keluaran SVG ----------
def to_d(path, s=1.0, ox=0.0, oy=0.0):
    out = []; f = lambda x, y: f"{x * s + ox:.2f} {y * s + oy:.2f}"
    for verb, pts in path.segments:
        if verb == "moveTo": out.append("M" + f(*pts[0]))
        elif verb == "lineTo": out.append("L" + f(*pts[0]))
        elif verb == "curveTo": out.append("C" + " ".join(f(*q) for q in pts))
        elif verb == "qCurveTo":
            segs = [tuple(pts)] if len(pts) == 2 else decompose_quadratic_segment(pts)
            for c, e in segs: out.append("Q" + f(*c) + " " + f(*e))
        elif verb == "closePath": out.append("Z")
    return "".join(out)
WARNA = "#111827"
def svg_tunggal(path, ukuran=2048):
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{ukuran}" height="{ukuran}" viewBox="0 0 64 64"><path fill="{WARNA}" fill-rule="nonzero" d="{to_d(path)}"/></svg>\n'

def _aman(nama): return "".join(c for c in nama.lower() if c.isalnum() or c == "-")[:24] or "ikon"

if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser(); ap.add_argument("perintah", choices=["daftar", "render"]); ap.add_argument("--keluar", default="hasil"); a = ap.parse_args()
    if a.perintah == "daftar":
        print(json.dumps([{"nama": n, "judul": j, "kata": k, "tema": "ramadan"} for n, j, _, k in IKON], ensure_ascii=False)); sys.exit(0)
    req = json.loads(sys.stdin.read()); os.makedirs(a.keluar, exist_ok=True); katalog = {n: fn for n, j, fn, k in IKON}; hasil = []
    for it in req.get("ikon", []):
        nama = _aman(str(it.get("nama", "ikon")))
        try:
            if it.get("spek") is not None: p = dari_spek(it["spek"])
            elif nama in katalog:
                p = katalog[nama](); p = p[0] if isinstance(p, tuple) else p
            else: raise SpekError("ikon tidak ada di katalog dan tanpa spek")
            if not periksa_path(p): raise SpekError("jalur tidak tertutup")
            berkas = os.path.join(a.keluar, f"ikon-{nama}.svg"); open(berkas, "w").write(svg_tunggal(p)); hasil.append({"nama": nama, "ok": True, "berkas": berkas})
        except Exception as e: hasil.append({"nama": nama, "ok": False, "galat": str(e)[:160]})
    print(json.dumps(hasil, ensure_ascii=False))
