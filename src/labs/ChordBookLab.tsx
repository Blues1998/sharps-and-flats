import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { LabIcon } from '../components/LabIcon';
import { ChordDiagram } from '../components/ChordDiagram';
import { ChordTile } from '../components/ChordTile';
import { ChordSheet } from '../components/ChordSheet';
import { ChordCatalogue } from '../components/ChordCatalogue';
import { RateStack } from '../components/RateStack';
import { QuickPlay, type TransportOrder } from '../components/QuickPlay';
import { onHandoff, takeLoop, type Handoff } from '../utils/handoff';
import { makeSlot, type Slot } from '../utils/loop';
import { useLibrary } from '../hooks/useLibrary';
import { getSongs, songChords } from '../utils/library';
import { timeChart } from '../utils/chart';
import {
  chordKey,
  comfortOf,
  forgetChord,
  getChordSkills,
  preferredVoicing,
  setComfort,
  setPreferredVoicing,
  skillFor,
  voicingsFor,
  type ChordComfort
} from '../utils/chordbook';
import { drillSlots, nextChords, reasonInFull, type NextChord } from '../utils/next';
import { normalizeChordSymbol } from '../utils/songText';
import { chartsWithChord, hideChord, removeFromSongs, songsWithChord, unhideAll, unhideChord, useHiddenChords } from '../utils/chordRemoval';
import { useBackToClose } from '../utils/nativeShell';

type Tab = 'learn' | 'mine' | 'all';
type Section = ChordComfort | 'unrated';

/** The order My chords is read in: what needs work first, what's done last. */
const SECTIONS: { id: Section; label: string }[] = [
  { id: 'none', label: 'Not yet' },
  { id: 'shaky', label: 'Shaky' },
  { id: 'unrated', label: 'Not rated' },
  { id: 'solid', label: 'Solid' }
];

/** With no songs yet, the chords most songs are made of. */
const COMMON = ['C', 'G', 'D', 'Em', 'Am', 'E', 'A', 'F'];

interface Entry {
  /** The canonical key the book files it under. */
  key: string;
  /** What the cards show. */
  symbol: string;
  /** Songs in the library that ask for this chord. */
  songs: string[];
  comfort: ChordComfort;
  rated: boolean;
  /** How hard the easiest shape is, the order to meet them in. */
  difficulty: number;
}

/**
 * Every chord you have met, and where you stand with each.
 *
 * The list is not a catalogue of all the chords there are. It is the ones your
 * own songs ask for, because those are the ones worth an opinion, plus
 * anything you add by hand. A chord book of six hundred entries is a reference
 * work; this is meant to be finishable in an evening.
 */
export const ChordBookLab: React.FC = () => {
  const ready = useLibrary();
  const [tab, setTab] = useState<Tab | null>(null);
  // The bucket: the loop being built, in the order chords were added. It
  // outlives the sheet, so shutting the loop to go and find two more chords
  // does not throw away the four you had.
  const [picked, setPicked] = useState<Slot[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState('');
  const [sheetFor, setSheetFor] = useState<string | null>(null);
  const [shut, setShut] = useState<Set<Section>>(() => new Set<Section>(['solid']));
  // This visit's ratings from the stack, so it can say how the pass went.
  const [ratedNow, setRatedNow] = useState<{ symbol: string; comfort: ChordComfort }[]>([]);
  const [skipped, setSkipped] = useState<Set<string>>(() => new Set());
  const [dock, setDock] = useState<HTMLDivElement | null>(null);
  const skills = getChordSkills();
  const songs = getSongs();
  const hidden = useHiddenChords();

  const entries = useMemo<Entry[]>(() => {
    // Keyed canonically so B flat and A sharp are one chord, but shown with
    // the spelling the songs themselves used, the book is filed by pitch and
    // read in whatever language your sheets are written in.
    const found = new Map<string, { display: string; titles: Set<string> }>();
    const note = (symbol: string, title: string) => {
      const key = chordKey(symbol);
      if (!key) return;
      if (!found.has(key)) found.set(key, { display: normalizeChordSymbol(symbol), titles: new Set() });
      if (title) found.get(key)?.titles.add(title);
    };

    for (const song of songs) {
      for (const symbol of songChords(song)) note(symbol, song.title);
      if (song.chart && song.chart.lines.length > 0) {
        // Read through the chart's own lens, so a chord is filed under the grip
        // you make rather than the pitch it comes out at. The book is about
        // hands: with a capo on, the sheet's Dm is an Am as far as they care.
        const parsed = timeChart(song.chart.lines, song.chart.beatsPerBar, song.chart.transpose);
        for (const symbol of parsed.chords) note(symbol, song.title);
      }
    }
    // Anything rated by hand belongs here whether or not a song uses it.
    for (const skill of skills) {
      if (!found.has(skill.id)) found.set(skill.id, { display: skill.label ?? skill.id, titles: new Set() });
    }

    return [...found.entries()]
      .filter(([key]) => !hidden.has(key))
      .map(([key, { display, titles }]) => ({
        key,
        symbol: display,
        songs: [...titles].sort(),
        comfort: comfortOf(key),
        rated: skills.some(s => s.id === key),
        difficulty: voicingsFor(key)[0]?.difficulty ?? 99
      }))
      // Most-used first, then easiest: the order that gets the most songs
      // unlocked for the least work.
      .sort((a, b) => b.songs.length - a.songs.length || a.difficulty - b.difficulty || a.symbol.localeCompare(b.symbol));
  }, [songs, skills, hidden]);

  // The four are disjoint and add up to the total. An unrated chord is one you
  // cannot play either, but counting it under both headings put the same four
  // chords in the summary twice and made the line unreadable.
  const counts = useMemo(() => ({
    solid: entries.filter(e => e.comfort === 'solid').length,
    shaky: entries.filter(e => e.comfort === 'shaky').length,
    none: entries.filter(e => e.rated && e.comfort === 'none').length,
    unrated: entries.filter(e => !e.rated).length
  }), [entries]);

  // Unrated chords, easiest first: the stack in Learn. With no songs yet it
  // offers the common open chords, so the app learns your hands on day one.
  const unrated = useMemo(
    () => entries.filter(e => !e.rated).sort((a, b) => a.difficulty - b.difficulty),
    [entries]
  );
  const stack = useMemo(() => {
    const pool = entries.length > 0
      ? unrated.map(e => ({ symbol: e.symbol, song: e.songs[0] ?? null }))
      : COMMON.filter(sym => !skillFor(sym)).map(symbol => ({ symbol, song: null }));
    return pool.filter(c => !skipped.has(c.symbol));
  }, [entries.length, unrated, skipped]);

  // My chords, in sections, through the search field.
  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? entries.filter(e => e.symbol.toLowerCase().includes(q)) : entries;
    return SECTIONS.map(sec => ({
      ...sec,
      items: list.filter(e => (sec.id === 'unrated' ? !e.rated : e.rated && e.comfort === sec.id))
    })).filter(sec => sec.items.length > 0);
  }, [entries, query]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const next = useMemo(() => nextChords(6).filter(c => !hidden.has(c.key)).slice(0, 4), [songs, skills, hidden]);

  // ---- Removing a chord ----------------------------------------------------
  // A chord only you added is just forgotten. One a song asks for gets a
  // question, out of the song, or just out of sight, because the right
  // answer depends on whether the song's line was wrong. Either way there is
  // an Undo for a few seconds, rather than a confirm in front of every press.
  // Where the chord comes from, split the way removing it has to be: a chord
  // line can be edited from here, a written chart cannot.
  const [removing, setRemoving] = useState<{ entry: Entry; lines: string[]; charts: string[] } | null>(null);
  const [toast, setToast] = useState<{ text: string; undo: () => Promise<void> | void } | null>(null);
  const closeSheet = useCallback(() => setRemoving(null), []);
  useBackToClose(removing !== null, closeSheet);
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(t);
  }, [toast]);

  // Everything forgetting a rating loses, so Undo can give it back.
  const forgetWithUndo = async (entry: Entry) => {
    const prev = skillFor(entry.key);
    await forgetChord(entry.key);
    return async () => {
      if (!prev) return;
      await setComfort(prev.label ?? entry.symbol, prev.comfort);
      if (prev.voicingId) await setPreferredVoicing(prev.label ?? entry.symbol, prev.voicingId);
    };
  };

  const startRemove = async (entry: Entry) => {
    if (entry.songs.length > 0) {
      setRemoving({
        entry,
        lines: songsWithChord(entry.key).map(song => song.title),
        charts: chartsWithChord(entry.key).map(song => song.title)
      });
      return;
    }
    const undo = await forgetWithUndo(entry);
    setToast({ text: `Removed ${entry.symbol}`, undo });
  };

  const removeFromSongLines = async (entry: Entry, lineCount: number) => {
    setRemoving(null);
    const undoSongs = await removeFromSongs(entry.key);
    const undoRating = await forgetWithUndo(entry);
    // A written chart that uses it isn't edited from here, so it would come
    // straight back from there; hide it so the press does what it said.
    const stillCharted = chartsWithChord(entry.key).length > 0;
    if (stillCharted) hideChord(entry.key);
    const n = lineCount;
    setToast({
      text: `Removed ${entry.symbol} from ${n} song${n === 1 ? '' : 's'}${stillCharted ? ' (hidden: still in a chart)' : ''}`,
      undo: async () => { await undoSongs(); await undoRating(); if (stillCharted) unhideChord(entry.key); }
    });
  };

  const hideFromBook = (entry: Entry) => {
    setRemoving(null);
    hideChord(entry.key);
    setToast({ text: `Hid ${entry.symbol}`, undo: () => unhideChord(entry.key) });
  };

  // A chord found by name in All chords. Added as "not yet" rather than as
  // solid: putting it in the book is saying you have met it, not that you
  // have it. Then it opens, so the next thing (its shapes) is right there.
  const addChord = async (raw: string) => {
    const symbol = normalizeChordSymbol(raw);
    if (!symbol) return;
    if (!skills.some(s => s.id === chordKey(symbol))) await setComfort(symbol, 'none');
    setSheetFor(symbol);
  };
  const isMine = (symbol: string) => entries.some(e => e.key === chordKey(symbol));

  // Ticked by canonical key, so B flat and A sharp are the one chord here as
  // they are everywhere else in the book.
  const pickedKeys = useMemo(() => new Set(picked.map(slot => chordKey(slot.symbol))), [picked]);
  const isPicked = (symbol: string) => pickedKeys.has(chordKey(symbol));

  // A tick is set membership, so unticking takes the chord out wherever it
  // sits. A progression that wants the same chord twice is written in the
  // panel, where there is a sequence to write it on; a checkbox cannot say
  // "twice" and should not pretend to.
  const toggle = (symbol: string) => setPicked(prev => {
    const key = chordKey(symbol);
    return prev.some(slot => chordKey(slot.symbol) === key)
      ? prev.filter(slot => chordKey(slot.symbol) !== key)
      : [...prev, makeSlot(symbol)];
  });

  // The docked bar and the sheet both drive the one player inside QuickPlay.
  // Orders from here (Drill plays at once) go in as numbered requests.
  const [order, setOrder] = useState<TransportOrder | null>(null);
  const tell = (action: 'start' | 'stop') =>
    setOrder(prev => ({ id: (prev?.id ?? 0) + 1, action }));

  const openLoop = useCallback(() => setExpanded(true), []);
  const closeLoop = useCallback(() => setExpanded(false), []);

  // Drill: the chord and the changes into it, playing straight away. The
  // loop bar shows what is sounding; the sheet stays shut.
  const drill = (chord: NextChord) => {
    setPicked(drillSlots(chord));
    setSheetFor(null);
    tell('start');
  };

  /**
   * A loop sent here from somewhere else, the palette, or today's run.
   *
   * Taken twice over, because there are two ways one can arrive. Sent from
   * another screen it is left waiting and the navigation brings us here, so
   * the pickup has to happen on mount; sent from this page it arrives as an
   * event while we are already standing here. Taking is destructive, so
   * whichever gets there first is the only one that finds anything.
   */
  const [preset, setPreset] = useState<Handoff | null>(null);
  const accept = useCallback(() => {
    const loop = takeLoop();
    if (!loop) return;
    setPicked(loop.slots);
    setPreset(loop);
    setExpanded(true);
  }, []);
  useEffect(() => {
    accept();
    return onHandoff(accept);
  }, [accept]);

  const rate = (symbol: string, comfort: ChordComfort) => {
    setRatedNow(prev => [...prev, { symbol, comfort }]);
    void setComfort(symbol, comfort);
  };

  if (!ready) return <div className="songs-loading readout">Opening your chord book…</div>;

  const total = entries.length;
  const focus = next[0] ?? null;
  const later = next.slice(1);
  const songsOf = (symbol: string) => entries.find(e => e.key === chordKey(symbol))?.songs ?? [];
  // Learn opens first while it has something to say, otherwise your chords.
  const shownTab: Tab = tab ?? (stack.length > 0 || focus ? 'learn' : total > 0 ? 'mine' : 'learn');
  const sheetEntry = sheetFor ? entries.find(e => e.key === chordKey(sheetFor)) ?? null : null;
  const sheetNext = sheetFor ? next.find(n => n.key === chordKey(sheetFor)) ?? null : null;
  const metaFor = (e: Entry) => (e.songs.length > 0 ? `${e.songs.length} song${e.songs.length === 1 ? '' : 's'}` : 'added by you');

  // The drill as it will sound: the chord, then each partner, alternating.
  const pair = focus ? drillSlots(focus).map(slot => slot.symbol) : [];
  const focusShape = focus ? preferredVoicing(focus.symbol) : null;

  return (
    <div className="chordbook">
      <header className="cb-head">
        <h2 className="lab-title"><LabIcon tab="chordbook" />Chords</h2>
        {total > 0 && (
          <p className="cb-summary">
            <span className="readout"><strong>{counts.solid}</strong> of {total} solid</span>
            <span className="tallybar is-wide" aria-hidden="true">
              <span className="tallybar-seg is-solid" style={{ flexGrow: counts.solid }} />
              <span className="tallybar-seg is-shaky" style={{ flexGrow: counts.shaky }} />
              <span className="tallybar-seg is-none" style={{ flexGrow: counts.none + counts.unrated }} />
            </span>
          </p>
        )}
      </header>

      <div className="cb-tabs" role="tablist" aria-label="Chords">
        {([
          ['learn', 'Learn', stack.length > 0 ? stack.length : null],
          ['mine', 'My chords', total > 0 ? total : null],
          ['all', 'All chords', null]
        ] as [Tab, string, number | null][]).map(([id, label, n]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={shownTab === id}
            className={`cb-tab${shownTab === id ? ' is-active' : ''}`}
            onClick={() => setTab(id)}
          >
            {label}{n !== null && <span className="cb-tab-n readout">{n}</span>}
          </button>
        ))}
      </div>

      <div className="cb-layout">
        <div className="cb-main">
          {shownTab === 'learn' && (
            <>
              <RateStack
                cards={stack}
                ratedNow={ratedNow}
                common={entries.length === 0}
                onRate={rate}
                onSkip={(symbol: string) => setSkipped(prev => new Set(prev).add(symbol))}
                onAgain={() => { setRatedNow([]); setSkipped(new Set()); }}
              />

              {focus && (
                <section className="cb-focus">
                  <span className="surface-label">Learn next</span>
                  <div className="cb-focus-body">
                    <button type="button" className="cb-focus-shape" onClick={() => setSheetFor(focus.symbol)} aria-label={`Open ${focus.symbol}`}>
                      {focusShape && <ChordDiagram frets={focusShape.frets} fingers={focusShape.fingers} scale={0.8} />}
                    </button>
                    <div className="cb-focus-text">
                      <h3 className="cb-focus-name">{focus.symbol}</h3>
                      <span className="cb-focus-why">{reasonInFull(focus)}</span>
                      {pair.length > 1 && (
                        <span className="cb-focus-pair readout" aria-label={`The change you'll drill: ${pair.join(', ')}`}>
                          {pair.map((sym, k) => (
                            <React.Fragment key={k}>{k > 0 && <i aria-hidden="true">↔</i>}{sym}</React.Fragment>
                          ))}
                        </span>
                      )}
                    </div>
                  </div>
                  <button type="button" className="btn btn-primary cb-focus-go" onClick={() => drill(focus)}>
                    Drill {focus.symbol}
                  </button>
                  {later.length > 0 && (
                    <div className="cb-later">
                      <span>Then</span>
                      {later.map(n => (
                        <button key={n.key} type="button" className="chip-btn cb-later-chip" onClick={() => setSheetFor(n.symbol)}>
                          {n.symbol}<small>{n.unlocks.length > 0 ? 'finishes a song' : `${n.songs} song${n.songs === 1 ? '' : 's'}`}</small>
                        </button>
                      ))}
                    </div>
                  )}
                </section>
              )}

              {stack.length === 0 && ratedNow.length === 0 && !focus && (
                <div className="songs-blank">
                  <p className="songs-blank-title">{total > 0 ? 'Nothing to learn next' : 'The chords your songs need'}</p>
                  <p className="songs-blank-said">
                    {total > 0
                      ? 'Every chord your songs use is rated, and none is marked Not yet. Mark one Not yet and it shows up here with a drill.'
                      : 'Add a song with its chords and they all land here to rate and drill. You can also look any chord up in All chords.'}
                  </p>
                </div>
              )}
            </>
          )}

          {shownTab === 'mine' && (
            total === 0 ? (
              <div className="songs-blank">
                <p className="songs-blank-title">No chords yet</p>
                <p className="songs-blank-said">Add a song with its chords, or find a chord in All chords and add it.</p>
              </div>
            ) : (
              <>
                <input
                  className="text-field cb-find"
                  type="search"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Find a chord"
                  aria-label="Find one of your chords"
                  autoCapitalize="none"
                  spellCheck={false}
                />
                {sections.length === 0 && <p className="song-empty">None of your chords match "{query.trim()}".</p>}
                {sections.map(sec => {
                  const closed = shut.has(sec.id) && !query.trim();
                  return (
                    <section key={sec.id} className={`cb-sec is-${sec.id}${closed ? ' is-shut' : ''}`}>
                      <button
                        type="button"
                        className="cb-sec-head"
                        aria-expanded={!closed}
                        onClick={() => setShut(prev => {
                          const nextSet = new Set(prev);
                          if (nextSet.has(sec.id)) nextSet.delete(sec.id); else nextSet.add(sec.id);
                          return nextSet;
                        })}
                      >
                        <i className="cb-sec-dot" aria-hidden="true" />
                        <span className="cb-sec-label">{sec.label}</span>
                        <span className="cb-sec-n readout">{sec.items.length}</span>
                        <svg className="cb-sec-caret" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9" /></svg>
                      </button>
                      {!closed && (
                        <div className="ctiles">
                          {sec.items.map(e => (
                            <ChordTile key={e.key} symbol={e.symbol} meta={metaFor(e)} inLoop={isPicked(e.symbol)} onOpen={setSheetFor} />
                          ))}
                        </div>
                      )}
                    </section>
                  );
                })}
                {hidden.size > 0 && (
                  <p className="chordbook-hidden">
                    {hidden.size} hidden chord{hidden.size === 1 ? '' : 's'} ·{' '}
                    <button type="button" className="linklike" onClick={unhideAll}>show {hidden.size === 1 ? 'it' : 'them'}</button>
                  </p>
                )}
              </>
            )
          )}

          {shownTab === 'all' && (
            <ChordCatalogue onOpen={setSheetFor} onAdd={symbol => void addChord(symbol)} isMine={isMine} isLooped={isPicked} />
          )}
        </div>

        <aside className="cb-side">
          <QuickPlay
            slots={picked}
            preset={preset}
            onChange={setPicked}
            onClose={closeLoop}
            onExpand={openLoop}
            order={order}
            dock={dock}
            expanded={expanded}
          />
        </aside>
      </div>

      <div className="cb-dock" ref={setDock} />

      {sheetFor && (
        <ChordSheet
          symbol={sheetFor}
          songs={songsOf(sheetFor)}
          inLoop={isPicked(sheetFor)}
          onToggleLoop={() => toggle(sheetFor)}
          onDrill={sheetNext ? () => drill(sheetNext) : undefined}
          onRemove={sheetEntry ? () => { setSheetFor(null); void startRemove(sheetEntry); } : undefined}
          onClose={() => setSheetFor(null)}
        />
      )}

      {/* Portaled: inside the page they sat under the phone's tab bar, since
          the lab's own stacking layer caps how high a z-index can reach. */}
      {removing && createPortal(
        <div className="msheet-backdrop is-dialog" onClick={closeSheet}>
          <div className="msheet" role="dialog" aria-modal="true" aria-label={`Remove ${removing.entry.symbol}`} onClick={e => e.stopPropagation()}>
            <h3 className="removesheet-title">Remove {removing.entry.symbol}?</h3>
            {removing.lines.length > 0 && (
              <p className="removesheet-said">
                In the chord line of <strong>{removing.lines.join(', ')}</strong>.
              </p>
            )}
            {removing.charts.length > 0 && (
              <p className="removesheet-said">
                In the chart of <strong>{removing.charts.join(', ')}</strong>. Edit the chart on the song page to remove it there.
              </p>
            )}
            <div className="removesheet-actions">
              {removing.lines.length > 0 && (
                <>
                  <button type="button" className="btn auth-delete-btn" onClick={() => void removeFromSongLines(removing.entry, removing.lines.length)}>
                    Remove it from {removing.lines.length === 1 ? 'that chord line' : `those ${removing.lines.length} chord lines`}
                  </button>
                  <p className="removesheet-hint">Use this for typos or notes misread as chords.</p>
                </>
              )}
              <button type="button" className="btn" onClick={() => hideFromBook(removing.entry)}>Just hide it here</button>
              <p className="removesheet-hint">The songs keep it.</p>
              <button type="button" className="btn removesheet-cancel" onClick={closeSheet}>Cancel</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {toast && createPortal(
        <div className="undo-toast" role="status">
          <span>{toast.text}</span>
          <button type="button" onClick={() => { const { undo } = toast; setToast(null); void undo(); }}>Undo</button>
        </div>,
        document.body
      )}

    </div>
  );
};

export default ChordBookLab;
