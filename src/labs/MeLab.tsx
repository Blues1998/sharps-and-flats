import React, { useRef, useState, useSyncExternalStore } from 'react';
import { LabIcon } from '../components/LabIcon';
import { Segmented } from '../components/Segmented';
import { TrophyShelf } from '../components/TrophyShelf';
import { useLibrary } from '../hooks/useLibrary';
import { exportLibrary, getSongs, importLibrary, isoDate, practiceStats } from '../utils/library';
import { saveTextFile } from '../utils/saveFile';
import { CAN_REMIND, SLOTS, getReminders, reminderStats, setReminders, subscribeReminders } from '../utils/reminders';
import { totalXp } from '../utils/xp';
import { GOAL_CHOICES, getGoal, setGoal } from '../utils/practiceClock';
import { BrandMark, PRIVACY_URL } from '../components/Brand';
import { audio } from '../utils/audio';
import { voicingsFor } from '../utils/chordbook';
import { setSunburst, useSunburst } from '../utils/sunburst';
import { useAuth } from '../context/AuthContext';
import { ACCOUNTS_ENABLED } from '../utils/nativeShell';
import { HAS_HAPTICS, setHaptics, useHaptics } from '../utils/haptics';
import { go } from '../hooks/useRoute';
import type { Theme } from '../hooks/useTheme';
import { restartOnboarding, setProfile, useProfile, type ProfileInstrument } from '../utils/profile';
import { prettyNote, setVoice, useVoice, type Notation } from '../utils/voice';

// You: your account, and the handful of settings that shape the rest of the
// app. On a phone this is also where the theme switch and sign-in live, now
// that the tab bar has no room for a "More".

// Everything the app ships that someone else made, and the terms it came on.
const CREDITS: { name: string; what: string; licence: string }[] = [
  { name: 'Meta Open Sound', what: 'Nylon and steel guitar recordings', licence: 'CC0, public domain' },
  { name: 'FreePats', what: 'Electric guitar recordings', licence: 'CC0, public domain' },
  { name: 'Sonivox EAS', what: 'Backing instrument sounds in the Tab Player', licence: 'Apache License 2.0' },
  { name: 'alphaTab', what: 'Tab rendering and playback, unmodified, source at github.com/CoderLine/alphaTab', licence: 'Mozilla Public License 2.0' },
  { name: 'Bravura', what: 'Music notation font', licence: 'SIL Open Font License 1.1' },
  { name: 'Geist, Space Grotesk, JetBrains Mono', what: 'Typefaces', licence: 'SIL Open Font License 1.1' },
  { name: 'React', what: 'Interface library', licence: 'MIT License' },
  { name: 'Capacitor', what: 'Android app shell', licence: 'MIT License' },
  { name: 'Supabase JS', what: 'Account backup on the website', licence: 'MIT License' }
].filter(c => ACCOUNTS_ENABLED || c.name !== 'Supabase JS');

// What the mark in About plays, one per tap, round and round. Open, ringing
// shapes, the kind a guitar sounds best on, ending on Hendrix's.
const MARK_CHORDS = ['E', 'Am', 'Cadd9', 'D/F#', 'G', 'Em7', 'A7sus4', 'Dsus2', 'E7#9'];

/** The ♯♭ mark as an instrument: every tap strums the next chord. */
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Back up to a file and restore from one: rare, so here rather than on Songs. */
const YourData: React.FC = () => {
  const ready = useLibrary();
  const [notice, setNotice] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const count = ready ? getSongs().length : 0;

  const backUp = async () => {
    const result = await saveTextFile(
      `sharps-and-flats-library-${isoDate()}.json`,
      JSON.stringify(exportLibrary(), null, 2),
      'application/json'
    );
    if (result === 'cancelled') return;
    setNotice(result === 'failed'
      ? 'Could not save the backup. Try again.'
      : `Backed up ${plural(count, 'song')} and ${plural(practiceStats().sessionCount, 'practice session')}.`);
  };

  const restore = async (file: File) => {
    const result = await importLibrary(await file.text());
    setNotice(result.ok
      ? `Restored ${plural(result.songs ?? 0, 'song')} and ${plural(result.sessions ?? 0, 'practice session')}.`
      : result.message);
  };

  return (
    <section className="glass-panel me-card me-settings">
      <h3 className="me-heading">Your data</h3>
      <div className="me-row">
        <span className="me-row-label">
          Back up
          <span className="me-row-sub">Save your songs and progress to a file</span>
        </span>
        <button type="button" className="btn" onClick={() => void backUp()} disabled={count === 0}>Save file</button>
      </div>
      <div className="me-row">
        <span className="me-row-label">
          Restore
          <span className="me-row-sub">Load a backup from another phone</span>
        </span>
        <button type="button" className="btn" onClick={() => fileInput.current?.click()} disabled={!ready}>Open file</button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={e => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void restore(file);
          }}
        />
      </div>
      {notice && <p className="me-notice" role="status">{notice}</p>}
    </section>
  );
};

/** Practice reminders: Android only, since they are scheduled on the phone. */
const Reminders: React.FC = () => {
  const s = useSyncExternalStore(subscribeReminders, () => JSON.stringify(getReminders()));
  const r = JSON.parse(s) as ReturnType<typeof getReminders>;
  const stats = reminderStats();
  if (!CAN_REMIND) return null;
  return (
    <section className="glass-panel me-card me-settings">
      <h3 className="me-heading">Reminders</h3>
      <div className="me-row">
        <span className="me-row-label">
          Practice reminder
          <span className="me-row-sub">{r.on ? (stats.sent ? `${stats.sent} sent · ${stats.opened} opened` : 'One a day, only if you have not played') : 'Off'}</span>
        </span>
        <Segmented<boolean>
          value={r.on}
          onChange={on => void setReminders({ on, asked: true })}
          options={[{ value: true, label: 'On' }, { value: false, label: 'Off' }]}
          size="sm"
        />
      </div>
      {r.on && (
        <>
          <div className="me-row">
            <span className="me-row-label">
              When
              <span className="me-row-sub">Auto learns when you usually play</span>
            </span>
            <select
              className="select-field me-select"
              value={r.time ?? 'auto'}
              onChange={e => void setReminders({ time: e.target.value === 'auto' ? null : e.target.value })}
            >
              <option value="auto">Auto</option>
              {SLOTS.map(x => <option key={x.value} value={x.value}>{x.label} ({x.value})</option>)}
            </select>
          </div>
          <div className="me-row">
            <span className="me-row-label">
              Streak warning
              <span className="me-row-sub">At night, if a 3+ day streak is about to end</span>
            </span>
            <Segmented<boolean>
              value={r.warn}
              onChange={warn => void setReminders({ warn })}
              options={[{ value: true, label: 'On' }, { value: false, label: 'Off' }]}
              size="sm"
            />
          </div>
        </>
      )}
    </section>
  );
};

const PlayableMark: React.FC = () => {
  const turn = useRef(0);
  const [shown, setShown] = useState<{ chord: string; key: number } | null>(null);
  const strum = () => {
    const chord = MARK_CHORDS[turn.current % MARK_CHORDS.length];
    turn.current++;
    const v = voicingsFor(chord)[0];
    if (v) audio.playStrum(v.midis);
    setShown({ chord, key: turn.current });
  };
  return (
    <button type="button" className="me-mark" onClick={strum} aria-label="Play a chord">
      <BrandMark key={shown?.key ?? 0} className={shown ? 'is-struck' : undefined} />
      {shown && <span key={`chord-${shown.key}`} className="me-mark-chord readout" aria-live="polite">{shown.chord}</span>}
    </button>
  );
};

interface MeLabProps {
  theme: Theme;
  toggleTheme: () => void;
}

export const MeLab: React.FC<MeLabProps> = ({ theme, toggleTheme }) => {
  const { user, openAuthModal, syncStatus, lastSyncedAt } = useAuth();
  const profile = useProfile();
  const voice = useVoice();
  const haptics = useHaptics();
  const sunburst = useSunburst();
  const [goal, setGoalState] = useState(getGoal);

  const toVoiceRange = () => {
    try { localStorage.setItem('cadenza-tuner-mode', 'voice'); } catch { /* fine */ }
    go({ tab: 'tuner', songId: null });
  };

  const synced = lastSyncedAt ? new Date(lastSyncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;

  return (
    <div className="lab-narrow me">
      <div className="lab-header">
        <h2 className="lab-title"><LabIcon tab="me" />Me</h2>
      </div>

      {ACCOUNTS_ENABLED && <section className="glass-panel me-card">
        <div className="me-account">
          <span className={`me-avatar${user ? ' is-in' : ''}`} aria-hidden="true">
            {user?.email ? user.email.charAt(0).toUpperCase() : '?'}
          </span>
          <div className="me-account-text">
            <span className="me-account-name">{user ? user.email : 'Not signed in'}</span>
            <span className="me-account-sub">
              {user
                ? syncStatus === 'syncing' ? 'Syncing…' : syncStatus === 'error' ? 'Sync failed. Retrying.' : synced ? `Backed up at ${synced}` : 'Backed up'
                : 'Songs are saved on this device only'}
            </span>
          </div>
        </div>
        <button type="button" className={`btn${user ? '' : ' btn-primary'}`} onClick={openAuthModal}>
          {user ? 'Account & sync' : 'Sign in to back up'}
        </button>
      </section>}

      <TrophyShelf />
      {totalXp() > 0 && <p className="me-xp readout">{totalXp()} XP earned in all</p>}

      <Reminders />

      <section className="glass-panel me-card me-settings">
        <h3 className="me-heading">Preferences</h3>

        <div className="me-row">
          <span className="me-row-label">Instrument</span>
          <Segmented<ProfileInstrument>
            value={profile.instrument}
            onChange={instrument => setProfile({ instrument })}
            options={[{ value: 'guitar', label: 'Guitar' }, { value: 'ukulele', label: 'Ukulele' }]}
            size="sm"
          />
        </div>

        <div className="me-row">
          <span className="me-row-label">
            Daily goal
            <span className="me-row-sub">Counted while you play, sing or drill</span>
          </span>
          <Segmented<number>
            value={goal}
            onChange={g => { setGoal(g); setGoalState(g); }}
            options={GOAL_CHOICES.map(g => ({ value: g, label: `${g} min` }))}
            size="sm"
          />
        </div>

        <div className="me-row">
          <span className="me-row-label">Note names</span>
          <Segmented<Notation>
            value={voice.notation}
            onChange={notation => setVoice({ notation })}
            options={[{ value: 'names', label: 'C D E' }, { value: 'sargam', label: 'Sa Re Ga' }]}
            size="sm"
          />
        </div>

        <div className="me-row">
          <span className="me-row-label">Theme</span>
          <Segmented<Theme>
            value={theme}
            onChange={next => { if (next !== theme) toggleTheme(); }}
            options={[{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }]}
            size="sm"
          />
        </div>

        {sunburst.earned && (
          <div className="me-row">
            <span className="me-row-label">
              Finish
              <span className="me-row-sub">Earned with a 7 day streak</span>
            </span>
            <Segmented<boolean>
              value={sunburst.on}
              onChange={setSunburst}
              options={[{ value: false, label: 'Classic' }, { value: true, label: 'Sunburst' }]}
              size="sm"
            />
          </div>
        )}

        {HAS_HAPTICS && (
          <div className="me-row">
            <span className="me-row-label">Haptics</span>
            <Segmented<boolean>
              value={haptics}
              onChange={setHaptics}
              options={[{ value: true, label: 'On' }, { value: false, label: 'Off' }]}
              size="sm"
            />
          </div>
        )}

        <div className="me-row">
          <span className="me-row-label">
            Your voice
            <span className="me-row-sub">
              {voice.range ? `${prettyNote(voice.range.low)} to ${prettyNote(voice.range.high)}` : 'Not measured'}
            </span>
          </span>
          <button type="button" className="btn" onClick={toVoiceRange}>{voice.range ? 'Measure again' : 'Find my range'}</button>
        </div>
      </section>

      <YourData />

      <section className="glass-panel me-card">
        <div className="me-account-text">
          <span className="me-account-name">Welcome setup</span>
          <span className="me-account-sub">Instrument, level and songs</span>
        </div>
        <button type="button" className="btn" onClick={restartOnboarding}>Run it again</button>
      </section>

      <section className="glass-panel me-card me-settings">
        <h3 className="me-heading">About</h3>
        <div className="me-row me-about">
          <PlayableMark />
          <span className="me-row-label">
            Sharps&amp;Flats
            <span className="me-row-sub">Version {__APP_VERSION__}</span>
          </span>
        </div>
        <div className="me-row">
          <span className="me-row-label">
            Privacy
            <span className="me-row-sub">Everything stays on this device</span>
          </span>
          <a className="btn" href={PRIVACY_URL} target="_blank" rel="noreferrer">Read policy</a>
        </div>
      </section>

      {/* Owed to the people whose work ships inside the app, and kept out of
          the way: one small line under everything else. */}
      <details className="me-licences">
        <summary>Open-source licences</summary>
        <dl>
          {CREDITS.map(c => (
            <div key={c.name}>
              <dt>{c.name}</dt>
              <dd>{c.what}. {c.licence}.</dd>
            </div>
          ))}
        </dl>
      </details>
    </div>
  );
};

export default MeLab;
