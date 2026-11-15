import { assetUrl } from './assetUrl';

// The glyphs come from Bravura, the notation font the app already ships for
// tabs, so they look the same on every phone and work offline.
let fontAsked = false;
export function loadMusicFont(): void {
  if (fontAsked || typeof FontFace === 'undefined') return;
  fontAsked = true;
  const face = new FontFace('Encore Music', `url(${assetUrl('font/Bravura.woff2')})`);
  face.load().then(f => document.fonts.add(f)).catch(() => { /* falls back to system symbols */ });
}
export const MUSIC_FONT = "'Encore Music', 'Noto Music', 'Segoe UI Symbol', serif";
