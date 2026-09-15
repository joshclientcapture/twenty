import { styled } from '@linaria/react';
import { useRef, useState } from 'react';
import { themeCssVariables as t } from 'twenty-ui/theme-constants';

export type ChartPoint = { label: string; value: number; sublabel?: string };

const StyledWrap = styled.div`
  position: relative;
  width: 100%;
  svg {
    display: block;
    height: 100%;
    overflow: visible;
    width: 100%;
  }
  text {
    fill: ${t.font.color.tertiary};
    font-family: ${t.font.family};
  }
`;

const StyledEmpty = styled.div`
  align-items: center;
  color: ${t.font.color.tertiary};
  display: flex;
  font-size: ${t.font.size.xs};
  justify-content: center;
`;

const StyledTooltip = styled.div`
  background: ${t.background.primaryInverted};
  border-radius: ${t.border.radius.sm};
  color: ${t.font.color.inverted};
  padding: ${t.spacing[1]} ${t.spacing[2]};
  pointer-events: none;
  position: absolute;
  text-align: center;
  top: 0;
  transform: translateX(-50%);
  white-space: nowrap;
  z-index: 20;
  div[data-v] {
    font-size: ${t.font.size.sm};
    font-weight: ${t.font.weight.medium};
    font-variant-numeric: tabular-nums;
  }
  div[data-l] {
    font-size: ${t.font.size.xs};
    opacity: 0.7;
  }
`;

// Reusable interactive line/area chart: hover crosshair + tooltip, optional goal line.
export const Chart = ({
  data,
  format = (n) => String(n),
  goal,
  goalLabel,
  color = 'var(--t-color-blue, #1b4498)',
  area = true,
  height = 240,
  onPointClick,
  mini = false,
  zoom = false,
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
}) => {
  const [hi, setHi] = useState<number | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const W = 820;
  const H = 260;
  const PX = 8;
  const PT = mini ? 8 : 18;
  const PB = mini ? 6 : 26;

  if (!data.length) return <StyledEmpty style={{ height }}>No data</StyledEmpty>;

  const vals = data.map((d) => d.value);
  const dMin = Math.min(...vals);
  const dMax = Math.max(...vals);
  const rng = dMax - dMin || Math.abs(dMax) || 1;
  const base = zoom ? dMin - rng * 0.12 : 0;
  const top = zoom ? dMax + rng * 0.12 : Math.max(dMax, goal ?? 0) * 1.08 || 1;
  const span = top - base || 1;
  const stepX = (W - PX * 2) / Math.max(data.length - 1, 1);
  const x = (i: number) => PX + stepX * i;
  const y = (v: number) => PT + (1 - (v - base) / span) * (H - PT - PB);
  const pts = data.map((d, i) => [x(i), y(d.value)] as const);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const areaPath = `${line} L${x(data.length - 1)},${H - PB} L${PX},${H - PB} Z`;
  const gradId = `cg-${color.replace(/[^a-z0-9]/gi, '')}`;

  const onMove = (e: React.MouseEvent) => {
    const rect = wrapRef.current!.getBoundingClientRect();
    const rx = ((e.clientX - rect.left) / rect.width) * W;
    setHi(Math.max(0, Math.min(data.length - 1, Math.round((rx - PX) / stepX))));
  };
  const h = hi != null ? data[hi] : null;

  return (
    <StyledWrap ref={wrapRef} style={{ height }} onMouseMove={onMove} onMouseLeave={() => setHi(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.18" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 0.5, 1].map((f) => {
          const yy = PT + f * (H - PT - PB);
          return <line key={f} x1={PX} x2={W - PX} y1={yy} y2={yy} stroke="currentColor" strokeOpacity="0.07" strokeDasharray="2 4" />;
        })}
        {goal != null && goal <= top && goal >= base && (
          <g>
            <line x1={PX} x2={W - PX} y1={y(goal)} y2={y(goal)} stroke={t.tag.text.orange} strokeOpacity="0.7" strokeWidth="1.5" strokeDasharray="5 4" />
            <text x={W - PX} y={y(goal) - 5} textAnchor="end" fontSize="10" style={{ fill: t.tag.text.orange }}>
              {goalLabel ?? format(goal)}
            </text>
          </g>
        )}
        {area && <path d={areaPath} fill={`url(#${gradId})`} />}
        <path d={line} fill="none" stroke={color} strokeWidth="2.25" vectorEffect="non-scaling-stroke" />
        {h && hi != null && <line x1={x(hi)} x2={x(hi)} y1={PT} y2={H - PB} stroke="currentColor" strokeOpacity="0.18" vectorEffect="non-scaling-stroke" />}
        {pts.map((p, i) => (
          <circle
            key={i}
            cx={p[0]}
            cy={p[1]}
            r={hi === i ? 4 : 2.5}
            fill={color}
            vectorEffect="non-scaling-stroke"
            style={{ cursor: onPointClick ? 'pointer' : 'default' }}
            onClick={() => onPointClick?.(data[i], i)}
          />
        ))}
        {!mini &&
          data.map(
            (d, i) =>
              (i % Math.ceil(data.length / 8) === 0 || i === data.length - 1) && (
                <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize="9.5">
                  {d.label}
                </text>
              ),
          )}
      </svg>
      {h && hi != null && (
        <StyledTooltip style={{ left: `${(x(hi) / W) * 100}%` }}>
          <div data-v>{format(h.value)}</div>
          <div data-l>{h.sublabel ?? h.label}</div>
        </StyledTooltip>
      )}
    </StyledWrap>
  );
};
