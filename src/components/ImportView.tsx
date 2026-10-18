import { useMemo, useState } from 'react';
import { formatDate, formatMoney } from '../lib/format';
import { guessMapping, importRows, readCsv, type ColumnMapping } from '../lib/importer';
import { mergeTransactions } from '../lib/store';
import type { BudgetData } from '../lib/types';

interface Props {
  data: BudgetData;
  onChange: (data: BudgetData) => void;
  onDone: () => void;
}

const FIELDS: { key: keyof ColumnMapping; label: string; required?: boolean }[] = [
  { key: 'date', label: 'Date', required: true },
  { key: 'description', label: 'Description', required: true },
  { key: 'moneyIn', label: 'Money in' },
  { key: 'moneyOut', label: 'Money out' },
  { key: 'amount', label: 'Amount (signed)' },
  { key: 'balance', label: 'Balance' },
];

export function ImportView({ data, onChange, onDone }: Props) {
  const [file, setFile] = useState<{ name: string; headers: string[]; rows: string[][] } | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [year, setYear] = useState(new Date().getFullYear());
  const [message, setMessage] = useState<string | null>(null);

  async function pickFile(f: File) {
    const { headers, rows } = readCsv(await f.text());
    setFile({ name: f.name, headers, rows });
    setMapping(guessMapping(headers));
    setMessage(null);
  }

  const mappingError = useMemo(() => {
    if (!mapping) return null;
    if (mapping.date === -1 || mapping.description === -1) return 'Choose the date and description columns.';
    if (mapping.amount === -1 && mapping.moneyIn === -1 && mapping.moneyOut === -1)
      return 'Choose either an amount column, or money in and money out columns.';
    return null;
  }, [mapping]);

  const result = useMemo(
    () => (file && mapping && !mappingError ? importRows(file.rows, mapping, year) : null),
    [file, mapping, mappingError, year],
  );

  const existing = useMemo(() => new Set(data.transactions.map((t) => t.id)), [data.transactions]);
  const newCount = result ? result.transactions.filter((t) => !existing.has(t.id)).length : 0;

  function doImport() {
    if (!result) return;
    const { data: next, added } = mergeTransactions(data, result.transactions);
    onChange(next);
    const dupes = result.transactions.length - added;
    setMessage(`Imported ${added} transactions${dupes ? `, skipped ${dupes} already imported` : ''}.`);
    setFile(null);
    setMapping(null);
    if (added) onDone();
  }

  return (
    <section>
      <h2>Import a bank statement</h2>
      <p className="muted">Choose a CSV export from your bank. Nothing leaves your browser.</p>
      <label className="file-picker">
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void pickFile(f);
            e.target.value = '';
          }}
        />
        <span>Choose CSV file…</span>
      </label>
      {message && <p className="notice">{message}</p>}

      {file && mapping && (
        <>
          <h3>Columns in {file.name}</h3>
          <div className="mapping">
            {FIELDS.map(({ key, label, required }) => (
              <label key={key}>
                {label}
                <select
                  value={mapping[key]}
                  onChange={(e) => setMapping({ ...mapping, [key]: Number(e.target.value) })}
                >
                  <option value={-1}>{required ? 'Choose…' : 'Not in file'}</option>
                  {file.headers.map((h, i) => (
                    <option key={i} value={i}>
                      {h || `Column ${i + 1}`}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <label>
              Year, if the file doesn't say
              <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} />
            </label>
          </div>

          {mappingError && <p className="warning">{mappingError}</p>}

          {result && (
            <>
              <p>
                Found <strong>{result.transactions.length}</strong> transactions
                {result.transactions.length > 0 &&
                  ` from ${formatDate(result.transactions[0].date)} to ${formatDate(result.transactions.at(-1)!.date)}`}
                , of which <strong>{newCount}</strong> are new.
              </p>
              {result.skipped.length > 0 && (
                <details>
                  <summary>{result.skipped.length} rows skipped</summary>
                  <ul>
                    {result.skipped.map((s) => (
                      <li key={s.row}>
                        Row {s.row}: {s.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {result.balanceMismatches.length > 0 && (
                <p className="warning">
                  The running balance doesn't add up at row{result.balanceMismatches.length > 1 ? 's' : ''}{' '}
                  {result.balanceMismatches.slice(0, 10).join(', ')}
                  {result.balanceMismatches.length > 10 && '…'}. Check the column choices above.
                </p>
              )}
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Description</th>
                    <th className="num">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {result.transactions.slice(0, 5).map((t) => (
                    <tr key={t.id}>
                      <td>{formatDate(t.date)}</td>
                      <td>{t.description}</td>
                      <td className={`num ${t.amount > 0 ? 'in' : ''}`}>{formatMoney(t.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button className="primary" disabled={newCount === 0} onClick={doImport}>
                {newCount === 0 ? 'Nothing new to import' : `Import ${newCount} transactions`}
              </button>
            </>
          )}
        </>
      )}
    </section>
  );
}
