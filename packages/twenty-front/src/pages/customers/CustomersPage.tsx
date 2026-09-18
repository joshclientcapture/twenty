import { styled } from '@linaria/react';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Skeleton, { SkeletonTheme } from 'react-loading-skeleton';
import { IconBuildingSkyscraper, IconRefresh, IconX } from 'twenty-ui/icon';
import { Button } from 'twenty-ui/input';
import { Tag } from 'twenty-ui/data-display';
import { themeCssVariables as t } from 'twenty-ui/theme-constants';

import { PageHeader } from '@/ui/layout/page/components/PageHeader';
import { CustomerMap } from '@/custom-pages/os/CustomerMap';
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
import { OsSelect } from '@/custom-pages/os/OsSelect';
import { useConfirm } from '@/custom-pages/os/useConfirm';
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

// Attribution editing (source / closer dropdowns, dud deletion, per-closer totals) is parked
// until the ledger itself is settled. Flip to true to bring the controls back.
const SHOW_ATTRIBUTION = false;

type View = 'customers' | 'agencies' | 'map';
type LedgerSortKey =
  | 'name'
  | 'total_paid'
  | 'payments'
  | 'first_paid'
  | 'last_paid'
  | 'status';

const srcLabel = (s: string | null) =>
  SOURCES.find((x) => x.key === s)?.label ?? '—';
const firstName = (name: string | null) => (name ? name.split(' ')[0] : '—');

const SORT_OPTIONS: { key: LedgerSortKey; label: string }[] = [
  { key: 'total_paid', label: 'Total paid' },
  { key: 'name', label: 'Name' },
  { key: 'payments', label: 'Payments' },
  { key: 'first_paid', label: 'First paid' },
  { key: 'last_paid', label: 'Last paid' },
  { key: 'status', label: 'Status' },
];

const LEDGER_SORT: Record<
  LedgerSortKey,
  { numeric: boolean; get: (r: SalesLedgerRow) => number | string }
> = {
  name: { numeric: false, get: (r) => (r.name ?? '').toLowerCase() },
  total_paid: { numeric: true, get: (r) => r.total_paid ?? 0 },
  payments: { numeric: true, get: (r) => r.payments ?? 0 },
  first_paid: {
    numeric: true,
    get: (r) => (r.first_paid ? new Date(r.first_paid).getTime() : 0),
  },
  last_paid: {
    numeric: true,
    get: (r) => (r.last_paid ? new Date(r.last_paid).getTime() : 0),
  },
  status: { numeric: false, get: (r) => r.status ?? '' },
};

const STANDING: Record<
  string,
  { label: string; tone: 'positive' | 'caution' }
> = {
  good: { label: 'Good standing', tone: 'positive' },
  watch: { label: 'Watch', tone: 'caution' },
  at_risk: { label: 'At risk', tone: 'caution' },
};
const STANDING_ORDER = ['good', 'watch', 'at_risk'];
const PAYMENT_BADGE: Record<
  string,
  { label: string; color: 'blue' | 'red' | 'gray' } | null
> = {
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
  const campaignsPerAccount = a.accounts_active
    ? a.campaigns_active / a.accounts_active
    : 0;
  if (a.accounts_active <= 1 || a.campaigns_active === 0) return 'red';
  if ((a.accounts_active >= 4 && campaignsPerAccount < 0.4) || seatPct < 0.2)
    return 'amber';
  return 'green';
};
const HEALTH_COLOR: Record<string, string | undefined> = {
  green: POSITIVE,
  amber: CAUTION,
  red: 'var(--t-tag-text-red)',
  grey: undefined,
};

const AGENCY_SORT: Record<
  string,
  { numeric: boolean; get: (r: AgencyPartner) => number | string }
> = {
  name: { numeric: false, get: (r) => (r.name ?? '').toLowerCase() },
  plan: { numeric: false, get: (r) => r.plan },
  total_mrr: { numeric: true, get: (r) => r.total_mrr },
  ltv: { numeric: true, get: (r) => r.ltv },
  accounts_active: { numeric: true, get: (r) => r.accounts_active },
};

const SEAT_FILTERS = [
  { key: 'all', label: 'All seats' },
  { key: 'disconnected', label: 'Disconnected' },
  { key: 'idle', label: 'Idle' },
  { key: 'live', label: 'Live' },
] as const;
const SEAT_TONE: Record<string, 'positive' | 'caution'> = {
  live: 'positive',
  idle: 'caution',
  disconnected: 'caution',
};

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
  &:focus {
    border-color: ${t.border.color.blue};
  }
  &:disabled {
    opacity: 0.5;
  }
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
  &:focus {
    border-color: ${t.border.color.blue};
  }
`;

const StyledSortHead = styled.button`
  background: none;
  border: 0;
  border-radius: 2px;
  color: inherit;
  cursor: pointer;
  font: inherit;
  padding: 0;
  white-space: nowrap;
  span {
    color: ${t.font.color.light};
    margin-left: 4px;
  }
  &[data-on] {
    color: ${t.font.color.primary};
  }
  &[data-on] span {
    color: ${t.font.color.secondary};
  }
  &:focus-visible {
    outline: 2px solid ${t.color.blue};
    outline-offset: 2px;
  }
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
  &:hover {
    background: ${t.background.tertiary};
  }
  &:active {
    transform: scale(0.96);
  }
  &:focus-visible {
    outline: 2px solid ${t.color.blue};
    outline-offset: 2px;
  }
  span[data-dot] {
    border-radius: 50%;
    display: inline-block;
    flex: none;
    height: 8px;
    width: 8px;
  }
  div[data-sub] {
    color: ${t.font.color.tertiary};
    font-size: ${t.font.size.xs};
  }
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
  li:first-child {
    border-top: 0;
  }
  div[data-name] {
    color: ${t.font.color.primary};
    font-size: ${t.font.size.sm};
    font-weight: ${t.font.weight.medium};
  }
  div[data-sub] {
    color: ${t.font.color.tertiary};
    font-size: ${t.font.size.xs};
  }
`;

const StyledScroll = styled.div`
  overflow-x: auto;
`;

const StyledLedgerRow = styled.tr`
  td[data-num] {
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  td[data-name] div[data-primary] {
    color: ${t.font.color.primary};
    font-weight: ${t.font.weight.medium};
  }
  td[data-name] div[data-secondary] {
    color: ${t.font.color.tertiary};
    font-size: ${t.font.size.xs};
  }
`;

const SortHead = ({
  label,
  sortKey,
  activeKey,
  dir,
  onSort,
}: {
  label: string;
  sortKey: string;
  activeKey: string | null;
  dir: 'asc' | 'desc';
  onSort: (key: string) => void;
}) => (
  <StyledSortHead
    data-on={activeKey === sortKey ? '' : undefined}
    onClick={() => onSort(sortKey)}
  >
    {label}
    <span>{activeKey === sortKey ? (dir === 'asc' ? '▲' : '▼') : '↕'}</span>
  </StyledSortHead>
);

const SeatDrilldown = ({
  agency,
  onClose,
}: {
  agency: AgencyPartner;
  onClose: () => void;
}) => {
  const [data, setData] = useState<AgencyAccounts | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] =
    useState<(typeof SEAT_FILTERS)[number]['key']>('all');
  useEffect(() => {
    let live = true;
    setData(null);
    fetchAgencyAccounts(agency.customer_id)
      .then((d) => live && setData(d))
      .catch((e) => live && setErr((e as Error).message));
    return () => {
      live = false;
    };
  }, [agency.customer_id]);
  const summary = data?.summary;
  const seats = useMemo(
    () =>
      (data?.accounts ?? []).filter(
        (s) => filter === 'all' || s.state === filter,
      ),
    [data, filter],
  );
  return (
    <StyledReveal>
      <StyledCard>
        <StyledCardHead>
          <div>
            <StyledCardTitle>{agency.name} · seats</StyledCardTitle>
            <StyledCardHint>
              {summary
                ? `${summary.live + summary.idle} of ${agency.seats} seats connected · ${summary.requests_sent.toLocaleString()} invites sent`
                : 'Loading…'}
            </StyledCardHint>
          </div>
          <Button
            size="small"
            variant="tertiary"
            Icon={IconX}
            title="Close"
            onClick={onClose}
          />
        </StyledCardHead>
        <StyledRow style={{ marginBottom: 12 }}>
          {SEAT_FILTERS.map((f) => {
            const count = f.key === 'all' ? summary?.total : summary?.[f.key];
            return (
              <PillButton
                key={f.key}
                title={`${f.label}${count != null ? ` · ${count}` : ''}`}
                active={filter === f.key}
                onClick={() => setFilter(f.key)}
              />
            );
          })}
        </StyledRow>
        {err && <StyledError>Couldn't load seats: {err}</StyledError>}
        {!err && data === null && <StyledMuted>Loading seats…</StyledMuted>}
        {!err && data !== null && seats.length === 0 && (
          <StyledMuted>No {filter === 'all' ? '' : filter} seats.</StyledMuted>
        )}
        <StyledSeatList>
          {seats.map((s) => (
            <li key={s.account_id}>
              <div>
                <div data-name>{s.label}</div>
                <div data-sub>
                  {s.state === 'disconnected'
                    ? `Needs reconnect${s.last_status_at ? ` · since ${fmtDate(s.last_status_at)}` : ''}`
                    : `${s.requests_sent.toLocaleString()} invites sent${s.state === 'idle' ? ' · not in a campaign' : ''}`}
                </div>
              </div>
              <StyledChip data-tone={SEAT_TONE[s.state]}>{s.state}</StyledChip>
            </li>
          ))}
        </StyledSeatList>
        <StyledFootnote>
          Live = running a campaign · Idle = connected, no campaign ·
          Disconnected = login broken
        </StyledFootnote>
      </StyledCard>
    </StyledReveal>
  );
};

export const CustomersPage = () => {
  const { confirm, ConfirmHost } = useConfirm('customers');
  const [params, setParams] = useSearchParams();
  const viewParam = params.get('view');
  const view: View =
    viewParam === 'agencies'
      ? 'agencies'
      : viewParam === 'map'
        ? 'map'
        : 'customers';
  const setView = (next: View) =>
    setParams(
      (p) => {
        const q = new URLSearchParams(p);
        q.set('view', next);
        return q;
      },
      { replace: true },
    );

  /* ---- customers (sales ledger) ---- */
  const [rows, setRows] = useState<SalesLedgerRow[] | null>(null);
  const [closers, setClosers] = useState<Closer[]>([]);
  const [q, setQ] = useState('');
  const [sortKey, setSortKey] = useState<LedgerSortKey>('total_paid');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const loadLedger = () =>
    fetchSalesLedger()
      .then(setRows)
      .catch(() => setRows([]));
  useEffect(() => {
    loadLedger();
    if (SHOW_ATTRIBUTION)
      fetchClosers()
        .then(setClosers)
        .catch(() => setClosers([]));
  }, []);

  const act = async (promise: Promise<unknown>, id: string) => {
    setBusy(id);
    setErr(null);
    try {
      await promise;
      await loadLedger();
    } catch (e) {
      setErr('Action failed: ' + (e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const closerNames = closers.filter((c) => c.active).map((c) => c.name);
  const defaultCloser = closerNames[0] ?? 'Therapon Savvas';

  const visible = useMemo(() => {
    let r = rows ?? [];
    const s = q.trim().toLowerCase();
    if (s)
      r = r.filter(
        (x) =>
          (x.name ?? '').toLowerCase().includes(s) ||
          (x.email ?? '').toLowerCase().includes(s),
      );
    const col = LEDGER_SORT[sortKey];
    return [...r].sort((a, b) => {
      const av = col.get(a);
      const bv = col.get(b);
      const cmp =
        typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : String(av).localeCompare(String(bv));
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [rows, q, sortKey, sortDir]);
  const visibleTotal = visible.reduce((a, r) => a + (r.total_paid || 0), 0);

  const onLedgerSort = (key: string) => {
    const k = key as LedgerSortKey;
    if (sortKey === k) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(k);
      setSortDir(LEDGER_SORT[k].numeric ? 'desc' : 'asc');
    }
  };

  /* ---- agencies ---- */
  const [agencies, setAgencies] = useState<AgencyPartners | null>(null);
  const [agencyRows, setAgencyRows] = useState<AgencyPartner[]>([]);
  const [saving, setSaving] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [agencySortKey, setAgencySortKey] = useState<string | null>(null);
  const [agencySortDir, setAgencySortDir] = useState<'asc' | 'desc'>('desc');
  const [refreshing, setRefreshing] = useState(false);
  const [refreshStatus, setRefreshStatus] = useState<{
    ok: boolean;
    msg: string;
  } | null>(null);
  const [drilldown, setDrilldown] = useState<AgencyPartner | null>(null);

  const loadAgencies = () =>
    fetchAgencyPartners()
      .then((d) => {
        setAgencies(d);
        setAgencyRows(d.agencies);
      })
      .catch((e) => setErr('Agencies: ' + (e as Error).message));
  useEffect(() => {
    if (view === 'agencies' && agencies === null) loadAgencies();
  }, [view]); // eslint-disable-line react-hooks/exhaustive-deps

  const refreshAgencyData = async () => {
    setRefreshing(true);
    setRefreshStatus({ ok: true, msg: 'Starting…' });
    try {
      await refreshAgencies((done, total, label) =>
        setRefreshStatus({ ok: true, msg: `${label} (${done}/${total})` }),
      );
      await loadAgencies();
      setRefreshStatus({ ok: true, msg: 'Up to date' });
    } catch (e) {
      setRefreshStatus({
        ok: false,
        msg: (e as Error).message || 'Refresh failed',
      });
      await loadAgencies();
    } finally {
      setRefreshing(false);
    }
  };
  const persist = async (
    customerId: string,
    status: string,
    notes: string | null,
  ) => {
    setSaving(customerId);
    try {
      await setAgencyPartner(customerId, status, notes);
      setSavedAt(customerId);
      setTimeout(() => setSavedAt((s) => (s === customerId ? null : s)), 1500);
    } catch (e) {
      setErr("Couldn't save: " + (e as Error).message);
    } finally {
      setSaving(null);
    }
  };
  const setLocal = (customerId: string, patch: Partial<AgencyPartner>) =>
    setAgencyRows((rs) =>
      rs.map((r) => (r.customer_id === customerId ? { ...r, ...patch } : r)),
    );
  const onAgencySort = (key: string) => {
    if (agencySortKey === key)
      setAgencySortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setAgencySortKey(key);
      setAgencySortDir(AGENCY_SORT[key].numeric ? 'desc' : 'asc');
    }
  };
  const displayAgencies = useMemo(() => {
    const col = agencySortKey ? AGENCY_SORT[agencySortKey] : null;
    if (!col) return agencyRows;
    return [...agencyRows].sort((a, b) => {
      const av = col.get(a);
      const bv = col.get(b);
      const cmp =
        typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : String(av).localeCompare(String(bv));
      return agencySortDir === 'asc' ? cmp : -cmp;
    });
  }, [agencyRows, agencySortKey, agencySortDir]);
  const summary = agencies?.summary;
  const seatFill = summary
    ? summary.total_accounts_active / Math.max(summary.total_seats, 1)
    : 0;
  const agencyKpis: Kpi[] = summary
    ? [
        {
          label: 'Agency partners',
          value: summary.count,
          delta: `${summary.agency_count} Agency · ${summary.lite_count} Lite${summary.past_due_count ? ` · ${summary.past_due_count} past due` : ''}${summary.churned_count ? ` · ${summary.churned_count} churned` : ''}`,
          valueTone:
            summary.past_due_count || summary.churned_count
              ? 'caution'
              : undefined,
        },
        {
          label: 'Total agency MRR',
          value: fmtUsd(summary.total_mrr),
          delta: `${fmtUsd(summary.total_rentals_mrr + summary.total_service_mrr)} from rentals and DFY`,
          valueTone: 'positive',
        },
        {
          label: 'Lifetime value',
          value: fmtUsd(summary.total_ltv),
          delta: 'revenue paid to date',
          valueTone: 'positive',
        },
        {
          label: 'Avg MRR per agency',
          value: fmtUsd(summary.avg_mrr),
          delta: 'across the portfolio',
        },
        {
          label: 'Avg partner tenure',
          value: `${summary.avg_months} mo`,
          delta: 'months as a partner',
        },
        {
          label: 'Seat utilisation',
          value: `${summary.total_accounts_active}/${summary.total_seats}`,
          delta: `${Math.round(seatFill * 100)}% seats · ${summary.total_campaigns_active} campaigns live`,
          valueTone: seatFill >= 0.6 ? 'positive' : 'caution',
        },
      ]
    : [];

  return (
    <StyledPage>
      <ConfirmHost />
      <PageHeader title="Customers" Icon={IconBuildingSkyscraper}>
        <StyledHeaderActions>
          <PillButton
            title="Customers"
            active={view === 'customers'}
            onClick={() => setView('customers')}
          />
          <PillButton
            title="Agencies"
            active={view === 'agencies'}
            onClick={() => setView('agencies')}
          />
          <PillButton
            title="Map"
            active={view === 'map'}
            onClick={() => setView('map')}
          />
        </StyledHeaderActions>
      </PageHeader>
      <StyledBody>
        <SkeletonTheme
          baseColor={'var(--t-background-tertiary)'}
          highlightColor={'var(--t-background-transparent-lighter)'}
          borderRadius={4}
        >
          <StyledContent>
            {err && <StyledError>{err}</StyledError>}

            {view === 'customers' && (
              <StyledCard>
                <StyledRow
                  style={{ justifyContent: 'space-between', marginBottom: 12 }}
                >
                  <StyledField>
                    <input
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      placeholder="Search name or email"
                      style={{ width: 260 }}
                    />
                  </StyledField>
                  <StyledRow>
                    <StyledMuted>Sort by</StyledMuted>
                    <OsSelect<LedgerSortKey>
                      id="ledger-sort"
                      value={sortKey}
                      onChange={(k) => {
                        setSortKey(k);
                        setSortDir(LEDGER_SORT[k].numeric ? 'desc' : 'asc');
                      }}
                      options={SORT_OPTIONS.map((o) => ({
                        value: o.key,
                        label: o.label,
                      }))}
                    />
                    <Button
                      size="small"
                      variant="secondary"
                      title={
                        sortDir === 'asc'
                          ? LEDGER_SORT[sortKey].numeric
                            ? 'Low to high'
                            : 'A to Z'
                          : LEDGER_SORT[sortKey].numeric
                            ? 'High to low'
                            : 'Z to A'
                      }
                      onClick={() =>
                        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
                      }
                    />
                  </StyledRow>
                </StyledRow>
                <StyledScroll>
                  <StyledTable>
                    <thead>
                      <tr>
                        <th>
                          <SortHead
                            label="Customer"
                            sortKey="name"
                            activeKey={sortKey}
                            dir={sortDir}
                            onSort={onLedgerSort}
                          />
                        </th>
                        <th>
                          <SortHead
                            label="Status"
                            sortKey="status"
                            activeKey={sortKey}
                            dir={sortDir}
                            onSort={onLedgerSort}
                          />
                        </th>
                        <th>Source</th>
                        <th>Closer</th>
                        <th>
                          <SortHead
                            label="Total paid"
                            sortKey="total_paid"
                            activeKey={sortKey}
                            dir={sortDir}
                            onSort={onLedgerSort}
                          />
                        </th>
                        <th>
                          <SortHead
                            label="Payments"
                            sortKey="payments"
                            activeKey={sortKey}
                            dir={sortDir}
                            onSort={onLedgerSort}
                          />
                        </th>
                        <th>
                          <SortHead
                            label="First paid"
                            sortKey="first_paid"
                            activeKey={sortKey}
                            dir={sortDir}
                            onSort={onLedgerSort}
                          />
                        </th>
                        <th>
                          <SortHead
                            label="Last paid"
                            sortKey="last_paid"
                            activeKey={sortKey}
                            dir={sortDir}
                            onSort={onLedgerSort}
                          />
                        </th>
                        <th>Call</th>
                        {SHOW_ATTRIBUTION && <th>Attribution</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {rows === null && (
                        <tr>
                          <td
                            colSpan={10}
                            style={{ textAlign: 'center', padding: 24 }}
                          >
                            <StyledMuted>Loading…</StyledMuted>
                          </td>
                        </tr>
                      )}
                      {rows !== null && visible.length === 0 && (
                        <tr>
                          <td
                            colSpan={10}
                            style={{ textAlign: 'center', padding: 24 }}
                          >
                            <StyledMuted>No customers.</StyledMuted>
                          </td>
                        </tr>
                      )}
                      {visible.map((r) => {
                        const isBusy = busy === r.customer_id;
                        const isLinkedin = r.source === 'linkedin_outreach';
                        return (
                          <StyledLedgerRow
                            key={r.customer_id}
                            style={isBusy ? { opacity: 0.4 } : undefined}
                          >
                            <td data-name>
                              <div data-primary>
                                <StyledTextLink
                                  to={`/records?type=customer_payments&arg=${encodeURIComponent(r.customer_id)}&name=${encodeURIComponent(r.name ?? '')}&back=/customers`}
                                >
                                  {r.name}
                                </StyledTextLink>
                              </div>
                              <div data-secondary>
                                {r.email}
                                {r.plan ? ` · ${r.plan}` : ''}
                              </div>
                            </td>
                            <td>
                              {r.status ? (
                                <StyledChip
                                  data-tone={
                                    r.status === 'active'
                                      ? 'positive'
                                      : undefined
                                  }
                                >
                                  {r.status}
                                </StyledChip>
                              ) : (
                                <StyledMuted>—</StyledMuted>
                              )}
                            </td>
                            <td>
                              {r.source ? (
                                srcLabel(r.source)
                              ) : (
                                <StyledMuted>—</StyledMuted>
                              )}
                            </td>
                            <td>
                              {isLinkedin && r.closer ? (
                                firstName(r.closer)
                              ) : (
                                <StyledMuted>—</StyledMuted>
                              )}
                            </td>
                            <td data-num style={{ fontWeight: 600 }}>
                              {fmtUsd(r.total_paid)}
                            </td>
                            <td
                              data-num
                              style={
                                r.payments > 1 ? { color: POSITIVE } : undefined
                              }
                            >
                              {r.payments}×
                            </td>
                            <td data-num>{fmtDate(r.first_paid)}</td>
                            <td data-num>{fmtDate(r.last_paid)}</td>
                            <td>
                              {r.fathom_url ? (
                                <StyledExtLink
                                  href={r.fathom_url}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  ▶ Watch
                                </StyledExtLink>
                              ) : (
                                <StyledMuted>—</StyledMuted>
                              )}
                            </td>
                            {SHOW_ATTRIBUTION && (
                              <td>
                                <StyledRow>
                                  <StyledSelect
                                    disabled={isBusy}
                                    value={r.source ?? ''}
                                    onChange={(e) => {
                                      const v = e.target.value;
                                      if (v === '')
                                        act(
                                          clearSaleOverride(r.customer_id),
                                          r.customer_id,
                                        );
                                      else
                                        act(
                                          setSaleAttribution(
                                            r.customer_id,
                                            v,
                                            v === 'linkedin_outreach'
                                              ? (r.closer ?? defaultCloser)
                                              : null,
                                          ),
                                          r.customer_id,
                                        );
                                    }}
                                  >
                                    <option value="">Auto / reset</option>
                                    {SOURCES.map((s) => (
                                      <option key={s.key} value={s.key}>
                                        {s.label}
                                      </option>
                                    ))}
                                  </StyledSelect>
                                  {isLinkedin && (
                                    <OsSelect
                                      id={`closer-${r.customer_id}`}
                                      disabled={isBusy}
                                      value={r.closer ?? defaultCloser}
                                      onChange={(value) =>
                                        act(
                                          setSaleAttribution(
                                            r.customer_id,
                                            'linkedin_outreach',
                                            value,
                                          ),
                                          r.customer_id,
                                        )
                                      }
                                      options={(r.closer &&
                                      !closerNames.includes(r.closer)
                                        ? [r.closer, ...closerNames]
                                        : closerNames
                                      ).map((name) => ({
                                        value: name,
                                        label: name,
                                      }))}
                                    />
                                  )}
                                  {!r.source && (
                                    <Button
                                      size="small"
                                      variant="tertiary"
                                      title="Delete dud"
                                      disabled={isBusy}
                                      onClick={async () => {
                                        if (
                                          await confirm({
                                            title: `Delete ${r.name}?`,
                                            message:
                                              'This hides a dud from every number.',
                                            confirmText: 'Delete',
                                            danger: true,
                                          })
                                        )
                                          act(
                                            excludeSale(r.customer_id),
                                            r.customer_id,
                                          );
                                      }}
                                    />
                                  )}
                                </StyledRow>
                              </td>
                            )}
                          </StyledLedgerRow>
                        );
                      })}
                    </tbody>
                  </StyledTable>
                </StyledScroll>
                <StyledFootnote>
                  {visible.length} of {rows?.length ?? 0} paying customers ·{' '}
                  {fmtUsd(visibleTotal)} paid in this view · column headers also
                  sort
                </StyledFootnote>
              </StyledCard>
            )}

            {view === 'map' && <CustomerMap />}

            {view === 'agencies' && (
              <>
                <StyledRow style={{ justifyContent: 'space-between' }}>
                  <StyledMuted>
                    Priority accounts: live MRR across every subscription (plan,
                    rentals, services), lifetime value, standing and notes.
                  </StyledMuted>
                  <StyledRow>
                    {refreshStatus && !refreshing && (
                      <Tag
                        color={refreshStatus.ok ? 'green' : 'orange'}
                        text={refreshStatus.msg}
                      />
                    )}
                    {refreshing && (
                      <StyledMuted>{refreshStatus?.msg}</StyledMuted>
                    )}
                    <Button
                      size="small"
                      variant="secondary"
                      Icon={IconRefresh}
                      title={refreshing ? 'Refreshing…' : 'Refresh data'}
                      disabled={refreshing}
                      onClick={refreshAgencyData}
                    />
                  </StyledRow>
                </StyledRow>
                <StyledGrid6>
                  {summary
                    ? agencyKpis.map((k) => <KpiTile key={k.label} kpi={k} />)
                    : Array.from({ length: 6 }).map((_, i) => (
                        <StyledCard
                          key={i}
                          style={{
                            minHeight: 92,
                            justifyContent: 'space-between',
                          }}
                        >
                          <Skeleton width={90} height={10} />
                          <Skeleton width={60} height={22} />
                          <Skeleton width={40} height={10} />
                        </StyledCard>
                      ))}
                </StyledGrid6>
                {drilldown && (
                  <SeatDrilldown
                    agency={drilldown}
                    onClose={() => setDrilldown(null)}
                  />
                )}
                <StyledCard>
                  <StyledCardHead>
                    <StyledCardTitle>Portfolio</StyledCardTitle>
                    <StyledCardHint>
                      MRR = all active subscriptions · LTV = paid to date · edit
                      standing and notes inline
                    </StyledCardHint>
                  </StyledCardHead>
                  <StyledScroll>
                    <StyledTable>
                      <thead>
                        <tr>
                          <th>
                            <SortHead
                              label="Agency"
                              sortKey="name"
                              activeKey={agencySortKey}
                              dir={agencySortDir}
                              onSort={onAgencySort}
                            />
                          </th>
                          <th>
                            <SortHead
                              label="Plan"
                              sortKey="plan"
                              activeKey={agencySortKey}
                              dir={agencySortDir}
                              onSort={onAgencySort}
                            />
                          </th>
                          <th>
                            <SortHead
                              label="MRR / mo"
                              sortKey="total_mrr"
                              activeKey={agencySortKey}
                              dir={agencySortDir}
                              onSort={onAgencySort}
                            />
                          </th>
                          <th>
                            <SortHead
                              label="LTV"
                              sortKey="ltv"
                              activeKey={agencySortKey}
                              dir={agencySortDir}
                              onSort={onAgencySort}
                            />
                          </th>
                          <th>
                            <SortHead
                              label="Activity"
                              sortKey="accounts_active"
                              activeKey={agencySortKey}
                              dir={agencySortDir}
                              onSort={onAgencySort}
                            />
                          </th>
                          <th>Standing</th>
                          <th>Notes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {agencies === null && (
                          <tr>
                            <td
                              colSpan={7}
                              style={{ textAlign: 'center', padding: 24 }}
                            >
                              <StyledMuted>Loading…</StyledMuted>
                            </td>
                          </tr>
                        )}
                        {displayAgencies.map((r) => {
                          const standing = STANDING[r.status] ?? STANDING.good;
                          const pay = PAYMENT_BADGE[r.payment_status];
                          const h = health(r);
                          const seatPct = r.seats
                            ? Math.round((r.accounts_active / r.seats) * 100)
                            : 0;
                          return (
                            <tr
                              key={r.customer_id}
                              style={
                                r.payment_status === 'churned'
                                  ? { opacity: 0.6 }
                                  : undefined
                              }
                            >
                              <td>
                                <div style={{ fontWeight: 500 }}>{r.name}</div>
                                <StyledMuted>{r.email ?? '—'}</StyledMuted>
                                {pay && (
                                  <div style={{ marginTop: 4 }}>
                                    <Tag color={pay.color} text={pay.label} />
                                  </div>
                                )}
                              </td>
                              <td>
                                <StyledChip>{r.plan}</StyledChip>
                              </td>
                              <td>
                                <div style={{ fontWeight: 600 }}>
                                  {fmtUsd(r.total_mrr)}
                                </div>
                                <StyledMuted>
                                  {fmtUsd(r.software_mrr)} plan
                                  {r.rentals_mrr > 0
                                    ? ` + ${fmtUsd(r.rentals_mrr)} rentals`
                                    : ''}
                                  {r.service_mrr > 0
                                    ? ` + ${fmtUsd(r.service_mrr)} DFY`
                                    : ''}
                                </StyledMuted>
                              </td>
                              <td>
                                <div style={{ fontWeight: 600 }}>
                                  {fmtUsd(r.ltv)}
                                </div>
                                <StyledMuted>{r.months_active} mo</StyledMuted>
                              </td>
                              <td>
                                <StyledHealthButton
                                  type="button"
                                  onClick={() => setDrilldown(r)}
                                  title="View this agency's seats: live, idle and disconnected"
                                >
                                  <span
                                    data-dot
                                    style={{
                                      background:
                                        HEALTH_COLOR[h] ??
                                        'var(--t-font-color-light)',
                                    }}
                                  />
                                  <div>
                                    <div>
                                      {r.accounts_active}/{r.seats} seats{' '}
                                      <StyledMuted>({seatPct}%)</StyledMuted>
                                    </div>
                                    <div data-sub>
                                      {r.campaigns_active} campaign
                                      {r.campaigns_active === 1 ? '' : 's'} live
                                      {r.accounts_total > r.accounts_active
                                        ? ` · ${r.accounts_total - r.accounts_active} disconnected`
                                        : ''}
                                    </div>
                                  </div>
                                </StyledHealthButton>
                              </td>
                              <td>
                                <StyledRow>
                                  <StyledChip data-tone={standing.tone}>
                                    {standing.label}
                                  </StyledChip>
                                  <OsSelect
                                    id={`standing-${r.customer_id}`}
                                    value={r.status}
                                    disabled={saving === r.customer_id}
                                    onChange={(value) => {
                                      setLocal(r.customer_id, {
                                        status: value,
                                      });
                                      persist(r.customer_id, value, r.notes);
                                    }}
                                    options={STANDING_ORDER.map((k) => ({
                                      value: k,
                                      label: STANDING[k].label,
                                    }))}
                                  />
                                </StyledRow>
                              </td>
                              <td>
                                <StyledNotes
                                  rows={2}
                                  value={r.notes ?? ''}
                                  placeholder="Feature requests, health, action items"
                                  onChange={(e) =>
                                    setLocal(r.customer_id, {
                                      notes: e.target.value,
                                    })
                                  }
                                  onBlur={(e) =>
                                    persist(
                                      r.customer_id,
                                      r.status,
                                      e.target.value || null,
                                    )
                                  }
                                />
                                {savedAt === r.customer_id && (
                                  <StyledMuted style={{ color: POSITIVE }}>
                                    ✓ saved
                                  </StyledMuted>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </StyledTable>
                  </StyledScroll>
                  {summary && (
                    <StyledFootnote>
                      {summary.count} agencies · {fmtUsd(summary.total_mrr)} MRR
                      · {fmtUsd(summary.total_ltv)} lifetime
                    </StyledFootnote>
                  )}
                </StyledCard>
              </>
            )}
          </StyledContent>
        </SkeletonTheme>
      </StyledBody>
    </StyledPage>
  );
};
