// The five tab icons: filled, two-tone, and drawn for this app, so the bar
// reads without labels. Each uses three colours from its tab's CSS:
//   --ic-body    the shape (muted grey, the brand orange when the tab is on)
//   --ic-hi      a highlight (light grey, gold when on)
//   --ic-cut     cut-outs, the page colour
// Home is a house whose door is a guitar's sound hole; Songs a record;
// Practice a metronome; Tuner a tuning dial; Me a person.

import React from 'react';
import type { ActiveTab } from './navGroups';

const B = 'var(--ic-body)';
const H = 'var(--ic-hi)';
const C = 'var(--ic-cut)';

const svg = (children: React.ReactNode) => (
  <svg viewBox="0 0 24 24" aria-hidden="true">{children}</svg>
);

export const TAB_ICONS: Partial<Record<ActiveTab, React.ReactNode>> = {
  dashboard: svg(<>
    <path fill={B} d="M2.6 10.6 11 3.3a1.5 1.5 0 0 1 2 0l8.4 7.3c.6.5.2 1.4-.6 1.4H20v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8h-.8c-.8 0-1.2-.9-.6-1.4Z" />
    <circle fill={C} cx="12" cy="15.4" r="3.6" />
    <circle fill={H} cx="12" cy="15.4" r="1.6" />
  </>),
  library: svg(<>
    <circle fill={B} cx="12" cy="12" r="10" />
    <circle fill="none" stroke={C} strokeWidth="0.9" opacity="0.55" cx="12" cy="12" r="7.6" />
    <circle fill="none" stroke={C} strokeWidth="0.9" opacity="0.55" cx="12" cy="12" r="5.8" />
    <circle fill={H} cx="12" cy="12" r="3.4" />
    <circle fill={C} cx="12" cy="12" r="1" />
  </>),
  practice: svg(<>
    <path fill={B} d="M9.1 2h5.8c.7 0 1.3.5 1.5 1.1l4.4 16.7c.3 1.1-.5 2.2-1.7 2.2H4.9c-1.2 0-2-1.1-1.7-2.2L7.6 3.1C7.8 2.5 8.4 2 9.1 2Z" />
    <path fill={C} d="M10.1 4.6h3.8l3 11.4H7.1Z" />
    <path stroke={H} strokeWidth="1.7" strokeLinecap="round" d="M12 15.6 15.4 4.4" />
    <rect fill={H} x="12.9" y="7.6" width="3.4" height="2.6" rx="0.7" transform="rotate(17 14.6 8.9)" />
    <circle fill={H} cx="12" cy="15.6" r="1.3" />
  </>),
  tuner: svg(<>
    <path fill={B} d="M12 3.5a10 10 0 0 1 10 10v4.5a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-4.5a10 10 0 0 1 10-10Z" />
    <path fill="none" stroke={C} strokeWidth="1.4" strokeLinecap="round" d="M5.2 13.2 6.6 14M8.4 8.6l.9 1.3M12 7v1.6M15.6 8.6l-.9 1.3M18.8 13.2l-1.4.8" />
    <path stroke={H} strokeWidth="2" strokeLinecap="round" d="m12 16.6 3.1-5.4" />
    <circle fill={H} cx="12" cy="16.6" r="1.9" />
  </>),
  me: svg(<>
    <circle fill={B} cx="12" cy="7.6" r="4.6" />
    <path fill={B} d="M3.2 20.2C3.9 15.7 7.6 13.6 12 13.6s8.1 2.1 8.8 6.6c.1.9-.6 1.8-1.6 1.8H4.8c-1 0-1.7-.9-1.6-1.8Z" />
    <path fill={H} d="M9.4 13.9 12 17.4l2.6-3.5c-.8-.2-1.7-.3-2.6-.3s-1.8.1-2.6.3Z" />
  </>),
};
