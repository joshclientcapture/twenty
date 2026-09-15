import { useRef, useState } from "react";

export type ChartPoint = { label: string; value: number; sublabel?: string };

// Reusable interactive line/area chart: hover crosshair + tooltip, optional goal line.
export function Chart({
  data, format = (n) => String(n), goal, goalLabel, color = "var(--color-primary)",
  area = true, height = 240, onPointClick, mini = false, zoom = false,
}: {
  data: ChartPoint[];
  format?: (n: number) => string;
  goal?: number;
  goalLabel?: string;
  color?: string;
  area?: boolean;
  height?: number;
  onPointClick?: (p: ChartPoint, i: number) => void;
  mini?: boolean;
  zoom?: boolean; // scale Y to the data's own range (not 0→goal) so growth reads steeply
}) {
  const [hi, setHi] = useState<number | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const W = 820, H = 260, PX = 8, PT = mini ? 8 : 18, PB = mini ? 6 : 26;

  if (!data.length) return <div style={{ height }} className="flex items-center justify-center font-mono text-xs uppercase tracking-wider text-muted-foreground">No data</div>;

  const vals = data.map((d) => d.value);
  const dMin = Math.min(...vals), dMax = Math.max(...vals);
  const rng = (dMax - dMin) || Math.abs(dMax) || 1;
  // zoom: axis spans [min-pad, max+pad] of the data. else 0 → max(data, goal).
  const base = zoom ? dMin - rng * 0.12 : 0;
  const top = zoom ? dMax + rng * 0.12 : (Math.max(dMax, goal ?? 0) * 1.08 || 1);
  const span = (top - base) || 1;
  const stepX = (W - PX * 2) / Math.max(data.length - 1, 1);
  const x = (i: number) => PX + stepX * i;
  const y = (v: number) => PT + (1 - (v - base) / span) * (H - PT - PB);
  const pts = data.map((d, i) => [x(i), y(d.value)] as const);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const areaPath = `${line} L${x(data.length - 1)},${H - PB} L${PX},${H - PB} Z`;

  const onMove = (e: React.MouseEvent) => {
    const rect = wrapRef.current!.getBoundingClientRect();
    const rx = ((e.clientX - rect.left) / rect.width) * W;
    setHi(Math.max(0, Math.min(data.length - 1, Math.round((rx - PX) / stepX))));
  };
  const h = hi != null ? data[hi] : null;

  return (
    <div ref={wrapRef} className="relative w-full" style={{ height }} onMouseMove={onMove} onMouseLeave={() => setHi(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-full w-full" style={{ overflow: "visible" }}>
        <defs>
          <linearGradient id={`cg-${color.replace(/[^a-z]/gi, "")}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.18" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 0.5, 1].map((f) => { const yy = PT + f * (H - PT - PB); return <line key={f} x1={PX} x2={W - PX} y1={yy} y2={yy} stroke="currentColor" strokeOpacity="0.07" strokeDasharray="2 4" />; })}
        {goal != null && goal <= top && goal >= base && (
          <g>
            <line x1={PX} x2={W - PX} y1={y(goal)} y2={y(goal)} stroke="var(--color-caution)" strokeOpacity="0.7" strokeWidth="1.5" strokeDasharray="5 4" />
            <text x={W - PX} y={y(goal) - 5} textAnchor="end" className="fill-[var(--color-caution)]" fontSize="10" fontFamily="JetBrains Mono, monospace">{goalLabel ?? format(goal)}</text>
          </g>
        )}
        {area && <path d={areaPath} fill={`url(#cg-${color.replace(/[^a-z]/gi, "")})`} />}
        <path d={line} fill="none" stroke={color} strokeWidth="2.25" vectorEffect="non-scaling-stroke" />
        {h && hi != null && <line x1={x(hi)} x2={x(hi)} y1={PT} y2={H - PB} stroke="currentColor" strokeOpacity="0.18" vectorEffect="non-scaling-stroke" />}
        {pts.map((p, i) => (
          <circle key={i} cx={p[0]} cy={p[1]} r={hi === i ? 4 : 2.5} fill={color} vectorEffect="non-scaling-stroke"
            style={{ cursor: onPointClick ? "pointer" : "default" }} onClick={() => onPointClick?.(data[i], i)} />
        ))}
        {!mini && data.map((d, i) => (i % Math.ceil(data.length / 8) === 0 || i === data.length - 1) && (
          <text key={i} x={x(i)} y={H - 8} textAnchor="middle" className="fill-slate-400" fontSize="9.5" fontFamily="JetBrains Mono, monospace">{d.label}</text>
        ))}
      </svg>
      {h && hi != null && (
        <div className="pointer-events-none absolute z-20 -translate-x-1/2 rounded-xl bg-foreground px-2.5 py-1.5 text-center shadow-lg"
          style={{ left: `${(x(hi) / W) * 100}%`, top: 0 }}>
          <div className="text-sm font-bold tabular-nums text-[var(--color-background)]">{format(h.value)}</div>
          <div className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-background)]/70">{h.sublabel ?? h.label}</div>
        </div>
      )}
    </div>
  );
}
