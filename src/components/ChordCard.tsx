import React, { useState } from 'react';
import { ChordDiagram } from './ChordDiagram';
import { IconTrash } from './Icons';
import { audio } from '../utils/audio';
import type { ChordVoicing } from '../utils/chords';
import {
  COMFORT_HINT,
  COMFORT_LABEL,
  COMFORT_ORDER,
  comfortOf,
  preferredVoicing,
  skillFor,
  setComfort,
  setPreferredVoicing,
  voicingsFor,
  type ChordComfort
} from '../utils/chordbook';

/**
 * How a chord feels: Solid, Shaky or Not yet, said in words.
 *
 * The same three labelled buttons as the chord sheet on the Chords page, so
 * rating a chord looks and reads the same wherever you meet it. Nothing is
 * lit until you answer, so an unrated chord does not pass for "Not yet".
 */
export const ComfortMark: React.FC<{ symbol: string }> = ({ symbol }) => {
  const comfort = comfortOf(symbol);
  const rated = skillFor(symbol) !== undefined;
  return (
    <div className="csheet-rate is-compact" role="group" aria-label={`How ${symbol} feels`}>
      {COMFORT_ORDER.map(value => (
        <button
          key={value}
          type="button"
          className={`csheet-rate-btn is-${value}${rated && comfort === value ? ' is-on' : ''}`}
          aria-pressed={rated && comfort === value}
          title={COMFORT_HINT[value]}
          onClick={() => void setComfort(symbol, value)}
        >
          {COMFORT_LABEL[value]}
        </button>
      ))}
    </div>
  );
};

/** The little coloured pill that says where a chord stands, with no controls. */
export const ComfortChip: React.FC<{ symbol: string; comfort?: ChordComfort }> = ({ symbol, comfort }) => {
  const value = comfort ?? comfortOf(symbol);
  return <span className={`comfort-chip is-${value}`}>{COMFORT_LABEL[value]}</span>;
};

interface ChordCardProps {
  symbol: string;
  /** Show the three-state control under the diagram. */
  markable?: boolean;
  /** Let the fingering be chosen from every shape we know. */
  shapes?: boolean;
  /** An action for this chord, under everything else, used by "Learn next". */
  footer?: React.ReactNode;
  /** Anything the caller wants under the name, "in 4 songs", a count. */
  meta?: React.ReactNode;
  /** What the footnote is short for, the songs behind "7 songs", on hover. */
  metaTitle?: string;
  scale?: number;
  /**
   * Whether this chord is in the bucket, when the page is collecting.
   *
   * Pressing the shape always did one thing, sound it, and it still does.
   * Collecting is a tick, because a tick says it is a set you are building and
   * shows you what is in it without you having to remember what you pressed.
   */
  picked?: boolean;
  /** Put it in the bucket or take it out. Undefined means nobody is collecting. */
  onToggle?: (symbol: string) => void;
  /** Shows a remove button; what removing means is up to the page. */
  onRemove?: () => void;
}

/**
 * One chord: what it is called, the shape you have chosen for it, how it sits
 * in your hands, and every other way it could be played.
 *
 * The shape matters as much as the comfort and is usually left out of apps
 * like this. "I can play B" is never true of B, it is true of one grip, and
 * which grip is the difference between a chord you have and a chord you do
 * not. So the choice is stored, and everything that draws or sounds this
 * chord, the play-along included, uses it.
 */
export const ChordCard: React.FC<ChordCardProps> = ({
  symbol, markable = false, shapes = false, meta, metaTitle, footer, scale = 0.62, picked = false, onToggle, onRemove
}) => {
  const [open, setOpen] = useState(false);
  // Counts strikes rather than holding a boolean, so a second press while the
  // first is still ringing starts a new flash instead of doing nothing, the
  // ring is a fresh element each time, keyed on the count.
  const [strikes, setStrikes] = useState(0);
  const voicing = preferredVoicing(symbol);
  const all = voicingsFor(symbol);
  const comfort = comfortOf(symbol);
  const chosenId = voicing?.id ?? null;

  const strum = (v: ChordVoicing) => {
    audio.playStrum(v.midis);
    setStrikes(n => n + 1);
  };

  return (
    <div className={`chordcard is-${comfort}${voicing ? '' : ' is-plain'}${open ? ' is-open' : ''}${onToggle ? ' is-pickable' : ''}${picked ? ' is-picked' : ''}`}>
      {/* A real checkbox, drawn the way the browser draws one. Every other
          control on this card had to be invented; this one already means
          "in the set" to everybody who has ever used a computer, and the
          bucket it fills is on screen at the same time. */}
      {onToggle && (
        <label
          className="chordpick"
          title={picked ? `Take ${symbol} out of the loop` : `Add ${symbol} to a loop you can play`}
        >
          <input
            type="checkbox"
            checked={picked}
            onChange={() => onToggle(symbol)}
            aria-label={`${symbol} in the loop`}
          />
          <span className="chordpick-word" aria-hidden="true">Loop</span>
        </label>
      )}
      {onRemove && (
        <button type="button" className="chordcard-remove" onClick={onRemove} aria-label={`Remove ${symbol}`} title={`Remove ${symbol}`}>
          <IconTrash size={12} />
        </button>
      )}
      <div className="chordcard-head">
        <span className="chordcard-name">{symbol}</span>
        {meta && (
          <span className="chordcard-meta readout" title={metaTitle ?? (typeof meta === 'string' ? meta : undefined)}>{meta}</span>
        )}
      </div>

      {voicing ? (
        <button
          type="button"
          className="chordcard-play"
          onClick={() => strum(voicing)}
          title={`Hear ${symbol} (${voicing.label})`}
          aria-label={`Hear ${symbol} strummed`}
        >
          <ChordDiagram frets={voicing.frets} fingers={voicing.fingers} scale={scale} />
          {/* Taken off when the animation says it is done, not on a timer: only
              one ring exists at a time, so the event always belongs to the one
              on screen. Left in place it would be an invisible element that
              never goes away. */}
          {strikes > 0 && (
            <span
              key={strikes}
              className="chordcard-ring"
              aria-hidden="true"
              onAnimationEnd={() => setStrikes(0)}
            />
          )}
        </button>
      ) : (
        <span className="chordcard-note">no shape stored</span>
      )}

      {voicing && (
        <span className={`chordcard-shape readout tier-${voicing.tier}`}>
          {voicing.substituteFor ? `${voicing.label} · for ${voicing.substituteFor}` : voicing.label}
        </span>
      )}

      {markable && <ComfortMark symbol={symbol} />}

      {footer}

      {shapes && all.length > 1 && (
        <button type="button" className="chordcard-more" onClick={() => setOpen(o => !o)} aria-expanded={open}>
          {open ? 'Hide shapes' : `${all.length} shapes`}
        </button>
      )}

      {shapes && open && (
        <div className="shapepick" role="radiogroup" aria-label={`Fingerings for ${symbol}`}>
          {all.map(v => (
            <button
              key={v.id}
              type="button"
              role="radio"
              aria-checked={v.id === chosenId}
              className={`shapepick-item${v.id === chosenId ? ' is-on' : ''}`}
              onClick={() => { strum(v); void setPreferredVoicing(symbol, v.id); }}
              title={`${v.substituteFor ? `${v.label} (instead of ${v.substituteFor})` : v.label}. Press to use it`}
            >
              <ChordDiagram frets={v.frets} fingers={v.fingers} scale={0.44} />
              <span className="shapepick-label readout">{v.label}</span>
              <span className={`shapepick-tier tier-${v.tier}`}>{v.tier}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default ChordCard;
