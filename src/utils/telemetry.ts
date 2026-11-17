// Anonymous usage and crash reports, from the Android app only.
//
// Two services, each doing the one thing it is good at:
//
//   Sentry    crashes: every error that reaches trouble.ts's record(), plus
//             native Android crashes, with the app version and the screen
//   PostHog   what people do: the events listed in EventName below
//
// Both stay off unless the build carries their keys (.env.android.local, see
// .env.android.example) and the player has "Share usage and crash reports" on
// in Me. It is on by default and turning it off stops both at once. The
// website never loads either SDK: they are imported on demand, and only here.
//
// What leaves the phone: the event names and small properties below, the app
// version, the phone model and Android version, and a random id PostHog makes
// for this install. Never names, emails, song titles, typed text or audio.
// Screen addresses are cut down to the screen's name, because a song's
// address carries its title.

import { useSyncExternalStore } from 'react';
import { IS_NATIVE } from './nativeShell';

// ---- The events ------------------------------------------------------------------
//
// Every event the app sends, in one place. Add one here before sending it.

export type EventName =
  // Daily habit
  | 'app_opened'            // streak, goal, minutes_today, days_since_install, returning
  | 'screen_viewed'         // screen
  | 'goal_met'              // goal, minutes
  | 'goal_set'              // minutes
  | 'goal_bump_offered'     // from, to, why
  | 'goal_bump_answered'    // from, to, why, yes
  | 'reminders_set'         // on, granted
  | 'reminder_opened'       // kind
  // Lessons and songs
  | 'lesson_started'        // lesson, kind
  | 'exercise_answered'     // lesson, step, type, ok, attempt
  | 'lesson_finished'       // lesson, kind, stars, complete, secs, wrong
  | 'lesson_quit'           // lesson, kind, step, of
  | 'play_mode_set'         // screen
  | 'song_take'             // lesson, score, hits, short, total, screen, restarts
  | 'song_restarted'        // lesson, at, screen
  // Games and tools
  | 'game_started'          // game
  | 'game_finished'         // game, score, level, secs, best
  | 'practice_session'      // what, secs
  // Setup and permissions
  | 'onboarding_step'       // step
  | 'onboarding_done'       // then, instrument, sings, level, songs_added
  | 'instrument_set'        // instrument
  | 'permission';           // what, granted

export type Props = Record<string, string | number | boolean | null | undefined>;

// ---- The switch ------------------------------------------------------------------

const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined;
const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
const POSTHOG_HOST = (import.meta.env.VITE_POSTHOG_HOST as string | undefined) || 'https://eu.i.posthog.com';

/** True when this build can send anything at all: the Android app, built with keys. */
export const TELEMETRY_AVAILABLE = IS_NATIVE && !!(SENTRY_DSN || POSTHOG_KEY);

const SETTING_KEY = 'cadenza-share-usage';
const INSTALL_KEY = 'cadenza-installed-on';

function readSetting(): boolean {
  try { return localStorage.getItem(SETTING_KEY) !== 'off'; } catch { return true; }
}

let on = readSetting();
const listeners = new Set<() => void>();

export const telemetryOn = (): boolean => TELEMETRY_AVAILABLE && on;

export function setTelemetry(next: boolean): void {
  if (next === on) return;
  on = next;
  try { localStorage.setItem(SETTING_KEY, next ? 'on' : 'off'); } catch { /* this session */ }
  listeners.forEach(l => l());
  if (next) {
    void initTelemetry();
    posthog?.opt_in_capturing();
  } else {
    queue = [];
    crashQueue = [];
    posthog?.opt_out_capturing();
    // Stops the native side too; it starts again with the next init.
    void sentry?.close();
    sentry = null;
    sentryStarted = false;
  }
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const useTelemetrySetting = (): boolean => useSyncExternalStore(subscribe, () => on);

/** Whole days since this install first ran, counted from the first launch with this code. */
export function daysSinceInstall(): number {
  try {
    let first = localStorage.getItem(INSTALL_KEY);
    if (!first) { first = new Date().toISOString().slice(0, 10); localStorage.setItem(INSTALL_KEY, first); }
    return Math.max(0, Math.floor((Date.now() - new Date(`${first}T00:00:00`).getTime()) / 86_400_000));
  } catch { return 0; }
}

// ---- Privacy filters ---------------------------------------------------------------

/** An address cut down to its screen: "#/songs/wonderwall" becomes "#/songs". */
export function screenOnly(url: string | undefined): string | undefined {
  if (!url) return url;
  const hash = url.indexOf('#');
  const base = hash >= 0 ? url.slice(0, hash) : url;
  const first = hash >= 0 ? url.slice(hash + 1).split('/').filter(Boolean)[0] : '';
  return first ? `${base}#/${first}` : base;
}

// ---- Sending -----------------------------------------------------------------------

type PostHog = typeof import('posthog-js').default;
type SentryApi = typeof import('@sentry/capacitor');

let posthog: PostHog | null = null;
let sentry: SentryApi | null = null;
let posthogStarted = false;
let sentryStarted = false;
/** Events and errors from before the SDKs finished loading, sent once they have. */
let queue: [EventName, Props][] = [];
let crashQueue: [unknown, string, string][] = [];
let context: Props = {};

/** Start both services, if this build and this player allow it. Safe to call again. */
export async function initTelemetry(): Promise<void> {
  if (!telemetryOn()) return;
  await Promise.all([startSentry(), startPostHog()]).catch(() => { /* never let reporting break the app */ });
}

async function startSentry(): Promise<void> {
  if (!SENTRY_DSN || sentryStarted) return;
  sentryStarted = true;
  const [S, R] = await Promise.all([import('@sentry/capacitor'), import('@sentry/react')]);
  if (!telemetryOn()) { sentryStarted = false; return; }
  S.init({
    dsn: SENTRY_DSN,
    release: `sharps-and-flats@${__APP_VERSION__}`,
    environment: import.meta.env.DEV ? 'development' : 'production',
    sendDefaultPii: false,
    tracesSampleRate: 0,
    // trouble.ts already catches window errors and loose promises, and hands
    // each one to captureCrash() once; Sentry's own handlers would send twice.
    integrations: defaults => defaults.filter(i => i.name !== 'GlobalHandlers'),
    beforeBreadcrumb: crumb => {
      // A navigation crumb carries the full address; screen_viewed says the same without the song.
      if (crumb.category === 'navigation') return null;
      return crumb;
    },
    beforeSend: event => {
      if (!telemetryOn()) return null;
      if (event.request?.url) event.request.url = screenOnly(event.request.url);
      return event;
    },
  }, R.init);
  sentry = S;
  for (const [error, where, kind] of crashQueue) sendCrash(error, where, kind);
  crashQueue = [];
}

async function startPostHog(): Promise<void> {
  if (!POSTHOG_KEY || posthogStarted) return;
  posthogStarted = true;
  const { default: ph } = await import('posthog-js');
  if (!telemetryOn()) { posthogStarted = false; return; }
  ph.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    persistence: 'localStorage',
    // Only the events this file names: no automatic clicks, page views,
    // recordings, surveys or scripts fetched from PostHog at run time.
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    capture_performance: false,
    capture_heatmaps: false,
    capture_dead_clicks: false,
    capture_exceptions: false,
    rageclick: false,
    disable_session_recording: true,
    disable_surveys: true,
    disable_product_tours: true,
    disable_conversations: true,
    disable_web_experiments: true,
    disable_external_dependency_loading: true,
    advanced_disable_flags: true,
    save_referrer: false,
    person_profiles: 'identified_only',
    before_send: event => {
      if (!event) return event;
      const p = event.properties;
      for (const k of ['$current_url', '$referrer', '$initial_current_url', '$initial_referrer']) {
        if (typeof p[k] === 'string') p[k] = screenOnly(p[k] as string);
      }
      for (const k of ['$pathname', '$initial_pathname']) delete p[k];
      return event;
    },
  });
  ph.register({ platform: 'android', app_version: __APP_VERSION__, ...clean(context) });
  posthog = ph;
  for (const [name, props] of queue) ph.capture(name, props);
  queue = [];
}

const clean = (props: Props): Record<string, string | number | boolean | null> => {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(props)) if (v !== undefined) out[k] = v;
  return out;
};

/** Record one thing the player did. Does nothing on the website, without keys, or with the switch off. */
export function track(name: EventName, props: Props = {}): void {
  if (!telemetryOn()) return;
  const p = clean(props);
  // The same trail goes to Sentry, so a crash report shows what led up to it.
  sentry?.addBreadcrumb({ category: 'event', message: name, data: p, level: 'info' });
  if (posthog) posthog.capture(name, p);
  else if (POSTHOG_KEY && queue.length < 100) queue.push([name, p]);
}

const sentOnce = new Set<string>();
/** The same event with the same properties at most once per launch, such as a permission answer. */
export function trackOnce(name: EventName, props: Props = {}): void {
  const key = `${name} ${JSON.stringify(props)}`;
  if (sentOnce.has(key)) return;
  sentOnce.add(key);
  track(name, props);
}

/** How a microphone request went: said yes, said no, or the mic was busy or missing. Once per launch each. */
export function micAnswered(error?: unknown): void {
  const name = error instanceof Error || error instanceof DOMException ? error.name : '';
  const result = error === undefined ? 'granted' : name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unavailable';
  trackOnce('permission', { what: 'mic', granted: result === 'granted', result });
}

/** Properties sent with every event from now on, such as the instrument. */
export function setTelemetryContext(props: Props): void {
  context = { ...context, ...props };
  posthog?.register(clean(props));
  sentry?.setTags(clean(props) as Record<string, string | number | boolean>);
}

/** An error trouble.ts has caught and logged. `kind` is describe()'s reading of it. */
export function captureCrash(error: unknown, where: string, kind: string): void {
  if (!telemetryOn() || !SENTRY_DSN) return;
  if (sentry) sendCrash(error, where, kind);
  else if (crashQueue.length < 20) crashQueue.push([error, where, kind]);
}

function sendCrash(error: unknown, where: string, kind: string): void {
  sentry?.withScope(scope => {
    scope.setTag('where', where);
    scope.setTag('kind', kind);
    // A microphone the player said no to is a choice, not a bug: keep it, quietly.
    scope.setLevel(kind === 'bug' || kind === 'memory' ? 'error' : 'warning');
    sentry?.captureException(error instanceof Error ? error : new Error(typeof error === 'string' ? error : JSON.stringify(error)));
  });
}
