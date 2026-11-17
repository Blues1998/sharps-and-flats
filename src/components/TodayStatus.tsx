import React, { useEffect, useReducer, useRef, useState } from 'react';
import { minutesPractisedToday, streakState, today } from '../utils/library';
import { CLOCK_EVENT, GOAL_CHOICES, getGoal, setGoal } from '../utils/practiceClock';
import { STORE_CHANGE_EVENT } from '../utils/db';
import { setProfile, useProfile, type ProfileInstrument } from '../utils/profile';
import { MAX_RESTS, REST_EVERY } from '../utils/streak';
import { go } from '../hooks/useRoute';
import { Segmented } from './Segmented';
import { GameShelf } from '../games/GameShelf';
import { gameOpen } from '../games/store';
import { lessonOpen } from '../lesson/store';
import { answerOffer, goalOffer, offerShown, type GoalOffer } from '../utils/goalBump';

// The top bar on Today, where the app name used to be: you, what you are
// learning, your streak, and how much of today's goal is done. Tapping one
// opens a small panel right under the bar with its detail and, where there is
// one, its setting. Only the person icon goes to Me.
//
// Motion here is small and cheap: the flame flickers only once today's
// practice has lit it, numbers tick only when they change, and the ring draws
// in once. All of it is transform and opacity on tiny elements, and the
// app-wide reduced-motion rule stills it.

const GOAL_SEEN = 'cadenza-goal-seen-today';

type Pop = 'inst' | 'streak' | 'goal' | 'bump';

/** True for a moment after `value` changes (not on first render): drives a one-off tick. */
function useChanged(value: number | boolean, ms = 700): boolean {
  const first = useRef(value);
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (value === first.current) return;
    first.current = value;
    setOn(true);
    const id = window.setTimeout(() => setOn(false), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return on;
}

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
  // The ring draws in from empty once, then follows the minutes.
  const [drawn, setDrawn] = useState(false);
  useEffect(() => { const id = requestAnimationFrame(() => setDrawn(true)); return () => cancelAnimationFrame(id); }, []);
  const ignite = useChanged(playedToday, 900);
  const streakTick = useChanged(s.current);
  const minsTick = useChanged(mins);
  const instrument = profile.instrument === 'ukulele' ? 'Ukulele' : 'Guitar';

  const [pop, setPop] = useState<Pop | null>(null);
  const [notch, setNotch] = useState(0);
  const barRef = useRef<HTMLDivElement>(null);
  const goalRef = useRef<HTMLButtonElement>(null);

  // A bigger goal, offered here once it is clearly too easy. Never over a
  // lesson or a game: it waits until Today is what you are looking at.
  const [offer, setOffer] = useState<GoalOffer | null>(null);
  useEffect(() => {
    if (pop || offer || lessonOpen() || gameOpen() || document.visibilityState !== 'visible') return;
    const o = goalOffer();
    if (!o) return;
    const b = goalRef.current?.getBoundingClientRect();
    const bar = barRef.current?.getBoundingClientRect();
    if (b && bar) setNotch(b.left + b.width / 2 - bar.left);
    offerShown(o);
    setOffer(o);
    setPop('bump');
  }, [mins, pop, offer]);
  const answer = (yes: boolean) => {
    if (!offer) return;
    answerOffer(offer, yes);
    if (yes) setGoal(offer.to);
    setPop(null);
  };
  const toggle = (which: Pop) => (e: React.MouseEvent<HTMLButtonElement>) => {
    if (pop === which) { setPop(null); return; }
    const b = e.currentTarget.getBoundingClientRect();
    const bar = barRef.current?.getBoundingClientRect();
    setNotch(bar ? b.left + b.width / 2 - bar.left : 0);
    setPop(which);
  };
  useEffect(() => {
    if (!pop) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setPop(null); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [pop]);

  // The goal met since you last looked at Today: the ring closes with a pulse,
  // once a day. The lab and the summary have already celebrated it; this ties
  // the minutes back to the page you return to.
  const [pulse, setPulse] = useState(false);
  useEffect(() => {
    if (!met) return;
    try {
      if (localStorage.getItem(GOAL_SEEN) === today()) return;
      localStorage.setItem(GOAL_SEEN, today());
    } catch { return; }
    setPulse(true);
    const id = window.setTimeout(() => setPulse(false), 1600);
    return () => window.clearTimeout(id);
  }, [met]);

  return (
    <div className={`tstat ${className}`} ref={barRef}>
      <button type="button" className="tstat-me" onClick={() => go({ tab: 'me', songId: null })} aria-label="Me">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="12" cy="8.5" r="3.8" /><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" />
        </svg>
      </button>
      <button type="button" className={`tstat-item tstat-inst${pop === 'inst' ? ' is-open' : ''}`} onClick={toggle('inst')} aria-expanded={pop === 'inst'} aria-label={`Learning on ${instrument}`}>
        <Guitar /><span>{instrument}</span>
      </button>
      <button type="button" className={`tstat-item tstat-streak${playedToday ? ' is-lit' : ''}${ignite ? ' is-ignite' : ''}${pop === 'streak' ? ' is-open' : ''}`} onClick={toggle('streak')} aria-expanded={pop === 'streak'} aria-label={`${s.current} day streak`}>
        <Flame lit={playedToday} /><span className={`readout${streakTick ? ' is-tick' : ''}`}>{s.current}</span>
      </button>
      <button type="button" ref={goalRef} className={`tstat-item tstat-goal${met ? ' is-met' : ''}${pulse ? ' is-pulse' : ''}${pop === 'goal' || pop === 'bump' ? ' is-open' : ''}`} onClick={toggle('goal')} aria-expanded={pop === 'goal'} aria-label={`${mins} of ${goal} minutes today`}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r={r} className="tstat-ring-track" />
          <circle cx="12" cy="12" r={r} className="tstat-ring-fill" strokeDasharray={`${(drawn ? c * Math.min(1, mins / goal) : 0).toFixed(1)} ${c.toFixed(1)}`} transform="rotate(-90 12 12)" />
        </svg>
        {/* The real minutes, past the goal too: 12 / 5 min, not 5 / 5. */}
        <span className={`readout${minsTick ? ' is-tick' : ''}`}>{mins}<small> / {goal} min</small></span>
      </button>

      {pop && <>
        <button type="button" className="tstat-scrim" aria-label="Close" onClick={() => setPop(null)} />
        <div className="tstat-pop" role="dialog" style={{ '--notch': `${notch}px` } as React.CSSProperties}>
          {pop === 'bump' && offer && <>
            <p className="tstat-pop-title">Daily goal</p>
            <p className="tstat-pop-big">Make it <b>{offer.to}</b> min a day?</p>
            <p className="tstat-pop-note">{offer.said} Your goal is {offer.from} min.</p>
            <div className="tstat-pop-actions">
              <button type="button" className="btn btn-primary" onClick={() => answer(true)}>Make it {offer.to} min</button>
              <button type="button" className="btn" onClick={() => answer(false)}>Keep {offer.from} min</button>
            </div>
          </>}
          {pop === 'inst' && <>
            <p className="tstat-pop-title">Learning on</p>
            <Segmented<ProfileInstrument>
              value={profile.instrument}
              onChange={instrument => setProfile({ instrument })}
              options={[{ value: 'guitar', label: 'Guitar' }, { value: 'ukulele', label: 'Ukulele' }]}
              ariaLabel="Instrument"
              full
            />
            <p className="tstat-pop-note">Lessons, chords and the tuner follow this.</p>
          </>}
          {pop === 'streak' && <>
            <p className="tstat-pop-big"><b>{s.current}</b> {s.current === 1 ? 'day' : 'days'} in a row</p>
            <p className="tstat-pop-note">
              {s.current === 0 ? 'Play today to start one.'
                : s.playedToday ? 'Played today. Come back tomorrow.'
                : `Play today to make it ${s.current + 1}.`}
              {s.longest > s.current && ` Best: ${s.longest}.`}
            </p>
            <div className="tstat-pop-rests">
              <span aria-hidden="true">{Array.from({ length: MAX_RESTS }, (_, i) => <i key={i} className={i < s.rests ? 'is-on' : ''}>𝄽</i>)}</span>
              <span>{s.rests} of {MAX_RESTS} rests. A missed day uses one. You earn one every {REST_EVERY} days.</span>
            </div>
          </>}
          {pop === 'goal' && <>
            <p className="tstat-pop-big"><b>{mins}</b> of {goal} min today</p>
            <p className="tstat-pop-note">{met ? 'Goal met.' : `${goal - mins} min to go.`}</p>
            <p className="tstat-pop-title">Daily goal</p>
            <Segmented<number>
              value={goal}
              onChange={g => setGoal(g)}
              options={GOAL_CHOICES.map(g => ({ value: g, label: `${g} min` }))}
              ariaLabel="Daily goal"
              full
            />
            {!met && <>
              <p className="tstat-pop-title">A quick way in</p>
              <GameShelf compact onPick={() => setPop(null)} />
            </>}
            <details className="tstat-counts">
              <summary>What counts</summary>
              <p>Time counts while you play, with the app open: lessons, songs, ear games, ear training, challenges, the metronome, loops, chord checks and both tuners.</p>
              <p>Anything that listens counts only while it hears you. After ten minutes without a tap the app asks if you are still playing.</p>
            </details>
          </>}
        </div>
      </>}
    </div>
  );
};

export default TodayStatus;
