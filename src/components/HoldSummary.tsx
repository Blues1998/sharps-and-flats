import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Pick } from './Pick';
import { gradeFor } from '../utils/chime';
import { MATERIALS, ROMAN, TIERED, heldTier } from '../utils/feats';
import type { HoldRun } from '../utils/holdRun';
import { useBackToClose } from '../utils/nativeShell';

interface HoldSummaryProps {
  run: HoldRun;
  onAgain: () => void;
  onDone: () => void;
}

const clock = (ms: number) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * The end of a run, on one card.
 *
 * The longest streak is the headline, and the line under it says whether it
 * beat your best. The strip is every hold in order, steadier ones taller and
 * coloured by grade, so you can see where you warmed up and where you tired.
 * Go again is the big button: the best time for another run is right after a
 * good one.
 */
export const HoldSummary: React.FC<HoldSummaryProps> = ({ run, onAgain, onDone }) => {
  useBackToClose(true, onDone);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onDone(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDone]);

  const avg = run.spreads.length ? Math.round(run.spreads.reduce((a, b) => a + b, 0) / run.spreads.length) : 0;
  const isBest = run.max > run.startBest;
  const verdict = run.startBest === 0
    ? 'Your first run. That is the number to beat.'
    : isBest
      ? `New best. Was ${run.startBest}.`
      : run.max === run.startBest
        ? `Level with your best of ${run.startBest}.`
        : `${run.startBest - run.max} short of your best of ${run.startBest}.`;
  const earned = TIERED.filter(b => heldTier(b.id) > (run.tiersAtStart[b.id] ?? heldTier(b.id)));

  return createPortal(
    <div className="msheet-backdrop is-dialog" onClick={onDone}>
      <div className="msheet hsum" role="dialog" aria-modal="true" aria-label="Run summary" onClick={e => e.stopPropagation()}>
        <span className="hsum-kicker">Run over</span>
        <div className="hsum-run readout">{run.max}<small>in a row</small></div>
        <p className={`hsum-verdict${isBest || run.startBest === 0 ? ' is-best' : ''}`}>{verdict}</p>

        {run.spreads.length > 0 && (
          <>
            <div className="hsum-strip" aria-hidden="true">
              {run.spreads.map((s, i) => (
                <i key={i} className={`is-${gradeFor(s)}`} style={{ height: `${Math.max(14, 100 - s * 3.6)}%` }} />
              ))}
            </div>
            <div className="hsum-strip-l readout"><span>first hold</span><span>steadier is taller</span><span>last</span></div>
          </>
        )}

        <div className="hsum-stats">
          <div><span>Held</span><b className="readout">{run.held}</b></div>
          <div><span>Perfect</span><b className="readout">{run.perfect}</b></div>
          <div><span>Average wobble</span><b className="readout">±{avg}¢</b></div>
          <div><span>Time</span><b className="readout">{clock(run.activeMs)}</b></div>
        </div>

        {earned.map(b => {
          const t = heldTier(b.id);
          return (
            <div key={b.id} className="hsum-earned">
              <Pick tier={t} glyph={b.glyph} className="hsum-pick" />
              <div><b>{b.name} {ROMAN[t]}</b><span>{MATERIALS[t]} pick, earned this run</span></div>
            </div>
          );
        })}

        <div className="hsum-acts">
          <button type="button" className="btn" onClick={onDone}>Done</button>
          <button type="button" className="btn btn-primary" onClick={onAgain}>Go again</button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default HoldSummary;
