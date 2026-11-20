import { xpBetween, xpWeek } from '../utils/xp';
import { shiftIso, today } from '../utils/library';
import React from 'react';
import type { WeekRecap } from '../utils/weekly';
import { heldLabel } from '../utils/tempoLog';

/**
 * The last seven days: one number, the shape, and one line.
 *
 * The streak is drawn rather than counted. Days played back to back are joined
 * by a line under their bars, so a run of days reads as a run at a glance and
 * a gap reads as a gap. Today's bar is an outline until something is logged:
 * the day is still open, it is not a day missed.
 *
 * Only facts with something to say are rendered. All-time figures and the
 * average confidence left this card: they never changed what anyone did next.
 */

const LETTER = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
// A three-minute day should read as a small day, not as a whole week's work.
const FLOOR = 20;
// ...and it should still be visible. Below this the bar rounds away to nothing.
const MIN_SHOWN = 0.09;

export const WeekPanel: React.FC<{ recap: WeekRecap; style?: React.CSSProperties }> = ({ recap, style }) => {
  const weekXp = xpWeek(shiftIso).reduce((a, d) => a + d.xp, 0);
  const lastWeekXp = xpBetween(shiftIso(today(), -13), shiftIso(today(), -7));
  const top = Math.max(FLOOR, ...recap.days.map(day => day.minutes));

  const facts: React.ReactNode[] = [];
  if (recap.chordsRated > 0) {
    facts.push(
      <span key="chords">
        {recap.chordsRated} chord{recap.chordsRated === 1 ? '' : 's'} rated
        {recap.chordsSolid > 0 && <>, <b>{recap.chordsSolid} solid</b></>}
      </span>
    );
  }
  if (recap.tempo) {
    facts.push(
      <span key="tempo">
        <b>{recap.tempo.bpm} bpm</b> held {heldLabel(recap.tempo.seconds)}
        {recap.tempo.previous !== null && `, up from ${recap.tempo.previous}`}
      </span>
    );
  }

  return (
    <section className="tday-card tday-week" style={style}>
      <div className="tday-week-head">
        <div>
          <span className="surface-label">This week</span>
          <div className="tday-big readout">
            {recap.minutes}<small>min</small>
          </div>
        </div>
        {(weekXp > 0 || lastWeekXp > 0) && (
          <div className="tday-xp" title="XP is earned for getting better: notes landed, answers right, scales climbed, records beaten.">
            <span className="tday-big readout">{weekXp}<small>XP</small></span>
            {lastWeekXp > 0 && <small>{weekXp >= lastWeekXp ? `Up on last week's ${lastWeekXp}` : `${lastWeekXp - weekXp} to match last week`}</small>}
          </div>
        )}
      </div>

      <div
        className="tday-bars"
        role="img"
        aria-label={
          recap.minutes > 0
            ? `${recap.minutes} minutes over ${recap.played} of the last seven days`
            : 'No practice logged in the last seven days'
        }
      >
        {recap.days.map((day, i) => {
          const share = day.minutes > 0 ? Math.max(MIN_SHOWN, day.minutes / top) : 0;
          const when = new Date(`${day.date}T12:00:00`);
          const next = recap.days[i + 1];
          const linked = day.minutes > 0 && !!next && next.minutes > 0;
          return (
            <span
              key={day.date}
              className={`tday-day${day.open ? ' is-today' : ''}${day.minutes > 0 ? ' is-on' : ''}${linked ? ' is-linked' : ''}`}
              style={{ ['--i' as string]: i } as React.CSSProperties}
              title={`${when.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })}: ${day.minutes > 0 ? `${day.minutes} min` : day.open ? 'not yet' : 'nothing logged'}`}
            >
              <span className="tday-track">
                <span className="tday-fill" style={{ height: `${(share * 100).toFixed(1)}%` }} />
              </span>
              <span className="tday-letter">{day.open ? 'Today' : LETTER[when.getDay()]}</span>
            </span>
          );
        })}
      </div>

    </section>
  );
};

export default WeekPanel;
