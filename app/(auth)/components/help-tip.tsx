'use client';

import { useState, useEffect, useRef } from 'react';
import { helpText } from '@/lib/help-text';

interface HelpTipProps {
  /** Key into the help-text registry */
  helpKey: string;
  /** Visual variant for dark (playground) vs light (experiments) backgrounds */
  variant?: 'light' | 'dark';
}

export function HelpTip({ helpKey, variant = 'light' }: HelpTipProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  const text = helpText[helpKey];
  if (!text) return null;

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  const isLight = variant === 'light';

  return (
    <span ref={ref} className="relative inline-flex items-center ml-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Help"
        className={`inline-flex items-center justify-center w-4 h-4 rounded-full text-[10px] font-bold leading-none cursor-pointer ${
          isLight
            ? 'border border-zinc-400 text-zinc-500 hover:bg-zinc-100'
            : 'border border-gray-500 text-gray-400 hover:bg-gray-700'
        }`}
      >
        ?
      </button>
      {open && (
        <div
          className={`absolute left-6 top-0 z-30 w-72 rounded-md border p-2 text-xs leading-relaxed shadow-lg ${
            isLight
              ? 'border-zinc-200 bg-white text-zinc-700'
              : 'border-gray-600 bg-gray-800 text-gray-200'
          }`}
        >
          {text}
        </div>
      )}
    </span>
  );
}
