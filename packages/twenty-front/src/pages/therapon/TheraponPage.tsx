import { styled } from '@linaria/react';
import { Fragment, useEffect, useState } from 'react';
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
  StyledFootnote,
  StyledGrid4,
  StyledGrid5,
  StyledHeaderActions,
  StyledLabel,
  StyledMuted,
  StyledNotice,
  StyledPage,
  StyledRow,
  StyledTable,
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

/* page-specific styled */
const StyledSegments = styled.div`
  background: ${t.background.tertiary};
  border-radius: ${t.border.radius.pill};
  display: flex;
  gap: 2px;
  height: 10px;
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
  gap: ${t.spacing[2]} ${t.spacing[5]};
  margin-top: ${t.spacing[3]};
  font-size: ${t.font.size.sm};
  span[data-dot] {
    border-radius: 2px;
    display: inline-block;
    height: 10px;
    margin-right: ${t.spacing[1]};
    vertical-align: -1px;
    width: 10px;
  }
  span[data-dot='positive'] { background: ${POSITIVE}; }
  span[data-dot='caution'] { background: ${CAUTION}; }
  span[data-dot='accent'] { background: ${ACCENT}; }
  b { font-variant-numeric: tabular-nums; }
  i { color: ${t.font.color.tertiary}; font-style: normal; margin-left: ${t.spacing[1]}; }
`;

const StyledBig = styled.span`
  font-size: ${t.font.size.xxl};
  font-weight: ${t.font.weight.semiBold};
  font-variant-numeric: tabular-nums;
`;

const StyledEditor = styled.div`
  background: ${t.background.secondary};
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
  margin-top: ${t.spacing[4]};
  padding-top: ${t.spacing[3]};
  span[data-chip] {
    background: ${t.background.secondary};
    border: 1px solid ${t.border.color.medium};
    border-radius: ${t.border.radius.sm};
    font-size: ${t.font.size.xs};
    padding: ${t.spacing[1]} ${t.spacing[2]};
  }
`;

const StyledCommStat = styled.div`
  display: grid;
  gap: ${t.spacing[3]};
  grid-template-columns: repeat(4, minmax(0, 1fr));
  @media (max-width: 640px) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
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
  const cashSeries = [...monthly]
    .sort((a, b) => a.month_key.localeCompare(b.month_key))
    .map((r) => ({ label: moLabel(r.month_key), value: cash?.monthly[r.month_key] ?? 0, sublabel: moLabel(r.month_key) }));
  const rep = comm?.reps.find((r) => r.rep === CLOSER);
  const pills = [{ key: 'all', label: 'All time' }, ...monthly.map((r) => ({ key: r.month_key, label: r.month.replace(' 2026', " '26") }))];
  const qp = all ? '' : `&month=${mk}`;
  const repQ = `arg=${encodeURIComponent(CLOSER)}&name=${encodeURIComponent(CLOSER)}`;

  const kpis: Kpi[] = [
    { label: 'Appointments held', value: (suD?.held ?? 0).toLocaleString(), delta: `took place · ${(suD?.upcoming ?? 0).toLocaleString()} upcoming`, to: '/showup' },
    { label: 'Appointments sat', value: (suD?.recorded ?? 0).toLocaleString(), delta: 'Fathom-confirmed', to: `/records?type=calls${qp}` },
    { label: 'Show-up rate', value: suD?.rate != null ? `${suD.rate}%` : '—', delta: `${suD?.recorded ?? 0}/${suD?.held ?? 0} held`, valueTone: (suD?.rate ?? 0) >= 55 ? 'positive' : 'caution', to: '/showup' },
    { label: 'Cancellations', value: suD?.cancel_rate != null ? `${suD.cancel_rate}%` : '—', delta: `${suD?.canceled ?? 0} genuine`, valueTone: 'caution', to: `/records?type=cancellations${qp}` },
    { label: 'Trials started', value: (cvD?.sat_trials ?? 0).toLocaleString(), delta: `of ${cvD?.trials_total ?? 0} total`, to: `/records?type=trials${qp}` },
    { label: 'Trial conversion', value: cvD?.rate != null ? `${cvD.rate}%` : '—', delta: `${cvD?.sat_trials ?? 0}/${cvD?.sat ?? 0} sat`, valueTone: (cvD?.rate ?? 0) >= 30 ? 'positive' : 'caution', to: `/records?type=trials${qp}` },
    { label: 'Sales (his)', value: `${salesHis.toLocaleString()} · ${salesActive} active`, delta: `${fmtUsd(salesMrr)}/mo · ${salesActive} of ${salesHis} still subscribed`, valueTone: 'positive', to: `/records?type=therapon_customers${qp}` },
    { label: 'Cash collected', value: fmtUsd(cashHis), delta: 'his attributed sales', valueTone: 'positive', to: `/records?type=sales${qp}` },
  ];

  const sat = suD?.recorded ?? 0;
  const ns = suD?.no_show ?? 0;
  const upc = suD?.upcoming ?? 0;
  const held = suD?.held ?? 0;
  const resc = suD?.rescheduled ?? 0;
  const can = suD?.canceled ?? 0;
  const real = held + upc;
  const segs: { label: string; n: number; tone: 'positive' | 'caution' | 'accent' }[] = [
    { label: 'Sat (showed)', n: sat, tone: 'positive' },
    { label: 'No-show', n: ns, tone: 'caution' },
    { label: 'Upcoming', n: upc, tone: 'accent' },
  ];

  return (
    <StyledPage>
      <PageHeader title="Therapon" Icon={IconUser}>
        <StyledHeaderActions>
          <StyledMuted>Sales closer · funnel, conversion and 10% commission</StyledMuted>
        </StyledHeaderActions>
      </PageHeader>
      <StyledBody>
        <StyledContent>
          {err && <StyledError>{err}</StyledError>}

          <StyledRow>
            <StyledLabel>Period</StyledLabel>
            {pills.map((p) => <PillButton key={p.key} title={p.label} active={period === p.key} onClick={() => setPeriod(p.key)} />)}
          </StyledRow>

          <StyledGrid4>
            {kpis.map((k) => <KpiTile key={k.label} kpi={k} />)}
          </StyledGrid4>

          {/* Appointment breakdown — a reschedule is one appointment (counted at its new time), not two. */}
          <StyledCard>
            <StyledCardHead>
              <StyledCardTitle>Appointment breakdown</StyledCardTitle>
              <StyledCardHint>a reschedule counts once · cancellations & reschedules aren't real appointments</StyledCardHint>
            </StyledCardHead>
            <div>
              <StyledBig>{real.toLocaleString()}</StyledBig>
              <StyledMuted style={{ marginLeft: 8 }}>real appointments · {held.toLocaleString()} held + {upc.toLocaleString()} upcoming</StyledMuted>
            </div>
            <StyledSegments>
              {segs.filter((s) => s.n > 0).map((s) => (
                <div key={s.label} data-seg={s.tone} style={{ width: `${(s.n / Math.max(real, 1)) * 100}%` }} title={`${s.label}: ${s.n}`} />
              ))}
            </StyledSegments>
            <StyledLegend>
              {segs.map((s) => (
                <span key={s.label}><span data-dot={s.tone} /><b>{s.n.toLocaleString()}</b><i>{s.label}</i></span>
              ))}
            </StyledLegend>
            <StyledFootnote>
              Counts new appointments only — Discovery, Demo & Agency Demo. "Next Steps" follow-up calls with existing prospects are separate, not counted here.
              <br />
              Not counted: {resc.toLocaleString()} rescheduled (moved to a new time — counted once) · {can.toLocaleString()} cancelled
              {all && " · tracking starts 30 Mar 2026, Therapon's first call — nothing earlier"}
            </StyledFootnote>
          </StyledCard>

          {/* Daily call log */}
          <StyledCard>
            <StyledCardHead>
              <StyledRow>
                <StyledCardTitle>Daily call log</StyledCardTitle>
                <Button size="small" variant="secondary" Icon={IconRefresh} title={fathomBusy ? 'Syncing Fathom…' : 'Refresh Fathom'} disabled={fathomBusy} onClick={refreshFathomNow} />
                {!fathomBusy && fathomStatus && (
                  <span title={fathomStatus.msg}>
                    <Tag color={fathomStatus.ok ? 'green' : 'orange'} text={fathomStatus.ok ? `Updated ${fathomStatus.at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : 'Failed — try again'} />
                  </span>
                )}
                <StyledMuted>
                  {dayRange.from === dayRange.to ? fmtDayLong(dayRange.from) : `${fmtDayLong(dayRange.from)} → ${fmtDayLong(dayRange.to)}`}
                </StyledMuted>
              </StyledRow>
              <StyledRow>
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
              </StyledRow>
            </StyledCardHead>

            <StyledGrid5 style={{ marginBottom: 16 }}>
              <KpiTile kpi={{ label: 'Calls booked', value: String(daily?.summary.booked ?? 0), delta: 'new appointments' }} />
              <KpiTile kpi={{ label: 'Showed up', value: String(daily?.summary.showed ?? 0), delta: daily?.summary.show_up_rate != null ? `${daily.summary.show_up_rate}% show-up` : 'attended', valueTone: 'positive' }} />
              <KpiTile kpi={{ label: 'No-shows', value: String(daily?.summary.no_show ?? 0), delta: "didn't attend", valueTone: 'caution' }} />
              <KpiTile kpi={{ label: 'Started trial', value: String(daily?.summary.trials ?? 0), delta: 'of those who sat', valueTone: 'positive' }} />
              <KpiTile kpi={{ label: 'Upcoming', value: String(daily?.summary.upcoming ?? 0), delta: (daily?.summary.in_progress ?? 0) > 0 ? `${daily!.summary.in_progress} in progress now` : 'later / not yet held', valueTone: (daily?.summary.in_progress ?? 0) > 0 ? 'positive' : undefined }} />
            </StyledGrid5>

            {(daily?.summary.maybe_trials ?? 0) > 0 && (
              <StyledNotice style={{ marginBottom: 12 }}>
                {daily!.summary.maybe_trials} possible trial{daily!.summary.maybe_trials === 1 ? '' : 's'} to review — someone with a matching name started a trial right after their call on a different email. Look for the "maybe trial" tags below and approve or dismiss.
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
                                : <Button size="small" variant="tertiary" title="+ mark trial" onClick={toggle} />}
                          </td>
                          <td>{r.recording ? <StyledExtLink href={r.recording} target="_blank" rel="noreferrer">▶ Watch</StyledExtLink> : <StyledMuted>—</StyledMuted>}</td>
                        </tr>
                        {open && (
                          <tr data-subrow>
                            <td colSpan={5}>
                              <CallEditor row={r} busy={savingKey === r.key} onSave={(p) => saveCall(r.key, p)} onReset={() => resetCall(r.key)} onClose={() => setEditKey(null)} />
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
                    <b>{fmtDayLong(d.date)}</b> · {d.booked} booked · <span style={{ color: POSITIVE }}>{d.showed} sat</span> · {d.trials} trial
                  </span>
                ))}
              </StyledDayChips>
            )}
          </StyledCard>

          {/* Cash chart */}
          <StyledCard>
            <StyledCardHead>
              <StyledCardTitle>Cash collected — Therapon (monthly)</StyledCardTitle>
              <StyledCardHint>{fmtUsd(cash?.total ?? 0)} lifetime</StyledCardHint>
            </StyledCardHead>
            <Chart data={cashSeries} format={(n) => fmtUsd(n)} color={POSITIVE} height={200} />
          </StyledCard>

          {/* Commission tracker */}
          <StyledCard>
            <StyledCardHead>
              <StyledCardTitle>Commission payout tracker</StyledCardTitle>
              <StyledCardHint>Next payout · {comm ? fmtDate(comm.next_payout) : '—'}</StyledCardHint>
            </StyledCardHead>
            {rep && (
              <>
                <StyledRow style={{ justifyContent: 'space-between', marginBottom: 16 }}>
                  <StyledMuted>
                    {rep.payments} payments · {fmtUsd2(rep.revenue)} attributed revenue · 10% commission
                  </StyledMuted>
                  <Button size="small" variant="primary" accent="blue" title="Mark all paid" disabled={busy || rep.outstanding <= 0} onClick={() => markAllPaid(rep)} />
                </StyledRow>
                <StyledCommStat>
                  <KpiTile kpi={{ label: 'Earned (10%)', value: fmtUsd2(rep.earned), to: `/records?type=sales&${repQ}` }} />
                  <KpiTile kpi={{ label: 'Paid to date', value: fmtUsd2(rep.paid), to: `/records?type=sales_comm_paid&${repQ}` }} />
                  <KpiTile kpi={{ label: 'Outstanding', value: fmtUsd2(rep.outstanding), valueTone: rep.outstanding > 0 ? 'caution' : 'positive', to: `/records?type=sales_comm_due&${repQ}` }} />
                  <KpiTile kpi={{ label: 'Payments', value: `${rep.payments_paid}/${rep.payments}`, to: `/records?type=sales&${repQ}` }} />
                </StyledCommStat>
                <StyledFootnote>10% of every attributed payment · open <b>Outstanding</b> to mark individual payments paid, or "Mark all paid" on payout day (the 31st)</StyledFootnote>
              </>
            )}
            {!rep && <StyledMuted>Loading commission…</StyledMuted>}
          </StyledCard>
        </StyledContent>
      </StyledBody>
    </StyledPage>
  );
};
