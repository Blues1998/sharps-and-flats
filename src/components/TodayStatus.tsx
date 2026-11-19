import React, { useEffect, useReducer, useRef, useState } from 'react';
import { minutesPractisedToday, streakState, today } from '../utils/library';
import { CLOCK_EVENT, GOAL_CHOICES, getGoal, setGoal } from '../utils/practiceClock';
import { STORE_CHANGE_EVENT } from '../utils/db';
import { setProfile, useProfile, type ProfileInstrument } from '../utils/profile';
import { MAX_RESTS, REST_EVERY } from '../utils/streak';
import { Segmented } from './Segmented';
import { GameShelf } from '../games/GameShelf';
import { gameOpen } from '../games/store';
import { LESSON_CLOSED, lessonOpen } from '../lesson/store';
import { answerOffer, goalOffer, offerShown, type GoalOffer } from '../utils/goalBump';
import { RiveStreak } from './RiveStreak';
import { StreakCelebration } from './StreakCelebration';

// The top bar on Today: what you are learning (a headstock badge) and today's
// minutes on the left; on the right the streak, its flame inside the goal ring. Tapping one
// opens a small panel right under the bar with its detail and, where there is
// one, its setting. Me lives in the tab bar, not here.
//
// Motion here is small and cheap, and nothing loops: the streak going up is
// shown once, big (StreakCelebration), then the flame sits still here; numbers tick only when they change, and the ring draws
// in once. All of it is transform and opacity on tiny elements, and the
// app-wide reduced-motion rule stills it.

const GOAL_SEEN = 'cadenza-goal-seen-today';
const STREAK_SHOWN = 'cadenza-streak-shown-on';
const RING_R = 22;
const RING_C = 2 * Math.PI * RING_R;

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

/** The instrument as a headstock, with its pegs: six for guitar, four for ukulele. */
const Headstock: React.FC<{ uke: boolean }> = ({ uke }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path className="tstat-head" d="M8.5 2h7l1.2 10.5h-9.4Z" />
    <rect className="tstat-head" x="10.6" y="12.5" width="2.8" height="10" rx="0.8" />
    {(uke ? [5, 10] : [4.5, 8, 11.5]).flatMap(y => [6, 18].map(x => <circle key={`${x}-${y}`} className="tstat-peg" cx={x} cy={y} r="1.4" />))}
  </svg>
);

// The drawn flame, for the unlit state and for when Rive cannot load: a soft
// glow, the flame and its hot core. Still, like everything in the top bar.
const FLAME = 'M12 1c1 4.5 6.5 7.5 6.5 14.2A6.5 6.5 0 0 1 12 27a6.5 6.5 0 0 1-6.5-6.8c0-3.4 1.9-5.4 3.3-7.2.3 2.2 1.2 3.4 2.4 3.9C10.6 12.5 10.4 6.6 12 1Z';
const CORE = 'M12 15.5c.6 2.2 3 3.4 3 6.2a3 3 0 0 1-6 0c0-1.7.9-2.8 1.7-3.6.2 1 .6 1.6 1.1 1.8-.3-1.6-.2-3 .2-4.4Z';
const Flame: React.FC<{ lit: boolean }> = ({ lit }) => (
  <span className={`tstat-flame-wrap${lit ? ' is-lit' : ''}`} aria-hidden="true">
    {lit && <span className="tstat-flame-glow" />}
    <svg className={`tstat-flame${lit ? ' is-lit' : ''}`} viewBox="0 0 24 28">
      <path d={FLAME} />
      {!lit && <path className="tstat-flame-core" d={CORE} />}
    </svg>
    {lit && <svg className="tstat-flame-hot" viewBox="0 0 24 28"><path d={CORE} /></svg>}
  </span>
);

export const TodayStatus: React.FC<{ className?: string }> = ({ className = '' }) => {
  const [, nudge] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    window.addEventListener(CLOCK_EVENT, nudge);
    window.addEventListener(STORE_CHANGE_EVENT, nudge);
    window.addEventListener(LESSON_CLOSED, nudge);
    return () => {
      window.removeEventListener(CLOCK_EVENT, nudge);
      window.removeEventListener(STORE_CHANGE_EVENT, nudge);
      window.removeEventListener(LESSON_CLOSED, nudge);
    };
  }, []);
  const profile = useProfile();
  // The flame is Rive's, with the number inside: grey until today's practice
  // lights it, orange after. The drawn one stands in if Rive cannot load.
  const [riveOk, setRiveOk] = useState(true);
  const flameRef = useRef<HTMLCanvasElement>(null);

  const s = streakState();
  const goal = getGoal();
  const mins = minutesPractisedToday();
  const met = mins >= goal;
  const playedToday = mins > 0 || s.restDays.includes(today());
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

  // The streak went up today: show it once, big, then let it land in the bar.
  // Waits, like the goal offer, until Today is what you are looking at.
  const [cele, setCele] = useState<number | null>(null);
  useEffect(() => {
    if (cele !== null || mins <= 0 || s.current < 1 || !riveOk) return;
    if (lessonOpen() || gameOpen() || document.visibilityState !== 'visible') return;
    // Today renders this bar twice (phone header, wide layout): only the one on screen celebrates.
    if (!barRef.current?.offsetParent) return;
    try {
      if (localStorage.getItem(STREAK_SHOWN) === today()) return;
      localStorage.setItem(STREAK_SHOWN, today());
    } catch { return; }
    setPop(null);
    setCele(s.current);
  }, [mins, s.current, riveOk]); // eslint-disable-line react-hooks/exhaustive-deps

  // A bigger goal, offered here once it is clearly too easy. Never over a
  // lesson or a game: it waits until Today is what you are looking at.
  const [offer, setOffer] = useState<GoalOffer | null>(null);
  useEffect(() => {
    if (pop || offer || cele !== null || lessonOpen() || gameOpen() || document.visibilityState !== 'visible') return;
    const o = goalOffer();
    if (!o) return;
    const b = goalRef.current?.getBoundingClientRect();
    const bar = barRef.current?.getBoundingClientRect();
    if (b && bar) setNotch(b.left + b.width / 2 - bar.left);
    offerShown(o);
    setOffer(o);
    setPop('bump');
  }, [mins, pop, offer, cele]);
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
      {/* Left: what you are learning, and how far into today's goal. */}
      <div className="tstat-left">
        <button type="button" className={`tstat-badge${pop === 'inst' ? ' is-open' : ''}`} onClick={toggle('inst')} aria-expanded={pop === 'inst'} aria-label={`Learning on ${instrument}`}>
          <Headstock uke={profile.instrument === 'ukulele'} />
        </button>
        <button type="button" ref={goalRef} className={`tstat-goaltext readout${met ? ' is-met' : ''}${minsTick ? ' is-tick' : ''}${pop === 'goal' || pop === 'bump' ? ' is-open' : ''}`} onClick={toggle('goal')} aria-expanded={pop === 'goal'} aria-label={`${mins} of ${goal} minutes today`}>
          {/* The real minutes, past the goal too. */}
          {met ? `goal met · ${mins} min` : `${mins} of ${goal} min`}
        </button>
      </div>
      {/* Right: the streak, its flame inside the goal ring. The ring fills with
          today's minutes; the flame lights once today's practice keeps the streak. */}
      <button type="button" className={`tstat-streak${playedToday ? ' is-lit' : ''}${met ? ' is-met' : ''}${pulse ? ' is-pulse' : ''}${ignite ? ' is-ignite' : ''}${pop === 'streak' ? ' is-open' : ''}`} onClick={toggle('streak')} aria-expanded={pop === 'streak'} aria-label={`${s.current} day streak, ${mins} of ${goal} minutes today`}>
        <span className={`tstat-streak-num readout${streakTick ? ' is-tick' : ''}`}>{s.current}</span>
        <span className="tstat-flamering">
          <svg className="tstat-ring" viewBox="0 0 52 52" aria-hidden="true">
            <circle cx="26" cy="26" r={RING_R} className="tstat-ring-track" />
            <circle cx="26" cy="26" r={RING_R} className="tstat-ring-fill" strokeDasharray={`${(drawn ? RING_C * Math.min(1, mins / goal) : 0).toFixed(1)} ${RING_C.toFixed(1)}`} transform="rotate(-90 26 26)" />
          </svg>
          {riveOk
            ? <RiveStreak streak={s.current} size={36} plain canvasRef={flameRef} className={cele !== null ? 'is-away' : ''} onFail={() => setRiveOk(false)} />
            : <Flame lit={playedToday} />}
        </span>
      </button>

      {cele !== null && <StreakCelebration to={cele} target={() => flameRef.current?.getBoundingClientRect() ?? null} onDone={() => setCele(null)} />}
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
