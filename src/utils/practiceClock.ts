// Practice time, counted by the app rather than claimed.
//
// There is no timer to start and no number to type. While something is
// actually happening (a song or a loop playing, the metronome running, the mic
// hearing you, an ear training set under way) the seconds are added to today,
// against the song when there is one and to general practice when there is
// not. Several things at once count once: wall time, not activity time.
//
// The rules that keep it honest, each the way well-known apps do it:
//
// - On screen only. Time in the background is not counted (like Strava's
//   auto-pause: no movement, no clock).
// - Mic tools count only while they hear notes, so a mic left on in a quiet
//   room adds nothing (like Yousician, which counts what it hears you play).
// - Presence. After ten minutes without a touch the app asks "Still playing?"
//   (like Netflix's "Are you still watching?"). A tap within two minutes keeps
//   the time since; no tap, and that time is dropped and the clock waits for
//   you. A radio near the mic or a loop left running cannot run up hours.
// - Days only move forward. Time goes to the latest date the app has seen, so
//   turning the phone's clock back cannot fill in a missed day (Duolingo uses
//   its server's clock for the same reason; this app has no server, so it
//   keeps its own high-water mark).
// - Two tabs of the web app add to one total instead of overwriting each
//   other: each saves only what it counted since its last save.

import { STORE_CHANGE_EVENT } from './db';

const KEY = 'cadenza-practice-clock-v1';
const LATEST_KEY = 'cadenza-clock-latest';
const GOAL_KEY = 'cadenza-daily-goal';
const GOAL_MET_KEY = 'cadenza-goal-met';
/** Fired when today's total reaches the daily goal, once a day. */
export const GOAL_MET_EVENT = 'cadenza-goal-met';
/** Fired when a whole minute is added, or the presence check changes. */
export const CLOCK_EVENT = 'cadenza-clock-change';
/** Songless practice: drills, the tuner, ear training. */
export const GENERAL = '';

const IDLE_MS = 10 * 60 * 1000;
const ASK_MS = 2 * 60 * 1000;
const HEARD_MS = 10 * 1000;

type Days = Record<string, Record<string, number>>;

const iso = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const readDays = (): Days => {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Days; } catch { return {}; }
};

let days: Days = readDays();
/** Seconds counted here and not yet written, per day and song. */
let unsaved: Days = {};

function add(into: Days, date: string, songId: string, seconds: number): void {
  const d = into[date] ?? (into[date] = {});
  d[songId] = (d[songId] ?? 0) + seconds;
}

function save(): void {
  // Re-read and add only our own new seconds, so another tab's are kept.
  const stored = readDays();
  for (const [date, songs] of Object.entries(unsaved)) {
    for (const [songId, s] of Object.entries(songs)) add(stored, date, songId, s);
  }
  unsaved = {};
  days = stored;
  try { localStorage.setItem(KEY, JSON.stringify(days)); } catch { /* kept in memory */ }
}

/** The date time is credited to: today, or the latest the app has seen if the clock went back. */
function creditDate(): string {
  const today = iso();
  let latest = '';
  try { latest = localStorage.getItem(LATEST_KEY) ?? ''; } catch { /* fine */ }
  if (today >= latest) {
    if (today !== latest) { try { localStorage.setItem(LATEST_KEY, today); } catch { /* fine */ } }
    return today;
  }
  return latest;
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

/** counting: normal. asking: "Still playing?" is up. waiting: unanswered, paused until a touch. */
export type Presence = 'counting' | 'asking' | 'waiting';
let presence: Presence = 'counting';
let askedAt = 0;
/** Time counted while asking, kept only if the question is answered. */
let pending: { date: string; songId: string; seconds: number }[] = [];

export const getPresence = (): Presence => (live.size > 0 ? presence : 'counting');

function setPresence(p: Presence): void {
  if (p === presence) return;
  presence = p;
  window.dispatchEvent(new Event(CLOCK_EVENT));
}

function credit(date: string, songId: string, seconds: number): void {
  const before = Math.floor(secondsOn(date) / 60);
  add(days, date, songId, seconds);
  add(unsaved, date, songId, seconds);
  const after = Math.floor(secondsOn(date) / 60);
  if (after === before) return;
  save();
  // The week, the streak and the badges all read the ledger this feeds.
  window.dispatchEvent(new Event(CLOCK_EVENT));
  window.dispatchEvent(new CustomEvent(STORE_CHANGE_EVENT));
  let met: string | null = null;
  try { met = localStorage.getItem(GOAL_MET_KEY); } catch { /* fine */ }
  if (date === iso() && after >= getGoal() && met !== date) {
    try { localStorage.setItem(GOAL_MET_KEY, date); } catch { /* fine */ }
    window.dispatchEvent(new CustomEvent(GOAL_MET_EVENT, { detail: { minutes: after } }));
  }
}

function tick(): void {
  const now = Date.now();
  const dt = Math.min(5000, now - lastTick);
  lastTick = now;
  if (live.size === 0 || document.visibilityState !== 'visible') return;

  const all = [...live.values()];
  if (all.every(l => l.mic) && now - lastHeard > HEARD_MS) return;

  if (presence === 'waiting') return;
  if (presence === 'counting' && now - lastTouch > IDLE_MS) {
    askedAt = now;
    setPresence('asking');
  }
  if (presence === 'asking' && now - askedAt > ASK_MS) {
    pending = [];
    setPresence('waiting');
    return;
  }

  // One clock: a song beats general practice when both are going.
  const songId = all.find(l => l.songId)?.songId ?? GENERAL;
  const date = creditDate();
  if (presence === 'asking') pending.push({ date, songId, seconds: dt / 1000 });
  else credit(date, songId, dt / 1000);
}

function onTouch(): void {
  lastTouch = Date.now();
  if (presence === 'asking') {
    // Answered: the time spent asking was real practice after all.
    for (const p of pending) credit(p.date, p.songId, p.seconds);
    pending = [];
  }
  setPresence('counting');
}

function ensureTimer(): void {
  if (live.size > 0 && timer === undefined) {
    lastTick = Date.now();
    timer = window.setInterval(tick, 1000);
  } else if (live.size === 0 && timer !== undefined) {
    tick();
    window.clearInterval(timer);
    timer = undefined;
    pending = [];
    setPresence('counting');
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
  window.addEventListener('pointerdown', onTouch, { passive: true });
  window.addEventListener('keydown', onTouch);
  document.addEventListener('visibilitychange', () => {
    lastTick = Date.now();
    if (document.visibilityState === 'hidden') save();
  });
}
