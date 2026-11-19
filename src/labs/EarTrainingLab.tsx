import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Select } from '../components/Select';
import { Keyboard } from '../components/Keyboard';
import { LabIcon } from '../components/LabIcon';
import { Fretboard } from '../components/Fretboard';
import { Segmented } from '../components/Segmented';
import { audio } from '../utils/audio';
import { reportProgress } from '../utils/progress';
import {
  getMastery,
  pickNextItem,
  recordAttempt,
  resetMastery,
  unlockedCount
} from '../utils/mastery';
import { MasteryStrip } from '../components/MasteryStrip';
import type { MasteryItem } from '../components/MasteryStrip';
import {
  INTERVALS,
  CHORD_QUALITIES,
  midiToNoteName
} from '../utils/musicTheory';
import type {
  IntervalInfo,
  ChordQualityInfo
} from '../utils/musicTheory';
import { useTabIntervalSource } from '../hooks/useTabIntervalSource';
import type { TabIntervalCandidate } from '../utils/tabIntervalSource';
import { CHORD_FEELINGS } from '../utils/glossary';
import { IconSounding } from '../components/Icons';
import { feel } from '../utils/haptics';
import { setRecord } from '../utils/feats';
import { usePracticeTime } from '../hooks/usePracticeTime';
import { useSessionEnd } from '../utils/session';
import { useBackToClose } from '../utils/nativeShell';

/** Questions in a set. A set ends, so a session has a shape and a result. */
const SET = 10;

type Mode = 'intervals' | 'chords' | 'tab';
const MODES: { value: Mode; label: string }[] = [
  { value: 'intervals', label: 'Intervals' },
  { value: 'chords', label: 'Chords' },
  { value: 'tab', label: 'From my tabs' }
];

const DIFFICULTY_LABEL: Record<string, string> = {
  auto: 'Auto', 'super-beginner': 'Starter', easy: 'Easy', medium: 'Medium', hard: 'Hard'
};

// Two of the longer 7th-chord names get an abbreviated parenthetical
// (everything else is short enough to show in full), the feeling word
// itself always comes from CHORD_FEELINGS so it can't drift out of sync
// with the rest of the app's chord-quality labeling.
const CHORD_SHORT_LABEL_OVERRIDES: Record<string, string> = {
  'Half-Diminished 7th': 'Half-Dim',
  'Diminished 7th': 'Dim 7th'
};

type QuizMode = 'intervals' | 'chords';
type Difficulty = 'auto' | 'super-beginner' | 'easy' | 'medium' | 'hard';
type PlaybackStyle = 'melodic' | 'harmonic';
type SourceMode = 'random' | 'tab';

// Item ids for the mastery store. Opaque to it, meaningful here.
const intervalItemId = (semitones: number): string => `interval:${semitones}`;
const chordItemId = (name: string): string => `chord:${name}`;

// The order things are introduced in on Auto, easiest first. Not the
// chromatic order: the octave and the fifth are the two intervals a beginner
// can already hear before being taught anything, so they anchor the row, and
// the tritone and the minor 2nd, the two that need a reference to place at
// all, come last.
const INTERVAL_LADDER = [0, 12, 7, 5, 4, 3, 2, 9, 8, 10, 11, 1, 6];

// Same idea for chord qualities: the major/minor split first, then the
// colours that sit between them, then the sevenths.
const CHORD_LADDER = [
  'Major Triad',
  'Minor Triad',
  'Dominant 7th',
  'Diminished Triad',
  'Augmented Triad',
  'Major 7th',
  'Minor 7th',
  'Half-Diminished 7th',
  'Diminished 7th'
];

// Two or three characters, because the strip is thirteen cells wide.
const CHORD_TICK_LABELS: Record<string, string> = {
  'Major Triad': 'Maj',
  'Minor Triad': 'min',
  'Dominant 7th': '7',
  'Diminished Triad': 'dim',
  'Augmented Triad': 'aug',
  'Major 7th': 'M7',
  'Minor 7th': 'm7',
  'Half-Diminished 7th': '\u00F87',
  'Diminished 7th': 'o7'
};

const INTERVAL_STRIP_ITEMS: MasteryItem[] = INTERVAL_LADDER.map(semitones => {
  const info = INTERVALS.find(i => i.semitones === semitones);
  return {
    id: intervalItemId(semitones),
    label: info?.shortName ?? String(semitones),
    name: info?.name ?? `${semitones} semitones`
  };
});

const CHORD_STRIP_ITEMS: MasteryItem[] = CHORD_LADDER.map(name => ({
  id: chordItemId(name),
  label: CHORD_TICK_LABELS[name] ?? name,
  name
}));

export const EarTrainingLab: React.FC = () => {
  const [quizMode, setQuizMode] = useState<QuizMode>('intervals');
  const [difficulty, setDifficulty] = useState<Difficulty>('auto');
  const [playbackStyle, setPlaybackStyle] = useState<PlaybackStyle>('melodic');
  const [sourceMode, setSourceMode] = useState<SourceMode>('random');
  const tabSource = useTabIntervalSource();
  const [currentCandidate, setCurrentCandidate] = useState<TabIntervalCandidate | null>(null);

  // Game States
  const [hasStarted, setHasStarted] = useState<boolean>(false);
  const [score, setScore] = useState<number>(0);
  const [totalQuestions, setTotalQuestions] = useState<number>(0);
  const [streak, setStreak] = useState<number>(0);
  const [best, setBest] = useState<number>(0);
  const [setDone, setSetDone] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [see, setSee] = useState<'guitar' | 'piano'>('guitar');
  // Mastery as it stood when the set began, so the summary can say what moved.
  const setStart = useRef<Record<string, number>>({});
  const [showCheatSheet, setShowCheatSheet] = useState<boolean>(false);
  // A perfect set means ten heard and named unaided, like Duolingo's perfect
  // lesson: opening the clues during a set keeps it from counting as one.
  const [usedClue, setUsedClue] = useState(false);

  // Question details
  const [currentRoot, setCurrentRoot] = useState<number>(60); // Default C4
  const [correctInterval, setCorrectInterval] = useState<IntervalInfo | null>(null);
  const [correctChord, setCorrectChord] = useState<ChordQualityInfo | null>(null);
  const [options, setOptions] = useState<string[]>([]);
  const [userAnswer, setUserAnswer] = useState<string | null>(null);
  const [isAnswered, setIsAnswered] = useState<boolean>(false);
  const [correctMidis, setCorrectMidis] = useState<number[]>([]);

  // The item the current question is about, and the one before it. The drill
  // never asks the same thing twice running, and the strip marks whichever
  // bar just moved.
  const lastItemId = useRef<string | null>(null);
  const [latestItemId, setLatestItemId] = useState<string | null>(null);
  // Clearing the store has to repaint the strip, which reads it directly.
  const [, setMasteryTick] = useState(0);

  // How far the Auto ladders have opened up. Recomputed on render so the row
  // widens the moment an unlock is earned.
  const intervalsUnlocked = unlockedCount(INTERVAL_STRIP_ITEMS.map(i => i.id));
  const chordsUnlocked = unlockedCount(CHORD_STRIP_ITEMS.map(i => i.id));

  // Configure options based on difficulty and mode
  const getPossibleIntervals = (): IntervalInfo[] => {
    switch (difficulty) {
      case 'auto': {
        // The ladder decides the pool; mastery decides which of it you get
        // asked. A hand-set level is still there for anyone who wants to sit
        // on one thing until it sticks.
        const semitones = INTERVAL_LADDER.slice(0, intervalsUnlocked);
        return INTERVALS.filter(i => semitones.includes(i.semitones));
      }
      case 'super-beginner':
        // Very basic leaps: Unison, Perfect 5th, Octave
        return INTERVALS.filter(i => [0, 7, 12].includes(i.semitones));
      case 'easy':
        return INTERVALS.filter(i => [0, 4, 7, 12].includes(i.semitones)); // Unison, Maj3, P5, Octave
      case 'medium':
        return INTERVALS.filter(i => [0, 2, 3, 4, 5, 7, 9, 11, 12].includes(i.semitones)); // Basic intervals
      case 'hard':
      default:
        return INTERVALS; // All chromatic intervals
    }
  };

  const getPossibleChords = (): ChordQualityInfo[] => {
    switch (difficulty) {
      case 'auto': {
        const names = CHORD_LADDER.slice(0, chordsUnlocked);
        return CHORD_QUALITIES.filter(c => names.includes(c.name));
      }
      case 'super-beginner':
      case 'easy':
        return CHORD_QUALITIES.filter(c => ['Major Triad', 'Minor Triad'].includes(c.name));
      case 'medium':
        return CHORD_QUALITIES.filter(c => ['Major Triad', 'Minor Triad', 'Diminished Triad', 'Augmented Triad'].includes(c.name));
      case 'hard':
      default:
        return CHORD_QUALITIES; // Triads + 7ths
    }
  };

  // Which row of bars to show, and how much of it is in play. Only Auto gates
  // the pool by mastery, so under a hand-set level every item is available and
  // the strip is a plain record of what you know.
  const strip = quizMode === 'intervals'
    ? { items: INTERVAL_STRIP_ITEMS, unlocked: difficulty === 'auto' ? intervalsUnlocked : INTERVAL_STRIP_ITEMS.length }
    : { items: CHORD_STRIP_ITEMS, unlocked: difficulty === 'auto' ? chordsUnlocked : CHORD_STRIP_ITEMS.length };

  // Which item to ask next. Weighted toward what you are weakest at and what
  // is due, in every difficulty, not just Auto. A hand-set level chooses the
  // pool, not the order within it, and a uniform draw over a pool you have
  // half learned spends half its questions on the half you already know.
  const chooseInterval = (pool: IntervalInfo[]): IntervalInfo => {
    const picked = pickNextItem(pool.map(i => intervalItemId(i.semitones)), { exclude: lastItemId.current });
    return pool.find(i => intervalItemId(i.semitones) === picked) ?? pool[0];
  };

  const chooseChord = (pool: ChordQualityInfo[]): ChordQualityInfo => {
    const picked = pickNextItem(pool.map(c => chordItemId(c.name)), { exclude: lastItemId.current });
    return pool.find(c => chordItemId(c.name) === picked) ?? pool[0];
  };

  // Generate a new question
  const generateQuestion = () => {
    audio.init();
    setIsAnswered(false);
    setUserAnswer(null);
    // The strip's marker is cleared with the answer it belonged to. Left up,
    // it would sit on the previous question's item all through the next one,
    // and since the drill never repeats an item back to back, that quietly
    // rules an option out for you.
    setLatestItemId(null);
    setCorrectMidis([]);
    setCurrentCandidate(null);

    if (sourceMode === 'tab') {
      const possible = getPossibleIntervals();
      const allowedSemitones = new Set(possible.map(i => i.semitones));
      // Prefer jumps matching the current difficulty; fall back to whatever
      // this piece actually has rather than showing nothing.
      const matchingCandidates = tabSource.candidates.filter(c => allowedSemitones.has(Math.abs(c.toMidi - c.fromMidi)));
      const pool = matchingCandidates.length > 0 ? matchingCandidates : tabSource.candidates;
      if (pool.length === 0) return;

      // Same weighting, applied to whichever jumps this piece actually
      // contains: choose the interval first, then a bar that has one of them.
      const byItem = new Map<string, TabIntervalCandidate[]>();
      for (const c of pool) {
        const id = intervalItemId(Math.abs(c.toMidi - c.fromMidi));
        const bucket = byItem.get(id);
        if (bucket) bucket.push(c);
        else byItem.set(id, [c]);
      }
      const pickedId = pickNextItem(Array.from(byItem.keys()), { exclude: lastItemId.current });
      const bucket = (pickedId && byItem.get(pickedId)) || pool;

      const candidate = bucket[Math.floor(Math.random() * bucket.length)];
      setCurrentCandidate(candidate);

      const semitones = Math.abs(candidate.toMidi - candidate.fromMidi);
      lastItemId.current = intervalItemId(semitones);
      const matchedInterval = INTERVALS.find(i => i.semitones === semitones) ?? INTERVALS[0];
      setCorrectInterval(matchedInterval);
      setCorrectChord(null);

      const lo = Math.min(candidate.fromMidi, candidate.toMidi);
      const hi = Math.max(candidate.fromMidi, candidate.toMidi);
      setCurrentRoot(lo);
      setCorrectMidis([lo, hi]);

      const distOptions = new Set<string>([matchedInterval.name]);
      while (distOptions.size < Math.min(4, possible.length)) {
        distOptions.add(possible[Math.floor(Math.random() * possible.length)].name);
      }
      setOptions(Array.from(distOptions).sort(() => Math.random() - 0.5));
      return;
    }

    // Random root between C3 (48) and C5 (72)
    const rootMidi = Math.floor(Math.random() * 24) + 48;
    setCurrentRoot(rootMidi);

    if (quizMode === 'intervals') {
      const possible = getPossibleIntervals();
      if (possible.length === 0) return;
      const randInterval = chooseInterval(possible);
      lastItemId.current = intervalItemId(randInterval.semitones);
      setCorrectInterval(randInterval);
      setCorrectChord(null);

      // Determine correct MIDI targets
      setCorrectMidis([rootMidi, rootMidi + randInterval.semitones]);

      // Choose distractor answers
      const distOptions = new Set<string>([randInterval.name]);
      while (distOptions.size < Math.min(4, possible.length)) {
        const randOpt = possible[Math.floor(Math.random() * possible.length)].name;
        distOptions.add(randOpt);
      }
      
      // Shuffle options
      setOptions(Array.from(distOptions).sort(() => Math.random() - 0.5));
    } else {
      // Chords mode
      const possible = getPossibleChords();
      if (possible.length === 0) return;
      const randChord = chooseChord(possible);
      lastItemId.current = chordItemId(randChord.name);
      setCorrectChord(randChord);
      setCorrectInterval(null);

      // Determine correct MIDI targets
      setCorrectMidis(randChord.intervals.map(offset => rootMidi + offset));

      // Choose distractor answers
      const distOptions = new Set<string>([randChord.name]);
      while (distOptions.size < Math.min(4, possible.length)) {
        const randOpt = possible[Math.floor(Math.random() * possible.length)].name;
        distOptions.add(randOpt);
      }
      
      // Shuffle options
      setOptions(Array.from(distOptions).sort(() => Math.random() - 0.5));
    }
  };

  // Trigger sound playback for the current question
  const playSound = () => {
    if (sourceMode === 'tab') {
      if (currentCandidate) tabSource.playCandidate(currentCandidate);
      return;
    }
    if (correctMidis.length === 0) return;
    audio.init();

    const now = audio.getCurrentTime();

    if (quizMode === 'intervals') {
      if (playbackStyle === 'melodic') {
        // Melodic play: Play root, then play interval note
        audio.playMidi(correctMidis[0], 1.5, now);
        audio.playMidi(correctMidis[1], 1.5, now + 0.6); // delayed by 600ms
      } else {
        // Harmonic play
        audio.playChord(correctMidis, 2.0, now);
      }
    } else {
      // Chord Playback
      if (playbackStyle === 'melodic') {
        // Arpeggiate (strum string by string ascending)
        correctMidis.forEach((midi, idx) => {
          audio.playMidi(midi, 2.0, now + idx * 0.25); // strum effect
        });
      } else {
        // Play together (harmonic)
        audio.playChord(correctMidis, 2.5, now);
      }
    }
  };

  // Translates complex terms to beginner-friendly labels
  const getDisplayOptionName = (opt: string) => {
    if (quizMode === 'chords') {
      const feeling = CHORD_FEELINGS[opt];
      if (!feeling) return opt;
      const shortLabel = CHORD_SHORT_LABEL_OVERRIDES[opt] ?? opt.replace(' Triad', '');
      return `${feeling} (${shortLabel})`;
    }
    return opt;
  };

  // Handle choice submission
  const handleAnswerSubmit = (option: string) => {
    if (isAnswered) return;
    
    setUserAnswer(option);
    setIsAnswered(true);
    setTotalQuestions(prev => prev + 1);

    const isCorrect = quizMode === 'intervals' 
      ? correctInterval?.name === option
      : correctChord?.name === option;

    // Grade the item itself, right or wrong, the miss is the more useful of
    // the two, and it is the one a running total of successes throws away.
    const itemId = quizMode === 'intervals'
      ? (correctInterval ? intervalItemId(correctInterval.semitones) : null)
      : (correctChord ? chordItemId(correctChord.name) : null);
    if (itemId) {
      recordAttempt(itemId, isCorrect);
      setLatestItemId(itemId);
    }

    if (isCorrect) {
      setScore(prev => prev + 1);
      setStreak(prev => { setBest(b => Math.max(b, prev + 1)); return prev + 1; });
      // Every fifth in a row is a moment; the rest are just right.
      feel((streak + 1) % 5 === 0 ? 'celebrate' : 'success');
      reportProgress(quizMode === 'intervals' ? 'ear-interval-correct' : 'ear-chord-correct');
    } else {
      setStreak(0);
      feel('error');
    }

    // Play sound of correct answer again so they reinforce the auditory memory
    playSound();
  };

  const handleStartQuiz = () => {
    setScore(0);
    setTotalQuestions(0);
    setStreak(0);
    setBest(0);
    setSetDone(false);
    setUsedClue(false);
    setStart.current = Object.fromEntries(strip.items.map(item => [item.id, getMastery(item.id)]));
    setHasStarted(true);
    generateQuestion();
  };

  // Watch for quiz criteria changes and update quiz question automatically.
  // If tab mode runs dry mid-session (switching the library pick to a piece
  // with no gradable candidates), generateQuestion() would otherwise bail
  // out early having already cleared the old candidate/correctMidis while
  // leaving the previous correctInterval/options on screen, an unanswerable
  // stale question. Bounce back to the start screen instead, same as the
  // already-disabled Start button for that same empty-candidates case.
  useEffect(() => {
    if (!hasStarted) return;
    if (sourceMode === 'tab' && !tabSource.isLoading && tabSource.candidates.length === 0) {
      setHasStarted(false);
      return;
    }
    generateQuestion();
  }, [quizMode, difficulty, playbackStyle, sourceMode, tabSource.candidates, tabSource.isLoading]);

  // Autoplay new question sound when ready
  useEffect(() => {
    if (hasStarted && correctMidis.length > 0 && !isAnswered) {
      const timer = setTimeout(() => {
        playSound();
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [correctMidis]);

  const mode: Mode = sourceMode === 'tab' ? 'tab' : quizMode;
  const setMode = (m: Mode) => {
    setSetDone(false);
    if (m === 'tab') { setSourceMode('tab'); setQuizMode('intervals'); }
    else { setSourceMode('random'); setQuizMode(m); }
  };
  const closeSettings = () => setSettingsOpen(false);
  useBackToClose(settingsOpen, closeSettings);

  const tabEmpty = sourceMode === 'tab' && tabSource.candidates.length === 0;
  const isCorrect = (opt: string) => (quizMode === 'intervals' ? correctInterval?.name === opt : correctChord?.name === opt);
  const clueFor = (opt: string) => (quizMode === 'intervals' ? INTERVALS.find(iv => iv.name === opt)?.feel ?? '' : CHORD_FEELINGS[opt] ?? '');
  useEffect(() => { if (showCheatSheet && hasStarted && !isAnswered) setUsedClue(true); }, [showCheatSheet, hasStarted, isAnswered]);
  const finished = totalQuestions >= SET;
  usePracticeTime('ear', hasStarted && !setDone);

  // A finished set leaves its mark: a perfect ten counts toward Sharp Ears,
  // and the best streak in it is offered to the record. Once per set.
  const markedSet = useRef(false);
  useEffect(() => {
    if (!finished) { markedSet.current = false; return; }
    if (markedSet.current) return;
    markedSet.current = true;
    if (score === SET && !usedClue) reportProgress('ear-perfect-set');
    if (best > 0) setRecord('ear-streak', best, quizMode === 'intervals' ? 'Intervals' : 'Chords');
  }, [finished, score, best, quizMode, usedClue]);

  // What Auto is drilling: the unlocked items you know least, said in words,
  // so the choice of question is not a black box.
  const focus = difficulty === 'auto'
    ? strip.items.slice(0, strip.unlocked).filter(item => getMastery(item.id) < 0.7)
      .sort((a, b) => getMastery(a.id) - getMastery(b.id)).slice(0, 2)
    : [];
  const improved = setDone
    ? strip.items.filter(item => getMastery(item.id) - (setStart.current[item.id] ?? 0) > 0.05).map(item => item.name)
    : [];

  useSessionEnd('ear', hasStarted && !setDone, () => ({
    title: 'Ear Training',
    headline: `${score} of ${totalQuestions}`,
    better: score === SET && totalQuestions === SET
      ? usedClue ? 'All right, with a clue. Try one without.' : 'Perfect set.'
      : improved.length ? `Getting better at ${improved.slice(0, 2).join(' and ')}.` : null,
    isBetter: (score === SET && !usedClue) || improved.length > 0,
    stats: [{ label: 'Best streak', value: String(best) }]
  }));

  const explain = (() => {
    const root = midiToNoteName(currentRoot);
    if (quizMode === 'intervals' && correctInterval) {
      const top = midiToNoteName(currentRoot + correctInterval.semitones);
      const from = sourceMode === 'tab' && currentCandidate && tabSource.selectedTab
        ? ` · ${tabSource.selectedTab.title || tabSource.selectedTab.fileName}, bar ${currentCandidate.barNumber}`
        : '';
      return <><strong>{correctInterval.name}</strong>: {root.name}{root.octave} up to {top.name}{top.octave}{from}</>;
    }
    if (correctChord) {
      const notes = correctChord.intervals.map(offset => midiToNoteName(currentRoot + offset).name).join(' ');
      return <><strong>{getDisplayOptionName(correctChord.name)}</strong>: {notes}</>;
    }
    return null;
  })();

  const settingsLine = `${DIFFICULTY_LABEL[difficulty]} · ${sourceMode === 'tab' || playbackStyle === 'melodic' ? 'one after another' : 'together'}`;

  return (
    <div className="lab-stack ear">
      <div className="ear-head">
        <h2 className="lab-title"><LabIcon tab="ear-training" />Ear Training</h2>
        {hasStarted && !setDone && (
          <span className="ear-score readout">{score} of {totalQuestions} · streak {streak}</span>
        )}
      </div>

      <section className="ear-card" aria-live="polite">
        {!hasStarted || setDone ? (
          setDone ? (
            <div className="ear-start">
              <span className="surface-label">Set done</span>
              <div className="ear-final readout">{score} of {SET}</div>
              <p className="ear-said">
                Best streak {best}.{improved.length > 0 ? ` ${improved.slice(0, 2).join(' and ')} ${improved.length === 1 ? 'is' : 'are'} getting stronger.` : ''}
              </p>
              {score === SET && usedClue && (
                <p className="ear-said">Clues were open, so this one does not count toward Sharp Ears.</p>
              )}
              <button type="button" className="btn btn-primary ear-again" onClick={handleStartQuiz}>Another set</button>
            </div>
          ) : (
            <div className="ear-start">
              <Segmented<Mode> value={mode} onChange={setMode} options={MODES} ariaLabel="What to hear" size="sm" />
              {mode === 'tab' && (
                tabSource.libraryEntries.length === 0 ? (
                  <p className="ear-said">No tabs saved yet. Open a tab file in Tabs first.</p>
                ) : (
                  <Select<string>
                    className="ear-tabpick"
                    label="Which tab"
                    placeholder="Choose a piece"
                    value={tabSource.selectedTab?.id ?? ''}
                    options={tabSource.libraryEntries.map(entry => ({ value: entry.id, label: entry.title || entry.fileName }))}
                    onChange={v => {
                      const entry = tabSource.libraryEntries.find(t => t.id === v);
                      if (entry) tabSource.selectTab(entry);
                    }}
                  />
                )
              )}
              {mode === 'tab' && tabSource.selectedTab && !tabSource.isLoading && tabSource.candidates.length === 0 && (
                <p className="ear-said">No clear single-note jumps in this piece.</p>
              )}
              <button
                type="button"
                className="ear-orb ear-start-go"
                onClick={handleStartQuiz}
                disabled={tabEmpty}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="6 4 20 12 6 20" /></svg>
                Start
              </button>
              <p className="ear-said">A set of {SET}. Hear it, then name it.</p>
              <button type="button" className="chip-btn ear-settings" onClick={() => setSettingsOpen(true)}>{settingsLine} ▾</button>
            </div>
          )
        ) : (
          <div className="ear-q">
            <div className="ear-q-top">
              <button type="button" className="ear-orb is-small" onClick={playSound} aria-label="Hear it again">
                <IconSounding />
                Replay
              </button>
            </div>

            <div className="ear-answers">
              {options.map(opt => {
                const right = isAnswered && isCorrect(opt);
                const wrong = isAnswered && userAnswer === opt && !isCorrect(opt);
                const clue = clueFor(opt);
                return (
                  <button
                    key={opt}
                    type="button"
                    className={`ear-ans${right ? ' is-right' : ''}${wrong ? ' is-wrong' : ''}${isAnswered && !right && !wrong ? ' is-dim' : ''}`}
                    onClick={() => handleAnswerSubmit(opt)}
                    disabled={isAnswered}
                    aria-pressed={userAnswer === opt}
                  >
                    <span className="ear-ans-name">{getDisplayOptionName(opt)}</span>
                    {(showCheatSheet || isAnswered) && quizMode === 'intervals' && clue && (
                      <span className="ear-ans-clue">{clue}</span>
                    )}
                    {right && <span className="sr-only">, correct</span>}
                    {wrong && <span className="sr-only">, your answer, wrong</span>}
                  </button>
                );
              })}
            </div>

            {!isAnswered && quizMode === 'intervals' && (
              <button type="button" className="linklike ear-clue" onClick={() => setShowCheatSheet(v => !v)}>
                {showCheatSheet ? 'Hide clues' : 'Need a clue?'}
              </button>
            )}

            {isAnswered && (
              <>
                <p className="ear-explain">{userAnswer && isCorrect(userAnswer) ? '✓ ' : ''}{explain}</p>
                {/* Next sits right under the answer, above the picture of it: it is
                    pressed ten times a set, and the picture is there to look at. */}
                <div className="ear-next">
                  <button type="button" className="btn" onClick={playSound}>Hear it again</button>
                  {finished ? (
                    <button type="button" className="btn btn-primary" onClick={() => setSetDone(true)}>See how it went</button>
                  ) : (
                    <button type="button" className="btn btn-primary" onClick={generateQuestion}>Next</button>
                  )}
                </div>
                <div className="ear-see">
                  <Segmented<'guitar' | 'piano'>
                    value={see}
                    onChange={setSee}
                    ariaLabel="See it on"
                    size="sm"
                    options={[{ value: 'guitar', label: 'Guitar' }, { value: 'piano', label: 'Piano' }]}
                  />
                  {see === 'guitar'
                    ? <Fretboard highlightCorrectMidis={correctMidis} interactive={false} />
                    : <Keyboard highlightCorrectMidis={correctMidis} interactive={false} />}
                </div>
              </>
            )}
          </div>
        )}
      </section>

      <section className="ear-mastery">
        <MasteryStrip
          items={strip.items}
          unlocked={strip.unlocked}
          highlightId={latestItemId}
        />
        {focus.length > 0 && (
          <p className="ear-focus">Auto is working on {focus.map(item => item.name).join(' and ')}.</p>
        )}
      </section>

      {settingsOpen && createPortal(
        <div className="msheet-backdrop is-dialog" onClick={closeSettings}>
          <div className="msheet ear-sheet" role="dialog" aria-modal="true" aria-label="Ear training settings" onClick={e => e.stopPropagation()}>
            <h3 className="removesheet-title">Settings</h3>
            <Segmented
              label="Difficulty"
              value={difficulty}
              onChange={setDifficulty}
              size="sm"
              options={[
                { value: 'auto' as Difficulty, label: 'Auto', title: 'Focuses on what you miss most' },
                { value: 'super-beginner' as Difficulty, label: 'Starter', title: 'Unison, 5th, octave' },
                { value: 'easy' as Difficulty, label: 'Easy' },
                { value: 'medium' as Difficulty, label: 'Medium' },
                { value: 'hard' as Difficulty, label: 'Hard' }
              ]}
              full
            />
            <Segmented
              label="Playback"
              value={sourceMode === 'tab' ? 'melodic' : playbackStyle}
              onChange={setPlaybackStyle}
              size="sm"
              options={[
                { value: 'melodic', label: 'One after another' },
                { value: 'harmonic', label: 'Together', disabled: sourceMode === 'tab' }
              ]}
              full
            />
            <button
              type="button"
              className="linklike ear-reset"
              onClick={() => { resetMastery(); setLatestItemId(null); setMasteryTick(t => t + 1); }}
            >
              Clear my mastery history
            </button>
            <button type="button" className="btn btn-primary ear-sheet-done" onClick={closeSettings}>Done</button>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default EarTrainingLab;
