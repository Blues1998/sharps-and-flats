import React, { useMemo, useState } from 'react';
import { ChordTile } from './ChordTile';
import { Segmented } from './Segmented';
import {
  GROUP_LABEL,
  allChords,
  chipLabel,
  groupChords,
  type ChordGroup,
  type GroupBy
} from '../utils/catalogue';
import { COMFORT_LABEL, comfortOf, tally, voicingsFor, type ChordComfort } from '../utils/chordbook';
import { normalizeChordSymbol } from '../utils/songText';
import { go } from '../hooks/useRoute';

// Chords in a key are Theory's Chords tab. Here they are arranged by what a
// chord is: its root, its quality, or how hard it is to hold.
const GROUPS: { value: GroupBy; label: string }[] =
  (['root', 'quality', 'difficulty'] as GroupBy[]).map(value => ({ value, label: GROUP_LABEL[value] }));

/**
 * How many chips a shut row builds.
 *
 * A cap on the work, not on what is shown: the strip is masked to the width it
 * has, so a difficulty band of fifty chords fades out where it runs off the
 * end. Nothing is lost by that, the tally on the right says how many are in
 * there, which is what a "+34" chip would have said less clearly.
 */
const PEEK = 16;

interface ChordCatalogueProps {
  onOpen: (symbol: string) => void;
  /** Put a chord found by name into your chords. */
  onAdd: (symbol: string) => void;
  /** Whether a chord is already one of yours. */
  isMine: (symbol: string) => boolean;
  isLooped: (symbol: string) => boolean;
}

/**
 * Every chord there is, looked up by name first and browsed second.
 *
 * Most visits here are a lookup: a sheet says F#m7 and you want the shape.
 * So the field is first, and it understands a chord the way a chord sheet
 * writes one. Browsing is under it, collapsed groups that still show their
 * tally, so a hundred and thirty diagrams are not built until asked for.
 */
export const ChordCatalogue: React.FC<ChordCatalogueProps> = ({ onOpen, onAdd, isMine, isLooped }) => {
  const [by, setBy] = useState<GroupBy>('root');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');

  const found = useMemo(() => {
    const q = query.trim();
    if (!q) return null;
    const exact = normalizeChordSymbol(q);
    const known = exact && voicingsFor(exact).length > 0 ? exact : null;
    const lower = q.toLowerCase();
    const near = allChords()
      .filter(c => c.symbol.toLowerCase().startsWith(lower) && c.symbol !== known)
      .slice(0, known ? 7 : 8)
      .map(c => c.symbol);
    return { known, list: known ? [known, ...near] : near };
  }, [query]);

  const groups = useMemo<ChordGroup[]>(() => groupChords(allChords(), by), [by]);
  const shown = groups.filter(group => group.chords.length > 0);

  const isOpen = (id: string) => open.has(id);
  const toggle = (id: string) => setOpen(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });


  return (
    <div className={`catalogue by-${by}`}>
      <div className="catalogue-find">
        <input
          className="text-field"
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Find any chord, like F#m7"
          aria-label="Find any chord"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
      </div>

      {found && (
        <section className="catalogue-found">
          {found.list.length === 0 ? (
            <p className="song-empty">No chord called "{query.trim()}".</p>
          ) : (
            <div className="ctiles">
              {found.list.map(symbol => (
                <ChordTile key={symbol} symbol={symbol} inLoop={isLooped(symbol)} onOpen={onOpen} />
              ))}
            </div>
          )}
          {found.known && !isMine(found.known) && (
            <button type="button" className="btn catalogue-add" onClick={() => { onAdd(found.known!); setQuery(''); }}>
              + Add {found.known} to my chords
            </button>
          )}
        </section>
      )}

      {!found && (
      <>
      <div className="catalogue-bar">
        <Segmented<GroupBy> value={by} onChange={setBy} options={GROUPS} ariaLabel="Arrange chords by" size="sm" />
        <button type="button" className="linklike catalogue-theory" onClick={() => go({ tab: 'theory', songId: null })}>
          Chords in a key: Theory
        </button>
      </div>

      {shown.length === 0 ? (
        <p className="song-empty">
          Nothing to show here.
        </p>
      ) : shown.map(group => {
        const counts = tally(group.chords.map(c => c.symbol));
        const opened = isOpen(group.id);
        return (
          <section key={group.id} className={`catgroup${opened ? ' is-open' : ''}`}>
            <button
              type="button"
              className="catgroup-head"
              onClick={() => toggle(group.id)}
              aria-expanded={opened}
            >
              <svg className="catgroup-caret" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="9 5 16 12 9 19" />
                </svg>
              <span className="catgroup-lead">
                <span className="catgroup-title">{group.title}</span>
                {group.subtitle && <span className="catgroup-sub readout">{group.subtitle}</span>}
              </span>
              {/* Shut, a row used to be a title and a number: twelve of them
                  read as twelve identical rows. The chips say which chords are
                  in there and, in the book's three colours, how you stand with
                  each, the reason to open one, without opening it. Decoration
                  to a screen reader, which is given the tally in words. */}
              {!opened && (
                <span className="catgroup-peek" aria-hidden="true">
                  {group.chords.slice(0, PEEK).map(chord => (
                    <span
                      key={chord.symbol}
                      className={`chordchip is-sm is-${comfortOf(chord.symbol)}`}
                      title={`${chord.symbol}: ${COMFORT_LABEL[comfortOf(chord.symbol)]}`}
                    >
                      {chipLabel(chord, by)}
                    </span>
                  ))}
                </span>
              )}
              {/* The tally is the reason a collapsed group is still worth
                  having on screen: coverage, one key at a time. */}
              <span className="catgroup-tally" aria-label={`${counts.solid} solid, ${counts.shaky} shaky, ${counts.none} not yet`}>
                <span className="tallybar">
                  {(['solid', 'shaky', 'none'] as ChordComfort[]).map(c => (
                    counts[c] > 0 && (
                      <span
                        key={c}
                        className={`tallybar-seg is-${c}`}
                        style={{ flexGrow: counts[c] }}
                        title={`${counts[c]} ${COMFORT_LABEL[c].toLowerCase()}`}
                      />
                    )
                  ))}
                </span>
                <span className="readout">{counts.solid}/{group.chords.length}</span>
              </span>
            </button>

            {opened && (
              <div className="ctiles">
                {group.chords.map(chord => (
                  <ChordTile
                    key={chord.symbol + (chord.numeral ?? '')}
                    symbol={chord.symbol}
                    meta={by === 'difficulty' ? chord.typeName : undefined}
                    inLoop={isLooped(chord.symbol)}
                    onOpen={onOpen}
                  />
                ))}
              </div>
            )}
          </section>
        );
      })}
      </>
      )}
    </div>
  );
};

export default ChordCatalogue;
