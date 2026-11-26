import { useState } from 'react';
import { parseMoney } from '../lib/importer';
import { merchantName } from '../lib/merchant';
import { applyRules } from '../lib/rules';
import type { BudgetData, Transaction } from '../lib/types';

interface Props {
  data: BudgetData;
  onChange: (data: BudgetData) => void;
  onDone: () => void;
  /** The category dropdown's options, grouped as on the rest of the tab. */
  options: React.ReactNode;
}

/** A form for a transaction typed in by hand, such as cash spending the bank never sees. */
export function AddTransaction({ data, onChange, onDone, options }: Props) {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState('');
  const [direction, setDirection] = useState<'out' | 'in'>('out');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('');
  const pence = parseMoney(amount);
  const ready = /^\d{4}-\d{2}-\d{2}$/.test(date) && description.trim() !== '' && pence !== null && pence !== 0;

  function add() {
    if (!ready) return;
    const size = Math.abs(pence!);
    const t: Transaction = {
      id: `manual-${crypto.randomUUID()}`,
      date,
      description: description.trim(),
      merchant: merchantName(description.trim()),
      amount: direction === 'out' ? -size : size,
      balance: null,
      category: category || null,
      categorySource: category ? 'manual' : null,
      manual: true,
    };
    const [tagged] = applyRules([t], data.rules);
    const transactions = [...data.transactions, tagged].sort((a, b) => a.date.localeCompare(b.date));
    onChange({ ...data, transactions });
    onDone();
  }

  return (
    <form
      className="add-transaction"
      onSubmit={(e) => {
        e.preventDefault();
        add();
      }}
    >
      <input type="date" aria-label="Date" value={date} onChange={(e) => setDate(e.target.value)} required />
      <input aria-label="Description" placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} autoFocus />
      <select aria-label="Money out or in" value={direction} onChange={(e) => setDirection(e.target.value as 'out' | 'in')}>
        <option value="out">Money out</option>
        <option value="in">Money in</option>
      </select>
      <input aria-label="Amount" placeholder="Amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="amount-input" />
      <select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
        <option value="">Untagged</option>
        {options}
      </select>
      <button type="submit" className="primary" disabled={!ready}>
        Add
      </button>
      <button type="button" onClick={onDone}>
        Cancel
      </button>
    </form>
  );
}
