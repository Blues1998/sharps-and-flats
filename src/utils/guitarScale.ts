// The guitar behind Today's map, drawn at true scale by scripts/guitar.py
// (a dreadnought: 645.2 mm scale, 43 mm nut, strings 35.6 mm apart at the nut
// and 54 mm at the saddle) into src/assets/guitar.webp. These numbers are the
// script's, so notes land on the image's strings and frets. Change one, render
// again.

export const PX_PER_MM = 2.8;
const SCALE_MM = 645.2;
const NUT_SPREAD = 35.6;
const SADDLE_SPREAD = 54.0;

/** The image, in CSS px: 390 wide with the neck's centre line at 195. */
export const GUITAR_IMG = { width: 390, height: 2273.7, centre: 195, nutY: 481.6 };

/** Distance from the nut to fret n, in CSS px. */
export const fretY = (n: number): number => SCALE_MM * (1 - 2 ** (-n / 12)) * PX_PER_MM;

/**
 * Where string s (1 is the thinnest, as the map counts them) crosses the
 * point y px below the nut, as px from the neck's centre line.
 */
export const stringX = (s: number, y: number): number => {
  const i = 6 - s; // 0 is low E
  const t = y / PX_PER_MM;
  const atNut = -NUT_SPREAD / 2 + i * NUT_SPREAD / 5;
  const atSaddle = -SADDLE_SPREAD / 2 + i * SADDLE_SPREAD / 5;
  return (atNut + (atSaddle - atNut) * t / SCALE_MM) * PX_PER_MM;
};
