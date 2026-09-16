import { styled } from '@linaria/react';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Skeleton, { SkeletonTheme } from 'react-loading-skeleton';
import { IconBuildingSkyscraper, IconRefresh, IconX } from 'twenty-ui/icon';
import { Button } from 'twenty-ui/input';
import { Tag } from 'twenty-ui/data-display';
import { themeCssVariables as t } from 'twenty-ui/theme-constants';

import { PageHeader } from '@/ui/layout/page/components/PageHeader';
import {
  CAUTION,
  fmtDate,
  fmtUsd,
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
  StyledGrid6,
  StyledHeaderActions,
  StyledMuted,
  StyledPage,
  StyledReveal,
  StyledRow,
  StyledTable,
  StyledTextLink,
} from '@/custom-pages/os/ui';
import {
  type AgencyAccounts,
  type AgencyPartner,
  type AgencyPartners,
  clearSaleOverride,
  excludeSale,
  fetchAgencyAccounts,
  fetchAgencyPartners,
  fetchSalesLedger,
  refreshAgencies,
  type SalesLedgerRow,
  setAgencyPartner,
  setSaleAttribution,
  SOURCES,
} from '@/custom-pages/os/data';
import { type Closer, fetchClosers } from '@/custom-pages/os/closers';

type View = 'customers' | 'agencies';
type SourceFilter = 'all' | 'linkedin_outreach' | 'email_marketing' | 'organic' | 'paid_ads' | 'unattributed';

const fmtShortDate = (s: string | null) => (s ? new Date(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '—');
const srcLabel = (s: string | null) => SOURCES.find((x) => x.key === s)?.label ?? '—';
const bucketOf = (r: SalesLedgerRow): SourceFilter => (r.source as SourceFilter) ?? 'unattributed';

const STANDING: Record<string, { label: string; tone: 'positive' | 'caution' | 'danger' }> = {
  good: { label: 'Good standing', tone: 'positive' },
  watch: { label: 'Watch', tone: 'caution' },
  at_risk: { label: 'At risk', tone: 'danger' },
};
const STANDING_ORDER = ['good', 'watch', 'at_risk'];
const PAYMENT_BADGE: Record<string, { label: string; color: 'blue' | 'red' | 'gray' } | null> = {
  active: null,
  trialing: { label: 'Trial', color: 'blue' },
  past_due: { label: 'Payment failed', color: 'red' },
  churned: { label: 'Churned', color: 'gray' },
};

// Same thresholds as the OS: payment problems override usage; otherwise seat fill and
// campaigns per active account decide green / amber / red.
const health = (a: AgencyPartner): 'green' | 'amber' | 'red' | 'grey' => {
  if (a.payment_status === 'churned') return 'grey';
  if (a.payment_status === 'past_due') return 'red';
  const seatPct = a.seats ? a.accounts_active / a.seats : 0;
  const campaignsPerAccount = a.accounts_active ? a.campaigns_active / a.accounts_active : 0;
  if (a.accounts_active <= 1 || a.campaigns_active === 0) return 'red';
  if ((a.accounts_active >= 4 && campaignsPerAccount < 0.4) || seatPct < 0.2) return 'amber';
  return 'green';
};
const HEALTH_COLOR: Record<string, string | undefined> = { green: POSITIVE, amber: CAUTION, red: 'var(--t-tag-text-red)', grey: undefined };

const SORT_COLUMNS: Record<string, { numeric: boolean; get: (r: AgencyPartner) => number | string }> = {
  name: { numeric: false, get: (r) => (r.name ?? '').toLowerCase() },
  plan: { numeric: false, get: (r) => r.plan },
  total_mrr: { numeric: true, get: (r) => r.total_mrr },
  ltv: { numeric: true, get: (r) => r.ltv },
  accounts_active: { numeric: true, get: (r) => r.accounts_active },
};

const SEAT_FILTERS = [
  { key: 'all', label: 'All seats' }, { key: 'disconnected', label: 'Disconnected' }, { key: 'idle', label: 'Idle' }, { key: 'live', label: 'Live' },
] as const;
const SEAT_TONE: Record<string, 'positive' | 'caution' | 'danger'> = { live: 'positive', idle: 'caution', disconnected: 'danger' };

const StyledSelect = styled.select`
  background: ${t.background.primary};
  border: 1px solid ${t.border.color.medium};
  border-radius: ${t.border.radius.sm};
  color: ${t.font.color.primary};
  font-family: inherit;
  font-size: ${t.font.size.sm};
  height: 24px;
  outline: none;
  padding: 0 ${t.spacing[1]};
  transition: border-color 120ms cubic-bezier(0.2, 0, 0, 1);
  &:focus { border-color: ${t.border.color.blue}; }
  &:disabled { opacity: 0.5; }
`;

const StyledNotes = styled.textarea`
  background: ${t.background.primary};
  border: 1px solid ${t.border.color.medium};
  border-radius: ${t.border.radius.sm};
  box-sizing: border-box;
  color: ${t.font.color.primary};
  font-family: inherit;
  font-size: ${t.font.size.sm};
  line-height: 1.4;
  min-width: 200px;
  outline: none;
  padding: ${t.spacing[1]} ${t.spacing[2]};
  resize: vertical;
  transition: border-color 120ms cubic-bezier(0.2, 0, 0, 1);
  width: 100%;
  &:focus { border-color: ${t.border.color.blue}; }
`;

const StyledSortHead = styled.button`
  background: none;
  border: 0;
  color: inherit;
  cursor: pointer;
  font: inherit;
  padding: 0;
  span { color: ${t.font.color.light}; margin-left: 4px; }
`;

const StyledHealthButton = styled.button`
  align-items: center;
  background: none;
  border: 0;
  border-radius: ${t.border.radius.sm};
  color: inherit;
  cursor: pointer;
  display: flex;
  font: inherit;
  gap: ${t.spacing[2]};
  margin: -${t.spacing[1]};
  padding: ${t.spacing[1]};
  text-align: left;
  transition-property: background-color, transform;
  transition-duration: 120ms;
  transition-timing-function: cubic-bezier(0.2, 0, 0, 1);
  &:hover { background: ${t.background.tertiary}; }
  &:active { transform: scale(0.96); }
  &:focus-visible { outline: 2px solid ${t.color.blue}; outline-offset: 2px; }
  span[data-dot] { border-radius: 50%; display: inline-block; flex: none; height: 8px; width: 8px; }
  div[data-sub] { color: ${t.font.color.tertiary}; font-size: ${t.font.size.xs}; }
`;

const StyledSeatList = styled.ul`
  list-style: none;
  margin: 0;
  max-height: 360px;
  overflow: auto;
  padding: 0;
  li {
    align-items: center;
    border-top: 1px solid ${t.border.color.light};
    display: grid;
    gap: ${t.spacing[3]};
    grid-template-columns: minmax(0, 1fr) auto;
    padding: ${t.spacing[2]} 0;
  }
  li:first-child { border-top: 0; }
  div[data-name] { color: ${t.font.color.primary}; font-size: ${t.font.size.sm}; font-weight: ${t.font.weight.medium}; }
  div[data-sub] { color: ${t.font.color.tertiary}; font-size: ${t.font.size.xs}; }
`;

const StyledScroll = styled.div`
  overflow-x: auto;
`;

const SeatDrilldown = ({ agency, onClose }: { agency: AgencyPartner; onClose: () => void }) => {
  const [data, setData] = useState<AgencyAccounts | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<(typeof SEAT_FILTERS)[number]['key']>('all');
  useEffect(() => {
    let live = true;
    setData(null);
    fetchAgencyAccounts(agency.customer_id).then((d) => live && setData(d)).catch((e) => live && setErr((e as Error).message));
    return () => { live = false; };
  }, [agency.customer_id]);
  const summary = data?.summary;
  const seats = useMemo(() => (data?.accounts ?? []).filter((s) => filter === 'all' || s.state === filter), [data, filter]);
  return (
    <StyledReveal>
      <StyledCard>
        <StyledCardHead>
          <div>
            <StyledCardTitle>{agency.name} · seats</StyledCardTitle>
            <StyledCardHint>{summary ? `${summary.live + summary.idle} of ${agency.seats} seats connected · ${summary.requests_sent.toLocaleString()} invites sent` : 'Loading…'}</StyledCardHint>
          </div>
          <Button size="small" variant="tertiary" Icon={IconX} title="Close" onClick={onClose} />
        </StyledCardHead>
        <StyledRow style={{ marginBottom: 12 }}>
          {SEAT_FILTERS.map((f) => {
            const count = f.key === 'all' ? summary?.total : summary?.[f.key];
            return <PillButton key={f.key} title={`${f.label}${count != null ? ` · ${count}` : ''}`} active={filter === f.key} onClick={() => setFilter(f.key)} />;
          })}
        </StyledRow>
        {err && <StyledError>Couldn't load seats: {err}</StyledError>}
        {!err && data === null && <StyledMuted>Loading seats…</StyledMuted>}
        {!err && data !== null && seats.length === 0 && <StyledMuted>No {filter === 'all' ? '' : filter} seats.</StyledMuted>}
        <StyledSeatList>
          {seats.map((s) => (
            <li key={s.account_id}>
              <div>
                <div data-name>{s.label}</div>
                <div data-sub>{s.state === 'disconnected' ? `Needs reconnect${s.last_status_at ? ` · since ${fmtDate(s.last_status_at)}` : ''}` : `${s.requests_sent.toLocaleString()} invites sent${s.state === 'idle' ? ' · not in a campaign' : ''}`}</div>
              </div>
              <StyledChip data-tone={SEAT_TONE[s.state]}>{s.state}</StyledChip>
            </li>
          ))}
        </StyledSeatList>
        <StyledFootnote>Live = running a campaign · Idle = connected, no campaign · Disconnected = login broken</StyledFootnote>
      </StyledCard>
    </StyledReveal>
  );
};

export const CustomersPage = () => {
  const [params, setParams] = useSearchParams();
  const view: View = params.get('view') === 'agencies' ? 'agencies' : 'customers';
  const setView = (next: View) => setParams((p) => { const q = new URLSearchParams(p); q.set('view', next); return q; }, { replace: true });

  /* ---- customers (sales ledger) ---- */
  const [rows, setRows] = useState<SalesLedgerRow[] | null>(null);
  const [closers, setClosers] = useState<Closer[]>([]);
  const [filter, setFilter] = useState<SourceFilter>(() => {
    const b = params.get('b');
    return b === 'unattributed' ? 'unattributed' : b === 'all' ? 'all' : 'linkedin_outreach';
  });
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const loadLedger = () => fetchSalesLedger().then(setRows).catch(() => setRows([]));
  useEffect(() => { loadLedger(); fetchClosers().then(setClosers).catch(() => setClosers([])); }, []);

  const act = async (promise: Promise<unknown>, id: string) => {
    setBusy(id);
    setErr(null);
    try { await promise; await loadLedger(); }
    catch (e) { setErr('Action failed: ' + (e as Error).message); }
    finally { setBusy(null); }
  };

  const closerNames = closers.filter((c) => c.active).map((c) => c.name);
  const defaultCloser = closerNames[0] ?? 'Therapon Savvas';
  const closerShort = (name: string | null) => closers.find((c) => c.name === name)?.name.split(' ')[0] ?? (name ? name.split(' ')[0] : '—');

  const stats = useMemo(() => {
    const all = rows ?? [];
    const s = (f: SourceFilter) => { const r = f === 'all' ? all : all.filter((x) => bucketOf(x) === f); return { n: r.length, v: r.reduce((a, x) => a + (x.total_paid || 0), 0) }; };
    const byCloser = closerNames.map((name) => ({ name, v: all.filter((x) => x.closer === name).reduce((a, x) => a + (x.total_paid || 0), 0) }));
    return { all: s('all'), linkedin: s('linkedin_outreach'), email: s('email_marketing'), organic: s('organic'), paid: s('paid_ads'), unattributed: s('unattributed'), byCloser };
  }, [rows, closerNames.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  const visible = useMemo(() => {
    let r = (rows ?? []).filter((x) => filter === 'all' || bucketOf(x) === filter);
    const s = q.trim().toLowerCase();
    if (s) r = r.filter((x) => (x.name ?? '').toLowerCase().includes(s) || (x.email ?? '').toLowerCase().includes(s));
    return r;
  }, [rows, filter, q]);

  const tabs: { key: SourceFilter; label: string; s: { n: number; v: number } }[] = [
    { key: 'linkedin_outreach', label: 'LinkedIn outreach', s: stats.linkedin },
    { key: 'email_marketing', label: 'Email marketing', s: stats.email },
    { key: 'organic', label: 'Organic', s: stats.organic },
    { key: 'paid_ads', label: 'Paid ads', s: stats.paid },
    { key: 'unattributed', label: 'Unattributed', s: stats.unattributed },
    { key: 'all', label: 'All paid', s: stats.all },
  ];

  /* ---- agencies ---- */
  const [agencies, setAgencies] = useState<AgencyPartners | null>(null);
  const [agencyRows, setAgencyRows] = useState<AgencyPartner[]>([]);
  const [saving, setSaving] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [refreshing, setRefreshing] = useState(false);
  const [refreshStatus, setRefreshStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [drilldown, setDrilldown] = useState<AgencyPartner | null>(null);

  const loadAgencies = () => fetchAgencyPartners().then((d) => { setAgencies(d); setAgencyRows(d.agencies); }).catch((e) => setErr('Agencies: ' + (e as Error).message));
  useEffect(() => { if (view === 'agencies' && agencies === null) loadAgencies(); }, [view]); // eslint-disable-line react-hooks/exhaustive-deps

  const refreshAgencyData = async () => {
    setRefreshing(true);
    setRefreshStatus({ ok: true, msg: 'Starting…' });
    try {
      await refreshAgencies((done, total, label) => setRefreshStatus({ ok: true, msg: `${label} (${done}/${total})` }));
      await loadAgencies();
      setRefreshStatus({ ok: true, msg: 'Up to date' });
    } catch (e) {
      setRefreshStatus({ ok: false, msg: (e as Error).message || 'Refresh failed' });
      await loadAgencies();
    } finally {
      setRefreshing(false);
    }
  };
  const persist = async (customerId: string, status: string, notes: string | null) => {
    setSaving(customerId);
    try { await setAgencyPartner(customerId, status, notes); setSavedAt(customerId); setTimeout(() => setSavedAt((s) => (s === customerId ? null : s)), 1500); }
    catch (e) { setErr("Couldn't save: " + (e as Error).message); }
    finally { setSaving(null); }
  };
  const setLocal = (customerId: string, patch: Partial<AgencyPartner>) => setAgencyRows((rs) => rs.map((r) => (r.customer_id === customerId ? { ...r, ...patch } : r)));
  const toggleSort = (key: string) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir(SORT_COLUMNS[key].numeric ? 'desc' : 'asc'); }
  };
  const sortArrow = (key: string) => <span>{sortKey === key ? (sortDir === 'asc' ? '▲' : '▼') : '↕'}</span>;
  const displayAgencies = useMemo(() => {
    const col = sortKey ? SORT_COLUMNS[sortKey] : null;
    if (!col) return agencyRows;
    return [...agencyRows].sort((a, b) => {
      const av = col.get(a); const bv = col.get(b);
      const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [agencyRows, sortKey, sortDir]);
  const summary = agencies?.summary;
  const seatFill = summary ? summary.total_accounts_active / Math.max(summary.total_seats, 1) : 0;
  const agencyKpis: Kpi[] = summary ? [
    { label: 'Agency partners', value: summary.count, delta: `${summary.agency_count} Agency · ${summary.lite_count} Lite${summary.past_due_count ? ` · ${summary.past_due_count} past due` : ''}${summary.churned_count ? ` · ${summary.churned_count} churned` : ''}`, valueTone: summary.past_due_count || summary.churned_count ? 'caution' : undefined },
    { label: 'Total agency MRR', value: fmtUsd(summary.total_mrr), delta: `${fmtUsd(summary.total_rentals_mrr + summary.total_service_mrr)} from rentals and DFY`, valueTone: 'positive' },
    { label: 'Lifetime value', value: fmtUsd(summary.total_ltv), delta: 'revenue paid to date', valueTone: 'positive' },
    { label: 'Avg MRR per agency', value: fmtUsd(summary.avg_mrr), delta: 'across the portfolio' },
    { label: 'Avg partner tenure', value: `${summary.avg_months} mo`, delta: 'months as a partner' },
    { label: 'Seat utilisation', value: `${summary.total_accounts_active}/${summary.total_seats}`, delta: `${Math.round(seatFill * 100)}% seats · ${summary.total_campaigns_active} campaigns live`, valueTone: seatFill >= 0.6 ? 'positive' : 'caution' },
  ] : [];

  return (
    <StyledPage>
      <PageHeader title="Customers" Icon={IconBuildingSkyscraper}>
        <StyledHeaderActions>
          <PillButton title="Paying customers" active={view === 'customers'} onClick={() => setView('customers')} />
          <PillButton title="Agencies" active={view === 'agencies'} onClick={() => setView('agencies')} />
        </StyledHeaderActions>
      </PageHeader>
      <StyledBody>
        <SkeletonTheme baseColor={'var(--t-background-tertiary)'} highlightColor={'var(--t-background-transparent-lighter)'} borderRadius={4}>
          <StyledContent>
            {err && <StyledError>{err}</StyledError>}

            {view === 'customers' && (
              <>
                <StyledRow>
                  {tabs.map((tab) => <PillButton key={tab.key} title={`${tab.label} · ${tab.s.n} · ${fmtUsd(tab.s.v)}`} active={filter === tab.key} onClick={() => setFilter(tab.key)} />)}
                  <StyledDivider />
                  <StyledField><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or email" style={{ width: 220 }} /></StyledField>
                </StyledRow>
                {filter === 'linkedin_outreach' && stats.byCloser.length > 0 && (
                  <StyledMuted>{stats.byCloser.map((c, i) => <span key={c.name}>{i > 0 && ' · '}{closerShort(c.name)}: <b>{fmtUsd(c.v)}</b></span>)}</StyledMuted>
                )}
                {filter === 'unattributed' && (
                  <StyledMuted>Allocate each to a source (and a closer if LinkedIn outreach), or delete duds. Deletion is only allowed here.</StyledMuted>
                )}
                <StyledCard>
                  <StyledScroll>
                    <StyledTable>
                      <thead><tr><th>Customer</th><th>Paid</th><th>Payments</th><th>First call</th><th>Source</th><th>Closer</th><th>Attribution</th></tr></thead>
                      <tbody>
                        {rows === null && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 24 }}><StyledMuted>Loading…</StyledMuted></td></tr>}
                        {rows !== null && visible.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 24 }}><StyledMuted>No customers.</StyledMuted></td></tr>}
                        {visible.map((r) => {
                          const isBusy = busy === r.customer_id;
                          const isLinkedin = r.source === 'linkedin_outreach';
                          return (
                            <tr key={r.customer_id} style={isBusy ? { opacity: 0.4 } : undefined}>
                              <td>
                                <StyledTextLink to={`/records?type=customer_payments&arg=${encodeURIComponent(r.customer_id)}&name=${encodeURIComponent(r.name ?? '')}&back=/customers`}>{r.name}</StyledTextLink>
                                <div><StyledMuted>{r.email}{r.stripe_email && ` · stripe: ${r.stripe_email}`}</StyledMuted></div>
                              </td>
                              <td>{fmtUsd(r.total_paid)}</td>
                              <td style={r.payments > 1 ? { color: POSITIVE } : undefined}>{r.payments}×</td>
                              <td>{r.fathom_url ? <StyledExtLink href={r.fathom_url} target="_blank" rel="noreferrer">▶ {fmtShortDate(r.first_call)}</StyledExtLink> : <StyledMuted>—</StyledMuted>}</td>
                              <td>{r.source ? srcLabel(r.source) : <StyledMuted>—</StyledMuted>}</td>
                              <td>{isLinkedin ? <span style={{ fontWeight: 500 }}>{closerShort(r.closer)}{r.is_manual && <StyledMuted title="Set manually"> •</StyledMuted>}</span> : <StyledMuted>—</StyledMuted>}</td>
                              <td>
                                <StyledRow>
                                  <StyledSelect disabled={isBusy} value={r.source ?? ''} onChange={(e) => {
                                    const v = e.target.value;
                                    if (v === '') act(clearSaleOverride(r.customer_id), r.customer_id);
                                    else act(setSaleAttribution(r.customer_id, v, v === 'linkedin_outreach' ? (r.closer ?? defaultCloser) : null), r.customer_id);
                                  }}>
                                    <option value="">Auto / reset</option>
                                    {SOURCES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                                  </StyledSelect>
                                  {isLinkedin && (
                                    <StyledSelect disabled={isBusy} value={r.closer ?? defaultCloser} onChange={(e) => act(setSaleAttribution(r.customer_id, 'linkedin_outreach', e.target.value), r.customer_id)}>
                                      {(r.closer && !closerNames.includes(r.closer) ? [r.closer, ...closerNames] : closerNames).map((name) => <option key={name} value={name}>{name}</option>)}
                                    </StyledSelect>
                                  )}
                                  {!r.source && <Button size="small" variant="tertiary" title="Delete dud" disabled={isBusy} onClick={() => { if (window.confirm(`Delete ${r.name}? This hides a dud from every number.`)) act(excludeSale(r.customer_id), r.customer_id); }} />}
                                </StyledRow>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </StyledTable>
                  </StyledScroll>
                  <StyledFootnote>Showing {visible.length} of {stats.all.n} paying customers · changes save instantly · deleted duds are hidden</StyledFootnote>
                </StyledCard>
              </>
            )}

            {view === 'agencies' && (
              <>
                <StyledRow style={{ justifyContent: 'space-between' }}>
                  <StyledMuted>Priority accounts: live MRR across every subscription (plan, rentals, services), lifetime value, standing and notes.</StyledMuted>
                  <StyledRow>
                    {refreshStatus && !refreshing && <Tag color={refreshStatus.ok ? 'green' : 'orange'} text={refreshStatus.msg} />}
                    {refreshing && <StyledMuted>{refreshStatus?.msg}</StyledMuted>}
                    <Button size="small" variant="secondary" Icon={IconRefresh} title={refreshing ? 'Refreshing…' : 'Refresh data'} disabled={refreshing} onClick={refreshAgencyData} />
                  </StyledRow>
                </StyledRow>
                <StyledGrid6>
                  {summary ? agencyKpis.map((k) => <KpiTile key={k.label} kpi={k} />) : Array.from({ length: 6 }).map((_, i) => (
                    <StyledCard key={i} style={{ minHeight: 92, justifyContent: 'space-between' }}><Skeleton width={90} height={10} /><Skeleton width={60} height={22} /><Skeleton width={40} height={10} /></StyledCard>
                  ))}
                </StyledGrid6>
                {drilldown && <SeatDrilldown agency={drilldown} onClose={() => setDrilldown(null)} />}
                <StyledCard>
                  <StyledCardHead>
                    <StyledCardTitle>Portfolio</StyledCardTitle>
                    <StyledCardHint>MRR = all active subscriptions · LTV = paid to date · edit standing and notes inline</StyledCardHint>
                  </StyledCardHead>
                  <StyledScroll>
                    <StyledTable>
                      <thead>
                        <tr>
                          <th><StyledSortHead onClick={() => toggleSort('name')}>Agency {sortArrow('name')}</StyledSortHead></th>
                          <th><StyledSortHead onClick={() => toggleSort('plan')}>Plan {sortArrow('plan')}</StyledSortHead></th>
                          <th><StyledSortHead onClick={() => toggleSort('total_mrr')}>MRR / mo {sortArrow('total_mrr')}</StyledSortHead></th>
                          <th><StyledSortHead onClick={() => toggleSort('ltv')}>LTV {sortArrow('ltv')}</StyledSortHead></th>
                          <th><StyledSortHead onClick={() => toggleSort('accounts_active')}>Activity {sortArrow('accounts_active')}</StyledSortHead></th>
                          <th>Standing</th>
                          <th>Notes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {agencies === null && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 24 }}><StyledMuted>Loading…</StyledMuted></td></tr>}
                        {displayAgencies.map((r) => {
                          const standing = STANDING[r.status] ?? STANDING.good;
                          const pay = PAYMENT_BADGE[r.payment_status];
                          const h = health(r);
                          const seatPct = r.seats ? Math.round((r.accounts_active / r.seats) * 100) : 0;
                          return (
                            <tr key={r.customer_id} style={r.payment_status === 'churned' ? { opacity: 0.6 } : undefined}>
                              <td>
                                <div style={{ fontWeight: 500 }}>{r.name}</div>
                                <StyledMuted>{r.email ?? '—'}</StyledMuted>
                                {pay && <div style={{ marginTop: 4 }}><Tag color={pay.color} text={pay.label} /></div>}
                              </td>
                              <td><StyledChip>{r.plan}</StyledChip></td>
                              <td>
                                <div style={{ fontWeight: 600 }}>{fmtUsd(r.total_mrr)}</div>
                                <StyledMuted>{fmtUsd(r.software_mrr)} plan{r.rentals_mrr > 0 ? ` + ${fmtUsd(r.rentals_mrr)} rentals` : ''}{r.service_mrr > 0 ? ` + ${fmtUsd(r.service_mrr)} DFY` : ''}</StyledMuted>
                              </td>
                              <td><div style={{ fontWeight: 600 }}>{fmtUsd(r.ltv)}</div><StyledMuted>{r.months_active} mo</StyledMuted></td>
                              <td>
                                <StyledHealthButton type="button" onClick={() => setDrilldown(r)} title="View this agency's seats: live, idle and disconnected">
                                  <span data-dot style={{ background: HEALTH_COLOR[h] ?? 'var(--t-font-color-light)' }} />
                                  <div>
                                    <div>{r.accounts_active}/{r.seats} seats <StyledMuted>({seatPct}%)</StyledMuted></div>
                                    <div data-sub>{r.campaigns_active} campaign{r.campaigns_active === 1 ? '' : 's'} live{r.accounts_total > r.accounts_active ? ` · ${r.accounts_total - r.accounts_active} disconnected` : ''}</div>
                                  </div>
                                </StyledHealthButton>
                              </td>
                              <td>
                                <StyledRow>
                                  <StyledChip data-tone={standing.tone === 'danger' ? 'caution' : standing.tone}>{standing.label}</StyledChip>
                                  <StyledSelect value={r.status} disabled={saving === r.customer_id} onChange={(e) => { setLocal(r.customer_id, { status: e.target.value }); persist(r.customer_id, e.target.value, r.notes); }}>
                                    {STANDING_ORDER.map((k) => <option key={k} value={k}>{STANDING[k].label}</option>)}
                                  </StyledSelect>
                                </StyledRow>
                              </td>
                              <td>
                                <StyledNotes rows={2} value={r.notes ?? ''} placeholder="Feature requests, health, action items"
                                  onChange={(e) => setLocal(r.customer_id, { notes: e.target.value })}
                                  onBlur={(e) => persist(r.customer_id, r.status, e.target.value || null)} />
                                {savedAt === r.customer_id && <StyledMuted style={{ color: POSITIVE }}>✓ saved</StyledMuted>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </StyledTable>
                  </StyledScroll>
                  {summary && <StyledFootnote>{summary.count} agencies · {fmtUsd(summary.total_mrr)} MRR · {fmtUsd(summary.total_ltv)} lifetime</StyledFootnote>}
                </StyledCard>
              </>
            )}
          </StyledContent>
        </SkeletonTheme>
      </StyledBody>
    </StyledPage>
  );
};
