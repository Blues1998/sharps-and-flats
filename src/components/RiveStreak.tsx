// The lit streak flame, drawn by Rive (src/assets/rive/streak.riv, a
// community file with its font cut down to the digits 0-9).
//
// Rive's own player draws every screen refresh, 120 times a second here. This
// uses the low-level runtime and draws at 20 fps through lowRate(), which also
// stops it in the background and after 30 s untouched. The runtime (a ~2 MB
// WebAssembly file, local in the app) loads on first use, after first paint.

import React, { useEffect, useRef, useState } from 'react';
import { lowRate, reducedMotion } from '../utils/lowRate';
import rivUrl from '../assets/rive/streak.riv?url';
import wasmUrl from '@rive-app/canvas-advanced/rive.wasm?url';

type Rive = Awaited<ReturnType<typeof import('@rive-app/canvas-advanced').default>>;
type RiveFile = Awaited<ReturnType<Rive['load']>>;

const FPS = 20;
let loading: Promise<{ rive: Rive; file: RiveFile }> | null = null;
function loadStreak() {
  loading ??= (async () => {
    const [{ default: init }, bytes] = await Promise.all([
      import('@rive-app/canvas-advanced'),
      fetch(rivUrl).then(r => r.arrayBuffer()),
    ]);
    const rive = await init({ locateFile: () => wasmUrl });
    const file = await rive.load(new Uint8Array(bytes));
    return { rive, file };
  })();
  loading.catch(() => { loading = null; });
  return loading;
}

/** The animated flame with `streak` inside, `size` CSS pixels square. Calls onFail if Rive cannot load. */
export const RiveStreak: React.FC<{ streak: number; size: number; onFail?: () => void }> = ({ streak, size, onFail }) => {
  const canvas = useRef<HTMLCanvasElement>(null);
  const setStreak = useRef<(n: number) => void>(() => {});
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let stop = () => {};
    let dead = false;
    loadStreak().then(({ rive, file }) => {
      const el = canvas.current;
      if (dead || !el) return;
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      el.width = el.height = Math.round(size * dpr);
      const renderer = rive.makeRenderer(el);
      const artboard = file.artboardByIndex(0);
      const sm = new rive.StateMachineInstance(artboard.stateMachineByIndex(0), artboard);
      const vm = file.defaultArtboardViewModel(artboard);
      const inst = vm?.defaultInstance();
      if (inst) { artboard.bindViewModelInstance(inst); sm.bindViewModelInstance(inst); }
      const num = inst?.number('streak');
      setStreak.current = n => { if (num) num.value = n; };
      setStreak.current(streak);
      const bounds = { minX: 0, minY: 0, maxX: el.width, maxY: el.height };

      const draw = (dt: number) => {
        sm.advance(dt);
        artboard.advance(dt);
        renderer.clear();
        renderer.save();
        renderer.align(rive.Fit.contain, rive.Alignment.center, bounds, artboard.bounds);
        artboard.draw(renderer);
        renderer.restore();
        rive.resolveAnimationFrame();
      };
      draw(0);
      setReady(true);
      // Reduced motion: one still frame, settled.
      if (reducedMotion()) { draw(2); return; }
      stop = lowRate(FPS, (dt, awake) => { if (awake) draw(dt); });
      const free = stop;
      stop = () => { free(); sm.delete(); artboard.delete(); renderer.delete(); inst?.delete?.(); };
    }).catch(() => { if (!dead) onFail?.(); });
    return () => { dead = true; stop(); };
  }, [size]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setStreak.current(streak); }, [streak]);

  return <canvas ref={canvas} className={`rive-streak${ready ? ' is-ready' : ''}`} style={{ width: size, height: size }} aria-hidden="true" />;
};
