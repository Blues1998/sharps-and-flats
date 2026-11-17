// The app-wide events: opening the app and meeting the daily goal. The rest
// are sent where they happen; telemetry.ts lists them all.

import { TELEMETRY_AVAILABLE, daysSinceInstall, setTelemetryContext, track } from './telemetry';
import { GOAL_MET_EVENT, getGoal } from './practiceClock';
import { initLibrary, minutesPractisedToday, streakState } from './library';
import { getProfile } from './profile';

/** Away this long, coming back counts as opening the app again. */
const AWAY_MS = 30 * 60 * 1000;

const opened = (returning: boolean) => {
  // The streak and today's minutes live in the library: wait for it to load.
  void initLibrary().then(() => track('app_opened', {
    returning,
    streak: streakState().current,
    goal: getGoal(),
    minutes_today: minutesPractisedToday(),
    days_since_install: daysSinceInstall(),
  }));
};

let wired = false;
export function wireUsage(): void {
  // Wired whenever the build can send, so turning the switch on mid-session
  // picks up from there; track() itself does nothing while it is off.
  if (wired || !TELEMETRY_AVAILABLE) return;
  wired = true;
  setTelemetryContext({ instrument: getProfile().instrument });
  opened(false);

  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
    if (hiddenAt && Date.now() - hiddenAt >= AWAY_MS) opened(true);
    hiddenAt = 0;
  });

  window.addEventListener(GOAL_MET_EVENT, e => {
    track('goal_met', { goal: getGoal(), minutes: (e as CustomEvent<{ minutes: number }>).detail?.minutes });
  });
}
