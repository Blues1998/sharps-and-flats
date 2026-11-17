import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { closeLesson, restartLesson, useOpenLesson } from './store';
import { lessonFor } from './lessons';
import type { ChooseOption, Exercise, Lesson } from './lessons';
import { appSounding, audioNow, hush, playSound, soundLength, startClicks } from './sound';
import type { Sound } from './sound';
import { useMicPitch } from '../hooks/useMicPitch';
import { feel } from '../utils/haptics';
import { hitChime, missChime } from '../utils/chime';
import { audio } from '../utils/audio';
import { getProgressCount, reportProgress } from '../utils/progress';
import { useHoldUnlocks } from '../utils/feats';
import { useBackToClose } from '../utils/nativeShell';

// A lesson, run like a short session with a teacher.
//
// Progress is written as notation: one notehead per exercise on a staff line,
// filled as each one goes. Answers sit in a list with a fret dot each. After
// Check, the verdict appears in place, under the question, with the reason.
// The lesson ends as a "take": graded, played back as a phrase on a staff
// (one note per exercise, coloured by how it went), with one line to remember.
//
// Scoring is one outcome per exercise:
//   first    right first time          counts toward accuracy, as right
//   second   right on the retry        counts toward accuracy, as a miss
//   missed   wrong twice               counts toward accuracy, as a miss
//   skipped  "Skip for now" on a guitar part: not scored, and the lesson
//            does not complete its step until it has been played
//   seen     a teach card
// Accuracy is first-time answers out of the exercises attempted. To pass, and
// complete the step, nothing may be skipped and at least half the exercises
// must end right, first time or on the retry. Rewards follow real skill.

type Outcome = 'first' | 'second' | 'missed' | 'skipped' | 'seen';
type Verdict = { ok: boolean; answer?: string; explain?: string };
interface Entry { key: number; ex: Exercise; attempt: 1 | 2 }

const NOTE = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const PRAISE = ['Right.', 'Yes, that is it.', 'Spot on.', 'Exactly.', 'Well heard.'];
const KIND: Record<Exercise['type'], string> = { teach: 'New idea', choose: 'Listen', play: 'Play', tap: 'Rhythm' };

// ---- Small pieces ----------------------------------------------------------------

const Icon = {
  stop: <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor" /></svg>,
  play: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.3 5.8v12.4a.8.8 0 0 0 1.2.7l9.6-6.2a.8.8 0 0 0 0-1.4L8.5 5.1a.8.8 0 0 0-1.2.7z" fill="currentColor" /></svg>,
  check: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7" /></svg>,
  cross: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" /></svg>,
  idea: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.4 1 1.1 1 1.8V16h5v-.3c0-.7.4-1.4 1-1.8A6 6 0 0 0 12 3z" /></svg>,
  ear: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M7 9a5 5 0 1 1 10 0c0 3-3 3.5-3 6.5a3 3 0 0 1-5.5 1.7" /><path d="M10 9.5a2 2 0 1 1 3.5 1.3" /></svg>,
  guitar: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true"><path d="M17.2 6.8l-5.6 5.6M19.5 2.5l2 2-3.2 3.2-2-2z" /><path d="M10.6 9.2c-1.3-.6-2.9-.4-3.9.6-.8.8-.9 1.8-1.7 2.5-.9.8-2.6.6-3.3 1.9-.9 1.7.2 4.4 2.1 6.1 1.7 1.9 4.4 3 6.1 2.1 1.3-.7 1.1-2.4 1.9-3.3.7-.8 1.7-.9 2.5-1.7 1-1 1.2-2.6.6-3.9" /><circle cx="9.3" cy="14.7" r="1.6" /></svg>,
  beat: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 21h8l-2.5-17h-3z" /><path d="M12 14l5-7" /></svg>,
};
const KIND_ICON: Record<Exercise['type'], React.ReactNode> = { teach: Icon.idea, choose: Icon.ear, play: Icon.guitar, tap: Icon.beat };

/** Plays a sound, and shows it playing with a ring that runs for its length. */
const Player: React.FC<{ sound: Sound; size?: 'big' | 'small'; label?: string; auto?: boolean }> = ({ sound, size = 'small', label, auto }) => {
  const [run, setRun] = useState(0);
  const [on, setOn] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const len = soundLength(sound);
  const go = useCallback(() => {
    playSound(sound);
    setOn(true);
    setRun(r => r + 1);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOn(false), len * 1000);
  }, [sound, len]);
  useEffect(() => {
    if (!auto) return;
    const id = window.setTimeout(go, 380);
    return () => window.clearTimeout(id);
  }, [auto, go]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <button type="button" className={`lp-player is-${size}${on ? ' is-on' : ''}`} onClick={e => { e.stopPropagation(); feel('tap'); go(); }} data-feel="off" aria-label={label ? `Play ${label}` : 'Play the sound'}>
      <span className="lp-player-disc" style={{ ['--len' as string]: `${len}s` } as React.CSSProperties} key={run}>
        {on ? <span className="lp-eq" aria-hidden="true"><i /><i /><i /><i /></span> : Icon.play}
      </span>
      {label && <span className="lp-player-label">{label}</span>}
    </button>
  );
};

/** A fret dot: the radio for an answer, filled like a note on the neck. */
const Dot: React.FC<{ state: 'idle' | 'sel' | 'right' | 'wrong' }> = ({ state }) => (
  <span className={`lp-dot is-${state}`} aria-hidden="true">{state === 'right' ? Icon.check : state === 'wrong' ? Icon.cross : null}</span>
);

// ---- Exercises -------------------------------------------------------------------

interface ExProps<E extends Exercise['type']> {
  ex: Extract<Exercise, { type: E }>;
  verdict: Verdict | null;
  onVerdict: (v: Verdict) => void;
  setFoot: (n: React.ReactNode) => void;
}

const Teach: React.FC<ExProps<'teach'> & { onNext: () => void }> = ({ ex, onNext, setFoot }) => {
  useEffect(() => {
    setFoot(<button type="button" className="lp-btn" onClick={() => { feel('tap'); onNext(); }} data-feel="off">Got it</button>);
  }, [setFoot, onNext]);
  return (
    <div className="lp-teach">
      <h2>{ex.title}</h2>
      <p>{ex.body}</p>
      {ex.chips && (
        <div className="lp-chips">
          {ex.chips.map((c, i) => <span key={i}><b>{c.name}</b>{c.where && <small>{c.where}</small>}</span>)}
        </div>
      )}
      {ex.sounds && <div className="lp-players">{ex.sounds.map((s, i) => <Player key={i} sound={s.sound} label={s.label} />)}</div>}
    </div>
  );
};

const Choose: React.FC<ExProps<'choose'>> = ({ ex, verdict, onVerdict, setFoot }) => {
  const [sel, setSel] = useState<number | null>(null);
  const right = ex.options.findIndex(o => o.correct);
  const check = useCallback(() => {
    if (sel === null) return;
    onVerdict({ ok: sel === right, answer: ex.options[right]?.label, explain: ex.explain });
  }, [sel, right, ex, onVerdict]);
  useEffect(() => {
    if (verdict) return;
    setFoot(<button type="button" className="lp-btn" disabled={sel === null} onClick={() => { feel('tap'); check(); }} data-feel="off">Check</button>);
  }, [setFoot, sel, check, verdict]);

  const stateOf = (i: number): 'idle' | 'sel' | 'right' | 'wrong' =>
    verdict ? (i === right ? 'right' : i === sel ? 'wrong' : 'idle') : i === sel ? 'sel' : 'idle';
  const choose = (i: number, o: ChooseOption) => {
    if (verdict) return;
    feel('select');
    setSel(i);
    if (o.sound) playSound(o.sound);
  };
  const dev = import.meta.env.DEV;

  return (
    <div className="lp-choose">
      <h2>{ex.prompt}</h2>
      {ex.sound && <div className="lp-prompt"><Player sound={ex.sound} size="big" auto /><span>Play it again as often as you like</span></div>}
      {ex.options.some(o => o.sound) ? (
        <div className="lp-pairs">
          {ex.options.map((o, i) => (
            <div key={i} role="radio" aria-checked={sel === i} tabIndex={0} data-correct={dev ? !!o.correct : undefined}
              className={`lp-pair is-${stateOf(i)}`} onClick={() => choose(i, o)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') choose(i, o); }}>
              <Dot state={stateOf(i)} />
              {o.sound && <Player sound={o.sound} />}
              <span className="lp-pair-label">{o.label}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="lp-list" role="radiogroup">
          {ex.options.map((o, i) => (
            <button key={i} type="button" role="radio" aria-checked={sel === i} data-correct={dev ? !!o.correct : undefined}
              className={`lp-row is-${stateOf(i)}`} disabled={!!verdict} onClick={() => choose(i, o)} data-feel="off">
              <Dot state={stateOf(i)} /><span>{o.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const Play: React.FC<ExProps<'play'> & { onSkip: () => void }> = ({ ex, verdict, onVerdict, onSkip, setFoot }) => {
  const mic = useMicPitch('instrument');
  const [at, setAt] = useState(0);
  const [tick, nudge] = useState(0);
  const holdFrom = useRef<number | null>(null);
  const tol = ex.tolerance ?? 35;
  const hold = ex.holdMs ?? 300;
  const { start, stop } = mic;

  useEffect(() => { void start(); return () => stop(); }, [start, stop]);
  useEffect(() => {
    if (verdict) return;
    setFoot(<button type="button" className="lp-btn is-quiet" onClick={() => { stop(); onSkip(); }} data-feel="off">No guitar right now? Skip for now</button>);
  }, [setFoot, onSkip, stop, verdict]);

  // While the app is playing (the example, the chime), the mic hears the
  // phone's own speaker. None of that counts; only what you play does.
  const [quiet, setQuiet] = useState(appSounding);
  useEffect(() => {
    const id = window.setInterval(() => setQuiet(appSounding()), 100);
    return () => window.clearInterval(id);
  }, []);
  const p = quiet ? null : mic.pitch;
  const pcOf = (m: number) => ((m % 12) + 12) % 12;
  const target = ex.notes[at];
  const onNote = !!p && (target === -1 || pcOf(p.midi) === target);
  const hit = onNote && Math.abs(p!.cents) <= tol;

  useEffect(() => {
    if (verdict || at >= ex.notes.length) return;
    if (!hit) { holdFrom.current = null; return; }
    const now = performance.now();
    if (holdFrom.current === null) holdFrom.current = now;
    const waited = now - holdFrom.current;
    if (waited < hold) {
      const id = window.setTimeout(() => nudge(x => x + 1), hold - waited + 10);
      return () => window.clearTimeout(id);
    }
    holdFrom.current = null;
    hitChime('great', p!.midi + 12);
    hush(1200);
    feel('success');
    const next = at + 1;
    setAt(next);
    if (next >= ex.notes.length) {
      stop();
      onVerdict({ ok: true });
    }
  }, [p, at, hit, verdict, tick, hold, ex.notes.length, onVerdict, stop]);

  const heard = p ? NOTE[pcOf(p.midi)] : null;
  const cents = p && onNote && target !== -1 ? Math.max(-50, Math.min(50, p.cents)) : null;

  return (
    <div className="lp-play">
      <h2>{ex.prompt}</h2>
      <p className="lp-detail">{ex.detail}</p>
      <div className="lp-targets">
        {ex.names.map((n, i) => (
          <span key={i} className={`lp-target${i < at ? ' is-done' : i === at ? ' is-now' : ''}${i === at && hit ? ' is-hit' : ''}`}>
            <b>{n.name}</b>{n.where && <small>{n.where}</small>}
          </span>
        ))}
      </div>
      <div className={`lp-ear${mic.isActive && !quiet ? ' is-on' : ''}`}>
        <div className="lp-ear-note">
          <small>{mic.error ? 'Mic off' : !mic.isActive ? 'Starting the mic' : quiet ? 'Paused' : 'Hearing'}</small>
          <b>{heard ?? '·'}</b>
        </div>
        <div className="lp-meter" aria-hidden="true">
          <i className="lp-meter-zone" style={{ width: `${tol}%`, left: `${50 - tol / 2}%` }} />
          {cents !== null && <i className={`lp-meter-needle${hit ? ' is-hit' : ''}`} style={{ left: `${50 + cents}%` }} />}
          <span>flat</span><span>sharp</span>
        </div>
        <p className="lp-ear-say">
          {mic.error ? 'Allow the mic in your phone\'s settings, or skip for now.'
            : quiet ? 'Listening again once the sound stops.'
            : !p ? 'Play when you are ready.'
            : hit ? 'Hold it…'
            : onNote ? (p.cents > 0 ? 'Right note, a touch sharp.' : 'Right note, a touch flat.')
            : `That is ${heard}. Looking for ${target === -1 ? 'any note' : NOTE[target]}.`}
        </p>
      </div>
      {ex.hear && <div className="lp-players"><Player sound={ex.hear} label="Hear how it goes" /></div>}
    </div>
  );
};

const Tap: React.FC<ExProps<'tap'>> = ({ ex, verdict, onVerdict, setFoot }) => {
  const COUNT_IN = 4;
  const [t0, setT0] = useState<number | null>(null);
  const [taps, setTaps] = useState<number[]>([]);
  const [beatNow, setBeatNow] = useState(-1);
  const beat = 60 / ex.bpm;

  const begin = useCallback(() => {
    feel('tap');
    setTaps([]);
    setT0(startClicks(ex.bpm, COUNT_IN + ex.taps + 1));
  }, [ex.bpm, ex.taps]);

  useEffect(() => {
    if (verdict) return;
    setFoot(t0 === null
      ? <button type="button" className="lp-btn" onClick={begin} data-feel="off">Start the click</button>
      : <span className="lp-hint">{beatNow < COUNT_IN ? 'Count in: listen' : `${Math.max(0, ex.taps - taps.length)} to go`}</span>);
  }, [setFoot, t0, begin, taps.length, ex.taps, beatNow, verdict]);

  useEffect(() => {
    if (t0 === null) return;
    let raf = 0;
    const loop = () => { setBeatNow(Math.floor((audioNow() - t0) / beat)); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [t0, beat]);

  const tap = () => {
    if (t0 === null || verdict || taps.length >= ex.taps) return;
    const at = audioNow() - t0;
    if (at < (COUNT_IN - 0.5) * beat) return; // the count-in is for listening
    const nearest = Math.max(COUNT_IN, Math.round(at / beat));
    const off = (at - nearest * beat) * 1000;
    feel('select');
    const next = [...taps, off];
    setTaps(next);
    if (next.length >= ex.taps) {
      const good = next.filter(o => Math.abs(o) <= ex.windowMs).length;
      const late = next.filter(o => o > ex.windowMs).length;
      const early = next.filter(o => o < -ex.windowMs).length;
      const lean = late > early ? 'Most misses were late: tap as the click sounds, not after it.' : early > late ? 'Most misses were early: let the click come to you.' : '';
      window.setTimeout(() => onVerdict(good >= ex.need
        ? { ok: true, explain: `${good} of ${ex.taps} on the beat.` }
        : { ok: false, answer: `${good} of ${ex.taps} on the beat, ${ex.need} needed.`, explain: lean || 'Listen to the count-in, then move with it.' }), 350);
    }
  };

  return (
    <div className="lp-tap">
      <h2>{ex.prompt}</h2>
      <p className="lp-detail">{ex.detail}</p>
      <div className="lp-count" aria-hidden="true">
        {Array.from({ length: 4 }, (_, k) => <i key={k} className={t0 !== null && beatNow >= 0 && beatNow % 4 === k ? 'is-on' : ''} />)}
      </div>
      <button type="button" className={`lp-pad${t0 !== null ? ' is-live' : ''}`} onPointerDown={tap} disabled={t0 === null} data-feel="off" key={beatNow}>
        <span>{t0 === null ? 'Tap pad' : beatNow < COUNT_IN ? `${Math.max(1, beatNow + 1)}` : 'Tap'}</span>
      </button>
      <div className="lp-taps" aria-label={`${taps.length} of ${ex.taps} taps`}>
        {Array.from({ length: ex.taps }, (_, i) => {
          const o = taps[i];
          const cls = o === undefined ? '' : Math.abs(o) <= ex.windowMs ? ' is-good' : o > 0 ? ' is-late' : ' is-early';
          return <i key={i} className={cls} />;
        })}
      </div>
    </div>
  );
};

// ---- The take --------------------------------------------------------------------

const STAFF_MIDI = [60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79];

const passes = (outcomes: Outcome[]): boolean => {
  const graded = outcomes.filter(o => o && o !== 'seen');
  if (graded.includes('skipped')) return false;
  if (graded.length === 0) return true;
  return graded.filter(o => o === 'first' || o === 'second').length / graded.length >= 0.5;
};

const Take: React.FC<{ lesson: Lesson; outcomes: Outcome[]; secs: number; take: number; complete: boolean }> = ({ lesson, outcomes, secs, take, complete }) => {
  const graded = useMemo(() => outcomes.filter(o => o && o !== 'seen'), [outcomes]);
  const attempted = graded.filter(o => o !== 'skipped');
  const first = graded.filter(o => o === 'first').length;
  const acc = attempted.length ? first / attempted.length : null;
  const skipped = graded.includes('skipped');
  const grade = skipped ? 'Unfinished take' : !complete ? 'Not there yet' : acc === null || acc >= 0.9 ? 'Clean take' : acc >= 0.6 ? 'Solid take' : 'Rough take';
  const [shown, setShown] = useState(0);

  // The phrase plays back as the notes appear: right notes ring, misses are muted.
  useEffect(() => {
    if (shown >= graded.length) return;
    const id = window.setTimeout(() => {
      const o = graded[shown];
      const m = STAFF_MIDI[shown % STAFF_MIDI.length];
      if (o === 'first') audio.playMidi(m, 1.1);
      else if (o === 'second') audio.playMidi(m, 0.6);
      else audio.playMuted();
      setShown(n => n + 1);
    }, shown === 0 ? 500 : 190);
    return () => window.clearTimeout(id);
  }, [shown, graded]);

  useEffect(() => { feel(complete ? 'celebrate' : 'nudge'); }, [complete]);

  const W = 300;
  const gap = Math.min(34, (W - 56) / Math.max(1, graded.length));
  const used = new Set(graded);
  return (
    <div className="lp-take">
      <span className="lp-take-kicker">Take {take} · {lesson.title}</span>
      <h2>{grade}</h2>
      <svg className="lp-staff" viewBox={`0 0 ${W} 100`} role="img" aria-label={`${first} of ${attempted.length} right first time`}>
        {[0, 1, 2, 3, 4].map(k => <line key={k} x1="0" x2={W} y1={22 + k * 14} y2={22 + k * 14} />)}
        <text x="2" y="72" className="lp-clef">𝄞</text>
        {graded.slice(0, shown).map((o, i) => {
          const x = 52 + i * gap;
          const y = 80 - (i % STAFF_MIDI.length) * 5.4;
          return (
            <g key={i} className={`lp-note is-${o}`}>
              <ellipse cx={x} cy={y} rx="6.4" ry="4.8" transform={`rotate(-20 ${x} ${y})`} />
              <line x1={x + 5.8} x2={x + 5.8} y1={y - 1} y2={y - 27} />
            </g>
          );
        })}
      </svg>
      <div className="lp-legend">
        {used.has('first') && <span className="is-first">Right first time</span>}
        {used.has('second') && <span className="is-second">Second try</span>}
        {used.has('missed') && <span className="is-missed">Missed</span>}
        {used.has('skipped') && <span className="is-skipped">Skipped</span>}
      </div>
      <dl className="lp-facts">
        <div><dt>First time</dt><dd>{attempted.length ? `${first} of ${attempted.length}` : 'None tried'}</dd></div>
        <div><dt>Time</dt><dd>{Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}</dd></div>
        <div><dt>XP</dt><dd>{complete && take === 1 ? '+20' : '0'}</dd></div>
      </dl>
      {complete ? (
        <div className="lp-recap"><small>Keep this</small><p>{lesson.recap}</p></div>
      ) : skipped ? (
        <div className="lp-recap is-open"><small>Not finished yet</small><p>The guitar parts you skipped are still open. Play them to finish this step.</p></div>
      ) : (
        <div className="lp-recap is-open"><small>One more take</small><p>Fewer than half came out right, so this step stays open. Go again: the questions change each time.</p></div>
      )}
      {!complete && <button type="button" className="lp-btn" onClick={() => { feel('tap'); restartLesson(); }} data-feel="off">Try again</button>}
      <button type="button" className={`lp-btn${complete ? '' : ' is-quiet'}`} onClick={() => { feel('tap'); closeLesson(); }} data-feel="off">Back to the neck</button>
    </div>
  );
};

// ---- The run ---------------------------------------------------------------------

interface RunState { queue: Entry[]; at: number; outcomes: Outcome[]; verdict: Verdict | null; done: boolean }
type Action = { type: 'verdict'; v: Verdict } | { type: 'skip' } | { type: 'seen' } | { type: 'next' };

const advance = (s: RunState): RunState =>
  s.at + 1 >= s.queue.length ? { ...s, verdict: null, done: true } : { ...s, at: s.at + 1, verdict: null };

function reduce(s: RunState, a: Action): RunState {
  const e = s.queue[s.at];
  const outcomes = [...s.outcomes];
  switch (a.type) {
    case 'verdict': {
      if (s.verdict) return s;
      let queue = s.queue;
      if (a.v.ok) outcomes[e.key] = e.attempt === 1 ? 'first' : 'second';
      else {
        outcomes[e.key] = 'missed';
        if (e.attempt === 1) queue = [...queue, { ...e, attempt: 2 }];
      }
      return { ...s, queue, outcomes, verdict: a.v };
    }
    case 'skip': outcomes[e.key] = 'skipped'; return advance({ ...s, outcomes });
    case 'seen': outcomes[e.key] = 'seen'; return advance({ ...s, outcomes });
    case 'next': return advance(s);
  }
}

const Run: React.FC<{ lesson: Lesson }> = ({ lesson }) => {
  const first = useMemo(() => lesson.build(), [lesson]);
  const [s, dispatch] = useReducer(reduce, undefined, (): RunState => ({
    queue: first.map((ex, key) => ({ key, ex, attempt: 1 })), at: 0, outcomes: [], verdict: null, done: false,
  }));
  const [foot, setFoot] = useState<React.ReactNode>(null);
  const [quitting, setQuitting] = useState(false);
  const startedAt = useRef(performance.now());
  const take = useRef(getProgressCount(`lesson:${lesson.id}`) + 1);
  const [secs, setSecs] = useState(0);
  useHoldUnlocks('lesson', true);

  const complete = s.done && passes(s.outcomes);
  useEffect(() => {
    if (!s.done) return;
    setSecs(Math.round((performance.now() - startedAt.current) / 1000));
    if (complete) reportProgress(`lesson:${lesson.id}`);
  }, [s.done, complete, lesson.id]);

  const onBack = useCallback(() => { if (s.done) closeLesson(); else setQuitting(q => !q); }, [s.done]);
  useBackToClose(true, onBack);

  const onVerdict = useCallback((v: Verdict) => {
    dispatch({ type: 'verdict', v });
    if (v.ok) { hitChime('great', 72); feel('success'); } else { missChime(64); feel('error'); }
    hush(1200);
  }, []);
  const onSkip = useCallback(() => { feel('select'); dispatch({ type: 'skip' }); }, []);
  const onSeen = useCallback(() => dispatch({ type: 'seen' }), []);

  // While a verdict shows, the footer is one button: Next.
  useEffect(() => {
    if (!s.verdict) return;
    setFoot(<button type="button" className="lp-btn" onClick={() => { feel('tap'); dispatch({ type: 'next' }); }} data-feel="off">{s.at + 1 >= s.queue.length ? 'Finish' : 'Next'}</button>);
  }, [s.verdict, s.at, s.queue.length]);

  if (s.done) return <Take lesson={lesson} outcomes={s.outcomes} secs={secs} take={take.current} complete={complete} />;

  const entry = s.queue[s.at];
  const ex = entry.ex;
  const props = { verdict: s.verdict, onVerdict, setFoot };
  const finished = s.outcomes.filter(Boolean).length;

  return (
    <>
      <header className="lp-top">
        <button type="button" className="lp-stop" onClick={() => { feel('select'); setQuitting(true); }} aria-label="Stop the lesson" data-feel="off">{Icon.stop}</button>
        <ol className="lp-staffbar" aria-label={`${finished} of ${first.length} exercises done`}>
          {first.map((x, k) => {
            const o = s.outcomes[k];
            const now = entry.key === k;
            const cls = now ? (entry.attempt === 2 ? 'is-now is-retry' : 'is-now') : o ? `is-${o}` : '';
            return <li key={k} className={`${cls}${x.type === 'teach' ? ' is-idea' : ''}`} />;
          })}
        </ol>
      </header>

      <main className="lp-body" key={s.at}>
        <span className="lp-kind">
          {ex.type === 'choose' && !ex.sound && !ex.options.some(o => o.sound) ? Icon.idea : KIND_ICON[ex.type]}
          {entry.attempt === 2 ? 'Once more' : ex.type === 'choose' && !ex.sound && !ex.options.some(o => o.sound) ? 'Question' : KIND[ex.type]}
        </span>
        {ex.type === 'teach' && <Teach ex={ex} {...props} onNext={onSeen} />}
        {ex.type === 'choose' && <Choose ex={ex} {...props} />}
        {ex.type === 'play' && <Play ex={ex} {...props} onSkip={onSkip} />}
        {ex.type === 'tap' && <Tap ex={ex} {...props} />}
        {s.verdict && (
          <aside className={`lp-verdict ${s.verdict.ok ? 'is-right' : 'is-wrong'}`} role="status">
            <span className="lp-verdict-mark" aria-hidden="true">{s.verdict.ok ? Icon.check : Icon.cross}</span>
            <div>
              <b>{s.verdict.ok ? PRAISE[s.at % PRAISE.length] : 'Not this time.'}</b>
              {!s.verdict.ok && s.verdict.answer && <span>{ex.type === 'tap' ? s.verdict.answer : `It was ${s.verdict.answer}.`}</span>}
              {s.verdict.explain && <p>{s.verdict.explain}</p>}
              {!s.verdict.ok && entry.attempt === 1 && <em>It will come round again at the end.</em>}
            </div>
          </aside>
        )}
      </main>

      <footer className="lp-foot">{foot}</footer>

      {quitting && (
        <div className="lp-quit" role="dialog" aria-modal="true" aria-label="Stop the lesson">
          <div className="lp-quit-scrim" onClick={() => setQuitting(false)} />
          <div className="lp-quit-card">
            <span className="lp-quit-icon" aria-hidden="true">{Icon.stop}</span>
            <h3>Stop here?</h3>
            <p>This take will not be kept. The step stays where it was.</p>
            <button type="button" className="lp-btn" onClick={() => setQuitting(false)} data-feel="off">Keep going</button>
            <button type="button" className="lp-btn is-quiet is-danger" onClick={() => { feel('select'); closeLesson(); }} data-feel="off">Stop the lesson</button>
          </div>
        </div>
      )}
    </>
  );
};

/** The open lesson, if any, over everything else. */
export const LessonPlayer: React.FC = () => {
  const id = useOpenLesson();
  const lesson = id ? lessonFor(id) : undefined;
  useEffect(() => {
    if (!lesson) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [lesson]);
  if (!lesson) return null;
  return createPortal(
    <div className="lp" role="dialog" aria-modal="true" aria-label={lesson.title}>
      <Run key={lesson.id} lesson={lesson} />
    </div>,
    document.body
  );
};

export default LessonPlayer;
