// The streak flame, drawn by Rive. src/assets/rive/streak.riv is made from
// assets/27337-51650-dynamic-streak-fire.riv by scripts/rive/prepare.py: font
// cut to the digits 0-9, gold swapped for the brand orange:
//   prepare.py <in> src/assets/rive/streak.riv --color f2af0f=ff6a2a ffe29d=ffc39a
//
// Still by default: the header shows one settled frame and draws again only
// when the number changes, so it costs nothing on an idle screen. `live`
// plays it every frame, for the few seconds the streak celebration is up.
// The runtime (a ~2 MB WebAssembly file, local in the app) loads on first use.

import React, { useEffect, useRef, useState } from 'react';
import rivUrl from '../assets/rive/streak.riv?url';
// The same flame with its number made invisible (prepare.py --hide-text), for
// the top bar, where the number sits beside the flame instead.
import plainUrl from '../assets/rive/streak-badge.riv?url';
import wasmUrl from '@rive-app/canvas-advanced/rive.wasm?url';

type Rive = Awaited<ReturnType<typeof import('@rive-app/canvas-advanced').default>>;
type RiveFile = Awaited<ReturnType<Rive['load']>>;

/** Long enough for the file's entry animations to finish, for a still frame. */
const SETTLE_S = 2.5;

let runtime: Promise<Rive> | null = null;
const files = new Map<string, Promise<{ rive: Rive; file: RiveFile }>>();
export function loadStreakRive(url: string = rivUrl) {
  let hit = files.get(url);
  if (!hit) {
    runtime ??= import('@rive-app/canvas-advanced').then(({ default: init }) => init({ locateFile: () => wasmUrl }));
    hit = Promise.all([runtime, fetch(url).then(r => r.arrayBuffer())])
      .then(async ([rive, bytes]) => ({ rive, file: await rive.load(new Uint8Array(bytes)) }));
    hit.catch(() => { files.delete(url); runtime = null; });
    files.set(url, hit);
  }
  return hit;
}

interface Props {
  streak: number;
  /** CSS pixels, square. */
  size: number;
  /** Animate every frame (the celebration); otherwise one settled frame. */
  live?: boolean;
  /** Draw the flame without its number. */
  plain?: boolean;
  onFail?: () => void;
  /** The first frame is on screen. */
  onReady?: () => void;
  className?: string;
  canvasRef?: React.Ref<HTMLCanvasElement>;
}

export const RiveStreak: React.FC<Props> = ({ streak, size, live = false, plain = false, onFail, onReady, className = '', canvasRef }) => {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const show = useRef<(n: number) => void>(() => {});
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let dead = false;
    let raf = 0;
    let free = () => {};
    loadStreakRive(plain ? plainUrl : rivUrl).then(({ rive, file }) => {
      const el = canvas.current;
      if (dead || !el) return;
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      el.width = el.height = Math.round(size * dpr);
      const renderer = rive.makeRenderer(el);
      const artboard = file.artboardByIndex(0);
      const sm = new rive.StateMachineInstance(artboard.stateMachineByIndex(0), artboard);
      const inst = file.defaultArtboardViewModel(artboard)?.defaultInstance();
      if (inst) { artboard.bindViewModelInstance(inst); sm.bindViewModelInstance(inst); }
      const num = inst?.number('streak');
      const bounds = { minX: 0, minY: 0, maxX: el.width, maxY: el.height };

      const advance = (dt: number) => { sm.advance(dt); artboard.advance(dt); };
      const draw = () => {
        renderer.clear();
        renderer.save();
        renderer.align(rive.Fit.contain, rive.Alignment.center, bounds, artboard.bounds);
        artboard.draw(renderer);
        renderer.restore();
        rive.resolveAnimationFrame();
      };
      const still = () => { for (let t = 0; t < SETTLE_S; t += 1 / 30) advance(1 / 30); draw(); };

      show.current = n => { if (num) num.value = n; if (!live) still(); };
      show.current(streak);

      if (live) {
        let last = performance.now();
        const tick = (now: number) => {
          advance(Math.min(0.05, (now - last) / 1000));
          last = now;
          draw();
          raf = requestAnimationFrame(tick);
        };
        advance(0); draw();
        raf = requestAnimationFrame(tick);
      }
      setReady(true);
      onReady?.();
      free = () => { sm.delete(); artboard.delete(); renderer.delete(); };
    }).catch(() => { if (!dead) onFail?.(); });
    return () => { dead = true; cancelAnimationFrame(raf); show.current = () => {}; free(); };
  }, [size, live, plain]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { show.current(streak); }, [streak]);

  const setRef = (el: HTMLCanvasElement | null) => {
    canvas.current = el;
    if (typeof canvasRef === 'function') canvasRef(el);
    else if (canvasRef) (canvasRef as React.MutableRefObject<HTMLCanvasElement | null>).current = el;
  };
  return <canvas ref={setRef} className={`rive-streak${ready ? ' is-ready' : ''} ${className}`} style={{ width: size, height: size }} aria-hidden="true" />;
};
