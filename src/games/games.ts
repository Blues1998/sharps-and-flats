// Ear games: quick rounds, no reading, three strikes. Each game climbs a level
// every five right answers, with more to choose from and closer sounds.
//
//   note      C plays, then a note: which one? (pitch against a home note)
//   chord     which kind of chord? major and minor first, sevenths last
//   interval  how far apart are the two notes?
//   tempo     how fast is the click?

import type { Sound } from '../lesson/sound';

export type GameId = 'note' | 'chord' | 'interval' | 'tempo';

export interface Round {
  prompt: string;
  sound: Sound;
  options: { label: string; hear: Sound }[];
  answer: string;
  /** One line after the answer, to keep. */
  say: string;
}

export interface GameDef {
  id: GameId;
  name: string;
  /** Under the name on the tile. */
  blurb: string;
  /** The glyph on the tile. */
  mark: string;
  round: (level: number) => Round;
}

export const LEVELS = 5;
export const PER_LEVEL = 5;
export const STRIKES = 3;
export const levelFor = (right: number): number => Math.min(LEVELS, 1 + Math.floor(right / PER_LEVEL));

const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)];
const shuffle = <T,>(xs: T[]): T[] => {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};

// ---- Note ---------------------------------------------------------------------------

const NOTE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const NOTE_POOLS: number[][] = [
  [0, 7],                       // C, G
  [0, 4, 7],                    // C, E, G
  [0, 2, 4, 7, 9],              // the pentatonic
  [0, 2, 4, 5, 7, 9, 11],       // every natural note
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
];
const C4 = 60;
const withHome = (pc: number): Sound => ({ kind: 'seq', parts: [{ kind: 'note', midi: C4 }, { kind: 'note', midi: C4 + pc }], gap: 1.1 });

function noteRound(level: number): Round {
  const pool = NOTE_POOLS[level - 1];
  const pc = pick(pool.filter(p => p !== 0 || level > 1));
  const feel = ['home', 'tight', 'a step up', 'dark', 'bright', 'open', 'uneasy', 'strong', 'bittersweet', 'warm', 'bluesy', 'leaning home'];
  return {
    prompt: 'C plays first. Which note comes after it?',
    sound: withHome(pc),
    options: pool.map(p => ({ label: NOTE_NAMES[p], hear: withHome(p) })),
    answer: NOTE_NAMES[pc],
    say: pc === 0 ? 'C again: the same note twice.' : `${NOTE_NAMES[pc]} against C sounds ${feel[pc]}.`,
  };
}

// ---- Chord --------------------------------------------------------------------------

const CHORDS: Record<string, { steps: number[]; say: string }> = {
  Major: { steps: [0, 4, 7], say: 'Major: open and settled.' },
  Minor: { steps: [0, 3, 7], say: 'Minor: the middle note drops a fret, and it darkens.' },
  Diminished: { steps: [0, 3, 6], say: 'Diminished: two small thirds, tight and uneasy.' },
  Augmented: { steps: [0, 4, 8], say: 'Augmented: two big thirds, stretched and floating.' },
  'Major 7': { steps: [0, 4, 7, 11], say: 'Major 7: major with a soft, dreamy top.' },
  'Dominant 7': { steps: [0, 4, 7, 10], say: 'Dominant 7: major with a pull, as if it wants to move.' },
  'Minor 7': { steps: [0, 3, 7, 10], say: 'Minor 7: minor, but mellow rather than sad.' },
};
const CHORD_POOLS = [
  ['Major', 'Minor'],
  ['Major', 'Minor', 'Diminished'],
  ['Major', 'Minor', 'Diminished', 'Augmented'],
  ['Major', 'Minor', 'Major 7', 'Dominant 7'],
  ['Major', 'Minor', 'Diminished', 'Major 7', 'Dominant 7', 'Minor 7'],
];
const chordSound = (root: number, name: string): Sound => ({ kind: 'chord', midis: CHORDS[name].steps.map(s => root + s) });

function chordRound(level: number): Round {
  const pool = CHORD_POOLS[level - 1];
  const name = pick(pool);
  const root = pick([48, 50, 52, 55, 57]);
  return {
    prompt: 'What kind of chord is this?',
    sound: chordSound(root, name),
    options: pool.map(n => ({ label: n, hear: chordSound(root, n) })),
    answer: name,
    say: CHORDS[name].say,
  };
}

// ---- Interval -----------------------------------------------------------------------

const INTERVALS: Record<string, { semis: number; feel: string }> = {
  'Minor 2nd': { semis: 1, feel: 'tight, almost a rub' },
  'Major 2nd': { semis: 2, feel: 'a step, like walking up a scale' },
  'Minor 3rd': { semis: 3, feel: 'close and a little sad' },
  'Major 3rd': { semis: 4, feel: 'close and bright' },
  'Perfect 4th': { semis: 5, feel: 'open, wanting to move on' },
  Tritone: { semis: 6, feel: 'uneasy, hanging in the air' },
  'Perfect 5th': { semis: 7, feel: 'wide and hollow' },
  'Minor 6th': { semis: 8, feel: 'wide and bittersweet' },
  'Major 6th': { semis: 9, feel: 'wide and warm' },
  'Minor 7th': { semis: 10, feel: 'wide and bluesy' },
  'Major 7th': { semis: 11, feel: 'almost an octave, restless' },
  Octave: { semis: 12, feel: 'the same note, higher' },
};
const INTERVAL_POOLS = [
  ['Major 3rd', 'Perfect 5th', 'Octave'],
  ['Major 3rd', 'Perfect 4th', 'Perfect 5th', 'Octave'],
  ['Major 2nd', 'Minor 3rd', 'Major 3rd', 'Perfect 4th', 'Perfect 5th', 'Octave'],
  ['Minor 3rd', 'Major 3rd', 'Perfect 4th', 'Perfect 5th', 'Minor 6th', 'Major 6th', 'Octave'],
  Object.keys(INTERVALS),
];
const gapSound = (root: number, name: string): Sound => ({ kind: 'notes', midis: [root, root + INTERVALS[name].semis], gap: 0.65 });

function intervalRound(level: number): Round {
  const pool = INTERVAL_POOLS[level - 1];
  const name = pick(pool);
  const root = pick([52, 55, 57, 59, 60]);
  const it = INTERVALS[name];
  return {
    prompt: 'How far apart are the two notes?',
    sound: gapSound(root, name),
    options: pool.map(n => ({ label: n, hear: gapSound(root, n) })),
    answer: name,
    say: `${name}: ${it.semis} fret${it.semis > 1 ? 's' : ''}, ${it.feel}.`,
  };
}

// ---- Tempo --------------------------------------------------------------------------

// Each level: how many choices, and how close together they sit.
const TEMPO_LEVELS = [
  { n: 2, step: 60 },
  { n: 3, step: 30 },
  { n: 3, step: 20 },
  { n: 4, step: 15 },
  { n: 4, step: 10 },
];
const clicks = (bpm: number): Sound => ({ kind: 'clicks', bpm, count: 6 });

function tempoRound(level: number): Round {
  const { n, step } = TEMPO_LEVELS[level - 1];
  const lows: number[] = [];
  for (let b = 60; b <= 150 - step * (n - 1); b += 5) lows.push(b);
  const lowest = pick(lows);
  const choices = Array.from({ length: n }, (_, i) => lowest + i * step);
  const bpm = pick(choices);
  return {
    prompt: 'How fast is the click?',
    sound: clicks(bpm),
    options: choices.map(c => ({ label: `${c}`, hear: clicks(c) })),
    answer: `${bpm}`,
    say: bpm === 60 ? '60 is one click a second.' : bpm === 120 ? '120 is two clicks a second.' : `${bpm} beats a minute. For scale: 60 is one click a second, 120 is two.`,
  };
}

export const GAMES: GameDef[] = [
  { id: 'note', name: 'Name the note', blurb: 'C, then a mystery note', mark: '♪', round: noteRound },
  { id: 'chord', name: 'Name the chord', blurb: 'Major, minor, and beyond', mark: '♯', round: chordRound },
  { id: 'interval', name: 'Name the gap', blurb: 'How far apart are two notes', mark: '↕', round: intervalRound },
  { id: 'tempo', name: 'Name the tempo', blurb: 'How fast is the click', mark: '♩', round: tempoRound },
];

export const gameDef = (id: GameId): GameDef => GAMES.find(g => g.id === id)!;

// ---- Bests ----------------------------------------------------------------------------

const BEST_KEY = 'cadenza-game-best';
export function gameBest(id: GameId): number {
  try { return (JSON.parse(localStorage.getItem(BEST_KEY) ?? '{}') as Record<string, number>)[id] ?? 0; } catch { return 0; }
}
export function saveGameBest(id: GameId, score: number): boolean {
  try {
    const all = JSON.parse(localStorage.getItem(BEST_KEY) ?? '{}') as Record<string, number>;
    if ((all[id] ?? 0) >= score) return false;
    all[id] = score;
    localStorage.setItem(BEST_KEY, JSON.stringify(all));
    return true;
  } catch { return false; }
}

// Shuffled options, shown in a steady order for tempo (slow to fast) and notes (C up).
export const ordered = (g: GameId, opts: Round['options']): Round['options'] =>
  g === 'tempo' || g === 'note' || g === 'interval' ? opts : shuffle(opts);
