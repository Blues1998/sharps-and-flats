// Tab for lessons and songs: notes as string, fret and length.

/** A note in a riff: string (1 thinnest to 6 thickest), fret, length in beats. */
export type RiffNote = [string: number, fret: number, beats: number];

/** Standard tuning, string 1 to 6 (index 0 unused). */
export const OPEN_MIDI = [0, 64, 59, 55, 50, 45, 40];
export const STRING_NAME = ['', 'high E', 'B', 'G', 'D', 'A', 'low E'];

export const riffMidi = ([st, f]: RiffNote | [number, number]): number => OPEN_MIDI[st] + f;
export const riffBeats = (notes: RiffNote[]): number => notes.reduce((t, n) => t + n[2], 0);
