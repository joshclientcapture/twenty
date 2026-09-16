import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { IconArrowLeft, IconList } from 'twenty-ui/icon';
import { Button } from 'twenty-ui/input';

import { PageHeader } from '@/ui/layout/page/components/PageHeader';
import {
  fmtDate,
  fmtDateTime,
  fmtUsd,
  StyledBody,
  StyledCaution,
  StyledChip,
  StyledContent,
  StyledExtLink,
  StyledField,
  StyledHeaderActions,
  StyledLabel,
  StyledMuted,
  StyledPage,
  StyledPositive,
  StyledRow,
  StyledTable,
  StyledTableCard,
  StyledTextLink,
} from '@/custom-pages/os/ui';
import {
  fetchRecords,
  markCommissionPaid,
  markSetterBonus,
  RECRUITERS,
  setSetterRecruiter,
  type RecordRow,
} from '@/custom-pages/os/data';

type Col = { key: string; header: string; kind: 'text' | 'datetime' | 'date' | 'recording' | 'bool' | 'money' | 'days' | 'eligibility' | 'payment' | 'campaign' | 'requests' };

const setterCols: Col[] = [
  { key: 'name', header: 'Setter', kind: 'text' },
  { key: 'added', header: 'Added', kind: 'date' },
  { key: 'days_active', header: 'Days active', kind: 'days' },
  { key: 'campaign', header: 'Campaign', kind: 'campaign' },
  { key: 'requests_sent', header: 'Requests sent', kind: 'requests' },
  { key: 'status', header: 'Status', kind: 'text' },
  { key: 'eligibility', header: '30-day bonus', kind: 'eligibility' },
];

// Setter-bonus payout list: verify tenure & campaign status before marking a $25 bonus paid.
const setterBonusCols: Col[] = [
  { key: 'name', header: 'Setter', kind: 'text' },
  { key: 'added', header: 'Onboarded', kind: 'date' },
  { key: 'days_active', header: 'Days active', kind: 'days' },
  { key: 'campaign', header: 'Campaign', kind: 'campaign' },
  { key: 'requests_sent', header: 'Requests sent', kind: 'requests' },
  { key: 'status', header: 'Connection', kind: 'text' },
  { key: 'eligibility', header: '30-day bonus', kind: 'eligibility' },
];

const commCols: Col[] = [
  { key: 'name', header: 'Customer', kind: 'text' },
  { key: 'email', header: 'Email', kind: 'text' },
  { key: 'date', header: 'Payment date', kind: 'datetime' },
  { key: 'payment_no', header: 'Payment #', kind: 'payment' },
  { key: 'amount', header: 'Amount', kind: 'money' },
  { key: 'commission', header: 'Commission (10%)', kind: 'money' },
];

const CONFIG: Record<string, { title: string; sub: string; cols: Col[]; back: string }> = {
  calls: {
    title: 'Appointments sat', sub: 'New appointments attended (Fathom recording matched a held booking) — excludes Next Steps follow-ups & internal meetings', back: '/therapon',
    cols: [
      { key: 'name', header: 'Prospect', kind: 'text' },
      { key: 'email', header: 'Email', kind: 'text' },
      { key: 'date', header: 'Date & time', kind: 'datetime' },
      { key: 'recording', header: 'Recording', kind: 'recording' },
    ],
  },
  bookings: {
    title: 'Appointments booked', sub: 'Calendly bookings', back: '/therapon',
    cols: [
      { key: 'name', header: 'Prospect', kind: 'text' },
      { key: 'email', header: 'Email', kind: 'text' },
      { key: 'date', header: 'Booked for', kind: 'datetime' },
      { key: 'status', header: 'Status', kind: 'text' },
      { key: 'event', header: 'Event', kind: 'text' },
    ],
  },
  cancellations: {
    title: 'Cancellations', sub: 'Genuine cancellations only — reschedules are excluded (they land on the new date)', back: '/therapon',
    cols: [
      { key: 'name', header: 'Prospect', kind: 'text' },
      { key: 'email', header: 'Email', kind: 'text' },
      { key: 'date', header: 'Was booked for', kind: 'datetime' },
      { key: 'reason', header: 'Reason', kind: 'text' },
    ],
  },
  noshows: {
    title: 'No-shows', sub: 'Held appointments (not cancelled, not rescheduled) with no Fathom recording', back: '/therapon',
    cols: [
      { key: 'name', header: 'Prospect', kind: 'text' },
      { key: 'email', header: 'Email', kind: 'text' },
      { key: 'date', header: 'Was booked for', kind: 'datetime' },
    ],
  },
  trials: {
    title: 'Trials started', sub: 'From the Conversifi database', back: '/sales',
    cols: [
      { key: 'name', header: 'Customer', kind: 'text' },
      { key: 'email', header: 'Email', kind: 'text' },
      { key: 'status', header: 'Status', kind: 'text' },
      { key: 'plan', header: 'Plan', kind: 'text' },
      { key: 'date', header: 'Signed up', kind: 'date' },
      { key: 'trial_ends', header: 'Trial ends', kind: 'date' },
      { key: 'paid', header: 'Paid', kind: 'bool' },
    ],
  },
  therapon_customers: {
    title: 'Therapon — customers', sub: "Every customer he closed · filter by status or plan to see who's still active", back: '/therapon',
    cols: [
      { key: 'name', header: 'Customer', kind: 'text' },
      { key: 'email', header: 'Email', kind: 'text' },
      { key: 'status', header: 'Status', kind: 'text' },
      { key: 'paid', header: 'Active', kind: 'bool' },
      { key: 'plan', header: 'Plan', kind: 'text' },
      { key: 'mrr', header: 'MRR / mo', kind: 'money' },
      { key: 'total_paid', header: 'Total paid', kind: 'money' },
      { key: 'date', header: 'First paid', kind: 'date' },
      { key: 'recording', header: 'Call', kind: 'recording' },
    ],
  },
  sales: {
    title: 'Sales — payments', sub: 'Every payment attributed to Therapon · repeat payments marked · click a name for full history', back: '/therapon',
    cols: [
      { key: 'name', header: 'Customer', kind: 'text' },
      { key: 'email', header: 'Email', kind: 'text' },
      { key: 'date', header: 'Payment date', kind: 'datetime' },
      { key: 'amount', header: 'Amount', kind: 'money' },
      { key: 'payment_no', header: 'Payment #', kind: 'payment' },
      { key: 'total_paid', header: 'Total paid', kind: 'money' },
      { key: 'recording', header: 'First call', kind: 'recording' },
    ],
  },
  sales_comm_due: { title: 'Commission — outstanding', sub: "Payments whose 10% commission hasn't been paid yet · mark each once settled", cols: commCols, back: '/therapon' },
  sales_comm_paid: { title: 'Commission — paid', sub: 'Payments whose 10% commission has been paid out', cols: commCols, back: '/therapon' },
  customer_payments: {
    title: 'Customer payments', sub: 'Every payment from this customer', back: '/therapon',
    cols: [
      { key: 'date', header: 'Date', kind: 'datetime' },
      { key: 'payment_no', header: 'Payment #', kind: 'payment' },
      { key: 'amount', header: 'Amount', kind: 'money' },
      { key: 'status', header: 'Status', kind: 'text' },
    ],
  },
  new_customers: {
    title: 'New customers', sub: 'Customers who started paying in this period', back: '/sales',
    cols: [
      { key: 'name', header: 'Customer', kind: 'text' },
      { key: 'email', header: 'Email', kind: 'text' },
      { key: 'plan', header: 'Plan', kind: 'text' },
      { key: 'interval', header: 'Cycle', kind: 'text' },
      { key: 'mrr', header: 'MRR', kind: 'money' },
      { key: 'arr', header: 'ARR', kind: 'money' },
      { key: 'date', header: 'Became a customer', kind: 'date' },
      { key: 'status', header: 'Status', kind: 'text' },
    ],
  },
  churned_customers: {
    title: 'Churned customers', sub: 'Customers who fully cancelled in this period — no active subscription remaining', back: '/sales',
    cols: [
      { key: 'name', header: 'Customer', kind: 'text' },
      { key: 'email', header: 'Email', kind: 'text' },
      { key: 'plan', header: 'Plan', kind: 'text' },
      { key: 'mrr', header: 'MRR lost', kind: 'money' },
      { key: 'arr', header: 'ARR lost', kind: 'money' },
      { key: 'start_date', header: 'Customer since', kind: 'date' },
      { key: 'date', header: 'Churned on', kind: 'date' },
      { key: 'status', header: 'Status', kind: 'text' },
    ],
  },
  setters_added: { title: 'Setters added', sub: 'New appointment setters by month', cols: setterCols, back: '/sales' },
  setters_idle: { title: 'Idle setters', sub: 'Connected but not in an active campaign', cols: setterCols, back: '/sales' },
  setters_active: { title: 'Active setters', sub: 'In an active campaign', cols: setterCols, back: '/sales' },
  setters_disconnected: { title: 'Disconnected setters', sub: 'Need reconnect', cols: setterCols, back: '/sales' },
  setters_eligible: { title: 'Bonus-eligible setters', sub: '30+ days active — recruiter bonus earned', cols: setterCols, back: '/sales' },
  setters_bonus_due: { title: 'Setter bonuses — due', sub: "Eligible 30+ day setters whose $25 bonus hasn't been paid yet — check tenure & campaign, then mark paid", cols: setterBonusCols, back: '/sales' },
  setters_bonus_paid: { title: 'Setter bonuses — paid', sub: 'Eligible setters whose $25 bonus has already been paid out', cols: setterBonusCols, back: '/sales' },
  setters_pending: { title: 'Pending setters', sub: 'Active, still under 30 days', cols: setterCols, back: '/sales' },
  setters_all: { title: 'All setters', sub: 'Tenure & 30-day bonus eligibility', cols: setterCols, back: '/sales' },
  setters_archived: { title: 'Archived accounts', sub: 'Archived copies — excluded from setter metrics & bonuses', cols: setterCols, back: '/sales' },
};

// Column sorting: numeric/date kinds sort by value (default high→low), everything else alphabetically.
const NUMERIC_KINDS = new Set<string>(['money', 'days', 'payment', 'requests']);
const DATE_KINDS = new Set<string>(['date', 'datetime']);
const sortValue = (v: RecordRow[string], kind?: string): number | string => {
  if (v == null || v === '') return kind && (NUMERIC_KINDS.has(kind) || DATE_KINDS.has(kind)) ? -Infinity : '';
  if (kind && DATE_KINDS.has(kind)) return new Date(String(v)).getTime();
  if (kind && NUMERIC_KINDS.has(kind)) return Number(v);
  if (typeof v === 'boolean') return v ? 1 : 0;
  const n = Number(v);
  if (typeof v === 'number' || (String(v).trim() !== '' && !isNaN(n))) return n;
  return String(v).toLowerCase();
};

const Cell = ({ col, value }: { col: Col; value: RecordRow[string] }) => {
  if (value == null || value === '') return <StyledMuted>—</StyledMuted>;
  switch (col.kind) {
    case 'datetime': return <span>{fmtDateTime(String(value))}</span>;
    case 'date': return <span>{fmtDate(String(value))}</span>;
    case 'money': return <span style={{ fontWeight: 500 }}>{fmtUsd(Number(value))}</span>;
    case 'bool': return value ? <StyledPositive>Yes</StyledPositive> : <StyledMuted>No</StyledMuted>;
    case 'recording': return <StyledExtLink href={String(value)} target="_blank" rel="noreferrer">▶ Watch</StyledExtLink>;
    case 'days': return <span>{Number(value)} days</span>;
    case 'payment': {
      const n = Number(value);
      const ord = n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`;
      return n > 1 ? <StyledPositive>{ord} · repeat</StyledPositive> : <StyledMuted>{ord} · new</StyledMuted>;
    }
    case 'eligibility': {
      const v = String(value);
      if (v === 'eligible') return <StyledChip data-tone="positive">Eligible</StyledChip>;
      if (v === 'paused') return <StyledChip data-tone="caution">Paused</StyledChip>;
      return <StyledChip>Pending</StyledChip>;
    }
    case 'campaign':
      return String(value) === 'In campaign' ? <StyledChip data-tone="positive">● In campaign</StyledChip> : <StyledChip>○ Dormant</StyledChip>;
    case 'requests': {
      const n = Number(value);
      return n === 0 ? <StyledCaution>0 · none sent</StyledCaution> : <span>{n.toLocaleString()} <StyledMuted>reqs</StyledMuted></span>;
    }
    default: return <span>{String(value)}</span>;
  }
};

const SortMark = ({ on, dir }: { on: boolean; dir: 'asc' | 'desc' }) => (
  <span data-sort={on ? 'on' : undefined}>{on ? (dir === 'asc' ? '▲' : '▼') : '↕'}</span>
);

export const RecordsPage = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const type = params.get('type') ?? 'calls';
  const month = params.get('month');
  const arg = params.get('arg');
  const from = params.get('from');
  const to = params.get('to');
  const nameParam = params.get('name');
  const cfg = CONFIG[type] ?? CONFIG.calls;
  const isSetter = type.startsWith('setters');
  const isComm = type === 'sales' || type === 'sales_comm_due' || type === 'sales_comm_paid';

  const [rows, setRows] = useState<RecordRow[] | null>(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [statusF, setStatusF] = useState('all');
  const [planF, setPlanF] = useState('all');
  const [monthF, setMonthF] = useState('all');
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const load = () => fetchRecords(type, month, arg, from, to).then(setRows).catch(() => setRows([]));
  useEffect(() => {
    setRows(null);
    load();
  }, [type, month, arg, from, to]);

  const reattr = async (accountId: string, recruiter: string) => {
    setBusy(accountId);
    try { await setSetterRecruiter(accountId, recruiter); await load(); } finally { setBusy(null); }
  };
  const toggleBonus = async (accountId: string, paid: boolean) => {
    setBusy(accountId);
    try { await markSetterBonus(accountId, paid); await load(); } finally { setBusy(null); }
  };
  const toggleComm = async (paymentId: string, paid: boolean) => {
    setBusy(paymentId);
    try { await markCommissionPaid(paymentId, paid); await load(); } finally { setBusy(null); }
  };

  const monthLabel = from || to
    ? `${from ?? 'start'} → ${to ?? 'now'}`
    : month
      ? new Date(month + '-01').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
      : 'All time';
  const pageTitle = type === 'customer_payments' && nameParam
    ? `Payments — ${nameParam}`
    : nameParam && (from || to)
      ? `${cfg.title} — ${nameParam}`
      : cfg.title;

  const statuses = useMemo(() => Array.from(new Set((rows ?? []).map((r) => r.status).filter(Boolean).map(String))), [rows]);
  const plans = useMemo(() => Array.from(new Set((rows ?? []).map((r) => r.plan).filter(Boolean).map(String))).sort(), [rows]);
  const monthsAvail = useMemo(() => Array.from(new Set((rows ?? []).map((r) => (r.date ? String(r.date).slice(0, 7) : '')).filter(Boolean))).sort().reverse(), [rows]);

  const sortKind = useMemo(() => cfg.cols.find((c) => c.key === sortKey)?.kind, [cfg, sortKey]);
  const toggleSort = (key: string, kind?: string) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir(kind && (NUMERIC_KINDS.has(kind) || DATE_KINDS.has(kind)) ? 'desc' : 'asc'); }
  };

  const visible = useMemo(() => {
    let r = rows ?? [];
    if (q.trim()) { const s = q.toLowerCase(); r = r.filter((x) => String(x.name ?? '').toLowerCase().includes(s) || String(x.email ?? '').toLowerCase().includes(s)); }
    if (statusF !== 'all') r = r.filter((x) => String(x.status) === statusF);
    if (planF !== 'all') r = r.filter((x) => String(x.plan) === planF);
    if (monthF !== 'all') r = r.filter((x) => x.date && String(x.date).slice(0, 7) === monthF);
    if (sortKey) {
      r = [...r].sort((a, b) => {
        const av = sortValue(a[sortKey], sortKind);
        const bv = sortValue(b[sortKey], sortKind);
        const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }
    return r;
  }, [rows, q, statusF, planF, monthF, sortKey, sortKind, sortDir]);

  // Average outreach volume across the visible setters (shown on setter/bonus lists).
  const avgRequests = useMemo(() => {
    const withReq = visible.filter((r) => r.requests_sent != null);
    if (!withReq.length) return null;
    return Math.round(withReq.reduce((s, r) => s + Number(r.requests_sent || 0), 0) / withReq.length);
  }, [visible]);

  const colSpan = cfg.cols.length + (isSetter ? 2 : 0) + (isComm ? 1 : 0);

  return (
    <StyledPage>
      <PageHeader title={pageTitle} Icon={IconList}>
        <StyledHeaderActions>
          <Button size="small" variant="secondary" Icon={IconArrowLeft} title="Back" onClick={() => navigate(cfg.back)} />
        </StyledHeaderActions>
      </PageHeader>
      <StyledBody>
        <StyledContent>
          <StyledRow style={{ justifyContent: 'space-between' }}>
            <StyledLabel>
              {cfg.sub} · <span style={{ color: 'var(--t-font-color-primary)' }}>{monthLabel}</span>
            </StyledLabel>
            <StyledRow>
              {statuses.length > 1 && (
                <StyledField>
                  <select value={statusF} onChange={(e) => setStatusF(e.target.value)}>
                    <option value="all">All statuses</option>
                    {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </StyledField>
              )}
              {plans.length > 1 && (
                <StyledField>
                  <select value={planF} onChange={(e) => setPlanF(e.target.value)} style={{ maxWidth: 192 }}>
                    <option value="all">All plans</option>
                    {plans.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </StyledField>
              )}
              {monthsAvail.length > 1 && (
                <StyledField>
                  <select value={monthF} onChange={(e) => setMonthF(e.target.value)}>
                    <option value="all">All months</option>
                    {monthsAvail.map((mk) => <option key={mk} value={mk}>{new Date(mk + '-01').toLocaleDateString('en-GB', { month: 'short', year: '2-digit' })}</option>)}
                  </select>
                </StyledField>
              )}
              <StyledField>
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" style={{ width: 176 }} />
              </StyledField>
            </StyledRow>
          </StyledRow>

          <StyledLabel>
            {rows === null ? 'Loading…' : `${visible.length} record${visible.length === 1 ? '' : 's'}`}
            {avgRequests != null && <span> · avg <StyledPositive>{avgRequests.toLocaleString()}</StyledPositive> requests sent</span>}
          </StyledLabel>

          <StyledTableCard>
            <div data-scroll>
              <StyledTable>
                <thead>
                  <tr>
                    {cfg.cols.map((c) => (
                      <th key={c.key}>
                        <button onClick={() => toggleSort(c.key, c.kind)}>
                          {c.header} <SortMark on={sortKey === c.key} dir={sortDir} />
                        </button>
                      </th>
                    ))}
                    {isSetter && <th><button onClick={() => toggleSort('recruiter')}>Recruiter <SortMark on={sortKey === 'recruiter'} dir={sortDir} /></button></th>}
                    {isSetter && <th><button onClick={() => toggleSort('bonus_paid')}>Bonus paid <SortMark on={sortKey === 'bonus_paid'} dir={sortDir} /></button></th>}
                    {isComm && <th>Commission paid</th>}
                  </tr>
                </thead>
                <tbody>
                  {rows === null && <tr><td colSpan={colSpan} style={{ textAlign: 'center', padding: 40 }}><StyledMuted>Loading…</StyledMuted></td></tr>}
                  {rows !== null && visible.length === 0 && <tr><td colSpan={colSpan} style={{ textAlign: 'center', padding: 40 }}><StyledMuted>No records.</StyledMuted></td></tr>}
                  {visible.map((r, i) => (
                    <tr key={i}>
                      {cfg.cols.map((c) => (
                        <td key={c.key}>
                          {c.key === 'name'
                            ? (isComm && r.customer_id
                                ? <StyledTextLink to={`/records?type=customer_payments&arg=${encodeURIComponent(String(r.customer_id))}&name=${encodeURIComponent(String(r.name ?? ''))}`}>{r.name == null ? '—' : String(r.name)}</StyledTextLink>
                                : <span style={{ fontWeight: 500 }}>{r[c.key] == null ? '—' : String(r[c.key])}</span>)
                            : c.kind === 'days' && String(r.status) === 'disconnected'
                              ? <StyledCaution title="Day count is paused while the account is disconnected">{Number(r[c.key])} days · paused</StyledCaution>
                              : <Cell col={c} value={r[c.key]} />}
                        </td>
                      ))}
                      {isSetter && (
                        <td>
                          <StyledField>
                            <select value={String(r.recruiter ?? 'Jade Vieira')} disabled={busy === r.account_id} onChange={(e) => reattr(String(r.account_id), e.target.value)}>
                              {RECRUITERS.map((rc) => <option key={rc} value={rc}>{rc}</option>)}
                            </select>
                          </StyledField>
                        </td>
                      )}
                      {isSetter && (
                        <td>
                          {r.bonus_paid
                            ? <Button size="small" variant="tertiary" accent="green" title="✓ Paid" disabled={busy === r.account_id} onClick={() => toggleBonus(String(r.account_id), false)} />
                            : r.eligibility === 'eligible'
                              ? <Button size="small" variant="secondary" title="Mark paid" disabled={busy === r.account_id} onClick={() => toggleBonus(String(r.account_id), true)} />
                              : <StyledMuted>—</StyledMuted>}
                        </td>
                      )}
                      {isComm && (
                        <td>
                          {r.commission_paid
                            ? <Button size="small" variant="tertiary" accent="green" title="✓ Paid" disabled={busy === r.payment_id} onClick={() => toggleComm(String(r.payment_id), false)} />
                            : <Button size="small" variant="secondary" title="Mark paid" disabled={busy === r.payment_id} onClick={() => toggleComm(String(r.payment_id), true)} />}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </StyledTable>
            </div>
          </StyledTableCard>
        </StyledContent>
      </StyledBody>
    </StyledPage>
  );
};
