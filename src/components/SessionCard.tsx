import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { assetUrl } from '../utils/assetUrl';
import { subscribeProgress } from '../utils/progress';
import { useLibrary } from '../hooks/useLibrary';
import { go } from '../hooks/useRoute';
import { getSong, getSongs, minutesPractisedToday, STATUS_LABEL } from '../utils/library';
import type { Song } from '../utils/library';
import { COMFORT_LABEL } from '../utils/chordbook';
import { handLoop } from '../utils/handoff';
import {
  abandon,
  dismissReport,
  finish,
  getReport,
  getRun,
  planRun,
  startRun,
  step,
  stepLoop,
  subscribeRun
} from '../utils/practiceRun';
import type { PracticeRun, RunReport, RunStep } from '../utils/practiceRun';


const isLate = (d = new Date()) => d.getHours() >= 17 || d.getHours() < 5;

const Arrow: React.FC<{ size?: number }> = ({ size = 15 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
  </svg>
);
const Chev = () => (
  <svg className="tday-chev" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="9 6 15 12 9 18" />
  </svg>
);
const Play = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="6 4 20 12 6 20" /></svg>
);

// The run store announces changes; a counter turns that into something
// useSyncExternalStore can compare.
let runVersion = 0;
subscribeRun(() => { runVersion += 1; });
const useRunVersion = () => useSyncExternalStore(subscribeRun, () => runVersion, () => 0);

/** Send someone to where a step happens, with its loop if it has one. */
const goToStep = (s: RunStep) => {
  const loop = stepLoop(s);
  if (loop) handLoop(loop);
  go({ tab: s.tab, songId: s.songId ?? null });
};

const StatusDot: React.FC<{ song: Song }> = ({ song }) => (
  <span className="tday-status"><i className={`is-${song.status}`} aria-hidden="true" />{STATUS_LABEL[song.status]}</span>
);

const songMeta = (song: Song): React.ReactNode => (
  <>
    <StatusDot song={song} />
    {song.artist && <> · {song.artist}</>}
    {song.key && <> · {song.key}</>}
    {song.capo ? <> · Capo {song.capo}</> : null}
  </>
);

// ---------------------------------------------------------------------------
// Tonight: the one card that answers "what do I do now", in four states.
// ---------------------------------------------------------------------------

interface TonightProps {
  hasSongs: boolean;
  run: PracticeRun | null;
  report: RunReport | null;
  plan: RunStep[];
  song: Song | null;
  minutesToday: number;
  onOpenSong: (id: string) => void;
  onAddSong: () => void;
}

const Steps: React.FC<{ steps: RunStep[]; at: number | null; skipped?: boolean[]; onPick: (i: number) => void }> = ({ steps, at, skipped, onPick }) => (
  <ol className="tday-steps">
    {steps.map((s, i) => {
      const state = at === null ? '' : i < at ? (skipped?.[i] ? ' is-skipped' : ' is-done') : i === at ? ' is-now' : '';
      return (
        <li key={i} className={`tday-step${state}${s.kind === 'song' ? ' is-song' : ''}`}>
          <button type="button" onClick={() => onPick(i)} aria-current={at === i ? 'step' : undefined}>
            <span className="tday-dot" aria-hidden="true"><i /></span>
            <span className="tday-step-text">
              <b>
                {s.title}
                {at === i && <span className="tday-now">Now</span>}
              </b>
            </span>
          </button>
        </li>
      );
    })}
  </ol>
);

const Tonight: React.FC<TonightProps> = ({ hasSongs, run, report, plan, song, minutesToday, onOpenSong, onAddSong }) => {
  const photo = { ['--tday-photo' as string]: `url(${assetUrl('img/hero-guitar.webp')})`, ['--i' as string]: 0 } as React.CSSProperties;

  // Finished: what the session moved, from the report the run builds.
  if (report) {
    const endSong = report.songId ? getSong(report.songId) : null;
    return (
      <section className="tday-hero" style={photo}>
        <div className="tday-title">
          <h2>{isLate() ? 'Done for tonight' : 'Session done'}</h2>
          <span>
            {report.minutes} min · {report.done} of {report.steps} steps
            {endSong && <> · {endSong.title}</>}
          </span>
        </div>
        {(report.promoted.length > 0 || report.records.length > 0) && (
          <ul className="tday-wins">
            {report.promoted.map(p => (
              <li key={`p-${p.symbol}`}>
                <i aria-hidden="true">↑</i>{p.symbol} moved up
                <small>{COMFORT_LABEL[p.from]} → {COMFORT_LABEL[p.to]}</small>
              </li>
            ))}
            {report.records.map(r => (
              <li key={`r-${r.chords}`}>
                <i aria-hidden="true">↑</i>New best, {r.chords}
                <small>{r.from === null ? `${r.to} bpm` : `${r.from} → ${r.to} bpm`}</small>
              </li>
            ))}
          </ul>
        )}
        <div className="tday-actions">
          {endSong ? (
            <button type="button" className="btn btn-primary tday-go" onClick={() => onOpenSong(endSong.id)}>
              <Play />Keep playing
            </button>
          ) : (
            <button type="button" className="btn btn-primary tday-go" onClick={dismissReport}>Done</button>
          )}
          {endSong && <button type="button" className="tday-quiet" onClick={dismissReport}>Plan another</button>}
        </div>
      </section>
    );
  }

  // Halfway: where you are, and the way back to it.
  if (run) {
    const now = run.steps[run.at];
    return (
      <section className="tday-hero" style={photo}>
        <span className="tday-when">Step {run.at + 1} of {run.steps.length}</span>
        <div className="tday-title">
          <h2>{song?.title ?? 'Tonight'}</h2>
          {song && <span>{songMeta(song)}</span>}
        </div>
        <Steps steps={run.steps} at={run.at} skipped={run.skipped} onPick={step} />
        <div className="tday-actions">
          <button type="button" className="btn btn-primary tday-go" onClick={() => now && goToStep(now)}>
            <Play />Resume
          </button>
          <button type="button" className="tday-quiet" onClick={run.at > 0 ? finish : abandon}>End session</button>
        </div>
      </section>
    );
  }

  // A first open: a song, or a warm-up without one.
  if (!hasSongs) {
    return (
      <section className="tday-hero" style={photo}>
        <div className="tday-title">
          <h2>Start with a song</h2>
          <span>Pick one you want to play. Its chords, strumming and practice time live with it.</span>
        </div>
        <div className="tday-actions">
          <button type="button" className="btn btn-primary tday-go" onClick={onAddSong}>Add a song<Arrow /></button>
        </div>
        <button type="button" className="tday-row tday-row-inset" onClick={() => startRun()}>
          <span className="tday-row-text"><b>Or warm up</b><small>Tune up, then two easy chord drills</small></span>
          <Chev />
        </button>
      </section>
    );
  }

  // Not started: tonight's song and the plan for it.
  const begin = (from = 0) => {
    startRun();
    if (from > 0) step(from);
  };
  return (
    <section className="tday-hero" style={photo}>
      <span className="tday-when">Song session{minutesToday > 0 && ` · ${minutesToday} min so far`}</span>
      <div className="tday-title">
        <h2>{song?.title ?? 'Tonight'}</h2>
        {song && <span>{songMeta(song)}</span>}
      </div>
      <Steps steps={plan} at={null} onPick={begin} />
      <div className="tday-actions">
        <button type="button" className="btn btn-primary tday-go" onClick={() => begin()}>
          <Play />Start session
        </button>
        {song && <button type="button" className="tday-quiet" onClick={() => onOpenSong(song.id)}>Just the song</button>}
      </div>
    </section>
  );
};

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

/**
 * Tonight's song session: a plan built from your songs and chord book, the
 * session halfway through, or what it moved once finished. It lives at the top
 * of Songs; Today is for the neck.
 */
export const SessionCard: React.FC<{ onOpenSong: (id: string) => void; onAddSong: () => void }> = ({ onOpenSong, onAddSong }) => {
  const [tick, setTick] = useState(0);
  useEffect(() => subscribeProgress(() => setTick(t => t + 1)), []);
  const runVersion = useRunVersion();
  const ready = useLibrary();
  const run = getRun();
  const report = getReport();
  const songs = getSongs();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const plan = useMemo(() => (ready && songs.length > 0 ? planRun() : []), [ready, songs.length, tick, runVersion]);
  const songOf = (steps: RunStep[] | undefined) => {
    const id = steps?.find(s => s.kind === 'song')?.songId;
    return id ? getSong(id) ?? null : null;
  };
  const song = songOf(run?.steps) ?? songOf(plan);
  if (!ready) return null;
  return (
    <Tonight
      hasSongs={songs.length > 0}
      run={run}
      report={report}
      plan={plan}
      song={song}
      minutesToday={minutesPractisedToday()}
      onOpenSong={onOpenSong}
      onAddSong={onAddSong}
    />
  );
};

export default SessionCard;
