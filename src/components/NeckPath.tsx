import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ActiveTab } from './navGroups';
import { ALL_LEVELS, isLevelComplete, levelProgress } from '../utils/journey';
import type { JourneyLevel } from '../utils/journey';
import { subscribeProgress } from '../utils/progress';
import { followStep } from '../utils/journeyStep';
import { useProfile } from '../utils/profile';
import { feel } from '../utils/haptics';
import { getSession, subscribeSession } from '../utils/session';
import { useHoldUnlocks } from '../utils/feats';
import { AHEAD, FRETS, OCTAVE, CHECKS_READY, UNITS, doneSteps, fretHeight, levelOf, markSeen, seenSteps, unitOf } from '../utils/neck';
import type { FretDef } from '../utils/neck';

// Up the Neck. The Journey drawn as a real fretboard you scroll like a path.
//
// Steps are notes fretted on the neck. Each unit ends on a milestone fret,
// marked with a medallion where a neck has its pearl inlay. Fret 12 is the
// octave, the end of the basics; the frets past it fade into what comes next.
//
// The banner names the unit in view. Your note carries a ring for the task in
// progress and a Start bubble. The wood behind the frets you have played is
// lit, so how far you have come reads at a glance.
//
// Moments (a note pressed on, a fret finished, a milestone, the octave) play
// for progress made since you last looked, after any session summary closes,
// and badges wait for them.

interface Props {
  mode: 'today' | 'full';
  setActiveTab: (tab: ActiveTab) => void;
}

const FIRST = 112;           // height of fret 1, px; each fret after is 2^(-1/12) of the last
const NUT = 12;
const XP_STEP = 20;
const STARS = 3;

const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const t = (ms: number) => (reduced() ? 0 : ms);

/** Which strings a fret's steps sit on: a shape a hand could make. String 1 is the thinnest. */
const shapeFor = (count: number, strings: number): number[] => {
  if (strings === 4) return [[2], [3, 1], [4, 2, 1]][Math.min(count, 3) - 1] ?? [];
  return [[4], [5, 2], [5, 3, 1]][Math.min(count, 3) - 1] ?? [];
};

const fretDoneIn = (f: FretDef, done: Set<string>): boolean =>
  f.check
    ? !CHECKS_READY && FRETS.filter(g => g.n < f.n).every(g => g.check || g.steps.every(id => done.has(id)))
    : f.steps.every(id => done.has(id));

const currentIn = (done: Set<string>): number => {
  for (const f of FRETS) if (!fretDoneIn(f, done)) return f.n;
  return OCTAVE + 1;
};

const Check = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12.5l4.5 4.5L19 7" />
  </svg>
);
const Note = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M9 17.5V6.2l10-2.2v11.3" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" />
    <ellipse cx="6.6" cy="17.6" rx="2.9" ry="2.4" fill="currentColor" />
    <ellipse cx="16.6" cy="15.4" rx="2.9" ry="2.4" fill="currentColor" />
  </svg>
);
const Star = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8l2.7 5.9 6.4.7-4.8 4.3 1.4 6.3L12 16.8 6.3 20l1.4-6.3L2.9 9.4l6.4-.7z" fill="currentColor" /></svg>
);

export const NeckPath: React.FC<Props> = ({ mode, setActiveTab }) => {
  const profile = useProfile();
  const strings = profile.instrument === 'ukulele' ? 4 : 6;

  const [, setTick] = useState(0);
  useEffect(() => subscribeProgress(() => setTick(x => x + 1)), []);

  // What the neck shows as done. It trails real progress while a moment plays.
  const [shown, setShown] = useState<Set<string>>(() => {
    const seen = seenSteps();
    const done = doneSteps();
    if (!seen) { markSeen(done); return done; }
    return new Set([...done].filter(id => seen.has(id)));
  });
  const [press, setPress] = useState<string | null>(null);
  const [ringing, setRinging] = useState<{ strings: number[] | 'all'; k: number } | null>(null);
  const [sweep, setSweep] = useState<number | null>(null);
  const [lit, setLit] = useState<number | null>(null);
  const [cheer, setCheer] = useState<number | null>(null);
  const [float, setFloat] = useState<{ x: number; y: number; k: number } | null>(null);
  const [octave, setOctave] = useState(false);
  const [focus, setFocus] = useState<number | null>(null);
  const [shake, setShake] = useState<{ id: string; k: number } | null>(null);
  const [hint, setHint] = useState<{ fret: number; k: number } | null>(null);
  const [viewUnit, setViewUnit] = useState<number | null>(null);
  const [away, setAway] = useState<'up' | 'down' | null>(null);
  const playing = useRef(false);
  const bannerRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<Record<number, HTMLDivElement | null>>({});

  const cur = currentIn(shown);
  const curFret = Math.min(cur, OCTAVE);
  const total = ALL_LEVELS.length;

  // One moment at a time: badges wait while the neck has progress to show.
  const pending = ALL_LEVELS.some(l => !shown.has(l.id) && isLevelComplete(l));
  useHoldUnlocks('neck', pending || octave);

  // ---- Geometry ---------------------------------------------------------------
  const lastFret = AHEAD[AHEAD.length - 1].n;
  const geo = useMemo(() => {
    const tops: number[] = [];
    const heights: number[] = [];
    let y = NUT;
    for (let n = 1; n <= lastFret; n++) {
      tops[n] = y;
      heights[n] = Math.round(fretHeight(n, FIRST));
      y += heights[n];
    }
    return { tops, heights, length: y };
  }, [lastFret]);
  const width = strings === 4 ? 148 : 190;
  const edge = strings === 4 ? 22 : 17;
  const strX = (s: number) => edge + (strings - s) * ((width - 2 * edge) / (strings - 1));
  const midY = (n: number) => geo.tops[n] + geo.heights[n] / 2;
  const noteY = (n: number) => midY(n) + (geo.heights[n] > 90 ? 6 : 3);

  const scrollToFret = useCallback((n: number, smooth = true) => {
    const el = rowRefs.current[Math.min(n, OCTAVE)];
    el?.scrollIntoView({ block: 'center', behavior: smooth && !reduced() ? 'smooth' : 'auto' });
  }, []);

  // ---- Moments ------------------------------------------------------------------
  const play = useCallback(async () => {
    if (playing.current) return;
    if (getSession()) return; // the summary first; we run again when it closes
    const done = doneSteps();
    const fresh = ALL_LEVELS.map(l => l.id).filter(id => done.has(id) && !shown.has(id));
    if (fresh.length === 0) return;
    playing.current = true;
    let have = new Set(shown);
    await wait(t(450));
    for (const id of fresh) {
      const fret = FRETS.find(f => f.steps.includes(id));
      if (!fret) { have.add(id); continue; }
      const s = shapeFor(fret.steps.length, strings)[fret.steps.indexOf(id)] ?? 3;
      const before = currentIn(have);
      have = new Set(have).add(id);
      setPress(id);
      setShown(have);
      await wait(t(220));
      feel('fret');
      setRinging({ strings: [s], k: Date.now() });
      setFloat({ x: strX(s), y: noteY(fret.n), k: Date.now() });
      await wait(t(800));
      const after = currentIn(have);
      if (after === before) { setPress(null); continue; }
      // The fret is finished: the wire lights like a downstroke, the neck rings.
      setSweep(fret.n);
      setRinging({ strings: 'all', k: Date.now() });
      feel('strum');
      await wait(t(800));
      setSweep(null);
      // Any milestone passed on the way gets its own moment.
      for (const m of FRETS.filter(f => f.check && f.n >= before && f.n < after)) {
        scrollToFret(m.n);
        await wait(t(450));
        if (m.n === OCTAVE) {
          feel('octave');
          for (let n = 1; n <= OCTAVE; n++) { setLit(n); await wait(t(70)); }
          setCheer(m.n);
          await wait(t(700));
          setOctave(true);
        } else {
          setCheer(m.n);
          feel('celebrate');
          await wait(t(1100));
        }
        setCheer(null);
      }
      setLit(null);
      scrollToFret(after);
      await wait(t(500));
      setPress(null);
    }
    markSeen(have);
    playing.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, strings, geo]);

  useEffect(() => {
    void play();
    return subscribeSession(() => { if (!getSession()) void play(); });
  });
  useEffect(() => () => { markSeen(doneSteps()); }, []);

  // Open on your fret, once the page has laid out.
  useEffect(() => {
    const id = window.setTimeout(() => scrollToFret(cur, false), 60);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The banner names the unit in view; a button finds your fret again.
  useEffect(() => {
    let raf = 0;
    const measure = () => {
      raf = 0;
      // Read where the eye is: a third of the way down the space under the banner.
      const top = bannerRef.current?.getBoundingClientRect().bottom ?? 0;
      const line = top + (window.innerHeight - top) * 0.35;
      let unit = 0;
      for (let n = 1; n <= OCTAVE; n++) {
        const r = rowRefs.current[n]?.getBoundingClientRect();
        if (r && r.top <= line) unit = unitOf(n);
      }
      setViewUnit(unit);
      const mine = rowRefs.current[curFret]?.getBoundingClientRect();
      if (!mine) return;
      const bottom = window.innerHeight - 80;
      setAway(mine.bottom < top ? 'up' : mine.top > bottom ? 'down' : null);
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(measure); };
    measure();
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [curFret]);

  // ---- Actions ------------------------------------------------------------------
  const open = (level: JourneyLevel) => {
    feel('tap');
    followStep(isLevelComplete(level) ? null : level.id);
    setActiveTab(level.tab);
  };

  const tapFret = (n: number, stepId?: string) => {
    if (n > OCTAVE) return;
    if (n > cur) {
      feel('nudge');
      if (stepId) setShake({ id: stepId, k: Date.now() });
      setHint({ fret: n, k: Date.now() });
      return;
    }
    feel('select');
    setFocus(focus === n ? null : n);
  };

  useEffect(() => {
    if (focus === null) return;
    const close = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest('.np-pop, .np-dot, .np-label-btn, .np-num, .np-bubble, .np-guide, .np-medal')) setFocus(null);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [focus]);

  useEffect(() => {
    if (!hint) return;
    const id = setTimeout(() => setHint(null), 1800);
    return () => clearTimeout(id);
  }, [hint]);

  // ---- Banner -------------------------------------------------------------------
  const myUnit = unitOf(curFret);
  const shownUnit = viewUnit ?? myUnit;
  const unit = UNITS[shownUnit];
  const unitState = cur > OCTAVE || shownUnit < myUnit ? 'is-done' : shownUnit > myUnit ? 'is-ahead' : 'is-now';
  const banner = (
    <div className="np-banner-wrap" ref={bannerRef}>
      <header className={`np-banner ${unitState}`}>
        <div className="np-banner-text">
          <span className="np-banner-kicker">
            Unit {shownUnit + 1} of {UNITS.length}
            {unitState === 'is-done' && ' · Done'}
            {unitState === 'is-now' && ` · Fret ${curFret}`}
          </span>
          <b key={shownUnit}>{unit.name}</b>
        </div>
        <button
          type="button"
          className="np-guide"
          data-feel="off"
          onClick={() => { feel('select'); scrollToFret(cur); setFocus(curFret); }}
          aria-label="Your next step"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z" /><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5" /><path d="M9 8h7M9 11.5h5" />
          </svg>
        </button>
      </header>
    </div>
  );

  // ---- Cards ----------------------------------------------------------------------
  const card = (f: FretDef) => {
    if (f.check) {
      const passed = fretDoneIn(f, shown);
      return (
        <div className="np-card is-check">
          <small>{f.n === OCTAVE ? 'The octave' : 'Milestone'}</small>
          <b>{f.check.title}</b>
          <p>{f.check.task}</p>
          <span className="np-soon">
            {passed ? 'Reached. Stars arrive with the skill checks in the next update.' : 'The skill check arrives in the next update.'}
          </span>
        </div>
      );
    }
    const levels = f.steps.map(id => levelOf(id)).filter((l): l is JourneyLevel => !!l);
    const next = levels.find(l => !shown.has(l.id)) ?? null;
    if (next && f.n === cur) {
      const [met, needed] = levelProgress(next);
      return (
        <div className="np-card is-now">
          <small>Fret {f.n} · Step {levels.indexOf(next) + 1} of {levels.length}{needed > 1 && <em>{met} of {needed} done</em>}</small>
          <b>{next.title}</b>
          <p>{next.task}</p>
          <button type="button" className="np-start" data-feel="off" onClick={() => open(next)}>Start</button>
        </div>
      );
    }
    return (
      <div className="np-card">
        <small>Fret {f.n} · {f.title}</small>
        <ul className="np-steps">
          {levels.map(l => (
            <li key={l.id}>
              <button type="button" data-feel="off" onClick={() => open(l)}>
                <span className={`np-steps-dot${shown.has(l.id) ? ' is-done' : ''}`} aria-hidden="true">{shown.has(l.id) && <Check />}</span>
                <span>{l.title}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  };

  // ---- Labels: a name, and only your fret says more ----------------------------
  const label = (f: FretDef) => {
    if (hint?.fret === f.n) return <span className="np-label is-hint">Finish fret {curFret} first</span>;
    const done = fretDoneIn(f, shown);
    if (f.check) {
      return (
        <span className={`np-label is-check${done ? ' is-done' : ''}`}>
          <small>{f.n === OCTAVE ? 'Octave' : 'Milestone'}</small>{f.check.title}
        </span>
      );
    }
    if (f.n === cur) {
      const levels = f.steps.map(id => levelOf(id)).filter((l): l is JourneyLevel => !!l);
      const next = levels.find(l => !shown.has(l.id));
      return (
        <span className="np-label is-now">
          {next?.title ?? f.title}
          <small>Fret {f.n} · Step {next ? levels.indexOf(next) + 1 : levels.length} of {levels.length}</small>
        </span>
      );
    }
    if (done) return <span className="np-label is-done"><Check />{f.title}</span>;
    const some = f.steps.filter(id => shown.has(id)).length;
    return <span className="np-label is-ahead">{f.title}{some > 0 && <small>{some} of {f.steps.length} done</small>}</span>;
  };

  // ---- The board ------------------------------------------------------------------
  const curDef = FRETS.find(f => f.n === cur) ?? null;
  const nextMilestone = FRETS.find(f => f.check && !fretDoneIn(f, shown))?.n ?? null;
  const playedTo = cur > OCTAVE ? geo.tops[OCTAVE] + geo.heights[OCTAVE] : noteY(cur);

  const curNote = (() => {
    if (!curDef || curDef.check) return null;
    const i = curDef.steps.findIndex(id => !shown.has(id));
    const level = levelOf(curDef.steps[i]);
    if (!level) return null;
    const [met, needed] = levelProgress(level);
    return { x: strX(shapeFor(curDef.steps.length, strings)[i] ?? 3), y: noteY(cur), pct: needed ? met / needed : 0 };
  })();

  const board = (
    <div className="np-board" style={{ width, height: geo.length }}>
      {/* The wood you have played, lit warm from the nut to your note. */}
      <i className="np-played" style={{ height: playedTo }} />
      <div className="np-nut" style={{ height: NUT }}>
        {Array.from({ length: strings }, (_, k) => <i key={k} style={{ left: strX(k + 1) }} />)}
      </div>
      {Array.from({ length: lastFret }, (_, k) => {
        const n = k + 1;
        const cls = ['np-wire', n === OCTAVE ? 'is-octave' : '', sweep === n ? 'is-sweep' : '', lit !== null && n <= lit ? 'is-lit' : ''].join(' ');
        return <i key={`w${n}`} className={cls} style={{ top: geo.tops[n] + geo.heights[n] - (n === OCTAVE ? 3 : 2) }} />;
      })}
      <span className="np-octave-tag" style={{ top: geo.tops[OCTAVE] + geo.heights[OCTAVE] + 6 }}>Octave</span>
      {/* Past the octave the neck fades into what comes next. */}
      <i className="np-beyond" style={{ top: geo.tops[OCTAVE + 1] }} />
      {/* A pearl at 15, as a real neck has. */}
      <span className="np-inlay is-far" style={{ top: midY(15), left: width / 2 }} />
      {Array.from({ length: strings }, (_, k) => {
        const s = k + 1;
        const ring = ringing && (ringing.strings === 'all' || ringing.strings.includes(s));
        return (
          <i
            key={`s${s}-${ring ? ringing!.k : 0}`}
            className={`np-string${s > (strings === 4 ? 4 : 3) ? ' is-wound' : ''}${ring ? ' is-ringing' : ''}`}
            style={{ left: strX(s), width: strings === 4 ? 1.3 + (s - 1) * 0.3 : 1.1 + (s - 1) * 0.42 }}
          />
        );
      })}
      {/* Milestones: medallions where the inlays sit. */}
      {FRETS.filter(f => f.check).map(f => {
        const passed = fretDoneIn(f, shown);
        const state = passed ? 'is-passed' : f.n === nextMilestone ? 'is-next' : 'is-later';
        const xs = f.n === OCTAVE ? [width * 0.3, width * 0.7] : [width / 2];
        return xs.map((x, j) => (
          <button
            key={`m${f.n}-${j}`}
            type="button"
            data-feel="off"
            className={`np-medal ${state}${cheer === f.n ? ' is-cheer' : ''}`}
            style={{ left: x, top: midY(f.n) }}
            onClick={() => tapFret(f.n)}
            aria-label={`${f.check!.title}, ${passed ? 'reached' : 'milestone'}`}
          >
            {state !== 'is-later' && <Note />}
          </button>
        ));
      })}
      {FRETS.filter(f => f.check).map(f => {
        if (!fretDoneIn(f, shown) && f.n !== nextMilestone) return null;
        return (
          <span key={`st${f.n}`} className="np-stars" style={{ top: midY(f.n) + (f.n === OCTAVE ? 20 : 24), left: width / 2 }} aria-hidden="true">
            {Array.from({ length: STARS }, (_, i) => <Star key={i} />)}
          </span>
        );
      })}
      {/* Steps: notes fretted just behind the wire, as a finger would. */}
      {FRETS.filter(f => !f.check).map(f => {
        const shape = shapeFor(f.steps.length, strings);
        return f.steps.map((id, i) => {
          const level = levelOf(id);
          if (!level) return null;
          const done = shown.has(id);
          const isNow = !done && f.n === cur && f.steps.find(x => !shown.has(x)) === id;
          const state = done ? (f.n > cur ? 'is-done is-early' : 'is-done') : isNow ? 'is-now' : f.n > cur ? 'is-ahead' : 'is-open';
          return (
            <button
              key={`${id}-${shake?.id === id ? shake.k : 0}`}
              type="button"
              data-feel="off"
              className={`np-dot ${state}${press === id ? ' is-press' : ''}${shake?.id === id ? ' is-shake' : ''}`}
              style={{ left: strX(shape[i] ?? 3), top: noteY(f.n) }}
              onClick={() => tapFret(f.n, id)}
              aria-label={`${level.title}${done ? ', done' : isNow ? ', next' : ''}`}
            >
              {done && <Check />}
            </button>
          );
        });
      })}
      {curNote && (
        <svg className="np-ring" style={{ left: curNote.x, top: curNote.y }} viewBox="0 0 52 52" aria-hidden="true">
          <circle cx="26" cy="26" r="23" className="np-ring-track" />
          {curNote.pct > 0 && (
            <circle cx="26" cy="26" r="23" className="np-ring-fill" pathLength={100} strokeDasharray={`${Math.max(4, curNote.pct * 100)} 100`} transform="rotate(-90 26 26)" />
          )}
        </svg>
      )}
      {curNote && focus === null && (
        <button
          type="button"
          className="np-bubble"
          data-feel="off"
          style={{ left: curNote.x, top: curNote.y - 30 }}
          onClick={() => { feel('select'); setFocus(cur); }}
        >
          Start
        </button>
      )}
      {float && (
        <span key={float.k} className="np-float" style={{ left: float.x, top: float.y - 18 }} onAnimationEnd={() => setFloat(null)}>
          +{XP_STEP} XP
        </span>
      )}
    </div>
  );

  // ---- Rows: the fret number, a unit divider where one starts, the label --------
  const focusedDef = focus !== null ? FRETS.find(f => f.n === focus) ?? null : null;
  const arrowX = (f: FretDef): number => {
    if (f.check) return width / 2;
    const i = Math.max(0, f.steps.findIndex(id => !shown.has(id)));
    return strX(shapeFor(f.steps.length, strings)[i] ?? 3);
  };

  const rows = Array.from({ length: lastFret }, (_, k) => {
    const n = k + 1;
    const f = FRETS.find(g => g.n === n);
    const ahead = AHEAD.find(a => a.n === n);
    const starts = UNITS.findIndex(u => u.from === n);
    return (
      <div
        key={n}
        ref={el => { rowRefs.current[n] = el; }}
        className={`np-row${n === cur ? ' is-now' : ''}${n > OCTAVE ? ' is-far' : ''}`}
        style={{ top: geo.tops[n], height: geo.heights[n] }}
      >
        {starts > 0 && <span className="np-divider"><span>{UNITS[starts].name}</span></span>}
        <button type="button" className="np-num" data-feel="off" onClick={() => tapFret(n)} aria-label={`Fret ${n}`} tabIndex={n > OCTAVE ? -1 : 0}>{n}</button>
        <div className="np-side">
          {ahead ? (
            <span className="np-label is-far">{ahead.title}{n === OCTAVE + 1 && <small>Second octave</small>}</span>
          ) : f ? (
            <button type="button" className="np-label-btn" data-feel="off" onClick={() => tapFret(n)} aria-pressed={focus === n}>{label(f)}</button>
          ) : null}
        </div>
      </div>
    );
  });

  return (
    <section className={`neckpath is-${mode}${strings === 4 ? ' is-uke' : ''}`} aria-label="Your progress up the neck">
      {banner}
      <div className="np-view" style={{ height: geo.length + 16 }}>
        <div className="np-grid" style={{ ['--neck-w' as string]: `${width}px` } as React.CSSProperties}>
          {board}
          {rows}
          {focusedDef && (
            <div
              key={focusedDef.n}
              className="np-pop"
              style={{ top: geo.tops[focusedDef.n] + geo.heights[focusedDef.n] + 6, ['--arrow-x' as string]: `calc(var(--np-left) + ${arrowX(focusedDef)}px)` } as React.CSSProperties}
            >
              {card(focusedDef)}
            </div>
          )}
        </div>
      </div>
      {away && (
        <button type="button" className={`np-back is-${away}`} onClick={() => { feel('select'); scrollToFret(cur); }} aria-label={`Back to fret ${curFret}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 19V5M6 11l6-6 6 6" />
          </svg>
        </button>
      )}
      {octave && createPortal(
        <div className="np-octave" role="dialog" aria-modal="true" aria-label="Octave reached">
          <div className="np-octave-scrim" onClick={() => setOctave(false)} />
          <div className="np-octave-sheet">
            <span className="np-eyebrow">Fret 12 · The octave</span>
            <h3>You know the basics.</h3>
            <p>Every note from here repeats one octave up. So does the course.</p>
            <div className="np-octave-stats">
              <div><b className="readout">{total}</b><span>steps</span></div>
              <div><b className="readout">{UNITS.length}</b><span>units</span></div>
              <div><b className="readout">{OCTAVE}</b><span>frets</span></div>
            </div>
            <button type="button" className="np-start" onClick={() => setOctave(false)}>Done</button>
          </div>
        </div>,
        document.body
      )}
    </section>
  );
};

export default NeckPath;
