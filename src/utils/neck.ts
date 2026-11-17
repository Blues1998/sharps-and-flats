// Up the Neck: the Journey laid out on a guitar neck.
//
// Each fret holds a few Journey steps, played as fretted notes. The inlay
// frets (3, 5, 7, 9 and the double dot at 12) are skill checks: a real musical
// task that pulls together what the frets before it taught. Fret 12 is the
// octave, the end of the basics. Frets past it are the second octave, shown
// faded until there is something to put on them.
//
// Progress itself still lives in journey.ts (steps complete when the labs
// report the work); this file only says where each step sits on the neck.

import { ALL_LEVELS, isLevelComplete } from './journey';
import { getProgressCount } from './progress';
import type { JourneyLevel } from './journey';

export type Strand = 'ear' | 'rhythm' | 'neck' | 'theory' | 'voice';

export interface FretDef {
  n: number;
  /** What this fret is about, in two or three words. */
  title: string;
  /** Journey step ids, in order. Empty on a check fret. */
  steps: string[];
  /** Set on inlay frets: the skill check that passes it. */
  check?: { title: string; task: string };
  strands: Strand[];
}

export const OCTAVE = 12;
export const INLAYS = [3, 5, 7, 9, 12];
/** Frets drawn past the octave, faded: a look at what comes next. */
export const AHEAD = [
  { n: 13, title: 'Barre chords' },
  { n: 14, title: 'Strumming patterns' },
  { n: 15, title: 'Pentatonic boxes' },
];

export const FRETS: FretDef[] = [
  { n: 1, title: 'Your instrument', steps: ['set-up', 'hear-a-note'], strands: ['theory'] },
  { n: 2, title: 'Pitch', steps: ['wake-the-tuner', 'first-match'], strands: ['ear'] },
  { n: 3, title: 'Find it by ear', steps: [], strands: ['ear', 'neck'],
    check: { title: 'Find it by ear', task: 'The app plays open strings. Find each one by ear.' } },
  { n: 4, title: 'The beat', steps: ['steady-hands'], strands: ['rhythm'] },
  { n: 5, title: 'Hold the tempo', steps: [], strands: ['rhythm'],
    check: { title: 'Hold the tempo', task: 'Keep a steady beat at slow, middle and quick tempos.' } },
  { n: 6, title: 'Major and minor', steps: ['happy-vs-sad', 'first-climb', 'pentatonic'], strands: ['ear', 'neck', 'theory'] },
  { n: 7, title: 'Scales by heart', steps: [], strands: ['neck', 'rhythm'],
    check: { title: 'Scales by heart', task: 'Play the major scale and the pentatonic box without the fret numbers.' } },
  { n: 8, title: 'Note to note', steps: ['interval-songs', 'interval-hunt'], strands: ['ear', 'neck'] },
  { n: 9, title: 'Hear it, play it', steps: [], strands: ['ear', 'neck'],
    check: { title: 'Hear it, play it', task: 'Name intervals by ear, then find them on the neck.' } },
  { n: 10, title: 'Chords', steps: ['chord-flavors', 'build-chords', 'why-chords-work'], strands: ['ear', 'neck', 'theory'] },
  { n: 11, title: 'Keys', steps: ['meet-the-circle', 'chords-that-belong', 'walk-the-circle'], strands: ['theory'] },
  { n: 12, title: 'The octave', steps: [], strands: ['ear', 'rhythm', 'neck', 'theory'],
    check: { title: 'The octave check', task: 'Ear, beat, scale, chord and key, in one go.' } },
];

const byId = new Map(ALL_LEVELS.map(l => [l.id, l]));
export const levelOf = (id: string): JourneyLevel | undefined => byId.get(id);

// Each inlay fret is a skill check: a short test of the frets below it. It
// passes when its check is passed. Milestones someone had already passed
// before the checks existed stay passed (nobody is sent back down the neck);
// their stars wait for them to take the check.
export const CHECKS_READY = true;
export const checkId = (n: number): string => `check-${n}`;
export const CHECK_IDS = FRETS.filter(f => f.check).map(f => checkId(f.n));

const KEPT = 'cadenza-checks-kept';
const SEEN = 'cadenza-neck-seen';
let kept: Set<number> | null = null;
function keptChecks(): Set<number> {
  if (kept) return kept;
  try {
    const raw = localStorage.getItem(KEPT);
    if (raw) return (kept = new Set(JSON.parse(raw) as number[]));
  } catch { /* work it out below */ }
  // First run with checks: keep every milestone whose frets were all done.
  const stepsDone = (f: FretDef) => f.steps.every(id => isLevelComplete(byId.get(id)!));
  kept = new Set(FRETS.filter(f => f.check && FRETS.filter(g => g.n < f.n && !g.check).every(stepsDone)).map(f => f.n));
  try {
    localStorage.setItem(KEPT, JSON.stringify([...kept]));
    // Already behind you, so no celebration for them: mark them seen.
    const raw = localStorage.getItem(SEEN);
    if (raw) localStorage.setItem(SEEN, JSON.stringify([...new Set([...(JSON.parse(raw) as string[]), ...[...kept].map(checkId)])]));
  } catch { /* recomputed next time, same answer */ }
  return kept;
}

export const checkPassed = (n: number): boolean => getProgressCount(`lesson:${checkId(n)}`) > 0 || keptChecks().has(n);

const STARS_KEY = 'cadenza-check-stars';
function readStars(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(STARS_KEY) ?? '{}') as Record<string, number>; } catch { return {}; }
}
/** Best stars earned on a check, 0 to 3. */
export const checkStars = (id: string): number => readStars()[id] ?? 0;
export function saveCheckStars(id: string, stars: number): void {
  const all = readStars();
  if ((all[id] ?? 0) >= stars) return;
  all[id] = stars;
  try { localStorage.setItem(STARS_KEY, JSON.stringify(all)); } catch { /* this session only */ }
}

export const fretDone = (f: FretDef): boolean =>
  f.check ? checkPassed(f.n) : f.steps.every(id => isLevelComplete(byId.get(id)!));

/** The fret you are on: the first one not done. OCTAVE + 1 once the octave is passed. */
export function currentFret(): number {
  for (const f of FRETS) if (!fretDone(f)) return f.n;
  return OCTAVE + 1;
}

/** The step to do next on a fret: the first not done. */
export function nextStepOn(f: FretDef): JourneyLevel | null {
  for (const id of f.steps) {
    const l = byId.get(id);
    if (l && !isLevelComplete(l)) return l;
  }
  return null;
}

export const fretOfStep = (id: string): FretDef | undefined => FRETS.find(f => f.steps.includes(id));

// ---- What you have already seen ---------------------------------------------
// The neck plays its moments (a note pressed on, a fret lit) for progress made
// since you last looked, so a step done in a lab lands when you come back.


export function seenSteps(): Set<string> | null {
  try {
    const raw = localStorage.getItem(SEEN);
    return raw ? new Set(JSON.parse(raw) as string[]) : null;
  } catch { return null; }
}

export function markSeen(ids: Iterable<string>): void {
  try { localStorage.setItem(SEEN, JSON.stringify([...ids])); } catch { /* replays next time */ }
}

export const doneSteps = (): Set<string> => new Set([
  ...ALL_LEVELS.filter(isLevelComplete).map(l => l.id),
  ...FRETS.filter(f => f.check && checkPassed(f.n)).map(f => checkId(f.n)),
]);

/** Every step and check, in the order you meet them on the neck. */
export const NECK_ORDER: string[] = FRETS.flatMap(f => (f.check ? [checkId(f.n)] : f.steps));

/** Fret heights follow a real neck: each fret is 2^(-1/12) of the one before. */
export const fretHeight = (n: number, first: number): number => first * Math.pow(2, -(n - 1) / 12);

// ---- Units ---------------------------------------------------------------------
// The frets fall into five units, each ending on a milestone. The banner names
// the unit in view and the path marks where each one starts.

export interface UnitDef { name: string; from: number; to: number }

export const UNITS: UnitDef[] = [
  { name: 'Sound', from: 1, to: 3 },
  { name: 'Rhythm', from: 4, to: 5 },
  { name: 'Scales', from: 6, to: 7 },
  { name: 'Intervals', from: 8, to: 9 },
  { name: 'Harmony', from: 10, to: 12 },
];

export const unitOf = (n: number): number => {
  const i = UNITS.findIndex(u => n >= u.from && n <= u.to);
  return i === -1 ? UNITS.length - 1 : i;
};
