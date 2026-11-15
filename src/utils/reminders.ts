// Practice reminders, scheduled on the phone (Android only; no server).
//
// The research this follows:
// - A plan tied to a moment ("after dinner I'll practise") roughly doubles
//   follow-through (Gollwitzer & Sheeran, 2006). So the first ask is "when
//   do you usually practise?", and reminders come at that moment.
// - A message loses its pull each time it is sent and gets it back after a
//   rest (Yancey & Settles, 2020, Duolingo). So there are several, built from
//   your own songs, chords and streak, and none repeats within 5 days.
// - Pointing at a broken streak drives people away (Silverman & Barasch,
//   2023). No message ever says a streak was lost. A repair is offered, or a
//   fresh start on a Monday or the 1st (Dai, Milkman & Riis, 2014).
// - Reminders that go ignored get notifications turned off for good. Days
//   1, 2, 3, 5 and 7 ahead are scheduled; the 7th says it is the last, and
//   then nothing until you open the app, which starts the count again.

import { LocalNotifications } from '@capacitor/local-notifications';
import { IS_NATIVE } from './nativeShell';
import { GOAL_MET_EVENT, getGoal, secondsOn } from './practiceClock';
import { getSongs, shiftIso, streakRepair, streakState, today } from './library';
import { getChordSkills } from './chordbook';
import { TIERED, heldTier, nextStep } from './feats';
import { suggestDrill } from './suggest';

const KEY = 'cadenza-reminders';
const LOG_KEY = 'cadenza-reminder-log';
const TIMES_KEY = 'cadenza-goal-times';
const CHANGE = 'cadenza-reminders-change';

export const SLOTS = [
  { value: '08:00', label: 'Morning' },
  { value: '13:00', label: 'Lunch' },
  { value: '18:00', label: 'After work' },
  { value: '20:30', label: 'Evening' }
] as const;

export interface ReminderSettings {
  on: boolean;
  /** "HH:MM", or null to use the time you usually practise. */
  time: string | null;
  /** The "streak ends tonight" warning. */
  warn: boolean;
  /** The first ask has been made. */
  asked: boolean;
}

interface Log {
  /** Template used for each date, so rescheduling keeps the same message. */
  assigned: Record<string, string>;
  /** When each template was last used. */
  lastUsed: Record<string, string>;
  /** Pending notification times, to count which went out. */
  pending: number[];
  sent: number;
  opened: number;
}

const read = <T,>(key: string, fallback: T): T => {
  try { const v = localStorage.getItem(key); return v ? { ...fallback, ...JSON.parse(v) } as T : fallback; } catch { return fallback; }
};
const write = (key: string, v: unknown) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* this session */ } };

export const getReminders = (): ReminderSettings =>
  read<ReminderSettings>(KEY, { on: false, time: null, warn: true, asked: false });
export const reminderStats = (): { sent: number; opened: number } => {
  const l = read<Log>(LOG_KEY, { assigned: {}, lastUsed: {}, pending: [], sent: 0, opened: 0 });
  return { sent: l.sent + l.pending.filter(t => t < Date.now()).length, opened: l.opened };
};
export const CAN_REMIND = IS_NATIVE;
export const subscribeReminders = (cb: () => void) => {
  window.addEventListener(CHANGE, cb);
  return () => window.removeEventListener(CHANGE, cb);
};

export async function setReminders(patch: Partial<ReminderSettings>): Promise<boolean> {
  const next = { ...getReminders(), ...patch };
  if (patch.on && IS_NATIVE) {
    const perm = await LocalNotifications.requestPermissions().catch(() => ({ display: 'denied' as const }));
    if (perm.display !== 'granted') next.on = false;
  }
  write(KEY, next);
  window.dispatchEvent(new Event(CHANGE));
  void schedule();
  return next.on;
}

// ---- The usual time ----------------------------------------------------------

/** When the daily goal was met, minutes after midnight, the last 14 times. */
function noteGoalTime(): void {
  const d = new Date();
  const times = read<{ t: number[] }>(TIMES_KEY, { t: [] }).t;
  write(TIMES_KEY, { t: [...times, d.getHours() * 60 + d.getMinutes()].slice(-14) });
}

/** The reminder time: the chosen one, or a little before you usually finish. */
function reminderMinutes(s: ReminderSettings): number {
  if (s.time) { const [h, m] = s.time.split(':').map(Number); return h * 60 + m; }
  const t = [...read<{ t: number[] }>(TIMES_KEY, { t: [] }).t].sort((a, b) => a - b);
  if (t.length < 3) return 19 * 60;
  const median = t[Math.floor(t.length / 2)];
  return Math.max(7 * 60, Math.min(21 * 60, median - getGoal() - 15));
}

// ---- What to say ---------------------------------------------------------------

interface Message { id: string; title: string; body: string }

function candidates(date: string): Message[] {
  const goal = getGoal();
  const s = streakState();
  const out: Message[] = [];
  const repair = streakRepair();
  if (repair) out.push({ id: 'repair', title: `Your ${repair.lost}-day streak can come back`, body: `Play ${goal * 2} minutes today and it counts as unbroken.` });
  if (s.current >= 2) out.push({ id: 'streak', title: `${s.current} days in a row`, body: `${goal} minutes today keeps it going.` });
  const d = new Date(`${date}T12:00:00`);
  if (s.current === 0 && (d.getDay() === 1 || d.getDate() === 1)) {
    out.push({ id: 'fresh', title: d.getDate() === 1 ? 'New month, fresh start' : 'New week, fresh start', body: `${goal} minutes today is a good first step.` });
  }
  const song = getSongs().find(x => x.status === 'learning');
  if (song) out.push({ id: 'song', title: song.title, body: `Ready when you are. ${goal} minutes of play along?` });
  const shaky = getChordSkills().find(c => c.comfort === 'shaky');
  if (shaky) out.push({ id: 'shaky', title: `${shaky.label ?? shaky.id} is still Shaky`, body: 'Two minutes on it today?' });
  const drill = suggestDrill();
  if (drill && drill.last) out.push({ id: 'drill', title: drill.drill.label, body: `${drill.said}. One short go?` });
  const close = TIERED.map(b => ({ b, step: nextStep(b) })).filter(x => x.step && heldTier(x.b.id) > 0)[0];
  if (close?.step) out.push({ id: 'badge', title: close.b.name, body: `Next pick: ${close.step}.` });
  out.push({ id: 'plain', title: 'Time to play', body: `${goal} minutes, any song or drill.` });
  return out;
}

/** The message for a date: the one already chosen, or one not used in 5 days. */
function messageFor(date: string, log: Log): Message {
  const all = candidates(date);
  const kept = all.find(m => m.id === log.assigned[date]);
  if (kept) return kept;
  const cool = (m: Message) => { const u = log.lastUsed[m.id]; return !u || u <= shiftIso(date, -5); };
  const m = all.find(cool) ?? [...all].sort((a, b) => (log.lastUsed[a.id] ?? '') < (log.lastUsed[b.id] ?? '') ? -1 : 1)[0];
  log.assigned[date] = m.id;
  log.lastUsed[m.id] = date;
  return m;
}

// ---- Scheduling ------------------------------------------------------------------

const DAYS_AHEAD = [0, 1, 2, 4, 6];
const LAST = 6;

const at = (date: string, minutes: number) => {
  const d = new Date(`${date}T00:00:00`);
  d.setMinutes(minutes);
  return d;
};

let scheduling: Promise<void> | null = null;
export function schedule(): Promise<void> {
  if (!IS_NATIVE) return Promise.resolve();
  scheduling = (scheduling ?? Promise.resolve()).then(doSchedule).catch(() => { /* try next time */ });
  return scheduling;
}

async function doSchedule(): Promise<void> {
  const pending = await LocalNotifications.getPending();
  if (pending.notifications.length) await LocalNotifications.cancel({ notifications: pending.notifications.map(n => ({ id: n.id })) });

  const log = read<Log>(LOG_KEY, { assigned: {}, lastUsed: {}, pending: [], sent: 0, opened: 0 });
  log.sent += log.pending.filter(t => t < Date.now()).length;
  log.pending = [];

  const s = getReminders();
  if (!s.on) { write(LOG_KEY, log); return; }

  const now = Date.now();
  const day = today();
  const goalMet = secondsOn(day) >= getGoal() * 60;
  const mins = reminderMinutes(s);
  const list: { id: number; title: string; body: string; schedule: { at: Date; allowWhileIdle: boolean } }[] = [];

  for (const ahead of DAYS_AHEAD) {
    const date = shiftIso(day, ahead);
    const when = at(date, mins);
    if (ahead === 0 && (goalMet || when.getTime() < now + 5 * 60000)) continue;
    const m = ahead === LAST
      ? { title: 'We will stop reminding you', body: 'Your songs are here whenever you want them.' }
      : messageFor(date, log);
    list.push({ id: 100 + ahead, title: m.title, body: m.body, schedule: { at: when, allowWhileIdle: true } });
  }

  // "Ends tonight", only when a streak worth keeping has no rest to cover it.
  if (s.warn) {
    const st = streakState();
    const warnAt = Math.min(22 * 60 + 30, Math.max(21 * 60, mins + 120));
    if (st.rests === 0) {
      const tonight = at(day, warnAt);
      if (!st.playedToday && st.current >= 3 && tonight.getTime() > now) {
        list.push({ id: 200, title: `Your ${st.current}-day streak ends at midnight`, body: `${getGoal()} minutes keeps it.`, schedule: { at: tonight, allowWhileIdle: true } });
      }
      if (st.playedToday && st.current >= 3) {
        list.push({ id: 201, title: `Your ${st.current}-day streak ends at midnight`, body: `${getGoal()} minutes keeps it.`, schedule: { at: at(shiftIso(day, 1), warnAt), allowWhileIdle: true } });
      }
    }
  }

  // Forget assignments for days gone by.
  for (const d of Object.keys(log.assigned)) if (d < day) delete log.assigned[d];
  log.pending = list.map(n => n.schedule.at.getTime());
  write(LOG_KEY, log);
  if (list.length) await LocalNotifications.schedule({ notifications: list });
}

let wired = false;
export function initReminders(): void {
  if (wired || !IS_NATIVE) return;
  wired = true;
  window.addEventListener(GOAL_MET_EVENT, () => { noteGoalTime(); void schedule(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void schedule(); });
  void LocalNotifications.addListener('localNotificationActionPerformed', () => {
    const log = read<Log>(LOG_KEY, { assigned: {}, lastUsed: {}, pending: [], sent: 0, opened: 0 });
    log.opened++;
    write(LOG_KEY, log);
  });
  void schedule();
}
