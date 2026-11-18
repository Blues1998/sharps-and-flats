// The streak going up, shown once: the flame plays big in the middle of the
// screen, the number steps up, then it shrinks into its spot in the top bar
// and stops there. A tap anywhere skips ahead.

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { RiveStreak } from './RiveStreak';
import { feel } from '../utils/haptics';

const BIG = 220;
const STEP_MS = 700;
const HOLD_MS = 2600;
const FLY_MS = 560;

interface Props {
  to: number;
  /** Where the flame lands: the header's flame. */
  target: () => DOMRect | null;
  onDone: () => void;
}

export const StreakCelebration: React.FC<Props> = ({ to, target, onDone }) => {
  const [shown, setShown] = useState(to > 1 ? to - 1 : to);
  const [phase, setPhase] = useState<'in' | 'fly'>('in');
  const flame = useRef<HTMLCanvasElement>(null);
  const [fly, setFly] = useState<React.CSSProperties>({});
  const done = useRef(false);

  const collapse = () => {
    if (phase === 'fly') return;
    setShown(to);
    const from = flame.current?.getBoundingClientRect();
    const at = target();
    if (from && at) {
      const dx = at.left + at.width / 2 - (from.left + from.width / 2);
      const dy = at.top + at.height / 2 - (from.top + from.height / 2);
      setFly({ transform: `translate(${dx}px, ${dy}px) scale(${at.width / from.width})` });
    }
    setPhase('fly');
  };

  // The clock starts once the flame is drawn, not while Rive is still loading.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!ready) return;
    const step = window.setTimeout(() => { setShown(to); feel('celebrate'); }, STEP_MS);
    const hold = window.setTimeout(collapse, HOLD_MS);
    return () => { window.clearTimeout(step); window.clearTimeout(hold); };
  }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (phase !== 'fly') return;
    const id = window.setTimeout(() => { if (!done.current) { done.current = true; onDone(); } }, FLY_MS + 40);
    return () => window.clearTimeout(id);
  }, [phase, onDone]);

  return createPortal(
    <div className={`streak-cele is-${phase}`} role="status" onClick={collapse}>
      <div className="streak-cele-flame" style={fly}>
        <RiveStreak streak={shown} size={BIG} live canvasRef={flame} onReady={() => setReady(true)} onFail={onDone} />
      </div>
      <p className="streak-cele-title">{to} day streak</p>
      <p className="streak-cele-sub">{to === 1 ? 'Day one. Come back tomorrow to make it 2.' : `Come back tomorrow to make it ${to + 1}.`}</p>
    </div>,
    document.body,
  );
};
