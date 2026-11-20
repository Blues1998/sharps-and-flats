// The sounds a lesson plays: guitar notes and chords from the app's engine,
// pure tones for showing what a note is made of, and metronome clicks.

import { audio } from '../utils/audio';
import { midiToFreq } from '../utils/musicTheory';

export type Sound =
  | { kind: 'note'; midi: number }
  | { kind: 'notes'; midis: number[]; gap?: number }
  | { kind: 'chord'; midis: number[] }
  | { kind: 'chords'; chords: number[][]; gap?: number }
  | { kind: 'sine'; midi: number }
  | { kind: 'pair'; a: number; b: number; detune?: number }
  | { kind: 'clicks'; bpm: number; count: number; wobble?: boolean }
  | { kind: 'seq'; parts: Sound[]; gap: number }
  /** A tune with its rhythm: [midi, beats] pairs at a tempo. */
  | { kind: 'melody'; notes: [number, number][]; bpm: number };

const now = () => {
  audio.init();
  return audio.getCurrentTime() + 0.05;
};

/** A pure tone: one frequency, no overtones. */
function sine(freq: number, at: number, dur: number, gain = 0.16): void {
  const bus = audio.getMasterBus();
  if (!bus) return;
  const { ctx, input } = bus;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, at);
  g.gain.linearRampToValueAtTime(gain, at + 0.03);
  g.gain.setValueAtTime(gain, at + dur - 0.15);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(g).connect(input);
  osc.start(at);
  osc.stop(at + dur + 0.05);
}

/** Seconds the sound lasts, so a lesson knows when it has finished. */
export function soundLength(s: Sound): number {
  switch (s.kind) {
    // As long as schedule() lets each one ring (a note is played for 2 s, a strum 2.4 s).
    case 'note': return 2;
    case 'chord': return 2.4;
    case 'sine': return 1.6;
    case 'pair': return 2.4;
    case 'notes': return s.midis.length * (s.gap ?? 0.45) + 1;
    case 'chords': return s.chords.length * (s.gap ?? 1.1) + 1;
    case 'clicks': return s.count * (60 / s.bpm) + 0.3;
    case 'seq': return (s.parts.length - 1) * s.gap + Math.max(...s.parts.map(soundLength));
    case 'melody': return s.notes.reduce((t, [, b]) => t + b, 0) * (60 / s.bpm) + 1;
  }
}

// When the lesson itself is making sound. The mic must not count the phone's
// own speaker as the player, so listening pauses until this time has passed,
// with room for the note to ring out and the room to go quiet.
// Room for the ring-out, the speaker's own delay (Android can lag 200 ms or
// more) and the room going quiet.
const TAIL_MS = 900;
let soundingUntil = 0;
/** Mark the app as sounding for the next `ms` milliseconds. */
export function hush(ms: number): void {
  soundingUntil = Math.max(soundingUntil, performance.now() + ms + TAIL_MS);
}
/** True while a sound the app played could still reach the mic. */
export const appSounding = (): boolean => performance.now() < soundingUntil;
/**
 * When the app last stopped sounding (performance.now ms). A note only counts
 * if it was plucked after this: the app's own note fading out never starts a
 * new pluck, so it can never answer for you, however long it rings.
 */
export const appSoundEnd = (): number => soundingUntil;

/** Play a sound; returns a function that stops it, notes still to come included. */
export function playSound(s: Sound): () => void {
  hush(soundLength(s) * 1000);
  const stop = audio.playStoppable(() => schedule(s, 0));
  return () => {
    stop();
    // The mic may listen again once the room is quiet.
    soundingUntil = Math.min(soundingUntil, performance.now() + TAIL_MS);
  };
}

function schedule(s: Sound, offset: number): void {
  const t = now() + offset;
  switch (s.kind) {
    case 'note': audio.playMidi(s.midi, 2, t); break;
    case 'chord': audio.playStrum(s.midis, 2.4, 0.04, t); break;
    case 'notes': s.midis.forEach((m, i) => audio.playMidi(m, 1.2, t + i * (s.gap ?? 0.45))); break;
    case 'chords': s.chords.forEach((c, i) => audio.playStrum(c, 1.4, 0.035, t + i * (s.gap ?? 1.1))); break;
    case 'sine': sine(midiToFreq(s.midi), t, 1.6); break;
    case 'pair': {
      sine(midiToFreq(s.a), t, 2.4, 0.12);
      sine(midiToFreq(s.b) * Math.pow(2, (s.detune ?? 0) / 1200), t, 2.4, 0.12);
      break;
    }
    case 'seq': s.parts.forEach((p, i) => schedule(p, offset + i * s.gap)); break;
    case 'melody': {
      const beat = 60 / s.bpm;
      let at = t;
      for (const [m, b] of s.notes) { audio.playMidi(m, Math.min(2, b * beat + 0.3), at); at += b * beat; }
      break;
    }
    case 'clicks': {
      const beat = 60 / s.bpm;
      // A wobbly beat drifts early and late, the way a rushed hand does.
      const drift = [0, 0.07, -0.05, 0.09, -0.08, 0.04, -0.07, 0.06];
      for (let i = 0; i < s.count; i++) audio.playClick(t + i * beat + (s.wobble ? drift[i % drift.length] : 0), i % 4 === 0);
      break;
    }
  }
}

/** Start a click track; returns the time of the first beat (audio clock).
 *  `hushFor` beats keep the mic deaf (the count-in); after that the clicks
 *  play on quietly while the mic listens to you. */
export function startClicks(bpm: number, count: number, hushFor = count): number {
  const t = now() + 0.4;
  const beat = 60 / bpm;
  hush((0.4 + Math.min(count, hushFor) * beat) * 1000 - (hushFor < count ? 850 : 0));
  for (let i = 0; i < count; i++) audio.playClick(t + i * beat, i % 4 === 0);
  return t;
}

export const audioNow = (): number => audio.getCurrentTime() - audio.getOutputLatency();
