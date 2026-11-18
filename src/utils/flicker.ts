// The drawn streak flame's flicker, used when Rive cannot load. Moved 15
// times a second by lowRate() (see there for why not CSS). Layered sine waves
// at unrelated speeds give a flicker that never visibly repeats.

import { lowRate, reducedMotion } from './lowRate';

const FPS = 15;

export interface FlameParts { flame: HTMLElement | SVGElement; hot: HTMLElement | SVGElement; glow: HTMLElement }

/** Start the flicker on these elements; returns a stop function. */
export function flicker(parts: FlameParts): () => void {
  if (reducedMotion()) return () => {};
  const t0 = performance.now();
  let calm = 0; // 1 while running, falls to 0 as it settles

  const wave = (t: number, a: number, b: number, c: number) =>
    Math.sin(t * a) * 0.5 + Math.sin(t * b + 1.3) * 0.3 + Math.sin(t * c + 2.1) * 0.2;

  const draw = (k: number) => {
    const t = (performance.now() - t0) / 1000;
    const n = (a: number, b: number, c: number) => wave(t, a, b, c) * k;
    parts.flame.style.transform = `skewX(${n(2.1, 3.7, 6.3) * 5}deg) scale(${1 + n(1.7, 4.1, 7.7) * 0.03}, ${1 + n(2.3, 5.3, 8.9) * 0.05})`;
    parts.hot.style.transform = `translateY(${n(3.1, 6.7, 11) * 0.8}px) scale(${0.95 + n(4.3, 7.1, 12.7) * 0.08}, ${1 + n(3.7, 8.3, 13.1) * 0.1})`;
    parts.hot.style.opacity = String(0.92 + n(5.1, 9.7, 14.3) * 0.08);
    parts.glow.style.transform = `scale(${1 + n(1.3, 2.9, 5.1) * 0.15})`;
    parts.glow.style.opacity = String(0.8 + n(1.9, 3.3, 6.1) * 0.2);
  };

  return lowRate(FPS, (_dt, awake) => {
    calm = awake ? Math.min(1, calm + 0.1) : calm * 0.8;
    if (!awake && calm < 0.02) { calm = 0; draw(0); return false; }
    draw(calm);
    return !awake;
  });
}
