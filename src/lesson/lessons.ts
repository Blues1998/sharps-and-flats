// The lessons behind the Journey's steps.
//
// Every lesson follows the same arc, the way a good teacher runs ten minutes:
//   1. one idea, said plainly, with the sound of it
//   2. tell it apart by ear, an easy case first
//   3. the same idea in a new context, so it is understood, not memorised
//   4. do it on the instrument, with exact frets, checked by the mic
//   5. a recap line, shown at the end
//
// Exercise kinds:
//   teach   one idea, a few sentences, sounds to hear, optional note chips
//   choose  hear something (or tap sounds) and pick an answer; explain says why
//   play    play notes; the mic checks each pitch class, any octave
//   tap     tap along with a click; taps within the window count
//
// Lessons are built fresh each time, so rounds are shuffled.
//
// Milestone checks sit on the inlay frets. They teach nothing new: they ask
// for what the frets below taught, in a fresh order, once each. Stars come
// from how much was right first time.

import type { Sound } from './sound';

export interface ChooseOption { label: string; sound?: Sound; correct?: boolean }

export type Exercise =
  | { type: 'teach'; title: string; body: string; sounds?: { label: string; sound: Sound }[]; chips?: { name: string; where?: string }[] }
  | { type: 'choose'; prompt: string; sound?: Sound; options: ChooseOption[]; explain: string }
  | { type: 'play'; prompt: string; detail: string; notes: number[]; names: { name: string; where?: string; hidden?: boolean }[]; hear?: Sound; auto?: boolean; tolerance?: number; holdMs?: number; found?: string }
  | { type: 'tap'; prompt: string; detail: string; bpm: number; taps: number; need: number; windowMs: number };

export interface Lesson {
  id: string;
  title: string;
  recap: string;
  build: () => Exercise[];
  /** A milestone check: no teaching, no second tries, scored in stars. */
  check?: boolean;
}

// ---- Helpers ---------------------------------------------------------------------

const NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const pc = (midi: number) => ((midi % 12) + 12) % 12;
const pick = <T,>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)];
const shuffle = <T,>(xs: T[]): T[] => {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};
/** Two sounds to compare, in random order, labelled by position. */
const pair = (word: string, right: Sound, wrong: Sound): ChooseOption[] =>
  shuffle<ChooseOption>([{ label: '', sound: right, correct: true }, { label: '', sound: wrong }]).map((o, i) => ({ ...o, label: `${word} ${i === 0 ? '1' : '2'}` }));

const MAJOR = [0, 2, 4, 5, 7, 9, 11, 12];
const MINOR = [0, 2, 3, 5, 7, 8, 10, 12];
const run = (root: number, steps: number[], gap = 0.32): Sound => ({ kind: 'notes', midis: steps.map(s => root + s), gap });
const triad = (root: number, q: 'maj' | 'min' | 'dim'): number[] =>
  q === 'maj' ? [root, root + 4, root + 7] : q === 'min' ? [root, root + 3, root + 7] : [root, root + 3, root + 6];

/** Notes to play, as pitch classes so any octave counts, with where to find each. */
const playNotes = (notes: [number, string?][]) => ({
  notes: notes.map(([m]) => pc(m)),
  names: notes.map(([m, where]) => ({ name: NAMES[pc(m)], where })),
});

const INTERVAL = {
  M3: { name: 'Major 3rd', semis: 4, hook: '"Oh when the Saints"' },
  P4: { name: 'Perfect 4th', semis: 5, hook: '"Here comes the bride"' },
  P5: { name: 'Perfect 5th', semis: 7, hook: 'the Star Wars theme' },
  P8: { name: 'Octave', semis: 12, hook: '"Some-where over the rainbow"' },
};
type IntervalKey = keyof typeof INTERVAL;

function intervalRound(keys: IntervalKey[]): Exercise {
  const k = pick(keys);
  const root = pick([55, 57, 59, 60, 62]);
  return {
    type: 'choose',
    prompt: 'Which interval is this?',
    sound: { kind: 'notes', midis: [root, root + INTERVAL[k].semis], gap: 0.65 },
    options: keys.map(o => ({ label: INTERVAL[o].name, correct: o === k })),
    explain: `That was a ${INTERVAL[k].name.toLowerCase()}, ${INTERVAL[k].semis} frets apart: the opening of ${INTERVAL[k].hook}.`,
  };
}

function chordRound(qs: ('maj' | 'min' | 'dim')[]): Exercise {
  const q = pick(qs);
  const root = pick([55, 57, 60, 62]);
  const label = { maj: 'Major', min: 'Minor', dim: 'Diminished' };
  return {
    type: 'choose',
    prompt: 'What kind of chord is this?',
    sound: { kind: 'chord', midis: triad(root, q) },
    options: qs.map(o => ({ label: label[o], correct: o === q })),
    explain: q === 'maj'
      ? 'Major: open and settled. Its third is four frets above the root.'
      : q === 'min'
        ? 'Minor: darker. Its third is only three frets above the root.'
        : 'Diminished: tight and unsettled. Both its intervals are small thirds.',
  };
}

// ---- The lessons -----------------------------------------------------------------

export const LESSONS: Lesson[] = [
  {
    id: 'hear-a-note',
    title: 'Hear what a note is made of',
    recap: 'Pitch is how high a note is. Timbre is its colour, made by the overtones ringing above it.',
    build: () => [
      { type: 'teach', title: 'A string rings at many pitches at once',
        body: 'Pluck a string and it vibrates as a whole, giving the note you hear, and in halves, thirds and quarters at the same time. Those quieter, higher pitches are overtones. A pure electronic tone has none.',
        sounds: [{ label: 'Pure tone', sound: { kind: 'sine', midi: 57 } }, { label: 'Guitar', sound: { kind: 'note', midi: 57 } }] },
      { type: 'choose', prompt: 'Tap both. Which one has overtones?',
        options: pair('Sound', { kind: 'note', midi: 60 }, { kind: 'sine', midi: 60 }),
        explain: 'The guitar has a bright edge on top of the note. That edge is its overtones.' },
      { type: 'choose', prompt: 'A pure tone, then the guitar. Same pitch, or different?',
        sound: { kind: 'seq', parts: [{ kind: 'sine', midi: 57 }, { kind: 'note', midi: 57 }], gap: 1.3 },
        options: [{ label: 'Same pitch', correct: true }, { label: 'Different pitch' }],
        explain: 'Same pitch. They only sound different because of the overtones, and that difference has a name: timbre.' },
      { type: 'teach', title: 'Pitch and timbre are separate',
        body: 'Pitch is how high a note is. Timbre is its colour. A guitar and a flute can play the same pitch, and you still know which is which.' },
      ...shuffle([true, false, false]).map((same): Exercise => {
        const a = pick([52, 55, 57, 59]);
        const b = same ? a : a + pick([2, 3, 4]);
        return {
          type: 'choose', prompt: 'A pure tone, then the guitar. Same pitch?',
          sound: { kind: 'seq', parts: [{ kind: 'sine', midi: a }, { kind: 'note', midi: b }], gap: 1.3 },
          options: [{ label: 'Same pitch', correct: same }, { label: 'Different pitch', correct: !same }],
          explain: same ? 'Same pitch, different colour.' : 'The guitar was higher. Listen past the colour to the height.',
        };
      }),
    ],
  },
  {
    id: 'wake-the-tuner',
    title: 'Let the app hear you',
    recap: 'Standard tuning, thickest to thinnest: E A D G B E. The app hears which one you play.',
    build: () => [
      { type: 'teach', title: 'Your phone can hear your guitar',
        body: 'The app listens through the mic and works out which note you are playing. Lessons use it to check you, so allow the mic when your phone asks.' },
      { type: 'play', prompt: 'Pluck any open string', detail: 'Let it ring for a second.', notes: [-1], names: [{ name: 'Any' }] },
      { type: 'teach', title: 'Six strings, six names',
        body: 'From the thickest string to the thinnest: E, A, D, G, B, E. The two E strings are the same note, two octaves apart. To remember the order: Eddie Ate Dynamite, Good Bye Eddie.',
        chips: [{ name: 'E', where: '6th' }, { name: 'A', where: '5th' }, { name: 'D', where: '4th' }, { name: 'G', where: '3rd' }, { name: 'B', where: '2nd' }, { name: 'E', where: '1st' }],
        sounds: [{ label: 'All six', sound: { kind: 'notes', midis: [40, 45, 50, 55, 59, 64], gap: 0.5 } }] },
      { type: 'choose', prompt: 'Which string is the A?',
        options: shuffle<ChooseOption>([{ label: 'Second thickest', correct: true }, { label: 'Thickest' }, { label: 'Thinnest' }]),
        explain: 'A is the 5th string, just above the thick low E.' },
      { type: 'play', prompt: 'Play the open A string', detail: 'Second thickest, nothing pressed.', ...playNotes([[45, 'open 5th']]), hear: { kind: 'note', midi: 45 } },
      { type: 'play', prompt: 'Now the open G string', detail: 'Third from the thin side.', ...playNotes([[55, 'open 3rd']]), hear: { kind: 'note', midi: 55 } },
    ],
  },
  {
    id: 'first-match',
    title: 'Match your first pitch',
    recap: 'A fret is 100 cents. In tune means within about ten of the target.',
    build: () => [
      { type: 'teach', title: 'In tune is a narrow target',
        body: 'Each fret is split into 100 cents. Get within about ten cents of a note and it sounds right. Further off, and two notes start to wobble against each other.',
        sounds: [{ label: 'In tune', sound: { kind: 'pair', a: 57, b: 69 } }, { label: '30 cents off', sound: { kind: 'pair', a: 57, b: 69, detune: 30 } }] },
      { type: 'choose', prompt: 'Tap both. Which pair is in tune?',
        options: pair('Pair', { kind: 'pair', a: 57, b: 69 }, { kind: 'pair', a: 57, b: 69, detune: 25 }),
        explain: 'In tune, the two notes melt into one. Out of tune, you hear a slow wobble.' },
      { type: 'choose', prompt: 'And these? Which is in tune?',
        options: pair('Pair', { kind: 'pair', a: 52, b: 64 }, { kind: 'pair', a: 52, b: 64, detune: -15 }),
        explain: 'A smaller miss makes a slower wobble. Listen for the one that stays still.' },
      { type: 'play', prompt: 'Play an A and hold it in tune', detail: 'Open 5th string, or the 5th fret of the low E. Pluck firmly and let it ring.', ...playNotes([[57, 'open 5th']]), tolerance: 15, holdMs: 900, hear: { kind: 'note', midi: 45 } },
      { type: 'play', prompt: 'Now an E, held in tune', detail: 'Either open E string.', ...playNotes([[64, 'open 1st or 6th']]), tolerance: 15, holdMs: 900, hear: { kind: 'note', midi: 52 } },
    ],
  },
  {
    id: 'steady-hands',
    title: 'Lock into the beat',
    recap: 'Count in, listen ahead, and play with the click rather than after it.',
    build: () => [
      { type: 'teach', title: 'Time before notes',
        body: 'A steady beat is what makes playing sound like music. Listeners forgive a wrong note long before they forgive rushed or dragging time.',
        sounds: [{ label: 'Steady at 80', sound: { kind: 'clicks', bpm: 80, count: 8 } }] },
      { type: 'choose', prompt: 'Tap both. Which beat is steady?',
        options: pair('Beat', { kind: 'clicks', bpm: 90, count: 8 }, { kind: 'clicks', bpm: 90, count: 8, wobble: true }),
        explain: 'The steady one keeps exactly the same gap between clicks.' },
      { type: 'teach', title: 'Count in, then tap with it',
        body: 'Musicians count four clicks before playing: 1, 2, 3, 4. Use them to feel the gap, then tap as the click sounds, not when you hear it. Early is better than late.' },
      { type: 'tap', prompt: 'Tap along at 70', detail: 'Four clicks to count in, then tap on each one.', bpm: 70, taps: 8, need: 6, windowMs: 70 },
      { type: 'tap', prompt: 'Now at 90', detail: 'Same again, a little quicker. Keep your hand loose.', bpm: 90, taps: 8, need: 6, windowMs: 60 },
    ],
  },
  {
    id: 'happy-vs-sad',
    title: 'Hear happy vs sad',
    recap: 'Major and minor share a home note. Minor lowers the 3rd, 6th and 7th, and the 3rd matters most.',
    build: () => [
      { type: 'teach', title: 'A scale is a family of notes',
        body: 'Most songs use seven notes that belong together, called a scale. The major scale sounds bright and settled.',
        sounds: [{ label: 'C major', sound: run(60, MAJOR) }] },
      { type: 'teach', title: 'Minor lowers three notes',
        body: 'Take the major scale and lower its 3rd, 6th and 7th notes by one fret. That is the natural minor: same home note, darker mood.',
        sounds: [{ label: 'C major', sound: run(60, MAJOR) }, { label: 'C minor', sound: run(60, MINOR) }] },
      ...shuffle([true, false]).map((major): Exercise => ({
        type: 'choose', prompt: 'Major or minor?',
        sound: run(pick([55, 57, 60]), major ? MAJOR : MINOR),
        options: [{ label: 'Major, bright', correct: major }, { label: 'Minor, dark', correct: !major }],
        explain: major ? 'Major: listen to the third note, a big step up from home.' : 'Minor: the third note sits low, only three frets above home.',
      })),
      { type: 'teach', title: 'The 3rd does most of the work',
        body: 'Play just the home note and the 3rd. Four frets apart sounds major. Three frets apart sounds minor. You can hear the mood in two notes.',
        sounds: [{ label: 'C to E', sound: { kind: 'notes', midis: [60, 64], gap: 0.6 } }, { label: 'C to E♭', sound: { kind: 'notes', midis: [60, 63], gap: 0.6 } }] },
      ...shuffle([true, false, true]).map((major): Exercise => {
        const root = pick([55, 57, 60, 62]);
        return {
          type: 'choose', prompt: 'Just two notes. Major or minor?',
          sound: { kind: 'notes', midis: [root, root + (major ? 4 : 3)], gap: 0.6 },
          options: [{ label: 'Major 3rd', correct: major }, { label: 'Minor 3rd', correct: !major }],
          explain: major ? 'Four frets apart: a major 3rd.' : 'Three frets apart: a minor 3rd.',
        };
      }),
    ],
  },
  {
    id: 'first-climb',
    title: 'Climb a scale on your guitar',
    recap: 'C major in open position: A3, open D, D2, D3, open G, G2, open B, B1.',
    build: () => [
      { type: 'teach', title: 'C major in open position',
        body: 'C major has no sharps or flats. Near the nut, it climbs across three strings. The fret numbers show where to press.',
        chips: [{ name: 'C', where: 'A 3' }, { name: 'D', where: 'D 0' }, { name: 'E', where: 'D 2' }, { name: 'F', where: 'D 3' }, { name: 'G', where: 'G 0' }, { name: 'A', where: 'G 2' }, { name: 'B', where: 'B 0' }, { name: 'C', where: 'B 1' }],
        sounds: [{ label: 'Hear it', sound: run(48, MAJOR, 0.45) }] },
      { type: 'choose', prompt: 'Where is the first C?',
        options: shuffle<ChooseOption>([{ label: '3rd fret, A string', correct: true }, { label: 'Open A string' }, { label: '3rd fret, low E string' }]),
        explain: 'Three frets up the A string: A, B♭, B, C.' },
      { type: 'play', prompt: 'The first four notes', detail: 'C D E F. Slowly is fine.', ...playNotes([[48, 'A 3'], [50, 'D 0'], [52, 'D 2'], [53, 'D 3']]), hear: run(48, [0, 2, 4, 5], 0.55) },
      { type: 'play', prompt: 'Now the whole climb', detail: 'All eight, low to high.', ...playNotes([[48, 'A 3'], [50, 'D 0'], [52, 'D 2'], [53, 'D 3'], [55, 'G 0'], [57, 'G 2'], [59, 'B 0'], [60, 'B 1']]), hear: run(48, MAJOR, 0.5) },
    ],
  },
  {
    id: 'pentatonic',
    title: 'The five-note shortcut',
    recap: 'A minor pentatonic at the 5th fret: two notes per string, frets 5 and 8, then 5 and 7.',
    build: () => [
      { type: 'teach', title: 'Five notes that never clash',
        body: 'Drop the 2nd and 6th notes from the minor scale and you get the minor pentatonic. With nothing in it that clashes, it is the sound of most rock and blues solos.',
        chips: [{ name: 'A' }, { name: 'C' }, { name: 'D' }, { name: 'E' }, { name: 'G' }],
        sounds: [{ label: 'A minor pentatonic', sound: { kind: 'notes', midis: [57, 60, 62, 64, 67, 69], gap: 0.36 } }] },
      { type: 'choose', prompt: 'How many different notes are in it?',
        options: shuffle<ChooseOption>([{ label: 'Five', correct: true }, { label: 'Six' }, { label: 'Seven' }]),
        explain: 'Penta means five. The A at the top is the bottom A again, an octave higher.' },
      { type: 'choose', prompt: 'Tap both. Which is the pentatonic?',
        options: pair('Run', { kind: 'notes', midis: [57, 60, 62, 64, 67, 69], gap: 0.32 }, run(57, MINOR, 0.32)),
        explain: 'The pentatonic has gaps. It skips the notes that make the full minor scale sound fussy.' },
      { type: 'play', prompt: 'Play A minor pentatonic', detail: 'Start at the 5th fret of the low E string. Two notes per string.', ...playNotes([[45, 'E 5'], [48, 'E 8'], [50, 'A 5'], [52, 'A 7'], [55, 'D 5'], [57, 'D 7']]), hear: { kind: 'notes', midis: [45, 48, 50, 52, 55, 57], gap: 0.5 } },
    ],
  },
  {
    id: 'interval-songs',
    title: 'Every interval has a song',
    recap: 'Hook intervals to songs: Saints for a major 3rd, Star Wars for a 5th, Over the Rainbow for an octave.',
    build: () => [
      { type: 'teach', title: 'An interval is the gap between two notes',
        body: 'Every gap has its own sound. The quickest way to learn them is to hang each one on a song you already know.',
        sounds: [
          { label: 'Major 3rd', sound: { kind: 'notes', midis: [60, 64], gap: 0.6 } },
          { label: 'Perfect 5th', sound: { kind: 'notes', midis: [60, 67], gap: 0.6 } },
          { label: 'Octave', sound: { kind: 'notes', midis: [60, 72], gap: 0.6 } },
        ] },
      { type: 'teach', title: 'Three songs, three gaps',
        body: 'Sing the first two notes in your head. "Oh when the Saints" is a major 3rd. The Star Wars theme is a perfect 5th. "Some-where over the rainbow" is an octave.' },
      { type: 'choose', prompt: 'Which gap is bigger?',
        options: pair('Gap', { kind: 'notes', midis: [60, 67], gap: 0.6 }, { kind: 'notes', midis: [60, 64], gap: 0.6 }),
        explain: 'The 5th is seven frets wide. The 3rd is four.' },
      intervalRound(['M3', 'P5', 'P8']), intervalRound(['M3', 'P5', 'P8']), intervalRound(['M3', 'P5', 'P8']), intervalRound(['M3', 'P5', 'P8']),
    ],
  },
  {
    id: 'interval-hunt',
    title: 'Find intervals by hand',
    recap: 'One fret is one semitone: a major 3rd is 4 frets, a perfect 5th is 7.',
    build: () => [
      { type: 'teach', title: 'Frets are a ruler for intervals',
        body: 'Each fret raises a note by one semitone. So on a single string, a major 3rd is four frets up and a perfect 5th is seven.' },
      { type: 'choose', prompt: 'How many frets up is a perfect 5th?',
        options: shuffle<ChooseOption>([{ label: 'Seven', correct: true }, { label: 'Five' }, { label: 'Four' }]),
        explain: 'Seven semitones. The name says 5th because it is the 5th note of the scale, not five frets.' },
      { type: 'choose', prompt: 'You start on the open A string. Where is the major 3rd above it?',
        options: shuffle<ChooseOption>([{ label: '4th fret, same string', correct: true }, { label: '3rd fret, same string' }, { label: '5th fret, same string' }]),
        explain: 'Four frets up from A is C♯, a major 3rd.' },
      { type: 'play', prompt: 'A, then the 5th above it', detail: 'Open A string, then the 7th fret on the same string.', ...playNotes([[45, 'A 0'], [52, 'A 7']]), hear: { kind: 'notes', midis: [45, 52], gap: 0.6 } },
      { type: 'play', prompt: 'C, then the major 3rd above it', detail: '3rd fret of the A string, then the 7th fret.', ...playNotes([[48, 'A 3'], [52, 'A 7']]), hear: { kind: 'notes', midis: [48, 52], gap: 0.6 } },
    ],
  },
  {
    id: 'chord-flavors',
    title: 'Chord flavours',
    recap: 'Major sounds settled, minor darker, diminished tense. The third makes most of the difference.',
    build: () => [
      { type: 'teach', title: 'Three notes, three moods',
        body: 'A chord is three or more notes at once. Move just one of them and the mood changes. Listen to C major, then C minor, then C diminished.',
        sounds: [
          { label: 'Major', sound: { kind: 'chord', midis: triad(60, 'maj') } },
          { label: 'Minor', sound: { kind: 'chord', midis: triad(60, 'min') } },
          { label: 'Diminished', sound: { kind: 'chord', midis: triad(60, 'dim') } },
        ] },
      chordRound(['maj', 'min']), chordRound(['maj', 'min']), chordRound(['maj', 'min']),
      { type: 'teach', title: 'Diminished wants to move',
        body: 'Diminished lowers the top note too. Nothing in it is at rest, so in songs it usually leads straight into another chord.' },
      chordRound(['maj', 'min', 'dim']), chordRound(['maj', 'min', 'dim']),
    ],
  },
  {
    id: 'build-chords',
    title: 'Build a chord',
    recap: 'A triad is root, third and fifth. C major is C E G; A minor is A C E.',
    build: () => [
      { type: 'teach', title: 'Root, third, fifth',
        body: 'A basic chord, a triad, stacks three notes: the root, the third above it and the fifth. C major is C, E and G. Played one at a time, it is called an arpeggio.',
        chips: [{ name: 'C', where: 'A 3' }, { name: 'E', where: 'D 2' }, { name: 'G', where: 'G 0' }],
        sounds: [{ label: 'One at a time', sound: { kind: 'notes', midis: [48, 52, 55], gap: 0.5 } }, { label: 'Together', sound: { kind: 'chord', midis: [48, 52, 55] } }] },
      { type: 'play', prompt: 'Play C, E and G', detail: 'One at a time, from the frets shown.', ...playNotes([[48, 'A 3'], [52, 'D 2'], [55, 'G 0']]), hear: { kind: 'notes', midis: [48, 52, 55], gap: 0.5 } },
      { type: 'choose', prompt: 'Which three notes make A minor?',
        options: shuffle<ChooseOption>([{ label: 'A C E', correct: true }, { label: 'A C♯ E' }, { label: 'A D E' }]),
        explain: 'Minor uses the small third: A to C is three frets. C♯ would make it major.' },
      { type: 'play', prompt: 'Play A, C and E', detail: 'Open A, 1st fret of the B string, open high E.', ...playNotes([[45, 'A 0'], [48, 'B 1'], [52, 'E 0']]), hear: { kind: 'notes', midis: [45, 48, 52], gap: 0.5 } },
    ],
  },
  {
    id: 'why-chords-work',
    title: 'Why chords work',
    recap: 'Notes blend when their frequencies form simple ratios: 2 to 1 for an octave, 3 to 2 for a fifth.',
    build: () => [
      { type: 'teach', title: 'Simple ratios blend',
        body: 'An octave vibrates exactly twice as fast as its root, 2 to 1. A fifth makes three waves for every two, 3 to 2. Their waves line up often, so the notes melt together.',
        sounds: [{ label: 'Octave, 2 to 1', sound: { kind: 'pair', a: 57, b: 69 } }, { label: 'Fifth, 3 to 2', sound: { kind: 'pair', a: 57, b: 64, detune: 2 } }] },
      { type: 'teach', title: 'Slightly off makes a wobble',
        body: 'Nudge one note off and the waves drift in and out of line. You hear it as a pulsing in the volume, called beating. Tuners and good ears listen for it.',
        sounds: [{ label: 'Beating', sound: { kind: 'pair', a: 57, b: 69, detune: 25 } }] },
      ...[22, 14, 9].map((d): Exercise => ({
        type: 'choose', prompt: 'Tap both. Which pair is beating?',
        options: pair('Pair', { kind: 'pair', a: 57, b: 69, detune: d }, { kind: 'pair', a: 57, b: 69 }),
        explain: d > 15 ? 'A clear wobble: about a fifth of a fret off.' : 'A slow wobble. The closer to in tune, the slower it beats.',
      })),
    ],
  },
  {
    id: 'meet-the-circle',
    title: 'The circle of fifths',
    recap: 'Going up a fifth moves one step round the circle and adds one sharp. Neighbours share six of seven notes.',
    build: () => [
      { type: 'teach', title: 'Keys sit on a circle',
        body: 'Go up a fifth from C and you reach G. From G, D. Each step adds one sharp to the key. Keep going and you pass through all twelve keys.',
        chips: [{ name: 'C', where: '0♯' }, { name: 'G', where: '1♯' }, { name: 'D', where: '2♯' }, { name: 'A', where: '3♯' }, { name: 'E', where: '4♯' }],
        sounds: [{ label: 'C, G, D', sound: { kind: 'chords', chords: [triad(48, 'maj'), triad(55, 'maj'), triad(50, 'maj')] } }] },
      { type: 'choose', prompt: 'Which key comes after C on the circle?',
        options: shuffle<ChooseOption>([{ label: 'G', correct: true }, { label: 'D' }, { label: 'F' }]), explain: 'G is a fifth above C.' },
      { type: 'choose', prompt: 'How many sharps does D major have?',
        options: shuffle<ChooseOption>([{ label: 'Two', correct: true }, { label: 'One' }, { label: 'Three' }]), explain: 'C has none, G adds one, D adds a second: F♯ and C♯.' },
      { type: 'choose', prompt: 'Which key shares the most notes with C?',
        options: shuffle<ChooseOption>([{ label: 'G', correct: true }, { label: 'E' }, { label: 'B♭' }]), explain: 'Neighbours on the circle differ by one note. G only swaps F for F♯.' },
    ],
  },
  {
    id: 'chords-that-belong',
    title: 'Chords in a key',
    recap: 'A major key owns seven chords: major on I, IV, V; minor on ii, iii, vi; diminished on vii.',
    build: () => [
      { type: 'teach', title: 'A key owns seven chords',
        body: 'Build a triad on each note of a scale, using only that scale\'s notes, and you get the key\'s chords. In C: C, Dm, Em, F, G, Am and B°. Most songs stay inside them.',
        chips: [{ name: 'C' }, { name: 'Dm' }, { name: 'Em' }, { name: 'F' }, { name: 'G' }, { name: 'Am' }, { name: 'B°' }],
        sounds: [{ label: 'C, G, Am, F', sound: { kind: 'chords', chords: [triad(48, 'maj'), triad(55, 'maj'), triad(57, 'min'), triad(53, 'maj')] } }] },
      { type: 'choose', prompt: 'Which chord is not in the key of C?',
        options: shuffle<ChooseOption>([{ label: 'E major', correct: true }, { label: 'A minor' }, { label: 'F major' }]),
        explain: 'E major needs G♯, which C does not have. E minor is the one that belongs.' },
      { type: 'teach', title: 'Home has a pull',
        body: 'The chord built on the first note is home. Chords like F and G lead back to it, which is why endings feel finished.' },
      { type: 'choose', prompt: 'Tap both. Which one lands home?',
        options: pair('Ending', { kind: 'chords', chords: [triad(53, 'maj'), triad(55, 'maj'), triad(48, 'maj')] }, { kind: 'chords', chords: [triad(53, 'maj'), triad(55, 'maj'), triad(57, 'min')] }),
        explain: 'F, G, then C lands home. Ending on A minor sounds like a twist.' },
      { type: 'choose', prompt: 'Which chord is not in the key of G?',
        options: shuffle<ChooseOption>([{ label: 'F major', correct: true }, { label: 'C major' }, { label: 'E minor' }]),
        explain: 'G major has F♯, so a chord built on plain F is outside it.' },
    ],
  },
  {
    id: 'walk-the-circle',
    title: 'Walk the circle',
    recap: 'Up a fifth twelve times visits every note once and lands home. On the neck, a fifth is 7 frets.',
    build: () => [
      { type: 'teach', title: 'Seven frets at a time',
        body: 'A fifth is seven semitones. Step up a fifth again and again and you land on every one of the twelve notes once before you are back where you started.',
        sounds: [{ label: 'C G D A E B', sound: { kind: 'notes', midis: [48, 55, 50, 57, 52, 59], gap: 0.45 } }] },
      ...shuffle([['C', 'G'], ['G', 'D'], ['D', 'A'], ['A', 'E'], ['F', 'C']] as [string, string][]).slice(0, 4).map(([from, to]): Exercise => ({
        type: 'choose', prompt: `A fifth above ${from} is…`,
        options: shuffle<ChooseOption>([to, ...shuffle(['F', 'B♭', 'C', 'B', 'G', 'D', 'A', 'E'].filter(n => n !== to && n !== from)).slice(0, 2)].map(n => ({ label: n, correct: n === to }))),
        explain: `Count seven semitones up from ${from} and you land on ${to}.`,
      })),
      { type: 'choose', prompt: 'How many fifths until you are back on C?',
        options: shuffle<ChooseOption>([{ label: 'Twelve', correct: true }, { label: 'Seven' }, { label: 'Eight' }]),
        explain: 'Twelve fifths visit all twelve notes once, then you are home.' },
    ],
  },
];


// ---- Milestone checks -------------------------------------------------------------

const OPEN = [
  { midi: 40, name: 'E', where: 'thickest' },
  { midi: 45, name: 'A', where: '5th string' },
  { midi: 50, name: 'D', where: '4th string' },
  { midi: 55, name: 'G', where: '3rd string' },
  { midi: 59, name: 'B', where: '2nd string' },
  { midi: 64, name: 'E', where: 'thinnest' },
];

/** The app plays one note; you find it. Its name stays hidden until you do. */
const findIt = (midi: number, prompt: string, detail: string, found?: string): Exercise => ({
  type: 'play', prompt, detail, notes: [pc(midi)],
  names: [{ name: NAMES[pc(midi)], hidden: true }],
  hear: { kind: 'note', midi }, auto: true, found,
});

export const CHECKS: Lesson[] = [
  {
    id: 'check-3',
    title: 'Find it by ear',
    check: true,
    recap: 'You can tell high from low, hear when two notes agree, and find a string by its sound.',
    build: () => {
      const strings = shuffle(OPEN).slice(0, 4);
      const lo = pick([45, 47, 50]);
      return [
        { type: 'choose', prompt: 'Tap both. Which note is higher?',
          options: pair('Note', { kind: 'note', midi: lo + pick([3, 5, 7]) }, { kind: 'note', midi: lo }),
          explain: 'Higher means faster vibration. Listen for which one sits up top.' },
        { type: 'choose', prompt: 'Tap both. Which pair is in tune?',
          options: pair('Pair', { kind: 'pair', a: 57, b: 69 }, { kind: 'pair', a: 57, b: 69, detune: pick([20, -20, 30]) }),
          explain: 'In tune, the two notes melt into one. Out of tune, they wobble.' },
        ...strings.map((o, i) => findIt(o.midi,
          i === 0 ? 'Which open string is this?' : 'And this one?',
          'Listen, then pluck the open string you think it is. Play it again as often as you like.',
          `That was ${o.name}, the ${o.where === 'thickest' || o.where === 'thinnest' ? `${o.where} string` : o.where}.`)),
        { type: 'choose', prompt: 'Which string is the G?',
          options: shuffle<ChooseOption>([{ label: '3rd from the thin side', correct: true }, { label: '2nd from the thin side' }, { label: '4th from the thin side' }]),
          explain: 'E A D G B E, thickest to thinnest: G is the 3rd string from the thin side.' },
      ];
    },
  },
  {
    id: 'check-5',
    title: 'Hold the tempo',
    check: true,
    recap: 'Your beat holds at slow, middle and quick tempos, and you can hear one that drifts.',
    build: () => [
      { type: 'choose', prompt: 'Tap both. Which beat is steady?',
        options: pair('Beat', { kind: 'clicks', bpm: 90, count: 8 }, { kind: 'clicks', bpm: 90, count: 8, wobble: true }),
        explain: 'A steady beat leaves the same gap every time. The other one rushes and drags.' },
      { type: 'tap', prompt: 'Hold 80', detail: 'Four clicks to count in, then tap on each one.', bpm: 80, taps: 12, need: 9, windowMs: 65 },
      { type: 'tap', prompt: 'Now slow: 60', detail: 'Slow is harder than it sounds. Count the gap, do not rush it.', bpm: 60, taps: 8, need: 6, windowMs: 75 },
      { type: 'choose', prompt: 'Tap both. Which is faster?',
        options: pair('Tempo', { kind: 'clicks', bpm: 112, count: 6 }, { kind: 'clicks', bpm: 96, count: 6 }),
        explain: 'More beats per minute means less space between clicks.' },
      { type: 'tap', prompt: 'And quick: 104', detail: 'Keep your hand loose and let the click lead.', bpm: 104, taps: 12, need: 9, windowMs: 55 },
    ],
  },
  {
    id: 'check-7',
    title: 'Scales by heart',
    check: true,
    recap: 'You know the major scale and the minor pentatonic by heart, and you can hear which mood a scale has.',
    build: () => {
      const root = pick([55, 57, 60]);
      const major = Math.random() < 0.5;
      return [
        { type: 'choose', prompt: 'Is this scale major or minor?', sound: run(root, major ? MAJOR : MINOR),
          options: [{ label: 'Major', correct: major }, { label: 'Minor', correct: !major }],
          explain: major ? 'Major: the third note sits high, so it sounds bright.' : 'Minor: the third note sits a fret lower, so it sounds darker.' },
        { type: 'play', prompt: 'C major, from memory', detail: 'The climb from the 3rd fret of the A string, all eight notes. No fret numbers this time.',
          notes: [0, 2, 4, 5, 7, 9, 11, 0], names: ['C', 'D', 'E', 'F', 'G', 'A', 'B', 'C'].map(name => ({ name })) },
        { type: 'choose', prompt: 'Which note turns a major scale minor?',
          options: shuffle<ChooseOption>([{ label: 'The 3rd', correct: true }, { label: 'The 5th' }, { label: 'The root' }]),
          explain: 'Lower the 3rd by one fret and the whole scale turns minor.' },
        { type: 'play', prompt: 'A minor pentatonic, from memory', detail: 'The box at the 5th fret, low to high.',
          notes: [9, 0, 2, 4, 7, 9], names: ['A', 'C', 'D', 'E', 'G', 'A'].map(name => ({ name })) },
        { type: 'tap', prompt: 'Keep the beat at 84', detail: 'A scale in time needs a steady hand. Count in, then tap.', bpm: 84, taps: 8, need: 6, windowMs: 65 },
      ];
    },
  },
  {
    id: 'check-9',
    title: 'Hear it, play it',
    check: true,
    recap: 'You can name an interval by ear and find it on the neck.',
    build: () => {
      const back = shuffle<{ root: number; where: string; k: IntervalKey }>([
        { root: 45, where: 'open 5th', k: 'P5' },
        { root: 45, where: 'open 5th', k: 'P4' },
        { root: 50, where: 'open 4th', k: 'P5' },
        { root: 40, where: 'open 6th', k: 'P4' },
        { root: 45, where: 'open 5th', k: 'M3' },
      ]).slice(0, 3);
      return [
        intervalRound(['M3', 'P4', 'P5', 'P8']),
        ...back.map(({ root, where, k }): Exercise => ({
          type: 'play', prompt: 'Play what you hear',
          detail: `It starts on ${NAMES[pc(root)]}, ${where}. Find the second note by ear.`,
          notes: [pc(root), pc(root + INTERVAL[k].semis)],
          names: [{ name: NAMES[pc(root)], where }, { name: NAMES[pc(root + INTERVAL[k].semis)], hidden: true }],
          hear: { kind: 'notes', midis: [root, root + INTERVAL[k].semis], gap: 0.7 }, auto: true,
          found: `${NAMES[pc(root)]} up to ${NAMES[pc(root + INTERVAL[k].semis)]}: a ${INTERVAL[k].name.toLowerCase()}, ${INTERVAL[k].semis} frets.`,
        })),
        intervalRound(['M3', 'P4', 'P5', 'P8']),
        { type: 'choose', prompt: 'How many frets up is a perfect 5th?',
          options: shuffle<ChooseOption>([{ label: '7', correct: true }, { label: '5' }, { label: '4' }]),
          explain: 'A perfect 5th is 7 frets. A 4th is 5, a major 3rd is 4.' },
        intervalRound(['M3', 'P4', 'P5', 'P8']),
      ];
    },
  },
  {
    id: 'check-12',
    title: 'The octave check',
    check: true,
    recap: 'Ear, beat, scale, chord and key: the whole first octave, in one go.',
    build: () => [
      intervalRound(['M3', 'P4', 'P5', 'P8']),
      chordRound(['maj', 'min']),
      { type: 'tap', prompt: 'Hold 92', detail: 'Count in, then tap on each click.', bpm: 92, taps: 8, need: 6, windowMs: 60 },
      { type: 'play', prompt: 'G major scale, one octave', detail: 'Start on the 3rd fret of the low E string. Seven notes and back to G.',
        notes: [7, 9, 11, 0, 2, 4, 6, 7], names: ['G', 'A', 'B', 'C', 'D', 'E', 'F♯', 'G'].map(name => ({ name })) },
      { type: 'play', prompt: 'Build A minor', detail: 'Its three notes, one at a time: root, third, fifth.',
        notes: [9, 0, 4], names: [{ name: 'A', hidden: true }, { name: 'C', hidden: true }, { name: 'E', hidden: true }] },
      { type: 'choose', prompt: 'Which chord belongs in the key of D?',
        options: shuffle<ChooseOption>([{ label: 'G major', correct: true }, { label: 'F major' }, { label: 'C major' }]),
        explain: 'D major has F♯ and C♯. G major (G B D) fits; F and C do not.' },
      { type: 'choose', prompt: 'On the circle of fifths, what comes after G?',
        options: shuffle<ChooseOption>([{ label: 'D', correct: true }, { label: 'C' }, { label: 'A' }]),
        explain: 'Each step is a 5th up: C, G, D, A, E and on round.' },
    ],
  },
];

export const lessonFor = (id: string): Lesson | undefined => LESSONS.find(l => l.id === id) ?? CHECKS.find(l => l.id === id);
