import React, { useEffect, useReducer } from 'react';
import { minutesPractisedToday, shiftIso, streakRepair, streakState, today } from '../utils/library';
import { XP_EVENT } from '../utils/xp';
import { CLOCK_EVENT, getGoal } from '../utils/practiceClock';
import { MAX_RESTS } from '../utils/streak';
import { useFeats } from '../utils/feats';
import { STORE_CHANGE_EVENT } from '../utils/db';
import { MUSIC_FONT } from '../utils/musicFont';

const Flame: React.FC<{ lit: boolean }> = ({ lit }) => (
  <svg className={`streak-flame${lit ? ' is-lit' : ''}`} viewBox="0 0 24 28" aria-hidden="true">
    <path d="M12 1c1 4.5 6.5 7.5 6.5 14.2A6.5 6.5 0 0 1 12 27a6.5 6.5 0 0 1-6.5-6.8c0-3.4 1.9-5.4 3.3-7.2.3 2.2 1.2 3.4 2.4 3.9C10.6 12.5 10.4 6.6 12 1Z" />
    <path className="streak-flame-core" d="M12 15.5c.6 2.2 3 3.4 3 6.2a3 3 0 0 1-6 0c0-1.7.9-2.8 1.7-3.6.2 1 .6 1.6 1.1 1.8-.3-1.6-.2-3 .2-4.4Z" />
  </svg>
);

/**
 * The top of Today: the streak, its rests, today's goal, and the newest pick.
 *
 * Read in one glance on opening the app: how many days in a row, whether today
 * has counted yet, and how far there is to go. The minutes are the ones the
 * app counted while you played, never typed in.
 */
export const StreakStrip: React.FC = () => {
  const [, nudge] = useReducer((n: number) => n + 1, 0);
  useFeats();
  useEffect(() => {
    window.addEventListener(CLOCK_EVENT, nudge);
    window.addEventListener(STORE_CHANGE_EVENT, nudge);
    window.addEventListener(XP_EVENT, nudge);
    return () => {
      window.removeEventListener(CLOCK_EVENT, nudge);
      window.removeEventListener(STORE_CHANGE_EVENT, nudge);
      window.removeEventListener(XP_EVENT, nudge);
    };
  }, []);

  const s = streakState();
  const goal = getGoal();
  const mins = minutesPractisedToday();
  const pct = Math.min(1, mins / goal);
  const met = mins >= goal;
  const restYesterday = s.restDays.includes(shiftIso(today(), -1));

  const r = 15;
  const c = 2 * Math.PI * r;

  const repair = streakRepair();

  const line = repair
    ? `Play ${goal * 2} min today to repair your ${repair.lost}-day streak.`
    : restYesterday
    ? 'A rest covered yesterday. Streak safe.'
    : s.current === 0
      ? 'Play today to start a streak.'
      : s.playedToday
        ? met ? 'Goal met. See you tomorrow.' : `${goal - mins} more min for today's goal.`
        : `Play today to make it ${s.current + 1}.`;

  return (
    <section className="streak" aria-label="Your streak and today's goal">
      <div className="streak-row">
        <div className="streak-days">
          <Flame lit={s.playedToday} />
          <span className="streak-n readout">{s.current}</span>
          <span className="streak-l">{s.current === 1 ? 'day' : 'days'}<br />in a row</span>
        </div>

        <div className="streak-goal" title={`Daily goal: ${goal} minutes`}>
          <svg viewBox="0 0 36 36" className={`streak-ring${met ? ' is-met' : ''}`} aria-hidden="true">
            <circle cx="18" cy="18" r={r} className="streak-ring-track" />
            <circle cx="18" cy="18" r={r} className="streak-ring-fill" strokeDasharray={`${pct * c} ${c}`} transform="rotate(-90 18 18)" />
          </svg>
          <span className="streak-goal-t"><b className="readout">{Math.min(mins, 999)}</b> of {goal} min<small>today</small></span>
        </div>

        <div className="streak-rests" title="A missed day uses a rest, and the streak carries on. One is earned every 7 days in a row.">
          <span className="streak-rest-glyphs" style={{ fontFamily: MUSIC_FONT }} aria-hidden="true">
            {Array.from({ length: MAX_RESTS }, (_, i) => <i key={i} className={i < s.rests ? 'is-on' : ''}>𝄽</i>)}
          </span>
          <small>{s.rests === 1 ? '1 rest' : `${s.rests} rests`}</small>
        </div>
      </div>
      <p className="streak-line">{line}</p>

    </section>
  );
};

export default StreakStrip;
