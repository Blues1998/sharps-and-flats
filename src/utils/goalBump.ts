// When the daily goal is too easy, offer a bigger one.
//
// Two signs, either is enough:
//
//   day one      the very first day of practice ran to three times the goal
//   a habit      the last three days in a row each ran to half again the goal
//
// The offer is always the next step up (5 to 10, 10 to 20), never a leap, so
// it stays a goal the player will keep hitting. Asked at most once a day;
// "Keep" stops it for two weeks. At the top choice there is nothing to offer.

import { GOAL_CHOICES, clockEntries, getGoal, secondsOn } from './practiceClock';
import { track } from './telemetry';

const KEY = 'cadenza-goal-bump';
const DAY_ONE_TIMES = 3;
const HABIT_TIMES = 1.5;
const HABIT_DAYS = 3;
const QUIET_DAYS = 14;

interface Asked { on: string; kept?: boolean }

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysBack = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };
const minutesOn = (date: string) => Math.floor(secondsOn(date) / 60);

function asked(): Asked | null {
  try { return JSON.parse(localStorage.getItem(KEY) ?? 'null') as Asked | null; } catch { return null; }
}
function remember(a: Asked): void {
  try { localStorage.setItem(KEY, JSON.stringify(a)); } catch { /* asks again next time */ }
}

export interface GoalOffer { from: number; to: number; why: 'day-one' | 'habit'; said: string }

/** A bigger goal worth offering right now, or null. Cheap: reads the day totals. */
export function goalOffer(): GoalOffer | null {
  const goal = getGoal();
  const today = daysBack(0);
  const last = asked();
  if (last?.on === today) return null;
  if (last?.kept && last.on > daysBack(QUIET_DAYS)) return null;

  const to = GOAL_CHOICES.find(g => g > goal);
  if (!to) return null;

  const todayMins = minutesOn(today);
  const firstDay = clockEntries().every(e => e.date === today || e.minutes === 0);
  if (firstDay && todayMins >= goal * DAY_ONE_TIMES) {
    return { from: goal, to, why: 'day-one', said: `${todayMins} minutes on your first day, ${Math.floor(todayMins / goal)} times your goal.` };
  }

  const recent = Array.from({ length: HABIT_DAYS }, (_, i) => minutesOn(daysBack(i)));
  if (recent.every(m => m >= goal * HABIT_TIMES)) {
    return { from: goal, to, why: 'habit', said: `At least ${Math.min(...recent)} minutes a day, ${HABIT_DAYS} days in a row.` };
  }
  return null;
}

/** Shown: not again today, whatever the answer. */
export function offerShown(o: GoalOffer): void {
  remember({ on: daysBack(0) });
  track('goal_bump_offered', { from: o.from, to: o.to, why: o.why });
}

/** The answer. Yes sets the goal; no keeps it and stays quiet for two weeks. */
export function answerOffer(o: GoalOffer, yes: boolean): void {
  remember({ on: daysBack(0), kept: !yes });
  track('goal_bump_answered', { from: o.from, to: o.to, why: o.why, yes });
}
