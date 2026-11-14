import React from 'react';
import { ChordDiagram } from './ChordDiagram';
import { audio } from '../utils/audio';
import { COMFORT_LABEL, COMFORT_ORDER, preferredVoicing, type ChordComfort } from '../utils/chordbook';

interface StackCard {
  symbol: string;
  /** A song that asks for it, to say why it is here. */
  song: string | null;
}

interface RateStackProps {
  /** Still to rate, easiest first. The first is the one on top. */
  cards: StackCard[];
  /** What this visit has rated, for the progress dots and the summary. */
  ratedNow: { symbol: string; comfort: ChordComfort }[];
  /** No songs yet: these are the common open chords, not your songs'. */
  common: boolean;
  onRate: (symbol: string, comfort: ChordComfort) => void;
  onSkip: (symbol: string) => void;
  onAgain: () => void;
}

/** What each answer means, in the words someone would use about their hands. */
const HINT: Record<ChordComfort, string> = {
  solid: 'Clean every time',
  shaky: 'Buzzes or slow',
  none: "Can't play it yet"
};

// More dots than this stop being progress and start being a barcode.
const MAX_DOTS = 12;

/**
 * New chords, one at a time.
 *
 * The question asked of each is the same and it only has three answers, so it
 * is asked of one chord at a time, large, with a way to hear it, and the next
 * one comes up the moment it is answered. Six chords take six taps and no
 * scrolling. Skip leaves one for later without inventing an answer for it.
 */
export const RateStack: React.FC<RateStackProps> = ({ cards, ratedNow, common, onRate, onSkip, onAgain }) => {
  const top = cards[0];

  if (!top) {
    if (ratedNow.length === 0) return null;
    const said = COMFORT_ORDER
      .map(c => [ratedNow.filter(r => r.comfort === c).length, COMFORT_LABEL[c].toLowerCase()] as const)
      .filter(([n]) => n > 0)
      .map(([n, w]) => `${n} ${w}`)
      .join(', ');
    return (
      <section className="rstack is-done" aria-live="polite">
        <span className="rstack-tick" aria-hidden="true">✓</span>
        <p className="rstack-said">All rated: {said}.</p>
        <button type="button" className="linklike" onClick={onAgain}>Done</button>
      </section>
    );
  }

  const done = ratedNow.length;
  const all = done + cards.length;
  const voicing = preferredVoicing(top.symbol);
  const hear = () => { if (voicing) audio.playStrum(voicing.midis); };

  return (
    <section className="rstack" aria-label="Rate new chords">
      <div className="rstack-top">
        <span className="surface-label">{common ? 'Common chords' : 'New chords'}</span>
        <span className="rstack-count readout">{done + 1} of {all}</span>
        {all <= MAX_DOTS && (
          <span className="rstack-dots" aria-hidden="true">
            {Array.from({ length: all }, (_, i) => (
              <i key={i} className={i < done ? 'is-done' : i === done ? 'is-now' : ''} />
            ))}
          </span>
        )}
      </div>

      {/* Keyed on the chord so each new one plays its entrance. */}
      <div key={top.symbol} className="rstack-card">
        {voicing ? (
          <button type="button" className="rstack-shape" onClick={hear} aria-label={`Hear ${top.symbol}`}>
            <ChordDiagram frets={voicing.frets} fingers={voicing.fingers} scale={1.05} />
          </button>
        ) : (
          <span className="rstack-noshape">No shape stored</span>
        )}
        <h3 className="rstack-name">{top.symbol}</h3>
        <span className="rstack-why">{top.song ? `In ${top.song}` : common ? 'In most songs' : 'Added by you'}</span>
        {voicing && (
          <button type="button" className="rstack-hear" onClick={hear}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" /><path d="M15.5 8.5a5 5 0 0 1 0 7" />
            </svg>
            Hear it
          </button>
        )}
      </div>

      <div className="rstack-answers" role="group" aria-label={`How does ${top.symbol} feel?`}>
        {COMFORT_ORDER.map(c => (
          <button key={c} type="button" className={`rstack-answer is-${c}`} onClick={() => onRate(top.symbol, c)}>
            <b>{COMFORT_LABEL[c]}</b>
            <small>{HINT[c]}</small>
          </button>
        ))}
      </div>
      {cards.length > 1 && (
        <button type="button" className="linklike rstack-skip" onClick={() => onSkip(top.symbol)}>Skip for now</button>
      )}
    </section>
  );
};

export default RateStack;
