// The two lesson parts drawn as guitar: a small fretboard to tap and hear,
// and a tab strip to play from.
//
// Explore  The board is drawn as you hold the guitar on your lap and look
//          down: high E on top, like tab. Tap any fret to hear it. The frets
//          to find glow one at a time; the rest stay faint, so the shape
//          shows before it is named.
// Riff     A strip of tab slides past a fixed line. Wait mode stops on each
//          note until the mic hears it. Time mode counts in four clicks and
//          keeps moving; a note counts if it is heard in its window.
//
// Neither plays a chime on a hit. The phone's own sound would reach the mic,
// and a riff often repeats the note just played.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ExProps } from './LessonPlayer';
import { Player } from './Player';
import { OPEN_MIDI, STRING_NAME, riffBeats, riffMidi } from './riff';
import type { RiffNote } from './riff';
import { appSounding, audioNow, startClicks } from './sound';
import { useMicPitch } from '../hooks/useMicPitch';
import { audio } from '../utils/audio';
import { feel } from '../utils/haptics';
import { noteMiss, noteName } from './hints';

const pcOf = (m: number) => ((m % 12) + 12) % 12;

// ---- The board: a few frets you can tap -----------------------------------------------

export type Dot = 'next' | 'soon' | 'dot' | 'found';
interface BoardProps {
  strings: number[];
  from: number;
  to: number;
  /** What to draw on a fret, keyed "string-fret". */
  dots: Map<string, Dot>;
  onTap: (st: number, f: number) => void;
  flash: { st: number; f: number; k: number } | null;
}

const Board: React.FC<BoardProps> = ({ strings, from, to, dots, onTap, flash }) => {
  const cols = to - from + 1;
  const W = 352;
  const left = 18;
  const cw = (W - left - 4) / cols;
  const rowH = strings.length === 1 ? 46 : 30;
  const top = 10;
  const H = top * 2 + rowH * strings.length + 16;
  const x = (f: number) => left + (f - from) * cw + cw / 2;
  const y = (i: number) => top + i * rowH + rowH / 2;
  return (
    <svg className="lp-board" viewBox={`0 0 ${W} ${H}`} role="group" aria-label="Fretboard">
      <rect className="lp-board-wood" x={left} y={top} width={W - left - 4} height={rowH * strings.length} rx="4" />
      {Array.from({ length: cols }, (_, i) => {
        const f = from + i;
        const wx = left + (i + 1) * cw;
        return (
          <g key={f}>
            {f === 0
              ? <rect className="lp-board-nut" x={wx - 3} y={top} width="5" height={rowH * strings.length} />
              : <line className="lp-board-wire" x1={wx} x2={wx} y1={top} y2={top + rowH * strings.length} />}
            <text className="lp-board-num" x={x(f)} y={H - 3}>{f === 0 ? 'open' : f}</text>
          </g>
        );
      })}
      {strings.map((st, i) => (
        <g key={st}>
          <line className="lp-board-string" x1={left} x2={W - 4} y1={y(i)} y2={y(i)} style={{ strokeWidth: 0.8 + st * 0.35 }} />
          <text className="lp-board-sname" x={left - 6} y={y(i) + 4}>{STRING_NAME[st].replace('high ', '').replace('low ', '')}</text>
        </g>
      ))}
      {strings.flatMap((st, i) => Array.from({ length: cols }, (_, c) => {
        const f = from + c;
        const d = dots.get(`${st}-${f}`);
        const lit = flash && flash.st === st && flash.f === f;
        return (
          <g key={`${st}-${f}`} className="lp-board-cell" onPointerDown={() => onTap(st, f)}>
            <rect x={left + c * cw} y={top + i * rowH} width={cw} height={rowH} fill="transparent" />
            {d && d !== 'next' && <circle className={`lp-board-dot is-${d}`} cx={x(f)} cy={y(i)} r={Math.min(9, cw / 2.6)} />}
            {d === 'next' && <circle className="lp-board-next" cx={x(f)} cy={y(i)} r={Math.min(11, cw / 2.2)} />}
            {lit && <g key={flash.k} className="lp-board-lit"><circle cx={x(f)} cy={y(i)} r={Math.min(12, cw / 2.1)} /><text x={x(f)} y={y(i) + 4}>{noteName(OPEN_MIDI[st] + f)}</text></g>}
          </g>
        );
      }))}
    </svg>
  );
};

// ---- Explore -----------------------------------------------------------------------

export const Explore: React.FC<ExProps<'explore'> & { onNext: () => void }> = ({ ex, setFoot, onNext }) => {
  const [at, setAt] = useState(0);
  const [flash, setFlash] = useState<{ st: number; f: number; k: number } | null>(null);
  const done = at >= ex.goal.length;

  useEffect(() => {
    setFoot(done
      ? <button type="button" className="lp-btn" onClick={() => { feel('tap'); onNext(); }} data-feel="off">Got it</button>
      : <span className="lp-hint">{ex.goal.length - at} to go</span>);
  }, [setFoot, done, at, ex.goal.length, onNext]);

  const tap = (st: number, f: number) => {
    audio.playMidi(OPEN_MIDI[st] + f, 1.4);
    feel('select');
    setFlash({ st, f, k: Date.now() });
    const g = ex.goal[at];
    if (g && g[0] === st && g[1] === f) setAt(a => a + 1);
  };

  const dots = new Map<string, Dot>();
  ex.goal.forEach(([st, f], i) => { if (!dots.has(`${st}-${f}`) || i < at) dots.set(`${st}-${f}`, i < at ? 'found' : 'dot'); });
  if (ex.goal[at]) dots.set(`${ex.goal[at][0]}-${ex.goal[at][1]}`, 'next');

  return (
    <div className="lp-explore">
      <h2>{ex.prompt}</h2>
      <p className="lp-detail">{ex.detail}</p>
      <Board strings={ex.strings} from={ex.from ?? 0} to={ex.to} dots={dots} onTap={tap} flash={flash} />
      {done && <p className="lp-explore-done">{ex.done}</p>}
    </div>
  );
};

// ---- Riff --------------------------------------------------------------------------

type Mark = 'hit' | 'miss' | undefined;
const COUNT_IN = 4;
const PPB = 44; // pixels per beat
const LEAD = 64; // where the play line sits
/** Once someone plays on screen, the next part of the lesson starts that way too. */
let preferScreen = false;

export const Riff: React.FC<ExProps<'riff'> & { onSkip: () => void }> = ({ ex, verdict, onVerdict, setFoot, onSkip }) => {
  const mic = useMicPitch('instrument');
  const { start, stop, lastPluck } = mic;
  const notes = ex.notes;
  const beat = 60 / ex.bpm;
  const starts = useMemo(() => { let t = 0; return notes.map(nt => { const s0 = t; t += nt[2]; return s0; }); }, [notes]);
  const total = riffBeats(notes);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [at, setAt] = useState(0);
  const [slips, setSlips] = useState(0);
  const [t0, setT0] = useState<number | null>(null);
  const strip = useRef<SVGSVGElement>(null);
  // No guitar to hand: the notes are tapped on a fretboard on screen instead.
  const [screen, setScreenState] = useState(preferScreen);
  const setScreen = (on: boolean) => { preferScreen = on; setScreenState(on); };
  const [flash, setFlash] = useState<{ st: number; f: number; k: number } | null>(null);
  const resRef = useRef<Mark[]>([]);

  useEffect(() => {
    if (screen) { stop(); return; }
    void start();
    return () => stop();
  }, [screen, start, stop]);

  // Readings while the app itself sounds (the count-in, the example) never count.
  const [quiet, setQuiet] = useState(appSounding);
  useEffect(() => {
    const id = window.setInterval(() => setQuiet(appSounding()), 80);
    return () => window.clearInterval(id);
  }, []);
  const p = quiet ? null : mic.pitch;
  const pRef = useRef(p);
  pRef.current = p;
  const screenRef = useRef(screen);
  screenRef.current = screen;

  // ---- Wait mode: each note waits until it is heard. ----
  const holdFrom = useRef<number | null>(null);
  const lastHit = useRef(0);
  const slipFrom = useRef<{ pc: number; at: number; counted: boolean } | null>(null);
  const [tick, nudge] = useState(0);
  useEffect(() => {
    if (screen || ex.time || verdict || at >= notes.length) return;
    const want = pcOf(riffMidi(notes[at]));
    const heardPc = p ? pcOf(p.midi) : null;
    // The same note again needs a fresh pluck, not the one still ringing.
    const fresh = at === 0 || pcOf(riffMidi(notes[at - 1])) !== want || lastPluck() > lastHit.current + 40;
    if (heardPc === want && Math.abs(p!.cents) <= 40 && fresh) {
      slipFrom.current = null;
      const now = performance.now();
      if (holdFrom.current === null) holdFrom.current = now;
      if (now - holdFrom.current < 120) {
        const id = window.setTimeout(() => nudge(x => x + 1), 130);
        return () => window.clearTimeout(id);
      }
      holdFrom.current = null;
      lastHit.current = now;
      feel('select');
      landed();
      return;
    }
    holdFrom.current = null;
    // A clear wrong note, held a moment, is a slip: counted once per pluck.
    // The note just played still rings while the hand moves on: not a slip.
    const ringing = at > 0 && heardPc === pcOf(riffMidi(notes[at - 1]));
    if (heardPc !== null && heardPc !== want && !ringing && lastPluck() > lastHit.current + 40) {
      const now = performance.now();
      const sf = slipFrom.current;
      if (!sf || sf.pc !== heardPc) slipFrom.current = { pc: heardPc, at: now, counted: false };
      else if (!sf.counted && now - sf.at > 260) { sf.counted = true; setSlips(n => n + 1); }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p, at, tick, verdict]);

  /** The waiting note was played: mark it and move on, or finish. */
  const landed = () => {
    const m = [...marks]; m[at] = 'hit'; setMarks(m);
    const nextAt = at + 1;
    setAt(nextAt);
    if (nextAt >= notes.length) {
      stop();
      const score = notes.length / (notes.length + slips);
      const how = screen ? ' Played on screen.' : '';
      onVerdict({ ok: true, score, explain: (slips === 0 ? 'Every note, no slips.' : `All ${notes.length} notes, with ${slips} slip${slips > 1 ? 's' : ''} on the way.`) + how });
    }
  };

  /** When a note may be played: from just before its beat to just before the next note. */
  const windowOf = (i: number, t: number) => {
    const s0 = t + (COUNT_IN + starts[i]) * beat;
    const len = notes[i][2] * beat;
    const close = i + 1 < notes.length ? Math.min(s0 + Math.min(len, 0.55) + 0.08, s0 + len - 0.06) : s0 + Math.min(len, 0.55) + 0.08;
    return { open: s0 - 0.16, close };
  };

  /** A fret tapped on screen: it sounds, and counts if it is the note due. */
  const tapScreen = (st: number, f: number) => {
    const midi = OPEN_MIDI[st] + f;
    audio.playMidi(midi, 1.2);
    feel('select');
    setFlash({ st, f, k: Date.now() });
    if (verdict) return;
    if (!ex.time) {
      if (at >= notes.length) return;
      if (midi === riffMidi(notes[at])) landed(); else setSlips(n => n + 1);
      return;
    }
    if (t0 === null) return;
    const now = audioNow();
    const res = resRef.current;
    for (let i = 0; i < notes.length; i++) {
      if (res[i]) continue;
      const w = windowOf(i, t0);
      if (now < w.open) break;
      if (now <= w.close && midi === riffMidi(notes[i])) { res[i] = 'hit'; break; }
    }
  };

  // ---- Time mode: a click, a moving strip, a window per note. ----
  const begin = useCallback(() => {
    feel('tap');
    setMarks([]);
    const t = startClicks(ex.bpm, COUNT_IN + Math.ceil(total) + 1, COUNT_IN);
    setT0(t);
    if (import.meta.env.DEV) Object.assign(window, { __riff: { t0: t, beat: 60 / ex.bpm, countIn: COUNT_IN, starts, now: audioNow } });
  }, [ex.bpm, total, starts]);

  useEffect(() => {
    if (!ex.time || t0 === null || verdict) return;
    let raf = 0;
    const res: Mark[] = [];
    resRef.current = res;
    // Audio clock to performance clock, for comparing with pluck times.
    const skew = performance.now() / 1000 - audioNow();
    let shown = '';
    // Each pluck counts for one note only: a repeated note needs its own.
    let usedPluck = 0;
    const loop = () => {
      const now = audioNow();
      const beatsIn = (now - t0) / beat - COUNT_IN;
      if (strip.current) strip.current.style.transform = `translateX(${LEAD - beatsIn * PPB}px)`;
      // On screen, taps mark their own notes; the mic is off.
      const cur = screenRef.current ? null : pRef.current;
      for (let i = 0; i < notes.length; i++) {
        if (res[i]) continue;
        // A note's window ends before the next note starts, so a missed note
        // can't borrow the next pluck.
        const { open, close } = windowOf(i, t0);
        if (now < open) break;
        const want = pcOf(riffMidi(notes[i]));
        const same = i > 0 && pcOf(riffMidi(notes[i - 1])) === want;
        const pluck = lastPluck() / 1000 - skew;
        const plucked = !same || (pluck >= open && pluck > usedPluck);
        if (cur && pcOf(cur.midi) === want && plucked) { res[i] = 'hit'; usedPluck = Math.max(usedPluck, pluck); }
        else if (now > close) res[i] = 'miss';
      }
      const key = res.map(r => (r === 'hit' ? 'h' : r === 'miss' ? 'm' : '.')).join('');
      if (key !== shown) { shown = key; setMarks([...res]); if (import.meta.env.DEV) Object.assign(window, { __riffKey: key }); }
      if (beatsIn > total + 0.6) {
        stop();
        const hits = res.filter(r => r === 'hit').length;
        const score = hits / notes.length;
        const need = ex.need ?? 0.7;
        onVerdict(score >= need
          ? { ok: true, score, explain: `${hits} of ${notes.length} notes in time.${screenRef.current ? ' Played on screen.' : ''}` }
          : { ok: false, score, answer: `${hits} of ${notes.length} in time, ${Math.ceil(need * notes.length)} needed`, explain: 'Count the four clicks, then play as the click sounds. Slow and steady beats fast and early.' });
        return;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t0, verdict]);

  // In wait mode the strip steps to the next note.
  useEffect(() => {
    if (ex.time || !strip.current) return;
    strip.current.style.transform = `translateX(${LEAD - starts[Math.min(at, notes.length - 1)] * PPB}px)`;
  }, [at, ex.time, starts, notes.length]);

  useEffect(() => {
    if (verdict) return;
    const swap = screen
      ? <button type="button" className="lp-btn is-quiet" onClick={() => { feel('tap'); setScreen(false); }} data-feel="off">Back to my guitar</button>
      : <button type="button" className="lp-btn is-quiet" onClick={() => { feel('tap'); setScreen(true); }} data-feel="off">No guitar? Play on screen</button>;
    if (ex.time && t0 === null) {
      setFoot(<><button type="button" className="lp-btn" onClick={begin} data-feel="off">Start the click</button>{swap}</>);
    } else if (ex.time) {
      setFoot(<span className="lp-hint">{screen ? 'Tap the lit fret on the beat' : 'Playing along'}</span>);
    } else {
      setFoot(swap);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setFoot, verdict, ex.time, t0, begin, onSkip, stop, screen]);

  const W = Math.ceil(total * PPB + LEAD + 80);
  const rowY = (st: number) => 12 + (st - 1) * 15;
  const H = 12 * 2 + 15 * 5;
  const cur = ex.time ? (() => { for (let i = 0; i < notes.length; i++) if (!marks[i]) return i; return notes.length; })() : at;
  const now = notes[cur] as RiffNote | undefined;
  const heard = p ? noteName(p.midi) : null;
  const want = now ? pcOf(riffMidi(now)) : null;

  return (
    <div className="lp-riff" data-midis={import.meta.env.DEV ? notes.map(riffMidi).join(',') : undefined}>
      <h2>{ex.prompt}</h2>
      <p className="lp-detail">{ex.detail}</p>
      <div className="lp-tab" aria-label={`${notes.length} notes of tab`}>
        <div className="lp-tab-names" aria-hidden="true">{[1, 2, 3, 4, 5, 6].map(st => <span key={st} style={{ top: rowY(st) - 7 }}>{['', 'e', 'B', 'G', 'D', 'A', 'E'][st]}</span>)}</div>
        <div className="lp-tab-window">
          <svg ref={strip} className={`lp-tab-strip${ex.time ? '' : ' is-step'}`} width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ transform: `translateX(${LEAD}px)` }}>
            {[1, 2, 3, 4, 5, 6].map(st => <line key={st} className="lp-tab-line" x1="0" x2={W} y1={rowY(st)} y2={rowY(st)} />)}
            {Array.from({ length: Math.ceil(total) + 1 }, (_, b) => <line key={b} className={`lp-tab-beat${b % 4 === 0 ? ' is-bar' : ''}`} x1={b * PPB} x2={b * PPB} y1={rowY(1)} y2={rowY(6)} />)}
            {notes.map((nt, i) => {
              const cls = marks[i] === 'hit' ? ' is-hit' : marks[i] === 'miss' ? ' is-miss' : i === cur ? ' is-now' : '';
              const cx = starts[i] * PPB;
              return (
                <g key={i} className={`lp-tab-note${cls}`}>
                  {nt[2] >= 1.5 && <rect className="lp-tab-tail" x={cx} y={rowY(nt[0]) - 2} width={nt[2] * PPB - 10} height="4" rx="2" />}
                  <circle cx={cx} cy={rowY(nt[0])} r="8.5" />
                  <text x={cx} y={rowY(nt[0]) + 3.6}>{nt[1]}</text>
                </g>
              );
            })}
          </svg>
          <i className="lp-tab-now" style={{ left: LEAD }} aria-hidden="true" />
        </div>
      </div>
      {screen && !verdict && (() => {
        const frets = notes.map(n => n[1]);
        const lo = Math.min(...frets);
        const from = lo <= 1 ? 0 : lo - 1;
        const to = Math.max(from + 4, Math.max(...frets));
        const dots = new Map<string, Dot>();
        const soon = notes[cur + 1];
        if (soon) dots.set(`${soon[0]}-${soon[1]}`, 'soon');
        if (now) dots.set(`${now[0]}-${now[1]}`, 'next');
        return (
          <>
            <Board strings={[1, 2, 3, 4, 5, 6]} from={from} to={to} dots={dots} onTap={tapScreen} flash={flash} />
            <p className="lp-screen-say">{ex.time
              ? (t0 === null ? 'Start the click, then tap each lit fret as its note reaches the line.' : `${marks.filter(m => m === 'hit').length} of ${notes.length} in time`)
              : now ? `Tap the lit fret: ${now[1] === 0 ? `open ${STRING_NAME[now[0]]}` : `${STRING_NAME[now[0]]} string, fret ${now[1]}`}.` : ''}</p>
          </>
        );
      })()}
      {now && !verdict && !screen && (
        <div className={`lp-ear${mic.isActive && !quiet ? ' is-on' : ''}`}>
          <div className="lp-ear-note"><small>{mic.error ? 'Mic off' : !mic.isActive ? 'Starting the mic' : 'Next'}</small><b>{noteName(riffMidi(now))}</b></div>
          <p className="lp-ear-say">
            <b>{now[1] === 0 ? `Open ${STRING_NAME[now[0]]}` : `${STRING_NAME[now[0]]} string, fret ${now[1]}`}</b>
            <br />
            {mic.error ? 'Allow the mic in your phone\'s settings, or skip for now.'
              : ex.time && t0 === null ? 'Start the click when you are ready.'
              : ex.time ? `${marks.filter(m => m === 'hit').length} of ${notes.length} in time`
              : !heard || want === null ? 'Play when you are ready.'
              : pcOf(p!.midi) === want ? 'That is it.'
              : noteMiss(pcOf(p!.midi), want)}
          </p>
        </div>
      )}
      {!ex.time && !verdict && <div className="lp-players"><Player sound={{ kind: 'melody', notes: notes.map((x): [number, number] => [riffMidi(x), x[2]]), bpm: ex.bpm }} label="Hear how it goes" /></div>}
    </div>
  );
};
