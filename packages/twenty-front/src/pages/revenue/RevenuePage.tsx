import { styled } from '@linaria/react';
import { useEffect, useMemo, useState } from 'react';
import Skeleton, { SkeletonTheme } from 'react-loading-skeleton';
import { IconTrendingUp, IconX } from 'twenty-ui/icon';
import { Button } from 'twenty-ui/input';
import { themeCssVariables as t } from 'twenty-ui/theme-constants';

import { PageHeader } from '@/ui/layout/page/components/PageHeader';
import { Chart } from '@/custom-pages/os/Chart';
import { MultiChart } from '@/custom-pages/os/MultiChart';
import {
  ACCENT,
  CAUTION,
  fmtDate,
  fmtUsd,
  fmtUsd2,
  type Kpi,
  KpiTile,
  PillButton,
  POSITIVE,
  StyledBigValue,
  StyledBody,
  StyledCard,
  StyledCardHead,
  StyledCardHint,
  StyledCardTitle,
  StyledChip,
  StyledContent,
  StyledDivider,
  StyledError,
  StyledFootnote,
  StyledGrid2,
  StyledGrid4,
  StyledGrid6,
  StyledHeaderActions,
  StyledLabel,
  StyledMuted,
  StyledPage,
  StyledReveal,
  StyledRow,
  StyledSub,
  StyledTable,
  StyledTextLink,
} from '@/custom-pages/os/ui';
import {
  type Churn,
  type ChurnExclusion,
  type ChurnListRow,
  type ChurnMonth,
  fetchChurn,
  fetchChurnExclusions,
  fetchChurnList,
  fetchGoalTracker,
  fetchGrowth,
  fetchTrialForecast,
  fetchUpcomingRenewals,
  type GoalMonth,
  type Growth,
  hideTrial,
  removeChurnExclusion,
  type Renewals,
  setChurnExclusion,
  type TrialForecast,
} from '@/custom-pages/os/data';

const mkLabel = (mk: string) => { const [y, m] = mk.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }); };
const mkLong = (mk: string) => { const [y, m] = mk.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }); };
const addMonths = (mk: string, n: number) => { const [y, m] = mk.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const thisMonth = new Date().toISOString().slice(0, 7);
const pct = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(Math.abs(x) >= 1 ? 0 : 1)}%`;
const fmtShort = (n: number) => n >= 1e9 ? `$${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}k` : `$${Math.round(n)}`;
const rateTone = (r: number | null): 'positive' | 'caution' | undefined => r == null ? undefined : r >= 15 ? 'caution' : r >= 7 ? undefined : 'positive';
const flag = (cc: string | null) => cc && /^[A-Z]{2}$/i.test(cc) ? String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)) : '🌐';

// The 9 month client ramp agreed in the OS: 45 → 246 new paying clients a month at a 50% trial rate.
const CLIENT_RAMP = [45, 54, 66, 79, 96, 116, 140, 169, 204, 246];
const TRIAL_RATE = 0.5;
const FORECAST_WINDOWS = [3, 7, 14, 30];

const StyledClickable = styled.button`
  background: none;
  border: 0;
  color: inherit;
  cursor: pointer;
  font: inherit;
  padding: 0;
  text-decoration: underline dotted transparent;
  text-underline-offset: 3px;
  transition: text-decoration-color 120ms cubic-bezier(0.2, 0, 0, 1);
  &:hover { text-decoration-color: currentColor; }
  &:focus-visible { outline: 2px solid ${t.color.blue}; outline-offset: 2px; border-radius: 2px; }
  &:disabled { cursor: default; text-decoration: none; }
`;

const StyledTakeaway = styled.p`
  background: ${t.background.tertiary};
  border-radius: ${t.border.radius.sm};
  color: ${t.font.color.secondary};
  font-size: ${t.font.size.md};
  line-height: 1.5;
  margin: ${t.spacing[3]} 0 0;
  padding: ${t.spacing[3]} ${t.spacing[4]};
  b { color: ${t.font.color.primary}; font-weight: ${t.font.weight.semiBold}; }
  span[data-note] { color: ${t.font.color.tertiary}; display: block; font-size: ${t.font.size.sm}; margin-top: ${t.spacing[1]}; }
`;

const StyledScroll = styled.div`
  max-height: 420px;
  overflow: auto;
`;

type Drill = { type: string; month: string | null; title: string };

const ChurnTable = ({ rows, showCancel, onExclude, busyId }: { rows: ChurnListRow[] | null; showCancel: boolean; onExclude?: (row: ChurnListRow) => void; busyId: string | null }) => (
  <StyledScroll>
    <StyledTable>
      <thead><tr><th>Customer</th><th>Plan</th><th>MRR</th><th>ARR impact</th>{showCancel && <th>Cancelled</th>}<th>Status</th>{onExclude && <th />}</tr></thead>
      <tbody>
        {rows === null && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 24 }}><StyledMuted>Loading…</StyledMuted></td></tr>}
        {rows?.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 24 }}><StyledMuted>None.</StyledMuted></td></tr>}
        {rows?.map((r) => (
          <tr key={r.customer_id}>
            <td>
              <StyledTextLink to={`/records?type=customer_payments&arg=${encodeURIComponent(r.customer_id)}&name=${encodeURIComponent(r.name)}&back=/revenue`}>{r.name}</StyledTextLink>
              {r.email && <StyledMuted style={{ marginLeft: 8 }}>{r.email}</StyledMuted>}
            </td>
            <td>{r.plan ?? '—'}</td>
            <td>{fmtUsd(r.mrr)}</td>
            <td style={{ color: CAUTION }}>{r.cancel_date ? `−${fmtUsd(r.arr)}` : fmtUsd(r.arr)}</td>
            {showCancel && <td>{fmtDate(r.cancel_date)}</td>}
            <td><StyledChip data-tone={r.status === 'active' ? 'positive' : 'caution'}>{r.status}</StyledChip></td>
            {onExclude && <td><Button size="small" variant="tertiary" title={busyId === r.customer_id ? '…' : 'Not churn'} disabled={busyId === r.customer_id} onClick={() => onExclude(r)} /></td>}
          </tr>
        ))}
      </tbody>
    </StyledTable>
  </StyledScroll>
);

export const RevenuePage = () => {
  const [growth, setGrowth] = useState<Growth | null>(null);
  const [churn, setChurn] = useState<Churn | null>(null);
  const [exclusions, setExclusions] = useState<ChurnExclusion[]>([]);
  const [goals, setGoals] = useState<GoalMonth[]>([]);
  const [renewals, setRenewals] = useState<Renewals | null>(null);
  const [trials, setTrials] = useState<TrialForecast | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [rateWindow, setRateWindow] = useState(4);
  const [horizon, setHorizon] = useState<'goal' | 12 | 36>('goal');
  const [drill, setDrill] = useState<Drill | null>(null);
  const [drillRows, setDrillRows] = useState<ChurnListRow[] | null>(null);
  const [showExclusions, setShowExclusions] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [forecastTab, setForecastTab] = useState<'renewals' | 'trials'>('renewals');
  const [days, setDays] = useState(7);
  const [hidingId, setHidingId] = useState<string | null>(null);

  const loadChurn = () => Promise.all([fetchChurn().then(setChurn), fetchChurnExclusions().then(setExclusions)]);
  useEffect(() => {
    fetchGrowth().then(setGrowth).catch((e) => setErr('Growth: ' + (e as Error).message));
    loadChurn().catch((e) => setErr('Churn: ' + (e as Error).message));
    fetchGoalTracker().then(setGoals).catch(() => setGoals([]));
  }, []);
  useEffect(() => {
    fetchUpcomingRenewals(days).then(setRenewals).catch(() => setRenewals(null));
    fetchTrialForecast(days).then(setTrials).catch(() => setTrials(null));
  }, [days]);
  useEffect(() => {
    if (!drill) return;
    setDrillRows(null);
    fetchChurnList(drill.type, drill.month).then(setDrillRows).catch(() => setDrillRows([]));
  }, [drill]);

  /* ---- ARR projection (same model as the OS page) ---- */
  const projection = useMemo(() => {
    const series = growth?.series ?? [];
    if (series.length < 2) return null;
    const last = series[series.length - 1];
    const goal = growth?.arr_goal || 1_000_000;
    const w = Math.min(rateWindow, series.length - 1);
    const base = series[series.length - 1 - w];
    const rate = base.arr > 0 ? Math.pow(last.arr / base.arr, 1 / w) - 1 : 0;
    const projected: { month: string; arr: number }[] = [];
    let arr = last.arr;
    let past = 0;
    for (let i = 1; i <= 60; i++) {
      arr = Math.round(arr * (1 + rate));
      projected.push({ month: addMonths(last.month, i), arr });
      if (horizon === 'goal') { if (arr >= goal) past++; if (past >= 2 || i >= 24) break; }
      else if (i >= horizon) break;
    }
    let milestone: { month: string; arr: number } | null = null;
    let m = last.arr;
    for (let i = 1; i <= 60 && !milestone; i++) { m = Math.round(m * (1 + rate)); if (m >= goal) milestone = { month: addMonths(last.month, i), arr: m }; }
    const mom = series.map((p, i) => (i === 0 || series[i - 1].arr === 0 ? null : p.arr / series[i - 1].arr - 1));
    const latestMom = mom[mom.length - 1];
    const peakMom = Math.max(...mom.filter((v): v is number => v != null), 0);
    const fourAgo = series[Math.max(series.length - 1 - 4, 0)];
    const mult = fourAgo.arr > 0 ? last.arr / fourAgo.arr : null;
    return { series, last, goal, w, rate, projected, milestone, mom, latestMom, peakMom, mult, horizonEnd: projected[projected.length - 1] };
  }, [growth, rateWindow, horizon]);

  /* ---- churn helpers ---- */
  const months = churn?.months ?? [];
  const latestChurn: ChurnMonth | undefined = months.find((mo) => mo.month === thisMonth) ?? months[months.length - 1];
  const churnSeries = (churn?.series ?? []).filter((s) => s.month >= '2026-03').map((s) => ({ label: mkLabel(s.month), value: s.rate ?? 0, sublabel: mkLong(s.month) }));
  const excludeCustomer = async (row: ChurnListRow) => {
    const reason = window.prompt(`Remove ${row.name} from churn?\n\nThey'll be treated as retained everywhere (counts, rate, ARR). Optional reason (e.g. "moved account", "DFY client"):`);
    if (reason === null) return;
    setBusyId(row.customer_id);
    try { await setChurnExclusion(row.customer_id, reason.trim() || null); await loadChurn(); if (drill) setDrill({ ...drill }); }
    catch (e) { setErr('Failed: ' + (e as Error).message); }
    finally { setBusyId(null); }
  };
  const undoExclusion = async (customerId: string) => {
    setBusyId(customerId);
    try { await removeChurnExclusion(customerId); await loadChurn(); if (drill) setDrill({ ...drill }); }
    catch (e) { setErr('Failed: ' + (e as Error).message); }
    finally { setBusyId(null); }
  };

  /* ---- goals ---- */
  const ramp = CLIENT_RAMP.map((clients, i) => ({ mk: addMonths(thisMonth, i), clients, trials: Math.round(clients / TRIAL_RATE) }));
  const target = ramp[ramp.length - 1];
  const actualByMonth = new Map(goals.map((g) => [g.month, g]));
  const thisActual = actualByMonth.get(thisMonth);
  const goalPct = thisActual ? Math.round((thisActual.clients / ramp[0].clients) * 100) : 0;
  const bestMonth = goals.reduce<GoalMonth | null>((best, g) => (best == null || g.clients > best.clients ? g : best), null);
  const goalChartMonths = useMemo(() => {
    const first = goals[0]?.month ?? thisMonth;
    const out: string[] = [];
    for (let mk = first; mk <= target.mk; mk = addMonths(mk, 1)) out.push(mk);
    return out;
  }, [goals, target.mk]);

  /* ---- forecast ---- */
  const removeTrial = async (subId: string, name: string) => {
    if (!window.confirm(`Remove ${name} from the trial forecast? You can restore it later if needed.`)) return;
    setHidingId(subId);
    try { await hideTrial(subId); setTrials(await fetchTrialForecast(days)); }
    catch (e) { setErr('Could not remove: ' + (e as Error).message); }
    finally { setHidingId(null); }
  };

  const kpis: Kpi[] = [
    { label: 'Current ARR', value: growth ? fmtUsd(growth.current_arr) : '—', delta: projection?.mult ? `${projection.mult.toFixed(1)}× in 4 months` : undefined, valueTone: 'positive' },
    { label: 'Avg monthly growth', value: projection ? pct(Math.max(projection.rate, 0)) : '—', delta: `compounded, last ${projection?.w ?? rateWindow} months`, valueTone: 'positive' },
    { label: 'Path to $1M ARR', value: projection?.milestone ? mkLabel(projection.milestone.month) : projection ? 'reached' : '—', delta: projection?.milestone ? `at ${pct(projection.rate)}/mo` : undefined },
    { label: 'Churn rate', value: latestChurn?.churn_rate != null ? `${latestChurn.churn_rate}%` : '—', delta: latestChurn ? `${latestChurn.churned} churned in ${mkLabel(latestChurn.month)}` : undefined, valueTone: rateTone(latestChurn?.churn_rate ?? null) },
    { label: 'ARR lost', value: latestChurn ? fmtUsd(latestChurn.churned_arr) : '—', delta: latestChurn ? `${mkLabel(latestChurn.month)} cancellations` : undefined, valueTone: latestChurn && latestChurn.churned_arr > 0 ? 'caution' : undefined },
    { label: 'New clients vs plan', value: thisActual ? `${thisActual.clients} / ${ramp[0].clients}` : `0 / ${ramp[0].clients}`, delta: `${goalPct}% of ${mkLabel(thisMonth)} goal`, valueTone: goalPct >= 100 ? 'positive' : goalPct < 50 ? 'caution' : undefined },
  ];

  const netSeries = months.map((mo) => ({ label: mkLabel(mo.month), value: mo.new - mo.churned, sublabel: mkLong(mo.month) }));
  const arrMini = (growth?.series ?? []).map((p) => ({ label: mkLabel(p.month), value: p.arr, sublabel: mkLong(p.month) }));

  return (
    <StyledPage>
      <PageHeader title="Revenue" Icon={IconTrendingUp}>
        <StyledHeaderActions><StyledMuted>Recurring revenue, churn and forecast</StyledMuted></StyledHeaderActions>
      </PageHeader>
      <StyledBody>
        <SkeletonTheme baseColor={'var(--t-background-tertiary)'} highlightColor={'var(--t-background-transparent-lighter)'} borderRadius={4}>
          <StyledContent>
            {err && <StyledError>{err}</StyledError>}

            <StyledGrid2>
              <StyledCard>
                <StyledCardHead>
                  <div>
                    <StyledLabel>Monthly recurring revenue</StyledLabel>
                    <StyledBigValue>
                      {growth ? fmtUsd(growth.current_mrr) : <Skeleton width={110} />}
                      {growth && <StyledSub>{growth.current_subscribers} paying subscribers · {fmtUsd(growth.current_arr)} ARR</StyledSub>}
                    </StyledBigValue>
                  </div>
                </StyledCardHead>
                <Chart data={arrMini} format={(n) => fmtShort(n)} color={POSITIVE} height={84} mini zoom />
              </StyledCard>
              <StyledCard>
                <StyledCardHead>
                  <div>
                    <StyledLabel>Net subscriber growth · {latestChurn ? mkLabel(latestChurn.month) : ''}</StyledLabel>
                    <StyledBigValue>
                      {latestChurn ? `${latestChurn.net >= 0 ? '+' : ''}${latestChurn.net}` : <Skeleton width={60} />}
                      {latestChurn && <StyledSub>{latestChurn.new} new · {latestChurn.churned} churned · {latestChurn.start} at start</StyledSub>}
                    </StyledBigValue>
                  </div>
                </StyledCardHead>
                <Chart data={netSeries} format={(n) => `${n >= 0 ? '+' : ''}${Math.round(n)}`} height={84} mini zoom />
              </StyledCard>
            </StyledGrid2>

            <StyledGrid6>
              {growth && churn ? kpis.map((k) => <KpiTile key={k.label} kpi={k} />) : Array.from({ length: 6 }).map((_, i) => (
                <StyledCard key={i} style={{ minHeight: 92, justifyContent: 'space-between' }}><Skeleton width={90} height={10} /><Skeleton width={60} height={22} /><Skeleton width={40} height={10} /></StyledCard>
              ))}
            </StyledGrid6>

            {/* ARR growth and projection */}
            <StyledCard>
              <StyledCardHead>
                <StyledCardTitle>ARR growth &amp; projection</StyledCardTitle>
                <StyledCardHint>How ARR has compounded over the last few months, and where the same pace would take it</StyledCardHint>
              </StyledCardHead>
              <StyledRow style={{ marginBottom: 12 }}>
                <StyledLabel>Growth rate</StyledLabel>
                {[3, 4, 6].map((w) => <PillButton key={w} title={`${w}-mo`} active={rateWindow === w} onClick={() => setRateWindow(w)} />)}
                <StyledDivider />
                <StyledLabel>Horizon</StyledLabel>
                {([['goal', 'To $1M'], [12, '1 year'], [36, '3 years']] as const).map(([h, l]) => <PillButton key={String(h)} title={l} active={horizon === h} onClick={() => setHorizon(h)} />)}
              </StyledRow>
              {projection ? (
                <>
                  <MultiChart
                    labels={[...projection.series.map((p) => mkLabel(p.month)), ...projection.projected.map((p) => mkLabel(p.month))]}
                    sublabels={[...projection.series.map((p) => mkLong(p.month)), ...projection.projected.map((p) => `${mkLong(p.month)} · projected`)]}
                    series={[
                      { key: 'actual', label: 'Actual', color: ACCENT, area: true, values: [...projection.series.map((p) => p.arr), ...projection.projected.map(() => null)] },
                      { key: 'proj', label: 'Projected', color: ACCENT, dashed: true, values: [...projection.series.map((_, i) => (i === projection.series.length - 1 ? projection.last.arr : null)), ...projection.projected.map((p) => p.arr)] },
                    ]}
                    goal={projection.goal}
                    goalLabel={`${fmtShort(projection.goal)} goal`}
                    format={(n) => fmtShort(n)}
                    logScale={horizon !== 'goal'}
                    mutedFrom={projection.series.length}
                    height={260}
                  />
                  <StyledTakeaway>
                    At the <b>{pct(projection.rate)}</b> average monthly growth of the last {projection.w} months, ARR crosses <b>$1M around {projection.milestone ? mkLong(projection.milestone.month) : 'now'}</b>
                    {horizon !== 'goal' && projection.horizonEnd && <> and reaches <b>{fmtShort(projection.horizonEnd.arr)}</b> by {mkLong(projection.horizonEnd.month)}</>}.
                    <span data-note>Projection, not a forecast: it assumes the last {projection.w} months' pace holds. Growth was {projection.latestMom == null ? '—' : pct(projection.latestMom)} last month against a peak of {pct(projection.peakMom)}.</span>
                  </StyledTakeaway>
                </>
              ) : <Skeleton height={200} />}
            </StyledCard>

            {/* New clients vs plan */}
            <StyledCard>
              <StyledCardHead>
                <StyledCardTitle>New clients vs the 9 month plan</StyledCardTitle>
                <StyledCardHint>Ramp from {ramp[0].clients} to {target.clients} new paying clients a month by {mkLong(target.mk)}. At a 50% trial rate that is {target.trials} trials a month.</StyledCardHint>
              </StyledCardHead>
              <MultiChart
                labels={goalChartMonths.map(mkLabel)}
                sublabels={goalChartMonths.map(mkLong)}
                series={[
                  { key: 'actual', label: 'Actual clients', color: ACCENT, kind: 'bar', values: goalChartMonths.map((mk) => actualByMonth.get(mk)?.clients ?? null) },
                  { key: 'goal', label: 'Goal', color: CAUTION, dashed: true, values: goalChartMonths.map((mk) => ramp.find((r) => r.mk === mk)?.clients ?? null) },
                ]}
                format={(n) => String(Math.round(n))}
                height={200}
              />
              <StyledTable style={{ marginTop: 12 }}>
                <thead><tr><th>Month</th><th>Goal clients</th><th>Trials needed</th><th>Actual clients</th><th>Actual trials</th><th>vs goal</th></tr></thead>
                <tbody>
                  {ramp.map((r, i) => {
                    const actual = actualByMonth.get(r.mk);
                    const diff = actual ? actual.clients - r.clients : null;
                    return (
                      <tr key={r.mk} style={i === 0 ? { background: 'var(--t-background-transparent-lighter)' } : undefined}>
                        <td>{mkLabel(r.mk)} {i === 0 && <StyledChip data-tone="accent">now</StyledChip>}</td>
                        <td style={{ fontWeight: 600 }}>{r.clients}</td>
                        <td>{r.trials}</td>
                        <td>{actual ? actual.clients : '—'}</td>
                        <td>{actual ? actual.trials : '—'}</td>
                        <td style={{ color: diff == null ? undefined : diff >= 0 ? POSITIVE : CAUTION }}>{diff == null ? '—' : `${diff >= 0 ? '+' : ''}${diff}`}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </StyledTable>
              <StyledFootnote>
                New client = a customer whose first payment landed that month. Trials needed assumes a 50% trial to client rate. The current month is partial.
                {bestMonth && <> Best month so far: {bestMonth.clients} clients in {mkLabel(bestMonth.month)} ({bestMonth.trials} trials).</>}
              </StyledFootnote>
            </StyledCard>

            {/* Churn */}
            <StyledCard>
              <StyledCardHead>
                <StyledCardTitle>Subscriber churn</StyledCardTitle>
                <StyledCardHint>Monthly churn rate = cancelled ÷ subscribers at start of month</StyledCardHint>
              </StyledCardHead>
              {churn ? (
                <MultiChart labels={churnSeries.map((c) => c.label)} sublabels={churnSeries.map((c) => c.sublabel)} series={[{ key: 'rate', label: 'Churn rate', color: CAUTION, kind: 'bar', values: churnSeries.map((c) => c.value) }]} format={(n) => `${Math.round(n * 10) / 10}%`} height={200} />
              ) : <Skeleton height={200} />}
              <StyledRow style={{ margin: '12px 0' }}>
                <StyledLabel>Breakdown</StyledLabel>
                <StyledMuted>click a number to see who</StyledMuted>
                <StyledDivider />
                <PillButton title="Recent cancellations" active={drill?.type === 'cancellations'} onClick={() => setDrill({ type: 'cancellations', month: null, title: 'Recent cancellations · newest first' })} />
                {exclusions.length > 0 && <PillButton title={`Excluded from churn (${exclusions.length})`} active={showExclusions} onClick={() => setShowExclusions((v) => !v)} />}
              </StyledRow>
              <StyledTable>
                <thead><tr><th>Month</th><th>Start</th><th>New</th><th>Churned</th><th>Reactivated</th><th>Net</th><th>ARR lost</th><th>Churn rate</th></tr></thead>
                <tbody>
                  {months.map((mo) => (
                    <tr key={mo.month}>
                      <td>{mkLong(mo.month)}</td>
                      <td><StyledClickable onClick={() => setDrill({ type: 'active', month: addMonths(mo.month, -1), title: `${mo.start} subscribers at start of ${mkLong(mo.month)}` })}>{mo.start}</StyledClickable></td>
                      <td style={{ color: POSITIVE }}><StyledClickable disabled={mo.new === 0} onClick={() => setDrill({ type: 'new', month: mo.month, title: `${mo.new} new in ${mkLong(mo.month)}` })}>{mo.new}</StyledClickable></td>
                      <td style={{ color: CAUTION }}><StyledClickable disabled={mo.churned === 0} onClick={() => setDrill({ type: 'churned', month: mo.month, title: `${mo.churned} churned in ${mkLong(mo.month)}` })}>{mo.churned}</StyledClickable></td>
                      <td><StyledMuted>{mo.reactivated}</StyledMuted></td>
                      <td style={{ fontWeight: 600 }}><StyledClickable onClick={() => setDrill({ type: 'active', month: mo.month, title: `${mo.net} subscribers at end of ${mkLong(mo.month)}` })}>{mo.net}</StyledClickable></td>
                      <td>{mo.churned_arr ? fmtUsd(mo.churned_arr) : '—'}</td>
                      <td style={{ color: rateTone(mo.churn_rate) === 'caution' ? CAUTION : rateTone(mo.churn_rate) === 'positive' ? POSITIVE : undefined }}>{mo.churn_rate == null ? '—' : `${mo.churn_rate}%`}</td>
                    </tr>
                  ))}
                </tbody>
              </StyledTable>
              {drill && (
                <StyledReveal style={{ marginTop: 12 }}>
                  <StyledCardHead>
                    <StyledCardTitle>{drill.title}</StyledCardTitle>
                    <Button size="small" variant="tertiary" Icon={IconX} title="Close" onClick={() => setDrill(null)} />
                  </StyledCardHead>
                  <ChurnTable rows={drill.type === 'cancellations' ? drillRows?.slice(0, 60) ?? null : drillRows} showCancel={drill.type === 'churned' || drill.type === 'cancellations'} onExclude={drill.type === 'churned' || drill.type === 'cancellations' ? excludeCustomer : undefined} busyId={busyId} />
                </StyledReveal>
              )}
              {showExclusions && exclusions.length > 0 && (
                <StyledReveal style={{ marginTop: 12 }}>
                  <StyledCardHead>
                    <StyledCardTitle>Excluded from churn</StyledCardTitle>
                    <StyledCardHint>Marked as not real churn, so they count as retained everywhere. Undo to put them back.</StyledCardHint>
                  </StyledCardHead>
                  <StyledTable>
                    <tbody>
                      {exclusions.map((x) => (
                        <tr key={x.customer_id}>
                          <td>{x.name ?? x.customer_id}{x.email && <StyledMuted style={{ marginLeft: 8 }}>{x.email}</StyledMuted>}</td>
                          <td>{x.reason && <StyledChip>{x.reason}</StyledChip>}</td>
                          <td><Button size="small" variant="tertiary" title={busyId === x.customer_id ? '…' : 'Undo, count as churn'} disabled={busyId === x.customer_id} onClick={() => undoExclusion(x.customer_id)} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </StyledTable>
                </StyledReveal>
              )}
            </StyledCard>

            {/* Forecast */}
            <StyledCard>
              <StyledCardHead>
                <StyledCardTitle>Forecast</StyledCardTitle>
                <StyledCardHint>Expected revenue from existing subscriptions and converting trials. Excludes subscriptions already set to cancel.</StyledCardHint>
              </StyledCardHead>
              <StyledRow style={{ marginBottom: 12 }}>
                <PillButton title="Upcoming renewals" active={forecastTab === 'renewals'} onClick={() => setForecastTab('renewals')} />
                <PillButton title="Current trials" active={forecastTab === 'trials'} onClick={() => setForecastTab('trials')} />
                <StyledDivider />
                <StyledLabel>{forecastTab === 'renewals' ? 'Due within' : 'Expiring within'}</StyledLabel>
                {FORECAST_WINDOWS.map((w) => <PillButton key={w} title={`${w} days`} active={days === w} onClick={() => setDays(w)} />)}
              </StyledRow>
              {forecastTab === 'renewals' ? (
                <>
                  <StyledGrid4 style={{ marginBottom: 12 }}>
                    <KpiTile kpi={{ label: `Expected · next ${days}d`, value: renewals ? fmtUsd(renewals.total_expected) : '—', delta: 'from existing subscriptions', valueTone: 'positive' }} />
                    <KpiTile kpi={{ label: 'Renewals', value: renewals?.count ?? '—', delta: 'customers billing' }} />
                    <KpiTile kpi={{ label: 'Past due', value: renewals?.past_due_count ?? '—', delta: 'overdue and unpaid', valueTone: renewals && renewals.past_due_count > 0 ? 'caution' : undefined }} />
                    <KpiTile kpi={{ label: 'Avg per renewal', value: renewals && renewals.count > 0 ? fmtUsd(renewals.total_expected / renewals.count) : '—', delta: 'mean expected charge' }} />
                  </StyledGrid4>
                  <StyledScroll>
                    <StyledTable>
                      <thead><tr><th>Customer</th><th>Renewal</th><th>MRR</th><th>ARR</th><th>Plan</th><th>Cycle</th><th>Net paid</th><th>Country</th><th>Since</th><th>Status</th></tr></thead>
                      <tbody>
                        {renewals?.rows.length === 0 && <tr><td colSpan={10} style={{ textAlign: 'center', padding: 24 }}><StyledMuted>No renewals in this window.</StyledMuted></td></tr>}
                        {renewals?.rows.map((r) => (
                          <tr key={r.customer_id + r.renewal}>
                            <td><StyledTextLink to={`/records?type=customer_payments&arg=${encodeURIComponent(r.customer_id)}&name=${encodeURIComponent(r.name)}&back=/revenue`}>{r.name}</StyledTextLink></td>
                            <td style={r.past_due ? { color: CAUTION, fontWeight: 600 } : undefined}>{fmtDate(r.renewal)}</td>
                            <td>{fmtUsd2(r.mrr)}</td><td>{fmtUsd2(r.arr)}</td><td>{r.plan ?? '—'}</td><td>{r.interval}</td><td>{fmtUsd2(r.net_payments)}</td>
                            <td>{flag(r.country)} {r.country ?? ''}</td><td>{fmtDate(r.since)}</td>
                            <td><StyledChip data-tone={r.past_due ? 'caution' : 'positive'}>{r.past_due ? 'Past due' : 'Active'}</StyledChip></td>
                          </tr>
                        ))}
                      </tbody>
                    </StyledTable>
                  </StyledScroll>
                  <StyledFootnote>Renewal = next bill date. MRR falls back to the last actual payment when Stripe has no fixed price.</StyledFootnote>
                </>
              ) : (
                <>
                  <StyledGrid4 style={{ marginBottom: 12 }}>
                    <KpiTile kpi={{ label: `Expected new · next ${days}d`, value: trials ? fmtUsd(trials.expected_mrr) : '—', delta: `at ${trials?.conversion_rate ?? 51.2}% trial to paid`, valueTone: 'positive' }} />
                    <KpiTile kpi={{ label: 'Trials expiring', value: trials?.count ?? '—', delta: 'due to convert or drop' }} />
                    <KpiTile kpi={{ label: 'Expected conversions', value: trials?.expected_conversions ?? '—', delta: `of ${trials?.count ?? 0} trials`, valueTone: 'positive' }} />
                    <KpiTile kpi={{ label: 'If all convert', value: trials ? fmtUsd(trials.potential_mrr) : '—', delta: 'max potential MRR' }} />
                  </StyledGrid4>
                  <StyledScroll>
                    <StyledTable>
                      <thead><tr><th>Customer</th><th>Trial ends</th><th>Plan</th><th>Cycle</th><th>MRR if converts</th><th>ARR</th><th>Country</th><th>Started</th><th /></tr></thead>
                      <tbody>
                        {trials?.rows.length === 0 && <tr><td colSpan={9} style={{ textAlign: 'center', padding: 24 }}><StyledMuted>No trials expiring in this window.</StyledMuted></td></tr>}
                        {trials?.rows.map((r) => (
                          <tr key={r.sub_id}>
                            <td><StyledTextLink to={`/records?type=customer_payments&arg=${encodeURIComponent(r.customer_id)}&name=${encodeURIComponent(r.name)}&back=/revenue`}>{r.name}</StyledTextLink></td>
                            <td>{fmtDate(r.trial_end)}</td><td>{r.plan ?? '—'}</td><td>{r.interval}</td>
                            <td>{fmtUsd2(r.mrr)} {r.est && <StyledChip title="Estimated from the plan's standard price">est</StyledChip>}</td>
                            <td>{fmtUsd2(r.arr)}</td><td>{flag(r.country)} {r.country ?? ''}</td><td>{fmtDate(r.since)}</td>
                            <td><Button size="small" variant="tertiary" title={hidingId === r.sub_id ? '…' : 'Remove'} disabled={hidingId === r.sub_id} onClick={() => removeTrial(r.sub_id, r.name)} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </StyledTable>
                  </StyledScroll>
                  <StyledFootnote>Expected new revenue = MRR of expiring trials × {trials?.conversion_rate ?? 51.2}% (the trial to paid rate). "est" = estimated from the plan's standard price where the trial has no set price yet.</StyledFootnote>
                </>
              )}
            </StyledCard>
          </StyledContent>
        </SkeletonTheme>
      </StyledBody>
    </StyledPage>
  );
};
