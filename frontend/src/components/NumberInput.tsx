import React, { useRef, useState } from 'react';
import { useT } from '../i18n';

interface Props {
  value: number;
  onCommit(value: number): void;
  min?: number;
  max?: number;
  decimals?: number;  // digits shown and kept after the decimal separator
  step?: number;      // arrow up/down increment; defaults to one unit of the last decimal
  className?: string;
  style?: React.CSSProperties;
  title?: string;
}

// Accepts "37,4" as well as "37.4"
const parse = (text: string): number | null => {
  const n = Number(text.trim().replace(',', '.'));
  return text.trim() === '' || Number.isNaN(n) ? null : n;
};

// Numeric field that lets the user type freely: the text is applied on Enter,
// on leaving the field or with the arrow keys or the ▲▼ buttons, and an invalid
// entry reverts. Shift makes the arrows step ten times as far.
// (A controlled <input type="number"> rewrote the value on every keystroke, so
// clearing the field or typing a decimal separator made it jump.)
export function NumberInput({ value, onCommit, min = -Infinity, max = Infinity, decimals = 1, step, className = 'chrome-input', style, title }: Props) {
  const t = useT();
  const [draft, setDraft] = useState<string | null>(null);
  // Commit to the element that was being edited when the field got focus,
  // even if the selection changes before the field loses it
  const commitRef = useRef(onCommit);
  const cancelRef = useRef(false);
  const format = (n: number) =>
    new Intl.NumberFormat(undefined, { maximumFractionDigits: decimals, useGrouping: false }).format(n);
  const clamp = (n: number) => Math.min(max, Math.max(min, Number(n.toFixed(decimals))));

  const commit = (text: string) => {
    const n = parse(text);
    if (n !== null && clamp(n) !== value) commitRef.current(clamp(n));
    setDraft(null);
  };

  // One step up or down from what is typed in the field
  const nudge = (direction: 1 | -1, big: boolean) => {
    const delta = (step ?? 10 ** -decimals) * direction * (big ? 10 : 1);
    commitRef.current = onCommit;
    commitRef.current(clamp((parse(draft ?? format(value)) ?? value) + delta));
    setDraft(null);
  };

  // The width belongs to the whole field, buttons included
  const { width, ...inputStyle } = style ?? {};

  return (
    <div className="number-field" style={{ width }}>
      <input
        className={className}
        style={inputStyle}
        title={title}
        type="text"
        inputMode="decimal"
        value={draft ?? format(value)}
        onFocus={e => { commitRef.current = onCommit; e.target.select(); }}
        onChange={e => setDraft(e.target.value)}
        onBlur={e => {
          if (cancelRef.current) setDraft(null); else commit(e.target.value);
          cancelRef.current = false;
        }}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.currentTarget.blur();  // commits
          } else if (e.key === 'Escape') {
            cancelRef.current = true;
            e.currentTarget.blur();
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            nudge(e.key === 'ArrowUp' ? 1 : -1, e.shiftKey);
          }
        }}
      />
      <div className="number-stepper">
        {([1, -1] as const).map(direction => (
          <button
            key={direction}
            type="button"
            tabIndex={-1}
            aria-label={t(direction === 1 ? 'common.increase' : 'common.decrease')}
            // Keep the focus (and the typed text) in the field
            onMouseDown={e => e.preventDefault()}
            onClick={e => nudge(direction, e.shiftKey)}
          >
            <svg width="8" height="5" viewBox="0 0 8 5" fill="none">
              <path d={direction === 1 ? 'M1 4l3-3 3 3' : 'M1 1l3 3 3-3'} stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        ))}
      </div>
    </div>
  );
}
