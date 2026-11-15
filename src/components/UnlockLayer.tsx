import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Pick } from './Pick';
import { MATERIALS, ROMAN, dismissAllUnlocks, dismissUnlock, initFeats, showOnShelf, useUnlocks } from '../utils/feats';
import { go } from '../hooks/useRoute';
import { bestChime, cadenceChime } from '../utils/chime';
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
    // The daily goal is a good day, not a feat: a brighter chime and a buzz,
    // and the confetti is kept for picks.
    if (top.kind === 'goal') { bestChime(60); feel('success'); return; }
    cadenceChime(60);
    confetti();
    feel('celebrate');
  }, [top]);

  useBackToClose(!!top, dismissUnlock);
  useEffect(() => {
    if (!top) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') dismissUnlock(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [top]);

  if (!top) return null;
  // The whole collection, opened on the pick just earned. Anything else that
  // was queued is on the shelf already, so the queue is cleared.
  const seeShelf = (id: string) => {
    showOnShelf(id);
    dismissAllUnlocks();
    go({ tab: 'me', songId: null });
  };
  const single = top.tier === 0;
  if (top.kind === 'goal') {
    return createPortal(
      <div className="unlock-backdrop" onClick={dismissUnlock}>
        <div className="unlock-card is-goal" role="dialog" aria-modal="true" aria-label={top.name} onClick={e => e.stopPropagation()}>
          <svg className="unlock-ring" viewBox="0 0 36 36" aria-hidden="true">
            <circle cx="18" cy="18" r="15" className="streak-ring-track" />
            <circle cx="18" cy="18" r="15" className="streak-ring-fill" strokeDasharray="94.25 94.25" transform="rotate(-90 18 18)" />
            <path d="m12 18.5 4 4 8-9" className="unlock-ring-tick" />
          </svg>
          <span className="unlock-kicker">Today</span>
          <h3 className="unlock-name">{top.name}</h3>
          <p className="unlock-why">{top.why}.</p>
          <button type="button" className="btn btn-primary unlock-go" onClick={dismissUnlock} autoFocus>Keep going</button>
        </div>
      </div>,
      document.body
    );
  }

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
        <button type="button" className="btn unlock-shelf" onClick={() => seeShelf(top.id)}>
          See all my picks
        </button>
      </div>
    </div>,
    document.body
  );
};

export default UnlockLayer;
