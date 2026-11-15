import React, { useEffect, useReducer } from 'react';
import { createPortal } from 'react-dom';
import { CLOCK_EVENT, getPresence } from '../utils/practiceClock';

/**
 * "Still playing?", after ten minutes without a touch.
 *
 * The music keeps going; only the practice clock asks. Any tap answers it (a
 * tap anywhere counts, this chip is just the obvious place), and the minutes
 * spent asking are kept. Unanswered for two minutes, the clock stops counting
 * until you are back, and says so.
 */
export const StillPlaying: React.FC = () => {
  const [, nudge] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    window.addEventListener(CLOCK_EVENT, nudge);
    return () => window.removeEventListener(CLOCK_EVENT, nudge);
  }, []);
  const p = getPresence();
  if (p === 'counting') return null;
  return createPortal(
    <button type="button" className={`stillplaying is-${p}`} aria-live="polite">
      <b>{p === 'asking' ? 'Still playing?' : 'Practice time paused'}</b>
      <span>{p === 'asking' ? 'Tap to keep counting' : 'Tap to start counting again'}</span>
    </button>,
    document.body
  );
};

export default StillPlaying;
