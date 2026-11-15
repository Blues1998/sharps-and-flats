// A run in Hold a note: the notes landed in a row, and everything a summary
// card needs to say about them afterwards.
//
// It lives here rather than in the tuner's state so that leaving the page is a
// rest, not the end: the run pauses, and coming back within ten minutes picks
// it up on the same note. It is written to localStorage as it goes, so even a
// closed app resumes inside that window.

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
export const RESUME_MS = 10 * 60 * 1000;

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

/** The run to carry on with, if it was left recently enough. */
export function resumeRun(): HoldRun | null {
  if (!current) return null;
  if (Date.now() - current.lastActive > RESUME_MS) { saveRun(null); return null; }
  return current;
}

export function saveRun(run: HoldRun | null): void {
  current = run ? { ...run, lastActive: Date.now() } : null;
  try {
    if (current) localStorage.setItem(KEY, JSON.stringify(current));
    else localStorage.removeItem(KEY);
  } catch { /* in memory still */ }
}
