# A dreadnought acoustic guitar at true scale, drawn from the top of the
# headstock to below the sound hole, for Today's map.
#
# Everything is measured in millimetres and drawn at K css px per mm (S image
# px per css px). t runs along the guitar from the nut's fretboard edge (t=0)
# towards the bridge; the headstock is at negative t. x is across, 0 on the
# centre line. Proportions follow a Martin D: 645.2 mm scale, 43 mm nut,
# 56 mm at the 14th fret where the body joins, 100 mm sound hole.
import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import gaussian_filter
import os, json, sys

K, S = 2.8, 3
PX = K * S                                   # image px per mm
W_CSS = 390
W = W_CSS * S
OUT = os.path.dirname(os.path.abspath(__file__))
F32 = np.float32
SCALE = 645.2
T_TOP, T_END = -168.0, 640.0                 # drawn range
MARGIN = 4.0                                 # mm above the headstock
rng = np.random.default_rng(5)
GRAIN = np.asarray(Image.open(os.path.join(OUT, 'grain.png')), dtype=F32) / 255

def fret_t(n): return SCALE * (1 - 2 ** (-n / 12))
T14 = fret_t(14)                             # body joint
T20 = fret_t(20)
BOARD_END = T20 + 4.5
NUT_SP, BR_SP = 35.6, 54.0                   # E to e spacing at the nut and the saddle
def string_x(i, t): return (-NUT_SP/2 + i*NUT_SP/5) + ((-BR_SP/2 + i*BR_SP/5) - (-NUT_SP/2 + i*NUT_SP/5)) * t / SCALE
def board_hw(t): return 21.5 + (28.0 - 21.5) * t / T14
GAUGE = [1.32, 1.07, 0.81, 0.61, 0.41, 0.30]  # mm, a light acoustic set (.053 to .012)
WOUND = [True, True, True, True, False, False]

# ---------- small helpers ----------
def rgb(h): h = h.lstrip('#'); return np.array([int(h[i:i+2], 16) for i in (0, 2, 4)], F32) / 255
def smooth(e0, e1, v):
    t = np.clip((v - e0) / (e1 - e0), 0, 1); return t*t*(3 - 2*t)
def mix(a, b, t):
    t = np.asarray(t, F32)
    if t.ndim: t = t[..., None]
    return a*(1 - t) + b*t
def bez(p0, p1, p2, p3, n=48):
    s = np.linspace(0, 1, n)[:, None]
    p0, p1, p2, p3 = map(lambda p: np.array(p, float), (p0, p1, p2, p3))
    return [tuple(v) for v in (1-s)**3*p0 + 3*(1-s)**2*s*p1 + 3*(1-s)*s**2*p2 + s**3*p3]

class Canvas:
    """One section of the guitar, t in [t0, t1], in image pixels."""
    def __init__(self, t0, t1):
        self.t0, self.t1 = t0, t1
        self.H = int(round((t1 - t0) * PX))
        self.img = np.zeros((self.H, W, 3), F32); self.a = np.zeros((self.H, W), F32)
        yy, xx = np.mgrid[0:self.H, 0:W].astype(F32)
        self.x = (xx + 0.5) / PX - W_CSS / K / 2          # mm
        self.t = (yy + 0.5) / PX + t0                    # mm
    def px(self, x, t): return ((x + W_CSS/K/2) * PX, (t - self.t0) * PX)
    def over(self, col, alpha, box=None):
        if box is None: box = (slice(None), slice(None))
        sa = np.clip(alpha, 0, 1).astype(F32)
        da = self.a[box]
        oa = sa + da*(1 - sa)
        col = np.broadcast_to(np.asarray(col, F32), self.img[box].shape) if np.ndim(col) <= 1 else col
        self.img[box] = (col*sa[..., None] + self.img[box]*(da*(1 - sa))[..., None]) / np.maximum(oa, 1e-6)[..., None]
        self.a[box] = oa
    def poly(self, pts, ss=4):
        im = Image.new('L', (W*ss, self.H*ss), 0)
        ImageDraw.Draw(im).polygon([((x + W_CSS/K/2)*PX*ss, (t - self.t0)*PX*ss) for x, t in pts], fill=255)
        return np.asarray(im.resize((W, self.H), Image.LANCZOS), dtype=F32) / 255
    def box(self, x0, x1, t0, t1, pad=1.0):
        c0, r0 = self.px(x0 - pad, t0 - pad); c1, r1 = self.px(x1 + pad, t1 + pad)
        r0, r1 = max(0, int(r0)), min(self.H, int(r1) + 1); c0, c1 = max(0, int(c0)), min(W, int(c1) + 1)
        if r0 >= r1 or c0 >= c1: return None
        return (slice(r0, r1), slice(c0, c1))

def grain(cv, scale_mm=60.0, xoff=0.0, along=True):
    # the shared grain image: its long axis runs along the strings
    gh, gw = GRAIN.shape
    u = ((cv.x + xoff) / scale_mm * gw * 0.5) % gw
    v = (cv.t / (scale_mm * 2) * gh) % gh
    return GRAIN[v.astype(int), u.astype(int)]

def lit_edges(mask, sigma_mm, light=(-0.55, -0.83)):
    m = gaussian_filter(mask, sigma_mm*PX)
    gy, gx = np.gradient(m)
    v = -(gx*light[0] + gy*light[1]); return v / (np.abs(v).max() + 1e-6)

def disc(cv, c, r, box):
    return np.clip((r - np.hypot(cv.x[box] - c[0], cv.t[box] - c[1])) * PX + 0.5, 0, 1)

def metal_disc(cv, c, r, box, base='#c6cbd1', rim=0.35):
    dx = (cv.x[box] - c[0]) / r; dt = (cv.t[box] - c[1]) / r
    rr = np.clip(np.hypot(dx, dt), 0, 1); ang = np.arctan2(dt, dx)
    v = 0.52 + 0.33*np.cos(ang - np.arctan2(-0.83, -0.55))*rr + 0.12*(1 - rr) - rim*smooth(0.8, 1.0, rr)
    return rgb(base) * v[..., None]

# ---------- strings, as polylines ----------
def draw_string(cv, pts, gauge, wound, shadow=True, tip=False):
    pts = np.array(pts, F32)
    w = gauge
    acc = 0.0
    for k in range(len(pts) - 1):
        a, b = pts[k], pts[k + 1]
        L = float(np.hypot(*(b - a)))
        if L < 1e-4: continue
        bx = cv.box(min(a[0], b[0]), max(a[0], b[0]), min(a[1], b[1]), max(a[1], b[1]), pad=w + 2.0)
        if bx is None: acc += L; continue
        X, T = cv.x[bx], cv.t[bx]
        d = (b - a) / L
        rel_x, rel_t = X - a[0], T - a[1]
        along = np.clip(rel_x*d[0] + rel_t*d[1], 0, L)
        side = rel_x*d[1] - rel_t*d[0]
        dist = np.hypot(rel_x - along*d[0], rel_t - along*d[1])
        if shadow:
            sx, st = X - 0.55 - a[0], T - 0.8 - a[1]
            al2 = np.clip(sx*d[0] + st*d[1], 0, L)
            ds = np.hypot(sx - al2*d[0], st - al2*d[1])
            cv.over(np.zeros(3, F32), np.clip((w/2 + 0.35 - ds)*PX/2.2, 0, 1)*0.5, bx)
        cov = np.clip((w/2 - dist)*PX + 0.5, 0, 1)
        rel = np.clip(side/(w/2), -1, 1)
        shade = 0.5 + 0.5*np.sqrt(np.clip(1 - rel**2, 0, 1)) - 0.16*rel
        if wound:
            coil = 0.80 + 0.20*np.sin(2*np.pi*((acc + along)/(w*1.0) + rel*0.4))
            col = rgb('#c8a066') * (shade*coil)[..., None]
        else:
            col = rgb('#dde2e7') * shade[..., None]
        spec = np.clip(1 - np.abs(rel + 0.35)*3.0, 0, 1)**2*0.5
        cv.over(np.clip(col + spec[..., None], 0, 1), cov, bx)
        acc += L

def arc_pts(c, r, a0, a1, n=60):
    a = np.linspace(a0, a1, n); return [(c[0] + r*np.cos(v), c[1] + r*np.sin(v)) for v in a]

# ---------- headstock ----------
HS_POSTS = [-52.0, -88.0, -124.0]            # t of the post centres
def hs_hw(t):
    d = -t                                  # distance above the nut edge
    if d <= 5: return 21.5
    if d <= 30: return 21.5 + (33.0 - 21.5) * (smooth(5, 30, d)*0.55 + ((d - 5)/25)**0.6*0.45)
    return 33.0 + (36.5 - 33.0) * (d - 30) / 128

def headstock(cv):
    # outline: throat flaring off the nut, straight sides to the top, rounded corners
    side = [(hs_hw(t), t) for t in np.linspace(-5, -150, 160)]
    top_r = 6.0
    corner = arc_pts((36.5 - top_r, -158 + top_r*0 - 0.0), top_r, 0, -np.pi/2, 20)
    corner = [(36.5 - top_r + top_r*np.cos(a), -152.0 - (top_r)*np.sin(-a) * 1.0) for a in np.linspace(0, -np.pi/2, 20)]
    corner = [(36.5 - top_r + top_r*np.cos(a), -152.0 + top_r*np.sin(a)) for a in np.linspace(0, -np.pi/2, 20)]
    top = [(x, -158.0 - 1.2*(1 - (x/30.5)**2)) for x in np.linspace(30.5, 0, 20)]
    right = side + corner + top
    left = [(-x, t) for x, t in reversed(right)]
    face = cv.poly(right + left)

    # shadow on the page, then the veneer
    sh = gaussian_filter(np.roll(np.roll(face, int(1.6*PX), 0), int(0.8*PX), 1), 1.8*PX)
    cv.over(np.zeros(3, F32), sh*0.7)
    g = grain(cv, 55, 13)
    wood = mix(rgb('#150c08'), rgb('#4b2c1c'), np.clip(0.5 + (g - 0.5)*1.3, 0, 1))
    le = lit_edges(face, 0.9)
    wood = wood + (np.clip(le, 0, 1)*0.5)[..., None]*rgb('#d6b08a') - (np.clip(-le, 0, 1)*0.4)[..., None]
    sheen = np.exp(-(((cv.x + 12)*0.7 + (cv.t + 120)*0.7)/22)**2)*0.09
    cv.over(np.clip(wood + sheen[..., None], 0, 1), face)

    # tuners
    posts = {}
    for k, tp in enumerate(HS_POSTS):
        hw = hs_hw(tp)
        for sgn in (-1, 1):
            px = sgn*(hw - 10.8); posts[(sgn, k)] = (px, tp)
            edge = sgn*hw
            # sealed housing behind the headstock, showing past the edge
            hx0, hx1 = (edge - 1.5, edge + 8.6) if sgn > 0 else (edge - 8.6, edge + 1.5)
            bx = cv.box(min(hx0, hx1) - 22, max(hx0, hx1) + 22, tp - 10, tp + 10)
            X, T = cv.x[bx], cv.t[bx]
            u = (X - (hx0 + hx1)/2)/((hx1 - hx0)/2); v = (T - tp)/8.6
            outer = u*sgn                                   # 1 at the outer end
            r_end = np.where(outer > 0, np.hypot(np.maximum(outer - 0.35, 0)/0.65, v), np.abs(v))
            hm = np.clip((1 - np.maximum(r_end, np.abs(u)*(outer <= 0)))*8.6*PX*0.5 + 0.5, 0, 1)
            hm = hm * (np.abs(v) <= 1.02)
            hshade = 0.55 + 0.35*np.cos(v*1.35 + 0.5) - 0.2*smooth(0.75, 1.0, np.abs(v))
            band = np.exp(-((v + 0.35)/0.12)**2)*0.4
            cv.over(np.zeros(3, F32), gaussian_filter(hm, 0.6*PX)*0.5*(1 - face[bx]), bx)
            cv.over(np.clip(rgb('#c5cad0')*hshade[..., None] + band[..., None], 0, 1), hm*(1 - face[bx]*0.92), bx)
            # shaft and collar
            s0 = edge + sgn*8.6; s1 = s0 + sgn*4.6
            m_sh = np.clip((2.1 - np.abs(T - tp))*PX + 0.5, 0, 1) * (((X - s0)*sgn > -0.2) & ((X - s1)*sgn < 0))
            sv = 0.5 + 0.45*np.cos((T - tp)/2.1*1.4 + 0.5)
            cv.over(rgb('#c9ced4')*sv[..., None], m_sh, bx)
            cc = s1 + sgn*1.0
            m_col = np.clip((3.0 - np.abs(T - tp))*PX + 0.5, 0, 1) * (np.abs(X - cc) < 1.1)
            cv.over(rgb('#c9ced4')*(0.5 + 0.45*np.cos((T - tp)/3*1.4 + 0.5))[..., None], m_col, bx)
            # butterbean button, broad face to the front
            bl, bh = 18.0, 13.2
            bc = cc + sgn*(1.0 + bl/2)
            uu = (X - bc)/(bl/2); vv = (T - tp)/(bh/2)
            waist = 1 - 0.12*np.exp(-((uu + 0.05*sgn)/0.42)**2)
            rr = (np.abs(uu)**2.6 + np.abs(vv/waist)**2.2)**(1/2.4)
            bm = np.clip((1 - rr)*(bh/2)*PX*0.9 + 0.5, 0, 1)
            env = 0.62 - 0.30*vv + 0.22*np.exp(-((vv + 0.45)/0.16)**2) - 0.28*np.exp(-((vv - 0.35)/0.22)**2)
            env = env - 0.30*smooth(0.72, 1.0, rr) + 0.10*np.exp(-((uu*sgn + 0.4)/0.3)**2)
            cv.over(np.zeros(3, F32), np.roll(np.roll(gaussian_filter(bm, 0.7*PX), int(0.6*PX), 0), int(0.4*PX), 1)*0.55*(1 - face[bx]), bx)
            cv.over(np.clip(rgb('#d3d8dd')*env[..., None], 0, 1), bm, bx)
            # bushing on the face
            pb = cv.box(px - 7, px + 7, tp - 7, tp + 7)
            cv.over(np.zeros(3, F32), gaussian_filter(disc(cv, (px + 0.6, tp + 1.0), 5.1, pb), 0.5*PX)*0.6, pb)
            cv.over(metal_disc(cv, (px, tp), 5.1, pb), disc(cv, (px, tp), 5.1, pb), pb)
            ring = disc(cv, (px, tp), 3.9, pb) - disc(cv, (px, tp), 3.3, pb)
            cv.over(np.zeros(3, F32), np.clip(ring, 0, 1)*0.5, pb)
            cv.over(metal_disc(cv, (px, tp), 3.0, pb, '#dfe3e8', 0.25), disc(cv, (px, tp), 3.0, pb), pb)

    # nut: bone
    nut = cv.poly([(-21.6, -5.0), (21.6, -5.0), (21.6, 0.2), (-21.6, 0.2)])
    g = grain(cv, 9, 70)
    bone = mix(rgb('#d6c8aa'), rgb('#f5eedd'), np.clip(0.55 + (g - 0.5)*0.55, 0, 1))
    bone = bone * (1.04 - 0.2*smooth(-3.5, 0.2, cv.t))[..., None] + (smooth(-4.4, -5.0, cv.t)*0.14)[..., None]
    cv.over(np.clip(bone, 0, 1), nut)
    for i in range(6):
        sx = string_x(i, 0)
        slot = np.clip((GAUGE[i]*0.75 + 0.15 - np.abs(cv.x - sx))*PX, 0, 1) * smooth(-2.6, -5.0, cv.t) * nut
        cv.over(rgb('#5d4b35'), slot*0.75)

    # strings: nut to post, around the post, the cut end out of the hole
    # low E and high e on the posts nearest the nut, D and G farthest
    plan = {0: (-1, 0), 1: (-1, 1), 2: (-1, 2), 3: (1, 2), 4: (1, 1), 5: (1, 0)}
    tails = {0: (5.5, 0.0), 1: (2.5, 0.0), 2: (19.0, 0.9), 3: (15.0, -0.8), 4: (3.0, 0.0), 5: (8.0, 0.25)}
    for i in range(6):
        sgn, k = plan[i]
        c = posts[(sgn, k)]
        w = GAUGE[i]; rc = 3.0 + w/2
        p0 = (string_x(i, 0), -2.4)
        # tangent point on the inner side of the post
        dx, dt = c[0] - p0[0], c[1] - p0[1]
        dist = np.hypot(dx, dt); base = np.arctan2(dt, dx)
        off = np.arcsin(rc/dist)
        ang_t = base + (off if sgn < 0 else -off)
        tang = (c[0] + rc*np.cos(ang_t + (np.pi/2 if sgn < 0 else -np.pi/2)), c[1] + rc*np.sin(ang_t + (np.pi/2 if sgn < 0 else -np.pi/2)))
        a0 = np.arctan2(tang[1] - c[1], tang[0] - c[0])
        turn = -1 if sgn < 0 else 1          # around away from the centre
        sweep = np.radians(300)
        coil = arc_pts(c, rc, a0, a0 + turn*sweep, 80)
        draw_string(cv, [p0, tang], w, WOUND[i])
        draw_string(cv, coil, w, WOUND[i], shadow=False)
        # through the hole: across the top of the post, then the end sticks out
        a_end = a0 + turn*sweep
        h_dir = np.array([np.cos(a_end + turn*np.pi/2), np.sin(a_end + turn*np.pi/2)])
        e0 = np.array(c) - h_dir*0.0
        L, curl = tails[i]
        e1 = np.array(c) + h_dir*(3.0 + L*0.5)
        norm = np.array([-h_dir[1], h_dir[0]])
        e2 = np.array(c) + h_dir*(3.0 + L) + norm*curl*L*0.6
        tail = bez(tuple(e0), tuple(np.array(c) + h_dir*1.5), tuple(e1), tuple(e2), 24)
        # hole across the post top
        pb = cv.box(c[0] - 4, c[0] + 4, c[1] - 4, c[1] + 4)
        hl = np.abs((cv.x[pb] - c[0])*h_dir[1] - (cv.t[pb] - c[1])*h_dir[0]) < 0.55
        cv.over(np.zeros(3, F32), hl*disc(cv, c, 3.0, pb)*0.8, pb)
        draw_string(cv, tail, w, WOUND[i], shadow=True)
        # the cut end, a little darker
        tb = cv.box(e2[0] - 1.5, e2[0] + 1.5, e2[1] - 1.5, e2[1] + 1.5)
        cv.over(np.zeros(3, F32), disc(cv, tuple(e2), w*0.55, tb)*0.35, tb)
    return face

# ---------- fretboard ----------
def board_poly(t0, t1, end_round=False):
    ts = np.linspace(t0, t1, 40)
    right = [(board_hw(t), t) for t in ts]; left = [(-board_hw(t), t) for t in reversed(ts)]
    return right + left

def fretboard(cv, t0, t1, end=False):
    bm = cv.poly(board_poly(t0, t1))
    cv.over(np.zeros(3, F32), gaussian_filter(np.roll(bm, int(1.2*PX), 0), 2.0*PX)*0.55)
    g = grain(cv, 60, 0)
    wood = mix(rgb('#1a0f0a'), rgb('#5a3522'), np.clip(0.5 + (g - 0.5)*1.25, 0, 1))
    hw = board_hw(np.clip(cv.t, 0, None)); rel = np.abs(cv.x)/np.maximum(hw, 1)
    wood = wood * (1 - 0.35*smooth(0.75, 1.0, rel))[..., None]
    cv.over(wood, bm)
    # dots: a single pearl at 3 5 7 9 15 17, two at 12
    for n in (3, 5, 7, 9, 12, 15, 17):
        tm = (fret_t(n - 1) + fret_t(n)) / 2
        xs = [0.0] if n != 12 else [-board_hw(tm)*0.42, board_hw(tm)*0.42]
        for xc in xs:
            if not (t0 < tm < t1): continue
            b = cv.box(xc - 4, xc + 4, tm - 4, tm + 4)
            dm = disc(cv, (xc, tm), 3.0, b)
            sh = np.sin(cv.x[b]*3.1 + cv.t[b]*2.3)*0.08 + np.sin(cv.x[b]*7.7 - cv.t[b]*5.1)*0.05
            pearl = mix(rgb('#e8e4ee'), rgb('#fbf8f2'), np.clip(0.5 + sh*3, 0, 1))
            cv.over(pearl, dm, b)
    # frets: nickel wire, crown lit from above
    for n in range(1, 21):
        tf = fret_t(n)
        if not (t0 - 2 < tf < t1 + 2): continue
        hw = board_hw(tf)
        b = cv.box(-hw - 1, hw + 1, tf - 3, tf + 3)
        X, T = cv.x[b], cv.t[b]
        u = (T - tf) / 1.2                          # -1..1 across the wire
        ends = np.clip((hw - 0.3 - np.abs(X))*PX + 0.5, 0, 1)
        cov = np.clip((1 - np.abs(u))*1.2*PX + 0.5, 0, 1) * ends
        shade = 0.42 + 0.58*np.clip(1 - (u + 0.25)**2*1.6, 0, 1)
        spec = np.exp(-((u + 0.3)/0.16)**2)*0.6
        sh = np.clip((1.2 - np.abs(T - tf - 1.3))*PX*0.6, 0, 1)*ends*0.45
        cv.over(np.zeros(3, F32), sh, b)
        cv.over(np.clip(rgb('#c9ced3')*shade[..., None] + spec[..., None], 0, 1), cov, b)
    return bm

# ---------- body ----------
HOLE_T = BOARD_END + 9.0 + 50.0             # sound hole centre
R = 50.0
def body(cv):
    edge_t = T14 - 1.0 + 4.0*(np.abs(cv.x)/70)**2.6        # the top edge across the screen
    dn = cv.t - edge_t
    shape = np.clip(dn*PX + 0.5, 0, 1)
    X, T = cv.x, cv.t
    def n1(u, octs):
        v = np.zeros_like(u)
        for wl, amp in octs:
            for _ in range(5):
                v += amp*np.sin(2*np.pi*u/(wl*rng.uniform(0.7, 1.4)) + rng.uniform(0, 6.3))
        return v
    wob = 0.35*np.sin(T/31 + 0.3) + 0.2*np.sin(T/9 + 1.7)
    gr = n1(X + wob, [(4.0, 0.45), (1.3, 0.9), (0.7, 0.55)]); gr = gr/np.abs(gr).max()
    silk = np.clip(n1(T + 0.25*X, [(2.2, 1)])/5, -1, 1)*np.clip(n1(X, [(14, 1)])/5, 0, 1)*0.045
    spruce = rgb('#e8c995') * (1 + 0.07*gr + silk)[..., None]
    # sunburst from the edge of the top (the shoulders are this edge here)
    tt = np.clip(dn/95, 0, 1)
    dark, amber = rgb('#1c0b04'), rgb('#a6501a')
    burst = np.where((tt < 0.36)[..., None], mix(dark, amber, smooth(0, 0.36, tt)), mix(amber, np.ones(3, F32), smooth(0.36, 1.0, tt)))
    top = spruce*burst
    # binding and purfling
    top = np.where((dn < 2.2)[..., None], rgb('#ecdfc2')*(0.86 + 0.14*smooth(0, 2.2, dn))[..., None], top)
    for lo, hi, c in ((2.2, 2.7, '#141010'), (2.7, 3.1, '#efe6d2'), (3.1, 3.6, '#141010')):
        top = mix(top, rgb(c), np.clip((dn - lo)*PX + 0.5, 0, 1)*np.clip((hi - dn)*PX + 0.5, 0, 1))
    # rosette
    r = np.hypot(X, T - HOLE_T); th = np.arctan2(T - HOLE_T, X)
    def ring(lo, hi): return np.clip((r - lo)*PX + 0.5, 0, 1)*np.clip((hi - r)*PX + 0.5, 0, 1)
    for lo, hi, c in ((R + 2.6, R + 3.1, '#120e0c'), (R + 3.1, R + 3.5, '#efe6d2'), (R + 3.5, R + 4.0, '#120e0c'),
                      (R + 7.0, R + 7.5, '#120e0c'), (R + 7.5, R + 7.9, '#efe6d2'), (R + 7.9, R + 8.4, '#120e0c'),
                      (R + 11.0, R + 11.5, '#120e0c'), (R + 11.5, R + 11.9, '#efe6d2'), (R + 11.9, R + 12.4, '#120e0c')):
        top = mix(top, rgb(c), ring(lo, hi))
    u = (r - (R + 4.0))/3.0
    p = th*(R + 5.5)/0.75 + np.abs(u - 0.5)*1.6
    herring = 0.5 + 0.5*np.tanh(np.sin(2*np.pi*p)*3.0)
    top = mix(top, mix(rgb('#1a120c'), rgb('#efe2c4'), herring), ring(R + 4.0, R + 7.0))
    sheen = np.exp(-(((X + 40)*0.8 - (T - T14 - 30)*0.6)/30)**2)*0.06
    cv.over(np.clip(top + sheen[..., None], 0, 1), shape)
    cv.over(np.ones(3, F32), np.clip(1 - np.abs(dn - 0.15)*PX/1.4, 0, 1)*0.3*shape)
    # inside the guitar, seen through the hole: the back, a ladder brace, the label
    inside = np.clip((R - r)*PX + 0.5, 0, 1)
    depth = np.clip(r/R, 0, 1)
    back = mix(rgb('#2a1a0f'), rgb('#050302'), smooth(0.1, 1.0, depth))
    brace = np.exp(-((T - HOLE_T - 14)/5.0)**2)*0.4*(1 - smooth(0.4, 0.95, depth))
    back = mix(back, rgb('#41301e'), brace)
    back = back*(1 - 0.55*smooth(0.7, 1.0, depth))[..., None]
    cv.over(back, inside)
    wall = np.clip((r - (R - 1.3))*PX + 0.5, 0, 1)*inside*np.clip(np.sin(th), 0, 1)
    cv.over(rgb('#8c6a44'), wall*0.85)
    # tortoiseshell pickguard on the treble side, hugging the rosette
    pts = arc_pts((0, HOLE_T), R + 14.5, np.radians(-38), np.radians(98), 60)
    # a teardrop: from the bottom of the rosette, round below and out to the treble side
    pts += bez(pts[-1], (-30, HOLE_T + 100), (30, HOLE_T + 150), (90, HOLE_T + 130))
    pts += bez((90, HOLE_T + 130), (130, HOLE_T + 112), (122, HOLE_T + 20), (95, HOLE_T - 20))
    pts += bez((95, HOLE_T - 20), (84, HOLE_T - 36), (66, HOLE_T - 44), pts[0])
    pg = cv.poly(pts)
    def aniso(sl, ss, shape=X.shape):
        n = gaussian_filter(rng.standard_normal(shape).astype(F32), (ss*PX, sl*PX)); return n/n.std()
    # streaks along a diagonal: a field wide enough to shear without wrapping
    yy, xx = np.mgrid[0:cv.H, 0:W]
    wide = aniso(2.4, 0.7, (cv.H, W + int(cv.H*0.6) + 2))
    base = wide[yy, (xx + yy*0.6).astype(int)]
    m = smooth(0.25, 0.85, np.clip(0.5 + base*0.28 + aniso(0.8, 0.3)*0.1 - 0.08, 0, 1))
    tort = mix(rgb('#160604'), rgb('#5a1d06'), np.clip(m*1.6, 0, 1))
    tort = mix(tort, rgb('#b8661f'), np.clip((m - 0.62)*2.4, 0, 1))
    tort = np.clip(tort + (np.clip(lit_edges(pg, 0.5), 0, 1)*0.18)[..., None], 0, 1)
    cv.over(np.zeros(3, F32), np.roll(gaussian_filter(pg, 0.6*PX), int(0.6*PX), 0)*0.35*shape)
    cv.over(tort, pg*shape*0.96)
    return shape

def strings_straight(cv, t0, t1):
    for i in range(6):
        draw_string(cv, [(string_x(i, t0), t0), (string_x(i, t1), t1)], GAUGE[i], WOUND[i])

def to_image(cv):
    rgba = np.dstack([np.clip(cv.img, 0, 1), np.clip(cv.a, 0, 1)])
    return Image.fromarray((rgba*255).astype(np.uint8), 'RGBA')

if __name__ == '__main__':
    parts = []
    hs = Canvas(T_TOP - MARGIN, 0.6); headstock(hs); parts.append(hs)
    nk = Canvas(0.6, T14); fretboard(nk, 0, T14 + 1); strings_straight(nk, 0.6, T14); parts.append(nk)
    bd = Canvas(T14, T_END); body(bd); fretboard(bd, T14 - 1, BOARD_END); strings_straight(bd, T14, T_END); parts.append(bd)
    H = sum(p.H for p in parts)
    full = Image.new('RGBA', (W, H), (0, 0, 0, 0)); y = 0
    for p in parts:
        full.paste(to_image(p), (0, y)); y += p.H
    full.save(os.path.join(OUT, 'guitar_full.png'))
    full.save(os.path.join(OUT, 'guitar_full.webp'), quality=84, method=6)
    # where things are, in css px from the top of the image
    y_of = lambda t: round((t - (T_TOP - MARGIN))*K, 1)
    info = {'height_css': round(H/S, 1), 'nut': y_of(0), 'body': y_of(T14), 'hole': y_of(HOLE_T), 'board_end': y_of(BOARD_END),
            'frets': {n: y_of(fret_t(n)) for n in range(0, 21)},
            'mid': {n: y_of((fret_t(n - 1) + fret_t(n))/2) for n in range(1, 21)},
            'strings_at': {n: [round(195 + string_x(i, (fret_t(n - 1) + fret_t(n))/2)*K, 1) for i in range(6)] for n in range(1, 15)},
            'board_hw_at': {n: round(board_hw((fret_t(n - 1) + fret_t(n))/2)*K, 1) for n in range(1, 15)}}
    json.dump(info, open(os.path.join(OUT, 'guitar_full.json'), 'w'), indent=1)
    print(os.path.getsize(os.path.join(OUT, 'guitar_full.webp')), 'bytes', W, H)
