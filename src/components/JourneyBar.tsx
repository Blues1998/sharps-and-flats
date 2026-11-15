import React, { useEffect, useRef, useSyncExternalStore } from 'react';
import { go, useRoute } from '../hooks/useRoute';
import { ALL_LEVELS, isLevelComplete, levelProgress } from '../utils/journey';
import { getProgressCount, subscribeProgress } from '../utils/progress';
import { cadenceChime } from '../utils/chime';
import { feel } from '../utils/haptics';
import { useRunning } from './RunBar';
import { IconCheck, IconX } from './Icons';
import { STEP_CHANGE, followStep, followedStep as read } from '../utils/journeyStep';

// The Journey step you came here to do, kept in view.
//
// Pressing a step's button in Journey used to drop you on the screen with the
// task left behind, so you had to remember it. Now a slim bar carries it across,
// ticks as the screen reports progress, and says when the step is done, with
// a way back. Kept for this visit only (sessionStorage): it is a thread from
// Journey, not a setting.

const subscribe = (cb: () => void) => {
  window.addEventListener(STEP_CHANGE, cb);
  const off = subscribeProgress(cb);
  return () => { window.removeEventListener(STEP_CHANGE, cb); off(); };
};

// A string snapshot that changes when the step or its progress does.
const snapshot = (): string => {
  const id = read();
  const level = id ? ALL_LEVELS.find(l => l.id === id) : undefined;
  if (!level) return '';
  return `${id}:${level.requirements.map(r => getProgressCount(r.event)).join(',')}`;
};

export const JourneyBar: React.FC = () => {
  useSyncExternalStore(subscribe, snapshot, () => '');
  const { tab } = useRoute();
  const running = useRunning();
  const id = read();
  const level = id ? ALL_LEVELS.find(l => l.id === id) : undefined;
  const done = level ? isLevelComplete(level) : false;
  const shown = !!level && level.tab === tab && !running;

  // The small moment, once, when the step is finished while you are on it.
  const wasDone = useRef(done);
  useEffect(() => {
    if (shown && done && !wasDone.current) {
      cadenceChime();
      feel('success');
    }
    wasDone.current = done;
  }, [shown, done]);

  if (!shown || !level) return null;
  const [met, needed] = levelProgress(level);

  return (
    <div className={`journeybar${done ? ' is-done' : ''}`} role="status">
      <span className="journeybar-mark" aria-hidden="true">{done ? <IconCheck size={13} /> : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 20h4l4-16h4" /><circle cx="19" cy="4" r="2" /><circle cx="5" cy="20" r="2" />
        </svg>
      )}</span>
      <span className="journeybar-text">
        {done ? <b>Step done</b> : <b>{level.task}</b>}
        <small>{done ? level.title : `${met} of ${needed}`}</small>
      </span>
      {done ? (
        <button type="button" className="btn btn-primary journeybar-back" onClick={() => { followStep(null); go({ tab: 'journey', songId: null }); }}>
          Back to Journey
        </button>
      ) : (
        <button type="button" className="journeybar-x" onClick={() => followStep(null)} aria-label="Hide this step">
          <IconX size={14} />
        </button>
      )}
    </div>
  );
};

export default JourneyBar;
