// The app's own dropdown, in place of the browser's <select>.
//
// A native select on Android opens the system's plain radio-list dialog,
// which looks like nothing else in the app. This opens a sheet from the bottom
// on a phone (big rows, a tick on the current choice, the list scrolled to it)
// and a small menu under the button on a wide screen.
//
// The trigger is a button. Pass children to draw it yourself (a chip, a
// sentence with an arrow); leave them out for a standard field showing the
// chosen label.

import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { feel } from '../utils/haptics';
import { BACK_EVENT } from '../utils/nativeShell';

export interface SelectOption<T> {
  value: T;
  label: string;
  /** A second, quieter line: "Duple", "Major". */
  hint?: string;
  disabled?: boolean;
}

interface Props<T> {
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  /** What is being chosen: the sheet's title and the button's accessible name. */
  label: string;
  /** Shown on the standard field when nothing is chosen yet. */
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  title?: string;
  children?: React.ReactNode;
}

const PHONE = '(max-width: 900px)';

export function Select<T extends string | number>({ value, options, onChange, label, placeholder, className, disabled, title, children }: Props<T>) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [menuAt, setMenuAt] = useState<React.CSSProperties>({});
  const id = useId();
  const chosen = options.find(o => o.value === value);
  const phone = typeof window !== 'undefined' && !!window.matchMedia?.(PHONE).matches;

  const close = () => {
    if (!open || closing) return;
    if (!phone) { setOpen(false); button.current?.focus(); return; }
    // On touch, focus is not handed back: it would leave a keyboard focus ring on the button.
    setClosing(true);
    window.setTimeout(() => { setOpen(false); setClosing(false); }, 180);
  };
  const pick = (o: SelectOption<T>) => {
    if (o.disabled) return;
    feel('select');
    if (o.value !== value) onChange(o.value);
    close();
  };

  // On a wide screen the menu sits under the button, or above it near the bottom.
  useLayoutEffect(() => {
    if (!open || phone || !button.current) return;
    const r = button.current.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    const up = below < 260 && r.top > below;
    setMenuAt({
      left: Math.min(r.left, window.innerWidth - Math.max(r.width, 200) - 8),
      minWidth: Math.max(r.width, 180),
      ...(up ? { bottom: window.innerHeight - r.top + 6 } : { top: r.bottom + 6 }),
      maxHeight: Math.min(340, (up ? r.top : below) - 16),
    });
  }, [open, phone]);

  // Open on the current choice, and keep Escape and outside scrolling sane.
  useEffect(() => {
    if (!open) return;
    list.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'center' });
    list.current?.querySelector<HTMLElement>('[aria-selected="true"], [role="option"]')?.focus({ preventScroll: true });
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const items = [...(list.current?.querySelectorAll<HTMLElement>('[role="option"]:not([aria-disabled="true"])') ?? [])];
        const at = items.indexOf(document.activeElement as HTMLElement);
        items[Math.max(0, Math.min(items.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus();
      }
    };
    const away = () => { if (!phone) close(); };
    // Android's Back closes the sheet rather than leaving the page.
    const back = (e: Event) => { e.preventDefault(); close(); };
    window.addEventListener('keydown', key);
    window.addEventListener('resize', away);
    window.addEventListener(BACK_EVENT, back);
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('resize', away); window.removeEventListener(BACK_EVENT, back); };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const items = (
    <div className="ui-select-list" role="listbox" aria-label={label} id={id} ref={list}>
      {options.map(o => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="option"
            aria-selected={on}
            aria-disabled={o.disabled || undefined}
            className={`ui-select-item${on ? ' is-on' : ''}`}
            onClick={() => pick(o)}
          >
            <span className="ui-select-text">
              <span className="ui-select-label">{o.label}</span>
              {o.hint && <span className="ui-select-hint">{o.hint}</span>}
            </span>
            {on && (
              <svg className="ui-select-tick" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="5 12.5 10 17 19 7.5" />
              </svg>
            )}
          </button>
        );
      })}
    </div>
  );

  return (
    <>
      <button
        ref={button}
        type="button"
        className={children ? className : `select-field ui-select-field ${className ?? ''}`}
        onClick={() => (open ? close() : setOpen(true))}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={children ? label : `${label}: ${chosen?.label ?? placeholder ?? ''}`}
        disabled={disabled}
        title={title}
      >
        {children ?? <>
          <span className={`ui-select-value${chosen ? '' : ' is-empty'}`}>{chosen?.label ?? placeholder ?? ''}</span>
          <svg className="ui-select-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </>}
      </button>
      {open && createPortal(
        phone ? (
          <div className={`ui-sheet${closing ? ' is-closing' : ''}`} onClick={close}>
            <div className="ui-sheet-panel" role="dialog" aria-label={label} onClick={e => e.stopPropagation()}>
              <span className="ui-sheet-grip" aria-hidden="true" />
              <p className="ui-sheet-title">{label}</p>
              {items}
            </div>
          </div>
        ) : (
          <>
            <div className="ui-menu-scrim" onClick={close} />
            <div className="ui-menu" style={menuAt}>{items}</div>
          </>
        ),
        document.body,
      )}
    </>
  );
}
