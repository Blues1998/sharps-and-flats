import numpy as np, sys
from PIL import Image, ImageFilter
W, H = 512, 1024
rng = np.random.default_rng(int(sys.argv[1]) if len(sys.argv) > 1 else 7)
y = np.arange(H)[:, None].astype(float); x = np.arange(W)[None, :].astype(float)

def per_y(n, amp, kmin, kmax):
    # periodic in y: integer cycles over H
    out = np.zeros((H, 1))
    for _ in range(n):
        k = rng.integers(kmin, kmax + 1); ph = rng.uniform(0, 2*np.pi)
        out += rng.uniform(0.4, 1) * np.sin(2*np.pi*k*y/H + ph)
    return amp * out / n

def noise1d(u, octaves):
    # smooth 1D noise along u (pixels), sum of random sines
    v = np.zeros_like(u)
    for wl, a in octaves:
        for _ in range(4):
            ph = rng.uniform(0, 2*np.pi); f = 1/(wl*rng.uniform(0.7, 1.4))
            v += a * np.sin(2*np.pi*f*u + ph)
    return v

# Grain lines run down the neck, gently wandering.
warp = per_y(5, 3.0, 1, 3) + per_y(6, 0.8, 4, 10)
# Each part of the board drifts on its own: a second drift that changes across x.
w2 = per_y(4, 4.0, 1, 3); w3 = per_y(4, 3.0, 1, 2)
mix = 0.5 + 0.5*np.sin(2*np.pi*x/W*1.3 + 0.7)
u = x + warp + mix*w2 + (1-mix)*w3
g = noise1d(u, [(110, 0.7), (38, 0.6), (13, 0.75), (5, 0.55), (2.2, 0.4), (1.3, 0.25)])
g = g / np.abs(g).max()
# A few darker streaks, as rosewood has.
dark = np.clip(noise1d(u*0.5, [(60, 1), (25, 0.6)]), 0, None)
dark = (dark/dark.max())**3
g = g - 0.8*dark
# Figure: slow light and dark patches along the board.
fig = noise1d(x + per_y(4, 30, 1, 2), [(160, 1)]) / 4 + per_y(5, 0.35, 1, 3)
v = 0.6*g + 0.22*fig/np.abs(fig).max()
# Pores: short dark dashes along the grain, wrapping top to bottom.
pores = np.zeros((H, W))
for _ in range(1400):
    px = rng.uniform(0, W); py = rng.integers(0, H); ln = rng.integers(4, 18); d = rng.uniform(0.25, 0.8)
    for j in range(ln):
        yy = (py + j) % H
        xx = int(px + warp[yy, 0] - warp[py, 0]) % W
        pores[yy, xx] = max(pores[yy, xx], d * np.sin(np.pi*(j+0.5)/ln))
pores = np.array(Image.fromarray((pores*255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.6))) / 255
v = v - 0.9*pores
img = np.clip(128 + 95*v, 0, 255).astype(np.uint8)
im = Image.fromarray(img, 'L')
im.save('wood/grain.webp', quality=78, method=6)
im.save('wood/grain.png')
# Previews: tinted as rosewood and maple with an overlay blend, two tiles stacked.
def overlay(base, t):
    a = base/255; b = t/255
    return np.where(a < 0.5, 2*a*b, 1-2*(1-a)*(1-b))
t = np.vstack([img, img])[:, :, None].astype(float)
for name, col in [('rose', (52, 32, 21)), ('maple', (226, 196, 150))]:
    base = np.ones((2*H, W, 3)) * np.array(col)
    out = (overlay(base, t)*255).clip(0, 255).astype(np.uint8)
    Image.fromarray(out).resize((W//2, H)).save(f'wood/prev_{name}.png')
import os; print(os.path.getsize('wood/grain.webp'), 'bytes')
