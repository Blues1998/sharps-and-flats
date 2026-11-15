import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { ActiveTab } from '../components/Sidebar';
import { WeekPanel } from '../components/WeekPanel';
import { assetUrl } from '../utils/assetUrl';
import { ALL_LEVELS, isLevelComplete } from '../utils/journey';
import { subscribeProgress } from '../utils/progress';
import { useLibrary } from '../hooks/useLibrary';
import { makeSlot } from '../utils/loop';
import { StreakStrip } from '../components/StreakStrip';
import { go } from '../hooks/useRoute';
import { getSong, getSongs, lastPractised, minutesPractisedToday, practiceStats, STATUS_LABEL, today } from '../utils/library';
import type { Song } from '../utils/library';
import { COMFORT_LABEL } from '../utils/chordbook';
import { promptForDate } from '../data/tryThis';
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
import { weekRecap } from '../utils/weekly';

interface DashboardLandingProps {
  setActiveTab: (tab: ActiveTab) => void;
  onOpenSong: (id: string) => void;
  onAddSong: () => void;
}

/** "Saturday evening": the day and the time of it, in one line. */
const whenLine = (d = new Date()): string => {
  const h = d.getHours();
  const part = h < 5 ? 'night' : h < 12 ? 'morning' : h < 17 ? 'afternoon' : h < 22 ? 'evening' : 'night';
  return `${d.toLocaleDateString(undefined, { weekday: 'long' })} ${part}`;
};
const isLate = (d = new Date()) => d.getHours() >= 17 || d.getHours() < 5;

const fmtWhen = (iso: string): string => {
  const days = Math.round((new Date(`${today()}T12:00`).getTime() - new Date(`${iso}T12:00`).getTime()) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

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

/** Journey progress as a ring with the count inside. */
const Ring: React.FC<{ done: number; total: number }> = ({ done, total }) => {
  const r = 14;
  const c = 2 * Math.PI * r;
  return (
    <svg className="tday-ring" viewBox="0 0 34 34" aria-hidden="true">
      <circle cx="17" cy="17" r={r} className="tday-ring-track" />
      {done > 0 && (
        <circle cx="17" cy="17" r={r} className="tday-ring-fill" strokeDasharray={`${(c * done) / total} ${c}`} transform="rotate(-90 17 17)" />
      )}
      <text x="17" y="20.5" textAnchor="middle">{done}</text>
    </svg>
  );
};

// The run store announces changes; a counter turns that into something
// useSyncExternalStore can compare.
let runVersion = 0;
subscribeRun(() => { runVersion += 1; });
const useRunVersion = () => useSyncExternalStore(subscribeRun, () => runVersion, () => 0);

/** What a step says under its title on this page. */
const stepWhy = (s: RunStep): string => (s.kind === 'song' ? 'Your song' : s.detail ?? s.note);

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
              <small>{stepWhy(s)}</small>
            </span>
          </button>
        </li>
      );
    })}
  </ol>
);

const Tonight: React.FC<TonightProps> = ({ hasSongs, run, report, plan, song, minutesToday, onOpenSong, onAddSong }) => {
  const when = whenLine();
  const photo = { ['--tday-photo' as string]: `url(${assetUrl('img/hero-guitar.webp')})`, ['--i' as string]: 0 } as React.CSSProperties;

  // Finished: what the session moved, from the report the run builds.
  if (report) {
    const endSong = report.songId ? getSong(report.songId) : null;
    return (
      <section className="tday-hero" style={photo}>
        <span className="tday-when">{when}</span>
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
        <span className="tday-when">{when} · step {run.at + 1} of {run.steps.length}</span>
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
        <span className="tday-when">{when}</span>
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
      <span className="tday-when">{when}{minutesToday > 0 && ` · ${minutesToday} min so far`}</span>
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
// The page
// ---------------------------------------------------------------------------

/**
 * Home answers one question: what should I do right now?
 *
 * Tonight's card holds the answer, and changes with the evening: a first
 * open, a plan, a session halfway through, a session finished. Under it, only
 * what helps decide what comes after: the week, two songs you might pick up,
 * a two-minute idea, and the next lesson.
 */
export const DashboardLanding: React.FC<DashboardLandingProps> = ({ setActiveTab, onOpenSong, onAddSong }) => {
  const [tick, setTick] = useState(0);
  useEffect(() => subscribeProgress(() => setTick(t => t + 1)), []);
  const runVersion = useRunVersion();
  const ready = useLibrary();

  const run = getRun();
  const report = getReport();
  const songs = getSongs();
  const stats = practiceStats();
  const recap = weekRecap();
  const prompt = promptForDate(new Date(), songs.length > 0);

  // The plan is worked out from the chord book and the library, so it is only
  // redone when either could have changed.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const plan = useMemo(() => (ready && songs.length > 0 ? planRun() : []), [ready, songs.length, tick, runVersion]);

  const songOf = (steps: RunStep[] | undefined) => {
    const id = steps?.find(s => s.kind === 'song')?.songId;
    return id ? getSong(id) ?? null : null;
  };
  const song = songOf(run?.steps) ?? songOf(plan);
  const minutesToday = minutesPractisedToday();

  // Two songs you might pick up instead: the last one played, then one you
  // marked to come back to (or another you are still learning).
  const others: { song: Song; why: string }[] = [];
  const recent = lastPractised(song?.id ?? null);
  if (recent) others.push({ song: recent.song, why: `played ${fmtWhen(recent.date)}` });
  const taken = new Set([song?.id, recent?.song.id]);
  const revisit = songs.find(s => s.revisit && !taken.has(s.id));
  const learning = songs.find(s => s.status === 'learning' && !taken.has(s.id));
  const second = revisit ?? learning ?? songs.find(s => !taken.has(s.id));
  if (second && others.length < 2) {
    others.push({ song: second, why: second.revisit ? 'marked to revisit' : second.artist || 'in your songs' });
  }

  const done = ALL_LEVELS.filter(isLevelComplete).length;
  const total = ALL_LEVELS.length;
  const nextLevel = ALL_LEVELS.find(l => !isLevelComplete(l));
  const fresh = songs.length === 0;
  const showWeek = !fresh || stats.totalMinutes > 0 || !recap.quiet;

  if (!ready) return <div className="tday" />;

  const at = (i: number) => ({ ['--i' as string]: i } as React.CSSProperties);

  // A tip opens the thing it is about: the song, the loop, the tuner mode.
  const openTip = () => {
    if (prompt.needsSong) { go({ tab: 'library', songId: song?.id ?? null }); return; }
    if (prompt.loop) {
      handLoop({ slots: prompt.loop.map(([c, b]) => makeSlot(c, b)), tempo: prompt.tempo ?? 60, beatsPerBar: 4, name: prompt.text });
      go({ tab: 'chordbook', songId: null });
      return;
    }
    if (prompt.voice) {
      try {
        localStorage.setItem('cadenza-tuner-mode', 'voice');
        localStorage.setItem('cadenza-voice-mode', prompt.voice);
      } catch { /* opens on its defaults */ }
    }
    setActiveTab(prompt.tab);
  };

  const tip = (
    <button type="button" className="tday-row tday-tip" style={at(4)} onClick={openTip}>
      <span className="tday-row-text"><small>Two minutes only?</small><b>{prompt.text}</b></span>
      <Chev />
    </button>
  );

  const journey = fresh && done === 0 && nextLevel ? (
    <button type="button" className="tday-row tday-lesson" style={at(1)} onClick={() => setActiveTab('journey')}>
      <Ring done={0} total={total} />
      <span className="tday-row-text"><small>Your first lesson</small><b>{nextLevel.title}</b></span>
      <Chev />
    </button>
  ) : (
    <button type="button" className="tday-row tday-journey" style={at(5)} onClick={() => setActiveTab('journey')}>
      <Ring done={done} total={total} />
      <span className="tday-row-text">
        <b>Journey</b>
        <small>{nextLevel ? `Next: ${nextLevel.title}` : `All ${total} lessons done`}</small>
      </span>
      <Chev />
    </button>
  );

  return (
    <div className={`tday${fresh ? ' is-fresh' : ''}`}>
      <div className="tday-main">
        {!fresh && <StreakStrip />}
        <Tonight
          hasSongs={!fresh}
          run={run}
          report={report}
          plan={plan}
          song={song}
          minutesToday={minutesToday}
          onOpenSong={onOpenSong}
          onAddSong={onAddSong}
        />
        {tip}
      </div>

      <div className="tday-side">
        {showWeek && <WeekPanel recap={recap} style={at(2)} />}

        {others.length > 0 && (
          <section className="tday-card tday-songs" style={at(3)}>
            <div className="tday-card-head">
              <span className="surface-label">Your songs</span>
              <button type="button" className="tday-link" onClick={() => setActiveTab('library')}>All {songs.length} ›</button>
            </div>
            <div className="tday-songlist">
              {others.map(o => (
                <button key={o.song.id} type="button" className="tday-song" onClick={() => onOpenSong(o.song.id)}>
                  <span className={`tday-edge is-${o.song.status}`} aria-hidden="true" />
                  <span className="tday-row-text">
                    <b>{o.song.title}</b>
                    <small>{STATUS_LABEL[o.song.status]} · {o.why}</small>
                  </span>
                  <Chev />
                </button>
              ))}
            </div>
          </section>
        )}

        {journey}
      </div>
    </div>
  );
};

export default DashboardLanding;
