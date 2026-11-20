import { getTempoMarking } from '../utils/strum';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Select } from '../components/Select';
import { LabIcon } from '../components/LabIcon';
import { Pendulum } from '../components/Pendulum';
import { PulseGrooveStage, SwingFeel } from '../components/PulseGrooveStage';
import { usePlayKey } from '../hooks/usePlayKey';
import { audio } from '../utils/audio';
import { logTempo } from '../utils/tempoLog';
import { reportProgress } from '../utils/progress';
import { feel } from '../utils/haptics';
import { setRecord } from '../utils/feats';
import { usePracticeTime } from '../hooks/usePracticeTime';
import { useSessionEnd } from '../utils/session';
import { frameGate } from '../utils/frames';
import { swingOffbeat } from '../utils/swing';

// A tap test counts toward Clockwork once it is a real test.
const CLOCKWORK_TAPS = 16;
const CLOCKWORK_BPM = 70;

interface TapHit {
  id: number;
  expectedTime: number;
  actualTime: number;
  differenceMs: number; // actual - expected
  rating: 'perfect' | 'good' | 'imprecise' | 'miss';
}

// Events plotted on the live timing graph. All times are audio-clock seconds.
interface TimelineBeat {
  time: number;      // when the click is HEARD (scheduled time + output latency)
  accented: boolean; // beat 1 of the bar
}
interface TimelineTap {
  time: number;        // when the press landed on the audio clock
  matchedTime: number; // heard time of the beat this tap was graded against
  differenceMs: number;
  rating: TapHit['rating'];
}

// Scrolling oscilloscope-style strip: metronome clicks (as heard) and taps
// drift right-to-left; the horizontal gap between paired spikes IS the timing
// error. Draws from refs via requestAnimationFrame, no React state per frame.
const TimingGraph: React.FC<{
  beatsRef: React.MutableRefObject<TimelineBeat[]>;
  tapsRef: React.MutableRefObject<TimelineTap[]>;
  /** Scrolling only while the click runs; stopped, the last frame holds. */
  active: boolean;
}> = ({ beatsRef, tapsRef, active }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const g = canvas.getContext('2d');
    if (!g) return;

    // Fixed palette, independent of the app theme, this canvas is a
    // "stage" surface (like the Sound Physics waveforms) that stays dark
    // regardless of light/dark mode, so its colors can't be sourced from
    // the live --primary/--warning/etc theme tokens (those shift to darker,
    // low-contrast values in light mode, which would read fine as page text
    // but muddy against this canvas's own always-dark background).
    const colors = {
      beat: 'var(--primary)',
      tap: '#FF6A2A',
      perfect: '#46C08A',
      good: 'var(--primary)',
      imprecise: '#E5C463',
      miss: '#FF4D5E',
      grid: 'rgba(255,255,255,0.07)',
      text: '#8b93a7'
    };

    const WINDOW_S = 4; // seconds of history shown
    let rafId = 0;
    const due = frameGate();

    const draw = () => {
      if (!due()) { rafId = requestAnimationFrame(draw); return; }
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);

      const now = audio.getCurrentTime();
      const pxPerSec = w / WINDOW_S;
      const xFor = (t: number) => w - (now - t) * pxPerSec;
      const baseline = h - 16;

      // Prune events that scrolled out of view
      beatsRef.current = beatsRef.current.filter(b => b.time > now - WINDOW_S - 0.5);
      tapsRef.current = tapsRef.current.filter(t => t.time > now - WINDOW_S - 0.5);

      // Faint gridline each second
      g.strokeStyle = colors.grid;
      g.lineWidth = 1;
      for (let t = Math.floor(now); t > now - WINDOW_S; t--) {
        const x = xFor(t);
        g.beginPath();
        g.moveTo(x, 6);
        g.lineTo(x, baseline);
        g.stroke();
      }
      // Baseline
      g.beginPath();
      g.moveTo(0, baseline);
      g.lineTo(w, baseline);
      g.stroke();

      // Metronome spikes at their HEARD time (only once actually audible)
      for (const b of beatsRef.current) {
        if (b.time > now) continue;
        const x = xFor(b.time);
        g.strokeStyle = colors.beat;
        g.lineWidth = b.accented ? 3 : 2;
        g.globalAlpha = 0.9;
        g.beginPath();
        g.moveTo(x, baseline);
        g.lineTo(x, b.accented ? 10 : 24);
        g.stroke();
      }
      g.globalAlpha = 1;

      // Tap spikes + dashed connector to their matched beat + ms label
      for (const t of tapsRef.current) {
        const x = xFor(t.time);
        g.strokeStyle = colors.tap;
        g.lineWidth = 2.5;
        g.beginPath();
        g.moveTo(x, baseline);
        g.lineTo(x, 38);
        g.stroke();

        const mx = xFor(t.matchedTime);
        g.strokeStyle = colors[t.rating];
        g.lineWidth = 1;
        g.setLineDash([3, 3]);
        g.beginPath();
        g.moveTo(mx, 38);
        g.lineTo(x, 38);
        g.stroke();
        g.setLineDash([]);

        g.fillStyle = colors[t.rating];
        g.font = "10px 'JetBrains Mono', monospace";
        g.textAlign = 'center';
        const label = `${t.differenceMs > 0 ? '+' : ''}${t.differenceMs}ms`;
        g.fillText(label, (x + mx) / 2, 34);
      }

      // Live latency readout (what the grader is compensating for)
      g.fillStyle = colors.text;
      g.font = "9px 'JetBrains Mono', monospace";
      g.textAlign = 'left';
      g.fillText(`output latency: ${Math.round(audio.getOutputLatency() * 1000)}ms`, 6, h - 4);
      g.textAlign = 'right';
      g.fillText('now', w - 12, 12);
      // Small drawn triangle marking the "now" line, sharper at any zoom
      // level than relying on the ▶ glyph in a 9px monospace font.
      g.beginPath();
      g.moveTo(w - 8, 8);
      g.lineTo(w - 8, 16);
      g.lineTo(w - 2, 12);
      g.closePath();
      g.fill();

      rafId = active ? requestAnimationFrame(draw) : 0;
    };

    rafId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafId);
  }, [beatsRef, tapsRef, active]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: '110px',
          display: 'block',
          background: '#0E0F11',
          border: '1px solid rgba(255,255,255,0.05)',
          borderRadius: '8px'
        }}
      />
      <div style={{ display: 'flex', gap: '1rem', fontSize: '0.65rem', color: 'var(--text-muted)', justifyContent: 'center' }}>
        <span><span style={{ color: 'var(--primary)' }}>▌</span> Metronome (as heard)</span>
        <span><span style={{ color: 'var(--warning)' }}>▌</span> Your taps</span>
        <span>gap = your timing error</span>
      </div>
    </div>
  );
};

const BPM_MIN = 40;
const BPM_MAX = 220;

/**
 * How often the ladder takes a rung.
 *
 * Eight bars is about twenty seconds at a hundred, long enough to have
 * actually settled into a tempo rather than survived it, short enough that a
 * ten-minute practice climbs somewhere.
 */
const RAMP_BARS = 8;

const RAMPS: { value: number; label: string; title: string }[] = [
  { value: 0, label: 'Off', title: 'Hold the tempo where it is' },
  { value: 2, label: '+2', title: `Two beats a minute faster every ${RAMP_BARS} bars` },
  { value: 5, label: '+5', title: `Five beats a minute faster every ${RAMP_BARS} bars` }
];

export const RhythmLab: React.FC = () => {
  const [bpm, setBpm] = useState<number>(100);
  const [timeSignature, setTimeSignature] = useState<number>(4); // beats per bar
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  // Counted while the click runs; badges wait for Stop.
  usePracticeTime('metronome', isPlaying);
  useSessionEnd('metronome', isPlaying, () => ({ title: 'Rhythm', headline: `${bpm} bpm` }));
  // Clicks to a beat. The pulse is always the beat; this is the texture under
  // it, which is what a strumming hand is actually counting.
  const [subdivision, setSubdivision] = useState<number>(1);
  // Metronome visual style: Groove pulse waves vs traditional precision pendulum
  const [metronomeVisual, setMetronomeVisual] = useState<'groove' | 'precision'>('groove');
  // Swing feel ratio (0 = straight, 0.67 = triplet shuffle)
  const [swing, setSwing] = useState<number>(0);
  // Beats per minute added every RAMP_BARS bars, or 0 to stay put.
  const [ramp, setRamp] = useState<number>(0);
  // Bars heard so far this run, not bars scheduled, which is up to 120ms ahead.
  const [bars, setBars] = useState<number>(0);
  
  // Rhythm game states
  // Three jobs, three tabs: keep time with the click, test your timing, and
  // hear what feel does. Tap test is the old Game mode.
  const [tab, setTab] = useState<'play' | 'tap' | 'feel'>('play');
  const isGameMode = tab === 'tap';
  const [touch, setTouch] = useState<'open' | 'muted' | null>(null);
  const taps = useRef<number[]>([]);
  const [tapHistory, setTapHistory] = useState<TapHit[]>([]);
  const [overallAccuracy, setOverallAccuracy] = useState<number>(0);
  const [feedback, setFeedback] = useState<{ text: string; color: string; offset: number } | null>(null);

  // Metronome Scheduler Refs
  const isPlayingRef = useRef<boolean>(false);
  const bpmRef = useRef<number>(100);
  const timeSignatureRef = useRef<number>(4);
  const subdivisionRef = useRef<number>(1);
  const swingRef = useRef<number>(0);
  const rampRef = useRef<number>(0);
  const schedulerTimerId = useRef<number | null>(null);

  // What the current run is, for the log it leaves behind when it stops.
  const runFrom = useRef<number>(100);
  const runStarted = useRef<number>(0);
  
  const nextBeatTime = useRef<number>(0.0);    // precise audio clock time of next beat
  const beatIndex = useRef<number>(0);         // current beat counter within the measure
  const scheduledBeats = useRef<{ index: number; audioTime: number; expired: boolean }[]>([]);

  // Live timing-graph event logs (drawn by TimingGraph, pruned there too)
  const timelineBeats = useRef<TimelineBeat[]>([]);
  const timelineTaps = useRef<TimelineTap[]>([]);

  // Update refs when state changes so the background scheduler timer sees them instantly
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    bpmRef.current = bpm;
  }, [bpm]);

  useEffect(() => {
    timeSignatureRef.current = timeSignature;
  }, [timeSignature]);

  useEffect(() => {
    subdivisionRef.current = subdivision;
  }, [subdivision]);

  useEffect(() => {
    swingRef.current = swing;
  }, [swing]);

  useEffect(() => {
    rampRef.current = ramp;
  }, [ramp]);

  // Metronome scheduler tick (runs every 25ms in JS loop)
  const scheduleNextBeats = () => {
    if (!isPlayingRef.current) return;

    const ctxTime = audio.getCurrentTime();
    const scheduleAheadTime = 0.12; // schedule 120ms ahead
    const outputLatency = audio.getOutputLatency();

    while (nextBeatTime.current < ctxTime + scheduleAheadTime) {
      const beatsPerBar = timeSignatureRef.current;
      const beatNum = beatIndex.current % beatsPerBar;
      const isAccented = beatNum === 0;
      if (isAccented) setBars(Math.floor(beatIndex.current / beatsPerBar));

      // The ladder takes its rung on the bar line, which is where a change of
      // tempo belongs, arriving mid-bar it reads as the click slipping.
      if (isAccented && beatIndex.current > 0 && rampRef.current > 0) {
        const bar = beatIndex.current / beatsPerBar;
        if (bar % RAMP_BARS === 0) {
          const faster = Math.min(BPM_MAX, bpmRef.current + rampRef.current);
          if (faster !== bpmRef.current) {
            bpmRef.current = faster;
            setBpm(faster);
          }
        }
      }

      // Read after the ramp, so the bar it changes on is already the new tempo.
      const secondsPerBeat = 60.0 / bpmRef.current;

      // 1. Play synthesized woodblock tick at the exact audio time
      audio.playClick(nextBeatTime.current, isAccented);

      // The ticks between this beat and the next. Audio only: they are a
      // texture to play against, not events to be graded, and putting them in
      // the candidate list would let a tap land halfway between two beats and
      // be told it was perfect.
      const sub = subdivisionRef.current;
      const sw = swingRef.current;
      for (let s = 1; s < sub; s++) {
        let ratio = s / sub;
        if (sub === 2 && s === 1 && sw > 0) {
          // Swing delays the off-beat eighth: 0 is even (half way), 0.5 is the
          // triplet shuffle (two thirds of the way, long-short 2:1), 0.75 a
          // hard dotted swing (three quarters, 3:1). It used to stop at 0.61,
          // so "Shuffle" never actually reached a shuffle.
          ratio = swingOffbeat(sw);
        }
        audio.playClick(nextBeatTime.current + ratio * secondsPerBeat, false, true);
      }

      // 2. Keep record of the scheduled beat for the tapping match logic
      scheduledBeats.current.push({
        index: beatIndex.current,
        audioTime: nextBeatTime.current,
        expired: false
      });

      // Log for the timing graph at the moment the click will be HEARD
      timelineBeats.current.push({
        time: nextBeatTime.current + outputLatency,
        accented: isAccented
      });

      // Advance clock
      nextBeatTime.current += secondsPerBeat;
      beatIndex.current++;
    }

    // Prune beats older than 2 seconds, long past any grading window
    scheduledBeats.current = scheduledBeats.current.filter(b => b.audioTime > ctxTime - 2);
  };

  /**
   * Where the beat is now, continuously, in the time the click is heard.
   *
   * `nextBeatTime` is the first beat not yet scheduled and `beatIndex` is its
   * number, so counting back from the pair gives a position that is exact at
   * the instant of every tick and smooth in between. Latency is added because
   * the drawing has to agree with the ear, not with the scheduler: the click
   * written at T is heard at T plus the output latency, and a pendulum that
   * hit its stop before you heard the tick would be the one thing on this page
   * teaching the wrong lesson.
   *
   * Stable, so the drawing's animation frame is never torn down and rebuilt
   * by a re-render of this screen.
   */
  const beatAt = useCallback((): number | null => {
    if (!isPlayingRef.current) return null;
    const secondsPerBeat = 60 / bpmRef.current;
    const heardNext = nextBeatTime.current + audio.getOutputLatency();
    return beatIndex.current - (heardNext - audio.getCurrentTime()) / secondsPerBeat;
  }, []);

  const startMetronome = () => {
    audio.init();
    setIsPlaying(true);
    
    // Clear scheduled tracking
    scheduledBeats.current = [];
    timelineBeats.current = [];
    timelineTaps.current = [];
    nextBeatTime.current = audio.getCurrentTime() + 0.05;
    beatIndex.current = 0;
    setBars(0);
    runFrom.current = bpmRef.current;
    runStarted.current = Date.now();

    // Run scheduler loop every 25 milliseconds
    schedulerTimerId.current = window.setInterval(scheduleNextBeats, 25);
  };

  const stopMetronome = () => {
    setIsPlaying(false);
    isPlayingRef.current = false;
    if (schedulerTimerId.current !== null) {
      clearInterval(schedulerTimerId.current);
      schedulerTimerId.current = null;
    }
    if (runStarted.current > 0) {
      logTempo({
        from: runFrom.current,
        to: bpmRef.current,
        beatsPerBar: timeSignatureRef.current,
        seconds: (Date.now() - runStarted.current) / 1000
      });
      runStarted.current = 0;
    }
    setBars(0);
  };

  // Toggle Metronome on click
  const handleTogglePlay = () => {
    if (isPlaying) {
      stopMetronome();
    } else {
      startMetronome();
    }
  };

  // Rhythm Game: Tapping mechanics
  const handleTap = () => {
    if (!isPlaying) {
      // Auto-start metronome if tapped while idle in game mode
      startMetronome();
      setTapHistory([]);
      setFeedback({ text: 'Started. Tap along on the beat.', color: 'var(--primary)', offset: 0 });
      return;
    }

    const tapAudioTime = audio.getCurrentTime();

    // Latency compensation: a click scheduled at audio time T is physically
    // HEARD at T + outputLatency. The player taps in sync with what they hear,
    // so shift the tap back by that latency before comparing to schedule times.
    const outputLatency = audio.getOutputLatency();
    const perceivedTapTime = tapAudioTime - outputLatency;

    // Candidate beats: everything scheduled recently, PLUS the predicted next
    // beat. The next beat only gets scheduled ~120ms ahead of time, so without
    // it an early tap would be graded against the PREVIOUS beat as a huge miss.
    const candidateTimes = scheduledBeats.current.map(b => b.audioTime);
    candidateTimes.push(nextBeatTime.current);

    let closestTime: number | null = null;
    let minDifference = Infinity;
    for (const beatTime of candidateTimes) {
      const diff = Math.abs(perceivedTapTime - beatTime);
      if (diff < minDifference) {
        minDifference = diff;
        closestTime = beatTime;
      }
    }

    if (closestTime === null) return;

    // Calculate timing difference in milliseconds
    const difference = perceivedTapTime - closestTime;
    const differenceMs = Math.round(difference * 1000);
    const absDiff = Math.abs(differenceMs);

    // Grade accuracy
    let rating: TapHit['rating'] = 'miss';
    let text = 'Miss';
    let color = 'var(--danger)';

    if (absDiff <= 45) {
      rating = 'perfect';
      text = 'Perfect';
      color = 'var(--success)';
      reportProgress('rhythm-perfect-tap');
    } else if (absDiff <= 90) {
      rating = 'good';
      text = 'Good';
      color = 'var(--primary)';
    } else if (absDiff <= 160) {
      rating = 'imprecise';
      text = differenceMs > 0 ? 'Late' : 'Early';
      color = 'var(--warning)';
    }

    // Felt in the hand that tapped: a crisp click on the beat, a softer one
    // near it, a knock when it was not close.
    feel(rating === 'perfect' ? 'tap' : rating === 'good' || rating === 'imprecise' ? 'select' : 'error');

    // Set real-time overlay feedback
    setFeedback({
      text: `${text} (${differenceMs > 0 ? '+' : ''}${differenceMs}ms)`,
      color,
      offset: differenceMs
    });

    // Log for the timing graph: raw press time vs the heard time of its beat
    timelineTaps.current.push({
      time: tapAudioTime,
      matchedTime: closestTime + outputLatency,
      differenceMs,
      rating
    });

    const newHit: TapHit = {
      id: Date.now(),
      expectedTime: closestTime,
      actualTime: perceivedTapTime,
      differenceMs,
      rating
    };

    setTapHistory((prev) => {
      const updated = [newHit, ...prev].slice(0, 20); // Keep last 20 hits

      // Calculate average accuracy score (misses count as 0)
      const sumScore = updated.reduce((acc, h) => {
        if (h.rating === 'perfect') return acc + 100;
        if (h.rating === 'good') return acc + 75;
        if (h.rating === 'imprecise') return acc + 40;
        return acc; // miss
      }, 0);
      setOverallAccuracy(Math.round(sumScore / updated.length));
      return updated;
    });
  };

  // Keyboard support: Spacebar taps the beat
  // The bar is the app's now, not this page's. In the game it is the thing you
  // tap with, which is still "what this screen does when you press Space".
  usePlayKey(() => { if (isGameMode) handleTap(); else handleTogglePlay(); });

  // Clean up timers on unmount, and leave the log behind, because walking
  // off to the chord page is a way of stopping the metronome too and a run
  // that only counted when you pressed the button would quietly lose half of
  // them.
  useEffect(() => {
    return () => {
      if (schedulerTimerId.current) {
        clearInterval(schedulerTimerId.current);
      }
      if (runStarted.current > 0) {
        logTempo({
          from: runFrom.current,
          to: bpmRef.current,
          beatsPerBar: timeSignatureRef.current,
          seconds: (Date.now() - runStarted.current) / 1000
        });
        runStarted.current = 0;
      }
    };
  }, []);

  // Tap tempo: the average gap between the last few presses, forgotten after
  // three seconds so a fresh run of taps starts clean.
  const tapTempo = () => {
    const now = performance.now();
    const kept = [...taps.current, now].filter(t => now - t < 3000).slice(-5);
    taps.current = kept;
    if (kept.length < 2) return;
    const gaps = kept.slice(1).map((t, i) => t - kept[i]);
    const next = Math.round(60000 / (gaps.reduce((x, y) => x + y, 0) / gaps.length));
    if (next >= BPM_MIN && next <= BPM_MAX) setBpm(next);
  };

  // The same strum, open and palm-muted.
  const playTouch = (type: 'open' | 'muted') => {
    audio.init();
    setTouch(type);
    const chord = [40, 45, 50, 55, 59, 64];
    if (type === 'open') audio.playStrum(chord, 3.0, 0.04);
    else audio.playStroke(chord, 'X', 0.2);
    window.setTimeout(() => setTouch(null), type === 'open' ? 1400 : 350);
  };

  const climbed = isPlaying && bpm > runFrom.current ? bpm - runFrom.current : 0;
  // A verdict, once there are enough taps to mean something: the average
  // signed offset of the hits (misses are not timing, they are absence).
  const hits = tapHistory.filter(h => h.rating !== 'miss').slice(0, 12);
  const lean = hits.length >= 8 ? Math.round(hits.reduce((n, h) => n + h.differenceMs, 0) / hits.length) : null;
  const verdict = lean === null ? null : Math.abs(lean) < 8 ? 'Right on the beat' : lean < 0 ? `You rush by about ${-lean} ms` : `You drag by about ${lean} ms`;
  const timeSig = timeSignature === 6 ? '6/8' : `${timeSignature}/4`;
  // How close the verdict's taps sat to the beat, unsigned: the Clockwork
  // number. Rushing 10 and dragging 10 are both 10 ms away.
  // Only a real test counts toward the record: 16 on-beat taps at 70 bpm or
  // more. Eight slow taps can land close by luck.
  const testHits = tapHistory.filter(h => h.rating !== 'miss').slice(0, CLOCKWORK_TAPS);
  const tightness = testHits.length >= CLOCKWORK_TAPS && bpm >= CLOCKWORK_BPM
    ? Math.round(testHits.reduce((n, h) => n + Math.abs(h.differenceMs), 0) / testHits.length)
    : null;
  useEffect(() => {
    if (tightness !== null && tightness > 0) setRecord('tap-tightest', tightness);
  }, [tightness]);

  return (
    <div className="lab-stack rhythm">
      <div className="lab-header">
        <h2 className="lab-title"><LabIcon tab="rhythm" />Rhythm</h2>
      </div>

      <div className="rh-tabs" role="tablist" aria-label="Rhythm">
        {([['play', 'Play along'], ['tap', 'Tap test'], ['feel', 'Feel']] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={`rh-tab${tab === id ? ' is-active' : ''}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab !== 'feel' && (
        <section className="rh-tempo">
          <div className="rh-tempo-row">
            <button type="button" className="rh-round" onClick={() => setBpm(prev => Math.max(BPM_MIN, prev - 5))} aria-label="5 bpm slower">−</button>
            <div className="rh-bpm">
              <span className="rh-bpm-num readout">{bpm}</span>
              <span className="rh-bpm-word">bpm · {getTempoMarking(bpm)}</span>
            </div>
            <button type="button" className="rh-round" onClick={() => setBpm(prev => Math.min(BPM_MAX, prev + 5))} aria-label="5 bpm faster">+</button>
          </div>
          <input
            type="range"
            className="rh-slider"
            min={BPM_MIN}
            max={BPM_MAX}
            value={bpm}
            onChange={e => setBpm(Number(e.target.value))}
            aria-label="Tempo in beats per minute"
          />
          <div className="rh-chips">
            <button type="button" className="chip-btn" onClick={tapTempo}>Tap tempo</button>
            <Select<number>
              className="chip-btn rh-pick"
              label="Time signature"
              value={timeSignature}
              options={[{ value: 2, label: '2/4', hint: 'Duple' }, { value: 3, label: '3/4', hint: 'Waltz' }, { value: 4, label: '4/4', hint: 'Common' }, { value: 6, label: '6/8', hint: 'Compound' }]}
              onChange={setTimeSignature}
            >
              {timeSig} ▾
            </Select>
            {tab === 'play' && (
              <>
                <Select<number>
                  className="chip-btn rh-pick"
                  label="Clicks per beat"
                  value={subdivision}
                  options={[1, 2, 3, 4].map(n => ({ value: n, label: `${n} click${n === 1 ? '' : 's'} a beat` }))}
                  onChange={n => {
                    setSubdivision(n);
                    // Swing lives between pairs of eighths; with any other
                    // count there is nothing for it to move.
                    if (n !== 2) setSwing(0);
                  }}
                >
                  {subdivision === 1 ? '1 click a beat' : `${subdivision} clicks a beat`} ▾
                </Select>
                <Select<'groove' | 'precision'>
                  className="chip-btn rh-pick"
                  label="View"
                  value={metronomeVisual}
                  options={[{ value: 'groove', label: 'Pulse' }, { value: 'precision', label: 'Pendulum' }]}
                  onChange={setMetronomeVisual}
                >
                  {metronomeVisual === 'groove' ? 'Pulse' : 'Pendulum'} ▾
                </Select>
                {/* Speeds the click up on its own, every few bars. */}
                <Select<number>
                  className="chip-btn rh-pick"
                  label={`Build speed every ${RAMP_BARS} bars`}
                  value={ramp}
                  options={RAMPS.map(r => ({ value: r.value, label: r.value ? `${r.label} bpm` : 'Off', hint: r.title }))}
                  onChange={setRamp}
                >
                  {ramp ? `Speed +${ramp}` : 'Speed steady'} ▾
                </Select>
              </>
            )}
          </div>
        </section>
      )}

      {tab === 'play' && (
        <>
          <div className="metronome-stage rh-stage">
              {metronomeVisual === 'groove' ? (
                <PulseGrooveStage
                  beatsPerBar={timeSignature}
                  subdivision={subdivision}
                  bpm={bpm}
                  swing={swing}
                  onSwingChange={setSwing}
                  at={beatAt}
                  isPlaying={isPlaying}
                  showFeel={false}
                />
              ) : (
                <Pendulum beatsPerBar={timeSignature} subdivision={subdivision} at={beatAt} onBar={setBars} running={isPlaying} />
              )}
          </div>

        </>
      )}

      {tab === 'tap' && (
        <section className="rh-card">
          <div className="rh-card-head">
            <span className="surface-label">Tap test</span>
            {tapHistory.length > 0 && <span className="rh-sub readout">{overallAccuracy}% accurate</span>}
          </div>
          <button type="button" className="rh-pad" onPointerDown={handleTap}>
            <span className="rh-pad-big" style={feedback ? { color: feedback.color } : undefined}>{feedback ? feedback.text : 'Tap'}</span>
            <span className="rh-pad-small">{isPlaying ? 'on the beat, or press Space' : 'Tap to start the click, then tap on the beat'}</span>
          </button>
          {tapHistory.length > 0 && (
            <>
              <div className="rh-spread" aria-hidden="true">
                {tapHistory.slice(0, 16).map(h => (
                  <i key={h.id} className={`is-${h.rating}`} style={{ left: `${50 + Math.max(-48, Math.min(48, h.differenceMs / 3))}%` }} />
                ))}
              </div>
              <div className="rh-spread-labels"><span>early</span><span>on the beat</span><span>late</span></div>
            </>
          )}
          {verdict ? (
            <p className="rh-verdict">{verdict}<small>
              Average of your last {hits.length} hits. Under 20 ms is tight.
              {tightness === null && (bpm < CLOCKWORK_BPM
                ? ` Clockwork counts from ${CLOCKWORK_BPM} bpm.`
                : ` ${CLOCKWORK_TAPS - testHits.length} more for a Clockwork test.`)}
            </small></p>
          ) : tapHistory.length > 0 ? (
            <p className="rh-sub">{8 - hits.length} more on-beat taps for a verdict.</p>
          ) : null}
          <TimingGraph beatsRef={timelineBeats} tapsRef={timelineTaps} active={isPlaying} />
        </section>
      )}

      {tab === 'feel' && (
        <>
          <section className="rh-card">
            <SwingFeel
              swing={swing}
              onSwingChange={amount => {
                setSwing(amount);
                // A swung feel is heard in the off-beat click. With one click a
                // beat there is none, so asking for swing brings in the eighths.
                if (amount > 0 && subdivision !== 2) setSubdivision(2);
              }}
            />
          </section>
          <section className="rh-card">
            <span className="surface-label">Open or muted</span>
            <p className="rh-lead">The same strum, two ways. Muted is the side of your picking hand resting on the strings by the bridge.</p>
            <div className="touch-buttons-row">
              <button type="button" className={`touch-btn is-open-touch${touch === 'open' ? ' is-active' : ''}`} onClick={() => playTouch('open')}>
                <span className="touch-title">Open</span>
                <span className="touch-sub">Let it ring</span>
              </button>
              <button type="button" className={`touch-btn is-muted-touch${touch === 'muted' ? ' is-active' : ''}`} onClick={() => playTouch('muted')}>
                <span className="touch-title">Palm mute</span>
                <span className="touch-sub">Short and percussive</span>
              </button>
            </div>
          </section>
        </>
      )}

      {/* Start, docked: pressed every time, so it is always in reach. */}
      <div className="rh-dock">
        <div className="rh-dock-text">
          <span className="rh-dock-title">{isPlaying ? `Bar ${bars + 1}` : 'Metronome'}</span>
          <span className="rh-dock-sub readout">
            {bpm} bpm · {timeSig}{climbed > 0 ? ` · up ${climbed} from ${runFrom.current}` : ''}
          </span>
        </div>
        <button type="button" className={`btn ${isPlaying ? 'btn-secondary' : 'btn-primary'} rh-go`} onClick={handleTogglePlay}>
          {isPlaying ? (
            <><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2" /></svg>Stop</>
          ) : (
            <><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="6 4 20 12 6 20" /></svg>Start</>
          )}
        </button>
      </div>
    </div>
  );
};
export default RhythmLab;
