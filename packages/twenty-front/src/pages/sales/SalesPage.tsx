import { styled } from '@linaria/react';
import { useEffect, useState } from 'react';
import Skeleton, { SkeletonTheme } from 'react-loading-skeleton';
import { IconArrowUpRight, IconRefresh, IconX } from 'twenty-ui/icon';
import { Button } from 'twenty-ui/input';
import { Tag } from 'twenty-ui/data-display';
import { themeCssVariables as t } from 'twenty-ui/theme-constants';

import { PageHeader } from '@/ui/layout/page/components/PageHeader';
import { IconSales } from '@/custom-pages/os/IconSales';
import { Chart } from '@/custom-pages/os/Chart';
import {
  fetchAttributionSplit,
  fetchConversion,
  fetchCustomerCounts,
  fetchDashboardMetrics,
  fetchGrowth,
  fetchLastSync,
  fetchMonthlyMetrics,
  fetchRangeMetrics,
  fetchShowUp,
  refreshStepped,
  REFRESH_STEPS,
  type AttributionSplit,
  type Conversion,
  type CustomerCounts,
  type DashboardMetrics,
  type Growth,
  type MonthlyRow,
  type RangeMetrics,
  type ShowUp,
} from '@/custom-pages/os/data';

// Drill-down pages (records, customers, setters, churn) still live in the OS app.
// When VITE_OS_URL is set, tiles link out to them; otherwise they are plain tiles.
const OS_BASE_URL: string = (import.meta.env.VITE_OS_URL ?? '').replace(/\/$/, '');
const osHref = (path?: string) => (OS_BASE_URL && path ? `${OS_BASE_URL}${path}` : undefined);

const ACCENT = 'var(--t-color-blue, #1b4498)';
const POSITIVE = t.tag.text.green;
const CAUTION = t.tag.text.orange;

/* ---------------------------------------------------------------- */
/*  date helpers for the custom range picker                         */
/* ---------------------------------------------------------------- */
const isoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
const rangePreset = (kind: string): { from: string; to: string } => {
  const today = new Date();
  const dow = (today.getDay() + 6) % 7; // 0 = Monday
  if (kind === 'this-week') return { from: isoDate(addDays(today, -dow)), to: isoDate(today) };
  if (kind === 'last-week') return { from: isoDate(addDays(today, -dow - 7)), to: isoDate(addDays(today, -dow - 1)) };
  if (kind === 'last-30') return { from: isoDate(addDays(today, -29)), to: isoDate(today) };
  return { from: isoDate(addDays(today, -6)), to: isoDate(today) };
};
const fmtRange = (from: string, to: string) => {
  const f = new Date(from + 'T00:00:00');
  const tt = new Date(to + 'T00:00:00');
  const o: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short' };
  return from === to
    ? f.toLocaleDateString('en-GB', { ...o, year: 'numeric' })
    : `${f.toLocaleDateString('en-GB', o)} – ${tt.toLocaleDateString('en-GB', { ...o, year: 'numeric' })}`;
};
const fmtUsd = (n: number) => '$' + Math.round(n).toLocaleString();
const fmtWhen = (s: string | null) =>
  s ? new Date(s).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';

/* ---------------------------------------------------------------- */
/*  styled (Twenty tokens only)                                      */
/* ---------------------------------------------------------------- */
const StyledPage = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  background: ${t.background.noisy};
  color: ${t.font.color.primary};
  font-family: ${t.font.family};
  font-size: ${t.font.size.md};
`;

const StyledBody = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: ${t.spacing[4]};
`;

const StyledContent = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${t.spacing[4]};
  margin: 0 auto;
  max-width: 1240px;
  width: 100%;
`;

const StyledHeaderActions = styled.div`
  align-items: center;
  display: flex;
  gap: ${t.spacing[3]};
`;

const StyledHeaderMeta = styled.div`
  color: ${t.font.color.tertiary};
  font-size: ${t.font.size.xs};
  white-space: nowrap;
  span {
    color: ${t.font.color.secondary};
    font-variant-numeric: tabular-nums;
  }
`;

const StyledProgress = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${t.spacing[1]};
  width: 200px;
  div[data-track] {
    background: ${t.background.tertiary};
    border-radius: ${t.border.radius.pill};
    height: 3px;
    overflow: hidden;
    width: 100%;
  }
  div[data-fill] {
    background: ${ACCENT};
    height: 100%;
    transition: width 0.3s ease-out;
  }
`;

const StyledCard = styled.div`
  background: ${t.background.primary};
  border: 1px solid ${t.border.color.medium};
  border-radius: ${t.border.radius.md};
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  padding: ${t.spacing[4]};
  min-width: 0;
`;

const StyledCardHead = styled.div`
  align-items: center;
  display: flex;
  justify-content: space-between;
  margin-bottom: ${t.spacing[3]};
  gap: ${t.spacing[2]};
`;

const StyledCardTitle = styled.div`
  color: ${t.font.color.primary};
  font-size: ${t.font.size.md};
  font-weight: ${t.font.weight.medium};
`;

const StyledCardHint = styled.div`
  color: ${t.font.color.tertiary};
  font-size: ${t.font.size.xs};
  text-align: right;
`;

const StyledLabel = styled.div`
  color: ${t.font.color.tertiary};
  font-size: ${t.font.size.xs};
  font-weight: ${t.font.weight.medium};
`;

const StyledBigValue = styled.div`
  color: ${t.font.color.primary};
  font-size: ${t.font.size.xl};
  font-weight: ${t.font.weight.semiBold};
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
`;

const StyledSub = styled.span`
  color: ${t.font.color.tertiary};
  font-size: ${t.font.size.xs};
  margin-left: ${t.spacing[2]};
`;

const StyledGrid2 = styled.div`
  display: grid;
  gap: ${t.spacing[4]};
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
`;

const StyledGrid6 = styled.div`
  display: grid;
  gap: ${t.spacing[3]};
  grid-template-columns: repeat(6, minmax(0, 1fr));
  @media (max-width: 640px) {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
`;

const StyledGrid3 = styled.div`
  display: grid;
  gap: ${t.spacing[4]};
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
`;

const StyledRow = styled.div`
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: ${t.spacing[2]};
`;

const StyledGoal = styled.div`
  align-items: flex-end;
  display: flex;
  flex-direction: column;
  gap: ${t.spacing[1]};
  div[data-track] {
    background: ${t.background.tertiary};
    border-radius: ${t.border.radius.pill};
    height: 4px;
    overflow: hidden;
    width: 96px;
  }
  div[data-fill] {
    background: ${ACCENT};
    height: 100%;
  }
  b {
    color: ${ACCENT};
    font-weight: ${t.font.weight.medium};
  }
`;

const StyledTile = styled.a`
  background: ${t.background.primary};
  border: 1px solid ${t.border.color.medium};
  border-radius: ${t.border.radius.md};
  box-sizing: border-box;
  color: inherit;
  display: flex;
  flex-direction: column;
  gap: ${t.spacing[2]};
  min-height: 92px;
  min-width: 0;
  padding: ${t.spacing[3]};
  text-decoration: none;
  transition: ${t.clickableElementBackgroundTransition};
  &[href] {
    cursor: pointer;
  }
  &[href]:hover {
    background: ${t.background.transparent.light};
    border-color: ${t.border.color.strong};
  }
  div[data-label] {
    align-items: center;
    color: ${t.font.color.tertiary};
    display: flex;
    font-size: ${t.font.size.xs};
    font-weight: ${t.font.weight.medium};
    gap: ${t.spacing[1]};
    justify-content: space-between;
    min-width: 0;
    span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }
  div[data-value] {
    color: ${t.font.color.primary};
    font-size: clamp(15px, 1.6vw, 20px);
    font-weight: ${t.font.weight.semiBold};
    font-variant-numeric: tabular-nums;
    line-height: 1.2;
    margin-top: auto;
  }
  div[data-delta] {
    font-size: ${t.font.size.xs};
  }
  div[data-delta='positive'] {
    color: ${POSITIVE};
  }
  div[data-delta='caution'] {
    color: ${CAUTION};
  }
`;

const StyledRangeBox = styled.div`
  align-items: center;
  background: ${t.background.primary};
  border: 1px solid ${t.border.color.medium};
  border-radius: ${t.border.radius.md};
  display: flex;
  flex-wrap: wrap;
  gap: ${t.spacing[2]};
  padding: ${t.spacing[2]} ${t.spacing[3]};
  &[data-active] {
    border-color: ${t.border.color.blue};
    background: ${t.background.transparent.blue};
  }
`;

const StyledDivider = styled.span`
  background: ${t.border.color.medium};
  height: 16px;
  margin: 0 ${t.spacing[1]};
  width: 1px;
`;

const StyledDateLabel = styled.label`
  align-items: center;
  color: ${t.font.color.tertiary};
  display: flex;
  font-size: ${t.font.size.sm};
  gap: ${t.spacing[1]};
  input {
    background: ${t.background.primary};
    border: 1px solid ${t.border.color.medium};
    border-radius: ${t.border.radius.sm};
    box-sizing: border-box;
    color: ${t.font.color.primary};
    font-family: inherit;
    font-size: ${t.font.size.sm};
    height: 24px;
    outline: none;
    padding: 0 ${t.spacing[2]};
  }
  input:focus {
    border-color: ${t.border.color.blue};
  }
`;

const StyledBars = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${t.spacing[3]};
  div[data-row] {
    align-items: center;
    display: grid;
    gap: ${t.spacing[3]};
    grid-template-columns: minmax(150px, 210px) 1fr 56px 40px;
  }
  div[data-stage] {
    color: ${t.font.color.secondary};
    font-size: ${t.font.size.sm};
    em {
      color: ${POSITIVE};
      font-size: ${t.font.size.xs};
      font-style: normal;
      margin-left: ${t.spacing[1]};
    }
  }
  div[data-track] {
    background: ${t.background.tertiary};
    border-radius: ${t.border.radius.pill};
    height: 8px;
    overflow: hidden;
  }
  div[data-fill] {
    background: ${ACCENT};
    border-radius: ${t.border.radius.pill};
    height: 100%;
  }
  div[data-fill='muted'] {
    background: ${t.font.color.extraLight};
  }
  div[data-fill='positive'] {
    background: ${POSITIVE};
  }
  div[data-fill='caution'] {
    background: ${CAUTION};
  }
  div[data-num] {
    color: ${t.font.color.primary};
    font-size: ${t.font.size.sm};
    font-variant-numeric: tabular-nums;
    text-align: right;
  }
  div[data-pct] {
    color: ${t.font.color.tertiary};
    font-size: ${t.font.size.xs};
    font-variant-numeric: tabular-nums;
    text-align: right;
  }
`;

const StyledFootnote = styled.p`
  color: ${t.font.color.tertiary};
  font-size: ${t.font.size.xs};
  margin: ${t.spacing[4]} 0 0;
`;

const StyledTable = styled.table`
  border-collapse: collapse;
  font-size: ${t.font.size.sm};
  width: 100%;
  th {
    border-bottom: 1px solid ${t.border.color.light};
    color: ${t.font.color.tertiary};
    font-size: ${t.font.size.xs};
    font-weight: ${t.font.weight.medium};
    padding: 0 ${t.spacing[2]} ${t.spacing[2]};
    text-align: right;
  }
  th:first-child,
  td:first-child {
    text-align: left;
    padding-left: ${t.spacing[2]};
  }
  td {
    border-bottom: 1px solid ${t.border.color.light};
    color: ${t.font.color.primary};
    font-variant-numeric: tabular-nums;
    padding: ${t.spacing[2]};
    text-align: right;
  }
  tr:last-child td {
    border-bottom: 0;
  }
  td[data-muted] {
    color: ${t.font.color.secondary};
  }
  td[data-positive] {
    color: ${POSITIVE};
  }
  td[data-accent] {
    color: ${ACCENT};
  }
  tbody tr[data-clickable] {
    cursor: pointer;
    transition: ${t.clickableElementBackgroundTransition};
  }
  tbody tr[data-clickable]:hover {
    background: ${t.background.transparent.light};
  }
  tbody tr[data-selected] {
    background: ${t.background.transparent.blue};
  }
`;

const StyledStat3 = styled.div`
  border-top: 1px solid ${t.border.color.light};
  display: grid;
  gap: ${t.spacing[2]};
  grid-template-columns: repeat(3, 1fr);
  margin-top: ${t.spacing[4]};
  padding-top: ${t.spacing[3]};
  div[data-k] {
    color: ${t.font.color.tertiary};
    font-size: ${t.font.size.xs};
  }
  div[data-v] {
    color: ${t.font.color.primary};
    font-size: ${t.font.size.md};
    font-weight: ${t.font.weight.medium};
    font-variant-numeric: tabular-nums;
    margin-top: ${t.spacing[1]};
  }
  div[data-v='positive'] {
    color: ${POSITIVE};
  }
`;

const StyledError = styled.div`
  background: ${t.background.transparent.danger};
  border: 1px solid ${t.border.color.danger};
  border-radius: ${t.border.radius.md};
  color: ${t.font.color.danger};
  font-size: ${t.font.size.sm};
  padding: ${t.spacing[3]};
`;

const StyledFooter = styled.div`
  border-top: 1px solid ${t.border.color.light};
  color: ${t.font.color.tertiary};
  display: flex;
  font-size: ${t.font.size.xs};
  justify-content: space-between;
  margin-top: ${t.spacing[4]};
  padding-top: ${t.spacing[3]};
  b {
    color: ${POSITIVE};
    font-weight: ${t.font.weight.medium};
  }
`;

/* ---------------------------------------------------------------- */
/*  small pieces                                                     */
/* ---------------------------------------------------------------- */
const LinkedInTrend = ({ data }: { data: DashboardMetrics['linkedin_monthly'] }) => {
  const W = 360;
  const H = 90;
  const P = 6;
  const vals = data.map((d) => d.cumulative);
  const max = Math.max(...vals, 1);
  const stepX = (W - P * 2) / Math.max(vals.length - 1, 1);
  const pts = vals.map((v, i) => [P + stepX * i, H - P - (v / max) * (H - P * 2)] as const);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const area = `${line} L${W - P},${H - P} L${P},${H - P} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ height: 90, width: '100%', display: 'block' }} preserveAspectRatio="none">
      <defs>
        <linearGradient id="liFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={ACCENT} stopOpacity="0.18" />
          <stop offset="100%" stopColor={ACCENT} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#liFill)" />
      <path d={line} fill="none" stroke={ACCENT} strokeWidth="2" />
      {pts.map((p, i) => (
        <circle key={i} cx={p[0]} cy={p[1]} r="2.5" fill={ACCENT} />
      ))}
    </svg>
  );
};

type Kpi = { label: string; value: string; delta: string; tone: 'positive' | 'caution'; to?: string };

const KpiTile = ({ kpi }: { kpi: Kpi }) => {
  const href = osHref(kpi.to);
  return (
    <StyledTile href={href} target={href ? '_blank' : undefined} rel={href ? 'noreferrer' : undefined}>
      <div data-label>
        <span>{kpi.label}</span>
        {href && <IconArrowUpRight size={12} />}
      </div>
      <div data-value>{kpi.value}</div>
      <div data-delta={kpi.tone}>{kpi.delta}</div>
    </StyledTile>
  );
};

const PillButton = ({ active, onClick, title }: { active: boolean; onClick: () => void; title: string }) => (
  <Button
    size="small"
    variant={active ? 'primary' : 'secondary'}
    accent={active ? 'blue' : 'default'}
    title={title}
    onClick={onClick}
  />
);

/* ---------------------------------------------------------------- */
/*  page                                                             */
/* ---------------------------------------------------------------- */
const OperatingSystem = () => {
  const [m, setM] = useState<DashboardMetrics | null>(null);
  const [showUp, setShowUp] = useState<ShowUp | null>(null);
  const [split, setSplit] = useState<AttributionSplit | null>(null);
  const [conv, setConv] = useState<Conversion | null>(null);
  const [growth, setGrowth] = useState<Growth | null>(null);
  const [monthly, setMonthly] = useState<MonthlyRow[]>([]);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [period, setPeriod] = useState<string>(() => new Date().toISOString().slice(0, 7)); // default: current month
  const [range, setRange] = useState<{ from: string; to: string } | null>(null); // custom date range (overrides period)
  const [rangeM, setRangeM] = useState<RangeMetrics | null>(null);
  const [counts, setCounts] = useState<CustomerCounts | null>(null); // new/churned customers for the active period
  const [err, setErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; label: string } | null>(null);
  const [syncStatus, setSyncStatus] = useState<{ ok: boolean; at: Date; msg?: string } | null>(null);

  const load = async () => {
    try {
      setM(await fetchDashboardMetrics());
      setErr(null);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    }
    try { setShowUp(await fetchShowUp()); } catch { /* noop */ }
    try { setSplit(await fetchAttributionSplit()); } catch { /* noop */ }
    try { setConv(await fetchConversion()); } catch { /* noop */ }
    try { setGrowth(await fetchGrowth()); } catch { /* noop */ }
    try { setMonthly(await fetchMonthlyMetrics()); } catch { /* noop */ }
    try { setLastSync(await fetchLastSync()); } catch { /* noop */ }
  };
  useEffect(() => { load(); }, []);

  // If the current month isn't in the data yet, fall back to the most recent month with data.
  useEffect(() => {
    if (monthly.length && period !== 'all' && !monthly.some((r) => r.month_key === period)) {
      setPeriod([...monthly].sort((a, b) => b.month_key.localeCompare(a.month_key))[0].month_key);
    }
  }, [monthly, period]);

  // Load range metrics whenever a custom range is set (and on refresh).
  useEffect(() => {
    if (range?.from && range?.to) fetchRangeMetrics(range.from, range.to).then(setRangeM).catch(() => setRangeM(null));
    else setRangeM(null);
  }, [range]);

  // New/churned customer counts for whichever period is active (range > month > all-time).
  useEffect(() => {
    const mth = range ? null : period !== 'all' ? period : null;
    fetchCustomerCounts(mth, range?.from ?? null, range?.to ?? null).then(setCounts).catch(() => setCounts(null));
  }, [range, period]);

  const refresh = async () => {
    setRefreshing(true);
    setSyncStatus(null);
    setProgress({ done: 0, total: REFRESH_STEPS.length, label: 'Starting…' });
    let syncErr: string | null = null;
    try {
      await refreshStepped((done, total, label) => setProgress({ done, total, label }));
    } catch (e) {
      syncErr = (e as Error).message;
    }
    // Always re-query so the page reflects whatever did sync, then confirm the outcome.
    try {
      await load();
      if (range?.from && range?.to) setRangeM(await fetchRangeMetrics(range.from, range.to).catch(() => null));
    } catch { /* best-effort reload */ }
    setRefreshing(false);
    setProgress(null);
    setSyncStatus(syncErr ? { ok: false, at: new Date(), msg: syncErr } : { ok: true, at: new Date() });
  };

  const mo = !range && period !== 'all' ? monthly.find((r) => r.month_key === period) : null;
  const cancelRate = m ? ((m.kpis.appts_canceled / Math.max(m.kpis.appts_booked, 1)) * 100).toFixed(1) : '—';
  const heldRate = m ? Math.round((m.kpis.appts_held / Math.max(m.kpis.appts_booked, 1)) * 100) : 0;
  const rq = range ? `&from=${range.from}&to=${range.to}` : '';
  const liTile: Kpi = {
    label: 'Active LinkedIn accounts',
    value: String(m?.linkedin.active ?? 0),
    delta: `${m?.linkedin.total ?? 0} connected`,
    tone: 'positive',
    to: '/setters',
  };
  const moLabel = mo ? mo.month.replace(' 2026', '') : '';

  const northStar: Kpi[] = m
    ? [
        { label: 'Trials started', value: (split?.trials.total ?? m.trials_started ?? 0).toLocaleString(), delta: 'All trials', tone: 'positive', to: '/records?type=trials' },
        { label: 'New customers', value: String(counts?.new ?? split?.sales.total ?? 0), delta: 'Paying · total', tone: 'positive', to: '/records?type=new_customers' },
        { label: 'Churned customers', value: String(counts?.churned ?? 0), delta: 'Lifetime', tone: 'caution', to: '/records?type=churned_customers' },
        { label: 'Cash collected', value: fmtUsd(m.revenue?.total_collected ?? 0), delta: 'Lifetime', tone: 'positive', to: '/customers?b=all' },
        { label: 'Paid subscribers', value: String(growth?.current_subscribers ?? 0), delta: 'Active', tone: 'positive', to: '/customers?b=all' },
        liTile,
      ]
    : [];

  const rangeKpis: Kpi[] = range && rangeM
    ? [
        { label: 'Trials started', value: String(rangeM.trials_total), delta: 'In range', tone: 'positive', to: `/records?type=trials${rq}` },
        { label: 'New customers', value: String(counts?.new ?? rangeM.sales_total), delta: 'In range', tone: 'positive', to: `/records?type=new_customers${rq}` },
        { label: 'Churned customers', value: String(counts?.churned ?? 0), delta: 'In range', tone: 'caution', to: `/records?type=churned_customers${rq}` },
        { label: 'Cash collected', value: fmtUsd(rangeM.cash_collected), delta: 'In range', tone: 'positive', to: '/customers?b=all' },
        { label: 'Paid subscribers', value: String(growth?.current_subscribers ?? 0), delta: 'Current', tone: 'positive', to: '/customers?b=all' },
        liTile,
      ]
    : [];

  const kpis: Kpi[] = range && rangeM
    ? rangeKpis
    : mo
      ? [
          { label: 'Trials started', value: String(split?.trials.monthly[mo.month_key]?.total ?? mo.trials ?? 0), delta: moLabel, tone: 'positive', to: `/records?type=trials&month=${mo.month_key}` },
          { label: 'New customers', value: String(counts?.new ?? split?.sales.monthly[mo.month_key]?.total ?? mo.new_sales ?? 0), delta: moLabel, tone: 'positive', to: `/records?type=new_customers&month=${mo.month_key}` },
          { label: 'Churned customers', value: String(counts?.churned ?? 0), delta: moLabel, tone: 'caution', to: `/records?type=churned_customers&month=${mo.month_key}` },
          { label: 'Cash collected', value: fmtUsd(mo.cash_collected), delta: moLabel, tone: 'positive', to: '/customers?b=all' },
          { label: 'Paid subscribers', value: String(growth?.current_subscribers ?? 0), delta: 'Current', tone: 'positive', to: '/customers?b=all' },
          liTile,
        ]
      : northStar;

  // Funnel uses the SAME numbers as the Show-up and Therapon pages so nothing can diverge.
  const fHeld = showUp?.held ?? 0;
  const fAttended = showUp?.recorded ?? 0;
  const fTrials = conv?.total.sat_trials ?? 0;
  const fSales = split?.sales.therapon ?? 0;
  const booked = Math.max(m?.kpis.appts_booked ?? 0, 1);
  const funnel = m
    ? [
        { stage: 'Appointments booked', value: m.kpis.appts_booked, pct: 100 },
        { stage: 'Appointments held', value: fHeld, pct: Math.round((fHeld / booked) * 100) },
        { stage: 'Appointments sat', value: fAttended, pct: Math.round((fAttended / booked) * 100) },
        { stage: 'Started a trial', value: fTrials, pct: Math.round((fTrials / booked) * 100) },
        { stage: 'Became a sale', value: fSales, pct: Math.round((fSales / booked) * 100) },
      ]
    : [];

  const orgTrials = split ? split.trials.total - split.trials.therapon : 0;
  const orgSales = split ? split.sales.total - split.sales.therapon : 0;
  const orgRate = orgTrials ? Math.round((orgSales / orgTrials) * 100) : 0;
  const organic = split
    ? [
        { stage: 'Started a trial (no appointment)', value: orgTrials, pct: 100, note: null as string | null },
        { stage: 'Became a sale', value: orgSales, pct: orgRate, note: `${orgRate}% convert` },
      ]
    : [];

  const arrPct = growth ? Math.round((growth.current_arr / growth.arr_goal) * 100) : 0;
  const churnHref = osHref('/churn');
  const monthPills = [{ key: 'all', label: 'All time' }, ...monthly.map((r) => ({ key: r.month_key, label: r.month.replace(' 2026', " '26") }))];
  const presets = [
    { k: 'this-week', label: 'This week' },
    { k: 'last-week', label: 'Last week' },
    { k: 'last-7', label: 'Last 7 days' },
    { k: 'last-30', label: 'Last 30 days' },
  ];

  return (
    <StyledPage>
      <PageHeader title="Sales" Icon={IconSales}>
        <StyledHeaderActions>
          {refreshing && progress ? (
            <StyledProgress>
              <StyledHeaderMeta>
                {progress.label} <span>{progress.done}/{progress.total}</span>
              </StyledHeaderMeta>
              <div data-track>
                <div data-fill style={{ width: `${(progress.done / progress.total) * 100}%` }} />
              </div>
            </StyledProgress>
          ) : (
            <>
              {syncStatus && (
                <span title={syncStatus.msg}>
                  <Tag
                    color={syncStatus.ok ? 'green' : 'orange'}
                    text={syncStatus.ok ? `Refreshed ${syncStatus.at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : 'Refresh failed'}
                  />
                </span>
              )}
              <StyledHeaderMeta>
                Last sync <span>{lastSync ? fmtWhen(lastSync) : 'syncing…'}</span>
              </StyledHeaderMeta>
            </>
          )}
          <Button size="small" variant="secondary" Icon={IconRefresh} title={refreshing ? 'Syncing…' : 'Refresh'} onClick={refresh} disabled={refreshing} />
        </StyledHeaderActions>
      </PageHeader>

      <StyledBody>
        <SkeletonTheme baseColor={'var(--t-background-tertiary)'} highlightColor={'var(--t-background-transparent-lighter)'} borderRadius={4}>
          <StyledContent>
            {err && <StyledError>Could not load metrics: {err}</StyledError>}

            {/* Business health — ARR + paid subscribers */}
            <StyledGrid2>
              <StyledCard>
                <StyledCardHead>
                  <div>
                    <StyledLabel>Annual run rate</StyledLabel>
                    <StyledBigValue>
                      {growth ? fmtUsd(growth.current_arr) : <Skeleton width={120} />}
                      {growth && <StyledSub>{fmtUsd(growth.current_mrr)} MRR</StyledSub>}
                    </StyledBigValue>
                  </div>
                  <StyledGoal>
                    <StyledLabel>
                      Goal $1M · <b>{growth ? `${arrPct}%` : ''}</b>
                    </StyledLabel>
                    {growth && (
                      <div data-track>
                        <div data-fill style={{ width: `${Math.min(100, arrPct)}%` }} />
                      </div>
                    )}
                  </StyledGoal>
                </StyledCardHead>
                <Chart
                  data={(growth?.series ?? []).map((s) => ({ label: s.month.slice(2).replace('-', '/'), value: s.arr, sublabel: s.month }))}
                  format={(n) => fmtUsd(n)}
                  height={84}
                  mini
                  zoom
                />
              </StyledCard>

              <StyledCard>
                <StyledCardHead>
                  <div>
                    <StyledLabel>Paid subscribers</StyledLabel>
                    <StyledBigValue>
                      {growth ? growth.current_subscribers.toLocaleString() : <Skeleton width={60} />}
                      {growth && <StyledSub>active paid</StyledSub>}
                    </StyledBigValue>
                  </div>
                  {churnHref && (
                    <a href={churnHref} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
                      <Button size="small" variant="tertiary" Icon={IconArrowUpRight} title="Churn" />
                    </a>
                  )}
                </StyledCardHead>
                <Chart
                  data={(growth?.series ?? []).map((s) => ({ label: s.month.slice(2).replace('-', '/'), value: s.subscribers, sublabel: s.month }))}
                  format={(n) => Math.round(n).toLocaleString()}
                  color={POSITIVE}
                  height={84}
                  mini
                  zoom
                />
              </StyledCard>
            </StyledGrid2>

            {/* Period pills */}
            <StyledRow>
              <StyledLabel>Period</StyledLabel>
              {monthPills.map((p) => (
                <PillButton key={p.key} title={p.label} active={!range && period === p.key} onClick={() => { setRange(null); setPeriod(p.key); }} />
              ))}
            </StyledRow>

            {/* Custom date range picker */}
            <StyledRangeBox data-active={range ? '' : undefined}>
              <StyledLabel>Custom range</StyledLabel>
              {presets.map((p) => {
                const pr = rangePreset(p.k);
                const active = range?.from === pr.from && range?.to === pr.to;
                return <PillButton key={p.k} title={p.label} active={active} onClick={() => setRange(pr)} />;
              })}
              <StyledDivider />
              <StyledDateLabel>
                From
                <input
                  type="date"
                  value={range?.from ?? ''}
                  max={range?.to || undefined}
                  onChange={(e) => { const v = e.target.value; if (v) setRange((r) => ({ from: v, to: r?.to && r.to >= v ? r.to : v })); }}
                />
              </StyledDateLabel>
              <StyledDateLabel>
                To
                <input
                  type="date"
                  value={range?.to ?? ''}
                  min={range?.from || undefined}
                  onChange={(e) => { const v = e.target.value; if (v) setRange((r) => ({ from: r?.from && r.from <= v ? r.from : v, to: v })); }}
                />
              </StyledDateLabel>
              {range && (
                <>
                  <Tag color="blue" text={`${fmtRange(range.from, range.to)}${rangeM ? '' : ' · loading…'}`} weight="medium" />
                  <Button size="small" variant="tertiary" Icon={IconX} title="Clear" onClick={() => setRange(null)} />
                </>
              )}
            </StyledRangeBox>

            {/* North star KPIs */}
            <StyledGrid6>
              {m
                ? kpis.map((k) => <KpiTile key={k.label} kpi={k} />)
                : Array.from({ length: 6 }).map((_, i) => (
                    <StyledTile key={i}>
                      <Skeleton width={90} height={10} />
                      <Skeleton width={60} height={22} />
                      <Skeleton width={40} height={10} />
                    </StyledTile>
                  ))}
            </StyledGrid6>

            {/* Funnels + month table */}
            <StyledGrid2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--t-spacing-4)' }}>
                <StyledCard>
                  <StyledCardHead>
                    <StyledCardTitle>Appointment → sale funnel</StyledCardTitle>
                    <StyledCardHint>Booked a call · since 30 Mar</StyledCardHint>
                  </StyledCardHead>
                  <StyledBars>
                    {funnel.map((r) => {
                      const note = r.stage === 'Appointments sat' && showUp ? `${Math.round(showUp.rate)}% show-up` : null;
                      return (
                        <div data-row key={r.stage}>
                          <div data-stage>
                            {r.stage}
                            {note && <em>({note})</em>}
                          </div>
                          <div data-track><div data-fill style={{ width: `${r.pct}%` }} /></div>
                          <div data-num>{r.value.toLocaleString()}</div>
                          <div data-pct>{r.pct}%</div>
                        </div>
                      );
                    })}
                    {!m && Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} height={16} />)}
                  </StyledBars>
                </StyledCard>

                <StyledCard>
                  <StyledCardHead>
                    <StyledCardTitle>Organic → sale funnel</StyledCardTitle>
                    <StyledCardHint>No booked call · self-serve</StyledCardHint>
                  </StyledCardHead>
                  <StyledBars>
                    {organic.map((r) => (
                      <div data-row key={r.stage}>
                        <div data-stage>
                          {r.stage}
                          {r.note && <em>({r.note})</em>}
                        </div>
                        <div data-track><div data-fill="muted" style={{ width: `${r.pct}%` }} /></div>
                        <div data-num>{r.value.toLocaleString()}</div>
                        <div data-pct>{r.pct}%</div>
                      </div>
                    ))}
                  </StyledBars>
                  <StyledFootnote>
                    Signed up with no booked call · {orgRate}% trial→sale vs {fTrials ? Math.round((fSales / fTrials) * 100) : 0}% on the appointment path
                  </StyledFootnote>
                </StyledCard>
              </div>

              <StyledCard>
                <StyledCardHead>
                  <StyledCardTitle>Month by month</StyledCardTitle>
                  <StyledCardHint>Click a month to filter</StyledCardHint>
                </StyledCardHead>
                <div style={{ overflowX: 'auto' }}>
                  <StyledTable>
                    <thead>
                      <tr>
                        <th>Month</th>
                        {([
                          ['Booked', 'New appointments booked'],
                          ['Sat', 'Attended — Fathom-confirmed show-ups'],
                          ['Sales', 'Successful transactions this month (includes recurring payments)'],
                          ['New', 'New paying customers — first-ever payment this month'],
                          ['Cash', 'Cash collected this month'],
                        ] as [string, string][]).map(([h, tip]) => (
                          <th key={h} title={tip}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {monthly.map((row) => (
                        <tr
                          key={row.month_key}
                          data-clickable
                          data-selected={!range && period === row.month_key ? '' : undefined}
                          onClick={() => { setRange(null); setPeriod(period === row.month_key ? 'all' : row.month_key); }}
                        >
                          <td data-muted>{row.month.replace(' 2026', '')}</td>
                          <td>{row.booked}</td>
                          <td data-positive>{row.sat}</td>
                          <td>{row.transactions}</td>
                          <td data-accent>{row.new_customers}</td>
                          <td>{fmtUsd(row.cash_collected)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </StyledTable>
                </div>
              </StyledCard>
            </StyledGrid2>

            {/* Bottom row */}
            <StyledGrid3>
              <StyledCard>
                <StyledCardHead>
                  <StyledCardTitle>Subscriptions</StyledCardTitle>
                </StyledCardHead>
                <StyledTable>
                  <tbody>
                    {m &&
                      ([
                        ['Total customers', m.subs.total],
                        ['Active', m.subs.active],
                        ['Trialing', m.subs.trialing],
                        ['Ever paid', m.subs.ever_paid],
                        ['Cancel rate', `${cancelRate}%`],
                      ] as [string, string | number][]).map(([k, v]) => (
                        <tr key={k}>
                          <td data-muted>{k}</td>
                          <td>{v}</td>
                        </tr>
                      ))}
                  </tbody>
                </StyledTable>
              </StyledCard>

              <StyledCard style={{ gridColumn: 'span 2' }}>
                <StyledCardHead>
                  <StyledCardTitle>Active LinkedIn accounts doing outreach</StyledCardTitle>
                  <StyledCardHint>jamal@conversifi.io</StyledCardHint>
                </StyledCardHead>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--t-spacing-6)' }}>
                  <div>
                    <StyledBigValue style={{ fontSize: 'var(--t-font-size-xxl)' }}>{m ? m.linkedin.active : '—'}</StyledBigValue>
                    <StyledLabel>in active campaign</StyledLabel>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>{m && <LinkedInTrend data={m.linkedin_monthly} />}</div>
                </div>
                <StyledStat3>
                  <div><div data-k>In campaign</div><div data-v="positive">{m?.linkedin.active}</div></div>
                  <div><div data-k>Idle</div><div data-v>{m?.linkedin.idle}</div></div>
                  <div><div data-k>Connected</div><div data-v>{m?.linkedin.total}</div></div>
                </StyledStat3>
              </StyledCard>
            </StyledGrid3>

            <StyledFooter>
              <span>Live · Calendly · Fathom · Stripe · Supabase · Central Brain</span>
              <span>Company-wide · <b>real-time</b></span>
            </StyledFooter>
          </StyledContent>
        </SkeletonTheme>
      </StyledBody>
    </StyledPage>
  );
};

export const SalesPage = OperatingSystem;
