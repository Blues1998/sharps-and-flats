import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Segmented } from './Segmented';
import { Select } from './Select';
import { PitchTrace } from './PitchTrace';
import { IconPlay, IconStop } from './Icons';
import { useMicPitch } from '../hooks/useMicPitch';
import { audio } from '../utils/audio';
import { reportProgress } from '../utils/progress';
import { usePracticeTime } from '../hooks/usePracticeTime';
import { heard } from '../utils/practiceClock';
import { HoldSummary } from './HoldSummary';
import {
  GRADE_LABEL, MILESTONES, bestChime, gradeFor, hitChime, milestoneChime, missChime, setChime, useChime, type Grade
} from '../utils/chime';
import { countHold, provenRange, setRecord, unlockShowing, useFeats, useHoldUnlocks } from '../utils/feats';
import { endedRun, freshRun, saveRun, type HoldRun } from '../utils/holdRun';
import { confetti } from '../utils/confetti';
import { feel } from '../utils/haptics';
import {
  SA_CHOICES, closestVoiceType, labelFor, prettyNote, setVoice, useVoice,
  type NoteLabel, type Notation, type Range
} from '../utils/voice';

// The tuner, for a voice.
//
// Three things a singer actually does with one: watch what their voice is
// doing (Sing), practise landing and holding a note (Hold), and find out where
// their voice lives (Range), which the song pages then use to say whether a
// song is in a key you can sing.

type Mode = 'sing' | 'hold' | 'range';

const MODE_KEY = 'cadenza-voice-mode';
const BAND_CENTS = 30;        // in tune, for a held sung note
const HOLD_TARGET_MS = 1500;  // long enough that you have stopped arriving and are holding
const REFERENCE_MS = 1700;    // the reference note's length, plus its tail in the room
const RANGE_HOLD_MS = 500;    // a note counts toward your range once held this long
const MISS_MS = 8000;         // to land each note once a streak is going, or it breaks
const SILENCE_MS = 30000;     // of hearing nothing, and the run is over
const TOO_STEADY_CENTS = 1.5; // steadier than any voice: a tone from a speaker
const STRETCH_CHANCE = 1 / 6; // how often a target sits just past your landed range
const VOICE_LOWEST = 36;      // C2
const VOICE_HIGHEST = 84;     // C6

const toMidi = (hz: number) => 12 * Math.log2(hz / 440) + 69;

/** A note name, or a sargam syllable with its komal/tivra and octave marks. */
export const NoteName: React.FC<{ label: NoteLabel; className?: string }> = ({ label, className }) => (
  <span className={`notename${label.komal ? ' is-komal' : ''}${label.tivra ? ' is-tivra' : ''}${className ? ` ${className}` : ''}`}>
    {label.octave > 0 && <span className="notename-dots is-above" aria-hidden="true">{'•'.repeat(label.octave)}</span>}
    <span className="notename-text">{label.text}</span>
    {label.octave < 0 && <span className="notename-dots is-below" aria-hidden="true">{'•'.repeat(-label.octave)}</span>}
  </span>
);

// ---- A tanpura-ish drone on Sa, for singing against -----------------------
// Sa and the Sa above, on soft triangle waves with a slow shimmer. Plain
// oscillators rather than samples: it only has to hold still, and it has to
// be quiet enough that the mic still hears the voice over it.
//
// Only Sa. It used to add Pa and the Sa below as well, and that drone was
// heard, by ears and by the pitch detector alike, an octave under the Sa it
// was named for: the low Sa sat underneath, and Sa with Pa repeats once per
// cycle of the Sa below. A drone on C3 read as C2, and so did a voice singing
// C3 against it. A triangle wave's third harmonic is Pa an octave up, so the
// fifth is still in the sound without moving its pitch.
function startDrone(sa: number): () => void {
  const bus = audio.getMasterBus();
  if (!bus) return () => {};
  const { ctx, input } = bus;
  const out = ctx.createGain();
  out.gain.setValueAtTime(0, ctx.currentTime);
  out.gain.linearRampToValueAtTime(0.18, ctx.currentTime + 0.8);
  out.connect(input);
  const oscs: OscillatorNode[] = [];
  for (const [semi, level] of [[0, 0.55], [12, 0.3]] as const) {
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 440 * Math.pow(2, (sa + semi - 69) / 12);
    const g = ctx.createGain();
    g.gain.value = level;
    // The shimmer: each string breathes at its own slow rate.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.2 + Math.random() * 0.3;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = level * 0.35;
    lfo.connect(lfoGain).connect(g.gain);
    osc.connect(g).connect(out);
    osc.start();
    lfo.start();
    oscs.push(osc, lfo);
  }
  return () => {
    const t = ctx.currentTime;
    out.gain.cancelScheduledValues(t);
    out.gain.setValueAtTime(out.gain.value, t);
    out.gain.linearRampToValueAtTime(0, t + 0.4);
    oscs.forEach(o => o.stop(t + 0.45));
  };
}

export const VoiceTuner: React.FC = () => {
  const { pitch, isActive, error, start, stop } = useMicPitch('voice');
  // Singing is practice: counted while the mic hears your voice.
  usePracticeTime('voice', isActive, { mic: true });
  const voice = useVoice();
  const { notation, sa } = voice;
  // Opens where you left it: most people come back for the same thing.
  const [mode, setModeState] = useState<Mode>(() => {
    try {
      const saved = localStorage.getItem(MODE_KEY);
      return saved === 'hold' || saved === 'range' ? saved : 'sing';
    } catch { return 'sing'; }
  });
  const setMode = (m: Mode) => {
    setModeState(m);
    try { localStorage.setItem(MODE_KEY, m); } catch { /* fine */ }
  };

  const live = pitch ? toMidi(pitch.frequency) : null;
  const nearest = live !== null ? Math.round(live) : null;
  const cents = live !== null && nearest !== null ? Math.round((live - nearest) * 100) : null;

  // Journey: the first pitch heard counts here too.
  const reported = useRef(false);
  useEffect(() => {
    if (pitch && !reported.current) { reported.current = true; reportProgress('tuner-pitch-detected'); }
  }, [pitch]);

  // ---- Drone (Sing only) ---------------------------------------------------
  const [droning, setDroning] = useState(false);
  const stopDrone = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!droning) return;
    stopDrone.current = startDrone(sa);
    return () => { stopDrone.current?.(); stopDrone.current = null; };
  }, [droning, sa]);
  useEffect(() => { if (mode !== 'sing') setDroning(false); }, [mode]);

  // ---- Hold a note --------------------------------------------------------
  const pool = useCallback((): number[] => {
    const r = voice.range;
    const low = r ? r.low + 1 : sa;
    const high = r ? r.high - 1 : sa + 12;
    return Array.from({ length: Math.max(1, high - low + 1) }, (_, i) => low + i);
  }, [voice.range, sa]);

  const chimeOn = useChime();
  const feats = useFeats();
  const best = feats.records['hold-streak']?.value ?? 0;

  // A run is only ever the notes landed in a row: stop singing (mic off, page
  // or app left, another mode) and it is over. One that ended while you were
  // away opens as its summary when you come back. See holdRun.
  const [ended] = useState(endedRun);
  const [run, setRunState] = useState<HoldRun>(() => freshRun(ended?.target ?? sa + 7));
  const runRef = useRef(run);
  const setRun = useCallback((next: HoldRun) => {
    runRef.current = next;
    setRunState(next);
  }, []);
  const [summary, setSummary] = useState<HoldRun | null>(ended);

  const [target, setTarget] = useState<number>(() => run.target ?? sa + 7);
  const targetRef = useRef(target);
  targetRef.current = target;
  const [holdMs, setHoldMs] = useState(0);
  const [lastResult, setLastResult] = useState<{ note: number; spread: number } | null>(null);
  const holdRef = useRef({ ms: 0, last: 0, samples: [] as number[], quietUntil: 0 });
  const missMs = useRef(0);
  const lastPitch = useRef(performance.now());
  const [missLeft, setMissLeft] = useState<number | null>(null);
  const [flash, setFlash] = useState<{ key: number; grade: Grade | 'miss'; text: string; sub: string } | null>(null);
  const [banner, setBanner] = useState<{ key: number; text: string; mark?: string; best?: boolean } | null>(null);
  const bannerTimer = useRef<number | undefined>(undefined);
  const showBanner = (b: { text: string; mark?: string; best?: boolean }) => {
    setBanner({ ...b, key: performance.now() });
    window.clearTimeout(bannerTimer.current);
    bannerTimer.current = window.setTimeout(() => setBanner(null), 2200);
  };

  // Shown once: the stored run is cleared as soon as it is on screen.
  useEffect(() => { saveRun(null); }, []);
  // Leaving the page ends the run; its summary waits for the next visit.
  useEffect(() => () => {
    window.clearTimeout(bannerTimer.current);
    if (runRef.current.held > 0) saveRun({ ...runRef.current, target: targetRef.current });
  }, []);

  // Now and then a stretch note: one just past the lowest or highest note you
  // have landed, which is how a proven range grows (see Range Finder).
  const [stretch, setStretch] = useState(false);
  const newTarget = useCallback((from?: number) => {
    const options = pool().filter(n => n !== (from ?? target));
    let next = options[Math.floor(Math.random() * options.length)] ?? sa;
    const proven = provenRange();
    const opts = pool();
    let isStretch = false;
    if (proven && opts.length > 0 && Math.random() < STRETCH_CHANCE) {
      const edge = Math.random() < 0.5 ? proven.low - 1 : proven.high + 1;
      // Within reach: no more than a few notes past the range you saved.
      if (edge >= Math.max(VOICE_LOWEST, opts[0] - 3) && edge <= Math.min(VOICE_HIGHEST, opts[opts.length - 1] + 3)) {
        next = edge;
        isStretch = true;
      }
    }
    setStretch(isStretch);
    setTarget(next);
    holdRef.current = { ms: 0, last: 0, samples: [], quietUntil: holdRef.current.quietUntil };
    missMs.current = 0;
    setHoldMs(0);
  }, [pool, target, sa]);

  const playReference = (note = target) => {
    audio.init();
    audio.playMidi(note, 1.4);
    // Don't let the phone hear its own speaker and call that a match.
    holdRef.current.quietUntil = performance.now() + REFERENCE_MS;
  };

  const endRun = useCallback(() => {
    const r = runRef.current;
    if (r.held === 0) return;
    setSummary(r);
    setRun(freshRun(targetRef.current));
  }, [setRun]);

  // Anything that stops the singing ends the run: the mic going off, another
  // mode, or the app going to the background (a locked phone included).
  useEffect(() => {
    if (!(mode === 'hold' && isActive)) endRun();
  }, [mode, isActive, endRun]);
  useEffect(() => {
    const away = () => { if (document.visibilityState === 'hidden') endRun(); };
    document.addEventListener('visibilitychange', away);
    return () => document.removeEventListener('visibilitychange', away);
  }, [endRun]);

  const startOver = (pickNew: boolean) => {
    setSummary(null);
    setRun(freshRun(target));
    lastPitch.current = performance.now();
    if (pickNew) newTarget();
  };

  // Landing a note.
  useEffect(() => {
    if (mode !== 'hold' || !isActive || summary) return;
    const h = holdRef.current;
    const now = performance.now();
    if (live !== null) lastPitch.current = now;
    const dt = h.last === 0 ? 16 : Math.min(100, now - h.last);
    h.last = now;
    if (now < h.quietUntil || unlockShowing()) return;

    const inBand = live !== null && Math.abs(live - target) * 100 <= BAND_CENTS;
    if (inBand) {
      h.ms += dt;
      h.samples.push((live! - target) * 100);
    } else {
      h.ms = Math.max(0, h.ms - dt * 2);
      if (h.ms === 0) h.samples = [];
    }
    setHoldMs(h.ms);
    if (h.ms < HOLD_TARGET_MS) return;

    // How steady it was: the spread of the held pitch, in cents.
    const s = h.samples;
    const mean = s.reduce((a, b) => a + b, 0) / s.length;
    const spread = Math.round(Math.sqrt(s.reduce((a, b) => a + (b - mean) ** 2, 0) / s.length));
    // No voice holds a note this still: a tone from a speaker does. It does not
    // land, and nothing about the run changes.
    if (spread < TOO_STEADY_CENTS) {
      setFlash({ key: now, grade: 'miss', text: 'Too steady for a voice', sub: 'Sing it yourself' });
      h.ms = 0;
      h.samples = [];
      setHoldMs(0);
      h.quietUntil = now + 800;
      return;
    }
    const grade = gradeFor(spread);
    const r = runRef.current;
    const streak = r.streak + 1;
    const next: HoldRun = {
      ...r, streak, max: Math.max(r.max, streak), held: r.held + 1,
      perfect: r.perfect + (grade === 'perfect' ? 1 : 0), spreads: [...r.spreads, spread], target
    };

    hitChime(grade, target);
    feel('success');
    setFlash({ key: now, grade, text: GRADE_LABEL[grade], sub: `${prettyNote(target)} · ±${spread}¢` });
    setLastResult({ note: target, spread });
    missMs.current = 0;
    setMissLeft(null);
    reportProgress('tuner-note-matched');
    countHold();

    // Records first: a badge they earn takes the stage, and the run's own
    // fanfare stands aside for it rather than playing over the cadence.
    const before = unlockShowing();
    setRecord('hold-steadiest', spread, prettyNote(target));
    if (grade === 'perfect') setRecord('hold-perfect-run', next.perfect);
    setRecord('hold-streak', streak);
    setRecord('hold-low', target, prettyNote(target));
    setRecord('hold-high', target, prettyNote(target));
    const badge = !before && unlockShowing();

    let quiet = 1200;
    if (!next.passedBest && next.startBest > 0 && streak === next.startBest + 1) {
      next.passedBest = true;
      showBanner({ text: `New best · ${streak}`, best: true });
      if (!badge) {
        window.setTimeout(() => { bestChime(60); confetti(); feel('celebrate'); }, 380);
        quiet = 2800;
      }
    } else {
      const m = MILESTONES.find(x => x.n === streak);
      if (m) {
        showBanner({ text: `${m.n} in a row`, mark: m.mark });
        if (!badge) {
          window.setTimeout(() => { milestoneChime(m, 60); feel('celebrate'); }, 380);
          quiet = 2400;
        }
      }
    }
    setRun(next);

    h.ms = 0;
    h.samples = [];
    // A beat to see it land before the next one, and quiet so the chime is
    // not heard as singing.
    h.quietUntil = now + quiet;
    setTimeout(() => newTarget(target), 700);
  }, [live, mode, isActive, target, newTarget, summary, setRun]);

  // The clocks: 8 seconds to land each note once a streak is going, and 30
  // seconds of silence to end the run. Both stand still behind a badge.
  useEffect(() => {
    if (mode !== 'hold' || !isActive || summary) return;
    let last = performance.now();
    lastPitch.current = last;
    const id = window.setInterval(() => {
      const now = performance.now();
      const dt = now - last;
      last = now;
      if (unlockShowing()) { lastPitch.current += dt; return; }
      const r = runRef.current;
      if (r.held > 0) runRef.current = { ...r, activeMs: r.activeMs + dt };
      const h = holdRef.current;
      if (r.streak > 0 && now >= h.quietUntil && h.ms === 0) {
        missMs.current += dt;
        const left = Math.ceil((MISS_MS - missMs.current) / 1000);
        setMissLeft(left <= 4 ? Math.max(0, left) : null);
        if (missMs.current >= MISS_MS) {
          const note = targetRef.current;
          missMs.current = 0;
          setMissLeft(null);
          missChime(note - 12);
          feel('error');
          setFlash({ key: now, grade: 'miss', text: `Missed ${prettyNote(note)}`, sub: `Streak was ${r.streak}` });
          setRun({ ...runRef.current, streak: 0 });
        }
      } else if (r.streak === 0) {
        setMissLeft(null);
      }
      if (r.held > 0 && now - lastPitch.current > SILENCE_MS) endRun();
    }, 250);
    return () => window.clearInterval(id);
  }, [mode, isActive, summary, endRun, setRun]);

  const heat = MILESTONES.filter(m => run.streak >= m.n).length / MILESTONES.length;
  // A note heard is proof of singing, unless it is the app's own sound: the
  // drone on Sa (and its octaves) or the reference note just played.
  useEffect(() => {
    if (!pitch) return;
    if (performance.now() < holdRef.current.quietUntil) return;
    if (droning) {
      const m = toMidi(pitch.frequency);
      if ([sa - 12, sa - 5, sa, sa + 7, sa + 12, sa + 19, sa + 24].some(d => Math.abs(m - d) < 0.25)) return;
    }
    heard();
  }, [pitch, droning, sa]);
  // Badges earned during a run wait until it is over (the summary lists them too).
  useHoldUnlocks('voice-run', mode === 'hold' && ((isActive && run.held > 0) || !!summary));

  // ---- Range ---------------------------------------------------------------
  const [found, setFound] = useState<Range | null>(null);
  const rangeRef = useRef<{ note: number | null; since: number }>({ note: null, since: 0 });
  useEffect(() => {
    if (mode !== 'range' || !isActive || live === null) { rangeRef.current.note = null; return; }
    const note = Math.round(live);
    const steady = Math.abs(live - note) < 0.4;
    const now = performance.now();
    const r = rangeRef.current;
    if (!steady || r.note !== note) { rangeRef.current = { note: steady ? note : null, since: now }; return; }
    if (now - r.since >= RANGE_HOLD_MS) {
      setFound(f => (f ? { low: Math.min(f.low, note), high: Math.max(f.high, note) } : { low: note, high: note }));
    }
  }, [live, mode, isActive]);

  const label = (m: number) => labelFor(m, notation, sa);
  const saved = voice.range;

  const holdPct = Math.min(100, (holdMs / HOLD_TARGET_MS) * 100);

  return (
    <div className="voice">
      {/* The stage: the trace fills it, and everything you read while singing
          floats over it, so the line gets every pixel the screen can spare. */}
      <section className="glass-panel voice-stage" style={mode === 'hold' ? { '--heat': heat } as React.CSSProperties : undefined}>
        <PitchTrace pitch={live} notation={notation} sa={sa} target={mode === 'hold' ? target : null} bandCents={BAND_CENTS} height="fill" />

        <div className="voice-hud">
          <div className="voice-readout">
            <span className={`voice-note readout${nearest !== null ? ' is-live' : ''}`}>
              {nearest !== null ? <NoteName label={label(nearest)} /> : '-'}
            </span>
            <span className="voice-cents readout">
              {cents !== null ? `${cents > 0 ? '+' : ''}${cents}¢${notation === 'sargam' ? ` · ${prettyNote(nearest!)}` : ''}` : isActive ? 'sing' : ''}
            </span>
          </div>
          <div className="voice-controls">
            <Segmented<Notation>
              value={notation}
              onChange={n => setVoice({ notation: n })}
              options={[{ value: 'names', label: 'C D E' }, { value: 'sargam', label: 'Sa Re' }]}
              size="sm"
            />
            {notation === 'sargam' && (
              <Select<number>
                className="voice-sa"
                label="Sa"
                value={sa}
                options={SA_CHOICES.map(m => ({ value: m, label: `Sa ${prettyNote(m)}` }))}
                onChange={m => setVoice({ sa: m })}
              />
            )}
          </div>
        </div>

        {isActive ? (
          <button onClick={stop} className="voice-stop" aria-label="Stop listening" title="Stop listening">
            <span className="tuner-stop-dot" aria-hidden="true" />
          </button>
        ) : (
          <div className="voice-start">
            <button onClick={start} className="btn btn-primary">Turn on the mic</button>
            
          </div>
        )}
        {error && <p className="micbar-error voice-error">{error}</p>}
        {mode === 'hold' && flash && (
          <div key={flash.key} className={`hold-flash is-${flash.grade}`} aria-live="polite">
            {flash.text}<small className="readout">{flash.sub}</small>
          </div>
        )}
        {mode === 'hold' && banner && (
          <div key={banner.key} className={`hold-banner${banner.best ? ' is-best' : ''}`}>
            {banner.mark && <span className="hold-mark" aria-hidden="true">{banner.mark}</span>}
            {banner.text}
          </div>
        )}
      </section>

      <section className="glass-panel voice-dock">
        <Segmented<Mode>
          value={mode}
          onChange={setMode}
          options={[
            { value: 'sing', label: 'Sing' },
            { value: 'hold', label: 'Hold a note' },
            { value: 'range', label: 'Range' }
          ]}
          size="sm"
          full
        />

        {mode === 'sing' && (
          <div className="voice-pane">
            <div className="voice-row">
              <button type="button" className={`btn${droning ? ' btn-primary' : ''}`} onClick={() => { audio.init(); setDroning(d => !d); }}>
                {droning ? <IconStop size={12} /> : <IconPlay size={12} />}
                {droning ? 'Stop drone' : `Drone on Sa · ${prettyNote(sa)}`}
              </button>
              <span className="voice-hint">Use headphones: through the speaker, the mic hears the drone too.</span>
            </div>
            
          </div>
        )}

        {mode === 'hold' && (
          <div className="voice-pane">
            <div className="hold-score">
              <span key={run.streak} className={`hold-streak readout${run.streak > 0 ? ' is-up' : ''}`}>{run.streak}</span>
              <span className="hold-streak-l">
                <b>in a row</b>
                {missLeft !== null
                  ? <span className="is-warn">Land it in {missLeft}s</span>
                  : stretch ? 'Stretch note: just past your range'
                  : run.streak > 0 ? '8 seconds for each note' : 'Miss one and it starts over'}
              </span>
              <span className={`hold-best${run.passedBest ? ' is-new' : ''}`}>
                <span>Best</span><b className="readout">{Math.max(best, run.max)}</b>
              </span>
            </div>
            <div className="voice-hold-bar" aria-label={`Held ${Math.round(holdPct)}%`}><span style={{ width: `${holdPct}%` }} /></div>
            <div className="voice-row voice-holdrow">
              <button type="button" className="btn voice-step" onClick={() => { setTarget(t => t - 1); holdRef.current.ms = 0; missMs.current = 0; }} aria-label="One semitone lower">−</button>
              <div className="voice-target-note">
                <NoteName label={label(target)} className="voice-target-name" />
                {notation === 'sargam' && <span className="voice-hint">{prettyNote(target)}</span>}
              </div>
              <button type="button" className="btn voice-step" onClick={() => { setTarget(t => t + 1); holdRef.current.ms = 0; missMs.current = 0; }} aria-label="One semitone higher">+</button>
              <button type="button" className="btn btn-primary" onClick={() => playReference()}>
                <IconPlay size={12} /> Hear it
              </button>
              <button type="button" className="btn" onClick={() => newTarget()}>New</button>
            </div>
            <div className="voice-stats readout">
              <span>Held <strong>{run.held}</strong></span>
              <span>Perfect <strong>{run.perfect}</strong></span>
              <span>{lastResult ? `Last ±${lastResult.spread}¢` : 'Hold in the green band'}</span>
              <span className="hold-tools">
                <button type="button" className="linklike" aria-pressed={chimeOn} onClick={() => setChime(!chimeOn)}>
                  {chimeOn ? 'Chime on' : 'Chime off'}
                </button>
                {run.held > 0 && <button type="button" className="linklike" onClick={endRun}>End run</button>}
              </span>
            </div>
          </div>
        )}

        {mode === 'range' && (
          <div className="voice-pane">
            <div className="voice-row voice-rangerow">
              <div className="voice-rangeend">
                <span className="voice-target-label">Lowest</span>
                <span className="voice-range-note readout">{found ? <NoteName label={label(found.low)} /> : '-'}</span>
              </div>
              <div className="voice-rangeend">
                <span className="voice-target-label">Highest</span>
                <span className="voice-range-note readout">{found ? <NoteName label={label(found.high)} /> : '-'}</span>
              </div>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!found || found.high - found.low < 5}
                onClick={() => found && setVoice({ range: found })}
              >
                Save
              </button>
              <button type="button" className="btn" onClick={() => setFound(null)} disabled={!found}>Reset</button>
            </div>
            <p className="voice-hint">
              {found && found.high - found.low >= 5
                ? <>{found.high - found.low} semitones ({prettyNote(found.low)} to {prettyNote(found.high)}), closest to <strong>{closestVoiceType(found)}</strong>.</>
                : saved
                  ? <>Saved: <strong>{prettyNote(saved.low)} to {prettyNote(saved.high)}</strong>. Sing again to update it.</>
                  : 'Hold your lowest note, then your highest.'}
            </p>
          </div>
        )}
      </section>
      {summary && <HoldSummary run={summary} onAgain={() => startOver(true)} onDone={() => startOver(false)} />}
    </div>
  );
};

export default VoiceTuner;
