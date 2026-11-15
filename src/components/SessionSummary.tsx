import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { closeSession, getSession, subscribeSession } from '../utils/session';
import { getGoal, secondsOn } from '../utils/practiceClock';
import { streakRepair, streakState, today } from '../utils/library';
import { TIERED, nextStep, useHoldUnlocks } from '../utils/feats';
import { DRILLS, suggestDrill } from '../utils/suggest';
import { CAN_REMIND, SLOTS, getReminders, setReminders } from '../utils/reminders';
import { go } from '../hooks/useRoute';
import { useBackToClose } from '../utils/nativeShell';

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/**
 * The end of a session, the same screen for every tool.
 *
 * In the order the research says matters: first whether you got better
 * (feedback on competence is what keeps people going), then what is close
 * (people speed up near a goal), then one next step (a good next step turns
 * one session into two). Badges wait until it is closed.
 */
export const SessionSummary: React.FC = () => {
  const report = useSyncExternalStore(subscribeSession, getSession, () => null);
  const open = report !== null;
  useHoldUnlocks('session-summary', open);
  useBackToClose(open, closeSession);
  const [askDone, setAskDone] = useState(false);
  useEffect(() => {
    if (!open) return;
    setAskDone(false);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeSession(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!report) return null;

  const goal = getGoal();
  const mins = Math.floor(secondsOn(today()) / 60);
  const st = streakState();
  const repair = streakRepair();
  const badge = TIERED.find(b => b.id === DRILLS.find(d => d.clock === report.tool)?.badge);
  const badgeNext = badge ? nextStep(badge) : null;
  const next = suggestDrill(report.tool);

  // What is close, most urgent first.
  const close: string[] = [];
  if (report.repaired) close.push(`Streak repaired: ${report.repaired} days in a row.`);
  else if (repair) {
    const need = goal * 2 - mins;
    if (need > 0) close.push(`${need} more min today repairs your ${repair.lost}-day streak.`);
  }
  if (mins < goal) close.push(`${goal - mins} min to today's goal.`);
  if (badge && badgeNext) close.push(`${badge.name}: ${badgeNext}.`);

  const askReminder = CAN_REMIND && report.goalMetNow && !getReminders().asked && !askDone;
  const choose = async (time: string | null) => {
    setAskDone(true);
    if (time === null) { await setReminders({ asked: true }); return; }
    await setReminders({ asked: true, on: true, time });
  };

  return createPortal(
    <div className="msheet-backdrop is-dialog" onClick={closeSession}>
      <div className="msheet hsum ssum" role="dialog" aria-modal="true" aria-label={`${report.title} summary`} onClick={e => e.stopPropagation()}>
        <span className="hsum-kicker">{report.title}</span>
        <div className="hsum-run readout ssum-head">{report.headline}</div>
        {report.better && <p className={`hsum-verdict${report.isBetter ? ' is-best' : ''}`}>{report.better}</p>}

        {report.goalMetNow && (
          <div className="ssum-goal">
            <b>Goal met</b>
            <span>{st.current > 1 ? `${st.current} days in a row` : 'Day 1 of a new streak'}</span>
          </div>
        )}

        <div className="hsum-stats">
          {(report.stats ?? []).map(s => (
            <div key={s.label}><span>{s.label}</span><b className="readout">{s.value}</b></div>
          ))}
          <div><span>Counted</span><b className="readout">{clock(report.seconds)}</b></div>
          <div><span>XP</span><b className="readout ssum-xp">+{report.xp}</b></div>
        </div>

        {close.length > 0 && (
          <ul className="ssum-close">
            {close.slice(0, 2).map(c => <li key={c}>{c}</li>)}
          </ul>
        )}

        {askReminder && (
          <div className="ssum-ask">
            <b>Want a nudge tomorrow?</b>
            <span>When do you usually practise?</span>
            <div className="ssum-ask-chips">
              {SLOTS.map(s => (
                <button key={s.value} type="button" className="chip-btn" onClick={() => void choose(s.value)}>{s.label}</button>
              ))}
              <button type="button" className="chip-btn is-quiet" onClick={() => void choose(null)}>Not now</button>
            </div>
          </div>
        )}

        <div className="hsum-acts">
          {next && !next.fresh && (
            <button type="button" className="btn" onClick={() => { closeSession(); go({ tab: next.drill.tab, songId: null }); }}>
              Next: {next.drill.label}
            </button>
          )}
          <button type="button" className="btn btn-primary" onClick={closeSession}>Done</button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default SessionSummary;
