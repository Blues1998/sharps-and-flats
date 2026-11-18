// A frame loop at a chosen, low frame rate, for decoration that should keep
// moving on an idle screen.
//
// Any CSS animation or requestAnimationFrame loop that runs forever makes the
// WebView draw 120 frames a second, ~80% CPU on Android even when the GPU only
// moves layers (measured). The WebView draws only when something changes, so
// moving things 15 to 24 times a second costs a fraction of that.
//
// It runs only while it is worth looking at: the app in front, and a touch or
// scroll in the last 30 seconds. Then `frame` gets `awake = false` once to
// settle, and the next touch wakes it.

const IDLE_MS = 30_000;

/** Calls frame(dt seconds, awake) about `fps` times a second; returns a stop function. */
export function lowRate(fps: number, frame: (dt: number, awake: boolean) => boolean | void): () => void {
  let timer = 0;
  let last = 0;
  let lastTouch = Date.now();

  const step = () => {
    const now = performance.now();
    const dt = last ? Math.min(0.25, (now - last) / 1000) : 0;
    last = now;
    const awake = Date.now() - lastTouch < IDLE_MS;
    // frame returns true while it still has settling to do after going idle.
    const more = frame(dt, awake);
    if (!awake && !more) { timer = 0; last = 0; return; }
    timer = window.setTimeout(step, 1000 / fps);
  };
  const run = () => { if (!timer && document.visibilityState === 'visible') step(); };
  const pause = () => { window.clearTimeout(timer); timer = 0; last = 0; };
  const touched = () => { lastTouch = Date.now(); run(); };
  const visible = () => { if (document.visibilityState === 'visible') touched(); else pause(); };

  const opts = { passive: true, capture: true } as const;
  window.addEventListener('pointerdown', touched, opts);
  window.addEventListener('scroll', touched, opts);
  document.addEventListener('visibilitychange', visible);
  run();
  return () => {
    pause();
    window.removeEventListener('pointerdown', touched, opts);
    window.removeEventListener('scroll', touched, opts);
    document.removeEventListener('visibilitychange', visible);
  };
}

export const reducedMotion = (): boolean => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
