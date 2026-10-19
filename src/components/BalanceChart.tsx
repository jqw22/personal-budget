import { useEffect, useRef, useState } from 'react';
import { formatDate, formatPounds } from '../lib/format';

interface Props {
  /** The calendar year shown, e.g. "2026". */
  year: string;
  /** End-of-day balances in pence, oldest first. */
  days: { date: string; balance: number }[];
  /** Forecast end-of-day balances after the last actual day, drawn dashed. */
  forecast?: { date: string; balance: number }[];
}

const HEIGHT = 240;
const PAD = { top: 12, right: 12, bottom: 24, left: 56 };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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

function dayOfYear(date: string, year: string): number {
  return (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${year}-01-01T00:00:00Z`)) / 86_400_000;
}

/** The balance at the end of each day across the calendar year, as a line. */
export function BalanceChart({ year, days, forecast = [] }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(300, entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  if (days.length === 0) return null;

  const yearDays = dayOfYear(`${year}-12-31`, year) + 1;
  const points = [...days, ...forecast];
  const balances = points.map((d) => d.balance);
  const yTicks = ticks(Math.min(0, ...balances), Math.max(...balances));
  const [yMin, yMax] = [yTicks[0], yTicks.at(-1)!];
  const plotW = width - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const x = (date: string) => PAD.left + ((dayOfYear(date, year) + 0.5) / yearDays) * plotW;
  const y = (pence: number) => PAD.top + (1 - (pence - yMin) / (yMax - yMin)) * plotH;
  const line = (list: { date: string; balance: number }[]) =>
    list.map((d, i) => `${i ? 'L' : 'M'}${x(d.date).toFixed(1)},${y(d.balance).toFixed(1)}`).join('');
  const point = hover === null ? null : points[hover];
  const forecasting = hover !== null && hover >= days.length;

  function onMove(e: React.PointerEvent<SVGRectElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - box.left + PAD.left;
    let nearest = 0;
    for (let i = 1; i < points.length; i++) if (Math.abs(x(points[i].date) - px) < Math.abs(x(points[nearest].date) - px)) nearest = i;
    setHover(nearest);
  }

  return (
    <>
      <h2>Daily closing balance</h2>
      <div className="balance-chart" ref={wrap}>
        <svg width={width} height={HEIGHT} role="img" aria-label={`Closing balance each day in ${year}`}>
          {yTicks.map((v) => (
            <g key={v}>
              <line className={v === 0 ? 'zero' : 'grid'} x1={PAD.left} x2={width - PAD.right} y1={y(v)} y2={y(v)} />
              <text className="axis" x={PAD.left - 6} y={y(v)} dy="0.32em" textAnchor="end">
                {formatPounds(v)}
              </text>
            </g>
          ))}
          {MONTHS.map((m, i) => {
            const start = `${year}-${String(i + 1).padStart(2, '0')}-01`;
            const left = PAD.left + (dayOfYear(start, year) / yearDays) * plotW;
            const next = i === 11 ? yearDays : dayOfYear(`${year}-${String(i + 2).padStart(2, '0')}-01`, year);
            const mid = PAD.left + (((dayOfYear(start, year) + next) / 2) / yearDays) * plotW;
            return (
              <g key={m}>
                {i > 0 && <line className="month" x1={left} x2={left} y1={PAD.top} y2={HEIGHT - PAD.bottom} />}
                <text className="axis" x={mid} y={HEIGHT - 6} textAnchor="middle">
                  {plotW < 500 ? m[0] : m}
                </text>
              </g>
            );
          })}
          <path className="line" d={line(days)} />
          {/* Joined to the last actual day so the two lines meet. */}
          {forecast.length > 0 && <path className="line forecast" d={line([days[days.length - 1], ...forecast])} />}
          {point && (
            <>
              <line className="crosshair" x1={x(point.date)} x2={x(point.date)} y1={PAD.top} y2={HEIGHT - PAD.bottom} />
              <circle className={`dot ${forecasting ? 'forecast' : ''}`} cx={x(point.date)} cy={y(point.balance)} r={4} />
            </>
          )}
          <rect
            className="hit"
            x={PAD.left}
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
