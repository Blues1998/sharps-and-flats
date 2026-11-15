// XP: a number for getting better, not for showing up.
//
// Rewards for merely taking part tend to wear down the wish to do the thing
// itself; feedback that says you are improving builds it (Deci, Koestner &
// Ryan, 1999). So XP is paid only for skill: notes landed clean, answers
// right, scales climbed, records beaten, chords proven. Minutes still count,
// but towards the daily goal and the streak, which are about turning up.
//
// No farming: every source has a daily cap, and a one-off (a key climbed for
// the first time, a chord proven) pays once. Kept as a list of events, so a
// server could take it as it is one day, for leagues or a backup.

import { ALL_LEVELS, isLevelComplete } from './journey';
import { subscribeProgress } from './progress';

const KEY = 'cadenza-xp-v1';
export const XP_EVENT = 'cadenza-xp-change';

interface XpEvent { d: string; s: string; k: string; n: number }

const iso = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

let events: XpEvent[] = (() => {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') as XpEvent[]; } catch { return []; }
})();

/** XP per event, and how many times a day it pays (Infinity for one-offs keyed uniquely). */
const RULES: Record<string, { n: number; perDay: number }> = {
  'ear-correct': { n: 1, perDay: 30 },
  'ear-perfect-set': { n: 5, perDay: 3 },
  'hold-clean': { n: 1, perDay: 40 },
  'tap-perfect': { n: 1, perDay: 30 },
  'climb': { n: 3, perDay: 12 },
  'climb-new-key': { n: 10, perDay: Infinity },
  'challenge-round': { n: 2, perDay: 20 },
  'record': { n: 10, perDay: 6 },
  'loop-best': { n: 5, perDay: 6 },
  'song-through': { n: 5, perDay: 6 },
  'chord-proven': { n: 10, perDay: Infinity },
  'journey-step': { n: 20, perDay: Infinity },
  'pick': { n: 25, perDay: Infinity }
};

/**
 * Pays XP for a skill event. `key` names what was done (a key, a chord, a
 * record), and the same source and key never pay twice in a day.
 * Returns what was paid, 0 if capped.
 */
export function award(source: string, key = ''): number {
  const rule = RULES[source];
  if (!rule) return 0;
  const today = iso();
  if (rule.perDay === Infinity) {
    if (events.some(e => e.s === source && e.k === key)) return 0;
  } else {
    const todays = events.filter(e => e.d === today && e.s === source);
    if (todays.length >= rule.perDay) return 0;
    if (key && todays.some(e => e.k === key)) return 0;
  }
  events = [...events, { d: today, s: source, k: key, n: rule.n }];
  try { localStorage.setItem(KEY, JSON.stringify(events)); } catch { /* this session */ }
  window.dispatchEvent(new Event(XP_EVENT));
  return rule.n;
}

export const totalXp = (): number => events.reduce((a, e) => a + e.n, 0);

/** XP from a date (inclusive) to another (inclusive). */
export function xpBetween(from: string, to: string): number {
  return events.reduce((a, e) => (e.d >= from && e.d <= to ? a + e.n : a), 0);
}

/** Each of the last 7 days, oldest first. */
export function xpWeek(shift: (iso: string, n: number) => string): { date: string; xp: number }[] {
  const today = iso();
  return Array.from({ length: 7 }, (_, i) => {
    const date = shift(today, i - 6);
    return { date, xp: xpBetween(date, date) };
  });
}

// Progress events that are skill, and the XP they pay. Exploring (a scale
// played in Theory, a lesson opened) is not here: that is curiosity, and it
// is its own reward.
const FROM_PROGRESS: Record<string, string> = {
  'ear-interval-correct': 'ear-correct',
  'ear-chord-correct': 'ear-correct',
  'ear-perfect-set': 'ear-perfect-set',
  'tuner-note-matched': 'hold-clean',
  'rhythm-perfect-tap': 'tap-perfect',
  'play-interval-completed': 'challenge-round',
  'play-chord-completed': 'challenge-round'
};

let wired = false;
export function initXp(): void {
  if (wired) return;
  wired = true;
  // Progress keeps counts, so the source is found by which count moved.
  const seen = new Map<string, number>();
  const done = new Set(ALL_LEVELS.filter(isLevelComplete).map(l => l.id));
  let counts: () => Record<string, number> = () => ({});
  try {
    counts = () => (JSON.parse(localStorage.getItem('cadenza-progress-v1') ?? '{}') as { counts?: Record<string, number> }).counts ?? {};
  } catch { /* none */ }
  for (const [k, v] of Object.entries(counts())) seen.set(k, v);
  subscribeProgress(() => {
    const now = counts();
    for (const [event, n] of Object.entries(now)) {
      const before = seen.get(event) ?? 0;
      seen.set(event, n);
      const source = FROM_PROGRESS[event];
      if (source) for (let i = before; i < n; i++) award(source);
    }
    for (const l of ALL_LEVELS) {
      if (!done.has(l.id) && isLevelComplete(l)) { done.add(l.id); award('journey-step', l.id); }
    }
  });
}
