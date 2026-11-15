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

import { useSyncExternalStore } from 'react';
import { getProgressCount, subscribeProgress } from './progress';
import { getChordSkills } from './chordbook';
import { getSongs, isReady, practiceLedger, shiftIso } from './library';
import { getRecords } from './records';
import { getVoice, prettyNote, subscribeVoice } from './voice';
import { JOURNEY, isLevelComplete } from './journey';
import { STORE_CHANGE_EVENT } from './db';

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

export type RecordId = 'hold-streak' | 'hold-steadiest' | 'hold-perfect-run' | 'ear-streak' | 'tap-tightest';

/** Records where a smaller number is the better one. */
const LOWER_IS_BETTER: Record<RecordId, boolean> = {
  'hold-streak': false,
  'hold-steadiest': true,
  'hold-perfect-run': false,
  'ear-streak': false,
  'tap-tightest': true
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
}

const KEY = 'cadenza-feats-v1';
const CHANGE = 'cadenza-feats-change';

function load(): FeatsState {
  const empty: FeatsState = { records: {}, tiers: {}, holds: 0, seeded: false };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...empty, ...JSON.parse(raw) };
  } catch { /* fresh */ }
  return empty;
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

/** Semitones between the lowest and highest notes of the saved voice range. */
const rangeSemitones = (): number => {
  const r = getVoice().range;
  return r ? r.high - r.low : 0;
};

/** The most a loop has sped up since the first clean run banked on it. */
const loopClimb = (): number =>
  getRecords().reduce((m, r) => Math.max(m, r.best - (r.first ?? r.previous ?? r.best)), 0);

const solidChords = (): number => getChordSkills().filter(s => s.comfort === 'solid').length;

const playableSongs = (): number => getSongs().filter(s => s.status !== 'learning').length;

/** The longest run of days with practice, from the whole ledger. */
export function longestDailyStreak(): number {
  const days = [...new Set(practiceLedger().filter(e => e.minutes > 0).map(e => e.date))].sort();
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of days) {
    run = prev && shiftIso(prev, 1) === d ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return best;
}

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
    what: 'Perfect holds (wobble within ±5¢) in one run', tiers: [3, 5, 10, 20, 40],
    value: () => rec('hold-perfect-run'), said: n => `${n} Perfect holds in one run`,
    need: g => `${g} more Perfect holds in one run`
  },
  {
    id: 'range', name: 'Range Finder', glyph: '𝄞', page: 'Voice tuner',
    what: 'Voice range found, in semitones', tiers: [12, 15, 18, 21, 24],
    value: rangeSemitones, said: n => `${n} semitones of voice range`,
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
    what: 'Tap test, average distance from the beat', tiers: [25, 18, 12, 8, 5], lowerIsBetter: true,
    value: () => rec('tap-tightest'), fmt: n => `${n} ms`, said: n => `Taps within ${n} ms of the beat, on average`,
    need: (_, m) => `Average within ${m} ms`
  },
  {
    id: 'climb', name: 'Speed Climber', glyph: '♬', page: 'Chords',
    what: 'Tempo gained on one loop since its first clean run', tiers: [10, 20, 30, 45, 60],
    value: loopClimb, fmt: n => `+${n}`, said: n => `${n} bpm faster on one loop`,
    need: g => `${g} more bpm on one loop`
  },
  {
    id: 'collect', name: 'Chord Collector', glyph: '♫', page: 'Chords',
    what: 'Chords rated Solid', tiers: [3, 8, 15, 25, 40],
    value: solidChords, said: n => `${n} chords rated Solid`,
    need: g => `${g} more Solid chord${g === 1 ? '' : 's'}`
  },
  {
    id: 'setlist', name: 'Setlist', glyph: '♪', page: 'Songs',
    what: 'Songs marked Playable or better', tiers: [1, 3, 5, 10, 20],
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
  /** The next mark, if there is one. */
  next: string | null;
}

let queue: Unlock[] = [];
const QUEUE_CHANGE = 'cadenza-unlock-change';
const announceQueue = () => window.dispatchEvent(new Event(QUEUE_CHANGE));

export function useUnlocks(): Unlock[] {
  return useSyncExternalStore(
    cb => { window.addEventListener(QUEUE_CHANGE, cb); return () => window.removeEventListener(QUEUE_CHANGE, cb); },
    () => queue
  );
}

/** Whether an unlock is on screen, so a run can wait behind it. */
export const unlockShowing = (): boolean => queue.length > 0;

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
  state = { ...state, tiers, seeded: true };
  save();
  if (!quiet && fresh.length) {
    queue = [...queue, ...fresh];
    announceQueue();
  }
}

export const heldTier = (id: string): number => state.tiers[id] ?? 0;

let wired = false;
/** Watches every store a badge reads. Called once, from the app shell. */
export function initFeats(): void {
  if (wired) return;
  wired = true;
  subscribeProgress(checkBadges);
  subscribeVoice(checkBadges);
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
  const range = getVoice().range;
  if (range) rows.push({ label: 'Voice range', value: `${prettyNote(range.low)} to ${prettyNote(range.high)}`, sub: `${range.high - range.low} semitones` });
  if (r['ear-streak']) rows.push({ label: 'Ear training streak', value: `${r['ear-streak'].value}`, sub: `${r['ear-streak'].note ?? 'Ear Training'} · ${when(r['ear-streak'].at)}` });
  if (r['tap-tightest']) rows.push({ label: 'Tightest tap test', value: `±${r['tap-tightest'].value} ms`, sub: `Rhythm · ${when(r['tap-tightest'].at)}` });
  const fastest = getRecords().sort((a, b) => b.best - a.best)[0];
  if (fastest) rows.push({ label: 'Fastest loop', value: `${fastest.best} bpm`, sub: `${fastest.chords.map(c => c[0]).join(' ')} · ${when(fastest.setAt)}` });
  const days = longestDailyStreak();
  if (days > 1) rows.push({ label: 'Longest daily streak', value: `${days} days`, sub: 'Practice on the calendar' });
  if (state.holds > 0) rows.push({ label: 'Notes held, all time', value: `${state.holds}`, sub: 'Voice tuner' });
  return rows;
}
