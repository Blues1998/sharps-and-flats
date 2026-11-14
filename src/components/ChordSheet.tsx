import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChordDiagram } from './ChordDiagram';
import { audio } from '../utils/audio';
import {
  COMFORT_LABEL,
  COMFORT_ORDER,
  comfortOf,
  preferredVoicing,
  setComfort,
  setPreferredVoicing,
  skillFor,
  voicingsFor
} from '../utils/chordbook';
import { useBackToClose } from '../utils/nativeShell';

interface ChordSheetProps {
  symbol: string;
  /** Titles of the songs that ask for it. */
  songs: string[];
  inLoop: boolean;
  onToggleLoop: () => void;
  /** Loop it against the chords around it, when there is a drill for it. */
  onDrill?: () => void;
  /** Take it out of your chords. Absent for a chord you have not met. */
  onRemove?: () => void;
  onClose: () => void;
}

/**
 * Everything one chord has, on one sheet.
 *
 * Every shape we know for it, each one sounding when pressed and becoming
 * yours on the same press, because "I can play B" is only ever true of one
 * grip. Where it is used, how it sits in your hands, and the two things you
 * might do with it next: add it to the loop, or drill it.
 */
export const ChordSheet: React.FC<ChordSheetProps> = ({ symbol, songs, inLoop, onToggleLoop, onDrill, onRemove, onClose }) => {
  useBackToClose(true, onClose);
  useEffect(() => {
    const shut = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', shut);
    return () => window.removeEventListener('keydown', shut);
  }, [onClose]);

  const all = voicingsFor(symbol);
  const mine = preferredVoicing(symbol);
  const rated = skillFor(symbol) !== undefined;
  const comfort = comfortOf(symbol);

  return createPortal(
    <div className="msheet-backdrop is-dialog" onClick={onClose}>
      <div className="msheet csheet" role="dialog" aria-modal="true" aria-label={symbol} onClick={e => e.stopPropagation()}>
        <span className="csheet-grab" aria-hidden="true" />
        <div className="csheet-head">
          <h3 className="csheet-name">{symbol}</h3>
          <span className={`csheet-state is-${rated ? comfort : 'unrated'}`}>{rated ? COMFORT_LABEL[comfort] : 'Not rated'}</span>
        </div>

        {all.length > 0 ? (
          <>
            <div className="csheet-shapes" role="radiogroup" aria-label={`Shapes for ${symbol}`}>
              {all.map(v => {
                const on = v.id === mine?.id;
                return (
                  <button
                    key={v.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    className={`csheet-shape${on ? ' is-on' : ''}`}
                    onClick={() => { audio.playStrum(v.midis); void setPreferredVoicing(symbol, v.id); }}
                  >
                    <ChordDiagram frets={v.frets} fingers={v.fingers} scale={0.72} />
                    <span className="csheet-shape-name">{v.substituteFor ? `${v.label}, plays ${v.substituteFor}` : v.label}</span>
                    <span className={`csheet-tier tier-${v.tier}`}>{on ? 'Yours' : v.tier}</span>
                  </button>
                );
              })}
            </div>
            <p className="csheet-hint">
              {all.length === 1 ? 'Tap the shape to hear it.' : `${all.length} shapes. Tap one to hear it and make it yours.`}
            </p>
          </>
        ) : (
          <p className="csheet-hint">No shape stored for this one.</p>
        )}

        {songs.length > 0 && (
          <p className="csheet-used">In <strong>{songs.join(', ')}</strong></p>
        )}

        <div className="csheet-rate" role="group" aria-label={`How ${symbol} feels`}>
          {COMFORT_ORDER.map(value => (
            <button
              key={value}
              type="button"
              className={`csheet-rate-btn is-${value}${rated && comfort === value ? ' is-on' : ''}`}
              aria-pressed={rated && comfort === value}
              onClick={() => void setComfort(symbol, value)}
            >
              {COMFORT_LABEL[value]}
            </button>
          ))}
        </div>

        <div className="csheet-actions">
          <button type="button" className={`btn${inLoop ? '' : ' btn-primary'} csheet-loop`} onClick={onToggleLoop} disabled={all.length === 0}>
            {inLoop ? 'In the loop ✓' : '+ Add to loop'}
          </button>
          {onDrill && <button type="button" className="btn" onClick={onDrill}>Drill</button>}
        </div>

        {onRemove && (
          <button type="button" className="csheet-remove" onClick={onRemove}>Remove from my chords</button>
        )}
      </div>
    </div>,
    document.body
  );
};

export default ChordSheet;
