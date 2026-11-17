// One sound at a time across every player: starting one stops the last.

import { playSound } from './sound';
import type { Sound } from './sound';

interface Playing { stop: () => void; off: () => void }
let current: Playing | null = null;

export function stopCurrent(): void { current?.stop(); current?.off(); current = null; }
export function claim(p: Playing): void { stopCurrent(); current = p; }
export function release(p: Playing): void { if (current === p) current = null; }
export const isCurrent = (p: Playing): boolean => current === p;

/** Play a sound outside a player button, under the same one-at-a-time rule. */
export function playOne(sound: Sound): void { claim({ stop: playSound(sound), off: () => {} }); }
