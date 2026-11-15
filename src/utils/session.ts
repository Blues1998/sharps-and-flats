// The end of a session: what it measured, so one summary screen can show it.
//
// Each tool says when a session is under way (useSessionEnd) and what to say
// about it at the end. The time and XP are measured here, from the practice
// clock and the XP ledger, so no tool can report more than happened.

import { useEffect, useRef } from 'react';
import { CLOCK_EVENT, getGoal, secondsOn } from './practiceClock';
import { addRepaired } from './streak';
import { STORE_CHANGE_EVENT } from './db';
import { totalXp } from './xp';
import { streakRepair, today } from './library';

export interface SessionStat { label: string; value: string }

/** What a tool says about the session it just ran. */
export interface SessionWords {
  title: string;
  headline: string;
  /** Against last time: "New best. Was 6.", "+6 bpm on Am F". */
  better?: string | null;
  /** Whether `better` is good news, coloured if so. */
  isBetter?: boolean;
  stats?: SessionStat[];
}

export interface SessionReport extends SessionWords {
  /** The practice clock key, which also names the badge it feeds. */
  tool: string;
  seconds: number;
  xp: number;
  /** Today's goal was reached during this session. */
  goalMetNow: boolean;
  /** A broken streak was earned back during this session. */
  repaired: number | null;
}

const OPEN = 'cadenza-session-open';
let current: SessionReport | null = null;
let running = 0;

export const getSession = (): SessionReport | null => current;
export const subscribeSession = (cb: () => void) => {
  window.addEventListener(OPEN, cb);
  return () => window.removeEventListener(OPEN, cb);
};
export function closeSession(): void {
  current = null;
  window.dispatchEvent(new Event(OPEN));
}
/** Whether a session that will end on a summary is under way. */
export const sessionRunning = (): boolean => running > 0;

const MIN_SECONDS = 30;

/**
 * Marks a session under way while `active`, and shows the summary when it
 * ends: when `active` goes false, or the screen closes mid-session. Nothing
 * shows for a session under 30 seconds that achieved nothing, so a quick try
 * of a button does not earn a screen.
 */
export function useSessionEnd(tool: string, active: boolean, words: () => SessionWords): void {
  const wordsRef = useRef(words);
  useEffect(() => { wordsRef.current = words; });
  useEffect(() => {
    if (!active) return;
    running++;
    const day = today();
    const startSecs = secondsOn(day);
    const startXp = totalXp();
    const goalSecs = getGoal() * 60;
    const repairAtStart = streakRepair();
    return () => {
      running--;
      // After the practice clock's own last tick, which runs in the same pass.
      window.setTimeout(() => {
        const seconds = secondsOn(day) - startSecs;
        const xp = totalXp() - startXp;
        const goalMetNow = startSecs < goalSecs && secondsOn(day) >= goalSecs;
        const repaired = repairAtStart && !streakRepair() ? repairAtStart.lost + repairAtStart.missed.length + 1 : null;
        if (seconds < MIN_SECONDS && xp === 0 && !goalMetNow && !repaired) return;
        current = { ...wordsRef.current(), tool, seconds, xp, goalMetNow, repaired };
        window.dispatchEvent(new Event(OPEN));
      }, 0);
    };
  }, [tool, active]);
}

/**
 * Earns a broken streak back once today's counted time reaches double the
 * goal (see streak.ts). Watches the practice clock; called once from the shell.
 */
let repairWired = false;
export function initRepair(): void {
  if (repairWired) return;
  repairWired = true;
  const check = () => {
    const offer = streakRepair();
    if (!offer || secondsOn(today()) < getGoal() * 2 * 60) return;
    addRepaired(offer.missed);
    window.dispatchEvent(new CustomEvent(STORE_CHANGE_EVENT));
  };
  window.addEventListener(CLOCK_EVENT, check);
  check();
}
