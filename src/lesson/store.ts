// Which lesson is open. The player renders over the app; the neck waits for it
// to close before playing its moments, and badges wait too.

import { useSyncExternalStore } from 'react';

let open: string | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());

export const LESSON_CLOSED = 'cadenza-lesson-closed';

export function startLesson(id: string): void {
  open = id;
  emit();
}

export function closeLesson(): void {
  open = null;
  emit();
  window.dispatchEvent(new Event(LESSON_CLOSED));
}

export const lessonOpen = (): boolean => open !== null;
/** The open lesson's id, for usage events sent from inside it. */
export const openLesson = (): string | null => open;

/** Run the open lesson again from the start, as a fresh take. */
export function restartLesson(): void {
  const id = open;
  if (!id) return;
  open = null;
  emit();
  window.setTimeout(() => { open = id; emit(); }, 0);
}

export const subscribeLesson = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const useOpenLesson = (): string | null => useSyncExternalStore(subscribeLesson, () => open);

// For trying lessons in a dev build.
if (import.meta.env.DEV) (window as unknown as { __lesson?: (id: string) => void }).__lesson = startLesson;
