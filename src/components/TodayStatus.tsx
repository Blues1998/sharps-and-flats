import React, { useEffect, useReducer } from 'react';
import { minutesPractisedToday, streakState, today } from '../utils/library';
import { CLOCK_EVENT, getGoal } from '../utils/practiceClock';
import { STORE_CHANGE_EVENT } from '../utils/db';
import { useProfile } from '../utils/profile';
import { go } from '../hooks/useRoute';

// The top bar on Today, where the app name used to be: you, what you are
// learning, your streak, and how much of today's goal is done. Each opens Me,
// where the detail lives.

const openMe = () => {
  go({ tab: 'me', songId: null });
  requestAnimationFrame(() => document.getElementById('me-streak')?.scrollIntoView({ block: 'start' }));
};

const Guitar = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M19.5 2.5l2 2-3.2 3.2-2-2z" fill="currentColor" stroke="none" />
    <path d="M17.2 6.8l-5.6 5.6" />
    <path d="M10.6 9.2c-1.3-.6-2.9-.4-3.9.6-.8.8-.9 1.8-1.7 2.5-.9.8-2.6.6-3.3 1.9-.9 1.7.2 4.4 2.1 6.1 1.7 1.9 4.4 3 6.1 2.1 1.3-.7 1.1-2.4 1.9-3.3.7-.8 1.7-.9 2.5-1.7 1-1 1.2-2.6.6-3.9" />
    <circle cx="9.3" cy="14.7" r="1.6" />
  </svg>
);

const Flame: React.FC<{ lit: boolean }> = ({ lit }) => (
  <svg className={`tstat-flame${lit ? ' is-lit' : ''}`} viewBox="0 0 24 28" aria-hidden="true">
    <path d="M12 1c1 4.5 6.5 7.5 6.5 14.2A6.5 6.5 0 0 1 12 27a6.5 6.5 0 0 1-6.5-6.8c0-3.4 1.9-5.4 3.3-7.2.3 2.2 1.2 3.4 2.4 3.9C10.6 12.5 10.4 6.6 12 1Z" />
    <path className="tstat-flame-core" d="M12 15.5c.6 2.2 3 3.4 3 6.2a3 3 0 0 1-6 0c0-1.7.9-2.8 1.7-3.6.2 1 .6 1.6 1.1 1.8-.3-1.6-.2-3 .2-4.4Z" />
  </svg>
);

export const TodayStatus: React.FC<{ className?: string }> = ({ className = '' }) => {
  const [, nudge] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    window.addEventListener(CLOCK_EVENT, nudge);
    window.addEventListener(STORE_CHANGE_EVENT, nudge);
    return () => {
      window.removeEventListener(CLOCK_EVENT, nudge);
      window.removeEventListener(STORE_CHANGE_EVENT, nudge);
    };
  }, []);
  const profile = useProfile();

  const s = streakState();
  const goal = getGoal();
  const mins = minutesPractisedToday();
  const met = mins >= goal;
  const playedToday = mins > 0 || s.restDays.includes(today());
  const r = 9;
  const c = 2 * Math.PI * r;
  const instrument = profile.instrument === 'ukulele' ? 'Ukulele' : 'Guitar';

  return (
    <div className={`tstat ${className}`}>
      <button type="button" className="tstat-me" onClick={() => go({ tab: 'me', songId: null })} aria-label="Me">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="12" cy="8.5" r="3.8" /><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" />
        </svg>
      </button>
      <button type="button" className="tstat-item tstat-inst" onClick={openMe} aria-label={`Learning on ${instrument}`}>
        <Guitar /><span>{instrument}</span>
      </button>
      <button type="button" className={`tstat-item tstat-streak${playedToday ? ' is-lit' : ''}`} onClick={openMe} aria-label={`${s.current} day streak`}>
        <Flame lit={playedToday} /><span className="readout">{s.current}</span>
      </button>
      <button type="button" className={`tstat-item tstat-goal${met ? ' is-met' : ''}`} onClick={openMe} aria-label={`${Math.min(mins, goal)} of ${goal} minutes today`}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r={r} className="tstat-ring-track" />
          <circle cx="12" cy="12" r={r} className="tstat-ring-fill" strokeDasharray={`${(c * Math.min(1, mins / goal)).toFixed(1)} ${c.toFixed(1)}`} transform="rotate(-90 12 12)" />
        </svg>
        <span className="readout">{Math.min(mins, goal)}<small> / {goal} min</small></span>
      </button>
    </div>
  );
};

export default TodayStatus;
