import React, { useCallback, useEffect, useRef, useState } from 'react';
import { playSound, soundLength } from './sound';
import { claim, isCurrent, release, stopCurrent } from './nowPlaying';
import type { Sound } from './sound';
import { feel } from '../utils/haptics';

const STOP = <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" /></svg>;
const PLAY = <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.3 5.8v12.4a.8.8 0 0 0 1.2.7l9.6-6.2a.8.8 0 0 0 0-1.4L8.5 5.1a.8.8 0 0 0-1.2.7z" fill="currentColor" /></svg>;

/** Plays a sound, and shows it playing with a ring that runs for its length.
 *  A second tap while it plays stops it. */
export const Player: React.FC<{ sound: Sound; size?: 'big' | 'small'; label?: string; auto?: boolean }> = ({ sound, size = 'small', label, auto }) => {
  const [run, setRun] = useState(0);
  const [on, setOn] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const mine = useRef<{ stop: () => void; off: () => void } | null>(null);
  const len = soundLength(sound);
  const off = useCallback(() => { window.clearTimeout(timer.current); setOn(false); }, []);
  const go = useCallback(() => {
    const me = { stop: playSound(sound), off };
    claim(me);
    mine.current = me;
    setOn(true);
    setRun(r => r + 1);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { setOn(false); release(me); }, len * 1000);
  }, [sound, len, off]);
  const toggle = useCallback(() => {
    if (on && mine.current && isCurrent(mine.current)) { stopCurrent(); return; }
    go();
  }, [on, go]);
  useEffect(() => {
    if (!auto) return;
    const id = window.setTimeout(go, 380);
    return () => window.clearTimeout(id);
  }, [auto, go]);
  // Leaving the screen stops the sound with it.
  useEffect(() => () => {
    window.clearTimeout(timer.current);
    if (mine.current && isCurrent(mine.current)) stopCurrent();
  }, []);
  return (
    <button type="button" className={`lp-player is-${size}${on ? ' is-on' : ''}`} onClick={e => { e.stopPropagation(); feel('tap'); toggle(); }} data-feel="off" aria-label={on ? 'Stop' : label ? `Play ${label}` : 'Play the sound'}>
      <span className="lp-player-disc" style={{ ['--len' as string]: `${len}s` } as React.CSSProperties} key={run}>
        {on ? STOP : PLAY}
      </span>
      {label && <span className="lp-player-label">{label}</span>}
    </button>
  );
};

