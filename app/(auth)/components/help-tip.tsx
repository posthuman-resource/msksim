'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { helpText } from '@/lib/help-text';

interface HelpTipProps {
  /** Key into the help-text registry */
  helpKey: string;
  /** Visual variant for dark (playground) vs light (experiments) backgrounds */
  variant?: 'light' | 'dark';
}

/**
 * Inline (?) help affordance.
 *
 * Hover-first: opens on mouseenter / focus, closes on mouseleave / blur.
 * Click-to-pin: clicking pins it open (next click or outside-click unpins).
 * Touch: pin/unpin on tap (no hover state).
 *
 * Renders as a `role="button"` span — NOT a `<button>` — so it can safely
 * nest inside other interactive parents (`<button>`, `<summary>`, `<label>`)
 * without triggering React 19's "button cannot contain a button" hydration
 * error. Keyboard support: Enter/Space toggle pin, Escape unpins.
 *
 * Pattern is documented in docs/design-system.md §6 (Tooltip / HelpTip).
 */
export function HelpTip({ helpKey, variant = 'light' }: HelpTipProps) {
  const [hovering, setHovering] = useState(false);
  const [pinned, setPinned] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const popoverId = useId();

  const text = helpText[helpKey];

  // Outside-click closes a pinned popover. Hooks must run unconditionally,
  // hence the early-return for missing helpText is below.
  useEffect(() => {
    if (!pinned) return;
    function onMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setPinned(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setPinned(false);
    }
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [pinned]);

  if (!text) return null;

  const open = hovering || pinned;
  const isLight = variant === 'light';

  return (
    <span ref={ref} className="relative inline-flex items-center ml-1 align-middle">
      <span
        role="button"
        tabIndex={0}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setPinned((p) => !p);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            setPinned((p) => !p);
          }
        }}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        onFocus={() => setHovering(true)}
        onBlur={() => setHovering(false)}
        aria-label="Help"
        aria-expanded={open}
        aria-describedby={open ? popoverId : undefined}
        className={`inline-flex items-center justify-center w-4 h-4 rounded-full text-[10px] font-bold leading-none cursor-help select-none transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
          isLight
            ? 'border border-border-strong text-fg-muted hover:bg-surface-muted'
            : 'border border-gray-500 text-gray-400 hover:bg-gray-700'
        }`}
      >
        ?
      </span>
      {open && (
        <span
          id={popoverId}
          role="tooltip"
          className={`pointer-events-none absolute left-6 top-0 z-30 w-72 rounded-md border p-2 text-xs leading-relaxed font-normal normal-case tracking-normal ${
            isLight
              ? 'border-border bg-surface text-fg'
              : 'border-gray-600 bg-gray-800 text-gray-200'
          }`}
        >
          {text}
        </span>
      )}
    </span>
  );
}
