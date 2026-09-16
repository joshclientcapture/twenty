import { styled } from '@linaria/react';
import { Fragment, useEffect, useState } from 'react';
import Skeleton, { SkeletonTheme } from 'react-loading-skeleton';
import { IconRefresh, IconUser } from 'twenty-ui/icon';
import { Button } from 'twenty-ui/input';
import { Tag } from 'twenty-ui/data-display';
import { themeCssVariables as t } from 'twenty-ui/theme-constants';

import { PageHeader } from '@/ui/layout/page/components/PageHeader';
import { Chart } from '@/custom-pages/os/Chart';
import {
  ACCENT,
  addDays,
  CAUTION,
  fmtDate,
  fmtUsd,
  fmtUsd2,
  isoDate,
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
  StyledExtLink,
  StyledField,
  StyledGrid2,
  StyledGrid4,
  StyledGrid6,
  StyledHeaderActions,
  StyledLabel,
  StyledMuted,
  StyledNotice,
  StyledPage,
  StyledReveal,
  StyledRow,
  StyledSub,
  StyledTable,
  StyledTextLink,
} from '@/custom-pages/os/ui';
import {
  clearTheraponCall,
  fetchAttributionSplit,
  fetchCommissionSummary,
  fetchConversion,
  fetchMonthlyMetrics,
  fetchShowUp,
  fetchTheraponCash,
  fetchTheraponDaily,
  markCloserCommissionPaid,
  refreshFathom,
  setTheraponCall,
  type AttributionSplit,
  type CommissionSummary,
  type Conversion,
  type MonthlyRow,
  type ShowUp,
  type TheraponCash,
  type TheraponDaily,
} from '@/custom-pages/os/data';

const CLOSER = 'Therapon Savvas';
const thisMonth = new Date().toISOString().slice(0, 7);
const moLabel = (mk: string) => { const [y, m] = mk.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }); };
const fmtTime = (s: string) => new Date(s).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const fmtDayLong = (s: string) => new Date(s + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' });
const dayPreset = (kind: string): { from: string; to: string } => {
  const d = new Date();
  if (kind === 'yesterday') { const y = addDays(d, -1); return { from: isoDate(y), to: isoDate(y) }; }
  if (kind === 'last7') return { from: isoDate(addDays(d, -6)), to: isoDate(d) };
  if (kind === 'month') return { from: isoDate(new Date(d.getFullYear(), d.getMonth(), 1)), to: isoDate(d) };
  return { from: isoDate(d), to: isoDate(d) };
};
const DAY_STATUS: Record<string, { label: string; tone?: 'positive' | 'caution' | 'accent' }> = {
  showed: { label: 'Showed', tone: 'positive' },
  no_show: { label: 'No-show', tone: 'caution' },
  in_progress: { label: '● In progress', tone: 'positive' },
  upcoming: { label: 'Upcoming', tone: 'accent' },
  cancelled: { label: 'Cancelled' },
};
const STATUS_OPTS = [
  { v: '', label: 'Auto' }, { v: 'showed', label: 'Showed' }, { v: 'no_show', label: 'No-show' },
  { v: 'cancelled', label: 'Cancelled' }, { v: 'upcoming', label: 'Upcoming' },
];

/* ---------------- page-specific styled ---------------- */
const StyledSegments = styled.div`
  background: ${t.background.tertiary};
  border-radius: ${t.border.radius.pill};
  display: flex;
  gap: 2px;
  height: 8px;
  margin-top: ${t.spacing[3]};
  overflow: hidden;
  width: 100%;
  div[data-seg='positive'] { background: ${POSITIVE}; }
  div[data-seg='caution'] { background: ${CAUTION}; }
  div[data-seg='accent'] { background: ${ACCENT}; }
`;

const StyledLegend = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${t.spacing[2]} ${t.spacing[4]};
  margin-top: ${t.spacing[2]};
  font-size: ${t.font.size.sm};
  color: ${t.font.color.secondary};
  span[data-dot] {
    border-radius: 2px;
    display: inline-block;
    height: 8px;
    margin-right: ${t.spacing[1]};
    vertical-align: 0;
    width: 8px;
  }
  span[data-dot='positive'] { background: ${POSITIVE}; }
  span[data-dot='caution'] { background: ${CAUTION}; }
  span[data-dot='accent'] { background: ${ACCENT}; }
  b { color: ${t.font.color.primary}; font-weight: ${t.font.weight.medium}; font-variant-numeric: tabular-nums; }
`;

/* A single row of stats separated by hairlines — quieter than a grid of tiles. */
const StyledStatStrip = styled.div`
  border: 1px solid ${t.border.color.light};
  border-radius: ${t.border.radius.md};
  background: ${t.background.secondary};
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  margin-bottom: ${t.spacing[3]};
  @media (max-width: 640px) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  div[data-stat] {
    border-right: 1px solid ${t.border.color.light};
    padding: ${t.spacing[2]} ${t.spacing[3]};
    min-width: 0;
  }
  div[data-stat]:last-child {
    border-right: 0;
  }
  div[data-k] {
    color: ${t.font.color.tertiary};
    font-size: ${t.font.size.xs};
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  div[data-v] {
    color: ${t.font.color.primary};
    font-size: ${t.font.size.lg};
    font-weight: ${t.font.weight.semiBold};
    font-variant-numeric: tabular-nums;
    line-height: 1.3;
  }
  div[data-v='positive'] { color: ${POSITIVE}; }
  div[data-v='caution'] { color: ${CAUTION}; }
  span[data-sub] {
    color: ${t.font.color.tertiary};
    font-size: ${t.font.size.xs};
    font-weight: ${t.font.weight.regular};
    margin-left: ${t.spacing[1]};
  }
`;

const StyledEditor = styled.div`
  background: ${t.background.primary};
  border: 1px solid ${t.border.color.medium};
  border-radius: ${t.border.radius.md};
  display: flex;
  flex-direction: column;
  gap: ${t.spacing[3]};
  padding: ${t.spacing[3]};
  label[data-check] {
    align-items: center;
    display: flex;
    font-size: ${t.font.size.sm};
    gap: ${t.spacing[2]};
  }
`;

const StyledDayChips = styled.div`
  border-top: 1px solid ${t.border.color.light};
  display: flex;
  flex-wrap: wrap;
  gap: ${t.spacing[2]};
  margin-top: ${t.spacing[3]};
  padding-top: ${t.spacing[3]};
  span[data-chip] {
    background: ${t.background.secondary};
    border: 1px solid ${t.border.color.light};
    border-radius: ${t.border.radius.sm};
    color: ${t.font.color.secondary};
    font-size: ${t.font.size.xs};
    padding: ${t.spacing[1]} ${t.spacing[2]};
    b { color: ${t.font.color.primary}; font-weight: ${t.font.weight.medium}; }
  }
`;

const StyledCommRow = styled.div`
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: ${t.spacing[3]};
  justify-content: space-between;
  margin-bottom: ${t.spacing[3]};
`;

type LogRow = TheraponDaily['log'][number];
type CallPatch = { status?: string | null; trialed?: boolean | null; stripe_email?: string | null; name?: string | null; email?: string | null };

// Inline editor for one call: override its status, and mark a trial (with the Stripe email
// used, which attributes the trial + eventual sale to Therapon).
const CallEditor = ({ row, busy, onSave, onReset, onClose }: { row: LogRow; busy: boolean; onSave: (p: CallPatch) => void; onReset: () => void; onClose: () => void }) => {
  const [status, setStatus] = useState<string>(row.overridden ? row.status : '');
  const [trial, setTrial] = useState<boolean>(!!row.trialed);
  const [email, setEmail] = useState<string>(row.stripe_email ?? '');
  const emailNeeded = trial && !email.trim();
  return (
    <StyledEditor>
      {row.maybe && !row.trialed && (
        <StyledNotice>
          <StyledRow style={{ justifyContent: 'space-between' }}>
            <span>
              <b>Maybe trial</b> · <b>{row.maybe.name ?? row.maybe.email}</b> started a trial <b>{row.maybe.mins ?? '?'} min</b> after this call, on {row.maybe.email} (different email, matching name).
            </span>
            <Button size="small" variant="primary" accent="blue" title="Approve match" disabled={busy}
              onClick={() => onSave({ status: 'showed', trialed: true, stripe_email: row.maybe!.email, name: row.name, email: row.email })} />
          </StyledRow>
        </StyledNotice>
      )}
      <StyledRow>
        <StyledLabel>Status</StyledLabel>
        {STATUS_OPTS.map((o) => <PillButton key={o.v} title={o.label} active={status === o.v} onClick={() => setStatus(o.v)} />)}
      </StyledRow>
      <StyledRow>
        <label data-check>
          <input type="checkbox" checked={trial} onChange={(e) => setTrial(e.target.checked)} />
          <span style={{ fontWeight: 500 }}>Trial started</span>
        </label>
        {trial && (
          <StyledField>
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email used on Stripe" data-invalid={emailNeeded ? '' : undefined} style={{ width: 240 }} />
            <StyledMuted>attributes the trial + sale to Therapon</StyledMuted>
          </StyledField>
        )}
      </StyledRow>
      <StyledRow>
        <Button size="small" variant="primary" accent="blue" title={busy ? 'Saving…' : 'Save'} disabled={busy || emailNeeded}
          onClick={() => onSave({ status: status || null, trialed: trial ? true : (row.trialed ? false : null), stripe_email: trial ? email.trim() || null : null, name: row.name, email: row.email })} />
        {row.overridden && <Button size="small" variant="tertiary" title="Reset to auto" disabled={busy} onClick={onReset} />}
        <Button size="small" variant="tertiary" title="Cancel" onClick={onClose} />
        {row.note && <StyledMuted>note: {row.note}</StyledMuted>}
      </StyledRow>
    </StyledEditor>
  );
};

export const TheraponPage = () => {
  const [su, setSu] = useState<ShowUp | null>(null);
  const [conv, setConv] = useState<Conversion | null>(null);
  const [split, setSplit] = useState<AttributionSplit | null>(null);
  const [monthly, setMonthly] = useState<MonthlyRow[]>([]);
  const [cash, setCash] = useState<TheraponCash | null>(null);
  const [comm, setComm] = useState<CommissionSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [period, setPeriod] = useState<string>(thisMonth);
  const [dayRange, setDayRange] = useState<{ from: string; to: string }>(() => dayPreset('today'));
  const [daily, setDaily] = useState<TheraponDaily | null>(null);
  const [dailyLoading, setDailyLoading] = useState(true);
  const [fathomBusy, setFathomBusy] = useState(false);
  const [fathomStatus, setFathomStatus] = useState<{ ok: boolean; at: Date; msg?: string } | null>(null);
  const [editKey, setEditKey] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const loadComm = () => fetchCommissionSummary().then(setComm).catch(() => {});
  useEffect(() => {
    let cancelled = false;
    fetchShowUp().then((d) => !cancelled && setSu(d)).catch(() => {});
    fetchConversion().then((d) => !cancelled && setConv(d)).catch(() => {});
    // These four all rebuild the heavy get_sales_ledger(); run them one at a time so a cold
    // cache doesn't trip the DB statement timeout.
    (async () => {
      const step = async <T,>(fn: () => Promise<T>, set: (v: T) => void) => {
        for (let attempt = 0; attempt < 2; attempt++) {
          try { const d = await fn(); if (!cancelled) set(d); return; } catch { /* retry once */ }
        }
      };
      await step(fetchAttributionSplit, setSplit);
      await step(fetchMonthlyMetrics, setMonthly);
      await step(fetchTheraponCash, setCash);
      await step(fetchCommissionSummary, setComm);
    })();
    return () => { cancelled = true; };
  }, []);

  // If the current month has no data yet, show the latest month that does.
  useEffect(() => {
    if (monthly.length && period !== 'all' && !monthly.some((r) => r.month_key === period)) {
      setPeriod([...monthly].sort((a, b) => b.month_key.localeCompare(a.month_key))[0].month_key);
    }
  }, [monthly, period]);

  const loadDaily = (from: string, to: string) => {
    setDailyLoading(true);
    return fetchTheraponDaily(from, to).then(setDaily).catch(() => setDaily(null)).finally(() => setDailyLoading(false));
  };
  useEffect(() => { loadDaily(dayRange.from, dayRange.to); }, [dayRange]);

  const saveCall = async (key: string, patch: CallPatch) => {
    setSavingKey(key);
    setErr(null);
    try { await setTheraponCall({ key, ...patch }); await loadDaily(dayRange.from, dayRange.to); setEditKey(null); }
    catch (e) { setErr('Failed to save call: ' + (e as Error).message); }
    finally { setSavingKey(null); }
  };
  const resetCall = async (key: string) => {
    setSavingKey(key);
    setErr(null);
    try { await clearTheraponCall(key); await loadDaily(dayRange.from, dayRange.to); setEditKey(null); }
    catch (e) { setErr('Failed to reset call: ' + (e as Error).message); }
    finally { setSavingKey(null); }
  };
  const markAllPaid = async (rep: CommissionSummary['reps'][number]) => {
    if (!window.confirm(`Mark all ${rep.payments_due} outstanding payments as commission-paid (${fmtUsd2(rep.outstanding)})?`)) return;
    setBusy(true);
    setErr(null);
    try { await markCloserCommissionPaid(rep.rep); await loadComm(); }
    catch (e) { setErr('Failed: ' + (e as Error).message); }
    finally { setBusy(false); }
  };
  const refreshFathomNow = async () => {
    setFathomBusy(true);
    setFathomStatus(null);
    try { await refreshFathom(); await loadDaily(dayRange.from, dayRange.to); setFathomStatus({ ok: true, at: new Date() }); }
    catch (e) { setFathomStatus({ ok: false, at: new Date(), msg: (e as Error).message }); }
    finally { setFathomBusy(false); }
  };

  const all = period === 'all';
  const mk = period;
  const suD = all ? su : (su ? su.monthly[mk] : undefined);
  const cvD = all ? conv?.total : (conv ? conv.monthly[mk] : undefined);
  const saM = all ? null : (split ? split.sales.monthly[mk] : undefined);
  const salesHis = all ? (split?.sales.therapon ?? 0) : (saM?.therapon ?? 0);
  const salesActive = all ? (split?.sales.active ?? 0) : (saM?.active ?? 0);
  const salesMrr = all ? (split?.sales.mrr ?? 0) : (saM?.mrr ?? 0);
  const cashHis = all ? (cash?.total ?? 0) : (cash?.monthly[mk] ?? 0);
  const monthsAsc = [...monthly].sort((a, b) => a.month_key.localeCompare(b.month_key));
  const cashSeries = monthsAsc.map((r) => ({ label: moLabel(r.month_key), value: cash?.monthly[r.month_key] ?? 0, sublabel: moLabel(r.month_key) }));
  const salesSeries = monthsAsc.map((r) => ({ label: moLabel(r.month_key), value: r.therapon_sales ?? 0, sublabel: moLabel(r.month_key) }));
  const rep = comm?.reps.find((r) => r.rep === CLOSER);
  const pills = [{ key: 'all', label: 'All time' }, ...monthly.map((r) => ({ key: r.month_key, label: r.month.replace(' 2026', " '26") }))];
  const periodLabel = all ? 'All time' : (monthly.find((r) => r.month_key === mk)?.month.replace(' 2026', '') ?? mk);
  const qp = all ? '' : `&month=${mk}`;
  const repQ = `arg=${encodeURIComponent(CLOSER)}&name=${encodeURIComponent(CLOSER)}`;
  const loaded = !!su && !!conv;

  const kpis: Kpi[] = [
    { label: 'Appointments held', value: (suD?.held ?? 0).toLocaleString(), delta: `${(suD?.upcoming ?? 0).toLocaleString()} upcoming`, to: '/showup' },
    { label: 'Appointments sat', value: (suD?.recorded ?? 0).toLocaleString(), delta: 'Fathom-confirmed', to: `/records?type=calls${qp}` },
    { label: 'Show-up rate', value: suD?.rate != null ? `${suD.rate}%` : '—', delta: `${suD?.recorded ?? 0} of ${suD?.held ?? 0} held`, valueTone: (suD?.rate ?? 0) >= 55 ? 'positive' : 'caution', to: '/showup' },
    { label: 'Cancellations', value: suD?.cancel_rate != null ? `${suD.cancel_rate}%` : '—', delta: `${suD?.canceled ?? 0} genuine`, to: `/records?type=cancellations${qp}` },
    { label: 'Trials started', value: (cvD?.sat_trials ?? 0).toLocaleString(), delta: `of ${cvD?.trials_total ?? 0} company-wide`, to: `/records?type=trials${qp}` },
    { label: 'Trial conversion', value: cvD?.rate != null ? `${cvD.rate}%` : '—', delta: `${cvD?.sat_trials ?? 0} of ${cvD?.sat ?? 0} sat`, valueTone: (cvD?.rate ?? 0) >= 30 ? 'positive' : 'caution', to: `/records?type=trials${qp}` },
  ];

  const sat = suD?.recorded ?? 0;
  const ns = suD?.no_show ?? 0;
  const upc = suD?.upcoming ?? 0;
  const held = suD?.held ?? 0;
  const resc = suD?.rescheduled ?? 0;
  const can = suD?.canceled ?? 0;
  const real = held + upc;
  const segs: { label: string; n: number; tone: 'positive' | 'caution' | 'accent' }[] = [
    { label: 'Sat', n: sat, tone: 'positive' },
    { label: 'No-show', n: ns, tone: 'caution' },
    { label: 'Upcoming', n: upc, tone: 'accent' },
  ];
  const ds = daily?.summary;

  return (
    <StyledPage>
      <PageHeader title="Therapon" Icon={IconUser}>
        <StyledHeaderActions>
          <StyledMuted>Sales closer</StyledMuted>
        </StyledHeaderActions>
      </PageHeader>
      <StyledBody>
        <SkeletonTheme baseColor={'var(--t-background-tertiary)'} highlightColor={'var(--t-background-transparent-lighter)'} borderRadius={4}>
          <StyledContent>
            {err && <StyledError>{err}</StyledError>}

            {/* Hero: his cash + his sales, with the monthly trend behind each */}
            <StyledGrid2>
              <StyledCard>
                <StyledCardHead>
                  <div>
                    <StyledLabel>Cash collected · {periodLabel}</StyledLabel>
                    <StyledBigValue>
                      {cash ? fmtUsd(cashHis) : <Skeleton width={110} />}
                      {cash && <StyledSub>{fmtUsd(cash.total)} lifetime</StyledSub>}
                    </StyledBigValue>
                  </div>
                  <StyledTextLink to={`/records?type=sales${qp}`}>Payments →</StyledTextLink>
                </StyledCardHead>
                <Chart data={cashSeries} format={(n) => fmtUsd(n)} color={POSITIVE} height={84} mini zoom />
              </StyledCard>

              <StyledCard>
                <StyledCardHead>
                  <div>
                    <StyledLabel>Sales closed · {periodLabel}</StyledLabel>
                    <StyledBigValue>
                      {split ? salesHis.toLocaleString() : <Skeleton width={60} />}
                      {split && <StyledSub>{salesActive} still active · {fmtUsd(salesMrr)}/mo</StyledSub>}
                    </StyledBigValue>
                  </div>
                  <StyledTextLink to={`/records?type=therapon_customers${qp}`}>Customers →</StyledTextLink>
                </StyledCardHead>
                <Chart data={salesSeries} format={(n) => Math.round(n).toLocaleString()} height={84} mini zoom />
              </StyledCard>
            </StyledGrid2>

            <StyledRow>
              <StyledLabel>Period</StyledLabel>
              {pills.map((p) => <PillButton key={p.key} title={p.label} active={period === p.key} onClick={() => setPeriod(p.key)} />)}
            </StyledRow>

            <StyledGrid6>
              {loaded
                ? kpis.map((k) => <KpiTile key={k.label} kpi={k} />)
                : Array.from({ length: 6 }).map((_, i) => (
                    <StyledCard key={i} style={{ minHeight: 92, justifyContent: 'space-between' }}>
                      <Skeleton width={90} height={10} />
                      <Skeleton width={60} height={22} />
                      <Skeleton width={40} height={10} />
                    </StyledCard>
                  ))}
            </StyledGrid6>

            {/* Appointment breakdown — a reschedule is one appointment (counted at its new time), not two. */}
            <StyledCard>
              <StyledCardHead>
                <StyledCardTitle>Appointments · {periodLabel}</StyledCardTitle>
                <StyledCardHint title={`Counts new appointments only (Discovery, Demo, Agency Demo). Next Steps follow-ups are separate. Not counted: ${resc} rescheduled (moved to a new time, counted once) · ${can} cancelled.${all ? ' Tracking starts 30 Mar 2026.' : ''}`}>
                  {resc} rescheduled · {can} cancelled — not counted
                </StyledCardHint>
              </StyledCardHead>
              <StyledBigValue>
                {loaded ? real.toLocaleString() : <Skeleton width={70} />}
                {loaded && <StyledSub>real appointments · {held.toLocaleString()} held + {upc.toLocaleString()} upcoming</StyledSub>}
              </StyledBigValue>
              <StyledSegments>
                {segs.filter((s) => s.n > 0).map((s) => (
                  <div key={s.label} data-seg={s.tone} style={{ width: `${(s.n / Math.max(real, 1)) * 100}%` }} title={`${s.label}: ${s.n}`} />
                ))}
              </StyledSegments>
              <StyledLegend>
                {segs.map((s) => (
                  <span key={s.label}><span data-dot={s.tone} /><b>{s.n.toLocaleString()}</b> {s.label}</span>
                ))}
              </StyledLegend>
            </StyledCard>

            {/* Daily call log */}
            <StyledCard>
              {/* Title row and control row are always separate, so a longer date label
                  never pushes the controls onto a new line when a preset is clicked. */}
              <StyledCardHead>
                <StyledRow>
                  <StyledCardTitle>Call log</StyledCardTitle>
                  <StyledMuted>
                    {dayRange.from === dayRange.to ? fmtDayLong(dayRange.from) : `${fmtDayLong(dayRange.from)} → ${fmtDayLong(dayRange.to)}`}
                  </StyledMuted>
                </StyledRow>
                {!fathomBusy && fathomStatus && (
                  <span title={fathomStatus.msg}>
                    <Tag color={fathomStatus.ok ? 'green' : 'orange'} text={fathomStatus.ok ? `Fathom updated ${fathomStatus.at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : 'Fathom refresh failed'} />
                  </span>
                )}
              </StyledCardHead>
              <StyledRow style={{ marginBottom: 12 }}>
                  {[['today', 'Today'], ['yesterday', 'Yesterday'], ['last7', 'Last 7 days'], ['month', 'This month']].map(([k, l]) => {
                    const pr = dayPreset(k);
                    const active = dayRange.from === pr.from && dayRange.to === pr.to;
                    return <PillButton key={k} title={l} active={active} onClick={() => setDayRange(pr)} />;
                  })}
                  <StyledDivider />
                  <StyledField>
                    <input type="date" value={dayRange.from} max={dayRange.to} onChange={(e) => { const v = e.target.value; if (v) setDayRange((r) => ({ from: v, to: r.to >= v ? r.to : v })); }} />
                  </StyledField>
                  <StyledMuted>→</StyledMuted>
                  <StyledField>
                    <input type="date" value={dayRange.to} min={dayRange.from} onChange={(e) => { const v = e.target.value; if (v) setDayRange((r) => ({ from: r.from <= v ? r.from : v, to: v })); }} />
                  </StyledField>
                  <StyledDivider />
                  <Button size="small" variant="secondary" Icon={IconRefresh} title={fathomBusy ? 'Syncing…' : 'Refresh Fathom'} disabled={fathomBusy} onClick={refreshFathomNow} />
              </StyledRow>

              <StyledStatStrip>
                <div data-stat><div data-k>Booked</div><div data-v>{ds ? ds.booked : <Skeleton width={30} />}</div></div>
                <div data-stat><div data-k>Showed</div><div data-v="positive">{ds ? ds.showed : <Skeleton width={30} />}{ds?.show_up_rate != null && <span data-sub>{ds.show_up_rate}%</span>}</div></div>
                <div data-stat><div data-k>No-show</div><div data-v="caution">{ds ? ds.no_show : <Skeleton width={30} />}</div></div>
                <div data-stat><div data-k>Started trial</div><div data-v="positive">{ds ? ds.trials : <Skeleton width={30} />}</div></div>
                <div data-stat><div data-k>Upcoming</div><div data-v>{ds ? ds.upcoming : <Skeleton width={30} />}{(ds?.in_progress ?? 0) > 0 && <span data-sub>{ds!.in_progress} in progress</span>}</div></div>
              </StyledStatStrip>

              {(ds?.maybe_trials ?? 0) > 0 && (
                <StyledNotice style={{ marginBottom: 12 }}>
                  {ds!.maybe_trials} possible trial{ds!.maybe_trials === 1 ? '' : 's'} to review — a matching name started a trial right after their call on a different email. Open the "maybe trial" rows below to approve or dismiss.
                </StyledNotice>
              )}

              <div style={{ overflowX: 'auto' }}>
                <StyledTable>
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Prospect</th>
                      <th>Status</th>
                      <th>Trial</th>
                      <th>Recording</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dailyLoading && <tr><td colSpan={5} style={{ textAlign: 'center', padding: 32 }}><StyledMuted>Loading…</StyledMuted></td></tr>}
                    {!dailyLoading && (daily?.log.length ?? 0) === 0 && <tr><td colSpan={5} style={{ textAlign: 'center', padding: 32 }}><StyledMuted>No calls in this window.</StyledMuted></td></tr>}
                    {(daily?.log ?? []).map((r, i) => {
                      const st = DAY_STATUS[r.status] ?? DAY_STATUS.upcoming;
                      const open = editKey === r.key;
                      const toggle = () => setEditKey(open ? null : r.key);
                      return (
                        <Fragment key={r.key || i}>
                          <tr>
                            <td>{dayRange.from === dayRange.to ? fmtTime(r.time) : `${new Date(r.time).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} ${fmtTime(r.time)}`}</td>
                            <td>
                              <span style={{ fontWeight: 500 }}>{r.name ?? '—'}</span>
                              {r.email && <StyledMuted style={{ marginLeft: 8 }}>{r.email}</StyledMuted>}
                            </td>
                            <td>
                              <StyledChip data-tone={st.tone} data-button onClick={toggle} title="Click to update this call">
                                {st.label}{r.overridden && ' ✎'} ▾
                              </StyledChip>
                            </td>
                            <td>
                              {r.trialed
                                ? <StyledChip data-tone="positive" data-button onClick={toggle} title={r.stripe_email ? `Trial via ${r.stripe_email}` : 'trial'}>✓ trial</StyledChip>
                                : r.maybe
                                  ? <StyledChip data-tone="caution" data-button onClick={toggle} title={`Likely trial: ${r.maybe.name ?? r.maybe.email} started ${r.maybe.mins ?? '?'} min after this call, on a different email (${r.maybe.email}). Click to review.`}>? maybe trial</StyledChip>
                                  : <Button size="small" variant="tertiary" title="Mark trial" onClick={toggle} />}
                            </td>
                            <td>{r.recording ? <StyledExtLink href={r.recording} target="_blank" rel="noreferrer">▶ Watch</StyledExtLink> : <StyledMuted>—</StyledMuted>}</td>
                          </tr>
                          {open && (
                            <tr data-subrow>
                              <td colSpan={5}>
                                <StyledReveal>
                                  <CallEditor row={r} busy={savingKey === r.key} onSave={(p) => saveCall(r.key, p)} onReset={() => resetCall(r.key)} onClose={() => setEditKey(null)} />
                                </StyledReveal>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </StyledTable>
              </div>
              {daily && daily.daily.length > 1 && (
                <StyledDayChips>
                  {daily.daily.map((d) => (
                    <span key={d.date} data-chip>
                      <b>{fmtDayLong(d.date)}</b> · {d.booked} booked · {d.showed} sat · {d.trials} trial
                    </span>
                  ))}
                </StyledDayChips>
              )}
            </StyledCard>

            {/* Commission tracker */}
            <StyledCard>
              <StyledCardHead>
                <StyledCardTitle>Commission</StyledCardTitle>
                <StyledCardHint>10% of every attributed payment · next payout {comm ? fmtDate(comm.next_payout) : '—'}</StyledCardHint>
              </StyledCardHead>
              {rep ? (
                <>
                  <StyledCommRow>
                    <StyledMuted>{rep.payments} payments · {fmtUsd2(rep.revenue)} attributed revenue</StyledMuted>
                    <Button size="small" variant="primary" accent="blue" title="Mark all paid" disabled={busy || rep.outstanding <= 0} onClick={() => markAllPaid(rep)} />
                  </StyledCommRow>
                  <StyledGrid4>
                    <KpiTile kpi={{ label: 'Earned', value: fmtUsd2(rep.earned), to: `/records?type=sales&${repQ}` }} />
                    <KpiTile kpi={{ label: 'Paid to date', value: fmtUsd2(rep.paid), delta: `${rep.payments_paid} payments`, to: `/records?type=sales_comm_paid&${repQ}` }} />
                    <KpiTile kpi={{ label: 'Outstanding', value: fmtUsd2(rep.outstanding), delta: `${rep.payments_due} payments`, valueTone: rep.outstanding > 0 ? 'caution' : 'positive', to: `/records?type=sales_comm_due&${repQ}` }} />
                    <KpiTile kpi={{ label: 'Payments', value: `${rep.payments_paid} / ${rep.payments}`, delta: 'paid / total', to: `/records?type=sales&${repQ}` }} />
                  </StyledGrid4>
                </>
              ) : (
                <StyledGrid4>
                  {Array.from({ length: 4 }).map((_, i) => (
                    <StyledCard key={i} style={{ minHeight: 92, justifyContent: 'space-between' }}>
                      <Skeleton width={70} height={10} />
                      <Skeleton width={80} height={22} />
                    </StyledCard>
                  ))}
                </StyledGrid4>
              )}
            </StyledCard>
          </StyledContent>
        </SkeletonTheme>
      </StyledBody>
    </StyledPage>
  );
};
