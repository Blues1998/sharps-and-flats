import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { closeLesson, restartLesson, startLesson, useOpenLesson } from './store';
import { lessonFor, setDrill } from './lessons';
import type { ChooseOption, Exercise, Lesson } from './lessons';
import { Explore, Riff } from './LessonTab';
import { Player } from './Player';
import { playOne } from './nowPlaying';
import { noteMiss } from './hints';
import { appSounding, audioNow, hush, soundLength, startClicks } from './sound';
import { useMicPitch } from '../hooks/useMicPitch';
import { feel } from '../utils/haptics';
import { hitChime, missChime } from '../utils/chime';
import { audio } from '../utils/audio';
import { getProgressCount, reportProgress } from '../utils/progress';
import { useHoldUnlocks } from '../utils/feats';
import { useBackToClose } from '../utils/nativeShell';
import { usePracticeTime } from '../hooks/usePracticeTime';
import { checkStars, saveCheckStars } from '../utils/neck';
import { award } from '../utils/xp';

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
export type Verdict = { ok: boolean; answer?: string; explain?: string; picked?: string; score?: number };
interface Entry { key: number; ex: Exercise; attempt: 1 | 2 }

const NOTE = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const PRAISE = ['Right.', 'Yes, that is it.', 'Spot on.', 'Exactly.', 'Well heard.'];
const KIND: Record<Exercise['type'], string> = { teach: 'New idea', choose: 'Listen', play: 'Play', tap: 'Rhythm', explore: 'Explore', riff: 'Play' };

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
const KIND_ICON: Record<Exercise['type'], React.ReactNode> = { teach: Icon.idea, choose: Icon.ear, play: Icon.guitar, tap: Icon.beat, explore: Icon.guitar, riff: Icon.guitar };

/** A fret dot: the radio for an answer, filled like a note on the neck. */
const Dot: React.FC<{ state: 'idle' | 'sel' | 'right' | 'wrong' }> = ({ state }) => (
  <span className={`lp-dot is-${state}`} aria-hidden="true">{state === 'right' ? Icon.check : state === 'wrong' ? Icon.cross : null}</span>
);

// ---- Exercises -------------------------------------------------------------------

export interface ExProps<E extends Exercise['type']> {
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
    onVerdict({ ok: sel === right, answer: ex.options[right]?.label, explain: ex.explain, picked: ex.options[sel]?.label });
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
    if (o.sound) playOne(o.sound);
  };
  const dev = import.meta.env.DEV;

  // Wrong, and both answers can be heard: play yours, then the right one, so
  // the difference is in the ear and not only in the explanation.
  const yours = verdict && !verdict.ok && sel !== null ? ex.options[sel] : null;
  const answer = ex.options[right];
  const compare = yours?.hear && answer?.hear ? { yours: yours.hear, answer: answer.hear } : null;
  useEffect(() => {
    if (!compare) return;
    const id = window.setTimeout(() => playOne({ kind: 'seq', parts: [compare.yours, compare.answer], gap: soundLength(compare.yours) + 0.3 }), 700);
    return () => window.clearTimeout(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!compare]);

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
      {compare && yours && (
        <div className="lp-compare">
          <small>Hear the difference</small>
          <div className="lp-players">
            <Player sound={compare.yours} label={`Yours: ${yours.label}`} />
            <Player sound={compare.answer} label={`Answer: ${answer.label}`} />
          </div>
        </div>
      )}
    </div>
  );
};

const Play: React.FC<ExProps<'play'> & { onSkip: () => void; check?: boolean }> = ({ ex, verdict, onVerdict, onSkip, setFoot, check }) => {
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
    setFoot(<button type="button" className="lp-btn is-quiet" onClick={() => { stop(); onSkip(); }} data-feel="off">{check ? 'No guitar? Skip, but the check won\'t pass' : 'No guitar right now? Skip for now'}</button>);
  }, [setFoot, onSkip, stop, verdict, check]);

  // While the app is playing (the example, the chime), the mic hears the
  // phone's own speaker. None of that counts; only what you play does.
  const [quiet, setQuiet] = useState(appSounding);
  useEffect(() => {
    const id = window.setInterval(() => setQuiet(appSounding()), 100);
    return () => window.clearInterval(id);
  }, []);
  const justHit = useRef<{ pc: number; until: number }>({ pc: -1, until: 0 });
  const raw = quiet ? null : mic.pitch;
  const echo = !!raw && ((raw.midi % 12) + 12) % 12 === justHit.current.pc && performance.now() < justHit.current.until;
  const p = echo ? null : raw;
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
    // The chime and your still-ringing string are the note just found. Ignore
    // that note for a moment, not the whole mic, so a scale can keep moving.
    justHit.current = { pc: pcOf(p!.midi), until: performance.now() + 1100 };
    feel('success');
    const next = at + 1;
    setAt(next);
    if (next >= ex.notes.length) {
      stop();
      onVerdict({ ok: true, explain: ex.found });
    }
  }, [p, at, hit, verdict, tick, hold, ex.notes.length, onVerdict, stop]);

  const heard = p ? NOTE[pcOf(p.midi)] : null;
  const cents = p && onNote && target !== -1 ? Math.max(-50, Math.min(50, p.cents)) : null;

  return (
    <div className="lp-play" data-notes={import.meta.env.DEV ? ex.notes.join(',') : undefined}>
      <h2>{ex.prompt}</h2>
      <p className="lp-detail">{ex.detail}</p>
      <div className="lp-targets">
        {ex.names.map((n, i) => (
          <span key={i} className={`lp-target${i < at ? ' is-done' : i === at ? ' is-now' : ''}${i === at && hit ? ' is-hit' : ''}${n.hidden && i >= at ? ' is-hidden' : ''}`}>
            <b>{n.hidden && i >= at ? '?' : n.name}</b>{n.where && <small>{n.where}</small>}
          </span>
        ))}
      </div>
      <div className={`lp-ear${mic.isActive && !quiet && !verdict ? ' is-on' : ''}`}>
        <div className="lp-ear-note">
          <small>{verdict ? 'Found it' : mic.error ? 'Mic off' : !mic.isActive ? 'Starting the mic' : quiet ? 'Paused' : 'Hearing'}</small>
          <b>{verdict ? '' : heard ?? ''}</b>
        </div>
        <div className="lp-meter" aria-hidden="true">
          <i className="lp-meter-zone" style={{ width: `${tol}%`, left: `${50 - tol / 2}%` }} />
          {cents !== null && <i className={`lp-meter-needle${hit ? ' is-hit' : ''}`} style={{ left: `${50 + cents}%` }} />}
          <span>flat</span><span>sharp</span>
        </div>
        <p className="lp-ear-say">
          {verdict ? (ex.notes.length > 1 ? 'All the notes, in order.' : 'That is the one.')
            : mic.error ? 'Allow the mic in your phone\'s settings, or skip for now.'
            : quiet ? 'Listening again once the sound stops.'
            : !p ? 'Play when you are ready.'
            : hit ? 'Hold it…'
            : onNote ? (p.cents > 0 ? 'Right note, a touch sharp.' : 'Right note, a touch flat.')
            : ex.names[at]?.hidden ? `That is ${heard}. Not this one yet.`
            : target === -1 ? `That is ${heard}.` : noteMiss(pcOf(p.midi), target)}
        </p>
      </div>
      {ex.hear && <div className="lp-players"><Player sound={ex.hear} label={ex.auto ? 'Hear it again' : 'Hear how it goes'} auto={ex.auto} /></div>}
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
    const start = startClicks(ex.bpm, COUNT_IN + ex.taps + 1);
    setT0(start);
    if (import.meta.env.DEV) Object.assign(window, { __tap: { t0: start, beat: 60 / ex.bpm, countIn: COUNT_IN, now: audioNow } });
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

const passes = (outcomes: Outcome[], check = false): boolean => {
  const graded = outcomes.filter(o => o && o !== 'seen');
  if (graded.includes('skipped')) return false;
  if (graded.length === 0) return true;
  if (check) return starsFor(outcomes) > 0;
  return graded.filter(o => o === 'first' || o === 'second').length / graded.length >= 0.5;
};

// A milestone check is a test: first time only. 60% passes with one star,
// 80% earns two, everything right earns three.
export const CHECK_PASS = 0.6;
function starsFor(outcomes: Outcome[]): number {
  const graded = outcomes.filter(o => o && o !== 'seen');
  if (!graded.length || graded.includes('skipped')) return 0;
  const acc = graded.filter(o => o === 'first').length / graded.length;
  return acc >= 1 ? 3 : acc >= 0.8 ? 2 : acc >= CHECK_PASS ? 1 : 0;
}

const BigStar: React.FC<{ on: boolean; i: number }> = ({ on, i }) => (
  <svg className={`lp-star${on ? ' is-on' : ''}`} style={{ animationDelay: `${0.5 + i * 0.28}s` }} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 2.8l2.7 5.9 6.4.7-4.8 4.3 1.4 6.3L12 16.8 6.3 20l1.4-6.3L2.9 9.4l6.4-.7z" />
  </svg>
);

// ---- Songs, slips and drills -----------------------------------------------------

/** A song's take: its best in-time score, or null if it was never played in time. */
function songTake(exs: Exercise[], scores: number[]): number | null {
  let best: number | null = null;
  exs.forEach((ex, k) => { if (ex.type === 'riff' && ex.time && scores[k] !== undefined) best = Math.max(best ?? 0, scores[k]); });
  return best;
}
const songStars = (score: number): number => (score >= 0.95 ? 3 : score >= 0.8 ? 2 : score >= 0.6 ? 1 : 0);

/** Mix-ups, grouped: "Major 3rd, heard as Perfect 5th" twice. */
function groupSlips(slips: Slip[]): { answer: string; picked: string; heard: boolean; n: number; again?: () => Exercise }[] {
  const out = new Map<string, { answer: string; picked: string; heard: boolean; n: number; again?: () => Exercise }>();
  for (const x of slips) {
    const k = `${x.answer}|${x.picked}`;
    const g = out.get(k);
    if (g) g.n++; else out.set(k, { answer: x.answer, picked: x.picked, heard: x.heard, n: 1, again: x.again });
  }
  return [...out.values()].sort((a, b) => b.n - a.n);
}

// Mix-ups are kept across days. Nothing reads them yet; daily practice will.
const SLIPS_KEY = 'cadenza-slips';
function rememberSlips(slips: Slip[]): void {
  if (!slips.length) return;
  try {
    const all = JSON.parse(localStorage.getItem(SLIPS_KEY) ?? '{}') as Record<string, { n: number; last: number }>;
    for (const x of slips) {
      const k = `${x.answer}|${x.picked}`;
      all[k] = { n: (all[k]?.n ?? 0) + 1, last: Date.now() };
    }
    localStorage.setItem(SLIPS_KEY, JSON.stringify(all));
  } catch { /* kept for this lesson only */ }
}

/** A short drill on the pairs that got mixed up: fresh rounds of just those. */
function startDrill(groups: { answer: string; picked: string; again?: () => Exercise }[]): void {
  const makers = groups.map(g => g.again).filter((f): f is () => Exercise => !!f);
  if (!makers.length) return;
  setDrill({
    id: 'drill', title: 'What tripped you', practice: true,
    recap: 'The more often you hear the two side by side, the sooner they stop sounding alike.',
    build: () => Array.from({ length: 6 }, (_, i) => makers[i % makers.length]()),
  });
  startLesson('drill');
}

const Take: React.FC<{ lesson: Lesson; outcomes: Outcome[]; secs: number; take: number; complete: boolean; stars: number; best: number; slips: Slip[]; songScore: number | null }> = ({ lesson, outcomes, secs, take, complete, stars, best, slips, songScore }) => {
  const graded = useMemo(() => outcomes.filter(o => o && o !== 'seen'), [outcomes]);
  const attempted = graded.filter(o => o !== 'skipped');
  const first = graded.filter(o => o === 'first').length;
  const acc = attempted.length ? first / attempted.length : null;
  const skipped = graded.includes('skipped');
  const check = !!lesson.check || !!lesson.song;
  const grade = lesson.practice
    ? (acc !== null && acc >= 0.8 ? 'Sorted' : 'Getting there')
    : check
    ? (skipped ? 'Unfinished' : !complete ? 'Not yet' : stars === 3 ? 'Three stars' : stars === 2 ? 'Two stars' : 'Passed')
    : skipped ? 'Unfinished take' : !complete ? 'Not there yet' : acc === null || acc >= 0.9 ? 'Clean take' : acc >= 0.6 ? 'Solid take' : 'Rough take';
  const mixups = groupSlips(slips);
  const need = Math.ceil(graded.length * CHECK_PASS);
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
      <span className="lp-take-kicker">{lesson.song ? `Song · ${lesson.song.by}` : lesson.practice ? 'Practice round' : check ? `Fret ${lesson.id.replace('check-', '')} · ${lesson.title}` : `Take ${take} · ${lesson.title}`}</span>
      <h2>{grade}</h2>
      {check && (
        <div className="lp-stars" role="img" aria-label={`${stars} of 3 stars`}>
          {[0, 1, 2].map(i => <BigStar key={i} i={i} on={i < stars} />)}
          {stars > best && best > 0 && <span className="lp-best">New best</span>}
        </div>
      )}
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
        {songScore !== null
          ? <div><dt>In time</dt><dd>{Math.round(songScore * 100)}%</dd></div>
          : <div><dt>First time</dt><dd>{attempted.length ? `${first} of ${attempted.length}` : 'None tried'}</dd></div>}
        <div><dt>Time</dt><dd>{Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}</dd></div>
        <div><dt>XP</dt><dd>{lesson.practice ? '0' : check ? (stars > best ? `+${(stars - best) * 10}` : '0') : complete && take === 1 ? '+20' : '0'}</dd></div>
      </dl>
      {mixups.length > 0 && (
        <div className="lp-slips">
          <small>What tripped you</small>
          <ul>{mixups.slice(0, 3).map(g => <li key={`${g.answer}|${g.picked}`}>{g.heard ? <><b>{g.answer}</b> heard as <b>{g.picked}</b></> : <>Picked <b>{g.picked}</b> instead of <b>{g.answer}</b></>}{g.n > 1 && <em> ×{g.n}</em>}</li>)}</ul>
          {mixups.some(g => g.again) && (
            <button type="button" className="lp-btn is-quiet" onClick={() => { feel('tap'); startDrill(mixups); }} data-feel="off">Practise just these</button>
          )}
        </div>
      )}
      {lesson.practice ? (
        <div className="lp-recap"><small>Keep this</small><p>{lesson.recap}</p></div>
      ) : lesson.song && !complete ? (
        <div className="lp-recap is-open"><small>{skipped ? 'Every part counts' : 'To pass'}</small><p>{skipped
          ? 'Play every part on the guitar to earn the song.'
          : 'Land 60% of the notes in time for the first star. Go again: the click helps more each time.'}</p></div>
      ) : check && !complete ? (
        <div className="lp-recap is-open"><small>{skipped ? 'Every part counts' : 'To pass'}</small><p>{skipped
          ? 'A check needs the guitar parts too. Play them all to pass.'
          : `Passing takes ${need} of ${graded.length} right first time. Each try asks a fresh set.`}</p></div>
      ) : complete ? (
        <div className="lp-recap"><small>{lesson.song ? 'Song learnt' : check ? 'Milestone passed' : 'Keep this'}</small><p>{lesson.recap}</p></div>
      ) : skipped ? (
        <div className="lp-recap is-open"><small>Not finished yet</small><p>The guitar parts you skipped are still open. Play them to finish this step.</p></div>
      ) : (
        <div className="lp-recap is-open"><small>One more take</small><p>Fewer than half came out right, so this step stays open. Go again: the questions change each time.</p></div>
      )}
      {(complete || lesson.practice) && <button type="button" className="lp-btn" onClick={() => { feel('tap'); closeLesson(); }} data-feel="off">Back to the neck</button>}
      {!lesson.practice && (!complete || (check && stars < 3)) && (
        <button type="button" className={`lp-btn${complete ? ' is-quiet' : ''}`} onClick={() => { feel('tap'); restartLesson(); }} data-feel="off">
          {complete ? 'Go for three stars' : 'Try again'}
        </button>
      )}
      {!complete && !lesson.practice && <button type="button" className="lp-btn is-quiet" onClick={() => { feel('tap'); closeLesson(); }} data-feel="off">Back to the neck</button>}
    </div>
  );
};

// ---- The run ---------------------------------------------------------------------

/** A wrong answer: what it was, what was picked, and how to ask that pair again. */
interface Slip { answer: string; picked: string; heard: boolean; again?: () => Exercise }
interface RunState { queue: Entry[]; at: number; outcomes: Outcome[]; scores: number[]; slips: Slip[]; verdict: Verdict | null; done: boolean; check: boolean }
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
      let slips = s.slips;
      const scores = [...s.scores];
      if (a.v.score !== undefined) scores[e.key] = Math.max(scores[e.key] ?? 0, a.v.score);
      if (a.v.ok) outcomes[e.key] = e.attempt === 1 ? 'first' : 'second';
      else {
        outcomes[e.key] = 'missed';
        const ex = e.ex;
        const remake = ex.type === 'choose' && ex.remake && a.v.picked ? ex.remake : null;
        if (a.v.picked && a.v.answer) slips = [...slips, { answer: a.v.answer, picked: a.v.picked, heard: ex.type === 'choose' && !!ex.sound, again: remake ? () => remake(a.v.picked!) : undefined }];
        // The retry is a fresh round, narrowed to the two that got mixed up.
        if (e.attempt === 1 && !s.check) queue = [...queue, { ...e, ex: remake ? remake(a.v.picked!) : e.ex, attempt: 2 }];
      }
      return { ...s, queue, outcomes, scores, slips, verdict: a.v };
    }
    case 'skip': outcomes[e.key] = 'skipped'; return advance({ ...s, outcomes });
    case 'seen': outcomes[e.key] = 'seen'; return advance({ ...s, outcomes });
    case 'next': return advance(s);
  }
}

const Run: React.FC<{ lesson: Lesson }> = ({ lesson }) => {
  const first = useMemo(() => lesson.build(), [lesson]);
  const [s, dispatch] = useReducer(reduce, undefined, (): RunState => ({
    queue: first.map((ex, key) => ({ key, ex, attempt: 1 })), at: 0, outcomes: [], scores: [], slips: [], verdict: null, done: false, check: !!lesson.check,
  }));
  const [foot, setFoot] = useState<React.ReactNode>(null);
  const [quitting, setQuitting] = useState(false);
  const startedAt = useRef(performance.now());
  const take = useRef(getProgressCount(`lesson:${lesson.id}`) + 1);
  const [secs, setSecs] = useState(0);
  useHoldUnlocks('lesson', true);
  // A lesson, check, song or drill is practice while it runs. The clock's own
  // rules still apply: on screen only, and "Still playing?" after ten idle minutes.
  usePracticeTime('lesson', !s.done);

  const starred = !!lesson.check || !!lesson.song;
  const songScore = lesson.song ? songTake(first, s.scores) : null;
  const skippedAny = s.outcomes.includes('skipped');
  const stars = !s.done ? 0 : lesson.check ? starsFor(s.outcomes) : songScore !== null && !skippedAny ? songStars(songScore) : 0;
  const complete = s.done && (lesson.song ? stars > 0 : passes(s.outcomes, !!lesson.check));
  const [best] = useState(() => (starred ? checkStars(lesson.id) : 0));
  useEffect(() => {
    if (!s.done) return;
    setSecs(Math.round((performance.now() - startedAt.current) / 1000));
    if (lesson.practice) return;
    if (starred && stars > best) {
      saveCheckStars(lesson.id, stars);
      // Each star pays once, ever: a retake only pays for stars not held before.
      for (let k = best + 1; k <= stars; k++) award(lesson.song ? 'song-star' : 'check-star', `${lesson.id}-${k}`);
    }
    if (complete) reportProgress(`lesson:${lesson.id}`);
    rememberSlips(s.slips);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.done]);

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

  if (s.done) return <Take lesson={lesson} outcomes={s.outcomes} secs={secs} take={take.current} complete={complete} stars={stars} best={best} slips={s.slips} songScore={songScore} />;

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
            const cls = now ? `is-now${entry.attempt === 2 ? ' is-retry' : ''}${s.verdict && o ? ` is-${o}` : ''}` : o ? `is-${o}` : '';
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
        {ex.type === 'play' && <Play ex={ex} {...props} onSkip={onSkip} check={!!lesson.check} />}
        {ex.type === 'tap' && <Tap ex={ex} {...props} />}
        {ex.type === 'explore' && <Explore ex={ex} {...props} onNext={onSeen} />}
        {ex.type === 'riff' && <Riff ex={ex} {...props} onSkip={onSkip} />}
        {s.verdict && (
          <aside className={`lp-verdict ${s.verdict.ok ? 'is-right' : 'is-wrong'}`} role="status">
            <span className="lp-verdict-mark" aria-hidden="true">{s.verdict.ok ? Icon.check : Icon.cross}</span>
            <div>
              <b>{s.verdict.ok ? PRAISE[s.at % PRAISE.length] : 'Not this time.'}</b>
              {!s.verdict.ok && s.verdict.answer && <span>{ex.type === 'tap' ? s.verdict.answer : `It was ${s.verdict.answer}.`}</span>}
              {s.verdict.explain && <p>{s.verdict.explain}</p>}
              {!s.verdict.ok && entry.attempt === 1 && !lesson.check && <em>{ex.type === 'choose' && ex.remake ? 'It comes back at the end, with just these two.' : 'It will come round again at the end.'}</em>}
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
