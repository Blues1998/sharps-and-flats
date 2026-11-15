import type { ActiveTab } from '../components/navGroups';

export interface Prompt {
  text: string;
  tab: ActiveTab;
  /** Only makes sense once there is a song in the library. Opens your current song. */
  needsSong?: boolean;
  /** A chord change to drill: opens Chords with this loop ready, at `tempo`. */
  loop?: [string, number][];
  tempo?: number;
  /** Opens the voice tuner in this mode. */
  voice?: 'sing' | 'hold';
}

// One small thing to go and do. Each one is a minute or two at the instrument
// and lands somewhere in the app that can actually help you do it, a prompt
// with nowhere to go is a slogan.
//
// Chosen by the date rather than at random, so it is the same all day: a
// suggestion that changes every time the page repaints is noise, and you can
// never come back to the one you meant to try.
export const PROMPTS: Prompt[] = [
  { text: 'Play the A minor pentatonic without looking at your hand.', tab: 'theory' },
  { text: 'Name every interval you hear for two minutes straight.', tab: 'ear-training' },
  { text: 'Set 60 BPM and play one clean downstroke per beat.', tab: 'rhythm' },
  { text: 'Tune by ear first. Then check how close you got.', tab: 'tuner' },
  { text: 'Change Am → F ten times without stopping.', tab: 'chordbook', loop: [['Am', 1], ['F', 1]], tempo: 60 },
  { text: 'Find every C on the fretboard in under a minute.', tab: 'theory' },
  { text: 'Hum the root while you strum the chord.', tab: 'tuner', voice: 'sing' },
  { text: "Play your song's progression at half speed, perfectly.", tab: 'library', needsSong: true },
  { text: 'Read one bar of tab, look away, play it back.', tab: 'tabs' },
  { text: 'Sing the melody while you strum.', tab: 'library', needsSong: true }
];

export function promptForDate(date = new Date(), hasSongs = true): Prompt {
  const dayOfYear = Math.floor(
    (date.getTime() - new Date(date.getFullYear(), 0, 0).getTime()) / 86400000
  );
  const usable = hasSongs ? PROMPTS : PROMPTS.filter(p => !p.needsSong);
  return usable[dayOfYear % usable.length];
}
