// The Journey step you are following, for this visit only. See JourneyBar.

const KEY = 'cadenza-journey-step';
export const STEP_CHANGE = 'cadenza-journey-step-change';

const read = (): string | null => {
  try { return sessionStorage.getItem(KEY); } catch { return null; }
};

/** The Journey step being followed, if any. */
export const followedStep = (): string | null => read();

/** Journey calls this when you press a step's button. */
export function followStep(levelId: string | null): void {
  try {
    if (levelId) sessionStorage.setItem(KEY, levelId); else sessionStorage.removeItem(KEY);
  } catch { /* this visit only */ }
  window.dispatchEvent(new Event(STEP_CHANGE));
}

