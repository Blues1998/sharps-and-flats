// A run in Hold a note: the notes landed in a row, and everything a summary
// card needs to say about them afterwards.
//
// A streak is notes landed one after another, so anything that stops the
// singing ends it: stopping the mic, leaving the page or the app, switching
// mode. Nothing is lost by that. The bests are saved the moment they happen,
// and a run that ended while you were away is kept here (in localStorage, so
// even a closed app keeps it) to be shown as its summary when you come back.

import { getRecord, heldTier } from './feats';

export interface HoldRun {
  streak: number;
  /** The longest streak this run. */
  max: number;
  held: number;
  perfect: number;
  /** The wobble of every hold, in cents, in order. */
  spreads: number[];
  /** Time spent listening in Hold, not wall time. */
  activeMs: number;
  lastActive: number;
  /** The record when the run began: the number to beat. */
  startBest: number;
  /** A new best is celebrated once per run, the moment it is passed. */
  passedBest: boolean;
  /** Badge tiers at the start, so the summary can show what the run earned. */
  tiersAtStart: Record<string, number>;
  target: number | null;
}

const KEY = 'cadenza-hold-run';

export function freshRun(target: number | null = null): HoldRun {
  return {
    streak: 0, max: 0, held: 0, perfect: 0, spreads: [], activeMs: 0, lastActive: Date.now(),
    startBest: getRecord('hold-streak')?.value ?? 0, passedBest: false,
    tiersAtStart: { steady: heldTier('steady'), centre: heldTier('centre') },
    target
  };
}

let current: HoldRun | null = (() => {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as HoldRun) : null;
  } catch { return null; }
})();

/** A run that ended while the tuner was closed, to show as its summary. */
export const endedRun = (): HoldRun | null => (current && current.held > 0 ? current : null);

export function saveRun(run: HoldRun | null): void {
  current = run ? { ...run, lastActive: Date.now() } : null;
  try {
    if (current) localStorage.setItem(KEY, JSON.stringify(current));
    else localStorage.removeItem(KEY);
  } catch { /* in memory still */ }
}
