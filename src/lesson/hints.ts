// Words for a near miss on the guitar: which note was heard, and how far off.

const NOTE = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

/** "That is G, 2 frets too high. Looking for F." Close misses say how far. */
export function noteMiss(heardPc: number, targetPc: number): string {
  const d = ((heardPc - targetPc + 18) % 12) - 6; // -6 to 5, nearest way round
  const heard = NOTE[heardPc];
  const want = NOTE[targetPc];
  if (d === 0) return `That is ${want}.`;
  if (Math.abs(d) > 3) return `That is ${heard}. Looking for ${want}.`;
  return `That is ${heard}, ${Math.abs(d)} fret${Math.abs(d) > 1 ? 's' : ''} too ${d > 0 ? 'high' : 'low'}. Looking for ${want}.`;
}

export const noteName = (pc: number): string => NOTE[((pc % 12) + 12) % 12];
