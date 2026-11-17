// The four ear games as tiles: at the top of Practice, and as small chips in
// the goal panel, so a few minutes of practice are always one tap away.

import React from 'react';
import { GAMES, gameBest } from './games';
import { startGame, useOpenGame } from './store';
import { feel } from '../utils/haptics';

export const GameShelf: React.FC<{ compact?: boolean; onPick?: () => void }> = ({ compact, onPick }) => {
  useOpenGame(); // redraw when a game closes, so a new best shows
  return (
  <div className={compact ? 'gm-chips' : 'gm-shelf'}>
    {GAMES.map(g => {
      const best = gameBest(g.id);
      return (
        <button key={g.id} type="button" className={compact ? 'gm-chip' : 'gm-tile'} data-feel="off"
          onClick={() => { feel('tap'); onPick?.(); startGame(g.id); }}>
          <span className="gm-tile-mark" aria-hidden="true">{g.mark}</span>
          <span className="gm-tile-text">
            <b>{g.name}</b>
            {!compact && <small>{best > 0 ? `Best ${best}` : g.blurb}</small>}
          </span>
        </button>
      );
    })}
  </div>
  );
};
