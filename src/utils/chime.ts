// The sounds of being right.
//
// Every reward in the app is made of the music itself: a held note answers
// with a bell on the note you sang, and the better you held it, the more of
// its harmonic series comes back on top (its fifth, then its octave). The
// milestones of a run climb like dynamics marks, a new best is a rising major
// arpeggio, and a badge lands on a V to I cadence, the sound of arriving home.
//
// Plain oscillators through the app's own master bus, like the tuner's drone:
// no samples to load, nothing to wait for, and quiet enough to sit under a
// voice.

import { useSyncExternalStore } from 'react';
import { audio } from './audio';

export type Grade = 'perfect' | 'great' | 'good';

/** How steady a held note was, from the spread of its pitch in cents. */
export const gradeFor = (spreadCents: number): Grade =>
  spreadCents <= 5 ? 'perfect' : spreadCents <= 12 ? 'great' : 'good';

export const GRADE_LABEL: Record<Grade, string> = { perfect: 'Perfect', great: 'Great', good: 'Good' };

// ---- The setting -------------------------------------------------------------

const KEY = 'cadenza-chime';
const CHANGE = 'cadenza-chime-change';
let on = (() => { try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; } })();

export function setChime(next: boolean): void {
  on = next;
  try { localStorage.setItem(KEY, next ? 'on' : 'off'); } catch { /* applies this session */ }
  window.dispatchEvent(new Event(CHANGE));
}

export function useChime(): boolean {
  return useSyncExternalStore(
    cb => { window.addEventListener(CHANGE, cb); return () => window.removeEventListener(CHANGE, cb); },
    () => on
  );
}

// ---- Voices ------------------------------------------------------------------

const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

function bus() {
  if (!on) return null;
  audio.init();
  return audio.getMasterBus();
}

/** A small bell: a few partials, each dying faster than the one below it. */
function bell(midi: number, at = 0, dur = 1.4, gain = 0.16): void {
  const b = bus();
  if (!b) return;
  const { ctx, input } = b;
  const t = ctx.currentTime + at;
  for (const [mult, level] of [[1, 1], [2, 0.32], [3, 0.1], [4.16, 0.05]] as const) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = hz(midi) * mult;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain * level, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur / (0.5 + mult * 0.5));
    osc.connect(g).connect(input);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }
}

/** A held note landed. Good is the note; Great adds its fifth; Perfect, its octave too. */
export function hitChime(grade: Grade, midi: number): void {
  bell(midi);
  if (grade !== 'good') bell(midi + 7, 0.045, 1.2, 0.11);
  if (grade === 'perfect') bell(midi + 12, 0.09, 1.1, 0.09);
}

/** A soft knock, falling. A miss is information, not a punishment. */
export function missChime(midi: number): void {
  const b = bus();
  if (!b) return;
  const { ctx, input } = b;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(hz(midi), t);
  osc.frequency.exponentialRampToValueAtTime(hz(midi - 5), t + 0.25);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.09, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
  osc.connect(g).connect(input);
  osc.start(t);
  osc.stop(t + 0.45);
}

/** The milestones of a run, quietest first, as the dynamics marks a player reads. */
export const MILESTONES = [
  { n: 5, mark: '𝆏', name: 'piano', notes: [0, 4], chord: false },
  { n: 10, mark: '𝆐𝆏', name: 'mezzo-piano', notes: [0, 4, 7], chord: false },
  { n: 25, mark: '𝆐𝆑', name: 'mezzo-forte', notes: [0, 4, 7, 12], chord: false },
  { n: 50, mark: '𝆑', name: 'forte', notes: [0, 4, 7, 12, 16], chord: true },
  { n: 100, mark: '𝆑𝆑', name: 'fortissimo', notes: [0, 4, 7, 12, 16, 19, 24], chord: true }
] as const;

export type Milestone = (typeof MILESTONES)[number];

export function milestoneChime(m: Milestone, root = 60): void {
  m.notes.forEach((s, i) => bell(root + s, i * 0.085, 1.3, 0.13));
  if (m.chord) [0, 4, 7, 12].forEach(s => bell(root + s, m.notes.length * 0.085 + 0.05, 2.2, 0.08));
}

/** Past your best: a major arpeggio up to the octave, the top note left ringing. */
export function bestChime(root = 60): void {
  [0, 4, 7, 12].forEach((s, i) => bell(root + s, i * 0.11, i === 3 ? 2.2 : 1.2, 0.15));
}

/** A badge: V, then I. */
export function cadenceChime(root = 60): void {
  [7, 11, 14, 19].forEach(s => bell(root - 12 + s, 0, 1.0, 0.09));
  [0, 4, 7, 12, 16].forEach(s => bell(root + s, 0.42, 2.6, 0.09));
  bell(root + 24, 0.5, 2.4, 0.06);
}
