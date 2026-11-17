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

import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { ExProps } from './LessonPlayer';
import { Player } from './Player';
import { OPEN_MIDI, STRING_NAME, riffBeats, riffMidi } from './riff';
import type { RiffNote } from './riff';
import { appSounding } from './sound';
import { Stage } from './Stage';
import type { StageResult } from './Stage';
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
  /** A held fret let go: lets a long note be held on screen. */
  onRelease?: () => void;
  flash: { st: number; f: number; k: number } | null;
  /** Drawing width and row height, for a wider board on the landscape stage. */
  width?: number;
  row?: number;
  /** A colour per string for the lit frets. */
  tint?: (st: number) => string;
}

export const Board: React.FC<BoardProps> = ({ strings, from, to, dots, onTap, onRelease, flash, width, row, tint }) => {
  const cols = to - from + 1;
  const W = width ?? 352;
  const left = 18;
  const cw = (W - left - 4) / cols;
  const rowH = row ?? (strings.length === 1 ? 46 : 30);
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
          <g key={`${st}-${f}`} className="lp-board-cell" style={tint ? { ['--tint' as string]: tint(st) } as React.CSSProperties : undefined}
            onPointerDown={e => { (e.target as Element).releasePointerCapture?.(e.pointerId); onTap(st, f); }}
            onPointerUp={onRelease} onPointerLeave={onRelease} onPointerCancel={onRelease}>
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
const PPB = 44; // pixels per beat
const LEAD = 64; // where the play line sits
/** Once someone plays on screen, the next part of the lesson starts that way too. */
let preferScreen = false;

export const Riff: React.FC<ExProps<'riff'> & { onSkip: () => void }> = ({ ex, verdict, onVerdict, setFoot, onSkip }) => {
  const mic = useMicPitch('instrument');
  const { start, stop, lastPluck } = mic;
  const notes = ex.notes;
  const starts = useMemo(() => { let t = 0; return notes.map(nt => { const s0 = t; t += nt[2]; return s0; }); }, [notes]);
  const total = riffBeats(notes);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [at, setAt] = useState(0);
  const [slips, setSlips] = useState(0);
  const strip = useRef<SVGSVGElement>(null);
  // No guitar to hand: the notes are tapped on a fretboard on screen instead.
  const [screen, setScreenState] = useState(preferScreen);
  const setScreen = (on: boolean) => { preferScreen = on; setScreenState(on); };
  const [flash, setFlash] = useState<{ st: number; f: number; k: number } | null>(null);

  // The in-time take runs on the stage, which has its own mic.
  const [staged, setStaged] = useState(false);
  useEffect(() => {
    if (screen || ex.time) { stop(); return; }
    void start();
    return () => stop();
  }, [screen, start, stop, ex.time]);

  const onStage = (r: StageResult | null) => {
    setStaged(false);
    if (!r) return;
    const need = ex.need ?? 0.7;
    const how = screen ? ' Played on screen.' : '';
    const said = `${r.hits + r.short} of ${r.total} notes in time${r.short ? `, ${r.short} cut short` : ''}.`;
    onVerdict(r.score >= need
      ? { ok: true, score: r.score, explain: said + how }
      : { ok: false, score: r.score, answer: `${Math.round(r.score * 100)}%, ${Math.round(need * 100)}% needed`, explain: `${said} Let the long notes ring for their whole bar.${how}` });
  };

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

  /** A fret tapped on screen: it sounds, and counts if it is the note due. */
  const tapScreen = (st: number, f: number) => {
    const midi = OPEN_MIDI[st] + f;
    audio.playMidi(midi, 1.2);
    feel('select');
    setFlash({ st, f, k: Date.now() });
    if (verdict || at >= notes.length) return;
    if (midi === riffMidi(notes[at])) landed(); else setSlips(n => n + 1);
  };

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
    if (ex.time) {
      setFoot(<><button type="button" className="lp-btn" onClick={() => { feel('tap'); setStaged(true); }} data-feel="off">{screen ? 'Play along on screen' : 'Play along'}</button>{swap}</>);
    } else {
      setFoot(swap);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setFoot, verdict, ex.time, onSkip, stop, screen]);

  const W = Math.ceil(total * PPB + LEAD + 80);
  const rowY = (st: number) => 12 + (st - 1) * 15;
  const H = 12 * 2 + 15 * 5;
  const cur = at;
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
      {ex.time && !verdict && (
        <p className="lp-screen-say">Long bars mean let the note ring.</p>
      )}
      {staged && <Stage notes={notes} bpm={ex.bpm} title={ex.prompt} screen={screen} onDone={onStage} />}
      {screen && !ex.time && !verdict && (() => {
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
            <p className="lp-screen-say">{now ? `Tap the lit fret: ${now[1] === 0 ? `open ${STRING_NAME[now[0]]}` : `${STRING_NAME[now[0]]} string, fret ${now[1]}`}.` : ''}</p>
          </>
        );
      })()}
      {now && !verdict && !screen && !ex.time && (
        <div className={`lp-ear${mic.isActive && !quiet ? ' is-on' : ''}`}>
          <div className="lp-ear-note"><small>{mic.error ? 'Mic off' : !mic.isActive ? 'Starting the mic' : 'Next'}</small><b>{noteName(riffMidi(now))}</b></div>
          <p className="lp-ear-say">
            <b>{now[1] === 0 ? `Open ${STRING_NAME[now[0]]}` : `${STRING_NAME[now[0]]} string, fret ${now[1]}`}</b>
            <br />
            {mic.error ? 'Allow the mic in your phone\'s settings, or skip for now.'
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
