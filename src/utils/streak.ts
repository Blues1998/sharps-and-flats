// The daily streak, with rests.
//
// A streak is days in a row with practice. Music has rests in it, and so does
// this: every 7 days in a row earns one (up to 2 kept), and a missed day uses
// one automatically, so a single off day does not throw away a month. A rest
// keeps the streak alive without adding to it.
//
// Worked out from the days themselves every time, so there is nothing stored
// to drift: the same history always gives the same streak. Today, if not yet
// played, is still open and never counts as missed.

export const REST_EVERY = 7;
export const MAX_RESTS = 2;

export interface StreakState {
  /** Days in a row, today included if played. */
  current: number;
  /** Rests banked now. */
  rests: number;
  /** The longest streak ever. */
  longest: number;
  /** Days a rest covered, oldest first. */
  restDays: string[];
  playedToday: boolean;
}

export function walkStreak(played: Set<string>, today: string, shift: (iso: string, n: number) => string): StreakState {
  const sorted = [...played].filter(d => d <= today).sort();
  const empty: StreakState = { current: 0, rests: 0, longest: 0, restDays: [], playedToday: false };
  if (sorted.length === 0) return empty;

  let current = 0;
  let rests = 0;
  let longest = 0;
  const restDays: string[] = [];
  for (let d = sorted[0]; d <= today; d = shift(d, 1)) {
    if (played.has(d)) {
      current++;
      longest = Math.max(longest, current);
      if (current % REST_EVERY === 0) rests = Math.min(MAX_RESTS, rests + 1);
    } else if (d !== today) {
      if (current > 0 && rests > 0) { rests--; restDays.push(d); }
      else { current = 0; rests = 0; }
    }
  }
  return { current, rests, longest, restDays, playedToday: played.has(today) };
}

// ---- Repair ----------------------------------------------------------------
//
// A broken streak makes people quit more than any missed day does, and
// messages that point at the break do not bring them back (Silverman &
// Barasch, 2023). What softens it is a way to repair. So within two days of a
// break you can earn the streak back: practise double your daily goal today
// and the missed days count as played. Rests cover one off day for free; this
// covers the bad week that rests ran out on.

const REPAIR_KEY = 'cadenza-streak-repairs';
export const REPAIR_WINDOW = 2;

export function repairedDays(): string[] {
  try { return JSON.parse(localStorage.getItem(REPAIR_KEY) ?? '[]') as string[]; } catch { return []; }
}

export function addRepaired(dates: string[]): void {
  const all = [...new Set([...repairedDays(), ...dates])];
  try { localStorage.setItem(REPAIR_KEY, JSON.stringify(all)); } catch { /* this session */ }
}

export interface RepairOffer {
  /** The streak that broke. */
  lost: number;
  /** The days that would be filled in. */
  missed: string[];
}

/** A streak that broke in the last two days and can still be earned back. */
export function repairOffer(played: Set<string>, today: string, shift: (iso: string, n: number) => string): RepairOffer | null {
  const past = new Set([...played].filter(d => d < today));
  if (past.size === 0) return null;
  if (walkStreak(past, today, shift).current > 0) return null; // not broken
  const last = [...past].sort().pop() as string;
  const missed: string[] = [];
  for (let d = shift(last, 1); d < today; d = shift(d, 1)) missed.push(d);
  if (missed.length === 0 || missed.length > REPAIR_WINDOW) return null;
  const lost = walkStreak(past, last, shift).current;
  return lost >= 2 ? { lost, missed } : null;
}
