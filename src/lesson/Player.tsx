import React, { useCallback, useEffect, useRef, useState } from 'react';
import { playSound, soundLength } from './sound';
import type { Sound } from './sound';
import { feel } from '../utils/haptics';

const PLAY = <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.3 5.8v12.4a.8.8 0 0 0 1.2.7l9.6-6.2a.8.8 0 0 0 0-1.4L8.5 5.1a.8.8 0 0 0-1.2.7z" fill="currentColor" /></svg>;

/** Plays a sound, and shows it playing with a ring that runs for its length. */
export const Player: React.FC<{ sound: Sound; size?: 'big' | 'small'; label?: string; auto?: boolean }> = ({ sound, size = 'small', label, auto }) => {
  const [run, setRun] = useState(0);
  const [on, setOn] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const len = soundLength(sound);
  const go = useCallback(() => {
    playSound(sound);
    setOn(true);
    setRun(r => r + 1);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOn(false), len * 1000);
  }, [sound, len]);
  useEffect(() => {
    if (!auto) return;
    const id = window.setTimeout(go, 380);
    return () => window.clearTimeout(id);
  }, [auto, go]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <button type="button" className={`lp-player is-${size}${on ? ' is-on' : ''}`} onClick={e => { e.stopPropagation(); feel('tap'); go(); }} data-feel="off" aria-label={label ? `Play ${label}` : 'Play the sound'}>
      <span className="lp-player-disc" style={{ ['--len' as string]: `${len}s` } as React.CSSProperties} key={run}>
        {on ? <span className="lp-eq" aria-hidden="true"><i /><i /><i /><i /></span> : PLAY}
      </span>
      {label && <span className="lp-player-label">{label}</span>}
    </button>
  );
};

