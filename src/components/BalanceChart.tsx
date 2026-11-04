import { useState } from 'react';
import { formatDate, formatMonth, formatPounds } from '../lib/format';

/** Where a month sits across the chart, in pixels, so it lines up under that month's table column. */
export interface ChartColumn {
  month: string;
  left: number;
  width: number;
}

interface Props {
  /** The months shown, oldest first, each placed under its table column. Months between columns are left out. */
  columns: ChartColumn[];
  /** The chart's full width in pixels; the y axis sits left of the first column. */
  width: number;
  /** End-of-day balances in pence, oldest first. */
  days: { date: string; balance: number }[];
  /** Forecast end-of-day balances after the last actual day, drawn dashed. */
  forecast?: { date: string; balance: number }[];
}

const HEIGHT = 240;
const PAD = { top: 12, bottom: 24 };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** A balance worth keeping above, drawn as a reference line. */
const THRESHOLD = 50000;

/** Round, evenly spaced values covering `min` to `max`, for the y axis. */
function ticks(min: number, max: number): number[] {
  const span = max - min || Math.abs(max) || 100000;
  const raw = span / 4;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw)!;
  const values: number[] = [];
  for (let v = Math.floor(min / step) * step; v <= max + step / 2; v += step) values.push(v);
  if (values.at(-1)! < max) values.push(values.at(-1)! + step);
  return values;
}

function daysIn(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** The balance at the end of each day across the columns' months, as a line. */
export function BalanceChart({ columns, width, days, forecast = [] }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  if (days.length === 0 || columns.length === 0) return null;

  const byMonth = new Map(columns.map((c) => [c.month, c]));
  const shown = (d: { date: string }) => byMonth.has(d.date.slice(0, 7));
  const actual = days.filter(shown);
  const ahead = forecast.filter(shown);
  const points = [...actual, ...ahead];
  if (points.length === 0) return null;
  const balances = points.map((d) => d.balance);
  const yTicks = ticks(Math.min(0, ...balances), Math.max(THRESHOLD, ...balances));
  const [yMin, yMax] = [yTicks[0], yTicks.at(-1)!];
  const plotLeft = columns[0].left;
  const plotRight = columns.at(-1)!.left + columns.at(-1)!.width;
  const plotW = plotRight - plotLeft;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const x = (date: string) => {
    const c = byMonth.get(date.slice(0, 7))!;
    return c.left + ((Number(date.slice(8)) - 0.5) / daysIn(c.month)) * c.width;
  };
  const y = (pence: number) => PAD.top + (1 - (pence - yMin) / (yMax - yMin)) * plotH;
  const line = (list: { date: string; balance: number }[]) =>
    list.map((d, i) => `${i ? 'L' : 'M'}${x(d.date).toFixed(1)},${y(d.balance).toFixed(1)}`).join('');
  const point = hover === null ? null : points[hover];
  const forecasting = hover !== null && hover >= actual.length;

  function onMove(e: React.PointerEvent<SVGRectElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - box.left + plotLeft;
    let nearest = 0;
    for (let i = 1; i < points.length; i++) if (Math.abs(x(points[i].date) - px) < Math.abs(x(points[nearest].date) - px)) nearest = i;
    setHover(nearest);
  }

  return (
    <>
      <h2>Daily closing balance</h2>
      <p className="muted small">
        Solid line: your actual balance at the end of each day, to {formatDate(days[days.length - 1].date)}.
        {forecast.length > 0 && ' Dashed line: the forecast, with spending spread evenly over each day and income on its usual payday.'}
      </p>
      <div className="balance-chart" style={{ width }}>
        <svg width={width} height={HEIGHT} role="img" aria-label={`Closing balance each day from ${formatMonth(columns[0].month)} to ${formatMonth(columns.at(-1)!.month)}`}>
          {yTicks.map((v) => (
            <g key={v}>
              <line className={v === 0 ? 'zero' : 'grid'} x1={plotLeft} x2={plotRight} y1={y(v)} y2={y(v)} />
              <text className="axis" x={plotLeft - 6} y={y(v)} dy="0.32em" textAnchor="end">
                {formatPounds(v)}
              </text>
            </g>
          ))}
          {columns.map((c) => {
            const name = MONTHS[Number(c.month.slice(5)) - 1];
            return (
              <g key={c.month}>
                <line className="month" x1={c.left} x2={c.left} y1={PAD.top} y2={HEIGHT - PAD.bottom} />
                <line className="month" x1={c.left + c.width} x2={c.left + c.width} y1={PAD.top} y2={HEIGHT - PAD.bottom} />
                <text className="axis" x={c.left + c.width / 2} y={HEIGHT - 6} textAnchor="middle">
                  {name === 'Jan' ? `Jan ${c.month.slice(2, 4)}` : name}
                </text>
              </g>
            );
          })}
          <line className="threshold" x1={plotLeft} x2={plotRight} y1={y(THRESHOLD)} y2={y(THRESHOLD)} />
          <text className="threshold-label" x={plotRight - 4} y={y(THRESHOLD) - 4} textAnchor="end">
            {formatPounds(THRESHOLD)}
          </text>
          <path className="line" d={line(actual)} />
          {/* Joined to the last actual day so the two lines meet. */}
          {ahead.length > 0 && <path className="line forecast" d={line(actual.length ? [actual[actual.length - 1], ...ahead] : ahead)} />}
          {point && (
            <>
              <line className="crosshair" x1={x(point.date)} x2={x(point.date)} y1={PAD.top} y2={HEIGHT - PAD.bottom} />
              <circle className={`dot ${forecasting ? 'forecast' : ''}`} cx={x(point.date)} cy={y(point.balance)} r={4} />
            </>
          )}
          <rect
            className="hit"
            x={plotLeft}
            y={PAD.top}
            width={plotW}
            height={plotH}
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
          />
        </svg>
        {point && (
          <div
            className="chart-tooltip"
            // Beside the crosshair rather than over the line, flipping to the left near the right edge.
            style={
              x(point.date) > width - 140
                ? { right: width - x(point.date) + 8, top: PAD.top }
                : { left: x(point.date) + 8, top: PAD.top }
            }
          >
            <strong>{formatPounds(point.balance)}</strong>
            <span>
              {formatDate(point.date)}
              {forecasting && ', forecast'}
            </span>
          </div>
        )}
      </div>
    </>
  );
}
