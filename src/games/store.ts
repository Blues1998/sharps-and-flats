// Which ear game is open. The player renders over the app, like a lesson.

import { useSyncExternalStore } from 'react';
import type { GameId } from './games';

let open: GameId | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());

export function startGame(id: GameId): void { open = id; emit(); }
export function closeGame(): void { open = null; emit(); }
export const gameOpen = (): boolean => open !== null;
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const useOpenGame = (): GameId | null => useSyncExternalStore(subscribe, () => open);

if (import.meta.env.DEV) (window as unknown as { __game?: (id: GameId) => void }).__game = startGame;
