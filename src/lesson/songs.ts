// One song per unit, opened when the unit's milestone is passed. Each one uses
// what the unit taught and adds one new thing, so the songs climb with you:
//
//   Sound      Ode to Joy        two strings, three frets, even notes
//   Rhythm     Jingle Bells      the same five notes; the rhythm is the work
//   Scales     Joy to the World  a major scale walking down four strings
//   Intervals  Greensleeves      three beats to a bar, minor, wider leaps
//   Harmony    Rising Sun        chords picked one string at a time
//
// All of them are in the public domain. A song is learnt in parts, each one
// waiting for every note, then played through in time with a click. Stars
// come from how many notes land in time on that last take.

import type { Exercise, Lesson } from './lessons';
import type { RiffNote } from './riff';
import { riffMidi } from './riff';

interface SongDef {
  id: string;
  title: string;
  by: string;
  /** What this song adds, said once before the first part. */
  intro: string;
  recap: string;
  bpm: number;
  /** Learnt one at a time, then played together. */
  parts: { name: string; notes: RiffNote[] }[];
}

const n = (st: number, f: number) => (beats: number): RiffNote => [st, f, beats];

// ---- Ode to Joy: B and high E strings, open position ----------------------------
const OC = n(2, 1), OD = n(2, 3), OE = n(1, 0), OF = n(1, 1), OG = n(1, 3);

// ---- Joy to the World: C major, open position -----------------------------------
const JC2 = n(2, 1), JB = n(2, 0), JA = n(3, 2), JG = n(3, 0), JF = n(4, 3), JE = n(4, 2), JD = n(4, 0), JC = n(5, 3);

// ---- Greensleeves: A minor, open position ---------------------------------------
const GA = n(3, 2), GC = n(2, 1), GD = n(2, 3), GE = n(1, 0), GF = n(1, 1), GB = n(2, 0), GG = n(3, 0), GGs = n(3, 1), GE3 = n(4, 2), GFs = n(4, 4);

// ---- House of the Rising Sun: each chord picked bass first, six eighths ---------
const pickBar = (shape: [number, number][]): RiffNote[] => shape.map(([st, f]) => [st, f, 0.5]);
const AM = pickBar([[5, 0], [3, 2], [2, 1], [1, 0], [2, 1], [3, 2]]);
const CM = pickBar([[5, 3], [3, 0], [2, 1], [1, 0], [2, 1], [3, 0]]);
const DM = pickBar([[4, 0], [3, 2], [2, 3], [1, 2], [2, 3], [3, 2]]);
const FM = pickBar([[4, 3], [3, 2], [2, 1], [1, 1], [2, 1], [3, 2]]);
const EM = pickBar([[6, 0], [3, 1], [2, 0], [1, 0], [2, 0], [3, 1]]);

const DEFS: SongDef[] = [
  {
    id: 'song-ode', title: 'Ode to Joy', by: 'Beethoven',
    intro: 'Your first tune. Two strings, three frets, and every note the same length.',
    recap: 'Ode to Joy: two strings, five notes, a steady pulse.',
    bpm: 80,
    parts: [
      { name: 'First line', notes: [OE(1), OE(1), OF(1), OG(1), OG(1), OF(1), OE(1), OD(1), OC(1), OC(1), OD(1), OE(1), OE(1.5), OD(0.5), OD(2)] },
      { name: 'Second line', notes: [OE(1), OE(1), OF(1), OG(1), OG(1), OF(1), OE(1), OD(1), OC(1), OC(1), OD(1), OE(1), OD(1.5), OC(0.5), OC(2)] },
    ],
  },
  {
    id: 'song-jingle', title: 'Jingle Bells', by: 'J. L. Pierpont',
    intro: 'The same five notes as Ode to Joy. What is new is the rhythm: repeated notes, some long, some short. Pick each one again.',
    recap: 'Jingle Bells: the notes are easy, the rhythm carries the tune.',
    bpm: 100,
    parts: [
      { name: 'Jingle bells', notes: [OE(1), OE(1), OE(2), OE(1), OE(1), OE(2), OE(1), OG(1), OC(1.5), OD(0.5), OE(4)] },
      { name: 'Oh what fun', notes: [OF(1), OF(1), OF(1.5), OF(0.5), OF(1), OE(1), OE(1), OE(0.5), OE(0.5), OE(1), OD(1), OD(1), OE(1), OD(2), OG(2)] },
    ],
  },
  {
    id: 'song-joy', title: 'Joy to the World', by: 'Handel, arr. Mason',
    intro: 'The opening is a major scale walking down, one note at a time, across four strings. Then it climbs back up in pairs.',
    recap: 'Joy to the World: a major scale, top to bottom, is already a melody.',
    bpm: 76,
    parts: [
      { name: 'Down the scale', notes: [JC2(2), JB(1.5), JA(0.5), JG(3), JF(1), JE(2), JD(2), JC(3)] },
      { name: 'Back up', notes: [JG(0.5), JA(1.5), JA(0.5), JB(1.5), JB(0.5), JC2(3)] },
    ],
  },
  {
    id: 'song-greensleeves', title: 'Greensleeves', by: 'Traditional',
    intro: 'Three beats to a bar, a minor key, and wider leaps than before. Count 1, 2, 3 and lean on the 1.',
    recap: 'Greensleeves: a minor tune in three, with leaps you can now hear coming.',
    bpm: 96,
    parts: [
      { name: 'First half', notes: [GA(1), GC(2), GD(1), GE(1.5), GF(0.5), GE(1), GD(2), GB(1), GG(1.5), GA(0.5), GB(1), GC(2), GA(1), GA(1.5), GGs(0.5), GA(1), GB(2), GGs(1), GE3(2)] },
      { name: 'Second half', notes: [GA(1), GC(2), GD(1), GE(1.5), GF(0.5), GE(1), GD(2), GB(1), GG(1.5), GA(0.5), GB(1), GC(1.5), GB(0.5), GA(1), GGs(1.5), GFs(0.5), GGs(1), GA(3)] },
    ],
  },
  {
    id: 'song-rising', title: 'House of the Rising Sun', by: 'Traditional',
    intro: 'Each bar is one chord, picked one string at a time: the bass note first, then up and back. Hold the chord shape and let the notes ring.',
    recap: 'Rising Sun: Am, C, D, F, then Am, C, E. Chords you can now pick apart.',
    bpm: 56,
    parts: [
      { name: 'Am, C, D, F', notes: [...AM, ...CM, ...DM, ...FM] },
      { name: 'Am, C, E, E', notes: [...AM, ...CM, ...EM, ...EM] },
    ],
  },
];

const melody = (notes: RiffNote[], bpm: number) => ({ kind: 'melody' as const, notes: notes.map((x): [number, number] => [riffMidi(x), x[2]]), bpm });

function build(d: SongDef): Exercise[] {
  const whole = d.parts.flatMap(p => p.notes);
  return [
    { type: 'teach', title: d.title, body: d.intro, sounds: [{ label: 'Hear it', sound: melody(whole, d.bpm) }] },
    ...d.parts.map((p): Exercise => ({
      type: 'riff', prompt: p.name, detail: 'Each note waits for you. Find it, play it, move on.', notes: p.notes, bpm: d.bpm,
    })),
    {
      type: 'riff', prompt: 'The whole song, in time', time: true, need: 0.6, notes: whole, bpm: d.bpm,
      detail: 'Four clicks to count in, then play along with the click. Stars come from the notes that land.',
    },
  ];
}

export const SONGS: Lesson[] = DEFS.map(d => ({
  id: d.id, title: d.title, recap: d.recap, song: { title: d.title, by: d.by }, build: () => build(d),
}));

/** The song for each unit, in unit order. */
export const UNIT_SONGS: string[] = DEFS.map(d => d.id);
