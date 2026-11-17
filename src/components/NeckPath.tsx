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
import { lessonOpen, startLesson, subscribeLesson } from '../lesson/store';
import { lessonFor } from '../lesson/lessons';
import { useBackToClose } from '../utils/nativeShell';
import { AHEAD, FRETS, NECK_ORDER, OCTAVE, CHECKS_READY, UNITS, checkId, checkStars, doneSteps, fretHeight, levelOf, markSeen, seenSteps, unitOf } from '../utils/neck';
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
const INTRO_KEY = 'cadenza-neck-intro';

const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const t = (ms: number) => (reduced() ? 0 : ms);

/** Which strings a fret's steps sit on: a shape a hand could make. String 1 is the thinnest. */
const shapeFor = (count: number, strings: number): number[] => {
  if (strings === 4) return [[2], [3, 1], [4, 2, 1]][Math.min(count, 3) - 1] ?? [];
  return [[4], [5, 2], [5, 3, 1]][Math.min(count, 3) - 1] ?? [];
};

const fretDoneIn = (f: FretDef, done: Set<string>): boolean =>
  f.check ? done.has(checkId(f.n)) : f.steps.every(id => done.has(id));

const currentIn = (done: Set<string>): number => {
  for (const f of FRETS) if (!fretDoneIn(f, done)) return f.n;
  return OCTAVE + 1;
};

/** "Lesson · 6 exercises · about 3 min", for a step with a lesson. */
const lessonSummary = (id: string): string | null => {
  const l = lessonFor(id);
  if (!l) return null;
  const xs = l.build();
  const mins = Math.max(2, Math.round(xs.reduce((a, x) => a + (x.type === 'play' || x.type === 'tap' ? 50 : 20), 0) / 60));
  const mic = xs.some(x => x.type === 'play');
  return `${l.check ? 'Check' : 'Lesson'} · ${xs.length} ${l.check ? 'questions' : 'exercises'} · about ${mins} min${mic ? ' · uses the mic' : ''}`;
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
    const done = doneSteps(); // first: it settles which milestones were already behind you
    const seen = seenSteps();
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
  const [viewUnit, setViewUnit] = useState<number | null>(null);
  const [guide, setGuide] = useState<number | null>(null);
  const [flash, setFlash] = useState<{ unit: number; k: number } | null>(null);
  const [intro, setIntro] = useState(() => { try { return !localStorage.getItem(INTRO_KEY); } catch { return false; } });
  const [narrow, setNarrow] = useState(() => typeof matchMedia === 'function' && matchMedia('(max-width: 379px)').matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia('(max-width: 379px)');
    const on = () => setNarrow(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const [away, setAway] = useState<'up' | 'down' | null>(null);
  const playing = useRef(false);
  const lastUnder = useRef(0);
  const bannerRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<Record<number, HTMLDivElement | null>>({});

  const cur = currentIn(shown);
  const curFret = Math.min(cur, OCTAVE);
  const total = ALL_LEVELS.length;

  // One moment at a time: badges wait while the neck has progress to show.
  const pending = (() => { const d = doneSteps(); return NECK_ORDER.some(id => d.has(id) && !shown.has(id)); })();
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
  const width = strings === 4 ? (narrow ? 132 : 148) : (narrow ? 166 : 190);
  const edge = strings === 4 ? 20 : narrow ? 15 : 17;
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
    if (getSession() || lessonOpen()) return; // the summary or lesson first; we run again when it closes
    const done = doneSteps();
    const fresh = NECK_ORDER.filter(id => done.has(id) && !shown.has(id));
    if (fresh.length === 0) return;
    playing.current = true;
    let have = new Set(shown);
    await wait(t(450));
    for (const id of fresh) {
      const isCheck = id.startsWith('check-');
      const fret = isCheck ? FRETS.find(f => f.check && checkId(f.n) === id) : FRETS.find(f => f.steps.includes(id));
      if (!fret) { have.add(id); continue; }
      const before = currentIn(have);
      have = new Set(have).add(id);
      setShown(have);
      if (!isCheck) {
        const s = shapeFor(fret.steps.length, strings)[fret.steps.indexOf(id)] ?? 3;
        setPress(id);
        await wait(t(220));
        feel('fret');
        setRinging({ strings: [s], k: Date.now() });
        setFloat({ x: strX(s), y: noteY(fret.n), k: Date.now() });
        await wait(t(800));
      }
      const after = currentIn(have);
      if (after === before) { setPress(null); continue; }
      if (!isCheck) {
        // The fret is finished: the wire lights like a downstroke, the neck rings.
        setSweep(fret.n);
        setRinging({ strings: 'all', k: Date.now() });
        feel('strum');
        await wait(t(800));
        setSweep(null);
      }
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
          setFlash({ unit: unitOf(m.n), k: Date.now() });
          feel('celebrate');
          await wait(t(1300));
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
    const offSession = subscribeSession(() => { if (!getSession()) void play(); });
    const offLesson = subscribeLesson(() => { if (!lessonOpen()) void play(); });
    return () => { offSession(); offLesson(); };
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
      let under = 0;
      for (let n = 1; n <= lastFret; n++) {
        const r = rowRefs.current[n]?.getBoundingClientRect();
        if (r && r.top <= line) under = n;
      }
      if (lastUnder.current !== 0 && under !== lastUnder.current) feel('select');
      lastUnder.current = under;
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
  }, [curFret, lastFret]);

  // The phone's Back closes a popover or the guide before leaving the page.
  const closeFocus = useCallback(() => setFocus(null), []);
  const closeGuide = useCallback(() => setGuide(null), []);
  useBackToClose(focus !== null, closeFocus);
  useBackToClose(guide !== null, closeGuide);

  // ---- Actions ------------------------------------------------------------------
  // A step with a lesson opens it; the rest (setup) go to their screen.
  const open = (level: JourneyLevel) => {
    feel('tap');
    setFocus(null);
    if (lessonFor(level.id)) { startLesson(level.id); return; }
    followStep(isLevelComplete(level) ? null : level.id);
    setActiveTab(level.tab);
  };

  const tapFret = (n: number, stepId?: string) => {
    if (n > OCTAVE) return;
    if (n > cur) {
      feel('nudge');
      if (stepId) setShake({ id: stepId, k: Date.now() });
    } else {
      feel('select');
    }
    setFocus(focus === n ? null : n);
  };

  useEffect(() => {
    if (focus === null) return;
    const close = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest('.np-pop, .np-dot, .np-label-btn, .np-num, .np-bubble, .np-guide, .np-medal, .np-octave')) setFocus(null);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [focus]);

  // A card opened near the bottom of the screen would sit under the tab bar.
  // Bring it into view, without pushing the note you tapped off the top.
  useEffect(() => {
    if (focus === null) return;
    let id = requestAnimationFrame(() => {
      const pop = document.querySelector<HTMLElement>('.neckpath .np-pop');
      const view = pop?.closest<HTMLElement>('.np-view');
      if (!pop || !view) return;
      // A card low on the neck can hang past the end of the page; make room for it.
      const hang = pop.getBoundingClientRect().bottom - view.getBoundingClientRect().bottom + 16;
      view.style.marginBottom = hang > 0 ? `${Math.ceil(hang)}px` : '';
      id = requestAnimationFrame(() => {
      const r = pop.getBoundingClientRect();
      const floor = (document.querySelector('.mtabs')?.getBoundingClientRect().top ?? window.innerHeight) - 12;
      const ceiling = (document.querySelector('.np-banner-wrap')?.getBoundingClientRect().bottom ?? 0) + 8;
      const need = r.bottom - floor;
      if (need <= 0) return;
      const room = r.top - 90 - ceiling; // keep the tapped fret (just above the card) on screen
      window.scrollBy({ top: Math.max(0, Math.min(need, room)), behavior: reduced() ? 'auto' : 'smooth' });
      });
    });
    return () => {
      cancelAnimationFrame(id);
      const view = document.querySelector<HTMLElement>('.neckpath .np-view');
      if (view) view.style.marginBottom = '';
    };
  }, [focus]);


  // ---- Banner -------------------------------------------------------------------
  const myUnit = unitOf(curFret);
  const shownUnit = viewUnit ?? myUnit;
  const unit = UNITS[shownUnit];
  const unitState = cur > OCTAVE || shownUnit < myUnit ? 'is-done' : shownUnit > myUnit ? 'is-ahead' : 'is-now';
  const banner = (
    <div className="np-banner-wrap" ref={bannerRef}>
      <header key={flash?.unit === shownUnit ? flash.k : 'b'} className={`np-banner ${unitState}${flash?.unit === shownUnit ? ' is-flash' : ''}`}>
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
          onClick={() => { feel('select'); setFocus(null); setGuide(shownUnit); }}
          aria-label={`What ${unit.name} teaches`}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z" /><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5" /><path d="M9 8h7M9 11.5h5" />
          </svg>
        </button>
      </header>
    </div>
  );

  // ---- Cards ----------------------------------------------------------------------
  const Lock = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <rect x="5" y="11" width="14" height="10" rx="2.5" /><path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3" />
    </svg>
  );
  const Chevron = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
  );

  const card = (f: FretDef) => {
    const locked = f.n > cur;
    const unlock = <span className="np-unlock"><Lock />Finish fret {curFret} to unlock</span>;
    if (f.check) {
      const id = checkId(f.n);
      const passed = fretDoneIn(f, shown);
      const st = checkStars(id);
      return (
        <div className={`np-card is-check${locked ? ' is-locked' : ''}`}>
          <small>{f.n === OCTAVE ? 'The octave' : 'Milestone'}{passed ? ' · passed' : ''}</small>
          <b>{f.check.title}</b>
          <p>{f.check.task}</p>
          <span className="np-card-stars" aria-label={`${st} of ${STARS} stars`}>
            {Array.from({ length: STARS }, (_, i) => <span key={i} className={i < st ? 'is-on' : ''}><Star /></span>)}
          </span>
          {locked ? unlock : (
            <>
              <p className="np-card-meta">{lessonSummary(id)}</p>
              {passed && st === 0 && <span className="np-soon">Passed before the checks arrived. Take it any time to earn its stars.</span>}
              <button type="button" className="np-start" data-feel="off" onClick={() => { feel('tap'); setFocus(null); startLesson(id); }}>
                {!passed ? 'Start the check' : st === STARS ? 'Take it again' : st > 0 ? 'Go for more stars' : 'Earn the stars'}
              </button>
            </>
          )}
        </div>
      );
    }
    const levels = f.steps.map(id => levelOf(id)).filter((l): l is JourneyLevel => !!l);
    const next = levels.find(l => !shown.has(l.id)) ?? null;
    if (next && f.n === cur) {
      const [met, needed] = levelProgress(next);
      return (
        <div className="np-card is-now">
          <small>Fret {f.n} · Step {levels.indexOf(next) + 1} of {levels.length}{needed > 1 && !lessonFor(next.id) && <em>{met} of {needed} done</em>}</small>
          <b>{next.title}</b>
          <p className="np-idea">{next.idea}</p>
          <p>{lessonSummary(next.id) ?? next.task}</p>
          <button type="button" className="np-start" data-feel="off" onClick={() => open(next)}>Start</button>
        </div>
      );
    }
    return (
      <div className={`np-card${locked ? ' is-locked' : ''}`}>
        <small>Fret {f.n} · {f.title}</small>
        <ul className="np-steps">
          {levels.map(l => {
            const done = shown.has(l.id);
            return (
              <li key={l.id}>
                {locked ? (
                  <div className="np-steps-row">
                    <span className={`np-steps-dot${done ? ' is-done' : ' is-locked'}`} aria-hidden="true">{done ? <Check /> : <Lock />}</span>
                    <span className="np-steps-text"><b>{l.title}</b><span>{l.idea}</span></span>
                  </div>
                ) : (
                  <button type="button" className="np-steps-row" data-feel="off" onClick={() => open(l)}>
                    <span className={`np-steps-dot${done ? ' is-done' : ''}`} aria-hidden="true">{done && <Check />}</span>
                    <span className="np-steps-text"><b>{l.title}</b><span>{done ? 'Practise again' : l.idea}</span></span>
                    <Chevron />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        {locked && unlock}
      </div>
    );
  };

  // ---- Labels: a name, and only your fret says more ----------------------------
  const label = (f: FretDef) => {
    const done = fretDoneIn(f, shown);
    if (f.check) {
      return (
        <span className={`np-label is-check${done ? ' is-done' : ''}`}>
          <small>{f.n === OCTAVE ? 'Octave' : 'Milestone'}</small>{f.check.title}
          {f.n === cur && tag?.place === 'label' && focus === null && <small className="np-label-gorow"><span className="np-label-go">Start<Chevron /></span></small>}
        </span>
      );
    }
    if (f.n === cur) {
      const levels = f.steps.map(id => levelOf(id)).filter((l): l is JourneyLevel => !!l);
      const next = levels.find(l => !shown.has(l.id));
      return (
        <span className="np-label is-now">
          {next?.title ?? f.title}
          {tag?.place === 'label' && focus === null
            ? <small className="np-label-gorow"><span className="np-label-go">Start<Chevron /></span></small>
            : <small>Fret {f.n} · Step {next ? levels.indexOf(next) + 1 : levels.length} of {levels.length}</small>}
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
    if (!curDef) return null;
    if (curDef.check) return { x: width / 2, y: midY(cur), pct: 0, check: true };
    const i = curDef.steps.findIndex(id => !shown.has(id));
    const level = levelOf(curDef.steps[i]);
    if (!level) return null;
    // A lesson is all or nothing, so its ring stays empty until it is done.
    const [met, needed] = lessonFor(level.id) ? [0, 1] : levelProgress(level);
    return { x: strX(shapeFor(curDef.steps.length, strings)[i] ?? 3), y: noteY(cur), pct: needed ? met / needed : 0, check: false };
  })();

  const tag = (() => {
    if (!curNote) return null;
    // The tag sits above your note: full size where there is room, smaller
    // where a neighbour is close. With no clean gap above or below (frets get
    // short up the neck), it moves into the step's label beside the neck.
    const ring = curNote.check ? 20 : 26;
    const half = 42; // half the tag's width
    const things = (n: number) => {
      const f = FRETS.find(g => g.n === n);
      if (!f) return [] as { x: number; y: number; r: number }[];
      if (f.check) return (n === OCTAVE ? [width * 0.3, width * 0.7] : [width / 2]).map(x => ({ x, y: midY(n), r: 17 }));
      const shape = shapeFor(f.steps.length, strings);
      return f.steps.map((_, i) => ({ x: strX(shape[i] ?? 3), y: noteY(n), r: 14 }));
    };
    const near = (n: number) => things(n).filter(o => Math.abs(o.x - curNote.x) < half + o.r);
    const ceiling = Math.max(cur === 1 ? geo.tops[1] : -Infinity, ...near(cur - 1).map(o => o.y + o.r));
    const floor = Math.min(Infinity, ...near(cur + 1).map(o => o.y - o.r));
    const room = curNote.y - ring - ceiling;
    const roomBelow = floor - (curNote.y + 30);
    const place = room >= 44 ? 'above' : room >= 33 ? 'tight' : roomBelow >= 36 ? 'below' : 'label';
    const top = place === 'below' ? curNote.y + 30 : place === 'tight' ? curNote.y - ring - 5 : curNote.y - 30;
    return { place, x: curNote.x, top };
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
        const st = checkStars(checkId(f.n));
        const passed = fretDoneIn(f, shown);
        if (!CHECKS_READY || (passed ? st === 0 : f.n !== nextMilestone)) return null;
        return (
          <span key={`st${f.n}`} className="np-stars" style={{ top: f.n === OCTAVE ? midY(f.n) - 6 : midY(f.n) + 24, left: width / 2 }} aria-hidden="true">
            {Array.from({ length: STARS }, (_, i) => <span key={i} className={i < st ? 'is-on' : ''}><Star /></span>)}
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
      {curNote && !curNote.check && (
        <svg className="np-ring" style={{ left: curNote.x, top: curNote.y }} viewBox="0 0 52 52" aria-hidden="true">
          <circle cx="26" cy="26" r="23" className="np-ring-track" />
          {curNote.pct > 0 && (
            <circle cx="26" cy="26" r="23" className="np-ring-fill" pathLength={100} strokeDasharray={`${Math.max(4, curNote.pct * 100)} 100`} transform="rotate(-90 26 26)" />
          )}
        </svg>
      )}
      {tag && focus === null && tag.place !== 'label' && (
        <button
          type="button"
          className={`np-bubble${tag.place === 'below' ? ' is-below' : tag.place === 'tight' ? ' is-tight' : ''}`}
          data-feel="off"
          style={{ left: tag.x, top: tag.top }}
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
        className={`np-row${n === cur ? ' is-now' : ''}${n > OCTAVE ? ' is-far' : ''}${starts > 0 ? ' has-div' : ''}`}
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
      {intro && (
        <div className="np-intro" role="note">
          <p><b>Each note is a step.</b> Finish a fret's notes to move up the neck. Milestones sit on the pearl inlays, and fret 12 is the octave.</p>
          <button type="button" onClick={() => { setIntro(false); try { localStorage.setItem(INTRO_KEY, '1'); } catch { /* shows again */ } }}>Got it</button>
        </div>
      )}
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
      {guide !== null && createPortal(
        <div className="np-octave np-guide-sheet" role="dialog" aria-modal="true" aria-label={`${UNITS[guide].name}, what it teaches`}>
          <div className="np-octave-scrim" onClick={() => setGuide(null)} />
          <div className="np-octave-sheet">
            <span className="np-eyebrow">Unit {guide + 1} of {UNITS.length} · Frets {UNITS[guide].from} to {UNITS[guide].to}</span>
            <h3>{UNITS[guide].name}</h3>
            <ol className="np-guide-list">
              {FRETS.filter(f => f.n >= UNITS[guide].from && f.n <= UNITS[guide].to).map(f => (
                <li key={f.n} className={f.check ? 'is-check' : ''}>
                  <span className="np-guide-fret">{f.n}</span>
                  <div>
                    {f.check ? (
                      <><b>{fretDoneIn(f, shown) && <Check />}{f.check.title}</b><p>{f.check.task}</p></>
                    ) : f.steps.map(id => {
                      const l = levelOf(id);
                      return l ? <div key={id} className={`np-guide-step${shown.has(id) ? ' is-done' : ''}`}><b>{shown.has(id) && <Check />}{l.title}</b><p>{l.idea}</p></div> : null;
                    })}
                  </div>
                </li>
              ))}
            </ol>
            <button type="button" className="np-start" onClick={() => { setGuide(null); scrollToFret(cur); }}>
              {guide === myUnit ? 'Go to my step' : 'Close'}
            </button>
          </div>
        </div>,
        document.body
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
