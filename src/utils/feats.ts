// Personal records and badges.
//
// Two kinds of thing worth keeping. A record is your best number at something
// (the longest run of held notes, the tightest tap test) with the day you set
// it, so a feat is never lost to a page switch again. A badge is a pick, earned
// in five tiers of rarer material as a number crosses fixed marks.
//
// Every badge reads something the app actually measured. Most come from what
// the pages already report (progress events, the chord book, the loop
// records, the practice ledger); the few new numbers are records set here.
// Nothing is given for opening a screen, and nothing can be bought.
//
// Kept on this device, like the voice settings: localStorage, read once.

import { useEffect, useSyncExternalStore } from 'react';
import { getProgressCount, subscribeProgress } from './progress';
import { chordKey, getChordSkills } from './chordbook';
import { getSongs, isReady, streakState } from './library';
import { GOAL_MET_EVENT, clockEntries } from './practiceClock';
import { getRecords } from './records';
import { prettyNote, subscribeVoice } from './voice';
import { JOURNEY, isLevelComplete } from './journey';
import { STORE_CHANGE_EVENT } from './db';
import { award } from './xp';
import { sessionRunning } from './session';

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

export type RecordId = 'hold-streak' | 'hold-steadiest' | 'hold-perfect-run' | 'ear-streak' | 'tap-tightest' | 'hold-low' | 'hold-high';

/** Records where a smaller number is the better one. */
const LOWER_IS_BETTER: Record<RecordId, boolean> = {
  'hold-streak': false,
  'hold-steadiest': true,
  'hold-perfect-run': false,
  'ear-streak': false,
  'tap-tightest': true,
  'hold-low': true,
  'hold-high': false
};

export interface PersonalRecord {
  value: number;
  /** When it was set. */
  at: number;
  /** Optional context: the note, the mode. */
  note?: string;
}

interface FeatsState {
  records: Partial<Record<RecordId, PersonalRecord>>;
  /** Tier held per badge id, 0 to 5 (one-offs: 0 or 1). */
  tiers: Record<string, number>;
  /** Total notes held in the tuner, ever. */
  holds: number;
  /**
   * Set once the first check has run with the library loaded. Badges already
   * deserved by then are granted quietly rather than all at once on launch.
   */
  seeded: boolean;
  /** Chords whose strum the mic has checked, by chord key, with when. */
  proven?: Record<string, number>;
  /** Scales climbed with the mic in Challenges, by "C Major": best time in seconds. */
  climbed?: Record<string, number>;
  /** The newest pick earned, for Today. */
  latest?: { id: string; name: string; glyph: string; tier: number; at: number };
  /** Data rules this state has been brought up to. See migrate(). */
  version?: number;
}

const KEY = 'cadenza-feats-v1';
const CHANGE = 'cadenza-feats-change';

function load(): FeatsState {
  const empty: FeatsState = { records: {}, tiers: {}, holds: 0, seeded: false, version: VERSION };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return migrate({ ...empty, version: 1, ...JSON.parse(raw) });
  } catch { /* fresh */ }
  return empty;
}

const VERSION = 2;
/**
 * Version 2 made Clockwork ask for a real test: 16 on-beat taps at 70 bpm or
 * more, on stricter tiers. A tap record kept under the old 8-tap rule does
 * not meet that, so it and the tier it earned are cleared rather than carried
 * onto a scale it was never measured on.
 */
function migrate(st: FeatsState): FeatsState {
  if ((st.version ?? 1) < 2) {
    const records = { ...st.records };
    delete records['tap-tightest'];
    st = { ...st, records, tiers: { ...st.tiers, clock: 0 }, version: 2 };
    try { localStorage.setItem(KEY, JSON.stringify(st)); } catch { /* next load tries again */ }
  }
  return st;
}

let state: FeatsState = load();

function save(): void {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* this session only */ }
  window.dispatchEvent(new Event(CHANGE));
}

export const getRecord = (id: RecordId): PersonalRecord | undefined => state.records[id];
export const totalHolds = (): number => state.holds;

export interface RecordResult {
  isNew: boolean;
  /** The record before this one, if there was one. */
  previous: number | null;
}

/** Offers a number to a record. Keeps it only if it beats what is there. */
export function setRecord(id: RecordId, value: number, note?: string): RecordResult {
  const old = state.records[id];
  const better = !old || (LOWER_IS_BETTER[id] ? value < old.value : value > old.value);
  if (better) {
    state = { ...state, records: { ...state.records, [id]: { value, at: Date.now(), note } } };
    save();
    if (old) award('record', id);
    checkBadges();
  }
  return { isNew: better, previous: old?.value ?? null };
}

export function countHold(): void {
  state = { ...state, holds: state.holds + 1 };
  save();
}

// ---------------------------------------------------------------------------
// Derived numbers
// ---------------------------------------------------------------------------

const rec = (id: RecordId): number => state.records[id]?.value ?? 0;

/**
 * Range you have proven: the lowest and highest notes actually landed in Hold
 * a note, each held steady for a second and a half. The range finder's own
 * number stays for fitting songs to your voice, but it can be stretched by a
 * guitar or a whistle, so a badge does not read it.
 */
const rangeSemitones = (): number => {
  const low = state.records['hold-low']?.value;
  const high = state.records['hold-high']?.value;
  return low !== undefined && high !== undefined ? high - low : 0;
};
export const provenRange = (): { low: number; high: number } | null => {
  const low = state.records['hold-low']?.value;
  const high = state.records['hold-high']?.value;
  return low !== undefined && high !== undefined ? { low, high } : null;
};

/**
 * How much faster a loop has got, counted across days.
 *
 * Progress is measured from the best run on the first day it was played, and
 * can grow by at most 10 bpm for each later day: a loop saved at 40 and then
 * at 100 five minutes later is a slider moved, not a skill gained. Quick play
 * cannot hear you, so the spacing is what keeps the number about practice.
 */
export const MAX_CLIMB_PER_DAY = 10;
function climbOf(days: Record<string, number> | undefined): number {
  const list = Object.entries(days ?? {}).sort(([a], [b]) => (a < b ? -1 : 1));
  if (list.length < 2) return 0;
  const base = list[0][1];
  let credited = 0;
  for (const [, best] of list.slice(1)) credited = Math.max(credited, Math.min(credited + MAX_CLIMB_PER_DAY, best - base));
  return credited;
}
const loopClimb = (): number => getRecords().reduce((m, r) => Math.max(m, climbOf(r.days)), 0);

/**
 * Chords you can play, proven: rated Solid and strummed for the mic, which
 * checked every note rang. Rating is your word; the strum is the evidence.
 */
export const isProven = (symbol: string): boolean => !!state.proven?.[chordKey(symbol)];
export function markProven(symbol: string): void {
  state = { ...state, proven: { ...state.proven, [chordKey(symbol)]: Date.now() } };
  save();
  award('chord-proven', chordKey(symbol));
  checkBadges();
}
const solidChords = (): number => getChordSkills().filter(s => s.comfort === 'solid' && !!state.proven?.[s.id]).length;

/**
 * Scales climbed in Challenges, every note heard by the mic, in order. Each
 * key and scale counts once ("C Major", "A Natural minor"), and its fastest
 * climb is kept as a personal best.
 */
export const bestClimb = (key: string): number | undefined => state.climbed?.[key];
export function markClimbed(key: string, seconds: number): { best: number; previous?: number } {
  const previous = state.climbed?.[key];
  const best = previous === undefined ? seconds : Math.min(previous, seconds);
  state = { ...state, climbed: { ...state.climbed, [key]: best } };
  save();
  award(previous === undefined ? 'climb-new-key' : 'climb', key);
  if (previous !== undefined && seconds < previous) award('record', `climb:${key}`);
  checkBadges();
  return { best, previous };
}
const scalesClimbed = (): number => Object.keys(state.climbed ?? {}).length;

/**
 * Songs you can play, with the minutes to show for it. Marking a song
 * Playable is a click; it counts here once the app has also counted at least
 * 10 minutes of playing it, on 2 or more days.
 */
export const SETLIST_MINUTES = 10;
export const SETLIST_DAYS = 2;
export function songEarned(songId: string): boolean {
  const days = clockEntries().filter(e => e.songId === songId);
  return days.length >= SETLIST_DAYS && days.reduce((n, e) => n + e.minutes, 0) >= SETLIST_MINUTES;
}
const playableSongs = (): number => getSongs().filter(s => s.status !== 'learning' && songEarned(s.id)).length;

/** The longest daily streak ever, rests included. See streak.ts. */
export const longestDailyStreak = (): number => streakState().longest;

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

export interface TieredBadge {
  id: string;
  name: string;
  /** A music symbol that says what it measures. */
  glyph: string;
  what: string;
  page: string;
  /** Five marks, in the order they are met. */
  tiers: [number, number, number, number, number];
  lowerIsBetter?: boolean;
  value: () => number;
  /** How a mark is written. */
  fmt?: (n: number) => string;
  /** What is still needed, given the gap to the next mark. */
  need: (gap: number, mark: number) => string;
  /** A mark met, said as a sentence: "25 notes in a row". */
  said: (mark: number) => string;
}

export const TIERED: TieredBadge[] = [
  {
    id: 'steady', name: 'Steady Voice', glyph: '𝄐', page: 'Voice tuner',
    what: 'Notes held in a row in one run', tiers: [10, 25, 50, 100, 200],
    value: () => rec('hold-streak'), said: n => `${n} notes in a row`,
    need: g => `${g} more in a row`
  },
  {
    id: 'centre', name: 'Dead Centre', glyph: '♮', page: 'Voice tuner',
    what: 'Perfect holds (wobble within ±8¢) in one run', tiers: [3, 5, 10, 20, 40],
    value: () => rec('hold-perfect-run'), said: n => `${n} Perfect holds in one run`,
    need: g => `${g} more Perfect holds in one run`
  },
  {
    id: 'range', name: 'Range Finder', glyph: '𝄞', page: 'Voice tuner',
    what: 'Semitones between your lowest and highest landed notes', tiers: [12, 15, 18, 21, 24],
    value: rangeSemitones, said: n => `${n} semitones between your lowest and highest landed notes`,
    need: g => `${g} more semitone${g === 1 ? '' : 's'} of range`
  },
  {
    id: 'ears', name: 'Sharp Ears', glyph: '♯', page: 'Ear Training',
    what: 'Sets of ten with all ten right', tiers: [1, 3, 10, 25, 50],
    value: () => getProgressCount('ear-perfect-set'), said: n => n === 1 ? 'A set of ten, all ten right' : `${n} sets of ten, all ten right`,
    need: g => `${g} more perfect set${g === 1 ? '' : 's'}`
  },
  {
    id: 'clock', name: 'Clockwork', glyph: '♩', page: 'Rhythm',
    what: 'Tap test of 16 taps, average distance from the beat', tiers: [30, 22, 16, 12, 8], lowerIsBetter: true,
    value: () => rec('tap-tightest'), fmt: n => `${n} ms`, said: n => `Taps within ${n} ms of the beat, on average`,
    need: (_, m) => `Average within ${m} ms`
  },
  {
    id: 'climb', name: 'Speed Climber', glyph: '♬', page: 'Chords',
    what: 'Tempo gained on one loop across days (up to 10 bpm a day)', tiers: [10, 20, 30, 45, 60],
    value: loopClimb, fmt: n => `+${n}`, said: n => `${n} bpm faster on one loop`,
    need: g => `${g} more bpm on one loop`
  },
  {
    id: 'collect', name: 'Chord Collector', glyph: '♫', page: 'Chords',
    what: 'Chords rated Solid and proven by strumming for the mic', tiers: [3, 8, 15, 25, 40],
    value: solidChords, said: n => `${n} chords proven by ear`,
    need: g => `${g} more chord${g === 1 ? '' : 's'} proven by ear`
  },
  {
    id: 'explorer', name: 'Fretboard Explorer', glyph: '♭', page: 'Challenges',
    what: 'Scales climbed with the mic, each key counted once', tiers: [1, 3, 5, 10, 20],
    value: scalesClimbed, said: n => n === 1 ? 'A scale climbed by ear' : `${n} scales climbed by ear`,
    need: g => `${g} more scale${g === 1 ? '' : 's'} to climb`
  },
  {
    id: 'setlist', name: 'Setlist', glyph: '♪', page: 'Songs',
    what: 'Songs marked Playable, with 10 counted minutes over 2 days', tiers: [1, 3, 5, 10, 20],
    value: playableSongs, said: n => n === 1 ? 'A song marked Playable' : `${n} songs marked Playable or better`,
    need: g => `${g} more playable song${g === 1 ? '' : 's'}`
  },
  {
    id: 'daily', name: 'Every Day', glyph: '𝄆', page: 'Today',
    what: 'Days in a row with practice', tiers: [3, 7, 14, 30, 100],
    value: longestDailyStreak, said: n => `${n} days in a row with practice`,
    need: g => `${g} more day${g === 1 ? '' : 's'} in a row`
  }
];

export interface OneOffBadge {
  id: string;
  name: string;
  glyph: string;
  what: string;
  earned: () => boolean;
}

export const ONE_OFFS: OneOffBadge[] = [
  { id: 'first-hold', name: 'First note held', glyph: '𝅗𝅥', what: 'Held a sung note in the tuner', earned: () => getProgressCount('tuner-note-matched') > 0 },
  {
    id: 'scientist', name: 'Sound Scientist', glyph: '𝄢', what: 'Tried all four Sound Physics lessons',
    earned: () => getProgressCount('physics-harmonic-played') >= 2 && getProgressCount('physics-ratio-locked') > 0 &&
      getProgressCount('physics-third-compared') > 0 && getProgressCount('physics-circle-completed') > 0
  },
  ...JOURNEY.map((chapter, i) => ({
    id: `chapter-${i}`,
    name: chapter.title,
    glyph: '𝄂',
    what: `Finished Journey chapter ${i + 1}`,
    earned: () => chapter.levels.every(isLevelComplete)
  }))
];

/** The tier a number reaches. */
export function tierOf(b: TieredBadge, v: number = b.value()): number {
  return b.tiers.filter(t => (b.lowerIsBetter ? v > 0 && v <= t : v >= t)).length;
}

export const fmtMark = (b: TieredBadge, n: number): string => (b.fmt ? b.fmt(n) : String(n));

/** What the next tier asks for, or null at the top. */
export function nextStep(b: TieredBadge): string | null {
  const t = tierOf(b);
  if (t >= 5) return null;
  const mark = b.tiers[t];
  const v = b.value();
  return b.need(Math.max(1, Math.ceil(mark - v)), mark);
}

export const MATERIALS = ['', 'Celluloid', 'Tortoiseshell', 'Bone', 'Brass', 'Abalone'] as const;
export const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'] as const;

// ---------------------------------------------------------------------------
// Unlocks
// ---------------------------------------------------------------------------

export interface Unlock {
  id: string;
  name: string;
  glyph: string;
  /** 1 to 5; one-offs show as 0 and are drawn in brass without a numeral. */
  tier: number;
  /** What earned it, in a line. */
  why: string;
  /** A badge, or the daily goal met (a lighter moment, no pick). */
  kind?: 'badge' | 'goal';
  /** The next mark, if there is one. */
  next: string | null;
}

let queue: Unlock[] = [];
const QUEUE_CHANGE = 'cadenza-unlock-change';
const announceQueue = () => window.dispatchEvent(new Event(QUEUE_CHANGE));

// Badges wait for you to finish. While anything is in progress (a tap test,
// a run of held notes, a set of ten, a stack of chords to rate) they queue up
// quietly, and appear a moment after the last activity stops. Each activity
// says it is busy through useHoldUnlocks.
const busy = new Set<string>();
let open = true;
let openTimer: number | undefined;
const NONE: Unlock[] = [];

function setBusy(key: string, on: boolean): void {
  if (on) busy.add(key); else busy.delete(key);
  window.clearTimeout(openTimer);
  if (busy.size > 0) {
    if (open) { open = false; announceQueue(); }
  } else if (!open) {
    // A breath after stopping, so the badge follows the finish rather than
    // landing on the last tap.
    openTimer = window.setTimeout(() => { open = true; announceQueue(); }, 900);
  }
}

/** Holds badges back while `active` is true, and lets them through after. */
export function useHoldUnlocks(key: string, active: boolean): void {
  useEffect(() => {
    setBusy(key, active);
    return () => setBusy(key, false);
  }, [key, active]);
}

export function useUnlocks(): Unlock[] {
  return useSyncExternalStore(
    cb => { window.addEventListener(QUEUE_CHANGE, cb); return () => window.removeEventListener(QUEUE_CHANGE, cb); },
    () => (open ? queue : NONE)
  );
}

/** Whether an unlock is on screen. */
export const unlockShowing = (): boolean => open && queue.length > 0;

export function dismissAllUnlocks(): void {
  queue = [];
  announceQueue();
}

// Which pick the Trophies shelf should open on, when a badge sent you there.
let shelfPick: string | null = null;
export const showOnShelf = (id: string): void => { shelfPick = id; };
/** Whether Me was opened to show a pick, without taking it. */
export const peekShelfPick = (): boolean => shelfPick !== null;
export function takeShelfPick(): string | null {
  const id = shelfPick;
  shelfPick = null;
  return id;
}

export function dismissUnlock(): void {
  queue = queue.slice(1);
  announceQueue();
}

/** Compares what is deserved with what is held, and queues anything new. */
export function checkBadges(): void {
  if (!isReady()) return;
  const tiers = { ...state.tiers };
  const fresh: Unlock[] = [];

  for (const b of TIERED) {
    const t = tierOf(b);
    const had = tiers[b.id] ?? 0;
    if (t > had) {
      tiers[b.id] = t;
      const mark = b.tiers[t - 1];
      fresh.push({
        id: b.id, name: b.name, glyph: b.glyph, tier: t,
        why: b.said(mark),
        next: t < 5 ? `${ROMAN[t + 1]} · ${b.said(b.tiers[t])}` : null
      });
    }
  }
  for (const o of ONE_OFFS) {
    if (!tiers[o.id] && o.earned()) {
      tiers[o.id] = 1;
      fresh.push({ id: o.id, name: o.name, glyph: o.glyph, tier: 0, why: o.what, next: null });
    }
  }

  const changed = fresh.length > 0 || !state.seeded;
  if (!changed) return;
  const quiet = !state.seeded;
  const top = fresh[fresh.length - 1];
  state = {
    ...state, tiers, seeded: true,
    latest: !quiet && top ? { id: top.id, name: top.name, glyph: top.glyph, tier: top.tier, at: Date.now() } : state.latest
  };
  save();
  if (!quiet && fresh.length) {
    for (const f of fresh) award('pick', `${f.id}:${f.tier}`);
    queue = [...queue, ...fresh];
    announceQueue();
  }
}

export const heldTier = (id: string): number => state.tiers[id] ?? 0;

/**
 * The newest pick, with what its next tier needs. Before any pick has been
 * earned with the app watching, the highest one held stands in.
 */
export function latestPick(): (Unlock & { tier: number }) | null {
  const l = state.latest;
  const tiered = (id: string) => TIERED.find(b => b.id === id);
  if (l) {
    const b = tiered(l.id);
    const t = b ? Math.max(heldTier(b.id), l.tier) : l.tier;
    return { id: l.id, name: l.name, glyph: l.glyph, tier: t, why: '', next: b ? nextStep(b) : null };
  }
  const best = TIERED.map(b => ({ b, t: heldTier(b.id) })).filter(x => x.t > 0).sort((x, y) => y.t - x.t)[0];
  return best ? { id: best.b.id, name: best.b.name, glyph: best.b.glyph, tier: best.t, why: '', next: nextStep(best.b) } : null;
}

let wired = false;
/** Watches every store a badge reads. Called once, from the app shell. */
export function initFeats(): void {
  if (wired) return;
  wired = true;
  subscribeProgress(checkBadges);
  subscribeVoice(checkBadges);
  window.addEventListener(GOAL_MET_EVENT, e => {
    // A session that ends on a summary says it there instead.
    if (sessionRunning()) return;
    const minutes = (e as CustomEvent<{ minutes: number }>).detail?.minutes ?? 0;
    const days = streakState().current;
    queue = [...queue, {
      id: 'goal', name: 'Daily goal met', glyph: '', tier: 0, kind: 'goal',
      why: `${minutes} minutes today${days > 1 ? `, ${days} days in a row` : ''}`, next: null
    }];
    announceQueue();
  });
  window.addEventListener(STORE_CHANGE_EVENT, checkBadges);
  checkBadges();
}

export function useFeats(): FeatsState {
  return useSyncExternalStore(
    cb => {
      window.addEventListener(CHANGE, cb);
      window.addEventListener(STORE_CHANGE_EVENT, cb);
      return () => { window.removeEventListener(CHANGE, cb); window.removeEventListener(STORE_CHANGE_EVENT, cb); };
    },
    () => state
  );
}

// ---------------------------------------------------------------------------
// The records shelf
// ---------------------------------------------------------------------------

export interface RecordRow {
  label: string;
  value: string;
  sub: string;
}

const when = (at: number): string => {
  const d = new Date(at);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'today';
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
};

/** Every best the app knows of, in the order a player would look for them. */
export function recordRows(): RecordRow[] {
  const rows: RecordRow[] = [];
  const r = state.records;
  if (r['hold-streak']) rows.push({ label: 'Longest hold streak', value: `${r['hold-streak'].value}`, sub: `Voice tuner · ${when(r['hold-streak'].at)}` });
  if (r['hold-steadiest']) rows.push({ label: 'Steadiest hold', value: `±${r['hold-steadiest'].value}¢`, sub: `${r['hold-steadiest'].note ?? 'Voice tuner'} · ${when(r['hold-steadiest'].at)}` });
  if (r['hold-perfect-run']) rows.push({ label: 'Most Perfect holds in a run', value: `${r['hold-perfect-run'].value}`, sub: `Voice tuner · ${when(r['hold-perfect-run'].at)}` });
  const range = provenRange();
  if (range && range.high > range.low) rows.push({ label: 'Landed range', value: `${prettyNote(range.low)} to ${prettyNote(range.high)}`, sub: `${range.high - range.low} semitones, Hold a note` });
  if (r['ear-streak']) rows.push({ label: 'Ear training streak', value: `${r['ear-streak'].value}`, sub: `${r['ear-streak'].note ?? 'Ear Training'} · ${when(r['ear-streak'].at)}` });
  if (r['tap-tightest']) rows.push({ label: 'Tightest tap test', value: `±${r['tap-tightest'].value} ms`, sub: `Rhythm · ${when(r['tap-tightest'].at)}` });
  const fastest = getRecords().sort((a, b) => b.best - a.best)[0];
  if (fastest) rows.push({ label: 'Fastest loop', value: `${fastest.best} bpm`, sub: `${fastest.chords.map(c => c[0]).join(' ')} · ${when(fastest.setAt)}` });
  const days = longestDailyStreak();
  if (days > 1) rows.push({ label: 'Longest daily streak', value: `${days} days`, sub: 'Practice on the calendar' });
  if (state.holds > 0) rows.push({ label: 'Notes held, all time', value: `${state.holds}`, sub: 'Voice tuner' });
  return rows;
}
