// An ear game, run over the app like a lesson: hear it, tap an answer, keep
// going until three strikes. Right answers move straight on; a wrong one
// plays your pick and then the right one, and waits for you.
//
// The score is a count of right answers; the level climbs every five. The
// time counts toward today's goal like any other practice.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { GAMES, LEVELS, PER_LEVEL, STRIKES, gameBest, gameDef, levelFor, ordered, saveGameBest } from './games';
import type { GameId, Round } from './games';
import { closeGame, startGame, useOpenGame } from './store';
import { Player } from '../lesson/Player';
import { playOne } from '../lesson/nowPlaying';
import { soundLength } from '../lesson/sound';
import { usePracticeTime } from '../hooks/usePracticeTime';
import { feel } from '../utils/haptics';
import { hitChime, missChime } from '../utils/chime';
import { reportProgress } from '../utils/progress';
import { useBackToClose } from '../utils/nativeShell';
import { getGoal, secondsOn, CLOCK_EVENT } from '../utils/practiceClock';

// ---- Small pieces ---------------------------------------------------------------------

const STOP = <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor" /></svg>;
/** A plectrum: one per strike left. */
const Pick: React.FC<{ on: boolean }> = ({ on }) => (
  <svg className={`gm-pick${on ? '' : ' is-gone'}`} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 21.5c-1.4 0-7.5-8.3-7.5-12.6C4.5 4.9 8 2.5 12 2.5s7.5 2.4 7.5 6.4c0 4.3-6.1 12.6-7.5 12.6z" />
  </svg>
);

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// ---- The game -------------------------------------------------------------------------

const Game: React.FC<{ id: GameId }> = ({ id }) => {
  const def = gameDef(id);
  const [right, setRight] = useState(0);
  const [strikes, setStrikes] = useState(0);
  const [round, setRound] = useState<Round>(() => def.round(1));
  const [n, setN] = useState(0);
  const [chosen, setChosen] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [best] = useState(() => gameBest(id));
  const [newBest, setNewBest] = useState(false);
  const startedAt = useRef(performance.now());
  const [secs, setSecs] = useState(0);
  const level = levelFor(right);
  const [levelUp, setLevelUp] = useState(false);

  usePracticeTime('game', !over);
  useBackToClose(true, closeGame);

  const next = useCallback((lv: number) => {
    setRound(def.round(lv));
    setChosen(null);
    setN(k => k + 1);
  }, [def]);

  const finish = useCallback(() => {
    setSecs(Math.round((performance.now() - startedAt.current) / 1000));
    setNewBest(saveGameBest(id, right));
    setOver(true);
    feel('nudge');
  }, [id, right]);

  const answer = (label: string) => {
    if (chosen) return;
    setChosen(label);
    if (label === round.answer) {
      feel('success');
      hitChime('great', 76);
      if (id === 'interval') reportProgress('ear-interval-correct');
      if (id === 'chord') reportProgress('ear-chord-correct');
      const r = right + 1;
      setRight(r);
      const up = levelFor(r) > levelFor(right);
      if (up) setLevelUp(true);
      window.setTimeout(() => { setLevelUp(false); next(levelFor(r)); }, up ? 1700 : 1100);
    } else {
      feel('error');
      missChime(60);
      setStrikes(s => s + 1);
      const yours = round.options.find(o => o.label === label)?.hear;
      const theirs = round.options.find(o => o.label === round.answer)?.hear;
      if (yours && theirs) window.setTimeout(() => playOne({ kind: 'seq', parts: [yours, theirs], gap: soundLength(yours) + 0.3 }), 600);
    }
  };

  const wrong = chosen !== null && chosen !== round.answer;
  const out = strikes >= STRIKES;
  const opts = ordered(id, round.options);

  if (over) return <Over id={id} right={right} best={best} newBest={newBest} level={level} secs={secs} />;

  return (
    <>
      <header className="lp-top gm-top">
        <button type="button" className="lp-stop" onClick={() => { feel('select'); finish(); }} aria-label="End the game" data-feel="off">{STOP}</button>
        <span className="gm-level">Level {level}<small> of {LEVELS}</small></span>
        <span className="gm-picks" aria-label={`${STRIKES - strikes} strikes left`}>{Array.from({ length: STRIKES }, (_, i) => <Pick key={i} on={i < STRIKES - strikes} />)}</span>
        <span className="gm-score readout" aria-label={`${right} right`}>{right}</span>
      </header>

      <main className="lp-body gm-body" key={n}>
        <span className="gm-kicker">{def.name}</span>
        <h2>{round.prompt}</h2>
        <div className="lp-prompt"><Player sound={round.sound} size="big" auto /><span>Play it again as often as you like</span></div>
        <div className={`gm-opts${opts.length > 4 ? ' is-many' : ''}`}>
          {opts.map(o => {
            const st = chosen === null ? '' : o.label === round.answer ? ' is-right' : o.label === chosen ? ' is-wrong' : ' is-out';
            return (
              <button key={o.label} type="button" className={`gm-opt${st}`} data-feel="off"
                data-correct={import.meta.env.DEV ? o.label === round.answer : undefined}
                onClick={() => (chosen ? playOne(o.hear) : answer(o.label))}>
                {o.label}
              </button>
            );
          })}
        </div>
        {chosen && (
          <p className={`gm-say${wrong ? ' is-wrong' : ''}`} role="status">
            <b>{wrong ? `It was ${round.answer}.` : 'Yes.'}</b> {round.say}
            {wrong && <small>Tap any answer to hear it again.</small>}
          </p>
        )}
        {levelUp && <div className="gm-up" role="status">Level {level}</div>}
      </main>

      <footer className="lp-foot">
        {wrong
          ? <button type="button" className="lp-btn" onClick={() => { feel('tap'); if (out) finish(); else next(level); }} data-feel="off">{out ? 'See your score' : 'Next'}</button>
          : <span className="lp-hint">{chosen ? ' ' : `${PER_LEVEL - (right % PER_LEVEL)} more to level ${Math.min(LEVELS, level + 1)}`}</span>}
      </footer>
    </>
  );
};

const Over: React.FC<{ id: GameId; right: number; best: number; newBest: boolean; level: number; secs: number }> = ({ id, right, best, newBest, level, secs }) => {
  const def = gameDef(id);
  const [, nudge] = useState(0);
  useEffect(() => {
    const f = () => nudge(x => x + 1);
    window.addEventListener(CLOCK_EVENT, f);
    return () => window.removeEventListener(CLOCK_EVENT, f);
  }, []);
  const mins = Math.floor(secondsOn(todayIso()) / 60);
  const goal = getGoal();
  const others = GAMES.filter(g => g.id !== id);
  return (
    <div className="lp-take gm-over">
      <span className="lp-take-kicker">{def.name}</span>
      <h2>{right === 0 ? 'Warming up' : newBest ? 'New best' : `${right} right`}</h2>
      <div className="gm-big readout">{right}</div>
      <dl className="lp-facts">
        <div><dt>Best</dt><dd>{Math.max(best, right)}</dd></div>
        <div><dt>Level</dt><dd>{level}</dd></div>
        <div><dt>Time</dt><dd>{Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}</dd></div>
      </dl>
      <p className="gm-goal">{mins >= goal ? `Today's goal is done: ${mins} min.` : `Today: ${mins} of ${goal} min.`}</p>
      <button type="button" className="lp-btn" onClick={() => { feel('tap'); closeGame(); window.setTimeout(() => startGame(id), 0); }} data-feel="off">Play again</button>
      <div className="gm-more">
        {others.map(g => (
          <button key={g.id} type="button" onClick={() => { feel('tap'); closeGame(); window.setTimeout(() => startGame(g.id), 0); }} data-feel="off">
            <span aria-hidden="true">{g.mark}</span>{g.name}
          </button>
        ))}
      </div>
      <button type="button" className="lp-btn is-quiet" onClick={() => { feel('tap'); closeGame(); }} data-feel="off">Done</button>
    </div>
  );
};

/** The open game, if any, over everything else. */
export const GamePlayer: React.FC = () => {
  const id = useOpenGame();
  useEffect(() => {
    if (!id) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [id]);
  if (!id) return null;
  return createPortal(
    <div className="lp gm" role="dialog" aria-modal="true" aria-label={gameDef(id).name}>
      <Game key={id} id={id} />
    </div>,
    document.body
  );
};
