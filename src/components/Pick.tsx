import React, { useId } from 'react';
import { ROMAN } from '../utils/feats';
import { MUSIC_FONT, loadMusicFont } from '../utils/musicFont';

// A badge is a guitar pick. Its five tiers are five pick materials, each rarer
// than the last: celluloid, tortoiseshell, bone, brass and abalone, the shell
// inlaid in the fretboards of fine guitars. The glyph on it is a music symbol
// for what it measures. Like the fretboard and the piano keys, these are real
// objects, so they keep their own colours in both themes.

const MAT: { stops: string[]; ink: string; spots?: boolean }[] = [
  { stops: [], ink: '' },
  { stops: ['#93A4B8', '#56667B'], ink: '#FFFFFF' },
  { stops: ['#A85E2C', '#4A220E'], ink: '#FBE9D2', spots: true },
  { stops: ['#F6EFE1', '#CFC09F'], ink: '#5A4630' },
  { stops: ['#F3D27E', '#A47622'], ink: '#4A3208' },
  { stops: ['#2F9A93', '#5E74D2', '#B05FA6', '#3BAE8C', '#7A95E0'], ink: '#FFFFFF' }
];

const SHAPE = 'M50 4C80 4 96 18 96 38C96 64 70 92 50 106C30 92 4 64 4 38C4 18 20 4 50 4Z';
const SPOTS = [[30, 30, 14, 9], [66, 46, 12, 8], [40, 70, 10, 7], [72, 22, 8, 6], [24, 54, 7, 5]];

// Bravura sits each symbol on its own baseline the way it would sit on a staff
// (an accidental centred on it, a note's head on it, a clef on its line), so
// each one needs its own size and lift to sit in the middle of the pick.
// [font size, how far the glyph's middle is above its baseline, in ems]
const FIT: Record<string, [number, number]> = {
  '♮': [52, 0], '♯': [52, 0], '♭': [52, 0.1],
  '𝄐': [56, 0.16],
  '𝄞': [38, 0.22], '𝄢': [46, -0.19],
  '♩': [46, 0.36], '♪': [46, 0.36], '♫': [46, 0.36], '♬': [46, 0.36], '𝅗𝅥': [46, 0.36],
  '𝄆': [32, 0.02], '𝄂': [32, 0.02]
};

interface PickProps {
  /** 0 for not yet earned, 1 to 5 for the tiers. */
  tier: number;
  glyph: string;
  /** One-offs: drawn in brass with no numeral. */
  single?: boolean;
  className?: string;
}

export const Pick: React.FC<PickProps> = ({ tier, glyph, single, className }) => {
  loadMusicFont();
  const id = useId().replace(/:/g, '');
  const [size, lift] = FIT[glyph] ?? [44, 0.3];
  const glyphY = (single ? 54 : 44) + lift * size;

  if (tier === 0) {
    return (
      <svg className={`pick is-locked${className ? ` ${className}` : ''}`} viewBox="0 0 100 110" aria-hidden="true">
        <path d={SHAPE} fill="var(--surface-2)" stroke="var(--text-muted)" strokeWidth="2.5" strokeDasharray="5 5" opacity="0.8" />
        <text x="50" y={glyphY} textAnchor="middle" fontFamily={MUSIC_FONT} fontSize={size} fill="var(--text-muted)">{glyph}</text>
      </svg>
    );
  }

  const m = MAT[single ? 4 : tier];
  return (
    <svg className={`pick${className ? ` ${className}` : ''}`} viewBox="0 0 100 110" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}g`} x1="0" y1="0" x2="1" y2="1">
          {m.stops.map((c, i) => <stop key={i} offset={i / (m.stops.length - 1)} stopColor={c} />)}
        </linearGradient>
        <clipPath id={`${id}c`}><path d={SHAPE} /></clipPath>
      </defs>
      <path d={SHAPE} fill={`url(#${id}g)`} />
      <g clipPath={`url(#${id}c)`}>
        {m.spots && SPOTS.map(([x, y, rx, ry], i) => <ellipse key={i} cx={x} cy={y} rx={rx} ry={ry} fill="#24100A" opacity="0.5" />)}
        <ellipse cx="30" cy="18" rx="34" ry="16" fill="#FFFFFF" opacity="0.22" />
      </g>
      <path d={SHAPE} fill="none" stroke="#000" strokeOpacity="0.18" strokeWidth="2" />
      <text x="50" y={glyphY} textAnchor="middle" fontFamily={MUSIC_FONT} fontSize={size} fill={m.ink}>{glyph}</text>
      {!single && (
        <text x="50" y="90" textAnchor="middle" fontFamily="var(--font-display)" fontWeight="700" fontSize="15" fill={m.ink} opacity="0.85">{ROMAN[tier]}</text>
      )}
    </svg>
  );
};

export default Pick;
