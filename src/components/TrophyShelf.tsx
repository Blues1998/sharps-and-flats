import React, { useEffect, useRef, useState } from 'react';
import { Pick } from './Pick';
import {
  MATERIALS, ONE_OFFS, ROMAN, TIERED, fmtMark, heldTier, nextStep, recordRows, takeShelfPick, tierOf, useFeats
} from '../utils/feats';

/**
 * Your picks and your bests, on Me.
 *
 * Earned picks in their material, the rest as outlines, and every one says
 * exactly what the next tier needs, so there is always a next thing to aim
 * at. Under them, every personal best the app keeps, with the day it was set.
 */
export const TrophyShelf: React.FC = () => {
  useFeats();
  // Sent here from a badge: open on that pick and bring the shelf into view.
  const [sentFor] = useState(takeShelfPick);
  // Nothing is open until you tap a pick (or arrive from one); tap it again to close.
  const [open, setOpen] = useState<string | null>(() => TIERED.find(b => b.id === sentFor)?.id ?? null);
  const shelfRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (sentFor) shelfRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [sentFor]);
  const earned = TIERED.reduce((n, b) => n + Math.max(heldTier(b.id), tierOf(b)), 0) + ONE_OFFS.filter(o => heldTier(o.id) > 0).length;
  const total = TIERED.length * 5 + ONE_OFFS.length;
  const sel = TIERED.find(b => b.id === open) ?? null;
  const selTier = sel ? Math.max(heldTier(sel.id), tierOf(sel)) : 0;
  const step = sel ? nextStep(sel) : null;

  return (
    <section ref={shelfRef} id="trophies" className="glass-panel me-card trophies">
      <div className="trophies-head">
        <h3 className="me-heading">Trophies</h3>
        <span className="trophies-count"><b className="readout">{earned}</b> of {total} picks</span>
      </div>

      <div className="trophies-shelf">
        {TIERED.map(b => {
          const t = Math.max(heldTier(b.id), tierOf(b));
          return (
            <button
              key={b.id}
              type="button"
              className={`trophy${b.id === open ? ' is-open' : ''}`}
              aria-pressed={b.id === open}
              aria-label={`${b.name}, ${t ? `tier ${ROMAN[t]}` : 'not earned yet'}`}
              onClick={() => setOpen(o => (o === b.id ? null : b.id))}
            >
              <Pick tier={t} glyph={b.glyph} className="trophy-pick" />
              <b>{b.name}</b>
              <span className="trophy-pips" aria-hidden="true">
                {[1, 2, 3, 4, 5].map(i => <i key={i} className={i <= t ? 'is-on' : ''} />)}
              </span>
            </button>
          );
        })}
      </div>

      {sel && <div className="trophy-detail" aria-live="polite">
        <h4>{sel.name}{selTier ? ` ${ROMAN[selTier]}` : ''}<span>{selTier ? `${MATERIALS[selTier]} pick` : 'Not earned yet'}</span></h4>
        <p>{sel.what} · {sel.page}</p>
        <div className="trophy-tiers">
          {sel.tiers.map((mark, i) => (
            <div key={i} className={i < selTier ? 'is-got' : ''}>
              <b>{ROMAN[i + 1]}</b>
              <span className="readout">{fmtMark(sel, mark)}</span>
            </div>
          ))}
        </div>
        <p className="trophy-next">{step ? `Next: ${step}` : 'Every tier earned.'}</p>
      </div>}

      <h3 className="me-heading trophy-ones-head">Milestones</h3>
      <div className="trophy-ones">
        {ONE_OFFS.map(o => {
          const got = heldTier(o.id) > 0;
          return (
            <span key={o.id} className={`trophy-one${got ? ' is-got' : ''}`} title={o.what}>
              <Pick tier={got ? 1 : 0} glyph={o.glyph} single className="trophy-one-pick" />
              <span>{o.name}</span>
            </span>
          );
        })}
      </div>

    </section>
  );
};

/** Every personal best the app keeps, with where and when it was set. */
export const RecordsCard: React.FC = () => {
  useFeats();
  const rows = recordRows();
  return (
    <section className="glass-panel me-card trophies">
      <h3 className="me-heading">Personal records</h3>
      {rows.length ? (
        <div className="trophy-recs">
          {rows.map(r => (
            <div key={r.label}>
              <span>{r.label}<small>{r.sub}</small></span>
              <b className="readout">{r.value}</b>
            </div>
          ))}
        </div>
      ) : (
        <p className="trophy-empty">Your bests land here the moment you set them.</p>
      )}
    </section>
  );
};

export default TrophyShelf;
