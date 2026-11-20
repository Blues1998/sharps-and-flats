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
// of its length. Held: full marks. Cut short: half. Two misses in a row and
// the song goes back to the top, waiting for the first note again.
//
// On screen the board shows only the strings and frets the song uses, sized to
// fill the space, and a tap next to the lit fret counts as the lit fret: the
// skill here is timing, not aiming. The timing is looser than with a guitar.
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
import { appSoundEnd, appSounding, audioNow } from './sound';
import { useMicPitch } from '../hooks/useMicPitch';
import { audio } from '../utils/audio';
import { feel } from '../utils/haptics';
import { BACK_EVENT } from '../utils/nativeShell';
import { noteName } from './hints';
import { openLesson } from './store';
import { track } from '../utils/telemetry';

const pcOf = (m: number) => ((m % 12) + 12) % 12;


type Result = 'hit' | 'short' | 'miss';
const LONG = 1.5; // beats: from here a note has to be held
const HOLD = 0.7; // of its length, with a guitar
const HOLD_SCREEN = 0.6; // a finger lifts early to reach the next fret
const PPB = 72;
const LINE = 96; // where the play line sits
const RESTART_AFTER = 2; // misses in a row

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
  const missRun = useRef(0);
  const restarts = useRef(0);
  const stoppedRef = useRef<() => void>(() => {});
  /** Times through: a restart redraws the tab from the top. */
  const [take, setTake] = useState(0);
  /** Audio time of the last restart: the mic needs a fresh pluck after it. */
  const restartAt = useRef(-1);
  const playRef = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState({ w: 720, h: 200 });
  useEffect(() => {
    const el = playRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setRoom({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // A finger that slides off the fret still holds the note until it lifts.
  useEffect(() => {
    const up = () => { held.current = null; };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => { window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
  }, []);

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
    const onBack = (e: Event) => { e.preventDefault(); e.stopImmediatePropagation(); stopClicks.current(); stoppedRef.current(); onDone(null); };
    window.addEventListener(BACK_EVENT, onBack, true);
    return () => window.removeEventListener(BACK_EVENT, onBack, true);
  }, [onDone]);

  const say = (text: string, tone: Result) => setWord({ text, k: Date.now(), tone });
  const longNote = (i: number) => notes[i][2] >= LONG;
  const windowOf = (i: number, t: number) => {
    const s0 = t + starts[i] * beat;
    const len = notes[i][2] * beat;
    // A tap is looser than a pluck: no string to find by feel, and touch lags.
    const early = screen ? 0.28 : 0.16;
    const late = screen ? Math.min(len, 0.7) + 0.14 : Math.min(len, 0.55) + 0.08;
    const close = i + 1 < notes.length ? Math.min(s0 + late, s0 + len - (screen ? 0.03 : 0.06)) : s0 + late;
    return { s0, open: s0 - early, close, len };
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
    missRun.current = r === 'miss' ? missRun.current + 1 : 0;
    if (r === 'miss') say('Missed', 'miss');
  };

  /** Back to the top: the clock stops and the first note starts it again. */
  /** Left before the end: how far it got, for usage. */
  const stopped = () => track('song_take', { lesson: openLesson(), finished: false, reached: resRef.current.filter(Boolean).length, total: notes.length, screen, restarts: restarts.current });
  stoppedRef.current = stopped;

  const restart = () => {
    track('song_restarted', { lesson: openLesson(), at: resRef.current.length - 1, screen });
    restarts.current++;
    stopClicks.current();
    stopClicks.current = () => {};
    resRef.current = [];
    hitAt.current = [];
    missRun.current = 0;
    held.current = null;
    restartAt.current = audioNow();
    setRes([]);
    setWord(null);
    setT0(null);
    setTake(k => k + 1);
    feel('nudge');
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
  const tap = (tst: number, tf: number) => {
    // Near enough is the note: snap to a lit fret within one string and one fret.
    let st = tst, f = tf;
    const now0 = audioNow();
    const live = t0 === null ? [0] : notes.map((_, i) => i).filter(i => {
      if (resRef.current[i] !== undefined || hitAt.current[i] !== undefined) return false;
      const w = windowOf(i, t0);
      return now0 >= w.open && now0 <= w.close;
    });
    let bestD = 9;
    for (const i of live) {
      const ds = Math.abs(notes[i][0] - tst), df = Math.abs(notes[i][1] - tf);
      if (ds <= 1 && df <= 1 && ds + df < bestD) { bestD = ds + df; st = notes[i][0]; f = notes[i][1]; }
    }
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
    // The example the app just played may still ring: only a pluck after it starts the take.
    if (appSounding() || lastPluck() <= appSoundEnd()) return;
    // After a restart the last note may still ring: wait for a new pluck.
    if (restartAt.current >= 0 && lastPluck() / 1000 - (performance.now() / 1000 - audioNow()) <= restartAt.current) return;
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
          const hold = screen ? HOLD_SCREEN : HOLD;
          const due = w.s0 + w.len * hold;
          const ringing = screen
            ? !!held.current && held.current.midi === riffMidi(notes[i])
            : !!cur && pcOf(cur.midi) === pcOf(riffMidi(notes[i]));
          const fill = Math.min(1, Math.max(0, (now - w.s0) / (w.len * hold)));
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
      if (missRun.current >= RESTART_AFTER) { restart(); return; }
      if (beatsIn > total + 0.8 && !doneRef.current) {
        doneRef.current = true;
        stopClicks.current();
        const r = resRef.current;
        const hits = r.filter(x => x === 'hit').length;
        const short = r.filter(x => x === 'short').length;
        if (import.meta.env.DEV) Object.assign(window, { __stageRes: r.map(x => x[0]).join('') });
        const score = (hits + short * 0.5) / notes.length;
        track('song_take', { lesson: openLesson(), finished: true, score: Math.round(score * 100) / 100, hits, short, total: notes.length, screen, restarts: restarts.current });
        window.setTimeout(() => onDone({ score, hits, short, total: notes.length }), 700);
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
  // Only the strings the song uses, on the tab and on the board.
  const used = notes.map(n => n[0]);
  const boardStrings = Array.from({ length: Math.max(...used) - Math.min(...used) + 1 }, (_, i) => Math.min(...used) + i);
  const gap = boardStrings.length <= 3 ? 26 : boardStrings.length <= 4 ? 22 : 17;
  const rowY = (st: number) => 12 + (st - boardStrings[0]) * gap;
  const H = 12 * 2 + gap * (boardStrings.length - 1);
  const W = Math.ceil(total * PPB + LINE + 200);
  const next = (() => { for (let i = 0; i < notes.length; i++) if (resRef.current[i] === undefined && hitAt.current[i] === undefined) return i; return -1; })();
  const nowNote = next >= 0 ? notes[next] : undefined;
  const first = notes[0];
  const where = (n: RiffNote) => (n[1] === 0 ? `open ${STRING_NAME[n[0]]}` : `${STRING_NAME[n[0]]} string, fret ${n[1]}`);
  const done = res.filter(Boolean).length;
  const frets = notes.map(n => n[1]);
  const from = Math.min(...frets);
  const to = Math.max(from + 3, Math.max(...frets));
  const boardRow = Math.max(24, Math.min(72, (room.h - 36) / boardStrings.length));
  const dots = new Map<string, Dot>();
  const soon = next >= 0 ? notes[next + 1] : undefined;
  if (soon) dots.set(`${soon[0]}-${soon[1]}`, 'soon');
  if (nowNote) dots.set(`${nowNote[0]}-${nowNote[1]}`, 'next');

  return createPortal(
    <div className={`stg${rotate ? ' is-rotated' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
      <header className="stg-top">
        <button type="button" className="lp-stop" onClick={() => { feel('select'); stopClicks.current(); stopped(); onDone(null); }} aria-label="Stop" data-feel="off">
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor" /></svg>
        </button>
        <p className="stg-say">
          {t0 === null
            ? <>Play <b style={{ color: STRING_TINT[first[0]] }}>{noteName(riffMidi(first))}</b> to start
              {/* Same height either way, so the board never moves under a finger. */}
              {take > 0 ? <small key={take} className="stg-again">Two missed in a row. From the top.</small> : <small>{where(first)}</small>}</>
            : word ? <span key={word.k} className={`stg-word is-${word.tone}`}>{word.text}</span> : <span className="stg-word is-quiet">{title}</span>}
        </p>
        <span className="stg-count readout"><span key={done} className="is-tick">{done}</span><small>/{notes.length}</small></span>
      </header>

      <div className="stg-tab">
        <div className="stg-names" aria-hidden="true">{boardStrings.map(st => <span key={st} style={{ top: rowY(st) - 8, color: STRING_TINT[st] }}>{['', 'e', 'B', 'G', 'D', 'A', 'E'][st]}</span>)}</div>
        <div className="stg-window" style={{ height: H }}>
          <svg key={take} ref={strip} className="stg-strip" width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ transform: `translateX(${LINE}px)` }}>
            {boardStrings.map(st => <line key={st} className="stg-line" x1="0" x2={W} y1={rowY(st)} y2={rowY(st)} />)}
            {Array.from({ length: Math.ceil(total) + 1 }, (_, b) => <line key={b} className={`stg-beat${b % 4 === 0 ? ' is-bar' : ''}`} x1={b * PPB} x2={b * PPB} y1={rowY(boardStrings[0]) - 8} y2={rowY(boardStrings[boardStrings.length - 1]) + 8} />)}
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

      <div className="stg-play" ref={playRef}>
        {screen ? (
          <Board strings={boardStrings} from={from} to={to} dots={dots} onTap={tap} onRelease={release} flash={flash}
            width={Math.max(320, room.w)} row={boardRow} tint={st => STRING_TINT[st]} />
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
