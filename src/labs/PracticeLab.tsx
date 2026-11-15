import React from 'react';
import { LabIcon } from '../components/LabIcon';
import { PRACTICE_GROUPS, type ActiveTab } from '../components/navGroups';
import { preloadLab } from './chunks';
import { useLibrary } from '../hooks/useLibrary';
import { ALL_LEVELS, isLevelComplete } from '../utils/journey';
import { getChordSkills } from '../utils/chordbook';
import { MATERIALS, ROMAN, TIERED, getRecord, heldTier } from '../utils/feats';
import { lastUsed } from '../utils/practiceClock';
import { isoDate, shiftIso } from '../utils/library';
import { Pick } from '../components/Pick';

/** Each drill's pick, and the clock key its time is counted under. */
const TOOL: Partial<Record<ActiveTab, { badge: string; clock: string }>> = {
  chordbook: { badge: 'collect', clock: 'loop' },
  rhythm: { badge: 'clock', clock: 'metronome' },
  'ear-training': { badge: 'ears', clock: 'ear' },
  play: { badge: 'explorer', clock: 'challenge' }
};

/** "today", "yesterday", "Thursday", or "12 Nov" for older. */
function since(date: string): string {
  const today = isoDate();
  if (date === today) return 'today';
  if (date === shiftIso(today, -1)) return 'yesterday';
  const d = new Date(`${date}T12:00:00`);
  return date >= shiftIso(today, -6)
    ? d.toLocaleDateString(undefined, { weekday: 'long' })
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

// Practice: everything that trains your hands and ears, and everything that
// explains why, one page with a card each, rather than seven rail entries.
//
// Each card says what it is for in a line, because "Challenges" and "Ear
// Training" are names that only mean something once you have opened them.

interface PracticeLabProps {
  setActiveTab: (tab: ActiveTab) => void;
}

export const PracticeLab: React.FC<PracticeLabProps> = ({ setActiveTab }) => {
  useLibrary(); // re-render when the chord book or library changes

  // A line of progress where there is one worth showing.
  const stat = (id: ActiveTab): string | null => {
    if (id === 'journey') {
      const done = ALL_LEVELS.filter(isLevelComplete).length;
      return `${done} of ${ALL_LEVELS.length} steps`;
    }
    if (id === 'chordbook') {
      const solid = getChordSkills().filter(s => s.comfort === 'solid').length;
      return solid > 0 ? `${solid} solid` : null;
    }
    if (id === 'rhythm') {
      const r = getRecord('tap-tightest');
      return r ? `Tap test best ±${r.value} ms` : null;
    }
    if (id === 'ear-training') {
      const r = getRecord('ear-streak');
      return r ? `Best ${r.value} in a row` : null;
    }
    if (id === 'play') {
      const b = TIERED.find(t => t.id === 'explorer');
      const n = b?.value() ?? 0;
      return n > 0 ? `${n} scale${n === 1 ? '' : 's'} climbed` : null;
    }
    return null;
  };

  // One suggestion: the drill you have left longest, never-tried first.
  const drills = (Object.keys(TOOL) as ActiveTab[]);
  const pick = drills
    .map(id => ({ id, last: lastUsed(TOOL[id]!.clock) ?? '' }))
    .sort((a, b) => (a.last < b.last ? -1 : a.last > b.last ? 1 : 0))[0];
  const suggestItem = PRACTICE_GROUPS.flatMap(g => g.items).find(i => i.id === pick?.id);
  const suggestSaid = pick && (pick.last ? `Not since ${since(pick.last)}` : 'Not tried yet');
  const fresh = pick?.last === isoDate();

  return (
    <div className="lab-narrow practice">
      <div className="lab-header">
        <h2 className="lab-title"><LabIcon tab="practice" />Practice</h2>
      </div>

      {suggestItem && !fresh && (
        <button type="button" className="practice-next" onClick={() => setActiveTab(suggestItem.id)}>
          <span className="practice-next-label">Try next</span>
          <span className="practice-next-name">{suggestItem.label}</span>
          <span className="practice-next-said">{suggestSaid}</span>
        </button>
      )}

      {PRACTICE_GROUPS.map(group => (
        <section key={group.name} className="practice-group">
          <h3 className="practice-label">{group.name === 'Drills' ? 'Train your hands and ears' : 'Understand what you play'}</h3>
          <div className="practice-grid">
            {group.items.map(item => {
              const line = stat(item.id);
              const tool = TOOL[item.id];
              const badge = tool ? TIERED.find(t => t.id === tool.badge) : undefined;
              const tier = badge ? heldTier(badge.id) : 0;
              return (
                <button
                  key={item.id}
                  type="button"
                  className="practice-card"
                  onClick={() => setActiveTab(item.id)}
                  onPointerEnter={() => preloadLab(item.id)}
                  onTouchStart={() => preloadLab(item.id)}
                >
                  <span className="practice-icon navmark" data-nav={item.id} aria-hidden="true">
                    <span className="channel-icon">{item.icon}</span>
                  </span>
                  <span className="practice-text">
                    <span className="practice-name">{item.label}</span>
                    <span className="practice-blurb">{item.blurb}</span>
                    {(line || tier > 0) && (
                      <span className="practice-stat readout">
                        {[tier > 0 && badge ? `${badge.name} ${ROMAN[tier]}` : null, line].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </span>
                  {badge && (
                    <span className="practice-pick" title={tier > 0 ? `${badge.name} ${ROMAN[tier]}, ${MATERIALS[tier]}` : `${badge.name}, not earned yet`}>
                      <Pick tier={tier} glyph={badge.glyph} />
                    </span>
                  )}
                  <svg className="practice-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="9 6 15 12 9 18" />
                  </svg>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
};

export default PracticeLab;
