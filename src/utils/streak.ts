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
