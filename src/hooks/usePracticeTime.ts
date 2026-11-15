import { useEffect } from 'react';
import { GENERAL, heard, setLive, wireClock } from '../utils/practiceClock';
import { useHoldUnlocks } from '../utils/feats';

/**
 * Counts practice time while `active`, against a song when there is one.
 *
 * A mic tool (`mic`) only counts while the mic is actually hearing notes.
 *
 * Also holds badges back for as long as it runs: anything worth counting as
 * practice is something a badge should not interrupt.
 */
export function usePracticeTime(key: string, active: boolean, opts: { songId?: string; mic?: boolean } = {}): void {
  const songId = opts.songId ?? GENERAL;
  const mic = !!opts.mic;
  useEffect(() => { wireClock(); }, []);
  useEffect(() => {
    setLive(key, active, songId, mic);
    return () => setLive(key, false);
  }, [key, active, songId, mic]);
  useHoldUnlocks(`practice:${key}`, active);
}

/** For mic tools: call with the latest pitch, and a heard note keeps the clock going. */
export function useHeard(pitch: unknown): void {
  useEffect(() => { if (pitch) heard(); }, [pitch]);
}
