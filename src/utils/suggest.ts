// Which drill to try next: the one you have left longest, never-tried first.
//
// A session that ends with a good next step often turns into two. Kept a
// suggestion, never a gate: choosing what to practise is part of owning it.

import type { ActiveTab } from '../components/Sidebar';
import { lastUsed } from './practiceClock';

export interface Drill {
  tab: ActiveTab;
  label: string;
  /** The practice clock key its time is counted under. */
  clock: string;
  /** The badge it earns. */
  badge: string;
}

export const DRILLS: Drill[] = [
  { tab: 'chordbook', label: 'Chords', clock: 'loop', badge: 'collect' },
  { tab: 'rhythm', label: 'Rhythm', clock: 'metronome', badge: 'clock' },
  { tab: 'ear-training', label: 'Ear Training', clock: 'ear', badge: 'ears' },
  { tab: 'play', label: 'Challenges', clock: 'challenge', badge: 'explorer' }
];

const iso = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** "today", "yesterday", a weekday this past week, or "12 Nov". */
export function since(date: string): string {
  const today = new Date(`${iso()}T12:00:00`);
  const d = new Date(`${date}T12:00:00`);
  const days = Math.round((today.getTime() - d.getTime()) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return days < 7
    ? d.toLocaleDateString(undefined, { weekday: 'long' })
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export function suggestDrill(excludeClock?: string): { drill: Drill; last: string | null; said: string; fresh: boolean } | null {
  const pick = DRILLS
    .filter(d => d.clock !== excludeClock)
    .map(drill => ({ drill, last: lastUsed(drill.clock) ?? null }))
    .sort((a, b) => ((a.last ?? '') < (b.last ?? '') ? -1 : (a.last ?? '') > (b.last ?? '') ? 1 : 0))[0];
  if (!pick) return null;
  return {
    ...pick,
    said: pick.last ? `Not since ${since(pick.last)}` : 'Not tried yet',
    fresh: pick.last === iso()
  };
}
