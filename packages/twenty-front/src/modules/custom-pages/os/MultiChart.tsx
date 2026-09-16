import { styled } from '@linaria/react';
import { useState } from 'react';
import { themeCssVariables as t } from 'twenty-ui/theme-constants';

import { CAUTION } from '@/custom-pages/os/ui';

export type MultiChartSeries = {
  key: string;
  label: string;
  values: (number | null)[];
  color: string;
  kind?: 'line' | 'bar';
  dashed?: boolean;
  area?: boolean;
};

export type MultiChartProps = {
  labels: string[];
  sublabels?: string[];
  series: MultiChartSeries[];
  format?: (n: number) => string;
  goal?: number;
  goalLabel?: string;
  height?: number;
  logScale?: boolean;
  // Index from which x labels render muted (used for projected months).
  mutedFrom?: number;
};

const StyledWrap = styled.div`
  position: relative;
  width: 100%;
  svg { display: block; width: 100%; height: auto; }
  text { fill: ${t.font.color.tertiary}; font-size: 11px; font-family: inherit; }
  text[data-muted] { fill: ${t.font.color.light}; }
  line[data-grid] { stroke: ${t.border.color.light}; }
  line[data-goal] { stroke: ${CAUTION}; stroke-dasharray: 4 4; }
  line[data-cross] { stroke: ${t.border.color.strong}; }
`;

const StyledReadout = styled.div`
  background: ${t.background.primary};
  border: 1px solid ${t.border.color.medium};
  border-radius: ${t.border.radius.sm};
  box-shadow: ${t.boxShadow.light};
  font-size: ${t.font.size.sm};
  padding: ${t.spacing[1]} ${t.spacing[2]};
  pointer-events: none;
  position: absolute;
  top: 0;
  white-space: nowrap;
  z-index: 1;
  div[data-title] { color: ${t.font.color.primary}; font-weight: ${t.font.weight.medium}; margin-bottom: 2px; }
  div[data-line] { color: ${t.font.color.secondary}; display: flex; gap: ${t.spacing[2]}; }
  span[data-dot] { border-radius: 2px; display: inline-block; height: 8px; margin-top: 4px; width: 8px; }
  b { color: ${t.font.color.primary}; font-variant-numeric: tabular-nums; }
`;

const StyledLegend = styled.div`
  color: ${t.font.color.secondary};
  display: flex;
  flex-wrap: wrap;
  font-size: ${t.font.size.xs};
  gap: ${t.spacing[3]};
  margin-bottom: ${t.spacing[2]};
  span[data-swatch] { border-radius: 2px; display: inline-block; height: 3px; margin-right: 6px; vertical-align: middle; width: 14px; }
  span[data-swatch='dashed'] { background: repeating-linear-gradient(90deg, currentColor 0 3px, transparent 3px 6px); }
  span[data-swatch='bar'] { height: 8px; width: 8px; }
`;

const W = 820;
const PAD = { top: 16, right: 16, bottom: 26, left: 8 };

// Line, bar and dashed series on one x axis, with an optional goal line and hover readout.
export const MultiChart = ({ labels, sublabels, series, format = (n) => String(n), goal, goalLabel, height = 240, logScale = false, mutedFrom }: MultiChartProps) => {
  const [hover, setHover] = useState<number | null>(null);
  const H = height;
  const n = labels.length;
  if (n === 0) return null;
  const all = series.flatMap((s) => s.values.filter((v): v is number => v != null));
  const rawMax = Math.max(...all, goal ?? 0, 1);
  const positives = all.filter((v) => v > 0);
  const logMin = logScale && positives.length ? Math.pow(10, Math.floor(Math.log10(Math.min(...positives)))) : 0;
  const top = logScale ? Math.pow(10, Math.ceil(Math.log10(rawMax))) : rawMax * 1.08;
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const stepX = n > 1 ? innerW / (n - 1) : innerW;
  const x = (i: number) => PAD.left + (n > 1 ? stepX * i : innerW / 2);
  const y = (v: number) => {
    if (logScale) {
      const lv = Math.log10(Math.max(v, logMin || 1));
      const lo = Math.log10(logMin || 1);
      const hi = Math.log10(top);
      return PAD.top + innerH - ((lv - lo) / Math.max(hi - lo, 1e-9)) * innerH;
    }
    return PAD.top + innerH - (v / top) * innerH;
  };
  const gridValues = logScale
    ? Array.from({ length: Math.ceil(Math.log10(top)) - Math.floor(Math.log10(logMin || 1)) + 1 }, (_, i) => Math.pow(10, Math.floor(Math.log10(logMin || 1)) + i))
    : [0, 0.25, 0.5, 0.75, 1].map((f) => top * f);
  const labelEvery = Math.max(1, Math.ceil(n / 14));
  const barSeries = series.filter((s) => s.kind === 'bar');
  const barW = Math.min(28, (stepX * 0.7) / Math.max(barSeries.length, 1));
  const linePath = (values: (number | null)[]) => {
    let d = '';
    let pen = false;
    values.forEach((v, i) => {
      if (v == null) { pen = false; return; }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
      pen = true;
    });
    return d.trim();
  };

  return (
    <StyledWrap>
      <StyledLegend>
        {series.map((s) => (
          <span key={s.key}><span data-swatch={s.kind === 'bar' ? 'bar' : s.dashed ? 'dashed' : ''} style={{ background: s.kind === 'bar' || !s.dashed ? s.color : undefined, color: s.color }} />{s.label}</span>
        ))}
        {goal != null && <span><span data-swatch="dashed" style={{ color: CAUTION }} />{goalLabel ?? 'Goal'}</span>}
        {logScale && <span>· log scale</span>}
      </StyledLegend>
      <svg viewBox={`0 0 ${W} ${H}`} onMouseLeave={() => setHover(null)}>
        {gridValues.map((g, i) => (
          <g key={i}>
            <line data-grid x1={PAD.left} x2={W - PAD.right} y1={y(g)} y2={y(g)} />
            <text x={W - PAD.right} y={y(g) - 3} textAnchor="end">{format(g)}</text>
          </g>
        ))}
        {goal != null && goal <= top && (
          <g>
            <line data-goal x1={PAD.left} x2={W - PAD.right} y1={y(goal)} y2={y(goal)} />
            <text x={PAD.left + 4} y={y(goal) - 4} style={{ fill: CAUTION }}>{goalLabel ?? format(goal)}</text>
          </g>
        )}
        {barSeries.map((s, si) =>
          s.values.map((v, i) => v == null || v <= 0 ? null : (
            <rect key={`${s.key}-${i}`} x={x(i) - (barW * barSeries.length) / 2 + si * barW} y={y(v)} width={barW - 2} height={Math.max(PAD.top + innerH - y(v), 1)} fill={s.color} opacity={hover === i ? 1 : 0.85} rx={2} />
          )),
        )}
        {series.filter((s) => s.kind !== 'bar').map((s) => {
          const path = linePath(s.values);
          const firstIdx = s.values.findIndex((v) => v != null);
          const lastIdx = s.values.length - 1 - [...s.values].reverse().findIndex((v) => v != null);
          return (
            <g key={s.key}>
              {s.area && !logScale && path && (
                <path d={`${path} L${x(lastIdx).toFixed(1)},${(PAD.top + innerH).toFixed(1)} L${x(firstIdx).toFixed(1)},${(PAD.top + innerH).toFixed(1)} Z`} fill={s.color} opacity={0.08} />
              )}
              <path d={path} fill="none" stroke={s.color} strokeWidth={2} strokeDasharray={s.dashed ? '5 5' : undefined} strokeOpacity={s.dashed ? 0.7 : 1} />
              {s.values.map((v, i) => v == null ? null : (
                <circle key={i} cx={x(i)} cy={y(v)} r={hover === i ? 4 : 2.5} fill={s.dashed ? 'var(--t-background-primary)' : s.color} stroke={s.color} strokeWidth={1.5} />
              ))}
            </g>
          );
        })}
        {hover != null && <line data-cross x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + innerH} />}
        {labels.map((label, i) => (i % labelEvery === 0 || i === n - 1) && (
          <text key={i} x={x(i)} y={H - 8} textAnchor="middle" data-muted={mutedFrom != null && i >= mutedFrom ? '' : undefined}>{label}</text>
        ))}
        {labels.map((_, i) => (
          <rect key={i} x={x(i) - stepX / 2} y={PAD.top} width={stepX} height={innerH} fill="transparent" onMouseEnter={() => setHover(i)} />
        ))}
      </svg>
      {hover != null && (
        <StyledReadout style={{ left: `${Math.min(Math.max((x(hover) / W) * 100 - 8, 0), 72)}%` }}>
          <div data-title>{sublabels?.[hover] ?? labels[hover]}</div>
          {series.map((s) => s.values[hover] == null ? null : (
            <div key={s.key} data-line><span data-dot style={{ background: s.color }} /><span>{s.label}</span><b>{format(s.values[hover] as number)}</b></div>
          ))}
        </StyledReadout>
      )}
    </StyledWrap>
  );
};
