// Confetti made of music: notes, beams, sharps, flats and naturals, in the
// app's own colours. Only for the big feats (a new best, a badge), so it stays
// worth seeing. One canvas laid over the whole window for a couple of seconds,
// then removed. Skipped entirely for anyone who asked for less motion.

import { MUSIC_FONT } from './musicFont';

const GLYPHS = ['♪', '♫', '♩', '♬', '♯', '♭', '♮', '♪', '♫', '♯'];

interface Bit { x: number; y: number; vx: number; vy: number; r: number; vr: number; s: number; c: string; g: string; life: number }

export function confetti(from?: { x: number; y: number }): void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const canvas = document.createElement('canvas');
  canvas.className = 'confetti-layer';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.appendChild(canvas);
  const dpr = window.devicePixelRatio || 1;
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  if (!ctx) { canvas.remove(); return; }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const css = getComputedStyle(document.documentElement);
  const colours = ['--primary', '--success', '--warning', '--note-scale', '--text-primary']
    .map(v => css.getPropertyValue(v).trim() || '#FF6A2A');
  const ox = from?.x ?? w / 2;
  const oy = from?.y ?? h * 0.42;
  let bits: Bit[] = Array.from({ length: 90 }, (_, i) => {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.9;
    const v = 6 + Math.random() * 8;
    return {
      x: ox + (Math.random() - 0.5) * 40, y: oy, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
      r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.25, s: 14 + Math.random() * 14,
      c: colours[i % colours.length], g: GLYPHS[i % GLYPHS.length], life: 0
    };
  });

  const frame = () => {
    ctx.clearRect(0, 0, w, h);
    for (const b of bits) {
      b.vy += 0.24; b.vx *= 0.985; b.x += b.vx; b.y += b.vy; b.r += b.vr; b.life++;
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(b.r);
      ctx.globalAlpha = Math.max(0, 1 - b.life / 160);
      ctx.fillStyle = b.c;
      ctx.font = `${b.s}px ${MUSIC_FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText(b.g, 0, 0);
      ctx.restore();
    }
    bits = bits.filter(b => b.y < h + 40 && b.life < 160);
    if (bits.length) requestAnimationFrame(frame);
    else canvas.remove();
  };
  requestAnimationFrame(frame);
}
