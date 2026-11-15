import React, { useEffect, useMemo, useState } from 'react';
import { LabIcon } from '../components/LabIcon';
import { Segmented } from '../components/Segmented';
import { SongPage } from './SongPage';
import { useLibrary } from '../hooks/useLibrary';
import { go } from '../hooks/useRoute';
import {
  createSong,
  getSong,
  getSongs,
  practiceStats,
  songChords,
  STATUS_LABEL,
  STATUS_ORDER,
  totalMinutes
} from '../utils/library';
import type { SongStatus } from '../utils/library';
import { capoLabel, parseCapo } from '../utils/songText';
import { feel } from '../utils/haptics';

interface SongsLabProps {
  focusSongId: string | null;
  /** Open a song, or (null) go back to the list. `replace` for a correction
   *  rather than a move, see the dead-link effect below. */
  onOpenSong: (id: string | null, replace?: boolean) => void;
  /** Set when Home sent you here to write a new song down. */
  openDraft?: boolean;
  onDraftOpened?: () => void;
}

type Filter = 'all' | SongStatus | 'revisit';

/** Filters show once the list is long enough to need them. */
const FILTER_FROM = 6;

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  ...STATUS_ORDER.map(s => ({ value: s as Filter, label: STATUS_LABEL[s] })),
  { value: 'revisit', label: 'Revisit' }
];

const blankDraft = () => ({
  title: '',
  artist: '',
  key: '',
  capo: '',
  chordsRaw: '',
  strumming: '',
  practiceMinutes: '',
  confidence: '0'
});

export const SongsLab: React.FC<SongsLabProps> = ({ focusSongId, onOpenSong, openDraft, onDraftOpened }) => {
  const ready = useLibrary();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [draft, setDraft] = useState<ReturnType<typeof blankDraft> | null>(null);

  const stats = practiceStats();
  const songs = getSongs();

  // Opening or closing a song is a page change inside one tab, so the window's
  // scroll offset survives it, from halfway down a long list you would land
  // halfway down the song, with its title above the fold. App.tsx does this for
  // tab changes and cannot see this one.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [focusSongId]);

  // Arriving from Home's empty state: open the form, then hand the intent back
  // so a later re-render does not reopen it over something you have since typed.
  useEffect(() => {
    if (!openDraft) return;
    setDraft(blankDraft());
    onDraftOpened?.();
  }, [openDraft, onDraftOpened]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return songs
      .filter(song => {
        const f = songs.length >= FILTER_FROM ? filter : 'all';
        if (f === 'revisit' ? !song.revisit : f !== 'all' && song.status !== f) return false;
        if (!q) return true;
        // The parsed chords as well as the raw line: the row shows "Am · Em",
        // so searching "Am" has to find a song whose sheet says "A min".
        return [song.title, song.artist, song.key, song.chordsRaw, songChords(song).join(' ')]
          .some(field => field.toLowerCase().includes(q));
      })
      // Sequence in original workbook order, with any newer songs naturally placed
      .sort((a, b) => {
        if (a.day && b.day) return a.day - b.day;
        if (a.day) return -1;
        if (b.day) return 1;
        return a.title.localeCompare(b.title);
      });
  }, [songs, query, filter]);

  const focused = focusSongId ? getSong(focusSongId) : undefined;

  // A link to a song that is no longer here, deleted, or carried over from
  // someone else's library, lands on the list. The address is corrected with
  // it so the bar agrees with the screen and a reload does not try the dead id
  // again; replaced rather than pushed, or Back would walk straight into it.
  // Only once the library is open: until then every id is unresolved.
  useEffect(() => {
    if (ready && focusSongId && !focused) onOpenSong(null, true);
  }, [ready, focusSongId, focused, onOpenSong]);

  const submitDraft = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft || !draft.title.trim()) return;
    feel('success');
    const song = await createSong({
      title: draft.title,
      artist: draft.artist,
      key: draft.key,
      capo: parseCapo(draft.capo),
      chordsRaw: draft.chordsRaw,
      strumming: draft.strumming,
      practiceMinutes: Number(draft.practiceMinutes) || 0,
      confidence: Number(draft.confidence) || 0
    });
    setDraft(null);
    onOpenSong(song.id);
  };

  if (focused) return <SongPage song={focused} onBack={() => onOpenSong(null)} />;

  if (!ready) {
    return <div className="songs-loading readout">Opening your library…</div>;
  }

  return (
    <div className="songs">
      <header className="songs-head">
        <div>
          <h2 className="lab-title"><LabIcon tab="library" />Songs</h2>
          <p className="songs-count readout">
            <strong>{songs.length}</strong> {songs.length === 1 ? 'song' : 'songs'}
            {songs.length > 0 && (
              <span className="songs-count-sub">
                {stats.songsComplete} complete{stats.totalMinutes > 0 && ` · ${stats.totalMinutes} min logged`}
              </span>
            )}
          </p>
        </div>
        <div className="songs-actions">
          <button type="button" className="btn btn-primary" onClick={() => setDraft(blankDraft())}>
            Add song
          </button>
        </div>
      </header>

      {draft && (
        <form className="song-draft" onSubmit={e => void submitDraft(e)}>
          <div className="surface-label"><span>New song</span></div>
          <div className="draft-grid">
            <label className="song-field draft-title">
              <span className="field-label">Title</span>
              {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
              <input className="text-field" autoFocus value={draft.title}
                onChange={e => setDraft(d => d && { ...d, title: e.target.value })} />
            </label>
            <label className="song-field">
              <span className="field-label">Artist</span>
              <input className="text-field" value={draft.artist}
                onChange={e => setDraft(d => d && { ...d, artist: e.target.value })} />
            </label>
            <label className="song-field">
              <span className="field-label">Key</span>
              <input className="text-field" placeholder="D minor" value={draft.key}
                onChange={e => setDraft(d => d && { ...d, key: e.target.value })} />
            </label>
            <label className="song-field draft-capo">
              <span className="field-label">Capo</span>
              <input className="text-field readout" inputMode="numeric" placeholder="5" value={draft.capo}
                onChange={e => setDraft(d => d && { ...d, capo: e.target.value })} />
            </label>
            <label className="song-field draft-chords">
              <span className="field-label">Chords</span>
              <input className="text-field" placeholder="A min → E min → F maj | C maj → G maj" value={draft.chordsRaw}
                onChange={e => setDraft(d => d && { ...d, chordsRaw: e.target.value })} />
            </label>
            <label className="song-field">
              <span className="field-label">Strumming</span>
              <input className="text-field readout" placeholder="D D U U D U" value={draft.strumming}
                onChange={e => setDraft(d => d && { ...d, strumming: e.target.value })} />
            </label>
          </div>
          <div className="draft-actions">
            <button type="submit" className="btn btn-primary" disabled={!draft.title.trim()}>Add song</button>
            <button type="button" className="btn" onClick={() => setDraft(null)}>Cancel</button>
            <button type="button" className="draft-tabfile" onClick={() => go({ tab: 'tabs', songId: null })}>
              Import a tab file
            </button>
          </div>
        </form>
      )}

      {songs.length > 0 && (
      <div className="songs-controls">
        <label className="songs-search">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" /><line x1="20" y1="20" x2="16.7" y2="16.7" />
          </svg>
          <input
            className="text-field"
            type="search"
            placeholder="Search title, artist, key or chord"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </label>
        {/* Sorting a short list is slower than reading it. */}
        {songs.length >= FILTER_FROM && (
        <Segmented<Filter>
          value={filter}
          onChange={setFilter}
          options={FILTERS}
          ariaLabel="Filter songs"
          size="sm"
        />
        )}
      </div>
      )}

      {songs.length === 0 ? (
        !draft && (
          <div className="songs-blank">
            <p className="songs-blank-title">Your songs live here</p>
            <p className="songs-blank-said">
              Add one with its chords and strumming, and it gets chord diagrams and a play-along. Have a backup? Restore it in Me.
            </p>
          </div>
        )
      ) : visible.length === 0 ? (
        <p className="songs-empty">Nothing matches that.</p>
      ) : (
        <ul className="songlist">
          {visible.map(song => {
            const chords = songChords(song);
            return (
              <li key={song.id}>
                <button
                  type="button"
                  className="songrow"
                  onClick={() => onOpenSong(song.id)}
                  title={`${song.title}: ${STATUS_LABEL[song.status]}`}
                >
                  <span className={`songrow-state is-${song.status}`} aria-hidden="true" />
                  <span className="songrow-name">
                    <span className="songrow-titleline">
                      <span className="songrow-title">{song.title}</span>
                      {song.revisit && <span className="revisit-flag readout">revisit</span>}
                    </span>
                    <span className="songrow-artist">
                      {song.artist && <>{song.artist} · </>}
                      <span className={`songrow-status is-${song.status}`}>{STATUS_LABEL[song.status]}</span>
                    </span>
                  </span>
                  <span className="songrow-key readout">
                    {song.key}
                    {song.capo !== null && song.capo > 0 && <span className="songrow-capo"> · {capoLabel(song.capo)}</span>}
                  </span>
                  <span className="songrow-chords readout">{chords.join(' · ')}</span>
                  {/* Your own rating, said in words. Unrated songs say nothing:
                      the status already says where they stand. */}
                  {song.confidence > 0 && (
                    <span className="songrow-conf readout"><small>Confidence</small>{song.confidence} of 10</span>
                  )}
                  <span className="songrow-mins readout">{totalMinutes(song)} min</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default SongsLab;
