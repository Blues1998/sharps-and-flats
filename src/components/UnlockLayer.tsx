import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Pick } from './Pick';
import { MATERIALS, ROMAN, dismissUnlock, initFeats, useUnlocks } from '../utils/feats';
import { cadenceChime } from '../utils/chime';
import { confetti } from '../utils/confetti';
import { feel } from '../utils/haptics';
import { useBackToClose } from '../utils/nativeShell';

/**
 * A badge, the moment it is earned, on whatever screen earned it.
 *
 * The pick lands, the cadence plays, the confetti falls, and the phone gives
 * its celebrate swell. Several at once are shown one after another. A run in
 * the tuner waits behind it and carries on when it closes.
 */
export const UnlockLayer: React.FC = () => {
  useEffect(() => { initFeats(); }, []);
  const queue = useUnlocks();
  const top = queue[0];

  useEffect(() => {
    if (!top) return;
    cadenceChime(60);
    confetti();
    feel('celebrate');
  }, [top]);

  useBackToClose(!!top, dismissUnlock);
  useEffect(() => {
    if (!top) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' || e.key === 'Enter') dismissUnlock(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [top]);

  if (!top) return null;
  const single = top.tier === 0;

  return createPortal(
    <div className="unlock-backdrop" onClick={dismissUnlock}>
      <div key={`${top.id}-${top.tier}`} className="unlock-card" role="dialog" aria-modal="true" aria-label={`Badge earned: ${top.name}`} onClick={e => e.stopPropagation()}>
        <Pick tier={single ? 1 : top.tier} glyph={top.glyph} single={single} className="unlock-pick" />
        <span className="unlock-kicker">Badge earned</span>
        <h3 className="unlock-name">{top.name}{single ? '' : ` ${ROMAN[top.tier]}`}</h3>
        <p className="unlock-why">{top.why}.{single ? '' : ` ${MATERIALS[top.tier]} pick.`}</p>
        {top.next && <span className="unlock-next readout">Next: {top.next}</span>}
        <button type="button" className="btn btn-primary unlock-go" onClick={dismissUnlock} autoFocus>
          {queue.length > 1 ? `Next badge (${queue.length - 1} more)` : 'Keep going'}
        </button>
      </div>
    </div>,
    document.body
  );
};

export default UnlockLayer;
