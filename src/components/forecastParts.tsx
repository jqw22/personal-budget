import { useState } from 'react';
import { formatPounds } from '../lib/format';
import { parseMoney } from '../lib/importer';

export function shortMonth(month: string): string {
  return new Date(`${month}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
}

export function net(amount: number): string {
  return `${amount >= 0 ? '+' : '−'}${formatPounds(Math.abs(amount))}`;
}

/** A money box that saves when you leave it. Clearing it goes back to the average. */
export function MoneyInput({
  value,
  edited,
  label,
  onCommit,
}: {
  value: number;
  edited: boolean;
  label: string;
  onCommit: (pence: number | null) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? String(Math.round(value / 100));

  function commit() {
    if (text === null) return;
    setText(null);
    if (text.trim() === '') return onCommit(null);
    const pence = parseMoney(text);
    if (pence !== null && pence !== value) onCommit(Math.round(Math.abs(pence) / 100) * 100);
  }

  return (
    <input
      className={`forecast-input ${edited ? 'edited' : ''}`}
      inputMode="decimal"
      aria-label={label}
      title={edited ? 'Your figure. Clear it to go back to the forecast.' : 'Forecast. Type to change it.'}
      value={shown}
      onFocus={(e) => e.target.select()}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setText(null);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}
