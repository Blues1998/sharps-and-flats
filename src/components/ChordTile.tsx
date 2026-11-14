import React from 'react';
import { ChordDiagram } from './ChordDiagram';
import { comfortOf, preferredVoicing, skillFor } from '../utils/chordbook';

interface ChordTileProps {
  symbol: string;
  /** One short line under the name: "4 songs", "added by you", a numeral. */
  meta?: string;
  /** In the loop being built, marked with a dot. */
  inLoop?: boolean;
  onOpen: (symbol: string) => void;
}

/**
 * One chord as a tile: the shape you play it with, its name, one line.
 *
 * Everything else a chord has (other shapes, the rating, the loop, removing
 * it) is one tap away in its sheet. A tile carries the rating as the colour
 * of its top edge, so a screen of them reads as a map of your hands.
 */
export const ChordTile: React.FC<ChordTileProps> = ({ symbol, meta, inLoop = false, onOpen }) => {
  const voicing = preferredVoicing(symbol);
  const state = skillFor(symbol) ? comfortOf(symbol) : 'unrated';
  return (
    <button
      type="button"
      className={`ctile is-${state}${inLoop ? ' is-looped' : ''}`}
      onClick={() => onOpen(symbol)}
      aria-label={`${symbol}${meta ? `, ${meta}` : ''}${inLoop ? ', in the loop' : ''}`}
    >
      {inLoop && <span className="ctile-loop" aria-hidden="true" />}
      {voicing ? (
        <ChordDiagram frets={voicing.frets} fingers={voicing.fingers} scale={0.5} />
      ) : (
        <span className="ctile-noshape">no shape</span>
      )}
      <span className="ctile-name">{symbol}</span>
      {meta && <span className="ctile-meta">{meta}</span>}
    </button>
  );
};

export default ChordTile;
