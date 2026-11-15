// Practice time, counted by the app rather than claimed.
//
// There is no timer to start and no number to type. While something is
// actually happening (a song or a loop playing, the metronome running, the mic
// hearing you, an ear training set under way) the seconds are added to today,
// against the song when there is one and to general practice when there is
// not. Several things at once count once: wall time, not activity time.
//
// Two rules keep it honest. The app has to be on screen. And with no touch for
// ten minutes, a running click stops counting until you are back, unless the
// mic is hearing you play or sing, which is the best evidence there is.
//
// Kept on this device, per day and per song, in whole seconds.

import { STORE_CHANGE_EVENT } from './db';

const KEY = 'cadenza-practice-clock-v1';
const GOAL_KEY = 'cadenza-daily-goal';
const GOAL_MET_KEY = 'cadenza-goal-met';
/** Fired when today's total reaches the daily goal, once a day. */
export const GOAL_MET_EVENT = 'cadenza-goal-met';
/** Fired when a whole minute is added, for anything that shows totals. */
export const CLOCK_EVENT = 'cadenza-clock-change';
/** Songless practice: drills, the tuner, ear training. */
export const GENERAL = '';

const IDLE_MS = 10 * 60 * 1000;
const HEARD_MS = 10 * 1000;

type Days = Record<string, Record<string, number>>;

const iso = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

let days: Days = (() => {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Days; } catch { return {}; }
})();

function save(): void {
  try { localStorage.setItem(KEY, JSON.stringify(days)); } catch { /* this session only */ }
}

// ---- Reading ---------------------------------------------------------------

/** Every day and song with counted time, in whole minutes (a minute counts once it is all played). */
export function clockEntries(): { date: string; songId: string; minutes: number }[] {
  const out: { date: string; songId: string; minutes: number }[] = [];
  for (const [date, songs] of Object.entries(days)) {
    for (const [songId, seconds] of Object.entries(songs)) {
      const minutes = Math.floor(seconds / 60);
      if (minutes > 0) out.push({ date, songId, minutes });
    }
  }
  return out;
}

/** Seconds counted on a day, for one song or all of it. */
export function secondsOn(date: string, songId?: string): number {
  const d = days[date];
  if (!d) return 0;
  if (songId !== undefined) return d[songId] ?? 0;
  return Object.values(d).reduce((a, b) => a + b, 0);
}

export const minutesToday = (): number => Math.floor(secondsOn(iso()) / 60);

// ---- The daily goal --------------------------------------------------------

export const GOAL_CHOICES = [5, 10, 20] as const;
export function getGoal(): number {
  try { const n = Number(localStorage.getItem(GOAL_KEY)); return GOAL_CHOICES.includes(n as 5) ? n : 10; } catch { return 10; }
}
export function setGoal(minutes: number): void {
  try { localStorage.setItem(GOAL_KEY, String(minutes)); } catch { /* this session */ }
  window.dispatchEvent(new Event(CLOCK_EVENT));
}

// ---- Counting --------------------------------------------------------------

interface Live { songId: string; mic: boolean }
const live = new Map<string, Live>();
let lastTouch = Date.now();
let lastHeard = 0;
let timer: number | undefined;
let lastTick = 0;

function tick(): void {
  const now = Date.now();
  const dt = Math.min(5000, now - lastTick);
  lastTick = now;
  if (live.size === 0 || document.visibilityState !== 'visible') return;
  const heard = now - lastHeard < HEARD_MS;
  // A mic left on in a quiet room is not practice: mic tools count only while
  // they hear notes. Anything else stops after ten minutes untouched.
  const all = [...live.values()];
  if (all.every(l => l.mic) && !heard) return;
  if (!heard && now - lastTouch > IDLE_MS) return;

  // One clock: a song beats general practice when both are going.
  const songId = [...live.values()].find(l => l.songId)?.songId ?? GENERAL;
  const date = iso();
  const before = Math.floor(secondsOn(date) / 60);
  const day = days[date] ?? (days[date] = {});
  day[songId] = (day[songId] ?? 0) + dt / 1000;
  const after = Math.floor(secondsOn(date) / 60);

  if (after !== before) {
    save();
    // The week, the streak and the badges all read the ledger this feeds.
    window.dispatchEvent(new Event(CLOCK_EVENT));
    window.dispatchEvent(new CustomEvent(STORE_CHANGE_EVENT));
    let met: string | null = null;
    try { met = localStorage.getItem(GOAL_MET_KEY); } catch { /* fine */ }
    if (after >= getGoal() && met !== date) {
      try { localStorage.setItem(GOAL_MET_KEY, date); } catch { /* fine */ }
      window.dispatchEvent(new CustomEvent(GOAL_MET_EVENT, { detail: { minutes: after } }));
    }
  }
}

function ensureTimer(): void {
  if (live.size > 0 && timer === undefined) {
    lastTick = Date.now();
    timer = window.setInterval(tick, 1000);
  } else if (live.size === 0 && timer !== undefined) {
    tick();
    window.clearInterval(timer);
    timer = undefined;
    save();
  }
}

/** Something started or stopped counting. */
export function setLive(key: string, on: boolean, songId: string = GENERAL, mic = false): void {
  if (on) live.set(key, { songId, mic }); else live.delete(key);
  ensureTimer();
}

/** The mic heard a note just now: proof someone is playing. */
export function heard(): void { lastHeard = Date.now(); }

let wired = false;
export function wireClock(): void {
  if (wired) return;
  wired = true;
  const touch = () => { lastTouch = Date.now(); };
  window.addEventListener('pointerdown', touch, { passive: true });
  window.addEventListener('keydown', touch);
  document.addEventListener('visibilitychange', () => { lastTick = Date.now(); if (document.visibilityState === 'hidden') save(); });
}
