import { Segmented } from '../components/Segmented';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Select } from '../components/Select';
import { useMicPitch } from '../hooks/useMicPitch';
import { Fretboard } from '../components/Fretboard';
import { LabIcon } from '../components/LabIcon';
import { audio } from '../utils/audio';
import {
  NOTE_NAMES,
  INTERVALS,
  CHORD_QUALITIES,
  SCALE_FORMULAS
} from '../utils/musicTheory';
import { CHORD_FEELINGS, shortScaleName } from '../utils/glossary';
import { bestClimb, markClimbed } from '../utils/feats';
import { followedStep } from '../utils/journeyStep';
import { reportProgress } from '../utils/progress';
import { IconCheck } from '../components/Icons';
import { feel } from '../utils/haptics';
import { useHeard, usePracticeTime } from '../hooks/usePracticeTime';
import { useSessionEnd } from '../utils/session';

// ---- Challenge tuning constants ----
const CONFIRM_MS = 350;  // how long the correct note must be held to count
const SLIP_MS = 550;     // how long a stable wrong note counts as a real miss
const CENTS_TOL = 45;    // generous, this game grades WHICH note, not intonation

const BEST_KEY = 'play-challenges-best-v1';

type Mode = 'scale' | 'interval' | 'chord';

interface Round {
  targets: number[];       // pitch classes (0-11) to play, in order
  chipLabels: string[];    // label under each step chip (note name or degree)
  promptTitle: string;
  promptDetail: string;
  contextPcs: number[];    // pitch classes shown green on the fretboard
  referenceMidis: number[]; // played by the "hear it" button (sequential)
  rewardMidis: number[];    // played together when the round is complete
  rootMidi: number;         // reference root (interval mode plays this)
  /** Scale climbs: "C Major", the key its best time is kept under. */
  climbKey?: string;
}

interface Feedback {
  type: 'ok' | 'slip' | 'info';
  text: string;
}

const randomOf = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

// All guitar-range midis (open E2 .. fret 12 of high E) with a given pitch class
const midisForPcs = (pcs: number[]): number[] => {
  const out: number[] = [];
  for (let m = 40; m <= 76; m++) {
    if (pcs.includes(m % 12)) out.push(m);
  }
  return out;
};

// Map a pitch class to a comfortable guitar-register midi (E2..D#3)
const pcToLowMidi = (pc: number): number => 40 + ((pc - 4 + 12) % 12);

// Intervals a beginner should meet first (semitone counts)
const COMMON_INTERVAL_SEMITONES = [2, 3, 4, 5, 7, 12];

/** 24.3 seconds as "0:24". */
const fmtTime = (sec: number): string => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

const ordinal = (n: number): string => ['Root', '3rd', '5th', '7th'][n] ?? `${n + 1}th`;

export const PlayLab: React.FC = () => {
  const { pitch, isActive, error: micError, start, stop } = useMicPitch();
  // Counted while the mic hears you play.
  usePracticeTime('challenge', isActive, { mic: true });
  useHeard(pitch);

  // Arriving from a Journey step opens the challenge it asks for.
  const [mode, setMode] = useState<Mode>(() => {
    const step = followedStep();
    return step === 'interval-hunt' ? 'interval' : step === 'build-chords' ? 'chord' : 'scale';
  });
  const [round, setRound] = useState<Round | null>(null);
  const [progressIdx, setProgressIdx] = useState<number>(0);
  const [phase, setPhase] = useState<'playing' | 'complete'>('playing');
  const [holdPct, setHoldPct] = useState<number>(0);
  const [feedback, setFeedback] = useState<Feedback>({ type: 'info', text: 'Play the first highlighted note to begin.' });
  const [revealed, setRevealed] = useState<boolean>(false);
  const [showTargets, setShowTargets] = useState<boolean>(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Scale climbs are timed from the first note heard to the last.
  const startedAtRef = useRef<number | null>(null);
  const [lastClimb, setLastClimb] = useState<{ key: string; seconds: number; previous?: number } | null>(null);

  // Session streak + persisted best streak per mode
  const [streak, setStreak] = useState<number>(0);
  const [best, setBest] = useState<Record<Mode, number>>(() => {
    try {
      return { scale: 0, interval: 0, chord: 0, ...JSON.parse(localStorage.getItem(BEST_KEY) ?? '{}') };
    } catch {
      return { scale: 0, interval: 0, chord: 0 };
    }
  });

  // Mode settings
  const [scaleRootPc, setScaleRootPc] = useState<number | 'random'>(0); // C
  const [scaleIdx, setScaleIdx] = useState<number>(0); // Major
  const [chordSevenths, setChordSevenths] = useState<boolean>(false);
  const [trickyIntervals, setTrickyIntervals] = useState<boolean>(false);

  // Matching engine refs (per-frame accumulators, no re-render churn)
  const holdMsRef = useRef<number>(0);
  const wrongMsRef = useRef<number>(0);
  const wrongPcRef = useRef<number | null>(null);
  const lastTickRef = useRef<number>(0);
  const armedRef = useRef<boolean>(true);
  const eventPcRef = useRef<number | null>(null);
  const nextRoundTimer = useRef<number | null>(null);
  // While the app itself is playing sound, ignore the mic, otherwise speaker
  // bleed from reference/reward notes could self-confirm the challenge
  const muteUntilRef = useRef<number>(0);

  const makeRound = useCallback((): Round => {
    if (mode === 'scale') {
      const rootPc = scaleRootPc === 'random' ? Math.floor(Math.random() * 12) : scaleRootPc;
      const scale = SCALE_FORMULAS[scaleIdx];
      const targets = scale.steps.map(s => (rootPc + s) % 12);
      const refMidis = scale.steps.map(s => pcToLowMidi(rootPc) + s);
      return {
        targets,
        chipLabels: targets.map(pc => NOTE_NAMES[pc]),
        promptTitle: `Climb the ${NOTE_NAMES[rootPc]} ${shortScaleName(scale.name)} scale`,
        promptDetail: 'Each note in order, any octave.',
        contextPcs: targets,
        referenceMidis: refMidis,
        rewardMidis: refMidis,
        rootMidi: pcToLowMidi(rootPc),
        climbKey: `${NOTE_NAMES[rootPc]} ${shortScaleName(scale.name)}`
      };
    }

    if (mode === 'chord') {
      const pool = chordSevenths ? CHORD_QUALITIES : CHORD_QUALITIES.slice(0, 4);
      const quality = randomOf(pool);
      const rootPc = Math.floor(Math.random() * 12);
      const targets = quality.intervals.map(i => (rootPc + i) % 12);
      const refMidis = quality.intervals.map(i => pcToLowMidi(rootPc) + i);
      const feeling = CHORD_FEELINGS[quality.name] ?? quality.name;
      return {
        targets,
        chipLabels: targets.map((pc, i) => `${NOTE_NAMES[pc]} · ${ordinal(i)}`),
        promptTitle: `Build ${NOTE_NAMES[rootPc]} ${quality.name} (${feeling})`,
        promptDetail: 'One note at a time, root first.',
        contextPcs: targets,
        referenceMidis: refMidis,
        rewardMidis: refMidis,
        rootMidi: pcToLowMidi(rootPc)
      };
    }

    // Interval Hunt
    const pool = INTERVALS.filter(iv =>
      iv.semitones > 0 && (trickyIntervals || COMMON_INTERVAL_SEMITONES.includes(iv.semitones))
    );
    const interval = randomOf(pool);
    const rootMidi = 45 + Math.floor(Math.random() * 13); // A2..A3, comfy register
    const targetPc = (rootMidi + interval.semitones) % 12;
    const rootName = `${NOTE_NAMES[rootMidi % 12]}${Math.floor(rootMidi / 12) - 1}`;
    return {
      targets: [targetPc],
      chipLabels: ['?'],
      promptTitle: `Play a ${interval.name} above ${rootName}`,
      promptDetail: `${interval.semitones} fret${interval.semitones === 1 ? '' : 's'} up, any octave.`,
      contextPcs: [rootMidi % 12],
      referenceMidis: [rootMidi],
      rewardMidis: [rootMidi, rootMidi + interval.semitones],
      rootMidi
    };
  }, [mode, scaleRootPc, scaleIdx, chordSevenths, trickyIntervals]);

  // `sound` is what separates a round you are about to play from one that is
  // only on screen. The interval hunt opens by playing its reference note,
  // which is right when you asked for a round and startling when the page has
  // merely finished loading, so the preview built before the mic is on is
  // built silently, and turning the mic on deals a fresh one that speaks.
  const startNewRound = useCallback((sound = true) => {
    const r = makeRound();
    setRound(r);
    setProgressIdx(0);
    setPhase('playing');
    setHoldPct(0);
    setRevealed(false);
    startedAtRef.current = null;
    holdMsRef.current = 0;
    wrongMsRef.current = 0;
    wrongPcRef.current = null;
    armedRef.current = true;
    eventPcRef.current = null;
    // Grace period covers the tail of the previous round's reward sound
    muteUntilRef.current = performance.now() + 800;
    setFeedback({
      type: 'info',
      text: mode === 'interval'
        ? 'Listen to the reference note, then hunt for the answer.'
        : `First up: ${NOTE_NAMES[r.targets[0]]}. Let it ring clearly.`
    });
    // Interval mode: play the reference note so the hunt starts by ear
    if (mode === 'interval' && sound) {
      muteUntilRef.current = performance.now() + 2800;
      window.setTimeout(() => {
        audio.init();
        audio.playMidi(r.rootMidi, 1.8);
      }, 500);
    }
  }, [makeRound, mode]);

  // New round whenever the mode or its settings change; reset session stats on mode switch
  useEffect(() => {
    setStreak(0);
  }, [mode]);

  // A round exists from the moment the page does. Before permission it is a
  // worked example of what the screen wants from you; granting it deals a new
  // one, out loud.
  useEffect(() => {
    startNewRound(isActive);
  }, [isActive, startNewRound]);

  // Persist best streak
  useEffect(() => {
    if (streak > best[mode]) {
      const updated = { ...best, [mode]: streak };
      setBest(updated);
      try {
        localStorage.setItem(BEST_KEY, JSON.stringify(updated));
      } catch { /* ignore */ }
    }
  }, [streak, mode, best]);

  // Clear any pending next-round timer on unmount / round churn
  useEffect(() => {
    return () => {
      if (nextRoundTimer.current !== null) window.clearTimeout(nextRoundTimer.current);
    };
  }, []);

  // Rounds finished since the mic went on, for the summary.
  const roundsRef = useRef(0);
  const bestStreakRef = useRef(0);
  const bestClimbRef = useRef<{ key: string; seconds: number; previous?: number } | null>(null);
  useEffect(() => { if (isActive) { roundsRef.current = 0; bestStreakRef.current = 0; bestClimbRef.current = null; } }, [isActive]);
  useEffect(() => { bestStreakRef.current = Math.max(bestStreakRef.current, streak); }, [streak]);
  useSessionEnd('challenge', isActive, () => {
    const rounds = roundsRef.current;
    const climb = mode === 'scale' ? bestClimbRef.current : null;
    return {
      title: 'Challenges',
      headline: climb ? fmtTime(climb.seconds) : `${rounds} ${rounds === 1 ? 'round' : 'rounds'}`,
      better: climb
        ? climb.previous === undefined ? `${climb.key}, your first climb.` : climb.seconds < climb.previous ? `${climb.key}. New best, was ${fmtTime(climb.previous)}.` : `${climb.key}, your fastest this time. Best is ${fmtTime(climb.previous)}.`
        : null,
      isBetter: !!climb && (climb.previous === undefined || climb.seconds < climb.previous),
      stats: [{ label: 'Rounds', value: String(rounds) }, { label: 'Best streak', value: String(bestStreakRef.current) }]
    };
  });

  const completeRound = () => {
    roundsRef.current++;
    if (mode === 'scale' && round?.climbKey && startedAtRef.current !== null) {
      const seconds = Math.round((performance.now() - startedAtRef.current) / 100) / 10;
      const { previous } = markClimbed(round.climbKey, seconds);
      setLastClimb({ key: round.climbKey, seconds, previous });
      if (!bestClimbRef.current || seconds < bestClimbRef.current.seconds) bestClimbRef.current = { key: round.climbKey, seconds, previous };
    }
    setStreak(s => s + 1);
    setPhase('complete');
    reportProgress(`play-${mode}-completed`);
    if (mode === 'scale' && SCALE_FORMULAS[scaleIdx].name.includes('Pentatonic')) {
      reportProgress('play-scale-completed:pentatonic');
    }
    feel('celebrate');
    setFeedback({ type: 'ok', text: 'Got it. Here it is all together.' });

    // Reward: hear what you just built
    audio.init();
    const now = audio.getCurrentTime();
    if (mode === 'chord') {
      round?.rewardMidis.forEach(m => audio.playMidi(m, 2.0, now + 0.45));
    } else {
      round?.rewardMidis.forEach((m, i) => audio.playMidi(m, 0.9, now + 0.4 + i * 0.22));
    }

    const delay = 700 + (round ? round.rewardMidis.length * 220 : 0);
    nextRoundTimer.current = window.setTimeout(() => startNewRound(), delay);
  };

  // ---- The matching engine: runs once per detected-pitch frame ----
  useEffect(() => {
    if (!isActive || phase !== 'playing' || !round) {
      lastTickRef.current = 0;
      return;
    }

    const now = performance.now();
    const elapsed = lastTickRef.current === 0 ? 16 : Math.min(100, now - lastTickRef.current);
    lastTickRef.current = now;

    // App audio is (or was just) playing, don't grade speaker bleed
    if (now < muteUntilRef.current) return;

    const targetPc = round.targets[progressIdx];
    const heardPc = pitch ? ((pitch.midi % 12) + 12) % 12 : null;

    // After a confirm/slip the same sustained note must be released
    // (silence or a different note) before it can trigger again
    if (!armedRef.current) {
      if (heardPc === null || heardPc !== eventPcRef.current) {
        armedRef.current = true;
        wrongMsRef.current = 0;
        wrongPcRef.current = null;
      } else {
        return;
      }
    }

    const isMatch = pitch !== null && heardPc === targetPc && Math.abs(pitch.cents) <= CENTS_TOL;

    if (isMatch) {
      wrongMsRef.current = 0;
      wrongPcRef.current = null;
      holdMsRef.current += elapsed;
      setHoldPct(Math.min(100, Math.round((holdMsRef.current / CONFIRM_MS) * 100)));

      if (holdMsRef.current >= CONFIRM_MS) {
        holdMsRef.current = 0;
        setHoldPct(0);
        armedRef.current = false;
        eventPcRef.current = targetPc;

        audio.init();
        audio.playMidi(93, 0.18); // bright confirmation ping

        const nextIdx = progressIdx + 1;
        if (progressIdx === 0) startedAtRef.current = performance.now();
        if (nextIdx < round.targets.length) feel('success');
        if (nextIdx >= round.targets.length) {
          completeRound();
        } else {
          setProgressIdx(nextIdx);
          setFeedback({
            type: 'ok',
            text: `${NOTE_NAMES[targetPc]} ✓ Next: ${NOTE_NAMES[round.targets[nextIdx]]}`
          });
        }
      }
    } else {
      // Decay hold progress when off-target or silent
      holdMsRef.current = Math.max(0, holdMsRef.current - elapsed);
      setHoldPct(Math.round((holdMsRef.current / CONFIRM_MS) * 100));

      // A *stable* wrong note (not a transition blip) counts as a miss
      if (heardPc !== null && heardPc !== targetPc) {
        if (wrongPcRef.current === heardPc) {
          wrongMsRef.current += elapsed;
        } else {
          wrongPcRef.current = heardPc;
          wrongMsRef.current = elapsed;
        }
        if (wrongMsRef.current >= SLIP_MS) {
          wrongMsRef.current = 0;
          armedRef.current = false;
          eventPcRef.current = heardPc;
          setStreak(0);
          feel('error');
          setFeedback({
            type: 'slip',
            text: `Heard ${NOTE_NAMES[heardPc]}, wanted ${NOTE_NAMES[targetPc]}. Streak reset.`
          });
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pitch, isActive, phase, round, progressIdx]);

  const playReference = () => {
    if (!round) return;
    audio.init();
    const now = audio.getCurrentTime();
    round.referenceMidis.forEach((m, i) => audio.playMidi(m, 0.9, now + i * 0.3));
    muteUntilRef.current = performance.now() + round.referenceMidis.length * 300 + 1200;
  };

  const revealAnswer = () => {
    setRevealed(true);
    setStreak(0);
    if (round) {
      setFeedback({ type: 'info', text: `It's ${NOTE_NAMES[round.targets[progressIdx]]}, shown in amber.` });
    }
  };

  // ---- Fretboard highlight sets ----
  const targetsHidden = mode === 'interval' && !revealed;
  const currentTargetPc = round && phase === 'playing' ? round.targets[progressIdx] : null;
  const rootMidis = !targetsHidden && showTargets && currentTargetPc !== null ? midisForPcs([currentTargetPc]) : [];
  // Interval mode's contextPcs only contains the reference note, so it stays
  // visible even while the answer is hidden
  const contextMidis = round && showTargets ? midisForPcs(round.contextPcs) : [];
  // Live feedback: light up every position of the note we're currently hearing
  const heardMidis = pitch ? midisForPcs([((pitch.midi % 12) + 12) % 12]) : [];

  const feedbackColor =
    feedback.type === 'ok' ? 'var(--success)' :
    feedback.type === 'slip' ? 'var(--danger)' : 'var(--text-secondary)';

  const scaleBest = round?.climbKey ? bestClimb(round.climbKey) : undefined;
  const settingsSummary =
    mode === 'scale'
      ? `${shortScaleName(SCALE_FORMULAS[scaleIdx].name)} · ${scaleRootPc === 'random' ? 'Any key' : NOTE_NAMES[scaleRootPc]}`
      : mode === 'chord'
        ? chordSevenths ? 'Triads and 7th chords' : 'Triads'
        : trickyIntervals ? 'All intervals' : 'Common intervals';

  return (
    <div className="lab-stack play">
      <div className="lab-header">
        <h2 className="lab-title"><LabIcon tab="play" />Challenges</h2>
      </div>

      <Segmented<Mode>
        value={mode}
        onChange={setMode}
        ariaLabel="Challenge"
        options={[
          { value: 'scale', label: 'Scales' },
          { value: 'interval', label: 'Intervals' },
          { value: 'chord', label: 'Chords' }
        ]}
      />

      {/* The settings, behind one line that says what they are set to. */}
      <button type="button" className={`play-settings-line${settingsOpen ? ' is-open' : ''}`} onClick={() => setSettingsOpen(o => !o)} aria-expanded={settingsOpen}>
        <span>{settingsSummary}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9" /></svg>
      </button>
      {settingsOpen && (
        <div className="play-settings">
          {mode === 'scale' && (
            <>
              <label>
                Key
                <Select<string>
                  label="Key"
                  value={String(scaleRootPc)}
                  options={[...NOTE_NAMES.map((n, i) => ({ value: String(i), label: n })), { value: 'random', label: 'Surprise me' }]}
                  onChange={v => setScaleRootPc(v === 'random' ? 'random' : Number(v))}
                />
              </label>
              <label>
                Scale
                <Select<number>
                  label="Scale"
                  value={scaleIdx}
                  options={SCALE_FORMULAS.map((sc, i) => ({ value: i, label: shortScaleName(sc.name) }))}
                  onChange={setScaleIdx}
                />
              </label>
            </>
          )}
          {mode === 'chord' && (
            <label className="play-check">
              <input type="checkbox" checked={chordSevenths} onChange={e => setChordSevenths(e.target.checked)} />
              7th chords too
            </label>
          )}
          {mode === 'interval' && (
            <label className="play-check">
              <input type="checkbox" checked={trickyIntervals} onChange={e => setTrickyIntervals(e.target.checked)} />
              Harder intervals too
            </label>
          )}
          <label className="play-check">
            <input type="checkbox" checked={showTargets} onChange={e => setShowTargets(e.target.checked)} />
            Show notes on the fretboard
          </label>
        </div>
      )}

      {/* One card: what to play, then where it is. */}
      <section className="glass-panel play-card">
        <h3 className="play-title">{round?.promptTitle ?? '…'}</h3>
        <p className="play-detail">{round?.promptDetail}</p>

        {round && (
          <div className="play-chips">
            {round.chipLabels.map((label, i) => {
              const done = i < progressIdx || phase === 'complete';
              const current = i === progressIdx && phase === 'playing';
              return (
                <span key={`${label}-${i}`} className={`play-chip${done ? ' is-done' : current ? ' is-now' : ''}`}>
                  {done && <IconCheck size={11} />}{targetsHidden && !done ? '?' : label}
                </span>
              );
            })}
          </div>
        )}

        <Fretboard
          activeMidis={heardMidis}
          highlightCorrectMidis={contextMidis}
          rootMidis={rootMidis}
          interactive={false}
        />

        <div className="play-stats readout">
          {mode === 'scale' ? (
            <>
              {scaleBest !== undefined && <span className="play-stat-best">best {fmtTime(scaleBest)}</span>}
            </>
          ) : (
            <>
              {isActive && <span>Streak {streak}</span>}
              {best[mode] > 0 && <span className="play-stat-best">best {best[mode]}</span>}
            </>
          )}
        </div>
        {mode === 'scale' && lastClimb && (
          <p className="play-last">
            {lastClimb.key} in {fmtTime(lastClimb.seconds)}
            {lastClimb.previous === undefined ? ' · first climb' : lastClimb.seconds < lastClimb.previous ? ` · new best (was ${fmtTime(lastClimb.previous)})` : ''}
          </p>
        )}

        <div className="play-actions">
          <button onClick={playReference} className="btn btn-secondary">
            {mode === 'interval' ? 'Hear the note' : 'Hear it'}
          </button>
          {mode === 'interval' && !revealed && (
            <button onClick={revealAnswer} className="btn">Show answer</button>
          )}
          <button onClick={() => startNewRound()} className="btn">Skip</button>
        </div>
      </section>

      {/* Docked, like Start in Rhythm: the mic is always in reach. */}
      <div className="play-dock">
        {isActive ? (
          <div className="play-live">
            <span className={`play-live-note${pitch && currentTargetPc !== null && ((pitch.midi % 12) + 12) % 12 === currentTargetPc ? ' is-match' : ''}`}>
              {pitch ? pitch.note : '--'}
            </span>
            <span className="play-live-text">
              <span className="play-live-said" style={{ color: feedbackColor }}>{feedback.text}</span>
              <span className="play-hold" aria-hidden="true"><span style={{ width: `${holdPct}%` }} /></span>
            </span>
            <button onClick={stop} className="btn play-stop">Stop</button>
          </div>
        ) : (
          <button onClick={start} className="btn btn-primary play-mic">
            <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" /><path d="M19 10v1a7 7 0 0 1-14 0v-1" /><line x1="12" y1="19" x2="12" y2="22" />
            </svg>
            Turn on the mic
          </button>
        )}
        {micError && <p className="micbar-error">{micError}</p>}
      </div>
    </div>
  );
};
export default PlayLab;
