// The play-along stage: a song or riff in time, full screen and sideways.
//
// The tab runs across the whole width and slides past a line near the left.
// Each note is a bar as long as it lasts, so a long bar means let it ring.
// Every string has its own colour, and on the on-screen fretboard the fret to
// press lights up in that same colour.
//
// Nothing counts you in: the music starts when you play the first note, and a
// quiet click keeps the beat from there. A note counts if it is played in its
// window; a long one (a beat and a half or more) also has to ring through most
// of its length. Held: full marks. Cut short: half.
//
// On a phone the screen turns to landscape for the take and back after. In a
// browser held upright, the stage is drawn sideways instead.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Capacitor } from '@capacitor/core';
import { ScreenOrientation } from '@capacitor/screen-orientation';
import type { RiffNote } from './riff';
import { OPEN_MIDI, STRING_NAME, STRING_TINT, riffBeats, riffMidi } from './riff';
import { Board } from './LessonTab';
import type { Dot } from './LessonTab';
import { audioNow } from './sound';
import { useMicPitch } from '../hooks/useMicPitch';
import { audio } from '../utils/audio';
import { feel } from '../utils/haptics';
import { BACK_EVENT } from '../utils/nativeShell';
import { noteName } from './hints';

const pcOf = (m: number) => ((m % 12) + 12) % 12;


type Result = 'hit' | 'short' | 'miss';
const LONG = 1.5; // beats: from here a note has to be held
const HOLD = 0.7; // of its length
const PPB = 72;
const LINE = 96; // where the play line sits

export interface StageResult { score: number; hits: number; short: number; total: number }

export const Stage: React.FC<{
  notes: RiffNote[];
  bpm: number;
  title: string;
  screen: boolean;
  onDone: (r: StageResult | null) => void;
}> = ({ notes, bpm, title, screen, onDone }) => {
  const beat = 60 / bpm;
  const starts = useMemo(() => { let t = 0; return notes.map(n => { const s0 = t; t += n[2]; return s0; }); }, [notes]);
  const total = riffBeats(notes);
  const mic = useMicPitch('instrument');
  const { start, stop, lastPluck } = mic;
  const [t0, setT0] = useState<number | null>(null);
  const [res, setRes] = useState<Result[]>([]);
  const [word, setWord] = useState<{ text: string; k: number; tone: Result } | null>(null);
  const [flash, setFlash] = useState<{ st: number; f: number; k: number } | null>(null);
  const strip = useRef<SVGSVGElement>(null);
  const resRef = useRef<Result[]>([]);
  const hitAt = useRef<number[]>([]);
  const held = useRef<{ midi: number; since: number } | null>(null);
  const pRef = useRef(mic.pitch);
  pRef.current = mic.pitch;
  const stopClicks = useRef<() => void>(() => {});
  const doneRef = useRef(false);

  // ---- Sideways for the take ----
  const native = Capacitor.isNativePlatform();
  const [upright, setUpright] = useState(() => window.innerHeight > window.innerWidth);
  useEffect(() => {
    if (native) {
      void ScreenOrientation.lock({ orientation: 'landscape' }).catch(() => {});
      return () => { void ScreenOrientation.lock({ orientation: 'portrait' }).catch(() => {}); };
    }
    const f = () => setUpright(window.innerHeight > window.innerWidth);
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, [native]);
  const rotate = !native && upright;

  useEffect(() => {
    if (screen) return;
    void start();
    return () => stop();
  }, [screen, start, stop]);
  useEffect(() => () => stopClicks.current(), []);
  // Back closes the stage first, not the whole lesson behind it.
  useEffect(() => {
    const onBack = (e: Event) => { e.preventDefault(); e.stopImmediatePropagation(); stopClicks.current(); onDone(null); };
    window.addEventListener(BACK_EVENT, onBack, true);
    return () => window.removeEventListener(BACK_EVENT, onBack, true);
  }, [onDone]);

  const say = (text: string, tone: Result) => setWord({ text, k: Date.now(), tone });
  const longNote = (i: number) => notes[i][2] >= LONG;
  const windowOf = (i: number, t: number) => {
    const s0 = t + starts[i] * beat;
    const len = notes[i][2] * beat;
    const close = i + 1 < notes.length ? Math.min(s0 + Math.min(len, 0.55) + 0.08, s0 + len - 0.06) : s0 + Math.min(len, 0.55) + 0.08;
    return { s0, open: s0 - 0.16, close, len };
  };

  /** The first note starts the music: the clock is set so it lands on time. */
  const begin = () => {
    const now = audioNow();
    const t = now - starts[0] * beat;
    setT0(t);
    resRef.current = [];
    hitAt.current = [];
    stopClicks.current = audio.playStoppable(() => {
      for (let b = 1; b <= Math.ceil(total) + 1; b++) audio.playClick(t + b * beat, b % 4 === 0);
    });
    return t;
  };

  const mark = (i: number, r: Result) => {
    resRef.current[i] = r;
    setRes([...resRef.current]);
    if (r === 'miss') say('Missed', 'miss');
  };

  /** A note was played at `now`: the first open window it fits takes it. */
  const played = (midi: number, now: number, t: number): boolean => {
    for (let i = 0; i < notes.length; i++) {
      if (resRef.current[i] !== undefined || hitAt.current[i] !== undefined) continue;
      const w = windowOf(i, t);
      if (now < w.open) break;
      if (now <= w.close && pcOf(midi) === pcOf(riffMidi(notes[i]))) {
        hitAt.current[i] = now;
        feel('select');
        if (!longNote(i)) { mark(i, 'hit'); say('Yes', 'hit'); }
        return true;
      }
    }
    return false;
  };

  // ---- On screen: tap and hold the lit fret ----
  const tap = (st: number, f: number) => {
    const midi = OPEN_MIDI[st] + f;
    audio.playMidi(midi, notes.some(n => riffMidi(n) === midi && n[2] >= LONG) ? 2.4 : 1.2);
    setFlash({ st, f, k: Date.now() });
    held.current = { midi, since: audioNow() };
    if (t0 === null) {
      if (midi !== riffMidi(notes[0])) return;
      const t = begin();
      played(midi, audioNow(), t);
      return;
    }
    played(midi, audioNow(), t0);
  };
  const release = () => { held.current = null; };

  // ---- With the guitar: the mic starts it, and hears each note ----
  useEffect(() => {
    if (screen || t0 !== null || !mic.pitch) return;
    if (pcOf(mic.pitch.midi) === pcOf(riffMidi(notes[0]))) {
      const t = begin();
      played(riffMidi(notes[0]), audioNow(), t);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mic.pitch, t0, screen]);

  // ---- The run: slide the tab, close windows, check the holds ----
  useEffect(() => {
    if (t0 === null) return;
    let raf = 0;
    const skew = performance.now() / 1000 - audioNow();
    let usedPluck = 0;
    const loop = () => {
      const now = audioNow();
      const beatsIn = (now - t0) / beat;
      if (strip.current) strip.current.style.transform = `translateX(${LINE - beatsIn * PPB}px)`;
      const cur = screen ? null : pRef.current;
      for (let i = 0; i < notes.length; i++) {
        if (resRef.current[i] !== undefined) continue;
        const w = windowOf(i, t0);
        // Waiting on a hold: did it ring through?
        if (hitAt.current[i] !== undefined) {
          const due = w.s0 + w.len * HOLD;
          const ringing = screen
            ? !!held.current && held.current.midi === riffMidi(notes[i])
            : !!cur && pcOf(cur.midi) === pcOf(riffMidi(notes[i]));
          const fill = Math.min(1, Math.max(0, (now - w.s0) / (w.len * HOLD)));
          const bar = document.getElementById(`stg-hold-${i}`);
          if (bar) bar.setAttribute('width', String(Math.max(0, fill * (notes[i][2] * PPB - 6))));
          if (!ringing && now < due) { mark(i, 'short'); say('Let it ring', 'short'); continue; }
          if (now >= due) { mark(i, 'hit'); say('Held', 'hit'); }
          continue;
        }
        if (now < w.open) break;
        if (!screen && cur) {
          const want = pcOf(riffMidi(notes[i]));
          const same = i > 0 && pcOf(riffMidi(notes[i - 1])) === want;
          const pluck = lastPluck() / 1000 - skew;
          const plucked = !same || (pluck >= w.open && pluck > usedPluck);
          if (pcOf(cur.midi) === want && plucked) {
            usedPluck = Math.max(usedPluck, pluck);
            played(cur.midi, now, t0);
            continue;
          }
        }
        if (now > w.close) mark(i, 'miss');
      }
      if (beatsIn > total + 0.8 && !doneRef.current) {
        doneRef.current = true;
        stopClicks.current();
        const r = resRef.current;
        const hits = r.filter(x => x === 'hit').length;
        const short = r.filter(x => x === 'short').length;
        if (import.meta.env.DEV) Object.assign(window, { __stageRes: r.map(x => x[0]).join('') });
        window.setTimeout(() => onDone({ score: (hits + short * 0.5) / notes.length, hits, short, total: notes.length }), 700);
        return;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t0]);

  if (import.meta.env.DEV) Object.assign(window, { __stage: { t0, beat, starts, now: audioNow, midis: notes.map(riffMidi), res: resRef.current } });

  // ---- Drawing ----
  const rowY = (st: number) => 14 + (st - 1) * 20;
  const H = 14 * 2 + 20 * 5;
  const W = Math.ceil(total * PPB + LINE + 200);
  const next = (() => { for (let i = 0; i < notes.length; i++) if (resRef.current[i] === undefined && hitAt.current[i] === undefined) return i; return -1; })();
  const nowNote = next >= 0 ? notes[next] : undefined;
  const first = notes[0];
  const where = (n: RiffNote) => (n[1] === 0 ? `open ${STRING_NAME[n[0]]}` : `${STRING_NAME[n[0]]} string, fret ${n[1]}`);
  const done = res.filter(Boolean).length;
  const frets = notes.map(n => n[1]);
  const lo = Math.min(...frets);
  const from = lo <= 1 ? 0 : lo - 1;
  const to = Math.max(from + 5, Math.max(...frets));
  const dots = new Map<string, Dot>();
  const soon = next >= 0 ? notes[next + 1] : undefined;
  if (soon) dots.set(`${soon[0]}-${soon[1]}`, 'soon');
  if (nowNote) dots.set(`${nowNote[0]}-${nowNote[1]}`, 'next');

  return createPortal(
    <div className={`stg${rotate ? ' is-rotated' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
      <header className="stg-top">
        <button type="button" className="lp-stop" onClick={() => { feel('select'); stopClicks.current(); onDone(null); }} aria-label="Stop" data-feel="off">
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor" /></svg>
        </button>
        <p className="stg-say">
          {t0 === null
            ? <>Play <b style={{ color: STRING_TINT[first[0]] }}>{noteName(riffMidi(first))}</b> to start <small>{where(first)}</small></>
            : word ? <span key={word.k} className={`stg-word is-${word.tone}`}>{word.text}</span> : <span className="stg-word is-quiet">{title}</span>}
        </p>
        <span className="stg-count readout">{done}<small>/{notes.length}</small></span>
      </header>

      <div className="stg-tab">
        <div className="stg-names" aria-hidden="true">{[1, 2, 3, 4, 5, 6].map(st => <span key={st} style={{ top: rowY(st) - 8, color: STRING_TINT[st] }}>{['', 'e', 'B', 'G', 'D', 'A', 'E'][st]}</span>)}</div>
        <div className="stg-window">
          <svg ref={strip} className="stg-strip" width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ transform: `translateX(${LINE}px)` }}>
            {[1, 2, 3, 4, 5, 6].map(st => <line key={st} className="stg-line" x1="0" x2={W} y1={rowY(st)} y2={rowY(st)} />)}
            {Array.from({ length: Math.ceil(total) + 1 }, (_, b) => <line key={b} className={`stg-beat${b % 4 === 0 ? ' is-bar' : ''}`} x1={b * PPB} x2={b * PPB} y1={rowY(1) - 8} y2={rowY(6) + 8} />)}
            {notes.map((n, i) => {
              const x = starts[i] * PPB + 2;
              const w = Math.max(20, n[2] * PPB - 6);
              const r = res[i];
              return (
                <g key={i} className={`stg-note${r ? ` is-${r}` : i === next ? ' is-now' : ''}${n[2] >= LONG ? ' is-long' : ''}`} style={{ ['--tint' as string]: STRING_TINT[n[0]] } as React.CSSProperties}>
                  <rect className="stg-bar" x={x} y={rowY(n[0]) - 8} width={w} height="16" rx="8" />
                  {n[2] >= LONG && <rect id={`stg-hold-${i}`} className="stg-fill" x={x} y={rowY(n[0]) - 8} width="0" height="16" rx="8" />}
                  <text x={x + 9} y={rowY(n[0]) + 4.2}>{n[1]}</text>
                </g>
              );
            })}
          </svg>
          <i className="stg-now" style={{ left: LINE }} aria-hidden="true" />
        </div>
      </div>

      <div className="stg-play">
        {screen ? (
          <Board strings={[1, 2, 3, 4, 5, 6]} from={from} to={to} dots={dots} onTap={tap} onRelease={release} flash={flash}
            width={720} row={24} tint={st => STRING_TINT[st]} />
        ) : (
          <div className="stg-ear">
            {nowNote ? <>
              <b style={{ color: STRING_TINT[nowNote[0]] }}>{noteName(riffMidi(nowNote))}</b>
              <span>{where(nowNote)}{nowNote[2] >= LONG ? ': let it ring' : ''}</span>
            </> : <span>That is the lot.</span>}
            <small>{mic.error ? 'The mic is off. Allow it in your phone\'s settings.' : mic.pitch ? `Hearing ${noteName(mic.pitch.midi)}` : 'Listening'}</small>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};
